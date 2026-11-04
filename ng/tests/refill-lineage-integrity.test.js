'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/rx-engine/prescriptionWorkflowService');
const actor = { user_id: 'test-clinician', kind: 'prescriber' };
function fixture({ itemId = 'own-item', failAudit = false, failCommit = false, status = 'requested' } = {}) {
  const state = { patient: { id: 'test-patient', role: 'patient', is_active: true, account_status: 'active', market_scope: 'NG' }, rx: { id: 'own-rx', patient_user_id: 'test-patient' }, items: [{ id: 'own-item', prescription_id: 'own-rx', refills_remaining: 2 }, { id: 'foreign-item', prescription_id: 'foreign-rx', refills_remaining: 2 }], refills: [{ id: 'refill', prescription_id: 'own-rx', item_id: itemId, status }], events: [], calls: [], released: false };
  let before;
  const client = { release() { state.released = true; }, async query(sql, params = []) {
    state.calls.push({ sql, params });
    if (sql === 'BEGIN') { before = structuredClone({ items: state.items, refills: state.refills, events: state.events }); return { rows: [] }; }
    if (sql === 'ROLLBACK') { Object.assign(state, before); return { rows: [] }; }
    if (sql === 'COMMIT') { if (failCommit) throw new Error('Commit acknowledgement unavailable'); return { rows: [] }; }
    if (sql.startsWith('SELECT id FROM users')) {
      assert.match(sql, /role='patient' AND is_active=TRUE FOR SHARE/);
      assert.doesNotMatch(sql, /account_status|market_scope/);
      return { rows: state.patient.id === params[0] && state.patient.role === 'patient' && state.patient.is_active ? [{ id: state.patient.id }] : [] };
    }
    if (sql.startsWith('SELECT id,patient_user_id FROM ng_digital_prescriptions')) {
      assert.match(sql, /FOR UPDATE/);
      return { rows: state.rx?.id === params[0] ? [{ ...state.rx }] : [] };
    }
    if (sql.startsWith('SELECT * FROM ng_digital_prescriptions')) return { rows: [{ id: 'own-rx', patient_user_id: 'test-patient', provider_id: 'test-profile' }] };
    if (sql.startsWith('SELECT * FROM ng_rx_items')) return { rows: state.items.filter(item => item.prescription_id === params[0]) };
    if (sql.startsWith('SELECT EXISTS(SELECT 1 FROM ng_medication_events')) return { rows: [{ required: false }] };
    if (sql.startsWith('SELECT id FROM ng_digital_prescriptions')) { assert.match(sql, /FOR UPDATE/); return { rows: params[0] === 'own-rx' ? [{ id: 'own-rx' }] : [] }; }
    if (sql.startsWith('SELECT id FROM ng_rx_items')) { assert.match(sql, /prescription_id=\$2 FOR UPDATE/); return { rows: state.items.filter(item => item.id === params[0] && item.prescription_id === params[1]) }; }
    if (sql.startsWith('SELECT prescription_id FROM ng_rx_refills')) return { rows: state.refills.filter(row => row.id === params[0]).map(row => ({ prescription_id: row.prescription_id })) };
    if (sql.startsWith('SELECT * FROM ng_rx_refills')) { assert.match(sql, /prescription_id=\$2 FOR UPDATE/); return { rows: state.refills.filter(row => row.id === params[0] && row.prescription_id === params[1]).map(row => ({ ...row })) }; }
    if (sql.includes('INSERT INTO ng_rx_refills')) { const row = { id: 'new-refill', prescription_id: params[0], item_id: params[1], status: 'requested', quantity: params[3] }; state.refills.push(row); return { rows: [{ ...row }] }; }
    if (sql.includes('UPDATE ng_rx_refills')) {
      assert.match(sql, /prescription_id = \$3 AND status = 'requested'/);
      const row = state.refills.find(row => row.id === params[0] && row.prescription_id === params[2] && row.status === 'requested');
      if (!row) return { rows: [] };
      row.status = sql.includes("SET status = 'approved'") ? 'approved' : 'denied'; return { rows: [{ ...row }] };
    }
    if (sql.includes('UPDATE ng_rx_items')) {
      assert.match(sql, /prescription_id = \$2/);
      const item = state.items.find(item => item.id === params[0] && item.prescription_id === params[1]);
      if (item.refills_remaining > 0) item.refills_remaining--; return { rows: [] };
    }
    if (sql.includes('INSERT INTO ng_rx_events')) { if (failAudit) throw new Error('Synthetic audit unavailable'); state.events.push(params); return { rows: [] }; }
    throw new Error('Unexpected refill query: ' + sql);
  } };
  return { state, client, pool: { connect: async () => client } };
}
const decide = (f, mode) => mode === 'approve' ? service.approveRefill('refill', actor, f.pool) : service.denyRefill('refill', actor, { reason: 'Reviewed denial' }, f.pool);

