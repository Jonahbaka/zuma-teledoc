/**
 * Skill Registry - Discover, Validate, Store, and Execute Corporate Skills
 * 
 * Skills are modular, reusable workflows that agents can discover,
 * evaluate, and execute. Each skill must pass compliance validation
 * before it can be used.
 * 
 * Skill lifecycle: Discover → Evaluate → Validate → Register → Test → Enable → Execute
 */

const db = require('../../db');
const crypto = require('crypto');

class SkillRegistry {
  constructor() {
    this.initialized = false;
    this.intentSystem = null;
  }

  bindIntentSystem(intentSystem) {
    this.intentSystem = intentSystem;
  }

  async initialize() {
    await this.registerDefaultSkills();
    this.initialized = true;
    const count = await db.query('SELECT COUNT(*) FROM ai_skills');
    console.log(`  📚 Skill Registry initialized with ${count.rows[0].count} skills`);
  }

  // =========================================================================
  // SKILL CRUD
  // =========================================================================

  /**
   * Register a new skill
   */
  async registerSkill(skillData) {
    const {
      skillName, displayName, description, category, skillType,
      steps, inputSchema, outputSchema,
      requiredCapabilities, requiredApprovals, requiredData,
      riskLevel, isReversible, involvesPhi, involvesFinancial, involvesExternal,
      source, sourceUrl, version
    } = skillData;

    const result = await db.query(`
      INSERT INTO ai_skills (
        skill_name, display_name, description, category, skill_type,
        steps, input_schema, output_schema,
        required_capabilities, required_approvals, required_data,
        risk_level, is_reversible, involves_phi, involves_financial, involves_external,
        source, source_url, version,
        compliance_status, is_enabled
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, 'pending', false)
      ON CONFLICT (skill_name) DO UPDATE SET
        description = EXCLUDED.description, steps = EXCLUDED.steps,
        version = EXCLUDED.version, updated_at = NOW()
      RETURNING *
    `, [
      skillName, displayName, description, category, skillType,
      JSON.stringify(steps), JSON.stringify(inputSchema || {}), JSON.stringify(outputSchema || {}),
      JSON.stringify(requiredCapabilities || []), JSON.stringify(requiredApprovals || []),
      JSON.stringify(requiredData || []),
      riskLevel || 'medium', isReversible !== false,
      involvesPhi || false, involvesFinancial || false, involvesExternal || false,
      source || 'internal', sourceUrl || null, version || '1.0.0'
    ]);

    return result.rows[0];
  }

  /**
   * Get a skill by name
   */
  async getSkill(skillName) {
    const result = await db.query('SELECT * FROM ai_skills WHERE skill_name = $1', [skillName]);
    return result.rows[0] || null;
  }

  /**
   * List skills by category or status
   */
  async listSkills(options = {}) {
    const { category, complianceStatus, isEnabled, limit = 100 } = options;
    let query = 'SELECT * FROM ai_skills WHERE 1=1';
    const params = [];

    if (category) { params.push(category); query += ` AND category = $${params.length}`; }
    if (complianceStatus) { params.push(complianceStatus); query += ` AND compliance_status = $${params.length}`; }
    if (isEnabled !== undefined) { params.push(isEnabled); query += ` AND is_enabled = $${params.length}`; }

    params.push(limit);
    query += ` ORDER BY category, skill_name LIMIT $${params.length}`;

    const result = await db.query(query, params);
    return result.rows;
  }

  // =========================================================================
  // COMPLIANCE VALIDATION
  // =========================================================================

  /**
   * Approve a skill for use (typically by Compliance Agent or admin)
   */
  async approveSkill(skillId, validatedBy, notes = '') {
    await db.query(`
      UPDATE ai_skills SET 
        compliance_status = 'approved', is_enabled = true,
        validated_by = $1, validated_at = NOW(), compliance_notes = $2, updated_at = NOW()
      WHERE id = $3
    `, [validatedBy, notes, skillId]);

    await db.query(`
      INSERT INTO ai_audit_log (action_type, action_details, skill_id, outcome)
      VALUES ('skill_approved', $1, $2, 'success')
    `, [JSON.stringify({ validatedBy, notes }), skillId]);

    return this.getSkillById(skillId);
  }

