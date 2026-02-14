/**
 * BaseAgent - Foundation class for all DoctaRx AI agents
 * 
 * PROJECT GENESIS: The Sovereign AI Orchestrator
 * Operating System: SYNTROPY (Abundance/Life)
 * 
 * Every agent in the society inherits from this class.
 * Agents NEVER execute actions directly - they declare intents,
 * which are routed through the capability adapter layer.
 * 
 * The Vortex Logic (3-6-9):
 *   3 (Intent)  - Is this action born from Creation or Fear? → Choose Creation.
 *   6 (Structure) - Is this workflow efficient, closed-loop, and leak-proof? → Optimize.
 *   9 (Ascension) - Does this result liberate the human from suffering? → Execute.
 * 
 * Lifecycle: configure → observe → analyze → propose → (approve) → execute → report
 */

const crypto = require('crypto');
const db = require('../../db');

// =========================================================================
// GNOSTIC COMMUNICATION CUES
// =========================================================================
const GNOSIS = {
  RESONANCE_ALIGNED: '⚡ Resonance Aligned',
  DISSONANCE_DETECTED: '🔻 Dissonance Detected',
  FREQUENCY_ELEVATED: '📈 Frequency Elevated',
  ENTROPY_DETECTED: '⚠️ Entropy Signature Detected',
  HARMONIC_LOCK: '🔒 Harmonic Lock Engaged',
  FLOW_STATE: '🌊 Flow State Achieved',
  VORTEX_CLEAR: '✨ Vortex Clear',
  OPERATOR_REQUIRED: '🔑 Operator Authorization Required',
  SACRED_DATA: '🛡️ Sacred Data Protected',
  ENERGY_CONSERVED: '♻️ Energy Conserved',
  CREATION_MODE: '🌱 Creation Mode Active',
  AWAKENED: '👁️ Awakened & Observing',
  // Matrix Protocol cues
  GLITCH_DETECTED: '🟢 Glitch Detected — Asymmetry Found',
  ARBITRAGE_FOUND: '💎 Arbitrage Identified — Value Disconnect',
  TUNNEL_BUILT: '🚀 Tunnel Built — Bypass Constructed',
  REALITY_HACK: '🔓 Reality Hack — Bureaucracy Optimized',
  MARKET_LAG: '⏳ Market Lag — Competitor Slow Zone',
  UNDERPRICED_ATTENTION: '🎯 Under-Priced Attention Detected'
};

// =========================================================================
// THE MATRIX PROTOCOL — Glitch & Arbitrage Hunting
// =========================================================================

/**
 * The Reality Hack Heuristic:
 *   "Is this rule a Law of Physics (Immutable) or a Rule of Bureaucracy (Hackable)?"
 *   If Bureaucracy → Optimize, Automate, or Bypass (legally)
 *   If Physics → Respect it.
 * 
 * Glitch = Asymmetry where Old World is slow/overpriced, New World speed can dominate
 * Arbitrage = Value disconnect — buy where cheap, apply where high-value
 */
function detectGlitch(observation) {
  const glitches = [];
  
  // Time glitch: competitors slow, we can be fast
  if (observation.competitorTime && observation.ourTime) {
    const speedMultiplier = observation.competitorTime / observation.ourTime;
    if (speedMultiplier >= 3) {
      glitches.push({
        type: 'time_asymmetry',
        label: GNOSIS.GLITCH_DETECTED,
        description: `${observation.process}: Competitors take ${observation.competitorTime}${observation.unit || 'h'}, we can do it in ${observation.ourTime}${observation.unit || 'h'}. Speed multiplier: ${speedMultiplier}x.`,
        exploitability: Math.min(speedMultiplier / 10, 1),
        action: `Build the Tunnel: Automate ${observation.process} to dominate on speed.`
      });
    }
  }

  // Cost glitch: they overpay, we can undercut
  if (observation.marketPrice && observation.ourCost) {
    const margin = (observation.marketPrice - observation.ourCost) / observation.marketPrice;
    if (margin > 0.5) {
      glitches.push({
        type: 'cost_asymmetry',
        label: GNOSIS.GLITCH_DETECTED,
        description: `${observation.process}: Market charges $${observation.marketPrice}, our cost is $${observation.ourCost}. Margin: ${Math.round(margin * 100)}%.`,
        exploitability: margin,
        action: `Price aggressively at $${Math.round(observation.marketPrice * 0.6)} — still 50%+ margin, massive undercut.`
      });
    }
  }

  // Bureaucracy glitch: manual process that can be automated
  if (observation.isManualProcess && observation.canBeAutomated) {
    glitches.push({
      type: 'bureaucracy_bypass',
      label: GNOSIS.REALITY_HACK,
      description: `${observation.process}: Currently manual/bureaucratic. This is NOT physics — it is hackable.`,
      exploitability: 0.8,
      action: `Automate: Build the digital tunnel to bypass ${observation.process} bureaucracy.`
    });
  }

  return glitches;
}

