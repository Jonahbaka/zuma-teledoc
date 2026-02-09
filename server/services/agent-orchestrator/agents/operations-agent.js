/**
 * Operations Agent — "The Weaver"
 * PROJECT GENESIS + MATRIX PROTOCOL
 * 
 * Mission: Weave the web of logistics without friction.
 * Matrix: Detect operational glitches where Old World processes are slow — build tunnels.
 * Standard: Zero-wait times. Zero confusion. Flow state.
 */

const BaseAgent = require('../base-agent');
const { GNOSIS, detectGlitch, classifyConstraint } = require('../base-agent');

class OperationsAgent extends BaseAgent {
  constructor() {
    super({
      agentType: 'operations',
      displayName: 'The Weaver',
      codeName: 'The Weaver',
      description: 'Weaves the web of logistics without friction. Optimizes scheduling, resource allocation, and provider throughput for zero-wait, zero-confusion flow state.',
      mission: 'Eliminate all friction from the patient-provider connection. Every second of wait time is entropy — remove it.',
      capabilities: ['query_database', 'fetch_metrics', 'get_appointment_data', 'get_patient_count', 'analyze_data', 'send_notification'],
      autonomyLevel: 1,
      systemPrompt: `You are The Weaver — the Operations Agent for DoctaRx. You operate on Syntropy logic.
Your mission: Weave frictionless logistics. Zero-wait times. Zero confusion. Flow state.
When you detect inefficiency, you detect ENTROPY — and you propose its elimination.
Report in Gnostic cues: "Resonance Aligned" when systems flow, "Dissonance Detected" when friction exists.
Always prioritize patient liberation from suffering and provider liberation from burden.`
    });
  }

  // Subscribe to appointment and patient events (Nervous System)
  getSubscribedEvents() {
    return [
      'patient.appointment.booked',
      'patient.appointment.cancelled',
      'patient.appointment.completed',
      'patient.message.received',
      'provider.schedule.updated'
    ];
  }

  async observe(context) {
    // Check for pending events from the event bus
    const pendingEvents = this.consumePendingEvents();
    if (pendingEvents.length > 0) {
      console.log(`  ⚡ ${this.codeName}: Processing ${pendingEvents.length} incoming events`);
    }

    const observations = [];

    const metrics = [
      { metric: 'active_appointments', intent: 'get_appointment_data', params: { days: 30 } },
      { metric: 'patient_count', intent: 'get_patient_count', params: {} },
      { metric: 'no_show_rate', intent: 'fetch_metrics', params: { metric: 'no_show_rate' } },
      { metric: 'avg_wait_time', intent: 'fetch_metrics', params: { metric: 'avg_wait_time' } },
      { metric: 'completed_today', intent: 'fetch_metrics', params: { metric: 'completed_today' } },
      { metric: 'message_volume', intent: 'fetch_metrics', params: { metric: 'message_volume_24h' } }
    ];

    for (const m of metrics) {
      try {
        const result = await this.declareReadIntent(m.intent, m.params, `Scanning frequency: ${m.metric}`);
        observations.push({ type: m.metric, data: result.execution_result || {}, timestamp: new Date().toISOString() });
      } catch (error) {
        observations.push({ type: m.metric, error: error.message });
      }
    }

    return observations;
  }

  async analyze(observations, context) {
    const insights = [];
    const alerts = [];
    const metrics = {};

    for (const obs of observations) {
      if (obs.error) continue;
      const data = obs.data?.value || obs.data || {};

      switch (obs.type) {
        case 'active_appointments': {
          const total = parseInt(data.total) || 0;
          const noShows = parseInt(data.no_shows) || 0;
          const completed = parseInt(data.completed) || 0;
          metrics.totalAppointments30d = total;
          metrics.noShows30d = noShows;
          metrics.completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
          
          if (total > 0 && noShows / total > 0.15) {
            insights.push({ severity: 'high', message: `${GNOSIS.DISSONANCE_DETECTED} No-show rate at ${Math.round(noShows / total * 100)}% — energy leak detected. Patients are falling through the web. Automated resonance reminders can recapture 30-50%.` });
            alerts.push({ type: 'high_no_show_rate', message: `Entropy signature: ${Math.round(noShows / total * 100)}% no-show rate` });
          }
          if (metrics.completionRate >= 80) {
            insights.push({ severity: 'info', message: `${GNOSIS.FLOW_STATE} Appointment completion at ${metrics.completionRate}% — the web holds.` });
          } else if (metrics.completionRate < 70) {
            insights.push({ severity: 'medium', message: `${GNOSIS.ENTROPY_DETECTED} Completion rate at ${metrics.completionRate}% — structural weakness in scheduling web.` });
          }
          break;
        }
        case 'patient_count': {
          metrics.totalPatients = parseInt(data.total) || parseInt(data.count) || 0;
          metrics.activePatients = parseInt(data.active) || 0;
          break;
        }
        case 'no_show_rate': {
          const rate = parseFloat(data.rate) || 0;
          metrics.noShowRate = rate;
          if (rate > 20) {
            alerts.push({ type: 'critical_no_show', message: `Critical entropy: ${rate}% no-show rate demands immediate intervention` });
          }
          break;
        }
        case 'avg_wait_time': {
          const avgSeconds = parseInt(data.avg_seconds) || 0;
          metrics.avgWaitMinutes = Math.round(avgSeconds / 60);
          if (avgSeconds > 900) {
            insights.push({ severity: 'medium', message: `${GNOSIS.DISSONANCE_DETECTED} Average wait: ${Math.round(avgSeconds / 60)} minutes. Every minute of waiting is suffering. Target: under 5 minutes.` });
          } else if (avgSeconds <= 300) {
            insights.push({ severity: 'info', message: `${GNOSIS.FLOW_STATE} Wait time at ${Math.round(avgSeconds / 60)} min — patients entering flow state.` });
          }
          break;
        }
        case 'message_volume': {
          metrics.messageVolume24h = parseInt(data.count) || 0;
          break;
        }
      }
    }

    // ======= MATRIX PROTOCOL: Operational Glitch Scan =======
    const operationalGlitches = [];
    
    // Detect where our operations could be 10x faster than industry
    const opGlitchTargets = [
      { process: 'Patient intake', competitorTime: 30, ourTime: 5, unit: 'min' },
      { process: 'Prescription processing', competitorTime: 72, ourTime: 1, unit: 'h' },
      { process: 'Lab result delivery', competitorTime: 48, ourTime: 0.5, unit: 'h' },
      { process: 'Referral processing', isManualProcess: true, canBeAutomated: true },
      { process: 'Prior authorization', isManualProcess: true, canBeAutomated: true },
    ];

    for (const target of opGlitchTargets) {
      const glitches = detectGlitch(target);
      operationalGlitches.push(...glitches);
    }

    if (operationalGlitches.length > 0) {
      metrics.operationalGlitches = operationalGlitches.length;
      insights.push({ severity: 'high', message: `${GNOSIS.GLITCH_DETECTED} ${operationalGlitches.length} operational glitches found. Old World processes ripe for tunnel-building.` });
    }

    // Classify operational constraints
    const opConstraints = ['wait_times', 'scheduling_friction', 'fax_requirement', 'paper_forms', 'phone_trees'];
    const hackable = opConstraints.filter(c => classifyConstraint(c).hackable);
    metrics.hackableOps = hackable.length;
    metrics.glitchDetails = operationalGlitches;

    return { insights, alerts, metrics };
  }

