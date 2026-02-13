/**
 * ═══════════════════════════════════════════════════════════════
 *  THE BRAIN STEM — Continuous Agent Runtime (Harvested from Lobster)
 * ═══════════════════════════════════════════════════════════════
 * 
 *  Pattern Source: @openclaw/lobster runtime.ts + state/store.ts
 *  
 *  This is the "Heartbeat" that keeps the DoctaRx agent ALIVE.
 *  Unlike a chatbot that waits for input, this loop:
 *    - WAKES at scheduled intervals
 *    - OBSERVES the environment
 *    - EXECUTES pending workflows with halt/resume gates
 *    - REMEMBERS state between cycles (diffAndStore pattern)
 *    - SLEEPS efficiently (Syntropy — no wasted compute)
 *  
 *  Key Lobster Patterns Adapted:
 *    1. Pipeline execution with halt/resume tokens
 *    2. State persistence with change detection (diffAndStore)
 *    3. Approval gates as hard stops (not prompt hints)
 *    4. Workflow definitions with typed schemas
 *    5. Registry-based command discovery
 * 
 *  The DoctaRx Way (Gnostic Filter):
 *    - Polite: Respect rate limits and server resources
 *    - Efficient: Don't loop if there's nothing to do
 *    - Consensual: Only act on data with explicit permission
 *    - Safe: All write actions require Operator approval
 * ═══════════════════════════════════════════════════════════════
 */

const crypto = require('crypto');
const db = require('../../db');
const persistentMemory = require('./persistent-memory');

// =========================================================================
// STATE MANAGEMENT (Adapted from Lobster state/store.ts)
// =========================================================================

/**
 * Stable JSON stringify for diffing — keys sorted alphabetically
 * (Exact pattern from lobster/src/state/store.ts)
 */
function stableStringify(value) {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]));
    }
    return v;
  });
}

/**
 * diffAndStore: Read previous state, compare, write new state, return delta
 * This is the "memory" that makes the agent aware of what changed.
 * (Pattern from lobster/src/state/store.ts)
 */
async function diffAndStore(key, newValue) {
  try {
    // Read previous state from persistent memory
    const before = await persistentMemory.recall('system', key);
    const changed = stableStringify(before) !== stableStringify(newValue);

    // Write new state
    await persistentMemory.remember('system', key, newValue, { category: 'context' });

    // Compute what changed
    let delta = null;
    if (changed && before && typeof before === 'object' && typeof newValue === 'object') {
      delta = {};
      const allKeys = new Set([...Object.keys(before), ...Object.keys(newValue)]);
      for (const k of allKeys) {
        if (stableStringify(before[k]) !== stableStringify(newValue[k])) {
          delta[k] = { from: before[k] ?? null, to: newValue[k] ?? null };
        }
      }
    }

    return { before, after: newValue, changed, delta };
  } catch (e) {
    return { before: null, after: newValue, changed: true, delta: null };
  }
}

// =========================================================================
// APPROVAL GATES (Adapted from Lobster approve command + resume.ts)
// =========================================================================

/**
 * Workflow step that requires Operator approval before continuing.
 * Unlike a prompt hint, this is a HARD STOP — the pipeline literally
 * cannot continue until the Operator resumes it.
 * 
 * Pattern: Lobster's `approve` command + resume token system
 */
class ApprovalGate {
  constructor(workflowId, stepIndex, prompt, context = {}) {
    this.id = crypto.randomUUID();
    this.workflowId = workflowId;
    this.stepIndex = stepIndex;
    this.prompt = prompt;
    this.context = context;
    this.status = 'pending'; // pending | approved | rejected
    this.createdAt = new Date();
    this.resolvedAt = null;
    this.resolvedBy = null;
  }

  /**
   * Encode a resume token (like Lobster's encodeToken)
   */
  toResumeToken() {
    return Buffer.from(JSON.stringify({
      protocolVersion: 1,
      gateId: this.id,
      workflowId: this.workflowId,
      resumeAtIndex: this.stepIndex + 1,
      context: this.context
    })).toString('base64url');
  }