test('refill request rejects a foreign item before creating any request or event', async () => {
  const f = fixture();
  await assert.rejects(service.requestRefill('own-rx', 'foreign-item', actor, {}, f.pool), { code: 'INVALID_STATE' });
  assert.equal(f.state.refills.length, 1); assert.equal(f.state.events.length, 0);
  assert.equal(f.state.calls.some(call => /INSERT|UPDATE ng_rx_items/.test(call.sql)), false);
  assert.equal(f.state.calls.at(-1).sql, 'ROLLBACK'); assert.equal(f.state.released, true);
});
test('existing foreign-item refill rows cannot be approved or denied as valid clinical lineage', async () => {
  for (const mode of ['approve','deny']) {
    const f = fixture({ itemId: 'foreign-item' }); await assert.rejects(decide(f, mode), { code: 'INVALID_STATE' });
    assert.equal(f.state.refills[0].status, 'requested'); assert.equal(f.state.items[1].refills_remaining, 2); assert.equal(f.state.events.length, 0);
    assert.equal(f.state.calls.some(call => call.sql.startsWith('UPDATE')), false);
  }
});
test('valid item and whole-prescription requests retain their existing behavior with atomic events', async () => {
  for (const itemId of ['own-item', null]) {
    const requested = fixture(); const result = await service.requestRefill('own-rx', itemId, actor, { quantity: 3 }, requested.pool);
    assert.equal(result.item_id, itemId); assert.equal(result.quantity, 3); assert.equal(requested.state.events.length, 1); assert.equal(requested.state.calls.at(-1).sql, 'COMMIT');
    for (const mode of ['approve','deny']) {
      const f = fixture({ itemId }); const result = await decide(f, mode);
      assert.equal(result.status, mode === 'approve' ? 'approved' : 'denied');
      assert.equal(f.state.items[0].refills_remaining, mode === 'approve' && itemId ? 1 : 2);
      assert.equal(f.state.items[1].refills_remaining, 2); assert.equal(f.state.events.length, 1); assert.equal(f.state.calls.at(-1).sql, 'COMMIT');
      const locks = f.state.calls.filter(call => call.sql.includes('FOR UPDATE')).map(call => call.sql);
      assert.ok(locks[0].includes('ng_digital_prescriptions')); assert.ok(locks[1].includes('ng_rx_refills'));
    }
  }
});
test('mandatory audit failure rolls back request, approval counter and denial together', async () => {
  for (const action of ['request','approve','deny']) {
    const f = fixture({ failAudit: true }); const before = structuredClone({ items: f.state.items, refills: f.state.refills });
    await assert.rejects(action === 'request' ? service.requestRefill('own-rx','own-item',actor,{},f.pool) : decide(f, action), /Synthetic audit unavailable/);
    assert.deepEqual(f.state.items, before.items); assert.deepEqual(f.state.refills, before.refills); assert.equal(f.state.events.length, 0);
    assert.equal(f.state.calls.at(-1).sql, 'ROLLBACK'); assert.equal(f.state.released, true);
  }
});
test('terminal refill decisions are not replayed as new approvals or events', async () => {
  for (const status of ['approved','denied']) for (const mode of ['approve','deny']) {
    const f = fixture({ status }); await assert.rejects(decide(f,mode), { code: 'NOT_FOUND' });
    assert.equal(f.state.items[0].refills_remaining, 2); assert.equal(f.state.events.length, 0);
  }
});
test('existing transaction client is reused rather than nesting or prematurely committing', async () => {
  const f = fixture(); await service.requestRefill('own-rx', null, actor, {}, f.client);
  assert.equal(f.state.calls.some(call => ['BEGIN','COMMIT','ROLLBACK'].includes(call.sql)), false); assert.equal(f.state.released, false);
});

function mountedPatientHandler(f) {
  const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
  const handlers = [];
  const router = { use() {}, get() {}, post(route, ...callbacks) { handlers.push({ route, callback: callbacks.at(-1) }); } };
  const express = { Router: () => router, json: () => (_req,_res,next) => next() };
  const filename = path.resolve(__dirname,'../routes/prescriptions.js');
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename,'utf8'), { module:mod,exports:mod.exports,console, require(name) {
    if (name==='express') return express;
    if (name==='../services/rx-engine/prescriptionWorkflowService') return service;
    if (name==='../services/pharmacy/pharmacistRxService' || name==='../services/rx-engine/prescriberRxService' || name==='../services/rx-engine/patientAdminRxReadService') return {};
    if (name==='../../server/db') return { getPool:()=>f.pool };
    throw new Error('Unexpected route dependency');
  } }, { filename });
  // Authenticated role middleware is covered separately; execute the actual
  // registered request handler and service against the same query double.
  f.pool.query=()=>{ throw new Error('Patient authorization must not use an unlocked pool query'); };
  return handlers.find(handler=>handler.route==='/:id/refill').callback;
}

