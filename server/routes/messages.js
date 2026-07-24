/**
 * Message Routes
 * Encrypted messaging between patients and providers
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const logger = require('../middleware/logger');
const { authenticate } = require('../middleware/auth');
const { auditMiddleware } = require('../middleware/audit');
const { encrypt, decrypt } = require('../../lib/encryption');
const { validate, createMessageSchema, paginationSchema } = require('../../lib/validation');
const { keysToCamel, parseQueryParams, getPaginationMeta } = require('../../lib/utils');
const notificationService = require('../services/notifications');
const {
  assertMessagingRelationship,
  sanitizeMessageContent
} = require('../services/messageAuthorization');

// Socket.io service for real-time messaging
let socketService = null;
try {
  socketService = require('../services/socketService');
} catch (err) {
  console.warn('Socket service not available:', err.message);
}

const router = express.Router();
const messageSendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many messages sent. Please wait a moment.' }
});

/**
 * POST /api/messages
 * Send a new message
 */
router.post('/',
  authenticate,
  messageSendLimiter,
  auditMiddleware('create', 'message'),
  async (req, res) => {
    try {
      const data = validate(createMessageSchema, req.body);
      const content = sanitizeMessageContent(data.content);
      if (!content) {
        return res.status(400).json({ success: false, error: 'Message content is required' });
      }
      const { conversationId, recipient } = await assertMessagingRelationship(
        db,
        req.user.id,
        data.recipientId
      );
      
      // Encrypt message content
      let encrypted, iv, tag;
      try {
        const encryptionResult = encrypt(content);
        encrypted = encryptionResult.encrypted;
        iv = encryptionResult.iv;
        tag = encryptionResult.tag;
      } catch (encryptError) {
        logger.error('Message encryption failed', { userId: req.user.id });
        throw new Error('Message encryption failed');
      }
      
      // Create message
      let rows;
      try {
        const result = await db.query(
          `INSERT INTO messages (
            conversation_id, sender_id, recipient_id,
            content_encrypted, content_iv, content_tag,
            is_urgent, has_attachment, attachment_name, attachment_type
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING id, conversation_id, sender_id, recipient_id,
                    is_urgent, has_attachment, status, created_at`,
          [
            conversationId,
            req.user.id,
            data.recipientId,
            encrypted,
            iv,
            tag,
            data.isUrgent || false,
            !!data.attachmentName,
            data.attachmentName || null,
            data.attachmentType || null
          ]
        );
        rows = result.rows;
      } catch (dbError) {
        logger.error('Message persistence failed', {
          userId: req.user.id,
          errorCode: dbError.code
        });
        throw dbError;
      }
      
      // Create notification for recipient using notification service
      const senderName = `${req.user.firstName || req.user.first_name || 'User'} ${req.user.lastName || req.user.last_name || ''}`.trim();
      await notificationService.sendMessageNotification(
        req.user.id,
        senderName,
        data.recipientId,
        rows[0].id,
        data.isUrgent
      );
      
      // Send email notification for urgent messages
      if (data.isUrgent) {
        try {
          const emailService = require('../services/email');
          await emailService.sendNewMessageEmail(
            {
              id: recipient.id,
              email: recipient.email,
              first_name: recipient.first_name,
              role: recipient.role
            },
            senderName,
            true
          );
        } catch (emailError) {
          logger.warn('Failed to send urgent message email notification', {
            recipientId: data.recipientId
          });
        }
      }
      
      logger.info('Message sent', { 
        messageId: rows[0].id, 
        senderId: req.user.id, 
        recipientId: data.recipientId 
      });
      
      // Emit real-time message via Socket.io
      if (socketService) {
        try {
          socketService.emitNewMessage(conversationId, data.recipientId, {
            id: rows[0].id,
            conversationId,
            senderId: req.user.id,
            senderName,
            content,
            isUrgent: data.isUrgent || false,
            hasAttachment: !!data.attachmentName,
            attachmentName: data.attachmentName,
            status: 'sent',
            sentByMe: false, // For recipient
            createdAt: rows[0].created_at
          });
        } catch (socketError) {
          logger.warn('Failed to emit socket message', { error: socketError.message });
        }
      }
      
      res.status(201).json({
        success: true,
        message: 'Message sent successfully',
        data: keysToCamel(rows[0])
      });
    } catch (error) {
      if (error.status === 400) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          errors: error.errors
        });
      }
      if (error.status === 403) {
        return res.status(403).json({
          success: false,
          error: error.message
        });
      }
      
      logger.error('Send message error', { 
        error: error.message,
        code: error.code,
        userId: req.user?.id
      });
      res.status(500).json({
        success: false,
        error: 'Failed to send message'
      });
    }
  }
);

