'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/pharmacy/clinicalInboxService');
const ids = { actor: '00000000-0000-4000-8000-000000000001', pharmacy: '00000000-0000-4000-8000-000000000002', rx: '00000000-0000-4000-8000-000000000003', other: '00000000-0000-4000-8000-000000000004' };
const actor = { id: ids.actor, role: 'pharmacy' };
function fixture() {
  const state = {
    account: { id: ids.actor, role: 'pharmacy', is_active: true, account_status: 'active', market_scope: 'NG' },
    pharmacy: { id: ids.pharmacy, owner_user_id: ids.actor, status: 'approved', account_status: 'active', verified_at: '2026-01-01', pcn_license_expiry: '2099-01-01', pcn_license_number: 'TEST-PCN', superintendent_pcn_number: 'TEST-SUPERVISOR' },
    rx: { id: ids.rx, routed_pharmacy_id: ids.pharmacy, signed_at: '2026-01-01', lifecycle_status: 'sent_to_pharmacy', pharmacy_response_status: 'pending_pharmacy_confirmation', confirmed_price_ngn: '500.00', pharmacy_notes: 'Private clinical note', clarification_request: 'Existing query' },
    items: [{ quantity: 2, status: 'dispensed', dispensed_quantity: 2 }], calls: [], audits: [], auditFails: false,
  };
  let before;
  const client = { release() {}, async query(sql, params = []) {
    state.calls.push({ sql, params });
    if (sql === 'BEGIN') { before = structuredClone(state.rx); return { rows: [] }; }
    if (sql === 'ROLLBACK') { state.rx = before; return { rows: [] }; }
    if (sql === 'COMMIT') return { rows: [] };
    if (sql.startsWith('SELECT EXISTS(SELECT 1 FROM ng_medication_events')) return { rows: [{ required: !!state.reviewHeld }] };
    if (sql.includes('FROM users WHERE id=')) { assert.match(sql, /role='pharmacy' AND is_active=TRUE AND account_status='active' AND market_scope='NG' FOR SHARE/); const a = state.account; return { rows: a.id === params[0] && a.role === 'pharmacy' && a.is_active && a.account_status === 'active' && a.market_scope === 'NG' ? [a] : [] }; }
    if (sql.includes('FROM ng_pharmacies WHERE id=')) { assert.match(sql, /owner_user_id=\$2 FOR SHARE/); return { rows: state.pharmacy.id === params[0] && state.pharmacy.owner_user_id === params[1] ? [state.pharmacy] : [] }; }
    if (sql.includes('FROM ng_rx_items')) { assert.match(sql, /FOR SHARE/); return { rows: structuredClone(state.items) }; }
    if (sql.includes('FROM ng_digital_prescriptions WHERE id=')) { assert.match(sql, /routed_pharmacy_id=\$2/); assert.match(sql, /signed_at IS NOT NULL/); assert.match(sql, /FOR UPDATE/); return { rows: state.rx.routed_pharmacy_id === params[1] && state.rx.signed_at && ['sent_to_pharmacy','received','partially_dispensed','fully_dispensed','completed'].includes(state.rx.lifecycle_status) ? [structuredClone(state.rx)] : [] }; }
    if (sql.includes('FROM ng_digital_prescriptions rx')) { assert.match(sql, /rx.routed_pharmacy_id=\$1 AND rx.signed_at IS NOT NULL/); assert.match(sql, /FOR SHARE OF rx/); assert.match(sql, /LIMIT 100/); return { rows: [structuredClone(state.rx)] }; }
    if (sql.includes('FROM ng_whatsapp_notification_log')) { assert.match(sql, /n.pharmacy_id=\$1 AND rx.routed_pharmacy_id=\$1 AND rx.signed_at IS NOT NULL/); assert.match(sql, /FOR SHARE OF n,rx/); assert.doesNotMatch(sql, /provider_response|metadata/); return { rows: [{ id: 'message-only-current-route' }] }; }
    if (sql.startsWith('UPDATE ng_digital_prescriptions')) {
      assert.match(sql, /pharmacy_response_status=\$3::text/);
      assert.equal([...sql.matchAll(/\$3(?![0-9])/g)].length, [...sql.matchAll(/\$3::text/g)].length, 'The shared status parameter must have one explicit PostgreSQL type everywhere.');
      state.rx.pharmacy_response_status = params[2]; state.rx.status = params[3]; state.rx.dispense_status = params[4];
      for (const field of ['confirmed_price_ngn', 'pharmacy_notes', 'clarification_request']) { const match = sql.match(new RegExp(`${field}=\\$(\\d+)`)); if (match) state.rx[field] = params[+match[1] - 1]; }
      return { rows: [structuredClone(state.rx)] };
    }
    if (sql.includes('INSERT INTO ng_compliance_audit_log')) { if (state.auditFails) throw new Error('Private audit SQL and patient details'); state.audits.push(params); return { rows: [] }; }
    throw new Error(`Unexpected clinical inbox query: ${sql}`);
  } };
  return { state, pool: { connect: async () => client } };
}
const denied = status => error => error.status === status;

