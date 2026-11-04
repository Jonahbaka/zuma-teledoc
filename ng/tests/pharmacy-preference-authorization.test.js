'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const express = require('express');
const { z } = require('zod');
const utils = require('../../lib/utils');
const marketScope = require('../../server/utils/marketScope');
const { getUSPatientControl } = require('./helpers/isolated-market-controls');
const patientId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const providerId = '00000000-0000-4000-8000-000000000003';
const adminId = '00000000-0000-4000-8000-000000000004';
const usId = '00000000-0000-4000-8000-000000000005';
const user = (id = patientId, role = 'patient', market = 'NG') => ({ id, role, marketScope: market });
const details = { pharmacyName: 'Test-only pharmacy', pharmacyAddress: 'Test-only business address', latitude: 0, longitude: 0, distanceMiles: 0, source: 'patient_selected', isPreferred: true };

function loadSource(relativePath, dependencies) {
  const sourceModule = { exports: {} }; const filename = path.resolve(__dirname, '../..', relativePath);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: sourceModule, exports: sourceModule.exports,
    require(name) { assert.ok(name in dependencies, `Unexpected preference dependency: ${name}`); return dependencies[name]; },
  }, { filename });
  return sourceModule.exports;
}

function memoryPool(options = {}) {
  const actor = (id, role = 'patient', market = 'NG') => ({ id, role, market_scope: market, is_active: true, provider_status: role === 'provider' ? 'approved' : null });
  const state = { actors: [actor(patientId), actor(otherId), actor(providerId, 'provider'), actor(adminId, 'admin'), actor(usId, 'patient', 'US')], records: [], audits: [], care: false, failAudit: false, ...options };
  const calls = []; let snapshot;
  const client = {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (sql === 'BEGIN') { snapshot = structuredClone({ records: state.records, audits: state.audits }); return { rows: [] }; }
      if (sql === 'COMMIT') { snapshot = null; return { rows: [] }; }
      if (sql === 'ROLLBACK') { if (snapshot) Object.assign(state, snapshot); return { rows: [] }; }
      if (sql.includes('FROM users WHERE id=$1')) return { rows: state.actors.filter((actor) => actor.id === parameters[0]) };
      if (sql.includes('FROM users p')) {
        const target = state.actors.find((actor) => actor.id === parameters[0] && actor.role === 'patient' && marketScope.normalizeMarketScope(actor.market_scope, 'US') === parameters[1]);
        const allowed = target && (parameters.length < 4 || parameters[2] !== 'provider' || state.care);
        return { rows: allowed ? [{ ...target }] : [] };
      }
      if (sql.includes('FROM appointments')) return { rows: state.care ? [{ id: crypto.randomUUID() }] : [] };
      if (sql.includes('INSERT INTO audit_logs')) { if (state.failAudit) throw new Error('Private audit failure'); state.audits.push(parameters); return { rows: [] }; }
      if (sql.includes('SELECT id FROM pharmacy_preferences')) return { rows: state.records.filter((row) => row.patient_id === parameters[0] && row.id === parameters[1]).map((row) => ({ id: row.id })) };
      if (sql.includes('SELECT * FROM pharmacy_preferences') && sql.includes('REGEXP_REPLACE')) {
        const normalize = (value) => value.trim().replace(/\s+/g, ' ').toLowerCase();
        return { rows: state.records.filter((row) => row.patient_id === parameters[0] && (parameters[1] ? row.pharmacy_npi === parameters[1]
          : row.pharmacy_npi === null && normalize(row.pharmacy_name) === normalize(parameters[2]) && normalize(row.pharmacy_address) === normalize(parameters[3]))) };
      }
      if (sql.includes('SELECT * FROM pharmacy_preferences')) return { rows: state.records.filter((row) => row.patient_id === parameters[0]) };
      if (sql.includes('SET is_preferred=FALSE')) { for (const row of state.records) if (row.patient_id === parameters[0] && row.id !== parameters[1]) row.is_preferred = false; return { rows: [] }; }
      if (sql.includes('SET is_preferred=TRUE')) { const row = state.records.find((item) => item.patient_id === parameters[0] && item.id === parameters[1]); row.is_preferred = true; return { rows: [row] }; }
      if (sql.includes('INSERT INTO pharmacy_preferences') || sql.includes('SET pharmacy_name')) {
        const row = sql.includes('INSERT') ? { id: crypto.randomUUID() } : state.records.find((item) => item.id === parameters[10]);
        Object.assign(row, { patient_id: parameters[0], pharmacy_name: parameters[1], pharmacy_address: parameters[2], pharmacy_phone: parameters[3], pharmacy_npi: parameters[4], latitude: parameters[5], longitude: parameters[6], distance_miles: parameters[7], is_preferred: parameters[8], source: parameters[9], is_open: null });
        if (sql.includes('INSERT')) state.records.push(row);
        return { rows: [row] };
      }
      if (sql.includes('DELETE FROM pharmacy_preferences')) { const removed = state.records.filter((row) => row.patient_id === parameters[0] && row.id === parameters[1]); state.records = state.records.filter((row) => !removed.includes(row)); return { rows: removed.map((row) => ({ id: row.id })) }; }
      throw new Error('Unexpected preference SQL');
    }, release() {},
  };
  return { state, calls, connect: async () => client, query: (...args) => client.query(...args) };
}

