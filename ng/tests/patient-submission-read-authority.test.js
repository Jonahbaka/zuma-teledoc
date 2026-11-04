'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ids = Object.fromEntries(['patient', 'other', 'rx', 'key'].map((key, index) => [key, `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', 'base64');
function load(relative, dependencies) {
  const filename = path.resolve(__dirname, relative), mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: mod, exports: mod.exports, Buffer, process, console,
    require(name) { assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`); return dependencies[name]; },
  }, { filename });
  return mod.exports;
}
function fixture() {
  const state = { user: { id: ids.patient, role: 'patient', market_scope: 'NG', is_active: true, account_status: 'suspended' },
    rx: { id: ids.rx, patient_user_id: ids.patient, submission_key: ids.key, status: 'uploaded', image_data_encrypted: { encrypted: 'synthetic' } },
    calls: [], audits: [], decrypted: 0, released: false };
  const client = { release(error) { state.released = true; state.releaseError = error; }, async query(sql, params = []) {
    state.calls.push({ sql, params });
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) {
      if (sql === 'COMMIT' && state.failCommit) throw new Error('Private commit detail');
      if (sql === 'ROLLBACK') { if (state.failRollback) throw new Error('Private rollback detail'); state.audits = []; }
      return { rows: [] };
    }
    if (sql.startsWith('SELECT id FROM users')) {
      assert.match(sql, /role='patient' AND market_scope='NG' AND is_active=true FOR SHARE$/);
      assert.doesNotMatch(sql, /account_status/);
      const u = state.user;
      return { rows: u && u.id === params[0] && u.role === 'patient' && u.market_scope === 'NG' && u.is_active === true ? [u] : [] };
    }
    if (sql.includes('FROM ng_prescriptions')) {
      assert.match(sql, /FOR SHARE/);
      const receipt = sql.includes('rx.submission_key');
      if (receipt) { assert.match(sql, /rx.patient_user_id = \$1 AND rx.submission_key = \$2/); assert.match(sql, /FOR SHARE OF rx/); }
      else assert.match(sql, /WHERE id=\$1 AND patient_user_id=\$2 FOR SHARE/);
      const rx = state.rx;
      return { rows: rx && rx.patient_user_id === params[receipt ? 0 : 1] && rx[receipt ? 'submission_key' : 'id'] === params[receipt ? 1 : 0] ? [rx] : [] };
    }
    if (sql.includes('INSERT INTO audit_logs')) {
      assert.match(sql, /'read','prescription_submission'/);
      if (state.failAudit) throw new Error('Private audit detail');
      state.audits.push(params); return { rows: [] };
    }
    assert.fail(`Unexpected SQL ${sql}`);
  } };
  const service = load('../services/rx-engine/privatePrescriptionUploadService.js', { sharp: {}, crypto: require('node:crypto'),
    '../../../lib/encryption': { encrypt() { assert.fail('Read must not encrypt'); }, decrypt() { state.decrypted++; return state.badCipher ? null : png.toString('base64'); } },
    '../clinical/clinicalAccessService': { assertClinicalAccess() { assert.fail('Patient read must not use provider access'); } },
  });
  return { state, service, req: { user: { id: ids.patient, role: 'patient' } }, pool: { connect: async () => client, query() { assert.fail('Read must not use pool queries'); } } };
}
const invoke = (f, mode) => mode === 'image' ? f.service.readOwnedImage(f.pool, f.req, ids.rx) : f.service.readSubmissionReceipt(f.pool, f.req, ids.key);
const modes = ['image', 'receipt'];
test('actual patient reads lock current exact eligibility and ownership, audit then commit on one client', async () => {
  for (const mode of modes) for (const status of ['uploaded','parsing','parsed','verified','matched','dispensing','dispensed','rejected','expired']) {
    const f = fixture(); f.state.rx.status = status; const result = await invoke(f, mode);
    if (mode === 'image') assert.deepEqual(result, png);
    else { assert.equal(result.status, status); assert.equal(result.requiresVerification, ['uploaded','parsing','parsed'].includes(status)); assert.deepEqual(Object.keys(result).sort(), ['prescriptionId','requiresVerification','status']); }
    assert.equal(f.state.calls[0].sql, 'BEGIN'); assert.equal(f.state.calls.at(-1).sql, 'COMMIT');
    assert.match(f.state.calls.at(-2).sql, /INSERT INTO audit_logs/); assert.equal(f.state.audits.length, 1);
    assert.deepEqual(Array.from(f.state.audits[0]), [ids.patient, ids.rx]); assert.equal(f.state.released, true);
    assert.equal(f.state.decrypted, mode === 'image' ? 1 : 0);
  }
});
test('fresh active, role and market changes deny before content lookup, ignoring stale session authority', async () => {
  for (const mode of modes) for (const patch of [null, { is_active: false }, { role: 'provider' }, { market_scope: 'US' }]) {
    const f = fixture(); f.state.user = patch ? { ...f.state.user, ...patch } : null;
    await assert.rejects(invoke(f, mode), { status: 403 });
    assert.equal(f.state.calls.some(({ sql }) => /ng_prescriptions|INSERT/.test(sql)), false); assert.equal(f.state.decrypted, 0);
    assert.equal(f.state.calls.at(-1).sql, 'ROLLBACK'); assert.equal(f.state.released, true);
  }
});
test('missing actor ids fail closed before connecting; absent or reassigned submissions return 404 without decrypt or audit', async () => {
  for (const mode of modes) {
    for (const req of [undefined, {}, { user: {} }, { user: { id: '' } }]) { const f = fixture(); f.req = req; f.pool.connect = () => assert.fail('No actor must not connect'); await assert.rejects(invoke(f, mode), { status: 403 }); }
    for (const missing of [true, false]) { const f = fixture(); if (missing) f.state.rx = null; else f.state.rx.patient_user_id = ids.other;
      await assert.rejects(invoke(f, mode), { status: 404 }); assert.equal(f.state.decrypted, 0); assert.equal(f.state.audits.length, 0); assert.equal(f.state.released, true); }
  }
});
test('audit, commit and rollback failures never release data; unreadable or absent image never audits', async () => {
  for (const mode of modes) for (const failure of ['failAudit','failCommit']) for (const failRollback of [false,true]) {
    const f = fixture(); f.state[failure] = true; f.state.failRollback = failRollback;
    await assert.rejects(invoke(f, mode), { message: failure === 'failAudit' ? 'Private audit detail' : 'Private commit detail' });
    assert.equal(f.state.calls.at(-1).sql, 'ROLLBACK');
    // A failed rollback cannot certify audit removal after an uncertain commit.
    assert.equal(f.state.audits.length, failure === 'failCommit' && failRollback ? 1 : 0);
    assert.equal(f.state.released, true);
    if (failRollback) assert.equal(f.state.releaseError.message, 'Private rollback detail');
    else assert.equal(f.state.releaseError, undefined);
  }
  for (const missing of [false, true]) { const f = fixture(); if (missing) f.state.rx.image_data_encrypted = null; else f.state.badCipher = true;
    await assert.rejects(invoke(f, 'image'), { status: missing ? 404 : 503 }); assert.equal(f.state.audits.length, 0); }
  const f = fixture(); await assert.rejects(f.service.readSubmissionReceipt(f.pool, f.req, 'bad'), { status: 400 }); assert.equal(f.state.calls.length, 0);
});
test('mounted actual patient image and receipt handlers preserve PNG, safe errors and no-store on validation/failures', async () => {
  const express = require('express'); let active = fixture();
  const router = load('../routes/patient.js', { express, multer: require('multer'),
    '../services/rx-engine/patientPrescriptionListService': {},
    '../services/rx-engine/rxRouter': {}, '../services/pharmacy/orderService': {}, '../services/logistics/medicationDeliveryWorkflowService': {},
    '../../server/middleware/auth': { requireRole: role => (req, res, next) => req.user?.role === role ? next() : res.sendStatus(403) },
    '../../server/db': { getPool: () => active.pool }, '../services/rx-engine/privatePrescriptionUploadService': {
      MAX_IMAGE_BYTES: 5242880, readOwnedImage: (...args) => active.service.readOwnedImage(...args), readSubmissionReceipt: (...args) => active.service.readSubmissionReceipt(...args),
    },
  });
  const app = express(); app.use((req, _res, next) => { req.user = active.req.user; next(); }); app.use(router);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const http = suffix => fetch(`http://127.0.0.1:${server.address().port}/prescriptions/${suffix}`);
  try {
    for (const mode of modes) {
      const suffix = mode === 'image' ? `${ids.rx}/image` : `requests/${ids.key}`;
      active = fixture(); let response = await http(suffix); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
      if (mode === 'image') { assert.equal(response.headers.get('content-type'), 'image/png'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.match(response.headers.get('content-disposition'), /prescription.png/); assert.deepEqual(Buffer.from(await response.arrayBuffer()), png); }
      else assert.equal((await response.json()).prescriptionId, ids.rx);
      for (const failure of ['failAudit','failCommit','inactive','owner']) {
        active = fixture(); if (failure === 'inactive') active.state.user.is_active = false; else if (failure === 'owner') active.state.rx.patient_user_id = ids.other; else active.state[failure] = true;
        response = await http(suffix); assert.equal(response.status, failure === 'inactive' ? 403 : failure === 'owner' ? 404 : 503);
        assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.doesNotMatch(await response.text(), /Private|synthetic|encrypted|iVBOR/);
      }
      active = fixture(); response = await http(mode === 'image' ? 'bad/image' : 'requests/bad'); assert.equal(response.status, 400); assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.equal(active.state.calls.length, 0);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('optional DB races reject unsafe target before constructing Pool and unsafe effective Pool before connecting', async () => {
  const { fixtureTargetSafety } = require('../scripts/fixtureTargetSafety');
  const local = 'postgresql://fixture@127.0.0.1:5432/patient_submission_reads_test';
  for (const [env, options] of [
    [{ NODE_ENV: 'test', SIMULATION_DATABASE_URL: local + '?host=remote.example' }, null],
    [{ NODE_ENV: 'test', SIMULATION_DATABASE_URL: local + '?database=production' }, null],
    [{ NODE_ENV: 'test', SIMULATION_DATABASE_URL: 'postgresql://fixture@remote.example/patient_submission_reads_test' }, null],
    [{ NODE_ENV: 'production', SIMULATION_DATABASE_URL: local }, null],
    [{ NODE_ENV: 'test', SIMULATION_DATABASE_URL: local }, { connectionString: local, host: 'remote.example' }],
  ]) {
    let callback, constructors = 0;
    const refuse = () => assert.fail('Unsafe fixture must not connect or execute SQL');
    const dependencies = { 'node:test': (_name, _options, run) => { callback = run; }, 'node:assert/strict': assert, 'node:crypto': require('node:crypto'),
      pg: { Pool: class { constructor() { constructors++; assert.ok(options, 'Guard must precede Pool construction'); this.options = options; } query = refuse; connect = refuse; end = refuse; } },
      '../../lib/encryption': {}, '../services/rx-engine/privatePrescriptionUploadService': {},
      '../scripts/fixtureTargetSafety': { fixtureTargetSafety: input => fixtureTargetSafety({ ...input, env }) },
    };
    const filename = path.resolve(__dirname, 'patient-submission-read-authority-db.test.js');
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { process: { env }, require(name) { assert.ok(name in dependencies); return dependencies[name]; } }, { filename });
    await assert.rejects(callback({}), /Fixture writes|supplied database pool/); assert.equal(constructors, options ? 1 : 0);
  }
});

test('plaintext and receipt remain pending until COMMIT resolves; missing submission ids never broaden lookup', async () => {
  for (const mode of modes) {
    const f = fixture(), connect = f.pool.connect;
    let reachedCommit, finishCommit, returned = false;
    const reached = new Promise(resolve => { reachedCommit = resolve; });
    const finish = new Promise(resolve => { finishCommit = resolve; });
    f.pool.connect = async () => {
      const client = await connect();
      return { release: () => client.release(), async query(sql, params) {
        if (sql === 'COMMIT') { reachedCommit(); await finish; }
        return client.query(sql, params);
      } };
    };
    const pending = invoke(f, mode).then(value => { returned = true; return value; });
    await reached;
    assert.equal(returned, false); assert.equal(f.state.released, false); assert.equal(f.state.audits.length, 1);
    finishCommit(); assert.ok(await pending); assert.equal(f.state.released, true);
    for (const id of [undefined, null, '']) {
      const missing = fixture();
      await assert.rejects(mode === 'image' ? missing.service.readOwnedImage(missing.pool, missing.req, id) : missing.service.readSubmissionReceipt(missing.pool, missing.req, id), { status: mode === 'image' ? 404 : 400 });
      assert.equal(missing.state.decrypted, 0); assert.equal(missing.state.audits.length, 0);
    }
  }
});