test('clinical response payloads reject negative or malformed prices, unknown fields, missing clarification and unsafe notes', () => {
  assert.deepEqual(service.validate({ status: 'accepted', confirmedPriceNgn: '1234.50' }), { status: 'accepted', confirmedPriceNgn: 1234.5 });
  for (const price of [-1, 1.001, '1e3', '0x10', true, '10000000000.00']) assert.throws(() => service.validate({ status: 'accepted', confirmedPriceNgn: price }), denied(400));
  for (const input of [{ status: 'completed' }, { status: 'clarification_requested' }, { status: 'accepted', pharmacyNotes: 'x'.repeat(4001) }, { status: 'accepted', pharmacyNotes: 'bad\u0000note' }, { status: 'accepted', routedPharmacyId: ids.other }]) assert.throws(() => service.validate(input), denied(400));
});

test('reads and mutations require current clinical authority held until commit, not a stale role or ownership precheck', async () => {
  const changes = [f => { f.state.account.account_status = 'suspended'; }, f => { f.state.account.market_scope = 'US'; }, f => { f.state.account.role = 'admin'; }, f => { f.state.account.is_active = false; }, f => { f.state.pharmacy.owner_user_id = ids.other; }, f => { f.state.pharmacy.account_status = 'suspended'; }, f => { f.state.pharmacy.verified_at = null; }, f => { f.state.pharmacy.pcn_license_expiry = '2000-01-01'; }];
  for (const mutate of changes) for (const method of ['listPrescriptions', 'listNotifications', 'updateStatus']) {
    const f = fixture(); mutate(f); await assert.rejects(service[method](f.pool, actor, ids.pharmacy, ids.rx, { status: 'accepted' }), denied(403));
    assert.equal(f.state.calls.some(({ sql }) => /FROM ng_digital_prescriptions|FROM ng_whatsapp_notification_log|UPDATE ng_digital_prescriptions/.test(sql)), false);
    assert.equal(f.state.calls.at(-1).sql, 'ROLLBACK');
  }
  const f = fixture(); await assert.rejects(service.listPrescriptions(f.pool, { ...actor, role: 'super_admin' }, ids.pharmacy), denied(403));
});

test('clinical inbox and notification reads require scoped row locks and successful same-transaction audit', async () => {
  for (const method of ['listPrescriptions', 'listNotifications']) {
    const f = fixture(); const rows = await service[method](f.pool, actor, ids.pharmacy); assert.equal(rows.length, 1); assert.equal(f.state.audits.length, 1); assert.equal(f.state.calls.at(-1).sql, 'COMMIT');
    const failing = fixture(); failing.state.auditFails = true; await assert.rejects(service[method](failing.pool, actor, ids.pharmacy), /Private audit/); assert.equal(failing.state.calls.at(-1).sql, 'ROLLBACK');
    assert.doesNotMatch(JSON.stringify(f.state.audits), /Private clinical note|Existing query/);
  }
});