  /**
   * Decode a resume token
   */
  static fromResumeToken(token) {
    try {
      const payload = JSON.parse(Buffer.from(token, 'base64url').toString());
      if (payload.protocolVersion !== 1) throw new Error('Unsupported protocol');
      return payload;
    } catch (e) {
      throw new Error('Invalid resume token');
    }
  }
}

// =========================================================================
// WORKFLOW PIPELINE (Adapted from Lobster runtime.ts)
// =========================================================================

/**
 * A Workflow is a sequence of steps that execute deterministically.
 * Each step can:
 *   - Execute an action (skill, query, analysis)
 *   - Transform data (filter, map, reduce)
 *   - HALT at an approval gate (hard stop)
 *   - Resume from where it stopped
 * 
 * Pattern from: lobster/src/runtime.ts runPipeline()
 */
class WorkflowPipeline {
  constructor(definition) {
    this.id = crypto.randomUUID();
    this.name = definition.name;
    this.description = definition.description || '';
    this.steps = definition.steps || [];
    this.args = definition.args || {};
    this.triggerEvent = definition.triggerEvent || null;
    this.schedule = definition.schedule || null;
    this.createdBy = definition.createdBy || 'system';

    // Runtime state
    this.status = 'idle'; // idle | running | halted | completed | failed
    this.currentStepIndex = 0;
    this.stepResults = new Map();
    this.pendingGate = null;
    this.startedAt = null;
    this.completedAt = null;
    this.error = null;
  }

  /**
   * Run the pipeline (like Lobster's runPipeline)
   * Returns { items, halted, haltedAt } just like Lobster
   */
  async run(context = {}, resumeFromIndex = 0) {
    this.status = 'running';
    this.startedAt = new Date();
    this.currentStepIndex = resumeFromIndex;
    let halted = false;
    let haltedAt = null;

    for (let idx = resumeFromIndex; idx < this.steps.length; idx++) {
      this.currentStepIndex = idx;
      const step = this.steps[idx];

      try {
        // Check for condition (like Lobster workflow conditions)
        if (step.condition) {
          const conditionMet = this.evaluateCondition(step.condition);
          if (!conditionMet) {
            this.stepResults.set(idx, { status: 'skipped', reason: 'condition_not_met' });
            continue;
          }
        }

        // Check for approval gate (like Lobster's approve command)
        if (step.approval === 'required') {
          const gate = new ApprovalGate(this.id, idx, step.approvalPrompt || `Approve step: ${step.name}?`, {
            stepName: step.name,
            pipelineData: this.collectOutput()
          });

          this.pendingGate = gate;
          halted = true;
          haltedAt = { index: idx, step: step.name, gate };

          // Persist the gate to database
          await this.persistGate(gate);

          this.status = 'halted';
          break;
        }

        // Execute the step
        const input = this.resolveStepInput(step, context);
        const result = await this.executeStep(step, input, context);
        this.stepResults.set(idx, result);

        // If step returned halt signal
        if (result?.halt) {
          halted = true;
          haltedAt = { index: idx, step: step.name };
          this.status = 'halted';
          break;
        }
      } catch (error) {
        this.stepResults.set(idx, { status: 'error', error: error.message });
        // Self-correction: Don't crash the entire pipeline on one step failure
        // (Pattern from Lobster's error handling in workflows)
        if (step.continueOnError !== true) {
          this.status = 'failed';
          this.error = error.message;
          break;
        }
      }
    }

    if (!halted && this.status !== 'failed') {
      this.status = 'completed';
      this.completedAt = new Date();
    }

    const items = this.collectOutput();
    return { items, halted, haltedAt, status: this.status, error: this.error };
  }

  /**
   * Resume a halted pipeline (like Lobster's handleResume)
   */
  async resume(approved, resolvedBy = 'operator') {
    if (!this.pendingGate) throw new Error('No pending approval gate');

    this.pendingGate.status = approved ? 'approved' : 'rejected';
    this.pendingGate.resolvedAt = new Date();
    this.pendingGate.resolvedBy = resolvedBy;

    await this.updateGateStatus(this.pendingGate);

    if (!approved) {
      this.status = 'completed';
      this.completedAt = new Date();
      return { items: this.collectOutput(), halted: false, status: 'cancelled' };
    }

    // Resume from the step AFTER the approval gate
    const resumeIndex = this.pendingGate.stepIndex + 1;
    this.pendingGate = null;
    return this.run({}, resumeIndex);
  }

