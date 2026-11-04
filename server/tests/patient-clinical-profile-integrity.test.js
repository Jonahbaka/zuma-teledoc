'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('node:fs');
const path = require('node:path');
const service = require('../services/patientClinicalProfileService');
const db = require('../db');

test('clinical profile operations require an explicit current session and reject administrative or self-verification claims before storage', async () => {
  const originalPool = db.getPool; let calls = 0;
  db.getPool = () => { calls++; throw new Error('Unauthorized clinical work must not connect'); };
  const patient = crypto.randomUUID(); const admin = { id: crypto.randomUUID(), role: 'admin', marketScope: 'US' };
  const self = { id: patient, role: 'patient', marketScope: 'US' };
  try {
    for (const read of [() => service.getOrCreateProfile(patient), () => service.getAllergies(patient), () => service.getProblems(patient), () => service.getMedications(patient), () => service.getClinicalSummary(patient, patient, 'patient')]) await assert.rejects(read(), { code: 'CLINICAL_REFERENCE_INVALID' });
    for (const actor of [admin, { ...admin, role: 'super_admin' }, { ...admin, role: 'pharmacy' }]) {
      await assert.rejects(service.getOrCreateProfile(patient, actor), { statusCode: 403 });
      await assert.rejects(service.getClinicalSummary(patient, actor.id, actor.role, actor), { statusCode: 403 });
    }
    for (const operation of [() => service.verifyIdentity(patient, 'document_review', self.id, self), () => service.verifyAllergy(crypto.randomUUID(), self.id, self),
      () => service.inactivateAllergy(crypto.randomUUID(), self.id, 'Self removal', self), () => service.addProblem(patient, { problemDescription: 'Self diagnosis' }, self.id, self),
      () => service.updateProblem(crypto.randomUUID(), { isActive: false }, self.id, self), () => service.discontinueMedication(crypto.randomUUID(), self.id, 'Self removal', self)]) await assert.rejects(operation(), { statusCode: 403 });
    assert.equal(calls, 0);
  } finally { db.getPool = originalPool; }
});

