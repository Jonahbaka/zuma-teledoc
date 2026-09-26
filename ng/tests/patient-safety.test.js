'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertStatusChange,
  buildClinicalSummary,
  changeProblemStatus,
  detectAllergyRisks,
  guardPrescriptionAllergies,
  listAllergies,
  recordAllergy,
  substanceKey,
  supersedeAllergy,
  validateAllergyInput,
  validateProblemInput,
} = require('../services/clinical/patientSafetyService');

function scriptedPool(responses) {
  const calls = [];
  const client = {
    calls,
    released: false,
    async query(sql, params) {
      calls.push({ sql, params: params || [] });
      for (const response of responses) {
        if (response.used) continue;
        if (response.match && !response.match.test(sql)) continue;
        response.used = true;
        if (response.error) throw response.error;
        return response.result;
      }
      return { rows: [] };
    },
    release() { client.released = true; },
  };
  return {
    calls,
    client,
    async connect() { return client; },
    async query(sql, params) { return client.query(sql, params); },
  };
}


// ---------------------------------------------------------------------------
function match(pattern, result) { return { match: pattern, result }; }

// Allergy matching
// ---------------------------------------------------------------------------

test('substance matching ignores dose, case and punctuation', () => {
  assert.equal(substanceKey('Amoxicillin 500mg'), 'amoxicillin');
  assert.equal(substanceKey('AMOXICILLIN'), 'amoxicillin');
  assert.equal(substanceKey('amoxicillin'), substanceKey('Amoxicillin 500 mg'));
});

test('a direct allergy match is flagged for acknowledgement', () => {
  const risks = detectAllergyRisks({
    medications: [{ name: 'Amoxicillin 500mg capsules' }],
    allergies: [{
      id: 'a1', substance_text: 'Amoxicillin', reaction_text: 'Rash', criticality: 'high', clinical_status: 'active',
    }],
  });

  assert.equal(risks.length, 1);
  assert.equal(risks[0].matchType, 'name_match');
  assert.equal(risks[0].severity, 'high');
  assert.equal(risks[0].requiresAcknowledgement, true);
  assert.equal(risks[0].allergyId, 'a1');
});

test('a same-class different-drug reaction is flagged as a class match', () => {
  const risks = detectAllergyRisks({
    medications: ['Flucloxacillin 250mg'],
    allergies: [{ id: 'a2', substance_text: 'Penicillin', criticality: 'low', clinical_status: 'active' }],
  });

  assert.equal(risks.length, 1);
  assert.equal(risks[0].matchType, 'class_match');
  assert.equal(risks[0].severity, 'review');
});

test('inactive, resolved, and error-marked allergies never raise an alert', () => {
  const allergies = [
    { id: 'a3', substance_text: 'Amoxicillin', clinical_status: 'inactive' },
    { id: 'a4', substance_text: 'Amoxicillin', clinical_status: 'active', verification_status: 'entered-in-error' },
    { id: 'a5', substance_text: 'Amoxicillin', clinical_status: 'resolved' },
  ];
  const risks = detectAllergyRisks({ medications: ['Amoxicillin'], allergies });
  assert.equal(risks.length, 0);
});

test('unrelated medications and malformed input produce no alerts and no crash', () => {
  const penicillin = [{ id: 'a6', substance_text: 'Penicillin', clinical_status: 'active' }];
  assert.deepEqual(detectAllergyRisks({ medications: ['Paracetamol'], allergies: penicillin }), []);
  assert.deepEqual(detectAllergyRisks({ medications: [null, {}, ''], allergies: penicillin }), []);
  assert.deepEqual(detectAllergyRisks({}), []);
  assert.deepEqual(
    detectAllergyRisks({ medications: ['Penicillin'], allergies: [{ id: 'a7', substance_text: '', clinical_status: 'active' }] }),
    []
  );
});

test('the prescribing guard records one alert row per risk and never blocks', async () => {
  const pool = scriptedPool([
    match(/INSERT INTO ng_prescription_allergy_alerts/i, { rows: [] }),
    match(/INSERT INTO ng_prescription_allergy_alerts/i, { rows: [] }),
  ]);
  const risks = await guardPrescriptionAllergies(pool, {
    prescriptionId: 'rx-1',
    patientUserId: 'p-1',
    medications: ['Amoxicillin', 'Paracetamol'],
    allergies: [{ id: 'a9', substance_text: 'Amoxicillin', criticality: 'high', clinical_status: 'active' }],
  });

  assert.equal(risks.length, 1);
  const inserts = pool.calls.filter((call) => /INSERT INTO ng_prescription_allergy_alerts/i.test(call.sql));
  assert.equal(inserts.length, 1);
  assert.deepEqual(inserts[0].params.slice(0, 5), ['rx-1', 'p-1', 'a9', 'Amoxicillin', 'name_match']);
});

