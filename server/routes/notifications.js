/**
 * Notification Routes
 * User notifications management
 */

const express = require('express');
const db = require('../db');
const logger = require('../middleware/logger');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate, paginationSchema, createNotificationSchema } = require('../../lib/validation');
const { keysToCamel, parseQueryParams, getPaginationMeta } = require('../../lib/utils');

const router = express.Router();

/**
 * GET /api/notifications
 * Get user notifications
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const filters = validate(paginationSchema, req.query);
    const { page, limit } = parseQueryParams(filters);
    const offset = (page - 1) * limit;
    
    // Get total count
    const { rows: countResult } = await db.query(
      `SELECT COUNT(*) FROM notifications 
       WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [req.user.id]
    );
    const total = parseInt(countResult[0].count);
    
    // Get notifications
    const { rows } = await db.query(
      `SELECT id, type, title, message, reference_type, reference_id,
              action_url, action_text, is_read, read_at, created_at
       FROM notifications
       WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );
    
    res.json({
      success: true,
      notifications: rows.map(keysToCamel),
      pagination: getPaginationMeta(total, page, limit)
    });
  } catch (error) {
    logger.error('Get notifications error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get notifications'
    });
  }
});

/**
 * GET /api/notifications/unread-count
 * Get unread notification count
 */
router.get('/unread-count', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT COUNT(*) FROM notifications 
       WHERE user_id = $1 AND is_read = false
       AND (expires_at IS NULL OR expires_at > NOW())`,
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
 * PUT /api/notifications/:id/read
 * Mark notification as read
 */
router.put('/:id/read', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    const { rows } = await db.query(
      `UPDATE notifications SET is_read = true, read_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id, is_read, read_at`,
      [id, req.user.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found'
      });
    }
    
    res.json({
      success: true,
      notification: keysToCamel(rows[0])
    });
  } catch (error) {
    logger.error('Mark notification read error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to mark notification as read'
    });
  }
});

/**
 * PUT /api/notifications/read-all
 * Mark all notifications as read
 */
router.put('/read-all', authenticate, async (req, res) => {
  try {
    const { rowCount } = await db.query(
      `UPDATE notifications SET is_read = true, read_at = NOW()
       WHERE user_id = $1 AND is_read = false`,
      [req.user.id]
    );
    
    res.json({
      success: true,
      message: `${rowCount} notifications marked as read`
    });
  } catch (error) {
    logger.error('Mark all read error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to mark notifications as read'
    });
  }
});

/**
 * DELETE /api/notifications/:id
 * Delete notification
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    const { rowCount } = await db.query(
      'DELETE FROM notifications WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    
    if (rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Notification deleted'
    });
  } catch (error) {
    logger.error('Delete notification error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to delete notification'
    });
  }
});

/**
 * POST /api/notifications/broadcast
 * Send broadcast notification (admin only)
 */
router.post('/broadcast',
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    try {
      const data = validate(createNotificationSchema, req.body);
      
      if (!data.broadcast) {
        return res.status(400).json({
          success: false,
          error: 'Broadcast flag must be true for this endpoint'
        });
      }
      
      // Get target users
      let targetQuery = 'SELECT id FROM users WHERE is_active = true';
      const values = [];
      
      if (data.targetRole) {
        targetQuery += ' AND role = $1';
        values.push(data.targetRole);
      }
      
      const { rows: users } = await db.query(targetQuery, values);
      
      // Create notifications for all target users
      const notificationValues = users.map(user => [
        user.id,
        data.type,
        data.title,
        data.message,
        data.referenceType || null,
        data.referenceId || null,
        data.actionUrl || null,
        data.actionText || null
      ]);
      
      // Batch insert
      for (const values of notificationValues) {
        await db.query(
          `INSERT INTO notifications (
            user_id, type, title, message, reference_type, 
            reference_id, action_url, action_text
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          values
        );
      }
      
      logger.info('Broadcast notification sent', { 
        adminId: req.user.id, 
        recipientCount: users.length,
        targetRole: data.targetRole || 'all'
      });
      
      res.status(201).json({
        success: true,
        message: `Notification sent to ${users.length} users`
      });
    } catch (error) {
      logger.error('Broadcast notification error', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to send broadcast notification'
      });
    }
  }
);

module.exports = router;

