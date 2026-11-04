'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const service = require('../services/eRxIntegrationService');
const db = require('../db');
const { decrypt } = require('../../lib/encryption');

test('unconnected eRx handoff/callback and malformed draft references never touch storage', async () => {
  const originalQuery = db.query; const originalPool = db.getPool; let calls = 0;
  db.query = async () => { calls++; throw new Error('Storage must not be reached'); };
  db.getPool = () => { calls++; throw new Error('Storage must not be reached'); };
  try {
    await assert.rejects(service.initiateERxHandoff(crypto.randomUUID(), crypto.randomUUID(), 'iprescribe'), { statusCode: 503, code: 'ERX_ADAPTER_NOT_ACTIVATED' });
    await assert.rejects(service.processERxCallback(crypto.randomUUID(), { status: 'dispensed', externalRxId: 'caller-invented' }), { statusCode: 503, code: 'ERX_CALLBACK_NOT_ACTIVATED' });
    await assert.rejects(service.createPrescriptionIntent({ encounterId: 'invalid', patientId: crypto.randomUUID() }, crypto.randomUUID()), { statusCode: 400, code: 'PRESCRIPTION_REFERENCE_INVALID' });
    await assert.rejects(service.updatePrescriptionIntent('invalid', crypto.randomUUID(), { quantity: 2 }), { statusCode: 400, code: 'PRESCRIPTION_REFERENCE_INVALID' });
    await assert.rejects(service.cancelPrescriptionIntent('invalid', crypto.randomUUID(), 'Clinical correction'), { statusCode: 400, code: 'PRESCRIPTION_REFERENCE_INVALID' });
    for (const reason of [undefined, '', '   ', {}, 'x'.repeat(2001)]) await assert.rejects(service.cancelPrescriptionIntent(crypto.randomUUID(), crypto.randomUUID(), reason), { statusCode: 400, code: 'PRESCRIPTION_CANCELLATION_REASON_INVALID' });
    for (const changes of [undefined, [], {}, { patientId: crypto.randomUUID() }, { rationale: {} }]) await assert.rejects(service.updatePrescriptionIntent(crypto.randomUUID(), crypto.randomUUID(), changes), { statusCode: 400, code: 'PRESCRIPTION_UPDATE_INVALID' });
    assert.equal(calls, 0);
  } finally { db.query = originalQuery; db.getPool = originalPool; }
});

test('prescription cancellation HTTP preserves sign-in/provider gates and returns safe validation, context, immutable and outage errors', async () => {
  let actor; let failure; let calls = 0;
  const dependencies = {
    express, zod: require('zod'), '../db': {},
    '../../lib/validation': require('../../lib/validation'), '../../lib/utils': require('../../lib/utils'),
    '../middleware/logger': { error() {} },
    '../middleware/auth': {
      authenticate(req, res, next) { if (!actor) return res.status(401).json({ success: false }); req.user = actor; next(); },
      requireRole(...roles) { return (req, res, next) => roles.includes(req.user?.role) ? next() : res.status(403).json({ success: false }); },
      canAccessPatient: (_req, _res, next) => next(),
    },
    '../middleware/audit': { auditMiddleware: () => (_req, _res, next) => next(), auditPhiAccess: () => (_req, _res, next) => next() },
    '../services/clinicalEncounterService': {}, '../services/patientClinicalProfileService': {}, '../services/telehealthConsentService': {},
    '../../ng/services/rx-engine/privatePrescriptionUploadService': {},
    '../services/eRxIntegrationService': { async cancelPrescriptionIntent(id, providerId, reason) {
      calls++; if (failure) throw failure;
      assert.equal(id, intentId); assert.equal(providerId, actor.id); assert.equal(reason, 'Clinical correction');
      return { id, providerId, status: 'cancelled' };
    } },
  };
  const sourceModule = { exports: {} }; const filename = path.resolve(__dirname, '../routes/clinicalEncounters.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: sourceModule, exports: sourceModule.exports,
    require(name) { assert.ok(name in dependencies, 'Unexpected clinical route dependency ' + name); return dependencies[name]; },
  }, { filename });
  const app = express(); app.use(express.json()); app.use('/api/clinical-encounters', sourceModule.exports);
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const intentId = crypto.randomUUID();
  const request = async () => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/clinical-encounters/prescription-intents/' + intentId + '/cancel', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Clinical correction' }),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await request()).status, 401);
    for (const role of ['patient', 'admin', 'super_admin', 'pharmacy']) {
      actor = { id: crypto.randomUUID(), role };
      assert.equal((await request()).status, 403);
    }
    assert.equal(calls, 0);
    actor = { id: crypto.randomUUID(), role: 'provider' };
    for (const statusCode of [400, 403, 404, 409, 503, 500]) {
      failure = Object.assign(new Error('Sensitive medication and database details'), { statusCode, code: statusCode === 500 ? 'INTERNAL_SECRET' : 'PRESCRIPTION_CONTEXT_DENIED' });
      const response = await request();
      assert.equal(response.status, statusCode === 500 ? 503 : statusCode);
      assert.equal(response.body.success, false);
      assert.ok(!JSON.stringify(response.body).includes('Sensitive medication'));
      assert.ok(!JSON.stringify(response.body).includes('INTERNAL_SECRET'));
      assert.equal(response.body.prescriptionIntent, undefined);
    }
    failure = null;
    const response = await request();
    assert.equal(response.status, 200); assert.equal(response.body.prescriptionIntent.status, 'cancelled');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

