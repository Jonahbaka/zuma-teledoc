/**
 * ═══════════════════════════════════════════════════════════════
 *  THE REFLEXES — Dynamic Skill Discovery & Dispatch
 *  (Harvested from @openclaw/skills + @openclaw/clawhub schema)
 * ═══════════════════════════════════════════════════════════════
 * 
 *  Pattern Source: 
 *    - @openclaw/skills: Flat directory of skill folders, each self-contained
 *    - @openclaw/clawhub: Skill schema with versions, fingerprints, embeddings
 *    - @openclaw/lobster: Command registry (Map-based, runtime discoverable)
 *  
 *  This makes the agent's "hands" dynamic:
 *    1. DROP a new skill file into the skills/ folder
 *    2. The agent DISCOVERS it on the next tick
 *    3. It VALIDATES the skill against compliance
 *    4. It REGISTERS the skill in the registry
 *    5. It can now USE the skill when needed
 *  
 *  Key OpenClaw Patterns Adapted:
 *    1. Directory-scan discovery (like skills/ folder in @openclaw/skills)
 *    2. Schema validation (from ClawHub's parsed.frontmatter)
 *    3. Version tracking with fingerprints (from skillVersions)
 *    4. Stats tracking per skill (downloads, executions, success rate)
 *    5. Intent-to-skill matching (the "brain decides which tool to pull")
 *  
 *  Skill Definition Schema (adapted from ClawHub):
 *    {
 *      name: string,           // unique slug (like skill.slug)
 *      displayName: string,    // human-readable name
 *      description: string,    // what this skill does
 *      version: string,        // semver
 *      category: string,       // medical, operations, financial, etc.
 *      triggers: string[],     // event types that can trigger this skill
 *      inputSchema: object,    // JSON Schema for inputs
 *      outputSchema: object,   // JSON Schema for outputs
 *      sideEffects: string[],  // what this skill changes
 *      steps: Step[],          // ordered execution steps
 *      riskLevel: string,      // minimal|low|medium|high|critical
 *      requiresApproval: boolean
 *    }
 * ═══════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../../db');

// =========================================================================
// SKILL SCHEMA DEFINITION (Adapted from ClawHub's skillVersions schema)
// =========================================================================

/**
 * MedicalSkill — The schema for a DoctaRx skill
 * (Adapted from ClawHub's parsed frontmatter + metadata)
 */
class MedicalSkill {
  constructor(definition) {
    // Core identity (like ClawHub's slug + displayName)
    this.name = definition.name;
    this.displayName = definition.displayName || definition.name;
    this.description = definition.description || '';
    this.version = definition.version || '1.0.0';

    // Classification
    this.category = definition.category || 'general';
    this.tags = definition.tags || [];
    this.domain = definition.domain || 'telehealth'; // telehealth, operations, financial, compliance

    // Trigger conditions (what events activate this skill)
    this.triggers = definition.triggers || [];
    this.schedule = definition.schedule || null; // e.g., 'daily', '6hours'

    // Schema (like ClawHub's parsed.frontmatter)
    this.inputSchema = definition.inputSchema || {};
    this.outputSchema = definition.outputSchema || {};
    this.sideEffects = definition.sideEffects || [];

    // Execution plan
    this.steps = (definition.steps || []).map((s, i) => ({
      id: s.id || `step_${i}`,
      name: s.name || `Step ${i + 1}`,
      type: s.type || 'action', // action, query, transform, approve, notify, sleep
      action: s.action || null,
      query: s.query || null,
      skill: s.skill || null,  // nested skill reference
      input: s.input || '$previous',
      condition: s.condition || null,
      approval: s.approval || null, // 'required' for approval gates
      approvalPrompt: s.approvalPrompt || null,
      continueOnError: s.continueOnError || false,
      timeout: s.timeout || 30000
    }));

    // Risk assessment
    this.riskLevel = definition.riskLevel || 'medium';
    this.requiresApproval = definition.requiresApproval ?? (this.riskLevel === 'high' || this.riskLevel === 'critical');
    this.isReversible = definition.isReversible !== false;
    this.involvesPhi = definition.involvesPhi || false;
    this.involvesFinancial = definition.involvesFinancial || false;
    this.involvesExternal = definition.involvesExternal || false;

    // Metadata
    this.author = definition.author || 'system';
    this.source = definition.source || 'internal';
    this.sourceUrl = definition.sourceUrl || null;
    this.fingerprint = this.computeFingerprint();
    this.createdAt = definition.createdAt || new Date();
    this.updatedAt = definition.updatedAt || new Date();

    // Runtime stats (like ClawHub's skill stats)
    this.stats = {
      executions: 0,
      successes: 0,
      failures: 0,
      avgDurationMs: 0,
      lastUsedAt: null
    };
  }