function parts(pool) {
  let authenticated;
  const logs = [];
  const db = { pool, query: (...args) => pool.query(...args) };
  const financialScope = loadSource('server/middleware/financialRecordScope.js', { '../db': db, '../utils/marketScope': marketScope });
  const logger = { warn: (...args) => logs.push(args), error: (...args) => logs.push(args), info: (...args) => logs.push(args) };
  const service = loadSource('server/services/pharmacyService.js', { '../db': db, '../middleware/logger': logger, '../../lib/utils': utils, '../middleware/financialRecordScope': financialScope, zod: { z } });
  const auth = { authenticate(req, res, next) { if (!authenticated) return res.status(401).json({ success: false }); req.user = authenticated; return next(); }, requireRole: () => (_req, _res, next) => next() };
  const route = loadSource('server/routes/pharmacy.js', { express, '../middleware/auth': auth, '../middleware/audit': { auditMiddleware: () => (_req, _res, next) => next() }, '../services/pharmacyService': service, '../middleware/logger': logger });
  return { service, route, logs, setUser(value) { authenticated = value; } };
}
async function serve(parts, run) {
  const app = express(); app.use(express.json()); app.use('/api/pharmacy', parts.route);
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  try {
    await run((url, method = 'GET', body) => fetch(`http://127.0.0.1:${server.address().port}/api/pharmacy${url}`, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }));
  } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('preferences authenticate, validate identifiers and require an explicit authorized patient context', async () => {
  const pool = memoryPool(); const api = parts(pool);
  await serve(api, async (request) => {
    assert.equal((await request('/preferences')).status, 401);
    api.setUser(user(providerId, 'provider'));
    assert.equal((await request('/preferences')).status, 400);
    assert.equal((await request('/preferences?patientId=not-a-uuid')).status, 400);
    api.setUser(user());
    assert.equal((await request('/preferences?patientId=')).status, 400);
    assert.equal((await request('/preferences', 'POST', { ...details, patientId: '' })).status, 400);
    assert.equal((await request('/preferences/' + patientId + '/preferred', 'PUT', { patientId: null })).status, 400);
    assert.equal((await request('/preferences?patientId=' + patientId, 'POST', { ...details, patientId: otherId })).status, 400);
    assert.equal((await request('/preferences/bad-id/preferred', 'PUT')).status, 400);
    assert.equal((await request('/preferences/bad-id', 'DELETE')).status, 400);
    api.setUser(user(patientId, 'pharmacy'));
    assert.equal((await request('/preferences')).status, 403);
    assert.equal(pool.calls.length, 0);
  });
});

