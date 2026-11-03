'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const service = require('../services/pharmacy/clinicalInboxService');
const { createBrowserFixture } = require('./helpers/medication-delivery-fixture');
const target = process.env.SIMULATION_DATABASE_URL;
const pause = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('PostgreSQL clinical inbox authority, rerouting and audit rollback are transactional', { skip: !target }, async t => {
  const url = new URL(target); assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'), 'Use only an explicitly disposable loopback test database.');
  const previous = { NODE_ENV: process.env.NODE_ENV, ENCRYPTION_KEY: process.env.ENCRYPTION_KEY }; process.env.NODE_ENV = 'test';
  const pool = new Pool({ connectionString: target, max: 8 });
  try {
    const f = await createBrowserFixture({ pool }); const other = await createBrowserFixture({ pool });
    await pool.query("UPDATE ng_digital_prescriptions SET pharmacy_response_status='pending_pharmacy_confirmation',confirmed_price_ngn=1234.50,pharmacy_notes='Isolated private note' WHERE id=$1", [f.prescriptionId]);
    await pool.query("INSERT INTO ng_whatsapp_notification_log(prescription_id,pharmacy_id,message_preview,status,metadata) VALUES($1,$2,'Isolated medication notification','manual_fallback_pending','{\"providerError\":\"not-for-client\"}')", [f.prescriptionId, f.pharmacyId]);
    const rows = await service.listPrescriptions(pool, f.pharmacist, f.pharmacyId); assert.ok(rows.some(row => row.id === f.prescriptionId), 'A signed explicitly routed Rx remains visible even without a legacy provider profile ID.');
    const notifications = await service.listNotifications(pool, f.pharmacist, f.pharmacyId); assert.equal(notifications.length, 1); assert.equal(notifications[0].metadata, undefined);
    const updated = await service.updateStatus(pool, f.pharmacist, f.pharmacyId, f.prescriptionId, { status: 'accepted' });
    assert.equal(updated.prescription.confirmed_price_ngn, '1234.50'); assert.equal(updated.prescription.pharmacy_notes, 'Isolated private note');

    await t.test('failed compliance writes roll status and notes back instead of returning success', async () => {
      const failing = { async connect() { const client = await pool.connect(); return { release: () => client.release(), query(sql, values) { if (sql.includes('INSERT INTO ng_compliance_audit_log')) throw new Error('Isolated unavailable clinical audit'); return client.query(sql, values); } }; } };
      await assert.rejects(service.updateStatus(failing, f.pharmacist, f.pharmacyId, f.prescriptionId, { status: 'unavailable', pharmacyNotes: 'Should roll back' }), /Isolated unavailable/);
      const rx = (await pool.query('SELECT pharmacy_response_status,pharmacy_notes FROM ng_digital_prescriptions WHERE id=$1', [f.prescriptionId])).rows[0];
      assert.deepEqual(rx, { pharmacy_response_status: 'accepted', pharmacy_notes: 'Isolated private note' });
      await assert.rejects(service.listPrescriptions(failing, f.pharmacist, f.pharmacyId), /Isolated unavailable/);
      await assert.rejects(service.listNotifications(failing, f.pharmacist, f.pharmacyId), /Isolated unavailable/);
    });
    await t.test('in-flight PHI read holds pharmacy authority through data access and audit commit', async () => {
      const atData = pause(); const proceed = pause();
      const paused = { async connect() { const client = await pool.connect(); return { release: () => client.release(), async query(sql, values) { if (sql.includes('FROM ng_digital_prescriptions rx')) { atData.resolve(); await proceed.promise; } return client.query(sql, values); } }; } };
      const reading = service.listPrescriptions(paused, f.pharmacist, f.pharmacyId); let suspending;
      try {
        await Promise.race([atData.promise, reading]); let changed = false;
        suspending = pool.query("UPDATE ng_pharmacies SET account_status='suspended' WHERE id=$1", [f.pharmacyId]).then(value => { changed = true; return value; });
        await new Promise(resolve => setTimeout(resolve, 75)); assert.equal(changed, false, 'Revocation cannot commit between authorization and PHI disclosure.');
        proceed.resolve(); assert.ok((await reading).some(row => row.id === f.prescriptionId)); await suspending;
        await assert.rejects(service.listPrescriptions(pool, f.pharmacist, f.pharmacyId), error => error.status === 403);
      } finally { proceed.resolve(); await Promise.allSettled([reading, suspending].filter(Boolean)); }
      await pool.query("UPDATE ng_pharmacies SET account_status='active' WHERE id=$1", [f.pharmacyId]);
    });
    await t.test('current user-account revocation is checked after the row lock, despite a stale session', async () => {
      const revoker = await pool.connect(); let reading;
      try {
        await revoker.query('BEGIN'); await revoker.query("UPDATE users SET account_status='suspended' WHERE id=$1", [f.pharmacist.id]);
        let settled = false;
        reading = service.listNotifications(pool, f.pharmacist, f.pharmacyId).then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
        await new Promise(resolve => setTimeout(resolve, 75)); assert.equal(settled, false);
        await revoker.query('COMMIT'); assert.equal((await reading).error.status, 403);
      } finally { await revoker.query('ROLLBACK'); revoker.release(); if (reading) await reading; }
      await pool.query("UPDATE users SET account_status='active' WHERE id=$1", [f.pharmacist.id]);
    });
    await t.test('rerouting while a response waits revokes both write authority and old notification PHI access', async () => {
      const rerouter = await pool.connect(); let response;
      try {
        await rerouter.query('BEGIN'); await rerouter.query('UPDATE ng_digital_prescriptions SET routed_pharmacy_id=$1 WHERE id=$2', [other.pharmacyId, f.prescriptionId]);
        let settled = false;
        response = service.updateStatus(pool, f.pharmacist, f.pharmacyId, f.prescriptionId, { status: 'unavailable' }).then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
        await new Promise(resolve => setTimeout(resolve, 75)); assert.equal(settled, false);
        await rerouter.query('COMMIT'); assert.equal((await response).error.status, 404);
      } finally { await rerouter.query('ROLLBACK'); rerouter.release(); if (response) await response; }
      assert.deepEqual(await service.listPrescriptions(pool, f.pharmacist, f.pharmacyId), []);
      assert.deepEqual(await service.listNotifications(pool, f.pharmacist, f.pharmacyId), []);
      assert.ok((await service.listPrescriptions(pool, other.pharmacist, other.pharmacyId)).some(row => row.id === f.prescriptionId));
      assert.equal((await pool.query('SELECT pharmacy_response_status FROM ng_digital_prescriptions WHERE id=$1', [f.prescriptionId])).rows[0].pharmacy_response_status, 'accepted');
    });
    await t.test('cancellation and completion responses cannot reopen or bypass real dispensing', async () => {
      await assert.rejects(service.updateStatus(pool, other.pharmacist, other.pharmacyId, f.prescriptionId, { status: 'fulfilled' }), error => error.status === 409);
      await service.updateStatus(pool, other.pharmacist, other.pharmacyId, f.prescriptionId, { status: 'cancelled' });
      await assert.rejects(service.updateStatus(pool, other.pharmacist, other.pharmacyId, f.prescriptionId, { status: 'accepted' }), error => error.status === 409);
      const audit = (await pool.query("SELECT details FROM ng_compliance_audit_log WHERE resource_id=$1 AND action='pharmacy.prescription_status_updated'", [f.prescriptionId])).rows;
      assert.equal(audit.length, 2); assert.doesNotMatch(JSON.stringify(audit), /Isolated private note|Should roll back/);
    });
    // Retain append-only evidence and only synthetic accounts in the disposable
    // database. Never reset or delete provisioned accounts or real patient data.
  } finally {
    await pool.end(); for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
