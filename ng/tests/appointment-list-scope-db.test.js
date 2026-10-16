'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { getUSPatientControl } = require('./helpers/isolated-market-controls');

const target = process.env.SIMULATION_DATABASE_URL;

test('appointment list applies current actor, patient and provider market scope before counts and pagination', { skip: !target }, async () => {
  const url = new URL(target);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'), 'Use a disposable loopback database ending in _test');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: target });
  const client = await pool.connect();
  const previousSecret = process.env.JWT_ACCESS_SECRET;
  process.env.JWT_ACCESS_SECRET = 'doctarx-appointment-list-test-secret-at-least-32-characters';
  const db = require('../../server/db');
  const originalQuery = db.query;
  let server;
  try {
    await client.query('BEGIN');
    // Existing accounts are reused. Only temporary appointment rows are added;
    // the enclosing transaction rolls back every write, including on failure.
    const patient = (await client.query("SELECT id FROM users WHERE email='patient@demo.doctarx.com' AND is_active=true AND role='patient' AND market_scope='NG'")).rows[0];
    const provider = (await client.query("SELECT id FROM users WHERE email='doctor@demo.doctarx.com' AND is_active=true AND role='provider' AND provider_status='approved' AND market_scope='NG' AND must_change_password=false")).rows[0];
    const otherProvider = (await client.query("SELECT id FROM users WHERE is_active=true AND role='provider' AND provider_status='approved' AND market_scope='NG' AND id<>$1 LIMIT 1", [provider?.id])).rows[0];
    const usPatient = await getUSPatientControl(client);
    const admin = (await client.query("SELECT id FROM users WHERE is_active=true AND role='admin' AND market_scope='NG' ORDER BY id LIMIT 1")).rows[0];
    const pharmacy = (await client.query("SELECT id FROM users WHERE is_active=true AND role='pharmacy' AND must_change_password=false ORDER BY id LIMIT 1")).rows[0];
    assert.ok(patient && provider && otherProvider && usPatient && admin && pharmacy, 'Provision the existing demo/test accounts before the scoped list database check');
    const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
    const startDate = '2097-06-15T00:00:00Z';
    const endDate = '2097-06-16T00:00:00Z';
    for (const [index, patientId, providerId] of [[0, patient.id, provider.id], [1, patient.id, provider.id], [2, usPatient.id, provider.id], [3, patient.id, otherProvider.id]]) {
      await client.query(`INSERT INTO appointments (id,patient_id,provider_id,scheduled_at,type,status)
        VALUES ($1,$2,$3,$4,'video','scheduled')`, [ids[index], patientId, providerId, '2097-06-15T' + String(12 + index).padStart(2, '0') + ':00:00Z']);
    }
    db.query = (sql, parameters) => client.query(sql, parameters);
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const app = express();
    app.use('/appointments', require('../../server/routes/appointments'));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port + '/appointments';
    const request = async (actor, params = {}) => {
      const query = new URLSearchParams({ startDate, endDate, sortOrder: 'asc', ...params });
      const token = jwt.sign({ userId: actor.id, role: 'super_admin', marketScope: 'US' }, process.env.JWT_ACCESS_SECRET, { expiresIn: 600 });
      const response = await fetch(base + '?' + query, { headers: { authorization: 'Bearer ' + token, 'x-doctarx-market': 'US' } });
      return { response, body: await response.json() };
    };
    const first = await request(provider, { limit: '1', page: '1' });
    assert.equal(first.response.status, 200);
    assert.equal(first.response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(first.body.appointments.map((row) => row.id), [ids[0]]);
    assert.equal(first.body.pagination.total, 2);
    assert.equal(first.body.pagination.totalPages, 2);
    assert.equal(first.body.pagination.hasMore, true);
    const second = await request(provider, { limit: '1', page: '2' });
    assert.deepEqual(second.body.appointments.map((row) => row.id), [ids[1]]);
    assert.equal(second.body.pagination.total, 2);
    assert.equal(second.body.pagination.hasMore, false);
    const foreignFilter = await request(provider, { patientId: usPatient.id });
    assert.deepEqual(foreignFilter.body.appointments, []);
    assert.equal(foreignFilter.body.pagination.total, 0);
    const ownPatient = await request(patient);
    assert.equal(ownPatient.response.status, 200);
    assert.deepEqual(ownPatient.body.appointments.map((row) => row.id), [ids[0], ids[1], ids[3]]);
    assert.equal(ownPatient.body.pagination.total, 3);
    const foreignPatient = await request(usPatient);
    assert.equal(foreignPatient.response.status, 200);
    assert.deepEqual(foreignPatient.body.appointments, []);
    assert.equal(foreignPatient.body.pagination.total, 0);
    const administrator = await request(admin, { providerId: provider.id });
    assert.deepEqual(administrator.body.appointments.map((row) => row.id), [ids[0], ids[1]]);
    assert.equal(administrator.body.pagination.total, 2);
    const denied = await request(pharmacy);
    assert.equal(denied.response.status, 403);
    assert.equal(denied.body.success, false);
    const invalidFilter = await request(provider, { status: 'unknown_status' });
    assert.equal(invalidFilter.response.status, 400);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    db.query = originalQuery;
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
    if (previousSecret === undefined) delete process.env.JWT_ACCESS_SECRET; else process.env.JWT_ACCESS_SECRET = previousSecret;
  }
});
