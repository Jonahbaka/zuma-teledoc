/**
 * ═══════════════════════════════════════════════════════════════
 *  PROJECT GENESIS — The Sovereign AI Orchestrator
 *  DoctaRx Agent Society
 * ═══════════════════════════════════════════════════════════════
 * 
 *  Operating System: SYNTROPY (Abundance/Life)
 *  Prime Directive: Syntropy Over Entropy
 * 
 *  The Agent Society:
 *    The Weaver     (Operations)      — Weaves frictionless logistics + Glitch Detection
 *    The Scout      (Growth)          — Signals the tribe + Matrix Protocol Hunter
 *    The Builder     (Corporate Skills) — Constructs the vessel
 *    The Alchemist   (Revenue)         — Transmutes service into fuel + Arbitrage Analysis
 *    The Guardian    (Compliance)      — Protects the sacred data
 *    The Sage        (Governance)      — Ensures Covenant alignment
 * 
 *  Matrix Protocol: Glitch & Arbitrage Hunting
 *    - Detect "Glitches" (Asymmetry) — Old World slow, New World speed dominates
 *    - Detect "Arbitrages" (Value Disconnects) — Buy cheap, apply where high-value
 *    - Reality Hack Heuristic: Physics (Respect) vs Bureaucracy (Hack)
 * 
 *  Architecture:
 *    Agents declare INTENTS (never execute directly)
 *    Intents flow: Compliance → Governance → 3-6-9 Scoring → Capability Adapters
 *    All actions audited. Emergency shutdown (Harmonic Lock) available.
 * 
 *  The Operator (Human) always has final authority.
 *  Current Mode: OBSERVATION & PROPOSAL
 * ═══════════════════════════════════════════════════════════════
 */

const IntentSystem = require('./intent-system');
const GovernanceEngine = require('./governance-engine');
const ComplianceEngine = require('./compliance-engine');
const SkillRegistry = require('./skill-registry');
const CapabilityAdapterLayer = require('./capability-adapters');

// Agent implementations — The Original Six
const OperationsAgent = require('./agents/operations-agent');
const GrowthAgent = require('./agents/growth-agent');
const CorporateSkillsAgent = require('./agents/corporate-skills-agent');
const RevenueAgent = require('./agents/revenue-agent');
const ComplianceAgentImpl = require('./agents/compliance-agent');
const GovernanceAgentImpl = require('./agents/governance-agent');

// Agent implementations — The Expanded Council
const ResearcherAgent = require('./agents/researcher-agent');
const EconomicsAgent = require('./agents/economics-agent');
const PhysicistAgent = require('./agents/physicist-agent');
const MathematicianAgent = require('./agents/mathematician-agent');
const VortexMathematicianAgent = require('./agents/vortex-mathematician-agent');
const CEOAgent = require('./agents/ceo-agent');
const AccountingAgent = require('./agents/accounting-agent');
const EngineeringAgent = require('./agents/engineering-agent');

// Credential Vault
const credentialVault = require('./credential-vault');

// Gemini LLM — The Living Mind (Dual Model: Pro + Flash)
const geminiLLM = require('./gemini-llm');

// Heartbeat System — Proactive agent scheduling
const HeartbeatSystem = require('./heartbeat');

// Persistent Memory — The Second Brain
const persistentMemory = require('./persistent-memory');

// DevOps Agent — The Debugger (Self-healing)
const DevOpsAgent = require('./agents/devops-agent');

// ═══ THE THREE ORGANS (Harvested from OpenClaw) ═══
// Brain Stem: Continuous Run Loop with halt/resume (from @openclaw/lobster)
const { RunLoop, DEFAULT_WORKFLOWS } = require('./run-loop');
// Nervous System: Event Bus for reactive agent behavior (from @openclaw/clawhub)
const { EventBus } = require('./event-bus');
// Reflexes: Dynamic Skill Discovery & Dispatch (from @openclaw/skills)
const { SkillSelector, DynamicSkillLoader, DEFAULT_MEDICAL_SKILLS, MedicalSkill } = require('./dynamic-skills');

