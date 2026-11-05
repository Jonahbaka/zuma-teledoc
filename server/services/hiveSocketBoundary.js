'use strict';
const crypto = require('crypto');
const policy = require('./hiveAccessPolicy');

function installHiveNamespace(io, { authenticateSocket, db }) {
  const namespace = io.of('/hive');
  async function actorFor(socket) {
    if (!socket.userId) return null;
    if (!socket.authorizeDelivery || !await socket.authorizeDelivery()) throw policy.error(401, 'HIVE_SESSION_REVOKED', 'Sign in again.');
    const result = await db.query('SELECT id,role,market_scope,is_active FROM users WHERE id=$1', [socket.userId]);
    const current = result.rows[0];
    if (!current || current.is_active !== true || current.role !== socket.userRole) throw policy.error(403, 'HIVE_SESSION_REVOKED', 'Session authority changed.');
    return { id: current.id, role: current.role, marketScope: current.market_scope };
  }
  namespace.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace(/^Bearer /, '');
      if (token) await authenticateSocket(socket, token);
      // An invalid token must fail; it must never become an anonymous session.
      const actor = await actorFor(socket);
      const agent = policy.assertAgent(socket.handshake.query?.agentId || 'nova', actor);
      socket.hiveAgentId = agent.id;
      socket.hiveRole = actor?.role || 'guest';
      socket.hiveMarket = actor?.marketScope || null;
      next();
    } catch (error) {
      const denied = new Error('Assistant access denied. Use your authorized clinical or admin workspace.');
      denied.data = { code: error.code || 'HIVE_ACCESS_DENIED' };
      next(denied);
    }
  });
  namespace.on('connection', socket => {
    const sessionId = `hive_ws_${crypto.randomBytes(32).toString('hex')}`;
    const agentId = socket.hiveAgentId;
    let busy = false, sent = 0, windowStart = Date.now();
    socket.hiveSessionId = sessionId;
    socket.emit('hive:session', { sessionId, agentId, role: socket.hiveRole });
    socket.on('hive:send', async (payload = {}) => {
      let acquired = false;
      try {
        if (busy) throw policy.error(409, 'HIVE_BUSY', 'Wait for the current response.');
        if (Date.now() - windowStart > 60000) { windowStart = Date.now(); sent = 0; }
        if (++sent > 30) throw policy.error(429, 'HIVE_RATE_LIMIT', 'Please wait before sending more messages.');
        const content = policy.validateMessage(payload);
        const actor = await actorFor(socket);
        if ((actor?.marketScope || null) !== socket.hiveMarket) throw policy.error(403, 'HIVE_SESSION_REVOKED', 'Session authority changed.');
        policy.assertAgent(agentId, actor);
        busy = true; acquired = true;
        socket.emit('hive:thinking', { sessionId });
        const response = await policy.reply({ agentId, actor, content, db });
        // Recheck immediately before delivering any private result.
        if (actor) {
          const current = await actorFor(socket);
          if (current.marketScope !== socket.hiveMarket) throw policy.error(403, 'HIVE_SESSION_REVOKED', 'Session authority changed.');
        }
        socket.emit('hive:message', { content: response.text, agentId, agentName: policy.AGENTS[agentId].name, mode: response.mode, toolCalls: [], ts: Date.now() });
      } catch (error) { socket.emit('hive:error', { code: error.code || 'HIVE_UNAVAILABLE', message: 'This request is unavailable in the current assistant session.' }); }
      finally { if (acquired) busy = false; }
    });
    socket.on('hive:command', payload => {
      if (payload?.command === 'kill') { socket.emit('hive:status', { type: 'session_killed', sessionId }); socket.disconnect(true); }
    });
    socket.on('hive:status_req', (_payload, callback) => {
      if (typeof callback === 'function') callback({ sessionId, agentId, role: socket.hiveRole, connected: true });
    });
  });
  return namespace;
}
module.exports = { installHiveNamespace };