/**
 * GET /api/messages/conversations
 * Get list of conversations
 */
router.get('/conversations', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `WITH latest_messages AS (
        SELECT DISTINCT ON (conversation_id)
          conversation_id,
          id as message_id,
          sender_id,
          recipient_id,
          content_encrypted,
          content_iv,
          content_tag,
          is_urgent,
          status,
          created_at
        FROM messages
        WHERE (sender_id = $1 OR recipient_id = $1)
          AND NOT (sender_id = $1 AND is_deleted_sender)
          AND NOT (recipient_id = $1 AND is_deleted_recipient)
        ORDER BY conversation_id, created_at DESC
      )
      SELECT 
        lm.*,
        CASE 
          WHEN lm.sender_id = $1 THEN u.id
          ELSE s.id
        END as other_user_id,
        CASE 
          WHEN lm.sender_id = $1 THEN u.first_name
          ELSE s.first_name
        END as other_user_first_name,
        CASE 
          WHEN lm.sender_id = $1 THEN u.last_name
          ELSE s.last_name
        END as other_user_last_name,
        CASE 
          WHEN lm.sender_id = $1 THEN u.role
          ELSE s.role
        END as other_user_role,
        (SELECT COUNT(*) FROM messages m 
         WHERE m.conversation_id = lm.conversation_id 
         AND m.recipient_id = $1 
         AND m.status != 'read') as unread_count
      FROM latest_messages lm
      JOIN users s ON s.id = lm.sender_id
      JOIN users u ON u.id = lm.recipient_id
      ORDER BY lm.created_at DESC`,
      [req.user.id]
    );
    
    // Decrypt preview of last message
    const conversations = rows.map(row => {
      let preview = 'Tap to view conversation';
      try {
        const decryptedContent = decrypt(row.content_encrypted, row.content_iv, row.content_tag);
        if (decryptedContent) {
          preview = decryptedContent.substring(0, 50) + (decryptedContent.length > 50 ? '...' : '');
        }
      } catch (decryptError) {
        logger.warn('Failed to decrypt message preview', { 
          messageId: row.message_id, 
          error: decryptError.message 
        });
      }
      
      return {
        conversationId: row.conversation_id,
        otherUser: {
          id: row.other_user_id,
          firstName: row.other_user_first_name,
          lastName: row.other_user_last_name,
          role: row.other_user_role
        },
        lastMessage: {
          id: row.message_id,
          preview,
          isUrgent: row.is_urgent,
          status: row.status,
          sentByMe: row.sender_id === req.user.id,
          createdAt: row.created_at
        },
        unreadCount: parseInt(row.unread_count)
      };
    });
    
    res.json({
      success: true,
      conversations
    });
  } catch (error) {
    logger.error('Get conversations error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get conversations'
    });
  }
});

/**
 * GET /api/messages/conversation/:recipientId
 * Get messages in a conversation
 */
router.get('/conversation/:recipientId', authenticate, async (req, res) => {
  try {
    const { recipientId } = req.params;
    const filters = validate(paginationSchema, req.query);
    const { page, limit } = parseQueryParams(filters);
    const offset = (page - 1) * limit;
    const { conversationId } = await assertMessagingRelationship(db, req.user.id, recipientId);
    
    // Get total count
    const { rows: countResult } = await db.query(
      `SELECT COUNT(*) FROM messages 
       WHERE conversation_id = $1
       AND NOT (sender_id = $2 AND is_deleted_sender)
       AND NOT (recipient_id = $2 AND is_deleted_recipient)`,
      [conversationId, req.user.id]
    );
    const total = parseInt(countResult[0].count);
    
    // Get messages
    const { rows } = await db.query(
      `SELECT m.*,
              s.first_name as sender_first_name,
              s.last_name as sender_last_name
       FROM messages m
       JOIN users s ON s.id = m.sender_id
       WHERE m.conversation_id = $1
       AND NOT (m.sender_id = $2 AND m.is_deleted_sender)
       AND NOT (m.recipient_id = $2 AND m.is_deleted_recipient)
       ORDER BY m.created_at DESC
       LIMIT $3 OFFSET $4`,
      [conversationId, req.user.id, limit, offset]
    );
    
    // Mark messages as read
    await db.query(
      `UPDATE messages SET status = 'read', read_at = NOW()
       WHERE conversation_id = $1 AND recipient_id = $2 AND status != 'read'`,
      [conversationId, req.user.id]
    );
    
    // Decrypt messages
    const messages = rows.map(row => {
      let content = null;
      try {
        content = decrypt(row.content_encrypted, row.content_iv, row.content_tag);
      } catch (decryptError) {
        logger.warn('Failed to decrypt message', { 
          messageId: row.id, 
          error: decryptError.message 
        });
      }
      if (!content) {
        content = '[Message from a previous session]';
      }
      
      return {
        id: row.id,
        conversationId: row.conversation_id,
        senderId: row.sender_id,
        senderName: `${row.sender_first_name} ${row.sender_last_name}`,
        content,
        isUrgent: row.is_urgent,
        hasAttachment: row.has_attachment,
        attachmentName: row.attachment_name,
        attachmentType: row.attachment_type,
        status: row.status,
        sentByMe: row.sender_id === req.user.id,
        createdAt: row.created_at,
        readAt: row.read_at
      };
    });
    
    res.json({
      success: true,
      conversationId,
      messages: messages.reverse(), // Oldest first for display
      pagination: getPaginationMeta(total, page, limit)
    });
  } catch (error) {
    if (error.status === 403) {
      return res.status(403).json({ success: false, error: error.message });
    }
    logger.error('Get conversation messages error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get messages'
    });
  }
});