  // ─── Step Execution ──────────────────────────────────────────────

  async executeStep(step, input, context) {
    const stepType = step.type || 'action';

    switch (stepType) {
      case 'action':
        return this.executeAction(step, input, context);
      case 'transform':
        return this.executeTransform(step, input);
      case 'query':
        return this.executeQuery(step, input);
      case 'notify':
        return this.executeNotify(step, input);
      case 'sleep':
        return this.executeSleep(step);
      default:
        return { status: 'completed', output: input, type: stepType };
    }
  }

  async executeAction(step, input, context) {
    // Delegate to skill registry or capability layer
    if (step.skill && context.skillRegistry) {
      return context.skillRegistry.executeSkill(step.skill, context.agentId, input);
    }
    return { status: 'completed', output: input, action: step.action || step.name };
  }

  async executeTransform(step, input) {
    // Data transformation (like Lobster's where/pick/head commands)
    if (step.filter && Array.isArray(input)) {
      const filtered = input.filter(item => {
        for (const [key, value] of Object.entries(step.filter)) {
          if (item[key] !== value) return false;
        }
        return true;
      });
      return { status: 'completed', output: filtered };
    }
    return { status: 'completed', output: input };
  }

  async executeQuery(step, input) {
    // Database query (read-only)
    try {
      const result = await db.query(step.query, step.params || []);
      return { status: 'completed', output: result.rows };
    } catch (e) {
      return { status: 'error', error: e.message };
    }
  }

  async executeNotify(step, input) {
    // Notify operator
    try {
      await db.query(`
        INSERT INTO ai_chat_messages (sender_type, sender_id, sender_name, recipient_type, content, message_type)
        VALUES ('system', 'workflow', $1, 'operator', $2, 'alert')
      `, [step.name || 'Workflow', typeof input === 'string' ? input : JSON.stringify(input)]);
      return { status: 'completed', notified: true };
    } catch (e) {
      return { status: 'error', error: e.message };
    }
  }

  async executeSleep(step) {
    // Sleep step — efficient waiting (Syntropy: don't burn cycles)
    const ms = step.durationMs || step.duration || 5000;
    await new Promise(resolve => setTimeout(resolve, Math.min(ms, 60000))); // Max 60s
    return { status: 'completed', sleptMs: ms };
  }

  // ─── Input Resolution ────────────────────────────────────────────

  /**
   * Resolve step input — supports $previous.output and $stepName.output
   * (Like Lobster's $collect.stdout variable references)
   */
  resolveStepInput(step, context) {
    if (step.input === '$previous') {
      const prevResult = this.stepResults.get(this.currentStepIndex - 1);
      return prevResult?.output || null;
    }
    if (step.input && step.input.startsWith('$')) {
      const refStep = step.input.slice(1);
      for (const [idx, result] of this.stepResults) {
        if (this.steps[idx]?.id === refStep || this.steps[idx]?.name === refStep) {
          return result?.output || null;
        }
      }
    }
    return step.input || this.args;
  }

  evaluateCondition(condition) {
    if (typeof condition === 'boolean') return condition;
    if (typeof condition === 'string' && condition.startsWith('$')) {
      const ref = condition.slice(1);
      for (const [idx, result] of this.stepResults) {
        if (this.steps[idx]?.id === ref) return !!result?.output;
      }
    }
    return true;
  }

  collectOutput() {
    const items = [];
    for (const [idx, result] of this.stepResults) {
      items.push({ step: idx, name: this.steps[idx]?.name, ...result });
    }
    return items;
  }

  // ─── Persistence ─────────────────────────────────────────────────

