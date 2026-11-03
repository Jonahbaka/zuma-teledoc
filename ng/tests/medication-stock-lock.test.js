'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const filename = require.resolve('../services/logistics/medicationDeliveryWorkflowService');
const localRequire = createRequire(filename);
const loaded = { exports: {} };
vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
  module: loaded, Buffer, process, console,
  require(name) { return name === '../interop/medicationFhirService' ? { async recordFulfillmentDispenses() {} } : localRequire(name); },
}, { filename });
const ids = Object.fromEntries(['order','patient','owner','pharmacy','rx','drug'].map((key,i)=>[key,`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`]));
function fixture({ invalid = false, auditFails = false, rxPatch = {} } = {}) {
  const actor = { id: ids.owner, role: 'pharmacy', is_active: true, market_scope: 'NG', account_status: 'active' };
  const pharmacy = { id: ids.pharmacy, owner_user_id: ids.owner, status: 'approved', account_status: 'active', verified_at: '2026-01-01', pcn_license_expiry: '2099-01-01', pcn_license_number: 'SYNTHETIC', superintendent_pcn_number: 'SYNTHETIC' };
  const order = { id: ids.order, patient_user_id: ids.patient, pharmacy_id: ids.pharmacy, prescription_id: ids.rx, status: 'ready_for_pickup', delivery_type: 'pickup', items: [{ drug_id: ids.drug, quantity: 2 }] };
  const fulfillment = { order_id: ids.order, version: 1, pharmacy_ready_at: '2026-01-01', medicines_minor: 100, medicines_approval: { patientMinor: 100, insurerMinor: 0 }, coverage: {}, coordination: {} };
  const state = { calls: [], locked: false, expiry: '2099-01-01', updateWaiting: false, consumedExpired: false, reserved: 2 };
  let saved;
  const client = { release() {}, async query(sql) {
    state.calls.push(sql);
    if (sql === 'BEGIN') { saved = { order: structuredClone(order), fulfillment: structuredClone(fulfillment), reserved: state.reserved }; return { rows: [] }; }
    if (sql === 'COMMIT' || sql === 'ROLLBACK') {
      if (sql === 'ROLLBACK') { Object.assign(order, saved.order); for (const key of Object.keys(fulfillment)) delete fulfillment[key]; Object.assign(fulfillment, saved.fulfillment); state.reserved = saved.reserved; }
      state.locked = false; if (state.updateWaiting) state.expiry = '2020-01-01'; return { rows: [] };
    }
    if (sql.includes('FROM ng_orders')) return { rows: [order] };
    if (sql.includes('FROM ng_medication_fulfillments')) return { rows: [fulfillment] };
    if (sql.includes('FROM ng_pharmacies')) return { rows: [pharmacy] };
    if (sql.includes('FROM users')) return { rows: [actor] };
    if (sql.includes('FROM ng_prescriptions')) {
      assert.match(sql, /FOR UPDATE/, 'Uploaded prescription authority must remain locked through collection');
      return { rows: [{ patient_user_id: ids.patient, verified_by_pharmacist: ids.owner, verified_at: '2026-01-01', status: 'verified', expires_at: '2099-01-01T00:00:00Z', ...rxPatch }] };
    }
    if (sql.includes('FROM ng_medication_operations') || sql.includes('FROM ng_medication_bookings')) return { rows: [] };
    if (sql.includes('FROM ng_medication_reservations r JOIN ng_pharmacy_inventory')) {
      assert.match(sql, /ORDER BY i\.drug_id,i\.expiry_date,i\.id FOR UPDATE OF i/);
      assert.match(sql, /WHERE r\.order_id=\$1 ORDER BY/);
      assert.doesNotMatch(sql, /LIMIT 1|FOR SHARE/);
      assert.match(sql, /i\.quantity_reserved IS NULL OR i\.quantity_reserved<r\.quantity/);
      state.locked = true;
      return { rows: [{ id: 'first-batch', invalid_stock: false }, { id: 'second-batch', invalid_stock: invalid }] };
    }
    if (sql.includes('FROM ng_medication_payment_attempts')) {
      if (!fulfillment.inventory_released_at) {
        assert.equal(state.locked, true, 'All healthy stock remains locked through payment validation');
        state.updateWaiting = true;
      }
      return { rows: sql.includes('SUM(') ? [{ amount: '100' }] : [] };
    }
    if (sql.startsWith('UPDATE ng_pharmacy_inventory')) { assert.equal(state.locked, true); state.consumedExpired = state.expiry === '2020-01-01'; state.reserved = 0; return { rows: [] }; }
    if (sql.startsWith('UPDATE ng_medication_fulfillments')) { if (sql.includes('inventory_released_at=')) fulfillment.inventory_released_at = '2026-11-03'; if (sql.includes('version=version+1')) fulfillment.version++; return { rows: [] }; }
    if (sql.startsWith('UPDATE ng_orders')) { order.status = 'delivered'; return { rows: [] }; }
    if (sql.includes('INSERT INTO ng_compliance_audit_log')) { assert.equal(state.locked, true); if (auditFails) throw new Error('Synthetic audit failure'); return { rows: [] }; }
    if (sql.startsWith('UPDATE ng_prescriptions') || sql.startsWith('INSERT INTO ng_medication_operations') || sql.startsWith('INSERT INTO ng_medication_events')) return { rows: [] };
    throw new Error(`Unexpected synthetic SQL: ${sql}`);
  } };
  const service = loaded.exports.createMedicationDeliveryWorkflowService({ pool: { connect: async () => client }, env: { NODE_ENV: 'test' }, provider: { getAvailability: () => ({ available: false }) }, gateway: { initializeTransaction() { throw new Error('No external payment is allowed'); } } });
  return { state, order, collect: () => service.collect(ids.order, actor, { version: 1, idempotencyKey: 'synthetic-stock-lock', attest: true }) };
}

