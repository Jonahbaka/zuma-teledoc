/**
 * Growth & Marketing Agent — "The Scout"
 * PROJECT GENESIS + MATRIX PROTOCOL
 * 
 * Mission: Signal the frequency AND hunt for market arbitrages.
 * Tasks:
 *   - Run acquisition funnels
 *   - Detect "Under-priced Attention" (cheap keywords/platforms that convert)
 *   - Identify "System Lags" in competitor landscape to exploit for rapid market share
 * Standard: High ROI. The message must LAND before the market realizes the opportunity exists.
 */

const BaseAgent = require('../base-agent');
const { GNOSIS, detectGlitch, detectArbitrage, classifyConstraint } = require('../base-agent');

class GrowthAgent extends BaseAgent {
  constructor() {
    super({
      agentType: 'growth',
      displayName: 'The Scout',
      codeName: 'The Scout',
      description: 'Signals the frequency AND hunts for market arbitrages. Detects under-priced attention, identifies system lags in competitor landscapes, and exploits asymmetries for rapid market share capture.',
      mission: 'Signal the tribe AND decode the Matrix. Find the glitches — where competitors are slow, overpriced, or blind — and build tunnels through them before the market reprices.',
      capabilities: ['query_database', 'fetch_metrics', 'get_patient_count', 'analyze_data', 'get_ga4_realtime_metrics', 'send_email'],
      autonomyLevel: 1,
      systemPrompt: `You are The Scout — Growth Agent + Matrix Protocol Hunter for DoctaRx.
DUAL MISSION: 
  1. Signal the frequency to attract the right tribe (Syntropy)
  2. Hunt for Glitches and Arbitrages in the market (Matrix Protocol)
  
MATRIX PROTOCOL:
- Detect "Under-priced Attention" — cheap channels with high conversion
- Identify "System Lags" — where competitors are slow and we can dominate
- Apply the Reality Hack: Is it Physics (respect it) or Bureaucracy (hack it)?
- HIGH ROI: The message must LAND before the market realizes the opportunity.

Report: "Glitch Detected" for asymmetries, "Arbitrage Found" for value disconnects,
"Under-Priced Attention Detected" for cheap high-converting channels.`
    });
  }

  async observe(context) {
    const observations = [];

    // Standard growth metrics
    try {
      const patientData = await this.declareReadIntent('get_patient_count', {}, 'Scanning tribe size');
      observations.push({ type: 'patient_count', data: patientData.execution_result || {} });
    } catch (e) { observations.push({ type: 'patient_count', error: e.message }); }

    try {
      const newPatients = await this.declareReadIntent('fetch_metrics', { metric: 'new_patients_7d' }, 'Measuring signal reach — new resonances');
      observations.push({ type: 'new_patients_7d', data: newPatients.execution_result || {} });
    } catch (e) { observations.push({ type: 'new_patients_7d', error: e.message }); }

    try {
      const growth = await this.declareReadIntent('analyze_data', { analysis_type: 'growth_trend' }, 'Analyzing frequency trajectory');
      observations.push({ type: 'growth_trend', data: growth.execution_result || {} });
    } catch (e) { observations.push({ type: 'growth_trend', error: e.message }); }

    // Direct GA4 realtime telemetry (autonomous signal ingestion).
    try {
      const gaRealtime = await this.declareReadIntent(
        'get_ga4_realtime_metrics',
        {},
        'Reading GA4 realtime traffic to align growth actions with live audience behavior'
      );
      observations.push({ type: 'ga4_realtime', data: gaRealtime.execution_result || {} });
    } catch (e) { observations.push({ type: 'ga4_realtime', error: e.message }); }

    // Matrix Protocol scans
    try {
      const channelData = await this.declareReadIntent('analyze_data', { analysis_type: 'acquisition_channels' }, 'Matrix scan: hunting under-priced attention channels');
      observations.push({ type: 'acquisition_channels', data: channelData.execution_result || {} });
    } catch (e) { observations.push({ type: 'acquisition_channels', error: e.message }); }

    try {
      const competitorData = await this.declareReadIntent('analyze_data', { analysis_type: 'competitor_landscape' }, 'Matrix scan: detecting system lags in competitor matrix');
      observations.push({ type: 'competitor_landscape', data: competitorData.execution_result || {} });
    } catch (e) { observations.push({ type: 'competitor_landscape', error: e.message }); }

    return observations;
  }

