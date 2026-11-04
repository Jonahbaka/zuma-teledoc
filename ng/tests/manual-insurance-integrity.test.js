'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const service = require('../../server/services/manualInsuranceService');
const encryption = require('../../lib/encryption');
const readiness = require('../../server/utils/integrationReadiness');
const { normalizeMarketScope } = require('../../server/utils/marketScope');
const testKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const patientId = '00000000-0000-4000-8000-000000000001';
const otherPatientId = '00000000-0000-4000-8000-000000000002';
const input = { payerName: 'Test-only payer', memberId: 'TEST-MEMBER-9031', groupNumber: 'TEST-GROUP-1234', planName: 'Test-only plan' };
function request(user = { id: patientId, role: 'patient', marketScope: 'NG' }, key = crypto.randomUUID()) { return { user, headers: { 'idempotency-key': key }, ip: '127.0.0.1', get() { return 'node-test'; } }; }
async function withKey(run) {
  const previous = process.env.ENCRYPTION_KEY; process.env.ENCRYPTION_KEY = testKey;
  try { return await run(); } finally { if (previous === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = previous; }
}

function memoryPool(options = {}) {
  const state = { actor: { id: patientId, role: 'patient', is_active: true, market_scope: 'NG' }, records: [], audits: [], failAudit: false, ...options };
  const calls = []; let snapshot;
  const client = {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (sql === 'BEGIN') { snapshot = structuredClone({ records: state.records, audits: state.audits }); return { rows: [] }; }
      if (sql === 'COMMIT') { snapshot = null; return { rows: [] }; }
      if (sql === 'ROLLBACK') { if (snapshot) Object.assign(state, snapshot); snapshot = null; return { rows: [] }; }
      if (sql.includes('FROM users')) {
        assert.ok(sql.includes("role='patient'") && sql.includes('is_active=TRUE') && sql.includes('FOR SHARE'));
        return { rows: state.actor?.id === parameters[0] && state.actor.role === 'patient' && state.actor.is_active === true ? [{ ...state.actor }] : [] };
      }
      if (sql.includes('INSERT INTO patient_insurance')) {
        if (state.records.some((record) => record.user_id === parameters[0] && record.manual_submission_key === parameters[2])) return { rows: [] };
        const record = { id: crypto.randomUUID(), user_id: parameters[0], insurance_provider: null, member_id: null, group_number: null, plan_name: null,
          manual_identity_encrypted: JSON.parse(parameters[1]), manual_submission_key: parameters[2], manual_submission_digest: parameters[3],
          is_primary: false, is_verified: false, eligibility_status: 'pending', ocr_provider: 'manual', created_at: new Date().toISOString() };
        state.records.push(record); return { rows: [record] };
      }
      if (sql.includes('SELECT * FROM patient_insurance WHERE user_id')) return { rows: state.records.filter((record) => record.user_id === parameters[0] && record.manual_submission_key === parameters[1]) };
      if (sql.includes('INSERT INTO audit_logs')) { if (state.failAudit) throw new Error('Audit unavailable'); state.audits.push(parameters); return { rows: [] }; }
      throw new Error('Unexpected manual insurance database operation');
    },
    release() {},
  };
  return { state, calls, connect: async () => client, query: (...args) => client.query(...args) };
}