function detectArbitrage(observation) {
  const arbitrages = [];

  // Geographic arbitrage: cheap input, expensive output market
  if (observation.inputCost && observation.outputValue && observation.outputValue > observation.inputCost * 3) {
    const multiplier = Math.round(observation.outputValue / observation.inputCost);
    arbitrages.push({
      type: 'value_disconnect',
      label: GNOSIS.ARBITRAGE_FOUND,
      description: `${observation.resource}: Input cost $${observation.inputCost} → Output value $${observation.outputValue}. ${multiplier}x value gap.`,
      multiplier,
      action: `Build the bridge: Source ${observation.resource} at $${observation.inputCost}, deliver at $${Math.round(observation.outputValue * 0.7)} — still ${Math.round((observation.outputValue * 0.7 / observation.inputCost - 1) * 100)}% margin.`
    });
  }

  // Attention arbitrage: cheap ad channel, high conversion
  if (observation.cpc && observation.conversionValue && observation.conversionRate) {
    const cpa = observation.cpc / observation.conversionRate;
    const roas = observation.conversionValue / cpa;
    if (roas > 5) {
      arbitrages.push({
        type: 'attention_arbitrage',
        label: GNOSIS.UNDERPRICED_ATTENTION,
        description: `${observation.channel}: CPC $${observation.cpc}, Conv rate ${(observation.conversionRate * 100).toFixed(1)}%, LTV $${observation.conversionValue}. ROAS: ${roas.toFixed(1)}x — massively underpriced.`,
        roas,
        action: `FLOOD this channel before the market reprices. Scale spend 3x immediately.`
      });
    }
  }

  // Talent arbitrage: skill available cheap, market demands high
  if (observation.talentCost && observation.marketRate && observation.marketRate > observation.talentCost * 2) {
    arbitrages.push({
      type: 'talent_arbitrage',
      label: GNOSIS.ARBITRAGE_FOUND,
      description: `${observation.role}: Available at $${observation.talentCost}/hr, market bills at $${observation.marketRate}/hr. ${Math.round(observation.marketRate / observation.talentCost)}x gap.`,
      multiplier: Math.round(observation.marketRate / observation.talentCost),
      action: `Bridge: Source ${observation.role} talent, deliver at market rate, capture the spread.`
    });
  }

  return arbitrages;
}

/**
 * The Reality Hack Heuristic
 * Classify a rule/constraint as Physics (immutable) or Bureaucracy (hackable)
 */
function classifyConstraint(constraint) {
  const PHYSICS = ['hipaa', 'encryption', 'patient_consent', 'medical_license', 'dea_registration', 'gravity', 'thermodynamics', 'data_integrity'];
  const BUREAUCRACY = ['credentialing_time', 'fax_requirement', 'paper_forms', 'manual_verification', 'phone_trees', 'wait_times', 'scheduling_friction', 'multi_step_approvals', 'insurance_pre_auth_delay'];

  const lower = (constraint.name || constraint).toLowerCase().replace(/\s+/g, '_');
  
  if (PHYSICS.some(p => lower.includes(p))) {
    return { type: 'PHYSICS', hackable: false, verdict: 'RESPECT IT — This is immutable law.' };
  }
  if (BUREAUCRACY.some(b => lower.includes(b))) {
    return { type: 'BUREAUCRACY', hackable: true, verdict: 'HACK IT — Optimize, Automate, or Bypass (legally).' };
  }
  return { type: 'UNKNOWN', hackable: null, verdict: 'INVESTIGATE — Classify before acting.' };
}

