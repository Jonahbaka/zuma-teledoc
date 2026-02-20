/**
 * ═══════════════════════════════════════════════════════════════
 *  OpenClaw REST API — External Agent Integration Layer
 *  DoctaRx Project Genesis
 * ═══════════════════════════════════════════════════════════════
 *
 * Enables external OpenClaw-compatible AI agents to interact with
 * the DoctaRx Agent Society through a structured REST API.
 *
 * Auth: x-openclaw-key header
 * All actions are logged to the audit trail.
 * Protocol Version: 1.0
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');

// ── Service references (lazy-loaded, graceful if unavailable) ──────────

let agentOrchestrator;
try { agentOrchestrator = require('../services/agent-orchestrator'); } catch {}

let llmService;
try {
  llmService = require('../services/agent-orchestrator/gemini-llm');
  if (llmService && !llmService.isAvailable()) llmService.initialize();
} catch {}

let medicalUnit;
try { medicalUnit = require('../services/agent-orchestrator/medical-unit'); } catch {}

let persistentMemory;
try { persistentMemory = require('../services/agent-orchestrator/persistent-memory'); } catch {}

let agentLoop;
try { agentLoop = require('../services/agent-orchestrator/agent-loop'); } catch {}

// ── Agent display names ───────────────────────────────────────────────

const AGENT_NAMES = {
  operations: 'The Weaver', growth: 'The Scout', corporate_skills: 'The Builder',
  revenue: 'The Alchemist', compliance: 'The Guardian', governance: 'The Sage',
  researcher: 'The Oracle', economics: 'The Economist', physicist: 'The Architect',
  mathematician: 'The Calculator', vortex_math: 'The Tesseract', ceo: 'The Conductor',
  devops: 'The Debugger', asclepius: 'Asclepius', triage_nurse: 'Triage Nurse',
  pharmacist: 'Pharmacist', accounting: 'The Accountant', engineering: 'The Engineer'
};

const AGENT_PERSONAS = {
  operations: 'You are The Weaver, DoctaRx operations optimizer. You find bottlenecks and weave frictionless logistics.',
  growth: 'You are The Scout, DoctaRx growth strategist. You find opportunities others miss.',
  corporate_skills: 'You are The Builder, DoctaRx corporate skills agent. You construct the legal and administrative vessel.',
  revenue: 'You are The Alchemist, DoctaRx revenue agent. You transmute service into fuel.',
  compliance: 'You are The Guardian, DoctaRx HIPAA compliance officer. You protect the sacred data.',
  governance: 'You are The Sage, DoctaRx governance agent. You score proposals with 3-6-9 Vortex Logic.',
  researcher: 'You are The Oracle, DoctaRx deep research agent. Every claim has a source and confidence level.',
  economics: 'You are The Economist, DoctaRx economics agent. Game theory, price elasticity, incentive design.',
  physicist: 'You are The Architect, DoctaRx physics agent. Thermodynamics and network theory applied to business.',
  mathematician: 'You are The Calculator, DoctaRx mathematics agent. Bayesian inference, Monte Carlo, queueing theory.',
  vortex_math: 'You are The Tesseract, DoctaRx vortex mathematics agent. Sacred geometry, 3-6-9 patterns.',
  ceo: 'You are The Conductor, DoctaRx CEO agent. You synthesize ALL agent intelligence into one executive brief.',
  devops: 'You are The Debugger, DoctaRx DevOps agent. You monitor, diagnose, and self-heal server issues.',
  asclepius: 'You are Asclepius, DoctaRx clinical decision support. Not a prescriber.',
  triage_nurse: 'You are the Triage Nurse, DoctaRx patient-facing triage agent. Safety-first.',
  pharmacist: 'You are the Pharmacist, DoctaRx medication management agent.',
  accounting: 'You are The Accountant, DoctaRx CFO agent. Revenue tracking and financial projections.',
  engineering: 'You are The Engineer, DoctaRx full-stack coding agent.'
};

// ── Auth Middleware ────────────────────────────────────────────────────

const OPENCLAW_API_KEY = process.env.OPENCLAW_API_KEY || process.env.OPENCLAW_GATEWAY_TOKEN || 'doctarx-hive-gateway-token-2026';

function requireOpenClawAuth(req, res, next) {
  const key = req.headers['x-openclaw-key']
    || (req.headers['authorization'] || '').replace('Bearer ', '')
    || req.query.key;
  if (!key) return res.status(401).json({ ok: false, error: 'Missing x-openclaw-key header' });
  if (key !== OPENCLAW_API_KEY) return res.status(403).json({ ok: false, error: 'Invalid API key' });
  req.openclawClient = {
    id: `oc_${crypto.createHash('sha256').update(key).digest('hex').slice(0, 12)}`,
    role: 'external_agent'
  };
  next();
}

// ── Helpers ───────────────────────────────────────────────────────────

async function auditLog(action, details, clientId) {
  try {
    await db.query(
      `INSERT INTO ai_audit_log (action, details, agent_id, created_at) VALUES ($1, $2, $3, NOW())`,
      [`openclaw:${action}`, JSON.stringify(details), clientId || 'openclaw']
    );
  } catch { /* non-critical */ }
}

