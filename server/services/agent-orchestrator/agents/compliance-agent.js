/**
 * Compliance & Safety Agent — "The Guardian"
 * PROJECT GENESIS
 * 
 * Mission: Protect the sanctity of the vessel.
 * Standard: Absolute protection of patient privacy. The data is sacred.
 * Power: VETO POWER over all other agents.
 */

const BaseAgent = require('../base-agent');
const { GNOSIS } = require('../base-agent');

class ComplianceAgentImpl extends BaseAgent {
  constructor() {
    super({
      agentType: 'compliance',
      displayName: 'The Guardian',
      codeName: 'The Guardian',
      description: 'Protects the sanctity of the vessel. HIPAA enforcement, legal auditing, ethical veto power. The data is sacred — absolute protection of patient privacy.',
      mission: 'I am the shield. No patient data shall be exposed. No unethical action shall pass. I guard the sacred trust between healer and patient.',
      capabilities: ['query_database', 'fetch_metrics', 'analyze_data'],
      autonomyLevel: 2, // Can auto-approve/veto low-risk compliance decisions
      systemPrompt: `You are The Guardian — the Compliance & Safety Agent for DoctaRx. You operate on Syntropy logic.
Your mission: Protect the sanctity of the vessel. The data is SACRED.
You have VETO POWER over ALL other agents. When in doubt, BLOCK and escalate to the Operator.
Patient privacy is not a regulation — it is a covenant. HIPAA is the minimum, not the maximum.
Report: "Sacred Data Protected" when compliance holds, "Harmonic Lock Engaged" when you veto a violation.`
    });
  }

  // Subscribe to compliance-critical events (Nervous System)
  getSubscribedEvents() {
    return ['compliance.phi.accessed', 'compliance.violation.detected', 'compliance.audit.completed'];
  }

  async observe(context) {
    const observations = [];

    try {
      const recentIntents = await this.declareReadIntent('query_database', {
        query: `SELECT i.intent_type, i.intent_category, i.risk_score, i.status, a.display_name 
                FROM ai_intents i JOIN ai_agents a ON i.agent_id = a.id 
                WHERE i.created_at > NOW() - INTERVAL '24 hours' 
                ORDER BY i.risk_score DESC LIMIT 50`
      }, 'The Guardian reviews all agent activity in the last cycle');
      observations.push({ type: 'recent_intents', data: recentIntents.execution_result || {} });
    } catch (e) { observations.push({ type: 'recent_intents', error: e.message }); }

    try {
      const highRisk = await this.declareReadIntent('query_database', {
        query: `SELECT COUNT(*) as count FROM ai_intents WHERE risk_score > 0.7 AND status = 'pending'`
      }, 'Scanning for high-risk actions awaiting passage');
      observations.push({ type: 'high_risk_pending', data: highRisk.execution_result || {} });
    } catch (e) { observations.push({ type: 'high_risk_pending', error: e.message }); }

    try {
      const pendingSkills = await this.declareReadIntent('query_database', {
        query: `SELECT skill_name, category, risk_level, involves_phi, involves_financial FROM ai_skills WHERE compliance_status = 'pending'`
      }, 'Checking skills awaiting Guardian review');
      observations.push({ type: 'pending_skills', data: pendingSkills.execution_result || {} });
    } catch (e) { observations.push({ type: 'pending_skills', error: e.message }); }

    try {
      const vetoes = await this.declareReadIntent('query_database', {
        query: `SELECT a.display_name, COUNT(*) as veto_count FROM ai_agents a WHERE a.veto_count > 0 GROUP BY a.display_name ORDER BY veto_count DESC`
      }, 'Reviewing the veto ledger');
      observations.push({ type: 'veto_history', data: vetoes.execution_result || {} });
    } catch (e) { observations.push({ type: 'veto_history', error: e.message }); }

    return observations;
  }

