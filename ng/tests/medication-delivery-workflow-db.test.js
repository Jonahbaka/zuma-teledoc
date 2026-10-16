'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { createBrowserFixture } = require('./helpers/medication-delivery-fixture');

const target = process.env.SIMULATION_DATABASE_URL;
const request = (checkout, body = {}) => ({ version: checkout.version, idempotencyKey: crypto.randomUUID(), ...body });

async function act(f, orderId, method, actor, body = {}) {
  const checkout = await f.service.getCheckout(orderId, actor);
  return f.service[method](orderId, actor, request(checkout, body));
}

async function pay(f, orderId, stage) {
  const current = await f.service.getCheckout(orderId, f.patient);
  const payment = await f.service.initiatePayment(orderId, f.patient, request(current, { stage }));
  const checkout = await f.service.verifyPayment(orderId, f.patient, payment.reference);
  return { payment, checkout };
}

async function prepared(f, { delivery = false, paid = true, ready = true } = {}) {
  const made = await f.service.createOrder(f.input, f.patient);
  const orderId = made.order.id;
  await act(f, orderId, 'confirmPrice', f.pharmacist, { items: [{ drugId: f.drugId, unitPriceMinor: 900000 }], pharmacistRegistrationNumber: f.registration, attest: true, packageCategory: 'sealed_ambient_medication' });
  await act(f, orderId, 'setFulfillment', f.patient, { deliveryType: delivery ? 'delivery' : 'pickup', consent: true, ...(delivery ? { address: f.address, contactConsent: true } : {}) });
  await act(f, orderId, 'approve', f.patient, { stage: 'medicines', consent: true });
  if (paid) await pay(f, orderId, 'medicines');
  if (ready) {
    await act(f, orderId, 'confirmPharmacy', f.pharmacist);
    await act(f, orderId, 'markReady', f.pharmacist, { attest: true });
  }
  return orderId;
}

async function quoted(f, { payDelivery = true } = {}) {
  const orderId = await prepared(f, { delivery: true });
  const quote = await act(f, orderId, 'requestQuote', f.patient);
  await act(f, orderId, 'approve', f.patient, { stage: 'delivery', quoteId: quote.quote.id, consent: true });
  if (payDelivery) await pay(f, orderId, 'delivery');
  return orderId;
}

