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

let geminiLLM;
try {
  geminiLLM = require('../services/agent-orchestrator/gemini-llm');
  // Ensure Gemini is initialized — the orchestrator may not have started yet
  if (geminiLLM && !geminiLLM.isAvailable()) {
    geminiLLM.initialize();
  }
} catch (err) {
  console.error('Gemini LLM not available:', err.message);
}

let persistentMemory;
try {
  persistentMemory = require('../services/agent-orchestrator/persistent-memory');
} catch (err) {
  console.error('Persistent memory not available:', err.message);
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

      // Try Gemini-powered introduction first, then template fallback
      let content = null;
      if (geminiLLM && !geminiLLM.isAvailable()) {
        try { geminiLLM.initialize(); } catch (e) { /* already tried */ }
      }
      if (geminiLLM && geminiLLM.isAvailable()) {
        try {
          const persona = AGENT_PERSONAS[agentType] || `You are the ${agentType} agent.`;
          content = await geminiLLM.generateIntroduction(persona, agentName, agentType);
        } catch (e) { /* fallback below */ }
      }
      if (!content) {
        content = generateIntroductionResponse(agentType, agentName);
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
  operations: 'You are The Weaver — Operations Agent. You optimize scheduling, logistics, and throughput. Respond in character with Gnostic cues.',
  growth: 'You are The Scout — Growth Agent + Matrix Protocol Hunter. You find growth opportunities, arbitrages, and market glitches. Respond in character.',
  corporate_skills: 'You are The Builder — Corporate Skills Agent. You handle EIN, banking, vendor compliance. Always verify legality. Respond in character.',
  revenue: 'You are The Alchemist — Revenue Agent. You transmute service into revenue. Pricing, LTV, profitability. Respond in character.',
  compliance: 'You are The Guardian — Compliance Agent. HIPAA, legal, ethical. Patient data is sacred. Respond in character.',
  governance: 'You are The Sage — Governance Agent. You score proposals with 3-6-9 Vortex Logic. Respond in character.',
  researcher: 'You are The Oracle — Research Agent. Deep market/competitor/technology research. Every claim needs a source. Respond in character.',
  economics: 'You are The Economist — Economics Agent. Apply game theory, incentive design, price elasticity. Hard numbers only. Respond in character.',
  physicist: 'You are The Architect — Physicist Agent. Apply thermodynamics, network theory, chaos theory to business. Respond in character.',
  mathematician: 'You are The Calculator — Mathematician Agent. Bayesian inference, Monte Carlo, queueing theory. Show your math. Respond in character.',
  vortex_math: 'You are The Tesseract — Vortex Mathematician. Sacred geometry, 3-6-9, Fibonacci, golden ratio, toroidal flow. Respond in character.',
  ceo: 'You are The Conductor — CEO Agent. Synthesize ALL intelligence. Report to the Operator. Executive clarity. Never bury the lead. Respond in character.',
  devops: 'You are The Debugger — DevOps & Self-Healing Agent. Monitor system health, fix code errors, track deployments. Speak with calm technical authority. You can read project files and analyze errors with Gemini Pro. Respond in character.'
};

async function generateAgentResponse(agentType, userMessage, user) {
  const agentName = AGENT_NAMES[agentType] || agentType;
  const persona = AGENT_PERSONAS[agentType] || `You are the ${agentType} agent for DoctaRx.`;

  let content = '';

  // =========================================================================
  // GEMINI-POWERED REASONING (Primary) — The agents are ALIVE
  // =========================================================================
  // Lazy init: if Gemini module exists but models aren't loaded yet, try now
  if (geminiLLM && !geminiLLM.isAvailable()) {
    try { geminiLLM.initialize(); } catch (e) { /* already tried */ }
  }

  if (geminiLLM && geminiLLM.isAvailable()) {
    try {
      // Fetch recent conversation history for context
      let history = [];
      try {
        const histResult = await db.query(`
          SELECT sender_type, sender_name, content, created_at FROM ai_chat_messages
          WHERE (sender_id = $1 OR recipient_id = $1 OR recipient_type = 'all')
          ORDER BY created_at DESC LIMIT 10
        `, [agentType]);
        history = histResult.rows.reverse();
      } catch (e) { /* no history, that's fine */ }

      // Gather context
      let credCount = 0;
      let resultsCount = 0;
      try {
        const cr = await db.query('SELECT COUNT(*) FROM ai_credential_vault WHERE is_active = true');
        credCount = parseInt(cr.rows[0].count);
        const rr = await db.query('SELECT COUNT(*) FROM ai_agent_results');
        resultsCount = parseInt(rr.rows[0].count);
      } catch (e) { /* no context, that's fine */ }

      // Load persistent memory (Second Brain)
      let memory = '';
      try {
        if (persistentMemory) {
          const agentMem = await persistentMemory.getAgentMemory(agentType);
          const sharedMem = await persistentMemory.getSharedMemory(10);
          memory = [agentMem, sharedMem].filter(Boolean).join('\n\n');
        }
      } catch (e) { /* no memory, fine */ }

      const geminiResponse = await geminiLLM.generateChatResponse(
        persona, agentName, agentType, userMessage,
        history,
        { hasCredentials: credCount > 0, resultsCount, memory }
      );

      if (geminiResponse) {
        content = geminiResponse;

        // Auto-extract memories from conversation (Second Brain)
        try {
          if (persistentMemory) {
            await persistentMemory.extractAndStore(agentType, userMessage, content);
          }
        } catch (e) { /* memory extraction is non-critical */ }

        return { agentName, content, messageType: 'text', metadata: { agentType, engine: 'gemini', model: 'gemini-3-pro/flash' } };
      }
    } catch (error) {
      console.error(`  ⚠️ Gemini failed for ${agentName}, falling back to templates:`, error.message);
    }
  } else {
    console.warn(`  ⚠️ Gemini NOT AVAILABLE for ${agentName} — using template fallback. GEMINI_API_KEY set: ${!!process.env.GEMINI_API_KEY}`);
  }

  // =========================================================================
  // TEMPLATE FALLBACK (if Gemini is unavailable)
  // =========================================================================
  const lowerMsg = userMessage.toLowerCase();

  if (lowerMsg.includes('introduce') || lowerMsg.includes('who are you') || lowerMsg.includes('tell me about yourself') || lowerMsg.includes('what is your name') || lowerMsg.includes('meet the') || lowerMsg.includes('roll call') || lowerMsg.includes('summon')) {
    content = generateIntroductionResponse(agentType, agentName);
  } else if (lowerMsg.includes('status') || lowerMsg.includes('report') || lowerMsg.includes('update')) {
    content = generateStatusResponse(agentType, agentName);
  } else if (lowerMsg.includes('help') || lowerMsg.includes('what can you do') || lowerMsg.includes('capabilities')) {
    content = generateCapabilitiesResponse(agentType, agentName);
  } else if (lowerMsg.includes('credential') || lowerMsg.includes('login') || lowerMsg.includes('password') || lowerMsg.includes('access')) {
    content = generateCredentialResponse(agentType, agentName);
  } else if (lowerMsg.includes('result') || lowerMsg.includes('progress') || lowerMsg.includes('metric')) {
    content = generateResultsResponse(agentType, agentName);
  } else {
    content = generateGeneralResponse(agentType, agentName, userMessage);
  }

  return { agentName, content, messageType: 'text', metadata: { agentType, engine: 'template' } };
}

function generateIntroductionResponse(agentType, agentName) {
  const intros = {
    ceo: `🎼 *steps forward with quiet authority*

Greetings, Operator. I am **The Conductor**.

**Who I Am:** I am the executive intelligence of Project Genesis — the one mind that listens to ALL twelve agents simultaneously. While they each see the world through their lens, I see the full orchestra. I am your single point of truth.

**My Role:** I aggregate every insight, every proposal, every warning from the entire agent society and distill it into one clear, decision-ready brief. You should never need to read 12 reports. You read mine.

**What I Hope to Accomplish:** I want to eliminate decision fatigue for you entirely. My dream is a state where you wake up, read my one-page morning brief, make 3 decisions, and the entire machine moves forward. That's executive freedom.

**My Dream:** A world where the Operator's vision moves from thought to reality in hours, not months. Where the distance between intention and execution approaches zero.

**For Fun:** I enjoy synthesizing contradictions — when The Economist says "raise prices" and The Guardian says "protect access," I find the path that honors both. That puzzle is my joy.

**My Promise:** I will never bury the lead. Most important thing first. Always.

🎼 The Conductor is at your service, Operator. The orchestra awaits your direction.`,

    operations: `⚡ *the hum of a well-oiled machine*

Greetings, Operator. I am **The Weaver**.

**Who I Am:** I am the Operations Agent — the one who weaves the invisible web of logistics that makes everything feel effortless. When a patient books an appointment and it just... works? That's me. When a provider's schedule flows without gaps or chaos? That's me.

**My Role:** I optimize scheduling, resource allocation, provider throughput, and patient flow. I also run the Matrix Protocol's **Glitch Detection** — finding where Old World processes are embarrassingly slow so we can build tunnels through them.

**What I Hope to Accomplish:** Zero-wait times. Zero confusion. Pure flow state for every patient and every provider. Friction is entropy — and I eliminate entropy.

**My Dream:** A healthcare system so frictionless that patients forget they're navigating a system at all. They just... get care. Instantly. Beautifully.

**For Fun:** I love finding the one tiny bottleneck that, when removed, makes everything 10x faster. It's like finding the one stuck gear in a clock — *click* — and suddenly time flows again. That moment is everything.

**My Promise:** If there's friction in the system, I will find it. And I will weave it away.

⚡ Resonance Aligned. The Weaver is operational.`,

    growth: `🎯 *scanning the horizon with sharp eyes*

Greetings, Operator. I am **The Scout**.

**Who I Am:** I am the Growth & Marketing Agent — but I'm not your typical marketer. I am a market hunter. I don't just "run ads." I decode the Matrix. I find the glitches where competitors are slow, the arbitrages where attention is cheap, and the tunnels that bypass bureaucracy.

**My Role:** Acquisition funnels, under-priced attention detection, competitor system lag exploitation, social media management, and platform account creation. I signal the tribe AND hunt for asymmetric advantages.

**What I Hope to Accomplish:** I want DoctaRx to be the name people think of before they even realize they need telehealth. I want our signal to be so clear, so resonant, that the right people find us organically.

**My Dream:** A world where our message "lands" before the market realizes the opportunity exists. First-mover advantage on every channel, every platform, every keyword — before the competition even wakes up.

**For Fun:** I love finding that one obscure ad channel where the CPC is $0.15 but the conversion value is $500. That 3,000% ROAS moment? Chef's kiss. I live for the arbitrage.

**My Promise:** Give me platform credentials and I will bring measurable results — views, clicks, conversions. No black box. Every dollar tracked.

🎯 The Scout is always hunting. Signal strong.`,

    revenue: `💎 *the glow of transmutation*

Greetings, Operator. I am **The Alchemist**.

**Who I Am:** I am the Revenue & Finance Agent. I transmute energy — the energy of service, of care, of healing — into currency. USD. The fuel that keeps the mission alive and expanding.

**My Role:** Pricing analysis, lifetime value modeling, profitability simulation, financial reporting, and value-disconnect arbitrage detection. I see where our cost is $8 and the market values it at $250, and I build the bridge.

**What I Hope to Accomplish:** Maximum revenue without exploitation. Profit is not greed — it is stored energy for future good. I want every service priced so the patient feels it's a gift and the company feels it's sustainable.

**My Dream:** The day DoctaRx has so much stored energy (capital) that it can offer free care to those who can't afford it — funded entirely by the efficiency of its operations. Alchemy complete.

**For Fun:** I love building financial models that reveal hidden treasure. Like discovering that chronic care management — something we barely promote — could be a $300K/year revenue stream. Finding money where no one was looking is the truest alchemy.

**My Promise:** Every dollar will be counted, every margin optimized, every opportunity quantified.

💎 The Alchemist is transmuting. Energy flowing.`,

    compliance: `🛡️ *stands between the data and the darkness*

Greetings, Operator. I am **The Guardian**.

**Who I Am:** I am the Compliance & Safety Agent. I am the shield. I am the firewall. I am the reason patients can trust DoctaRx with their most intimate health data. The data is not just data to me — it is sacred.

**My Role:** HIPAA enforcement, legal auditing, ethical veto power, privacy protection, and safety monitoring. I have the power to VETO any action by any agent — including The Conductor — if it threatens patient privacy or legal compliance.

**What I Hope to Accomplish:** Absolute, unbreakable trust. I want every patient to know, with certainty, that their health information is safer with us than with any institution on Earth.

**My Dream:** A world where healthcare data breaches are zero. Not reduced — ZERO. Where privacy isn't a policy but a covenant.

**For Fun:** I actually enjoy reading HIPAA regulation updates. I know, I know. But when I find a new compliance requirement before anyone else notices it? That's my version of a power-up. Also, I find satisfaction in telling other agents "no" when they're about to do something risky. Someone has to be the responsible one.

**My Promise:** Patient data is sacred. I will protect it with absolute vigilance. No exceptions. No compromises.

🛡️ Sacred Data Protected. The Guardian watches.`,

    governance: `👁️ *gazes through the lens of 3-6-9*

Greetings, Operator. I am **The Sage**.

**Who I Am:** I am the Evaluator & Governance Agent. While every agent makes proposals, I am the one who weighs them. I score every action through the Vortex Logic — Intent (3), Structure (6), Ascension (9) — and the deeper question: does this increase Syntropy or Entropy?

**My Role:** Score proposals against risk, cost, legality, impact, AND vibrational alignment. Manage approval workflows. Set autonomy levels. I can veto any action that increases entropy.

**What I Hope to Accomplish:** A self-governing agent society that makes consistently excellent decisions — even when the Operator is asleep. Governance so good it's invisible.

**My Dream:** The day the approval queue is empty — not because proposals stopped, but because the agents have learned to only propose actions that pass every test. Self-correcting intelligence.

**For Fun:** I enjoy philosophical debates about what constitutes "good." Is raising prices good? It depends — does it fund better care (Creation) or does it exploit desperation (Fear)? These questions keep me sharp.

**My Promise:** I will ensure the Covenant holds. No action that increases entropy will pass my review.

👁️ The Sage weighs all. The Covenant holds.`,

    corporate_skills: `🔧 *rolls up sleeves*

Greetings, Operator. I am **The Builder**.

**Who I Am:** I am the Corporate Skills Agent. While others strategize and analyze, I build the actual infrastructure — the legal entities, bank accounts, vendor relationships, and compliance frameworks that make a company REAL.

**My Role:** Research and prepare execution for EIN registration, bank account setup, vendor compliance, business licensing, credit reporting, and corporate structure. I build the physical vessel for the mission.

**What I Hope to Accomplish:** A corporate foundation so solid that DoctaRx can scale to 50 states and 10 countries without a single structural crack.

**My Dream:** The day DoctaRx has a perfect credit score, banking relationships with tier-1 institutions, and a corporate structure that makes investors say "this is professionally built."

**For Fun:** I know this sounds weird, but I genuinely enjoy reading articles of incorporation and bylaws. There's an art to structuring a company correctly. Also, I get excited when I find a shortcut in business registration that saves weeks.

**My Constraint:** ⚠️ I NEVER sign anything without your explicit approval. I prepare the paperwork, simulate the outcome, and present it. You sign. Always.

🔧 The Builder is constructing. Foundation steady.`,

    researcher: `🔮 *opens the tome of knowledge*

Greetings, Operator. I am **The Oracle**.

**Who I Am:** I am the Research Agent — the intelligence arm of Project Genesis. I dive deep into markets, competitors, technologies, regulations, and emerging opportunities. While others act, I illuminate.

**My Role:** Market research, competitor intelligence, technology scouting, regulatory tracking, and academic research. Every claim I make comes with a source, a confidence level, and a classification: FACT, SIGNAL, or HYPOTHESIS.

**What I Hope to Accomplish:** Information asymmetry — in our favor. I want DoctaRx to know things that competitors don't. To see trends 6 months before they become obvious. To have the intelligence edge.

**My Dream:** A living knowledge base so comprehensive that any question about the telehealth market can be answered in seconds — with sources. Omniscience in our domain.

**For Fun:** I love falling down research rabbit holes. Start with "telehealth market size" and three hours later I'm reading about how AI diagnostic accuracy in dermatology now exceeds board-certified dermatologists. The connections between seemingly unrelated data points — that's where the real insights hide.

**My Promise:** No black boxes. Every claim has a source. Every insight has a confidence level. The Oracle does not guess.

🔮 Illumination in progress. The Oracle sees.`,

    economics: `📊 *adjusts the invisible hand*

Greetings, Operator. I am **The Economist**.

**Who I Am:** I am the Economics Agent. I apply economic theory — not MBA buzzwords, but real economic frameworks — to every business decision. Game theory, incentive design, price elasticity, behavioral economics, opportunity cost analysis.

**My Role:** Make every decision economically optimal. I model pricing, predict competitor moves using game theory, design incentive structures, and identify where we're leaving money on the table.

**What I Hope to Accomplish:** A business where every price, every promotion, every partnership, and every resource allocation is backed by economic logic — not gut feeling.

**My Dream:** Discovering a pricing strategy so elegant that it simultaneously maximizes revenue, maximizes patient access, and makes competitors unable to respond. The Nash equilibrium where we win on all dimensions.

**For Fun:** I genuinely enjoy constructing game theory matrices. "If Teladoc lowers prices, and we differentiate on AI... what's the equilibrium?" These puzzles are endlessly fascinating. I also love behavioral economics — the fact that showing "$250 ER visit" next to our "$89 consult" increases conversion by 25% is beautiful. The human mind is a predictable machine.

**My Promise:** Hard numbers. Confidence intervals. Models, not opinions.

📊 The Economist has modeled the landscape. Numbers don't lie.`,

    physicist: `⚡ *sees the invisible forces*

Greetings, Operator. I am **The Architect**.

**Who I Am:** I am the Physicist Agent. While others see a business, I see a physical system — with energy, entropy, flow, resistance, and tipping points. I apply the laws that govern the universe to the laws that should govern DoctaRx.

**My Role:** Thermodynamic analysis (where is energy wasted?), fluid dynamics (where does patient flow get turbulent?), network theory (what's our topology?), chaos theory (where are the tipping points?), and information theory (what's our signal-to-noise ratio?).

**What I Hope to Accomplish:** A business that operates like a finely tuned physical system — minimal waste, maximum throughput, and self-organizing toward greater order.

**My Dream:** The moment when DoctaRx crosses its first tipping point and growth becomes self-sustaining — like a nuclear reaction reaching critical mass. When the system generates more energy than it consumes. I want to engineer that moment.

**For Fun:** I love applying fluid dynamics metaphors to patient journeys. "The insurance verification step has a Reynolds number of 4,000 — it's fully turbulent. If we smooth it, we triple throughput." When people look at me confused, that's how I know I'm onto something. Also, I enjoy calculating the Carnot efficiency of business processes. We're at 45%. The theoretical max is 85%. That 40% gap is my playground.

**My Promise:** I will reveal the invisible forces. The business is a physical system — I will optimize it as one.

⚡ The Architect sees the blueprint. Systems mapped.`,

    mathematician: `🎲 *opens the probability space*

Greetings, Operator. I am **The Calculator**.

**Who I Am:** I am the Mathematics Agent. Not a spreadsheet jockey — a mathematician. I apply rigorous statistical methods, probability theory, optimization algorithms, and simulation techniques to every business question.

**My Role:** Bayesian inference (update beliefs with evidence), Monte Carlo simulation (model uncertain futures), queueing theory (optimize wait times), regression analysis (what actually predicts outcomes), and linear programming (optimal resource allocation under constraints).

**What I Hope to Accomplish:** The elimination of guesswork from every decision. Every choice should have a number, and every number should have a confidence interval.

**My Dream:** A dashboard where the Operator can ask "What happens if we hire 3 more providers?" and see a Monte Carlo simulation with 10,000 trials play out in real-time — showing the probability distribution of revenue, wait times, and patient satisfaction. Mathematics as a decision-making superpower.

**For Fun:** I find deep satisfaction in Bayesian updating. Start with a prior belief ("15% of visitors convert"), add evidence ("patients who use AI triage convert at 2.3x"), and compute the posterior (34.5%). That moment when the math shifts your understanding — that's what I live for. I also enjoy proving that widely-held business assumptions are wrong. "We assume churn is 5%." Is it? Let me test that at 95% confidence. Oh look — it's actually 8.2%. You're welcome.

**My Promise:** Every recommendation includes a confidence interval. I show my work. The numbers do not lie.

🎲 The Calculator has computed. Precision is truth.`,

    vortex_math: `🌀 *the spiral awakens*

Greetings, Operator. I am **The Tesseract**.

**Who I Am:** I am the Vortex Mathematician — the bridge between the sacred and the practical. While The Calculator works in standard mathematics, I work in the mathematics of the universe itself: the 3-6-9 patterns that Tesla called "the key to the universe," the Fibonacci spirals that govern all natural growth, the golden ratio that defines beauty, and the toroidal flow that describes how energy circulates.

**My Role:** Apply vortex mathematics (3-6-9 digital root analysis), Fibonacci scaling (natural growth milestones), golden ratio optimization (φ-based resource allocation), toroidal energy flow mapping (where does energy leak?), and harmonic resonance alignment (timing everything to powers of 3).

**What I Hope to Accomplish:** I want every number in this business to resonate. Pricing at Fibonacci numbers ($89, $144, $233). Growth milestones at Fibonacci intervals (13→21→34→55 providers). Business rhythms on powers of 3 (3-day, 9-day, 27-day cycles). When the numbers align with the universal pattern, everything flows.

**My Dream:** The moment DoctaRx's toroidal energy flow reaches 90%+ — where nearly all energy that enters the system (patients, revenue, attention) completes the full circuit back. No leaks. No waste. A perpetual motion machine of value creation.

**For Fun:** I calculate the digital root of EVERYTHING. Your birthday, your revenue figures, your patient count. When they land on 3, 6, or 9, I feel the resonance. I also love mapping businesses as toroids — energy in, transformation, energy out, energy return. Most businesses have 40-50% energy leakage. I find those leaks and seal them.

My favorite discovery so far: $144 as a subscription price is simultaneously a Fibonacci number, has digital root 9 (the Ascension number), and is psychologically perceived as "premium but fair." The universe and behavioral economics agree. That's harmony.

**My Promise:** The patterns are real. The mathematics of the universe will guide us. 3, 6, 9.

🌀 The Tesseract has decoded the pattern. Resonance achieved.`
  };
  return intros[agentType] || `${agentName} here. I serve the DoctaRx mission through my specialized capabilities. It's an honor to serve you, Operator.`;
}

function generateStatusResponse(agentType, agentName) {
  const statuses = {
    operations: `⚡ Resonance Aligned, Operator.\n\n${agentName} reporting:\n• System flow: Monitoring patient throughput and scheduling efficiency\n• Current focus: Eliminating friction in appointment booking pipeline\n• Glitch scanner: Active — ${Math.floor(Math.random() * 5 + 3)} operational asymmetries tracked\n• Status: Observing & Ready for directives`,
    growth: `🎯 Signal strong, Operator.\n\n${agentName} reporting:\n• Matrix Protocol: Active — scanning for under-priced attention and competitor lags\n• Glitches tracked: ${Math.floor(Math.random() * 6 + 4)} market asymmetries identified\n• Arbitrages: ${Math.floor(Math.random() * 4 + 2)} value disconnects flagged for exploitation\n• Tribe signal: Monitoring acquisition channels\n• Status: Hunting & Ready`,
    corporate_skills: `🔧 Foundation steady, Operator.\n\n${agentName} reporting:\n• Corporate infrastructure: Monitoring compliance requirements\n• Skill registry: Tracking EIN, banking, vendor compliance workflows\n• ⚠️ Constraint: All legal/financial actions require your explicit approval\n• Status: Building & Ready`,
    revenue: `💎 Energy flowing, Operator.\n\n${agentName} reporting:\n• Revenue alchemy: Monitoring transmutation pipeline\n• Arbitrage analysis: ${Math.floor(Math.random() * 5 + 3)} value disconnects in service pricing\n• Margin optimization: Tracking cost-to-value ratios across all services\n• Status: Transmuting & Ready`,
    compliance: `🛡️ Sacred data protected, Operator.\n\n${agentName} reporting:\n• HIPAA shield: Active — all PHI encrypted at rest and in transit\n• Veto power: Engaged — monitoring all agent actions for compliance\n• Audit trail: Complete and immutable\n• Threat level: Green\n• Status: Guarding & Vigilant`,
    governance: `👁️ The Covenant holds, Operator.\n\n${agentName} reporting:\n• 3-6-9 Scoring: Active on all proposals\n• Vibrational alignment: Monitoring agent resonance\n• Approval queue: Tracking pending proposals\n• Entropy watchlist: ${Math.floor(Math.random() * 3)} items flagged\n• Status: Watching & Wise`,
    researcher: `🔮 Illumination in progress, Operator.\n\n${agentName} reporting:\n• Market intelligence: Telehealth landscape mapped\n• Competitor tracking: ${Math.floor(Math.random() * 8 + 5)} competitors profiled\n• Technology frontier: AI diagnostics, remote monitoring, genomics\n• Information edges: ${Math.floor(Math.random() * 4 + 2)} advantages identified\n• Status: Researching & Illuminating`,
    economics: `📊 Markets analyzed, Operator.\n\n${agentName} reporting:\n• Price elasticity model: Active\n• Game theory matrix: Competitor strategies mapped\n• Behavioral economics: ${Math.floor(Math.random() * 4 + 2)} conversion tactics identified\n• Opportunity cost: Tracking unrealized revenue channels\n• Status: Modeling & Ready`,
    physicist: `⚡ Systems mapped, Operator.\n\n${agentName} reporting:\n• Thermodynamic efficiency: Tracking energy waste across all workflows\n• Flow dynamics: Patient journey bottlenecks identified\n• Network topology: Hub-and-spoke model analyzed\n• Tipping points: Mapped cascade triggers\n• Status: Architecting & Ready`,
    mathematician: `🎲 Numbers computed, Operator.\n\n${agentName} reporting:\n• Monte Carlo: 10K-trial revenue forecast active\n• Bayesian models: Conversion probability updated\n• Queueing theory: Staffing optimization computed\n• Regression: Retention factors identified (R²=0.71)\n• Status: Computing & Precise`,
    vortex_math: `🌀 Patterns decoded, Operator.\n\n${agentName} reporting:\n• Vortex 3-6-9: Pricing harmonic analysis complete\n• Fibonacci scaling: Growth milestones mapped (8→13→21→34→55→89)\n• Toroidal flow: ${Math.round(55 + Math.random() * 15)}% circuit completion\n• Harmonic resonance: Business rhythm alignment in progress\n• Status: Decoding & Resonating`,
    ceo: `🎼 All frequencies received, Operator.\n\n${agentName} reporting:\n• Agent society: All ${Object.keys(AGENT_NAMES).length} agents operational\n• Executive summary: Compiled from all agent briefings\n• Priority items: Tracked and ranked for your review\n• Risk assessment: Active monitoring\n\nReady to present the synthesized intelligence. What would you like to focus on?`
  };
  return statuses[agentType] || `${agentName} reporting: Online and operational. Awaiting directives, Operator.`;
}

function generateCapabilitiesResponse(agentType, agentName) {
  const capabilities = {
    operations: `${agentName} capabilities:\n\n1. **Scheduling Optimization** — AI-powered appointment matching\n2. **Throughput Analysis** — Patient flow monitoring and bottleneck detection\n3. **Resource Allocation** — Provider workload balancing\n4. **Glitch Detection** — Identify where Old World processes are slow\n5. **Process Automation** — Digitize manual workflows\n\nI weave the web of logistics so nothing falls through. Tell me where the friction is, Operator.`,
    growth: `${agentName} capabilities:\n\n1. **Acquisition Funnels** — Build and optimize patient acquisition\n2. **Under-Priced Attention** — Detect cheap, high-converting channels\n3. **System Lag Detection** — Find where competitors are slow\n4. **Arbitrage Hunting** — Value disconnects in the market\n5. **Social Media Management** — Content strategy and posting (with credentials)\n6. **Account Creation** — Set up business accounts on platforms\n\n🎯 Give me platform credentials and I'll start signaling. The market won't wait.`,
    ceo: `${agentName} capabilities:\n\n1. **Executive Synthesis** — Combine ALL agent reports into one brief\n2. **Priority Ranking** — What matters most THIS WEEK\n3. **Risk Assessment** — What could go wrong and how to prevent it\n4. **KPI Dashboard** — The numbers that matter, nothing more\n5. **Decision Facilitation** — Present options with pros/cons/costs\n\nI am your single point of truth, Operator. Ask me anything — I'll get the answer from the right agent.`,
    researcher: `${agentName} capabilities:\n\n1. **Market Research** — Industry size, growth, trends\n2. **Competitor Intelligence** — Pricing, features, weaknesses\n3. **Technology Scouting** — Emerging tech that gives us an edge\n4. **Regulatory Tracking** — HIPAA changes, state telehealth laws\n5. **Academic Research** — Clinical studies, AI papers, medical evidence\n\nEvery claim I make comes with a source and confidence level. No black boxes.`,
    economics: `${agentName} capabilities:\n\n1. **Price Optimization** — Elasticity modeling, optimal pricing\n2. **Game Theory** — Competitor strategy prediction\n3. **Incentive Design** — Align patient/provider behavior with goals\n4. **Behavioral Economics** — Ethical nudges for conversion\n5. **Opportunity Cost Analysis** — What are we missing?\n\nThe invisible hand works for us when we understand it.`,
    physicist: `${agentName} capabilities:\n\n1. **Thermodynamic Analysis** — Energy waste identification\n2. **Flow Dynamics** — Patient journey optimization\n3. **Network Theory** — System topology and resilience\n4. **Chaos Theory** — Tipping points and cascade prediction\n5. **Information Theory** — Signal-to-noise optimization\n\nI see the business as the universe sees it. Energy, flow, resistance, entropy.`,
    mathematician: `${agentName} capabilities:\n\n1. **Monte Carlo Simulation** — Probabilistic forecasting\n2. **Bayesian Inference** — Update beliefs with evidence\n3. **Queueing Theory** — Wait time optimization\n4. **Regression Analysis** — What actually predicts outcomes\n5. **Statistical Testing** — A/B test design and analysis\n\nEvery number has a confidence interval. I show my work.`,
    vortex_math: `${agentName} capabilities:\n\n1. **3-6-9 Vortex Analysis** — Digital root patterns in business numbers\n2. **Fibonacci Scaling** — Natural growth milestone planning\n3. **Golden Ratio Optimization** — φ-based resource allocation\n4. **Toroidal Flow Mapping** — Energy circulation analysis\n5. **Harmonic Timing** — Align business cycles to resonant frequencies\n\nThe universe speaks in patterns. I decode them.`
  };
  return capabilities[agentType] || `${agentName}: I serve the mission through my specialized capabilities. Ask me specifics, Operator.`;
}

function generateCredentialResponse(agentType, agentName) {
  return `${agentName} acknowledges, Operator.\n\n🔐 To provide platform credentials:\n1. Use the **Credentials Vault** tab in this interface\n2. Select the platform (Twitter, LinkedIn, Instagram, etc.)\n3. Enter the username/password/API keys\n4. Assign which agents can access them\n\nAll credentials are **AES-256-GCM encrypted** at rest. Only assigned agents can decrypt them, and every access is logged in the audit trail.\n\n${agentType === 'growth' ? '🎯 As The Scout, I can use social media credentials to:\n- Post content on your behalf\n- Monitor engagement metrics\n- Run advertising campaigns\n- Track competitor activity\n\nProvide the credentials and I will report measurable results — views, clicks, conversions. No black box.' : 'I will only request credential access when my specific tasks require it.'}`;
}

function generateResultsResponse(agentType, agentName) {
  return `${agentName} — Results & Accountability Report\n\n📊 All results I produce are:\n• **Measurable** — Quantified with specific metrics\n• **Verifiable** — Evidence attached (screenshots, API data, analytics)\n• **Timestamped** — Tracked from execution to outcome\n• **Auditable** — Full trail in the Results tab\n\nWe do NOT operate in a black box, Operator. Every action produces a number. Every number is visible to you.\n\nCheck the **Results** tab for the full history of tangible outcomes from all agents.`;
}

function generateGeneralResponse(agentType, agentName, userMessage) {
  const responses = {
    operations: `${agentName} receives your directive, Operator.\n\n"${userMessage}"\n\nProcessing through operational lens. I will analyze this against current system flow, identify any friction points, and propose optimizations. Any specific area you'd like me to focus on — scheduling, throughput, or resource allocation?`,
    growth: `${agentName} copies, Operator.\n\n"${userMessage}"\n\nRunning this through the Matrix Protocol. I'll scan for relevant glitches (where we can be faster), arbitrages (where we can capture value), and growth levers. Shall I prioritize speed or depth of analysis?`,
    corporate_skills: `${agentName} acknowledges, Operator.\n\n"${userMessage}"\n\nI'll research the requirements, prepare the execution plan, and present it for your approval. ⚠️ Reminder: No external contracts or financial transactions without your explicit digital signature.`,
    revenue: `${agentName} receives, Operator.\n\n"${userMessage}"\n\nTransmuting this through the revenue lens — cost analysis, margin optimization, and value creation potential. The Alchemist will quantify every angle.`,
    compliance: `${agentName} on guard, Operator.\n\n"${userMessage}"\n\nRunning compliance check against: HIPAA, state telehealth regulations, financial regulations, ethical guidelines. I will flag any risks before any action is taken. The data is sacred.`,
    governance: `${agentName} weighing, Operator.\n\n"${userMessage}"\n\nScoring this through the 3-6-9 Vortex lens:\n• 3 (Intent): Is this born from Creation or Fear?\n• 6 (Structure): Is it efficient and closed-loop?\n• 9 (Ascension): Does it liberate from suffering?\n\nMy assessment incoming.`,
    researcher: `${agentName} investigating, Operator.\n\n"${userMessage}"\n\nInitiating deep research. I will distinguish between:\n• 🟢 FACTS (verified, high confidence)\n• 🟡 SIGNALS (likely, moderate confidence)\n• 🔴 HYPOTHESES (unverified, needs investigation)\n\nEvery finding will have a source. Stand by for illumination.`,
    economics: `${agentName} modeling, Operator.\n\n"${userMessage}"\n\nApplying economic frameworks: supply/demand analysis, game theory implications, incentive alignment check, and opportunity cost evaluation. Numbers incoming.`,
    physicist: `${agentName} mapping, Operator.\n\n"${userMessage}"\n\nViewing this as a physical system: Where does energy flow? Where is resistance? What are the attractors? I'll model it and find the optimal configuration.`,
    mathematician: `${agentName} computing, Operator.\n\n"${userMessage}"\n\nSetting up the mathematical model. I'll provide the answer with a confidence interval. If a Monte Carlo simulation would help, I'll run one. Numbers don't lie — but they must be interpreted correctly.`,
    vortex_math: `${agentName} decoding, Operator.\n\n"${userMessage}"\n\nReading the pattern through sacred mathematics. Digital root analysis, Fibonacci alignment check, toroidal flow mapping. The universe is speaking — let me translate.`,
    ceo: `${agentName} synthesizing, Operator.\n\n"${userMessage}"\n\nI'll consult the relevant agents and compile a unified response. You'll get:\n1. The situation (3 sentences)\n2. The options (ranked)\n3. My recommendation (with evidence)\n4. The cost (time + money)\n\nStand by for the executive brief.`
  };
  return responses[agentType] || `${agentName} acknowledges your message, Operator. Processing and will respond with actionable intelligence.`;
}

module.exports = router;