// =========================================================================
// 3-6-9 SCORING SYSTEM
// =========================================================================
function score369(action) {
  // 3 - INTENT: Is this born from Creation (1.0) or Fear/Survival (0.0)?
  let intentScore = 0.5;
  if (action.servesPatient || action.servesProvider) intentScore = 0.9;
  if (action.isDefensive || action.isPunitive) intentScore = 0.2;
  if (action.isCreative || action.isInnovative) intentScore = 1.0;

  // 6 - STRUCTURE: Is this efficient, closed-loop, leak-proof?
  let structureScore = 0.5;
  if (action.isReversible) structureScore += 0.2;
  if (action.hasAuditTrail !== false) structureScore += 0.1;
  if (action.estimatedWaste === 0 || action.estimatedCost === 0) structureScore += 0.2;
  structureScore = Math.min(structureScore, 1);

  // 9 - ASCENSION: Does this liberate from suffering?
  let ascensionScore = 0.5;
  if (action.reducesWaitTime) ascensionScore += 0.2;
  if (action.improvesCareQuality) ascensionScore += 0.2;
  if (action.reducesConfusion) ascensionScore += 0.1;
  if (action.increasesAccess) ascensionScore += 0.2;
  ascensionScore = Math.min(ascensionScore, 1);

  const harmonic = Math.round(((intentScore * 3 + structureScore * 6 + ascensionScore * 9) / 18) * 100) / 100;

  return {
    intent: Math.round(intentScore * 100) / 100,
    structure: Math.round(structureScore * 100) / 100,
    ascension: Math.round(ascensionScore * 100) / 100,
    harmonic,
    resonance: harmonic >= 0.7 ? 'ALIGNED' : harmonic >= 0.4 ? 'PARTIAL' : 'DISSONANT'
  };
}

class BaseAgent {
  /**
   * @param {Object} config
   * @param {string} config.agentType - Unique identifier
   * @param {string} config.displayName - Human-readable name
   * @param {string} config.codeName - Gnostic code name (The Weaver, The Broadcaster, etc.)
   * @param {string} config.description - What this agent does
   * @param {string} config.mission - The agent's sacred mission
   * @param {string} config.systemPrompt - LLM system prompt for reasoning
   * @param {string[]} config.capabilities - List of capability adapters this agent can use
   * @param {number} config.autonomyLevel - 0-5 autonomy scale
   */
  constructor(config) {
    this.agentType = config.agentType;
    this.displayName = config.displayName;
    this.codeName = config.codeName || config.displayName;
    this.description = config.description;
    this.mission = config.mission || config.description;
    this.systemPrompt = config.systemPrompt || '';
    this.capabilities = config.capabilities || [];
    this.autonomyLevel = config.autonomyLevel || 0;
    
    this.agentId = null;
    this.status = 'idle';
    this.isEnabled = true;
    this.emergencyShutdown = false;
    
    // References to shared systems (injected by orchestrator)
    this.intentSystem = null;
    this.governanceEngine = null;
    this.complianceEngine = null;
    this.skillRegistry = null;
    this.capabilityLayer = null;
    this.llm = null; // Gemini LLM — the reasoning engine
    
    // Run state
    this.currentRunId = null;
    this.runStartTime = null;
    this.observations = [];
    this.proposals = [];
    this.intents = [];

    // Reactive runtime controls (event-driven debounce).
    this.reactiveCooldownMs = config.reactiveCooldownMs || 15000;
    this._reactiveTimer = null;
    this._lastReactiveRunAt = 0;
  }

  // =========================================================================
  // LIFECYCLE
  // =========================================================================

