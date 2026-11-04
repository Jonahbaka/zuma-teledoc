/**
 * ═══════════════════════════════════════════════════════════════
 *  HIVE GATEWAY — REST endpoints for the DoctaRx Agent Hive
 * ═══════════════════════════════════════════════════════════════
 *
 *  All agent interactions route through here.
 *  The /hive socket namespace handles real-time streaming.
 *  This file handles REST fallback + admin control surfaces.
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const db = require('../db');

let agentLoop, llmService, toolRegistry, hiveConfig;
try { agentLoop = require('../services/agent-orchestrator/agent-loop'); } catch {}
try { llmService = require('../services/agent-orchestrator/gemini-llm'); } catch {}
try { toolRegistry = require('../services/agent-orchestrator/tool-registry'); } catch {}
try { hiveConfig = require('../services/agent-orchestrator/hive-config'); } catch {}

const adminOnly = [authenticate, requireRole('admin', 'super_admin')];
const anyAuth = [authenticate];

const HIVE_AGENTS = {
  nova:        { type: 'concierge',  name: 'Nurse Nova',  persona: 'You are Nurse Nova, the DoctaRx public concierge. You answer FAQs about the platform, help visitors understand telehealth, guide them to sign up, and respond with warmth and clarity. You never access or discuss specific patient data. If someone describes an emergency, tell them to call 911 immediately.' },
  triage:      { type: 'triage',     name: 'Triage Bot',  persona: 'You are the DoctaRx Triage Agent. You are a symptom-assessment specialist. Ask the patient about symptoms, duration, severity, and relevant history. Calculate an urgency score from 1 (routine) to 5 (emergent). For scores 4-5, advise emergency services. For lower scores, recommend booking a telehealth appointment. Never diagnose or prescribe. Be compassionate.' },
  hippocrates: { type: 'clinical',   name: 'Hippocrates',  persona: 'You are Hippocrates, the DoctaRx Clinical Co-Pilot. You assist providers during consultations. You can draft SOAP notes from conversation summaries, fetch patient lab results and medication history, suggest differential diagnoses, and flag drug interactions. All output is for the provider only, not the patient. Write clearly and concisely.' },
  overwatch:   { type: 'ceo',        name: 'The Conductor', persona: 'You are The Conductor, the Hive Overwatch intelligence. You monitor all agent sessions, platform health, and operational metrics. You report to the admin in plain language. You can query the database, review flagged conversations, and recommend actions.' },
};

const SANDBOX_PERMISSIONS = {
  concierge: { dbRead: false, dbWrite: false, webSearch: true,  medical: false },
  triage:    { dbRead: true,  dbWrite: true,  webSearch: false, medical: true  },
  clinical:  { dbRead: true,  dbWrite: true,  webSearch: true,  medical: true  },
  ceo:       { dbRead: true,  dbWrite: true,  webSearch: true,  medical: false },
};

/* ---------- Session store (in-memory, production would use Redis) ---------- */
const sessions = new Map();

