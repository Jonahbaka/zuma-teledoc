'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  amendNote,
  assertClinicalListRole,
  assertEncounterWriteOwnership,
  assertSignableEncounter,
  coveringReasonFrom,
  noteContentHash,
  noteSnapshot,
  signEncounter,
  validateReferralTransition,
} = require('../services/clinical/clinicalRecordIntegrityService');

function request(overrides = {}) {
  return {
    user: { id: 'provider-1', role: 'provider' },
    headers: {},
    body: {},
    ip: '10.0.0.9',
    get: () => 'clinical-integrity-test',
    ...overrides,
  };
}

/** Minimal pg Pool/Client stand-in: every query is recorded and scripted. */
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
    release() {
      client.released = true;
    },
  };
  return {
    calls,
    client,
    async connect() {
      return client;
    },
    async query(sql, params) {
      return client.query(sql, params);
    },
  };
}

function sqlMatching(pattern, result) {
  return { match: pattern, result };
}

// ---------------------------------------------------------------------------
// Encounter ownership
// ---------------------------------------------------------------------------

test('encounter notes are restricted to the owning clinician', () => {
  const encounter = { id: 'enc-1', provider_user_id: 'provider-1', status: 'draft' };

  const owner = assertEncounterWriteOwnership({ encounter, actorUserId: 'provider-1' });
  assert.equal(owner.owner, true);
  assert.equal(owner.covering, false);

  assert.throws(
    () => assertEncounterWriteOwnership({ encounter, actorUserId: 'provider-2' }),
    (error) => error.statusCode === 403 && error.code === 'ENCOUNTER_OWNERSHIP_REQUIRED'
  );

  assert.throws(
    () => assertEncounterWriteOwnership({ encounter, actorUserId: 'provider-2', coveringReason: 'short' }),
    (error) => error.statusCode === 403 && error.code === 'ENCOUNTER_OWNERSHIP_REQUIRED'
  );
});

test('shift cover is allowed only with a recorded reason and is flagged as cover', () => {
  const encounter = { id: 'enc-1', provider_user_id: 'provider-1', status: 'draft' };
  const cover = assertEncounterWriteOwnership({
    encounter,
    actorUserId: 'provider-2',
    coveringReason: '  Night shift handover because provider-1 went off call  ',
  });

  assert.equal(cover.owner, false);
  assert.equal(cover.covering, true);
  assert.equal(cover.encounterOwnerUserId, 'provider-1');
  assert.equal(cover.coveringReason, 'Night shift handover because provider-1 went off call');
});

test('a missing encounter is a 404 and an unauthenticated actor never writes', () => {
  assert.throws(
    () => assertEncounterWriteOwnership({ encounter: null, actorUserId: 'provider-1' }),
    (error) => error.statusCode === 404 && error.code === 'ENCOUNTER_NOT_FOUND'
  );

  assert.throws(
    () => assertEncounterWriteOwnership({ encounter: { id: 'e', provider_user_id: 'p' }, actorUserId: null }),
    (error) => error.statusCode === 401 && error.code === 'AUTHENTICATION_REQUIRED'
  );
});

test('administrative override is explicit and reported as an override', () => {
  const decision = assertEncounterWriteOwnership({
    encounter: { id: 'enc-1', provider_user_id: 'provider-1' },
    actorUserId: 'admin-1',
    coveringReason: null,
    isAdminOverride: true,
  });

  assert.equal(decision.adminOverride, true);
  assert.equal(decision.covering, false);
});

// ---------------------------------------------------------------------------
// Referral status transitions
// ---------------------------------------------------------------------------

test('legal referral transitions are accepted and normalized', () => {
  assert.deepEqual(validateReferralTransition('draft', 'sent'), { from: 'draft', to: 'sent' });
  assert.deepEqual(validateReferralTransition('SENT', 'Accepted'), { from: 'sent', to: 'accepted' });
  assert.deepEqual(validateReferralTransition('accepted', 'completed'), { from: 'accepted', to: 'completed' });
  assert.deepEqual(validateReferralTransition('declined', 'cancelled'), { from: 'declined', to: 'cancelled' });
});

test('illegal referral transitions are rejected instead of silently applied', () => {
  assert.throws(
    () => validateReferralTransition('draft', 'completed'),
    (error) => error.statusCode === 409 && error.code === 'REFERRAL_TRANSITION_NOT_ALLOWED'
  );
  assert.throws(
    () => validateReferralTransition('completed', 'sent'),
    (error) => error.statusCode === 409 && error.code === 'REFERRAL_TRANSITION_NOT_ALLOWED'
  );
  assert.throws(
    () => validateReferralTransition('cancelled', 'sent'),
    (error) => error.statusCode === 409 && error.code === 'REFERRAL_TRANSITION_NOT_ALLOWED'
  );
  assert.throws(
    () => validateReferralTransition('sent', 'sent'),
    (error) => error.statusCode === 409 && error.code === 'REFERRAL_STATUS_UNCHANGED'
  );
  assert.throws(
    () => validateReferralTransition('sent', 'teleported'),
    (error) => error.statusCode === 400 && error.code === 'REFERRAL_STATUS_INVALID'
  );
  assert.throws(
    () => validateReferralTransition(null, 'sent'),
    (error) => error.statusCode === 409 && error.code === 'REFERRAL_STATUS_UNKNOWN'
  );
});

