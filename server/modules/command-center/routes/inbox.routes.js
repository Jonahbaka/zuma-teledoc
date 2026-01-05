/**
 * Inbox Routes
 * Email inbox management endpoints
 * @module command-center/routes/inbox
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../../../db');
const { encrypt, decrypt } = require('../../../lib/encryption');
const logger = require('../../../middleware/logger');
const { authenticate, requireRole } = require('../../../middleware/auth');
const { createAuditLog } = require('../../../middleware/audit');
const emailService = require('../services/email');
const queueService = require('../services/queue/QueueService');
const HealthBotService = require('../services/ai/HealthBotService');

const router = express.Router();

/**
 * GET /api/command-center/inbox/threads
 * Get email threads for the current user
 */
router.get('/threads', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { page = 1, limit = 20, folder, label, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `
      SELECT 
        t.*,
        COUNT(DISTINCT m.id) as message_count,
        MAX(m.created_at) as last_message_at,
        COALESCE(SUM(CASE WHEN m.is_read = false AND m.direction = 'inbound' THEN 1 ELSE 0 END), 0) as unread_count
      FROM email_threads t
      LEFT JOIN email_messages m ON m.thread_id = t.id
      WHERE $1 = ANY(t.participant_ids)
    `;
    
    const params = [req.user.id];
    let paramIndex = 2;

    if (search) {
      query += ` AND (t.subject ILIKE $${paramIndex} OR t.subject_normalized ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    query += `
      GROUP BY t.id
      ORDER BY MAX(m.created_at) DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(parseInt(limit), offset);

    const { rows: threads } = await db.query(query, params);

    // Get total count
    const { rows: countResult } = await db.query(
      `SELECT COUNT(DISTINCT t.id) FROM email_threads t WHERE $1 = ANY(t.participant_ids)`,
      [req.user.id]
    );

    res.json({
      success: true,
      threads: threads.map(t => ({
        id: t.id,
        subject: t.subject,
        lastMessageAt: t.last_message_at,
        messageCount: parseInt(t.message_count),
        unreadCount: parseInt(t.unread_count),
        hasAttachments: t.has_attachments,
        isStarred: t.is_starred,
        priority: t.priority,
        sentiment: t.sentiment
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult[0].count)
      }
    });
  } catch (error) {
    logger.error('Get inbox threads error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to get threads' });
  }
});

/**
 * GET /api/command-center/inbox/threads/:threadId
 * Get messages in a thread
 */
router.get('/threads/:threadId', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { threadId } = req.params;

    // Verify access
    const { rows: threadRows } = await db.query(
      `SELECT * FROM email_threads WHERE id = $1 AND $2 = ANY(participant_ids)`,
      [threadId, req.user.id]
    );

    if (threadRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Thread not found' });
    }

    const thread = threadRows[0];

    // Get messages
    const { rows: messages } = await db.query(
      `SELECT m.*, 
              array_agg(DISTINCT l.id) FILTER (WHERE l.id IS NOT NULL) as label_ids
       FROM email_messages m
       LEFT JOIN email_message_labels ml ON ml.message_id = m.id
       LEFT JOIN email_labels l ON l.id = ml.label_id
       WHERE m.thread_id = $1
       GROUP BY m.id
       ORDER BY m.created_at ASC`,
      [threadId]
    );

    // Decrypt messages
    const decryptedMessages = messages.map(m => ({
      id: m.id,
      senderEmail: decrypt(m.sender_email_encrypted, m.sender_email_iv, m.sender_email_tag),
      senderName: m.sender_name_encrypted 
        ? decrypt(m.sender_name_encrypted, m.sender_name_iv, m.sender_name_tag)
        : null,
      recipients: JSON.parse(decrypt(m.recipients_encrypted, m.recipients_iv, m.recipients_tag)),
      subject: decrypt(m.subject_encrypted, m.subject_iv, m.subject_tag),
      bodyHtml: m.body_html_encrypted 
        ? decrypt(m.body_html_encrypted, m.body_html_iv, m.body_html_tag)
        : null,
      bodyText: m.body_text_encrypted
        ? decrypt(m.body_text_encrypted, m.body_text_iv, m.body_text_tag)
        : null,
      direction: m.direction,
      status: m.status,
      isRead: m.is_read,
      isStarred: m.is_starred,
      isImportant: m.is_important,
      sentAt: m.sent_at,
      createdAt: m.created_at,
      labelIds: m.label_ids || []
    }));

    // Mark as read
    await db.query(
      `UPDATE email_messages SET is_read = true, read_at = NOW()
       WHERE thread_id = $1 AND direction = 'inbound' AND is_read = false`,
      [threadId]
    );

    res.json({
      success: true,
      thread: {
        id: thread.id,
        subject: thread.subject,
        isStarred: thread.is_starred,
        priority: thread.priority,
        sentiment: thread.sentiment
      },
      messages: decryptedMessages
    });
  } catch (error) {
    logger.error('Get thread messages error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to get messages' });
  }
});