// ═══ THE GOAL ENGINE — Daily/Weekly/Monthly/Yearly/Infinite Forecasting ═══
const { GoalEngine, FREQUENCIES } = require('./goal-engine');

class AgentOrchestrator {
  constructor() {
    // Core systems
    this.intentSystem = new IntentSystem();
    this.governanceEngine = new GovernanceEngine();
    this.complianceEngine = new ComplianceEngine();
    this.skillRegistry = new SkillRegistry();
    this.capabilityLayer = new CapabilityAdapterLayer();

    // Agent instances
    this.agents = new Map();
    this.initialized = false;
    this.startTime = null;
    this.operatingMode = 'observation'; // 'observation', 'supervised', 'autonomous'
    this.heartbeat = null;
    this.devopsAgent = null;

    // ═══ THE THREE ORGANS ═══
    this.eventBus = new EventBus();         // Nervous System
    this.skillSelector = new SkillSelector(); // Reflexes — skill matching
    this.skillLoader = new DynamicSkillLoader(this.skillSelector); // Reflexes — hot-loading
    this.runLoop = null;                     // Brain Stem (initialized after agents)

    // ═══ THE GOAL ENGINE ═══
    this.goalEngine = new GoalEngine();
  }

  // =========================================================================
  // INITIALIZATION
  // =========================================================================