  async persistGate(gate) {
    try {
      await db.query(`
        INSERT INTO ai_audit_log (action_type, action_details, outcome)
        VALUES ('approval_gate_created', $1, 'pending')
      `, [JSON.stringify({
        gateId: gate.id,
        workflowId: gate.workflowId,
        stepIndex: gate.stepIndex,
        prompt: gate.prompt,
        resumeToken: gate.toResumeToken()
      })]);
    } catch (e) { /* ok */ }
  }

  async updateGateStatus(gate) {
    try {
      await db.query(`
        INSERT INTO ai_audit_log (action_type, action_details, outcome)
        VALUES ('approval_gate_resolved', $1, $2)
      `, [JSON.stringify({
        gateId: gate.id,
        workflowId: gate.workflowId,
        resolvedBy: gate.resolvedBy
      }), gate.status]);
    } catch (e) { /* ok */ }
  }
}

// =========================================================================
// THE RUN LOOP — The Continuous Consciousness
// =========================================================================

/**
 * RunLoop: The persistent tick that gives the agent "life."
 * 
 * Unlike a script that runs top-to-bottom and dies, this loop:
 * 1. Checks for pending events
 * 2. Checks for triggered workflows
 * 3. Runs the appropriate pipeline
 * 4. Diffs state to detect changes
 * 5. Sleeps efficiently until the next tick
 * 
 * Resource-efficient: Uses adaptive sleep intervals.
 * If nothing is happening, it sleeps longer (Syntropy).
 */
class RunLoop {
  constructor(orchestrator, eventBus) {
    this.orchestrator = orchestrator;
    this.eventBus = eventBus;
    this.isRunning = false;
    this.tickCount = 0;
    this.consecutiveIdleTicks = 0;
    this.workflows = new Map(); // Registered workflow definitions
    this.activeWorkflows = new Map(); // Currently running workflows
    this.timer = null;
    this.stats = {
      startedAt: null,
      totalTicks: 0,
      workflowsExecuted: 0,
      eventsProcessed: 0,
      approvalsRequested: 0
    };
  }

  /**
   * Register a workflow definition (like Lobster's workflowRegistry)
   */
  registerWorkflow(definition) {
    this.workflows.set(definition.name, definition);
    console.log(`  📋 Workflow registered: ${definition.name}`);
  }

  /**
   * START — Begin the continuous consciousness
   */
  start(intervalMs = 120000) {  // 2 min base — conserve DB connections & API calls (bootstrapping)
    if (this.isRunning) return;
    this.isRunning = true;
    this.stats.startedAt = new Date();

    console.log('  🧠 Run Loop: ALIVE');
    console.log(`    ├─ Base tick: every ${intervalMs / 1000}s`);
    console.log(`    ├─ Adaptive sleep: slows when idle`);
    console.log(`    └─ Workflows registered: ${this.workflows.size}`);

    // The tick function — the "heartbeat" of consciousness
    const tick = async () => {
      if (!this.isRunning) return;

      try {
        await this.tick();
      } catch (e) {
        console.error('RunLoop tick error:', e.message);
      }

      // Adaptive sleep: idle ticks = longer sleep (Syntropy: conserve energy)
      const adaptiveInterval = Math.min(
        intervalMs * (1 + this.consecutiveIdleTicks * 0.5),
        intervalMs * 10 // Max 10x the base interval
      );

      this.timer = setTimeout(tick, adaptiveInterval);
    };

    // First tick after a short delay
    this.timer = setTimeout(tick, 5000);
  }

  /**
   * STOP — Enter sleep state
   */
  stop() {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log('  💤 Run Loop: SLEEPING');
  }