// ---------------------------------------------------------------------------
// Sign-off
// ---------------------------------------------------------------------------

test('an encounter can only be signed while it is still open', () => {
  const signable = assertSignableEncounter({ id: 'enc-1', status: 'in_progress' });
  assert.equal(signable.status, 'in_progress');

  for (const status of ['signed', 'amended', 'cancelled']) {
    assert.throws(
      () => assertSignableEncounter({ id: 'enc-1', status }),
      (error) => error.statusCode === 409 && error.code === 'ENCOUNTER_ALREADY_FINAL'
    );
  }
  assert.throws(
    () => assertSignableEncounter({ id: 'enc-1', status: 'waiting' }),
    (error) => error.statusCode === 409 && error.code === 'ENCOUNTER_NOT_SIGNABLE'
  );
  assert.throws(
    () => assertSignableEncounter(null),
    (error) => error.statusCode === 404 && error.code === 'ENCOUNTER_NOT_FOUND'
  );
});

test('signing stamps notes, finalizes the encounter, and writes an audit record', async () => {
  const pool = scriptedPool([
    sqlMatching(/SELECT id, subjective[\s\S]*FOR UPDATE/i, {
      rows: [
        { id: 'note-1', subjective: 'Fever', objective: null, assessment: 'Malaria', plan: 'ACT', provider_attestation: null },
        { id: 'note-2', subjective: null, objective: null, assessment: null, plan: null, provider_attestation: null },
      ],
    }),
    sqlMatching(/UPDATE ng_clinical_encounters/i, {
      rows: [{ id: 'enc-1', status: 'signed', signed_at: '2026-09-26T00:00:00.000Z' }],
    }),
    sqlMatching(/INSERT INTO ng_audit_lineage/i, { rows: [] }),
  ]);

  const signed = await signEncounter(pool, request(), {
    encounter: { id: 'enc-1', patient_user_id: 'patient-1', status: 'draft' },
    noteIds: ['note-1', 'note-2'],
    attestation: 'Attested by remote clinician',
    actorUserId: 'provider-1',
  });

  assert.equal(signed.status, 'signed');

  const noteUpdate = pool.calls.find((call) => /UPDATE ng_soap_notes/i.test(call.sql));
  assert.equal(
    noteUpdate.params[2],
    noteContentHash({
      subjective: 'Fever', objective: null, assessment: 'Malaria', plan: 'ACT', provider_attestation: null,
    }),
    'signed notes store a content digest computed from the note text'
  );

  const audit = pool.calls.find((call) => /INSERT INTO ng_audit_lineage/i.test(call.sql));
  assert.equal(audit.params[1], 'encounter_signed');
  assert.match(audit.params[6], /"noteIds":\["note-1","note-2"\]/);
  assert.match(audit.params[6], /"attestationProvided":true/);
  assert.equal(pool.client.released, true);
});

test('signing rolls back and fails when a note is already signed', async () => {
  const pool = scriptedPool([
    sqlMatching(/SELECT id, subjective[\s\S]*FOR UPDATE/i, { rows: [] }),
  ]);

  await assert.rejects(
    signEncounter(pool, request(), {
      encounter: { id: 'enc-1', patient_user_id: 'patient-1', status: 'draft' },
      noteIds: ['note-1'],
      actorUserId: 'provider-1',
    }),
    (error) => error.statusCode === 409 && error.code === 'SOAP_NOTE_NOT_SIGNABLE'
  );

  assert.ok(pool.calls.some((call) => /ROLLBACK/i.test(call.sql)));
  assert.equal(pool.client.released, true);
});

// ---------------------------------------------------------------------------
// Amendments
// ---------------------------------------------------------------------------

test('a note digest is stable, ignores nulls, and changes with the text', () => {
  const a = noteContentHash({ subjective: 'Headache', assessment: null });
  const b = noteContentHash({ subjective: 'Headache', assessment: null, objective: undefined, plan: null });
  const c = noteContentHash({ subjective: 'Headache', assessment: 'Migraine' });

  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.deepEqual(noteSnapshot({ subjective: 'x' }), {
    subjective: 'x', objective: '', assessment: '', plan: '', provider_attestation: '',
  });
});