  /**
   * Compute fingerprint (like ClawHub's skillVersionFingerprints)
   * Used to detect when a skill has been modified
   */
  computeFingerprint() {
    const content = JSON.stringify({
      name: this.name,
      version: this.version,
      steps: this.steps,
      inputSchema: this.inputSchema,
      outputSchema: this.outputSchema
    });
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  /**
   * Validate input against schema
   */
  validateInput(input) {
    const required = this.inputSchema.required || [];
    const missing = required.filter(field => input[field] === undefined);
    return {
      valid: missing.length === 0,
      missingFields: missing,
      providedFields: Object.keys(input || {})
    };
  }

  /**
   * Convert to registry format
   */
  toRegistryEntry() {
    return {
      name: this.name,
      displayName: this.displayName,
      description: this.description,
      version: this.version,
      category: this.category,
      domain: this.domain,
      tags: this.tags,
      triggers: this.triggers,
      schedule: this.schedule,
      riskLevel: this.riskLevel,
      requiresApproval: this.requiresApproval,
      involvesPhi: this.involvesPhi,
      involvesFinancial: this.involvesFinancial,
      involvesExternal: this.involvesExternal,
      fingerprint: this.fingerprint,
      stepCount: this.steps.length,
      sideEffects: this.sideEffects,
      stats: this.stats
    };
  }
}

// =========================================================================
// SKILL SELECTOR (The "Brain decides which tool to pull")
// =========================================================================

/**
 * SkillSelector — Matches agent intent to the best available skill
 * (The "reflex" that decides which hand to use)
 * 
 * Lobster pattern: Commands are registered in a Map, discoverable at runtime
 * ClawHub pattern: Vector search to find relevant skills by meaning
 */
class SkillSelector {
  constructor() {
    this.skills = new Map(); // name → MedicalSkill
    this.triggerIndex = new Map(); // eventType → [skillName]
    this.categoryIndex = new Map(); // category → [skillName]
  }

  /**
   * Register a skill (like Lobster's registry.set)
   */
  register(skill) {
    if (!(skill instanceof MedicalSkill)) {
      skill = new MedicalSkill(skill);
    }

    this.skills.set(skill.name, skill);

    // Index by triggers
    for (const trigger of skill.triggers) {
      if (!this.triggerIndex.has(trigger)) {
        this.triggerIndex.set(trigger, []);
      }
      this.triggerIndex.get(trigger).push(skill.name);
    }

    // Index by category
    if (!this.categoryIndex.has(skill.category)) {
      this.categoryIndex.set(skill.category, []);
    }
    this.categoryIndex.get(skill.category).push(skill.name);

    return skill;
  }

  /**
   * Get a skill by name (like Lobster's registry.get)
   */
  get(name) {
    return this.skills.get(name);
  }

  /**
   * List all skills (like Lobster's registry.list)
   */
  list() {
    return [...this.skills.values()].map(s => s.toRegistryEntry());
  }

  /**
   * Find skills triggered by an event type
   */
  findByTrigger(eventType) {
    const names = this.triggerIndex.get(eventType) || [];
    return names.map(n => this.skills.get(n)).filter(Boolean);
  }

  /**
   * Find skills by category
   */
  findByCategory(category) {
    const names = this.categoryIndex.get(category) || [];
    return names.map(n => this.skills.get(n)).filter(Boolean);
  }

  /**
   * AI-powered skill matching — given a natural language intent,
   * find the best matching skill. Uses keyword overlap + category matching.
   * (Simplified version of ClawHub's vector search)
   */
  matchIntent(intentDescription, agentType) {
    const words = intentDescription.toLowerCase().split(/\s+/);
    let bestMatch = null;
    let bestScore = 0;

    for (const [, skill] of this.skills) {
      let score = 0;
      const skillText = `${skill.name} ${skill.displayName} ${skill.description} ${skill.tags.join(' ')} ${skill.category}`.toLowerCase();

      // Keyword overlap score
      for (const word of words) {
        if (word.length > 2 && skillText.includes(word)) {
          score += 1;
        }
      }

      // Category bonus
      const agentCategoryMap = {
        operations: ['operations', 'scheduling', 'logistics'],
        growth: ['marketing', 'growth', 'acquisition'],
        revenue: ['financial', 'revenue', 'billing'],
        compliance: ['compliance', 'hipaa', 'audit'],
        corporate_skills: ['corporate', 'legal', 'registration'],
        researcher: ['research', 'analysis'],
        devops: ['devops', 'monitoring', 'debugging']
      };
      const agentCategories = agentCategoryMap[agentType] || [];
      if (agentCategories.includes(skill.category)) {
        score += 3;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = skill;
      }
    }

    return bestMatch && bestScore >= 2 ? bestMatch : null;
  }
}

// =========================================================================
// DYNAMIC SKILL LOADER (The "Drop a file, agent learns it" pattern)
// =========================================================================

/**
 * DynamicSkillLoader — Watches a directory for new skill definitions
 * Drop a new JSON file in the skills/ folder and the agent learns it.
 * (Adapted from @openclaw/skills flat directory pattern)
 */
class DynamicSkillLoader {
  constructor(selector) {
    this.selector = selector;
    this.skillsDir = path.join(__dirname, 'skills-library');
    this.loadedFiles = new Map(); // filename → fingerprint
    this.watchTimer = null;
  }