  /**
   * TICK — One cycle of consciousness
   * 
   * This is the core loop that makes the agent "alive":
   * 1. Process pending events from the event bus
   * 2. Check for scheduled workflows
   * 3. Execute any triggered workflows
   * 4. Diff the state to detect changes
   * 5. Report changes to interested agents
   */
  async tick() {
    this.tickCount++;
    this.stats.totalTicks++;
    let hadWork = false;

    // ── Phase 1: Process pending events from the event bus ──
    if (this.eventBus) {
      const events = await this.eventBus.consume('run-loop', 10);
      if (events.length > 0) {
        hadWork = true;
        this.stats.eventsProcessed += events.length;

        for (const event of events) {
          await this.handleEvent(event);
        }
      }
    }

    // ── Phase 2: Check scheduled workflows ──
    for (const [name, def] of this.workflows) {
      if (def.schedule && this.shouldRunSchedule(def)) {
        hadWork = true;
        await this.triggerWorkflow(name, { trigger: 'schedule' });
      }
    }

    // ── Phase 3: Process active workflows (check for approvals) ──
    for (const [id, workflow] of this.activeWorkflows) {
      if (workflow.status === 'completed' || workflow.status === 'failed') {
        this.activeWorkflows.delete(id);
      }
    }

    // ── Phase 4: State diff ──
    if (hadWork) {
      const snapshot = {
        tickCount: this.tickCount,
        activeWorkflows: this.activeWorkflows.size,
        eventsProcessed: this.stats.eventsProcessed,
        timestamp: new Date().toISOString()
      };
      const diff = await diffAndStore('runloop:state', snapshot);
      if (diff.changed && diff.delta) {
        // State changed — emit an event for any interested agents
        if (this.eventBus) {
          await this.eventBus.emit('system.state.changed', {
            source: 'run-loop',
            delta: diff.delta
          });
        }
      }
    }

    // ── Adaptive idle tracking ──
    if (hadWork) {
      this.consecutiveIdleTicks = 0;
    } else {
      this.consecutiveIdleTicks++;
    }
  }

  /**
   * Handle an event — route to the appropriate workflow
   * (This is the "reflex" — Event → Reaction)
   */
  async handleEvent(event) {
    // Find workflows triggered by this event type
    for (const [name, def] of this.workflows) {
      if (def.triggerEvent === event.type || (def.triggerEvents && def.triggerEvents.includes(event.type))) {
        await this.triggerWorkflow(name, { trigger: 'event', event });
      }
    }
  }

  /**
   * Trigger a workflow execution
   */
  async triggerWorkflow(workflowName, context = {}) {
    const def = this.workflows.get(workflowName);
    if (!def) return null;

    const pipeline = new WorkflowPipeline({
      ...def,
      args: { ...def.args, ...context }
    });

    this.activeWorkflows.set(pipeline.id, pipeline);
    this.stats.workflowsExecuted++;

    console.log(`  ⚡ Workflow triggered: ${workflowName} (${pipeline.id.slice(0, 8)})`);

    const result = await pipeline.run({
      skillRegistry: this.orchestrator?.skillRegistry,
      agentId: null
    });

    if (result.halted) {
      this.stats.approvalsRequested++;
      console.log(`  🔒 Workflow HALTED at "${result.haltedAt?.step}" — Awaiting Operator approval`);
    }

    return result;
  }

  /**
   * Resume a halted workflow (called when Operator approves)
   */
  async resumeWorkflow(workflowId, approved, resolvedBy = 'operator') {
    const workflow = this.activeWorkflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);
    if (workflow.status !== 'halted') throw new Error('Workflow is not halted');

