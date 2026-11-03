'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReturnCustodyService } = require('../services/pharmacy/returnCustodyService');
const ids = Object.fromEntries(['order', 'wrongOrder', 'original', 'receiver', 'otherReceiver', 'owner', 'otherOwner', 'oldOwner', 'superAdmin', 'admin'].map((name, index) => [name, `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]));
const now = Date.parse('2026-11-03T12:00:00Z');
const env = { NODE_ENV: 'test', NG_RETURN_CUSTODY_ENABLED: 'true', NG_RETURN_CUSTODY_CLINICIAN_APPROVAL: 'test-clinician', NG_RETURN_CUSTODY_PRIVACY_APPROVAL: 'test-privacy', NG_RETURN_CUSTODY_OPERATIONS_APPROVAL: 'test-operations' };
const nomination = { version: 1, idempotencyKey: 'test-nomination-1', receivingPharmacyId: ids.receiver, patientAuthorizationReference: 'test-sharing', transferApprovalReference: 'test-transfer', receivingAcceptanceReference: 'test-acceptance', expiresAt: new Date(now + 3600000).toISOString(), authorizationVerified: true, sealedAmbientOnly: true };
const actor = id => ({ id });
const received = parcel => ({ version: parcel.version, nominationId: parcel.nominationId, idempotencyKey: 'test-receipt-1', evidenceReference: 'test-custody', physicallyReceivedAndQuarantined: true });
const rejected = status => error => error.status === status;
function fixture(options = {}) {
  const active = { status: 'approved', account_status: 'active', pcn_license_expiry: '2099-01-01', pcn_license_number: 'TEST-PCN', superintendent_pcn_number: 'TEST-SUPERVISOR', verified_at: new Date(now).toISOString() };
  const state = {
    accounts: Object.fromEntries(['owner', 'otherOwner', 'oldOwner', 'superAdmin', 'admin'].map(name => [ids[name], { id: ids[name], role: name === 'superAdmin' ? 'super_admin' : name === 'admin' ? 'admin' : 'pharmacy', account_status: 'active', market_scope: 'NG', is_active: true }])),
    pharmacies: { [ids.original]: { ...active, id: ids.original, owner_user_id: ids.oldOwner, account_status: 'suspended' }, [ids.receiver]: { ...active, id: ids.receiver, owner_user_id: ids.owner }, [ids.otherReceiver]: { ...active, id: ids.otherReceiver, owner_user_id: ids.otherOwner } },
    orders: Object.fromEntries(['order', 'wrongOrder'].map(name => [ids[name], { id: ids[name], order_number: 'TEST-PARCEL', pharmacy_id: ids.original, status: 'in_transit' }])),
    fulfillments: Object.fromEntries(['order', 'wrongOrder'].map(name => [ids[name], { order_id: ids[name], version: 1, package_category: 'sealed_ambient_medication', inventory_released_at: new Date(now).toISOString(), return_received_at: null }])),
    events: [], operations: [], audits: [], calls: [], now, auditFails: false, bookingStatus: 'returned',
  };
  let snapshot;
  const client = { release() {}, async query(sql, params = []) {
    state.calls.push({ sql, params });
    if (sql === 'BEGIN') { snapshot = structuredClone({ fulfillments: state.fulfillments, events: state.events, operations: state.operations, audits: state.audits }); return { rows: [] }; }
    if (sql === 'ROLLBACK') { Object.assign(state, snapshot); return { rows: [] }; }
    if (sql === 'COMMIT') return { rows: [] };
    if (sql.includes('FROM users WHERE id=')) { assert.match(sql, /FOR SHARE/); return { rows: state.accounts[params[0]] ? [structuredClone(state.accounts[params[0]])] : [] }; }
    if (sql.includes('FROM ng_pharmacies WHERE id=')) { assert.match(sql, /FOR SHARE/); return { rows: state.pharmacies[params[0]] ? [structuredClone(state.pharmacies[params[0]])] : [] }; }
    if (sql.includes('FROM ng_orders WHERE id=')) { assert.match(sql, /FOR (UPDATE|SHARE)/); return { rows: state.orders[params[0]] ? [structuredClone(state.orders[params[0]])] : [] }; }
    if (sql.includes('FROM ng_medication_fulfillments WHERE order_id=')) { assert.match(sql, /FOR (UPDATE|SHARE)/); return { rows: [structuredClone(state.fulfillments[params[0]])] }; }
    if (sql.includes('FROM ng_medication_bookings')) { assert.match(sql, /FOR SHARE/); return { rows: [{ status: state.bookingStatus }] }; }
    if (sql.includes('FROM ng_medication_events WHERE order_id=')) { assert.match(sql, /ORDER BY id DESC LIMIT 1/); return { rows: state.events.filter(row => row.order_id === params[0] && [params[1], params[2]].includes(row.action)).slice(-1) }; }
    if (sql.includes('FROM ng_medication_events e')) {
      assert.match(sql, /NOT EXISTS/); assert.match(sql, /LIMIT 51/);
      return { rows: state.events.filter(row => row.action === params[0] && row.details.receivingPharmacyId === params[1] && row.details.receivingOwnerUserId === params[2] && +row.id > +params[3]
        && !state.events.some(next => next.order_id === row.order_id && [params[0], params[4]].includes(next.action) && +next.id > +row.id)).slice(0, 51).map(row => ({ order_id: row.order_id, id: row.id })) };
    }
    if (sql.includes('FROM ng_medication_operations')) return { rows: state.operations.filter(row => row.order_id === params[0] && row.operation_key === params[1]) };
    if (sql.startsWith('INSERT INTO ng_medication_events')) {
      const row = { id: String(state.events.length + 1), order_id: params[0], action: params[2], details: JSON.parse(params[3]), created_at: new Date(state.now).toISOString() }; state.events.push(row); return { rows: [row] };
    }
    if (sql.startsWith('INSERT INTO ng_medication_operations')) { state.operations.push({ order_id: params[0], operation_key: params[1], action: params[2], digest: params[3] }); return { rows: [] }; }
    if (sql.startsWith('UPDATE ng_medication_fulfillments SET version=')) { state.fulfillments[params[0]].version++; return { rows: [] }; }
    if (sql.startsWith('UPDATE ng_medication_fulfillments SET return_received_at=')) { const f = state.fulfillments[params[1]]; f.return_received_at = new Date(state.now).toISOString(); f.return_evidence_reference = params[0]; return { rows: [structuredClone(f)] }; }
    if (sql.includes('INSERT INTO ng_compliance_audit_log')) { if (state.auditFails) throw new Error('Isolated custody audit failure'); state.audits.push(params); return { rows: [] }; }
    throw new Error(`Unexpected custody query: ${sql}`);
  } };
  const pool = { connect: async () => client, query: (...args) => client.query(...args) };
  return { state, pool, service: createReturnCustodyService({ pool, now: () => state.now, env: { ...env, ...options.env } }) };
}

test('manual custody stays disabled without each sign-off and performs no database work', async () => {
  for (const patch of [{ NG_RETURN_CUSTODY_ENABLED: undefined }, { NG_RETURN_CUSTODY_CLINICIAN_APPROVAL: '' }, { NG_RETURN_CUSTODY_PRIVACY_APPROVAL: undefined }, { NG_RETURN_CUSTODY_OPERATIONS_APPROVAL: 'patient name or URL' }]) {
    const f = fixture({ env: patch }); assert.deepEqual(f.service.availability(), { enabled: false });
    for (const invoke of [() => f.service.nominate(ids.order, actor(ids.superAdmin), nomination), () => f.service.list(ids.receiver, actor(ids.owner)), () => f.service.receive(ids.order, ids.receiver, actor(ids.owner), {})]) await assert.rejects(invoke, rejected(503));
    assert.equal(f.state.calls.length, 0);
  }
});

test('nomination requires explicit bounded authorization, current super-admin and an unavailable original pharmacy', async () => {
  for (const patch of [{ authorizationVerified: false }, { sealedAmbientOnly: false }, { patientAuthorizationReference: '' }, { receivingAcceptanceReference: '' }, { patientName: 'Forbidden' }, { expiresAt: new Date(now + 86400001).toISOString() }]) {
    const f = fixture(); await assert.rejects(f.service.nominate(ids.order, actor(ids.superAdmin), { ...nomination, ...patch }), rejected(422)); assert.equal(f.state.events.length, 0);
  }
  for (const name of ['owner', 'admin']) { const f = fixture(); await assert.rejects(f.service.nominate(ids.order, actor(ids[name]), nomination), rejected(403)); }
  for (const patch of [{ account_status: 'suspended' }, { market_scope: 'US' }, { is_active: false }]) { const f = fixture(); Object.assign(f.state.accounts[ids.superAdmin], patch); await assert.rejects(f.service.nominate(ids.order, actor(ids.superAdmin), nomination), rejected(403)); }
  const f = fixture(); f.state.pharmacies[ids.original].account_status = 'active'; await assert.rejects(f.service.nominate(ids.order, actor(ids.superAdmin), nomination), rejected(409));
  f.state.accounts[ids.oldOwner].account_status = 'suspended'; assert.ok((await f.service.nominate(ids.order, actor(ids.superAdmin), nomination)).nominationId);
});

test('only the current authorized receiver sees minimal parcel data and may record custody, never funds or dispensing', async () => {
  const f = fixture(); const parcel = await f.service.nominate(ids.order, actor(ids.superAdmin), nomination);
  assert.deepEqual(await f.service.nominate(ids.order, actor(ids.superAdmin), nomination), parcel);
  const queue = await f.service.list(ids.receiver, actor(ids.owner)); assert.equal(queue.returns.length, 1);
  assert.deepEqual(Object.keys(queue.returns[0]).sort(), ['disposition', 'expiresAt', 'handlingCategory', 'nominatedAt', 'nominationId', 'orderId', 'orderNumber', 'receivedAt', 'version'].sort());
  assert.doesNotMatch(JSON.stringify(queue), /patient|clinical|medicine|phone|address|Authorization|Acceptance|Approval/);
  const input = received(parcel); const result = await f.service.receive(ids.order, ids.receiver, actor(ids.owner), input);
  assert.equal(result.disposition, 'quarantined'); assert.equal(result.version, 3);
  assert.match(f.state.fulfillments[ids.order].return_evidence_reference, /^alternate-custody:1:/);
  assert.deepEqual(await f.service.receive(ids.order, ids.receiver, actor(ids.owner), input), result);
  assert.equal(f.state.events.filter(row => row.action === 'alternate_return_custody_received').length, 1);
  assert.equal(f.state.fulfillments[ids.order].return_refund_approval_reference, undefined);
  assert.equal(f.state.calls.some(({ sql }) => /UPDATE ng_orders|ng_medication_(payments|refunds|ledger|settlements)|ng_rx_items|ng_pharmacy_inventory|dispense/i.test(sql)), false);
  assert.deepEqual((await f.service.list(ids.receiver, actor(ids.owner))).returns, []);
});

test('superseded and wrong-order nominations cannot attest custody, including replay of old keys', async () => {
  const f = fixture(); const old = await f.service.nominate(ids.order, actor(ids.superAdmin), nomination);
  const current = await f.service.nominate(ids.order, actor(ids.superAdmin), { ...nomination, version: old.version, idempotencyKey: 'test-nomination-2', receivingPharmacyId: ids.otherReceiver });
  await assert.rejects(f.service.receive(ids.order, ids.receiver, actor(ids.owner), received(old)), rejected(409));
  await assert.rejects(f.service.receive(ids.wrongOrder, ids.otherReceiver, actor(ids.otherOwner), received(current)), rejected(409));
  await assert.rejects(f.service.nominate(ids.order, actor(ids.superAdmin), nomination), rejected(409));
  assert.deepEqual((await f.service.list(ids.receiver, actor(ids.owner))).returns, []);
  assert.equal(f.state.events.length, 2); assert.equal(f.state.fulfillments[ids.order].return_received_at, null);
});

test('changed owner, suspended workspace/account, expired licence or protocol revocation invalidate access and receipt replays', async () => {
  for (const mutate of [
    f => { f.state.pharmacies[ids.receiver].owner_user_id = ids.otherOwner; },
    f => { f.state.pharmacies[ids.receiver].account_status = 'suspended'; },
    f => { f.state.pharmacies[ids.receiver].pcn_license_expiry = '2000-01-01'; },
    f => { f.state.accounts[ids.owner].account_status = 'suspended'; },
    f => { f.state.accounts[ids.owner].market_scope = 'US'; },
    f => { f.state.accounts[ids.owner].is_active = false; },
  ]) {
    const f = fixture(); const parcel = await f.service.nominate(ids.order, actor(ids.superAdmin), nomination); const input = received(parcel);
    mutate(f); await assert.rejects(f.service.receive(ids.order, ids.receiver, actor(ids.owner), input), rejected(403));
    await assert.rejects(f.service.list(ids.receiver, actor(ids.owner)), rejected(403)); assert.equal(f.state.fulfillments[ids.order].return_received_at, null);
  }
  const f = fixture(); const parcel = await f.service.nominate(ids.order, actor(ids.superAdmin), nomination); const input = received(parcel);
  await f.service.receive(ids.order, ids.receiver, actor(ids.owner), input);
  f.state.accounts[ids.owner].account_status = 'suspended'; await assert.rejects(f.service.receive(ids.order, ids.receiver, actor(ids.owner), input), rejected(403));
  const next = fixture(); const p = await next.service.nominate(ids.order, actor(ids.superAdmin), nomination); next.state.now += 3600001;
  await assert.rejects(next.service.receive(ids.order, ids.receiver, actor(ids.owner), received(p)), rejected(409));
  assert.deepEqual((await next.service.list(ids.receiver, actor(ids.owner))).returns, []);
  const revised = createReturnCustodyService({ pool: next.pool, now: () => now, env: { ...env, NG_RETURN_CUSTODY_PRIVACY_APPROVAL: 'new-protocol' } });
  await assert.rejects(revised.receive(ids.order, ids.receiver, actor(ids.owner), received(p)), rejected(409));
});

test('revocation is append-only, denies prior access and cannot be replayed over a replacement nomination', async () => {
  const f = fixture(); const p = await f.service.nominate(ids.order, actor(ids.superAdmin), nomination);
  const revoke = { version: p.version, nominationId: p.nominationId, idempotencyKey: 'test-revoke-1', reasonReference: 'authorization-withdrawn' };
  const result = await f.service.revoke(ids.order, actor(ids.superAdmin), revoke); assert.equal(result.revoked, true);
  assert.deepEqual(await f.service.revoke(ids.order, actor(ids.superAdmin), revoke), result);
  await assert.rejects(f.service.receive(ids.order, ids.receiver, actor(ids.owner), received(p)), rejected(409));
  assert.deepEqual((await f.service.list(ids.receiver, actor(ids.owner))).returns, []);
  await f.service.nominate(ids.order, actor(ids.superAdmin), { ...nomination, version: result.version, idempotencyKey: 'test-nomination-new' });
  await assert.rejects(f.service.revoke(ids.order, actor(ids.superAdmin), revoke), rejected(409));
  assert.equal(f.state.events.length, 3);
});

test('custody requires existing released inventory, eligible courier return, current version and a unique request identity', async () => {
  for (const mutate of [f => { f.state.fulfillments[ids.order].inventory_released_at = null; }, f => { f.state.fulfillments[ids.order].package_category = 'cold_chain'; }, f => { f.state.bookingStatus = 'delivered'; }, f => { f.state.orders[ids.order].status = 'cancelled'; }]) {
    const f = fixture(); mutate(f); await assert.rejects(f.service.nominate(ids.order, actor(ids.superAdmin), nomination), rejected(409));
  }
  const f = fixture(); const p = await f.service.nominate(ids.order, actor(ids.superAdmin), nomination);
  await assert.rejects(f.service.receive(ids.order, ids.receiver, actor(ids.owner), { ...received(p), version: 1 }), rejected(409));
  await assert.rejects(f.service.receive(ids.order, ids.receiver, actor(ids.owner), { ...received(p), idempotencyKey: nomination.idempotencyKey }), rejected(409));
  await assert.rejects(f.service.receive(ids.order, ids.otherReceiver, actor(ids.otherOwner), received(p)), rejected(403));
  await assert.rejects(f.service.receive(ids.order, ids.receiver, actor(ids.superAdmin), received(p)), rejected(403));
  assert.equal(f.state.fulfillments[ids.order].return_received_at, null);
});

test('audit failures roll back nominations, physical custody and versions atomically', async () => {
  const f = fixture(); f.state.auditFails = true;
  await assert.rejects(f.service.nominate(ids.order, actor(ids.superAdmin), nomination), /Isolated custody audit failure/);
  assert.equal(f.state.events.length, 0); assert.equal(f.state.fulfillments[ids.order].version, 1);
  f.state.auditFails = false; const p = await f.service.nominate(ids.order, actor(ids.superAdmin), nomination); f.state.auditFails = true;
  await assert.rejects(f.service.receive(ids.order, ids.receiver, actor(ids.owner), received(p)), /Isolated custody audit failure/);
  assert.equal(f.state.events.length, 1); assert.equal(f.state.fulfillments[ids.order].version, 2); assert.equal(f.state.fulfillments[ids.order].return_received_at, null);
  await assert.rejects(f.service.list(ids.receiver, actor(ids.owner)), /Isolated custody audit failure/);
});

module.exports = { fixture, ids, nomination, received, actor, env };

test('parcel pagination advances past expired entries without losing later authorized returns', async () => {
  const f = fixture();
  for (let n = 0; n < 52; n++) {
    const orderId = `00000000-0000-4000-8000-${String(n + 100).padStart(12, '0')}`;
    f.state.orders[orderId] = { ...f.state.orders[ids.order], id: orderId };
    f.state.fulfillments[orderId] = { ...f.state.fulfillments[ids.order], order_id: orderId };
    await f.service.nominate(orderId, actor(ids.superAdmin), { ...nomination, idempotencyKey: `test-queue-key-${n}` });
  }
  for (const entry of f.state.events.slice(0, 50)) entry.details.expiresAt = new Date(now - 1).toISOString(); // Synthetic expired authorization fixture.
  const first = await f.service.list(ids.receiver, actor(ids.owner)); assert.equal(first.returns.length, 0); assert.equal(first.nextCursor, '50');
  const second = await f.service.list(ids.receiver, actor(ids.owner), { after: first.nextCursor }); assert.equal(second.returns.length, 2); assert.equal(second.nextCursor, null);
  for (const after of ['9999999999999999999', 'not-an-id', '1.1', '-1', '']) await assert.rejects(f.service.list(ids.receiver, actor(ids.owner), { after }), rejected(422));
});

test('HTTP custody adapters keep service-owned authority, default-disabled errors and private no-store responses', async () => {
  const express = require('express'); const Module = require('node:module');
  const adminPath = require.resolve('../routes/medicationDeliveryAdmin'); const pharmacyPath = require.resolve('../routes/pharmacy');
  const originalLoad = Module._load; let active = fixture(); let adminRouter; let pharmacyRouter;
  try {
    Module._load = function(name, parent) {
      if ([adminPath, pharmacyPath].includes(parent?.filename)) {
        if (name === '../services/pharmacy/returnCustodyService') return Object.fromEntries(['availability', 'nominate', 'revoke', 'receive', 'list'].map(method => [method, (...args) => active.service[method](...args)]));
        if (name === '../../server/db') return { getPool: () => ({ async query(sql, params) { assert.match(sql, /^SELECT id,role,is_active FROM users/); return { rows: active.state.accounts[params[0]] ? [active.state.accounts[params[0]]] : [] }; } }) };
      }
      return originalLoad.apply(this, arguments);
    };
    delete require.cache[adminPath]; delete require.cache[pharmacyPath]; adminRouter = require(adminPath); pharmacyRouter = require(pharmacyPath);
  } finally { Module._load = originalLoad; }
  const app = express(); app.use(express.json());
  // Authentication transport is covered by the isolated JWT/HTTP database
  // suite. Here intentionally stale role claims must still fail at the service.
  app.use((req, _res, next) => { req.user = { id: req.headers['x-test-actor'], role: req.headers['x-test-role'] || 'pharmacy' }; next(); });
  app.use('/admin', adminRouter); app.use('/pharmacy', pharmacyRouter);
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const call = async (path, id, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: body ? 'POST' : 'GET', headers: { 'x-test-actor': id, 'x-test-role': 'super_admin', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
  };
  try {
    assert.equal((await call(`/admin/${ids.order}/return-custody/nominate`, ids.admin, nomination)).status, 403);
    const p = await call(`/admin/${ids.order}/return-custody/nominate`, ids.superAdmin, nomination); assert.equal(p.status, 200); assert.equal(p.cache, 'private, no-store');
    const queue = await call(`/pharmacy/${ids.receiver}/return-custody`, ids.owner); assert.equal(queue.status, 200); assert.equal(queue.cache, 'private, no-store');
    assert.equal((await call(`/pharmacy/${ids.receiver}/return-custody/${ids.order}/receive`, ids.superAdmin, received(p.body))).status, 403);
    assert.equal((await call(`/pharmacy/${ids.receiver}/return-custody/${ids.order}/receive`, ids.owner, received(p.body))).status, 200);
    active = fixture({ env: { NG_RETURN_CUSTODY_ENABLED: 'false' } });
    const unavailable = await call(`/pharmacy/${ids.receiver}/return-custody`, ids.owner); assert.equal(unavailable.status, 503); assert.equal(unavailable.cache, 'private, no-store');
    assert.deepEqual((await call('/admin/return-custody/availability', ids.superAdmin)).body, { enabled: false });
    assert.equal(active.state.calls.length, 0);
  } finally { await new Promise(resolve => server.close(resolve)); delete require.cache[adminPath]; delete require.cache[pharmacyPath]; }
});
