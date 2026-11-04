'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const workflow = require('../services/rx-engine/prescriptionWorkflowService');

function fixture({ status = 'received', itemStatus = 'pending', reservation = null, conflict = false } = {}) {
  const state = { rx: { id: 'rx-1', lifecycle_status: status }, items: [{ id: 'item-1', drug_name: 'Isolated fixture medicine', quantity: 2, status: itemStatus, fulfillment_order_id: reservation }], events: [], calls: [], released: false };
  let saved;
  const client = {
    release() { state.released = true; },
    async query(sql, params = []) {
      state.calls.push({ sql, params });
      if (sql === 'BEGIN') { saved = structuredClone({ rx: state.rx, items: state.items, events: state.events }); return { rows: [] }; }
      if (sql === 'ROLLBACK') { Object.assign(state, saved); return { rows: [] }; }
      if (sql === 'COMMIT') return { rows: [] };
      if (sql.includes('SELECT * FROM ng_digital_prescriptions')) return { rows: [{ ...state.rx }] };
      if (sql.includes('SELECT * FROM ng_rx_items')) return { rows: state.items.map(row => ({ ...row })) };
      if (sql.includes('COUNT(*) FILTER')) return { rows: [{ total: state.items.length, dispensed: state.items.filter(row => row.status === 'dispensed').length, finalized: state.items.filter(row => ['dispensed', 'cancelled', 'unavailable'].includes(row.status)).length }] };
      if (sql.includes('UPDATE ng_rx_items')) {
        const item = state.items.find(row => row.id === params[0]);
        if (!item) return { rows: [] };
        item.status = sql.includes("status = 'dispensed'") ? 'dispensed' : 'unavailable'; return { rows: [{ id: item.id }] };
      }
      if (sql.includes('UPDATE ng_digital_prescriptions')) {
        assert.match(sql, /AND lifecycle_status\s*=\s*\$\d+/);
        assert.match(sql, /RETURNING/);
        if (conflict) return { rows: [] };
        const literal = /SET lifecycle_status = '([^']+)'/.exec(sql);
        state.rx.lifecycle_status = literal ? literal[1] : params[1];
        return { rows: [{ ...state.rx }] };
      }
      if (sql.includes('INSERT INTO ng_rx_events')) { state.events.push({ params }); return { rows: [] }; }
      throw new Error(`Unexpected Rx fixture SQL: ${sql}`);
    },
  };
  return { state, pool: { connect: async () => client }, client };
}

test('legacy prescription mutation uses one transaction with header lock, CAS and audit', async () => {
  const { state, pool } = fixture({ status: 'drafted' });
  await workflow.sign('rx-1', { user_id: 'doctor-1', kind: 'prescriber' }, { sig_text: 'Authorized fixture signoff' }, pool);
  assert.equal(state.rx.lifecycle_status, 'signed');
  assert.equal(state.calls[0].sql, 'BEGIN');
  assert.match(state.calls.find(call => call.sql.includes('SELECT * FROM ng_digital_prescriptions')).sql, /FOR UPDATE/);
  assert.equal(state.calls.at(-1).sql, 'COMMIT');
  assert.equal(state.events.length, 1);
  assert.equal(state.released, true);
});

test('concurrent header change cannot be overwritten or falsely audited as cancellation', async () => {
  const { state, pool } = fixture({ conflict: true });
  await assert.rejects(workflow.cancel('rx-1', { user_id: 'doctor-1' }, { reason: 'Withdrawal' }, pool), { code: 'INVALID_STATE' });
  assert.equal(state.rx.lifecycle_status, 'received');
  assert.equal(state.events.length, 0);
  assert.equal(state.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(state.released, true);
});

test('failed lifecycle CAS rolls back item dispensing and its clinical history together', async () => {
  const { state, pool } = fixture({ conflict: true });
  await assert.rejects(workflow.dispenseItem('rx-1', 'item-1', { kind: 'pharmacist' }, { quantity: 2 }, pool), { code: 'INVALID_STATE' });
  assert.equal(state.items[0].status, 'pending');
  assert.equal(state.events.length, 0);
  assert.equal(state.calls.at(-1).sql, 'ROLLBACK');
});

test('legacy unavailable action cannot alter an item reserved by the medication order', async () => {
  const { state, pool } = fixture({ reservation: 'order-1' });
  await assert.rejects(workflow.markItemUnavailable('rx-1', 'item-1', { kind: 'pharmacist' }, { notes: 'Do not bypass order', fulfillment_order_id: 'order-1' }, pool), { code: 'INVALID_STATE' });
  assert.equal(state.calls.some(call => call.sql.includes('UPDATE ng_rx_items')), false);
  assert.equal(state.events.length, 0);
});

test('legacy dispenser cannot claim an order reservation, while the internal matching order may hand over', async () => {
  const blocked = fixture({ reservation: 'order-1' });
  await assert.rejects(workflow.dispenseItem('rx-1', 'item-1', { kind: 'pharmacist' }, { quantity: 2 }, blocked.pool), { code: 'INVALID_STATE' });
  const allowed = fixture({ reservation: 'order-1' });
  await workflow.dispenseItem('rx-1', 'item-1', { kind: 'pharmacist' }, { quantity: 2, fulfillment_order_id: 'order-1' }, allowed.pool);
  assert.equal(allowed.state.items[0].status, 'dispensed');
  assert.equal(allowed.state.rx.lifecycle_status, 'fully_dispensed');
  const update = allowed.state.calls.find(call => call.sql.includes('UPDATE ng_rx_items'));
  assert.match(update.sql, /prescription_id=\$7/);
  assert.match(update.sql, /fulfillment_order_id=\$6/);
});

test('invalid quantities and terminal states cannot be rewritten through legacy mutations', async () => {
  for (const quantity of [0, -1, 1.5, 3, Infinity]) {
    const { state, pool } = fixture();
    await assert.rejects(workflow.dispenseItem('rx-1', 'item-1', {}, { quantity }, pool), { code: 'INVALID_STATE' });
    assert.equal(state.calls.some(call => call.sql.includes('UPDATE ng_rx_items')), false);
  }
  const closed = fixture({ status: 'completed', itemStatus: 'dispensed' });
  await assert.rejects(workflow.markItemUnavailable('rx-1', 'item-1', {}, {}, closed.pool), { code: 'INVALID_STATE' });
  const dispensed = fixture({ status: 'fully_dispensed', itemStatus: 'dispensed' });
  await assert.rejects(workflow.cancel('rx-1', {}, {}, dispensed.pool), { code: 'INVALID_TRANSITION' });
});

test('existing transaction clients are reused without nesting a new transaction', async () => {
  const { state, client } = fixture({ status: 'fully_dispensed', itemStatus: 'dispensed' });
  await workflow.complete('rx-1', { kind: 'pharmacist' }, client);
  assert.equal(state.calls.some(call => call.sql === 'BEGIN'), false);
  assert.equal(state.rx.lifecycle_status, 'completed');
  assert.equal(state.released, false);
});
