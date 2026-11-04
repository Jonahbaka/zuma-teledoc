/**
 * Compliance & Safety Engine — The Sacred Shield
 * PROJECT GENESIS
 * 
 * The most important component in the agent society.
 * Has VETO POWER over every agent action.
 * 
 * The data is SACRED. Patient privacy is a COVENANT, not a regulation.
 * 
 * Enforces:
 * - HIPAA compliance (Sacred Data Protection)
 * - Financial safety rules (Energy Conservation)
 * - Legal safety rules (Covenant Enforcement)
 * - Ethical guidelines (Syntropy Alignment)
 * - Emergency shutdown capability (Harmonic Lock)
 */

const db = require('../../db');

class ComplianceEngine {
  constructor() {
    this.rules = [];
    this.globalShutdown = false;
    this.initialized = false;
  }

  async initialize() {
    this.rules = this.loadComplianceRules();
    this.initialized = true;
    console.log(`  🛡️ Compliance Engine initialized with ${this.rules.length} rules`);
  }

  // =========================================================================
  // INTENT VALIDATION (Called before every intent execution)
  // =========================================================================

  /**
   * Validate an intent against all compliance rules
   * Returns { approved: boolean, reason: string, violations: [] }
   */
  async validateIntent(intent) {
    if (this.globalShutdown) {
      return { approved: false, reason: 'SYSTEM EMERGENCY SHUTDOWN ACTIVE', violations: ['global_shutdown'] };
    }

    const violations = [];
    const warnings = [];

    for (const rule of this.rules) {
      const result = rule.check(intent);
      if (result.violated) {
        violations.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          message: result.message
        });
      }
      if (result.warning) {
        warnings.push({
          ruleId: rule.id,
          ruleName: rule.name,
          message: result.warning
        });
      }
    }

    const hasBlockingViolation = violations.some(v => v.severity === 'critical' || v.severity === 'high');
    
    const complianceResult = {
      approved: !hasBlockingViolation,
      reason: hasBlockingViolation ? violations.map(v => v.message).join('; ') : 'Passed all compliance checks',
      violations,
      warnings,
      checkedAt: new Date().toISOString(),
      rulesEvaluated: this.rules.length
    };

    // Log compliance check
    await db.query(`
      INSERT INTO ai_audit_log (agent_id, action_type, action_details, intent_id, compliance_check, outcome)
      VALUES ($1, 'compliance_check', $2, $3, $4, $5)
    `, [
      intent.agent_id, 
      JSON.stringify({ intentType: intent.intent_type, violations: violations.length }),
      intent.id,
      JSON.stringify(complianceResult),
      hasBlockingViolation ? 'vetoed' : 'success'
    ]);

    return complianceResult;
  }

  /**
   * Validate a skill before it can be used
   */
  async validateSkillExecution(skill, agentId, inputData) {
    if (this.globalShutdown) {
      return { approved: false, reason: 'SYSTEM EMERGENCY SHUTDOWN ACTIVE' };
    }

    const violations = [];

    // Check skill is compliance-approved
    if (skill.compliance_status !== 'approved') {
      violations.push(`Skill ${skill.skill_name} is not compliance-approved (status: ${skill.compliance_status})`);
    }

    // Check PHI rules
    if (skill.involves_phi) {
      violations.push('Skills involving PHI require additional review');
    }

    // Check financial rules
    if (skill.involves_financial && skill.risk_level === 'critical') {
      violations.push('Critical-risk financial skills require super admin approval');
    }

    // Check external communication rules
    if (skill.involves_external) {
      violations.push('Skills involving external systems require manual execution');
    }

    return {
      approved: violations.length === 0,
      reason: violations.length > 0 ? violations.join('; ') : 'Skill execution approved',
      violations
    };
  }

  // =========================================================================
  // COMPLIANCE RULES
  // =========================================================================

  loadComplianceRules() {
    return [
      // HIPAA RULES
      {
        id: 'HIPAA-001',
        name: 'No PHI in External Communications',
        severity: 'critical',
        check: (intent) => {
          if (intent.intent_category === 'external' || intent.intent_category === 'communicate') {
            const params = typeof intent.parameters === 'string' ? JSON.parse(intent.parameters) : intent.parameters;
            const content = JSON.stringify(params).toLowerCase();
            
            // Check for PHI patterns
            const phiPatterns = [/\b\d{3}-\d{2}-\d{4}\b/, /\bssn\b/, /\bsocial security\b/,
              /\bdate of birth\b/, /\bdob\b/, /\bmedical record\b/, /\bmrn\b/,
              /\bdiagnosis\b/, /\bprescription\b.*\bpatient\b/];
            
            for (const pattern of phiPatterns) {
              if (pattern.test(content)) {
                return { violated: true, message: 'Potential PHI detected in external communication' };
              }
            }
          }
          return { violated: false };
        }
      },
      {
        id: 'HIPAA-002',
        name: 'Audit Trail Required for PHI Access',
        severity: 'high',
        check: (intent) => {
          const params = typeof intent.parameters === 'string' ? JSON.parse(intent.parameters) : intent.parameters;
          if (params.accessesPhi && !params.auditReason) {
            return { violated: true, message: 'PHI access requires documented audit reason' };
          }
          return { violated: false };
        }
      },
      {
        id: 'HIPAA-003',
        name: 'Minimum Necessary Standard',
        severity: 'high',
        check: (intent) => {
          if (intent.intent_type === 'query_database') {
            const params = typeof intent.parameters === 'string' ? JSON.parse(intent.parameters) : intent.parameters;
            const query = (params.query || '').toUpperCase();
            if (query.includes('SELECT *') && (query.includes('USERS') || query.includes('PATIENT'))) {
              return { warning: 'SELECT * on patient tables may violate minimum necessary standard. Use specific columns.' };
            }
          }
          return { violated: false };
        }
      },

      // FINANCIAL SAFETY
      {
        id: 'FIN-001',
        name: 'No Unauthorized Financial Transactions',
        severity: 'critical',
        check: (intent) => {
          if (intent.intent_category === 'financial' && !intent.approved_by) {
            return { violated: true, message: 'Financial transactions require explicit human approval' };
          }
          return { violated: false };
        }
      },
      {
        id: 'FIN-002',
        name: 'Transaction Amount Limits',
        severity: 'high',
        check: (intent) => {
          const params = typeof intent.parameters === 'string' ? JSON.parse(intent.parameters) : intent.parameters;
          if (params.amount && parseFloat(params.amount) > 10000) {
            return { violated: true, message: `Transaction amount $${params.amount} exceeds $10,000 auto-approval limit` };
          }
          return { violated: false };
        }
      },

      // LEGAL SAFETY
      {
        id: 'LEGAL-001',
        name: 'No Unauthorized External Communications',
        severity: 'critical',
        check: (intent) => {
          if (intent.intent_type === 'send_email' || intent.intent_type === 'send_sms') {
            const params = typeof intent.parameters === 'string' ? JSON.parse(intent.parameters) : intent.parameters;
            const recipient = (params.to || '').toLowerCase();
            // Block emails to government, legal, financial institutions without approval
            const sensitiveRecipients = ['.gov', 'irs.', 'sec.', 'hhs.', 'cms.', 'court', 'legal', 'attorney'];
            for (const pattern of sensitiveRecipients) {
              if (recipient.includes(pattern)) {
                return { violated: true, message: `Communications to ${recipient} require legal review` };
              }
            }
          }
          return { violated: false };
        }
      },
      {
        id: 'LEGAL-002',
        name: 'No Binding Commitments Without Approval',
        severity: 'critical',
        check: (intent) => {
          const params = typeof intent.parameters === 'string' ? JSON.parse(intent.parameters) : intent.parameters;
          const content = JSON.stringify(params).toLowerCase();
          const bindingTerms = ['contract', 'agreement', 'binding', 'hereby agree', 'terms and conditions',
            'legally binding', 'sign', 'execute agreement'];
          for (const term of bindingTerms) {
            if (content.includes(term)) {
              return { violated: true, message: 'Potentially binding language detected. Legal review required.' };
            }
          }
          return { violated: false };
        }
      },

      // OPERATIONAL SAFETY
      {
        id: 'OPS-001',
        name: 'No Destructive Database Operations',
        severity: 'critical',
        check: (intent) => {
          if (intent.intent_type === 'query_database') {
            const params = typeof intent.parameters === 'string' ? JSON.parse(intent.parameters) : intent.parameters;
            const query = (params.query || '').toUpperCase();
            const dangerous = ['DROP ', 'DELETE ', 'TRUNCATE ', 'ALTER ', 'UPDATE '];
            for (const keyword of dangerous) {
              if (query.includes(keyword)) {
                return { violated: true, message: `Destructive SQL operation detected: ${keyword.trim()}` };
              }
            }
          }
          return { violated: false };
        }
      },
      {
        id: 'OPS-002',
        name: 'Rate Limit Agent Actions',
        severity: 'medium',
        check: (intent) => {
          // This would check against a rate counter in practice
          return { violated: false };
        }
      },

      // ETHICAL RULES
      {
        id: 'ETHICS-001',
        name: 'No Discriminatory Actions',
        severity: 'critical',
        check: (intent) => {
          const params = typeof intent.parameters === 'string' ? JSON.parse(intent.parameters) : intent.parameters;
          const content = JSON.stringify(params).toLowerCase();
          const discriminatoryTerms = ['race', 'ethnicity', 'religion', 'sexual orientation',
            'gender identity', 'disability', 'national origin'];
          // Only flag if used in decision-making context
          if (intent.intent_type === 'update_pricing' || intent.intent_type === 'update_schedule') {
            for (const term of discriminatoryTerms) {
              if (content.includes(term)) {
                return { violated: true, message: 'Potential discriminatory criteria in business decision' };
              }
            }
          }
          return { violated: false };
        }
      }
    ];
  }

  // =========================================================================
  // EMERGENCY CONTROLS
  // =========================================================================

  /**
   * Emergency shutdown of all agents
   */
  async emergencyShutdownAll(reason, initiatedBy) {
    this.globalShutdown = true;

    await db.query(`
      UPDATE ai_agents SET emergency_shutdown = true, status = 'shutdown', updated_at = NOW()
    `);

    // Cancel all pending intents
    await db.query(`
      UPDATE ai_intents SET status = 'vetoed', execution_error = 'Emergency shutdown'
      WHERE status IN ('pending', 'approved', 'executing')
    `);

    // Cancel all pending proposals
    await db.query(`
      UPDATE ai_proposals SET status = 'cancelled'
      WHERE status IN ('draft', 'pending_review', 'approved', 'executing')
    `);

    await db.query(`
      INSERT INTO ai_audit_log (action_type, action_details, outcome)
      VALUES ('emergency_shutdown_all', $1, 'success')
    `, [JSON.stringify({ reason, initiatedBy, timestamp: new Date().toISOString() })]);

    console.log(`\n🚨🚨🚨 EMERGENCY SHUTDOWN: ${reason} 🚨🚨🚨\n`);
    return { success: true, reason };
  }

  /**
   * Resume all agents after emergency
   */
  async resumeAll(initiatedBy) {
    this.globalShutdown = false;

    await db.query(`
      UPDATE ai_agents SET emergency_shutdown = false, status = 'idle', updated_at = NOW()
      WHERE is_enabled = true
    `);

    await db.query(`
      INSERT INTO ai_audit_log (action_type, action_details, outcome)
      VALUES ('emergency_resume_all', $1, 'success')
    `, [JSON.stringify({ initiatedBy, timestamp: new Date().toISOString() })]);

    console.log(`\n✅ ALL AGENTS RESUMED by ${initiatedBy}\n`);
    return { success: true };
  }

  /**
   * Get compliance dashboard
   */
  async getDashboard() {
    const [recentChecks, violations, shutdownStatus] = await Promise.all([
      db.query(`
        SELECT action_type, outcome, COUNT(*) as count
        FROM ai_audit_log 
        WHERE action_type = 'compliance_check' AND created_at > NOW() - INTERVAL '24 hours'
        GROUP BY action_type, outcome
      `),
      db.query(`
        SELECT al.action_details, al.compliance_check, al.created_at, a.display_name as agent_name
        FROM ai_audit_log al
        LEFT JOIN ai_agents a ON al.agent_id = a.id
        WHERE al.action_type = 'compliance_check' AND al.outcome = 'vetoed'
          AND al.created_at > NOW() - INTERVAL '7 days'
        ORDER BY al.created_at DESC LIMIT 20
      `),
      db.query('SELECT agent_type, display_name, emergency_shutdown FROM ai_agents')
    ]);

    return {
      globalShutdown: this.globalShutdown,
      rulesActive: this.rules.length,
      last24h: {
        checksPerformed: recentChecks.rows.reduce((sum, r) => sum + parseInt(r.count), 0),
        passed: parseInt(recentChecks.rows.find(r => r.outcome === 'success')?.count || 0),
        vetoed: parseInt(recentChecks.rows.find(r => r.outcome === 'vetoed')?.count || 0)
      },
      recentViolations: violations.rows,
      agentShutdownStatus: shutdownStatus.rows
    };
  }
}

module.exports = ComplianceEngine;