test('mounted patient refill handler rejects a foreign item with HTTP409 and no clinical write', async () => {
  const f = fixture(), handler = mountedPatientHandler(f);
  const res = { code:200,status(code) { this.code=code; return this; },json(body) { this.body=body; return this; } };
  await handler({ user:{ id:'test-patient',role:'patient' },params:{ id:'own-rx' },body:{ item_id:'foreign-item' } },res);
  assert.equal(res.code,409); assert.equal(res.body.ok,false); assert.equal(f.state.refills.length,1); assert.equal(f.state.events.length,0);
});

const patientActor = { user_id: 'test-patient', kind: 'patient' };
const patientRequest = (f, itemId = 'own-item', target = f.pool) => service.requestPatientRefill('own-rx', itemId, patientActor, { quantity: 2, notes: 'Synthetic refill request' }, target);

test('patient refill authority, exact ownership and item lineage precede writes in one transaction', async () => {
  for (const itemId of ['own-item', null]) {
    const f = fixture(), result = await patientRequest(f, itemId);
    assert.equal(result.item_id, itemId); assert.equal(result.quantity, 2);
    assert.equal(f.state.events.length, 1);
    const queries = f.state.calls.map(call => call.sql);
    assert.equal(queries[0], 'BEGIN'); assert.equal(queries.at(-1), 'COMMIT');
    assert.equal(queries.filter(sql => sql === 'BEGIN').length, 1);
    const authority = queries.findIndex(sql => sql.startsWith('SELECT id FROM users'));
    const ownership = queries.findIndex(sql => sql.startsWith('SELECT id,patient_user_id'));
    const insert = queries.findIndex(sql => sql.includes('INSERT INTO ng_rx_refills'));
    assert.ok(authority > 0 && ownership > authority && insert > ownership);
    assert.equal(f.state.released, true);
  }
});

test('patient refill denies lost current role, active status or ownership before any clinical mutation', async () => {
  for (const change of [f => { f.state.patient.role = 'provider'; }, f => { f.state.patient.is_active = false; },
    f => { f.state.patient.id = 'another-patient'; }, f => { f.state.rx.patient_user_id = 'another-patient'; }]) {
    const f = fixture(); change(f);
    await assert.rejects(patientRequest(f), { code: 'FORBIDDEN' });
    assert.equal(f.state.calls.some(call => /INSERT|UPDATE ng_/.test(call.sql)), false);
    assert.equal(f.state.calls.at(-1).sql, 'ROLLBACK'); assert.equal(f.state.released, true);
  }
  const absent = fixture(); absent.state.rx = null;
  await assert.rejects(patientRequest(absent), { code: 'NOT_FOUND' });
  for (const actor of [{ user_id: 'test-patient', kind: 'prescriber' }, { kind: 'patient' }]) {
    const f = fixture(); await assert.rejects(service.requestPatientRefill('own-rx', null, actor, {}, f.pool), { code: 'FORBIDDEN' });
    assert.equal(f.state.calls.length, 0);
  }
});

test('patient refill preserves existing market and account-status policy and trusted clinician behavior', async () => {
  const f = fixture(); Object.assign(f.state.patient, { account_status: 'suspended', market_scope: 'US' });
  assert.equal((await patientRequest(f)).status, 'requested');
  const clinician = fixture(); clinician.state.patient.is_active = false;
  assert.equal((await service.requestRefill('own-rx', null, actor, {}, clinician.pool)).status, 'requested');
  assert.equal(clinician.state.calls.some(call => call.sql.includes('FROM users')), false);
});

test('patient refill retains audit rollback, uncertain-commit suppression and caller-owned transaction behavior', async () => {
  for (const options of [{ failAudit: true }, { failCommit: true }]) {
    const f = fixture(options); await assert.rejects(patientRequest(f));
    assert.equal(f.state.refills.length, 1); assert.equal(f.state.events.length, 0);
    assert.equal(f.state.calls.at(-1).sql, 'ROLLBACK'); assert.equal(f.state.released, true);
  }
  const f = fixture(); await patientRequest(f, null, f.client);
  assert.equal(f.state.calls.some(call => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(call.sql)), false);
  assert.equal(f.state.released, false);
});

test('mounted patient refill uses current transaction authority and never an earlier ownership snapshot', async () => {
  for (const change of [f => { f.state.rx.patient_user_id = 'another-patient'; }, f => { f.state.patient.is_active = false; }]) {
    const f = fixture(), original = f.client.query;
    f.client.query = async (sql, values) => { if (sql === 'BEGIN') change(f); return original(sql, values); };
    const handler = mountedPatientHandler(f);
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ user: { id: 'test-patient', role: 'patient' }, params: { id: 'own-rx' }, body: { item_id: 'own-item' } }, res);
    assert.equal(res.code, 403); assert.equal(res.body.ok, false);
    assert.equal(f.state.refills.length, 1); assert.equal(f.state.events.length, 0);
    assert.equal(f.state.calls.at(-1).sql, 'ROLLBACK');
  }
});