function createSession(userId, agentId, role) {
  const id = `hive_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const agent = HIVE_AGENTS[agentId] || HIVE_AGENTS.nova;
  const session = {
    id,
    userId,
    agentId,
    agentType: agent.type,
    agentName: agent.name,
    role,
    messages: [],
    urgencyScore: null,
    startedAt: new Date(),
    sandbox: SANDBOX_PERMISSIONS[agent.type] || SANDBOX_PERMISSIONS.concierge,
  };
  sessions.set(id, session);
  return session;
}

/* ---------- POST /api/hive/session — Start a new agent session ---------- */
router.post('/session', ...anyAuth, async (req, res) => {
  try {
    const { agentId } = req.body;
    const session = createSession(req.user.id, agentId || 'nova', req.user.role);
    res.json({
      success: true,
      data: {
        sessionId: session.id,
        agent: { id: session.agentId, name: session.agentName, type: session.agentType },
        sandbox: session.sandbox,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ---------- POST /api/hive/session/public — Unauthenticated concierge ---------- */
router.post('/session/public', async (req, res) => {
  try {
    const id = `hive_pub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const agent = HIVE_AGENTS.nova;
    const session = {
      id,
      userId: null,
      agentId: 'nova',
      agentType: agent.type,
      agentName: agent.name,
      role: 'guest',
      messages: [],
      startedAt: new Date(),
      sandbox: SANDBOX_PERMISSIONS.concierge,
    };
    sessions.set(id, session);
    res.json({
      success: true,
      data: { sessionId: id, agent: { id: 'nova', name: agent.name, type: agent.type } }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ---------- POST /api/hive/message — Send a message to the agent ---------- */
router.post('/message', async (req, res) => {
  try {
    const { sessionId, content, attachments } = req.body;
    if (!sessionId || !content) return res.status(400).json({ success: false, error: 'sessionId and content required' });

    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

    session.messages.push({ role: 'user', content, ts: Date.now() });

    const agent = HIVE_AGENTS[session.agentId] || HIVE_AGENTS.nova;
    let response;

    // Load skill context if available
    let skillContext = '';
    if (hiveConfig) {
      const skill = hiveConfig.loadAgentSkill(session.agentId);
      if (skill) skillContext += `\n\n--- SKILL FILE ---\n${skill}\n--- END SKILL ---\n`;
      if (session.agentId === 'nova') {
        const kb = hiveConfig.loadKnowledgeBase();
        if (kb) skillContext += `\n--- KNOWLEDGE BASE ---\n${kb}\n--- END KB ---\n`;
      }
    }

    const enrichedPersona = agent.persona + skillContext;

    if (agentLoop?.runAgent) {
      response = await agentLoop.runAgent(
        session.agentType,
        session.agentName,
        enrichedPersona,
        content,
        {
          llmService,
          conversationHistory: session.messages.map(m => ({
            sender_type: m.role === 'user' ? 'operator' : 'agent',
            content: m.content,
          })),
          attachments,
        }
      );
    } else if (llmService?.callLLM) {
      const sysPrompt = `${enrichedPersona}\n\nYou are in sandbox mode: ${JSON.stringify(session.sandbox)}. Current time: ${new Date().toISOString()}`;
      const text = await llmService.callLLM(sysPrompt, content);
      response = { text, toolCalls: [], iterations: 0 };
    } else {
      response = { text: `${agent.name} is currently offline. Please try again shortly.`, toolCalls: [], iterations: 0 };
    }

    const agentMessage = {
      role: 'agent',
      content: response.text,
      toolCalls: response.toolCalls || [],
      iterations: response.iterations || 0,
      ts: Date.now(),
    };
    session.messages.push(agentMessage);

    // Triage: extract urgency if applicable
    if (session.agentType === 'triage') {
      const urgencyMatch = response.text.match(/urgency[:\s]*(\d)/i);
      if (urgencyMatch) session.urgencyScore = parseInt(urgencyMatch[1]);
    }

    res.json({ success: true, data: agentMessage });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ---------- GET /api/hive/session/:id — Get session history ---------- */
router.get('/session/:id', async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ success: false, error: 'Session not found' });
  res.json({
    success: true,
    data: {
      ...session,
      messageCount: session.messages.length,
    },
  });
});

/* ---------- POST /api/hive/triage/book — Book appointment from triage ---------- */
router.post('/triage/book', ...anyAuth, async (req, res) => {
  try {
    const { sessionId, urgency, symptoms, preferredDate } = req.body;
    const session = sessionId ? sessions.get(sessionId) : null;

    const appointmentType = urgency >= 4 ? 'urgent' : urgency >= 3 ? 'priority' : 'routine';

    const result = await db.query(`
      INSERT INTO video_sessions (patient_id, status, appointment_type, notes, scheduled_at, created_at)
      VALUES ($1, 'scheduled', $2, $3, $4, NOW())
      RETURNING id, appointment_type, scheduled_at
    `, [
      req.user.id,
      appointmentType,
      `AI Triage (Urgency ${urgency}/5): ${symptoms || 'General'}`,
      preferredDate || new Date(Date.now() + (urgency >= 4 ? 3600000 : 86400000)),
    ]);

    res.json({ success: true, data: { appointment: result.rows[0], urgency, appointmentType } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ---------- ADMIN: GET /api/hive/overwatch — Live Hive status ---------- */
router.get('/overwatch', ...adminOnly, async (req, res) => {
  try {
    const activeSessions = [];
    const flagged = [];
    for (const [id, s] of sessions) {
      const entry = {
        id, agentId: s.agentId, agentName: s.agentName, role: s.role,
        messageCount: s.messages.length, urgencyScore: s.urgencyScore,
        startedAt: s.startedAt, lastActivity: s.messages.length > 0 ? new Date(s.messages[s.messages.length - 1].ts) : s.startedAt,
      };
      activeSessions.push(entry);
      if (s.urgencyScore >= 4) flagged.push(entry);
    }

    // Live platform stats
    let stats = {};
    try {
      const [users, appts, agents] = await Promise.all([
        db.query('SELECT COUNT(*) as total FROM users').catch(() => ({ rows: [{ total: 0 }] })),
        db.query("SELECT COUNT(*) as total FROM video_sessions WHERE created_at > NOW() - INTERVAL '24 hours'").catch(() => ({ rows: [{ total: 0 }] })),
        db.query('SELECT COUNT(*) as total FROM ai_chat_messages WHERE created_at > NOW() - INTERVAL \'1 hour\'').catch(() => ({ rows: [{ total: 0 }] })),
      ]);
      stats = {
        totalUsers: parseInt(users.rows[0]?.total || 0),
        appointments24h: parseInt(appts.rows[0]?.total || 0),
        agentMessages1h: parseInt(agents.rows[0]?.total || 0),
        activeSessions: activeSessions.length,
        flaggedConversations: flagged.length,
      };
    } catch {}

    res.json({ success: true, data: { activeSessions, flagged, stats, serverUptime: Math.round(process.uptime()) } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ---------- ADMIN: POST /api/hive/kill — Kill switch ---------- */
router.post('/kill', ...adminOnly, async (req, res) => {
  const { scope } = req.body;
  if (scope === 'all') {
    const count = sessions.size;
    sessions.clear();
    res.json({ success: true, data: { killed: count, message: 'All agent sessions terminated' } });
  } else if (scope && sessions.has(scope)) {
    sessions.delete(scope);
    res.json({ success: true, data: { killed: 1, message: `Session ${scope} terminated` } });
  } else {
    res.status(400).json({ success: false, error: 'Provide scope: "all" or a sessionId' });
  }
});

/* ---------- ADMIN: POST /api/hive/pause — Pause/resume all agents ---------- */
router.post('/pause', ...adminOnly, async (req, res) => {
  const { paused } = req.body;
  global.__HIVE_PAUSED = !!paused;
  res.json({ success: true, data: { paused: global.__HIVE_PAUSED } });
});

/* ---------- GET /api/hive/status — Public hive status ---------- */
router.get('/status', (req, res) => {
  res.json({
    success: true,
    data: {
      online: true,
      paused: !!global.__HIVE_PAUSED,
      activeSessions: sessions.size,
      agents: Object.keys(HIVE_AGENTS).map(k => ({ id: k, name: HIVE_AGENTS[k].name, type: HIVE_AGENTS[k].type })),
      uptime: Math.round(process.uptime()),
    }
  });
});

module.exports = router;