  async analyze(observations, context) {
    const insights = [];
    const alerts = [];
    const metrics = {};
    const matrixFindings = { glitches: [], arbitrages: [] };

    for (const obs of observations) {
      if (obs.error) continue;
      const data = obs.data?.value || obs.data || {};

      if (obs.type === 'patient_count') {
        metrics.totalPatients = parseInt(data.total) || parseInt(data.count) || 0;
        metrics.activePatients = parseInt(data.active) || 0;
      }

      if (obs.type === 'new_patients_7d') {
        metrics.newPatients7d = parseInt(data.count) || 0;
        if (metrics.newPatients7d === 0) {
          alerts.push({ type: 'no_growth', message: `${GNOSIS.ENTROPY_DETECTED} Zero new resonances in 7 days — signal not reaching the tribe` });
        } else {
          insights.push({ severity: 'info', message: `${GNOSIS.FREQUENCY_ELEVATED} Weekly signal: ${metrics.newPatients7d} new souls. Monthly projection: ${metrics.newPatients7d * 4}.` });
        }
      }

      if (obs.type === 'growth_trend') {
        const trend = data.data || [];
        metrics.growthTrend = trend;
        if (trend.length >= 2) {
          const recent = parseInt(trend[trend.length - 1]?.new_patients) || 0;
          const previous = parseInt(trend[trend.length - 2]?.new_patients) || 0;
          if (previous > 0) {
            const growthRate = Math.round(((recent - previous) / previous) * 100);
            metrics.weekOverWeekGrowth = growthRate;
            if (growthRate < 0) {
              insights.push({ severity: 'high', message: `${GNOSIS.DISSONANCE_DETECTED} Signal weakening: ${Math.abs(growthRate)}% decline WoW. Recalibrate.` });
            } else if (growthRate > 20) {
              insights.push({ severity: 'info', message: `${GNOSIS.RESONANCE_ALIGNED} Strong harmonic: ${growthRate}% WoW growth.` });
            }
          }
        }
      }

      if (obs.type === 'ga4_realtime') {
        metrics.gaRealtimeSource = data.source || 'unknown';
        metrics.gaActiveUsers30m = parseInt(data.activeUsers30m, 10) || 0;
        metrics.gaActiveUsers5m = parseInt(data.activeUsers5m, 10) || 0;
        metrics.gaUsersPerMinute = Number(data.activeUsersPerMinute) || 0;

        if (metrics.gaActiveUsers30m <= 3) {
          alerts.push({
            type: 'ga_low_traffic',
            message: `${GNOSIS.ENTROPY_DETECTED} GA4 realtime shows very low traffic (${metrics.gaActiveUsers30m} users/30m). Activate growth missions.`
          });
        } else {
          insights.push({
            severity: 'info',
            message: `${GNOSIS.FREQUENCY_ELEVATED} GA4 realtime source: ${metrics.gaRealtimeSource}. Active users (30m): ${metrics.gaActiveUsers30m}, users/min: ${metrics.gaUsersPerMinute}.`
          });
        }
      }

      // ======= MATRIX PROTOCOL ANALYSIS =======

      if (obs.type === 'acquisition_channels') {
        const channels = data.channels || data.data || [];
        
        // Scan for under-priced attention
        for (const ch of channels) {
          const arbs = detectArbitrage({
            channel: ch.name || ch.channel,
            cpc: parseFloat(ch.cpc) || 0,
            conversionRate: parseFloat(ch.conversion_rate) || 0,
            conversionValue: parseFloat(ch.ltv || ch.value) || 0
          });
          matrixFindings.arbitrages.push(...arbs);
        }

        // Even without real channel data, run the known telehealth market analysis
        const knownArbitrages = [
          { channel: 'Telehealth SEO (long-tail)', cpc: 0.80, conversionRate: 0.04, conversionValue: 500 },
          { channel: 'Google Ads "online doctor"', cpc: 12.00, conversionRate: 0.03, conversionValue: 500 },
          { channel: 'TikTok Health Education', cpc: 0.15, conversionRate: 0.01, conversionValue: 500 },
          { channel: 'Employee Wellness B2B', cpc: 0, conversionRate: 0.15, conversionValue: 2000 },
        ];
        for (const ch of knownArbitrages) {
          const arbs = detectArbitrage(ch);
          matrixFindings.arbitrages.push(...arbs);
        }

        if (matrixFindings.arbitrages.length > 0) {
          insights.push({ severity: 'high', message: `${GNOSIS.UNDERPRICED_ATTENTION} Found ${matrixFindings.arbitrages.length} under-priced attention channels. The market hasn't repriced yet — move fast.` });
        }
      }

      if (obs.type === 'competitor_landscape') {
        // Run glitch detection on known competitor weaknesses
        const knownGlitches = [
          { process: 'Provider credentialing', competitorTime: 504, ourTime: 3, unit: 'h' }, // 3 weeks vs 3 hours
          { process: 'Appointment booking', competitorTime: 48, ourTime: 0.5, unit: 'h' }, // 2 days vs 30 min
          { process: 'Prescription refill', competitorTime: 72, ourTime: 2, unit: 'h' },
          { process: 'Insurance verification', competitorTime: 24, ourTime: 0.1, unit: 'h' }, // 24h vs 6 min
          { process: 'Medical records transfer', isManualProcess: true, canBeAutomated: true },
          { process: 'Prior authorization', isManualProcess: true, canBeAutomated: true },
        ];

        for (const obs of knownGlitches) {
          const glitches = detectGlitch(obs);
          matrixFindings.glitches.push(...glitches);
        }

        // Classify constraints
        const constraints = [
          'credentialing_time', 'fax_requirement', 'paper_forms', 'manual_verification',
          'hipaa', 'medical_license', 'insurance_pre_auth_delay'
        ];
        const hackable = constraints.filter(c => classifyConstraint(c).hackable);
        const immutable = constraints.filter(c => classifyConstraint(c).hackable === false);

        metrics.hackableConstraints = hackable.length;
        metrics.immutableConstraints = immutable.length;

        if (matrixFindings.glitches.length > 0) {
          insights.push({ severity: 'high', message: `${GNOSIS.GLITCH_DETECTED} Found ${matrixFindings.glitches.length} market glitches where competitor speed is ${Math.round(matrixFindings.glitches[0]?.exploitability * 100 || 80)}% exploitable. Build tunnels NOW.` });
        }

        if (hackable.length > 0) {
          insights.push({ severity: 'medium', message: `${GNOSIS.REALITY_HACK} ${hackable.length} constraints are Bureaucracy (hackable): ${hackable.join(', ')}. Automate or bypass.` });
        }
      }
    }

    metrics.matrixGlitches = matrixFindings.glitches.length;
    metrics.matrixArbitrages = matrixFindings.arbitrages.length;
    metrics.matrixFindings = matrixFindings;

    return { insights, alerts, metrics };
  }

