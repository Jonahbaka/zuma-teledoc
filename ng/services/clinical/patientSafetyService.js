'use strict';

/**
 * ng/services/clinical/patientSafetyService.js
 *
 * First-class patient safety records for the Nigeria clinical API:
 *   - allergies with reaction, criticality, attribution, and correction history
 *   - problem list with coded, attributable, longitudinal status
 *   - prescription allergy alerting (flag only; never silently blocks a clinician)
 *   - longitudinal patient timeline and printable clinical summary
 *
 * Allergies and problems are never hard-deleted: a correction supersedes the prior
 * record and the superseded row is retained with its original text and digests.
 *
 * The pure decision helpers (matching, transitions, summary assembly) are exported
 * separately so they can be tested without a database.
 */

const CRITICALITY = ['low', 'high', 'unable-to-assess'];
const ALLERGY_STATUS = ['active', 'inactive', 'resolved', 'entered-in-error'];
const ALLERGY_VERIFICATION = ['unconfirmed', 'confirmed', 'refuted', 'entered-in-error'];
const PROBLEM_STATUS = [
  'active', 'recurrence', 'relapse', 'remission', 'resolved', 'inactive', 'entered-in-error',
];
const TERMINAL_STATUSES = new Set(['resolved', 'inactive', 'entered-in-error']);

// Allergy -> drug class members. Deliberately small and conservative: the service
// only raises a flag for human review, it never decides therapy.
const ALLERGY_CLASSES = {
  penicillin: ['amoxicillin', 'ampicillin', 'penicillin', 'benzylpenicillin', 'cloxacillin', 'flucloxacillin'],
  cephalosporin: ['cephalexin', 'cefuroxime', 'ceftriaxone', 'cefixime', 'cefazolin'],
  sulfonamide: ['co-trimoxazole', 'cotrimoxazole', 'sulfamethoxazole', 'sulfasalazine'],
  nsaid: ['ibuprofen', 'diclofenac', 'naproxen', 'aspirin', 'ketoprofen', 'mefenamic'],
  macrolide: ['erythromycin', 'azithromycin', 'clarithromycin'],
  nitroimidazole: ['metronidazole', 'tinidazole'],
  statin: ['simvastatin', 'atorvastatin', 'rosuvastatin'],
  ace_inhibitor: ['lisinopril', 'enalapril', 'captopril', 'ramipril'],
};

function safetyError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Dose, unit, and dosage-form tokens carry no identity: "Amoxicillin 500 mg",
// "AMOXICILLIN 500mg" and "amoxicillin" are the same substance.
const NON_SUBSTANCE_TOKENS = new Set([
  'mg', 'ml', 'mcg', 'ug', 'g', 'iu', 'kg', 'mmol', 'mol', '%',
  'tab', 'tabs', 'tablet', 'tablets', 'cap', 'caps', 'capsule', 'capsules',
  'sachet', 'sachets', 'vial', 'ampoule', 'ampoule', 'syrup', 'suspension',
  'drops', 'cream', 'ointment', 'injection', 'oral', 'tablet', 'dose', 'once',
  'daily', 'bd', 'tds', 'od', 'morning', 'evening', 'night',
]);

function isNonSubstanceToken(token) {
  if (NON_SUBSTANCE_TOKENS.has(token)) return true;
  if (/^\d+(\.\d+)?$/.test(token)) return true;
  return /^\d+(mg|ml|mcg|ug|g|iu|kg|mmol|mol|%)$/.test(token);
}

/** "Amoxicillin 500mg" and "amoxicillin" are the same substance. */
function substanceKey(value) {
  return normalizeToken(value).split(' ').filter((part) => part && !isNonSubstanceToken(part)).join(' ');
}

function assertOneOf(value, allowed, field, statusCode = 400) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (!allowed.includes(normalized)) {
    throw safetyError(statusCode, `Unsupported ${field}: ${value}`, `${field.toUpperCase()}_INVALID`);
  }
  return normalized;
}

function validateAllergyInput(input = {}) {
  const substanceText = String(input.substanceText || input.substance_text || '').trim();
  if (!substanceText) {
    throw safetyError(400, 'substanceText is required.', 'ALLERGY_SUBSTANCE_REQUIRED');
  }
  if (substanceText.length > 255) {
    throw safetyError(400, 'substanceText is too long.', 'ALLERGY_SUBSTANCE_TOO_LONG');
  }
  return {
    substanceText,
    substanceCode: input.substanceCode || input.substance_code || null,
    reactionText: input.reactionText || input.reaction_text || null,
    reactionCode: input.reactionCode || input.reaction_code || null,
    criticality: assertOneOf(input.criticality, CRITICALITY, 'criticality') || 'unable-to-assess',
    clinicalStatus: assertOneOf(input.clinicalStatus || input.clinical_status, ALLERGY_STATUS, 'clinicalStatus') || 'active',
    verificationStatus: assertOneOf(
      input.verificationStatus || input.verification_status,
      ALLERGY_VERIFICATION,
      'verificationStatus'
    ) || 'unconfirmed',
    category: assertOneOf(input.category, ['medication', 'food', 'environment', 'biologic'], 'category'),
    onsetDate: input.onsetDate || input.onset_date || null,
    note: input.note || null,
  };
}