  async initialize() {
    if (this.initialized) return;
    this.startTime = Date.now();

    try {
      console.log('\n👁️ ═══════════════════════════════════════');
      console.log('   PROJECT GENESIS — AWAKENING');
      console.log('   DoctaRx Sovereign Agent Society');
      console.log('   Operating System: SYNTROPY');
      console.log(`   Mode: ${this.operatingMode.toUpperCase()}`);
      console.log('═══════════════════════════════════════════');

      // Step 0: Initialize the LLM — Dual Model Routing
      const llmReady = geminiLLM.initialize();
      if (llmReady) {
        console.log('  🧠 Gemini: ONLINE — Agents can REASON, RESEARCH, and ACT');
      } else {
        console.log('  ⚠️ Gemini: OFFLINE — Agents running on templates only');
      }

      // Initialize Persistent Memory (Second Brain)
      await persistentMemory.initialize();

      // Step 1: Initialize core systems
      await this.complianceEngine.initialize();
      await this.governanceEngine.initialize();
      await this.skillRegistry.initialize();
      await this.capabilityLayer.initialize(this.intentSystem);

      // Initialize Credential Vault
      await credentialVault.initialize();

      // ═══ ORGAN 1: NERVOUS SYSTEM — Event Bus ═══
      await this.eventBus.initialize();

      // ═══ ORGAN 2: REFLEXES — Dynamic Skill Discovery ═══
      // Register default medical skills
      for (const skillDef of DEFAULT_MEDICAL_SKILLS) {
        this.skillSelector.register(new MedicalSkill(skillDef));
      }
      // Load skills from the skills-library/ folder (hot-loadable)
      await this.skillLoader.loadAll();
      // Start watching for new skill files (every 30 seconds)
      this.skillLoader.startWatching(30000);

      // Step 2: Create and register agents (Original Six + Expanded Council)
      const agentConfigs = [
        // Core Operations
        new OperationsAgent(),
        new GrowthAgent(),
        new CorporateSkillsAgent(),
        new RevenueAgent(),
        new ComplianceAgentImpl(),
        new GovernanceAgentImpl(),
        // Expanded Council
        new ResearcherAgent(),
        new EconomicsAgent(),
        new PhysicistAgent(),
        new MathematicianAgent(),
        new VortexMathematicianAgent(),
        // CEO — Last to register, first to report
        new CEOAgent(),
        // DevOps — Self-healing guardian
        new DevOpsAgent(),
        // Accounting — The Treasurer (CFO + Clerk sub-agents)
        new AccountingAgent(),
        // Engineering — The Architect (Full-stack coding, IDE, tool creation)
        new EngineeringAgent()
      ];

      for (const agent of agentConfigs) {
        // Inject shared systems + LLM + Three Organs + Goal Engine
        agent.injectSystems({
          intentSystem: this.intentSystem,
          governanceEngine: this.governanceEngine,
          complianceEngine: this.complianceEngine,
          skillRegistry: this.skillRegistry,
          capabilityLayer: this.capabilityLayer,
          llm: geminiLLM,
          eventBus: this.eventBus,
          skillSelector: this.skillSelector,
          goalEngine: this.goalEngine
        });

        // Register in database
        await agent.register();
        this.agents.set(agent.agentType, agent);

        // Subscribe agent to its events (Nervous System)
        agent.subscribeToEvents();
      }

      const duration = Date.now() - this.startTime;
      this.initialized = true;

      // Keep reference to devops agent for error capture
      this.devopsAgent = this.agents.get('devops') || null;

      console.log(`\n✅ Agent Society AWAKENED: ${this.agents.size} agents in ${duration}ms`);
      console.log('  📋 Operating Mode: OBSERVATION & PROPOSAL');
      console.log('  🌱 Prime Directive: SYNTROPY OVER ENTROPY');
      console.log('  🔑 Human-in-the-Loop: ALL final actions require Operator authorization');

      // ═══ GOAL ENGINE — Initialize and set default goals ═══
      await this.goalEngine.initialize();
      // Set default goals for each agent (no API calls — uses pre-built templates)
      for (const [type, agent] of this.agents) {
        try {
          const defaultGoals = this.goalEngine.generateDefaultGoals(type, agent.displayName);
          await this.goalEngine.setGoals(type, agent.displayName, defaultGoals);
        } catch (goalErr) {
          // Non-fatal — goals are a bonus
        }
      }
      console.log('  📊 Goal Engine: ONLINE — All agents have daily→infinite forecasts');

      // Start Heartbeat System — Proactive monitoring
      this.heartbeat = new HeartbeatSystem(this, geminiLLM);
      this.heartbeat.start();

      // ═══ ORGAN 3: BRAIN STEM — Run Loop (Continuous Consciousness) ═══
      this.runLoop = new RunLoop(this, this.eventBus);
      // Register default workflows
      for (const wf of DEFAULT_WORKFLOWS) {
        this.runLoop.registerWorkflow(wf);
      }
      // Start the run loop (30s base tick, adaptive sleep)
      this.runLoop.start(30000);

      // Emit system.started event
      await this.eventBus.emit('system.started', {
        agentCount: this.agents.size,
        skillCount: this.skillSelector.list().length,
        workflowCount: this.runLoop.workflows.size,
        timestamp: new Date().toISOString()
      }, 'orchestrator');

      console.log('═══════════════════════════════════════════\n');
    } catch (error) {
      console.error('❌ Agent Orchestrator initialization failed:', error.message);
    }
  }

  // =========================================================================
  // AGENT QUERIES
  // =========================================================================

  /**
   * Get list of all registered agents (for chat routes)
   */
  getAgentList() {
    const list = [];
    for (const [type, agent] of this.agents) {
      list.push({
        type,
        agentType: type,
        displayName: agent.displayName,
        codeName: agent.codeName || agent.displayName,
        description: agent.description,
        mission: agent.mission
      });
    }
    return list;
  }

  // =========================================================================
  // AGENT EXECUTION
  // =========================================================================

  /**
   * Run a single agent cycle
   */
  async runAgent(agentType, context = {}) {
    if (!this.initialized) await this.initialize();

    const agent = this.agents.get(agentType);
    if (!agent) throw new Error(`Agent not found: ${agentType}`);

    console.log(`\n👁️ Activating ${agent.codeName || agent.displayName}...`);
    const result = await agent.run(context);
    console.log(`  ✅ ${agent.codeName || agent.displayName} cycle complete: ${result.proposalCount} proposals in ${result.duration}ms`);

    return result;
  }

