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
      // Read operations
      query_database: 'read',
      fetch_metrics: 'read',
      analyze_data: 'read',
      get_patient_count: 'read',
      get_revenue_data: 'read',
      get_appointment_data: 'read',
      get_ga4_realtime_metrics: 'read',
      // Clinical (read-level — advisory only, never prescribes)
      medical_unit_consult: 'read',
      // Communication
      send_email: 'communicate',
      send_notification: 'communicate',
      // Write operations
      create_record: 'write',
      update_record: 'write',
      // Financial
      process_payment: 'financial',
      update_pricing: 'financial',
      // External
      api_call_external: 'external',
      register_ein: 'external',
      file_report: 'external',
      open_bank_account: 'external',
      submit_to_bureau: 'external',
      zoho_recruit_create_job_opening: 'external',
      zoho_recruit_publish_job_opening: 'external'
    };
    return categories[intentType] || 'write';
  }

  estimateRisk(intentType, skillRiskLevel = 'medium') {
    const riskByIntent = {
      // Read operations — low risk
      query_database: 0.05,
      fetch_metrics: 0.05,
      analyze_data: 0.08,
      get_patient_count: 0.05,
      get_revenue_data: 0.1,
      get_appointment_data: 0.1,
      get_ga4_realtime_metrics: 0.05,
      // Clinical — moderate (advisory, never prescribes)
      medical_unit_consult: 0.2,
      // Write operations
      create_record: 0.3,
      update_record: 0.35,
      // Communication — moderate
      send_notification: 0.2,
      send_email: 0.35,
      // Financial — high
      process_payment: 0.8,
      update_pricing: 0.7,
      // External — high to critical
      api_call_external: 0.85,
      register_ein: 0.9,
      open_bank_account: 0.95,
      file_report: 0.85,
      submit_to_bureau: 0.9,
      zoho_recruit_create_job_opening: 0.75,
      zoho_recruit_publish_job_opening: 0.65
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
        skillName: 'recruitment.zoho.job_posting',
        displayName: 'Zoho Recruit Job Posting',
        description: 'Create job openings in Zoho Recruit and publish to LinkedIn/Indeed job boards',
        category: 'growth',
        skillType: 'workflow',
        steps: [
          { name: 'Create Zoho Job Opening', intentType: 'zoho_recruit_create_job_opening', description: 'Create a new Job Opening record in Zoho Recruit' },
          { name: 'Publish Job to Boards', intentType: 'zoho_recruit_publish_job_opening', description: 'Publish created job to LinkedIn and Indeed channels through Zoho' }
        ],
        riskLevel: 'medium', isReversible: false, involvesPhi: false, involvesFinancial: false, involvesExternal: true
      },
      {
        skillName: 'analytics.ga4.realtime.read',
        displayName: 'GA4 Realtime Intelligence',
        description: 'Fetch and summarize GA4 realtime traffic so agents can react to live acquisition metrics autonomously',
        category: 'growth',
        skillType: 'analysis',
        steps: [
          { name: 'Fetch GA4 Realtime Metrics', intentType: 'get_ga4_realtime_metrics', description: 'Pull active users, sources, countries, and page activity from GA4 realtime feed' },
          { name: 'Analyze Conversion Signals', intentType: 'analyze_data', description: 'Analyze live traffic quality and identify growth opportunities from realtime signals' }
        ],
        riskLevel: 'minimal', isReversible: true, involvesPhi: false, involvesFinancial: false
      },
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
      },

      // ═══════════════════════════════════════════════════════════════
      //  CLINICAL SKILLS (Asclepius + Triage Nurse)
      // ═══════════════════════════════════════════════════════════════

      {
        skillName: 'clinical.triage.symptom_assessment',
        displayName: 'Symptom Triage Assessment',
        description: 'Patient-facing symptom intake with auto-escalation for MI/CVA/sepsis/anaphylaxis. Collects chief complaint, HPI, ROS. Outputs urgency tier.',
        category: 'clinical',
        skillType: 'workflow',
        steps: [
          { name: 'Collect Chief Complaint', intentType: 'medical_unit_consult', description: 'Gather patient chief complaint and symptom timeline' },
          { name: 'Screen for Emergency', intentType: 'medical_unit_consult', description: 'Pattern-match critical symptoms (chest pain, face droop, high fever+confusion, throat swelling). Hard-escalate to 911 if matched.' },
          { name: 'Assess Urgency Tier', intentType: 'analyze_data', description: 'Classify as emergency / urgent / semi-urgent / routine based on symptom severity and acuity' },
          { name: 'Generate Triage Summary', intentType: 'analyze_data', description: 'Compile triage output for provider review with recommended next steps' }
        ],
        inputSchema: { required: ['symptoms'], optional: ['patientAge', 'medications', 'medicalHistory'] },
        riskLevel: 'medium', isReversible: true, involvesPhi: true, involvesFinancial: false
      },
      {
        skillName: 'clinical.triage.emergency_escalation',
        displayName: 'Emergency Escalation (911)',
        description: 'Hard-coded emergency override. Pattern-matches critical symptoms and immediately returns 911 advisory. No LLM reasoning — direct pattern match.',
        category: 'clinical',
        skillType: 'automation',
        steps: [
          { name: 'Critical Pattern Match', intentType: 'medical_unit_consult', description: 'Match symptoms against MI/CVA/sepsis/anaphylaxis patterns' },
          { name: 'Issue 911 Advisory', intentType: 'send_notification', description: 'Return immediate 911 advisory in patient-safe language and notify provider' }
        ],
        riskLevel: 'critical', isReversible: false, involvesPhi: true, involvesFinancial: false
      },
      {
        skillName: 'clinical.differential.generate',
        displayName: 'Generate Differential Diagnosis',
        description: 'Generates ranked differential diagnosis from most likely to most dangerous. Quantifies uncertainty per diagnosis. Maps symptoms to organ systems.',
        category: 'clinical',
        skillType: 'analysis',
        steps: [
          { name: 'Map to Organ Systems', intentType: 'medical_unit_consult', description: 'Map symptoms to cardiovascular, respiratory, GI, neuro, endocrine, MSK, psych systems' },
          { name: 'Generate Differential', intentType: 'medical_unit_consult', description: 'Rank diagnoses by likelihood and severity. Quantify confidence per diagnosis.' },
          { name: 'Identify Red Flags', intentType: 'medical_unit_consult', description: 'Flag must-not-miss diagnoses and recommend urgent workup if needed' },
          { name: 'Suggest Workup', intentType: 'analyze_data', description: 'Recommend labs, imaging, and referrals to narrow the differential' }
        ],
        inputSchema: { required: ['symptoms', 'audience'], optional: ['age', 'sex', 'history', 'medications', 'vitals', 'labs'] },
        riskLevel: 'high', isReversible: true, involvesPhi: true, involvesFinancial: false
      },
      {
        skillName: 'clinical.differential.refine',
        displayName: 'Refine Differential Diagnosis',
        description: 'Takes existing differential + new data (labs, imaging), narrows the list, adjusts confidence scores, suggests next diagnostic steps.',
        category: 'clinical',
        skillType: 'analysis',
        steps: [
          { name: 'Integrate New Data', intentType: 'medical_unit_consult', description: 'Incorporate new lab results, imaging, or clinical findings into existing differential' },
          { name: 'Adjust Confidence Scores', intentType: 'medical_unit_consult', description: 'Re-rank diagnoses based on updated evidence. Remove ruled-out diagnoses.' },
          { name: 'Recommend Next Steps', intentType: 'analyze_data', description: 'Suggest additional workup or confirm working diagnosis' }
        ],
        inputSchema: { required: ['existingDifferential', 'newFindings'], optional: ['labResults', 'imagingResults'] },
        riskLevel: 'high', isReversible: true, involvesPhi: true, involvesFinancial: false
      },
      {
        skillName: 'clinical.consult.provider',
        displayName: 'Provider Clinical Consult',
        description: 'Clinical-language consult for licensed providers. References guidelines (USPSTF, AHA, IDSA). Decision support only — not a prescriber.',
        category: 'clinical',
        skillType: 'query',
        steps: [
          { name: 'Clinical Consult', intentType: 'medical_unit_consult', description: 'Generate clinical-language response using provider-grade medical terminology and guideline references' }
        ],
        inputSchema: { required: ['question'], optional: ['patientContext', 'specialty'] },
        riskLevel: 'medium', isReversible: true, involvesPhi: true, involvesFinancial: false
      },
      {
        skillName: 'clinical.consult.patient',
        displayName: 'Patient Health Guidance',
        description: 'Plain-language health guidance for patients. Empathetic, calm, no jargon. Explains symptoms, what to watch for, when to seek care.',
        category: 'clinical',
        skillType: 'query',
        steps: [
          { name: 'Patient Guidance', intentType: 'medical_unit_consult', description: 'Generate patient-friendly health guidance in plain language with empathetic tone' }
        ],
        inputSchema: { required: ['question'], optional: ['symptoms', 'medications'] },
        riskLevel: 'medium', isReversible: true, involvesPhi: true, involvesFinancial: false
      },
      {
        skillName: 'clinical.note.generate_soap',
        displayName: 'Generate SOAP Note',
        description: 'Generates structured SOAP note (Subjective, Objective, Assessment, Plan) from telehealth encounter. Provider reviews and signs. AI content labeled.',
        category: 'clinical',
        skillType: 'workflow',
        steps: [
          { name: 'Extract Subjective', intentType: 'medical_unit_consult', description: 'Extract chief complaint, HPI, ROS, and PMH from encounter transcript' },
          { name: 'Compile Objective', intentType: 'medical_unit_consult', description: 'Organize vitals, exam findings, and labs into objective section' },
          { name: 'Generate Assessment', intentType: 'medical_unit_consult', description: 'Synthesize differential diagnosis and working assessment' },
          { name: 'Draft Plan', intentType: 'medical_unit_consult', description: 'Draft treatment plan including medications, follow-up, referrals, and patient education' }
        ],
        inputSchema: { required: ['encounterTranscript'], optional: ['vitals', 'labs', 'chiefComplaint'] },
        riskLevel: 'high', isReversible: true, involvesPhi: true, involvesFinancial: false
      },
      {
        skillName: 'clinical.note.after_visit_summary',
        displayName: 'After-Visit Summary',
        description: 'Generates patient-friendly after-visit summary: what was discussed, decisions made, medications reviewed, follow-up instructions, red flags.',
        category: 'clinical',
        skillType: 'workflow',
        steps: [
          { name: 'Summarize Visit', intentType: 'medical_unit_consult', description: 'Create plain-language summary of the encounter and clinical decisions' },
          { name: 'List Action Items', intentType: 'analyze_data', description: 'Compile medications, follow-up appointments, and red flags to watch for' }
        ],
        inputSchema: { required: ['encounterSummary'], optional: ['medications', 'followUpDate'] },
        riskLevel: 'medium', isReversible: true, involvesPhi: true, involvesFinancial: false
      },

      // ═══════════════════════════════════════════════════════════════
      //  PHARMACY SKILLS (Pharmacist Agent)
      // ═══════════════════════════════════════════════════════════════

      {
        skillName: 'pharmacy.interaction.check',
        displayName: 'Drug Interaction Check',
        description: 'Checks drug-drug interactions, contraindications, duplicate therapies, and dosing concerns for a proposed medication against current med list.',
        category: 'clinical',
        skillType: 'analysis',
        steps: [
          { name: 'Fetch Current Medications', intentType: 'query_database', description: 'Retrieve patient current medication list from EHR' },
          { name: 'Check Interactions', intentType: 'medical_unit_consult', description: 'Analyze proposed drug against current meds for DDI, contraindications, and duplicate therapy' },
          { name: 'Generate Safety Report', intentType: 'analyze_data', description: 'Compile interaction findings with severity ratings and alternatives' }
        ],
        inputSchema: { required: ['proposedMedication', 'patientId'], optional: ['currentMedications', 'allergies'] },
        riskLevel: 'high', isReversible: true, involvesPhi: true, involvesFinancial: false
      },
      {
        skillName: 'pharmacy.medication.reconciliation',
        displayName: 'Medication Reconciliation',
        description: 'Compares medications across sources (patient-reported, pharmacy, EHR). Identifies discrepancies, duplicates, and gaps. Outputs reconciled list.',
        category: 'clinical',
        skillType: 'workflow',
        steps: [
          { name: 'Gather Med Sources', intentType: 'query_database', description: 'Pull medication lists from patient intake, pharmacy records, and provider records' },
          { name: 'Compare and Reconcile', intentType: 'medical_unit_consult', description: 'Identify discrepancies, duplicates, and missing medications across sources' },
          { name: 'Generate Reconciled List', intentType: 'analyze_data', description: 'Produce unified reconciled medication list for provider review' }
        ],
        inputSchema: { required: ['patientId'], optional: ['patientReportedMeds', 'pharmacyRecords'] },
        riskLevel: 'high', isReversible: true, involvesPhi: true, involvesFinancial: false
      },
      {
        skillName: 'pharmacy.education.patient',
        displayName: 'Medication Education',
        description: 'Patient-friendly medication education: what the drug does, how to take it, side effects, what to report, food/drug interactions.',
        category: 'clinical',
        skillType: 'query',
        steps: [
          { name: 'Generate Education', intentType: 'medical_unit_consult', description: 'Create plain-language medication education covering purpose, dosing, side effects, and interactions' }
        ],
        inputSchema: { required: ['medicationName'], optional: ['patientAge', 'otherMeds'] },
        riskLevel: 'medium', isReversible: true, involvesPhi: true, involvesFinancial: false
      },
      {
        skillName: 'pharmacy.refill.workflow',
        displayName: 'Prescription Refill Workflow',
        description: 'End-to-end refill management: verify active prescription → check interactions → route to provider → notify patient.',
        category: 'clinical',
        skillType: 'workflow',
        steps: [
          { name: 'Verify Prescription', intentType: 'query_database', description: 'Confirm prescription is active and has remaining refills' },
          { name: 'Check Current Interactions', intentType: 'medical_unit_consult', description: 'Verify no new interactions with current medication list' },
          { name: 'Route to Provider', intentType: 'send_notification', description: 'Send refill authorization request to prescribing provider' },
          { name: 'Notify Patient', intentType: 'send_notification', description: 'Confirm refill status to patient via secure message' }
        ],
        inputSchema: { required: ['patientId', 'prescriptionId'] },
        riskLevel: 'high', isReversible: true, involvesPhi: true, involvesFinancial: false
      },
      {
        skillName: 'pharmacy.formulary.check',
        displayName: 'Insurance Formulary Check',
        description: 'Checks if a medication is on the patient insurance formulary. Suggests tier-equivalent alternatives if not covered.',
        category: 'financial',
        skillType: 'query',
        steps: [
          { name: 'Check Formulary', intentType: 'query_database', description: 'Look up medication on insurance formulary and determine tier/coverage' },
          { name: 'Suggest Alternatives', intentType: 'analyze_data', description: 'If not covered, identify therapeutically equivalent alternatives on formulary' }
        ],
        inputSchema: { required: ['medicationName', 'insurancePlan'], optional: ['diagnosis'] },
        riskLevel: 'medium', isReversible: true, involvesPhi: false, involvesFinancial: false
      },

      // ═══════════════════════════════════════════════════════════════
      //  SCHEDULING & PATIENT FLOW SKILLS (The Weaver)
      // ═══════════════════════════════════════════════════════════════

      {
        skillName: 'ops.scheduling.book_appointment',
        displayName: 'Book Telehealth Appointment',
        description: 'Books a telehealth appointment: matches patient with available provider by specialty, availability, insurance, and preference.',
        category: 'operations',
        skillType: 'workflow',
        steps: [
          { name: 'Match Provider', intentType: 'query_database', description: 'Find available providers matching specialty, insurance, and time preferences' },
          { name: 'Reserve Slot', intentType: 'create_record', description: 'Book the appointment slot and create calendar entry' },
          { name: 'Send Confirmation', intentType: 'send_notification', description: 'Send confirmation via SMS and email with prep instructions' }
        ],
        inputSchema: { required: ['patientId', 'specialty'], optional: ['preferredDate', 'preferredProvider', 'insurancePlan'] },
        riskLevel: 'medium', isReversible: true, involvesPhi: true, involvesFinancial: false
      },
      {
        skillName: 'ops.scheduling.reschedule',
        displayName: 'Reschedule Appointment',
        description: 'Handles rescheduling: finds next slot, updates calendar, notifies parties. Tracks reschedule patterns for no-show prediction.',
        category: 'operations',
        skillType: 'workflow',
        steps: [
          { name: 'Find Next Available', intentType: 'query_database', description: 'Find next available slot with same provider or equivalent' },
          { name: 'Update Appointment', intentType: 'create_record', description: 'Move appointment to new slot, update calendar' },
          { name: 'Notify All Parties', intentType: 'send_notification', description: 'Send rescheduling confirmation to patient and provider' }
        ],
        inputSchema: { required: ['appointmentId'], optional: ['preferredDate', 'reason'] },
        riskLevel: 'medium', isReversible: true, involvesPhi: true, involvesFinancial: false
      },
      {
        skillName: 'ops.scheduling.waitlist',
        displayName: 'Waitlist Management',
        description: 'Manages patient waitlist. When slot opens, auto-notifies next eligible patient. Tracks acceptance rates.',
        category: 'operations',
        skillType: 'automation',
        steps: [
          { name: 'Check Waitlist', intentType: 'query_database', description: 'Get next patient on waitlist matching open slot criteria' },
          { name: 'Offer Slot', intentType: 'send_notification', description: 'Notify waitlisted patient of available appointment' },
          { name: 'Track Response', intentType: 'fetch_metrics', description: 'Track acceptance/decline and move to next patient if declined' }
        ],
        inputSchema: { required: ['openSlotId'], optional: ['specialty', 'provider'] },
        riskLevel: 'low', isReversible: true, involvesPhi: true, involvesFinancial: false
      },
      {
        skillName: 'ops.reminders.appointment',
        displayName: 'Appointment Reminders',
        description: 'Automated appointment reminders at 48hr, 24hr, and 2hr intervals via SMS/email. Includes prep instructions.',
        category: 'operations',
        skillType: 'automation',
        steps: [
          { name: 'Fetch Upcoming Appointments', intentType: 'query_database', description: 'Get appointments needing reminders in next 48 hours' },
          { name: 'Send Reminders', intentType: 'send_notification', description: 'Send reminder via SMS and email with telehealth link and prep instructions' }
        ],
        riskLevel: 'low', isReversible: true, involvesPhi: true, involvesFinancial: false
      },

      // ═══════════════════════════════════════════════════════════════
      //  INSURANCE & BILLING SKILLS (The Alchemist + The Accountant)
      // ═══════════════════════════════════════════════════════════════

      {
        skillName: 'billing.insurance.verify_eligibility',
        displayName: 'Insurance Eligibility Verification',
        description: 'Real-time eligibility verification: active coverage, copay, deductible status, network status before the visit.',
        category: 'financial',
        skillType: 'workflow',
        steps: [
          { name: 'Query Payer', intentType: 'api_call_external', description: 'Submit 270 eligibility inquiry to insurance payer' },
          { name: 'Parse Response', intentType: 'analyze_data', description: 'Parse 271 response for coverage details, copay, deductible remaining' },
          { name: 'Update Patient Record', intentType: 'create_record', description: 'Store verified eligibility in patient insurance record' }
        ],
        inputSchema: { required: ['patientId', 'insurancePlanId'], optional: ['serviceDate', 'cptCodes'] },
        riskLevel: 'medium', isReversible: true, involvesPhi: true, involvesFinancial: false, involvesExternal: true
      },
      {
        skillName: 'billing.insurance.prior_auth',
        displayName: 'Prior Authorization Workflow',
        description: 'End-to-end prior auth: determine if PA required → gather documentation → submit to payer → track status → notify.',
        category: 'financial',
        skillType: 'workflow',
        steps: [
          { name: 'Check PA Requirement', intentType: 'query_database', description: 'Determine if service requires prior authorization for this payer' },
          { name: 'Gather Clinical Documentation', intentType: 'query_database', description: 'Collect supporting clinical documentation for medical necessity' },
          { name: 'Submit PA Request', intentType: 'api_call_external', description: 'Submit prior authorization request to payer with supporting docs' },
          { name: 'Track and Notify', intentType: 'send_notification', description: 'Track PA status and notify provider and patient of decision' }
        ],
        inputSchema: { required: ['patientId', 'serviceCode', 'insurancePlanId'], optional: ['clinicalNotes', 'urgency'] },
        riskLevel: 'high', isReversible: false, involvesPhi: true, involvesFinancial: false, involvesExternal: true
      },
      {
        skillName: 'billing.claims.submit',
        displayName: 'Submit Insurance Claim',
        description: 'Generates and submits 837P insurance claim. Validates CPT/ICD-10 codes, ensures medical necessity documentation.',
        category: 'financial',
        skillType: 'workflow',
        steps: [
          { name: 'Validate Codes', intentType: 'analyze_data', description: 'Verify CPT and ICD-10 code accuracy and medical necessity linkage' },
          { name: 'Generate 837P', intentType: 'create_record', description: 'Compile claim in 837P format with all required fields' },
          { name: 'Submit to Clearinghouse', intentType: 'api_call_external', description: 'Submit claim electronically via clearinghouse' },
          { name: 'Track Submission', intentType: 'create_record', description: 'Log claim submission and set follow-up reminders' }
        ],
        inputSchema: { required: ['encounterId', 'patientId', 'providerId'], optional: ['cptCodes', 'icdCodes'] },
        riskLevel: 'high', isReversible: false, involvesPhi: true, involvesFinancial: true, involvesExternal: true
      },
      {
        skillName: 'billing.claims.denial_management',
        displayName: 'Denial Management & Appeal',
        description: 'Analyzes denied claims, identifies denial reason, generates appeal letter with supporting documentation, resubmits.',
        category: 'financial',
        skillType: 'workflow',
        steps: [
          { name: 'Analyze Denial', intentType: 'analyze_data', description: 'Parse denial reason code and identify root cause' },
          { name: 'Gather Appeal Evidence', intentType: 'query_database', description: 'Collect clinical documentation supporting medical necessity' },
          { name: 'Generate Appeal Letter', intentType: 'medical_unit_consult', description: 'Draft appeal letter with clinical justification and supporting references' },
          { name: 'Resubmit Claim', intentType: 'api_call_external', description: 'Submit corrected claim or formal appeal to payer' }
        ],
        inputSchema: { required: ['claimId', 'denialReasonCode'] },
        riskLevel: 'high', isReversible: false, involvesPhi: true, involvesFinancial: true, involvesExternal: true
      },
      {
        skillName: 'billing.coding.suggest',
        displayName: 'CPT/ICD-10 Code Suggestion',
        description: 'Given an encounter note, suggests appropriate CPT and ICD-10 codes. Flags upcoding/downcoding risks. Provider confirms.',
        category: 'financial',
        skillType: 'analysis',
        steps: [
          { name: 'Parse Encounter', intentType: 'medical_unit_consult', description: 'Extract diagnoses, procedures, and complexity from encounter documentation' },
          { name: 'Suggest Codes', intentType: 'analyze_data', description: 'Map to CPT and ICD-10 codes with confidence scores' },
          { name: 'Validate Compliance', intentType: 'analyze_data', description: 'Check for upcoding/downcoding risk, bundling issues, and modifier requirements' }
        ],
        inputSchema: { required: ['encounterNote'], optional: ['specialty', 'visitType'] },
        riskLevel: 'medium', isReversible: true, involvesPhi: true, involvesFinancial: false
      },
      {
        skillName: 'billing.payment.collect',
        displayName: 'Patient Payment Collection',
        description: 'Manages patient payments via Stripe: sends payment links, tracks balances, offers payment plans, processes copays.',
        category: 'financial',
        skillType: 'workflow',
        steps: [
          { name: 'Calculate Amount Due', intentType: 'query_database', description: 'Determine patient responsibility from EOB and outstanding balance' },
          { name: 'Generate Payment Link', intentType: 'api_call_external', description: 'Create Stripe payment link or invoice for patient' },
          { name: 'Send Payment Request', intentType: 'send_notification', description: 'Send payment link to patient via secure message or email' },
          { name: 'Track Payment', intentType: 'fetch_metrics', description: 'Monitor payment status and send follow-up if unpaid after 7 days' }
        ],
        inputSchema: { required: ['patientId', 'amountDue'], optional: ['paymentPlan', 'dueDate'] },
        riskLevel: 'high', isReversible: false, involvesPhi: false, involvesFinancial: true, involvesExternal: true
      },

      // ═══════════════════════════════════════════════════════════════
      //  PATIENT ENGAGEMENT SKILLS (Multi-Agent)
      // ═══════════════════════════════════════════════════════════════

      {
        skillName: 'engagement.onboard.new_patient',
        displayName: 'New Patient Onboarding',
        description: 'Full onboarding: registration → insurance verification → intake forms → medication history → consent → first appointment.',
        category: 'operations',
        skillType: 'workflow',
        steps: [
          { name: 'Create Patient Record', intentType: 'create_record', description: 'Create patient account with demographics and contact info' },
          { name: 'Verify Insurance', intentType: 'api_call_external', description: 'Run eligibility verification on provided insurance' },
          { name: 'Send Intake Forms', intentType: 'send_notification', description: 'Send digital intake forms, consent documents, and medication history questionnaire' },
          { name: 'Schedule First Visit', intentType: 'create_record', description: 'Book initial telehealth consultation based on patient needs' }
        ],
        inputSchema: { required: ['firstName', 'lastName', 'dateOfBirth', 'email'], optional: ['phone', 'insuranceInfo', 'chiefComplaint'] },
        riskLevel: 'medium', isReversible: true, involvesPhi: true, involvesFinancial: false, involvesExternal: true
      },
      {
        skillName: 'engagement.followup.post_visit',
        displayName: 'Post-Visit Follow-Up',
        description: 'Automated post-visit check-in at 24hr and 7 days: symptom status, medication issues, need for follow-up. Escalates concerning responses.',
        category: 'clinical',
        skillType: 'automation',
        steps: [
          { name: 'Send 24hr Check-In', intentType: 'send_notification', description: 'Send secure message checking on symptoms and medication tolerability' },
          { name: 'Analyze Response', intentType: 'medical_unit_consult', description: 'Evaluate patient response for concerning symptoms or medication issues' },
          { name: 'Escalate or Confirm', intentType: 'send_notification', description: 'If concerning: route to provider. If stable: send 7-day follow-up.' }
        ],
        inputSchema: { required: ['encounterId', 'patientId'] },
        riskLevel: 'medium', isReversible: true, involvesPhi: true, involvesFinancial: false
      },
      {
        skillName: 'engagement.education.condition',
        displayName: 'Condition-Specific Patient Education',
        description: 'Personalized patient education: what the condition is, treatment options, lifestyle modifications, when to seek urgent care.',
        category: 'clinical',
        skillType: 'query',
        steps: [
          { name: 'Generate Education Material', intentType: 'medical_unit_consult', description: 'Create plain-language education on the diagnosed condition, tailored to patient literacy and cultural context' }
        ],
        inputSchema: { required: ['conditionName'], optional: ['patientAge', 'readingLevel', 'language'] },
        riskLevel: 'low', isReversible: true, involvesPhi: false, involvesFinancial: false
      },
      {
        skillName: 'engagement.recall.preventive',
        displayName: 'Preventive Care Recall',
        description: 'Tracks preventive care gaps: overdue screenings, missing vaccinations, annual wellness visits. Sends recalls to eligible patients.',
        category: 'operations',
        skillType: 'automation',
        steps: [
          { name: 'Identify Gaps', intentType: 'query_database', description: 'Screen patient population for overdue preventive services based on age, sex, and risk factors' },
          { name: 'Generate Recall List', intentType: 'analyze_data', description: 'Prioritize patients by overdue interval and clinical risk' },
          { name: 'Send Recalls', intentType: 'send_notification', description: 'Send personalized recall notices via preferred communication channel' }
        ],
        riskLevel: 'low', isReversible: true, involvesPhi: true, involvesFinancial: false
      },

      // ═══════════════════════════════════════════════════════════════
      //  COMPLIANCE & QUALITY SKILLS (The Guardian)
      // ═══════════════════════════════════════════════════════════════

      {
        skillName: 'compliance.hipaa.breach_assessment',
        displayName: 'Breach Risk Assessment',
        description: 'If potential breach detected: identify scope, determine notification requirements (HHS, patients), generate incident report, initiate containment.',
        category: 'compliance',
        skillType: 'workflow',
        steps: [
          { name: 'Assess Scope', intentType: 'query_database', description: 'Identify number of records affected, data types exposed, and attack vector' },
          { name: 'Determine Notification Requirements', intentType: 'analyze_data', description: 'Apply HIPAA breach notification rule: HHS within 60 days if 500+ records, individual notification, media if 500+ in one state' },
          { name: 'Generate Incident Report', intentType: 'analyze_data', description: 'Compile formal incident report with timeline, scope, and containment actions' },
          { name: 'Initiate Containment', intentType: 'send_notification', description: 'Alert security team, disable compromised access, preserve evidence' }
        ],
        inputSchema: { required: ['incidentDescription'], optional: ['affectedSystems', 'discoveryDate'] },
        riskLevel: 'critical', isReversible: false, involvesPhi: true, involvesFinancial: false
      },
      {
        skillName: 'compliance.consent.manage',
        displayName: 'Consent Management',
        description: 'Tracks patient consent forms: informed consent, telehealth consent, data sharing, research. Alerts on expired or missing consents.',
        category: 'compliance',
        skillType: 'automation',
        steps: [
          { name: 'Audit Consent Status', intentType: 'query_database', description: 'Check consent forms on file: telehealth, treatment, data sharing, research' },
          { name: 'Identify Gaps', intentType: 'analyze_data', description: 'Flag patients with missing or expired consent documents' },
          { name: 'Send Consent Requests', intentType: 'send_notification', description: 'Send digital consent forms to patients with gaps' }
        ],
        riskLevel: 'medium', isReversible: true, involvesPhi: true, involvesFinancial: false
      },
      {
        skillName: 'compliance.credentialing.verify',
        displayName: 'Provider Credentialing Verification',
        description: 'Verifies provider credentials: medical license, DEA, board certification, malpractice insurance, NPI. Tracks expirations.',
        category: 'compliance',
        skillType: 'analysis',
        steps: [
          { name: 'Query Credential Sources', intentType: 'query_database', description: 'Check provider credentials on file: license, DEA, boards, insurance, NPI' },
          { name: 'Verify External Sources', intentType: 'api_call_external', description: 'Cross-reference with NPPES, state licensing boards, and verification services' },
          { name: 'Generate Credential Report', intentType: 'analyze_data', description: 'Compile credentialing status report with expiration alerts' }
        ],
        inputSchema: { required: ['providerId'], optional: ['credentialTypes'] },
        riskLevel: 'medium', isReversible: true, involvesPhi: false, involvesFinancial: false, involvesExternal: true
      },
      {
        skillName: 'compliance.quality.measures',
        displayName: 'Quality Measures Tracking',
        description: 'Tracks HEDIS, MIPS/MACRA, and state-specific quality measures. Identifies care gaps. Generates quality improvement reports.',
        category: 'compliance',
        skillType: 'analysis',
        steps: [
          { name: 'Fetch Quality Data', intentType: 'query_database', description: 'Pull clinical data for applicable quality measures' },
          { name: 'Calculate Measure Rates', intentType: 'analyze_data', description: 'Compute numerator/denominator for each measure, identify gaps' },
          { name: 'Generate QI Report', intentType: 'analyze_data', description: 'Produce quality improvement report with actionable recommendations' }
        ],
        riskLevel: 'low', isReversible: true, involvesPhi: true, involvesFinancial: false
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
