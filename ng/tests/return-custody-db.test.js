'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { createBrowserFixture } = require('./helpers/medication-delivery-fixture');
const { createReturnCustodyService } = require('../services/pharmacy/returnCustodyService');
const target = process.env.SIMULATION_DATABASE_URL;
const approvals = { NG_RETURN_CUSTODY_ENABLED: 'true', NG_RETURN_CUSTODY_CLINICIAN_APPROVAL: 'isolated-clinician-only', NG_RETURN_CUSTODY_PRIVACY_APPROVAL: 'isolated-privacy-only', NG_RETURN_CUSTODY_OPERATIONS_APPROVAL: 'isolated-operations-only' };

async function act(f, orderId, method, actor, body = {}) {
  const checkout = await f.service.getCheckout(orderId, actor);
  return f.service[method](orderId, actor, { version: checkout.version, idempotencyKey: crypto.randomUUID(), ...body });
}
async function returnedParcel(f) {
  const orderId = (await f.service.createOrder(f.input, f.patient)).order.id;
  await act(f, orderId, 'confirmPrice', f.pharmacist, { items: [{ drugId: f.drugId, unitPriceMinor: f.unitPriceMinor }], pharmacistRegistrationNumber: f.registration, attest: true, packageCategory: 'sealed_ambient_medication' });
  await act(f, orderId, 'setFulfillment', f.patient, { deliveryType: 'delivery', consent: true, address: f.address, contactConsent: true });
  await act(f, orderId, 'approve', f.patient, { stage: 'medicines', consent: true });
  const medicine = await act(f, orderId, 'initiatePayment', f.patient, { stage: 'medicines' });
  await f.service.verifyPayment(orderId, f.patient, medicine.reference);
  await act(f, orderId, 'confirmPharmacy', f.pharmacist); await act(f, orderId, 'markReady', f.pharmacist, { attest: true });
  const quote = await act(f, orderId, 'requestQuote', f.patient);
  await act(f, orderId, 'approve', f.patient, { stage: 'delivery', quoteId: quote.quote.id, consent: true });
  const delivery = await act(f, orderId, 'initiatePayment', f.patient, { stage: 'delivery' });
  await f.service.verifyPayment(orderId, f.patient, delivery.reference); await act(f, orderId, 'dispatch', f.pharmacist);
  await f.advanceDelivery('picked_up'); await f.service.refresh(orderId, f.pharmacist);
  await f.advanceDelivery('returned'); await f.service.refresh(orderId, f.pharmacist);
  await f.pool.query("UPDATE ng_pharmacies SET account_status='suspended' WHERE id=$1", [f.pharmacyId]);
  return orderId;
}
const nomination = (version, receivingPharmacyId, now) => ({ version, receivingPharmacyId, idempotencyKey: crypto.randomUUID(), patientAuthorizationReference: 'isolated-sharing-authorization', transferApprovalReference: 'isolated-transfer-approval', receivingAcceptanceReference: 'isolated-receiver-acceptance', expiresAt: new Date(now + 3600000).toISOString(), authorizationVerified: true, sealedAmbientOnly: true });
const receipt = p => ({ version: p.version, nominationId: p.nominationId, idempotencyKey: crypto.randomUUID(), evidenceReference: 'isolated-witnessed-quarantine', physicallyReceivedAndQuarantined: true });