  /**
   * Initial load — scan the skills directory
   */
  async loadAll() {
    // Create skills directory if it doesn't exist
    try {
      if (!fs.existsSync(this.skillsDir)) {
        fs.mkdirSync(this.skillsDir, { recursive: true });
      }
    } catch (e) { /* ok */ }

    const files = this.scanDirectory();
    let loaded = 0;

    for (const file of files) {
      try {
        const skill = this.loadSkillFile(file);
        if (skill) {
          this.selector.register(skill);
          this.loadedFiles.set(file, skill.fingerprint);
          loaded++;
        }
      } catch (e) {
        console.error(`  ⚠️ Failed to load skill: ${file} — ${e.message}`);
      }
    }

    console.log(`  🤲 Dynamic Skills: ${loaded} loaded from ${this.skillsDir}`);
    return loaded;
  }

  /**
   * Scan for new/modified skill files (called periodically by the run loop)
   */
  async scanForChanges() {
    const files = this.scanDirectory();
    let newCount = 0;
    let updatedCount = 0;

    for (const file of files) {
      try {
        const skill = this.loadSkillFile(file);
        if (!skill) continue;

        const existingFingerprint = this.loadedFiles.get(file);
        if (!existingFingerprint) {
          // New skill file!
          this.selector.register(skill);
          this.loadedFiles.set(file, skill.fingerprint);
          newCount++;
          console.log(`  ✨ New skill discovered: ${skill.displayName} (${file})`);
        } else if (existingFingerprint !== skill.fingerprint) {
          // Modified skill file
          this.selector.register(skill);
          this.loadedFiles.set(file, skill.fingerprint);
          updatedCount++;
          console.log(`  🔄 Skill updated: ${skill.displayName} (${file})`);
        }
      } catch (e) { /* ignore bad files */ }
    }

    return { newCount, updatedCount };
  }

  /**
   * Scan the skills directory for JSON files
   */
  scanDirectory() {
    try {
      if (!fs.existsSync(this.skillsDir)) return [];
      return fs.readdirSync(this.skillsDir)
        .filter(f => f.endsWith('.json') || f.endsWith('.skill.json'))
        .map(f => path.join(this.skillsDir, f));
    } catch (e) {
      return [];
    }
  }

  /**
   * Load a skill definition from a JSON file
   */
  loadSkillFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const definition = JSON.parse(content);
    if (!definition.name) {
      definition.name = path.basename(filePath, '.json').replace('.skill', '');
    }
    return new MedicalSkill(definition);
  }

  /**
   * Start watching for changes (called by the run loop)
   */
  startWatching(intervalMs = 30000) {
    if (this.watchTimer) return;
    this.watchTimer = setInterval(() => this.scanForChanges(), intervalMs);
  }