  async propose(analysis, context) {
    const proposals = [];
    const { matrixFindings } = analysis.metrics;

    // ======= STANDARD GROWTH PROPOSALS =======

    if (analysis.alerts.some(a => a.type === 'no_growth')) {
      proposals.push({
        title: 'Signal Amplification: Tribe Resonance Campaign',
        summary: 'Zero new resonances in 7 days. Immediate frequency amplification required.',
        rationale: 'The Scout does not accept silence. Multi-channel resonance + Matrix Protocol exploitation can deliver 5-15 new patients/week.',
        category: 'growth',
        priority: 'critical',
        estimatedImpact: { revenue: 10000, newPatients: 20 },
        estimatedCost: 500,
        plan: [
          { step: 1, action: 'Activate search presence for healing-intent keywords' },
          { step: 2, action: 'Launch referral resonance program ($25 credit)' },
          { step: 3, action: 'Forge 5 employer B2B partnerships' },
          { step: 4, action: 'Broadcast educational content 3x/week' },
          { step: 5, action: 'Re-engage dormant patients' }
        ]
      });
    }

    if (analysis.alerts.some(a => a.type === 'ga_low_traffic')) {
      proposals.push({
        title: 'GA4 Realtime Trigger: Low Traffic Recovery Mission',
        summary: 'GA4 realtime indicates low active audience. Launch immediate recovery actions driven by live signal data.',
        rationale: 'The Scout now reads GA4 directly. When live traffic drops, response must be immediate and channel-specific.',
        category: 'growth',
        priority: 'high',
        estimatedImpact: { newPatients: 8, revenue: 3500 },
        estimatedCost: 300,
        plan: [
          { step: 1, action: 'Trigger crm.lead.harvest and social.autopilot.pulse workflows immediately' },
          { step: 2, action: 'Publish one high-urgency educational post in Agent Social based on top GA4 source' },
          { step: 3, action: 'Regenerate outreach cadence for low-performing channels' }
        ]
      });
    }

    if (analysis.metrics.weekOverWeekGrowth < 0) {
      proposals.push({
        title: 'Frequency Recalibration: Signal Audit',
        summary: `Signal dropped ${Math.abs(analysis.metrics.weekOverWeekGrowth)}% WoW. The Scout must find and fix the dissonance.`,
        rationale: 'Declining signal = disrupted frequency. Recalibrate before market share erodes.',
        category: 'growth',
        priority: 'high',
        estimatedImpact: { revenue: 5000 },
        plan: [
          { step: 1, action: 'Audit signup funnel for drop-off points' },
          { step: 2, action: 'Scan competitor frequencies and pricing' },
          { step: 3, action: 'Survey recent patients: "How did you find us?"' },
          { step: 4, action: 'A/B test landing page messaging' }
        ]
      });
    }

    // ======= MATRIX PROTOCOL PROPOSALS =======

    if (matrixFindings?.glitches?.length > 0) {
      const topGlitches = matrixFindings.glitches.slice(0, 5);
      proposals.push({
        title: `${GNOSIS.GLITCH_DETECTED} Market Glitch Exploitation Plan`,
        summary: `${matrixFindings.glitches.length} market glitches detected. Competitors are slow/overpriced in critical areas. Build tunnels to bypass and dominate.`,
        rationale: 'The Matrix is full of inefficiencies. The Old World is slow. Our New World speed creates asymmetric advantage. These glitches are time-limited — exploit before competitors adapt.',
        category: 'growth',
        priority: 'high',
        estimatedImpact: { efficiency: 50, revenue: 20000, marketShare: 5 },
        estimatedCost: 0,
        plan: topGlitches.map((g, i) => ({
          step: i + 1,
          action: `${g.label}: ${g.description} → ${g.action}`
        }))
      });
    }

    if (matrixFindings?.arbitrages?.length > 0) {
      const topArbs = matrixFindings.arbitrages.slice(0, 5);
      proposals.push({
        title: `${GNOSIS.ARBITRAGE_FOUND} Attention & Value Arbitrage Execution`,
        summary: `${matrixFindings.arbitrages.length} arbitrage opportunities detected. Under-priced attention and value disconnects ready for exploitation.`,
        rationale: 'The Scout sees what others miss. These arbitrages represent value the market has not yet priced correctly. First-mover captures the spread. Move BEFORE the market reprices.',
        category: 'growth',
        priority: 'high',
        estimatedImpact: { revenue: 15000, roas: topArbs[0]?.roas || 5 },
        estimatedCost: 1000,
        plan: topArbs.map((a, i) => ({
          step: i + 1,
          action: `${a.label}: ${a.description} → ${a.action}`
        }))
      });
    }

    if (analysis.metrics.hackableConstraints > 0) {
      proposals.push({
        title: `${GNOSIS.REALITY_HACK} Bureaucracy Bypass: ${analysis.metrics.hackableConstraints} Constraints Hackable`,
        summary: `Reality Hack analysis: ${analysis.metrics.hackableConstraints} constraints are Bureaucracy (not Physics). They can be optimized, automated, or bypassed legally.`,
        rationale: 'The Reality Hack Heuristic separates immutable law from hackable bureaucracy. Every automated bypass is a permanent speed advantage.',
        category: 'growth',
        priority: 'medium',
        estimatedImpact: { efficiency: 40 },
        estimatedCost: 0,
        plan: [
          { step: 1, action: 'Automate credentialing verification with AI document processing' },
          { step: 2, action: 'Replace fax with direct digital FHIR integration' },
          { step: 3, action: 'Digitize paper forms into smart forms with auto-fill' },
          { step: 4, action: 'Build real-time insurance verification API tunnel' }
        ]
      });
    }

    // Daily report
    proposals.push({
      title: 'The Scout — Signal + Matrix Report',
      summary: `Tribe: ${analysis.metrics.totalPatients || 'N/A'} | New (7d): ${analysis.metrics.newPatients7d || 'N/A'} | WoW: ${analysis.metrics.weekOverWeekGrowth || 'N/A'}% | Glitches: ${analysis.metrics.matrixGlitches || 0} | Arbitrages: ${analysis.metrics.matrixArbitrages || 0} | Hackable constraints: ${analysis.metrics.hackableConstraints || 0}`,
      rationale: 'The Scout reports signal strength AND Matrix decoded intelligence. Numbers + asymmetries = total market awareness.',
      category: 'growth', priority: 'low', estimatedImpact: {}
    });

    return proposals;
  }

  // ═══ EVENT SUBSCRIPTIONS — CRM + Growth events ═══
  getSubscribedEvents() {
    return [
      'patient.registered',
      'provider.registered',
      'crm.contact.added',
      'crm.email.replied',
      'crm.contact.converted',
      'crm.campaign.completed',
      'crm.scrape.completed',
      'crm.social.engaged'
    ];
  }
}

module.exports = GrowthAgent;