test('real PostgreSQL medication checkout, payment, courier and refund workflows remain isolated and financially auditable', { skip: !target }, async t => {
  const url = new URL(target);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname.endsWith('_test'), 'Use only an explicitly disposable loopback test database');
  const previous = { NODE_ENV: process.env.NODE_ENV, ENCRYPTION_KEY: process.env.ENCRYPTION_KEY };
  process.env.NODE_ENV = 'test'; process.env.ENCRYPTION_KEY ||= 'c'.repeat(64);
  const pool = new Pool({ connectionString: target, max: 6 });
  const fixture = options => createBrowserFixture({ pool, ...options });
  try {
    await t.test('concurrent create retries reserve stock once and never accept a body-supplied patient owner', async () => {
      const f = await fixture();
      const input = { ...f.input, patientUserId: f.otherPatient.id, patient_user_id: f.otherPatient.id };
      const results = await Promise.all([f.service.createOrder(input, f.patient), f.service.createOrder(input, f.patient)]);
      assert.equal(results[0].order.id, results[1].order.id);
      assert.equal(results[0].order.patient_user_id, f.patient.id);
      const stock = (await pool.query('SELECT quantity_available,quantity_reserved FROM ng_pharmacy_inventory WHERE id=$1', [f.inventoryId])).rows[0];
      assert.deepEqual(stock, { quantity_available: 99, quantity_reserved: 1 });
      assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ng_orders WHERE pharmacy_id=$1', [f.pharmacyId])).rows[0].count, 1);
      await assert.rejects(f.service.createOrder({ ...input, items: [{ drugId: f.drugId, quantity: 2 }] }, f.patient), { status: 409 });
      await assert.rejects(f.service.createOrder({ ...input, idempotencyKey: crypto.randomUUID() }, f.patient), { status: 409 });
    });

    await t.test('pickup completes final pricing, exact payment, pharmacy verification and collection without courier fees', async () => {
      const f = await fixture(); const orderId = await prepared(f);
      const before = await f.service.getCheckout(orderId, f.patient);
      assert.equal(before.pricing.courierMinor, 0); assert.equal(before.pricing.managementMinor, 0); assert.equal(before.pricing.patientTotalMinor, 900000);
      assert.equal(before.payment.medicines.status, 'verified'); assert.equal(before.actions.canMarkCollected, true);
      const complete = await act(f, orderId, 'collect', f.pharmacist, { attest: true });
      assert.equal(complete.status, 'delivered'); assert.equal(f.state.bookCalls, 0); assert.equal(f.state.quoteCalls, 0);
      assert.equal((await pool.query('SELECT lifecycle_status FROM ng_digital_prescriptions WHERE id=$1', [f.prescriptionId])).rows[0].lifecycle_status, 'completed');
      const dispensed = (await pool.query('SELECT status,dispensed_quantity FROM ng_rx_items WHERE prescription_id=$1', [f.prescriptionId])).rows[0]; assert.deepEqual(dispensed, { status: 'dispensed', dispensed_quantity: 1 });
      const stock = (await pool.query('SELECT quantity_available,quantity_reserved FROM ng_pharmacy_inventory WHERE id=$1', [f.inventoryId])).rows[0];
      assert.deepEqual(stock, { quantity_available: 99, quantity_reserved: 0 });
      const balances = (await pool.query('SELECT account,SUM(debit_minor)::text AS debit,SUM(credit_minor)::text AS credit FROM ng_medication_ledger WHERE order_id=$1 GROUP BY account', [orderId])).rows;
      assert.equal(balances.find(row => row.account === 'pharmacy_payable').credit, '900000');
      assert.equal(balances.some(row => row.account === 'management_revenue' || row.account === 'courier_payable'), false);
      await assert.rejects(act(f, orderId, 'collect', f.pharmacist, { attest: true }), { status: 409 });
    });

    await t.test('foreign patients and pharmacy accounts cannot read or mutate another order', async () => {
      const f = await fixture(); const made = await f.service.createOrder(f.input, f.patient);
      await assert.rejects(f.service.getCheckout(made.order.id, f.otherPatient), { status: 404 });
      await assert.rejects(f.service.getCheckout(made.order.id, f.otherPharmacist), { status: 404 });
      await assert.rejects(f.service.setFulfillment(made.order.id, f.otherPatient, request(made.checkout, { deliveryType: 'pickup', consent: true })), { status: 404 });
      await assert.rejects(f.service.confirmPrice(made.order.id, { ...f.patient, role: 'pharmacy' }, request(made.checkout, {})), { status: 404 });
    });

    await t.test('uploaded prescriptions use migrated items and a pharmacist belonging to the selected pharmacy', async () => {
      const f = await fixture({ uploaded: true });
      const made = await f.service.createOrder(f.input, f.patient);
      assert.equal(made.order.patient_user_id, f.patient.id); assert.equal(made.checkout.items[0].drugId, f.drugId);
      const wrong = await fixture({ uploaded: true });
      await pool.query('UPDATE ng_prescriptions SET verified_by_pharmacist=$1 WHERE id=$2', [wrong.otherPharmacist.id, wrong.prescriptionId]);
      await assert.rejects(wrong.service.createOrder(wrong.input, wrong.patient), { status: 409 });
    });

    await t.test('unapproved, expired, controlled and unverified-stock medication checkout fails before reservation', async () => {
      for (const scenario of ['pharmacy_expired', 'unsigned', 'controlled', 'stock_unverified']) {
        const f = await fixture();
        if (scenario === 'pharmacy_expired') await pool.query('UPDATE ng_pharmacies SET pcn_license_expiry=CURRENT_DATE-1 WHERE id=$1', [f.pharmacyId]);
        if (scenario === 'unsigned') await pool.query('UPDATE ng_digital_prescriptions SET signed_at=NULL WHERE id=$1', [f.prescriptionId]);
        if (scenario === 'controlled') await pool.query('UPDATE ng_drug_catalog SET category=\'controlled\' WHERE id=$1', [f.drugId]);
        if (scenario === 'stock_unverified') await pool.query('UPDATE ng_pharmacy_inventory SET availability_verification_status=\'unverified\' WHERE id=$1', [f.inventoryId]);
        await assert.rejects(f.service.createOrder(f.input, f.patient), undefined, scenario);
        assert.equal((await pool.query('SELECT quantity_reserved FROM ng_pharmacy_inventory WHERE id=$1', [f.inventoryId])).rows[0].quantity_reserved, 0, scenario);
      }
    });

    await t.test('delivery is disabled without an approved provider and cannot silently become a simulated dispatch', async () => {
      const f = await fixture({ providerAvailable: false }); const made = await f.service.createOrder(f.input, f.patient);
      await assert.rejects(f.service.setFulfillment(made.order.id, f.patient, request(made.checkout, { deliveryType: 'delivery', consent: true, contactConsent: true, address: f.address })), { status: 503 });
      const current = await f.service.getCheckout(made.order.id, f.patient);
      assert.equal(current.deliveryType, 'pickup'); assert.equal(current.delivery, null); assert.equal(f.state.bookCalls, 0);
    });

    await t.test('delivery addresses require explicit contact consent and are stored encrypted without diagnosis disclosure', async () => {
      const f = await fixture(); const made = await f.service.createOrder(f.input, f.patient);
      await assert.rejects(f.service.setFulfillment(made.order.id, f.patient, request(made.checkout, { deliveryType: 'delivery', consent: true, address: f.address })), { status: 422 });
      const chosen = await act(f, made.order.id, 'setFulfillment', f.patient, { deliveryType: 'delivery', consent: true, contactConsent: true, address: f.address });
      assert.equal(chosen.address.recipientName, f.address.recipientName); assert.equal(chosen.pricing.courierMinor, null); assert.equal(chosen.pricing.patientTotalMinor, null);
      const saved = (await pool.query('SELECT address_encrypted FROM ng_medication_fulfillments WHERE order_id=$1', [made.order.id])).rows[0].address_encrypted;
      assert.equal(JSON.stringify(saved).includes(f.address.recipientName), false);
      assert.equal((await pool.query('SELECT delivery_address FROM ng_orders WHERE id=$1', [made.order.id])).rows[0].delivery_address, null);
    });

    await t.test('preparation and courier quotes require confirmed medicine prices, consent and verified payment', async () => {
      const f = await fixture(); const orderId = await prepared(f, { delivery: true, paid: false, ready: false });
      await assert.rejects(act(f, orderId, 'confirmPharmacy', f.pharmacist), { status: 409 });
      await assert.rejects(act(f, orderId, 'requestQuote', f.patient), { status: 409 });
      assert.equal(f.state.quoteCalls, 0); assert.equal(f.state.bookCalls, 0);
    });

    await t.test('payment initialization retries and replayed confirmations charge and post only once', async () => {
      const f = await fixture(); const orderId = await prepared(f, { paid: false, ready: false });
      const current = await f.service.getCheckout(orderId, f.patient); const input = request(current, { stage: 'medicines' });
      const requests = await Promise.allSettled([f.service.initiatePayment(orderId, f.patient, input), f.service.initiatePayment(orderId, f.patient, input)]);
      assert.equal(f.state.initializeCalls, 1); assert.ok(requests.some(row => row.status === 'fulfilled'));
      const result = requests.find(row => row.status === 'fulfilled').value;
      const replay = await f.service.initiatePayment(orderId, f.patient, input); assert.equal(replay.reference, result.reference);
      await Promise.all([f.service.verifyPayment(orderId, f.patient, result.reference), f.service.verifyPayment(orderId, f.patient, result.reference)]);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ng_medication_payment_attempts WHERE order_id=$1', [orderId])).rows[0].count, 1);
      assert.equal((await pool.query('SELECT SUM(credit_minor)::text AS amount FROM ng_medication_ledger WHERE order_id=$1 AND account=\'pharmacy_payable\'', [orderId])).rows[0].amount, '900000');
    });

    await t.test('mismatched or failed payment evidence never prepares or dispatches medicines', async () => {
      const f = await fixture(); const orderId = await prepared(f, { paid: false, ready: false });
      const attempt = await f.service.initiatePayment(orderId, f.patient, request(await f.service.getCheckout(orderId, f.patient), { stage: 'medicines' }));
      const receipt = f.state.payments.get(attempt.reference);
      for (const [field, value] of [['amount', 900001], ['currency', 'USD'], ['domain', 'live']]) {
        const original = receipt[field]; receipt[field] = value;
        await assert.rejects(f.service.verifyPayment(orderId, f.patient, attempt.reference), { status: 409 }); receipt[field] = original;
      }
      receipt.status = 'failed'; const checkout = await f.service.verifyPayment(orderId, f.patient, attempt.reference);
      assert.equal(checkout.payment.medicines.status, 'pending'); assert.equal(checkout.actions.canConfirm, false);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ng_medication_ledger WHERE order_id=$1', [orderId])).rows[0].count, 0);
      await assert.rejects(act(f, orderId, 'confirmPharmacy', f.pharmacist), { status: 409 });
    });

    await t.test('failed or abandoned hosted checkout resumes the same collectible reference and cannot create a second charge', async () => {
      for (const status of ['failed', 'abandoned']) {
        const f = await fixture(); const orderId = await prepared(f, { paid: false, ready: false });
        const original = await f.service.initiatePayment(orderId, f.patient, request(await f.service.getCheckout(orderId, f.patient), { stage: 'medicines' }));
        f.state.payments.get(original.reference).status = status;
        const current = await f.service.verifyPayment(orderId, f.patient, original.reference);
        assert.equal(current.payment.medicines.status, 'pending'); assert.equal(current.actions.canConfirm, false);
        f.advance(1000);
        await assert.rejects(act(f, orderId, 'approve', f.patient, { stage: 'medicines', consent: true }), { status: 409 });
        const resumed = await f.service.initiatePayment(orderId, f.patient, request(current, { stage: 'medicines' }));
        assert.equal(resumed.reference, original.reference); assert.equal(resumed.authorizationUrl, original.authorizationUrl); assert.equal(f.state.initializeCalls, 1);
        assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ng_medication_payment_attempts WHERE order_id=$1', [orderId])).rows[0].count, 1);
        assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ng_medication_ledger WHERE order_id=$1', [orderId])).rows[0].count, 0);
      }
    });

    await t.test('a previously verified payment loses fulfillment authority when fresh gateway evidence reverses or changes its amount', async () => {
      for (const scenario of ['medicine_reversed', 'delivery_amount_changed']) {
        const f = await fixture();
        const orderId = scenario === 'medicine_reversed' ? await prepared(f, { ready: false }) : await quoted(f);
        const stage = scenario === 'medicine_reversed' ? 'medicines' : 'delivery';
        const before = await f.service.getCheckout(orderId, f.patient);
        const reference = before.payment[stage].reference;
        const count = (await pool.query('SELECT COUNT(*)::int AS count FROM ng_medication_ledger WHERE order_id=$1', [orderId])).rows[0].count;
        if (scenario === 'medicine_reversed') f.state.payments.get(reference).status = 'reversed';
        else f.state.payments.get(reference).amount += 1;
        const after = await f.service.verifyPayment(orderId, f.patient, reference);
        assert.equal(after.payment[stage].status, 'reconciliation_required', scenario);
        assert.equal(after.actions.canConfirm, false); assert.equal(after.actions.canDispatch, false);
        assert.equal((await pool.query('SELECT status FROM ng_medication_payment_attempts WHERE provider_reference=$1', [reference])).rows[0].status, 'reconciliation_required');
        assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ng_medication_ledger WHERE order_id=$1', [orderId])).rows[0].count, count, 'Changed evidence must not duplicate or fabricate financial postings');
        if (scenario === 'medicine_reversed') await assert.rejects(act(f, orderId, 'confirmPharmacy', f.pharmacist), { status: 409 });
        else await assert.rejects(act(f, orderId, 'dispatch', f.pharmacist), { status: 409 });
        assert.equal(f.state.bookCalls, 0);
      }
    });

    await t.test('an external dashboard refund for a known payment blocks fulfillment without fabricating a local refund or ledger proof', async () => {
      const f = await fixture(); const orderId = await prepared(f, { ready: false });
      const checkout = await f.service.getCheckout(orderId, f.patient); const reference = checkout.payment.medicines.reference;
      const payment = f.state.payments.get(reference); const externalRefundId = ++f.state.nextRefundId;
      f.state.refunds.set(String(externalRefundId), { id: externalRefundId, amount: payment.amount, currency: 'NGN', domain: 'test', status: 'processed', transaction: { id: payment.id, reference } });
      const before = (await pool.query('SELECT COUNT(*)::int AS count FROM ng_medication_ledger WHERE order_id=$1', [orderId])).rows[0].count;
      const outcome = await f.service.handleRefundWebhook('refund.processed', { id: externalRefundId, transaction_reference: reference, amount: payment.amount, currency: 'NGN', domain: 'test' });
      assert.equal(outcome.status, 'reconciliation_required');
      const current = await f.service.getCheckout(orderId, f.patient);
      assert.equal(current.payment.medicines.status, 'reconciliation_required'); assert.equal(current.actions.canConfirm, false); assert.equal(current.actions.canDispatch, false);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ng_medication_ledger WHERE order_id=$1', [orderId])).rows[0].count, before);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ng_medication_refunds r JOIN ng_medication_payment_attempts p ON p.id=r.payment_id WHERE p.order_id=$1', [orderId])).rows[0].count, 0);
      // A refunded charge may still be reported as a successful original
      // transaction. Re-verifying that charge cannot release a refund hold.
      try {
        const reverified = await f.service.verifyPayment(orderId, f.patient, reference);
        assert.equal(reverified.payment.medicines.status, 'reconciliation_required');
      } catch (error) { assert.equal(error.status || error.statusCode, 409); }
      const held = await f.service.getCheckout(orderId, f.patient);
      assert.equal(held.payment.medicines.status, 'reconciliation_required'); assert.equal(held.actions.canConfirm, false);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ng_medication_ledger WHERE order_id=$1', [orderId])).rows[0].count, before);
      await assert.rejects(act(f, orderId, 'confirmPharmacy', f.pharmacist), { status: 409 }); assert.equal(f.state.bookCalls, 0);
    });

    await t.test('uncertain payment initialization is held for reconciliation instead of creating a second charge', async () => {
      const f = await fixture(); const orderId = await prepared(f, { paid: false, ready: false }); f.state.initializationError = true;
      const input = request(await f.service.getCheckout(orderId, f.patient), { stage: 'medicines' });
      await assert.rejects(f.service.initiatePayment(orderId, f.patient, input), { status: 503 });
      await assert.rejects(f.service.initiatePayment(orderId, f.patient, { ...input, idempotencyKey: crypto.randomUUID() }), { status: 409 });
      assert.equal(f.state.initializeCalls, 1);
      assert.equal((await pool.query('SELECT status FROM ng_medication_payment_attempts WHERE order_id=$1', [orderId])).rows[0].status, 'reconciliation_required');
    });

    await t.test('disabled medication checkout cannot initialize a real charge and production cannot inject mock transports', async () => {
      const f = await fixture(); const orderId = await prepared(f, { paid: false, ready: false }); f.env.NG_MEDICATION_CHECKOUT_ENABLED = 'false';
      const current = await f.service.getCheckout(orderId, f.patient); assert.equal(current.actions.canPayMedicines, false);
      await assert.rejects(f.service.initiatePayment(orderId, f.patient, request(current, { stage: 'medicines' })), { status: 503 }); assert.equal(f.state.initializeCalls, 0);
      const { createMedicationDeliveryWorkflowService } = require('../services/logistics/medicationDeliveryWorkflowService');
      const before = process.env.NODE_ENV;
      try { process.env.NODE_ENV = 'production'; assert.throws(() => createMedicationDeliveryWorkflowService(f.serviceOptions)); }
      finally { process.env.NODE_ENV = before; }
    });

    await t.test('authoritative courier quotation uses actual pharmacy pickup and only authorized delivery information', async () => {
      const f = await fixture(); const orderId = await prepared(f, { delivery: true });
      const quote = await act(f, orderId, 'requestQuote', f.patient);
      assert.equal(quote.pricing.courierMinor, 280000); assert.equal(quote.pricing.managementMinor, 75000); assert.equal(quote.pricing.patientTotalMinor, 1255000);
      const sent = f.state.quoteRequests[0];
      assert.equal(sent.pickup.latitude, Number(f.pharmacy.latitude)); assert.equal(sent.pickup.address.streetAddress[0], f.pharmacy.address_line1);
      assert.equal(sent.dropoff.contactName, f.address.recipientName); assert.equal(sent.package.category, 'sealed_ambient_medication');
      assert.equal(JSON.stringify(sent).includes('Isolated verified medication'), false);
      assert.equal(Object.keys(sent).some(key => /diagnos|prescript|medicine/i.test(key)), false);
      f.advance(16 * 60000);
      await assert.rejects(act(f, orderId, 'approve', f.patient, { stage: 'delivery', quoteId: quote.quote.id, consent: true }), { status: 409 });
      await assert.rejects(act(f, orderId, 'dispatch', f.pharmacist), { status: 409 }); assert.equal(f.state.bookCalls, 0);
    });

    await t.test('concurrent dispatch books exactly one courier; private tracking and verified proof complete delivery', async () => {
      const f = await fixture(); const orderId = await quoted(f);
      const current = await f.service.getCheckout(orderId, f.pharmacist); const input = request(current);
      const results = await Promise.all([f.service.dispatch(orderId, f.pharmacist, input), f.service.dispatch(orderId, f.pharmacist, input)]);
      assert.equal(f.state.bookCalls, 1); assert.ok(results.every(row => row.delivery));
      const tracking = await f.service.getTracking(results[0].delivery.trackingId, f.patient); assert.equal(tracking.orderId, orderId);
      await assert.rejects(f.service.getTracking(results[0].delivery.trackingId, f.otherPatient), { status: 404 });
      await f.advanceDelivery('delivered');
      const complete = await f.service.refresh(orderId, f.pharmacist); assert.equal(complete.status, 'delivered'); assert.ok(complete.delivery.deliveryProof);
      assert.equal((await pool.query('SELECT SUM(credit_minor)::text AS amount FROM ng_medication_ledger WHERE order_id=$1 AND account=\'management_revenue\'', [orderId])).rows[0].amount, '75000');
      const ledger = (await pool.query('SELECT SUM(debit_minor)::text AS debits,SUM(credit_minor)::text AS credits FROM ng_medication_ledger WHERE order_id=$1', [orderId])).rows[0]; assert.equal(ledger.debits, ledger.credits);
    });

    await t.test('ambiguous courier booking failure is persisted and never automatically rebooked', async () => {
      const f = await fixture(); const orderId = await quoted(f); f.state.bookError = true;
      await assert.rejects(act(f, orderId, 'dispatch', f.pharmacist), { status: 503 });
      const again = await act(f, orderId, 'dispatch', f.pharmacist);
      assert.equal(again.delivery.status, 'reconciliation_required'); assert.equal(f.state.bookCalls, 1);
      await assert.rejects(act(f, orderId, 'cancel', f.patient, { reason: 'Do not refund an unresolved booking' }), { status: 409 });
      assert.equal(f.state.refundCalls, 0);
      assert.deepEqual((await pool.query('SELECT quantity_available,quantity_reserved FROM ng_pharmacy_inventory WHERE id=$1', [f.inventoryId])).rows[0], { quantity_available: 99, quantity_reserved: 1 });
    });

    await t.test('a definite courier booking rejection allows cancellation, releases stock once and verifies both refunds', async () => {
      const f = await fixture(); const orderId = await quoted(f); f.state.bookError = true; f.state.bookingAmbiguous = false;
      await assert.rejects(act(f, orderId, 'dispatch', f.pharmacist), { status: 409 });
      const again = await act(f, orderId, 'dispatch', f.pharmacist);
      assert.equal(again.delivery.status, 'booking_failed'); assert.equal(again.actions.canCancel, true); assert.equal(f.state.bookCalls, 1);
      const cancelled = await act(f, orderId, 'cancel', f.patient, { reason: 'Courier declined the approved request' });
      assert.equal(cancelled.status, 'cancelled'); assert.equal(f.state.refundCalls, 2);
      assert.deepEqual((await pool.query('SELECT quantity_available,quantity_reserved FROM ng_pharmacy_inventory WHERE id=$1', [f.inventoryId])).rows[0], { quantity_available: 100, quantity_reserved: 0 });
      assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ng_medication_refunds r JOIN ng_medication_payment_attempts p ON p.id=r.payment_id WHERE p.order_id=$1 AND r.status=\'processed\'', [orderId])).rows[0].count, 2);
      assert.equal((await pool.query('SELECT prescription_claim_active FROM ng_medication_fulfillments WHERE order_id=$1', [orderId])).rows[0].prescription_claim_active, false);
      await act(f, orderId, 'cancel', f.patient, { reason: 'Repeat the same cancellation safely' });
      assert.equal(f.state.refundCalls, 2); assert.equal(f.state.bookCalls, 1);
      assert.deepEqual((await pool.query('SELECT quantity_available,quantity_reserved FROM ng_pharmacy_inventory WHERE id=$1', [f.inventoryId])).rows[0], { quantity_available: 100, quantity_reserved: 0 });
    });

    await t.test('a courier response for another external order cannot populate this patient delivery', async () => {
      const f = await fixture(); const orderId = await quoted(f); const book = f.provider.book;
      f.provider.book = async input => ({ ...await book(input), externalId: crypto.randomUUID() });
      await assert.rejects(act(f, orderId, 'dispatch', f.pharmacist), { status: 503 });
      const booking = (await pool.query('SELECT status,provider_delivery_id FROM ng_medication_bookings WHERE order_id=$1', [orderId])).rows[0];
      assert.equal(booking.status, 'reconciliation_required'); assert.equal(booking.provider_delivery_id, null); assert.equal(f.state.bookCalls, 1);
    });

    await t.test('a tracking webhook racing the booking response cannot regress courier pickup status', async () => {
      const f = await fixture(); const orderId = await quoted(f);
      const book = f.provider.book;
      f.provider.book = async input => {
        const result = await book(input);
        const event = { ...result, externalId: input.delivery.id, eventId: crypto.randomUUID(), status: 'in_transit', pickup: { completedAt: new Date(f.state.now).toISOString(), verification: { pictureUrl: 'https://proof.example.invalid/pickup' } } };
        await f.service.acceptCourierWebhook(Buffer.from(JSON.stringify(event)), { 'x-isolated-courier-signature': 'authorized-isolated-event' });
        return result;
      };
      const current = await act(f, orderId, 'dispatch', f.pharmacist);
      assert.equal(current.delivery.status, 'in_transit'); assert.equal(current.status, 'in_transit'); assert.equal(f.state.bookCalls, 1);
      await assert.rejects(act(f, orderId, 'cancel', f.patient, { reason: 'Return review required after pickup' }), { status: 409 });
      assert.equal(f.state.refundCalls, 0);
    });

    await t.test('courier delivery without recipient proof cannot earn the DoctaRx management fee', async () => {
      const f = await fixture(); const orderId = await quoted(f);
      await act(f, orderId, 'dispatch', f.pharmacist);
      f.state.withholdProof = true; await f.advanceDelivery('delivered');
      const pending = await f.service.refresh(orderId, f.pharmacist);
      assert.equal(pending.delivery.status, 'proof_pending'); assert.notEqual(pending.status, 'delivered');
      assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ng_medication_ledger WHERE order_id=$1 AND account=\'management_revenue\'', [orderId])).rows[0].count, 0);
    });

    await t.test('a medicine reclassified for cold-chain transport cannot obtain a courier quote', async () => {
      const f = await fixture(); const orderId = await prepared(f, { delivery: true });
      await pool.query('UPDATE ng_drug_catalog SET delivery_restriction=\'cold_chain\' WHERE id=$1', [f.drugId]);
      await assert.rejects(act(f, orderId, 'requestQuote', f.patient), { status: 422 }); assert.equal(f.state.quoteCalls, 0);
    });

    await t.test('stock expiring after pharmacy readiness cannot be quoted or dispatched', async () => {
      const f = await fixture(); const orderId = await prepared(f, { delivery: true });
      await pool.query('UPDATE ng_pharmacy_inventory SET expiry_date=CURRENT_DATE WHERE id=$1', [f.inventoryId]);
      await assert.rejects(act(f, orderId, 'requestQuote', f.patient), { status: 409 }); assert.equal(f.state.quoteCalls, 0); assert.equal(f.state.bookCalls, 0);
    });

    await t.test('fresh higher courier quote requires new consent and only an exact additional payment', async () => {
      const f = await fixture(); const orderId = await quoted(f); f.advance(1000); f.state.fareMinor = 300000;
      const fresh = await act(f, orderId, 'requestQuote', f.patient);
      assert.equal(fresh.actions.canDispatch, false); assert.equal(fresh.pricing.patientTotalMinor, 1275000);
      await assert.rejects(act(f, orderId, 'dispatch', f.pharmacist), { status: 409 });
      await act(f, orderId, 'approve', f.patient, { stage: 'delivery', quoteId: fresh.quote.id, consent: true });
      const difference = await pay(f, orderId, 'delivery');
      assert.equal(f.state.payments.get(difference.payment.reference).amount, 20000); assert.equal(difference.checkout.actions.canDispatch, true);
      assert.equal((await pool.query('SELECT SUM(amount_minor)::text AS amount FROM ng_medication_payment_attempts WHERE order_id=$1 AND stage=\'delivery\' AND status=\'verified\'', [orderId])).rows[0].amount, '375000');
      assert.equal((await pool.query('SELECT SUM(credit_minor)::text AS amount FROM ng_medication_ledger WHERE order_id=$1 AND account=\'management_unearned\'', [orderId])).rows[0].amount, '75000');
    });

    await t.test('signed webhook replay is idempotent and conflicting or unauthenticated events fail', async () => {
      const f = await fixture(); const orderId = await quoted(f); const dispatched = await act(f, orderId, 'dispatch', f.pharmacist);
      const event = { ...f.state.booking, eventId: crypto.randomUUID(), externalId: dispatched.delivery.trackingId, status: 'courier_assigned' };
      const raw = Buffer.from(JSON.stringify(event)); const headers = { 'x-isolated-courier-signature': 'authorized-isolated-event' };
      assert.equal((await f.service.acceptCourierWebhook(raw, headers)).matched, true);
      assert.equal((await f.service.acceptCourierWebhook(raw, headers)).duplicate, true);
      await assert.rejects(f.service.acceptCourierWebhook(Buffer.from(JSON.stringify({ ...event, status: 'in_transit' })), headers), { status: 409 });
      await assert.rejects(f.service.acceptCourierWebhook(raw, {}), { status: 401 });
      assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ng_courier_webhook_receipts WHERE event_id=$1', [event.eventId])).rows[0].count, 1);
    });

    await t.test('a lower fresh fare refunds the old delivery stage and requires a new explicit quotation and approval', async () => {
      const f = await fixture(); const orderId = await quoted(f); f.advance(1000); f.state.fareMinor = 250000;
      const decreased = await act(f, orderId, 'requestQuote', f.patient);
      assert.equal(f.state.refundCalls, 1); assert.equal(decreased.actions.canDispatch, false); assert.equal(decreased.actions.canApproveQuote, false);
      const refunds = (await pool.query('SELECT r.status,r.amount_minor FROM ng_medication_refunds r JOIN ng_medication_payment_attempts p ON p.id=r.payment_id WHERE p.order_id=$1', [orderId])).rows;
      assert.equal(refunds.length, 1); assert.equal(refunds[0].status, 'processed'); assert.equal(refunds[0].amount_minor, '355000');
      await assert.rejects(act(f, orderId, 'approve', f.patient, { stage: 'delivery', quoteId: decreased.quote.id, consent: true }), { status: 409 });
      f.advance(1000); const refreshed = await act(f, orderId, 'requestQuote', f.patient);
      await act(f, orderId, 'approve', f.patient, { stage: 'delivery', quoteId: refreshed.quote.id, consent: true });
      const newPayment = await pay(f, orderId, 'delivery');
      assert.equal(f.state.payments.get(newPayment.payment.reference).amount, 325000); assert.equal(newPayment.checkout.actions.canDispatch, true);
    });

    await t.test('pharmacy cancellation releases inventory and records only an authoritatively processed refund', async () => {
      const f = await fixture(); const orderId = await prepared(f, { ready: false });
      const cancelled = await act(f, orderId, 'cancel', f.pharmacist, { reason: 'Pharmacy cannot safely prepare this order' });
      assert.equal(cancelled.status, 'cancelled'); assert.equal(f.state.refundCalls, 1);
      assert.equal((await pool.query('SELECT r.status FROM ng_medication_refunds r JOIN ng_medication_payment_attempts p ON p.id=r.payment_id WHERE p.order_id=$1', [orderId])).rows[0].status, 'processed');
      const stock = (await pool.query('SELECT quantity_available,quantity_reserved FROM ng_pharmacy_inventory WHERE id=$1', [f.inventoryId])).rows[0]; assert.deepEqual(stock, { quantity_available: 100, quantity_reserved: 0 });
      await act(f, orderId, 'cancel', f.pharmacist, { reason: 'Repeated cancellation request' }); assert.equal(f.state.refundCalls, 1);
    });

    await t.test('pre-handover cancellation releases a valid signed prescription for one new checkout while preserving its history', async () => {
      const f = await fixture(); const oldOrderId = await prepared(f, { ready: false });
      assert.equal((await f.service.getOrderOptions(f.patient)).prescriptions.some(rx => rx.id === f.prescriptionId), false);
      await act(f, oldOrderId, 'cancel', f.pharmacist, { reason: 'The pharmacy cannot prepare this order now' });
      assert.equal((await f.service.getOrderOptions(f.patient)).prescriptions.some(rx => rx.id === f.prescriptionId), true);
      const input = { ...f.input, idempotencyKey: crypto.randomUUID() };
      const retries = await Promise.all([f.service.createOrder(input, f.patient), f.service.createOrder(input, f.patient)]);
      const newOrderId = retries[0].order.id;
      assert.notEqual(newOrderId, oldOrderId); assert.equal(retries[1].order.id, newOrderId);
      const claims = (await pool.query('SELECT order_id,digital_prescription_id,prescription_claim_active FROM ng_medication_fulfillments WHERE digital_prescription_id=$1 ORDER BY prescription_claim_active', [f.prescriptionId])).rows;
      assert.deepEqual(claims, [
        { order_id: oldOrderId, digital_prescription_id: f.prescriptionId, prescription_claim_active: false },
        { order_id: newOrderId, digital_prescription_id: f.prescriptionId, prescription_claim_active: true },
      ]);
      assert.equal((await f.service.getOrderOptions(f.patient)).prescriptions.some(rx => rx.id === f.prescriptionId), false);
      await assert.rejects(f.service.createOrder({ ...f.input, idempotencyKey: crypto.randomUUID() }, f.patient), { status: 409 });
      await act(f, oldOrderId, 'cancel', f.pharmacist, { reason: 'Old cancellation replay must not release the new claim' });
      assert.equal(f.state.refundCalls, 1);
      assert.equal((await pool.query('SELECT fulfillment_order_id FROM ng_rx_items WHERE prescription_id=$1', [f.prescriptionId])).rows[0].fulfillment_order_id, newOrderId);
      assert.deepEqual((await pool.query('SELECT quantity_available,quantity_reserved FROM ng_pharmacy_inventory WHERE id=$1', [f.inventoryId])).rows[0], { quantity_available: 99, quantity_reserved: 1 });
    });

    await t.test('courier cancellation revealing completed pickup requires return review instead of restocking medicines', async () => {
      const f = await fixture(); const orderId = await quoted(f); await act(f, orderId, 'dispatch', f.pharmacist);
      f.provider.cancel = async () => ({ ...f.state.booking, status: 'cancelled', updatedAt: new Date(f.state.now + 1000).toISOString(), pickup: { completedAt: new Date(f.state.now).toISOString(), verification: { pictureUrl: 'https://proof.example.invalid/pickup' } } });
      await assert.rejects(act(f, orderId, 'cancel', f.patient, { reason: 'Cancel requested while courier picked up' }), { status: 409 });
      assert.equal((await pool.query('SELECT quantity_available FROM ng_pharmacy_inventory WHERE id=$1', [f.inventoryId])).rows[0].quantity_available, 99);
      assert.equal(f.state.refundCalls, 0);
    });

    await t.test('physical returned medicines are quarantined and only a super-admin can approve a merchant-funded refund', async () => {
      const f = await fixture(); const orderId = await quoted(f); await act(f, orderId, 'dispatch', f.pharmacist);
      await f.advanceDelivery('returned'); await f.service.refresh(orderId, f.pharmacist);
      await assert.rejects(f.service.refundReturn(orderId, f.superAdmin, { attest: true, approvalReference: 'Isolated explicit merchant-funded refund' }), { status: 409 });
      f.advance(60000); // The fixed injected clock advances before physical return.
      const received = await act(f, orderId, 'receiveReturn', f.pharmacist, { attest: true, evidenceReference: 'Isolated physical pharmacy receipt' });
      assert.equal(received.returns.disposition, 'quarantined'); assert.ok(received.returns.receivedAt);
      const stock = (await pool.query('SELECT quantity_available,quantity_reserved FROM ng_pharmacy_inventory WHERE id=$1', [f.inventoryId])).rows[0]; assert.deepEqual(stock, { quantity_available: 99, quantity_reserved: 0 });
      await assert.rejects(f.service.refundReturn(orderId, f.admin, { attest: true, approvalReference: 'Isolated explicit merchant-funded refund' }), { status: 403 });
      const refunded = await f.service.refundReturn(orderId, f.superAdmin, { attest: true, approvalReference: 'Isolated explicit merchant-funded refund' });
      assert.equal(refunded.status, 'cancelled'); assert.equal(f.state.refundCalls, 2);
      const courier = (await pool.query('SELECT SUM(credit_minor-debit_minor)::text AS amount FROM ng_medication_ledger WHERE order_id=$1 AND account=\'courier_payable\'', [orderId])).rows[0]; assert.equal(courier.amount, '280000');
      assert.equal((await pool.query('SELECT SUM(debit_minor)::text AS amount FROM ng_medication_ledger WHERE order_id=$1 AND account=\'merchant_refund_expense\'', [orderId])).rows[0].amount, '280000');
      assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ng_medication_refunds r JOIN ng_medication_payment_attempts p ON p.id=r.payment_id WHERE p.order_id=$1 AND r.status=\'processed\'', [orderId])).rows[0].count, 2);
      await f.service.refundReturn(orderId, f.superAdmin, { attest: true, approvalReference: 'Isolated explicit merchant-funded refund' }); assert.equal(f.state.refundCalls, 2);
    });

    await t.test('return-pending cancellation requires physical pharmacy receipt before an explicit merchant refund', async () => {
      const f = await fixture(); const orderId = await quoted(f); await act(f, orderId, 'dispatch', f.pharmacist);
      f.provider.cancel = async () => ({ ...f.state.booking, status: 'cancelled', updatedAt: new Date(f.state.now + 1000).toISOString(), pickup: { completedAt: new Date(f.state.now).toISOString(), verification: { pictureUrl: 'https://proof.example.invalid/pickup' } } });
      await assert.rejects(act(f, orderId, 'cancel', f.patient, { reason: 'Pickup happened while cancelling' }), { status: 409 });
      await assert.rejects(f.service.refundReturn(orderId, f.superAdmin, { attest: true, approvalReference: 'Isolated cancelled pickup return approval' }), { status: 409 });
      f.advance(60000);
      await act(f, orderId, 'receiveReturn', f.pharmacist, { attest: true, evidenceReference: 'Isolated pharmacy counter physical return' });
      const refunded = await f.service.refundReturn(orderId, f.superAdmin, { attest: true, approvalReference: 'Isolated cancelled pickup return approval' });
      assert.equal(refunded.status, 'cancelled'); assert.equal(f.state.refundCalls, 2);
      assert.equal((await pool.query('SELECT quantity_available FROM ng_pharmacy_inventory WHERE id=$1', [f.inventoryId])).rows[0].quantity_available, 99);
      assert.equal((await pool.query('SELECT prescription_claim_active FROM ng_medication_fulfillments WHERE order_id=$1', [orderId])).rows[0].prescription_claim_active, true);
      await assert.rejects(f.service.createOrder({ ...f.input, idempotencyKey: crypto.randomUUID() }, f.patient), { status: 409 });
      assert.equal((await f.service.getOrderOptions(f.patient)).prescriptions.some(rx => rx.id === f.prescriptionId), false);
    });

    await t.test('uncertain refunds remain pending reconciliation and do not claim returned patient money', async () => {
      const f = await fixture(); const orderId = await prepared(f, { ready: false }); f.state.refundError = true;
      await act(f, orderId, 'cancel', f.pharmacist, { reason: 'Pharmacy unavailable' });
      assert.equal((await pool.query('SELECT r.status FROM ng_medication_refunds r JOIN ng_medication_payment_attempts p ON p.id=r.payment_id WHERE p.order_id=$1', [orderId])).rows[0].status, 'reconciliation_required');
      assert.equal((await pool.query('SELECT status FROM ng_medication_payment_attempts WHERE order_id=$1', [orderId])).rows[0].status, 'refund_pending');
      await act(f, orderId, 'cancel', f.pharmacist, { reason: 'Repeat request' }); assert.equal(f.state.refundCalls, 1);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ng_medication_ledger WHERE order_id=$1 AND posting_key LIKE \'refund:%\'', [orderId])).rows[0].count, 0);
    });

    await t.test('verified insurer coordination service is receivable rather than patient cash or duplicated consultation pricing', async () => {
      const f = await fixture(); const made = await f.service.createOrder(f.input, f.patient);
      await act(f, made.order.id, 'confirmPrice', f.pharmacist, { items: [{ drugId: f.drugId, unitPriceMinor: 900000 }], pharmacistRegistrationNumber: f.registration, attest: true, packageCategory: 'sealed_ambient_medication' });
      const programmeId = crypto.randomUUID(); const partnerId = crypto.randomUUID();
      await pool.query('INSERT INTO public_health_programmes(id,name,created_by) VALUES($1,$2,$3)', [programmeId, `Isolated coordination programme ${programmeId}`, f.admin.id]);
      await pool.query(`INSERT INTO ng_insurance_partners(id,programme_id,partner_key,display_name,onboarding_status,contract_reference,activation_evidence_reference,capabilities_json,created_by,updated_by)
        VALUES($1,$2,$3,'Isolated coordination insurer','live','Isolated medication agreement','Isolated activation evidence',$4,$5,$5)`, [partnerId, programmeId, `test-${partnerId}`, JSON.stringify({ medication_orders: true, coordination_fee: true }), f.admin.id]);
      await act(f, made.order.id, 'setCoverage', f.admin, { partnerId, authorizationReference: 'Isolated verified coordination benefit', evidenceReference: 'Isolated HMO approval receipt', expiresAt: new Date(f.state.now + 3600000).toISOString(), allocations: { coordinationMinor: 50000 }, coordination: { authorized: true, billable: true, authorizationReference: 'Isolated separate service authority', payer: 'insurer' } });
      const approved = await act(f, made.order.id, 'approve', f.patient, { stage: 'medicines', consent: true });
      assert.equal(approved.pricing.patientTotalMinor, 900000); assert.equal(approved.pricing.insurerTotalMinor, 50000);
      assert.equal((await pool.query('SELECT SUM(debit_minor)::text AS amount FROM ng_medication_ledger WHERE order_id=$1 AND account=\'insurer_receivable\'', [made.order.id])).rows[0].amount, '50000');
      assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ng_medication_ledger WHERE order_id=$1 AND account=\'gateway_cash\'', [made.order.id])).rows[0].count, 0);
    });
  } finally {
    await pool.end();
    for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
