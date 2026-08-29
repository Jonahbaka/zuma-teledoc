'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required: PHC workflow tests must run against disposable PostgreSQL and may not be skipped.');
}

process.env.ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { getPool, close } = require('../../server/db');
const clinicalEncounterService = require('../../server/services/clinicalEncounterService');
const { runNgMigrations } = require('../migrations/migrate');
const { seedDemoAccounts } = require('../scripts/seed-demo-accounts');
const deviceGateway = require('../services/phc/deviceGatewayService');
const reporting = require('../services/phc/programmeReportingService');
const scope = require('../services/phc/programmeScopeService');
const workflow = require('../services/phc/phcWorkflowService');

const request = {
  ip: '127.0.0.1',
  headers: { 'user-agent': 'doctarx-phc-db-integration-test' },
  get(name) { return this.headers[String(name).toLowerCase()] || null; },
};

const idempotencyKey = () => crypto.randomUUID();
const currentPeriod = () => new Date().toISOString().slice(0, 7);
let seeded;

test('PHC migrations are checksum-backed, idempotent, and seed the synthetic programme', async () => {
  const pool = getPool();
  const secondRun = await runNgMigrations(pool);
  assert.equal(secondRun.ran, 0);

  const ledger = await pool.query(
    `SELECT filename, checksum FROM ng_migrations
      WHERE filename IN ('020_ng_phc_programme_workspace.sql','021_ng_phc_clinical_operations.sql','022_ng_phc_sync_ai_reporting.sql')
      ORDER BY filename`
  );
  assert.equal(ledger.rows.length, 3);
  ledger.rows.forEach((row) => assert.match(row.checksum.trim(), /^[a-f0-9]{64}$/));

  seeded = await seedDemoAccounts({
    pool,
    password: 'Demo12345678!',
    mfaSecret: 'JBSWY3DPEHPK3PXP',
  });
  assert.equal(seeded.accounts.length, 12);
  assert.ok(seeded.demoProgramme.programmeId);
  assert.ok(seeded.demoProgramme.facilityId);
});

