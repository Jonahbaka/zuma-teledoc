'use strict';

// Mandatory, synthetic-only integration coverage. Never point this suite at a
// deployed database. CI owns provisioning/migrations and discards the database.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { v5 } = require('uuid');
const { fixtureTargetSafety } = require('../scripts/fixtureTargetSafety');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: clinical AI PostgreSQL tests must not be skipped.');
const safety = fixtureTargetSafety({ source: 'DATABASE_URL' });
if (safety.skipped) throw new Error(`Refusing clinical AI fixture writes: ${safety.reason}`);
if (process.env.SIMULATION_DATABASE_URL && process.env.SIMULATION_DATABASE_URL !== process.env.DATABASE_URL) {
  throw new Error('SIMULATION_DATABASE_URL must not redirect clinical AI fixtures to a different database.');
}
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.CLINICAL_AI_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.CLINICAL_AI_KILL_SWITCH = 'false';

const { getPool, close } = require('../../server/db');
const { runNgMigrations } = require('../migrations/migrate');
const { seedDemoAccounts } = require('../scripts/seed-demo-accounts');
const workflow = require('../services/phc/phcWorkflowService');
const scope = require('../services/phc/programmeScopeService');
const ai = require('../services/phc/clinicalAiService');
const chart = require('../../server/services/clinicalEncounterService');
const request = { ip: '127.0.0.1', headers: { 'user-agent': 'synthetic-clinical-ai-db-test' } };
let pool, nurseContext, doctorContext, doctor, patient, otherPatient;
const key = () => crypto.randomUUID();
const complaint = 'Synthetic documentation fixture, not a real patient complaint.';

// No provider configuration, credentials, SDK, or network call is involved.
const syntheticOutput = () => ({
  summary: complaint, handoverDraft: complaint,
  missingInformation: [], uncertainties: [],
  assertions: [{ text: complaint, sourceRefs: ['encounter:chief_complaint'] }],
  soapDraft: { subjective: complaint, objective: '', assessment: '', plan: '' },
  followUpDrafts: [{ title: 'Synthetic documentation check', instructions: 'Review the synthetic intake documentation.', sourceRefs: ['encounter:chief_complaint'] }],
});
async function modelCaller({ allowedSourceRefs, input }) {
  assert.ok(allowedSourceRefs.includes('encounter:chief_complaint'));
  assert.equal(input.encounter.chiefComplaint, complaint);
  return { text: JSON.stringify(syntheticOutput()), provider: 'synthetic-test', model: 'no-network-fixture', modelVersion: '1' };
}
async function encounterFor(patientId = patient.id) {
  const encounter = await workflow.createEncounter(pool, request, nurseContext, {
    patientUserId: patientId, chiefComplaint: complaint, reasonForVisit: complaint,
    identityVerified: true, identityVerificationMethod: 'synthetic_fixture', idempotencyKey: key(),
  });
  const queued = await workflow.enqueueEncounter(pool, request, nurseContext, {
    encounterId: encounter.id, priority: 'routine', priorityScore: 50, idempotencyKey: key(),
  });
  await workflow.claimQueueEntry(pool, request, doctorContext, { queueEntryId: queued.id });
  return encounter;
}
const draftFor = encounter => ai.createSuggestion(pool, request, doctorContext, { encounterId: encounter.id, suggestionType: 'soap_draft' }, modelCaller);
const review = (encounter, draft, changes = {}) => ai.reviewSuggestion(pool, request, doctorContext, draft.id, { decision: 'accepted', expectedEncounterId: encounter.id, ...changes });
const observationInput = encounter => ({
  encounterId: encounter.id, observationCode: '8310-5', displayName: 'Synthetic temperature',
  valueType: 'numeric', valueNumeric: 37.1, unit: 'Cel', method: 'manual',
  observedAt: new Date().toISOString(), idempotencyKey: key(), provenance: { synthetic: true },
});