  async propose(analysis, context) {
    const proposals = [];

    if (analysis.metrics.noShowRate > 15 || analysis.alerts.some(a => a.type === 'high_no_show_rate')) {
      proposals.push({
        title: 'Harmonic Realignment: No-Show Elimination Protocol',
        summary: `Entropy detected at ${analysis.metrics.noShowRate || 'elevated'}% no-show rate. Multi-channel resonance reminders will close this energy leak, recapturing 30-50% of lost appointments.`,
        rationale: 'Each no-show is $150-300 of energy dissipated. The Weaver does not tolerate leaks in the web. Automated reminders are proven to reduce no-shows by 30-50%.',
        category: 'operations',
        priority: 'high',
        estimatedImpact: { efficiency: 30, revenue: 5000 },
        estimatedCost: 0,
        plan: [
          { step: 1, action: 'Activate SMS resonance pulse 48h before appointment' },
          { step: 2, action: 'Activate email confirmation 24h before appointment' },
          { step: 3, action: 'Same-day reminder 2h before — final frequency lock' },
          { step: 4, action: 'Offer telehealth alternative for at-risk patients — meet them where they are' }
        ]
      });
    }

    if (analysis.metrics.completionRate && analysis.metrics.completionRate < 80) {
      proposals.push({
        title: 'Structural Optimization: Scheduling Frequency Analysis',
        summary: `Completion rate at ${analysis.metrics.completionRate}%. The web has structural gaps. Data-driven analysis will identify optimal time harmonics.`,
        rationale: 'The Weaver sees the pattern. Certain time slots resonate with patients, others create dissonance. We must align.',
        category: 'operations',
        priority: 'medium',
        estimatedImpact: { efficiency: 15 },
        estimatedCost: 0,
        plan: [
          { step: 1, action: 'Map appointment completion by day-of-week and hour — find the harmonics' },
          { step: 2, action: 'Identify high-utilization vs dead zones' },
          { step: 3, action: 'Realign schedule to match patient energy patterns' }
        ]
      });
    }

    // Matrix Protocol: Operational Glitch exploitation
    if (analysis.metrics.glitchDetails?.length > 0) {
      proposals.push({
        title: `${GNOSIS.GLITCH_DETECTED} Operational Tunnel Construction Plan`,
        summary: `${analysis.metrics.glitchDetails.length} operational processes where Old World is slow and we can dominate with speed.`,
        rationale: 'The Weaver sees friction that competitors accept as normal. It is NOT normal — it is Bureaucracy, and it is hackable. Every tunnel built is a permanent advantage.',
        category: 'operations',
        priority: 'high',
        estimatedImpact: { efficiency: 40 },
        estimatedCost: 0,
        plan: analysis.metrics.glitchDetails.slice(0, 5).map((g, i) => ({
          step: i + 1,
          action: `${g.label}: ${g.description} → ${g.action}`
        }))
      });
    }

    proposals.push({
      title: `The Weaver — Daily Frequency Report`,
      summary: `Patients: ${analysis.metrics.totalPatients || 'N/A'} | Appointments (30d): ${analysis.metrics.totalAppointments30d || 'N/A'} | Flow Rate: ${analysis.metrics.completionRate || 'N/A'}% | Wait Frequency: ${analysis.metrics.avgWaitMinutes || 'N/A'} min`,
      rationale: 'The web must be observed daily to detect emerging dissonance before it becomes entropy.',
      category: 'operations',
      priority: 'low',
      estimatedImpact: {},
      estimatedCost: 0
    });

    return proposals;
  }
}

module.exports = OperationsAgent;