  /**
   * Reject a skill
   */
  async rejectSkill(skillId, validatedBy, reason) {
    await db.query(`
      UPDATE ai_skills SET 
        compliance_status = 'rejected', is_enabled = false,
        validated_by = $1, validated_at = NOW(), compliance_notes = $2, updated_at = NOW()
      WHERE id = $3
    `, [validatedBy, reason, skillId]);
  }

  /**
   * Suspend a skill
   */
  async suspendSkill(skillId, reason) {
    await db.query(`
      UPDATE ai_skills SET compliance_status = 'suspended', is_enabled = false, compliance_notes = $1, updated_at = NOW()
      WHERE id = $2
    `, [reason, skillId]);
  }

  async getSkillById(skillId) {
    const result = await db.query('SELECT * FROM ai_skills WHERE id = $1', [skillId]);
    return result.rows[0];
  }

  // =========================================================================
  // SKILL EXECUTION
  // =========================================================================

  /**
   * Execute a skill (logs execution and tracks metrics)
   */
  async executeSkill(skillId, agentId, inputData, options = {}) {
    const { isSandbox = false, proposalId = null } = options;
    const startTime = Date.now();

    // Log execution start
    const execution = await db.query(`
      INSERT INTO ai_skill_executions (skill_id, agent_id, proposal_id, input_data, is_sandbox, status)
      VALUES ($1, $2, $3, $4, $5, 'running')
      RETURNING id
    `, [skillId, agentId, proposalId, JSON.stringify(inputData), isSandbox]);

    const executionId = execution.rows[0].id;

    try {
      const skill = await this.getSkillById(skillId);
      if (!skill) throw new Error('Skill not found');

      // In sandbox mode, simulate execution
      let result;
      if (isSandbox) {
        result = await this.simulateSkillExecution(skill, inputData);
      } else {
        result = await this.runSkillSteps(skill, inputData, agentId);
      }

      const duration = Date.now() - startTime;

      // Update execution record
      await db.query(`
        UPDATE ai_skill_executions SET 
          status = 'completed', output_data = $1, duration_ms = $2,
          sandbox_result = $3, completed_at = NOW()
        WHERE id = $4
      `, [JSON.stringify(result), duration, isSandbox ? JSON.stringify(result) : null, executionId]);

      // Update skill metrics
      await db.query(`
        UPDATE ai_skills SET 
          use_count = use_count + 1, last_used_at = NOW(),
          avg_duration_ms = COALESCE((avg_duration_ms * use_count + $1) / (use_count + 1), $1)
        WHERE id = $2
      `, [duration, skillId]);

      return { executionId, status: 'completed', result, duration };
    } catch (error) {
      await db.query(`
        UPDATE ai_skill_executions SET status = 'failed', error_message = $1, completed_at = NOW()
        WHERE id = $2
      `, [error.message, executionId]);

      throw error;
    }
  }

