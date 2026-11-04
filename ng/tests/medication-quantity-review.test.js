'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMedicationDeliveryWorkflowService } = require('../services/logistics/medicationDeliveryWorkflowService');
const ids = Object.fromEntries(['order', 'patient', 'pharmacy', 'rx', 'item', 'booking', 'quote', 'drug'].map((key, i) => [key, `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`]));
function fixture({ auditFails = false } = {}) {
  const state = {
    order: { id: ids.order, patient_user_id: ids.patient, pharmacy_id: ids.pharmacy, delivery_type: 'delivery', status: 'dispatched', items: [{ drug_id: ids.drug, quantity: 2 }] },
    f: { order_id: ids.order, digital_prescription_id: ids.rx, version: 1, medicines_minor: 10000, coverage: {}, coordination: {}, medicines_approval: { patientMinor: 10000, insurerMinor: 0 } },
    rx: { id: ids.rx, lifecycle_status: 'fully_dispensed' },
    items: [{ id: ids.item, prescription_id: ids.rx, fulfillment_order_id: ids.order, drug_id: ids.drug, quantity: 2, dispensed_quantity: 1, status: 'dispensed' }],
    booking: { id: ids.booking, quote_id: ids.quote, provider_delivery_id: 'isolated-provider-delivery', status: 'booked' },
    events: [], audits: [], calls: [], stockReserved: 2, ledger: [], external: 0,
  };
  const actor = { id: ids.patient, role: 'patient', is_active: true, market_scope: 'NG', account_status: 'active' };
  let saved, phase = 'picked_up';
  const client = { release() {}, async query(sql, params = []) {
    state.calls.push({ sql, params });
    if (sql === 'BEGIN') { saved = structuredClone({ ...state, calls: [] }); return { rows: [] }; }
    if (sql === 'ROLLBACK') { const calls=state.calls; Object.assign(state, saved, { calls }); return { rows: [] }; }
    if (sql === 'COMMIT') return { rows: [] };
    if (sql.includes('FROM ng_orders')) return { rows: [structuredClone(state.order)] };
    if (sql.includes('FROM ng_medication_fulfillments')) return { rows: [{ ...state.f, clinical_review_required: state.events.some(e=>e.action==='handover_requires_clinical_review') }] };
    if (sql.includes('FROM ng_pharmacies')) return { rows: [{ id: ids.pharmacy, name: 'Isolated pharmacy', account_status: 'suspended' }] };
    if (sql.includes('FROM users')) return { rows: [actor] };
    if (sql.includes('FROM ng_medication_bookings')) return { rows: [structuredClone(state.booking)] };
    if (sql.includes('FROM ng_medication_quotes')) return { rows: [{ id: ids.quote, provider_quote_id: 'isolated-quote', fare_minor: 100 }] };
    if (sql.includes('FROM ng_medication_payment_attempts')) return { rows: sql.includes('SUM(') ? [{ amount: '10000' }] : [{ stage: 'medicines', status: 'verified', amount_minor: 10000, provider_reference: 'existing-payment' }] };
    if (sql.includes('FROM ng_digital_prescriptions')) { assert.match(sql, /FOR UPDATE/); return { rows: [structuredClone(state.rx)] }; }
    if (sql.includes('FROM ng_rx_items')) return { rows: structuredClone(state.items) };
    if (sql.includes('FROM ng_medication_events')) return { rows: state.events.filter(e=>e.action==='handover_requires_clinical_review').map(()=>({ '?column?': 1 })) };
    if (sql.startsWith('UPDATE ng_medication_bookings')) { Object.assign(state.booking, { status: params[1], pickup_proof: params[3] ? JSON.parse(params[3]) : state.booking.pickup_proof, delivery_proof: params[4] ? JSON.parse(params[4]) : state.booking.delivery_proof }); return { rows: [] }; }
    if (sql.startsWith('UPDATE ng_orders')) { state.order.status=params[0]; return { rows: [] }; }
    if (sql.startsWith('UPDATE ng_pharmacy_inventory')) { state.stockReserved -= state.order.items.reduce((total, item) => total + item.quantity, 0); return { rows: [] }; }
    if (sql.startsWith('UPDATE ng_medication_fulfillments')) { if(sql.includes('inventory_released_at='))state.f.inventory_released_at='2026-01-01'; if(sql.includes('version=version+1'))state.f.version++; return { rows: [] }; }
    if (sql.startsWith('INSERT INTO ng_medication_events')) { state.events.push({ action: params[2], details: JSON.parse(params[3]) }); return { rows: [] }; }
    if (sql.includes('INSERT INTO ng_compliance_audit_log')) { if(auditFails)throw new Error('Isolated audit failure');state.audits.push(params);return { rows: [] }; }
    throw new Error(`Unexpected SQL; no clinical dispense or payment writes allowed: ${sql}`);
  } };
  const pool = { connect: async()=>client, query: (...args)=>client.query(...args) };
  const forbidden = ()=>{state.external++;throw new Error('No new external booking, payment or refund allowed');};
  const service = createMedicationDeliveryWorkflowService({ pool, env: { NODE_ENV: 'test' },
    provider: { getAvailability:()=>({available:false}), async getStatus() { return { currency:'NGN',providerDeliveryId:'isolated-provider-delivery',providerQuoteId:'isolated-quote',externalId:ids.booking,feeMinor:100,status:phase,updatedAt:'2026-01-01T00:00:00Z',pickup:{completedAt:'2026-01-01T00:00:00Z',verification:{}},dropoff:phase==='delivered'?{completedAt:'2026-01-01T00:00:00Z',verification:{}}:{} }; }, book:forbidden,getQuote:forbidden },
    gateway: { initializeTransaction:forbidden,createRefund:forbidden }, finance: { async recognizeDelivery(sameClient,{reference}) { assert.equal(sameClient,client);assert.equal(state.order.status,'delivered');if(!state.ledger.includes(reference))state.ledger.push(reference); },refundOrder:forbidden },
  });
  return { state, async refresh(status) { phase=status;return service.refresh(ids.order,actor); } };
}