test('manual insurance rejects missing encryption, malformed retry references and unbounded/spoofed fields before SQL', async () => {
  const pool = { async connect() { throw new Error('SQL must not be used'); } };
  const previous = process.env.ENCRYPTION_KEY;
  try {
    delete process.env.ENCRYPTION_KEY;
    await assert.rejects(service.saveManualInsurance(pool, request(), input), (error) => error.status === 503);
    process.env.ENCRYPTION_KEY = 'short-key';
    await assert.rejects(service.saveManualInsurance(pool, request(), input), (error) => error.status === 503);
  } finally { if (previous === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = previous; }
  await withKey(async () => {
    for (const details of [{ ...input, patientId: otherPatientId }, { ...input, payerName: 'x'.repeat(256) }, { ...input, memberId: 'x'.repeat(101) }, { ...input, groupNumber: 'x'.repeat(101) }, { ...input, planName: 'x'.repeat(256) }, { ...input, memberId: '' }, { ...input, payerName: 'Test\u0000payer' }, { ...input, memberId: 1234 }]) {
      await assert.rejects(service.saveManualInsurance(pool, request(), details), (error) => error.status === 400);
    }
    await assert.rejects(service.saveManualInsurance(pool, request(undefined, 'not-a-uuid'), input), (error) => error.status === 400);
    await assert.rejects(service.saveManualInsurance(pool, request({ id: patientId, role: 'provider', marketScope: 'NG' }), input), (error) => error.status === 403);
  });
});

test('manual insurance requires the fresh active patient account and matching market before insertion', async () => {
  await withKey(async () => {
    for (const actor of [null, { id: patientId, role: 'provider', is_active: true, market_scope: 'NG' }, { id: patientId, role: 'patient', is_active: false, market_scope: 'NG' }, { id: patientId, role: 'patient', is_active: true, market_scope: 'US' }]) {
      const pool = memoryPool({ actor });
      await assert.rejects(service.saveManualInsurance(pool, request(), input), (error) => error.status === 403);
      assert.equal(pool.calls.some((call) => call.sql.includes('INSERT')), false);
    }
  });
});

test('manual insurance encrypts all entered identity, masks list data and commits an audit without coverage verification', async () => {
  await withKey(async () => {
    const pool = memoryPool(); const result = await service.saveManualInsurance(pool, request(), input);
    assert.equal(result.created, true); assert.equal(result.insurance.eligibility_status, 'pending');
    assert.equal(result.insurance.is_verified, false); assert.equal(result.insurance.is_primary, false);
    assert.equal(result.insurance.memberId, '••••9031'); assert.equal(result.insurance.groupNumber, '••••1234');
    assert.equal(result.insurance.payerName, input.payerName); assert.equal(result.insurance.planName, input.planName);
    const record = pool.state.records[0];
    for (const field of ['insurance_provider', 'member_id', 'group_number', 'plan_name']) assert.equal(record[field], null);
    assert.equal(JSON.stringify(record).includes(input.memberId), false);
    assert.equal(JSON.stringify(pool.state.audits).includes(input.memberId), false);
    assert.equal(JSON.stringify(pool.state.audits).includes(input.payerName), false);
    assert.equal(result.insurance.manual_identity_encrypted, undefined); assert.equal(result.insurance.manual_submission_digest, undefined);
    assert.equal(service.presentInsurance(record, { revealMemberId: true }).memberId, input.memberId);
    assert.equal(pool.calls.at(-1).sql, 'COMMIT');
  });
});

test('retry identity is stable for normalized fields/key case, rejects mismatches and preserves the actual stored status', async () => {
  await withKey(async () => {
    const pool = memoryPool(); const req = request();
    const first = await service.saveManualInsurance(pool, req, input);
    pool.state.records[0].eligibility_status = 'inactive';
    const repeated = await service.saveManualInsurance(pool, { ...req, headers: { 'idempotency-key': req.headers['idempotency-key'].toUpperCase() } }, { ...input, payerName: ' ' + input.payerName + ' ' });
    assert.equal(repeated.created, false); assert.equal(repeated.insurance.id, first.insurance.id);
    assert.equal(repeated.insurance.eligibility_status, 'inactive'); assert.equal(pool.state.records.length, 1);
    await assert.rejects(service.saveManualInsurance(pool, req, { ...input, memberId: 'Different content' }), (error) => error.status === 409);
    assert.equal(pool.state.records.length, 1); assert.equal(pool.state.audits.filter((audit) => audit[1] === 'create').length, 1);
  });
});

test('corrupt or misplaced encrypted identity fails closed, and audit failures roll back the record', async () => {
  await withKey(async () => {
    const pool = memoryPool(); await service.saveManualInsurance(pool, request(), input);
    const record = pool.state.records[0];
    for (const invalid of [{ ...record, user_id: otherPatientId }, { ...record, manual_submission_key: crypto.randomUUID() }, { ...record, manual_identity_encrypted: {} },
      { ...record, member_id: 'Do not use this plaintext fallback', manual_identity_encrypted: { ...record.manual_identity_encrypted, tag: '00'.repeat(16) } }]) {
      assert.throws(() => service.presentInsurance(invalid), (error) => error.status === 503);
    }
    const blocked = memoryPool({ failAudit: true });
    await assert.rejects(service.saveManualInsurance(blocked, request(), input));
    assert.equal(blocked.state.records.length, 0); assert.equal(blocked.state.audits.length, 0);
    assert.equal(blocked.calls.at(-1).sql, 'ROLLBACK');
  });
});

function loadSource(relativePath, dependencies) {
  const sourceModule = { exports: {} }; const filename = path.resolve(__dirname, '../..', relativePath);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: sourceModule, exports: sourceModule.exports,
    require(name) { assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name]; },
    console: { error() {}, warn() {} }, Buffer,
  }, { filename });
  return sourceModule.exports;
}

