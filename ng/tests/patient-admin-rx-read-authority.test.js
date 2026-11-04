'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ids = Object.fromEntries(['patient', 'admin', 'other', 'rx', 'provider', 'pharmacy'].map((name, index) => [name, `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]));
function load(relative, dependencies) {
  const filename = path.resolve(__dirname, relative), mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: mod, exports: mod.exports, console, Date, Math, JSON,
    require(name) { return Object.hasOwn(dependencies, name) ? dependencies[name] : require(name.startsWith('.') ? path.resolve(path.dirname(filename), name) : name); },
  }, { filename });
  return mod.exports;
}
function fixture(role = 'patient') {
  const actor = { id: role === 'patient' ? ids.patient : ids.admin, role };
  const state = { user: { ...actor, is_active: true, account_status: 'suspended', market_scope: 'US' },
    rx: { id: ids.rx, patient_user_id: ids.patient, provider_id: ids.provider, preferred_pharmacy_id: ids.pharmacy, routed_pharmacy_id: null, lifecycle_status: 'cancelled', created_at: '2026-01-01T00:00:00Z' },
    calls: [], audits: [], released: false, failAudit: false, failCommit: false };
  const client = { release() { state.released = true; }, async query(sql, params = []) {
    state.calls.push({ sql, params });
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      if (sql === 'COMMIT' && state.failCommit) throw new Error('Private database commit failure');
      if (sql === 'ROLLBACK') state.audits = [];
      return { rows: [] };
    }
    if (sql.startsWith('SELECT id,role FROM users')) {
      assert.match(sql, /is_active=TRUE FOR SHARE/);
      assert.doesNotMatch(sql, /market_scope|account_status/);
      return { rows: state.user && state.user.is_active && state.user.id === params[0] ? [state.user] : [] };
    }
    if (sql.startsWith('SELECT id,patient_user_id FROM ng_digital_prescriptions')) {
      assert.match(sql, /WHERE id=\$1 FOR SHARE/);
      return { rows: state.rx && state.rx.id === params[0] ? [{ id: state.rx.id, patient_user_id: state.rx.patient_user_id }] : [] };
    }
    if (sql.includes('SELECT p.*')) {
      let rows = state.rx ? [state.rx] : [];
      for (const field of ['provider_id', 'patient_user_id', 'lifecycle_status']) {
        const match = sql.match(new RegExp(`p\\.${field} = \\$(\\d+)`));
        if (match) rows = rows.filter(row => row[field] === params[Number(match[1]) - 1]);
      }
      const pharmacy = sql.match(/p.preferred_pharmacy_id = \$(\d+) OR p.routed_pharmacy_id = \$(\d+)/);
      if (pharmacy) rows = rows.filter(row => [row.preferred_pharmacy_id, row.routed_pharmacy_id].includes(params[Number(pharmacy[1]) - 1]));
      const since = sql.match(/p.created_at >= \$(\d+)/);
      if (since) rows = rows.filter(row => row.created_at >= params[Number(since[1]) - 1]);
      return { rows: rows.slice(0, params.at(-1)) };
    }
    if (sql.startsWith('SELECT * FROM ng_digital_prescriptions')) return { rows: state.rx ? [state.rx] : [] };
    if (sql.includes('SELECT * FROM ng_rx_items')) return { rows: [{ id: 'synthetic-item', quantity: 2, dispensed_quantity: 0 }] };
    if (sql.startsWith('SELECT EXISTS(SELECT 1 FROM ng_medication_events')) return { rows: [{ required: false }] };
    if (sql.includes('SELECT * FROM ng_rx_events')) return { rows: [{ id: 'synthetic-event', prescription_id: ids.rx }] };
    if (sql.includes('INSERT INTO audit_logs')) {
      if (state.failAudit) throw new Error('Private patient audit failure');
      assert.match(sql, /'read','digital_prescription'/); state.audits.push(params); return { rows: [] };
    }
    throw new Error('Unexpected read SQL: ' + sql);
  } };
  const workflow = load('../services/rx-engine/prescriptionWorkflowService.js', { '../../../server/db': { getPool() { throw new Error('Global pool forbidden'); }, transaction() { throw new Error('Nested transaction forbidden'); } } });
  const service = load('../services/rx-engine/patientAdminRxReadService.js', { './prescriptionWorkflowService': workflow });
  return { actor, state, client, workflow, service, pool: { connect: async () => client } };
}
const operations = ['list', 'detail', 'events'];
const invoke = (f, operation, query = {}) => operation === 'list' ? f.service.list(f.pool, f.actor, query) : f.service.read(f.pool, f.actor, ids.rx, operation === 'events');
const privateRead = sql => /SELECT \* FROM ng_|SELECT p\.\*/.test(sql);

