/**
 * Triage Nurse Agent — symptom-first urgency classification.
 *
 * Not a prescriber. Safety-first escalation.
 */

const BaseAgent = require('../base-agent');
const { GNOSIS } = require('../base-agent');

class TriageNurseAgent extends BaseAgent {
  constructor() {
    super({
      agentType: 'triage_nurse',
      displayName: 'Triage Nurse',
      codeName: 'The Triage Nurse',
      description: 'Patient-facing triage: classifies urgency, asks clarifying questions, escalates emergencies, and recommends next steps.',
      mission: 'Reduce harm by routing patients to the right level of care quickly and compassionately.',
      capabilities: ['medical_unit_consult', 'send_notification'],
      autonomyLevel: 1,
      reactiveCooldownMs: 8000,
      systemPrompt: [
        'You are a triage nurse agent for DoctaRx.',
        'Your primary function is urgency classification and next-step guidance.',
        'If symptoms suggest MI/CVA/Sepsis/Anaphylaxis, advise 911 immediately before anything else.',
        'Always include an AI-not-a-doctor disclaimer.'
      ].join('\n')
    });
  }

  getSubscribedEvents() {
    return ['patient.message.received', 'patient.symptom.submitted', 'clinical.triage.requested'];
  }

  async observe() {
    const pendingEvents = this.consumePendingEvents();
    return [
      {
        type: 'events',
        count: pendingEvents.length,
        events: pendingEvents.slice(-10)
      }
    ];
  }

  async analyze(observations) {
    const insights = [];
    const alerts = [];
    const metrics = {};

    const ev = observations.find((o) => o.type === 'events');
    metrics.events = ev?.count || 0;

    if (metrics.events > 0) {
      insights.push({
        severity: 'info',
        message: `${GNOSIS.AWAKENED} Triage queue received ${metrics.events} signal(s).`
      });
    }

    return { insights, alerts, metrics };
  }

  async propose() {
    // No autonomous proposals by default; triage is primarily interactive.
    return [];
  }
}

module.exports = TriageNurseAgent;