test('synthetic PHC intake, device capture, clinician sign-off, referral, and reporting complete end to end', async () => {
  const pool = getPool();
  const accountResult = await pool.query(
    `SELECT id, email, role FROM users
      WHERE email = ANY($1::TEXT[])`,
    [['nurse@demo.doctarx.com', 'doctor@demo.doctarx.com', 'patient@demo.doctarx.com']]
  );
  const accounts = new Map(accountResult.rows.map((row) => [row.email, row]));
  const nurse = accounts.get('nurse@demo.doctarx.com');
  const doctor = accounts.get('doctor@demo.doctarx.com');
  const patient = accounts.get('patient@demo.doctarx.com');
  assert.ok(nurse && doctor && patient);

  const scopeInput = {
    programmeId: seeded.demoProgramme.programmeId,
    facilityId: seeded.demoProgramme.facilityId,
  };
  const nurseContext = await scope.assertProgrammeScope(pool, nurse, {
    ...scopeInput,
    allowedRoles: ['phc_nurse'],
  });
  const doctorContext = await scope.assertProgrammeScope(pool, doctor, {
    ...scopeInput,
    allowedRoles: ['remote_clinician'],
  });
  await assert.rejects(
    () => scope.assertProgrammeScope(pool, nurse, {
      programmeId: seeded.demoProgramme.programmeId,
      facilityId: crypto.randomUUID(),
    }),
    (error) => error.code === 'PROGRAMME_CONTEXT_INACTIVE'
  );

  const complaint = 'Synthetic headache used only for automated validation';
  const encounter = await workflow.createEncounter(pool, request, nurseContext, {
    patientUserId: patient.id,
    chiefComplaint: complaint,
    reasonForVisit: complaint,
    identityVerified: true,
    identityVerificationMethod: 'developer_fixture',
    idempotencyKey: idempotencyKey(),
  });
  assert.equal(encounter.chief_complaint, complaint);
  assert.ok(encounter.canonical_id);

  const protectedRows = await pool.query(
    `SELECT n.chief_complaint AS ng_plaintext,
            n.reason_for_visit AS ng_reason_plaintext,
            n.chief_complaint_encrypted AS ng_ciphertext,
            n.reason_for_visit_encrypted AS ng_reason_ciphertext,
            c.chief_complaint AS core_plaintext,
            c.chief_complaint_encrypted AS core_ciphertext
       FROM ng_clinical_encounters n
       JOIN ng_clinical_record_links l
         ON l.source_table='ng_clinical_encounters' AND l.source_id=n.id
       JOIN clinical_encounters c ON c.id=l.canonical_id
      WHERE n.id=$1`,
    [encounter.id]
  );
  const protectedEncounter = protectedRows.rows[0];
  assert.equal(protectedEncounter.ng_plaintext, null);
  assert.equal(protectedEncounter.ng_reason_plaintext, null);
  assert.equal(protectedEncounter.core_plaintext, null);
  assert.ok(protectedEncounter.ng_ciphertext);
  assert.ok(protectedEncounter.ng_reason_ciphertext);
  assert.ok(protectedEncounter.core_ciphertext);

  const manualObservation = await workflow.createObservation(pool, request, nurseContext, {
    encounterId: encounter.id,
    observationCode: '8310-5',
    displayName: 'Body temperature',
    valueType: 'numeric',
    valueNumeric: 37.1,
    unit: 'Cel',
    method: 'manual',
    observedAt: new Date().toISOString(),
    idempotencyKey: idempotencyKey(),
    provenance: { synthetic: true, enteredByRole: 'phc_nurse' },
  });
  assert.equal(Number(manualObservation.value_numeric), 37.1);

  const device = (await pool.query(
    `SELECT id FROM ng_clinical_devices
      WHERE programme_id=$1 AND facility_id=$2 AND adapter_key='mock_device_v1'
      LIMIT 1`,
    [nurseContext.programme_id, nurseContext.facility_id]
  )).rows[0];
  const deviceCapture = await deviceGateway.captureMockFixture(pool, request, nurseContext, {
    deviceId: device.id,
    encounterId: encounter.id,
    fixtureName: 'blood_pressure',
    idempotencyKey: idempotencyKey(),
  });
  assert.equal(deviceCapture.synthetic, true);
  assert.equal(deviceCapture.observation.method, 'device');

  const queued = await workflow.enqueueEncounter(pool, request, nurseContext, {
    encounterId: encounter.id,
    priority: 'routine',
    priorityScore: 50,
    idempotencyKey: idempotencyKey(),
  });
  await assert.rejects(
    () => workflow.transitionQueueEntry(pool, request, doctorContext, {
      queueEntryId: queued.id,
      toStatus: 'called',
      expectedVersion: queued.record_version,
    }),
    (error) => error.code === 'ASSIGNED_CLINICIAN_REQUIRED'
  );
  await assert.rejects(
    () => workflow.transitionQueueEntry(pool, request, nurseContext, {
      queueEntryId: queued.id,
      toStatus: 'claimed',
      expectedVersion: queued.record_version,
    }),
    (error) => error.code === 'QUEUE_CLAIM_OPERATION_REQUIRED'
  );
  const claimed = await workflow.claimQueueEntry(pool, request, doctorContext, {
    queueEntryId: queued.id,
  });
  assert.equal(claimed.assigned_provider_user_id, doctor.id);

  const consulting = await workflow.transitionQueueEntry(pool, request, doctorContext, {
    queueEntryId: queued.id,
    toStatus: 'in_consultation',
    expectedVersion: claimed.record_version,
  });
  await assert.rejects(
    () => workflow.transitionQueueEntry(pool, request, doctorContext, {
      queueEntryId: queued.id,
      toStatus: 'completed',
      expectedVersion: consulting.record_version,
    }),
    (error) => error.code === 'CLINICAL_SIGNOFF_REQUIRED'
  );

  const note = await clinicalEncounterService.createNote(encounter.canonical_id, doctor.id, {
    noteType: 'soap',
    subjective: complaint,
    objective: 'Synthetic observations reviewed.',
    assessment: 'Synthetic test assessment; no real clinical decision.',
    plan: 'Close the synthetic validation encounter.',
  });
  const signedNote = await clinicalEncounterService.signNote(note.id, doctor.id);
  assert.equal(signedNote.isSigned, true);

  const completed = await workflow.transitionQueueEntry(pool, request, doctorContext, {
    queueEntryId: queued.id,
    toStatus: 'completed',
    expectedVersion: consulting.record_version,
  });
  assert.equal(completed.status, 'completed');
  const finalState = await pool.query(
    `SELECT n.status AS ng_status, c.status AS core_status
       FROM ng_clinical_encounters n
       JOIN ng_clinical_record_links l
         ON l.source_table='ng_clinical_encounters' AND l.source_id=n.id
       JOIN clinical_encounters c ON c.id=l.canonical_id
      WHERE n.id=$1`,
    [encounter.id]
  );
  assert.deepEqual(finalState.rows[0], { ng_status: 'signed', core_status: 'completed' });

  const referralReason = 'Synthetic specialist review request';
  const referral = await workflow.createReferral(pool, request, doctorContext, {
    patientUserId: patient.id,
    encounterId: encounter.id,
    targetName: 'Synthetic Referral Destination',
    destinationType: 'external',
    referralType: 'specialist',
    reason: referralReason,
    clinicalNotes: 'Synthetic clinical context only.',
    idempotencyKey: idempotencyKey(),
  });
  assert.equal(referral.reason, referralReason);
  await workflow.transitionReferral(pool, request, doctorContext, {
    referralId: referral.id,
    toStatus: 'sent',
  });
  await workflow.transitionReferral(pool, request, doctorContext, {
    referralId: referral.id,
    toStatus: 'accepted',
  });
  const closedReferral = await workflow.transitionReferral(pool, request, doctorContext, {
    referralId: referral.id,
    toStatus: 'completed',
    responseSummary: 'Synthetic referral outcome returned to PHC.',
  });
  assert.equal(closedReferral.status, 'completed');
  assert.match(closedReferral.response_summary, /Synthetic referral outcome/);
  const rawReferral = (await pool.query(
    `SELECT reason, clinical_notes, response_summary,
            reason_encrypted, clinical_notes_encrypted, response_summary_encrypted
       FROM ng_referrals WHERE id=$1`,
    [referral.id]
  )).rows[0];
  assert.equal(rawReferral.reason, null);
  assert.equal(rawReferral.clinical_notes, null);
  assert.equal(rawReferral.response_summary, null);
  assert.ok(rawReferral.reason_encrypted);
  assert.ok(rawReferral.clinical_notes_encrypted);
  assert.ok(rawReferral.response_summary_encrypted);

  const preview = await reporting.previewReport(pool, nurseContext, currentPeriod());
  assert.equal(preview.aggregateOnly, true);
  assert.equal(preview.containsPatientIdentifiers, false);
  assert.ok(preview.values.length > 0);
  assert.ok(preview.values.every((value) => !Object.hasOwn(value, 'patientUserId')));

  const generated = await reporting.generateReport(pool, request, nurseContext, {
    period: currentPeriod(),
    notes: 'Synthetic monthly programme validation report.',
  });
  assert.equal(generated.report.contains_patient_identifiers, false);
  const dhis2 = await reporting.buildDhis2DryRun(pool, request, nurseContext, generated.report.id);
  assert.equal(dhis2.dryRunOnly, true);
  assert.equal(dhis2.liveSubmissionEnabled, false);
  assert.equal(dhis2.containsPatientIdentifiers, false);

  const queue = await workflow.listQueue(pool, doctorContext, { status: 'completed' });
  const listed = queue.find((row) => row.id === queued.id);
  assert.equal(listed.chief_complaint, complaint);
  assert.equal(listed.canonical_encounter_id, encounter.canonical_id);
});

test.after(async () => {
  await close();
});
