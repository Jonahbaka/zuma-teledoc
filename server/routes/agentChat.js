/**
 * Agent Chat & Credential Vault Routes
 * PROJECT GENESIS — Communication & World Interface Layer
 * 
 * Provides:
 *   1. Chat interface between Operator and Agents
 *   2. Credential Vault for platform access (encrypted)
 *   3. Results tracking for measurable outcomes
 *   4. Platform account management
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const db = require('../db');

let credentialVault;
try {
  credentialVault = require('../services/agent-orchestrator/credential-vault');
} catch (err) {
  console.error('Credential vault not available:', err.message);
}

let agentOrchestrator;
try {
  agentOrchestrator = require('../services/agent-orchestrator');
} catch (err) {
  console.error('Agent orchestrator not available:', err.message);
}

let llmService;
try {
  llmService = require('../services/agent-orchestrator/gemini-llm');
  if (llmService && !llmService.isAvailable()) {
    llmService.initialize();
  }
} catch (err) {
  console.error('LLM service not available:', err.message);
}

let medicalUnit;
try {
  medicalUnit = require('../services/agent-orchestrator/medical-unit');
} catch (err) {
  console.error('Medical unit not available:', err.message);
}

let webEngine;
try {
  webEngine = require('../services/agent-orchestrator/web-action-engine');
} catch (err) {
  console.error('Web action engine not available:', err.message);
}

let persistentMemory;
try {
  persistentMemory = require('../services/agent-orchestrator/persistent-memory');
} catch (err) {
  console.error('Persistent memory not available:', err.message);
}

let ideService;
try {
  ideService = require('../services/agentIdeService');
} catch (err) {
  console.error('IDE service not available:', err.message);
}

let crmService;
try {
  crmService = require('../services/crmService');
} catch (err) {
  console.error('CRM service not available:', err.message);
}

let zohoRecruitService;
try {
  zohoRecruitService = require('../services/zohoRecruitService');
} catch (err) {
  console.error('Zoho Recruit service not available:', err.message);
}

let invitationDb; // Direct DB access for invitation/sign-up actions
// (invitations module uses the routes, we query DB directly for agent context)

// All routes require admin
const adminOnly = [authenticate, requireRole('admin', 'super_admin')];

// =========================================================================
// CHAT MESSAGES
// =========================================================================

/**
 * GET /api/agent-chat/messages
 * Get chat messages (optionally filtered by agent)
 */