test('collection locks every reserved batch until consumption and mandatory audit commit', async () => {
  const f = fixture(); const result = await f.collect();
  assert.equal(result.status, 'delivered'); assert.equal(f.state.reserved, 0);
  assert.equal(f.state.consumedExpired, false); assert.equal(f.state.updateWaiting, true);
  assert.equal(f.state.expiry, '2020-01-01', 'The simulated inventory updater can finish only after the workflow commit');
  assert.equal(f.state.calls.at(-1), 'COMMIT');
});

test('an invalid second reserved batch denies collection before any mutation', async () => {
  const f = fixture({ invalid: true }); await assert.rejects(f.collect(), error => error.status === 409);
  assert.equal(f.order.status, 'ready_for_pickup'); assert.equal(f.state.reserved, 2);
  assert.equal(f.state.calls.some(sql => /^(UPDATE|INSERT)/.test(sql)), false);
  assert.equal(f.state.calls.at(-1), 'ROLLBACK');
});

test('failed collection audit rolls stock and status back and releases inventory locks', async () => {
  const f = fixture({ auditFails: true }); await assert.rejects(f.collect(), /Synthetic audit failure/);
  assert.equal(f.order.status, 'ready_for_pickup'); assert.equal(f.state.reserved, 2);
  assert.equal(f.state.locked, false); assert.equal(f.state.calls.at(-1), 'ROLLBACK');
});

test('an unknown reserved-stock result cannot authorize a new collection', async () => {
  const f = fixture({ invalid: null }); await assert.rejects(f.collect(), error => error.status === 409);
  assert.equal(f.order.status, 'ready_for_pickup'); assert.equal(f.state.reserved, 2);
  assert.equal(f.state.calls.some(sql => /^(UPDATE|INSERT)/.test(sql)), false);
  assert.equal(f.state.calls.at(-1), 'ROLLBACK');
});

test('revoked uploaded prescription authority rejects collection before inventory or operational writes', async () => {
  for (const rxPatch of [{ status: 'rejected' }, { verified_by_pharmacist: null }, { expires_at: '2000-01-01T00:00:00Z' }]) {
    const f = fixture({ rxPatch }); await assert.rejects(f.collect(), error => error.status === 409);
    assert.equal(f.order.status, 'ready_for_pickup'); assert.equal(f.state.reserved, 2);
    assert.equal(f.state.calls.some(sql => sql.includes('ng_pharmacy_inventory') || /^(UPDATE|INSERT)/.test(sql)), false);
    assert.equal(f.state.calls.at(-1), 'ROLLBACK');
  }
});
