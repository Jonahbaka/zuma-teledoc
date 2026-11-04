/**
 * Governance Engine - Proposal Review, Scoring, and Approval Workflows
 * PROJECT GENESIS — The Covenant Enforcement Layer
 * 
 * Every agent proposal flows through governance before execution.
 * Scores proposals by: risk, reversibility, legality, cost, impact, AND Vibrational Alignment (3-6-9).
 * Manages autonomy levels and approval routing.
 * 
 * The Sage oversees this engine. Any action that increases Entropy is vetoed.
 */

const db = require('../../db');

class GovernanceEngine {
  constructor() {
    this.policies = [];
    this.initialized = false;
  }

  async initialize() {
    await this.loadPolicies();
    await this.registerDefaultPolicies();
    this.initialized = true;
    console.log(`  ⚖️ Governance Engine initialized with ${this.policies.length} policies`);
  }

  // =========================================================================
  // PROPOSAL MANAGEMENT
  // =========================================================================

  /**
   * Submit a proposal for governance review
   */
  async submitProposal(proposalData) {
    const {
      agentId, title, summary, detailedPlan, rationale,
      category, priority, estimatedImpact, estimatedCost
    } = proposalData;

    // Score the proposal
    const governanceScore = this.scoreProposal(proposalData);

    const result = await db.query(`
      INSERT INTO ai_proposals (
        agent_id, title, summary, detailed_plan, rationale,
        category, priority, estimated_impact, estimated_cost,
        governance_score, overall_score, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      agentId, title, summary,
      JSON.stringify(detailedPlan || {}), rationale,
      category, priority,
      JSON.stringify(estimatedImpact || {}), estimatedCost || 0,
      JSON.stringify(governanceScore), governanceScore.overall,
      'pending_review'
    ]);

    return result.rows[0];
  }

  /**
   * Score a proposal on multiple dimensions + Vibrational Impact (3-6-9)
   */
  scoreProposal(proposal) {
    // Risk Score (0 = no risk, 1 = maximum risk)
    let riskScore = 0.3;
    if (proposal.category === 'financial') riskScore += 0.3;
    if (proposal.category === 'corporate') riskScore += 0.2;
    if (proposal.estimatedCost > 1000) riskScore += 0.1;
    if (proposal.estimatedCost > 10000) riskScore += 0.2;
    riskScore = Math.min(riskScore, 1);

    // Reversibility (0 = irreversible, 1 = fully reversible)
    let reversibility = 0.7;
    if (proposal.category === 'operations') reversibility = 0.9;
    if (proposal.category === 'corporate') reversibility = 0.3;
    if (proposal.category === 'financial') reversibility = 0.4;

    // Legality (0 = illegal, 1 = fully legal)
    let legality = 0.9;

    // Cost efficiency / Energy Conservation (0 = wasteful, 1 = excellent ROI)
    let costScore = 0.5;
    const impact = proposal.estimatedImpact || {};
    if (impact.revenue > 0 && (proposal.estimatedCost || 0) > 0) {
      const roi = impact.revenue / proposal.estimatedCost;
      costScore = Math.min(roi / 10, 1);
    }
    if ((proposal.estimatedCost || 0) === 0) costScore = 0.9; // Zero waste = energy conserved

    // Impact (0 = no impact, 1 = transformative)
    let impactScore = 0.5;
    if (proposal.priority === 'critical') impactScore = 0.9;
    if (proposal.priority === 'high') impactScore = 0.7;
    if (proposal.priority === 'low') impactScore = 0.3;
    if (impact.efficiency) impactScore = Math.max(impactScore, impact.efficiency / 100);

    // *** VIBRATIONAL IMPACT (3-6-9 Framework) ***
    // 3 = Intent: Creation vs Fear
    let vibrationalIntent = 0.5;
    if (['operations', 'compliance', 'growth'].includes(proposal.category)) vibrationalIntent = 0.8; // Service-oriented
    if (proposal.priority === 'critical' && proposal.category === 'compliance') vibrationalIntent = 0.6; // Defensive but necessary

    // 6 = Structure: Efficient, closed-loop
    let vibrationalStructure = 0.5;
    if (proposal.detailedPlan && typeof proposal.detailedPlan === 'object') {
      const planSteps = Array.isArray(proposal.detailedPlan) ? proposal.detailedPlan.length : Object.keys(proposal.detailedPlan).length;
      vibrationalStructure = Math.min(0.3 + (planSteps * 0.15), 1); // More structured = better
    }

    // 9 = Ascension: Liberates from suffering
    let vibrationalAscension = 0.5;
    if (impact.efficiency > 0) vibrationalAscension += 0.2;
    if (impact.newPatients > 0) vibrationalAscension += 0.2;
    if (proposal.category === 'operations') vibrationalAscension += 0.1; // Reduces friction
    vibrationalAscension = Math.min(vibrationalAscension, 1);

    const vibrational = Math.round(((vibrationalIntent * 3 + vibrationalStructure * 6 + vibrationalAscension * 9) / 18) * 100) / 100;

    // Overall weighted score (now includes vibrational impact)
    const overall = Math.round((
      (1 - riskScore) * 0.20 +
      reversibility * 0.10 +
      legality * 0.20 +
      costScore * 0.10 +
      impactScore * 0.15 +
      vibrational * 0.25           // 25% weight on Vibrational Alignment
    ) * 100) / 100;

    return {
      risk: Math.round(riskScore * 100) / 100,
      reversibility: Math.round(reversibility * 100) / 100,
      legality: Math.round(legality * 100) / 100,
      cost: Math.round(costScore * 100) / 100,
      impact: Math.round(impactScore * 100) / 100,
      vibrational: Math.round(vibrational * 100) / 100,
      resonance: vibrational >= 0.7 ? 'ALIGNED' : vibrational >= 0.4 ? 'PARTIAL' : 'DISSONANT',
      overall
    };
  }

  /**
   * Approve a proposal
   */
  async approveProposal(proposalId, reviewedBy, notes = '') {
    await db.query(`
      UPDATE ai_proposals SET 
        status = 'approved', reviewed_by = $1, review_notes = $2, reviewed_at = NOW(), updated_at = NOW()
      WHERE id = $3 AND status = 'pending_review'
    `, [reviewedBy, notes, proposalId]);

    await db.query(`
      INSERT INTO ai_audit_log (action_type, action_details, proposal_id, outcome, human_approved, approved_by)
      VALUES ('proposal_approved', $1, $2, 'success', true, $3)
    `, [JSON.stringify({ notes }), proposalId, reviewedBy]);

    return this.getProposal(proposalId);
  }

  /**
   * Reject a proposal
   */
  async rejectProposal(proposalId, reviewedBy, notes = '') {
    await db.query(`
      UPDATE ai_proposals SET 
        status = 'rejected', reviewed_by = $1, review_notes = $2, reviewed_at = NOW(), updated_at = NOW()
      WHERE id = $3 AND status = 'pending_review'
    `, [reviewedBy, notes, proposalId]);

    await db.query(`
      INSERT INTO ai_audit_log (action_type, action_details, proposal_id, outcome, human_approved, approved_by)
      VALUES ('proposal_rejected', $1, $2, 'vetoed', false, $3)
    `, [JSON.stringify({ notes }), proposalId, reviewedBy]);
  }

  /**
   * Get a proposal by ID
   */
  async getProposal(proposalId) {
    const result = await db.query(`
      SELECT p.*, a.display_name as agent_name 
      FROM ai_proposals p JOIN ai_agents a ON p.agent_id = a.id
      WHERE p.id = $1
    `, [proposalId]);
    return result.rows[0];
  }

  /**
   * Get proposals by status
   */
  async getProposals(options = {}) {
    const { status, category, agentId, limit = 50 } = options;
    let query = 'SELECT p.*, a.display_name as agent_name FROM ai_proposals p JOIN ai_agents a ON p.agent_id = a.id WHERE 1=1';
    const params = [];

    if (status) { params.push(status); query += ` AND p.status = $${params.length}`; }
    if (category) { params.push(category); query += ` AND p.category = $${params.length}`; }
    if (agentId) { params.push(agentId); query += ` AND p.agent_id = $${params.length}`; }

    params.push(limit);
    query += ` ORDER BY CASE p.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, p.created_at DESC LIMIT $${params.length}`;

    const result = await db.query(query, params);
    return result.rows;
  }

  // =========================================================================
  // GOVERNANCE POLICIES
  // =========================================================================

  async loadPolicies() {
    try {
      const result = await db.query('SELECT * FROM ai_governance_policies WHERE is_enabled = true ORDER BY priority DESC');
      this.policies = result.rows;
    } catch {
      this.policies = [];
    }
  }

  async registerDefaultPolicies() {
    const defaults = [
      {
        name: 'auto_approve_read_intents',
        description: 'Read-only intents are always auto-approved',
        ruleType: 'auto_approve',
        conditions: { intentCategory: 'read' },
        actions: { approve: true },
        priority: 1000
      },
      {
        name: 'block_external_without_approval',
        description: 'All external API calls require human approval',
        ruleType: 'require_approval',
        conditions: { intentCategory: 'external' },
        actions: { requireHumanApproval: true, notifyAdmin: true },
        priority: 900
      },
      {
        name: 'block_financial_without_approval',
        description: 'All financial transactions require human approval',
        ruleType: 'require_approval',
        conditions: { intentCategory: 'financial' },
        actions: { requireHumanApproval: true, notifyAdmin: true },
        priority: 900
      },
      {
        name: 'escalate_high_risk',
        description: 'High risk intents (>0.7) require super admin approval',
        ruleType: 'escalate',
        conditions: { riskScoreAbove: 0.7 },
        actions: { requireSuperAdmin: true, notifyAdmin: true },
        priority: 800
      },
      {
        name: 'auto_reject_phi_exposure',
        description: 'Reject any intent that would expose PHI externally',
        ruleType: 'auto_reject',
        conditions: { involvesPhi: true, intentCategory: 'external' },
        actions: { reject: true, reason: 'PHI cannot be sent to external systems' },
        priority: 950
      }
    ];

    for (const policy of defaults) {
      try {
        await db.query(`
          INSERT INTO ai_governance_policies (policy_name, description, rule_type, conditions, actions, priority)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (policy_name) DO NOTHING
        `, [policy.name, policy.description, policy.ruleType, JSON.stringify(policy.conditions), JSON.stringify(policy.actions), policy.priority]);
      } catch { /* ignore */ }
    }

    await this.loadPolicies();
  }

  /**
   * Evaluate policies against an intent
   */
  evaluatePolicy(intent) {
    for (const policy of this.policies) {
      const conditions = policy.conditions || {};
      let matches = true;

      if (conditions.intentCategory && intent.intentCategory !== conditions.intentCategory) matches = false;
      if (conditions.riskScoreAbove && intent.riskScore <= conditions.riskScoreAbove) matches = false;
      if (conditions.involvesPhi && !intent.involvesPhi) matches = false;

      if (matches) {
        return { policy: policy.policy_name, ruleType: policy.rule_type, actions: policy.actions };
      }
    }

    return null;
  }

  // =========================================================================
  // AUTONOMY MANAGEMENT
  // =========================================================================

  /**
   * Get/set autonomy level for an agent
   */
  async setAutonomyLevel(agentId, level) {
    if (level < 0 || level > 5) throw new Error('Autonomy level must be 0-5');
    
    await db.query('UPDATE ai_agents SET autonomy_level = $1, updated_at = NOW() WHERE id = $2', [level, agentId]);
    
    await db.query(`
      INSERT INTO ai_audit_log (agent_id, action_type, action_details, outcome)
      VALUES ($1, 'autonomy_changed', $2, 'success')
    `, [agentId, JSON.stringify({ newLevel: level })]);
  }

  /**
   * Get governance dashboard stats
   */
  async getDashboardStats() {
    const [proposals, intents, agents] = await Promise.all([
      db.query(`
        SELECT status, COUNT(*) as count 
        FROM ai_proposals WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY status
      `),
      db.query(`
        SELECT status, COUNT(*) as count 
        FROM ai_intents WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY status
      `),
      db.query('SELECT agent_type, display_name, status, autonomy_level, run_count, veto_count FROM ai_agents ORDER BY agent_type')
    ]);

    return {
      proposals: Object.fromEntries(proposals.rows.map(r => [r.status, parseInt(r.count)])),
      intents: Object.fromEntries(intents.rows.map(r => [r.status, parseInt(r.count)])),
      agents: agents.rows
    };
  }
}

module.exports = GovernanceEngine;