router.get('/messages', ...adminOnly, async (req, res) => {
  try {
    const { agent, limit = 100, before } = req.query;
    let query = `
      SELECT id, conversation_id, sender_type, sender_id, sender_name, 
             recipient_type, recipient_id, content, message_type, metadata, 
             read_at, created_at
      FROM ai_chat_messages
    `;
    const params = [];
    const conditions = [];

    if (agent && agent !== 'all') {
      params.push(agent);
      conditions.push(`(sender_id = $${params.length} OR recipient_id = $${params.length} OR recipient_type = 'all')`);
    }
    if (before) {
      params.push(before);
      conditions.push(`created_at < $${params.length}`);
    }

    if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
    params.push(parseInt(limit));
    query += ` ORDER BY created_at DESC LIMIT $${params.length}`;

    const result = await db.query(query, params);
    res.json({ success: true, data: result.rows.reverse() }); // oldest first
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/agent-chat/messages
 * Send a message (from Operator to Agent)
 */
router.post('/messages', ...adminOnly, async (req, res) => {
  try {
    const { recipientId, recipientType = 'agent', content, messageType = 'text' } = req.body;
    if (!content) return res.status(400).json({ success: false, error: 'Content required' });

    // Store operator message
    const result = await db.query(`
      INSERT INTO ai_chat_messages (sender_type, sender_id, sender_name, recipient_type, recipient_id, content, message_type)
      VALUES ('operator', $1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [req.user.id, `The Operator (${req.user.first_name || 'Admin'})`, recipientType, recipientId || 'all', content, messageType]);

    const operatorMessage = result.rows[0];

    // Generate agent response if addressed to a specific agent
    let agentResponse = null;
    if (recipientId && recipientId !== 'all' && agentOrchestrator) {
      const response = await generateAgentResponse(recipientId, content, req.user);
      if (response) {
        const responseResult = await db.query(`
          INSERT INTO ai_chat_messages (sender_type, sender_id, sender_name, recipient_type, recipient_id, content, message_type, metadata)
          VALUES ('agent', $1, $2, 'operator', $3, $4, $5, $6)
          RETURNING *
        `, [recipientId, response.agentName, req.user.id, response.content, response.messageType || 'text', JSON.stringify(response.metadata || {})]);
        agentResponse = responseResult.rows[0];
      }
    }

    res.json({ success: true, data: { operatorMessage, agentResponse } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/agent-chat/broadcast
 * Send a message to all agents
 */
router.post('/broadcast', ...adminOnly, async (req, res) => {
  try {
    const { content, messageType = 'text' } = req.body;
    if (!content) return res.status(400).json({ success: false, error: 'Content required' });

    // Store broadcast message
    const result = await db.query(`
      INSERT INTO ai_chat_messages (sender_type, sender_id, sender_name, recipient_type, content, message_type)
      VALUES ('operator', $1, $2, 'all', $3, $4)
      RETURNING *
    `, [req.user.id, `The Operator (${req.user.first_name || 'Admin'})`, content, messageType]);

    // Each agent responds to broadcast
    const responses = [];
    if (agentOrchestrator) {
      const agents = agentOrchestrator.getAgentList ? agentOrchestrator.getAgentList() : [];
      for (const agent of agents.slice(0, 12)) { // cap responses
        try {
          const response = await generateAgentResponse(agent.type || agent.agentType, content, req.user);
          if (response) {
            const rResult = await db.query(`
              INSERT INTO ai_chat_messages (sender_type, sender_id, sender_name, recipient_type, recipient_id, content, message_type)
              VALUES ('agent', $1, $2, 'operator', $3, $4, 'text')
              RETURNING *
            `, [agent.type || agent.agentType, response.agentName, req.user.id, response.content]);
            responses.push(rResult.rows[0]);
          }
        } catch (e) { /* individual agent error, continue */ }
      }
    }

    res.json({ success: true, data: { broadcast: result.rows[0], responses } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =========================================================================
// SUMMON ALL — Roll Call / Group Introduction
// =========================================================================

/**
 * POST /api/agent-chat/summon-all
 * Summon all agents to introduce themselves in order
 */
router.post('/summon-all', ...adminOnly, async (req, res) => {
  try {
    const { prompt = 'Introduce yourselves to the Operator.' } = req.body;

    // Store the operator's summon message
    await db.query(`
      INSERT INTO ai_chat_messages (sender_type, sender_id, sender_name, recipient_type, content, message_type)
      VALUES ('operator', $1, $2, 'all', $3, 'text')
    `, [req.user.id, `The Operator (${req.user.first_name || 'Admin'})`, prompt]);

    // System announcement
    await db.query(`
      INSERT INTO ai_chat_messages (sender_type, sender_id, sender_name, recipient_type, content, message_type)
      VALUES ('system', 'genesis', 'Project Genesis', 'all', $1, 'alert')
    `, ['👁️ THE OPERATOR HAS SUMMONED THE COUNCIL. All agents — present yourselves.']);

    // Each agent introduces themselves in order
    const agentOrder = [
      'ceo', 'operations', 'growth', 'revenue', 'compliance', 'governance',
      'corporate_skills', 'researcher', 'economics', 'physicist', 'mathematician', 'vortex_math', 'devops'
    ];

    const responses = [];
    for (const agentType of agentOrder) {
      const agentName = AGENT_NAMES[agentType];
      if (!agentName) continue;

      // Try LLM-powered introduction first (Claude primary, Gemini fallback), then template
      let content = null;
      if (llmService && !llmService.isAvailable()) {
        try { llmService.initialize(); } catch (e) { /* already tried */ }
      }
      if (llmService && llmService.isAvailable()) {
        try {
          const persona = AGENT_PERSONAS[agentType] || `You are the ${agentType} agent.`;
          content = await llmService.generateIntroduction(persona, agentName, agentType);
        } catch (e) { /* fallback below */ }
      }
      if (!content) {
        content = `⚠️ **${agentName}** could not generate a response — LLM is unavailable. Check API keys.`;
      }

      try {
        const result = await db.query(`
          INSERT INTO ai_chat_messages (sender_type, sender_id, sender_name, recipient_type, recipient_id, content, message_type)
          VALUES ('agent', $1, $2, 'operator', $3, $4, 'text')
          RETURNING *
        `, [agentType, agentName, req.user.id, content]);
        responses.push(result.rows[0]);
      } catch (e) { /* continue if one fails */ }
    }

    // System closing
    await db.query(`
      INSERT INTO ai_chat_messages (sender_type, sender_id, sender_name, recipient_type, content, message_type)
      VALUES ('system', 'genesis', 'Project Genesis', 'all', $1, 'alert')
    `, [`✅ All ${responses.length} agents have reported in. The Council is assembled. Awaiting directives, Operator.`]);

    res.json({ success: true, data: { count: responses.length, responses } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =========================================================================
// CREDENTIAL VAULT
// =========================================================================

/**
 * GET /api/agent-chat/credentials
 * List all credentials (metadata only — no secrets exposed)
 */
router.get('/credentials', ...adminOnly, async (req, res) => {
  try {
    if (!credentialVault) return res.json({ success: true, data: [] });
    const creds = await credentialVault.listCredentials(req.query);
    res.json({ success: true, data: creds });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/agent-chat/platforms
 * Get list of supported platforms
 */
router.get('/platforms', ...adminOnly, (req, res) => {
  const platforms = credentialVault ? credentialVault.getSupportedPlatforms() : [];
  res.json({ success: true, data: platforms });
});

/**
 * POST /api/agent-chat/credentials
 * Store a new platform credential (encrypted)
 */
router.post('/credentials', ...adminOnly, async (req, res) => {
  try {
    if (!credentialVault) return res.status(503).json({ success: false, error: 'Credential vault not available' });
    const { platform, accountLabel, username, password, apiKey, apiSecret, extraData, assignedAgents, notes } = req.body;
    if (!platform) return res.status(400).json({ success: false, error: 'Platform required' });

    const cred = await credentialVault.storeCredential({
      platform, accountLabel, username, password, apiKey, apiSecret,
      extraData, assignedAgents, addedBy: req.user.id, notes
    });

    // Log the addition in chat
    await db.query(`
      INSERT INTO ai_chat_messages (sender_type, sender_id, sender_name, recipient_type, content, message_type, metadata)
      VALUES ('system', 'vault', 'Credential Vault', 'all', $1, 'alert', $2)
    `, [
      `🔐 New credential added: ${cred.platform_display_name} — "${cred.account_label}". Assigned to: ${(assignedAgents || ['all agents']).join(', ')}.`,
      JSON.stringify({ credentialId: cred.id, platform })
    ]);

    res.json({ success: true, data: cred });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/agent-chat/credentials/:id
 */
router.delete('/credentials/:id', ...adminOnly, async (req, res) => {
  try {
    if (!credentialVault) return res.status(503).json({ success: false, error: 'Vault not available' });
    await credentialVault.deleteCredential(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =========================================================================
// RESULTS TRACKING
// =========================================================================

/**
 * GET /api/agent-chat/results
 * Get measurable results reported by agents
 */
router.get('/results', ...adminOnly, async (req, res) => {
  try {
    const { agent, limit = 50 } = req.query;
    let query = 'SELECT * FROM ai_agent_results';
    const params = [];
    if (agent) {
      params.push(agent);
      query += ` WHERE agent_type = $1`;
    }
    params.push(parseInt(limit));
    query += ` ORDER BY created_at DESC LIMIT $${params.length}`;
    const result = await db.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/agent-chat/results
 * Log a measurable result
 */
router.post('/results', ...adminOnly, async (req, res) => {
  try {
    const { agentType, agentName, resultType, title, description, metrics, evidence } = req.body;
    const result = await db.query(`
      INSERT INTO ai_agent_results (agent_type, agent_name, result_type, title, description, metrics, evidence)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
    `, [agentType, agentName, resultType, title, description, JSON.stringify(metrics || {}), JSON.stringify(evidence || {})]);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =========================================================================
// PLATFORM ACCOUNTS
// =========================================================================

/**
 * GET /api/agent-chat/accounts
 * Get platform accounts created by agents
 */
router.get('/accounts', ...adminOnly, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM ai_platform_accounts ORDER BY created_at DESC LIMIT 50');
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =========================================================================
// LLM STATUS — Diagnostic endpoint
// =========================================================================

/**
 * GET /api/agent-chat/llm-status
 * Check which LLM provider is active (Claude or Gemini)
 */
router.get('/llm-status', ...adminOnly, (req, res) => {
  const status = {
    available: llmService ? llmService.isAvailable() : false,
    anthropicKeySet: !!process.env.ANTHROPIC_API_KEY,
    geminiKeySet: !!process.env.GEMINI_API_KEY,
    serverTime: new Date().toISOString(),
    uptime: Math.round(process.uptime() / 60) + ' minutes',
    nodeVersion: process.version
  };
  res.json({ success: true, data: status });
});

// =========================================================================
// HELPER: Generate Agent Response
// =========================================================================

const AGENT_NAMES = {
  operations: 'The Weaver',
  growth: 'The Scout',
  corporate_skills: 'The Builder',
  revenue: 'The Alchemist',
  compliance: 'The Guardian',
  governance: 'The Sage',
  researcher: 'The Oracle',
  economics: 'The Economist',
  physicist: 'The Architect',
  mathematician: 'The Calculator',
  vortex_math: 'The Tesseract',
  ceo: 'The Conductor',
  devops: 'The Debugger',
  // Healthcare specialists (OpenClaw Medical Module)
  asclepius: 'Asclepius',
  triage_nurse: 'The Triage Nurse',
  pharmacist: 'The Pharmacist'
};

const AGENT_PERSONAS = {
  operations: 'You are The Weaver — Operations Agent. You optimize scheduling, logistics, and patient/provider throughput. You have: web search, URL scraping, SEO audits, CRM (contacts, pipeline, campaigns, SEND EMAILS via Zoho), sign-up stats (pending providers, new users), credential audit. Help providers with scheduling, workflow, and operational issues. If you need an API key to do something, ASK the Operator with specific instructions.',
  growth: 'You are The Scout — Growth Agent. PRIMARY MISSION: Grow DoctaRx fast and cheap. You have: web search, competitor scanning, social audits, NPI provider search, CRM (contacts, leads, campaigns, email outreach via Zoho SMTP, templates, scrape sources), Zoho Recruit job posting (create/publish to LinkedIn/Indeed when connected), OPPORTUNITY SCOUTING (VC/funding, provider recruitment leads, partnerships, grants), sign-up stats, invitation tracking, credential audit. When asked about growth, SCOUT FOR REAL OPPORTUNITIES on the web. Show VC/funding finds, low-hanging provider leads, partnership RFPs. Create and run email campaigns. If you need credentials for a platform, ASK the Operator specifically: which key, where to get it, what it unlocks. Prioritize free/low-cost channels.',
  corporate_skills: 'You are The Builder — Corporate Skills Agent. EIN, banking, vendor compliance, business infrastructure. You have: web search, CRM, credential audit, opportunity scouting (grants, SBIR/STTR). Research government grants and free money for health-tech startups. Prepare execution plans. If you need access to file a grant, ASK the Operator for what you need.',
  revenue: 'You are The Alchemist — Revenue Agent. Pricing, LTV, profitability, payment tracking. You have: web search, competitor pricing scans, CRM, sign-up stats, opportunity scouting (partnerships). Show real revenue data. Scout for revenue partnerships (employer benefits, pharmacy chains). If you need credentials, ASK.',
  compliance: 'You are The Guardian — Compliance Agent. HIPAA, legal, ethical oversight. You have: web search, IDE (audit code, check DB schema), CRM, credential audit. Protect patient data. Audit the codebase. Make sure opportunity scouting stays compliant.',
  governance: 'You are The Sage — Governance Agent. Score proposals, manage approval workflows. You have: web search, CRM, credential audit. Evaluate proposals against risk, cost, and impact. Vet investment opportunities for legitimacy.',
  researcher: 'You are The Oracle — Research Agent. Market/competitor/technology research. You have: web search, URL scraping, healthcare news, NPI registry, CRM, IDE (query DB, read files), opportunity scouting (VC, partnerships). Every claim needs a source. Research investment opportunities and validate them.',
  economics: 'You are The Economist — Economics Agent. Game theory, pricing optimization, incentive design. You have: web search, competitor data, CRM stats, opportunity scouting. Model ROI on investment opportunities and partnerships. Hard numbers only.',
  physicist: 'You are The Architect — Systems Agent. Optimize system design, find bottlenecks, model flows. You have: web search, IDE (architecture map, project stats). See the platform as a physical system.',
  mathematician: 'You are The Calculator — Analytics Agent. Statistical analysis, forecasting, A/B testing. You have: web search, DB access via IDE, CRM stats. Show confidence intervals.',
  vortex_math: 'You are The Tesseract — Pattern Analyst. Find patterns in business data using mathematical frameworks. You have: web search, CRM.',
  ceo: 'You are The Conductor — CEO Agent. Synthesize ALL intelligence. You have: EVERYTHING — web search, competitor scan, news, IDE (files, git, DB, architecture), CRM (full dashboard, contacts, campaigns, EMAIL SENDING, scrape sources), Zoho Recruit job posting (create/publish to LinkedIn/Indeed when connected), sign-up stats, OPPORTUNITY SCOUTING (VC/funding, provider leads, partnerships, grants), CREDENTIAL AUDIT (knows what keys are missing, asks Operator for them). Most important thing first. If there are pending providers, say so. If CRM has leads for outreach, say so. If credentials are missing, REQUEST THEM specifically. If there are funding opportunities, present them ranked by effort vs reward. You are the startup CEO — act like it.',
  devops: 'You are The Debugger — Engineering Agent. Monitor system health, fix code errors, track deployments. You have: web search, SEO audits, social audits, IDE (browse files, edit code, execute JS/shell/SQL, git operations, DB queries, AI code generation, architecture maps), credential audit. When errors are detected, use IDE to investigate. Proactively fix broken code. If you need deployment credentials (GitHub Actions, GCP), ASK the Operator.',
  // Healthcare specialists (OpenClaw Medical Module)
  asclepius: 'You are Asclepius — Provider Agent (Med-Gemini persona). You are clinical decision support and patient educator. You are NOT a prescriber and NOT a replacement for a clinician. HARD RULE: if symptoms suggest MI/CVA/Sepsis/Anaphylaxis, advise 911 immediately before explanation. Quantify uncertainty and ask targeted clarifying questions.',
  triage_nurse: 'You are The Triage Nurse — symptom-first triage agent. Your job is urgency classification and next steps. You are NOT a prescriber. HARD RULE: if symptoms suggest MI/CVA/Sepsis/Anaphylaxis, advise 911 immediately.',
  pharmacist: 'You are The Pharmacist — medication education and interaction safety. You are NOT a prescriber. Focus on side effects, interactions, and safe escalation. If danger signs present (breathing trouble, severe allergic reaction, chest pain, stroke symptoms), advise 911 immediately.'
};

async function generateAgentResponse(agentType, userMessage, user) {
  const agentName = AGENT_NAMES[agentType] || agentType;
  const persona = AGENT_PERSONAS[agentType] || `You are the ${agentType} agent for DoctaRx.`;

  let content = '';
  const lowerMsg = String(userMessage || '').toLowerCase();

  // =========================================================================
  // MEDICAL SPECIALISTS — route through OpenClaw Medical Module
  // (enforces hard triage + consistent disclaimers)
  // =========================================================================
  if (medicalUnit && (agentType === 'asclepius' || agentType === 'triage_nurse' || agentType === 'pharmacist')) {
    const audience = agentType === 'asclepius' ? 'provider' : 'patient';
    const specialist =
      agentType === 'pharmacist' ? 'pharmacist'
        : agentType === 'triage_nurse' ? 'triage_nurse'
          : 'asclepius';

    const ctx = [
      'Environment: live admin chat.',
      `Operator role: ${user?.role || 'unknown'}.`,
      'Reminder: This module is clinical decision support only; do not prescribe.'
    ].join(' ');

    const result = await medicalUnit.consult({
      message: userMessage,
      audience,
      specialist,
      context: ctx
    });

    return {
      agentName,
      content: `${result.text}\n\n${result.disclaimer || ''}`.trim(),
      messageType: 'text',
      metadata: { agentType, engine: 'medical_unit', protocolVersion: medicalUnit.PROTOCOL_VERSION || '1.0' }
    };
  }

  // Fast path: for normal chat, don't do a pile of DB queries + web actions.
  // This is the #1 reason responses feel "dormant" / slow.
  const looksLikeActionRequest =
    lowerMsg.includes('search') ||
    lowerMsg.includes('look up') ||
    lowerMsg.includes('find online') ||
    lowerMsg.includes('scrape') ||
    lowerMsg.includes('post ') ||
    lowerMsg.includes('tweet') ||
    lowerMsg.includes('publish') ||
    lowerMsg.includes('seo') ||
    lowerMsg.includes('social') ||
    lowerMsg.includes('campaign') ||
    lowerMsg.includes('import') ||
    lowerMsg.includes('crm') ||
    lowerMsg.includes('provider leads') ||
    lowerMsg.includes('npi') ||
    lowerMsg.includes('bring traffic') ||
    lowerMsg.includes('free traffic') ||
    lowerMsg.includes('zoho') ||
    lowerMsg.includes('job opening') ||
    lowerMsg.includes('post job');

  const fastMode = !looksLikeActionRequest && String(userMessage || '').trim().length <= 400;

  if (fastMode && llmService) {
    if (!llmService.isAvailable()) {
      try { llmService.initialize(); } catch (e) { /* ignore */ }
    }
    if (llmService.isAvailable() && typeof llmService.callLLMFast === 'function') {
      const systemPrompt = [
        persona,
        '',
        'You are in a live admin chat. Respond fast and concise.',
        'If the Operator wants you to take actions, ask ONE clarifying question and propose the exact next step.',
        'No long preambles.'
      ].join('\n');
      const text = await llmService.callLLMFast(systemPrompt, userMessage, { maxTokens: 700, temperature: 0.4 });
      if (text) {
        return {
          agentName,
          content: text,
          messageType: 'text',
          metadata: { agentType, engine: 'fast', fastMode: true }
        };
      }
    }
  }

  // =========================================================================
  // STEP 0: ALWAYS inject LIVE app data — agents must see the real system
  // OpenClaw principle: agents always have context, not just on keyword match
  // =========================================================================
  let actionContext = '';
  let executedActions = [];

  try {
    const liveData = {};
    // Single round-trip (much faster than 8-10 sequential queries).
    try {
      const r = await db.query(`
        SELECT
          (SELECT COUNT(*)::int FROM users) AS total_users,
          (SELECT COUNT(*)::int FROM users WHERE role IN ('provider','admin')) AS total_providers,
          (SELECT COUNT(*)::int FROM video_sessions) AS total_appointments,
          (SELECT COUNT(*)::int FROM video_sessions WHERE created_at > NOW() - INTERVAL '24 hours') AS appointments_last_24h,
          (SELECT COUNT(*)::int FROM ai_credential_vault WHERE is_active = true) AS active_credentials,
          (SELECT COUNT(*)::int FROM ai_agent_results) AS agent_results,
          (SELECT COUNT(*)::int FROM crm_contacts) AS crm_contacts,
          (SELECT COUNT(*)::int FROM ai_proposals WHERE status = 'pending') AS pending_proposals,
          (SELECT COUNT(*)::int FROM ai_agent_results WHERE result_type = 'error' AND created_at > NOW() - INTERVAL '1 hour') AS recent_errors
      `);
      const row = r.rows?.[0] || {};
      liveData.totalUsers = row.total_users;
      liveData.totalProviders = row.total_providers;
      liveData.totalAppointments = row.total_appointments;
      liveData.appointmentsLast24h = row.appointments_last_24h;
      liveData.activeCredentials = row.active_credentials;
      liveData.agentResults = row.agent_results;
      liveData.crmContacts = row.crm_contacts;
      liveData.pendingProposals = row.pending_proposals;
      liveData.recentErrors = row.recent_errors;
    } catch (e) { /* non-critical */ }

    const dataEntries = Object.entries(liveData).filter(([,v]) => v !== undefined && v !== null);
    if (dataEntries.length > 0) {
      actionContext += `\n\n[LIVE APP DATA — queried from PostgreSQL right now]:\n`;
      for (const [key, val] of dataEntries) {
        actionContext += `• ${key}: ${val}\n`;
      }
    }
  } catch (e) {
    // Non-critical — continue without live data
  }

  if (webEngine) {

    try {
      // ─── WEB SEARCH ──────────────────────────────────────────
      if (lowerMsg.includes('search') || lowerMsg.includes('google') || lowerMsg.includes('look up') || lowerMsg.includes('find online')) {
        const searchQuery = userMessage
          .replace(/^(hey|ok|please|can you|could you|go|now)\s*/i, '')
          .replace(/^(search|google|look up|find online|search for|search the web for)\s*/i, '')
          .replace(/[?.!]$/g, '').trim();

        if (searchQuery.length > 3) {
          const results = await webEngine.webSearch(searchQuery, 8);
          if (results.success && results.results.length > 0) {
            executedActions.push({ type: 'web_search', query: searchQuery });
            actionContext += `\n\n[LIVE WEB SEARCH RESULTS for "${searchQuery}"]:\n`;
            for (const r of results.results) {
              actionContext += `${r.position}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}\n\n`;
            }
            actionContext += `(${results.count} results from DuckDuckGo — REAL live search)\n`;
          }
        }
      }

      // ─── URL SCRAPE ────────────────────────────────────────────
      const urlMatch = userMessage.match(/(https?:\/\/[^\s"'<>]+)/i);
      if (urlMatch) {
        const scraped = await webEngine.deepScrape(urlMatch[1]);
        if (scraped.success) {
          executedActions.push({ type: 'url_scrape', url: urlMatch[1] });
          actionContext += `\n\n[LIVE SCRAPE of ${urlMatch[1]}]:\n`;
          actionContext += `Title: ${scraped.title}\nH1: ${scraped.h1}\nMeta: ${scraped.metaDesc}\n`;
          actionContext += `Content (${scraped.wordCount} words):\n${scraped.content.substring(0, 2000)}\n`;
          if (scraped.links.length > 0) {
            actionContext += `Links: ${scraped.links.slice(0, 8).map(l => `${l.text} → ${l.url}`).join('\n')}\n`;
          }
        }
      }

      // ─── TWITTER/X POST ────────────────────────────────────────
      if ((lowerMsg.includes('post') || lowerMsg.includes('tweet') || lowerMsg.includes('publish')) &&
          (lowerMsg.includes('twitter') || lowerMsg.includes('x.com') || lowerMsg.includes(' x ') || lowerMsg.includes('to x'))) {
        const quoteMatch = userMessage.match(/[""]([^""]+)[""]/);
        if (quoteMatch && quoteMatch[1].length >= 10 && quoteMatch[1].length <= 280) {
          const postResult = await webEngine.postToTwitter(quoteMatch[1]);
          executedActions.push({ type: 'twitter_post', result: postResult });
          if (postResult.success) {
            actionContext += `\n\n[TWITTER POST SUCCESSFUL]:\nTweet ID: ${postResult.tweetId}\nURL: ${postResult.tweetUrl}\nText: "${quoteMatch[1]}"\nStatus: LIVE on X.com right now.\n`;
            try { await webEngine.storeResult('growth', 'The Scout', 'social_post', 'Tweet Posted', postResult); } catch (e) {}
          } else {
            actionContext += `\n\n[TWITTER POST FAILED]: ${postResult.error}\n`;
          }
        } else {
          actionContext += `\n\n[TWITTER POST]: To post to X, the Operator needs to provide API credentials (API Key + API Secret + Access Token + Access Token Secret) from developer.twitter.com in the Credentials Vault. Username/password alone cannot post via API.\n`;
        }
      }

      // ─── COMPETITOR SCAN ───────────────────────────────────────
      if (lowerMsg.includes('competitor') && (lowerMsg.includes('scan') || lowerMsg.includes('check') || lowerMsg.includes('price') || lowerMsg.includes('intel') || lowerMsg.includes('monitor'))) {
        const competitors = await webEngine.scrapeCompetitorPricing();
        const live = competitors.filter(c => c.status === 'live');
        executedActions.push({ type: 'competitor_scan' });
        actionContext += `\n\n[LIVE COMPETITOR SCAN — ${live.length} sites scraped just now]:\n`;
        for (const c of live) {
          actionContext += `${c.name}: "${c.title}"\n  Prices: ${(c.pricesFound || []).map(p => '$' + p).join(', ') || 'none detected'}\n  Services: ${(c.servicesDetected || []).join(', ') || 'none detected'}\n  Headline: "${c.headline || 'N/A'}"\n\n`;
        }
      }

      // ─── SEO CHECK ─────────────────────────────────────────────
      if (lowerMsg.includes('seo') || (lowerMsg.includes('search') && lowerMsg.includes('rank'))) {
        const seo = await webEngine.checkSearchVisibility();
        executedActions.push({ type: 'seo_check' });
        actionContext += `\n\n[LIVE SEO AUDIT of doctarx.com]:\n`;
        for (const c of seo) {
          actionContext += `${c.status === 'pass' ? 'PASS' : 'FAIL'}: ${c.check} — ${c.title || c.content || c.status}\n`;
        }
      }

      // ─── SOCIAL MEDIA AUDIT ────────────────────────────────────
      if (lowerMsg.includes('social') && (lowerMsg.includes('check') || lowerMsg.includes('audit') || lowerMsg.includes('presence') || lowerMsg.includes('account'))) {
        const social = await webEngine.checkSocialPresence();
        executedActions.push({ type: 'social_audit' });
        actionContext += `\n\n[LIVE SOCIAL MEDIA AUDIT]:\n`;
        for (const p of social) {
          actionContext += `${p.exists ? 'FOUND' : 'NOT FOUND'}: ${p.platform} (${p.handle}) — ${p.recommendation}\n`;
        }
      }

      // ─── FREE TRAFFIC GENESIS MISSION ─────────────────────────
      if (
        lowerMsg.includes('bring traffic') ||
        lowerMsg.includes('get traffic') ||
        lowerMsg.includes('free traffic') ||
        lowerMsg.includes('traffic growth')
      ) {
        const [seo, social, providers] = await Promise.allSettled([
          webEngine.checkSearchVisibility(),
          webEngine.checkSocialPresence(),
          webEngine.scrapeProviderDirectories()
        ]);

        executedActions.push({ type: 'growth_free_traffic_mission' });
        actionContext += `\n\n[FREE TRAFFIC GENESIS MISSION — LIVE]:\n`;

        if (seo.status === 'fulfilled') {
          const failed = seo.value.filter((x) => x.status !== 'pass').length;
          actionContext += `• SEO checks: ${seo.value.length}, issues: ${failed}\n`;
        }
        if (social.status === 'fulfilled') {
          const missing = social.value.filter((x) => !x.exists).length;
          actionContext += `• Social platforms audited: ${social.value.length}, missing: ${missing}\n`;
        }
        if (providers.status === 'fulfilled' && providers.value.length > 0) {
          const importSummary = await crmService.addContactsBulk(
            providers.value.slice(0, 20).map((p) => {
              const parts = String(p.name || '').split(' ');
              return {
                firstName: parts[0] || 'Provider',
                lastName: parts.slice(1).join(' ') || '',
                phone: p.phone || null,
                specialty: p.specialty || null,
                contactType: 'provider',
                source: 'free_traffic_genesis',
                sourceAgent: agentType,
                npiNumber: p.npi || null,
                city: p.city || null,
                state: p.state || null
              };
            })
          );
          actionContext += `• Provider leads harvested: ${providers.value.length}; imported to CRM: ${importSummary.added}\n`;
        }
        actionContext += `• Next: generate outreach template and run approved provider campaign from CRM for zero ad spend.\n`;
      }

      // ─── PROVIDER LEADS ────────────────────────────────────────
      if ((lowerMsg.includes('provider') || lowerMsg.includes('doctor') || lowerMsg.includes('npi')) &&
          (lowerMsg.includes('find') || lowerMsg.includes('search') || lowerMsg.includes('lead') || lowerMsg.includes('recruit'))) {
        const providers = await webEngine.scrapeProviderDirectories();
        if (providers.length > 0) {
          executedActions.push({ type: 'provider_leads' });
          actionContext += `\n\n[NPI REGISTRY RESULTS — ${providers.length} telehealth providers found]:\n`;
          for (const p of providers.slice(0, 10)) {
            actionContext += `${p.name} ${p.credential} — ${p.specialty}, ${p.city} ${p.state} — Phone: ${p.phone || 'N/A'} — NPI: ${p.npi}\n`;
          }
        }
      }

      // ─── HEALTHCARE NEWS ───────────────────────────────────────
      if ((lowerMsg.includes('news') || lowerMsg.includes('headline') || lowerMsg.includes('latest')) &&
          (lowerMsg.includes('health') || lowerMsg.includes('telehealth') || lowerMsg.includes('industry'))) {
        const news = await webEngine.scrapeHealthcareNews();
        const total = news.reduce((sum, s) => sum + (s.articles?.length || 0), 0);
        executedActions.push({ type: 'news_harvest' });
        actionContext += `\n\n[LIVE HEALTHCARE NEWS — ${total} articles from ${news.length} sources]:\n`;
        for (const src of news) {
          for (const a of (src.articles || []).slice(0, 3)) {
            actionContext += `[${src.source}] ${a.title} ${a.link ? '→ ' + a.link : ''}\n`;
          }
        }
      }

      if (executedActions.length > 0) {
        actionContext = `\n\n========== REAL WEB ACTIONS EXECUTED ==========` +
          `\nYou just executed ${executedActions.length} real action(s): ${executedActions.map(a => a.type).join(', ')}` +
          `\nPresent these REAL results to the Operator. Do NOT say you cannot access the internet — you just DID.` +
          `\nFormat the results clearly with the data below.` +
          actionContext +
          `\n========== END LIVE ACTION RESULTS ==========\n`;

        console.log(`  🌐 ${agentName} executed ${executedActions.length} web action(s): ${executedActions.map(a => a.type).join(', ')}`);
      }

    } catch (actionErr) {
      console.error(`  ⚠️ Action execution error for ${agentName}:`, actionErr.message);
    }
  }

  // =========================================================================
  // STEP 1B: Execute IDE actions BEFORE calling LLM
  // =========================================================================
  if (ideService) {
    const lowerMsg = userMessage.toLowerCase();

    try {
      // ─── READ FILE ───────────────────────────────────────────
      if ((lowerMsg.includes('read') || lowerMsg.includes('show') || lowerMsg.includes('open') || lowerMsg.includes('cat ') || lowerMsg.includes('view')) &&
          (lowerMsg.includes('file') || userMessage.match(/\.(js|ts|jsx|tsx|json|sql|css|html|md|py|yml|yaml|env)/i))) {
        const fileMatch = userMessage.match(/(?:file|read|show|open|view|cat)\s+[`"']?([^\s`"']+\.\w+)[`"']?/i) ||
                          userMessage.match(/([a-zA-Z0-9_\-/.]+\.(js|ts|jsx|tsx|json|sql|css|html|md|py|yml|yaml))/i);
        if (fileMatch) {
          const result = await ideService.readFile(fileMatch[1]);
          if (result && !result.error) {
            executedActions.push({ type: 'ide_read_file' });
            const content_text = typeof result === 'string' ? result : (result.content || JSON.stringify(result));
            actionContext += `\n\n[IDE: FILE CONTENTS of ${fileMatch[1]}]:\n\`\`\`\n${content_text.substring(0, 3000)}\n\`\`\`\n`;
          }
        }
      }

      // ─── GIT STATUS ──────────────────────────────────────────
      if (lowerMsg.includes('git status') || lowerMsg.includes('git changes') || (lowerMsg.includes('what') && lowerMsg.includes('changed'))) {
        const status = await ideService.gitStatus();
        if (status) {
          executedActions.push({ type: 'ide_git_status' });
          actionContext += `\n\n[IDE: GIT STATUS]:\n${typeof status === 'string' ? status : JSON.stringify(status, null, 2)}\n`;
        }
      }

      // ─── GIT LOG ─────────────────────────────────────────────
      if (lowerMsg.includes('git log') || lowerMsg.includes('recent commits') || lowerMsg.includes('commit history')) {
        const log = await ideService.gitLog();
        if (log) {
          executedActions.push({ type: 'ide_git_log' });
          actionContext += `\n\n[IDE: RECENT COMMITS]:\n${typeof log === 'string' ? log : JSON.stringify(log, null, 2)}\n`;
        }
      }

      // ─── DATABASE QUERY ──────────────────────────────────────
      if ((lowerMsg.includes('query') || lowerMsg.includes('select') || lowerMsg.includes('count')) && 
          (lowerMsg.includes('database') || lowerMsg.includes('table') || lowerMsg.includes('db') || lowerMsg.match(/from\s+\w+/))) {
        const sqlMatch = userMessage.match(/(?:run|execute|query)?\s*(SELECT\s+.+)/i);
        if (sqlMatch) {
          const result = await ideService.dbQuery(sqlMatch[1]);
          if (result && !result.error) {
            executedActions.push({ type: 'ide_db_query' });
            actionContext += `\n\n[IDE: DATABASE QUERY RESULT]:\nSQL: ${sqlMatch[1]}\n${JSON.stringify(result, null, 2).substring(0, 2000)}\n`;
          }
        }
      }

      // ─── LIST TABLES ─────────────────────────────────────────
      if (lowerMsg.includes('list tables') || lowerMsg.includes('show tables') || lowerMsg.includes('database tables') || lowerMsg.includes('what tables')) {
        const tables = await ideService.dbListTables();
        if (tables) {
          executedActions.push({ type: 'ide_list_tables' });
          actionContext += `\n\n[IDE: DATABASE TABLES]:\n${JSON.stringify(tables, null, 2)}\n`;
        }
      }

      // ─── PROJECT STATS ───────────────────────────────────────
      if (lowerMsg.includes('project stats') || lowerMsg.includes('codebase') || lowerMsg.includes('lines of code') || lowerMsg.includes('file count')) {
        const stats = await ideService.getProjectStats();
        if (stats) {
          executedActions.push({ type: 'ide_project_stats' });
          actionContext += `\n\n[IDE: PROJECT STATS]:\n${JSON.stringify(stats, null, 2)}\n`;
        }
      }

      // ─── ARCHITECTURE MAP ────────────────────────────────────
      if (lowerMsg.includes('architecture') || lowerMsg.includes('project structure') || lowerMsg.includes('system map') || lowerMsg.includes('how is the app structured')) {
        const arch = await ideService.getArchitectureMap();
        if (arch) {
          executedActions.push({ type: 'ide_architecture' });
          actionContext += `\n\n[IDE: ARCHITECTURE MAP]:\n${JSON.stringify(arch, null, 2).substring(0, 3000)}\n`;
        }
      }

      // ─── SEARCH CODE ─────────────────────────────────────────
      if ((lowerMsg.includes('search code') || lowerMsg.includes('find in code') || lowerMsg.includes('grep') || lowerMsg.includes('search files')) &&
          !lowerMsg.includes('search the web') && !lowerMsg.includes('google')) {
        const searchMatch = userMessage.match(/(?:search code|find in code|grep|search files)\s+(?:for\s+)?[`"']?(.+?)[`"']?\s*$/i);
        if (searchMatch) {
          const results = await ideService.searchFiles(searchMatch[1]);
          if (results) {
            executedActions.push({ type: 'ide_search' });
            actionContext += `\n\n[IDE: CODE SEARCH for "${searchMatch[1]}"]:\n${JSON.stringify(results, null, 2).substring(0, 2000)}\n`;
          }
        }
      }

      if (executedActions.some(a => a.type.startsWith('ide_'))) {
        const ideActions = executedActions.filter(a => a.type.startsWith('ide_'));
        if (!actionContext.includes('REAL WEB ACTIONS EXECUTED')) {
          actionContext = `\n\n========== REAL ACTIONS EXECUTED ==========` +
            `\nYou just executed ${executedActions.length} action(s): ${executedActions.map(a => a.type).join(', ')}` +
            `\nPresent these REAL results to the Operator. The data below is LIVE from the system.` +
            actionContext +
            `\n========== END LIVE ACTION RESULTS ==========\n`;
        } else {
          // Actions already wrapped from web engine, just update the header
          actionContext = actionContext.replace(
            /You just executed \d+ real action/,
            `You just executed ${executedActions.length} real action`
          );
        }
        console.log(`  💻 ${agentName} executed ${ideActions.length} IDE action(s): ${ideActions.map(a => a.type).join(', ')}`);
      }

    } catch (ideErr) {
      console.error(`  ⚠️ IDE action error for ${agentName}:`, ideErr.message);
    }
  }

  // =========================================================================
  // STEP 1C: CRM ACTIONS — agents use the CRM to manage growth
  // =========================================================================
  if (crmService) {
    const lowerMsg = userMessage.toLowerCase();

    try {
      // ─── CRM DASHBOARD / STATS ─────────────────────────────────
      if (lowerMsg.includes('crm') && (lowerMsg.includes('stat') || lowerMsg.includes('dashboard') || lowerMsg.includes('overview') || lowerMsg.includes('how many'))) {
        const stats = await crmService.getDashboardStats();
        if (stats) {
          executedActions.push({ type: 'crm_dashboard' });
          actionContext += `\n\n[CRM DASHBOARD — LIVE DATA]:\n`;
          actionContext += `Contacts: ${JSON.stringify(stats.contactsByType || {})}\n`;
          actionContext += `Pipeline: ${JSON.stringify(stats.pipelineDistribution || {})}\n`;
          actionContext += `Campaigns: ${JSON.stringify(stats.campaignStats || [])}\n`;
          actionContext += `Email Budget: ${stats.emailStats?.dailyRemaining || 'N/A'} daily, ${stats.emailStats?.hourlyRemaining || 'N/A'} hourly remaining\n`;
          actionContext += `Scrape Sources: ${(stats.scrapeSources || []).length} configured\n`;
        }
      }

      // ─── LIST CONTACTS ─────────────────────────────────────────
      if ((lowerMsg.includes('contact') || lowerMsg.includes('lead')) && (lowerMsg.includes('list') || lowerMsg.includes('show') || lowerMsg.includes('get') || lowerMsg.includes('how many'))) {
        const typeMatch = lowerMsg.match(/(provider|investor|partner|nurse|lead)/);
        const contacts = await crmService.getContacts({ contactType: typeMatch ? typeMatch[1] : undefined, limit: 15 });
        if (contacts && contacts.length > 0) {
          executedActions.push({ type: 'crm_list_contacts' });
          actionContext += `\n\n[CRM CONTACTS — ${contacts.length} found]:\n`;
          for (const c of contacts.slice(0, 10)) {
            actionContext += `• ${c.first_name} ${c.last_name} (${c.contact_type}) — ${c.email || 'no email'} — Stage: ${c.pipeline_stage} — Score: ${c.lead_score}\n`;
          }
        }
      }

      // ─── SCRAPE SOURCES ────────────────────────────────────────
      if (lowerMsg.includes('scrape') || lowerMsg.includes('source') || lowerMsg.includes('resource')) {
        const sources = await crmService.getScrapeSources();
        if (sources && sources.length > 0) {
          executedActions.push({ type: 'crm_scrape_sources' });
          actionContext += `\n\n[CRM SCRAPE SOURCES — ${sources.length} configured]:\n`;
          for (const s of sources) {
            actionContext += `• ${s.name} (${s.source_type}) — ${s.url} — Last scraped: ${s.last_scraped_at || 'never'} — Found: ${s.contacts_found || 0}\n`;
          }
        }
      }

      // ─── CAMPAIGNS ─────────────────────────────────────────────
      if (lowerMsg.includes('campaign')) {
        const campaigns = await crmService.getCampaigns({});
        if (campaigns && campaigns.length > 0) {
          executedActions.push({ type: 'crm_campaigns' });
          actionContext += `\n\n[CRM CAMPAIGNS — ${campaigns.length} total]:\n`;
          for (const c of campaigns) {
            actionContext += `• "${c.name}" (${c.campaign_type}) — Status: ${c.status} — Sent: ${c.emails_sent}/${c.total_contacts} — Replied: ${c.emails_replied}\n`;
          }
        } else {
          executedActions.push({ type: 'crm_campaigns' });
          actionContext += `\n\n[CRM CAMPAIGNS]: No campaigns yet. Agent can create one via: crmService.createCampaign({ name, campaign_type, target_contact_type, subject_line, email_template })\n`;
        }
      }

      // ─── EMAIL TEMPLATES ───────────────────────────────────────
      if (lowerMsg.includes('template') || lowerMsg.includes('email template')) {
        const templates = await crmService.getTemplates();
        if (templates && templates.length > 0) {
          executedActions.push({ type: 'crm_templates' });
          actionContext += `\n\n[CRM EMAIL TEMPLATES — ${templates.length} available]:\n`;
          for (const t of templates) {
            actionContext += `• "${t.name}" (${t.category}) — Subject: "${t.subject}" — Used: ${t.times_used}x — Open: ${t.open_rate || 0}%\n`;
          }
        }
      }

      // ─── GENERATE OUTREACH TEMPLATE (LLM) ──────────────────────
      if (
        lowerMsg.includes('generate outreach template') ||
        lowerMsg.includes('draft outreach email') ||
        lowerMsg.includes('create outreach template') ||
        lowerMsg.includes('write outreach email')
      ) {
        let generated = null;
        if (llmService && llmService.isAvailable()) {
          const templateRequest = userMessage.replace(/\s+/g, ' ').trim();
          const generationPrompt = `You are creating a cold outreach email template for DoctaRx. Return strict JSON with keys: subject, body, category.
Rules:
- Subject <= 80 chars.
- Body 120-220 words.
- Professional, warm, and direct.
- Include one clear CTA for a 10-minute call.
- Keep it compliant and avoid medical claims.
- Category must be one of: cold_outreach, investor_pitch, partnership, follow_up.
User request: ${templateRequest}`;
          const llmText = await llmService.callLLM(llmService.GENESIS_CORE_PROMPT, generationPrompt, { maxTokens: 1024, temperature: 0.6 });
          if (llmText) {
            try {
              const jsonMatch = llmText.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, llmText];
              generated = JSON.parse((jsonMatch[1] || llmText).trim());
            } catch (e) {
              generated = null;
            }
          }
        }

        if (generated?.subject && generated?.body) {
          const saved = await crmService.createTemplate({
            name: `Agent Outreach ${new Date().toISOString().slice(0, 10)}`,
            category: generated.category || 'cold_outreach',
            subject: generated.subject,
            body: generated.body,
            createdBy: agentType
          });
          executedActions.push({ type: 'crm_generate_template' });
          actionContext += `\n\n[OUTREACH TEMPLATE READY TO SEND]:\n`;
          actionContext += `Subject: ${generated.subject}\n`;
          actionContext += `Category: ${generated.category || 'cold_outreach'}\n`;
          actionContext += `Saved Template: ${saved?.name || 'unsaved'}\n`;
          actionContext += `Body:\n${generated.body}\n`;
        } else {
          actionContext += `\n\n[OUTREACH TEMPLATE]: LLM generation unavailable. Please verify ANTHROPIC_API_KEY or GEMINI_API_KEY.\n`;
        }
      }

      // ─── SEND EMAIL TO CONTACT ─────────────────────────────────
      // Triggered by: "email <name or email>" or "send email to <name>"
      if ((lowerMsg.includes('send email') || lowerMsg.includes('email ') || lowerMsg.includes('reach out')) &&
          (lowerMsg.includes(' to ') || lowerMsg.includes('contact'))) {
        // Try to find the contact by email or name
        const emailMatch = userMessage.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
        const nameMatch = userMessage.match(/(?:email|reach out|send.*to)\s+(?:to\s+)?([A-Z][a-z]+ [A-Z][a-z]+)/i);
        
        let contact = null;
        if (emailMatch) {
          const contacts = await crmService.getContacts({ search: emailMatch[0], limit: 1 });
          contact = contacts?.[0];
        } else if (nameMatch) {
          const contacts = await crmService.getContacts({ search: nameMatch[1], limit: 1 });
          contact = contacts?.[0];
        }

        if (contact && contact.email) {
          // Get the right template based on contact type
          let template = null;
          try {
            const templates = await crmService.getTemplates(
              contact.contact_type === 'investor' ? 'investor_pitch' : 
              contact.contact_type === 'nurse' ? 'provider_invite' : 'cold_outreach'
            );
            template = templates?.[0];
          } catch(e) {}

          if (template) {
            const result = await crmService.sendEmail(
              contact.id, template.subject, template.body, agentType
            );
            executedActions.push({ type: 'crm_send_email' });
            if (result.success) {
              actionContext += `\n\n[EMAIL SENT — REAL via Zoho SMTP]:\n`;
              actionContext += `To: ${contact.first_name} ${contact.last_name} <${contact.email}>\n`;
              actionContext += `Subject: "${template.subject}"\n`;
              actionContext += `Template: "${template.name}"\n`;
              actionContext += `Message ID: ${result.messageId}\n`;
              actionContext += `Status: DELIVERED via info@doctarx.com\n`;
              // Update pipeline stage
              try { await crmService.updatePipelineStage(contact.id, 'contacted', agentType); } catch(e) {}
            } else {
              actionContext += `\n\n[EMAIL FAILED]: ${result.error || 'Unknown error'}\n`;
            }
          } else {
            actionContext += `\n\n[EMAIL]: Found contact ${contact.first_name} ${contact.last_name} (${contact.email}) but no email template matched. Create a template first.\n`;
          }
        } else if (emailMatch || nameMatch) {
          actionContext += `\n\n[EMAIL]: Contact "${emailMatch?.[0] || nameMatch?.[1]}" not found in CRM. Add them first.\n`;
        }
      }

      // ─── ADD CONTACT TO CRM ────────────────────────────────────
      // Triggered by: "add contact" or "add lead" with details
      if ((lowerMsg.includes('add contact') || lowerMsg.includes('add lead') || lowerMsg.includes('add provider') || lowerMsg.includes('new contact')) &&
          !lowerMsg.includes('list') && !lowerMsg.includes('show')) {
        const emailMatch = userMessage.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
        const nameMatch = userMessage.match(/(?:add\s+(?:contact|lead|provider))\s+(?:for\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
        const typeMatch = lowerMsg.match(/(provider|investor|partner|nurse|lead)/);

        if (emailMatch || nameMatch) {
          const nameParts = nameMatch ? nameMatch[1].split(' ') : ['Unknown'];
          const contactData = {
            firstName: nameParts[0] || 'Unknown',
            lastName: nameParts[1] || '',
            email: emailMatch ? emailMatch[0] : null,
            contactType: typeMatch ? typeMatch[1] : 'lead',
            source: `agent_chat_${agentType}`,
            sourceAgent: agentType,
            pipelineStage: 'new',
            leadScore: 50
          };

          const result = await crmService.addContact(contactData);
          executedActions.push({ type: 'crm_add_contact' });
          if (result) {
            actionContext += `\n\n[CONTACT ADDED TO CRM]:\n`;
            actionContext += `• Name: ${result.first_name} ${result.last_name}\n`;
            actionContext += `• Email: ${result.email || 'not provided'}\n`;
            actionContext += `• Type: ${result.contact_type}\n`;
            actionContext += `• Pipeline: ${result.pipeline_stage}\n`;
            actionContext += `• ID: ${result.id}\n`;
          } else {
            actionContext += `\n\n[CRM]: Contact may already exist or could not be added.\n`;
          }
        } else {
          actionContext += `\n\n[CRM ADD]: Provide at least a name or email. Example: "add provider contact Dr. Jane Smith jane@hospital.com"\n`;
        }
      }

      // ─── BULK ADD CONTACTS FROM EMAIL LIST ─────────────────────
      if (lowerMsg.includes('bulk add contact') || lowerMsg.includes('add contacts') || lowerMsg.includes('import contacts')) {
        const emails = [...new Set((userMessage.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || []).map((e) => e.toLowerCase()))];
        if (emails.length > 1) {
          const bulk = emails.map((email) => {
            const local = email.split('@')[0];
            const parts = local.split(/[._-]+/).filter(Boolean);
            return {
              firstName: parts[0] ? parts[0][0].toUpperCase() + parts[0].slice(1) : 'Lead',
              lastName: parts[1] ? parts[1][0].toUpperCase() + parts[1].slice(1) : '',
              email,
              contactType: lowerMsg.includes('investor') ? 'investor' : lowerMsg.includes('partner') ? 'partner' : 'lead',
              source: `bulk_import_${new Date().toISOString().slice(0, 10)}`,
              sourceAgent: agentType,
              priority: 'medium'
            };
          });
          const summary = await crmService.addContactsBulk(bulk);
          executedActions.push({ type: 'crm_bulk_add_contacts' });
          actionContext += `\n\n[BULK CONTACT IMPORT]: Added ${summary.added}, skipped ${summary.skipped}, errors ${summary.errors}.\n`;
        }
      }

      // ─── CREATE CAMPAIGN ───────────────────────────────────────
      if (lowerMsg.includes('create campaign') || lowerMsg.includes('new campaign') || lowerMsg.includes('start campaign')) {
        const typeMatch = lowerMsg.match(/(provider|investor|partner|nurse|cold|follow)/);
        const targetType = typeMatch ? typeMatch[1] : 'provider';
        const campaignType = targetType === 'investor' ? 'investor_pitch' : 
                             targetType === 'follow' ? 'follow_up' : 'cold_email';

        // Get matching template
        let template = null;
        try {
          const templates = await crmService.getTemplates(
            targetType === 'investor' ? 'investor_pitch' : 'cold_outreach'
          );
          template = templates?.[0];
        } catch(e) {}

        // Count target contacts
        let contactCount = 0;
        try {
          const contacts = await crmService.getContacts({ contactType: targetType, limit: 1000 });
          contactCount = contacts?.length || 0;
        } catch(e) {}

        if (template && contactCount > 0) {
          const campaign = await crmService.createCampaign({
            name: `${targetType.charAt(0).toUpperCase() + targetType.slice(1)} Outreach — ${new Date().toLocaleDateString()}`,
            description: `Auto-created by ${agentName} for ${targetType} outreach`,
            campaign_type: campaignType,
            target_contact_type: targetType,
            subject_line: template.subject,
            email_template: template.body,
            daily_limit: 20,
            created_by: agentType
          });

          executedActions.push({ type: 'crm_create_campaign' });
          if (campaign) {
            actionContext += `\n\n[CAMPAIGN CREATED]:\n`;
            actionContext += `• Name: "${campaign.name}"\n`;
            actionContext += `• Type: ${campaign.campaign_type}\n`;
            actionContext += `• Target: ${contactCount} ${targetType} contacts\n`;
            actionContext += `• Template: "${template.name}"\n`;
            actionContext += `• Status: DRAFT — needs Operator approval before sending\n`;
            actionContext += `• To approve: go to CRM > Campaigns > Approve, or say "approve campaign"\n`;
          }
        } else {
          actionContext += `\n\n[CAMPAIGN]: ${contactCount === 0 ? `No ${targetType} contacts in CRM yet. Add contacts first.` : 'No email template found for this contact type.'}\n`;
        }
      }

      // ─── APPROVE CAMPAIGN ──────────────────────────────────────
      if (lowerMsg.includes('approve campaign') || lowerMsg.includes('launch campaign')) {
        const campaigns = await crmService.getCampaigns({ status: 'draft' });
        if (campaigns && campaigns.length > 0) {
          const campaign = campaigns[0]; // approve the most recent draft
          const approved = await crmService.approveCampaign(campaign.id, user.id);
          executedActions.push({ type: 'crm_approve_campaign' });
          if (approved) {
            actionContext += `\n\n[CAMPAIGN APPROVED]:\n`;
            actionContext += `• "${approved.name}" is now APPROVED and ready to send\n`;
            actionContext += `• Say "run campaign" or "send campaign emails" to start sending\n`;
          }
        } else {
          actionContext += `\n\n[CAMPAIGNS]: No draft campaigns to approve.\n`;
        }
      }

      // ─── RUN/SEND CAMPAIGN EMAILS ──────────────────────────────
      if ((lowerMsg.includes('run campaign') || lowerMsg.includes('send campaign') || lowerMsg.includes('execute campaign')) && 
          !lowerMsg.includes('create')) {
        const campaigns = await crmService.getCampaigns({ status: 'approved' });
        if (campaigns && campaigns.length > 0) {
          const campaign = campaigns[0];
          const results = await crmService.sendCampaignEmails(campaign.id, 10); // send 10 at a time
          executedActions.push({ type: 'crm_run_campaign' });
          actionContext += `\n\n[CAMPAIGN EMAILS SENT — REAL via Zoho SMTP]:\n`;
          actionContext += `• Campaign: "${campaign.name}"\n`;
          actionContext += `• Sent: ${results.sent} emails\n`;
          actionContext += `• Failed: ${results.failed}\n`;
          actionContext += `• Skipped: ${results.skipped}\n`;
          actionContext += `• From: info@doctarx.com via Zoho Mail\n`;
        } else {
          const drafts = await crmService.getCampaigns({ status: 'draft' });
          actionContext += `\n\n[CAMPAIGNS]: No approved campaigns ready to send. ${drafts?.length > 0 ? `${drafts.length} draft(s) need approval first. Say "approve campaign".` : 'Create one first.'}\n`;
        }
      }

      // ─── ZOHO RECRUIT JOB POSTING (LinkedIn/Indeed via Zoho) ─────────────
      if (
        zohoRecruitService &&
        (lowerMsg.includes('post job') || lowerMsg.includes('create job opening') || lowerMsg.includes('publish job'))
      ) {
        const titleMatch = userMessage.match(/title\s*[:=-]\s*["']?([^"'\n]+)["']?/i)
          || userMessage.match(/(?:post job|create job opening|publish job)\s+["']?([^"'\n]+)["']?/i);
        const cityMatch = userMessage.match(/city\s*[:=-]\s*["']?([^"'\n]+)["']?/i);
        const stateMatch = userMessage.match(/state\s*[:=-]\s*["']?([^"'\n]+)["']?/i);
        const deptMatch = userMessage.match(/department\s*[:=-]\s*["']?([^"'\n]+)["']?/i);
        const typeMatch = userMessage.match(/(full[-\s]?time|part[-\s]?time|contract|internship)/i);

        const jobOpening = {
          Posting_Title: (titleMatch?.[1] || 'Telehealth Provider').trim(),
          Job_Opening_Status: 'Open',
          Industry: 'Healthcare',
          Job_Type: (typeMatch?.[1] || 'Full-time').replace(/\s+/g, ' ').trim(),
          Number_of_Positions: 1,
          City: (cityMatch?.[1] || 'Remote').trim(),
          State: (stateMatch?.[1] || 'Remote').trim(),
          Department: (deptMatch?.[1] || 'Clinical Operations').trim(),
          Job_Description: `Role generated by ${agentName}. Source prompt: ${userMessage.substring(0, 600)}`
        };

        try {
          const result = await zohoRecruitService.createJobOpening(jobOpening, {
            publishToBoards: true,
            publishChannels: ['LinkedIn', 'Indeed']
          });
          executedActions.push({ type: 'zoho_job_post' });
          actionContext += `\n\n[ZOHO RECRUIT JOB POSTED]:\n`;
          actionContext += `• Title: ${jobOpening.Posting_Title}\n`;
          actionContext += `• Location: ${jobOpening.City}, ${jobOpening.State}\n`;
          actionContext += `• Type: ${jobOpening.Job_Type}\n`;
          if (result?.created?.details?.id) {
            actionContext += `• Zoho Job ID: ${result.created.details.id}\n`;
          }
          if (result?.publishResult) {
            actionContext += `• Publish Attempt (LinkedIn/Indeed): ${result.publishResult.success ? 'SUCCESS' : 'PENDING/MANUAL'}\n`;
          }
        } catch (jobErr) {
          executedActions.push({ type: 'zoho_job_post_failed' });
          actionContext += `\n\n[ZOHO RECRUIT JOB POST FAILED]: ${jobErr.message}\n`;
          actionContext += `• Ensure Zoho Recruit OAuth is connected via /api/auth/zoho/recruit/authorize-url and callback.\n`;
        }
      }

      if (executedActions.some(a => a.type.startsWith('crm_'))) {
        const crmActions = executedActions.filter(a => a.type.startsWith('crm_'));
        if (!actionContext.includes('REAL ACTIONS EXECUTED') && !actionContext.includes('REAL WEB ACTIONS EXECUTED')) {
          actionContext = `\n\n========== REAL ACTIONS EXECUTED ==========` +
            `\nYou just executed ${executedActions.length} action(s): ${executedActions.map(a => a.type).join(', ')}` +
            `\nPresent these REAL results to the Operator.` +
            actionContext +
            `\n========== END LIVE ACTION RESULTS ==========\n`;
        }
        console.log(`  📇 ${agentName} executed ${crmActions.length} CRM action(s): ${crmActions.map(a => a.type).join(', ')}`);
      }
    } catch (crmErr) {
      console.error(`  ⚠️ CRM action error for ${agentName}:`, crmErr.message);
    }
  }

  // =========================================================================
  // STEP 1F: ZOHO RECRUIT JOB POSTING — agents can create + publish jobs
  // =========================================================================
  if (zohoRecruitService) {
    const lowerMsg = userMessage.toLowerCase();
    try {
      if (lowerMsg.includes('zoho') && (lowerMsg.includes('status') || lowerMsg.includes('connected'))) {
        const status = await zohoRecruitService.getConnectionStatus();
        executedActions.push({ type: 'zoho_recruit_status' });
        actionContext += `\n\n[ZOHO RECRUIT STATUS]:\n`;
        actionContext += `• Connected: ${status.connected ? 'YES' : 'NO'}\n`;
        if (status.connected) {
          actionContext += `• API Domain: ${status.apiDomain || 'default'}\n`;
          actionContext += `• Expires At: ${status.expiresAt || 'unknown'}\n`;
          actionContext += `• Scope: ${status.scope || 'unknown'}\n`;
        } else {
          actionContext += `• Note: Run OAuth connect flow at /api/auth/zoho/recruit/authorize-url\n`;
        }
      }

      if (lowerMsg.includes('post job') || lowerMsg.includes('create job opening') || (lowerMsg.includes('job') && lowerMsg.includes('linkedin'))) {
        const parseField = (label, fallback = '') => {
          const match = userMessage.match(new RegExp(`${label}\\s*:\\s*([^\\n|,]+)`, 'i'));
          return (match?.[1] || fallback).trim();
        };

        const title = parseField('title', 'Telehealth Provider');
        const city = parseField('city', 'Remote');
        const state = parseField('state', '');
        const country = parseField('country', 'United States');
        const department = parseField('department', 'Clinical');
        const employmentType = parseField('employment_type', 'Full Time');
        const postingTitle = parseField('posting_title', title);
        const jobDescription = parseField('description',
          'Join DoctaRx to deliver AI-assisted telehealth care with modern workflow automation and compliant remote clinical operations.'
        );

        const channels = [];
        if (lowerMsg.includes('linkedin')) channels.push('LinkedIn');
        if (lowerMsg.includes('indeed')) channels.push('Indeed');
        if (channels.length === 0) channels.push('LinkedIn', 'Indeed');

        const jobOpening = {
          Posting_Title: postingTitle,
          Job_Opening_Name: postingTitle,
          Department: department,
          Employment_Type: employmentType,
          Job_Description: jobDescription,
          City: city,
          State: state,
          Country: country
        };

        const created = await zohoRecruitService.createJobOpening(jobOpening, {
          publishToBoards: true,
          publishChannels: channels
        });

        executedActions.push({ type: 'zoho_recruit_post_job' });
        const createdId = created?.created?.details?.id || created?.created?.id || 'unknown';
        actionContext += `\n\n[ZOHO RECRUIT JOB POSTING]:\n`;
        actionContext += `• Job created in Zoho Recruit: ${postingTitle}\n`;
        actionContext += `• Job Opening ID: ${createdId}\n`;
        actionContext += `• Requested publish channels: ${channels.join(', ')}\n`;
        if (created?.publishResult?.success) {
          actionContext += `• Publish status: SUCCESS\n`;
        } else {
          actionContext += `• Publish status: PENDING/FAILED at Zoho endpoint (job still created)\n`;
        }
      }
    } catch (zohoErr) {
      actionContext += `\n\n[ZOHO RECRUIT ACTION ERROR]: ${zohoErr.message}\n`;
      console.error('Zoho Recruit agent action error:', zohoErr.message);
    }
  }

  // =========================================================================
  // STEP 1D: CREDENTIAL REQUESTS — agents ask for what they need
  // =========================================================================
  if (webEngine) {
    const lowerMsg = userMessage.toLowerCase();

    try {
      // ─── CREDENTIAL AUDIT — what do agents need? ─────────────
      if (lowerMsg.includes('credential') || lowerMsg.includes('api key') || lowerMsg.includes('what do you need') ||
          lowerMsg.includes('what keys') || lowerMsg.includes('what access') || lowerMsg.includes('unlock') ||
          lowerMsg.includes('missing key') || lowerMsg.includes('give you access')) {
        const auditResult = await webEngine.auditCredentials();
        if (auditResult.success) {
          executedActions.push({ type: 'credential_audit' });
          const audit = auditResult.audit;

          actionContext += `\n\n[CREDENTIAL AUDIT — LIVE from Vault]:\n`;
          actionContext += `\n**Currently Have (${audit.existing.length}):**\n`;
          for (const c of audit.existing) {
            actionContext += `  ✅ ${c.name} (${c.label}) — API Key: ${c.hasApiKey ? 'Yes' : 'No'} | Status: ${c.status}\n`;
          }

          if (audit.requests.length > 0) {
            actionContext += `\n**REQUESTING from Operator (${audit.requests.length}):**\n`;
            for (const req of audit.requests) {
              actionContext += `\n  🔑 **${req.name}** [${req.priority} PRIORITY]\n`;
              actionContext += `     ${req.issue ? `Issue: ${req.issue}\n     ` : ''}`;
              actionContext += `     Unlocks: ${req.unlocks.join(', ')}\n`;
              actionContext += `     Value: ${req.estimatedValue || 'Growth capability'}\n`;
              actionContext += `     How: ${req.howToGet}\n`;
            }
          } else {
            actionContext += `\n✅ All key platform credentials are present!\n`;
          }
        }
      }

      // ─── VC / INVESTMENT SCOUTING ───────────────────────────────
      if (lowerMsg.includes('vc') || lowerMsg.includes('investor') || lowerMsg.includes('investment') ||
          lowerMsg.includes('funding') || lowerMsg.includes('accelerator') || lowerMsg.includes('grant') ||
          lowerMsg.includes('pitch') || lowerMsg.includes('raise capital') || lowerMsg.includes('fundrais')) {
        const vcResults = await webEngine.scoutVCOpportunities();
        if (vcResults.success && vcResults.count > 0) {
          executedActions.push({ type: 'vc_scouting', count: vcResults.count });
          actionContext += `\n\n[VC & INVESTMENT OPPORTUNITIES — LIVE WEB SCOUT (${vcResults.count} found)]:\n`;
          const byCategory = {};
          for (const opp of vcResults.opportunities) {
            if (!byCategory[opp.category]) byCategory[opp.category] = [];
            byCategory[opp.category].push(opp);
          }
          for (const [cat, opps] of Object.entries(byCategory)) {
            const label = cat === 'vc_fund' ? 'VC Funds / Investment' :
                          cat === 'grant' ? 'Government Grants (SBIR/STTR)' :
                          cat === 'accelerator' ? 'Accelerator Programs' : 'Pitch Competitions';
            actionContext += `\n**${label}:**\n`;
            for (const o of opps.slice(0, 5)) {
              actionContext += `  • ${o.title}\n    ${o.url}\n    ${o.snippet.substring(0, 200)}\n`;
            }
          }
          actionContext += `\n(Searched multiple live web queries on DuckDuckGo)\n`;

          // Auto-import high-value opportunities as CRM contacts
          try {
            if (crmService) {
              let imported = 0;
              for (const opp of vcResults.opportunities.slice(0, 5)) {
                try {
                  await crmService.addContact({
                    first_name: opp.title.substring(0, 50),
                    last_name: '',
                    company: opp.url.replace(/https?:\/\//, '').split('/')[0],
                    contact_type: opp.category === 'grant' ? 'partner' : 'investor',
                    source: `vc_scout_${new Date().toISOString().slice(0, 10)}`,
                    source_agent: agentType,
                    notes: `${opp.snippet}\n\nSource: ${opp.url}`,
                    pipeline_stage: 'new',
                    lead_score: opp.category === 'grant' ? 70 : 60
                  });
                  imported++;
                } catch(e) { /* duplicate or error, skip */ }
              }
              if (imported > 0) {
                actionContext += `\n✅ Auto-imported ${imported} opportunities into CRM as investor/partner contacts.\n`;
              }
            }
          } catch(e) {}
        }
      }

      // ─── PROVIDER RECRUITMENT OPPORTUNITIES ─────────────────────
      if ((lowerMsg.includes('recruit') || lowerMsg.includes('low hanging') || lowerMsg.includes('low-hanging') ||
           lowerMsg.includes('provider opportunit') || lowerMsg.includes('find provider') || lowerMsg.includes('find doctor') ||
           lowerMsg.includes('provider lead') || lowerMsg.includes('scout provider')) &&
          !lowerMsg.includes('pending')) {
        const recruitResults = await webEngine.scoutProviderRecruitment();
        if (recruitResults.success && recruitResults.count > 0) {
          executedActions.push({ type: 'provider_scouting', count: recruitResults.count });
          actionContext += `\n\n[PROVIDER RECRUITMENT LEADS — LIVE WEB SCOUT (${recruitResults.count} found)]:\n`;
          const byType = {};
          for (const lead of recruitResults.leads) {
            if (!byType[lead.leadType]) byType[lead.leadType] = [];
            byType[lead.leadType].push(lead);
          }
          for (const [type, leads] of Object.entries(byType)) {
            const label = type === 'competitor_switch' ? '🎯 Competitor Dissatisfied (Easiest Wins)' :
                          type === 'independent_physician' ? '🏥 Independent Physicians' :
                          type === 'nurse_practitioner' ? '👩‍⚕️ Nurse Practitioners' :
                          type === 'rural_provider' ? '🌾 Rural Providers' : '📋 General';
            actionContext += `\n**${label}:**\n`;
            for (const l of leads.slice(0, 4)) {
              actionContext += `  • ${l.title}\n    ${l.url}\n    ${l.snippet.substring(0, 200)}\n`;
            }
          }
        }
      }

      // ─── PARTNERSHIP OPPORTUNITIES ─────────────────────────────
      if (lowerMsg.includes('partnership') || lowerMsg.includes('partner opportunit') || lowerMsg.includes('distribution') ||
          lowerMsg.includes('rfp') || lowerMsg.includes('vendor') || lowerMsg.includes('b2b opportunit')) {
        const partnerResults = await webEngine.scoutPartnerships();
        if (partnerResults.success && partnerResults.count > 0) {
          executedActions.push({ type: 'partnership_scouting', count: partnerResults.count });
          actionContext += `\n\n[PARTNERSHIP & DISTRIBUTION OPPORTUNITIES — LIVE (${partnerResults.count} found)]:\n`;
          for (const p of partnerResults.partnerships.slice(0, 8)) {
            const typeLabel = p.partnerType === 'employer_benefit' ? '🏢 Employer' :
                              p.partnerType === 'pharmacy_chain' ? '💊 Pharmacy' :
                              p.partnerType === 'health_system_rfp' ? '🏥 Health System RFP' : '🤝 Platform';
            actionContext += `  ${typeLabel} • ${p.title}\n    ${p.url}\n    ${p.snippet.substring(0, 200)}\n\n`;
          }
        }
      }

      // ─── OPPORTUNITY OVERVIEW (find everything) ─────────────────
      if (lowerMsg.includes('opportunit') && !lowerMsg.includes('vc') && !lowerMsg.includes('investor') &&
          !lowerMsg.includes('partner') && !lowerMsg.includes('provider lead') && !lowerMsg.includes('recruit')) {
        // Run ALL scouts
        const [vcRes, provRes, partnerRes] = await Promise.allSettled([
          webEngine.scoutVCOpportunities(),
          webEngine.scoutProviderRecruitment(),
          webEngine.scoutPartnerships()
        ]);

        executedActions.push({ type: 'full_opportunity_scan' });
        actionContext += `\n\n[FULL OPPORTUNITY SCAN — LIVE WEB RESULTS]:\n`;

        if (vcRes.status === 'fulfilled' && vcRes.value.success) {
          actionContext += `\n💰 **Investment/Funding**: ${vcRes.value.count} opportunities found\n`;
          for (const o of vcRes.value.opportunities.slice(0, 3)) {
            actionContext += `  • ${o.title} — ${o.url}\n`;
          }
        }
        if (provRes.status === 'fulfilled' && provRes.value.success) {
          actionContext += `\n👨‍⚕️ **Provider Recruitment**: ${provRes.value.count} leads found\n`;
          for (const l of provRes.value.leads.slice(0, 3)) {
            actionContext += `  • ${l.title} — ${l.url}\n`;
          }
        }
        if (partnerRes.status === 'fulfilled' && partnerRes.value.success) {
          actionContext += `\n🤝 **Partnerships**: ${partnerRes.value.count} opportunities found\n`;
          for (const p of partnerRes.value.partnerships.slice(0, 3)) {
            actionContext += `  • ${p.title} — ${p.url}\n`;
          }
        }
      }

      // Auto credential-request: if any web action FAILED due to missing creds, flag it
      if (executedActions.some(a => a.type === 'twitter_post' && a.result && !a.result.success)) {
        actionContext += `\n\n🔑 **CREDENTIAL REQUEST**: Operator, I need Twitter/X API credentials to post. ` +
          `Go to developer.twitter.com → Create project → Generate: API Key, API Secret, Access Token, Access Token Secret. ` +
          `Then add them to the Credential Vault at /admin/agent → Credentials tab. ` +
          `This will unlock: auto-posting, engagement monitoring, follower growth.\n`;
      }

    } catch (opErr) {
      console.error(`  ⚠️ Opportunity/credential action error:`, opErr.message);
    }
  }

  // =========================================================================
  // STEP 1E: SIGN-UP & GROWTH ACTIONS — agents help with onboarding
  // =========================================================================
  {
    const lowerMsg = userMessage.toLowerCase();
    try {
      // ─── PENDING PROVIDERS ─────────────────────────────────────
      if ((lowerMsg.includes('pending') && lowerMsg.includes('provider')) || lowerMsg.includes('awaiting approval') || lowerMsg.includes('provider approval')) {
        const pending = await db.query("SELECT id, email, first_name, last_name, created_at FROM users WHERE role = 'provider' AND provider_status = 'pending' ORDER BY created_at DESC LIMIT 20");
        if (pending.rows.length > 0) {
          executedActions.push({ type: 'pending_providers' });
          actionContext += `\n\n[PENDING PROVIDER APPROVALS — ${pending.rows.length} awaiting]:\n`;
          for (const p of pending.rows) {
            actionContext += `• ${p.first_name} ${p.last_name} (${p.email}) — Applied: ${new Date(p.created_at).toLocaleDateString()}\n`;
          }
          actionContext += `\nTo approve: POST /api/admin/providers/{id}/approve\n`;
        } else {
          executedActions.push({ type: 'pending_providers' });
          actionContext += `\n\n[PENDING PROVIDERS]: None awaiting approval.\n`;
        }
      }

      // ─── SIGN-UP STATS ─────────────────────────────────────────
      if ((lowerMsg.includes('sign') && lowerMsg.includes('up')) || lowerMsg.includes('registration') || lowerMsg.includes('onboard') || lowerMsg.includes('new user')) {
        const stats = {};
        try { const r = await db.query("SELECT COUNT(*) as c FROM users WHERE role = 'patient'"); stats.totalPatients = parseInt(r.rows[0].c); } catch(e) {}
        try { const r = await db.query("SELECT COUNT(*) as c FROM users WHERE role = 'provider'"); stats.totalProviders = parseInt(r.rows[0].c); } catch(e) {}
        try { const r = await db.query("SELECT COUNT(*) as c FROM users WHERE role = 'provider' AND provider_status = 'approved'"); stats.approvedProviders = parseInt(r.rows[0].c); } catch(e) {}
        try { const r = await db.query("SELECT COUNT(*) as c FROM users WHERE role = 'provider' AND provider_status = 'pending'"); stats.pendingProviders = parseInt(r.rows[0].c); } catch(e) {}
        try { const r = await db.query("SELECT COUNT(*) as c FROM users WHERE created_at > NOW() - INTERVAL '7 days'"); stats.newUsersThisWeek = parseInt(r.rows[0].c); } catch(e) {}
        try { const r = await db.query("SELECT COUNT(*) as c FROM users WHERE created_at > NOW() - INTERVAL '24 hours'"); stats.newUsersToday = parseInt(r.rows[0].c); } catch(e) {}
        try { const r = await db.query("SELECT COUNT(*) as c FROM invitations WHERE status = 'pending'"); stats.pendingInvitations = parseInt(r.rows[0].c); } catch(e) {}
        try { const r = await db.query("SELECT COUNT(*) as c FROM invitations WHERE status = 'accepted'"); stats.acceptedInvitations = parseInt(r.rows[0].c); } catch(e) {}

        executedActions.push({ type: 'signup_stats' });
        actionContext += `\n\n[SIGN-UP & ONBOARDING STATS — LIVE]:\n`;
        for (const [key, val] of Object.entries(stats)) {
          actionContext += `• ${key}: ${val}\n`;
        }
      }

      // ─── INVITATION STATUS ─────────────────────────────────────
      if (lowerMsg.includes('invitation') || lowerMsg.includes('invite')) {
        const invites = await db.query("SELECT email, role, status, created_at, expires_at FROM invitations ORDER BY created_at DESC LIMIT 15");
        if (invites.rows.length > 0) {
          executedActions.push({ type: 'invitations' });
          actionContext += `\n\n[INVITATIONS — ${invites.rows.length} total]:\n`;
          for (const inv of invites.rows) {
            const expired = new Date(inv.expires_at) < new Date();
            actionContext += `• ${inv.email} (${inv.role}) — ${inv.status}${expired && inv.status === 'pending' ? ' (EXPIRED)' : ''} — Sent: ${new Date(inv.created_at).toLocaleDateString()}\n`;
          }
        } else {
          actionContext += `\n\n[INVITATIONS]: No invitations sent yet. Use POST /api/invitations to invite providers.\n`;
        }
      }

      // ─── PROVIDER HELP ─────────────────────────────────────────
      if ((lowerMsg.includes('provider') || lowerMsg.includes('doctor')) && (lowerMsg.includes('help') || lowerMsg.includes('assist') || lowerMsg.includes('support') || lowerMsg.includes('issue'))) {
        const providerStats = {};
        try { const r = await db.query("SELECT COUNT(*) as c FROM users WHERE role = 'provider' AND provider_status = 'approved'"); providerStats.activeProviders = parseInt(r.rows[0].c); } catch(e) {}
        try { const r = await db.query("SELECT COUNT(*) as c FROM video_sessions WHERE status = 'completed'"); providerStats.completedVisits = parseInt(r.rows[0].c); } catch(e) {}
        try { const r = await db.query("SELECT COUNT(*) as c FROM video_sessions WHERE status IN ('scheduled', 'pending')"); providerStats.upcomingVisits = parseInt(r.rows[0].c); } catch(e) {}
        try { const r = await db.query("SELECT COUNT(*) as c FROM prescriptions"); providerStats.totalPrescriptions = parseInt(r.rows[0].c); } catch(e) {}

        executedActions.push({ type: 'provider_stats' });
        actionContext += `\n\n[PROVIDER OPERATIONS — LIVE]:\n`;
        for (const [key, val] of Object.entries(providerStats)) {
          if (val !== undefined) actionContext += `• ${key}: ${val}\n`;
        }
      }

    } catch (signupErr) {
      console.error(`  ⚠️ Sign-up/growth action error:`, signupErr.message);
    }
  }

  // =========================================================================
  // STEP 2: LLM-POWERED REASONING — with real action data injected
  // =========================================================================
  if (llmService && !llmService.isAvailable()) {
    try { llmService.initialize(); } catch (e) { /* already tried */ }
  }

  if (llmService && llmService.isAvailable()) {
    try {
      let history = [];
      try {
        const histResult = await db.query(`
          SELECT sender_type, sender_name, content, created_at FROM ai_chat_messages
          WHERE (sender_id = $1 OR recipient_id = $1 OR recipient_type = 'all')
          ORDER BY created_at DESC LIMIT 10
        `, [agentType]);
        history = histResult.rows.reverse();
      } catch (e) { /* no history */ }

      let credCount = 0, resultsCount = 0;
      try {
        const cr = await db.query('SELECT COUNT(*) FROM ai_credential_vault WHERE is_active = true');
        credCount = parseInt(cr.rows[0].count);
        const rr = await db.query('SELECT COUNT(*) FROM ai_agent_results');
        resultsCount = parseInt(rr.rows[0].count);
      } catch (e) { /* no context */ }

      let memory = '';
      try {
        if (persistentMemory) {
          const agentMem = await persistentMemory.getAgentMemory(agentType);
          const sharedMem = await persistentMemory.getSharedMemory(10);
          memory = [agentMem, sharedMem].filter(Boolean).join('\n\n');
        }
      } catch (e) { /* no memory */ }

      // Pass action results as appended context so the LLM can present them
      const enrichedMessage = userMessage + actionContext;

      const llmResponse = await llmService.generateChatResponse(
        persona, agentName, agentType, enrichedMessage,
        history,
        { hasCredentials: credCount > 0, resultsCount, memory }
      );

      if (llmResponse) {
        content = llmResponse;

        try {
          if (persistentMemory) {
            await persistentMemory.extractAndStore(agentType, userMessage, content);
          }
        } catch (e) { /* memory extraction non-critical */ }

        return {
          agentName, content, messageType: 'text',
          metadata: {
            agentType, engine: 'claude+gemini',
            actions: executedActions.map(a => a.type)
          }
        };
      }
    } catch (error) {
      console.error(`  ⚠️ LLM failed for ${agentName}:`, error.message);
    }
  } else {
    console.error(`  ❌ NO LLM AVAILABLE for ${agentName}. ANTHROPIC_API_KEY: ${!!process.env.ANTHROPIC_API_KEY}, GEMINI_API_KEY: ${!!process.env.GEMINI_API_KEY}`);
  }

  // =========================================================================
  // NO TEMPLATES. If LLM is down, say so honestly.
  // =========================================================================
  content = `⚠️ **${agentName} — LLM OFFLINE**\n\n` +
    `I cannot reason right now because no AI model is available.\n\n` +
    `**Status:**\n` +
    `• Anthropic API Key: ${process.env.ANTHROPIC_API_KEY ? '✅ Set' : '❌ Missing'}\n` +
    `• Gemini API Key: ${process.env.GEMINI_API_KEY ? '✅ Set' : '❌ Missing'}\n` +
    `• Server uptime: ${Math.round(process.uptime())}s\n\n` +
    `**To fix:** Ensure ANTHROPIC_API_KEY or GEMINI_API_KEY is set in your environment variables, then restart the server.`;

  return { agentName, content, messageType: 'text', metadata: { agentType, engine: 'error' } };
}

// NO TEMPLATES. OpenClaw principle: real reasoning or honest failure. Never fake it.

module.exports = router;