test('amending requires a reason and never rewrites the original note', async () => {
  const original = {
    id: 'note-1',
    patient_user_id: 'patient-1',
    encounter_id: 'enc-1',
    subjective: 'Fever',
    assessment: 'Malaria',
    content_hash: noteContentHash({ subjective: 'Fever', assessment: 'Malaria' }),
  };

  await assert.rejects(
    amendNote(scriptedPool([]), request(), {
      encounterId: 'enc-1',
      originalNote: original,
      replacement: { assessment: 'Malaria (revised)' },
      reason: 'too short',
      actorUserId: 'provider-1',
    }),
    (error) => error.statusCode === 400 && error.code === 'AMENDMENT_REASON_REQUIRED'
  );

  const pool = scriptedPool([
    sqlMatching(/INSERT INTO ng_soap_notes/i, { rows: [{ id: 'note-2', content_hash: 'newhash' }] }),
    sqlMatching(/UPDATE ng_soap_notes/i, { rows: [{ id: 'note-1' }] }),
    sqlMatching(/INSERT INTO ng_clinical_record_amendments/i, { rows: [] }),
  ]);

  const result = await amendNote(pool, request(), {
    encounterId: 'enc-1',
    originalNote: original,
    replacement: { assessment: 'Malaria (revised)', plan: 'Continue ACT' },
    reason: 'Wrong antimalarial recorded at first review',
    actorUserId: 'provider-1',
    providerId: 'provider-profile-1',
  });

  assert.equal(result.supersededNoteId, 'note-1');
  assert.equal(result.amendment.id, 'note-2');
  assert.equal(result.originalContentHash, original.content_hash);

  // The original text is only ever marked not-current, never rewritten.
  const retire = pool.calls.find((call) => /UPDATE ng_soap_notes/i.test(call.sql));
  assert.match(retire.sql, /is_current = FALSE/);
  assert.doesNotMatch(retire.sql, /subjective\s*=/i);

  const insert = pool.calls.find((call) => /INSERT INTO ng_soap_notes/i.test(call.sql));
  assert.deepEqual(insert.params[9], 'note-1', 'the amendment references the note it replaces');
  assert.equal(insert.params[10], 'Wrong antimalarial recorded at first review');

  const amendment = pool.calls.find((call) => /INSERT INTO ng_clinical_record_amendments/i.test(call.sql));
  assert.match(amendment.params[7], /"subjective":"Fever"/, 'the pre-amendment text is preserved');
  assert.equal(amendment.params[8], original.content_hash);

  const audit = pool.calls.find((call) => /INSERT INTO ng_audit_lineage/i.test(call.sql));
  assert.match(audit.params[1], /soap_note_amended/);
});

test('a note already superseded by another amendment is not overwritten twice', async () => {
  const pool = scriptedPool([
    sqlMatching(/INSERT INTO ng_soap_notes/i, { rows: [{ id: 'note-3', content_hash: 'hash-3' }] }),
    sqlMatching(/UPDATE ng_soap_notes/i, { rows: [] }),
  ]);

  await assert.rejects(
    amendNote(pool, request(), {
      encounterId: 'enc-1',
      originalNote: { id: 'note-1', patient_user_id: 'patient-1' },
      replacement: { assessment: 'again' },
      reason: 'Second correction arriving at the same time',
      actorUserId: 'provider-1',
    }),
    (error) => error.statusCode === 409 && error.code === 'AMENDMENT_CONFLICT'
  );
});

test('an amendment cannot itself be amended', async () => {
  await assert.rejects(
    amendNote(scriptedPool([]), request(), {
      encounterId: 'enc-1',
      originalNote: { id: 'note-2', patient_user_id: 'patient-1', amends_note_id: 'note-1' },
      replacement: { assessment: 'x' },
      reason: 'Attempting to edit an already amended note',
      actorUserId: 'provider-1',
    }),
    (error) => error.statusCode === 409 && error.code === 'AMENDMENT_NOT_AMENDABLE'
  );
});

// ---------------------------------------------------------------------------
// Route-level guards
// ---------------------------------------------------------------------------

test('clinical list endpoints deny non-clinical roles and route admins to break-glass', () => {
  assert.equal(assertClinicalListRole('patient'), 'patient');
  assert.equal(assertClinicalListRole('Provider'), 'provider');
  assert.equal(assertClinicalListRole('specialist'), 'specialist');
  assert.equal(assertClinicalListRole('  DOCTOR  '), 'doctor');

  assert.throws(
    () => assertClinicalListRole('pharmacy'),
    (error) => error.statusCode === 403 && error.code === 'CLINICAL_ACCESS_DENIED'
  );
  assert.throws(
    () => assertClinicalListRole('nurse'),
    (error) => error.statusCode === 403 && error.code === 'CLINICAL_ACCESS_DENIED'
  );
  assert.throws(
    () => assertClinicalListRole('super_admin'),
    (error) => error.statusCode === 403 && error.code === 'BREAK_GLASS_REQUIRED_FOR_LIST'
  );
  assert.throws(
    () => assertClinicalListRole(''),
    (error) => error.statusCode === 403 && error.code === 'CLINICAL_ACCESS_DENIED'
  );
});

test('covering-clinician reason is read from the header or the body', () => {
  assert.equal(
    coveringReasonFrom(request({ headers: { 'x-covering-clinician-reason': 'Night shift cover' } })),
    'Night shift cover'
  );
  assert.equal(coveringReasonFrom(request({ body: { covering_reason: 'Handover agreed' } })), 'Handover agreed');
  assert.equal(coveringReasonFrom(request()), null);
});