function routeParts(pool) {
  let user;
  const db = { pool, query: (...args) => pool.query(...args) };
  const noOp = () => (_req, _res, next) => next();
  const scope = loadSource('server/middleware/financialRecordScope.js', { '../db': db, '../utils/marketScope': { normalizeMarketScope } });
  const wallet = loadSource('server/services/insuranceWalletService.js', {
    '../db': db, '../middleware/logger': { error() {}, warn() {} }, '../../lib/encryption': encryption,
    './eligibilityService': require('../../server/services/eligibilityService'), '../utils/integrationReadiness': readiness, './manualInsuranceService': service,
  });
  const auth = { authenticate(req, res, next) { if (!user) return res.status(401).json({ success: false }); req.user = user; return next(); }, requireRole: noOp, canAccessPatient: (_req, _res, next) => next() };
  const insurance = loadSource('server/routes/insurance.js', {
    express, multer: require('multer'), '../db': db, '../middleware/auth': auth, '../middleware/audit': { auditMiddleware: noOp },
    '../services/insuranceWalletService': wallet, '../services/manualInsuranceService': service,
    '../services/ocrService': require('../../server/services/ocrService'), '../middleware/financialRecordScope': scope,
  });
  return { insurance, wallet, setUser(value) { user = value; } };
}

async function withHttp(parts, run) {
  const app = express(); app.use(express.json()); app.use('/api/insurance', parts.insurance);
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  try {
    await run((url, options = {}) => fetch(`http://127.0.0.1:${server.address().port}${url}`, options));
  } finally { await new Promise((resolve) => server.close(resolve)); }
}
function postOptions(key, details = input) { return { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(details) }; }

test('manual insurance HTTP boundary reports real creation/retry/conflict and rejects nonpatients before SQL', async () => {
  await withKey(async () => {
    const pool = memoryPool(); const parts = routeParts(pool); const key = crypto.randomUUID();
    await withHttp(parts, async (fetchRoute) => {
      assert.equal((await fetchRoute('/api/insurance/manual', postOptions(key))).status, 401);
      parts.setUser({ id: patientId, role: 'provider', marketScope: 'NG' });
      assert.equal((await fetchRoute('/api/insurance/manual', postOptions(key))).status, 403); assert.equal(pool.calls.length, 0);
      parts.setUser({ id: patientId, role: 'patient', marketScope: 'NG' });
      const first = await fetchRoute('/api/insurance/manual', postOptions(key)); assert.equal(first.status, 201);
      assert.equal(first.headers.get('cache-control'), 'private, no-store'); const created = await first.json();
      assert.equal(created.success, true); assert.equal(created.insurance.is_verified, false); assert.equal(created.insurance.eligibility_status, 'pending');
      const second = await fetchRoute('/api/insurance/manual', postOptions(key)); assert.equal(second.status, 200);
      assert.equal((await second.json()).insurance.id, created.insurance.id);
      assert.equal((await fetchRoute('/api/insurance/manual', postOptions(key, { ...input, memberId: 'Changed value' }))).status, 409);
      assert.equal((await fetchRoute('/api/insurance/manual', postOptions('invalid'))).status, 400);
    });
  });
});