test('current actor activation, role, market and provider approval override cached session privileges before PHI retrieval', async () => {
  for (const change of [{ is_active: false }, { role: 'provider' }, { market_scope: 'US' }]) {
    const pool = memoryPool(); Object.assign(pool.state.actors[0], change); const api = parts(pool); api.setUser(user());
    await serve(api, async (request) => { assert.equal((await request('/preferences')).status, 403); assert.equal((await request('/preferences', 'POST', details)).status, 403); });
    assert.equal(pool.calls.some((call) => call.sql.includes('pharmacy_preferences')), false);
  }
  const pool = memoryPool({ care: true }); pool.state.actors.find((actor) => actor.id === providerId).provider_status = 'suspended';
  const api = parts(pool); api.setUser(user(providerId, 'provider'));
  await serve(api, async (request) => { assert.equal((await request('/preferences?patientId=' + patientId)).status, 403); });
  assert.equal(pool.calls.some((call) => call.sql.includes('pharmacy_preferences')), false);
  const unmapped = memoryPool(); unmapped.state.actors.find((actor) => actor.id === usId).market_scope = 'unsupported';
  const invalidMarket = parts(unmapped); invalidMarket.setUser(user(usId, 'patient', 'US'));
  await serve(invalidMarket, async (request) => { assert.equal((await request('/preferences')).status, 403); });
});

test('patients cannot choose a foreign patient, providers require care and administrators cannot cross markets', async () => {
  for (const [actor, target] of [[user(), otherId], [user(providerId, 'provider'), patientId], [user(adminId, 'admin'), usId]]) {
    const pool = memoryPool(); const api = parts(pool); api.setUser(actor);
    await serve(api, async (request) => {
      assert.equal((await request('/preferences?patientId=' + target)).status, 404);
      assert.equal((await request('/preferences', 'POST', { ...details, patientId: target })).status, 404);
    });
    assert.equal(pool.calls.some((call) => call.sql.includes('pharmacy_preferences')), false);
  }
  const unknownTarget = memoryPool();
  unknownTarget.state.actors.find((actor) => actor.id === adminId).market_scope = 'US';
  unknownTarget.state.actors.find((actor) => actor.id === usId).market_scope = 'unsupported';
  const api = parts(unknownTarget); api.setUser(user(adminId, 'admin', 'US'));
  await serve(api, async (request) => { assert.equal((await request('/preferences?patientId=' + usId)).status, 404); });
  assert.equal(unknownTarget.calls.some((call) => call.sql.includes('pharmacy_preferences')), false);
});

test('authorized patient preference retries preserve zero coordinates and stable null-NPI identity without opening or delivery claims', async () => {
  const pool = memoryPool(); const api = parts(pool); api.setUser(user());
  await serve(api, async (request) => {
    const first = await request('/preferences', 'POST', details); assert.equal(first.status, 201);
    const created = (await first.json()).pharmacy;
    assert.equal(created.latitude, 0); assert.equal(created.longitude, 0); assert.equal(created.distanceMiles, 0); assert.equal(created.isOpen, null);
    assert.equal(created.verificationStatus, 'details_not_verified'); assert.equal(created.hasDelivery, undefined);
    const retry = await request('/preferences', 'POST', { ...details, pharmacyName: '  TEST-ONLY   PHARMACY ', pharmacyAddress: ' TEST-ONLY BUSINESS ADDRESS ' }); assert.equal(retry.status, 200);
    assert.equal((await retry.json()).pharmacy.id, created.id); assert.equal(pool.state.records.length, 1);
    const listing = await request('/preferences'); assert.equal(listing.headers.get('cache-control'), 'private, no-store');
    assert.equal((await listing.json()).pharmacies.length, 1);
  });
  assert.equal(JSON.stringify(api.logs).includes(details.pharmacyAddress), false);
  assert.ok(pool.calls.some((call) => call.sql.includes('FOR NO KEY UPDATE')));
});

test('preference input bounds fit database fields and reject malformed values before a transaction', async () => {
  const pool = memoryPool(); const api = parts(pool);
  for (const invalid of [{ ...details, pharmacyName: 'x'.repeat(256) }, { ...details, pharmacyAddress: 'x'.repeat(1001) }, { ...details, pharmacyPhone: 'x'.repeat(51) }, { ...details, pharmacyNpi: 'x'.repeat(21) }, { ...details, latitude: 91 }, { ...details, longitude: null }, { ...details, latitude: '0' }, { ...details, distanceMiles: 1000 }, { ...details, distanceMiles: Infinity }, { ...details, isPreferred: 'true' }, { ...details, isOpen: true }, { ...details, pharmacyName: 'x\u0000y' }]) {
    await assert.rejects(api.service.addPatientPharmacy(patientId, invalid, { user: user() }), (error) => error.statusCode === 400);
  }
  assert.equal(pool.calls.length, 0);
});