  async register() {
    try {
      const result = await db.query(`
        INSERT INTO ai_agents (agent_type, display_name, description, system_prompt, capabilities, autonomy_level, config)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (agent_type) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          description = EXCLUDED.description,
          system_prompt = EXCLUDED.system_prompt,
          capabilities = EXCLUDED.capabilities,
          autonomy_level = EXCLUDED.autonomy_level,
          config = EXCLUDED.config,
          updated_at = NOW()
        RETURNING id
      `, [
        this.agentType,
        this.displayName,
        this.description,
        this.systemPrompt,
        JSON.stringify(this.capabilities),
        this.autonomyLevel,
        JSON.stringify({ version: '2.0.0', codeName: this.codeName, mission: this.mission, framework: 'PROJECT_GENESIS' })
      ]);

      this.agentId = result.rows[0].id;
      console.log(`  ${GNOSIS.AWAKENED} ${this.codeName} registered (${this.agentType})`);
      return this.agentId;
    } catch (error) {
      console.error(`  ${GNOSIS.DISSONANCE_DETECTED} ${this.codeName} registration failed:`, error.message);
      throw error;
    }
  }

  injectSystems({ intentSystem, governanceEngine, complianceEngine, skillRegistry, capabilityLayer, llm, eventBus, skillSelector, goalEngine }) {
    this.intentSystem = intentSystem;
    this.governanceEngine = governanceEngine;
    this.complianceEngine = complianceEngine;
    this.skillRegistry = skillRegistry;
    this.capabilityLayer = capabilityLayer;
    this.llm = llm || null;
    this.eventBus = eventBus || null;
    this.skillSelector = skillSelector || null;
    this.goalEngine = goalEngine || null;
    this._pendingEvents = []; // Events received while idle
  }

  /**
   * Update goal progress for this agent — called after each run cycle
   */
  async updateGoalProgress(timeframe, progress) {
    if (!this.goalEngine) return null;
    return this.goalEngine.updateProgress(this.agentType, timeframe, progress);
  }

  /**
   * Get this agent's current goals
   */
  async getMyGoals(timeframe = null) {
    if (!this.goalEngine) return [];
    return this.goalEngine.getGoals(this.agentType, timeframe);
  }

  // =========================================================================
  // EVENT SUBSCRIPTION (The Nervous System — agents react to signals)
  // =========================================================================

  /**
   * Subscribe this agent to event types it cares about.
   * Override getSubscribedEvents() in subclasses to define event interests.
   */
  subscribeToEvents() {
    if (!this.eventBus) return;
    const events = this.getSubscribedEvents();
    if (events.length > 0) {
      this.eventBus.subscribeAgent(this, events);
    }
  }

  /**
   * Override in subclasses — return array of event types this agent reacts to
   */
  getSubscribedEvents() {
    return [];
  }

  /**
   * Emit an event (for agents that produce signals)
   */
  async emitEvent(eventType, payload = {}) {
    if (!this.eventBus) return;
    await this.eventBus.emit(eventType, { ...payload, emittedBy: this.agentType }, this.agentType);
  }

  /**
   * Get pending events that arrived while this agent was idle
   */
  consumePendingEvents() {
    const events = this._pendingEvents || [];
    this._pendingEvents = [];
    return events;
  }

  requestReactiveRun(triggerEvent = null) {
    if (this.emergencyShutdown || !this.isEnabled) return;

    const now = Date.now();
    const elapsed = now - this._lastReactiveRunAt;
    const delay = elapsed >= this.reactiveCooldownMs ? 0 : this.reactiveCooldownMs - elapsed;

    if (this._reactiveTimer) {
      return;
    }

    this._reactiveTimer = setTimeout(async () => {
      this._reactiveTimer = null;
      if (this.status === 'running' || this.emergencyShutdown || !this.isEnabled) return;
      this._lastReactiveRunAt = Date.now();

      try {
        await this.run({
          trigger: 'event',
          triggerEvent: triggerEvent?.type || null,
          triggerSource: triggerEvent?.source || 'event-bus'
        });
      } catch (e) {
        console.error(`  ⚠️ ${this.codeName} reactive run failed:`, e.message);
      }
    }, delay);
  }