// ---------------------------------------------------------------------------
// Persistence: attribution, supersede-not-overwrite, concurrency
// ---------------------------------------------------------------------------

test('recording an allergy attributes the recorder and stores clinical detail', async () => {
  const pool = scriptedPool([match(/INSERT INTO ng_patient_allergies/i, { rows: [{ id: 'all-1' }] })]);
  const allergy = await recordAllergy(pool, {
    patientUserId: 'p-1',
    actorUserId: 'dr-1',
    actorRole: 'provider',
    substanceText: 'Penicillin',
    reactionText: 'Urticaria',
    criticality: 'high',
    category: 'medication',
  });

  assert.equal(allergy.id, 'all-1');
  const params = pool.calls[0].params;
  assert.equal(params[0], 'p-1');
  assert.equal(params[1], null, 'substance code may be absent without failing');
  assert.equal(params[3], null, 'a reaction code may be absent without failing');
  assert.equal(params[4], 'Urticaria');
  assert.equal(params[5], 'high');
  assert.equal(params[10], 'dr-1');
  assert.equal(params[11], 'provider');
});

test('listing allergies hides superseded rows and puts active high-criticality first', async () => {
  const pool = scriptedPool([match(/SELECT \* FROM ng_patient_allergies/i, { rows: [{ id: 'all-1' }] })]);
  await listAllergies(pool, 'p-1', { includeInactive: false });
  const sql = pool.calls[0].sql;
  assert.match(sql, /superseded_by_allergy_id IS NULL/);
  assert.match(sql, /criticality WHEN 'high' THEN 0/);
  assert.deepEqual(pool.calls[0].params, ['p-1', false]);
});

test('correcting an allergy supersedes the original instead of rewriting it', async () => {
  const pool = scriptedPool([
    match(/SELECT \* FROM ng_patient_allergies/i, {
      rows: [{ id: 'all-1', patient_user_id: 'p-1', clinical_status: 'active', substance_text: 'Penicillin' }],
    }),
    match(/INSERT INTO ng_patient_allergies/i, { rows: [{ id: 'all-2', clinical_status: 'refuted' }] }),
    match(/UPDATE ng_patient_allergies/i, { rows: [{ id: 'all-1' }] }),
  ]);

  const result = await supersedeAllergy(pool, {
    allergyId: 'all-1',
    patientUserId: 'p-1',
    actorUserId: 'dr-1',
    reason: 'Reassessed in clinic: no true penicillin allergy',
    next: { substanceText: 'Penicillin', criticality: 'low', clinicalStatus: 'active', verificationStatus: 'refuted' },
  });

  assert.equal(result.superseded.id, 'all-1');
  assert.equal(result.correction.id, 'all-2');
  const update = pool.calls.find((call) => /UPDATE ng_patient_allergies/i.test(call.sql));
  assert.doesNotMatch(update.sql, /substance_text\s*=/, 'the original allergy text is never rewritten');
  assert.deepEqual(update.params.slice(0, 2), ['all-2', 'all-1']);
});

test('a concurrent correction is rejected instead of double-superseding', async () => {
  const pool = scriptedPool([
    match(/SELECT \* FROM ng_patient_allergies/i, {
      rows: [{ id: 'all-1', patient_user_id: 'p-1', clinical_status: 'active', substance_text: 'Penicillin' }],
    }),
    match(/INSERT INTO ng_patient_allergies/i, { rows: [{ id: 'all-2' }] }),
    match(/UPDATE ng_patient_allergies/i, { rows: [] }),
  ]);

  await assert.rejects(
    supersedeAllergy(pool, {
      allergyId: 'all-1', patientUserId: 'p-1', actorUserId: 'dr-1',
      next: { substanceText: 'Penicillin', clinicalStatus: 'inactive' },
    }),
    (error) => error.statusCode === 409 && error.code === 'ALLERGY_CONFLICT'
  );
});

