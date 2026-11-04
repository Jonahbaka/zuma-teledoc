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
const marketScope = require('../utils/marketScope');
const readiness = require('../utils/integrationReadiness');
const { fixtureTargetSafety } = require('../../ng/scripts/fixtureTargetSafety');
const { getUSPatientControl } = require('../../ng/tests/helpers/isolated-market-controls');
const id = crypto.randomUUID();
const providerId = crypto.randomUUID();
const recordId = crypto.randomUUID();
const actor = (role = 'patient') => ({ id, role, marketScope: 'NG' });

function load(relative, dependencies) {
  const sourceModule = { exports: {} }; const filename = path.resolve(__dirname, '../..', relative);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: sourceModule, exports: sourceModule.exports,
    require(name) { assert.ok(name in dependencies, 'Unexpected legacy Rx dependency ' + name); return dependencies[name]; } }, { filename });
  return sourceModule.exports;
}
function parts(pool) {
  let user; const logs = [];
  const database = { pool, query: (...args) => pool.query(...args) };
  const scope = load('server/middleware/financialRecordScope.js', { '../db': database, '../utils/marketScope': marketScope });
  const service = load('server/services/prescriptionService.js', { '../db': database, '../../lib/utils': utils, zod: { z }, '../utils/integrationReadiness': readiness, '../middleware/financialRecordScope': scope });
  const router = load('server/routes/prescriptions.js', { express, '../middleware/auth': {
    authenticate(req, res, next) { if (!user) return res.status(401).json({ success: false }); req.user = user; next(); },
    requireRole(roles) { return (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ success: false }); },
  }, '../middleware/audit': { auditMiddleware: () => (_req, _res, next) => next() }, '../services/prescriptionService': service, '../middleware/logger': { warn: (...args) => logs.push(args) } });
  return { service, router, logs, setUser(value) { user = value; } };
}
async function serve(parts, run) {
  const app = express(); app.use(express.json()); app.use('/api/prescriptions', parts.router);
  const server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  try { await run(async (suffix = '', method = 'GET', body) => { const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/prescriptions' + suffix, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }); return { response, body: await response.json() }; }); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('legacy create, send, pharmacy change, cancellation, refill and unverified catalog cannot produce clinical success or storage changes', async () => {
  let queries = 0;
  const api = parts({ connect() { queries++; throw new Error('No legacy operation may touch storage'); } });
  await serve(api, async (request) => {
    assert.equal((await request('/' + recordId + '/history')).response.status, 401);
    api.setUser(actor('provider'));
    for (const [suffix, method] of [['', 'POST'], ['/' + recordId + '/sign-and-send', 'POST'], ['/' + recordId + '/pharmacy', 'PUT'], ['/' + recordId + '/cancel', 'POST'], ['/medications/search?q=unverified', 'GET']]) {
      const { response, body } = await request(suffix, method, method === 'GET' ? undefined : { medicationName: 'Never logged or stored', patientId: id });
      assert.equal(response.status, 503); assert.equal(body.status, 'unavailable'); assert.equal(body.success, false); assert.equal(body.code, 'INTEGRATION_NOT_ACTIVATED');
    }
    api.setUser(actor());
    const refill = await request('/' + recordId + '/refill', 'POST', {}); assert.equal(refill.response.status, 503); assert.equal(refill.body.prescription, undefined);
    assert.equal((await request('', 'POST', {})).response.status, 403);
    assert.equal((await request('/not-a-uuid/history')).response.status, 400);
  });
  assert.equal(queries, 0); assert.equal(JSON.stringify(api.logs).includes('Never logged or stored'), false);
  for (const method of ['createPrescription', 'signAndSend', 'updatePharmacy', 'cancelPrescription', 'requestRefill', 'searchMedications']) await assert.rejects(api.service[method](), (error) => error.statusCode === 503);
  assert.equal(queries, 0);
});

test('unsupported and stale readers are denied before prescription/history retrieval; audit failure returns no PHI', async () => {
  for (const current of [{ id, role: 'patient', is_active: false, market_scope: 'NG' }, { id, role: 'provider', is_active: true, provider_status: 'pending', market_scope: 'NG' }, { id, role: 'patient', is_active: true, market_scope: 'US' }]) {
    const calls = []; const pool = { async connect() { return { async query(sql) { calls.push(sql); return { rows: sql.includes('FROM users WHERE') ? [current] : [] }; }, release() {} }; } };
    const api = parts(pool); api.setUser(actor(current.role));
    await serve(api, async (request) => { const result = await request('/' + recordId + '/history'); assert.equal(result.response.status, 403); assert.equal(result.body.history, undefined); });
    assert.equal(calls.some((sql) => sql.includes('FROM prescriptions') || sql.includes('FROM prescription_history')), false);
  }
  let queries = 0; const forbidden = parts({ connect() { queries++; throw new Error('Unsupported roles cannot query'); } }); forbidden.setUser(actor('pharmacy'));
  await serve(forbidden, async (request) => { assert.equal((await request('/' + recordId)).response.status, 403); assert.equal((await request('/' + recordId + '/history')).response.status, 403); });
  assert.equal(queries, 0);
  const current = { id, role: 'patient', is_active: true, market_scope: 'NG' };
  const calls = [];
  const auditFailure = parts({ async connect() { return { async query(sql) { calls.push(sql); if (sql.includes('FROM users WHERE')) return { rows: [current] }; if (sql.includes('FROM prescriptions')) return { rows: [{ id: recordId, patient_id: id, provider_id: providerId, medication_name: 'Private recorded drug' }] }; if (sql.includes('FROM prescription_history')) return { rows: [{ id: crypto.randomUUID(), new_values: { medication: 'Private history' } }] }; if (sql.includes('INSERT INTO audit_logs')) throw new Error('Private raw database failure'); return { rows: [] }; }, release() {} }; } });
  auditFailure.setUser(actor());
  await serve(auditFailure, async (request) => { const result = await request('/' + recordId + '/history'); assert.equal(result.response.status, 503); assert.equal(result.body.history, undefined); assert.equal(JSON.stringify(result.body).includes('Private'), false); });
  assert.ok(calls.includes('ROLLBACK'));
});


// Contract tests use the expression emitted by the real service, not a parallel
// implementation of its market policy. The optional PostgreSQL check below also
// executes this exact expression, while the hermetic matrix needs no database.
const marketCases = [
  ['NG', null, null, 'NG'], [' ng ', 'US', 'US', 'NG'],
  [' Nigeria ', null, 'US', 'NG'], ['US', 'NG', 'NG', 'US'],
  [' usa ', null, null, 'US'], [' united states ', null, null, 'US'],
  [' United States of America ', null, null, 'US'],
  ['', 'NG', 'US', 'NG'], ['   ', ' nigeria ', 'US', 'NG'],
  [null, ' NG ', 'US', 'NG'], [null, '', ' nigeria ', 'NG'],
  ['', ' ', ' usa ', 'US'], [null, null, ' United States ', 'US'],
  ['CA', 'NG', 'US', null], ['unknown', 'US', 'NG', null],
  [null, 'CA', 'NG', null], ['', '', 'CA', null],
  [null, null, null, null], ['', '', '', null], [' ', ' ', ' ', null],
  ['\tNG\t', null, null, null], ['\nUS', null, null, null], ['\t', 'NG', null, null],
];
function marketExpression(scope) {
  const expression = scope.match(/CASE\b[\s\S]*?\bEND/);
  assert.ok(expression, 'scope must contain an explicit fail-closed market CASE');
  assert.equal((scope.match(/\bCASE\b/g) || []).length, 1);
  const compact = expression[0].replace(/\s+/g, ' ').trim();
  const clauses = [...compact.matchAll(/WHEN (UPPER\(.*?\)) IN \(([^)]+)\) THEN '(NG|US)'/g)];
  assert.equal(clauses.length, 2);
  for (const clause of clauses) {
    assert.match(clause[1], /^UPPER\(COALESCE\(NULLIF\(TRIM\(pat\.market_scope\),\s*''\),\s*NULLIF\(TRIM\(pat\.region::text\),\s*''\),\s*NULLIF\(TRIM\(pat\.country\),\s*''\),\s*''\)\)$/);
  }
  assert.equal(clauses[0][1], clauses[1][1], 'recognition and matching normalize identically');
  assert.equal(compact, 'CASE ' + clauses.map((clause) => clause[0]).join(' ') + ' ELSE NULL END');
  const branches = clauses.flatMap((clause) => clause[2].split(',').map((alias) => {
    assert.match(alias.trim(), /^'[^']+'$/);
    return [alias.trim().slice(1, -1), clause[3]];
  }));
  assert.deepEqual(branches.sort(), [
    ['NG', 'NG'], ['NIGERIA', 'NG'], ['US', 'US'], ['USA', 'US'],
    ['UNITED STATES', 'US'], ['UNITED STATES OF AMERICA', 'US'],
  ].sort());
  assert.match(scope.slice(expression.index + expression[0].length), /^\s*=\s*\$2/);
  return {
    sql: expression[0],
    evaluate(row) {
      // PostgreSQL TRIM without a character argument removes spaces, not tabs.
      const value = [row.market_scope, row.region, row.country]
        .map((item) => item == null ? '' : String(item).replace(/^ +| +$/g, ''))
        .find((item) => item !== '') || '';
      return branches.find((branch) => branch[0] === value.toUpperCase())?.[1] ?? null;
    },
  };
}

test('legacy recorded market scope has one canonical trimmed, blank-skipping, fail-closed CASE', () => {
  const scope = parts({}).service._scope();
  const expression = marketExpression(scope);
  for (const [market_scope, region, country, expected] of marketCases) {
    assert.equal(expression.evaluate({ market_scope, region, country }), expected, JSON.stringify([market_scope, region, country]));
  }
  assert.match(scope, /pat\.role='patient' AND pat\.is_active=TRUE/);
  assert.match(scope, /\$3 IN \('admin','super_admin'\) OR \$3='patient' AND p\.patient_id=\$4 OR \$3='provider' AND p\.provider_id=\$4/);
  assert.match(scope, /\$3<>'provider' OR EXISTS \(SELECT 1 FROM appointments a WHERE a\.patient_id=p\.patient_id AND a\.provider_id=\$4\)/);
});

test('actual legacy detail, history and list queries share canonical market scope and durable audit boundaries', async () => {
  for (const [market_scope, region, country, expected] of marketCases) {
    for (const market of ['NG', 'US']) for (const role of ['patient', 'provider', 'admin', 'super_admin']) {
      const session = { id, role, marketScope: market };
      const current = { id, role, market_scope: market, is_active: true, provider_status: 'approved' };
      const patient = { market_scope, region, country };
      let calls = []; let failAudit = false;
      const record = { id: recordId, patient_id: id, provider_id: id, medication_name: 'Private matrix medication' };
      const api = parts({ async connect() { return { async query(sql, parameters) {
        calls.push({ sql, parameters });
        if (sql.includes('FROM users WHERE')) return { rows: [current] };
        if (sql.includes('FROM prescriptions')) {
          assert.ok(sql.includes(api.service._scope()), 'every read must use the same scope');
          assert.equal(parameters[1], market); assert.equal(parameters[2], role); assert.equal(parameters[3], id);
          return { rows: marketExpression(sql).evaluate(patient) === market ? [record] : [] };
        }
        if (sql.includes('FROM prescription_history')) return { rows: [{ id: recordId, new_values: { marker: 'Private matrix history' } }] };
        if (sql.includes('INSERT INTO audit_logs')) {
          assert.equal(parameters[0], id);
          assert.equal(JSON.stringify(parameters).includes('Private'), false);
          if (failAudit) throw new Error('Private audit outage');
        }
        return { rows: [] };
      }, release() {} }; } });
      const operations = [
        ['detail', () => api.service.getPrescriptionById(recordId, session)],
        ['history', () => api.service.getPrescriptionHistory(recordId, session)],
        ['list', () => role === 'patient' ? api.service.getPatientPrescriptions(id, {}, session) : api.service.getProviderPrescriptions(id, {}, session)],
      ];
      for (const [operation, invoke] of operations) {
        calls = [];
        const allowed = expected === market;
        if (!allowed && operation !== 'list') {
          await assert.rejects(invoke(), (error) => error.statusCode === 404 && error.code === 'PRESCRIPTION_NOT_FOUND');
          assert.equal(calls.some(({ sql }) => sql.includes('FROM prescription_history') || sql.includes('INSERT INTO audit_logs')), false);
          assert.equal(calls.at(-1).sql, 'ROLLBACK');
        } else {
          const result = await invoke();
          if (operation === 'list') assert.equal(result.length, allowed ? 1 : 0);
          assert.equal(calls.filter(({ sql }) => sql.includes('INSERT INTO audit_logs')).length, 1);
          assert.equal(calls.at(-1).sql, 'COMMIT');
          if (allowed) {
            failAudit = true; calls = [];
            await assert.rejects(invoke(), /Private audit outage/);
            assert.equal(calls.at(-1).sql, 'ROLLBACK');
            assert.equal(calls.some(({ sql }) => sql === 'COMMIT'), false);
            failAudit = false;
          }
        }
      }
    }
  }
});

// Keep validation in the same path as the optional integration test, before
// constructing a Pool and again before connect/query. Never use DATABASE_URL.
async function isolatedFixturePool(env = process.env, createPool = (options) => new (require('pg').Pool)(options)) {
  const safety = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL', env });
  assert.equal(safety.skipped, false, safety.reason);
  const pool = createPool({ connectionString: env.SIMULATION_DATABASE_URL, statement_timeout: 10000 });
  const effective = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL', pool, env });
  if (effective.skipped) { await pool.end(); assert.fail(effective.reason); }
  return pool;
}

test('legacy optional fixture rejects unsafe targets before Pool construction and contradictory pools before connect/query', async () => {
  const safe = 'postgresql://fixture:fixture@127.0.0.1:5432/legacy_test';
  let constructions = 0; let ended = 0;
  for (const value of [undefined, '', 'not a URL', 'https://127.0.0.1/legacy_test',
    'postgresql://remote.invalid/legacy_test', 'postgresql://localhost/production',
    safe + '?host=remote.invalid', safe + '?database=production', safe + '#fragment']) {
    await assert.rejects(isolatedFixturePool({ NODE_ENV: 'test', SIMULATION_DATABASE_URL: value, DATABASE_URL: safe }, () => { constructions++; }));
  }
  await assert.rejects(isolatedFixturePool({ NODE_ENV: ' Production ', SIMULATION_DATABASE_URL: safe }, () => { constructions++; }));
  assert.equal(constructions, 0);
  for (const options of [{ connectionString: safe, host: 'remote.invalid' },
    { connectionString: safe, database: 'production' }, { connectionString: safe, port: 6543 },
    { connectionString: safe, stream: {} }, { host: '127.0.0.1', database: 'different_test', port: 5432 }]) {
    await assert.rejects(isolatedFixturePool({ NODE_ENV: 'test', SIMULATION_DATABASE_URL: safe }, () => ({
      options, async end() { ended++; }, connect() { assert.fail('unsafe pool connected'); }, query() { assert.fail('unsafe pool queried'); },
    })));
  }
  assert.equal(ended, 5);
  const verified = await isolatedFixturePool({ NODE_ENV: 'test', SIMULATION_DATABASE_URL: safe }, (options) => ({ options }));
  assert.equal(verified.options.connectionString, safe);
});

const target = process.env.SIMULATION_DATABASE_URL;
test('actual PostgreSQL/HTTP history and lists enforce current actor, owning care, supported market and durable audit with rollback-only controls', { skip: !target }, async () => {
  const pool = await isolatedFixturePool(); const client = await pool.connect(); let sequence = 0; let savepoint; let failAudit = false;
  const baseline = (await client.query('SELECT COUNT(*)::int AS count FROM prescriptions')).rows[0].count;
  try {
    await client.query('BEGIN');
    const expression = marketExpression(parts({}).service._scope());
    for (const [market_scope, region, country, expected] of marketCases) {
      const result = await client.query(`SELECT ${expression.sql} AS market FROM (VALUES ($1::text,$2::text,$3::text)) AS pat(market_scope,region,country)`, [market_scope, region, country]);
      assert.equal(result.rows[0].market, expected);
    }
    const patient = (await client.query("SELECT id FROM users WHERE email='patient@demo.doctarx.com' AND is_active=TRUE AND role='patient' AND market_scope='NG'")).rows[0];
    const other = (await client.query("SELECT id FROM users WHERE email='government@demo.doctarx.com' AND is_active=TRUE AND role='patient' AND market_scope='NG'")).rows[0];
    const provider = (await client.query("SELECT id FROM users WHERE email='doctor@demo.doctarx.com' AND is_active=TRUE AND role='provider' AND provider_status='approved' AND market_scope='NG'")).rows[0];
    const administrator = (await client.query("SELECT id,role FROM users WHERE is_active=TRUE AND role IN ('admin','super_admin') AND market_scope='NG' ORDER BY id LIMIT 1")).rows[0];
    const us = await getUSPatientControl(client); assert.ok(patient && other && provider && administrator && us);
    const insert = async (patientId) => (await client.query("INSERT INTO prescriptions (patient_id,provider_id,medication_name,dosage_strength,dosage_form,quantity,days_supply,sig_directions,status) VALUES ($1,$2,'Rollback-only recorded medication','test-only strength','test-only form',1,1,'Test-only instructions','draft') RETURNING id", [patientId, provider.id])).rows[0].id;
    const own = await insert(patient.id); const foreign = await insert(other.id); const crossMarket = await insert(us.id);
    await client.query("INSERT INTO prescription_history (prescription_id,action,performed_by,new_values) VALUES ($1,'created',$2,$3::jsonb)", [own, provider.id, JSON.stringify({ testOnly: true, marker: 'Owned rollback history' })]);
    await client.query("INSERT INTO appointments (patient_id,provider_id,scheduled_at,status) VALUES ($1,$2,NOW(),'completed')", [patient.id, provider.id]);
    const wrapped = { async query(sql, parameters) {
      if (sql === 'BEGIN') { savepoint = 'legacy_rx_' + ++sequence; return client.query('SAVEPOINT ' + savepoint); }
      if (sql === 'COMMIT') return client.query('RELEASE SAVEPOINT ' + savepoint);
      if (sql === 'ROLLBACK') { await client.query('ROLLBACK TO SAVEPOINT ' + savepoint); return client.query('RELEASE SAVEPOINT ' + savepoint); }
      if (failAudit && sql.includes('INSERT INTO audit_logs')) throw new Error('Test-only audit outage');
      return client.query(sql, parameters);
    }, release() {} };
    const api = parts({ connect: async () => wrapped });
    const session = (current, role = 'patient', marketScope = 'NG') => ({ id: current.id, role, marketScope });
    api.setUser(session(patient));
    await serve(api, async (request) => {
      const history = await request('/' + own + '/history'); assert.equal(history.response.status, 200); assert.ok(history.body.history.some((row) => row.newValues.marker === 'Owned rollback history')); assert.equal(history.response.headers.get('cache-control'), 'private, no-store');
      assert.equal((await request('/' + foreign + '/history')).response.status, 404); assert.equal((await request('/' + crossMarket)).response.status, 404);
      const listing = await request(''); assert.equal(listing.response.status, 200); assert.ok(listing.body.prescriptions.some((row) => row.id === own)); assert.ok(listing.body.prescriptions.every((row) => row.patientId === patient.id));
      assert.equal((await request('?patientId=' + other.id)).response.status, 404); assert.equal((await request('?limit=-1')).response.status, 400);
      api.setUser(session(provider, 'patient')); assert.equal((await request('/' + own + '/history')).response.status, 403);
      api.setUser(session(provider, 'provider'));
      assert.equal((await request('/' + own)).response.status, 200); assert.equal((await request('/' + crossMarket + '/history')).response.status, 404);
      const providerList = await request(''); assert.equal(providerList.response.status, 200); assert.ok(providerList.body.prescriptions.some((row) => row.id === own)); assert.equal(providerList.body.prescriptions.some((row) => row.id === crossMarket), false);
      api.setUser(session(administrator, administrator.role)); assert.equal((await request('/' + own + '/history')).response.status, 200); assert.equal((await request('/' + crossMarket)).response.status, 404);
      api.setUser(session(patient)); failAudit = true;
      const unavailable = await request('/' + own + '/history'); assert.equal(unavailable.response.status, 503); assert.equal(unavailable.body.history, undefined); failAudit = false;
      const before = (await client.query('SELECT status,refills_remaining,erx_sent_at FROM prescriptions WHERE id=$1', [own])).rows[0];
      assert.equal((await request('/' + own + '/refill', 'POST', {})).response.status, 503);
      assert.deepEqual((await client.query('SELECT status,refills_remaining,erx_sent_at FROM prescriptions WHERE id=$1', [own])).rows[0], before);
    });
  } finally { await client.query('ROLLBACK'); assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM prescriptions')).rows[0].count, baseline); client.release(); await pool.end(); }
});