test('verified courier handover retains physical and accounting facts but places legacy short quantities on visible review hold', async()=>{
  const f=fixture();const original=structuredClone(f.state.items);
  let dto=await f.refresh('picked_up');assert.equal(dto.status,'in_transit');assert.equal(dto.clinicalReviewRequired,true);
  assert.equal(dto.payment.medicines.status,'verified');assert.equal(f.state.stockReserved,0);assert.ok(dto.delivery.pickupProof);
  dto=await f.refresh('delivered');assert.equal(dto.status,'delivered');assert.ok(dto.delivery.deliveryProof);
  assert.equal(f.state.rx.lifecycle_status,'fully_dispensed');assert.deepEqual(f.state.items,original);
  await f.refresh('delivered');assert.equal(f.state.stockReserved,0);assert.equal(f.state.ledger.length,1);
  assert.equal(f.state.events.filter(e=>e.action==='handover_requires_clinical_review').length,1);
  assert.equal(f.state.events.find(e=>e.action==='handover_requires_clinical_review').details.reason,'dispense_quantity_conflict');
  assert.equal(f.state.calls.some(({sql})=>/UPDATE ng_rx_items|UPDATE ng_digital_prescriptions|ng_fhir_medication_dispenses|ng_medication_refunds/.test(sql)),false);
  assert.equal(f.state.external,0);assert.equal(f.state.calls.at(-1).sql,'COMMIT');
});

test('review audit failure rolls physical status and inventory changes back together rather than swallowing evidence failure', async()=>{
  const f=fixture({auditFails:true});await assert.rejects(f.refresh('picked_up'),/Isolated audit failure/);
  assert.equal(f.state.order.status,'dispatched');assert.equal(f.state.booking.status,'booked');assert.equal(f.state.stockReserved,2);
  assert.equal(f.state.f.inventory_released_at,undefined);assert.equal(f.state.events.length,0);assert.equal(f.state.calls.at(-1).sql,'ROLLBACK');
});