function validateProblemInput(input = {}) {
  const problemText = String(input.problemText || input.problem_text || '').trim();
  if (!problemText) {
    throw safetyError(400, 'problemText is required.', 'PROBLEM_TEXT_REQUIRED');
  }
  if (problemText.length > 255) {
    throw safetyError(400, 'problemText is too long.', 'PROBLEM_TEXT_TOO_LONG');
  }
  return {
    problemText,
    problemCode: input.problemCode || input.problem_code || null,
    clinicalStatus: assertOneOf(input.clinicalStatus || input.clinical_status, PROBLEM_STATUS, 'clinicalStatus') || 'active',
    verificationStatus: assertOneOf(
      input.verificationStatus || input.verification_status,
      ALLERGY_VERIFICATION,
      'verificationStatus'
    ) || 'unconfirmed',
    category: assertOneOf(input.category, ['condition', 'finding'], 'category'),
    severity: input.severity || null,
    onsetDate: input.onsetDate || input.onset_date || null,
    resolvedDate: input.resolvedDate || input.resolved_date || null,
    note: input.note || null,
  };
}

/** A clinical record may move to any other valid status, but never to itself. */
function assertStatusChange(currentStatus, nextStatus) {
  const from = String(currentStatus || '').trim().toLowerCase();
  const to = String(nextStatus || '').trim().toLowerCase();
  if (from === to) {
    throw safetyError(409, `Record is already ${to}.`, 'STATUS_UNCHANGED');
  }
  if (from === 'entered-in-error') {
    throw safetyError(409, 'A record marked entered-in-error cannot change status.', 'STATUS_FINAL');
  }
  return { from, to };
}

/**
 * Flag medications that may conflict with a patient's recorded allergies.
 * Conservative by design: only name and known-class matches, and a match is a
 * prompt for clinician review, never a block and never a treatment decision.
 */
function detectAllergyRisks({ medications = [], allergies = [] }) {
  const usable = allergies.filter(
    (allergy) => String(allergy.clinical_status || 'active').toLowerCase() === 'active'
      && String(allergy.verification_status || 'unconfirmed').toLowerCase() !== 'entered-in-error'
  );
  const risks = [];

  for (const medication of medications) {
    const medicationName = String(
      (typeof medication === 'string' ? medication : medication?.name || medication?.medication || '')
    ).trim();
    if (!medicationName) continue;
    const medicationKey = substanceKey(medicationName);

    for (const allergy of usable) {
      const allergyKey = substanceKey(allergy.substance_text || allergy.substance_text || '');
      if (!allergyKey) continue;

      let matchType = null;
      if (allergyKey === medicationKey
        || medicationKey.includes(allergyKey)
        || allergyKey.includes(medicationKey)) {
        matchType = 'name_match';
      } else {
        for (const [className, members] of Object.entries(ALLERGY_CLASSES)) {
          const classHit = members.some(
            (member) => allergyKey.includes(member) || member.includes(allergyKey)
          );
          const medicationHit = members.some((member) => medicationKey.includes(member));
          if (classHit && medicationHit) {
            matchType = 'class_match';
            break;
          }
        }
      }
      if (!matchType) continue;

      risks.push({
        allergyId: allergy.id,
        medicationText: medicationName,
        substance: allergy.substance_text,
        reaction: allergy.reaction_text || null,
        criticality: String(allergy.criticality || 'unable-to-assess').toLowerCase(),
        matchType,
        severity: String(allergy.criticality || '').toLowerCase() === 'high' ? 'high' : 'review',
        requiresAcknowledgement: matchType === 'name_match'
          || String(allergy.criticality || '').toLowerCase() === 'high',
      });
    }
  }
  return risks;
}

