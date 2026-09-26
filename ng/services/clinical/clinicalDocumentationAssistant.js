'use strict';

/**
 * ng/services/clinical/clinicalDocumentationAssistant.js
 *
 * Safe, deterministic assistance for clinicians and nurses at a PHC.
 *
 * Deliberate constraints:
 *   - This module NEVER diagnoses, prescribes, triages, or proposes treatment.
 *   - It never calls a language model. Documentation completeness is a
 *     structural question about what a clinician has already recorded, so a
 *     deterministic check is both safer and available offline on the poor
 *     connections described in the FCT PHCB assessment.
 *   - Output is advisory, attributed to the rule that produced it, and must be
 *     reviewed by a clinician before it affects the record.
 *
 * A separate, governed AI drafting path already exists for narrative
 * suggestions (ng/services/phc/clinicalAiService.js) and is gated on clinician
 * review, provenance, and audit logging.
 */

const FIELD_LABELS = {
  chiefComplaint: 'Chief complaint / presenting problem',
  history: 'History of present illness',
  pastHistory: 'Past medical and surgical history',
  medications: 'Current medications',
  allergies: 'Allergies and reactions',
  examination: 'Clinical examination findings',
  vitals: 'Vital signs with units and time',
  assessment: 'Assessment',
  plan: 'Plan / next steps',
  reviewDate: 'Agreed review or follow-up date',
};

const RULES = [
  {
    id: 'presenting_problem',
    label: 'A presenting problem is recorded',
    rationale: 'Without a presenting problem the encounter cannot be summarised or handed over safely.',
    fields: ['chiefComplaint'],
  },
  {
    id: 'history_present_illness',
    label: 'History of the presenting problem is recorded',
    rationale: 'Duration, onset, and context drive safe remote assessment.',
    fields: ['history'],
  },
  {
    id: 'allergies_reviewed',
    label: 'Allergies were asked about and the answer recorded',
    rationale: 'An unanswered allergy question is a prescribing hazard, even when the answer is "none known".',
    fields: ['allergies'],
  },
  {
    id: 'medications_reviewed',
    label: 'Current medications were asked about and recorded',
    rationale: 'Medication review is required before any prescribing decision.',
    fields: ['medications'],
  },
  {
    id: 'vital_signs_with_time',
    label: 'Vital signs are recorded with units and a time',
    rationale: 'Observations without units or a timestamp cannot be compared over time.',
    fields: ['vitals'],
  },
  {
    id: 'assessment_recorded',
    label: 'An assessment is recorded',
    rationale: 'The assessment is the clinician\'s reasoning and must exist before a plan is followed.',
    fields: ['assessment'],
  },
  {
    id: 'plan_and_review',
    label: 'A plan and a follow-up or review point are recorded',
    rationale: 'Continuity of care depends on a named next step and when it is due.',
    fields: ['plan', 'reviewDate'],
  },
];

const REDACTION_PLACEHOLDER = '[redacted]';

function clinicalError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function isMeaningful(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  return false;
}

// Observation codes whose meaning is ambiguous without an explicit unit, e.g.
// "120" could be systolic or diastolic, and "38" could be Celsius or Fahrenheit.
const OBSERVATION_CODES_REQUIRING_UNIT = [
  'temperature', 'SBP', 'DBP', 'pulse', 'respiratory_rate', 'spo2', 'SpO2',
  'glucose', 'random_glucose', 'haemoglobin', 'hb', 'weight', 'height',
];