test('foreign preferred IDs and audit outages leave the previous preferred selection intact', async () => {
  const pool = memoryPool(); const api = parts(pool);
  const own = await api.service.addPatientPharmacy(patientId, details, { user: user() });
  const foreign = await api.service.addPatientPharmacy(otherId, details, { user: user(otherId) });
  const before = JSON.stringify(pool.state.records);
  await assert.rejects(api.service.setPreferredPharmacy(patientId, foreign.pharmacy.id, { user: user() }), (error) => error.statusCode === 404);
  assert.equal(JSON.stringify(pool.state.records), before);
  const second = await api.service.addPatientPharmacy(patientId, { ...details, pharmacyName: 'Another test-only choice', isPreferred: false }, { user: user() });
  const stable = JSON.stringify(pool.state.records); pool.state.failAudit = true;
  await assert.rejects(api.service.setPreferredPharmacy(patientId, second.pharmacy.id, { user: user() }));
  assert.equal(JSON.stringify(pool.state.records), stable); assert.equal(pool.state.records.find((row) => row.id === own.pharmacy.id).is_preferred, true);
  api.setUser(user());
  await serve(api, async (request) => { const response = await request('/preferences'); assert.equal(response.status, 503); assert.equal((await response.json()).pharmacies, undefined); });
});

