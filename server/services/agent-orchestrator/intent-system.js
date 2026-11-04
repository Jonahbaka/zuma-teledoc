/**
 * Intent System - Declares, routes, and tracks agent intents
 * 
 * Agents NEVER execute actions directly.
 * They declare intents, which flow through:
 * Intent → Compliance Check → Governance Review → Capability Adapter → Execution
 */

const db = require('../../db');

class IntentSystem {
  constructor() {
    this.pendingIntents = new Map();
    this.intentHandlers = new Map(); // intentType → handler function
  }

  /**
   * Declare a new intent from an agent
   */
  async declare(intentData) {
    const {
      agentId, intentType, intentCategory, parameters,
      reasoning, expectedOutcome, confidence, isReversible, riskScore
    } = intentData;

    // Determine if approval is needed based on risk and autonomy
    const agent = await db.query('SELECT autonomy_level FROM ai_agents WHERE id = $1', [agentId]);
    const autonomyLevel = agent.rows[0]?.autonomy_level || 0;
    const requiresApproval = this.requiresApproval(intentCategory, riskScore, autonomyLevel);

    const result = await db.query(`
      INSERT INTO ai_intents (
        agent_id, intent_type, intent_category, parameters,
        reasoning, expected_outcome, confidence,
        requires_approval, is_reversible, risk_score,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      agentId, intentType, intentCategory, JSON.stringify(parameters),
      reasoning, expectedOutcome, confidence,
      requiresApproval, isReversible, riskScore,
      requiresApproval ? 'pending' : 'approved'
    ]);

    const intent = result.rows[0];

    // Auto-execute if no approval needed
    if (!requiresApproval) {
      await this.executeIntent(intent);
    } else {
      this.pendingIntents.set(intent.id, intent);
    }

    return intent;
  }

  /**
   * Determine if an intent requires human approval
   */
  requiresApproval(category, riskScore, autonomyLevel) {
    // Read operations never need approval
    if (category === 'read') return false;

    // Autonomy level 0 = everything needs approval
    if (autonomyLevel === 0) return true;

    // Risk-based thresholds per autonomy level
    const thresholds = {
      1: 0.10, // Only auto-approve minimal risk
      2: 0.30, // Auto-approve low risk
      3: 0.50, // Auto-approve medium risk
      4: 0.70, // Auto-approve most things
      5: 1.00  // Full autonomy (never use in production)
    };

    const threshold = thresholds[autonomyLevel] || 0;
    
    // External and financial always need approval unless autonomy >= 4
    if ((category === 'external' || category === 'financial') && autonomyLevel < 4) {
      return true;
    }

    return riskScore > threshold;
  }

  /**
   * Approve a pending intent (called by human or governance engine)
   */
  async approveIntent(intentId, approvedBy = null) {
    await db.query(`
      UPDATE ai_intents SET status = 'approved', approved_by = $1, approved_at = NOW()
      WHERE id = $2 AND status = 'pending'
    `, [approvedBy, intentId]);

    const intent = await db.query('SELECT * FROM ai_intents WHERE id = $1', [intentId]);
    if (intent.rows[0]) {
      await this.executeIntent(intent.rows[0]);
    }

    return intent.rows[0];
  }

  /**
   * Reject/veto an intent
   */
  async vetoIntent(intentId, reason, vetoedBy = null) {
    await db.query(`
      UPDATE ai_intents SET status = 'vetoed', execution_error = $1
      WHERE id = $2 AND status IN ('pending', 'approved')
    `, [reason, intentId]);

    // Log veto in audit
    const intent = await db.query('SELECT * FROM ai_intents WHERE id = $1', [intentId]);
    if (intent.rows[0]) {
      await db.query(`
        INSERT INTO ai_audit_log (agent_id, action_type, action_details, intent_id, outcome)
        VALUES ($1, 'intent_vetoed', $2, $3, 'vetoed')
      `, [intent.rows[0].agent_id, JSON.stringify({ reason, vetoedBy }), intentId]);

      // Increment veto count on agent
      await db.query('UPDATE ai_agents SET veto_count = veto_count + 1 WHERE id = $1', [intent.rows[0].agent_id]);
    }
  }

  /**
   * Execute an approved intent through the capability layer
   */
  async executeIntent(intent) {
    const startTime = Date.now();

    try {
      await db.query("UPDATE ai_intents SET status = 'executing' WHERE id = $1", [intent.id]);

      // Find the appropriate handler/adapter
      const handler = this.intentHandlers.get(intent.intent_type);
      let result;

      if (handler) {
        result = await handler(intent.parameters, intent);
      } else {
        // Default: log intent as executed but with no adapter
        result = { status: 'no_adapter', message: `No adapter registered for intent: ${intent.intent_type}` };
      }

      const duration = Date.now() - startTime;

      await db.query(`
        UPDATE ai_intents SET 
          status = 'completed', execution_result = $1, 
          execution_duration_ms = $2, executed_at = NOW(),
          adapter_used = $3
        WHERE id = $4
      `, [JSON.stringify(result), duration, result.adapter || 'default', intent.id]);

      // Audit log
      await db.query(`
        INSERT INTO ai_audit_log (agent_id, action_type, action_details, intent_id, outcome, outcome_details)
        VALUES ($1, 'intent_executed', $2, $3, 'success', $4)
      `, [intent.agent_id, JSON.stringify({ intentType: intent.intent_type }), intent.id, JSON.stringify(result)]);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      await db.query(`
        UPDATE ai_intents SET status = 'failed', execution_error = $1, execution_duration_ms = $2, executed_at = NOW()
        WHERE id = $3
      `, [error.message, duration, intent.id]);

      await db.query(`
        INSERT INTO ai_audit_log (agent_id, action_type, action_details, intent_id, outcome, outcome_details)
        VALUES ($1, 'intent_failed', $2, $3, 'failure', $4)
      `, [intent.agent_id, JSON.stringify({ intentType: intent.intent_type, error: error.message }), intent.id, JSON.stringify({ error: error.message })]);

      throw error;
    }
  }

  // =========================================================================
  // HANDLER REGISTRATION (Capability Adapter Binding)
  // =========================================================================

  /**
   * Register a handler for an intent type
   * This is how capability adapters connect to the intent system
   */
  registerHandler(intentType, handler) {
    this.intentHandlers.set(intentType, handler);
  }

  /**
   * Register multiple handlers
   */
  registerHandlers(handlerMap) {
    for (const [intentType, handler] of Object.entries(handlerMap)) {
      this.registerHandler(intentType, handler);
    }
  }

  // =========================================================================
  // QUERIES
  // =========================================================================

  async getPendingIntents(options = {}) {
    const { agentId, limit = 50 } = options;
    let query = "SELECT i.*, a.display_name as agent_name FROM ai_intents i JOIN ai_agents a ON i.agent_id = a.id WHERE i.status = 'pending'";
    const params = [];

    if (agentId) {
      params.push(agentId);
      query += ` AND i.agent_id = $${params.length}`;
    }

    params.push(limit);
    query += ` ORDER BY i.risk_score DESC, i.created_at ASC LIMIT $${params.length}`;

    const result = await db.query(query, params);
    return result.rows;
  }

  async getIntentHistory(options = {}) {
    const { agentId, status, limit = 100 } = options;
    let query = 'SELECT i.*, a.display_name as agent_name FROM ai_intents i JOIN ai_agents a ON i.agent_id = a.id WHERE 1=1';
    const params = [];

    if (agentId) { params.push(agentId); query += ` AND i.agent_id = $${params.length}`; }
    if (status) { params.push(status); query += ` AND i.status = $${params.length}`; }

    params.push(limit);
    query += ` ORDER BY i.created_at DESC LIMIT $${params.length}`;

    const result = await db.query(query, params);
    return result.rows;
  }

  async getIntentStats() {
    const result = await db.query(`
      SELECT 
        a.display_name as agent_name,
        i.status,
        COUNT(*) as count,
        AVG(i.execution_duration_ms) as avg_duration_ms
      FROM ai_intents i
      JOIN ai_agents a ON i.agent_id = a.id
      WHERE i.created_at > NOW() - INTERVAL '7 days'
      GROUP BY a.display_name, i.status
      ORDER BY a.display_name, i.status
    `);
    return result.rows;
  }

  /**
   * Expire old pending intents
   */
  async expireStaleIntents() {
    const result = await db.query(`
      UPDATE ai_intents SET status = 'expired'
      WHERE status = 'pending' AND expires_at < NOW()
      RETURNING id
    `);
    return result.rowCount;
  }
}

module.exports = IntentSystem;