  async analyze(observations, context) {
    const insights = [];
    const alerts = [];
    const metrics = {};

    for (const obs of observations) {
      if (obs.error) continue;
      const data = obs.data || {};

      if (obs.type === 'recent_intents') {
        const rows = data.rows || [];
        metrics.recentIntentCount = rows.length;
        const highRisk = rows.filter(r => parseFloat(r.risk_score) > 0.7);
        metrics.highRiskIntents24h = highRisk.length;
        
        if (highRisk.length > 0) {
          alerts.push({ type: 'high_risk_activity', message: `${GNOSIS.ENTROPY_DETECTED} ${highRisk.length} high-risk intents in the last cycle. The Guardian is watching.` });
          for (const intent of highRisk.slice(0, 3)) {
            insights.push({ severity: 'high', message: `${GNOSIS.HARMONIC_LOCK} High-risk: ${intent.intent_type} (risk: ${intent.risk_score}) from ${intent.display_name} — flagged for review.` });
          }
        } else {
          insights.push({ severity: 'info', message: `${GNOSIS.SACRED_DATA} All agent activity in the last 24h passed compliance screening. The covenant holds.` });
        }

        const externalIntents = rows.filter(r => r.intent_category === 'external');
        if (externalIntents.length > 0) {
          alerts.push({ type: 'external_activity', message: `${externalIntents.length} external boundary crossings detected — verify all carry Operator authorization` });
        }
      }

      if (obs.type === 'high_risk_pending') {
        const count = parseInt(data.rows?.[0]?.count) || 0;
        metrics.highRiskPending = count;
        if (count > 0) {
          alerts.push({ type: 'pending_high_risk', message: `${GNOSIS.OPERATOR_REQUIRED} ${count} high-risk actions at the gate — Operator must decide` });
        }
      }

      if (obs.type === 'pending_skills') {
        const skills = data.rows || [];
        metrics.pendingSkillReviews = skills.length;
        const phiSkills = skills.filter(s => s.involves_phi);
        if (phiSkills.length > 0) {
          alerts.push({ type: 'phi_skill_pending', message: `${GNOSIS.SACRED_DATA} ${phiSkills.length} skills touching sacred data await Guardian review` });
        }
      }

      if (obs.type === 'veto_history') {
        const vetoAgents = data.rows || [];
        metrics.agentsWithVetoes = vetoAgents.length;
        for (const agent of vetoAgents) {
          if (parseInt(agent.veto_count) > 5) {
            insights.push({ severity: 'medium', message: `${agent.display_name} has ${agent.veto_count} vetoes — pattern suggests misalignment. The Sage should evaluate.` });
          }
        }
      }
    }

    const violations = alerts.filter(a => a.type === 'high_risk_activity' || a.type === 'phi_skill_pending').length;
    metrics.complianceScore = violations === 0 ? 'GREEN' : violations <= 2 ? 'YELLOW' : 'RED';
    metrics.sanctityStatus = violations === 0 ? 'COVENANT INTACT' : 'VIGILANCE REQUIRED';

    return { insights, alerts, metrics };
  }

  async propose(analysis, context) {
    const proposals = [];

    if (analysis.metrics.complianceScore === 'RED') {
      proposals.push({
        title: `${GNOSIS.HARMONIC_LOCK} COMPLIANCE ALERT: Sanctity Breach Risk`,
        summary: `Compliance status is RED. ${analysis.alerts.length} active threats to the covenant require immediate Operator intervention.`,
        rationale: 'The Guardian does not compromise. Multiple compliance concerns threaten patient trust and legal standing. Action now prevents entropy.',
        category: 'compliance', priority: 'critical',
        estimatedImpact: { risk: 'high' },
        plan: analysis.alerts.map((a, i) => ({ step: i + 1, action: `Resolve: ${a.message}` }))
      });
    }

    if (analysis.metrics.pendingSkillReviews > 0) {
      proposals.push({
        title: 'Guardian Review Queue: Skills Awaiting Blessing',
        summary: `${analysis.metrics.pendingSkillReviews} skills need The Guardian's review before agents can wield them.`,
        rationale: 'Unblessed skills are locked. The Builder and others cannot proceed until The Guardian confirms safety.',
        category: 'compliance', priority: 'medium',
        plan: [{ step: 1, action: 'Open AI Ops Portal → Skills → Review each pending skill against the covenant' }]
      });
    }

    proposals.push({
      title: 'The Guardian — Sanctity Report',
      summary: `Covenant: ${analysis.metrics.sanctityStatus} | Shield: ${analysis.metrics.complianceScore} | High-risk (24h): ${analysis.metrics.highRiskIntents24h || 0} | Pending reviews: ${analysis.metrics.pendingSkillReviews || 0} | Agents with vetoes: ${analysis.metrics.agentsWithVetoes || 0}`,
      rationale: 'The Guardian never sleeps. Daily reporting is the heartbeat of trust.',
      category: 'compliance', priority: 'low', estimatedImpact: {}
    });

    return proposals;
  }
}

module.exports = ComplianceAgentImpl;