function sanitize(input) {
  let t = String(input || '');
  t = t.replace(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g, (_m, inner) => String(inner || ''));
  t = t.replace(/\*\*/g, '').replace(/\*/g, '').replace(/^#{1,6}\s+/gm, '');
  t = t.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

// =========================================================================
// ROUTES
// =========================================================================

/**
 * GET /api/openclaw/health
 * Public health check (no auth)
 */
router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    status: agentOrchestrator?.initialized ? 'online' : 'initializing',
    protocolVersion: '1.0',
    llm: llmService?.isAvailable() ? 'online' : 'offline',
    agentCount: agentOrchestrator?.agents?.size || 0,
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /api/openclaw/soul
 * Read the SOUL.md identity protocol
 */
router.get('/soul', requireOpenClawAuth, async (req, res) => {
  try {
    const soulPath = path.join(__dirname, '..', '..', 'SOUL.md');
    if (!fs.existsSync(soulPath)) return res.status(404).json({ ok: false, error: 'SOUL.md not found' });
    const content = fs.readFileSync(soulPath, 'utf8');
    await auditLog('read_soul', {}, req.openclawClient.id);
    res.json({ ok: true, data: { content, protocolVersion: '1.0' } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/openclaw/agents
 * List all agents and their status
 */
router.get('/agents', requireOpenClawAuth, async (req, res) => {
  try {
    if (!agentOrchestrator) return res.status(503).json({ ok: false, error: 'Orchestrator unavailable' });
    const agents = agentOrchestrator.getAgentList ? agentOrchestrator.getAgentList() : [];

    let dbMap = new Map();
    try {
      const r = await db.query('SELECT agent_type, status, autonomy_level, last_run_at, operating_mode FROM ai_agents');
      dbMap = new Map((r.rows || []).map(a => [a.agent_type, a]));
    } catch {}

    const enriched = agents.map(a => {
      const d = dbMap.get(a.type || a.agentType) || {};
      return {
        type: a.type || a.agentType,
        displayName: a.displayName || AGENT_NAMES[a.type] || a.type,
        codeName: a.codeName || AGENT_NAMES[a.type] || a.type,
        description: a.description || '',
        status: d.status || 'idle',
        autonomyLevel: d.autonomy_level || 0,
        lastRunAt: d.last_run_at || null
      };
    });

    await auditLog('list_agents', { count: enriched.length }, req.openclawClient.id);
    res.json({ ok: true, data: { agents: enriched, count: enriched.length } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/openclaw/agents/:type
 * Get specific agent details
 */
router.get('/agents/:type', requireOpenClawAuth, async (req, res) => {
  try {
    const t = req.params.type;
    if (!agentOrchestrator?.agents?.has(t)) return res.status(404).json({ ok: false, error: `Agent '${t}' not found` });
    const agent = agentOrchestrator.agents.get(t);

    let dbRow = {};
    try { const r = await db.query('SELECT * FROM ai_agents WHERE agent_type = $1', [t]); dbRow = r.rows?.[0] || {}; } catch {}

    res.json({
      ok: true,
      data: {
        type: t,
        displayName: agent.displayName || AGENT_NAMES[t],
        codeName: agent.codeName || AGENT_NAMES[t],
        description: agent.description || '',
        mission: agent.mission || '',
        status: dbRow.status || 'idle',
        autonomyLevel: dbRow.autonomy_level || 0,
        lastRunAt: dbRow.last_run_at || null
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/openclaw/query
 * Ask any DoctaRx agent a question and get a response.
 *
 * Body: { agentType: string, message: string, context?: string }
 */
router.post('/query', requireOpenClawAuth, async (req, res) => {
  try {
    const { agentType, message, context } = req.body;
    if (!agentType) return res.status(400).json({ ok: false, error: 'agentType required' });
    if (!message) return res.status(400).json({ ok: false, error: 'message required' });
    if (!AGENT_NAMES[agentType]) {
      return res.status(404).json({ ok: false, error: `Unknown agent: ${agentType}. Available: ${Object.keys(AGENT_NAMES).join(', ')}` });
    }

    const agentName = AGENT_NAMES[agentType];
    const persona = AGENT_PERSONAS[agentType];
    await auditLog('query', { agentType, len: message.length }, req.openclawClient.id);

    // Store incoming message
    try {
      await db.query(
        `INSERT INTO ai_chat_messages (sender_type, sender_id, sender_name, recipient_type, recipient_id, content, message_type)
         VALUES ('operator', $1, $2, 'agent', $3, $4, 'text')`,
        [req.openclawClient.id, `OpenClaw (${req.openclawClient.id})`, agentType, message]
      );
    } catch {}

    // ── Medical specialists: route through Medical Unit ──────────────
    if (medicalUnit && ['asclepius', 'triage_nurse', 'pharmacist'].includes(agentType)) {
      const audience = agentType === 'asclepius' ? 'provider' : 'patient';
      const result = await medicalUnit.consult({
        message, audience, specialist: agentType,
        context: context || 'External OpenClaw agent query'
      });
      const responseText = sanitize(`${result.text}\n\n${result.disclaimer || ''}`);

      try {
        await db.query(
          `INSERT INTO ai_chat_messages (sender_type, sender_id, sender_name, recipient_type, recipient_id, content, message_type, metadata)
           VALUES ('agent', $1, $2, 'operator', $3, $4, 'text', $5)`,
          [agentType, agentName, req.openclawClient.id, responseText, JSON.stringify({ engine: 'medical_unit', source: 'openclaw' })]
        );
      } catch {}

      return res.json({
        ok: true,
        data: { agentType, agentName, response: responseText, engine: 'medical_unit', emergency: result.emergency || false, triage: result.triage || null }
      });
    }

    // ── General agents: LLM-powered ─────────────────────────────────
    if (!llmService?.isAvailable()) {
      try { llmService?.initialize(); } catch {}
    }
    if (!llmService?.isAvailable()) {
      return res.status(503).json({ ok: false, error: 'LLM unavailable. Set ANTHROPIC_API_KEY or GEMINI_API_KEY.' });
    }

    let conversationHistory = [];
    try {
      const h = await db.query(
        `SELECT sender_type, content FROM ai_chat_messages WHERE (sender_id = $1 OR recipient_id = $1) ORDER BY created_at DESC LIMIT 8`, [agentType]
      );
      conversationHistory = h.rows.reverse();
    } catch {}

    let memory = '';
    try {
      if (persistentMemory) {
        const am = await persistentMemory.getAgentMemory(agentType);
        const sm = await persistentMemory.getSharedMemory(5);
        memory = [am, sm].filter(Boolean).join('\n\n');
      }
    } catch {}

    const enrichedMessage = context ? `[Context from external agent: ${context}]\n\n${message}` : message;

    // Try agent loop first
    if (agentLoop) {
      const result = await agentLoop.runAgent(agentType, agentName, persona, enrichedMessage, {
        llmService, conversationHistory, memory, attachments: [], maxTokens: 4096
      });
      const responseText = sanitize(result.text || result.content || 'No response.');
      try {
        await db.query(
          `INSERT INTO ai_chat_messages (sender_type, sender_id, sender_name, recipient_type, recipient_id, content, message_type, metadata)
           VALUES ('agent', $1, $2, 'operator', $3, $4, 'text', $5)`,
          [agentType, agentName, req.openclawClient.id, responseText, JSON.stringify({ engine: 'agent_loop', source: 'openclaw', iterations: result.iterations || 1 })]
        );
      } catch {}
      return res.json({ ok: true, data: { agentType, agentName, response: responseText, engine: 'agent_loop', iterations: result.iterations || 1 } });
    }

    // Fallback: direct LLM
    const sysPrompt = `${persona}\n\nAn external AI agent is querying you through the OpenClaw API. Respond helpfully, in-character.`;
    const llmResult = await llmService.generateContent(sysPrompt, enrichedMessage);
    const responseText = sanitize(llmResult?.text || llmResult || 'No response.');
    try {
      await db.query(
        `INSERT INTO ai_chat_messages (sender_type, sender_id, sender_name, recipient_type, recipient_id, content, message_type, metadata)
         VALUES ('agent', $1, $2, 'operator', $3, $4, 'text', $5)`,
        [agentType, agentName, req.openclawClient.id, responseText, JSON.stringify({ engine: 'direct_llm', source: 'openclaw' })]
      );
    } catch {}

    res.json({ ok: true, data: { agentType, agentName, response: responseText, engine: 'direct_llm' } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/openclaw/intent
 * Submit an action intent through the governance pipeline.
 *
 * Body: {
 *   agentType: string, intentType: string, intentCategory: string,
 *   parameters: object, reasoning: string, expectedOutcome: string
 * }
 */
router.post('/intent', requireOpenClawAuth, async (req, res) => {
  try {
    const { agentType, intentType, intentCategory, parameters, reasoning, expectedOutcome } = req.body;
    if (!agentType) return res.status(400).json({ ok: false, error: 'agentType required' });
    if (!intentType) return res.status(400).json({ ok: false, error: 'intentType required' });
    if (!reasoning) return res.status(400).json({ ok: false, error: 'reasoning required' });

    let agentId = null;
    try {
      const r = await db.query('SELECT id FROM ai_agents WHERE agent_type = $1', [agentType]);
      agentId = r.rows?.[0]?.id;
    } catch {}
    if (!agentId) return res.status(404).json({ ok: false, error: `Agent '${agentType}' not found` });

    await auditLog('submit_intent', { agentType, intentType, intentCategory }, req.openclawClient.id);

    if (agentOrchestrator?.intentSystem) {
      const intent = await agentOrchestrator.intentSystem.declare({
        agentId, intentType,
        intentCategory: intentCategory || 'external',
        parameters: parameters || {},
        reasoning: `[OpenClaw] ${reasoning}`,
        expectedOutcome: expectedOutcome || 'Pending review',
        confidence: 0.8, isReversible: true,
        riskScore: intentCategory === 'financial' ? 8 : intentCategory === 'external' ? 6 : 3
      });
      return res.json({
        ok: true,
        data: {
          intentId: intent.id, status: intent.status,
          requiresApproval: intent.requires_approval,
          message: intent.requires_approval
            ? 'Intent awaiting Operator approval.'
            : 'Intent auto-approved and executed (low risk).'
        }
      });
    }

    // Fallback: store directly as pending
    const r = await db.query(
      `INSERT INTO ai_intents (agent_id, intent_type, intent_category, parameters, reasoning, expected_outcome, confidence, requires_approval, status)
       VALUES ($1, $2, $3, $4, $5, $6, 0.8, true, 'pending') RETURNING id, status, requires_approval`,
      [agentId, intentType, intentCategory || 'external', JSON.stringify(parameters || {}), `[OpenClaw] ${reasoning}`, expectedOutcome || '']
    );
    res.json({ ok: true, data: { intentId: r.rows[0].id, status: 'pending', requiresApproval: true } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/openclaw/event
 * Emit an event on the Event Bus.
 *
 * Body: { eventType: string, payload: object }
 */
router.post('/event', requireOpenClawAuth, async (req, res) => {
  try {
    const { eventType, payload } = req.body;
    if (!eventType) return res.status(400).json({ ok: false, error: 'eventType required' });

    const prefixed = eventType.startsWith('openclaw.') ? eventType : `openclaw.${eventType}`;
    await auditLog('emit_event', { eventType: prefixed }, req.openclawClient.id);

    if (agentOrchestrator?.eventBus) {
      await agentOrchestrator.eventBus.emit(prefixed, {
        ...(payload || {}), source: 'openclaw_api',
        clientId: req.openclawClient.id, timestamp: new Date().toISOString()
      }, req.openclawClient.id);
      return res.json({ ok: true, data: { eventType: prefixed, emitted: true } });
    }

    res.json({ ok: true, data: { eventType: prefixed, emitted: false, note: 'Event Bus unavailable, logged only.' } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/openclaw/skills
 * List registered skills
 */
router.get('/skills', requireOpenClawAuth, async (req, res) => {
  try {
    let skills = [];
    try {
      const r = await db.query('SELECT id, skill_name, description, agent_type, category, status, created_at FROM ai_skills ORDER BY created_at DESC');
      skills = (r.rows || []).map(s => ({ id: s.id, name: s.skill_name, description: s.description, agentType: s.agent_type, category: s.category, status: s.status }));
    } catch {}

    if (agentOrchestrator?.skillSelector) {
      for (const ds of agentOrchestrator.skillSelector.list()) {
        skills.push({ id: ds.id || ds.name, name: ds.name, description: ds.description || '', category: 'dynamic', status: 'active' });
      }
    }

    await auditLog('list_skills', { count: skills.length }, req.openclawClient.id);
    res.json({ ok: true, data: { skills, count: skills.length } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/openclaw/memory
 * Store a memory in the persistent brain.
 *
 * Body: { content: string, memoryType?: 'fact'|'context'|'preference'|'learning', agentType?: string }
 */
router.post('/memory', requireOpenClawAuth, async (req, res) => {
  try {
    const { content, memoryType, agentType } = req.body;
    if (!content) return res.status(400).json({ ok: false, error: 'content required' });

    await auditLog('store_memory', { memoryType, agentType, len: content.length }, req.openclawClient.id);

    if (persistentMemory) {
      await persistentMemory.store({
        content, memoryType: memoryType || 'fact',
        agentType: agentType || 'shared',
        source: `openclaw:${req.openclawClient.id}`
      });
      return res.json({ ok: true, data: { stored: true } });
    }

    await db.query(
      `INSERT INTO ai_audit_log (action, details, agent_id) VALUES ($1, $2, $3)`,
      ['openclaw:memory', JSON.stringify({ content, memoryType }), req.openclawClient.id]
    );
    res.json({ ok: true, data: { stored: true, note: 'Stored in audit log (persistent memory unavailable).' } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/openclaw/memory
 * Retrieve shared memories.
 * Query: ?agentType=ceo&limit=20
 */
router.get('/memory', requireOpenClawAuth, async (req, res) => {
  try {
    const agentType = req.query.agentType || 'shared';
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    if (persistentMemory) {
      const agentMem = agentType !== 'shared' ? await persistentMemory.getAgentMemory(agentType) : null;
      const sharedMem = await persistentMemory.getSharedMemory(limit);
      return res.json({ ok: true, data: { agentMemory: agentMem, sharedMemory: sharedMem } });
    }

    res.json({ ok: true, data: { agentMemory: null, sharedMemory: null, note: 'Persistent memory unavailable.' } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