  stopWatching() {
    if (this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
  }
}

// =========================================================================
// DEFAULT MEDICAL SKILLS (Pre-loaded skill definitions for DoctaRx)
// =========================================================================

const DEFAULT_MEDICAL_SKILLS = [
  {
    name: 'diagnose.symptom.check',
    displayName: 'Symptom Checker',
    description: 'AI-powered symptom analysis and preliminary assessment',
    category: 'medical',
    domain: 'telehealth',
    tags: ['diagnosis', 'triage', 'patient-facing'],
    triggers: ['patient.message.received'],
    riskLevel: 'medium',
    requiresApproval: false,
    involvesPhi: true,
    steps: [
      { name: 'Parse symptoms', type: 'action', action: 'parse_symptoms' },
      { name: 'Check drug interactions', type: 'action', action: 'check_interactions' },
      { name: 'Generate assessment', type: 'action', action: 'generate_assessment' },
      { name: 'Route to provider', type: 'notify', input: '$previous' }
    ],
    inputSchema: { required: ['symptoms'], properties: { symptoms: { type: 'string' }, patientAge: { type: 'number' } } },
    sideEffects: ['creates_triage_record']
  },
  {
    name: 'check.drug.interactions',
    displayName: 'Drug Interaction Checker',
    description: 'Check for dangerous drug interactions between medications',
    category: 'medical',
    domain: 'telehealth',
    tags: ['pharmacy', 'safety', 'prescriptions'],
    triggers: ['provider.prescription.written'],
    riskLevel: 'high',
    requiresApproval: true,
    involvesPhi: true,
    steps: [
      { name: 'Fetch patient medications', type: 'query', query: "SELECT * FROM prescriptions WHERE patient_id = $1 AND status = 'active'" },
      { name: 'Analyze interactions', type: 'action', action: 'analyze_interactions' },
      { name: 'Alert if dangerous', type: 'notify', input: '$previous', condition: '$previous.hasDangerousInteraction' }
    ],
    inputSchema: { required: ['patientId', 'newMedication'] },
    sideEffects: ['may_block_prescription']
  },
  {
    name: 'optimize.provider.schedule',
    displayName: 'Provider Schedule Optimizer',
    description: 'Analyze provider schedules and suggest optimizations to reduce gaps and no-shows',
    category: 'operations',
    domain: 'telehealth',
    tags: ['scheduling', 'efficiency', 'providers'],
    triggers: ['patient.appointment.cancelled'],
    schedule: 'daily',
    riskLevel: 'low',
    steps: [
      { name: 'Fetch schedule', type: 'query', query: "SELECT * FROM video_sessions WHERE scheduled_at > NOW() AND scheduled_at < NOW() + INTERVAL '7 days' ORDER BY scheduled_at" },
      { name: 'Detect gaps', type: 'transform', filter: { status: 'available' } },
      { name: 'Generate suggestions', type: 'action', action: 'schedule_optimizer' },
      { name: 'Report', type: 'notify', input: '$previous' }
    ],
    sideEffects: []
  },
  {
    name: 'monitor.claim.status',
    displayName: 'Claims Status Monitor',
    description: 'Track insurance claims and alert on denials or delays',
    category: 'financial',
    domain: 'telehealth',
    tags: ['insurance', 'claims', 'revenue'],
    triggers: ['claim.submitted', 'claim.denied'],
    schedule: '6hours',
    riskLevel: 'low',
    steps: [
      { name: 'Fetch pending claims', type: 'query', query: "SELECT * FROM insurance_claims WHERE status = 'pending' AND submitted_at < NOW() - INTERVAL '48 hours'" },
      { name: 'Check for denials', type: 'transform', filter: { status: 'denied' } },
      { name: 'Alert revenue agent', type: 'notify', input: '$previous' }
    ],
    sideEffects: []
  },
  {
    name: 'audit.phi.access',
    displayName: 'PHI Access Auditor',
    description: 'Monitor and audit access to Protected Health Information',
    category: 'compliance',
    domain: 'telehealth',
    tags: ['hipaa', 'privacy', 'audit'],
    triggers: ['compliance.phi.accessed'],
    schedule: 'daily',
    riskLevel: 'low',
    involvesPhi: true,
    steps: [
      { name: 'Fetch access logs', type: 'query', query: "SELECT * FROM ai_audit_log WHERE action_type = 'phi_access' AND created_at > NOW() - INTERVAL '24 hours'" },
      { name: 'Detect anomalies', type: 'action', action: 'detect_access_anomalies' },
      { name: 'Report findings', type: 'notify', input: '$previous' }
    ],
    sideEffects: ['creates_audit_report']
  },
  {
    name: 'patient.followup.reminder',
    displayName: 'Patient Follow-Up Reminder',
    description: 'Proactively check on patients who need follow-up appointments',
    category: 'operations',
    domain: 'telehealth',
    tags: ['patient-care', 'follow-up', 'reminders'],
    triggers: ['patient.appointment.completed'],
    schedule: 'daily',
    riskLevel: 'low',
    steps: [
      { name: 'Find patients needing follow-up', type: 'query', query: "SELECT * FROM video_sessions WHERE status = 'completed' AND follow_up_needed = true AND follow_up_scheduled = false AND completed_at < NOW() - INTERVAL '3 days'" },
      { name: 'Approve sending reminders', type: 'action', approval: 'required', approvalPrompt: 'Send follow-up reminders to patients?' },
      { name: 'Send reminders', type: 'notify', input: '$previous' }
    ],
    sideEffects: ['sends_patient_notification']
  }
];

// =========================================================================
// EXPORTS
// =========================================================================

module.exports = {
  MedicalSkill,
  SkillSelector,
  DynamicSkillLoader,
  DEFAULT_MEDICAL_SKILLS
};