const target = process.env.SIMULATION_DATABASE_URL;
test('PostgreSQL manual insurance migration, encryption, ownership, retries and wallet reads work with rolled-back writes', { skip: !target }, async () => {
  const url = new URL(target);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'), 'Only an isolated loopback test database is permitted');
  const { Pool } = require('pg'); const pool = new Pool({ connectionString: target }); const client = await pool.connect();
  await withKey(async () => {
    let baseline; let savepoint = 0; let current;
    try {
      baseline = (await client.query('SELECT COUNT(*)::int AS count FROM patient_insurance')).rows[0].count;
      await client.query('BEGIN');
      const migration = fs.readFileSync(path.resolve(__dirname, '../../server/db/migrations/037_encrypted_manual_insurance.sql'), 'utf8');
      await client.query(migration); await client.query(migration);
      const patient = (await client.query("SELECT id,market_scope FROM users WHERE email='patient@demo.doctarx.com' AND role='patient' AND market_scope='NG' AND is_active=TRUE")).rows[0];
      const other = (await client.query("SELECT id,market_scope FROM users WHERE email='government@demo.doctarx.com' AND role='patient' AND market_scope='NG' AND is_active=TRUE")).rows[0];
      const provider = (await client.query("SELECT id FROM users WHERE email='doctor@demo.doctarx.com' AND role='provider' AND is_active=TRUE")).rows[0];
      assert.ok(patient && other && provider, 'Use the existing demo accounts; this test never creates accounts');
      const wrapped = {
        async query(sql, parameters) {
          if (sql === 'BEGIN') { current = 'manual_insurance_test_' + ++savepoint; return client.query('SAVEPOINT ' + current); }
          if (sql === 'COMMIT') return client.query('RELEASE SAVEPOINT ' + current);
          if (sql === 'ROLLBACK') { await client.query('ROLLBACK TO SAVEPOINT ' + current); return client.query('RELEASE SAVEPOINT ' + current); }
          return client.query(sql, parameters);
        }, release() {},
      };
      const isolated = { connect: async () => wrapped, query: (...args) => client.query(...args) };
      const parts = routeParts(isolated); const key = crypto.randomUUID(); const req = request({ id: patient.id, role: 'patient', marketScope: 'NG' }, key);
      const created = await service.saveManualInsurance(isolated, req, input); const storedId = created.insurance.id;
      const stored = (await client.query('SELECT * FROM patient_insurance WHERE id=$1', [storedId])).rows[0];
      assert.equal(stored.member_id, null); assert.equal(stored.insurance_provider, null); assert.equal(stored.plan_name, null); assert.equal(stored.group_number, null);
      assert.equal(stored.is_primary, false); assert.equal(stored.is_verified, false); assert.equal(stored.verified_at, null); assert.equal(stored.eligibility_status, 'pending');
      assert.equal(service.presentInsurance(stored, { revealMemberId: true }).memberId, input.memberId);
      assert.equal(JSON.stringify(stored).includes(input.memberId), false);
      const retry = await service.saveManualInsurance(isolated, req, input); assert.equal(retry.insurance.id, storedId); assert.equal(retry.created, false);
      await assert.rejects(service.saveManualInsurance(isolated, req, { ...input, memberId: 'Changed member' }), (error) => error.status === 409);
      const otherEntry = await service.saveManualInsurance(isolated, request({ id: other.id, role: 'patient', marketScope: 'NG' }, key), input);
      assert.notEqual(otherEntry.insurance.id, storedId);
      await assert.rejects(service.saveManualInsurance(isolated, request({ id: provider.id, role: 'patient', marketScope: 'NG' }), input), (error) => error.status === 403);
      await assert.rejects(service.saveManualInsurance(isolated, request({ id: patient.id, role: 'patient', marketScope: 'US' }), input), (error) => error.status === 403);
      const wallet = await parts.wallet.getWallet(patient.id);
      const listed = wallet.find((card) => card.id === storedId); assert.ok(listed);
      assert.equal(listed.memberId, '••••9031'); assert.equal(listed.payerName, input.payerName); assert.equal(listed.planName, input.planName);
      assert.equal(listed.manual_identity_encrypted, undefined); assert.equal(listed.manual_submission_key, undefined);
      assert.equal(wallet.some((card) => card.id === otherEntry.insurance.id), false);
      const audit = (await client.query('SELECT action,new_values FROM audit_logs WHERE resource_id=$1 ORDER BY created_at', [storedId])).rows;
      assert.equal(audit.filter((row) => row.action === 'create').length, 1); assert.equal(JSON.stringify(audit).includes(input.memberId), false); assert.equal(JSON.stringify(audit).includes(input.payerName), false);
      parts.setUser({ id: patient.id, role: 'patient', marketScope: 'NG' });
      await withHttp(parts, async (fetchRoute) => {
        const response = await fetchRoute('/api/insurance/wallet'); assert.equal(response.status, 200);
        assert.ok((await response.json()).wallet.some((card) => card.id === storedId));
        parts.setUser({ id: other.id, role: 'patient', marketScope: 'NG' });
        assert.equal((await fetchRoute('/api/insurance/' + storedId)).status, 404);
        assert.equal((await fetchRoute('/api/insurance/' + storedId + '/export')).status, 404);
        assert.equal((await fetchRoute('/api/insurance/' + storedId + '/audit')).status, 404);
      });
      await client.query('SAVEPOINT malformed_manual_identity');
      await assert.rejects(client.query("UPDATE patient_insurance SET manual_identity_encrypted='{}'::jsonb WHERE id=$1", [storedId]), (error) => error.code === '23514');
      await client.query('ROLLBACK TO SAVEPOINT malformed_manual_identity');
      await client.query('RELEASE SAVEPOINT malformed_manual_identity');
      await client.query("UPDATE patient_insurance SET manual_identity_encrypted=jsonb_set(manual_identity_encrypted,'{tag}','\"00000000000000000000000000000000\"') WHERE id=$1", [storedId]);
      await assert.rejects(parts.wallet.getWallet(patient.id), (error) => error.status === 503);
    } finally {
      await client.query('ROLLBACK');
      assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM patient_insurance')).rows[0].count, baseline, 'All manual insurance writes must roll back');
      client.release(); await pool.end();
    }
  });
});