const target = process.env.SIMULATION_DATABASE_URL;
test('PostgreSQL/HTTP preference authorization, null-NPI retry, preferred isolation and audit rollback preserve existing accounts and records', { skip: !target }, async () => {
  const url = new URL(target); assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'));
  const { Pool } = require('pg'); const pool = new Pool({ connectionString: target }); const client = await pool.connect();
  let baseline; let count = 0; let current; let failAudit = false;
  try {
    baseline = (await client.query('SELECT COUNT(*)::int AS count FROM pharmacy_preferences')).rows[0].count;
    await client.query('BEGIN');
    const patient = (await client.query("SELECT id FROM users WHERE email='patient@demo.doctarx.com' AND role='patient' AND market_scope='NG' AND is_active=TRUE")).rows[0];
    const other = (await client.query("SELECT id FROM users WHERE email='government@demo.doctarx.com' AND role='patient' AND market_scope='NG' AND is_active=TRUE")).rows[0];
    const provider = (await client.query("SELECT id FROM users WHERE email='doctor@demo.doctarx.com' AND role='provider' AND market_scope='NG' AND provider_status='approved' AND is_active=TRUE")).rows[0];
    const admin = (await client.query("SELECT id,role FROM users WHERE role IN ('admin','super_admin') AND market_scope='NG' AND is_active=TRUE ORDER BY id LIMIT 1")).rows[0];
    const usControl = await getUSPatientControl(client);
    assert.ok(patient && other && provider && admin && usControl, 'Existing NG demo accounts and isolated US control are required; existing accounts are never reset');
    const wrapped = {
      async query(sql, parameters) {
        if (sql === 'BEGIN') { current = 'preference_test_' + ++count; return client.query('SAVEPOINT ' + current); }
        if (sql === 'COMMIT') return client.query('RELEASE SAVEPOINT ' + current);
        if (sql === 'ROLLBACK') { await client.query('ROLLBACK TO SAVEPOINT ' + current); return client.query('RELEASE SAVEPOINT ' + current); }
        if (failAudit && sql.includes('INSERT INTO audit_logs')) throw new Error('Test-only durable audit outage');
        return client.query(sql, parameters);
      }, release() {},
    };
    const isolated = { connect: async () => wrapped, query: (...args) => wrapped.query(...args) };
    const api = parts(isolated); api.setUser(user(patient.id));
    let ownId, otherPreferenceId, secondId;
    const unique = { ...details, pharmacyName: 'Rollback preference ' + crypto.randomUUID() };
    await serve(api, async (request) => {
      const created = await request('/preferences', 'POST', unique); assert.equal(created.status, 201); ownId = (await created.json()).pharmacy.id;
      const retry = await request('/preferences', 'POST', { ...unique, pharmacyName: unique.pharmacyName.toUpperCase() }); assert.equal(retry.status, 200); assert.equal((await retry.json()).pharmacy.id, ownId);
      const stored = (await client.query('SELECT * FROM pharmacy_preferences WHERE id=$1', [ownId])).rows[0];
      assert.equal(stored.pharmacy_npi, null); assert.notEqual(stored.latitude, null); assert.equal(Number(stored.latitude), 0); assert.notEqual(stored.longitude, null); assert.equal(Number(stored.longitude), 0); assert.notEqual(stored.distance_miles, null); assert.equal(Number(stored.distance_miles), 0); assert.equal(stored.is_open, null);
      api.setUser(user(other.id)); otherPreferenceId = (await (await request('/preferences', 'POST', unique)).json()).pharmacy.id;
      api.setUser(user(patient.id));
      assert.equal((await request('/preferences/' + otherPreferenceId + '/preferred', 'PUT')).status, 404);
      assert.equal((await client.query('SELECT is_preferred FROM pharmacy_preferences WHERE id=$1', [ownId])).rows[0].is_preferred, true);
      assert.equal((await request('/preferences?patientId=' + other.id)).status, 404);
      api.setUser(user(provider.id, 'patient')); assert.equal((await request('/preferences')).status, 403);
      api.setUser(user(provider.id, 'provider')); assert.equal((await request('/preferences?patientId=' + usControl.id)).status, 404);
      await client.query("INSERT INTO appointments (patient_id,provider_id,scheduled_at,status) VALUES ($1,$2,NOW(),'completed')", [patient.id, provider.id]);
      const providerRead = await request('/preferences?patientId=' + patient.id); assert.equal(providerRead.status, 200); assert.ok((await providerRead.json()).pharmacies.some((row) => row.id === ownId));
      const clinicianSave = await request('/preferences', 'POST', { ...unique, patientId: patient.id, pharmacyName: unique.pharmacyName + ' clinician choice', isPreferred: false });
      assert.equal(clinicianSave.status, 201); assert.equal((await clinicianSave.json()).pharmacy.patientId, patient.id);
      assert.equal((await request('/preferences/' + ownId + '/preferred?patientId=' + patient.id, 'PUT')).status, 200);
      api.setUser(user(admin.id, admin.role)); assert.equal((await request('/preferences?patientId=' + patient.id)).status, 200); assert.equal((await request('/preferences?patientId=' + usControl.id)).status, 404);
      const administratorSave = await request('/preferences', 'POST', { ...unique, patientId: patient.id, pharmacyName: unique.pharmacyName + ' administrator choice', isPreferred: false });
      assert.equal(administratorSave.status, 201); assert.equal((await administratorSave.json()).pharmacy.patientId, patient.id);
      api.setUser(user(patient.id));
      secondId = (await (await request('/preferences', 'POST', { ...unique, pharmacyName: unique.pharmacyName + ' second', isPreferred: false })).json()).pharmacy.id;
      const flagsBefore = (await client.query('SELECT id,is_preferred FROM pharmacy_preferences WHERE patient_id=$1 ORDER BY id', [patient.id])).rows;
      failAudit = true;
      assert.equal((await request('/preferences/' + secondId + '/preferred', 'PUT')).status, 503);
      assert.deepEqual((await client.query('SELECT id,is_preferred FROM pharmacy_preferences WHERE patient_id=$1 ORDER BY id', [patient.id])).rows, flagsBefore);
      failAudit = false;
      assert.equal((await request('/preferences/' + secondId + '/preferred', 'PUT')).status, 200);
      assert.equal((await client.query('SELECT is_preferred FROM pharmacy_preferences WHERE id=$1', [ownId])).rows[0].is_preferred, false);
      assert.equal((await request('/preferences/' + secondId, 'DELETE')).status, 200);
      assert.equal((await request('/preferences/' + otherPreferenceId, 'DELETE')).status, 404);
    });
    const audit = (await client.query("SELECT action,patient_id FROM audit_logs WHERE resource_type='pharmacy_preference' AND resource_id=$1 ORDER BY created_at", [ownId])).rows;
    assert.ok(audit.some((row) => row.action === 'create' && row.patient_id === patient.id));
  } finally {
    await client.query('ROLLBACK'); assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM pharmacy_preferences')).rows[0].count, baseline);
    client.release(); await pool.end();
  }
});