test.before(async () => {
  pool = getPool();
  assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, safety.target.database);
  pool = getPool(); // Resolve the lazy pool before verifying its concrete options.
  const actualTarget = fixtureTargetSafety({ source: 'DATABASE_URL', pool });
  assert.equal(actualTarget.skipped, false, actualTarget.reason);
  await runNgMigrations(pool);
  const seeded = await seedDemoAccounts({ pool, password: 'Demo12345678!', mfaSecret: 'JBSWY3DPEHPK3PXP' });
  assert.ok(seeded.demoProgramme, 'Disposable database must have synthetic demo programme');
  const accounts = (await pool.query(`SELECT id,email,role,is_test_account FROM users WHERE email=ANY($1::text[])`,
    [['nurse@demo.doctarx.com','doctor@demo.doctarx.com','patient@demo.doctarx.com']])).rows;
  const account = email => accounts.find(row => row.email === email);
  const nurse = account('nurse@demo.doctarx.com'); doctor = account('doctor@demo.doctarx.com');
  patient = account('patient@demo.doctarx.com');
  assert.ok(accounts.length === 3 && accounts.every(row => row.is_test_account));
  const input = { programmeId: seeded.demoProgramme.programmeId, facilityId: seeded.demoProgramme.facilityId };
  nurseContext = await scope.assertProgrammeScope(pool, nurse, { ...input, allowedRoles: ['phc_nurse'] });
  doctorContext = await scope.assertProgrammeScope(pool, doctor, { ...input, allowedRoles: ['remote_clinician'] });
  assert.equal(doctorContext.demo_only, true);
  await pool.query(`UPDATE public_health_programmes SET settings_json=settings_json || '{"clinicalAiEnabled":true}'::jsonb WHERE id=$1 AND demo_only=TRUE`, [doctorContext.programme_id]);
  // Dedicated fictional patient, not a role change to an existing demo persona.
  const secondId = key();
  otherPatient = (await pool.query(`INSERT INTO users
      (id,email,password_hash,role,first_name,last_name,is_active,is_verified,
       email_verified_at,hipaa_consent_at,terms_accepted_at,country,market_scope,is_test_account,test_account_metadata)
    SELECT $1,$2,password_hash,'patient','Synthetic','AiPatientB',TRUE,TRUE,
      NOW(),NOW(),NOW(),'Nigeria','NG',TRUE,'{"syntheticDataOnly":true,"fixture":"clinical-ai-workflow-db"}'::jsonb
    FROM users WHERE id=$3 AND role='patient' AND is_test_account=TRUE
    RETURNING id,role,is_test_account`, [secondId, `clinical-ai-${secondId}@fixture.doctarx.test`, patient.id])).rows[0];
  assert.ok(otherPatient?.is_test_account && otherPatient.role === 'patient');
  await workflow.enrollPatient(pool, request, nurseContext, {
    patientUserId: otherPatient.id, consentStatus: 'granted', consentVersion: 'synthetic-ai-db-v1', signatureEvidence: { synthetic: true },
  });
});
test.after(async () => { await close(); });

