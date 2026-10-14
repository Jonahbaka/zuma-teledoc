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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const inboxError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

function selectedIds(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => typeof id !== 'string' || !UUID.test(id))) {
    throw inboxError(400, 'Select between 1 and 100 valid inbox message IDs.');
  }
  return [...new Set(ids)];
}

async function requireOperatorItems(client, ids) {
  const result = await client.query("SELECT id FROM ai_chat_messages WHERE id = ANY($1::uuid[]) AND recipient_type = 'operator' FOR UPDATE", [ids]);
  if (result.rows.length !== ids.length) throw inboxError(404, 'One or more selected operator inbox messages were not found.');
}

function sendInboxError(res, error) {
  const known = [400, 403, 404].includes(error.statusCode);
  return res.status(known ? error.statusCode : 503).json({ success: false,
    error: known ? error.message : 'The operator inbox is temporarily unavailable. No completed change was confirmed.' });
}

async function changeOperatorInbox(req, action, mode, ids, change) {
  return db.transaction(async client => {
    const actor = await client.query('SELECT id,role,is_active FROM users WHERE id=$1 FOR SHARE', [req.user.id]);
    if (!actor.rows[0]?.is_active || !['admin', 'super_admin'].includes(actor.rows[0].role)) throw inboxError(403, 'Current administrator access is required.');
    if (ids) await requireOperatorItems(client, ids);
    const result = await change(client);
    await client.query(`INSERT INTO audit_logs (user_id,action,resource_type,resource_id,phi_accessed,success,description,new_values)
      VALUES ($1,$2,'operator_inbox',$3,FALSE,TRUE,$4,$5::jsonb)`, [req.user.id, action, ids?.length === 1 ? ids[0] : null,
      `DoctaRx operator inbox ${action}`, JSON.stringify({ recipientType: 'operator', mode, ids: ids || [], affected: result.rowCount })]);
    return result.rowCount;
  });
}

// ═══════════════════════════════════════════════════════════════
//  GET /api/inbox — Get all inbox items (alerts, briefings, accomplishments)
// ═══════════════════════════════════════════════════════════════
router.get('/', ...adminOnly, async (req, res) => {
  try {
    const { type, unread, limit = 50, offset = 0 } = req.query;
    const boundedLimit = Number(limit); const boundedOffset = Number(offset);
    if (!Number.isInteger(boundedLimit) || boundedLimit < 1 || boundedLimit > 100 || !Number.isInteger(boundedOffset) || boundedOffset < 0 || boundedOffset > 100000 ||
        (type && (typeof type !== 'string' || type.length > 30))) throw inboxError(400, 'Use valid inbox filters and pagination.');
    const params = [];
    const conditions = ["recipient_type = 'operator'"];

    if (type) {
      params.push(type);
      conditions.push(`message_type = $${params.length}`);
    }
    if (unread === 'true') {
      conditions.push('read_at IS NULL');
    }

    params.push(boundedLimit);
    params.push(boundedOffset);

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
    sendInboxError(res, err);
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
    res.status(503).json({ success: false, data: { count: null }, error: 'Inbox count is temporarily unavailable.' });
  }
});

// ═══════════════════════════════════════════════════════════════
//  POST /api/inbox/mark-read — Mark items as read
// ═══════════════════════════════════════════════════════════════
router.post('/mark-read', ...adminOnly, async (req, res) => {
  try {
    const { ids } = req.body || {}; // array of message IDs, or 'all'
    let marked;
    if (ids === 'all') {
      marked = await changeOperatorInbox(req, 'update', 'all', null, client => client.query(
        "UPDATE ai_chat_messages SET read_at = NOW() WHERE recipient_type = 'operator' AND read_at IS NULL"));
    } else {
      const selected = selectedIds(ids);
      marked = await changeOperatorInbox(req, 'update', 'selected', selected, client => client.query(
        "UPDATE ai_chat_messages SET read_at = NOW() WHERE id = ANY($1::uuid[]) AND recipient_type = 'operator' AND read_at IS NULL", [selected]));
    }
    res.json({ success: true, data: { marked } });
  } catch (err) {
    sendInboxError(res, err);
  }
});

