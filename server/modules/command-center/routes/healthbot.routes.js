/**
 * HealthBot Routes
 * AI assistant API endpoints
 * @module command-center/routes/healthbot
 */

const express = require('express');
const db = require('../../../db');
const logger = require('../../../middleware/logger');
const { authenticate, requireRole } = require('../../../middleware/auth');
const HealthBotService = require('../services/ai/HealthBotService');

const router = express.Router();

/**
 * POST /api/command-center/healthbot/chat
 * Send a message to HealthBot
 */
router.post('/chat', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { conversationId, message, context, contextReferenceId, generateContent, contentType } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }

    const response = await HealthBotService.chat(req.user.id, {
      conversationId,
      message,
      context,
      contextReferenceId,
      generateContent,
      contentType
    });

    res.json({
      success: true,
      data: response
    });
  } catch (error) {
    logger.error('HealthBot chat error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to process message' });
  }
});

/**
 * GET /api/command-center/healthbot/conversations
 * Get user's conversation history
 */
router.get('/conversations', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, title, context_type, message_count, last_message_at, created_at
       FROM healthbot_conversations
       WHERE user_id = $1 AND status = 'active'
       ORDER BY last_message_at DESC
       LIMIT 50`,
      [req.user.id]
    );

    res.json({
      success: true,
      conversations: rows.map(c => ({
        id: c.id,
        title: c.title || `Conversation ${c.id.substring(0, 8)}`,
        contextType: c.context_type,
        messageCount: c.message_count,
        lastMessageAt: c.last_message_at,
        createdAt: c.created_at
      }))
    });
  } catch (error) {
    logger.error('Get conversations error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to get conversations' });
  }
});

/**
 * GET /api/command-center/healthbot/conversations/:id
 * Get a specific conversation with messages
 */
router.get('/conversations/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const { rows: convRows } = await db.query(
      `SELECT * FROM healthbot_conversations WHERE id = $1 AND user_id = $2`,
      [id, req.user.id]
    );

    if (convRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    const history = await HealthBotService.getConversationHistory(id, 100);

    res.json({
      success: true,
      conversation: {
        id: convRows[0].id,
        title: convRows[0].title,
        contextType: convRows[0].context_type
      },
      messages: history
    });
  } catch (error) {
    logger.error('Get conversation error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to get conversation' });
  }
});

/**
 * DELETE /api/command-center/healthbot/conversations/:id
 * Archive a conversation
 */
router.delete('/conversations/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    await db.query(
      `UPDATE healthbot_conversations SET status = 'archived'
       WHERE id = $1 AND user_id = $2`,
      [id, req.user.id]
    );

    res.json({ success: true });
  } catch (error) {
    logger.error('Archive conversation error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to archive conversation' });
  }
});

/**
 * POST /api/command-center/healthbot/generate
 * Generate content (email, social post, etc.)
 */
router.post('/generate', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { type, originalContent, prompt, tone, platforms, context } = req.body;

    if (!type) {
      return res.status(400).json({ success: false, error: 'Content type is required' });
    }

    const generated = await HealthBotService.generateContent(req.user.id, {
      type,
      originalContent,
      prompt,
      tone,
      platforms,
      context
    });

    res.json({
      success: true,
      data: generated
    });
  } catch (error) {
    logger.error('Generate content error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to generate content' });
  }
});

/**
 * POST /api/command-center/healthbot/analyze
 * Analyze text (sentiment, urgency, etc.)
 */
router.post('/analyze', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ success: false, error: 'Text is required' });
    }

    const analysis = await HealthBotService.analyzeSentiment(text, req.user.id);

    res.json({
      success: true,
      analysis
    });
  } catch (error) {
    logger.error('Analyze text error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to analyze text' });
  }
});

/**
 * POST /api/command-center/healthbot/feedback
 * Submit feedback on a HealthBot response
 */
router.post('/feedback', authenticate, async (req, res) => {
  try {
    const { messageId, rating, feedback, wasUsed } = req.body;

    await db.query(
      `UPDATE healthbot_messages SET
        user_rating = $1,
        user_feedback = $2,
        was_used = $3
       WHERE id = $4`,
      [rating, feedback, wasUsed, messageId]
    );

    res.json({ success: true });
  } catch (error) {
    logger.error('Submit feedback error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to submit feedback' });
  }
});

/**
 * GET /api/command-center/healthbot/knowledge
 * Search knowledge base
 */
router.get('/knowledge', authenticate, async (req, res) => {
  try {
    const { query, category, limit = 10 } = req.query;

    let sql = `
      SELECT id, title, content_type, summary, category, tags, source_name
      FROM healthbot_knowledge_base
      WHERE is_active = true
    `;
    const params = [];
    let paramIndex = 1;

    if (query) {
      sql += ` AND to_tsvector('english', content) @@ plainto_tsquery('english', $${paramIndex})`;
      params.push(query);
      paramIndex++;
    }

    if (category) {
      sql += ` AND category = $${paramIndex}`;
      params.push(category);
      paramIndex++;
    }

    sql += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(parseInt(limit));

    const { rows } = await db.query(sql, params);

    res.json({
      success: true,
      entries: rows
    });
  } catch (error) {
    logger.error('Search knowledge base error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to search knowledge base' });
  }
});

/**
 * POST /api/command-center/healthbot/knowledge
 * Add entry to knowledge base
 */
router.post('/knowledge', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { title, contentType, content, summary, category, tags, sourceUrl, sourceName } = req.body;

    if (!title || !content || !contentType) {
      return res.status(400).json({
        success: false,
        error: 'Title, content type, and content are required'
      });
    }

    const { rows } = await db.query(
      `INSERT INTO healthbot_knowledge_base (
        title, content_type, content, summary, category, tags, source_url, source_name, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id`,
      [title, contentType, content, summary, category, tags || [], sourceUrl, sourceName, req.user.id]
    );

    res.status(201).json({
      success: true,
      id: rows[0].id
    });
  } catch (error) {
    logger.error('Add knowledge entry error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to add entry' });
  }
});

module.exports = router;