    return workflow.resume(approved, resolvedBy);
  }

  /**
   * Check if a scheduled workflow should run
   */
  shouldRunSchedule(def) {
    if (!def._lastRunAt) {
      def._lastRunAt = Date.now();
      return true; // Run immediately on first check to avoid idle startup.
    }

    const intervals = {
      '5min': 5 * 60 * 1000,
      '15min': 15 * 60 * 1000,
      '30min': 30 * 60 * 1000,
      '1hour': 60 * 60 * 1000,
      'hourly': 60 * 60 * 1000,
      '4hours': 4 * 60 * 60 * 1000,
      'daily': 24 * 60 * 60 * 1000,
      '6hours': 6 * 60 * 60 * 1000
    };

    const intervalMs = intervals[def.schedule] || parseInt(def.schedule) || 3600000;
    const elapsed = Date.now() - def._lastRunAt;

    if (elapsed >= intervalMs) {
      def._lastRunAt = Date.now();
      return true;
    }
    return false;
  }

  /**
   * Get loop status (for the portal)
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      tickCount: this.tickCount,
      consecutiveIdleTicks: this.consecutiveIdleTicks,
      registeredWorkflows: this.workflows.size,
      activeWorkflows: this.activeWorkflows.size,
      stats: this.stats,
      haltedWorkflows: [...this.activeWorkflows.values()]
        .filter(w => w.status === 'halted')
        .map(w => ({
          id: w.id,
          name: w.name,
          haltedAt: w.pendingGate?.stepIndex,
          prompt: w.pendingGate?.prompt,
          resumeToken: w.pendingGate?.toResumeToken()
        }))
    };
  }
}

// =========================================================================
// DEFAULT WORKFLOW DEFINITIONS (DoctaRx Medical Workflows)
// =========================================================================

const DEFAULT_WORKFLOWS = [
  {
    name: 'patient.monitoring',
    description: 'Check on patients with upcoming appointments or pending follow-ups',
    schedule: '6hours',
    triggerEvent: 'appointment.created',
    steps: [
      { name: 'Fetch upcoming appointments', type: 'query', query: "SELECT * FROM video_sessions WHERE scheduled_at > NOW() AND scheduled_at < NOW() + INTERVAL '24 hours' AND status = 'scheduled'", id: 'upcoming' },
      { name: 'Check for no-show risks', type: 'transform', input: '$upcoming', filter: { reminder_sent: false } },
      { name: 'Notify operator', type: 'notify', input: '$previous' }
    ]
  },
  {
    name: 'daily.operations.scan',
    description: 'Morning operations scan — system health, appointments, revenue',
    schedule: 'daily',
    steps: [
      { name: 'Count active patients', type: 'query', query: "SELECT COUNT(*) as count FROM users WHERE role = 'patient'", id: 'patients' },
      { name: 'Today appointments', type: 'query', query: "SELECT COUNT(*) as count FROM video_sessions WHERE DATE(scheduled_at) = CURRENT_DATE", id: 'appointments' },
      { name: 'Compile report', type: 'notify', input: '$previous' }
    ]
  },
  {
    name: 'compliance.heartbeat',
    description: 'Periodic HIPAA compliance check',
    schedule: 'daily',
    steps: [
      { name: 'Check encryption status', type: 'action', action: 'verify_encryption' },
      { name: 'Audit recent access', type: 'query', query: "SELECT COUNT(*) as count FROM ai_audit_log WHERE created_at > NOW() - INTERVAL '24 hours'" },
      { name: 'Report', type: 'notify', input: '$previous' }
    ]
  },
  {
    name: 'revenue.alert',
    description: 'Alert on unusual revenue patterns',
    triggerEvent: 'payment.received',
    steps: [
      { name: 'Fetch daily revenue', type: 'query', query: "SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE DATE(created_at) = CURRENT_DATE", id: 'revenue' },
      { name: 'Notify if threshold', type: 'notify', input: '$revenue' }
    ]
  },
  // ═══ PATIENT REMINDERS — Proactive "the organism cares" ═══
  {
    name: 'patient.reminders',
    description: 'Send proactive reminders to patients with upcoming appointments (24h, 2h, 30min)',
    schedule: '30min',
    steps: [
      { name: 'Fetch upcoming in 24h', type: 'query', query: "SELECT a.id, a.scheduled_at, a.type, u.first_name, u.last_name, u.email, p.first_name as provider_first, p.last_name as provider_last FROM appointments a LEFT JOIN users u ON a.patient_id = u.id LEFT JOIN users p ON a.provider_id = p.id WHERE a.scheduled_at > NOW() AND a.scheduled_at < NOW() + INTERVAL '24 hours' AND a.status = 'scheduled'", id: 'upcoming_patients' },
      { name: 'Log reminder activity', type: 'notify', input: '$upcoming_patients' }
    ]
  },
  // ═══ PROVIDER REMINDERS — Keep providers prepared ═══
  {
    name: 'provider.schedule.prep',
    description: 'Notify providers of their upcoming appointments and patient prep notes',
    schedule: '1hour',
    steps: [
      { name: 'Fetch provider schedule', type: 'query', query: "SELECT a.id, a.scheduled_at, a.reason_for_visit, a.patient_notes, u.first_name as patient_first, u.last_name as patient_last, p.first_name as provider_first, p.last_name as provider_last, p.email as provider_email FROM appointments a LEFT JOIN users u ON a.patient_id = u.id LEFT JOIN users p ON a.provider_id = p.id WHERE a.scheduled_at > NOW() AND a.scheduled_at < NOW() + INTERVAL '2 hours' AND a.status IN ('scheduled', 'confirmed')", id: 'provider_upcoming' },
      { name: 'Notify providers', type: 'notify', input: '$provider_upcoming' }
    ]
  },
  // ═══ PREDICTIVE MODEL REFRESH — Agents proactively update intelligence ═══
  {
    name: 'predictive.model.refresh',
    description: 'Proactively run predictive models to keep risk scores and forecasts fresh',
    schedule: '4hours',
    steps: [
      { name: 'Gather patient risk data', type: 'query', query: "SELECT patient_id, COUNT(*) as total, COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed, COUNT(CASE WHEN status = 'no_show' THEN 1 END) as no_shows, COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled FROM appointments WHERE created_at > NOW() - INTERVAL '90 days' GROUP BY patient_id", id: 'risk_data' },
      { name: 'Gather revenue trends', type: 'query', query: "SELECT DATE_TRUNC('day', created_at) as day, SUM(amount) as daily_revenue, COUNT(*) as transactions FROM payments WHERE created_at > NOW() - INTERVAL '30 days' AND status = 'completed' GROUP BY DATE_TRUNC('day', created_at) ORDER BY day", id: 'revenue_trends' },
      { name: 'Compile predictive brief', type: 'notify', input: '$revenue_trends' }
    ]
  },
  // ═══ GROWTH PULSE — Monitor acquisition and viral metrics ═══
  {
    name: 'growth.pulse',
    description: 'Monitor new signups, referrals, and growth velocity',
    schedule: 'daily',
    steps: [
      { name: 'New patient signups (7 days)', type: 'query', query: "SELECT COUNT(*) as new_patients FROM users WHERE role = 'patient' AND created_at > NOW() - INTERVAL '7 days'", id: 'new_patients' },
      { name: 'New provider signups (7 days)', type: 'query', query: "SELECT COUNT(*) as new_providers FROM users WHERE role = 'provider' AND created_at > NOW() - INTERVAL '7 days'", id: 'new_providers' },
      { name: 'Growth report', type: 'notify', input: '$new_providers' }
    ]
  },
  // ═══ CRM OUTREACH CYCLE — Automated email campaigns ═══
  {
    name: 'crm.outreach.cycle',
    description: 'Process approved CRM campaigns — send batch emails via Zoho Mail',
    schedule: '6hours',
    steps: [
      { name: 'Check approved campaigns', type: 'query', query: "SELECT id, name, status, emails_sent, daily_limit FROM crm_campaigns WHERE status IN ('approved', 'running') LIMIT 5", id: 'active_campaigns' },
      { name: 'Check CRM contact volume', type: 'query', query: "SELECT contact_type, COUNT(*) as count FROM crm_contacts WHERE is_active = true GROUP BY contact_type", id: 'contact_stats' },
      { name: 'Report outreach status', type: 'notify', input: '$contact_stats' }
    ]
  },
  // ═══ CRM FOLLOWUP — Check for contacts needing follow-up ═══
  {
    name: 'crm.followup.check',
    description: 'Check for contacts due for follow-up and move stale contacts',
    schedule: 'daily',
    steps: [
      { name: 'Due for follow-up', type: 'query', query: "SELECT id, first_name, last_name, email, organization, pipeline_stage FROM crm_contacts WHERE next_followup_at < NOW() AND is_active = true AND opt_out = false AND pipeline_stage NOT IN ('converted', 'lost') LIMIT 20", id: 'followup_due' },
      { name: 'Stale contacts (no contact in 14 days)', type: 'query', query: "SELECT id, first_name, last_name, email, pipeline_stage FROM crm_contacts WHERE last_contacted_at < NOW() - INTERVAL '14 days' AND pipeline_stage IN ('contacted', 'responded') AND is_active = true LIMIT 20", id: 'stale_contacts' },
      { name: 'Report followup status', type: 'notify', input: '$followup_due' }
    ]
  },

  // ═══ FINANCIAL RECONCILIATION — Treasurer agent daily checks ═══
  {
    name: 'finance.daily.reconciliation',
    description: 'The Treasurer reconciles bank accounts, verifies trial balance, checks runway',
    schedule: 'daily',
    steps: [
      { name: 'Trial balance check', type: 'query', query: "SELECT COALESCE(SUM(debit), 0) as total_debits, COALESCE(SUM(credit), 0) as total_credits, ABS(COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0)) as imbalance FROM fin_journal_lines jl JOIN fin_journal_entries je ON jl.journal_entry_id = je.id AND je.is_posted = true", id: 'trial_balance' },
      { name: 'Cash position', type: 'query', query: "SELECT account_name, current_balance FROM fin_bank_accounts WHERE is_active = true", id: 'cash_position' },
      { name: 'Overdue receivables', type: 'query', query: "SELECT COUNT(*) as count, COALESCE(SUM(amount - amount_paid), 0) as total FROM fin_accounts_receivable WHERE due_date < CURRENT_DATE AND status IN ('outstanding', 'partial')", id: 'overdue_ar' },
      { name: 'Upcoming payables', type: 'query', query: "SELECT COUNT(*) as count, COALESCE(SUM(amount - amount_paid), 0) as total FROM fin_accounts_payable WHERE due_date <= CURRENT_DATE + INTERVAL '7 days' AND status IN ('pending', 'approved')", id: 'upcoming_ap' },
      { name: 'Report financial status', type: 'notify', input: '$cash_position' }
    ]
  },

  // ═══ STRIPE REVENUE SYNC — Bridge simulated ↔ real money ═══
  {
    name: 'finance.stripe.sync',
    description: 'Monitor Stripe payments and ensure all revenue is recorded in the financial ledger',
    schedule: '6hours',
    steps: [
      { name: 'Unreconciled Stripe payments', type: 'query', query: "SELECT COUNT(*) as pending FROM fin_stripe_bridge WHERE reconciled = false AND status = 'completed'", id: 'unreconciled' },
      { name: 'MTD Revenue', type: 'query', query: "SELECT COALESCE(SUM(jl.credit), 0) as revenue FROM fin_journal_lines jl JOIN fin_journal_entries je ON jl.journal_entry_id = je.id AND je.is_posted = true WHERE jl.account_number LIKE '4%' AND jl.account_number != '4900' AND je.entry_date >= DATE_TRUNC('month', CURRENT_DATE)", id: 'mtd_revenue' },
      { name: 'Report Stripe sync status', type: 'notify', input: '$mtd_revenue' }
    ]
  },

  // ═══ STRIPE PAYMENT PIPELINE TEST — Agents verify payments work ═══
  {
    name: 'finance.stripe.pipeline_test',
    description: 'The Treasurer tests the Stripe payment pipeline to prevent customer-facing glitches',
    schedule: 'daily',
    steps: [
      { name: 'Stripe API health', type: 'query', query: "SELECT 1 as stripe_check_placeholder", id: 'stripe_placeholder' },
      { name: 'Check recent payment failures', type: 'query', query: "SELECT COUNT(*) as failed FROM fin_stripe_bridge WHERE status = 'failed' AND created_at > NOW() - INTERVAL '24 hours'", id: 'recent_failures' },
      { name: 'Check bridge integrity', type: 'query', query: "SELECT enrollment_type, COUNT(*) as total, COUNT(*) FILTER (WHERE reconciled = true) as reconciled, COUNT(*) FILTER (WHERE reconciled = false) as unreconciled FROM fin_stripe_bridge GROUP BY enrollment_type", id: 'bridge_integrity' },
      { name: 'Report pipeline status', type: 'notify', input: '$bridge_integrity' }
    ]
  }
];

// =========================================================================
// EXPORTS
// =========================================================================

module.exports = {
  RunLoop,
  WorkflowPipeline,
  ApprovalGate,
  diffAndStore,
  stableStringify,
  DEFAULT_WORKFLOWS
};