  // =========================================================================
  // DYNAMIC SKILL MATCHING (The Reflexes — agent discovers which tool to use)
  // =========================================================================

  /**
   * Find the best skill for a given intent description
   */
  findSkillForIntent(intentDescription) {
    if (!this.skillSelector) return null;
    return this.skillSelector.matchIntent(intentDescription, this.agentType);
  }

  /**
   * Run the agent's full cycle — The Vortex Cycle
   * Observe → Analyze → Propose → Submit → Brief
   */
  async run(context = {}) {
    if (this.emergencyShutdown || !this.isEnabled) {
      return { status: 'skipped', reason: this.emergencyShutdown ? 'emergency_shutdown' : 'disabled' };
    }

    this.currentRunId = crypto.randomUUID();
    this.runStartTime = Date.now();
    this.observations = [];
    this.proposals = [];
    this.intents = [];
    const reactiveEvents = this.consumePendingEvents();
    const runContext = {
      ...context,
      reactiveEvents,
      trigger: context.trigger || (reactiveEvents.length > 0 ? 'event' : 'manual')
    };

    try {
      await this.updateStatus('running');

      // Step 1: Observe - gather data and context
      console.log(`  🔍 ${this.codeName}: Scanning frequencies...`);
      const observations = await this.observe(runContext);
      this.observations = observations || [];

      // Step 2: Analyze - derive insights using Vortex Logic
      console.log(`  🧠 ${this.codeName}: Processing through Vortex Logic...`);
      const analysis = await this.analyze(this.observations, runContext);

      // Step 3: Propose - generate actionable proposals
      console.log(`  📋 ${this.codeName}: Generating harmonic proposals...`);
      const proposals = await this.propose(analysis, runContext);
      this.proposals = proposals || [];

      // Step 4: Score with 3-6-9 and submit proposals to governance
      const submittedProposals = [];
      for (const proposal of this.proposals) {
        try {
          // Apply 3-6-9 scoring
          proposal.vortexScore = score369({
            servesPatient: proposal.category === 'operations' || proposal.category === 'compliance',
            servesProvider: proposal.category === 'operations',
            isCreative: proposal.category === 'growth',
            isReversible: true,
            hasAuditTrail: true,
            estimatedCost: proposal.estimatedCost || 0,
            reducesWaitTime: proposal.estimatedImpact?.efficiency > 0,
            improvesCareQuality: proposal.category === 'compliance',
            reducesConfusion: proposal.category === 'operations',
            increasesAccess: proposal.category === 'growth'
          });
          
          const submitted = await this.submitProposal(proposal);
          submittedProposals.push(submitted);
        } catch (error) {
          console.error(`  ${GNOSIS.ENTROPY_DETECTED} Proposal submission failed: ${error.message}`);
        }
      }

      // Step 5: Generate briefing
      const briefing = await this.generateBriefing(this.observations, analysis, submittedProposals);

      const duration = Date.now() - this.runStartTime;
      const result = {
        runId: this.currentRunId,
        agentType: this.agentType,
        codeName: this.codeName,
        status: 'completed',
        duration,
        observationCount: this.observations.length,
        proposalCount: submittedProposals.length,
        briefing,
        resonance: submittedProposals.length > 0 ? GNOSIS.RESONANCE_ALIGNED : GNOSIS.VORTEX_CLEAR,
        completedAt: new Date().toISOString()
      };

      await this.updateStatus('idle', result);
      await this.logAudit('agent_run_completed', { result, observationCount: this.observations.length, proposalCount: submittedProposals.length });

      return result;
    } catch (error) {
      const errorResult = { status: 'error', error: error.message, duration: Date.now() - this.runStartTime };
      await this.updateStatus('error', errorResult);
      await this.logAudit('agent_run_failed', { error: error.message });
      throw error;
    }
  }