test('unsigned, rerouted, cancelled or terminal prescription responses cannot be overwritten or reopened', async () => {
  for (const patch of [{ routed_pharmacy_id: ids.other }, { signed_at: null }, { lifecycle_status: 'drafted' }]) {
    const f = fixture(); Object.assign(f.state.rx, patch); await assert.rejects(service.updateStatus(f.pool, actor, ids.pharmacy, ids.rx, { status: 'accepted' }), denied(404));
  }
  for (const [patch, status] of [[{}, 'fulfilled'], [{ lifecycle_status: 'fully_dispensed' }, 'accepted'], [{ lifecycle_status: 'partially_dispensed' }, 'cancelled'], [{ pharmacy_response_status: 'cancelled' }, 'accepted'], [{ pharmacy_response_status: 'fulfilled', lifecycle_status: 'fully_dispensed' }, 'fulfilled']]) {
    const f = fixture(); Object.assign(f.state.rx, patch); await assert.rejects(service.updateStatus(f.pool, actor, ids.pharmacy, ids.rx, { status }), denied(409));
    assert.equal(f.state.calls.some(({ sql }) => sql.startsWith('UPDATE')), false);
  }
});

test('untouched price/notes survive a status change and explicit clearing remains deliberate', async () => {
  const f = fixture(); const result = await service.updateStatus(f.pool, actor, ids.pharmacy, ids.rx, { status: 'accepted' });
  assert.equal(result.prescription.confirmed_price_ngn, '500.00'); assert.equal(result.prescription.pharmacy_notes, 'Private clinical note');
  assert.equal(f.state.calls.at(-1).sql, 'COMMIT'); assert.equal(f.state.audits[0][3], 'pharmacy.prescription_status_updated');
  const cleared = await service.updateStatus(f.pool, actor, ids.pharmacy, ids.rx, { status: 'pharmacy_reviewing', pharmacyNotes: null, confirmedPriceNgn: null });
  assert.equal(cleared.prescription.pharmacy_notes, null); assert.equal(cleared.prescription.confirmed_price_ngn, null);
});

test('audit failure atomically rolls clinical updates back and is never reported as success', async () => {
  const f = fixture(); f.state.auditFails = true;
  await assert.rejects(service.updateStatus(f.pool, actor, ids.pharmacy, ids.rx, { status: 'accepted', confirmedPriceNgn: 99 }), /Private audit/);
  assert.equal(f.state.rx.pharmacy_response_status, 'pending_pharmacy_confirmation'); assert.equal(f.state.rx.confirmed_price_ngn, '500.00');
  assert.equal(f.state.calls.at(-1).sql, 'ROLLBACK');
  const result = {}; service.sendError({ status(value) { result.status = value; return this; }, json(body) { result.body = body; } }, new Error('Private audit SQL and patient details'));
  assert.equal(result.status, 503); assert.doesNotMatch(JSON.stringify(result.body), /SQL|patient details/);
});


test('inbox fulfillment requires actual item quantities, not only a historical lifecycle label', async () => {
  for (const recorded of [0, 1, 3]) {
    const f = fixture(); f.state.rx.lifecycle_status = 'fully_dispensed'; f.state.items[0].dispensed_quantity = recorded;
    await assert.rejects(service.updateStatus(f.pool, actor, ids.pharmacy, ids.rx, { status: 'fulfilled' }), denied(409));
    assert.equal(f.state.calls.some(({sql})=>sql.startsWith('UPDATE')), false); assert.equal(f.state.audits.length, 0);
  }
  const f = fixture(); f.state.rx.lifecycle_status = 'fully_dispensed';
  assert.equal((await service.updateStatus(f.pool, actor, ids.pharmacy, ids.rx, { status: 'fulfilled' })).prescription.pharmacy_response_status, 'fulfilled');
});


test('inbox fulfillment cannot bypass an unresolved physical-handover review with otherwise matching item quantities', async()=>{
  const f=fixture();f.state.rx.lifecycle_status='fully_dispensed';f.state.reviewHeld=true;
  await assert.rejects(service.updateStatus(f.pool,actor,ids.pharmacy,ids.rx,{status:'fulfilled'}),denied(409));
  assert.equal(f.state.calls.some(({sql})=>sql.startsWith('UPDATE')),false);
});
