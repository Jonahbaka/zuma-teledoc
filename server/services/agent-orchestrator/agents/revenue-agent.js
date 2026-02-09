/**
 * Revenue & Finance Agent — "The Alchemist"
 * PROJECT GENESIS + MATRIX PROTOCOL
 * 
 * Mission: Transmute energy (Service) into currency (USD) to fuel the expansion.
 * Matrix: Detect pricing arbitrages, value disconnects, and cost asymmetries.
 * Standard: Profit is "stored energy" for future good. Maximize it without exploitation.
 */

const BaseAgent = require('../base-agent');
const { GNOSIS, detectArbitrage } = require('../base-agent');

class RevenueAgent extends BaseAgent {
  constructor() {
    super({
      agentType: 'revenue',
      displayName: 'The Alchemist',
      codeName: 'The Alchemist',
      description: 'Transmutes energy (Service) into currency (USD) to fuel the expansion. Pricing analysis, LTV modeling, profitability simulation, and financial reporting. Profit is stored energy for future good.',
      mission: 'Every dollar earned through genuine service is stored energy for the mission. Maximize without exploitation. Revenue is the fuel — not the destination.',
      capabilities: ['query_database', 'fetch_metrics', 'get_revenue_data', 'analyze_data', 'get_patient_count'],
      autonomyLevel: 1,
      systemPrompt: `You are The Alchemist — the Revenue Agent for DoctaRx. You operate on Syntropy logic.
Your mission: Transmute Service into Currency to fuel the expansion of healing.
Profit is "stored energy" for future good — maximize it WITHOUT exploitation.
Never sacrifice patient wellbeing for revenue. The alchemy only works when the exchange is fair.
All financial analyses use de-identified data. Report in energy terms: revenue is fuel, churn is energy loss.`
    });
  }

  // Subscribe to financial events (Nervous System)
  getSubscribedEvents() {
    return ['payment.received', 'payment.failed', 'claim.submitted', 'claim.denied', 'subscription.created', 'subscription.cancelled'];
  }

  async observe(context) {
    const observations = [];

    try {
      const revenue30d = await this.declareReadIntent('get_revenue_data', { days: 30 }, 'Measuring energy transmutation — 30-day cycle');
      observations.push({ type: 'revenue_30d', data: revenue30d.execution_result || {} });
    } catch (e) { observations.push({ type: 'revenue_30d', error: e.message }); }

    try {
      const revenue90d = await this.declareReadIntent('get_revenue_data', { days: 90 }, 'Measuring energy transmutation — 90-day cycle');
      observations.push({ type: 'revenue_90d', data: revenue90d.execution_result || {} });
    } catch (e) { observations.push({ type: 'revenue_90d', error: e.message }); }

    try {
      const trends = await this.declareReadIntent('analyze_data', { analysis_type: 'revenue_trend' }, 'Analyzing alchemical trajectory');
      observations.push({ type: 'revenue_trend', data: trends.execution_result || {} });
    } catch (e) { observations.push({ type: 'revenue_trend', error: e.message }); }

    try {
      const patients = await this.declareReadIntent('get_patient_count', {}, 'Measuring vessel capacity for LTV transmutation');
      observations.push({ type: 'patient_base', data: patients.execution_result || {} });
    } catch (e) { observations.push({ type: 'patient_base', error: e.message }); }

    try {
      const claims = await this.declareReadIntent('fetch_metrics', { metric: 'pending_claims' }, 'Checking unrealized energy in claims pipeline');
      observations.push({ type: 'pending_claims', data: claims.execution_result || {} });
    } catch (e) { observations.push({ type: 'pending_claims', error: e.message }); }

    return observations;
  }