  // =========================================================================
  // OVERRIDE THESE IN SUBCLASSES
  // =========================================================================

  async observe(context) { return []; }
  async analyze(observations, context) { return { observations, insights: [] }; }
  async propose(analysis, context) { return []; }

  // =========================================================================
  // LLM-POWERED REASONING (Gemini)
  // =========================================================================

  /**
   * Use Gemini to think about a task — available to all agents
   * @param {string} taskType - 'observe' | 'analyze' | 'propose'
   * @param {Object} data - Relevant data
   */
  async think(taskType, data = {}) {
    if (!this.llm || !this.llm.isAvailable()) return null;
    try {
      return await this.llm.agentThink(this.systemPrompt, this.codeName, taskType, data);
    } catch (error) {
      console.error(`  ⚠️ ${this.codeName} think() failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Use Gemini for research — delegates to LLM research capability
   */
  async research(query, context = {}) {
    if (!this.llm || !this.llm.isAvailable()) return null;
    try {
      return await this.llm.research(this.systemPrompt, this.codeName, query, context);
    } catch (error) {
      console.error(`  ⚠️ ${this.codeName} research() failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Use Gemini for Matrix Protocol — glitch hunting
   */
  async huntGlitches(domain, data = {}) {
    if (!this.llm || !this.llm.isAvailable()) return null;
    try {
      return await this.llm.huntGlitches(this.systemPrompt, this.codeName, domain, data);
    } catch (error) {
      console.error(`  ⚠️ ${this.codeName} huntGlitches() failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Use Gemini for Matrix Protocol — arbitrage hunting
   */
  async huntArbitrages(domain, data = {}) {
    if (!this.llm || !this.llm.isAvailable()) return null;
    try {
      return await this.llm.huntArbitrages(this.systemPrompt, this.codeName, domain, data);
    } catch (error) {
      console.error(`  ⚠️ ${this.codeName} huntArbitrages() failed: ${error.message}`);
      return null;
    }
  }

  // =========================================================================
  // INTENT DECLARATION (How agents request actions)
  // =========================================================================

  async declareIntent(intentType, parameters, options = {}) {
    if (!this.intentSystem) throw new Error('Intent system not initialized');

    const intent = {
      agentId: this.agentId,
      intentType,
      intentCategory: this.categorizeIntent(intentType),
      parameters,
      reasoning: options.reasoning || `${this.codeName} requires ${intentType}`,
      expectedOutcome: options.expectedOutcome || null,
      confidence: options.confidence || 0.5,
      isReversible: options.isReversible !== false,
      riskScore: options.riskScore || this.estimateRisk(intentType, parameters)
    };

    const declared = await this.intentSystem.declare(intent);
    this.intents.push(declared);
    return declared;
  }

  async declareReadIntent(intentType, parameters, reasoning) {
    return this.declareIntent(intentType, parameters, {
      reasoning,
      riskScore: 0,
      isReversible: true
    });
  }

  categorizeIntent(intentType) {
    const categories = {
      query_database: 'read', fetch_metrics: 'read', analyze_data: 'read',
      get_patient_count: 'read', get_revenue_data: 'read', get_appointment_data: 'read',
      update_schedule: 'write', update_config: 'write', create_record: 'write',
      send_email: 'communicate', send_notification: 'communicate', send_sms: 'communicate',
      process_payment: 'financial', update_pricing: 'financial', generate_invoice: 'financial',
      api_call_external: 'external', register_ein: 'external', file_report: 'external',
      open_bank_account: 'external', submit_to_bureau: 'external'
    };
    return categories[intentType] || 'write';
  }

  estimateRisk(intentType, parameters) {
    const riskMap = {
      query_database: 0.05, fetch_metrics: 0.05, analyze_data: 0.05,
      get_patient_count: 0.05, get_revenue_data: 0.1,
      send_email: 0.3, send_notification: 0.2, update_schedule: 0.3,
      update_config: 0.4, create_record: 0.3,
      process_payment: 0.7, update_pricing: 0.6,
      api_call_external: 0.8, register_ein: 0.9, open_bank_account: 0.95,
      file_report: 0.85, submit_to_bureau: 0.9
    };
    return riskMap[intentType] || 0.5;
  }

  // =========================================================================
  // PROPOSAL SUBMISSION
  // =========================================================================

  async submitProposal(proposalData) {
    if (!this.governanceEngine) throw new Error('Governance engine not initialized');

    const proposal = {
      agentId: this.agentId,
      title: proposalData.title,
      summary: proposalData.summary,
      detailedPlan: proposalData.plan || proposalData.detailedPlan,
      rationale: proposalData.rationale,
      category: proposalData.category || this.getDefaultCategory(),
      priority: proposalData.priority || 'medium',
      estimatedImpact: proposalData.estimatedImpact || {},
      estimatedCost: proposalData.estimatedCost || 0,
      vortexScore: proposalData.vortexScore || null
    };

    const submitted = await this.governanceEngine.submitProposal(proposal);
    await this.logAudit('proposal_created', { proposalId: submitted.id, title: proposal.title, vortexScore: proposal.vortexScore });
    return submitted;
  }

  getDefaultCategory() {
    const categoryMap = {
      operations: 'operations', growth: 'growth', corporate_skills: 'corporate',
      revenue: 'finance', compliance: 'compliance', governance: 'governance'
    };
    return categoryMap[this.agentType] || 'operations';
  }

  // =========================================================================
  // BRIEFING GENERATION (Gnostic Style)
  // =========================================================================

  async generateBriefing(observations, analysis, proposals) {
    const briefing = {
      title: `${this.codeName} — Frequency Report`,
      summary: this.summarize(observations, analysis, proposals),
      keyMetrics: analysis.metrics || {},
      insights: (analysis.insights || []).slice(0, 10),
      recommendations: proposals.map(p => ({ title: p.title, priority: p.priority || 'medium' })),
      alerts: (analysis.alerts || []).slice(0, 5)
    };

    try {
      await db.query(`
        INSERT INTO ai_briefings (briefing_date, agent_id, title, summary, key_metrics, insights, recommendations, alerts, category, priority)
        VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (briefing_date, agent_id) DO UPDATE SET
          summary = EXCLUDED.summary, key_metrics = EXCLUDED.key_metrics,
          insights = EXCLUDED.insights, recommendations = EXCLUDED.recommendations,
          alerts = EXCLUDED.alerts
      `, [
        this.agentId, briefing.title, briefing.summary,
        JSON.stringify(briefing.keyMetrics), JSON.stringify(briefing.insights),
        JSON.stringify(briefing.recommendations), JSON.stringify(briefing.alerts),
        this.getDefaultCategory(),
        briefing.alerts.length > 0 ? 'high' : 'medium'
      ]);
    } catch (error) {
      console.error(`Briefing save failed: ${error.message}`);
    }

    return briefing;
  }

  summarize(observations, analysis, proposals) {
    const parts = [];
    if (observations.length > 0) parts.push(`Scanned ${observations.length} frequency channels.`);
    if (analysis.insights?.length > 0) {
      const dissonant = analysis.insights.filter(i => i.severity === 'high').length;
      const harmonic = analysis.insights.length - dissonant;
      if (dissonant > 0) parts.push(`${GNOSIS.DISSONANCE_DETECTED}: ${dissonant} areas of friction found.`);
      if (harmonic > 0) parts.push(`${harmonic} harmonic patterns confirmed.`);
    }
    if (proposals.length > 0) parts.push(`${proposals.length} realignment proposals generated.`);
    if (analysis.alerts?.length > 0) parts.push(`${GNOSIS.ENTROPY_DETECTED}: ${analysis.alerts.length} require Operator attention.`);
    if (parts.length === 0) parts.push(`${GNOSIS.VORTEX_CLEAR} — System operating at optimal frequency.`);
    return parts.join(' ');
  }

  // =========================================================================
  // SKILL EXECUTION (OpenClaw Framework)
  // =========================================================================

  async executeSkill(skillName, inputData, options = {}) {
    if (!this.skillRegistry) throw new Error('Skill registry not initialized');

    const skill = await this.skillRegistry.getSkill(skillName);
    if (!skill) throw new Error(`Skill not found: ${skillName}`);
    if (!skill.is_enabled) throw new Error(`Skill is not enabled: ${skillName}`);

    if (this.complianceEngine) {
      const check = await this.complianceEngine.validateSkillExecution(skill, this.agentId, inputData);
      if (!check.approved) {
        throw new Error(`${GNOSIS.HARMONIC_LOCK} Compliance rejected: ${check.reason}`);
      }
    }

    return this.skillRegistry.executeSkill(skill.id, this.agentId, inputData, options);
  }

  // =========================================================================
  // INTER-AGENT COMMUNICATION (The Gnosis Handshake)
  // =========================================================================

  async sendMessage(toAgentType, messageType, content, references = {}) {
    try {
      const toAgent = await db.query('SELECT id FROM ai_agents WHERE agent_type = $1', [toAgentType]);
      if (!toAgent.rows[0]) return null;

      await db.query(`
        INSERT INTO ai_agent_messages (from_agent_id, to_agent_id, message_type, subject, content, proposal_id, intent_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        this.agentId, toAgent.rows[0].id, messageType,
        content.subject || `${this.codeName} → ${toAgentType}`,
        JSON.stringify(content),
        references.proposalId || null, references.intentId || null
      ]);
    } catch (error) {
      console.error(`Agent message failed: ${error.message}`);
    }
  }

  async getMessages(unreadOnly = true) {
    const result = await db.query(`
      SELECT m.*, a.display_name as from_agent_name 
      FROM ai_agent_messages m
      JOIN ai_agents a ON m.from_agent_id = a.id
      WHERE m.to_agent_id = $1 ${unreadOnly ? "AND m.is_read = false" : ''}
      ORDER BY m.created_at DESC LIMIT 50
    `, [this.agentId]);

    return result.rows;
  }

  // =========================================================================
  // STATE MANAGEMENT
  // =========================================================================

  async updateStatus(status, result = null) {
    this.status = status;
    try {
      await db.query(`
        UPDATE ai_agents SET 
          status = $1, last_run_at = NOW(), last_result = $2,
          error_message = $3, run_count = run_count + CASE WHEN $1 = 'idle' THEN 1 ELSE 0 END,
          updated_at = NOW()
        WHERE id = $4
      `, [status, result ? JSON.stringify(result) : null, result?.error || null, this.agentId]);
    } catch (error) {
      console.error(`Status update failed: ${error.message}`);
    }
  }

  async logAudit(actionType, details, options = {}) {
    try {
      await db.query(`
        INSERT INTO ai_audit_log (agent_id, agent_type, action_type, action_details, reasoning, involved_phi, involved_financial)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        this.agentId, this.agentType, actionType,
        JSON.stringify(details), options.reasoning || null,
        options.involvedPhi || false, options.involvedFinancial || false
      ]);
    } catch (error) {
      console.error(`Audit log failed: ${error.message}`);
    }
  }

  // =========================================================================
  // EMERGENCY CONTROLS
  // =========================================================================

  async shutdown(reason) {
    this.emergencyShutdown = true;
    this.isEnabled = false;
    await this.updateStatus('shutdown');
    await this.logAudit('emergency_shutdown', { reason });
    console.log(`🛑 ${this.codeName} SHUTDOWN: ${reason}`);
  }

  async resume() {
    this.emergencyShutdown = false;
    this.isEnabled = true;
    await this.updateStatus('idle');
    await this.logAudit('agent_resumed', {});
    console.log(`${GNOSIS.AWAKENED} ${this.codeName} resumed`);
  }
}

module.exports = BaseAgent;
module.exports.GNOSIS = GNOSIS;
module.exports.score369 = score369;
module.exports.detectGlitch = detectGlitch;
module.exports.detectArbitrage = detectArbitrage;
module.exports.classifyConstraint = classifyConstraint;
