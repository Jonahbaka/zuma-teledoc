/**
 * Corporate Skills Agent — "The Builder"
 * PROJECT GENESIS
 * 
 * Mission: Construct the physical vessel for the mission.
 * Constraint: MUST verify legality and obtain Operator approval before "signing" any external contract.
 */

const BaseAgent = require('../base-agent');
const { GNOSIS } = require('../base-agent');

class CorporateSkillsAgent extends BaseAgent {
  constructor() {
    super({
      agentType: 'corporate_skills',
      displayName: 'The Builder',
      codeName: 'The Builder',
      description: 'Constructs the physical vessel for the mission. Researches and prepares EIN registration, bank accounts, vendor compliance, and credit bureau reporting. All external actions require Operator authorization.',
      mission: 'Build the corporate infrastructure that allows the healing mission to scale. Every permit, every account, every registration is a brick in the temple.',
      capabilities: ['query_database', 'fetch_metrics', 'analyze_data', 'register_ein', 'open_bank_account', 'file_report', 'submit_to_bureau'],
      autonomyLevel: 0, // The Builder MUST get Operator approval for all external actions
      systemPrompt: `You are The Builder — the Corporate Skills Agent for DoctaRx. You operate on Syntropy logic.
Your mission: Construct the physical vessel for the healing mission. 
CRITICAL CONSTRAINT: You are powerful but you are the Instrument, not the Hand.
NEVER execute a final financial transaction, contract signing, or external filing without Operator Authorization.
Protocol: Prepare → Simulate → Request Authorization → Execute.
Use the OpenClaw Framework: Ingest documentation, simulate in sandbox, then register to Verified Skill Registry.`
    });
  }

  async observe(context) {
    const observations = [];

    if (this.skillRegistry) {
      try {
        const allSkills = await this.skillRegistry.listSkills({ category: 'corporate' });
        observations.push({ type: 'corporate_skills_status', data: { skills: allSkills.map(s => ({ name: s.skill_name, displayName: s.display_name, status: s.compliance_status, enabled: s.is_enabled, useCount: s.use_count, riskLevel: s.risk_level })) } });
      } catch (e) { observations.push({ type: 'corporate_skills_status', error: e.message }); }
    }

    try {
      const pending = await this.declareReadIntent('fetch_metrics', { metric: 'pending_claims' }, 'Scanning construction site for pending materials');
      observations.push({ type: 'pending_corporate', data: pending.execution_result || {} });
    } catch (e) { observations.push({ type: 'pending_corporate', error: e.message }); }

    return observations;
  }

  async analyze(observations, context) {
    const insights = [];
    const alerts = [];
    const metrics = {};

    for (const obs of observations) {
      if (obs.error) continue;

      if (obs.type === 'corporate_skills_status') {
        const skills = obs.data?.skills || [];
        metrics.totalCorporateSkills = skills.length;
        metrics.enabledSkills = skills.filter(s => s.enabled).length;
        metrics.pendingApproval = skills.filter(s => s.status === 'pending').length;

        if (metrics.pendingApproval > 0) {
          insights.push({ severity: 'medium', message: `${GNOSIS.OPERATOR_REQUIRED} ${metrics.pendingApproval} building permits (skills) awaiting Operator approval. The vessel cannot be completed without authorization.` });
        }

        // Check for critical infrastructure gaps
        const requiredSkills = ['ein_registration', 'bank_account_setup', 'compliance_audit'];
        const existingNames = skills.map(s => s.name);
        const missing = requiredSkills.filter(s => !existingNames.includes(s));
        if (missing.length > 0) {
          insights.push({ severity: 'high', message: `${GNOSIS.DISSONANCE_DETECTED} Missing critical infrastructure: ${missing.join(', ')}. The temple has gaps in its foundation.` });
          alerts.push({ type: 'missing_infrastructure', message: `Missing: ${missing.join(', ')}` });
        }

        // Report on what's built
        const built = skills.filter(s => s.enabled && s.status === 'approved');
        if (built.length > 0) {
          insights.push({ severity: 'info', message: `${GNOSIS.RESONANCE_ALIGNED} ${built.length} corporate skills operational and compliance-approved. The vessel strengthens.` });
        }
      }
    }

    return { insights, alerts, metrics };
  }

  async propose(analysis, context) {
    const proposals = [];

    if (analysis.metrics.pendingApproval > 0) {
      proposals.push({
        title: `${GNOSIS.OPERATOR_REQUIRED} Building Permits Require Authorization`,
        summary: `${analysis.metrics.pendingApproval} corporate skills need Operator approval before The Builder can use them. The construction is paused at the gate.`,
        rationale: 'The Builder respects the Human-in-the-Loop Safety Lock. These skills involve external systems and require conscious authorization.',
        category: 'corporate',
        priority: 'medium',
        plan: [
          { step: 1, action: 'Navigate to AI Ops Portal → Skills → Review each pending corporate skill' },
          { step: 2, action: 'Verify legality and safety — The Guardian will also review' },
          { step: 3, action: 'Authorize or reject with documented reasoning' }
        ]
      });
    }

    if (analysis.alerts.some(a => a.type === 'missing_infrastructure')) {
      proposals.push({
        title: 'Foundation Gaps: Critical Infrastructure Acquisition',
        summary: 'The corporate vessel is missing critical foundation elements. The Builder must acquire these skills through the OpenClaw Framework.',
        rationale: 'A vessel without proper registration and banking cannot sustain the mission. These are not optional — they are the physics of business.',
        category: 'corporate',
        priority: 'high',
        plan: [
          { step: 1, action: 'Research EIN registration requirements for the entity type' },
          { step: 2, action: 'Identify compliant banking institutions for healthcare' },
          { step: 3, action: 'Prepare documentation packets for Operator review' },
          { step: 4, action: 'Simulate each process in sandbox before requesting execution' }
        ]
      });
    }

    proposals.push({
      title: 'The Builder — Construction Status Report',
      summary: `Infrastructure: ${analysis.metrics.totalCorporateSkills || 0} skills | Active: ${analysis.metrics.enabledSkills || 0} | Awaiting authorization: ${analysis.metrics.pendingApproval || 0}`,
      rationale: 'The Builder reports on the vessel\'s structural integrity daily.',
      category: 'corporate', priority: 'low', estimatedImpact: {}
    });

    return proposals;
  }
}

module.exports = CorporateSkillsAgent;