test('actual encrypted AI generation, clinician edits, canonical unsigned SOAP import and reviewed follow-up replay', async () => {
  const encounter = await encounterFor();
  const draft = await draftFor(encounter);
  assert.equal(draft.requiresHumanReview, true);
  assert.equal(draft.validation_json.groundingValidated, false);
  const stored = (await pool.query('SELECT * FROM ng_clinical_ai_suggestions WHERE id=$1', [draft.id])).rows[0];
  assert.ok(stored.output_encrypted && !stored.output_encrypted.includes(complaint));
  assert.equal(ai.decryptJson({ encrypted: stored.output_encrypted, iv: stored.output_iv, tag: stored.output_tag }).summary, complaint);
  const edited = syntheticOutput();
  edited.soapDraft.assessment = 'Clinician-authored synthetic assessment; not a clinical recommendation.';
  edited.followUpDrafts[0].instructions = 'Clinician-reviewed synthetic documentation follow-up.';
  const accepted = await review(encounter, draft, { decision: 'accepted_with_edits', editedOutput: edited });
  assert.equal(accepted.status, 'accepted');
  assert.equal(Number((await pool.query('SELECT count(*) FROM clinical_notes WHERE encounter_id=$1', [encounter.canonical_id])).rows[0].count), 0, 'Review must not auto-write a chart note');
  const preview = await chart.getReviewedAiDraft(encounter.canonical_id, doctor.id, draft.id);
  assert.equal(preview.noteDraft.assessment, edited.soapDraft.assessment);
  const notePayload = { ...preview.noteDraft, aiSuggestionId: draft.id };
  const note = await chart.createNote(encounter.canonical_id, doctor.id, notePayload);
  const replay = await chart.createNote(encounter.canonical_id, doctor.id, notePayload);
  assert.equal(replay.id, note.id);
  const persistedNote = (await pool.query('SELECT * FROM clinical_notes WHERE id=$1', [note.id])).rows[0];
  assert.equal(persistedNote.is_signed, false);
  assert.equal(persistedNote.signature_hash, null);
  assert.ok(persistedNote.assessment_encrypted);
  assert.equal(Number((await pool.query('SELECT count(*) FROM clinical_notes WHERE encounter_id=$1', [encounter.canonical_id])).rows[0].count), 1);
  await assert.rejects(chart.createNote(encounter.canonical_id, doctor.id, { ...notePayload, plan: 'Conflicting retry' }), { code: 'CLINICAL_AI_ALREADY_IMPORTED' });
  const noteAudit = (await pool.query(`SELECT new_values FROM audit_logs WHERE resource_id::text=$1 AND resource_type='clinical_note' AND action='create'`, [note.id])).rows[0];
  assert.equal(noteAudit.new_values.aiSuggestionId, draft.id);
  const taskPayload = {
    patientUserId: patient.id, encounterId: encounter.id, taskType: 'clinical_review',
    title: edited.followUpDrafts[0].title, instructions: edited.followUpDrafts[0].instructions,
    dueAt: new Date(Date.now() + 86400000).toISOString(), assignedRole: 'remote_clinician',
    sourceSuggestionId: draft.id, sourceDraftIndex: 0,
    idempotencyKey: v5(`clinical-ai-follow-up:${draft.id}:0`, v5.URL),
  };
  const task = await workflow.createFollowUp(pool, request, doctorContext, taskPayload);
  const taskReplay = await workflow.createFollowUp(pool, request, doctorContext, taskPayload);
  assert.equal(taskReplay.id, task.id);
  assert.notEqual(task.status, 'completed');
  const protectedTask = (await pool.query('SELECT title,title_encrypted,title_iv,title_tag FROM ng_follow_up_tasks WHERE id=$1', [task.id])).rows[0];
  assert.equal(protectedTask.title, null, 'Clinical title must not be written in plaintext');
  assert.ok(protectedTask.title_encrypted && protectedTask.title_iv && protectedTask.title_tag);
  await assert.rejects(pool.query('UPDATE ng_follow_up_tasks SET title_encrypted=NULL WHERE id=$1', [task.id]), { code: '23514' });
  await assert.rejects(pool.query("UPDATE ng_follow_up_tasks SET title_tag='' WHERE id=$1", [task.id]), { code: '23514' });
  const taskAudit = (await pool.query(`SELECT metadata_json FROM ng_programme_audit_events WHERE resource_id=$1 AND action='follow_up_created'`, [task.id])).rows[0];
  assert.deepEqual(taskAudit.metadata_json, { sourceSuggestionId: draft.id, sourceDraftIndex: 0 });
  await assert.rejects(workflow.createFollowUp(pool, request, doctorContext, { ...taskPayload, dueAt: new Date(Date.now() + 172800000).toISOString() }), { code: 'FOLLOW_UP_IDEMPOTENCY_CONFLICT' });
  const otherEncounter = await encounterFor(otherPatient.id);
  await assert.rejects(chart.getReviewedAiDraft(otherEncounter.canonical_id, doctor.id, draft.id), { code: 'CLINICAL_AI_IMPORT_DENIED' });
  await assert.rejects(workflow.createFollowUp(pool, request, doctorContext, { ...taskPayload, patientUserId: otherPatient.id, encounterId: otherEncounter.id }), { code: 'CLINICAL_AI_ENCOUNTER_MISMATCH' });
});