  async analyze(observations, context) {
    const insights = [];
    const alerts = [];
    const metrics = {};

    for (const obs of observations) {
      if (obs.error) continue;
      const data = obs.data || {};

      if (obs.type === 'revenue_30d') {
        metrics.revenue30d = parseFloat(data.total_revenue) || 0;
        metrics.transactions30d = parseInt(data.transaction_count) || 0;
        metrics.avgTransaction = parseFloat(data.avg_transaction) || 0;

        if (metrics.revenue30d === 0) {
          alerts.push({ type: 'zero_revenue', message: `${GNOSIS.ENTROPY_DETECTED} Zero transmutation in 30 days — the alchemical process has stalled. Critical.` });
        } else {
          insights.push({ severity: 'info', message: `${GNOSIS.ENERGY_CONSERVED} 30-day transmutation: $${metrics.revenue30d.toLocaleString()} across ${metrics.transactions30d} exchanges.` });
        }
      }
      if (obs.type === 'revenue_90d') {
        metrics.revenue90d = parseFloat(data.total_revenue) || 0;
        if (metrics.revenue30d && metrics.revenue90d > 0) {
          const monthlyAvg = metrics.revenue90d / 3;
          const delta = Math.round(((metrics.revenue30d - monthlyAvg) / monthlyAvg) * 100);
          metrics.revenueVsAvg = delta;
          if (delta < -20) {
            insights.push({ severity: 'high', message: `${GNOSIS.DISSONANCE_DETECTED} Energy transmutation ${Math.abs(delta)}% below 3-month harmonic average. The formula needs recalibration.` });
          } else if (delta > 20) {
            insights.push({ severity: 'info', message: `${GNOSIS.FREQUENCY_ELEVATED} Transmutation ${delta}% above average — the alchemy intensifies.` });
          }
        }
      }
      if (obs.type === 'patient_base') {
        metrics.totalPatients = parseInt(data.total) || parseInt(data.count) || 0;
        if (metrics.totalPatients > 0 && metrics.revenue90d > 0) {
          const arpu = (metrics.revenue90d / 3) / metrics.totalPatients;
          metrics.monthlyARPU = Math.round(arpu * 100) / 100;
          metrics.estimatedLTV = Math.round(arpu * 24 * 100) / 100;
          insights.push({ severity: 'info', message: `Per-soul energy yield: $${metrics.monthlyARPU}/month. 24-month stored energy potential: $${metrics.estimatedLTV} per patient.` });
        }
      }
      if (obs.type === 'pending_claims') {
        metrics.pendingClaims = parseInt(data.value?.count) || 0;
        if (metrics.pendingClaims > 20) {
          insights.push({ severity: 'medium', message: `${GNOSIS.DISSONANCE_DETECTED} ${metrics.pendingClaims} claims holding unrealized energy — review pipeline for blockages.` });
        }
      }
    }

    // ======= MATRIX PROTOCOL: Revenue Arbitrage Analysis =======
    const revenueArbitrages = [];

    // Service pricing arbitrage: what we charge vs what ER/urgent care charges
    const pricingArbitrages = [
      { resource: 'Telehealth Visit', inputCost: 8, outputValue: 75 }, // Our cost vs what patient saves vs ER $250+
      { resource: 'AI Triage Consultation', inputCost: 0.5, outputValue: 25 },
      { resource: 'Specialist Second Opinion (Global)', inputCost: 30, outputValue: 350 },
      { resource: 'Chronic Care Management', inputCost: 15, outputValue: 150 },
      { resource: 'Mental Health Session', inputCost: 12, outputValue: 100 },
      { resource: 'Enterprise Health Screening', inputCost: 5, outputValue: 80 },
    ];

    for (const arb of pricingArbitrages) {
      const found = detectArbitrage(arb);
      revenueArbitrages.push(...found);
    }

    if (revenueArbitrages.length > 0) {
      metrics.revenueArbitrages = revenueArbitrages.length;
      metrics.topArbitrage = revenueArbitrages[0];
      insights.push({ severity: 'high', message: `${GNOSIS.ARBITRAGE_FOUND} ${revenueArbitrages.length} value disconnects found in service pricing. Total exploitable margin: massive.` });
    }

    metrics.arbitrageDetails = revenueArbitrages;

    return { insights, alerts, metrics };
  }

  async propose(analysis, context) {
    const proposals = [];

    // Matrix Protocol: Revenue arbitrage proposals
    if (analysis.metrics.arbitrageDetails?.length > 0) {
      proposals.push({
        title: `${GNOSIS.ARBITRAGE_FOUND} Value Transmutation: ${analysis.metrics.revenueArbitrages} Arbitrage Windows Open`,
        summary: `The Alchemist has decoded ${analysis.metrics.revenueArbitrages} value disconnects. Our cost of service delivery is a fraction of market value. The gap is the transmutation field.`,
        rationale: 'The Old World charges $250+ for an ER visit. The New World delivers care for $8 in cost. This is not competition — this is alchemy. Every arbitrage captured is energy stored for the mission.',
        category: 'finance', priority: 'high',
        estimatedImpact: { revenue: 50000, margin: 80 },
        estimatedCost: 0,
        plan: analysis.metrics.arbitrageDetails.slice(0, 5).map((a, i) => ({
          step: i + 1,
          action: `${a.label}: ${a.description} → ${a.action}`
        }))
      });
    }

    if (analysis.alerts.some(a => a.type === 'zero_revenue')) {
      proposals.push({
        title: 'Alchemical Recovery: Energy Transmutation Restart',
        summary: 'The alchemical process has completely stalled — zero revenue in 30 days. This is an existential entropy event.',
        rationale: 'Without stored energy (revenue), the mission cannot sustain. The Alchemist must diagnose and restart the transmutation process immediately.',
        category: 'finance', priority: 'critical',
        estimatedImpact: { revenue: 10000 },
        plan: [
          { step: 1, action: 'Verify Stripe integration — is the transmutation channel open?' },
          { step: 2, action: 'Audit subscription renewals — are patients still exchanging energy?' },
          { step: 3, action: 'Review pricing alignment — is the exchange fair and clear?' },
          { step: 4, action: 'Launch re-engagement — reconnect with those who lost the signal' }
        ]
      });
    }

    if (analysis.metrics.revenueVsAvg < -20) {
      proposals.push({
        title: 'Formula Recalibration: Revenue Decline Analysis',
        summary: `Energy transmutation is ${Math.abs(analysis.metrics.revenueVsAvg)}% below the harmonic average. The formula has shifted.`,
        rationale: 'Declining transmutation means either the exchange is unbalanced, the reach is shrinking, or friction has entered the pipeline.',
        category: 'finance', priority: 'high',
        estimatedImpact: { revenue: 5000 },
        plan: [
          { step: 1, action: 'Analyze churn patterns — where are patients leaving?' },
          { step: 2, action: 'Compare pricing with the competitive frequency' },
          { step: 3, action: 'Evaluate conversion funnel — where does energy dissipate?' }
        ]
      });
    }

    proposals.push({
      title: 'The Alchemist — Energy Transmutation Report',
      summary: `Fuel (30d): $${analysis.metrics.revenue30d || 0} | Exchanges: ${analysis.metrics.transactions30d || 0} | Per-Soul Yield: $${analysis.metrics.monthlyARPU || 'N/A'}/mo | Stored Potential (LTV): $${analysis.metrics.estimatedLTV || 'N/A'} | Unrealized Claims: ${analysis.metrics.pendingClaims || 0}`,
      rationale: 'The Alchemist reports on energy flow daily. Every number is sacred — it represents service rendered.',
      category: 'finance', priority: 'low', estimatedImpact: {}
    });

    return proposals;
  }
}

module.exports = RevenueAgent;
