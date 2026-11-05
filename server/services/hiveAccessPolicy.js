'use strict';
const crypto = require('crypto');
const error = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });
const AGENTS = {
  nova: { id: 'nova', name: 'Nurse Nova', type: 'concierge' },
  overwatch: { id: 'overwatch', name: 'The Conductor', type: 'operations' },
};
const TTL = 30 * 60 * 1000;

function assertAgent(agentId = 'nova', actor = null) {
  if (agentId === 'hippocrates' || agentId === 'triage') {
    const role = agentId === 'hippocrates' ? 'provider' : 'patient';
    if (actor?.role !== role) throw error(403, 'HIVE_AGENT_FORBIDDEN', 'This agent is unavailable for your role.');
    throw error(409, 'CLINICAL_WORKFLOW_REQUIRED', 'Open the authorized consultation or clinical-review workflow for this request.');
  }
  if (!Object.hasOwn(AGENTS, agentId)) throw error(400, 'HIVE_AGENT_UNKNOWN', 'Select an available assistant.');
  if (agentId === 'overwatch' && !['admin', 'super_admin'].includes(actor?.role)) throw error(403, 'HIVE_AGENT_FORBIDDEN', 'Administrative access is required.');
  return AGENTS[agentId];
}
function createStore({ now = Date.now, maxSessions = 1000 } = {}) {
  const sessions = new Map();
  const prune = () => { for (const [id, session] of sessions) if (session.expiresAt <= now()) sessions.delete(id); };
  return {
    sessions, prune,
    create(agentId, actor, isPublic = false) {
      const agent = assertAgent(agentId, actor);
      if (isPublic && agent.id !== 'nova' || !isPublic && !actor?.id) throw error(403, 'HIVE_SESSION_FORBIDDEN', 'Session access denied.');
      prune();
      if (sessions.size >= maxSessions) throw error(503, 'HIVE_CAPACITY', 'Assistant capacity reached. Please try again later.');
      const session = { id: `hive_${crypto.randomBytes(32).toString('hex')}`, userId: actor?.id || null,
        role: actor?.role || 'guest', market: actor?.marketScope || null, agentId: agent.id,
        agentName: agent.name, agentType: agent.type, isPublic, startedAt: new Date(now()).toISOString(),
        expiresAt: now() + TTL, messages: [], busy: false };
      sessions.set(session.id, session);
      return session;
    },
    read(id, actor, isPublic = false) {
      prune();
      const session = typeof id === 'string' && sessions.get(id);
      if (!session || session.isPublic !== isPublic || !isPublic &&
          (session.userId !== actor?.id || session.role !== actor?.role || session.market !== (actor?.marketScope || null))) {
        throw error(404, 'HIVE_SESSION_NOT_FOUND', 'Session not found.');
      }
      assertAgent(session.agentId, actor);
      return session;
    },
  };
}
function validateMessage(payload) {
  if (typeof payload?.content !== 'string' || !payload.content.trim() || payload.content.length > 4000 ||
      payload.attachments && (!Array.isArray(payload.attachments) || payload.attachments.length > 0)) throw error(400, 'HIVE_MESSAGE_INVALID', 'Enter a message of up to 4,000 characters. Attachments belong in the secure clinical workflow.');
  return payload.content.trim();
}
function conciergeReply(content) {
  // Public navigation is intentionally tool-free. Free text cannot grant access
  // to patient records, clinical inference, browsing, messaging or execution.
  if (/emergency|chest pain|cannot breathe|can.t breathe|suicid/i.test(content)) return 'If you may be in immediate danger, contact local emergency services or seek urgent in-person care. This concierge cannot assess symptoms.';
  if (/price|pricing|cost|pay|insurance/i.test(content)) return 'Visit /pricing and choose your care market. Confirm the price and available payment options before booking; coverage and availability depend on your location.';
  if (/provider|doctor|clinician|register/i.test(content)) return 'For the United States, visit /provider/register. For Nigeria, visit /ng/provider/register. Submitted credentials are reviewed before clinical access is granted.';
  if (/book|appointment|consult|care/i.test(content)) return 'Choose the United States or Nigeria on the site, sign in to your patient portal, and select Get care. Your portal shows available appointments and visit details.';
  if (/record|prescription|medication|result|patient|symptom|diagnos/i.test(content)) return 'Please use your secure patient portal for records, prescriptions, results or questions for your care team. Do not share medical or identifying information in this public concierge.';
  return 'DoctaRx connects care booking, visits and follow-up in your selected market. I can guide you to booking, pricing, provider registration or your secure patient portal. Please keep personal and medical information in the secure portal.';
}
async function operationsSnapshot(db, actor) {
  assertAgent('overwatch', actor);
  if (!['US', 'NG'].includes(actor.marketScope)) throw error(403, 'HIVE_MARKET_REQUIRED', 'Current market authority is required.');
  const result = await db.query(`SELECT COUNT(*) FILTER (WHERE role='patient')::int AS patients,
    COUNT(*) FILTER (WHERE role='provider')::int AS providers FROM users WHERE market_scope=$1 AND is_active=TRUE`, [actor.marketScope]);
  return { market: actor.marketScope, activePatients: result.rows[0]?.patients ?? null,
    activeProviders: result.rows[0]?.providers ?? null, observedAt: new Date().toISOString() };
}
async function reply({ agentId, actor, content, db }) {
  assertAgent(agentId, actor);
  if (global.__HIVE_PAUSED) throw error(503, 'HIVE_PAUSED', 'Assistant messaging is temporarily paused.');
  if (agentId === 'nova') return { text: conciergeReply(content), toolCalls: [], iterations: 0, mode: 'platform_navigation' };
  const stats = await operationsSnapshot(db, actor);
  return { text: `${stats.market} operations: ${stats.activePatients ?? 'unavailable'} active patient accounts and ${stats.activeProviders ?? 'unavailable'} active provider accounts. Updated ${stats.observedAt}. Detailed operations remain in the authorized admin workspace.`, toolCalls: [], iterations: 0, mode: 'scoped_operations', stats };
}
module.exports = { AGENTS, assertAgent, createStore, validateMessage, conciergeReply, operationsSnapshot, reply, error };