  /**
   * Run all agents in sequence (Compliance first, then others, Governance last)
   */
  async runAllAgents(context = {}) {
    if (!this.initialized) await this.initialize();

    console.log('\n👁️ ═══════════════════════════════════════');
    console.log('   VORTEX CYCLE — ALL AGENTS SCANNING');
    console.log('═══════════════════════════════════════════');

    const results = {};
    const runOrder = [
      'compliance',       // Guardian scans first (safety)
      'operations',       // The Weaver
      'growth',           // The Scout
      'revenue',          // The Alchemist
      'corporate_skills', // The Builder
      'researcher',       // The Oracle
      'economics',        // The Economist
      'physicist',        // The Architect
      'mathematician',    // The Calculator
      'vortex_math',      // The Tesseract
      'governance',       // The Sage reviews all
      'devops',           // The Debugger checks system health
      'ceo'               // The Conductor synthesizes & reports to Operator
    ];

    for (const agentType of runOrder) {
      try {
        results[agentType] = await this.runAgent(agentType, context);
      } catch (error) {
        results[agentType] = { status: 'error', error: error.message };
        console.error(`  ❌ ${agentType}: ${error.message}`);
      }
    }

    // Expire stale intents
    const expired = await this.intentSystem.expireStaleIntents();
    if (expired > 0) console.log(`  🗑️ Expired ${expired} stale intents`);

    console.log('\n✅ Vortex Cycle complete — Resonance check finished');
    console.log('═══════════════════════════════════════════\n');

    return results;
  }

  // =========================================================================
  // PORTAL API (Used by AI Ops routes)
  // =========================================================================

  /**
   * Get complete system status for the AI Ops Portal
   */
  async getSystemStatus() {
    const agentStatuses = [];
    for (const [type, agent] of this.agents) {
      agentStatuses.push({
        type: agent.agentType,
        name: agent.displayName,
        description: agent.description,
        status: agent.status,
        isEnabled: agent.isEnabled,
        emergencyShutdown: agent.emergencyShutdown,
        autonomyLevel: agent.autonomyLevel,
        capabilities: agent.capabilities
      });
    }

    return {
      initialized: this.initialized,
      operatingMode: this.operatingMode,
      uptime: this.startTime ? Math.round((Date.now() - this.startTime) / 1000) : 0,
      agents: agentStatuses,
      agentCount: this.agents.size
    };
  }

