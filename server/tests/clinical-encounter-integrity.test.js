'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const jwt = require('jsonwebtoken');
const service = require('../services/clinicalEncounterService');
const db = require('../db');

test('malformed clinical references and unsupported clinical reader roles never reach storage', async () => {
  const oldQuery = db.query; const oldPool = db.getPool; let calls = 0;
  db.query = () => { calls++; throw new Error('Storage must not be reached'); };
  db.getPool = () => { calls++; throw new Error('Storage must not be reached'); };
  const id = crypto.randomUUID();
  try {
    for (const role of ['admin', 'super_admin', 'pharmacy', 'government_analyst', undefined]) {
      await assert.rejects(service.getEncounterById(id, id, role), { statusCode: 403 });
      await assert.rejects(service.getNoteById(id, id, role), { statusCode: 403 });
      await assert.rejects(service.getEncounterNotes(id, id, role), { statusCode: 403 });
      await assert.rejects(service.getPatientEncounters(id, { userId: id, userRole: role }), { statusCode: 403 });
    }
    for (const operation of [() => service.createEncounter({ patientId: 'invalid' }, id), () => service.completeEncounter('invalid', id),
      () => service.createNote('invalid', id, {}), () => service.updateNote('invalid', id, {}), () => service.signNote('invalid', id),
      () => service.createAmendment('invalid', id, { reason: 'Clinical correction' })]) await assert.rejects(operation(), { statusCode: 400 });
    assert.equal(calls, 0);
  } finally { db.query = oldQuery; db.getPool = oldPool; }
});

test('a stale unsigned note snapshot cannot overwrite a signed row at the final SQL write boundary', async () => {
  const oldPool = db.getPool; const oldQuery = db.query; const oldLock = service._lockNote;
  const noteId = crypto.randomUUID(), providerId = crypto.randomUUID(), patientId = crypto.randomUUID(), encounterId = crypto.randomUUID();
  const signed = { id: noteId, provider_id: providerId, patient_id: patientId, encounter_id: encounterId, is_signed: true, is_locked: true, signature_hash: 'retained-signature', subjective_encrypted: 'retained-signed-content' };
  const original = structuredClone(signed); let writes = 0; let audits = 0; let rolledBack = false;
  const query = async sql => {
    if (sql === 'BEGIN') return { rows: [] };
    if (sql === 'ROLLBACK') { rolledBack = true; return { rows: [] }; }
    if (sql.includes('INSERT INTO audit_logs')) { audits++; return { rows: [] }; }
    if (sql.includes('SELECT')) return { rows: [{ ...signed, is_signed: false, is_locked: false }] };
    if (sql.includes('UPDATE clinical_notes')) {
      writes++;
      if (sql.includes('is_signed IS NOT TRUE') && sql.includes('is_locked IS NOT TRUE')) return { rows: [] };
      signed.subjective_encrypted = 'overwritten'; return { rows: [signed] };
    }
    throw new Error('Unexpected stale note SQL');
  };
  db.query = query; db.getPool = () => ({ connect: async () => ({ query, release() {} }) });
  service._lockNote = async () => ({ ...signed, is_signed: false, is_locked: false });
  try {
    await assert.rejects(service.updateNote(noteId, providerId, { subjective: 'Delayed draft edit' }), { code: 'CLINICAL_NOTE_IMMUTABLE' });
    assert.equal(writes, 1); assert.equal(audits, 0); assert.equal(rolledBack, true); assert.deepEqual(signed, original);
  } finally { db.query = oldQuery; db.getPool = oldPool; service._lockNote = oldLock; }
});