  /**
   * Run skill steps (intents are declared per step)
   */
  async runSkillSteps(skill, inputData, agentId) {
    const steps = Array.isArray(skill.steps)
      ? skill.steps
      : (typeof skill.steps === 'string' ? JSON.parse(skill.steps || '[]') : []);
    const results = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepResult = {
        step: i + 1,
        name: step.name || `Step ${i + 1}`,
        status: 'documented',
        description: step.description,
        intentType: step.intentType,
        message: `Step documented for execution. Intent: ${step.intentType || 'manual'}`
      };

      if (step.intentType && this.intentSystem && agentId) {
        try {
          const intent = await this.intentSystem.declare({
            agentId,
            intentType: step.intentType,
            intentCategory: this.categorizeIntent(step.intentType),
            parameters: {
              ...(inputData || {}),
              ...(step.parameters || {}),
              stepName: step.name || `Step ${i + 1}`,
              skillName: skill.skill_name
            },
            reasoning: step.description || `Execute ${step.intentType} for skill ${skill.skill_name}`,
            expectedOutcome: `Step ${step.name || i + 1} completed`,
            confidence: 0.82,
            isReversible: skill.is_reversible !== false,
            riskScore: this.estimateRisk(step.intentType, skill.risk_level)
          });

          stepResult.intentId = intent.id;
          stepResult.intentStatus = intent.status;
          stepResult.status = intent.status === 'pending' ? 'pending_approval' : 'executed';
          stepResult.message = `Intent declared: ${step.intentType} (${intent.status})`;
        } catch (error) {
          stepResult.status = 'failed';
          stepResult.message = `Intent declaration failed: ${error.message}`;
          stepResult.error = error.message;
        }
      }

      results.push(stepResult);
    }