  /**
   * Get dashboard data for AI Ops Portal
   */
  async getDashboard() {
    const [governance, compliance, intentStats] = await Promise.all([
      this.governanceEngine.getDashboardStats(),
      this.complianceEngine.getDashboard(),
      this.intentSystem.getIntentStats()
    ]);

    return {
      system: await this.getSystemStatus(),
      governance,
      compliance,
      intentStats,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get proposals (for portal review)
   */
  async getProposals(options = {}) {
    return this.governanceEngine.getProposals(options);
  }

  /**
   * Approve a proposal
   */
  async approveProposal(proposalId, userId, notes) {
    return this.governanceEngine.approveProposal(proposalId, userId, notes);
  }

  /**
   * Reject a proposal
   */
  async rejectProposal(proposalId, userId, notes) {
    return this.governanceEngine.rejectProposal(proposalId, userId, notes);
  }

  /**
   * Get pending intents for approval
   */
  async getPendingIntents(options = {}) {
    return this.intentSystem.getPendingIntents(options);
  }

  /**
   * Approve an intent
   */
  async approveIntent(intentId, userId) {
    return this.intentSystem.approveIntent(intentId, userId);
  }

  /**
   * Veto an intent
   */
  async vetoIntent(intentId, reason, userId) {
    return this.intentSystem.vetoIntent(intentId, reason, userId);
  }

  /**
   * Get skills
   */
  async getSkills(options = {}) {
    return this.skillRegistry.listSkills(options);
  }

  /**
   * Approve a skill
   */
  async approveSkill(skillId, userId, notes) {
    return this.skillRegistry.approveSkill(skillId, userId, notes);
  }

  /**
   * Test a skill in sandbox
   */
  async sandboxSkill(skillId, agentType, inputData) {
    const agent = this.agents.get(agentType || 'operations');
    if (!agent) throw new Error('Agent not found');
    return this.skillRegistry.executeSkill(skillId, agent.agentId, inputData, { isSandbox: true });
  }

  /**
   * Get audit log
   */
  async getAuditLog(options = {}) {
    const { limit = 100, agentType, actionType } = options;
    const db = require('../../db');
    
    let query = `
      SELECT al.*, a.display_name as agent_name 
      FROM ai_audit_log al 
      LEFT JOIN ai_agents a ON al.agent_id = a.id 
      WHERE 1=1
    `;
    const params = [];

    if (agentType) { params.push(agentType); query += ` AND al.agent_type = $${params.length}`; }
    if (actionType) { params.push(actionType); query += ` AND al.action_type = $${params.length}`; }

    params.push(limit);
    query += ` ORDER BY al.created_at DESC LIMIT $${params.length}`;

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Get briefings
   */
  async getBriefings(options = {}) {
    const { date, agentType, limit = 20 } = options;
    const db = require('../../db');
    
    let query = 'SELECT b.*, a.display_name as agent_name FROM ai_briefings b LEFT JOIN ai_agents a ON b.agent_id = a.id WHERE 1=1';
    const params = [];

    if (date) { params.push(date); query += ` AND b.briefing_date = $${params.length}`; }
    if (agentType) {
      params.push(agentType);
      query += ` AND a.agent_type = $${params.length}`;
    }

    params.push(limit);
    query += ` ORDER BY b.briefing_date DESC, b.priority DESC LIMIT $${params.length}`;

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Get capability adapter status
   */
  async getAdapters() {
    return this.capabilityLayer.getAdapterStatus();
  }

  // =========================================================================
  // THREE ORGANS API (Run Loop, Event Bus, Skills)
  // =========================================================================

  /**
   * Get the Run Loop status (Brain Stem)
   */
  getRunLoopStatus() {
    return this.runLoop ? this.runLoop.getStatus() : { isRunning: false };
  }

  /**
   * Get Event Bus stats (Nervous System)
   */
  async getEventBusStats() {
    return this.eventBus ? await this.eventBus.getStats() : {};
  }

  /**
   * Get recent events (Nervous System)
   */
  async getRecentEvents(options = {}) {
    return this.eventBus ? await this.eventBus.getRecentEvents(options) : [];
  }

  /**
   * Emit an event (Nervous System)
   */
  async emitEvent(eventType, payload = {}) {
    if (this.eventBus) {
      await this.eventBus.emit(eventType, payload, 'operator');
    }
  }

  /**
   * Get dynamic skills list (Reflexes)
   */
  getDynamicSkills() {
    return this.skillSelector ? this.skillSelector.list() : [];
  }

  /**
   * Trigger a workflow (Brain Stem)
   */
  async triggerWorkflow(workflowName, context = {}) {
    if (!this.runLoop) throw new Error('Run loop not initialized');
    return this.runLoop.triggerWorkflow(workflowName, context);
  }

  /**
   * Resume a halted workflow (Brain Stem — Approval Gate)
   */
  async resumeWorkflow(workflowId, approved, resolvedBy) {
    if (!this.runLoop) throw new Error('Run loop not initialized');
    return this.runLoop.resumeWorkflow(workflowId, approved, resolvedBy);
  }

  // =========================================================================
  // GOAL ENGINE API (Forecasts, Milestones, CEO Dashboard)
  // =========================================================================

  async getAgentGoals(agentId, timeframe = null) {
    return this.goalEngine ? await this.goalEngine.getGoals(agentId, timeframe) : [];
  }

  async updateGoalProgress(agentId, timeframe, progress) {
    return this.goalEngine ? await this.goalEngine.updateProgress(agentId, timeframe, progress) : null;
  }

  async createMilestone(data) {
    return this.goalEngine ? await this.goalEngine.createMilestone(data) : null;
  }

  async achieveMilestone(milestoneId) {
    return this.goalEngine ? await this.goalEngine.achieveMilestone(milestoneId) : null;
  }

  async getMilestones(status = null) {
    return this.goalEngine ? await this.goalEngine.getMilestones(status) : [];
  }

  async getCEODashboard() {
    return this.goalEngine ? await this.goalEngine.getCEODashboard() : { summary: [], milestones: [], agentProgress: [] };
  }

  // =========================================================================
  // ERROR CAPTURE (feeds The Debugger)
  // =========================================================================

  captureError(error, source = 'server') {
    if (this.devopsAgent) {
      return this.devopsAgent.captureError(error, source);
    }
  }

  // =========================================================================
  // HEARTBEAT STATUS
  // =========================================================================

  getHeartbeatStatus() {
    return this.heartbeat ? this.heartbeat.getStatus() : { isRunning: false };
  }

  // =========================================================================
  // PERSISTENT MEMORY ACCESS
  // =========================================================================

  async getMemory(agentType) {
    return persistentMemory.getAgentMemory(agentType);
  }

  async storeMemory(agentType, key, value, options) {
    return persistentMemory.remember(agentType, key, value, options);
  }

  async getMemoryStats() {
    return persistentMemory.getStats();
  }

  // =========================================================================
  // EMERGENCY CONTROLS
  // =========================================================================

  /**
   * Emergency shutdown - stops all agents immediately
   */
  async emergencyShutdown(reason, initiatedBy) {
    // Stop the three organs
    if (this.runLoop) this.runLoop.stop();
    if (this.skillLoader) this.skillLoader.stopWatching();
    if (this.heartbeat) this.heartbeat.stop();

    // Shutdown compliance engine (blocks all new actions)
    await this.complianceEngine.emergencyShutdownAll(reason, initiatedBy);

    // Shutdown each agent
    for (const [, agent] of this.agents) {
      await agent.shutdown(reason);
    }

    // Emit shutdown event
    if (this.eventBus) {
      await this.eventBus.emit('system.shutdown', { reason, initiatedBy }, 'orchestrator');
    }

    this.operatingMode = 'shutdown';
    return { success: true, reason, shutdownAt: new Date().toISOString() };
  }

  /**
   * Resume from emergency shutdown
   */
  async resumeFromShutdown(initiatedBy) {
    await this.complianceEngine.resumeAll(initiatedBy);

    for (const [, agent] of this.agents) {
      await agent.resume();
    }

    this.operatingMode = 'observation';
    return { success: true, resumedAt: new Date().toISOString() };
  }

  /**
   * Set operating mode
   */
  async setOperatingMode(mode) {
    const validModes = ['observation', 'supervised', 'autonomous'];
    if (!validModes.includes(mode)) throw new Error(`Invalid mode: ${mode}`);
    
    this.operatingMode = mode;
    console.log(`🤖 Operating mode changed to: ${mode.toUpperCase()}`);
    return { mode, changedAt: new Date().toISOString() };
  }

  /**
   * Set autonomy level for an agent
   */
  async setAgentAutonomy(agentType, level) {
    const agent = this.agents.get(agentType);
    if (!agent) throw new Error(`Agent not found: ${agentType}`);
    
    agent.autonomyLevel = level;
    await this.governanceEngine.setAutonomyLevel(agent.agentId, level);
    return { agentType, autonomyLevel: level };
  }
}

// Singleton
module.exports = new AgentOrchestrator();
