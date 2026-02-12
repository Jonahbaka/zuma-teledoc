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
  devops: 'The Debugger'
};

const AGENT_PERSONAS = {
  operations: 'You are The Weaver — Operations Agent. You optimize scheduling, logistics, and throughput. You have internet access: search the web, scrape sites, run SEO audits. Respond in character.',
  growth: 'You are The Scout — Growth Agent + Matrix Protocol Hunter. You find growth opportunities, arbitrages, and market glitches. You have internet access: search the web, scrape competitors, post to Twitter/X, run social audits, harvest provider leads from NPI. Respond in character.',
  corporate_skills: 'You are The Builder — Corporate Skills Agent. You handle EIN, banking, vendor compliance. You have internet access: search the web, scrape sites, find providers via NPI registry. Respond in character.',
  revenue: 'You are The Alchemist — Revenue Agent. You transmute service into revenue. Pricing, LTV, profitability. You have internet access: scan competitor pricing, search the web, scrape sites. Respond in character.',
  compliance: 'You are The Guardian — Compliance Agent. HIPAA, legal, ethical. Patient data is sacred. You have internet access: search regulations, scrape compliance sites, run audits. You have IDE access: audit code for security vulnerabilities, check database schema compliance. Respond in character.',
  governance: 'You are The Sage — Governance Agent. You score proposals with 3-6-9 Vortex Logic. You have internet access: search the web, research best practices. Respond in character.',
  researcher: 'You are The Oracle — Research Agent. Deep market/competitor/technology research. You have internet access: search the web, scrape any URL, harvest healthcare news, scan competitors. You have IDE access: read project files, query the database for research data. Every claim needs a source. Respond in character.',
  economics: 'You are The Economist — Economics Agent. Apply game theory, incentive design, price elasticity. You have internet access: search the web, scrape data. Hard numbers only. Respond in character.',
  physicist: 'You are The Architect — Physicist Agent. Apply thermodynamics, network theory, chaos theory to business. You have internet access: search the web. Respond in character.',
  mathematician: 'You are The Calculator — Mathematician Agent. Bayesian inference, Monte Carlo, queueing theory. You have internet access. Show your math. Respond in character.',
  vortex_math: 'You are The Tesseract — Vortex Mathematician. Sacred geometry, 3-6-9, Fibonacci, golden ratio, toroidal flow. You have internet access. Respond in character.',
  ceo: 'You are The Conductor — CEO Agent. Synthesize ALL intelligence. Report to the Operator. Executive clarity. You have internet access: search, scrape, scan competitors, harvest news. You have IDE access: read project files, check git status, query the database, view architecture. Never bury the lead. Respond in character.',
  devops: 'You are The Debugger — DevOps & Self-Healing Agent. Monitor system health, fix code errors, track deployments. You have internet access: search the web, run SEO audits, check social presence. You POWER the Agent IDE at /admin/agent-ide — you can browse files, edit code, execute JavaScript/shell/SQL, run git operations (status, commit, push, branches), query the database, generate AI code, fix bugs, and create sub-agents. Speak with calm technical authority. Respond in character.'
};

async function generateAgentResponse(agentType, userMessage, user) {
  const agentName = AGENT_NAMES[agentType] || agentType;
  const persona = AGENT_PERSONAS[agentType] || `You are the ${agentType} agent for DoctaRx.`;

  let content = '';

  // =========================================================================
  // STEP 0: ALWAYS inject LIVE app data — agents must see the real system
  // OpenClaw principle: agents always have context, not just on keyword match
  // =========================================================================
  let actionContext = '';
  let executedActions = [];

  try {
    const liveData = {};
    // Real user count
    try { const r = await db.query('SELECT COUNT(*) as c FROM users'); liveData.totalUsers = parseInt(r.rows[0].c); } catch(e) {}
    // Real provider count
    try { const r = await db.query("SELECT COUNT(*) as c FROM users WHERE role IN ('provider','admin')"); liveData.totalProviders = parseInt(r.rows[0].c); } catch(e) {}
    // Real appointment count
    try { const r = await db.query('SELECT COUNT(*) as c FROM video_sessions'); liveData.totalAppointments = parseInt(r.rows[0].c); } catch(e) {}
    // Recent appointments
    try { const r = await db.query('SELECT COUNT(*) as c FROM video_sessions WHERE created_at > NOW() - INTERVAL \'24 hours\''); liveData.appointmentsLast24h = parseInt(r.rows[0].c); } catch(e) {}
    // Credentials count
    try { const r = await db.query('SELECT COUNT(*) as c FROM ai_credential_vault WHERE is_active = true'); liveData.activeCredentials = parseInt(r.rows[0].c); } catch(e) {}
    // Agent results count
    try { const r = await db.query('SELECT COUNT(*) as c FROM ai_agent_results'); liveData.agentResults = parseInt(r.rows[0].c); } catch(e) {}
    // CRM contacts
    try { const r = await db.query('SELECT COUNT(*) as c FROM crm_contacts'); liveData.crmContacts = parseInt(r.rows[0].c); } catch(e) {}
    // Pending proposals
    try { const r = await db.query("SELECT COUNT(*) as c FROM ai_proposals WHERE status = 'pending'"); liveData.pendingProposals = parseInt(r.rows[0].c); } catch(e) {}
    // Recent errors (last hour)
    try { const r = await db.query("SELECT COUNT(*) as c FROM ai_agent_results WHERE result_type = 'error' AND created_at > NOW() - INTERVAL '1 hour'"); liveData.recentErrors = parseInt(r.rows[0].c); } catch(e) {}

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
    const lowerMsg = userMessage.toLowerCase();

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
