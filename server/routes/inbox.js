/**
 * ═══════════════════════════════════════════════════════════════
 *  AGENT INBOX — Proactive Briefings, Alerts & Accomplishments
 *  The Operator sees what agents DO, not just what they say
 * ═══════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const db = require('../db');

const adminOnly = [authenticate, requireRole('admin', 'super_admin')];

// ═══════════════════════════════════════════════════════════════
//  GET /api/inbox — Get all inbox items (alerts, briefings, accomplishments)
// ═══════════════════════════════════════════════════════════════
router.get('/', ...adminOnly, async (req, res) => {
  try {
    const { type, unread, limit = 50, offset = 0 } = req.query;
    const params = [];
    const conditions = ["recipient_type = 'operator'"];

    if (type) {
      params.push(type);
      conditions.push(`message_type = $${params.length}`);
    }
    if (unread === 'true') {
      conditions.push('read_at IS NULL');
    }

    params.push(parseInt(limit));
    params.push(parseInt(offset));

    const query = `
      SELECT id, sender_type, sender_id, sender_name, content, message_type, 
             metadata, read_at, created_at
      FROM ai_chat_messages
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    const result = await db.query(query, params);

    // Also get unread count
    const countResult = await db.query(
      "SELECT COUNT(*) FROM ai_chat_messages WHERE recipient_type = 'operator' AND read_at IS NULL"
    );

    res.json({
      success: true,
      data: {
        items: result.rows,
        unreadCount: parseInt(countResult.rows[0].count),
        total: result.rows.length
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  GET /api/inbox/unread-count — Quick count for badge
// ═══════════════════════════════════════════════════════════════
router.get('/unread-count', ...adminOnly, async (req, res) => {
  try {
    const result = await db.query(
      "SELECT COUNT(*) FROM ai_chat_messages WHERE recipient_type = 'operator' AND read_at IS NULL"
    );
    res.json({ success: true, data: { count: parseInt(result.rows[0].count) } });
  } catch (err) {
    res.json({ success: true, data: { count: 0 } });
  }
});

// ═══════════════════════════════════════════════════════════════
//  POST /api/inbox/mark-read — Mark items as read
// ═══════════════════════════════════════════════════════════════
router.post('/mark-read', ...adminOnly, async (req, res) => {
  try {
    const { ids } = req.body; // array of message IDs, or 'all'
    if (ids === 'all') {
      await db.query(
        "UPDATE ai_chat_messages SET read_at = NOW() WHERE recipient_type = 'operator' AND read_at IS NULL"
      );
    } else if (Array.isArray(ids) && ids.length > 0) {
      await db.query(
        "UPDATE ai_chat_messages SET read_at = NOW() WHERE id = ANY($1) AND read_at IS NULL",
        [ids]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  DELETE /api/inbox/:id — Delete an inbox item
// ═══════════════════════════════════════════════════════════════
router.delete('/:id', ...adminOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM ai_chat_messages WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  GET /api/inbox/summary — AI-generated daily summary
// ═══════════════════════════════════════════════════════════════
router.get('/summary', ...adminOnly, async (req, res) => {
  try {
    // Get counts by type from last 24h
    const stats = await db.query(`
      SELECT 
        message_type,
        COUNT(*) as count,
        COUNT(*) FILTER (WHERE read_at IS NULL) as unread
      FROM ai_chat_messages
      WHERE recipient_type = 'operator'
        AND created_at > NOW() - INTERVAL '24 hours'
      GROUP BY message_type
      ORDER BY count DESC
    `);

    // Get unique agent senders in last 24h
    const agents = await db.query(`
      SELECT DISTINCT sender_id, sender_name 
      FROM ai_chat_messages 
      WHERE recipient_type = 'operator'
        AND sender_type = 'agent'
        AND created_at > NOW() - INTERVAL '24 hours'
    `);

    // Get recent proposals
    let proposals = [];
    try {
      const propResult = await db.query(`
        SELECT id, agent_type, title, priority, status, created_at
        FROM ai_proposals
        WHERE status = 'pending'
        ORDER BY created_at DESC
        LIMIT 10
      `);
      proposals = propResult.rows;
    } catch (e) { /* table may not exist */ }

    // Get recent events
    let recentEvents = [];
    try {
      const eventResult = await db.query(`
        SELECT event_type, COUNT(*) as count
        FROM ai_event_queue
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY event_type
        ORDER BY count DESC
        LIMIT 10
      `);
      recentEvents = eventResult.rows;
    } catch (e) { /* table may not exist */ }

    res.json({
      success: true,
      data: {
        messageStats: stats.rows,
        activeAgents: agents.rows,
        pendingProposals: proposals,
        recentEvents,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