/**
 * GET /api/messages/unread-count
 * Get total unread message count
 */
router.get('/unread-count', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT COUNT(*) FROM messages 
       WHERE recipient_id = $1 AND status != 'read' AND NOT is_deleted_recipient`,
      [req.user.id]
    );
    
    res.json({
      success: true,
      unreadCount: parseInt(rows[0].count)
    });
  } catch (error) {
    logger.error('Get unread count error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get unread count'
    });
  }
});

/**
 * PUT /api/messages/:id/read
 * Mark message as read
 */
router.put('/:id/read', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    const { rows } = await db.query(
      `UPDATE messages SET status = 'read', read_at = NOW()
       WHERE id = $1 AND recipient_id = $2
       RETURNING id, status, read_at`,
      [id, req.user.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Message not found'
      });
    }
    
    res.json({
      success: true,
      message: keysToCamel(rows[0])
    });
  } catch (error) {
    logger.error('Mark message read error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to mark message as read'
    });
  }
});

/**
 * DELETE /api/messages/:id
 * Delete message (soft delete for current user)
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get message
    const { rows: messages } = await db.query(
      'SELECT sender_id, recipient_id FROM messages WHERE id = $1',
      [id]
    );
    
    if (messages.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Message not found'
      });
    }
    
    const message = messages[0];
    
    // Determine which delete flag to set
    if (message.sender_id === req.user.id) {
      await db.query(
        'UPDATE messages SET is_deleted_sender = true WHERE id = $1',
        [id]
      );
    } else if (message.recipient_id === req.user.id) {
      await db.query(
        'UPDATE messages SET is_deleted_recipient = true WHERE id = $1',
        [id]
      );
    } else {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }
    
    res.json({
      success: true,
      message: 'Message deleted'
    });
  } catch (error) {
    logger.error('Delete message error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to delete message'
    });
  }
});

/**
 * GET /api/messages/online-status/:userId
 * Check if a user is online
 */
router.get('/online-status/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    await assertMessagingRelationship(db, req.user.id, userId);
    
    const isOnline = socketService ? socketService.isUserOnline(userId) : false;
    const lastSeen = socketService ? socketService.getUserLastSeen(userId) : null;
    
    res.json({
      success: true,
      userId,
      isOnline,
      lastSeen
    });
  } catch (error) {
    if (error.status === 403) {
      return res.status(403).json({ success: false, error: error.message });
    }
    logger.error('Get online status error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get online status'
    });
  }
});

/**
 * GET /api/messages/online-users
 * Get list of online users
 */
router.get('/online-users', authenticate, async (req, res) => {
  try {
    const { rows: contacts } = await db.query(
      `SELECT DISTINCT
          CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS user_id
         FROM messages
        WHERE sender_id = $1 OR recipient_id = $1`,
      [req.user.id]
    );
    const contactIds = new Set(contacts.map((row) => String(row.user_id)));
    const onlineUsers = socketService
      ? socketService.getOnlineUsers().filter((user) => contactIds.has(String(user.userId)))
      : [];
    
    res.json({
      success: true,
      users: onlineUsers
    });
  } catch (error) {
    logger.error('Get online users error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get online users'
    });
  }
});

module.exports = router;