const target = process.env.SIMULATION_DATABASE_URL;
test('PostgreSQL modern draft binds current patient, clinician, market and appointment atomically without changing existing demo accounts', { skip: !target }, async () => {
  const url = new URL(target);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'), 'Use only an isolated loopback database ending in _test');
  const { Pool } = require('pg'); const pool = new Pool({ connectionString: target }); const client = await pool.connect();
  const originalQuery = db.query; const originalPool = db.getPool; let serial = 0; let failAudit = false;
  const routePool = { query: (...args) => client.query(...args), async connect() {
    const point = 'erx_' + (++serial);
    return { async query(sql, parameters) {
      if (sql === 'BEGIN') return client.query('SAVEPOINT ' + point);
      if (sql === 'COMMIT') return client.query('RELEASE SAVEPOINT ' + point);
      if (sql === 'ROLLBACK') { await client.query('ROLLBACK TO SAVEPOINT ' + point); return client.query('RELEASE SAVEPOINT ' + point); }
      if (failAudit && sql.includes('INSERT INTO audit_logs')) throw new Error('Isolated audit failure');
      return client.query(sql, parameters);
    }, release() {} };
  } };
  try {
    await client.query('BEGIN'); db.query = routePool.query; db.getPool = () => routePool;
    const patientId = crypto.randomUUID(); const otherPatientId = crypto.randomUUID(); const providerId = crypto.randomUUID(); const otherProviderId = crypto.randomUUID(); const adminId = crypto.randomUUID();
    for (const [id, role] of [[patientId, 'patient'], [otherPatientId, 'patient'], [providerId, 'provider'], [otherProviderId, 'provider'], [adminId, 'admin']]) await client.query(`INSERT INTO users
      (id,email,password_hash,role,first_name,last_name,market_scope,region,country,is_active,is_test_account,provider_status)
      VALUES ($1,$2,'ISOLATED_CONTROL_NO_PASSWORD_LOGIN',$3,'Isolated','Intent control','US','US','US',TRUE,TRUE,'approved')`, [id, 'intent-' + id + '@example.invalid', role]);
    const ngPatient = (await client.query("SELECT id FROM users WHERE email='patient@demo.doctarx.com' AND role='patient' AND market_scope='NG'")).rows[0];
    assert.ok(ngPatient, 'Reuse the existing NG patient as a cross-market control');
    const appointmentId = crypto.randomUUID();
    await client.query("INSERT INTO appointments (id,patient_id,provider_id,scheduled_at,status) VALUES ($1,$2,$3,NOW()+INTERVAL '1 day','confirmed')", [appointmentId, patientId, providerId]);
    const encounters = [];
    for (const [patient, provider, appointment] of [[patientId, providerId, appointmentId], [otherPatientId, providerId, appointmentId], [patientId, otherProviderId, null], [ngPatient.id, providerId, null], [patientId, adminId, null]]) {
      const result = await client.query("INSERT INTO clinical_encounters (patient_id,provider_id,appointment_id,encounter_type,encounter_start_time,status) VALUES ($1,$2,$3,'chart_review',NOW(),'in_progress') RETURNING id", [patient, provider, appointment]);
      encounters.push(result.rows[0].id);
    }
    const draft = { encounterId: encounters[0], patientId, medicationName: 'Isolated clinical draft', dosageStrength: '10 mg', dosageForm: 'tablet', quantity: 1, daysSupply: 1, indication: 'Isolated test context', sigDirections: 'Test-only instruction' };
    const count = async () => Number((await client.query('SELECT count(*) AS count FROM prescription_intents WHERE provider_id=ANY($1::uuid[])', [[providerId, otherProviderId, adminId]])).rows[0].count);
    assert.equal(await count(), 0);
    for (const [input, actor] of [
      [{ ...draft, patientId: otherPatientId }, providerId],
      [{ ...draft, encounterId: encounters[1], patientId: otherPatientId }, providerId],
      [{ ...draft, encounterId: encounters[2] }, providerId],
      [{ ...draft, encounterId: encounters[3], patientId: ngPatient.id }, providerId],
      [{ ...draft, encounterId: encounters[4] }, adminId],
    ]) { await assert.rejects(service.createPrescriptionIntent(input, actor), error => error.statusCode === 403); assert.equal(await count(), 0); }
    await client.query("UPDATE users SET provider_status='pending' WHERE id=$1", [providerId]);
    await assert.rejects(service.createPrescriptionIntent(draft, providerId), { code: 'PRESCRIPTION_CONTEXT_DENIED' });
    await client.query("UPDATE users SET provider_status='approved' WHERE id=$1", [providerId]);
    failAudit = true; await assert.rejects(service.createPrescriptionIntent(draft, providerId), /Isolated audit failure/); assert.equal(await count(), 0); failAudit = false;
    const saved = await service.createPrescriptionIntent(draft, providerId);
    assert.equal(saved.patientId, patientId); assert.equal(saved.providerId, providerId); assert.equal(saved.encounterId, encounters[0]); assert.equal(saved.status, 'draft'); assert.equal(await count(), 1);
    const audit = (await client.query("SELECT new_values FROM audit_logs WHERE resource_type='prescription_intent' AND resource_id=$1", [saved.id])).rows;
    assert.equal(audit.length, 1); assert.deepEqual(audit[0].new_values, { encounterId: encounters[0], status: 'draft' });
    await assert.rejects(service.initiateERxHandoff(saved.id, providerId), { statusCode: 503 });
    await assert.rejects(service.processERxCallback(saved.id, { status: 'sent', externalRxId: 'unverified' }), { statusCode: 503 });
    const unchanged = (await client.query('SELECT status,external_erx_id,external_erx_sent_at FROM prescription_intents WHERE id=$1', [saved.id])).rows[0];
    assert.deepEqual(unchanged, { status: 'draft', external_erx_id: null, external_erx_sent_at: null });
    // Every modern reader uses fresh actor/market and exact encounter lineage.
    // Unsupported authenticated roles can no longer fall through to all rows.
    for (const role of ['admin', 'super_admin', 'pharmacy', 'government_analyst']) {
      await assert.rejects(service.getEncounterPrescriptionIntents(encounters[0], adminId, role), { statusCode: 403 });
      await assert.rejects(service.getPrescriptionIntent(saved.id, adminId, role), { statusCode: 403 });
    }
    assert.equal((await service.getPrescriptionIntent(saved.id, patientId, 'patient')).id, saved.id);
    assert.equal((await service.getPrescriptionIntent(saved.id, providerId, 'provider')).id, saved.id);
    assert.equal(await service.getPrescriptionIntent(saved.id, otherPatientId, 'patient'), null);
    assert.equal(await service.getPrescriptionIntent(saved.id, otherProviderId, 'provider'), null);
    assert.deepEqual(await service.getEncounterPrescriptionIntents(encounters[0], otherProviderId, 'provider'), []);
    assert.deepEqual(await service.getEncounterPrescriptionIntents(encounters[0], ngPatient.id, 'patient'), []);
    const poisoned = (await client.query(`INSERT INTO prescription_intents
      (encounter_id,patient_id,provider_id,medication_name,dosage_strength,dosage_form,quantity,days_supply,indication,sig_directions)
      SELECT encounter_id,$2,provider_id,medication_name,dosage_strength,dosage_form,quantity,days_supply,indication,sig_directions
      FROM prescription_intents WHERE id=$1 RETURNING id`, [saved.id, otherPatientId])).rows[0];
    assert.equal(await service.getPrescriptionIntent(poisoned.id, otherPatientId, 'patient'), null);
    assert.equal(await service.getPrescriptionIntent(poisoned.id, providerId, 'provider'), null);
    assert.deepEqual((await service.getProviderPrescriptionIntents(providerId)).map(row => row.id), [saved.id]);
    assert.deepEqual((await service.getPatientPrescriptionIntents(patientId)).map(row => row.id), [saved.id]);
    await client.query("UPDATE users SET role='admin' WHERE id=$1", [providerId]);
    await assert.rejects(service.getProviderPrescriptionIntents(providerId), { statusCode: 403 });
    await client.query("UPDATE users SET role='provider',is_active=FALSE WHERE id=$1", [providerId]);
    await assert.rejects(service.getProviderPrescriptionIntents(providerId), { statusCode: 403 });
    assert.equal((await service.getPrescriptionIntent(saved.id, patientId, 'patient')).id, saved.id, 'Patients retain their clinical record when its clinician is inactive');
    await client.query('UPDATE users SET is_active=TRUE WHERE id=$1', [providerId]);

    // Cancellation and edits must revalidate the same current authority as creation,
    // even when an old row still records the caller as its provider.
    const snapshot = async id => ({
      record: (await client.query('SELECT * FROM prescription_intents WHERE id=$1', [id])).rows[0] || null,
      audits: (await client.query("SELECT id,new_values FROM audit_logs WHERE resource_type='prescription_intent' AND resource_id=$1 ORDER BY id", [id])).rows,
    });
    const deniedBoth = async (id, actor = providerId, code = 'PRESCRIPTION_CONTEXT_DENIED') => {
      const before = await snapshot(id);
      await assert.rejects(service.updatePrescriptionIntent(id, actor, { medicationName: 'Must not persist' }), { code });
      await assert.rejects(service.cancelPrescriptionIntent(id, actor, 'Must not cancel'), { code });
      assert.deepEqual(await snapshot(id), before, 'Denied edits/cancellation do not change the record or append a success audit');
    };
    const copyIntent = async (encounterId, patient, provider = providerId) => (await client.query(`INSERT INTO prescription_intents
      (encounter_id,patient_id,provider_id,medication_name,dosage_strength,dosage_form,quantity,days_supply,indication,sig_directions,status)
      SELECT $2,$3,$4,medication_name,dosage_strength,dosage_form,quantity,days_supply,indication,sig_directions,'draft'
      FROM prescription_intents WHERE id=$1 RETURNING id`, [saved.id, encounterId, patient, provider])).rows[0].id;
    await deniedBoth(crypto.randomUUID());
    await deniedBoth(saved.id, otherProviderId);
    await deniedBoth(poisoned.id);
    await deniedBoth(await copyIntent(encounters[2], patientId));
    await deniedBoth(await copyIntent(encounters[3], ngPatient.id));
    await deniedBoth(await copyIntent(encounters[1], otherPatientId), providerId, 'PRESCRIPTION_APPOINTMENT_MISMATCH');
    for (const patch of ["role='admin'", 'is_active=FALSE', "provider_status='pending'", "market_scope='NG'"]) {
      await client.query('UPDATE users SET ' + patch + ' WHERE id=$1', [providerId]);
      await deniedBoth(saved.id);
      await client.query("UPDATE users SET role='provider',is_active=TRUE,provider_status='approved',market_scope='US' WHERE id=$1", [providerId]);
    }
    await client.query('UPDATE users SET is_active=FALSE WHERE id=$1', [patientId]);
    await deniedBoth(saved.id);
    await client.query('UPDATE users SET is_active=TRUE WHERE id=$1', [patientId]);
    await client.query("UPDATE users SET market_scope='NG' WHERE id=ANY($1::uuid[])", [[patientId, providerId]]);
    await deniedBoth(saved.id); // Current NG credentials also require a verified provider profile.
    await client.query("UPDATE users SET market_scope='US' WHERE id=ANY($1::uuid[])", [[patientId, providerId]]);
    await client.query("UPDATE appointments SET status='cancelled' WHERE id=$1", [appointmentId]);
    await deniedBoth(saved.id, providerId, 'PRESCRIPTION_APPOINTMENT_MISMATCH');
    await client.query("UPDATE appointments SET status='confirmed' WHERE id=$1", [appointmentId]);
    await client.query("UPDATE clinical_encounters SET status='cancelled' WHERE id=$1", [encounters[0]]);
    await deniedBoth(saved.id);
    await client.query("UPDATE clinical_encounters SET status='in_progress' WHERE id=$1", [encounters[0]]);
    for (const patch of ["status='sent'", "status='cancelled'", "external_erx_id='recorded-partner-id'", 'external_erx_sent_at=NOW()', "external_erx_status='signed'"]) {
      await client.query('UPDATE prescription_intents SET ' + patch + ' WHERE id=$1', [saved.id]);
      await deniedBoth(saved.id, providerId, 'PRESCRIPTION_IMMUTABLE');
      await client.query("UPDATE prescription_intents SET status='draft',external_erx_id=NULL,external_erx_sent_at=NULL,external_erx_status=NULL WHERE id=$1", [saved.id]);
    }
    const beforeFailure = await snapshot(saved.id);
    failAudit = true;
    try {
      await assert.rejects(service.updatePrescriptionIntent(saved.id, providerId, { medicationName: 'Must roll back', rationale: 'Protected rationale' }), /Isolated audit failure/);
      assert.deepEqual(await snapshot(saved.id), beforeFailure);
      await assert.rejects(service.cancelPrescriptionIntent(saved.id, providerId, 'Must roll back'), /Isolated audit failure/);
      assert.deepEqual(await snapshot(saved.id), beforeFailure);
    } finally { failAudit = false; }
    const updated = await service.updatePrescriptionIntent(saved.id, providerId, { quantity: 2, rationale: 'Protected revised clinical rationale', patientId: otherPatientId, status: 'sent' });
    assert.equal(updated.quantity, 2); assert.equal(updated.patientId, patientId); assert.equal(updated.status, 'draft');
    assert.equal((await service.getPrescriptionIntent(saved.id, providerId, 'provider')).rationale, 'Protected revised clinical rationale');
    const updateAudit = (await snapshot(saved.id)).audits.find(row => row.new_values.changedFields);
    assert.deepEqual(updateAudit.new_values, { encounterId: encounters[0], status: 'draft', changedFields: ['quantity', 'rationale'] });
    assert.ok(!JSON.stringify(updateAudit).includes('Protected revised clinical rationale'));
    const cancelled = await service.cancelPrescriptionIntent(saved.id, providerId, '  Corrected after clinical review  ');
    assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.patientId, patientId);
    const cancelAudit = (await snapshot(saved.id)).audits.find(row => row.new_values.status === 'cancelled');
    assert.ok(cancelAudit);
    const reason = cancelAudit.new_values.cancellationReasonEncrypted;
    assert.equal(decrypt(reason.encrypted, reason.iv, reason.tag), 'Corrected after clinical review');
    assert.ok(!JSON.stringify(cancelAudit).includes('Corrected after clinical review'));
    await deniedBoth(saved.id, providerId, 'PRESCRIPTION_IMMUTABLE');
    const pending = await copyIntent(encounters[0], patientId);
    await client.query("UPDATE prescription_intents SET status='pending_erx' WHERE id=$1", [pending]);
    await assert.rejects(service.updatePrescriptionIntent(pending, providerId, { quantity: 2 }), { code: 'PRESCRIPTION_IMMUTABLE' });
    assert.equal((await service.cancelPrescriptionIntent(pending, providerId, 'Unsent draft no longer needed')).status, 'cancelled');
  } finally {
    db.query = originalQuery; db.getPool = originalPool;
    await client.query('ROLLBACK'); client.release(); await pool.end();
  }
});
