/**
 * ═══════════════════════════════════════════════════════════════
 *  OpenClaw Adapter — Bridges OpenClaw WebSocket protocol to the
 *  DoctaRx Hive Agent Orchestrator
 * ═══════════════════════════════════════════════════════════════
 *
 * Accepts WebSocket connections speaking the OpenClaw protocol
 * (JSON frames with type: req/res/event) on the /openclaw path.
 * Bridges them to our existing Socket.io /hive namespace and
 * agent-orchestrator backend.
 *
 * Protocol Reference: https://docs.openclaw.ai
 * Frame types: { type: 'req'|'res'|'event', id, method, params, payload }
 */

const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');

const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || 'doctarx-hive-gateway-token-2026';
const PROTOCOL_VERSION = '1.0.0';

// Active OpenClaw sessions: wsClientId → { ws, sessionKey, agentId, userId, role }
const ocSessions = new Map();
let seqCounter = 0;

function nextSeq() { return ++seqCounter; }

function send(ws, frame) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(frame));
  }
}

function sendRes(ws, id, payload, ok = true) {
  send(ws, { type: 'res', id, ok, payload });
}

function sendErr(ws, id, error) {
  send(ws, { type: 'res', id, ok: false, error });
}

function sendEvent(ws, event, payload) {
  send(ws, { type: 'event', event, payload, seq: nextSeq() });
}

/**
 * Authenticate the connect request.
 * Accepts either the gateway token or a valid DoctaRx JWT.
 */
function authenticate(params) {
  const token = params?.auth?.token || params?.token;
  if (!token) return { ok: false, error: 'No token provided' };

  // Gateway token (server-to-server)
  if (token === GATEWAY_TOKEN) {
    return { ok: true, role: 'operator', userId: 'gateway', isGateway: true };
  }

  // DoctaRx JWT (user sessions)
  try {
    const secret = process.env.JWT_ACCESS_SECRET || 'dev-access-secret';
    const payload = jwt.verify(token, secret);
    return { ok: true, role: payload.role || 'patient', userId: payload.id || payload.sub };
  } catch {
    return { ok: false, error: 'Invalid token' };
  }
}

/**
 * Map OpenClaw agentId to DoctaRx Hive agent identifier.
 */
function resolveAgentId(agentId) {
  const map = { nova: 'nova', triage: 'triage', hippocrates: 'hippocrates', overwatch: 'overwatch', main: 'nova' };
  return map[agentId] || 'nova';
}

/**
 * Initialise the OpenClaw WebSocket adapter on the HTTP server.
 * Called once from server/index.js after Express is set up.
 */