test('real source changes, expired drafts and cross-encounter review fail without a review row or note write', async () => {
  const encounter = await encounterFor();
  const stale = await draftFor(encounter);
  await workflow.createObservation(pool, request, nurseContext, observationInput(encounter));
  await assert.rejects(review(encounter, stale), { code: 'CLINICAL_AI_SOURCE_CHANGED' });
  const expired = await draftFor(encounter);
  await pool.query("UPDATE ng_clinical_ai_suggestions SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [expired.id]);
  await assert.rejects(review(encounter, expired), { code: 'CLINICAL_AI_DRAFT_EXPIRED' });
  const fresh = await draftFor(encounter);
  const otherEncounter = await encounterFor(otherPatient.id);
  await assert.rejects(review(otherEncounter, fresh), { code: 'CLINICAL_AI_ENCOUNTER_MISMATCH' });
  assert.equal(Number((await pool.query('SELECT count(*) FROM ng_clinical_ai_reviews WHERE suggestion_id=ANY($1::uuid[])', [[stale.id, expired.id, fresh.id]])).rows[0].count), 0);
  assert.equal(Number((await pool.query('SELECT count(*) FROM clinical_notes WHERE encounter_id=$1', [encounter.canonical_id])).rows[0].count), 0);
});

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function barrierPool(base, { onConnect, beforeQuery, afterQuery }) {
  return { async connect() {
    const client = await base.connect();
    await client.query("SET statement_timeout='15000ms'");
    onConnect?.(client.processID);
    return { async query(sql, params) { await beforeQuery?.(sql); const result = await client.query(sql, params); await afterQuery?.(sql); return result; }, release() { client.release(); } };
  } };
}
async function assertBlockedBy(writerPid, reviewPid) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const row = (await pool.query('SELECT $1::int=ANY(pg_blocking_pids($2::int)) AS blocked', [reviewPid, writerPid])).rows[0];
    if (row.blocked) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('PostgreSQL did not report the source writer blocked by the review transaction');
}

test('real concurrent observation capture waits for the locked review snapshot, then makes later import stale', { timeout: 30000 }, async () => {
  const encounter = await encounterFor();
  const draft = await draftFor(encounter);
  const acquired = deferred(), releaseReview = deferred(), writerAttempt = deferred();
  let reviewPid, writerPid, paused = false;
  const encounterLock = sql => /SELECT id FROM ng_clinical_encounters/.test(sql) && /FOR UPDATE/.test(sql);
  const reviewingPool = barrierPool(pool, {
    onConnect(pid) { reviewPid = pid; },
    async afterQuery(sql) { if (!paused && encounterLock(sql)) { paused = true; acquired.resolve(); await releaseReview.promise; } },
  });
  const writingPool = barrierPool(pool, {
    onConnect(pid) { writerPid = pid; },
    beforeQuery(sql) { if (encounterLock(sql)) writerAttempt.resolve(); },
  });
  let reviewOutcome, writerOutcome;
  const reviewing = ai.reviewSuggestion(reviewingPool, request, doctorContext, draft.id, { decision: 'accepted', expectedEncounterId: encounter.id })
    .then(value => { reviewOutcome = { value }; }, error => { reviewOutcome = { error }; acquired.resolve(); });
  let writing;
  try {
    await acquired.promise;
    if (reviewOutcome?.error) throw reviewOutcome.error;
    writing = workflow.createObservation(writingPool, request, nurseContext, observationInput(encounter))
      .then(value => { writerOutcome = { value }; }, error => { writerOutcome = { error }; writerAttempt.resolve(); });
    await writerAttempt.promise;
    if (writerOutcome?.error) throw writerOutcome.error;
    await assertBlockedBy(writerPid, reviewPid);
    assert.equal(writerOutcome, undefined, 'Writer must not finish while the review holds its source lock');
  } finally {
    releaseReview.resolve();
    await Promise.all([reviewing, writing].filter(Boolean));
  }
  if (reviewOutcome?.error) throw reviewOutcome.error;
  if (writerOutcome?.error) throw writerOutcome.error;
  assert.equal(reviewOutcome.value.status, 'accepted');
  assert.ok(writerOutcome.value.id);
  await assert.rejects(chart.getReviewedAiDraft(encounter.canonical_id, doctor.id, draft.id), { code: 'CLINICAL_AI_SOURCE_CHANGED' });
  assert.equal(Number((await pool.query('SELECT count(*) FROM ng_clinical_ai_reviews WHERE suggestion_id=$1', [draft.id])).rows[0].count), 1);
});