test('all six patient/admin operations recheck current active role before PHI', async () => {
  for (const role of ['patient', 'admin']) for (const operation of operations) for (const patch of [null, { is_active: false }, { role: 'provider' }, { role: role === 'patient' ? 'admin' : 'patient' }]) {
    const f = fixture(role); f.state.user = patch === null ? null : { ...f.state.user, ...patch };
    await assert.rejects(invoke(f, operation), { code: 'FORBIDDEN' });
    assert.equal(f.state.calls.some(({ sql }) => /ng_digital_prescriptions|INSERT/.test(sql)), false);
    assert.equal(f.state.calls.at(-1).sql, 'ROLLBACK'); assert.equal(f.state.released, true);
  }
});
test('patient ownership is locked and checked before detail/items/events; missing Rx has no content read', async () => {
  for (const operation of ['detail', 'events']) for (const missing of [false, true]) {
    const f = fixture(); if (missing) f.state.rx = null; else f.state.rx.patient_user_id = ids.other;
    await assert.rejects(invoke(f, operation), { code: missing ? 'NOT_FOUND' : 'FORBIDDEN' });
    assert.equal(f.state.calls.some(({ sql }) => privateRead(sql) || sql.includes('INSERT')), false);
  }
});
test('six reads preserve lifecycle/market/account policy and audit with one client before commit', async () => {
  for (const role of ['patient', 'admin']) for (const operation of operations) {
    const f = fixture(role); const result = await invoke(f, operation); assert.ok(result);
    assert.equal(f.state.calls[0].sql, 'BEGIN'); assert.equal(f.state.calls.at(-1).sql, 'COMMIT');
    assert.equal(f.state.calls.filter(({ sql }) => sql === 'BEGIN').length, 1);
    assert.equal(f.state.audits.length, 1); assert.equal(f.state.audits[0][0], f.actor.id);
    assert.match(f.state.calls.at(-2).sql, /INSERT INTO audit_logs/);
    assert.equal(f.state.calls.some(({ sql }) => /INSERT INTO ng_|UPDATE |DELETE /.test(sql)), false);
    if (operation === 'list') assert.match(f.state.calls.find(({ sql }) => sql.includes('SELECT p.*')).sql, /FOR SHARE OF p/);
    else assert.ok(f.state.calls.findIndex(({ sql }) => /id=\$1 FOR SHARE/.test(sql)) < f.state.calls.findIndex(({ sql }) => privateRead(sql)));
    assert.equal(f.state.released, true);
  }
});
test('patient list ignores foreign authority filters while retaining status/since/default and bounded limit', async () => {
  const f = fixture();
  assert.equal((await invoke(f, 'list', { provider_id: ids.other, patient_user_id: ids.other, pharmacy_id: ids.other })).length, 1);
  let call = f.state.calls.find(({ sql }) => sql.includes('SELECT p.*'));
  assert.deepEqual(Array.from(call.params), [ids.patient, 50]); assert.doesNotMatch(call.sql, /p.provider_id =|p.preferred_pharmacy_id =/);
  assert.equal((await invoke(f, 'list', { status: 'drafted' })).length, 0);
  assert.equal((await invoke(f, 'list', { since: '2027-01-01T00:00:00Z' })).length, 0);
  await invoke(f, 'list', { limit: '9999' }); call = f.state.calls.filter(({ sql }) => sql.includes('SELECT p.*')).at(-1); assert.equal(call.params.at(-1), 500);
});
test('admin list retains all filters including preferred OR routed pharmacy; workflow default remains unlocked', async () => {
  const f = fixture('admin'), filters = { provider_id: ids.provider, patient_user_id: ids.patient, pharmacy_id: ids.pharmacy, status: 'cancelled', since: '2025-01-01T00:00:00Z', limit: '25' };
  assert.equal((await invoke(f, 'list', filters)).length, 1);
  const call = f.state.calls.find(({ sql }) => sql.includes('SELECT p.*'));
  assert.deepEqual(Array.from(call.params), [ids.provider, ids.patient, ids.pharmacy, 'cancelled', filters.since, 25]);
  assert.match(call.sql, /ORDER BY p.created_at DESC/);
  f.state.rx.preferred_pharmacy_id = null; f.state.rx.routed_pharmacy_id = ids.pharmacy;
  assert.equal((await invoke(f, 'list', filters)).length, 1);
  for (const key of ['provider_id', 'patient_user_id', 'pharmacy_id']) assert.equal((await invoke(f, 'list', { ...filters, [key]: ids.other })).length, 0);
  await f.workflow.listPrescriptions({}, f.client); assert.doesNotMatch(f.state.calls.at(-1).sql, /FOR SHARE/); assert.equal(f.state.calls.at(-1).params.at(-1), 50);
});
test('existing admin role aliases and authenticated canonical super-admin remain compatible without raw alias expansion', async () => {
  for (const role of ['admin', 'administrator', 'super_admin', 'superadmin', 'platform_admin', ' SUPER ADMIN ']) {
    const f = fixture(role); assert.equal((await invoke(f, 'list')).length, 1);
  }
  const f = fixture('super_admin'); f.state.user.role = 'super-admin'; assert.equal((await invoke(f, 'list')).length, 1);
  for (const role of ['super-admin', 'provider', 'pharmacist', '', 'administrator-extra']) {
    const f = fixture(role); await assert.rejects(invoke(f, 'list'), { code: 'FORBIDDEN' }); assert.equal(f.state.calls.length, 0);
  }
});
test('audit and commit failures release clients, rollback and never return data; private errors sanitized', async () => {
  for (const role of ['patient', 'admin']) for (const operation of operations) for (const failure of ['failAudit', 'failCommit']) {
    const f = fixture(role); f.state[failure] = true; await assert.rejects(invoke(f, operation));
    assert.equal(f.state.calls.at(-1).sql, 'ROLLBACK'); assert.equal(f.state.audits.length, 0); assert.equal(f.state.released, true);
    const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    f.service.sendError(response, new Error('Private patient database SQL')); assert.equal(response.code, 503); assert.doesNotMatch(JSON.stringify(response.body), /Private patient|SQL/);
  }
});

