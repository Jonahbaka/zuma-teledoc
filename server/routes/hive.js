'use strict';
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { authenticate, requireRole } = require('../middleware/auth');
const db = require('../db');
const policy = require('../services/hiveAccessPolicy');
const router = express.Router();
const store = policy.createStore();
const limited = rateLimit({ windowMs: 60000, limit: 30, standardHeaders: true, legacyHeaders: false });
const admin = [authenticate, requireRole('admin', 'super_admin')];
router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
function failure(res, err) {
  const status = [400, 403, 404, 409, 503].includes(err.statusCode) ? err.statusCode : 503;
  return res.status(status).json({ success: false, code: err.code || 'HIVE_UNAVAILABLE',
    error: status === 503 ? 'Assistant information is temporarily unavailable.' : err.message });
}
const sessionPayload = session => ({ sessionId: session.id, agent: policy.AGENTS[session.agentId], expiresAt: session.expiresAt });
router.post('/session/public', limited, (_req, res) => {
  try { res.json({ success: true, data: sessionPayload(store.create('nova', null, true)) }); }
  catch (error) { failure(res, error); }
});
router.post('/session', authenticate, limited, (req, res) => {
  try { res.json({ success: true, data: sessionPayload(store.create(req.body?.agentId || 'nova', req.user)) }); }
  catch (error) { failure(res, error); }
});
function message(isPublic) {
  return async (req, res) => {
    let session;
    let acquired = false;
    try {
      session = store.read(req.body?.sessionId, req.user, isPublic);
      const content = policy.validateMessage(req.body);
      if (session.busy) throw policy.error(409, 'HIVE_BUSY', 'Wait for the current response.');
      session.busy = true;
      acquired = true;
      const result = await policy.reply({ agentId: session.agentId, actor: req.user, content, db });
      const agentMessage = { role: 'agent', content: result.text, toolCalls: [], iterations: 0, mode: result.mode, ts: Date.now() };
      session.messages.push({ role: 'user', content, ts: Date.now() }, agentMessage);
      session.messages = session.messages.slice(-20);
      res.json({ success: true, data: agentMessage });
    } catch (error) { failure(res, error); }
    finally { if (acquired) session.busy = false; }
  };
}
router.post('/message/public', limited, message(true));
router.post('/message', authenticate, limited, message(false));
router.get('/session/:id', authenticate, (req, res) => {
  try {
    const session = store.read(req.params.id, req.user);
    res.json({ success: true, data: { ...sessionPayload(session), messages: session.messages, messageCount: session.messages.length } });
  } catch (error) { failure(res, error); }
});
router.post('/triage/book', authenticate, requireRole('patient'), (_req, res) => res.status(409).json({ success: false,
  code: 'APPOINTMENT_WORKFLOW_REQUIRED', error: 'Book through Get care in your patient portal. A chat message cannot assign clinical urgency or create a confirmed appointment.' }));
router.get('/overwatch', ...admin, async (req, res) => {
  try {
    store.prune();
    const stats = await policy.operationsSnapshot(db, req.user);
    const activeSessions = [...store.sessions.values()].filter(session => session.market === req.user.marketScope && !session.isPublic)
      .map(session => ({ id: session.id, agentId: session.agentId, agentName: session.agentName, role: session.role, messageCount: session.messages.length, startedAt: session.startedAt }));
    res.json({ success: true, data: { activeSessions, flagged: [], stats: { ...stats, activeSessions: activeSessions.length }, serverUptime: Math.round(process.uptime()) } });
  } catch (error) { failure(res, error); }
});
router.post('/kill', ...admin, (req, res) => {
  const scope = req.body?.scope;
  let killed = 0;
  for (const [id, session] of store.sessions) {
    if ((scope === 'all' || scope === id) && (req.user.role === 'super_admin' || session.market === req.user.marketScope)) { store.sessions.delete(id); killed++; }
  }
  res.json({ success: true, data: { killed } });
});
router.post('/pause', ...admin, (req, res) => {
  if (req.user.role !== 'super_admin') return res.status(403).json({ success: false, error: 'Platform-wide pause requires a super administrator.' });
  if (typeof req.body?.paused !== 'boolean') return res.status(400).json({ success: false, error: 'A boolean paused value is required.' });
  global.__HIVE_PAUSED = req.body.paused;
  res.json({ success: true, data: { paused: global.__HIVE_PAUSED } });
});
router.get('/status', (_req, res) => res.json({ success: true, data: { online: true, paused: !!global.__HIVE_PAUSED, agents: [policy.AGENTS.nova] } }));
module.exports = router;