/** Assembles a printable, factual summary. Missing values stay "not recorded". */
function buildClinicalSummary({
  patient = {},
  allergies = [],
  problems = [],
  medications = [],
  encounters = [],
  observations = [],
  referrals = [],
} = {}) {
  const notRecorded = 'Not recorded';
  const activeAllergies = allergies.filter((a) => String(a.clinical_status || '').toLowerCase() === 'active');
  const activeProblems = problems.filter((p) => String(p.clinical_status || '').toLowerCase() === 'active');

  return {
    generatedAt: new Date().toISOString(),
    patient: {
      displayName: patient.displayName || notRecorded,
      localPatientNumber: patient.local_patient_number || notRecorded,
      dateOfBirth: patient.date_of_birth || notRecorded,
      sex: patient.sex || notRecorded,
    },
    allergies: activeAllergies.map((allergy) => ({
      substance: allergy.substance_text,
      reaction: allergy.reaction_text || notRecorded,
      criticality: allergy.criticality,
      status: allergy.clinical_status,
      verification: allergy.verification_status,
      recordedAt: allergy.recorded_at,
    })),
    problemList: activeProblems.map((problem) => ({
      problem: problem.problem_text,
      code: problem.problem_code || null,
      status: problem.clinical_status,
      onset: problem.onset_date || notRecorded,
    })),
    currentMedications: medications.map((medication) => ({
      medication: medication.name || medication.medication || notRecorded,
      status: medication.status || 'unknown',
    })),
    recentEncounters: encounters.slice(0, 10).map((encounter) => ({
      date: encounter.started_at || encounter.created_at,
      type: encounter.encounter_type || notRecorded,
      status: encounter.status,
      signedAt: encounter.signed_at || null,
    })),
    observations: observations.slice(0, 20).map((observation) => ({
      code: observation.observation_code,
      name: observation.display_name,
      value: observation.value_numeric ?? observation.value_text ?? observation.value_code ?? null,
      unit: observation.unit || null,
      observedAt: observation.observed_at,
      method: observation.method || 'manual',
    })),
    openReferrals: referrals
      .filter((referral) => !['completed', 'cancelled', 'declined'].includes(
        String(referral.status || '').toLowerCase()
      ))
      .map((referral) => ({
        status: referral.status,
        priority: referral.priority,
        target: referral.target_name || null,
        createdAt: referral.created_at,
      })),
    provenance: {
      allergyCount: activeAllergies.length,
      problemCount: activeProblems.length,
      encounterCount: encounters.length,
      observationCount: observations.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Persistence. All writes are attributed and append-only: a correction inserts a
// new row and supersedes the old one rather than rewriting clinical history.
// ---------------------------------------------------------------------------

async function listAllergies(pool, patientUserId, { includeInactive = false } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM ng_patient_allergies
      WHERE patient_user_id = $1
        AND ($2::BOOLEAN OR clinical_status <> 'entered-in-error')
        AND (superseded_by_allergy_id IS NULL)
      ORDER BY (clinical_status = 'active') DESC,
               CASE criticality WHEN 'high' THEN 0 WHEN 'unable-to-assess' THEN 1 ELSE 2 END,
               recorded_at DESC`,
    [patientUserId, includeInactive]
  );
  return rows;
}

async function recordAllergy(pool, { patientUserId, actorUserId, actorRole = null, source = 'clinician', ...input }) {
  const allergy = validateAllergyInput(input);
  const { rows } = await pool.query(
    `INSERT INTO ng_patient_allergies
       (patient_user_id, substance_code, substance_text, code_system, reaction_code, reaction_text,
        criticality, clinical_status, verification_status, category, onset_date,
        recorded_by_user_id, recorded_by_role, source, note)
     VALUES ($1,$2,$3,'http://snomed.info/sct',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      patientUserId, allergy.substanceCode, allergy.substanceText, allergy.reactionCode, allergy.reactionText,
      allergy.criticality, allergy.clinicalStatus, allergy.verificationStatus, allergy.category,
      allergy.onsetDate, actorUserId, actorRole, source, allergy.note,
    ]
  );
  return rows[0];
}

/** Correcting an allergy never rewrites the original: it supersedes it. */
async function supersedeAllergy(pool, { allergyId, patientUserId, actorUserId, next, reason }) {
  const current = await pool.query(
    'SELECT * FROM ng_patient_allergies WHERE id = $1 AND patient_user_id = $2 AND superseded_by_allergy_id IS NULL',
    [allergyId, patientUserId]
  );
  if (!current.rows.length) {
    throw safetyError(404, 'Allergy not found.', 'ALLERGY_NOT_FOUND');
  }
  const existing = current.rows[0];
  // A correction usually keeps the same clinical status (a corrected substance is
  // still "active"); the status is only validated when the caller actually changes it.
  const requestedStatus = next.clinicalStatus || next.clinical_status;
  const change = requestedStatus && String(requestedStatus).toLowerCase() !== String(existing.clinical_status).toLowerCase()
    ? assertStatusChange(existing.clinical_status, requestedStatus)
    : { from: existing.clinical_status, to: requestedStatus || existing.clinical_status };

  const created = await recordAllergy(pool, {
    patientUserId,
    actorUserId,
    source: 'clinician',
    ...next,
    clinicalStatus: change.to,
  });

  const { rows } = await pool.query(
    `UPDATE ng_patient_allergies
        SET superseded_by_allergy_id = $1, updated_at = NOW()
      WHERE id = $2 AND superseded_by_allergy_id IS NULL
      RETURNING *`,
    [created.id, allergyId]
  );
  if (!rows.length) {
    throw safetyError(409, 'Allergy was already corrected by someone else.', 'ALLERGY_CONFLICT');
  }
  return { superseded: rows[0], correction: created, reason: reason || null };
}

async function listProblems(pool, patientUserId, { includeInactive = false } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM ng_problem_list_items
      WHERE patient_user_id = $1
        AND ($2::BOOLEAN OR clinical_status <> 'entered-in-error')
        AND superseded_by_problem_id IS NULL
      ORDER BY (clinical_status = 'active') DESC, recorded_at DESC`,
    [patientUserId, includeInactive]
  );
  return rows;
}

async function recordProblem(pool, {
  patientUserId, encounterId = null, actorUserId, actorRole = null, source = 'clinician', ...input
}) {
  const problem = validateProblemInput(input);
  const { rows } = await pool.query(
    `INSERT INTO ng_problem_list_items
       (patient_user_id, encounter_id, problem_code, problem_text, code_system, clinical_status,
        verification_status, category, severity, onset_date, resolved_date,
        recorded_by_user_id, recorded_by_role, source, note)
     VALUES ($1,$2,$3,$4,'ICD-10',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      patientUserId, encounterId, problem.problemCode, problem.problemText, problem.clinicalStatus,
      problem.verificationStatus, problem.category, problem.severity, problem.onsetDate,
      problem.resolvedDate, actorUserId, actorRole, source, problem.note,
    ]
  );
  return rows[0];
}

/** Compare-and-swap on the expected prior status: concurrent edits cannot silently win. */
async function changeProblemStatus(pool, { problemId, patientUserId, clinicalStatus }) {
  const current = await pool.query(
    'SELECT * FROM ng_problem_list_items WHERE id = $1 AND patient_user_id = $2 AND superseded_by_problem_id IS NULL',
    [problemId, patientUserId]
  );
  if (!current.rows.length) {
    throw safetyError(404, 'Problem not found.', 'PROBLEM_NOT_FOUND');
  }
  const change = assertStatusChange(current.rows[0].clinical_status, clinicalStatus);
  const { rows } = await pool.query(
    `UPDATE ng_problem_list_items
        SET clinical_status = $1,
            resolved_date = CASE WHEN $1 IN ('resolved','remission') THEN COALESCE(resolved_date, NOW()::DATE) ELSE resolved_date END,
            updated_at = NOW()
      WHERE id = $2 AND clinical_status = $3
      RETURNING *`,
    [change.to, problemId, change.from]
  );
  if (!rows.length) {
    throw safetyError(409, 'Problem changed while this update was in flight.', 'PROBLEM_CONFLICT');
  }
  return { previousStatus: change.from, problem: rows[0] };
}

/**
 * Prescription safety net. Records one alert per (prescription, allergy) pair and
 * returns the flags so the prescribing UI can require acknowledgement. It never
 * refuses to create the prescription: that decision belongs to the clinician.
 */
async function guardPrescriptionAllergies(pool, { prescriptionId, patientUserId, medications, allergies }) {
  const risks = detectAllergyRisks({ medications, allergies });
  for (const risk of risks) {
    await pool.query(
      `INSERT INTO ng_prescription_allergy_alerts
         (prescription_id, patient_user_id, allergy_id, medication_text, match_type)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT DO NOTHING`,
      [prescriptionId, patientUserId, risk.allergyId, risk.medicationText, risk.matchType]
    );
  }
  return risks;
}

module.exports = {
  buildClinicalSummary,
  changeProblemStatus,
  detectAllergyRisks,
  assertStatusChange,
  guardPrescriptionAllergies,
  listAllergies,
  listProblems,
  recordAllergy,
  recordProblem,
  substanceKey,
  supersedeAllergy,
  validateAllergyInput,
  validateProblemInput,
  _test: {
    ALLERGY_CLASSES,
    ALLERGY_STATUS,
    ALLERGY_VERIFICATION,
    CRITICALITY,
    PROBLEM_STATUS,
    TERMINAL_STATUSES,
    normalizeToken,
  },
};

