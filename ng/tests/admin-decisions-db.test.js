'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { getUSPatientControl } = require('./helpers/isolated-market-controls');

const target = process.env.SIMULATION_DATABASE_URL;

test('NG admin verification, subscription cancellation and manual confirmation are scoped and roll back atomically', { skip: !target }, async () => {
  const url = new URL(target);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'), 'Use only an isolated loopback database ending in _test');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: target });
  const client = await pool.connect();
  const previousSecret = process.env.JWT_ACCESS_SECRET;
  const previousDatabase = process.env.DATABASE_URL;
  process.env.DATABASE_URL = target;
  process.env.JWT_ACCESS_SECRET = 'doctarx-isolated-admin-decisions-test-secret-32-characters';
  const db = require('../../server/db');
  const originalQuery = db.query;
  const originalPool = db.getPool;
  let server;
  let failAudit = false;
  let missAccountUpdate = false;
  let serial = 0;
  const statements = [];
  const databaseFailures = [];
  // Route transactions are real PostgreSQL savepoints under one transaction.
  // Even successful decisions and audit entries are rolled back after this test.
  const routePool = {
    query: (sql, params) => client.query(sql, params),
    async connect() {
      const savepoint = 'admin_decision_' + (++serial);
      return {
        async query(sql, params) {
          statements.push(sql);
          if (sql === 'BEGIN') return client.query('SAVEPOINT ' + savepoint);
          if (sql === 'COMMIT') return client.query('RELEASE SAVEPOINT ' + savepoint);
          if (sql === 'ROLLBACK') {
            await client.query('ROLLBACK TO SAVEPOINT ' + savepoint);
            return client.query('RELEASE SAVEPOINT ' + savepoint);
          }
          if (failAudit && sql.includes('INSERT INTO audit_logs')) throw new Error('Isolated injected audit failure');
          if (missAccountUpdate && sql.includes('UPDATE users SET provider_status')) return { rows: [], rowCount: 0 };
          try { return await client.query(sql, params); }
          catch (error) { databaseFailures.push({ code: error.code, message: error.message }); throw error; }
        },
        release() {},
      };
    },
  };
  try {
    await client.query('BEGIN');
    const admin = (await client.query("SELECT id FROM users WHERE role='admin' AND market_scope='NG' AND is_active=TRUE LIMIT 1")).rows[0];
    const provider = (await client.query("SELECT u.id, p.id AS profile_id FROM users u JOIN ng_providers p ON p.user_id=u.id WHERE u.email='doctor@demo.doctarx.com' AND u.role='provider' AND u.provider_status='approved' AND u.market_scope='NG' AND u.is_active=TRUE AND u.must_change_password=FALSE")).rows[0];
    const patient = (await client.query("SELECT id FROM users WHERE email='patient@demo.doctarx.com' AND role='patient' AND market_scope='NG' AND is_active=TRUE")).rows[0];
    const usPatient = await getUSPatientControl(client);
    assert.ok(admin && provider && patient && usPatient, 'Reuse the provisioned demo accounts; this test never provisions or resets accounts');
    const plan = (await client.query("SELECT id FROM ng_subscription_plans WHERE plan_key='provider_basic' AND is_active=TRUE AND currency='NGN'")).rows[0];
    assert.ok(plan);
    const orgId = crypto.randomUUID();
    const foreignOrgId = crypto.randomUUID();
    const hospitalId = crypto.randomUUID();
    const foreignHospitalId = crypto.randomUUID();
    for (const [id, owner, country] of [[orgId, patient.id, 'Nigeria'], [foreignOrgId, usPatient.id, 'United States']]) {
      await client.query(`INSERT INTO ng_organizations (id,name,slug,type,owner_user_id,admin_name,admin_email,admin_phone,country)
        VALUES ($1,'Isolated route fixture',$2,'company',$3,'Route fixture','fixture@example.invalid','0000000000',$4)`, [id, id, owner, country]);
    }
    for (const [id, owner] of [[hospitalId, patient.id], [foreignHospitalId, usPatient.id]]) {
      await client.query(`INSERT INTO ng_hospitals (id,name,slug,facility_type,owner_user_id,contact_name,contact_email,contact_phone,address_line1,city,state)
        VALUES ($1,'Isolated route fixture',$2,'clinic',$3,'Route fixture','fixture@example.invalid','0000000000','Isolated test address','Test area','Test region')`, [id, id, owner]);
    }
    const subscriptionId = crypto.randomUUID();
    const pendingId = crypto.randomUUID();
    const foreignId = crypto.randomUUID();
    for (const [id, owner, status] of [[subscriptionId, provider.id, 'active'], [pendingId, patient.id, 'pending'], [foreignId, usPatient.id, 'active']]) {
      await client.query(`INSERT INTO ng_subscriptions (id,subscriber_user_id,plan_id,plan_key,status,amount_per_period,currency,last_payment_reference,current_period_end)
        VALUES ($1,$2,$3,'provider_basic',$4,10000,'NGN',$5,NOW()+INTERVAL '30 days')`, [id, owner, plan.id, status, 'ISOLATED-' + id]);
    }
    db.query = (sql, params) => client.query(sql, params);
    db.getPool = () => routePool;
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const app = express(); app.use(express.json());
    app.use('/providers', require('../routes/provider'));
    app.use('/hospitals', require('../routes/hospital'));
    app.use('/organizations', require('../routes/organization'));
    app.use('/subscriptions', require('../routes/subscriptions'));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const post = async (actor, path, body) => {
      const token = jwt.sign({ userId: actor.id, role: 'super_admin', marketScope: 'NG' }, process.env.JWT_ACCESS_SECRET, { expiresIn: 600 });
      const response = await fetch('http://127.0.0.1:' + server.address().port + path, {
        method: 'POST', headers: { authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'x-doctarx-market': 'NG' }, body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };
    const routeEntities = [['providers', provider.profile_id], ['hospitals', hospitalId], ['organizations', orgId]];
    for (const [route, id] of routeEntities) {
      assert.equal((await post(patient, `/${route}/${id}/verify`, { action: 'approve' })).status, 403, 'Forged role cannot administer');
      assert.equal((await post(admin, `/${route}/invalid/verify`, { action: 'approve' })).status, 400);
      assert.equal((await post(admin, `/${route}/${crypto.randomUUID()}/verify`, { action: 'approve' })).status, 404);
      assert.equal((await post(admin, `/${route}/${id}/verify`, { action: '__proto__' })).status, 400);
      assert.equal((await post(admin, `/${route}/${id}/verify`, { action: 'suspend', reason: ' ' })).status, 400);
      assert.equal((await post(admin, `/${route}/${id}/verify`, { action: 'reject', reason: 'x'.repeat(1001) })).status, 400);
    }
    assert.equal((await post(admin, `/organizations/${foreignOrgId}/verify`, { action: 'approve' })).status, 404);
    assert.equal((await post(admin, `/hospitals/${foreignHospitalId}/verify`, { action: 'approve' })).status, 404);
    assert.equal((await post(admin, `/hospitals/${hospitalId}/verify`, { action: 'activate' })).status, 409);
    for (const [route, id] of routeEntities) {
      const approved = await post(admin, `/${route}/${id}/verify`, { action: 'approve', reason: 'Isolated verification review' });
      assert.equal(approved.status, 200, JSON.stringify(databaseFailures)); assert.equal(approved.body.success, true);
      assert.equal(approved.body.status, route === 'organizations' ? 'active' : 'verified');
      const audit = await client.query("SELECT new_values FROM audit_logs WHERE resource_id=$1 AND action='update' ORDER BY created_at DESC LIMIT 1", [id]);
      assert.equal(audit.rows[0].new_values.action, 'approve');
    }
    const verifiedHospital = await post(admin, `/hospitals/${hospitalId}/verify`, { action: 'activate' });
    assert.equal(verifiedHospital.body.hospital.status, 'active');
    const beforeProvider = (await client.query('SELECT p.status,p.access_status,p.trial_start_at,p.trial_end_at,u.provider_status FROM ng_providers p JOIN users u ON u.id=p.user_id WHERE p.id=$1', [provider.profile_id])).rows[0];
    failAudit = true;
    const failed = await post(admin, `/providers/${provider.profile_id}/verify`, { action: 'suspend', reason: 'Isolated rollback check' });
    assert.equal(failed.status, 500); assert.equal(failed.body.success, false); assert.ok(!failed.body.error.includes('injected'));
    failAudit = false;
    const afterProvider = (await client.query('SELECT p.status,p.access_status,p.trial_start_at,p.trial_end_at,u.provider_status FROM ng_providers p JOIN users u ON u.id=p.user_id WHERE p.id=$1', [provider.profile_id])).rows[0];
    assert.deepEqual(afterProvider, beforeProvider, 'Audit failure rolls back profile and account approval together');
    missAccountUpdate = true;
    assert.equal((await post(admin, `/providers/${provider.profile_id}/verify`, { action: 'reject', reason: 'Missing account update' })).status, 404);
    missAccountUpdate = false;
    assert.equal((await client.query('SELECT status FROM ng_providers WHERE id=$1', [provider.profile_id])).rows[0].status, 'verified');
    assert.equal((await post(admin, `/subscriptions/admin/${subscriptionId}/cancel`, { reason: '' })).status, 400);
    assert.equal((await post(patient, `/subscriptions/admin/${subscriptionId}/cancel`, { reason: 'Not an admin' })).status, 403);
    assert.equal((await post(patient, `/subscriptions/${subscriptionId}/cancel`, {})).status, 404);
    assert.equal((await post(admin, `/subscriptions/admin/${foreignId}/cancel`, { reason: 'Other market' })).status, 404);
    assert.equal((await post(admin, `/subscriptions/admin/${crypto.randomUUID()}/cancel`, { reason: 'Unknown ID' })).status, 404);
    failAudit = true;
    assert.equal((await post(admin, `/subscriptions/admin/${subscriptionId}/cancel`, { reason: 'Isolated rollback check' })).status, 500);
    failAudit = false;
    assert.equal((await client.query('SELECT status FROM ng_subscriptions WHERE id=$1', [subscriptionId])).rows[0].status, 'active');
    const canceled = await post(admin, `/subscriptions/admin/${subscriptionId}/cancel`, { reason: 'Recorded staff decision in isolated test' });
    assert.equal(canceled.status, 200); assert.equal(canceled.body.subscription.status, 'canceled');
    assert.equal((await post(admin, `/subscriptions/admin/${subscriptionId}/cancel`, { reason: 'Retry same cancellation' })).body.subscription.status, 'canceled');
    for (const path of ['/subscribe', `/${pendingId}/initiate-payment`, '/activate']) {
      const result = await post(patient, '/subscriptions' + path, { subscription_id: pendingId, payment_reference: 'ISOLATED-' + pendingId, amount: 1, currency: 'USD', environment: 'live' });
      assert.equal(result.status, 503); assert.equal(result.body.code, 'SUBSCRIPTION_CHECKOUT_NOT_ACTIVATED');
    }
    assert.equal((await post(patient, '/subscriptions/activate', { subscription_id: pendingId, payment_reference: 'FORGED' })).status, 409);
    assert.equal((await post(patient, '/subscriptions/activate', { subscription_id: foreignId, payment_reference: 'ISOLATED-' + foreignId })).status, 404);
    assert.equal((await post(usPatient, '/subscriptions/activate', { subscription_id: foreignId, payment_reference: 'ISOLATED-' + foreignId })).status, 403);
    assert.equal((await client.query('SELECT status,last_payment_reference FROM ng_subscriptions WHERE id=$1', [pendingId])).rows[0].status, 'pending');
    assert.equal((await post(patient, `/subscriptions/${pendingId}/cancel`, {})).body.subscription.status, 'canceled');
    assert.equal((await post(patient, '/subscriptions/activate', { subscription_id: pendingId, payment_reference: 'ISOLATED-' + pendingId })).status, 409, 'Cancellation cannot be replayed into paid activation');
    const manual = { subjectType: 'provider', userId: provider.id, planKey: 'provider_basic', amountNgn: 10000,
      idempotencyKey: crypto.randomUUID(), paymentMethod: 'bank_transfer', paymentReference: 'ISOLATED-MANUAL-' + crypto.randomUUID(), periodEnd: new Date(Date.now() + 86400000 * 30).toISOString(), notes: 'Isolated staff confirmation test' };
    assert.equal((await post(patient, '/subscriptions/admin/manual-activation', manual)).status, 403);
    assert.equal((await post(admin, '/subscriptions/admin/manual-activation', { ...manual, amountNgn: '10.001' })).status, 400);
    assert.equal((await post(admin, '/subscriptions/admin/manual-activation', { ...manual, userId: usPatient.id })).status, 404);
    const beforeCount = (await client.query('SELECT COUNT(*)::int AS count FROM ng_subscriptions')).rows[0].count;
    failAudit = true;
    assert.equal((await post(admin, '/subscriptions/admin/manual-activation', manual)).status, 500);
    failAudit = false;
    assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM ng_subscriptions')).rows[0].count, beforeCount, 'Audit failure rolls back subscription and manual confirmation');
    assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM ng_manual_payment_confirmations WHERE payment_reference=$1', [manual.paymentReference])).rows[0].count, 0);
    const activated = await post(admin, '/subscriptions/admin/manual-activation', manual);
    assert.equal(activated.status, 201); assert.equal(activated.body.subscription.status, 'active');
    assert.equal(activated.body.subscription.payment_provider, 'manual_admin');
    assert.equal(activated.body.paymentEvidence, 'manual_admin_confirmation');
    const retry = await post(admin, '/subscriptions/admin/manual-activation', manual);
    assert.equal(retry.status, 201); assert.equal(retry.body.subscription.id, activated.body.subscription.id);
    assert.equal(retry.body.subscription.replayed, true, 'Identical key/reference retries reuse the actual confirmation');
    assert.equal((await post(admin, '/subscriptions/admin/manual-activation', { ...manual, amountNgn: 1 })).status, 409, 'Reusing a key/reference with different content is rejected');
    assert.equal((await post(admin, '/subscriptions/admin/manual-activation', { ...manual, paymentReference: 'DIFFERENT-' + crypto.randomUUID() })).status, 409, 'A key cannot confirm another payment reference');
    assert.equal((await post(admin, '/subscriptions/admin/manual-activation', { ...manual, idempotencyKey: crypto.randomUUID(), paymentReference: 'ISOLATED-SECOND-' + crypto.randomUUID() })).status, 409, 'Another live subscription is not created');
    assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM ng_subscriptions')).rows[0].count, beforeCount + 1);
    assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM ng_manual_payment_confirmations WHERE payment_reference=$1', [manual.paymentReference])).rows[0].count, 1);
    assert.equal((await client.query('SELECT provider_status FROM users WHERE id=$1', [provider.id])).rows[0].provider_status, 'approved');
    assert.ok(statements.filter(sql => sql === 'ROLLBACK').length >= 8);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    db.query = originalQuery; db.getPool = originalPool;
    await client.query('ROLLBACK'); client.release(); await pool.end();
    if (previousSecret === undefined) delete process.env.JWT_ACCESS_SECRET; else process.env.JWT_ACCESS_SECRET = previousSecret;
    if (previousDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabase;
  }
});