test('PostgreSQL proposed alternate custody is current, atomic, minimal and separate from refund approval', { skip: !target }, async t => {
  const url = new URL(target); assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'), 'Only an explicitly disposable loopback test database is supported.');
  const previous = { NODE_ENV: process.env.NODE_ENV, ENCRYPTION_KEY: process.env.ENCRYPTION_KEY }; process.env.NODE_ENV = 'test';
  const pool = new Pool({ connectionString: target, max: 8 });
  try {
    const f = await createBrowserFixture({ pool }); const receiver = await createBrowserFixture({ pool }); const replacement = await createBrowserFixture({ pool });
    const orderId = await returnedParcel(f);
    const serviceOptions = { pool, env: { NODE_ENV: 'test', ...approvals }, now: () => f.state.now };
    const custody = createReturnCustodyService(serviceOptions);
    const current = () => f.service.getCheckout(orderId, f.patient);
    let parcel;
    await t.test('recorded sharing authorization enables only parcel fields, with no clinical access for either suspended or substitute owners', async () => {
      await assert.rejects(f.service.receiveReturn(orderId, f.pharmacist, {}), { status: 403 });
      await assert.rejects(f.service.getCheckout(orderId, receiver.pharmacist), { status: 404 });
      await assert.rejects(f.service.refundReturn(orderId, f.superAdmin, { attest: true, approvalReference: 'isolated-return-approval' }), { status: 409 });
      parcel = await custody.nominate(orderId, f.superAdmin, nomination((await current()).version, receiver.pharmacyId, f.state.now));
      const queue = await custody.list(receiver.pharmacyId, receiver.pharmacist); assert.equal(queue.returns.length, 1);
      assert.deepEqual(Object.keys(queue.returns[0]).sort(), ['disposition', 'expiresAt', 'handlingCategory', 'nominatedAt', 'nominationId', 'orderId', 'orderNumber', 'receivedAt', 'version'].sort());
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM ng_compliance_audit_log WHERE resource_id=$1 AND action='medication_return_custody_parcel_read'", [orderId])).rows[0].count, 1);
    });
    await t.test('supersession holds order authority until commit and denies a blocked old-recipient receipt', async () => {
      let releaseCommit; const holdCommit = new Promise(resolve => { releaseCommit = resolve; });
      let reachedCommit; const atCommit = new Promise(resolve => { reachedCommit = resolve; });
      const pausedPool = { async connect() { const client = await pool.connect(); return { release: () => client.release(), async query(sql, params) { if (sql === 'COMMIT') { reachedCommit(); await holdCommit; } return client.query(sql, params); } }; } };
      const paused = createReturnCustodyService({ ...serviceOptions, pool: pausedPool });
      const replacementRequest = paused.nominate(orderId, f.superAdmin, nomination(parcel.version, replacement.pharmacyId, f.state.now));
      let waiting;
      try {
        await Promise.race([atCommit, replacementRequest]);
        let settled = false;
        waiting = custody.receive(orderId, receiver.pharmacyId, receiver.pharmacist, receipt(parcel)).then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
        await new Promise(resolve => setTimeout(resolve, 75)); assert.equal(settled, false);
        releaseCommit(); parcel = await replacementRequest;
        assert.equal((await waiting).error.status, 409);
      } finally { releaseCommit(); await Promise.allSettled([replacementRequest, waiting].filter(Boolean)); }
      assert.deepEqual((await custody.list(receiver.pharmacyId, receiver.pharmacist)).returns, []);
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM ng_medication_events WHERE order_id=$1 AND action='return_custody_nominated'", [orderId])).rows[0].count, 2);
    });
    await t.test('current owner, workspace and account suspension revoke nomination authority even with the same request', async () => {
      const input = receipt(parcel);
      await pool.query('UPDATE ng_pharmacies SET owner_user_id=$1 WHERE id=$2', [replacement.otherPharmacist.id, replacement.pharmacyId]);
      await assert.rejects(custody.receive(orderId, replacement.pharmacyId, replacement.pharmacist, input), { status: 403 });
      await assert.rejects(custody.receive(orderId, replacement.pharmacyId, replacement.otherPharmacist, input), { status: 403 });
      await pool.query('UPDATE ng_pharmacies SET owner_user_id=$1 WHERE id=$2', [replacement.pharmacist.id, replacement.pharmacyId]);
      await pool.query("UPDATE users SET account_status='suspended' WHERE id=$1", [replacement.pharmacist.id]);
      await assert.rejects(custody.receive(orderId, replacement.pharmacyId, replacement.pharmacist, input), { status: 403 });
      await pool.query("UPDATE users SET account_status='active' WHERE id=$1", [replacement.pharmacist.id]);
      await pool.query("UPDATE ng_pharmacies SET account_status='suspended' WHERE id=$1", [replacement.pharmacyId]);
      await assert.rejects(custody.receive(orderId, replacement.pharmacyId, replacement.pharmacist, input), { status: 403 });
      await pool.query("UPDATE ng_pharmacies SET account_status='active' WHERE id=$1", [replacement.pharmacyId]);
    });
    await t.test('audit failure rolls receipt back and verified quarantine changes no stock, dispensing or money', async () => {
      const input = receipt(parcel);
      const badPool = { async connect() { const client = await pool.connect(); return { release: () => client.release(), query(sql, params) { if (sql.includes('INSERT INTO ng_compliance_audit_log')) throw new Error('Isolated custody audit failure'); return client.query(sql, params); } }; } };
      await assert.rejects(createReturnCustodyService({ ...serviceOptions, pool: badPool }).receive(orderId, replacement.pharmacyId, replacement.pharmacist, input), /Isolated custody audit failure/);
      assert.equal((await current()).returns.receivedAt, null);
      const inventory = async () => (await pool.query('SELECT quantity_available,quantity_reserved FROM ng_pharmacy_inventory WHERE id=$1', [f.inventoryId])).rows;
      const dispenses = async () => (await pool.query('SELECT id FROM ng_fhir_medication_dispenses WHERE order_id=$1 ORDER BY id', [orderId])).rows;
      const stockBefore = await inventory(); const dispensesBefore = await dispenses(); const callsBefore = { ...f.state };
      const verified = await custody.receive(orderId, replacement.pharmacyId, replacement.pharmacist, input);
      assert.equal(verified.disposition, 'quarantined');
      assert.deepEqual(await custody.receive(orderId, replacement.pharmacyId, replacement.pharmacist, input), verified);
      assert.deepEqual(await inventory(), stockBefore); assert.deepEqual(await dispenses(), dispensesBefore);
      for (const name of ['refundCalls', 'initializeCalls', 'bookCalls', 'quoteCalls']) assert.equal(f.state[name], callsBefore[name]);
      const checkout = await current(); assert.equal(checkout.actions.canApproveReturnRefund, true); assert.equal(checkout.returns.refundApprovalReference, null); assert.match(checkout.returns.evidenceReference, /^alternate-custody:/);
      // Custody uses the database clock; advance the synthetic finance clock
      // past that witnessed receipt rather than treating slow CI as future proof.
      f.state.now = Math.max(f.state.now, Date.now(), Date.parse(verified.receivedAt)) + 1000;
      await assert.rejects(f.service.refundReturn(orderId, f.admin, { attest: true, approvalReference: 'isolated-return-approval' }), { status: 403 });
      await f.service.refundReturn(orderId, f.superAdmin, { attest: true, approvalReference: 'isolated-return-approval' });
      assert.equal(f.state.refundCalls, 2, 'Only the separate super-admin approval initiates synthetic refunds.');
    });
    // Synthetic fixture data and append-only evidence are retained only in the
    // disposable CI database. No provisioned accounts or live transports used.
  } finally {
    await pool.end(); for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