test('correcting an allergy for the wrong patient is a 404, not a cross-patient write', async () => {
  const pool = scriptedPool([match(/SELECT \* FROM ng_patient_allergies/i, { rows: [] })]);
  await assert.rejects(
    supersedeAllergy(pool, {
      allergyId: 'all-1', patientUserId: 'p-2', actorUserId: 'dr-1',
      next: { substanceText: 'Penicillin' },
    }),
    (error) => error.statusCode === 404 && error.code === 'ALLERGY_NOT_FOUND'
  );
});

test('a problem status change is a compare-and-swap and reports the previous status', async () => {
  const pool = scriptedPool([
    match(/SELECT \* FROM ng_problem_list_items/i, {
      rows: [{ id: 'pr-1', patient_user_id: 'p-1', clinical_status: 'active' }],
    }),
    match(/UPDATE ng_problem_list_items/i, { rows: [{ id: 'pr-1', clinical_status: 'resolved' }] }),
  ]);

  const result = await changeProblemStatus(pool, {
    problemId: 'pr-1', patientUserId: 'p-1', clinicalStatus: 'resolved',
  });

  assert.equal(result.previousStatus, 'active');
  assert.equal(result.problem.clinical_status, 'resolved');
  assert.match(pool.calls[1].sql, /WHERE id = \$2 AND clinical_status = \$3/, 'concurrent edits cannot silently win');
  assert.deepEqual(pool.calls[1].params, ['resolved', 'pr-1', 'active']);
});

test('a stale problem update fails closed', async () => {
  const pool = scriptedPool([
    match(/SELECT \* FROM ng_problem_list_items/i, {
      rows: [{ id: 'pr-1', patient_user_id: 'p-1', clinical_status: 'active' }],
    }),
    match(/UPDATE ng_problem_list_items/i, { rows: [] }),
  ]);
  await assert.rejects(
    changeProblemStatus(pool, { problemId: 'pr-1', patientUserId: 'p-1', clinicalStatus: 'resolved' }),
    (error) => error.statusCode === 409 && error.code === 'PROBLEM_CONFLICT'
  );
});

// ---------------------------------------------------------------------------
// Clinical summary
// ---------------------------------------------------------------------------

test('the clinical summary separates missing values from real data and stays factual', () => {
  const summary = buildClinicalSummary({
    patient: {},
    allergies: [
      {
        substance_text: 'Penicillin', reaction_text: null, criticality: 'high',
        clinical_status: 'active', verification_status: 'confirmed', recorded_at: '2026-09-01',
      },
      { substance_text: 'Peanuts', clinical_status: 'inactive' },
    ],
    problems: [
      { problem_text: 'Asthma', problem_code: 'J45', clinical_status: 'active', onset_date: null },
      { problem_text: 'Old fracture', clinical_status: 'resolved' },
    ],
    medications: [{ name: 'Salbutamol inhaler', status: 'active' }],
    encounters: [{ encounter_type: 'telehealth', status: 'signed', created_at: '2026-09-10', signed_at: '2026-09-10' }],
    observations: [{
      observation_code: 'SPO2', display_name: 'SpO2', value_numeric: 97, unit: '%',
      observed_at: '2026-09-10', method: 'device',
    }],
    referrals: [
      { status: 'completed', priority: 'routine' },
      { status: 'sent', priority: 'urgent', target_name: 'Paediatric clinic' },
    ],
  });

  assert.equal(summary.allergies.length, 1, 'inactive allergies are not listed as current');
  assert.equal(summary.allergies[0].reaction, 'Not recorded', 'missing reaction is explicit, not blank or zero');
  assert.equal(summary.problemList.length, 1);
  assert.equal(summary.problemList[0].onset, 'Not recorded');
  assert.equal(summary.observations[0].value, 97);
  assert.equal(summary.openReferrals.length, 1);
  assert.equal(summary.openReferrals[0].target, 'Paediatric clinic');
  assert.equal(summary.patient.displayName, 'Not recorded');
  assert.equal(summary.provenance.allergyCount, 1);
  assert.match(summary.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('an empty chart produces a summary, not a crash, and reports zero counts', () => {
  const summary = buildClinicalSummary();
  assert.deepEqual(summary.allergies, []);
  assert.deepEqual(summary.problemList, []);
  assert.deepEqual(summary.recentEncounters, []);
  assert.equal(summary.provenance.encounterCount, 0);
  assert.equal(summary.patient.sex, 'Not recorded');
});
