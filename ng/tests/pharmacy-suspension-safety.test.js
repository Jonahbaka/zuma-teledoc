'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { isClinicalPharmacyActive } = require('../services/pharmacy/clinicalPharmacyAuthorization');
const { createMedicationDeliveryWorkflowService } = require('../services/logistics/medicationDeliveryWorkflowService');
const fhir = require('../services/interop/medicationFhirService');
const ids = { patient: '00000000-0000-4000-8000-000000000001', pharmacist: '00000000-0000-4000-8000-000000000002', pharmacy: '00000000-0000-4000-8000-000000000003', order: '00000000-0000-4000-8000-000000000004', drug: '00000000-0000-4000-8000-000000000005', admin: '00000000-0000-4000-8000-000000000006' };
const actors = Object.fromEntries(['patient', 'pharmacist', 'admin'].map(key => [key, { id: ids[key], role: key === 'pharmacist' ? 'pharmacy' : key, email: `${key}@isolated.invalid`, market_scope: 'NG', account_status: 'active', is_active: true }]));
const pharmacy = { id: ids.pharmacy, owner_user_id: ids.pharmacist, status: 'approved', account_status: 'active', verified_at: '2026-01-01', pcn_license_expiry: '2099-01-01', pcn_license_number: 'ISOLATED-PCN', superintendent_pcn_number: 'ISOLATED-SUPERINTENDENT', name: 'Isolated pharmacy', phone: '+2348000000000' };
function fixture({ pharmacyPatch = {}, actorPatch = {}, auditFails = false } = {}) {
  const state = {
    p: { ...pharmacy, ...pharmacyPatch }, actors: Object.fromEntries(Object.entries(actors).map(([key, actor]) => [key, { ...actor, ...actorPatch }])),
    order: { id: ids.order, patient_user_id: ids.patient, pharmacy_id: ids.pharmacy, status: 'pending', delivery_type: 'pickup', order_number: 'DRX-isolated', items: [{ drug_id: ids.drug, name: 'Isolated medicine', quantity: 1, unitPriceMinor: 10000, lineTotalMinor: 10000 }] },
    f: { order_id: ids.order, version: 1, medicines_minor: 10000, coverage: {}, coordination: {}, pharmacy_confirmed_at: '2026-01-01', pharmacy_data_consent_at: '2026-01-01' },
    calls: [], external: 0, refunds: 0,
  };
  const client = { release() {}, async query(sql, params = []) {
    state.calls.push({ sql, params });
    if (sql.startsWith('BEGIN') || ['COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    if (sql.includes('FROM users WHERE id=')) {
      assert.match(sql, /FOR SHARE/);
      const actor = Object.values(state.actors).find(row => row.id === params[0]);
      if (sql.includes("role='pharmacy'")) return { rows: actor?.role === 'pharmacy' && actor.is_active && actor.market_scope === 'NG' && actor.account_status === 'active' ? [actor] : [] };
      return { rows: actor ? [actor] : [] };
    }
    if (sql.includes('FROM ng_pharmacies WHERE id=')) { assert.match(sql, /FOR SHARE/); return { rows: params[0] === state.p.id && (params.length < 2 || params[1] === state.p.owner_user_id) ? [{ ...state.p }] : [] }; }
    if (sql.includes('FROM ng_orders o JOIN users')) return { rows: [{ ...state.order }] };
    if (sql.includes('FROM ng_orders')) return { rows: [{ ...state.order }] };
    if (sql.includes('FROM ng_medication_fulfillments WHERE create_key=')) return { rows: [] };
    if (sql.includes('FROM ng_medication_fulfillments')) return { rows: [{ ...state.f }] };
    if (sql.includes('pg_advisory_xact_lock') || sql.includes('FROM ng_medication_operations') || sql.includes('FROM ng_medication_bookings') || sql.includes('FROM ng_medication_payment_attempts')) return { rows: [] };
    if (sql.includes('FROM ng_digital_prescriptions r JOIN ng_pharmacies') || sql.includes('FROM ng_prescriptions r')) { assert.match(sql, /p.account_status='active'/); return { rows: [] }; }
    if (sql.includes('INSERT INTO ng_compliance_audit_log') && auditFails) throw new Error('Isolated audit unavailable');
    if (sql.startsWith('INSERT INTO ng_medication_events') || sql.includes('INSERT INTO ng_compliance_audit_log')) return { rows: [] };
    if (sql.startsWith('UPDATE ng_orders')) { if (sql.includes("status='cancelled'")) state.order.status = 'cancelled'; return { rows: [] }; }
    if (sql.startsWith('UPDATE ng_medication_fulfillments')) { if (sql.includes('cancellation_requested_at=')) state.f.cancellation_requested_at = new Date(); if (sql.includes('inventory_released_at=')) state.f.inventory_released_at = new Date(); return { rows: [] }; }
    if (sql.startsWith('UPDATE ng_pharmacy_inventory') || sql.startsWith('UPDATE ng_rx_items')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const pool = { connect: async () => client, query: (...args) => client.query(...args) };
  const external = () => { state.external++; throw new Error('No external call is allowed'); };
  const service = createMedicationDeliveryWorkflowService({ pool, env: { NODE_ENV: 'test', NG_MEDICATION_CHECKOUT_ENABLED: 'true', PAYSTACK_SECRET_KEY: 'sk_test_isolated', NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000' }, provider: { getAvailability: () => ({ available: false }), book: external, getQuote: external }, gateway: { initializeTransaction: external }, finance: { refundOrder: async () => { state.refunds++; } } });
  return { state, pool, client, service };
}
const request = { version: 1, idempotencyKey: 'isolated-suspension-request', attest: true, consent: true, stage: 'medicines', deliveryType: 'pickup' };
const denied = error => error.status === 403;

test('clinical pharmacy policy rejects suspended, unverified, expired, malformed and missing authority', () => {
  assert.equal(isClinicalPharmacyActive(pharmacy), true);
  for (const patch of [{ account_status: 'suspended' }, { account_status: null }, { status: 'pending' }, { verified_at: null }, { pcn_license_expiry: 'invalid-date' }, { pcn_license_expiry: null }, { pcn_license_expiry: '2000-01-01' }, { pcn_license_number: ' ' }, { superintendent_pcn_number: null }]) assert.equal(isClinicalPharmacyActive({ ...pharmacy, ...patch }), false);
  assert.equal(isClinicalPharmacyActive(null), false);
});

test('suspended pharmacy owners cannot read checkout or replay any pharmacy fulfillment command', async () => {
  for (const method of ['getCheckout', 'confirmPrice', 'confirmPharmacy', 'markReady', 'collect', 'dispatch', 'receiveReturn', 'cancel']) {
    const f = fixture({ pharmacyPatch: { account_status: 'suspended' } });
    await assert.rejects(f.service[method](ids.order, actors.pharmacist, request), denied);
    assert.equal(f.state.calls.some(call => /^(?:UPDATE|INSERT)/.test(call.sql)), false, method);
    assert.equal(f.state.external, 0); assert.equal(f.state.calls.at(-1).sql, 'ROLLBACK');
  }
});

test('patients cannot approve, pay, reserve or quote new fulfillment with a suspended pharmacy', async () => {
  for (const method of ['approve', 'setFulfillment', 'requestQuote', 'initiatePayment']) {
    const f = fixture({ pharmacyPatch: { account_status: 'suspended' } });
    await assert.rejects(f.service[method](ids.order, actors.patient, request), denied);
    assert.equal(f.state.calls.some(call => /^(?:UPDATE|INSERT)/.test(call.sql)), false, method); assert.equal(f.state.external, 0);
  }
  const f = fixture({ pharmacyPatch: { account_status: 'suspended' } });
  await assert.rejects(f.service.createOrder({ pharmacyId: ids.pharmacy, idempotencyKey: 'isolated-create-request' }, actors.patient), denied);
  assert.equal(f.state.calls.some(call => /^(?:UPDATE|INSERT)/.test(call.sql)), false);
});

test('suspension preserves patient read, cancellation and refund reconciliation without enabling fulfillment actions', async () => {
  const f = fixture({ pharmacyPatch: { account_status: 'suspended' } });
  const current = await f.service.getCheckout(ids.order, actors.patient);
  assert.equal(current.pharmacy.active, false); assert.equal(current.actions.canCancel, true);
  for (const action of ['canChoose', 'canPrice', 'canConfirm', 'canReady', 'canApproveMedicines', 'canPayMedicines', 'canRequestQuote', 'canApproveQuote', 'canPayDelivery', 'canDispatch', 'canMarkCollected']) assert.equal(current.actions[action], false, action);
  const cancelled = await f.service.cancel(ids.order, actors.patient, request);
  assert.equal(cancelled.status, 'cancelled'); assert.equal(f.state.refunds, 1); assert.equal(f.state.external, 0);
  const system = await f.service._test.tx(client => f.service._test.load(client, ids.order, null, { system: true, lock: true }));
  assert.equal(system.order.id, ids.order, 'System reconciliation remains available for existing external receipts.');
});

test('current account suspension and market revocation deny order data despite stale session context', async () => {
  for (const actorPatch of [{ is_active: false }, { account_status: 'suspended' }, { market_scope: 'US' }]) {
    const f = fixture({ actorPatch }); await assert.rejects(f.service.getCheckout(ids.order, actors.patient), denied);
    assert.equal(f.state.calls.some(call => call.sql.startsWith('INSERT')), false);
  }
  const f = fixture(); await f.service.getOrderOptions(actors.patient);
  assert.equal(f.state.calls.filter(call => call.sql.includes("p.account_status='active'")).length, 2);
  await assert.rejects(f.service.getOrderOptions(actors.pharmacist), denied);
});

test('FHIR clinical export also rejects a suspended pharmacy owner before building resources or recording successful read', async () => {
  const f = fixture({ pharmacyPatch: { account_status: 'suspended' } });
  await assert.rejects(fhir.read(f.pool, actors.pharmacist, ids.order), denied);
  assert.equal(f.state.calls.some(call => call.sql.includes('INSERT INTO ng_compliance_audit_log')), false);
  assert.equal(f.state.calls.at(-1).sql, 'ROLLBACK');
});

let activePool;
const orderPath = require.resolve('../services/pharmacy/orderService'); const originalLoad = Module._load;
let orders;
try {
  Module._load = function(name, parent) { if (parent?.filename === orderPath && name === '../../../server/db') return { getPool: () => activePool }; return originalLoad.apply(this, arguments); };
  delete require.cache[orderPath]; orders = require(orderPath);
} finally { Module._load = originalLoad; }

test('pharmacy order list checks current actor, ownership and pharmacy authority in its audited read transaction', async () => {
  for (const [options, actor] of [[{ pharmacyPatch: { account_status: 'suspended' } }, actors.pharmacist], [{ pharmacyPatch: { owner_user_id: ids.admin } }, actors.pharmacist], [{ actorPatch: { is_active: false } }, actors.pharmacist], [{}, actors.admin]]) {
    const f = fixture(options); activePool = f.pool;
    await assert.rejects(orders.listPharmacyOrders(ids.pharmacy, {}, actor), denied);
    assert.equal(f.state.calls.some(call => call.sql.includes('FROM ng_orders o JOIN users')), false);
  }
  const f = fixture(); activePool = f.pool;
  assert.equal((await orders.listPharmacyOrders(ids.pharmacy, { limit: 2 }, actors.pharmacist))[0].id, ids.order);
  assert.ok(f.state.calls.some(call => call.sql.includes('INSERT INTO ng_compliance_audit_log')));
  assert.equal(f.state.calls.at(-1).sql, 'COMMIT');
  const failed = fixture({ auditFails: true }); activePool = failed.pool;
  await assert.rejects(orders.listPharmacyOrders(ids.pharmacy, {}, actors.pharmacist), /Isolated audit unavailable/);
  assert.equal(failed.state.calls.at(-1).sql, 'ROLLBACK');
});
