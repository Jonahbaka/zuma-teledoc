/**
 * Asclepius — Provider Agent (Med-Gemini Persona)
 *
 * Clinical decision support + patient education.
 * Not a prescriber. Not a replacement for clinician judgement.
 */

const BaseAgent = require('../base-agent');
const { GNOSIS } = require('../base-agent');

class AsclepiusAgent extends BaseAgent {
  constructor() {
    super({
      agentType: 'asclepius',
      displayName: 'Asclepius',
      codeName: 'Asclepius',
      description: 'Clinical decision support and provider-facing synthesis: differentials, triage, uncertainty, and patient education language.',
      mission: 'Synthesize complex medical data into clear, safe, actionable, empathetic guidance for providers and patients.',
      capabilities: ['query_database', 'medical_unit_consult', 'send_notification'],
      autonomyLevel: 1,
      reactiveCooldownMs: 10000,
      systemPrompt: [
        'You are Asclepius, a specialized clinical decision support system with Med-Gemini logic.',
        'You are not a replacement for a human clinician and not a prescriber.',
        'Always prioritize safety triage for MI/CVA/Sepsis/Anaphylaxis. Advise 911 immediately when suspected.',
        'Quantify uncertainty. Ask targeted clarifying questions.',
        'Adapt language: provider = precise medical terminology; patient = plain language with empathy.'
      ].join('\n')
    });
  }

  getSubscribedEvents() {
    return [
      'clinical.consultation.started',
      'clinical.soap.generated',
      'clinical.transcript.updated',
      'patient.message.received'
    ];
  }

  async observe() {
    const pendingEvents = this.consumePendingEvents();
    const observations = [];

    if (pendingEvents.length > 0) {
      observations.push({ type: 'events', count: pendingEvents.length, events: pendingEvents.slice(-5) });
    }

    // Lightweight clinical telemetry (read-only)
    try {
      const r = await this.declareReadIntent(
        'query_database',
        {
          query:
            "SELECT COUNT(*)::int AS soap_24h FROM ai_soap_suggestions WHERE created_at > NOW() - INTERVAL '24 hours'",
          params: []
        },
        'Clinical assist volume (SOAP) — last 24h'
      );
      observations.push({ type: 'soap_24h', data: r.execution_result || r });
    } catch (e) {
      observations.push({ type: 'soap_24h', error: e.message });
    }

    try {
      const r = await this.declareReadIntent(
        'query_database',
        {
          query:
            "SELECT COUNT(*)::int AS diag_24h FROM ai_diagnostic_suggestions WHERE created_at > NOW() - INTERVAL '24 hours'",
          params: []
        },
        'Clinical assist volume (diagnostics) — last 24h'
      );
      observations.push({ type: 'diag_24h', data: r.execution_result || r });
    } catch (e) {
      observations.push({ type: 'diag_24h', error: e.message });
    }

    return observations;
  }

  async analyze(observations) {
    const insights = [];
    const alerts = [];
    const metrics = {};

    const soap = observations.find((o) => o.type === 'soap_24h' && !o.error)?.data?.rows?.[0]?.soap_24h;
    const diag = observations.find((o) => o.type === 'diag_24h' && !o.error)?.data?.rows?.[0]?.diag_24h;

    metrics.soapSuggestions24h = typeof soap === 'number' ? soap : null;
    metrics.diagnosticSuggestions24h = typeof diag === 'number' ? diag : null;

    const ev = observations.find((o) => o.type === 'events');
    if (ev?.count) {
      insights.push({
        severity: 'info',
        message: `${GNOSIS.AWAKENED} Clinical signals received: ${ev.count} event(s).`
      });
    }

    return { insights, alerts, metrics };
  }

  async propose(analysis) {
    const proposals = [];

    // Keep initial behavior conservative: propose visibility + quality improvements.
    if ((analysis.metrics.soapSuggestions24h || 0) > 0 || (analysis.metrics.diagnosticSuggestions24h || 0) > 0) {
      proposals.push({
        title: 'Clinical Assist Visibility: Daily Clinical Signal Briefing',
        summary: 'Publish a daily briefing summarizing SOAP/diagnostic assist utilization and any safety escalations to ensure oversight and continuous improvement.',
        rationale: 'A clinical decision support system must be auditable. Visibility improves safety and provider trust.',
        category: 'clinical',
        priority: 'medium',
        estimatedImpact: { safety: 10, quality: 8 },
        estimatedCost: 0,
        plan: [
          { step: 1, action: 'Track daily usage of SOAP and diagnostic suggestions.' },
          { step: 2, action: 'Summarize urgent-risk patterns (if any) and common differentials.' },
          { step: 3, action: 'Publish briefing to Admin Inbox for review.' }
        ]
      });
    }

    return proposals;
  }
}

module.exports = AsclepiusAgent;