const target = process.env.SIMULATION_DATABASE_URL;
test('PostgreSQL encounters and notes retain current market, exact care lineage, immutable signatures, transactional audits and safe HTTP access', { skip: !target }, async () => {
  const url = new URL(target); assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'));
  const { Pool } = require('pg'); const pool = new Pool({ connectionString: target }); const client = await pool.connect();
  const oldQuery = db.query; const oldPool = db.getPool; const oldSecret = process.env.JWT_ACCESS_SECRET;
  const logger = require('../middleware/logger'); const oldLogging = { info: logger.info, error: logger.error, audit: logger.audit };
  logger.info = logger.error = logger.audit = () => {};
  process.env.JWT_ACCESS_SECRET = 'isolated-clinical-encounter-test-signing-secret';
  let serial = 0; let failAudit = false; let server;
  const routePool = { query: (...args) => client.query(...args), async connect() {
    const point = 'clinical_' + (++serial);
    return { async query(sql, params) {
      if (sql === 'BEGIN') return client.query('SAVEPOINT ' + point);
      if (sql === 'COMMIT') return client.query('RELEASE SAVEPOINT ' + point);
      if (sql === 'ROLLBACK') { await client.query('ROLLBACK TO SAVEPOINT ' + point); return client.query('RELEASE SAVEPOINT ' + point); }
      if (failAudit && sql.includes('INSERT INTO audit_logs')) throw new Error('Isolated clinical audit failure');
      return client.query(sql, params);
    }, release() {} };
  } };
  try {
    await client.query('BEGIN'); db.query = routePool.query; db.getPool = () => routePool;
    const patient = crypto.randomUUID(), otherPatient = crypto.randomUUID(), provider = crypto.randomUUID(), otherProvider = crypto.randomUUID(), admin = crypto.randomUUID();
    for (const [id, role] of [[patient, 'patient'], [otherPatient, 'patient'], [provider, 'provider'], [otherProvider, 'provider'], [admin, 'admin']]) await client.query(`INSERT INTO users
      (id,email,password_hash,role,first_name,last_name,market_scope,region,country,is_active,is_test_account,provider_status,must_change_password)
      VALUES ($1,$2,'ISOLATED_CONTROL_NO_PASSWORD_LOGIN',$3,'Isolated','Clinical control','US','US','US',TRUE,TRUE,'approved',FALSE)`, [id, 'clinical-' + id + '@example.invalid', role]);
    const appointment = crypto.randomUUID(), foreignAppointment = crypto.randomUUID();
    for (const [id, patientId, providerId] of [[appointment, patient, provider], [foreignAppointment, otherPatient, otherProvider]]) await client.query("INSERT INTO appointments (id,patient_id,provider_id,scheduled_at,status) VALUES ($1,$2,$3,NOW()+INTERVAL '1 day','confirmed')", [id, patientId, providerId]);
    const input = { patientId: patient, appointmentId: appointment, encounterType: 'chart_review', patientState: 'CA', chiefComplaint: 'Protected clinical complaint' };
    const rowCount = async table => Number((await client.query('SELECT count(*) AS count FROM ' + table)).rows[0].count);
    const before = { encounters: await rowCount('clinical_encounters'), relationships: await rowCount('provider_patient_relationships') };
    for (const [data, actor] of [[{ ...input, appointmentId: foreignAppointment }, provider], [{ ...input, patientId: otherPatient }, provider], [input, otherProvider], [input, admin], [{ ...input, appointmentId: null }, provider]]) await assert.rejects(service.createEncounter(data, actor), error => error.statusCode === 403);
    assert.deepEqual({ encounters: await rowCount('clinical_encounters'), relationships: await rowCount('provider_patient_relationships') }, before);
    failAudit = true;
    await assert.rejects(service.createEncounter(input, provider), /Isolated clinical audit failure/); failAudit = false;
    assert.equal(await rowCount('clinical_encounters'), before.encounters);
    assert.equal((await client.query('SELECT status FROM appointments WHERE id=$1', [appointment])).rows[0].status, 'confirmed');
    const encounter = await service.createEncounter(input, provider);
    assert.equal(encounter.patientId, patient); assert.equal(encounter.providerId, provider);
    assert.equal((await service.getEncounterById(encounter.id, provider, 'provider')).chiefComplaint, input.chiefComplaint);
    assert.equal((await service.getEncounterById(encounter.id, patient, 'patient')).id, encounter.id);
    assert.equal(await service.getEncounterById(encounter.id, otherPatient, 'patient'), null);
    assert.equal(await service.getEncounterById(encounter.id, otherProvider, 'provider'), null);
    assert.equal((await service.getPatientEncounters(patient, { userId: provider, userRole: 'provider' })).length, 1);
    await client.query("INSERT INTO provider_patient_relationships(provider_id,patient_id,relationship_type,is_active) VALUES($1,$2,'treating',TRUE)", [otherProvider, patient]);
    assert.equal((await service.getEncounterById(encounter.id, otherProvider, 'provider')).id, encounter.id, 'An authorized active care relationship preserves clinical reads');
    await assert.rejects(service.createNote(encounter.id, otherProvider, { subjective: 'Foreign author' }), { code: 'CLINICAL_CONTEXT_DENIED' });
    const note = await service.createNote(encounter.id, provider, { noteType: 'soap', subjective: 'Original protected note', objective: 'Recorded objective finding', assessment: 'Clinical assessment', plan: 'Clinical plan', physicalExam: 'Recorded physical finding', vitals: { heartRate: 76 } });
    assert.equal((await service.getNoteById(note.id, provider, 'provider')).subjective, 'Original protected note');
    assert.deepEqual((await service.getNoteById(note.id, provider, 'provider')).vitals, { heartRate: 76 });
    assert.equal((await service.getEncounterNotes(encounter.id, otherProvider, 'provider')).length, 1);
    const reads = [() => service.getEncounterById(encounter.id, provider, 'provider'),
      () => service.getPatientEncounters(patient, { userId: provider, userRole: 'provider' }), () => service.getNoteById(note.id, provider, 'provider'),
      () => service.getEncounterNotes(encounter.id, provider, 'provider'), () => service.getNoteVersionHistory(note.id, provider, 'provider')];
    const auditCount = async () => Number((await client.query("SELECT count(*) FROM audit_logs WHERE user_id=$1 AND action='read' AND resource_type IN ('clinical_encounter','clinical_note')", [provider])).rows[0].count);
    for (const read of reads) { const beforeRead = await auditCount(); await read(); assert.ok(await auditCount() > beforeRead); }
    const beforeFailedReads = await auditCount(); failAudit = true;
    for (const read of reads) await assert.rejects(read(), { statusCode: 503, code: 'CLINICAL_AUDIT_UNAVAILABLE' });
    failAudit = false; assert.equal(await auditCount(), beforeFailedReads);
    for (const [table, id, field, read] of [
      ['clinical_encounters', encounter.id, 'chief_complaint', reads[0]],
      ...['subjective', 'objective', 'assessment', 'plan', 'physical_exam', 'vitals'].map(field => ['clinical_notes', note.id, field, reads[2]]),
    ]) {
      const tag = (await client.query('SELECT ' + field + '_tag AS tag FROM ' + table + ' WHERE id=$1', [id])).rows[0].tag;
      const beforeTamper = await auditCount();
      await client.query('UPDATE ' + table + ' SET ' + field + '_tag=$1 WHERE id=$2', ['0'.repeat(32), id]);
      await assert.rejects(read(), { statusCode: 503, code: 'CLINICAL_DECRYPTION_UNAVAILABLE' });
      await assert.rejects(reads[3](), { statusCode: 503, code: 'CLINICAL_DECRYPTION_UNAVAILABLE' });
      assert.equal(await auditCount(), beforeTamper, 'Corrupt clinical content never commits a successful read audit or partial plaintext result');
      await client.query('UPDATE ' + table + ' SET ' + field + '_tag=$1 WHERE id=$2', [tag, id]);
      await read();
    }
    for (const operation of [() => service.getNoteById(note.id, patient, 'patient'), () => service.getEncounterNotes(encounter.id, patient, 'patient'), () => service.getNoteVersionHistory(note.id, patient, 'patient')]) await assert.rejects(operation(), { code: 'CLINICAL_NOTE_RELEASE_NOT_CONFIGURED' });
    const noteSnapshot = async () => (await client.query('SELECT * FROM clinical_notes WHERE id=$1', [note.id])).rows[0];
    const original = await noteSnapshot();
    for (const operation of [() => service.updateNote(note.id, otherProvider, { subjective: 'Foreign edit' }), () => service.signNote(note.id, otherProvider), () => service.createAmendment(note.id, otherProvider, { reason: 'Foreign amendment' })]) await assert.rejects(operation(), { statusCode: 403 });
    const deniedContext = async () => {
      await assert.rejects(service.createNote(encounter.id, provider, {}), error => [403, 409].includes(error.statusCode));
      await assert.rejects(service.updateNote(note.id, provider, { subjective: 'Must not persist' }), error => [403, 409].includes(error.statusCode));
      await assert.rejects(service.signNote(note.id, provider), error => [403, 409].includes(error.statusCode));
      assert.deepEqual(await noteSnapshot(), original);
    };
    for (const patch of ["role='admin'", 'is_active=FALSE', "provider_status='pending'", "market_scope='NG'"]) {
      await client.query('UPDATE users SET ' + patch + ' WHERE id=$1', [provider]); await deniedContext();
      await client.query("UPDATE users SET role='provider',is_active=TRUE,provider_status='approved',market_scope='US' WHERE id=$1", [provider]);
    }
    await client.query('UPDATE users SET is_active=FALSE WHERE id=$1', [patient]); await deniedContext(); await client.query('UPDATE users SET is_active=TRUE WHERE id=$1', [patient]);
    await client.query("UPDATE users SET market_scope='NG' WHERE id=ANY($1::uuid[])", [[patient, provider]]); await deniedContext();
    await client.query("UPDATE users SET market_scope='US' WHERE id=ANY($1::uuid[])", [[patient, provider]]);
    await client.query('UPDATE clinical_encounters SET appointment_id=$1 WHERE id=$2', [foreignAppointment, encounter.id]);
    await deniedContext();
    await client.query('UPDATE clinical_encounters SET appointment_id=$1 WHERE id=$2', [appointment, encounter.id]);
    await client.query("UPDATE appointments SET status='cancelled' WHERE id=$1", [appointment]); await deniedContext();
    await client.query("UPDATE appointments SET status='in_progress' WHERE id=$1", [appointment]);
    await client.query("UPDATE clinical_encounters SET status='cancelled' WHERE id=$1", [encounter.id]); await deniedContext();
    await client.query("UPDATE clinical_encounters SET status='in_progress' WHERE id=$1", [encounter.id]);
    await client.query('UPDATE clinical_notes SET patient_id=$1 WHERE id=$2', [otherPatient, note.id]);
    assert.equal(await service.getNoteById(note.id, provider, 'provider'), null);
    await assert.rejects(service.updateNote(note.id, provider, { plan: 'Poisoned lineage' }), { code: 'CLINICAL_CONTEXT_DENIED' });
    await client.query('UPDATE clinical_notes SET patient_id=$1 WHERE id=$2', [patient, note.id]);
    failAudit = true;
    for (const operation of [() => service.createNote(encounter.id, provider, { subjective: 'Must roll back' }), () => service.updateNote(note.id, provider, { subjective: 'Must roll back' }), () => service.signNote(note.id, provider), () => service.completeEncounter(encounter.id, provider)]) {
      const notesBefore = await rowCount('clinical_notes'); await assert.rejects(operation(), /Isolated clinical audit failure/); assert.deepEqual(await noteSnapshot(), original); assert.equal(await rowCount('clinical_notes'), notesBefore);
    }
    failAudit = false;
    await service.updateNote(note.id, provider, { subjective: 'Revised protected note' });
    assert.equal((await service.getNoteById(note.id, provider, 'provider')).subjective, 'Revised protected note');
    const signed = await service.signNote(note.id, provider); assert.equal(signed.isSigned, true); assert.ok(signed.signatureHash);
    const immutable = await noteSnapshot();
    await assert.rejects(service.updateNote(note.id, provider, { subjective: 'Must not overwrite signature' }), { code: 'CLINICAL_NOTE_IMMUTABLE' });
    await assert.rejects(service.signNote(note.id, provider), { code: 'CLINICAL_NOTE_IMMUTABLE' });
    failAudit = true;
    await assert.rejects(service.createAmendment(note.id, provider, { reason: 'Documented correction', plan: 'Must roll back' }), /Isolated clinical audit failure/); failAudit = false;
    assert.deepEqual(await noteSnapshot(), immutable);
    const amendment = await service.createAmendment(note.id, provider, { reason: 'Documented clinical correction', plan: 'Corrected plan' });
    assert.equal(amendment.parentNoteId, note.id); assert.equal(amendment.version, 2); assert.deepEqual(await noteSnapshot(), immutable);
    assert.equal((await service.getNoteVersionHistory(note.id, provider, 'provider')).length, 2);
    assert.equal((await service.completeEncounter(encounter.id, provider)).status, 'completed');
    await service.updateNote(amendment.id, provider, { plan: 'Completed encounter amendment' });
    assert.equal((await service.signNote(amendment.id, provider)).isSigned, true, 'A genuine appended amendment remains signable after encounter completion');
    const laterAmendment = await service.createAmendment(amendment.id, provider, { reason: 'Additional documented correction', assessment: 'New amended assessment' });
    assert.equal(laterAmendment.parentNoteId, note.id); assert.equal(laterAmendment.version, 3);
    assert.deepEqual(await noteSnapshot(), immutable);
    const consent = (await client.query("INSERT INTO telehealth_consents(patient_id,consent_text_version,patient_state,is_valid,expires_at) VALUES($1,'isolated-v1','CA',TRUE,NOW()+INTERVAL '1 day') RETURNING id", [patient])).rows[0];
    const virtual = { ...input, appointmentId: null, encounterType: 'telehealth_video' };
    await assert.rejects(service.createEncounter(virtual, provider), { code: 'CONSENT_REQUIRED' });
    const telehealth = await service.createEncounter({ ...virtual, telehealthConsentId: consent.id }, provider); assert.equal(telehealth.telehealthConsentId, consent.id);
    await client.query('UPDATE telehealth_consents SET is_valid=FALSE WHERE id=$1', [consent.id]);
    await assert.rejects(service.createEncounter({ ...virtual, telehealthConsentId: consent.id }, provider), { code: 'CONSENT_REQUIRED' });

    const dependencies = { express, zod: require('zod'), '../db': db, '../../lib/validation': require('../../lib/validation'), '../../lib/utils': require('../../lib/utils'),
      '../middleware/logger': { error() {} }, '../middleware/auth': require('../middleware/auth'),
      '../middleware/audit': { auditMiddleware: () => (_req, _res, next) => next(), auditPhiAccess: () => (_req, _res, next) => next() },
      '../services/clinicalEncounterService': service, '../services/patientClinicalProfileService': {}, '../services/eRxIntegrationService': {},
      '../services/telehealthConsentService': { validateConsentForEncounter: async () => ({ id: consent.id }) }, '../../ng/services/rx-engine/privatePrescriptionUploadService': {} };
    const sourceModule = { exports: {} }; const filename = path.resolve(__dirname, '../routes/clinicalEncounters.js');
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: sourceModule, exports: sourceModule.exports, require(name) { assert.ok(name in dependencies); return dependencies[name]; } }, { filename });
    const app = express(); app.use(express.json()); app.use('/api/clinical-encounters', sourceModule.exports);
    server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    async function request(suffix, actor, method = 'GET', body) {
      const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/clinical-encounters' + suffix, { method,
        headers: { ...(actor ? { Authorization: 'Bearer ' + jwt.sign({ userId: actor }, process.env.JWT_ACCESS_SECRET, { expiresIn: '5m' }) } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() };
    }
    assert.equal((await request('/' + encounter.id)).status, 401);
    for (const suffix of ['/' + encounter.id, '/' + encounter.id + '/notes', '/notes/' + note.id + '/history', '/patient/' + patient]) assert.equal((await request(suffix, admin)).status, 403);
    assert.equal((await request('/' + encounter.id, provider)).status, 200);
    failAudit = true;
    for (const suffix of ['/' + encounter.id, '/patient/' + patient, '/' + encounter.id + '/notes', '/notes/' + note.id + '/history']) {
      const failed = await request(suffix, provider); assert.equal(failed.status, 503); assert.equal(failed.body.code, 'CLINICAL_AUDIT_UNAVAILABLE');
      assert.deepEqual(Object.keys(failed.body).sort(), ['code', 'error', 'success']);
    }
    failAudit = false;
    for (const [table, id, field, suffix] of [['clinical_encounters', encounter.id, 'chief_complaint', '/' + encounter.id], ['clinical_notes', note.id, 'subjective', '/' + encounter.id + '/notes']]) {
      const tag = (await client.query('SELECT ' + field + '_tag AS tag FROM ' + table + ' WHERE id=$1', [id])).rows[0].tag;
      await client.query('UPDATE ' + table + ' SET ' + field + '_tag=$1 WHERE id=$2', ['0'.repeat(32), id]);
      const corrupt = await request(suffix, provider); assert.equal(corrupt.status, 503); assert.equal(corrupt.body.code, 'CLINICAL_DECRYPTION_UNAVAILABLE');
      assert.deepEqual(Object.keys(corrupt.body).sort(), ['code', 'error', 'success']);
      await client.query('UPDATE ' + table + ' SET ' + field + '_tag=$1 WHERE id=$2', [tag, id]);
    }
    assert.equal((await request('/' + encounter.id, otherPatient)).status, 404);
    assert.equal((await request('/' + encounter.id + '/notes', patient)).body.code, 'CLINICAL_NOTE_RELEASE_NOT_CONFIGURED');
    const locked = await request('/notes/' + note.id, provider, 'PUT', { plan: 'No overwrite' }); assert.equal(locked.status, 409); assert.equal(locked.body.note, undefined);
    assert.equal((await request('', admin, 'POST', input)).status, 403);
    assert.equal((await request('', provider, 'POST', { patientId: 'invalid' })).status, 400);
    await client.query('UPDATE telehealth_consents SET is_valid=TRUE WHERE id=$1', [consent.id]);
    const verifiedConsent = await request('', provider, 'POST', { ...virtual, appointmentId: undefined, telehealthConsentId: crypto.randomUUID() });
    assert.equal(verifiedConsent.status, 201); assert.equal(verifiedConsent.body.encounter.telehealthConsentId, consent.id, 'The route attaches its verified consent, ignoring unvalidated caller consent references');
    const audits = (await client.query("SELECT new_values FROM audit_logs WHERE user_id=$1 AND resource_type IN ('clinical_encounter','clinical_note')", [provider])).rows;
    assert.ok(audits.length >= 7); assert.ok(!JSON.stringify(audits).includes('Revised protected note'));
    assert.deepEqual(await noteSnapshot(), immutable);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    db.query = oldQuery; db.getPool = oldPool;
    Object.assign(logger, oldLogging);
    if (oldSecret === undefined) delete process.env.JWT_ACCESS_SECRET; else process.env.JWT_ACCESS_SECRET = oldSecret;
    await client.query('ROLLBACK'); client.release(); await pool.end();
  }
});
