'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const service = require('../services/clinical/manualReferralIntentService');
const target = process.env.SIMULATION_DATABASE_URL;
const status = expected => error => error.statusCode === expected;
const noBoundary = client => ({ query: (sql, params) => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) ? Promise.resolve({ rows: [] }) : client.query(sql, params), release() {} });

// No fallback connection: never run fixture mutations against a non-test host.
test('PostgreSQL manual referral intent locks, receipts, rollback and current authority', { skip: !target }, async () => {
  const url = new URL(target);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'), 'Only isolated loopback *_test databases are accepted');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: target, statement_timeout: 15000 });
  const first = await pool.connect(), second = await pool.connect();
  const keys = Array.from({ length: 4 }, () => crypto.randomUUID());
  const appointmentId = crypto.randomUUID();
  let provider, patient, pending;
  try {
    provider = (await pool.query("SELECT u.id,p.id AS provider_id FROM users u JOIN ng_providers p ON p.user_id=u.id WHERE u.email='doctor@demo.doctarx.com' AND u.role='provider' AND u.is_active=true AND u.market_scope='NG' AND u.provider_status='approved' AND p.status='verified'")).rows[0];
    patient = (await pool.query("SELECT id FROM users WHERE email='patient@demo.doctarx.com' AND role='patient' AND is_active=true AND market_scope='NG'")).rows[0];
    assert.ok(provider && patient, 'Provision the existing demo clinician and patient before running this test; no accounts or credentials are seeded');
    await pool.query("INSERT INTO ng_appointments(id,patient_user_id,provider_id,scheduled_at,status,consult_fee,total_amount) VALUES($1,$2,$3,'2099-06-15T12:00:00Z','confirmed',0,0)", [appointmentId, patient.id, provider.provider_id]);
    const req = { user: { id: provider.id, role: 'provider' }, headers: { 'idempotency-key': keys[0] }, body: { patient_user_id: patient.id, reason: 'Synthetic manual referral concurrency fixture', clinical_notes: 'Synthetic fixture only', target_name: 'Synthetic test destination' } };
    await first.query('BEGIN');
    const saved = await service.save({ connect: async () => noBoundary(first) }, req);
    await assert.rejects(service.receipt(pool, req, keys[0]), status(404));
    const pid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    pending = service.save({ connect: async () => ({ query: (sql, params) => second.query(sql, params), release() {} }) }, req);
    pending.catch(() => {});
    let blocked = false;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const locks = await pool.query("SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted AND locktype='transactionid'", [pid]);
      if (locks.rows.length) { blocked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(blocked, true, 'A same-key INSERT must wait on the uncommitted unique-index contender');
    await first.query('COMMIT');
    assert.deepEqual(await pending, saved); pending = null;
    assert.deepEqual(await service.receipt(pool, req, keys[0]), saved);
    assert.deepEqual(Object.keys(saved).sort(), ['id', 'status'], 'Receipt exposes metadata only');
    await assert.rejects(service.receipt(pool, { ...req, user: { id: patient.id, role: 'patient' } }, keys[0]), status(404));
    const beforeConflict = (await pool.query("SELECT count(*) FROM ng_audit_lineage WHERE resource_type='manual_referral_request' AND resource_id=$1", [saved.id])).rows[0].count;
    await assert.rejects(service.save(pool, { ...req, body: { ...req.body, reason: 'Different synthetic intent' } }), status(409));
    assert.equal((await pool.query("SELECT count(*) FROM ng_audit_lineage WHERE resource_type='manual_referral_request' AND resource_id=$1", [saved.id])).rows[0].count, beforeConflict, 'Conflict must not emit success audit');
    await pool.query("UPDATE ng_referrals SET status='completed' WHERE id=$1", [saved.id]);
    assert.equal((await service.save(pool, req)).status, 'completed');
    assert.equal((await service.receipt(pool, req, keys[0])).status, 'completed');
    const distinct = await service.save(pool, { ...req, headers: { 'idempotency-key': keys[1] } });
    assert.notEqual(distinct.id, saved.id, 'A deliberate new key remains a distinct referral even for identical content');
    assert.equal((await pool.query('SELECT count(*) FROM ng_referrals WHERE provider_user_id=$1 AND manual_request_key=$2', [provider.id, keys[0]])).rows[0].count, '1');
    const audits = (await pool.query("SELECT action,metadata_json FROM ng_audit_lineage WHERE resource_type='manual_referral_request' AND resource_id=$1", [saved.id])).rows;
    assert.ok(audits.length);
    assert.ok(audits.some(audit => audit.action === 'submit'), 'Actual PostgreSQL accepts a submission audit for the saved request');
    assert.ok(audits.some(audit => audit.action === 'view'), 'Receipt reads retain their view audit');
    for (const audit of audits) {
      assert.ok(['submit', 'view'].includes(audit.action), 'Use the existing constrained audit vocabulary');
      assert.deepEqual(audit.metadata_json, { requestId: keys[0] }, 'Audit stores no referral narrative');
    }

    // A real service transaction must roll back its insert if the audit cannot be written.
    const brokenAuditPool = { connect: async () => {
      const client = await pool.connect();
      return { query: (sql, params) => sql.includes('INSERT INTO ng_audit_lineage') ? Promise.reject(new Error('Synthetic audit failure')) : client.query(sql, params), release: () => client.release() };
    } };
    await assert.rejects(service.save(brokenAuditPool, { ...req, headers: { 'idempotency-key': keys[2] } }), /Synthetic audit failure/);
    assert.equal((await pool.query('SELECT count(*) FROM ng_referrals WHERE provider_user_id=$1 AND manual_request_key=$2', [provider.id, keys[2]])).rows[0].count, '0');
    await assert.rejects(service.receipt(pool, req, keys[2]), status(404));

    // Account changes below are visible only in this transaction, then rolled back.
    await first.query('BEGIN');
    const scoped = { connect: async () => noBoundary(first) };
    for (const [sql, params] of [
      ['UPDATE users SET is_active=false WHERE id=$1', [provider.id]],
      ["UPDATE users SET market_scope='US' WHERE id=$1", [provider.id]],
      ["UPDATE users SET provider_status='pending' WHERE id=$1", [provider.id]],
      ["UPDATE ng_providers SET status='pending' WHERE id=$1", [provider.provider_id]],
      ['UPDATE users SET is_active=false WHERE id=$1', [patient.id]],
      ["UPDATE users SET market_scope='US' WHERE id=$1", [patient.id]],
    ]) {
      await first.query('SAVEPOINT revoke');
      await first.query(sql, params);
      await assert.rejects(service.save(scoped, req), status(403));
      await assert.rejects(service.receipt(scoped, req, keys[0]), status(403));
      await first.query('ROLLBACK TO SAVEPOINT revoke');
    }
    await assert.rejects(service.save(scoped, { ...req, user: { ...req.user, role: 'patient' } }), status(403));
    await assert.rejects(service.save(scoped, { ...req, body: { ...req.body, encounter_id: crypto.randomUUID() } }), status(403));
    const encounterId = crypto.randomUUID();
    await first.query('INSERT INTO ng_clinical_encounters(id,patient_user_id,provider_user_id) VALUES($1,$2,NULL)', [encounterId, patient.id]);
    await assert.rejects(service.save(scoped, { ...req, body: { ...req.body, encounter_id: encounterId } }), status(403));
    // Removing all authority alternatives inside a rollback-only transaction
    // proves that the receipt is not a durable authorization grant.
    await first.query('UPDATE ng_appointments SET patient_user_id=$3 WHERE patient_user_id=$1 AND provider_id=$2', [patient.id, provider.provider_id, provider.id]);
    await first.query('UPDATE ng_clinical_encounters SET provider_user_id=NULL WHERE patient_user_id=$1 AND provider_user_id=$2', [patient.id, provider.id]);
    await first.query('UPDATE provider_patient_relationships SET is_active=false WHERE patient_id=$1 AND provider_id=$2', [patient.id, provider.id]);
    await assert.rejects(service.save(scoped, req), status(403));
    await assert.rejects(service.receipt(scoped, req, keys[0]), status(403));
    await first.query('ROLLBACK');
  } finally {
    await first.query('ROLLBACK');
    if (pending) await pending.catch(() => {});
    if (provider) {
      await pool.query("DELETE FROM ng_audit_lineage WHERE resource_type='manual_referral_request' AND resource_id IN (SELECT id FROM ng_referrals WHERE provider_user_id=$1 AND manual_request_key=ANY($2::uuid[]))", [provider.id, keys]);
      await pool.query('DELETE FROM ng_referrals WHERE provider_user_id=$1 AND manual_request_key=ANY($2::uuid[])', [provider.id, keys]);
      await pool.query('DELETE FROM ng_appointments WHERE id=$1', [appointmentId]);
    }
    first.release(); second.release(); await pool.end();
  }
});