function initOpenClawAdapter(httpServer, hiveRouteHandler) {
  const wss = new WebSocketServer({ server: httpServer, path: '/openclaw' });

  wss.on('connection', (ws, req) => {
    const clientId = `oc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let authenticated = false;
    let session = null;

    // Send pre-connect challenge (OpenClaw protocol)
    send(ws, { nonce: clientId, timestamp: Date.now() });

    ws.on('message', async (raw) => {
      let frame;
      try { frame = JSON.parse(raw.toString()); } catch { return; }

      const { type, id, method, params, payload } = frame;
      const p = params || payload || {};

      // ── CONNECT (must be first frame) ─────────────────────────────
      if (method === 'connect' || (!authenticated && type === 'req')) {
        if (authenticated) return sendErr(ws, id, 'Already connected');

        const auth = authenticate(p);
        if (!auth.ok) {
          sendErr(ws, id, auth.error);
          ws.close(4001, 'Unauthorized');
          return;
        }

        authenticated = true;
        session = { clientId, role: auth.role, userId: auth.userId, agentId: 'nova' };
        ocSessions.set(clientId, { ws, ...session });

        sendRes(ws, id, {
          protocolVersion: PROTOCOL_VERSION,
          deviceToken: clientId,
          clientId,
          presence: [],
          health: { status: 'ok', hive: 'online' }
        });

        sendEvent(ws, 'presence:update', { devices: [{ id: clientId, role: auth.role }] });
        return;
      }

      if (!authenticated) { sendErr(ws, id, 'Not authenticated'); return; }

      // ── SESSIONS LIST ─────────────────────────────────────────────
      if (method === 'sessions_list') {
        const agentId = p.agentId || 'nova';
        const sessionKey = `agent:${agentId}:${session.userId || 'guest'}`;
        sendRes(ws, id, {
          sessions: [{ sessionKey, agentId, status: 'active', userId: session.userId }]
        });
        return;
      }

      // ── SESSIONS HISTORY ──────────────────────────────────────────
      if (method === 'sessions_history') {
        sendRes(ws, id, { messages: [], sessionKey: p.sessionKey });
        return;
      }

      // ── SESSIONS SEND (core message flow) ─────────────────────────
      if (method === 'sessions_send') {
        const { sessionKey, message } = p;
        const agentId = resolveAgentId(sessionKey?.split(':')?.[1] || session.agentId);
        session.agentId = agentId;
        ocSessions.set(clientId, { ws, ...session });

        // Emit thinking event
        sendEvent(ws, 'agent:turn:phase', { sessionKey, phase: 'thinking' });

        // Forward to DoctaRx Hive via internal HTTP call to /api/hive/message
        try {
          const axios = require('axios');
          const serverUrl = `http://127.0.0.1:${process.env.PORT || 3001}`;
          const token = typeof session.userId !== 'string' || session.userId === 'gateway'
            ? null
            : null; // Guest/gateway sessions use sessionId

          // First, create or reuse hive session
          const sessionRes = await axios.post(`${serverUrl}/api/hive/session/public`, {
            agentId, message: '' }, { timeout: 5000 }).catch(() => null);

          const hiveSessionId = sessionRes?.data?.sessionId;

          // Send message to hive
          const msgRes = await axios.post(`${serverUrl}/api/hive/message`, {
            sessionId: hiveSessionId,
            content: message,
            agentId
          }, { timeout: 30000 });

          if (msgRes.data?.success) {
            const reply = msgRes.data.message || msgRes.data.response || 'No response';
            sendEvent(ws, 'chat:delta', { sessionKey, content: reply });
            sendEvent(ws, 'chat:final', { sessionKey, content: reply });
            sendEvent(ws, 'agent:turn:phase', { sessionKey, phase: 'done' });
          } else {
            throw new Error(msgRes.data?.error || 'Hive error');
          }
        } catch (err) {
          sendEvent(ws, 'agent:turn:phase', { sessionKey, phase: 'done' });
          sendEvent(ws, 'chat:final', {
            sessionKey,
            content: 'I\'m temporarily unavailable. Please try again in a moment.',
            error: true
          });
        }

        sendRes(ws, id, { ok: true, sessionKey });
        return;
      }

      // ── NODE LIST / DESCRIBE ──────────────────────────────────────
      if (method === 'node.list') {
        sendRes(ws, id, {
          nodes: [
            { id: 'hive-orchestrator', type: 'server', status: 'online', capabilities: ['agents', 'triage', 'clinical'] }
          ]
        });
        return;
      }

      // ── STATUS CHECK ──────────────────────────────────────────────
      if (method === 'hive.status') {
        sendRes(ws, id, { status: 'online', activeSessions: ocSessions.size, paused: false });
        return;
      }

      // ── KILL / PAUSE (admin only) ─────────────────────────────────
      if (method === 'hive.kill' && (session.role === 'admin' || session.role === 'super_admin')) {
        ocSessions.forEach((s) => { if (s.ws !== ws) s.ws.close(1001, 'Killed by admin'); });
        sendRes(ws, id, { killed: true });
        return;
      }

      // Default: unknown method
      sendErr(ws, id, `Unknown method: ${method}`);
    });

    ws.on('close', () => {
      ocSessions.delete(clientId);
    });

    ws.on('error', (err) => {
      console.error('[OpenClaw Adapter] WS error:', err.message);
      ocSessions.delete(clientId);
    });
  });

  console.log('🔮 OpenClaw adapter active on ws://<host>/openclaw');
  return wss;
}

/**
 * Broadcast an event to all connected OpenClaw clients.
 * Used by the hive to push real-time updates.
 */
function broadcastToOpenClaw(event, payload) {
  ocSessions.forEach(({ ws }) => {
    sendEvent(ws, event, payload);
  });
}

module.exports = { initOpenClawAdapter, broadcastToOpenClaw };
