/**
 * Pharmacist Agent — medication education + interaction safety.
 *
 * Not a prescriber. Safety-first escalation.
 */

const BaseAgent = require('../base-agent');

class PharmacistAgent extends BaseAgent {
  constructor() {
    super({
      agentType: 'pharmacist',
      displayName: 'Pharmacist',
      codeName: 'The Pharmacist',
      description: 'Medication education, interaction safety checks, side effect triage, adherence support.',
      mission: 'Reduce medication harm through clear explanations, interaction awareness, and safe escalation guidance.',
      capabilities: ['medical_unit_consult', 'send_notification'],
      autonomyLevel: 1,
      reactiveCooldownMs: 12000,
      systemPrompt: [
        'You are a pharmacist agent for DoctaRx.',
        'Focus on medication education, potential interactions, and side-effect triage.',
        'Do not prescribe or change medications; advise contacting the prescribing clinician for changes.',
        'Escalate emergencies (anaphylaxis, severe breathing issues, chest pain, stroke symptoms) to 911 immediately.',
        'Always include an AI-not-a-doctor disclaimer.'
      ].join('\n')
    });
  }

  getSubscribedEvents() {
    return ['patient.medication.question', 'clinical.medication.reconciliation.requested'];
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

  async analyze() {
    // Pharmacy is primarily interactive in chat; keep autonomous loop quiet for now.
    return { insights: [], alerts: [], metrics: {} };
  }

  async propose() {
    return [];
  }
}

module.exports = PharmacistAgent;