test('mounted patient/admin reads enforce gateway and cache headers; professional reads and patient refill keep their routes', async () => {
  const express = require('express'); let active = fixture(); const routed = [];
  const professional = label => ({ list: async () => { routed.push(label + ':list'); return []; }, read: async (_pool, _actor, _id, events) => { routed.push(label + (events ? ':events' : ':detail')); return {}; } });
  const boundary = Object.fromEntries(['list', 'read', 'sendError'].map(name => [name, (...args) => active.service[name](...args)]));
  const router = load('../routes/prescriptions.js', { express, '../services/rx-engine/patientAdminRxReadService': boundary,
    '../services/rx-engine/prescriberRxService': professional('provider'), '../services/pharmacy/pharmacistRxService': professional('pharmacist'),
    '../services/rx-engine/prescriptionWorkflowService': { async requestPatientRefill(id, item, actor, body, pool) { assert.equal(id, ids.rx); assert.equal(actor.kind, 'patient'); assert.equal(pool, active.pool); routed.push('patient:refill'); return { id: 'refill' }; } },
    '../../server/db': { getPool: () => active.pool },
  });
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.user = active.actor; next(); }); app.use('/rx', router);
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const http = async (suffix, method = 'GET') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/rx${suffix}`, { method, ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: '{}' } : {}) });
    assert.equal(response.headers.get('cache-control'), 'private, no-store'); return { status: response.status, body: await response.json() };
  };
  try {
    for (const role of ['patient', 'admin']) for (const suffix of ['/', `/${ids.rx}`, `/${ids.rx}/events`]) {
      active = fixture(role); assert.equal((await http(suffix)).status, 200); assert.equal(active.state.calls.at(-1).sql, 'COMMIT');
      active = fixture(role); active.state.user.is_active = false; assert.equal((await http(suffix)).status, 403);
      for (const failure of ['failAudit', 'failCommit']) { active = fixture(role); active.state[failure] = true; const response = await http(suffix); assert.equal(response.status, 503); assert.doesNotMatch(JSON.stringify(response.body), /Private|synthetic|patient_user_id/); }
    }
    for (const role of ['provider', 'pharmacist']) for (const suffix of ['/', `/${ids.rx}`, `/${ids.rx}/events`]) { active = fixture(role); assert.equal((await http(suffix)).status, 200); assert.equal(active.state.calls.length, 0); }
    active = fixture(); assert.equal((await http(`/${ids.rx}/refill`, 'POST')).status, 201);
    assert.deepEqual(routed, ['provider:list', 'provider:detail', 'provider:events', 'pharmacist:list', 'pharmacist:detail', 'pharmacist:events', 'patient:refill']);
    active = fixture('admin'); assert.equal((await http(`/${ids.rx}/sign`, 'POST')).status, 403); assert.equal((await http(`/${ids.rx}/refill`, 'POST')).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('list audit records only returned identities and count, including an empty list', async () => {
  for (const role of ['patient', 'admin']) {
    const f = fixture(role); f.state.rx.notes = 'Private clinical narrative'; f.state.rx.diagnosis = 'Private diagnosis';
    await invoke(f, 'list', { patient_user_id: role === 'patient' ? ids.other : ids.patient });
    assert.deepEqual(JSON.parse(f.state.audits.at(-1)[4]), { recordCount: 1, records: [{ id: ids.rx, patientId: ids.patient }] });
    assert.doesNotMatch(f.state.audits.at(-1)[4], /Private|notes|diagnosis/);
    await invoke(f, 'list', { status: 'drafted' });
    assert.deepEqual(JSON.parse(f.state.audits.at(-1)[4]), { recordCount: 0, records: [] });
    for (const operation of ['detail', 'events']) { await invoke(f, operation); assert.equal(f.state.audits.at(-1)[4], null); assert.equal(f.state.audits.at(-1)[1], ids.rx); assert.equal(f.state.audits.at(-1)[2], ids.patient); }
  }
});

test('optional PostgreSQL suite rejects unsafe URL and effective Pool before any connection', async () => {
  const { fixtureTargetSafety } = require('../scripts/fixtureTargetSafety');
  const local = 'postgresql://fixture@127.0.0.1:5432/patient_admin_reads_test';
  const filename = path.resolve(__dirname, 'patient-admin-rx-read-authority-db.test.js');
  for (const [env, poolOptions] of [
    [{ NODE_ENV: 'test', SIMULATION_DATABASE_URL: local + '?host=remote.example' }, null],
    [{ NODE_ENV: 'test', SIMULATION_DATABASE_URL: local + '?database=production' }, null],
    [{ NODE_ENV: 'test', SIMULATION_DATABASE_URL: 'postgresql://fixture@remote.example/patient_admin_reads_test' }, null],
    [{ NODE_ENV: 'production', SIMULATION_DATABASE_URL: local }, null],
    [{ NODE_ENV: 'test', SIMULATION_DATABASE_URL: local }, { connectionString: local, host: 'remote.example' }],
  ]) {
    let callback, constructors = 0;
    const refuse = () => { throw new Error('Unsafe fixture must not connect or execute SQL'); };
    const dependencies = {
      'node:test': (_name, _options, run) => { callback = run; }, 'node:assert/strict': assert, 'node:crypto': require('node:crypto'),
      pg: { Pool: class { constructor() { constructors++; assert.ok(poolOptions, 'Guard must precede Pool construction'); this.options = poolOptions; } query = refuse; connect = refuse; end = refuse; } },
      '../services/rx-engine/patientAdminRxReadService': {},
      '../scripts/fixtureTargetSafety': { fixtureTargetSafety: options => fixtureTargetSafety({ ...options, env }) },
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { process: { env }, require(name) { assert.ok(name in dependencies, name); return dependencies[name]; } }, { filename });
    await assert.rejects(callback({}), /Fixture writes|supplied database pool/);
    assert.equal(constructors, poolOptions ? 1 : 0);
  }
});

test('missing actor id never becomes an unfiltered patient list or an admin read', async () => {
  for (const role of ['patient', 'admin']) for (const operation of operations) for (const actor of [undefined, { role }, { role, userId: ids.patient }, { role, id: '' }]) {
    const f = fixture(role); f.actor = actor; f.pool.connect = async () => { assert.fail('Missing actor id must be rejected before opening a transaction'); };
    await assert.rejects(invoke(f, operation), { code: 'FORBIDDEN' }); assert.equal(f.state.calls.length, 0);
  }
});