/** Observations must carry a unit and a time before they can count as recorded. */
function validateObservations(observations) {
  const problems = [];
  if (!Array.isArray(observations)) {
    return { usable: false, problems: [{ code: 'OBSERVATIONS_NOT_A_LIST', detail: 'Observations must be a list.' }] };
  }

  observations.forEach((observation, index) => {
    if (!observation || typeof observation !== 'object') {
      problems.push({ code: 'OBSERVATION_MALFORMED', index, detail: 'Entry is not an observation object.' });
      return;
    }
    if (!isMeaningful(observation.value)) {
      problems.push({
        code: 'OBSERVATION_VALUE_MISSING',
        index,
        detail: `${observation.code || 'Observation'} has no value. Record 0 only when a true zero was measured.`,
      });
    }
    if (!isMeaningful(observation.unit) && OBSERVATION_CODES_REQUIRING_UNIT.includes(observation.code)) {
      problems.push({ code: 'OBSERVATION_UNIT_MISSING', index, detail: `${observation.code} needs a unit.` });
    }
    if (!isMeaningful(observation.observedAt)) {
      problems.push({
        code: 'OBSERVATION_TIME_MISSING',
        index,
        detail: `${observation.code || 'Observation'} needs the time it was taken.`,
      });
    }
  });

  return { usable: problems.length === 0, problems };
}

/**
 * Strips anything that could identify a patient from assistant output. The
 * assistant summarises structure, never patient identity.
 */
function redactPatientIdentifiers(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/(?:\+?234|0)[789][01]\d{8}/g, REDACTION_PLACEHOLDER)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, REDACTION_PLACEHOLDER)
    .replace(/\b\d{6}-\d{4}-\d{4}\b/g, REDACTION_PLACEHOLDER)
    .slice(0, 500);
}

/**
 * Produces advisory, rule-attributed documentation guidance for one encounter.
 * Returns questions to ask and gaps to close - never clinical assertions.
 */
function buildDocumentationReview({ encounter = {}, observations = [], authorRole } = {}) {
  if (!encounter || typeof encounter !== 'object' || Array.isArray(encounter)) {
    throw clinicalError(400, 'encounter must be an object.', 'ENCOUNTER_INVALID');
  }

  const observationCheck = validateObservations(observations);
  const recorded = {
    chiefComplaint: isMeaningful(encounter.chiefComplaint ?? encounter.chief_complaint),
    history: isMeaningful(encounter.history ?? encounter.subjective),
    pastHistory: isMeaningful(encounter.pastHistory ?? encounter.past_history),
    medications: isMeaningful(encounter.medications ?? encounter.medicationHistory),
    allergies: isMeaningful(encounter.allergies),
    examination: isMeaningful(encounter.examination ?? encounter.objective),
    vitals: observationCheck.usable,
    assessment: isMeaningful(encounter.assessment),
    plan: isMeaningful(encounter.plan),
    reviewDate: isMeaningful(encounter.reviewDate ?? encounter.review_date),
  };

  const findings = RULES.map((rule) => {
    const missing = rule.fields.filter((field) => !recorded[field]);
    return {
      ruleId: rule.id,
      label: rule.label,
      rationale: rule.rationale,
      status: missing.length === 0 ? 'met' : 'gap',
      missingFields: missing,
      missingLabels: missing.map((field) => FIELD_LABELS[field]),
    };
  });

  const gaps = findings.filter((finding) => finding.status === 'gap');
  const completeness = Math.round(
    (RULES.filter((rule) => rule.fields.every((field) => recorded[field])).length / RULES.length) * 100
  );

  return {
    generatedAt: new Date().toISOString(),
    completenessPercent: completeness,
    findings,
    gaps,
    observationProblems: observationCheck.problems,
    // The clinician decides what to do next; the assistant only asks questions.
    suggestedQuestions: gaps.map((gap) => ({
      question: `Could you confirm: ${gap.missingLabels.join(' and ')}?`,
      ruleId: gap.ruleId,
      rationale: gap.rationale,
    })),
    requiresClinicianReview: true,
    advisoryOnly: true,
    performsClinicalDecision: false,
    provenance: {
      source: 'deterministic_documentation_rules',
      ruleCount: RULES.length,
      authorRole: authorRole || null,
    },
  };
}

module.exports = {
  FIELD_LABELS,
  RULES,
  buildDocumentationReview,
  clinicalError,
  isMeaningful,
  redactPatientIdentifiers,
  validateObservations,
  _test: { OBSERVATION_CODES_REQUIRING_UNIT },
};