test('cancelled or expired Rx handover records physical facts and review without clinical or FHIR dispensing', async()=>{
  for (const lifecycle_status of ['cancelled','expired']) {
    const f=fixture(); f.state.rx.lifecycle_status=lifecycle_status; Object.assign(f.state.items[0],{status:'available',dispensed_quantity:0});
    const original=structuredClone(f.state.items);
    const pickup=await f.refresh('picked_up'); assert.equal(pickup.status,'in_transit'); assert.equal(pickup.clinicalReviewRequired,true); assert.ok(pickup.delivery.pickupProof);
    const delivered=await f.refresh('delivered'); assert.equal(delivered.status,'delivered'); assert.ok(delivered.delivery.deliveryProof); assert.equal(delivered.payment.medicines.status,'verified');
    await f.refresh('delivered'); assert.equal(f.state.stockReserved,0); assert.equal(f.state.ledger.length,1);
    assert.equal(f.state.rx.lifecycle_status,lifecycle_status); assert.deepEqual(f.state.items,original);
    assert.equal(f.state.events.filter(event=>event.action==='handover_requires_clinical_review').length,1);
    assert.equal(f.state.calls.some(({sql})=>/UPDATE ng_rx_items|UPDATE ng_digital_prescriptions|ng_fhir_medication_dispenses|ng_medication_refunds/.test(sql)),false);
    assert.equal(f.state.calls.filter(({sql})=>sql.includes('FROM ng_pharmacies')).length,9,'Only the existing load calls run; no FHIR context read is attempted');
    assert.equal(f.state.external,0); assert.equal(f.state.calls.at(-1).sql,'COMMIT');
  }
});

test('inactive-Rx review audit failure rolls handover back before any dispensing can be recorded', async()=>{
  for (const lifecycle_status of ['cancelled','expired']) {
    const f=fixture({auditFails:true}); f.state.rx.lifecycle_status=lifecycle_status;
    await assert.rejects(f.refresh('picked_up'),/Isolated audit failure/);
    assert.equal(f.state.rx.lifecycle_status,lifecycle_status); assert.equal(f.state.order.status,'dispatched'); assert.equal(f.state.booking.status,'booked'); assert.equal(f.state.stockReserved,2);
    assert.equal(f.state.f.inventory_released_at,undefined); assert.equal(f.state.events.length,0); assert.equal(f.state.ledger.length,0);
    assert.equal(f.state.calls.some(({sql})=>sql.includes('ng_fhir_medication_dispenses')),false); assert.equal(f.state.calls.at(-1).sql,'ROLLBACK');
  }
});


test('historical order-to-signed-quantity mismatch preserves pickup and delivery instead of dispensing a short quantity', async()=>{
  const f=fixture();f.state.rx.lifecycle_status='received';Object.assign(f.state.items[0],{status:'available',dispensed_quantity:0});
  f.state.order.items[0].quantity=1;f.state.stockReserved=1;
  let dto=await f.refresh('picked_up');assert.equal(dto.status,'in_transit');assert.equal(dto.clinicalReviewRequired,true);
  dto=await f.refresh('delivered');assert.equal(dto.status,'delivered');assert.equal(dto.payment.medicines.status,'verified');
  await f.refresh('delivered');assert.equal(f.state.stockReserved,0);assert.equal(f.state.ledger.length,1);assert.equal(f.state.items[0].dispensed_quantity,0);
  assert.equal(f.state.rx.lifecycle_status,'received');assert.equal(f.state.events.filter(e=>e.action==='handover_requires_clinical_review').length,1);
  assert.equal(f.state.events.find(e=>e.action==='handover_requires_clinical_review').details.reason,'order_quantity_conflict');
  assert.equal(f.state.external,0);
});

test('aggregate matching does not invent one FHIR attribution for multiple signed same-drug items', async()=>{
  const { orderQuantitiesMatch }=require('../services/rx-engine/dispenseQuantityPolicy');
  const f=fixture();f.state.rx.lifecycle_status='received';Object.assign(f.state.items[0],{quantity:1,status:'available',dispensed_quantity:0});
  f.state.items.push({...f.state.items[0],id:'another-signed-item'});
  assert.equal(orderQuantitiesMatch(f.state.order.items,f.state.items),true);
  assert.equal(orderQuantitiesMatch([{drug_id:ids.drug,quantity:1}],f.state.items),false);
  assert.equal(orderQuantitiesMatch([{drug_id:ids.drug,quantity:3}],f.state.items),false);
  const dto=await f.refresh('delivered');assert.equal(dto.status,'delivered');assert.equal(dto.clinicalReviewRequired,true);
  assert.equal(f.state.items.every(item=>item.dispensed_quantity===0),true);
  assert.equal(f.state.events.find(e=>e.action==='handover_requires_clinical_review').details.reason,'multiple_signed_items_same_drug');
  assert.equal(f.state.external,0);
});