/**
 * POST /api/command-center/inbox/compose
 * Compose and send a new email
 */
router.post('/compose', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { to, cc, bcc, subject, bodyHtml, bodyText, priority, threadId, labels } = req.body;

    // Validate
    if (!to || !subject || (!bodyHtml && !bodyText)) {
      return res.status(400).json({
        success: false,
        error: 'To, subject, and body are required'
      });
    }

    // Get or create thread
    let thread;
    if (threadId) {
      const { rows } = await db.query(
        `SELECT * FROM email_threads WHERE id = $1`,
        [threadId]
      );
      thread = rows[0];
    }

    if (!thread) {
      // Create new thread
      const { rows } = await db.query(
        `INSERT INTO email_threads (subject, subject_normalized, participant_ids, priority)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [
          subject,
          subject.toLowerCase().replace(/^(re:|fwd:)\s*/gi, ''),
          [req.user.id],
          priority || 'normal'
        ]
      );
      thread = rows[0];
    }

    // Encrypt message content
    const senderEmail = encrypt(req.user.email);
    const senderName = encrypt(`${req.user.firstName} ${req.user.lastName}`);
    const recipientsEncrypted = encrypt(JSON.stringify({ to: [to], cc, bcc }));
    const subjectEncrypted = encrypt(subject);
    const bodyHtmlEncrypted = bodyHtml ? encrypt(bodyHtml) : null;
    const bodyTextEncrypted = bodyText ? encrypt(bodyText || '') : null;

    // Create message
    const { rows: messageRows } = await db.query(
      `INSERT INTO email_messages (
        thread_id, sender_id,
        sender_email_encrypted, sender_email_iv, sender_email_tag,
        sender_name_encrypted, sender_name_iv, sender_name_tag,
        recipients_encrypted, recipients_iv, recipients_tag,
        subject_encrypted, subject_iv, subject_tag,
        body_html_encrypted, body_html_iv, body_html_tag,
        body_text_encrypted, body_text_iv, body_text_tag,
        direction, status
      ) VALUES (
        $1, $2,
        $3, $4, $5,
        $6, $7, $8,
        $9, $10, $11,
        $12, $13, $14,
        $15, $16, $17,
        $18, $19, $20,
        'outbound', 'queued'
      ) RETURNING id`,
      [
        thread.id, req.user.id,
        senderEmail.encrypted, senderEmail.iv, senderEmail.tag,
        senderName.encrypted, senderName.iv, senderName.tag,
        recipientsEncrypted.encrypted, recipientsEncrypted.iv, recipientsEncrypted.tag,
        subjectEncrypted.encrypted, subjectEncrypted.iv, subjectEncrypted.tag,
        bodyHtmlEncrypted?.encrypted, bodyHtmlEncrypted?.iv, bodyHtmlEncrypted?.tag,
        bodyTextEncrypted?.encrypted, bodyTextEncrypted?.iv, bodyTextEncrypted?.tag
      ]
    );

    const messageId = messageRows[0].id;

    // Add labels if provided
    if (labels?.length) {
      for (const labelId of labels) {
        await db.query(
          `INSERT INTO email_message_labels (message_id, label_id) VALUES ($1, $2)`,
          [messageId, labelId]
        );
      }
    }

    // Queue email for sending
    await queueService.addEmailJob({
      messageId,
      emailOptions: {
        to,
        cc,
        bcc,
        subject,
        html: bodyHtml,
        text: bodyText
      },
      trackingId: messageId
    });

    await createAuditLog(req, 'email_composed', 'email_messages', messageId);

    res.status(201).json({
      success: true,
      message: 'Email queued for sending',
      data: {
        messageId,
        threadId: thread.id
      }
    });
  } catch (error) {
    logger.error('Compose email error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to compose email' });
  }
});

/**
 * POST /api/command-center/inbox/analyze-sentiment
 * Analyze sentiment of a message
 */
router.post('/analyze-sentiment', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { text, messageId } = req.body;

    if (!text) {
      return res.status(400).json({ success: false, error: 'Text is required' });
    }

    const analysis = await HealthBotService.analyzeSentiment(text, req.user.id);

    // Update message/thread with sentiment if messageId provided
    if (messageId) {
      await db.query(
        `UPDATE email_threads t SET 
          sentiment = $1, 
          sentiment_score = $2,
          updated_at = NOW()
         FROM email_messages m 
         WHERE m.id = $3 AND m.thread_id = t.id`,
        [analysis.sentiment, analysis.score, messageId]
      );
    }

    res.json({
      success: true,
      analysis
    });
  } catch (error) {
    logger.error('Sentiment analysis error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to analyze sentiment' });
  }
});

/**
 * POST /api/command-center/inbox/suggest-reply
 * Get AI-suggested reply for a message
 */
router.post('/suggest-reply', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { messageId, tone } = req.body;

    // Get original message
    const { rows } = await db.query(
      `SELECT * FROM email_messages WHERE id = $1`,
      [messageId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Message not found' });
    }

    const message = rows[0];
    const originalContent = message.body_text_encrypted
      ? decrypt(message.body_text_encrypted, message.body_text_iv, message.body_text_tag)
      : decrypt(message.body_html_encrypted, message.body_html_iv, message.body_html_tag);

    const generated = await HealthBotService.generateContent(req.user.id, {
      type: 'email_reply',
      originalContent,
      tone: tone || 'professional and empathetic'
    });

    res.json({
      success: true,
      suggestion: generated.content,
      tokensUsed: generated.tokensUsed
    });
  } catch (error) {
    logger.error('Suggest reply error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to generate suggestion' });
  }
});

/**
 * PUT /api/command-center/inbox/threads/:threadId/star
 * Toggle star on a thread
 */
router.put('/threads/:threadId/star', authenticate, async (req, res) => {
  try {
    const { threadId } = req.params;
    const { isStarred } = req.body;

    await db.query(
      `UPDATE email_threads SET is_starred = $1, updated_at = NOW()
       WHERE id = $2 AND $3 = ANY(participant_ids)`,
      [isStarred, threadId, req.user.id]
    );

    res.json({ success: true });
  } catch (error) {
    logger.error('Star thread error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to update thread' });
  }
});

/**
 * GET /api/command-center/inbox/labels
 * Get user's labels
 */
router.get('/labels', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM email_labels 
       WHERE user_id = $1 OR (organization_id IS NOT NULL AND is_system = true)
       ORDER BY is_system DESC, name ASC`,
      [req.user.id]
    );

    res.json({
      success: true,
      labels: rows
    });
  } catch (error) {
    logger.error('Get labels error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to get labels' });
  }
});