const target = process.env.SIMULATION_DATABASE_URL;
test('actual clinical profile HTTP and PostgreSQL enforce current care and market, own history, record IDs, encounter lineage and atomic audits', { skip: !target }, async () => {
  const url = new URL(target); assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'));
  const { Pool } = require('pg'); const pool = new Pool({ connectionString: target }); const client = await pool.connect();
  const oldQuery = db.query; const oldPool = db.getPool; const oldSecret = process.env.JWT_ACCESS_SECRET;
  process.env.JWT_ACCESS_SECRET = 'isolated-profile-current-authority-http-secret';
  const logger = require('../middleware/logger'); const logging = { info: logger.info, error: logger.error, audit: logger.audit }; logger.info = logger.error = logger.audit = () => {};
  let serial = 0; let failAudit = false; let server;
  const scoped = { query: (...args) => client.query(...args), async connect() {
    const point = 'profile_' + (++serial);
    return { async query(sql, params) {
      if (sql === 'BEGIN') return client.query('SAVEPOINT ' + point);
      if (sql === 'COMMIT') return client.query('RELEASE SAVEPOINT ' + point);
      if (sql === 'ROLLBACK') { await client.query('ROLLBACK TO SAVEPOINT ' + point); return client.query('RELEASE SAVEPOINT ' + point); }
      if (failAudit && sql.includes('INSERT INTO audit_logs')) throw new Error('Isolated clinical profile audit failure');
      return client.query(sql, params);
    }, release() {} };
  } };
  try {
    await client.query('BEGIN'); db.query = scoped.query; db.getPool = () => scoped;
    const alignment = fs.readFileSync(path.resolve(__dirname, '../db/migrations/040_clinical_encrypted_history.sql'), 'utf8');
    await client.query(alignment); await client.query(alignment);
    const constraints = (await client.query("SELECT convalidated FROM pg_constraint WHERE conname IN ('patient_allergies_recorded_content','patient_problems_recorded_content','patient_medications_recorded_content')")).rows;
    assert.equal(constraints.length, 3); assert.ok(constraints.every(row => row.convalidated === true));
    const patientId = crypto.randomUUID(), foreignPatientId = crypto.randomUUID(), providerId = crypto.randomUUID(), foreignProviderId = crypto.randomUUID(), adminId = crypto.randomUUID();
    for (const [id, role] of [[patientId, 'patient'], [foreignPatientId, 'patient'], [providerId, 'provider'], [foreignProviderId, 'provider'], [adminId, 'admin']]) await client.query(`INSERT INTO users
      (id,email,password_hash,role,first_name,last_name,market_scope,region,country,is_active,is_test_account,provider_status,must_change_password)
      VALUES($1,$2,'ISOLATED_CONTROL_NO_PASSWORD_LOGIN',$3,'Isolated','Profile control','US','US','US',TRUE,TRUE,'approved',FALSE)`, [id, 'profile-' + id + '@example.invalid', role]);
    const patient = { id: patientId, role: 'patient', marketScope: 'US' }, provider = { id: providerId, role: 'provider', marketScope: 'US' }, foreignProvider = { ...provider, id: foreignProviderId }, admin = { id: adminId, role: 'admin', marketScope: 'US' };
    for (const [actor, record] of [[providerId, patientId], [foreignProviderId, foreignPatientId]]) await client.query("INSERT INTO provider_patient_relationships(provider_id,patient_id,relationship_type,is_active) VALUES($1,$2,'treating',TRUE)", [actor, record]);
    const encounter = (await client.query("INSERT INTO clinical_encounters(patient_id,provider_id,encounter_type,encounter_start_time,status) VALUES($1,$2,'chart_review',NOW(),'in_progress') RETURNING id", [patientId, providerId])).rows[0];
    const foreignEncounter = (await client.query("INSERT INTO clinical_encounters(patient_id,provider_id,encounter_type,encounter_start_time,status) VALUES($1,$2,'chart_review',NOW(),'in_progress') RETURNING id", [foreignPatientId, foreignProviderId])).rows[0];
    const profile = await service.getOrCreateProfile(patientId, patient); assert.equal(profile.patientId, patientId);
    await service.updateProfile(patientId, { preferredPharmacyName: 'Recorded pharmacy' }, patientId, patient);
    assert.equal((await service.getOrCreateProfile(patientId, provider)).preferredPharmacyName, 'Recorded pharmacy');
    const allergyData = { allergen: 'Recorded allergy', allergenType: 'drug', reaction: 'Recorded reaction' };
    const medicationData = { medicationName: 'Recorded medication', dosage: '10 mg' };
    const allergy = await service.addAllergy(patientId, { ...allergyData, source: 'provider_documented' }, patientId, patient);
    assert.equal(allergy.source, 'patient_reported'); assert.equal(allergy.verifiedAt, null);
    const medication = await service.addMedication(patientId, { ...medicationData, source: 'provider_documented' }, patientId, patient); assert.equal(medication.source, 'patient_reported');
    await assert.rejects(service.addMedication(patientId, { ...medicationData, source: 'erx_import' }, patientId, patient), { code: 'CLINICAL_SOURCE_UNVERIFIED' });
    const problem = await service.addProblem(patientId, { problemDescription: 'Recorded diagnosis', encounterId: encounter.id }, providerId, provider);
    await assert.rejects(service.addProblem(patientId, { problemDescription: 'Wrong encounter', encounterId: foreignEncounter.id }, providerId, provider), { code: 'CLINICAL_ENCOUNTER_CONTEXT_DENIED' });
    const foreignAllergy = await service.addAllergy(foreignPatientId, allergyData, foreignProviderId, foreignProvider);
    const foreignMedication = await service.addMedication(foreignPatientId, medicationData, foreignProviderId, foreignProvider);
    const foreignProblem = await service.addProblem(foreignPatientId, { problemDescription: 'Foreign recorded diagnosis', encounterId: foreignEncounter.id }, foreignProviderId, foreignProvider);
    const legacyAllergy = (await client.query("INSERT INTO patient_allergies(patient_id,allergy_name,reaction) VALUES($1,'Recorded legacy allergen','Recorded legacy reaction') RETURNING id", [foreignPatientId])).rows[0];
    const legacyProblem = (await client.query("INSERT INTO patient_problems(patient_id,problem_name) VALUES($1,'Recorded legacy diagnosis') RETURNING id", [foreignPatientId])).rows[0];
    const legacyMedication = (await client.query("INSERT INTO patient_medications(patient_id,medication_name,dosage) VALUES($1,'Recorded legacy medication','Recorded legacy dosage') RETURNING id", [foreignPatientId])).rows[0];
    assert.equal((await service.getAllergies(foreignPatientId, false, foreignProvider)).find(row => row.id === legacyAllergy.id).allergen, 'Recorded legacy allergen');
    assert.equal((await service.getProblems(foreignPatientId, {}, foreignProvider)).find(row => row.id === legacyProblem.id).problemDescription, 'Recorded legacy diagnosis');
    assert.equal((await service.getMedications(foreignPatientId, false, foreignProvider)).find(row => row.id === legacyMedication.id).medicationName, 'Recorded legacy medication');
    const reads = [() => service.getOrCreateProfile(patientId, patient), () => service.getAllergies(patientId, false, patient),
      () => service.getProblems(patientId, {}, patient), () => service.getMedications(patientId, false, patient),
      () => service.getClinicalSummary(patientId, patientId, 'patient', patient)];
    const auditCount = async () => Number((await client.query("SELECT count(*) FROM audit_logs WHERE patient_id=$1 AND resource_type='patient_clinical_record'", [patientId])).rows[0].count);
    for (const read of reads) { const beforeRead = await auditCount(); await read(); assert.ok(await auditCount() > beforeRead, 'A successful clinical profile read commits its required audit'); }
    const beforeFailedReads = await auditCount(); failAudit = true;
    for (const read of reads) await assert.rejects(read(), { statusCode: 503, code: 'CLINICAL_AUDIT_UNAVAILABLE' });
    failAudit = false; assert.equal(await auditCount(), beforeFailedReads);
    for (const [table, id, field, read] of [
      ['patient_allergies', allergy.id, 'allergen', reads[1]], ['patient_allergies', allergy.id, 'reaction', reads[1]],
      ['patient_problems', problem.id, 'problem_description', reads[2]],
      ['patient_medications', medication.id, 'medication_name', reads[3]], ['patient_medications', medication.id, 'dosage', reads[3]],
    ]) {
      const tag = (await client.query('SELECT ' + field + '_tag AS tag FROM ' + table + ' WHERE id=$1', [id])).rows[0].tag;
      const beforeTamper = await auditCount();
      await client.query('UPDATE ' + table + ' SET ' + field + '_tag=$1 WHERE id=$2', ['0'.repeat(32), id]);
      await assert.rejects(read(), { statusCode: 503, code: 'CLINICAL_DECRYPTION_UNAVAILABLE' });
      await assert.rejects(reads[4](), { statusCode: 503, code: 'CLINICAL_DECRYPTION_UNAVAILABLE' });
      assert.equal(await auditCount(), beforeTamper, 'Damaged recorded content cannot be returned as a successful partial history');
      await client.query('UPDATE ' + table + ' SET ' + field + '_tag=$1 WHERE id=$2', [tag, id]);
      await read();
    }
    const counts = async () => {
      const tables = ['patient_clinical_profiles', 'patient_allergies', 'patient_problems', 'patient_medications']; const records = {};
      for (const table of tables) records[table] = (await client.query('SELECT * FROM ' + table + ' WHERE patient_id=ANY($1::uuid[]) ORDER BY id', [[patientId, foreignPatientId]])).rows;
      records.audits = (await client.query("SELECT * FROM audit_logs WHERE user_id=ANY($1::uuid[]) ORDER BY id", [[patientId, providerId, foreignProviderId]])).rows;
      return records;
    };
    const deniedReads = async actor => {
      for (const read of [() => service.getOrCreateProfile(patientId, actor), () => service.getAllergies(patientId, false, actor), () => service.getProblems(patientId, {}, actor), () => service.getMedications(patientId, false, actor), () => service.getClinicalSummary(patientId, actor.id, actor.role, actor)]) await assert.rejects(read(), { statusCode: 403 });
    };
    await deniedReads(admin); await deniedReads(foreignProvider); await deniedReads({ ...patient, id: foreignPatientId });
    for (const operation of [() => service.verifyAllergy(foreignAllergy.id, providerId, provider), () => service.inactivateAllergy(foreignAllergy.id, providerId, 'Foreign correction', provider),
      () => service.updateProblem(foreignProblem.id, { isActive: false }, providerId, provider), () => service.discontinueMedication(foreignMedication.id, providerId, 'Foreign correction', provider)]) await assert.rejects(operation(), { statusCode: 403 });
    for (const patch of ["role='admin'", 'is_active=FALSE', "provider_status='pending'", "market_scope='NG'"]) {
      await client.query('UPDATE users SET ' + patch + ' WHERE id=$1', [providerId]); await deniedReads(provider);
      await assert.rejects(service.verifyAllergy(allergy.id, providerId, provider), { statusCode: 403 });
      await client.query("UPDATE users SET role='provider',is_active=TRUE,provider_status='approved',market_scope='US' WHERE id=$1", [providerId]);
    }
    await client.query('UPDATE provider_patient_relationships SET is_active=FALSE WHERE provider_id=$1 AND patient_id=$2', [providerId, patientId]); await deniedReads(provider);
    await assert.rejects(service.updateProblem(problem.id, { priority: 'primary' }, providerId, provider), { code: 'CLINICAL_CARE_RELATIONSHIP_REQUIRED' });
    await client.query('UPDATE provider_patient_relationships SET is_active=TRUE WHERE provider_id=$1 AND patient_id=$2', [providerId, patientId]);
    await client.query('UPDATE users SET is_active=FALSE WHERE id=$1', [patientId]); await deniedReads(provider); await client.query('UPDATE users SET is_active=TRUE WHERE id=$1', [patientId]);
    await client.query("UPDATE users SET market_scope='NG' WHERE id=ANY($1::uuid[])", [[patientId, providerId]]); await deniedReads({ ...provider, marketScope: 'NG' });
    await client.query("UPDATE users SET market_scope='US' WHERE id=ANY($1::uuid[])", [[patientId, providerId]]);
    const snapshot = await counts();
    const changes = [() => service.updateProfile(patientId, { preferredPharmacyName: 'Must roll back' }, providerId, provider), () => service.verifyIdentity(patientId, 'document_review', providerId, provider),
      () => service.addAllergy(patientId, allergyData, providerId, provider), () => service.verifyAllergy(allergy.id, providerId, provider), () => service.inactivateAllergy(allergy.id, providerId, 'Protected clinical reason', provider),
      () => service.addProblem(patientId, { problemDescription: 'Must roll back' }, providerId, provider), () => service.updateProblem(problem.id, { priority: 'primary' }, providerId, provider),
      () => service.addMedication(patientId, medicationData, providerId, provider), () => service.discontinueMedication(medication.id, providerId, 'Protected clinical reason', provider)];
    failAudit = true;
    for (const change of changes) { await assert.rejects(change(), /Isolated clinical profile audit failure/); assert.deepEqual(await counts(), snapshot); }
    failAudit = false;
    assert.equal((await service.verifyIdentity(patientId, 'document_review', providerId, provider)).identityVerified, true);
    assert.ok((await service.verifyAllergy(allergy.id, providerId, provider)).verifiedAt);
    assert.equal((await service.updateProblem(problem.id, { priority: 'primary' }, providerId, provider)).priority, 'primary');
    assert.equal((await service.inactivateAllergy(allergy.id, providerId, 'Reviewed allergy correction', provider)).isActive, false);
    assert.equal((await service.discontinueMedication(medication.id, providerId, 'Reviewed medication correction', provider)).isActive, false);
    const summary = await service.getClinicalSummary(patientId, patientId, 'patient', patient); assert.equal(summary.profile.identityVerified, true); assert.equal(summary.problems.length, 1);
    assert.ok(!JSON.stringify((await client.query("SELECT new_values FROM audit_logs WHERE resource_type='patient_clinical_record' AND patient_id=$1", [patientId])).rows).includes('Reviewed medication correction'));

    const app = express(); app.use(express.json()); app.use('/api/clinical-encounters', require('../routes/clinicalEncounters'));
    server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    async function request(path, actor, method = 'GET', body) {
      const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/clinical-encounters' + path, { method,
        headers: { ...(actor ? { Authorization: 'Bearer ' + jwt.sign({ userId: actor.id }, process.env.JWT_ACCESS_SECRET, { expiresIn: '5m' }) } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() };
    }
    for (const suffix of ['profile', 'summary', 'allergies', 'problems', 'medications']) {
      assert.equal((await request('/patient/' + patientId + '/' + suffix, admin)).status, 403);
      assert.equal((await request('/patient/' + patientId + '/' + suffix, patient)).status, 200);
      assert.equal((await request('/patient/' + foreignPatientId + '/' + suffix, provider)).status, 403);
    }
    assert.equal((await request('/patient/' + patientId + '/profile')).status, 401);
    failAudit = true;
    for (const suffix of ['profile', 'summary', 'allergies', 'problems', 'medications']) {
      const failed = await request('/patient/' + patientId + '/' + suffix, patient);
      assert.equal(failed.status, 503); assert.equal(failed.body.code, 'CLINICAL_AUDIT_UNAVAILABLE');
      assert.equal(failed.body[suffix], undefined, 'A read without its required audit never releases clinical content');
    }
    failAudit = false;
    const originalTag = (await client.query('SELECT medication_name_tag FROM patient_medications WHERE id=$1', [medication.id])).rows[0].medication_name_tag;
    await client.query('UPDATE patient_medications SET medication_name_tag=$1 WHERE id=$2', ['0'.repeat(32), medication.id]);
    const corrupt = await request('/patient/' + patientId + '/medications?includeInactive=true', patient);
    assert.equal(corrupt.status, 503); assert.equal(corrupt.body.code, 'CLINICAL_DECRYPTION_UNAVAILABLE'); assert.equal(corrupt.body.medications, undefined);
    await client.query('UPDATE patient_medications SET medication_name_tag=$1 WHERE id=$2', [originalTag, medication.id]);
    for (const [path, method, body] of [['/allergies/' + allergy.id + '/verify', 'POST', {}], ['/allergies/' + allergy.id, 'DELETE', { reason: 'Self removal' }],
      ['/problems/' + problem.id, 'PUT', { isActive: false }], ['/medications/' + medication.id, 'DELETE', { reason: 'Self removal' }], ['/patient/' + patientId + '/verify-identity', 'POST', { method: 'document_review' }]]) assert.equal((await request(path, patient, method, body)).status, 403);
    assert.equal((await request('/allergies/' + foreignAllergy.id + '/verify', provider, 'POST', {})).status, 403);
    assert.equal((await request('/medications/' + foreignMedication.id, provider, 'DELETE', { reason: 'Foreign removal' })).status, 403);
    await client.query('UPDATE provider_patient_relationships SET is_active=FALSE WHERE provider_id=$1 AND patient_id=$2', [providerId, patientId]);
    assert.equal((await request('/patient/' + patientId + '/profile', provider)).status, 403);
    assert.equal((await request('/allergies/' + allergy.id + '/verify', provider, 'POST', {})).status, 403);
    assert.ok(!JSON.stringify(await counts()).includes('Must roll back'));
    assert.equal((await request('/allergies/not-a-uuid/verify', provider, 'POST', {})).status, 400);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve)); db.query = oldQuery; db.getPool = oldPool; Object.assign(logger, logging);
    if (oldSecret === undefined) delete process.env.JWT_ACCESS_SECRET; else process.env.JWT_ACCESS_SECRET = oldSecret;
    await client.query('ROLLBACK'); client.release(); await pool.end();
  }
});
