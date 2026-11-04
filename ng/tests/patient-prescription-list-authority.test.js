'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const service = require('../services/rx-engine/patientPrescriptionListService');
const id = '00000000-0000-4000-8000-000000000001';
function load(relative, dependencies, globals = {}) {
  const filename = path.resolve(__dirname, relative), sourceModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: sourceModule, exports: sourceModule.exports, console, process, Buffer,
    require(name) { assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`); return dependencies[name]; }, ...globals }, { filename });
  return sourceModule.exports;
}
function fixture() {
  const state = { user: { id, role: 'patient', is_active: true, provider_status: 'approved', must_change_password: false, market_scope: 'US', account_status: 'suspended' }, calls: [], audits: [], released: false,
    uploaded: [{ id: 'upload', status: 'rejected', created_at: '2026-01-01', items: [{ drug_name: 'Private synthetic drug' }], prescriber_name: 'Synthetic', ocr_confidence: 0.5, is_controlled_substance: true, expires_at: '2025-01-01' }],
    digital: [{ id: 'digital', status: 'expired', created_at: '2026-01-01', items: [], prescription_number: 'SYNTHETIC', dispense_status: 'pending', pharmacy_response_status: 'accepted', expires_at: null, prescriber_name: 'Synthetic provider', pharmacy_name: 'Synthetic pharmacy', pharmacy_phone: 'synthetic', whatsapp_business_number: 'synthetic', fulfillment_preference: 'pickup', confirmed_price_ngn: '123', pharmacy_notes: 'Private synthetic note' }] };
  const client = { release(error) { state.released = true; state.releaseError = error; }, async query(sql, params = []) {
    state.calls.push({ sql, params });
    if (sql === state.fail || (state.fail === 'audit2' && /INSERT INTO audit_logs/.test(sql) && state.audits.length === 1)) throw new Error('Private SQL detail');
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) { if (sql === 'ROLLBACK') { if (state.failRollback) throw new Error('Private rollback detail'); state.audits = []; } return { rows: [] }; }
    if (/FROM users/.test(sql)) { if (state.fail === 'actorQuery') throw new Error('Private current-user query detail'); assert.match(sql, /WHERE id=\$1 FOR SHARE$/); assert.deepEqual(params, [id]); assert.doesNotMatch(sql, /market_scope|account_status/); return { rows: state.user ? [state.user] : [] }; }
    if (/FROM ng_prescriptions/.test(sql)) { assert.match(sql, /WHERE patient_user_id = \$1\s+ORDER BY created_at DESC LIMIT \$2 OFFSET \$3 FOR SHARE$/); if (state.fail === 'upload') throw new Error('Private upload detail'); return { rows: state.uploaded }; }
    if (/FROM ng_digital_prescriptions/.test(sql)) { assert.match(sql, /JOIN ng_providers provider ON provider.id = rx.provider_id/); assert.match(sql, /LEFT JOIN ng_pharmacies pharmacy/); assert.match(sql, /COALESCE\(rx.routed_pharmacy_id, rx.preferred_pharmacy_id, rx.dispensed_by_pharmacy_id\)/); assert.match(sql, /WHERE rx.patient_user_id = \$1\s+ORDER BY rx.created_at DESC\s+LIMIT \$2 OFFSET \$3 FOR SHARE OF rx$/); if (state.fail === 'digital') throw new Error('Private digital detail'); return { rows: state.digital }; }
    if (/INSERT INTO audit_logs/.test(sql)) { assert.match(sql, /patient_id,phi_accessed,success/); assert.match(sql, /VALUES\(\$1,'read',\$2,NULL,\$1,true,true/); if (state.fail === 'audit1') throw new Error('Private audit detail'); state.audits.push(params); return { rows: [] }; }
    assert.fail(`Unexpected SQL ${sql}`);
  } };
  return { state, client, actor: { id, role: 'stale-session-role' }, pool: { connect: async () => client, query: () => assert.fail('Use one transactional client') } };
}
const read = (f, query = {}) => service.list(f.pool, f.actor, query);
test('actual combined list keeps own all-role/all-market scope, shape, stable ordering, joins and metadata-only audits', async () => {
  for (const role of ['patient','provider','pharmacy','admin','nurse',' Provider ',' PHARMACY ']) {
    const f = fixture(); f.state.user.role = role;
    const result = await read(f, { patient_id: 'other', status: 'active' });
    assert.deepEqual(result, [{ ...f.state.digital[0], source_type: 'provider_digital_prescription' }, { ...f.state.uploaded[0], source_type: 'patient_uploaded_prescription' }]);
    assert.equal(f.state.calls[0].sql, 'BEGIN'); assert.equal(f.state.calls.at(-1).sql, 'COMMIT'); assert.equal(f.state.released, true);
    assert.deepEqual(f.state.audits.map(a => [a[0], a[1], JSON.parse(a[2])]), [[id,'prescription_submission',{ recordCount: 1, records: [{ id: 'upload' }] }],[id,'digital_prescription',{ recordCount: 1, records: [{ id: 'digital' }] }]]);
    assert.doesNotMatch(JSON.stringify(f.state.audits), /Private|Synthetic|drug_name|items|pharmacy_notes/);
  }
  const f = fixture(); f.state.uploaded[0].created_at = '2026-03-01'; assert.equal((await read(f))[0].id, 'upload');
});
test('per-source parseInt pagination remains unchanged without global slicing, including default and negative cases', async () => {
  for (const [query, expected] of [[{},[20,0]],[{ limit: '1', page: '2' },[1,1]],[{ limit: '0', page: '0' },[20,0]],[{ limit: '2tail', page: '3tail' },[2,4]],[{ limit: '-3', page: '-2' },[-3,9]],[{ limit: 'bad', page: 'bad' },[20,0]]]) {
    const f = fixture(); const result = await read(f, query); assert.equal(result.length, 2);
    for (const call of f.state.calls.filter(c => /FROM ng_(digital_)?prescriptions/.test(c.sql))) assert.deepEqual(call.params, [id,...expected]);
  }
  const f = fixture(); f.state.uploaded = []; f.state.digital = []; assert.deepEqual(await read(f), []); assert.equal(f.state.audits.length, 2); assert.ok(f.state.audits.every(a => JSON.parse(a[2]).recordCount === 0));
});
test('current actor eligibility fails closed before sources and ignores stale session authority', async () => {
  for (const patch of [null,{ is_active: false },{ role: 'provider', provider_status: 'pending' },{ role: 'provider', must_change_password: true },{ role: ' Pharmacy ', must_change_password: true }]) {
    const f = fixture(); f.state.user = patch ? { ...f.state.user, ...patch } : null;
    await assert.rejects(read(f), { status: 403 }); assert.equal(f.state.calls.some(c => /ng_prescriptions|ng_digital_prescriptions|INSERT/.test(c.sql)), false); assert.equal(f.state.calls.at(-1).sql, 'ROLLBACK');
  }
  // Existing authentication checks raw provider approval, but normalized role for password rotation.
  const f = fixture(); Object.assign(f.state.user, { role: ' Provider ', provider_status: 'pending' }); assert.equal((await read(f)).length, 2);
  for (const actor of [undefined,null,{}, { id: '' }]) { const f = fixture(); f.actor = actor; f.pool.connect = () => assert.fail('No actor must not connect'); await assert.rejects(read(f), { status: 403 }); }
});
test('either source, either audit and commit failures return no data; rollback failure discards connection', async () => {
  for (const fail of ['BEGIN','actorQuery','upload','digital','audit1','audit2','COMMIT']) for (const failRollback of [false,true]) {
    const f = fixture(); Object.assign(f.state, { fail, failRollback }); await assert.rejects(read(f), /Private/);
    assert.equal(f.state.calls.at(-1).sql, 'ROLLBACK'); assert.equal(f.state.released, true);
    if (!failRollback) { assert.equal(f.state.audits.length, 0); assert.equal(f.state.releaseError, undefined); }
    else assert.equal(f.state.releaseError.message, 'Private rollback detail');
  }
});
test('result and connection stay held after both audits until COMMIT resolves', async () => {
  const f = fixture(); let reached, proceed, returned = false;
  const boundary = new Promise(resolve => { reached = resolve; }), gate = new Promise(resolve => { proceed = resolve; });
  const query = f.client.query; f.client.query = async (...args) => { if (args[0] === 'COMMIT') { reached(); await gate; } return query(...args); };
  const pending = read(f).then(result => { returned = true; return result; }); await boundary;
  assert.equal(returned, false); assert.equal(f.state.released, false); assert.equal(f.state.audits.length, 2);
  proceed(); assert.equal((await pending).length, 2); assert.equal(f.state.released, true);
});
test('actual mounted combined handler returns bare arrays and no-store on success, denial and generic failures', async () => {
  const express = require('express'); let active = fixture();
  const router = load('../routes/patient.js', { express, multer: require('multer'), '../services/rx-engine/rxRouter': {}, '../services/pharmacy/orderService': {}, '../services/logistics/medicationDeliveryWorkflowService': {},
    '../../server/middleware/auth': { requireRole: () => (_req,_res,next) => next() }, '../../server/db': { getPool: () => active.pool }, '../services/rx-engine/privatePrescriptionUploadService': { MAX_IMAGE_BYTES: 5242880 }, '../services/rx-engine/patientPrescriptionListService': service });
  const app = express(); app.use((req,_res,next) => { req.user = active.actor; next(); }); app.use('/api/ng/patient', router);
  const server = await new Promise(resolve => { const s = app.listen(0,'127.0.0.1',() => resolve(s)); });
  const http = () => fetch(`http://127.0.0.1:${server.address().port}/api/ng/patient/prescriptions?limit=1&page=2&patient_id=other`);
  try {
    for (const mode of ['ok','empty','inactive','missing','upload','digital','audit1','audit2','BEGIN','actorQuery','COMMIT','connect']) {
      active = fixture(); active.actor.role = 'admin';
      if (mode === 'empty') { active.state.uploaded = []; active.state.digital = []; }
      else if (mode === 'inactive') active.state.user.is_active = false;
      else if (mode === 'missing') active.actor = {};
      else if (mode === 'connect') active.pool.connect = async () => { throw new Error('Private connection detail'); };
      else if (mode !== 'ok') active.state.fail = mode;
      const response = await http(); assert.equal(response.status, ['ok','empty'].includes(mode) ? 200 : ['inactive','missing'].includes(mode) ? 403 : 503, mode);
      assert.equal(response.headers.get('cache-control'), 'private, no-store'); const body = await response.json();
      if (response.ok) { assert.ok(Array.isArray(body)); assert.equal(body.length, mode === 'empty' ? 0 : 2); }
      else assert.doesNotMatch(JSON.stringify(body), /Private|Synthetic|SQL|drug_name|pharmacy_notes/);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('optional DB suite guards unsafe configured and effective Pool targets before any connection', async () => {
  const { fixtureTargetSafety } = require('../scripts/fixtureTargetSafety');
  const local = 'postgresql://fixture@127.0.0.1:5432/patient_prescription_list_test';
  for (const [env, options] of [
    [{ NODE_ENV: 'test', SIMULATION_DATABASE_URL: local + '?host=remote.example' },null],
    [{ NODE_ENV: 'test', SIMULATION_DATABASE_URL: local + '?database=production' },null],
    [{ NODE_ENV: 'test', SIMULATION_DATABASE_URL: 'postgresql://fixture@remote.example/patient_prescription_list_test' },null],
    [{ NODE_ENV: 'production', SIMULATION_DATABASE_URL: local },null],
    [{ NODE_ENV: 'test', SIMULATION_DATABASE_URL: local },{ connectionString: local, host: 'remote.example' }],
  ]) {
    let callback, constructors = 0;
    const refuse = () => assert.fail('Unsafe target must never connect or execute SQL');
    load('patient-prescription-list-authority-db.test.js', { 'node:test': (_name,_options,run) => { callback = run; }, 'node:assert/strict': assert, 'node:crypto': require('node:crypto'),
      pg: { Pool: class { constructor() { constructors++; assert.ok(options,'Guard must precede Pool construction'); this.options = options; } query = refuse; connect = refuse; end = refuse; } },
      '../services/rx-engine/patientPrescriptionListService': {}, '../scripts/fixtureTargetSafety': { fixtureTargetSafety: input => fixtureTargetSafety({ ...input, env }) },
    },{ process: { env } });
    await assert.rejects(callback({}),/Fixture writes|supplied database pool/); assert.equal(constructors,options ? 1 : 0);
  }
});