test('migration 033 upgrades legacy follow-up titles without losing plaintext or accepting incomplete protection', async () => {
  const migrationSql = require('node:fs').readFileSync(require('node:path').join(__dirname, '../migrations/033_ng_follow_up_protected_title.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // No public-schema fallback: the actual unqualified migration must resolve
    // exclusively to this connection-local legacy fixture, never the real table.
    await client.query('SET LOCAL search_path TO pg_temp');
    await client.query(`CREATE TEMP TABLE ng_follow_up_tasks (
      id integer PRIMARY KEY,
      title text NOT NULL,
      title_encrypted text,
      title_iv text,
      title_tag text
    ) ON COMMIT DROP`);
    const target = (await client.query(`SELECT c.relpersistence, c.relnamespace = pg_my_temp_schema() AS is_temp_schema
      FROM pg_class c WHERE c.oid = 'ng_follow_up_tasks'::regclass`)).rows[0];
    assert.equal(target.relpersistence, 't');
    assert.equal(target.is_temp_schema, true);
    // Fail closed if a later migration revision explicitly names another schema.
    assert.doesNotMatch(migrationSql, /ALTER\s+TABLE\s+(?:ONLY\s+)?[\w"]+\s*\./i);
    await client.query("INSERT INTO ng_follow_up_tasks (id,title) VALUES (1,'Synthetic legacy title')");
    await client.query(migrationSql);
    assert.equal((await client.query('SELECT title FROM ng_follow_up_tasks WHERE id=1')).rows[0].title, 'Synthetic legacy title');
    await client.query(`INSERT INTO ng_follow_up_tasks (id,title,title_encrypted,title_iv,title_tag)
      VALUES (2,NULL,'synthetic-ciphertext','synthetic-iv','synthetic-tag')`);
    assert.equal((await client.query('SELECT title FROM ng_follow_up_tasks WHERE id=2')).rows[0].title, null);
    const invalidProtection = [
      [null, null, null],
      [null, 'iv', 'tag'], ['ciphertext', null, 'tag'], ['ciphertext', 'iv', null],
      ['', 'iv', 'tag'], ['ciphertext', '', 'tag'], ['ciphertext', 'iv', ''],
    ];
    for (const values of invalidProtection) {
      await client.query('SAVEPOINT invalid_title');
      try {
        await assert.rejects(client.query(`INSERT INTO ng_follow_up_tasks
          (id,title,title_encrypted,title_iv,title_tag) VALUES (3,NULL,$1,$2,$3)`, values),
        { code: '23514', constraint: 'ng_follow_up_title_required' });
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT invalid_title');
        await client.query('RELEASE SAVEPOINT invalid_title');
      }
    }
    assert.equal(Number((await client.query('SELECT count(*) FROM ng_follow_up_tasks')).rows[0].count), 2);
  } finally {
    // Rollback also removes the temporary table and resets search_path, including
    // when migration execution/assertions fail; no shared fixture is altered.
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
});

test('follow-up lifecycle enforces owner, optimistic concurrency, encrypted outcome and single closure audit', async () => {
  const encounter = await encounterFor();
  const task = await workflow.createFollowUp(pool, request, doctorContext, {
    patientUserId: patient.id, encounterId: encounter.id, taskType: 'clinical_review',
    title: 'Synthetic lifecycle task', instructions: 'Review fictional documentation only.',
    assignedUserId: doctorContext.userId, assignedRole: 'remote_clinician', idempotencyKey: key(),
  });
  const change = { taskId: task.id, toStatus: 'in_progress', expectedVersion: task.record_version };
  await assert.rejects(workflow.transitionFollowUp(pool, request, nurseContext, change), { code: 'FOLLOW_UP_ASSIGNEE_REQUIRED' });
  await assert.rejects(workflow.transitionFollowUp(pool, request, { ...doctorContext, facility_id: key() }, change), { code: 'FOLLOW_UP_AUTHORITY_REVOKED' });
  const started = await workflow.transitionFollowUp(pool, request, doctorContext, change);
  assert.equal(started.status, 'in_progress'); assert.equal(started.completed_at, null);
  const finish = { taskId: task.id, toStatus: 'completed', expectedVersion: started.record_version, outcome: 'Human confirmed synthetic documentation check.' };
  // Both transactions read the same caller version; exactly one may commit.
  const attempts = await Promise.allSettled([
    workflow.transitionFollowUp(pool, request, doctorContext, finish),
    workflow.transitionFollowUp(pool, request, doctorContext, finish),
  ]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(result => result.status === 'rejected').reason.code, 'FOLLOW_UP_VERSION_CONFLICT');
  const closed = attempts.find(result => result.status === 'fulfilled').value;
  assert.equal(closed.status, 'completed'); assert.equal(closed.completed_by, doctorContext.userId);
  assert.ok(closed.completed_at); assert.equal(closed.closure_outcome, finish.outcome);
  assert.deepEqual(closed.allowed_transitions, []);
  const row = (await pool.query('SELECT * FROM ng_follow_up_tasks WHERE id=$1', [task.id])).rows[0];
  assert.equal(row.record_version, task.record_version + 2);
  assert.equal(JSON.stringify(row.closure_evidence_json).includes(finish.outcome), false);
  assert.ok(row.closure_evidence_json.encrypted && row.closure_evidence_json.iv && row.closure_evidence_json.tag);
  const audit = (await pool.query("SELECT metadata_json FROM ng_programme_audit_events WHERE resource_id=$1 AND action='follow_up_transition' ORDER BY created_at", [task.id])).rows;
  assert.equal(audit.length, 2); assert.equal(JSON.stringify(audit).includes(finish.outcome), false);
  const reloaded = (await workflow.listFollowUps(pool, doctorContext, { patientUserId: patient.id })).find(item => item.id === task.id);
  assert.equal(reloaded.closure_outcome, finish.outcome); assert.equal(reloaded.closure_evidence_json, undefined);
  await assert.rejects(workflow.transitionFollowUp(pool, request, doctorContext, { ...finish, expectedVersion: closed.record_version, toStatus: 'cancelled' }), { code: 'INVALID_FOLLOW_UP_TRANSITION' });
});

test('membership revocation serializes against task writes and stale middleware context is rejected', { timeout: 30000 }, async () => {
  const task = await workflow.createFollowUp(pool, request, doctorContext, {
    patientUserId: patient.id, taskType: 'review', title: 'Synthetic authority race',
    assignedUserId: doctorContext.userId, assignedRole: 'remote_clinician', idempotencyKey: key(),
  });
  const held = deferred(), release = deferred();
  let transitionPid, paused = false, result;
  const transactional = barrierPool(pool, {
    onConnect(pid) { transitionPid = pid; },
    async afterQuery(sql) {
      if (!paused && sql.includes('FROM ng_follow_up_tasks') && sql.includes('FOR UPDATE')) {
        paused = true; held.resolve(); await release.promise;
      }
    },
  });
  const transition = workflow.transitionFollowUp(transactional, request, doctorContext, {
    taskId: task.id, toStatus: 'in_progress', expectedVersion: task.record_version,
  }).then(value => { result = { value }; }, error => { result = { error }; held.resolve(); });
  const revoker = await pool.connect();
  let revocation, revokeError;
  try {
    await held.promise; if (result?.error) throw result.error;
    await revoker.query("SET statement_timeout='15000ms'");
    revocation = revoker.query("UPDATE ng_programme_memberships SET expires_at=clock_timestamp()-INTERVAL '1 second' WHERE id=$1", [doctorContext.membershipId])
      .catch(error => { revokeError = error; });
    await assertBlockedBy(revoker.processID, transitionPid);
  } finally {
    release.resolve(); await transition;
    if (revocation) await revocation;
    revoker.release();
  }
  try {
    if (result?.error) throw result.error;
    if (revokeError) throw revokeError;
    await assert.rejects(workflow.transitionFollowUp(pool, request, doctorContext, {
      taskId: task.id, toStatus: 'completed', expectedVersion: result.value.record_version, outcome: 'Synthetic completion must be rejected.',
    }), { code: 'FOLLOW_UP_AUTHORITY_REVOKED' });
    const row = (await pool.query('SELECT status,record_version FROM ng_follow_up_tasks WHERE id=$1', [task.id])).rows[0];
    assert.equal(row.status, 'in_progress'); assert.equal(row.record_version, task.record_version + 1);
    assert.equal(Number((await pool.query("SELECT count(*) FROM ng_programme_audit_events WHERE resource_id=$1 AND action='follow_up_transition'", [task.id])).rows[0].count), 1);
  } finally {
    await pool.query('UPDATE ng_programme_memberships SET expires_at=NULL WHERE id=$1', [doctorContext.membershipId]);
  }
});