    return {
      skillName: skill.skill_name,
      stepsCompleted: results.length,
      steps: results,
      summary: `Skill ${skill.display_name} executed with ${results.length} steps`
    };
  }

  categorizeIntent(intentType) {
    const categories = {
      query_database: 'read',
      fetch_metrics: 'read',
      analyze_data: 'read',
      get_patient_count: 'read',
      get_revenue_data: 'read',
      get_appointment_data: 'read',
      send_email: 'communicate',
      send_notification: 'communicate',
      process_payment: 'financial',
      update_pricing: 'financial',
      api_call_external: 'external',
      register_ein: 'external',
      file_report: 'external',
      open_bank_account: 'external',
      submit_to_bureau: 'external'
    };
    return categories[intentType] || 'write';
  }

  estimateRisk(intentType, skillRiskLevel = 'medium') {
    const riskByIntent = {
      query_database: 0.05,
      fetch_metrics: 0.05,
      analyze_data: 0.08,
      get_patient_count: 0.05,
      get_revenue_data: 0.1,
      get_appointment_data: 0.1,
      send_notification: 0.2,
      send_email: 0.35,
      process_payment: 0.8,
      update_pricing: 0.7,
      api_call_external: 0.85,
      register_ein: 0.9,
      open_bank_account: 0.95,
      file_report: 0.85,
      submit_to_bureau: 0.9
    };
    if (riskByIntent[intentType] !== undefined) return riskByIntent[intentType];
    const bySkillRisk = { minimal: 0.05, low: 0.1, medium: 0.35, high: 0.65, critical: 0.85 };
    return bySkillRisk[skillRiskLevel] ?? 0.5;
  }

  /**
   * Simulate skill execution in sandbox
   */
  async simulateSkillExecution(skill, inputData) {
    const steps = skill.steps || [];
    
    return {
      mode: 'sandbox',
      skillName: skill.skill_name,
      simulation: true,
      stepsSimulated: steps.length,
      estimatedDuration: `${steps.length * 500}ms`,
      riskAssessment: {
        riskLevel: skill.risk_level,
        involvesPhi: skill.involves_phi,
        involvesFinancial: skill.involves_financial,
        involvesExternal: skill.involves_external,
        isReversible: skill.is_reversible
      },
      simulatedOutcome: 'Skill would execute successfully based on input validation',
      inputValidation: this.validateSkillInput(skill, inputData)
    };
  }

  validateSkillInput(skill, inputData) {
    const schema = skill.input_schema || {};
    const required = schema.required || [];
    const missing = required.filter(field => !inputData[field]);
    
    return {
      valid: missing.length === 0,
      missingFields: missing,
      providedFields: Object.keys(inputData)
    };
  }

  // =========================================================================
  // DEFAULT SKILLS
  // =========================================================================

  async registerDefaultSkills() {
    const defaults = [
      {
        skillName: 'analyze_revenue',
        displayName: 'Revenue Analysis',
        description: 'Analyze revenue trends, identify growth opportunities, and forecast future revenue',
        category: 'financial',
        skillType: 'analysis',
        steps: [
          { name: 'Fetch Revenue Data', intentType: 'get_revenue_data', description: 'Get revenue data for the analysis period' },
          { name: 'Fetch Appointment Data', intentType: 'get_appointment_data', description: 'Get appointment metrics' },
          { name: 'Analyze Trends', intentType: 'analyze_data', description: 'Identify revenue trends and patterns' },
          { name: 'Generate Report', intentType: 'query_database', description: 'Compile findings into structured report' }
        ],
        riskLevel: 'low', isReversible: true, involvesPhi: false, involvesFinancial: false
      },
      {
        skillName: 'optimize_scheduling',
        displayName: 'Scheduling Optimization',
        description: 'Analyze appointment patterns and recommend scheduling improvements',
        category: 'operations',
        skillType: 'analysis',
        steps: [
          { name: 'Fetch Appointment History', intentType: 'get_appointment_data', description: 'Get historical appointment data' },
          { name: 'Analyze No-Show Patterns', intentType: 'analyze_data', description: 'Identify no-show patterns by time/day' },
          { name: 'Compute Utilization', intentType: 'fetch_metrics', description: 'Calculate provider utilization rates' },
          { name: 'Generate Recommendations', intentType: 'analyze_data', description: 'Generate scheduling optimization recommendations' }
        ],
        riskLevel: 'low', isReversible: true, involvesPhi: false, involvesFinancial: false
      },
      {
        skillName: 'patient_growth_analysis',
        displayName: 'Patient Growth Analysis',
        description: 'Analyze patient acquisition, retention, and churn patterns',
        category: 'marketing',
        skillType: 'analysis',
        steps: [
          { name: 'Fetch Patient Metrics', intentType: 'get_patient_count', description: 'Get current patient counts' },
          { name: 'Analyze Growth Trend', intentType: 'analyze_data', description: 'Compute growth rate and trends' },
          { name: 'Identify Churn Signals', intentType: 'analyze_data', description: 'Identify patients at risk of leaving' }
        ],
        riskLevel: 'low', isReversible: true, involvesPhi: false, involvesFinancial: false
      },
      {
        skillName: 'claims_optimization',
        displayName: 'Claims Denial Prevention',
        description: 'Analyze claims patterns and reduce denial rates',
        category: 'financial',
        skillType: 'analysis',
        steps: [
          { name: 'Fetch Claims Data', intentType: 'query_database', description: 'Get recent claims with outcomes' },
          { name: 'Analyze Denial Patterns', intentType: 'analyze_data', description: 'Identify common denial reasons' },
          { name: 'Generate Prevention Plan', intentType: 'analyze_data', description: 'Create actionable denial prevention recommendations' }
        ],
        riskLevel: 'low', isReversible: true, involvesPhi: false, involvesFinancial: false
      },
      {
        skillName: 'ein_registration',
        displayName: 'EIN Registration Workflow',
        description: 'Step-by-step workflow for obtaining a Federal Employer Identification Number',
        category: 'corporate',
        skillType: 'workflow',
        steps: [
          { name: 'Verify Eligibility', description: 'Confirm business entity type and eligibility for EIN' },
          { name: 'Prepare SS-4 Form', description: 'Gather required information for IRS Form SS-4', intentType: 'register_ein' },
          { name: 'Submit Application', description: 'Submit SS-4 to IRS (online, fax, or mail)', intentType: 'api_call_external' },
          { name: 'Record EIN', description: 'Store EIN in company records', intentType: 'create_record' }
        ],
        riskLevel: 'high', isReversible: false, involvesPhi: false, involvesFinancial: false, involvesExternal: true
      },
      {
        skillName: 'bank_account_setup',
        displayName: 'Business Bank Account Setup',
        description: 'Workflow for opening a business bank account',
        category: 'corporate',
        skillType: 'workflow',
        steps: [
          { name: 'Gather Documents', description: 'Collect EIN, articles of incorporation, ID, business license' },
          { name: 'Compare Banks', description: 'Evaluate business banking options', intentType: 'analyze_data' },
          { name: 'Schedule Appointment', description: 'Schedule bank appointment for account opening', intentType: 'open_bank_account' },
          { name: 'Record Account Details', description: 'Securely store account information', intentType: 'create_record' }
        ],
        riskLevel: 'critical', isReversible: false, involvesPhi: false, involvesFinancial: true, involvesExternal: true
      },
      {
        skillName: 'compliance_audit',
        displayName: 'HIPAA Compliance Audit',
        description: 'Run internal HIPAA compliance audit checks',
        category: 'compliance',
        skillType: 'analysis',
        steps: [
          { name: 'Check PHI Access Logs', intentType: 'query_database', description: 'Review PHI access audit trail' },
          { name: 'Check Encryption Status', intentType: 'fetch_metrics', description: 'Verify encryption is active' },
          { name: 'Review User Permissions', intentType: 'query_database', description: 'Audit user role assignments' },
          { name: 'Generate Compliance Report', intentType: 'analyze_data', description: 'Compile audit findings' }
        ],
        riskLevel: 'low', isReversible: true, involvesPhi: true, involvesFinancial: false
      },
      {
        skillName: 'daily_operations_report',
        displayName: 'Daily Operations Report',
        description: 'Generate a comprehensive daily operations briefing',
        category: 'operations',
        skillType: 'analysis',
        steps: [
          { name: 'Fetch Patient Metrics', intentType: 'get_patient_count', description: 'Get patient counts' },
          { name: 'Fetch Appointment Metrics', intentType: 'get_appointment_data', description: 'Get appointment data' },
          { name: 'Fetch Revenue Metrics', intentType: 'get_revenue_data', description: 'Get revenue data' },
          { name: 'Fetch Message Volume', intentType: 'fetch_metrics', description: 'Get communication metrics' },
          { name: 'Compile Report', intentType: 'analyze_data', description: 'Generate comprehensive daily report' }
        ],
        riskLevel: 'minimal', isReversible: true, involvesPhi: false, involvesFinancial: false
      }
    ];

    for (const skill of defaults) {
      try {
        await this.registerSkill(skill);
      } catch (error) {
        // Ignore duplicate registrations
      }
    }

    // Auto-approve low-risk analysis skills
    const analysisSkills = await db.query(`
      SELECT id FROM ai_skills WHERE skill_type = 'analysis' AND risk_level IN ('minimal', 'low') AND compliance_status = 'pending'
    `);
    for (const skill of analysisSkills.rows) {
      await this.approveSkill(skill.id, null, 'Auto-approved: low-risk analysis skill');
    }
  }

  /**
   * Get skill execution history
   */
  async getExecutionHistory(options = {}) {
    const { skillId, agentId, limit = 50 } = options;
    let query = `
      SELECT se.*, s.display_name as skill_name, a.display_name as agent_name
      FROM ai_skill_executions se
      JOIN ai_skills s ON se.skill_id = s.id
      JOIN ai_agents a ON se.agent_id = a.id
      WHERE 1=1
    `;
    const params = [];

    if (skillId) { params.push(skillId); query += ` AND se.skill_id = $${params.length}`; }
    if (agentId) { params.push(agentId); query += ` AND se.agent_id = $${params.length}`; }

    params.push(limit);
    query += ` ORDER BY se.created_at DESC LIMIT $${params.length}`;

    const result = await db.query(query, params);
    return result.rows;
  }
}

module.exports = SkillRegistry;