// ═══════════════════════════════════════════════════════════════
//  DELETE /api/inbox/:id — Delete an inbox item
// ═══════════════════════════════════════════════════════════════
router.delete('/:id', ...adminOnly, async (req, res) => {
  try {
    const selected = selectedIds([req.params.id]);
    const deleted = await changeOperatorInbox(req, 'delete', 'selected', selected, async client => {
      const removed = await client.query("DELETE FROM ai_chat_messages WHERE id = $1 AND recipient_type = 'operator'", [selected[0]]);
      if (removed.rowCount !== 1) throw inboxError(404, 'Inbox message not found.');
      return removed;
    });
    res.json({ success: true, data: { deleted } });
  } catch (err) {
    sendInboxError(res, err);
  }
});

// ═══════════════════════════════════════════════════════════════
//  POST /api/inbox/delete-bulk — Delete multiple messages at once
// ═══════════════════════════════════════════════════════════════
router.post('/delete-bulk', ...adminOnly, async (req, res) => {
  try {
    const { ids, mode } = req.body || {};
    // mode: 'selected' (delete specific IDs), 'read' (delete all read), 'all' (delete everything)
    let deleted;
    if (mode === 'all') {
      if (ids !== undefined) throw inboxError(400, 'Choose all messages or selected IDs, without combining them.');
      deleted = await changeOperatorInbox(req, 'delete', 'all', null, client => client.query("DELETE FROM ai_chat_messages WHERE recipient_type = 'operator'"));
    } else if (mode === 'read') {
      if (ids !== undefined) throw inboxError(400, 'Choose read messages or selected IDs, without combining them.');
      deleted = await changeOperatorInbox(req, 'delete', 'read', null, client => client.query("DELETE FROM ai_chat_messages WHERE recipient_type = 'operator' AND read_at IS NOT NULL"));
    } else if (mode === undefined || mode === 'selected') {
      const selected = selectedIds(ids);
      deleted = await changeOperatorInbox(req, 'delete', 'selected', selected, client => client.query("DELETE FROM ai_chat_messages WHERE id = ANY($1::uuid[]) AND recipient_type = 'operator'", [selected]));
    } else {
      return res.status(400).json({ success: false, error: 'Provide ids array, or mode: "read" or "all"' });
    }
    res.json({ success: true, data: { deleted } });
  } catch (err) {
    sendInboxError(res, err);
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
    const unavailableSections = [];
    try {
      const propResult = await db.query(`
        SELECT id, agent_type, title, priority, status, created_at
        FROM ai_proposals
        WHERE status = 'pending'
        ORDER BY created_at DESC
        LIMIT 10
      `);
      proposals = propResult.rows;
    } catch (e) { unavailableSections.push('pendingProposals'); }

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
    } catch (e) { unavailableSections.push('recentEvents'); }

    res.json({
      success: true,
      data: {
        messageStats: stats.rows,
        activeAgents: agents.rows,
        pendingProposals: proposals,
        recentEvents,
        unavailableSections,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (err) {
    sendInboxError(res, err);
  }
});

// ═══════════════════════════════════════════════════════════════
//  POST /api/inbox/run-missions — Manually trigger web missions
// ═══════════════════════════════════════════════════════════════
router.post('/run-missions', ...adminOnly, async (req, res) => {
  try {
    let orchestrator = null;
    try { orchestrator = require('../services/agent-orchestrator'); } catch (e) {}

    if (orchestrator && orchestrator.heartbeat) {
      // Run async — don't block the response
      orchestrator.heartbeat.runWebMissions().catch(e => console.error('Manual web mission error:', e.message));
      res.json({ success: true, message: 'Web mission requested. Results appear in the inbox as work completes.' });
    } else {
      res.status(503).json({ success: false, error: 'Heartbeat system not available' });
    }
  } catch (err) {
    sendInboxError(res, err);
  }
});

// ═══════════════════════════════════════════════════════════════
//  POST /api/inbox/wake-up — WAKE UP ALL AGENTS (full activation)
// ═══════════════════════════════════════════════════════════════
router.post('/wake-up', ...adminOnly, async (req, res) => {
  try {
    let orchestrator = null;
    try { orchestrator = require('../services/agent-orchestrator'); } catch (e) {}

    if (orchestrator && orchestrator.heartbeat) {
      const result = await orchestrator.heartbeat.wakeUp();
      res.json({
        success: true,
        message: `All agents activated. ${result.triggered.length} systems triggered.`,
        data: result
      });
    } else {
      res.status(503).json({ success: false, error: 'Heartbeat system not available. Server may still be starting.' });
    }
  } catch (err) {
    sendInboxError(res, err);
  }
});

module.exports = router;