/**
 * POST /api/command-center/inbox/labels
 * Create a new label
 */
router.post('/labels', authenticate, async (req, res) => {
  try {
    const { name, color, description } = req.body;

    const { rows } = await db.query(
      `INSERT INTO email_labels (user_id, name, color, description)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.user.id, name, color || '#6366f1', description]
    );

    res.status(201).json({
      success: true,
      label: rows[0]
    });
  } catch (error) {
    logger.error('Create label error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to create label' });
  }
});

/**
 * GET /api/command-center/inbox/stats
 * Get inbox statistics
 */
router.get('/stats', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const [unread, total, urgent, sentToday] = await Promise.all([
      db.query(
        `SELECT COUNT(*) FROM email_messages m
         JOIN email_threads t ON t.id = m.thread_id
         WHERE $1 = ANY(t.participant_ids) AND m.direction = 'inbound' AND m.is_read = false`,
        [req.user.id]
      ),
      db.query(
        `SELECT COUNT(DISTINCT t.id) FROM email_threads t
         WHERE $1 = ANY(t.participant_ids)`,
        [req.user.id]
      ),
      db.query(
        `SELECT COUNT(*) FROM email_threads t
         WHERE $1 = ANY(t.participant_ids) AND t.priority = 'urgent'`,
        [req.user.id]
      ),
      db.query(
        `SELECT COUNT(*) FROM email_messages
         WHERE sender_id = $1 AND sent_at > CURRENT_DATE`,
        [req.user.id]
      )
    ]);

    res.json({
      success: true,
      stats: {
        unreadCount: parseInt(unread.rows[0].count),
        totalThreads: parseInt(total.rows[0].count),
        urgentCount: parseInt(urgent.rows[0].count),
        sentToday: parseInt(sentToday.rows[0].count)
      }
    });
  } catch (error) {
    logger.error('Get inbox stats error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to get stats' });
  }
});

module.exports = router;

