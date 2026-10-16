'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

// This suite mutates only an explicitly supplied, loopback test database.
const target = process.env.SIMULATION_DATABASE_URL;
if (!target || !['127.0.0.1', 'localhost'].includes(new URL(target).hostname) || !new URL(target).pathname.endsWith('_test')) {
  throw new Error('SIMULATION_DATABASE_URL must identify a disposable loopback database ending in _test.');
}
process.env.DATABASE_URL = target;
process.env.JWT_ACCESS_SECRET = 'synthetic-careops-db-jwt-secret-at-least-32-chars';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_synthetic';
process.env.ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const db = require('../../server/db');
const { withProviderReservation } = require('../../server/services/appointmentReservationService');
const { patientFinancialAccess } = require('../../server/middleware/financialRecordScope');
const billing = require('../services/payments/consultationBillingService');
const delivery = require('../services/public-health/dhis2DeliveryService');
const { canAccessReport, accessibleReportIds } = require('../middleware/reportScope');
const rbac = require('../middleware/rbac');
const express = require('express');
const jwt = require('jsonwebtoken');
const ids = Object.fromEntries(['patient', 'otherPatient', 'usPatient', 'provider', 'otherProvider', 'reviewer', 'appointment', 'claim', 'tariff', 'report', 'otherReport', 'facility', 'otherFacility', 'jurisdiction', 'otherJurisdiction', 'pharmacy', 'order'].map((key) => [key, crypto.randomUUID()]));
let pool;
let appServer;
let baseUrl;
let invoice;
let job;

test.before(async () => {
  pool = db.getPool();
  for (const key of ['patient', 'otherPatient', 'usPatient', 'provider', 'otherProvider', 'reviewer']) {
    const role = key.includes('Provider') || key === 'provider' || key === 'reviewer' ? 'provider' : 'patient';
    await pool.query(`INSERT INTO users (id,email,password_hash,first_name,last_name,role,provider_status,is_active,market_scope)
      VALUES ($1,$2,'synthetic-not-a-login-password','Synthetic','Fixture',$3,'approved',true,$4)`, [ids[key], `${ids[key]}@example.test`, role, key === 'usPatient' ? 'US' : 'NG']);
  }
  const app = express();
  app.use(express.json());
  app.use('/claims', require('../../server/routes/claims'));
  app.use('/insurance', require('../../server/routes/insurance'));
  app.use('/interop', require('../../server/routes/interoperability'));
  app.use('/governance', require('../../server/middleware/auth').authenticate, require('../routes/governance'));
  app.use('/public-health', require('../../server/middleware/auth').authenticate, require('../routes/publicHealth'));
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  appServer = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => appServer.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${appServer.address().port}`;
});

function bearer(key) { return `Bearer ${jwt.sign({ userId: ids[key] }, process.env.JWT_ACCESS_SECRET, { expiresIn: 600 })}`; }

test('concurrent reservations yield one appointment and one conflict in real PostgreSQL', async () => {
  const input = { providerId: ids.provider, patientId: ids.patient, marketScope: 'NG', scheduledAt: new Date(Date.now() + 86400000).toISOString(), durationMinutes: 30 };
  const reserve = () => withProviderReservation(db, input, (client) => client.query(
    `INSERT INTO appointments(id,patient_id,provider_id,scheduled_at,duration_minutes,type,payment_required,payment_completed)
     VALUES ($1,$2,$3,$4,30,'video',true,false) RETURNING *`, [crypto.randomUUID(), ids.patient, ids.provider, input.scheduledAt]
  ));
  const results = await Promise.allSettled([reserve(), reserve()]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'APPOINTMENT_CONFLICT');
  ids.appointment = results.find((result) => result.status === 'fulfilled').value.rows[0].id;
  await assert.rejects(withProviderReservation(db, { ...input, patientId: ids.usPatient }, async () => {}), { code: 'APPOINTMENT_SCOPE_DENIED' });
});

test('patient and provider financial access require ownership, relationship and market', async () => {
  assert.equal(await patientFinancialAccess({ id: ids.patient, role: 'patient', marketScope: 'NG' }, ids.otherPatient), false);
  assert.equal(await patientFinancialAccess({ id: ids.provider, role: 'provider', marketScope: 'NG' }, ids.patient), true);
  assert.equal(await patientFinancialAccess({ id: ids.otherProvider, role: 'provider', marketScope: 'NG' }, ids.patient), false);
  assert.equal(await patientFinancialAccess({ id: ids.provider, role: 'admin', marketScope: 'NG' }, ids.usPatient), false);
});

test('stale appointment mutations cannot overwrite a concurrent state change', async () => {
  const snapshot = (await pool.query('SELECT *, xmin::text AS revision FROM appointments WHERE id=$1', [ids.appointment])).rows[0];
  await pool.query('UPDATE appointments SET updated_at=NOW() WHERE id=$1', [ids.appointment]);
  await assert.rejects(withProviderReservation(db, {
    providerId: ids.provider, patientId: ids.patient, marketScope: 'NG', scheduledAt: snapshot.scheduled_at,
    durationMinutes: 30, excludeId: ids.appointment, expectedRevision: snapshot.revision,
  }, async () => { throw new Error('A stale mutation must not run'); }), { code: 'APPOINTMENT_CHANGED' });
});

test('FHIR Patient and Encounter serialize from the migrated schema with correct ownership', async () => {
  const patientResponse = await fetch(`${baseUrl}/interop/fhir/Patient/${ids.patient}`, { headers: { authorization: bearer('patient') } });
  assert.equal(patientResponse.status, 200);
  const patient = await patientResponse.json();
  assert.equal(patient.resourceType, 'Patient'); assert.equal(patient.id, ids.patient); assert.equal(patient.active, true);
  assert.equal(patient.meta.profile, undefined);
  const encounterResponse = await fetch(`${baseUrl}/interop/fhir/Encounter/${ids.appointment}`, { headers: { authorization: bearer('provider') } });
  assert.equal(encounterResponse.status, 200);
  const encounter = await encounterResponse.json();
  assert.equal(encounter.resourceType, 'Encounter'); assert.equal(encounter.subject.reference, `Patient/${ids.patient}`);
  assert.equal(encounter.status, 'planned');
});

test('real claim routes deny unrelated providers and keep unavailable submissions draft', async () => {
  await pool.query(`INSERT INTO claims(id,patient_id,provider_id,claim_type,billing_provider_npi,service_date_start,service_date_end,cpt_codes,icd_codes,total_charge_amount)
    VALUES ($1,$2,$3,'professional','0000000000',CURRENT_DATE,CURRENT_DATE,ARRAY[]::text[],ARRAY[]::text[],100)`, [ids.claim, ids.patient, ids.provider]);
  const denied = await fetch(`${baseUrl}/claims/${ids.claim}`, { headers: { authorization: bearer('otherProvider') } });
  assert.equal(denied.status, 404);
  const listing = await fetch(`${baseUrl}/claims`, { headers: { authorization: bearer('otherProvider') } });
  assert.deepEqual((await listing.json()).claims, []);
  const submitted = await fetch(`${baseUrl}/claims/${ids.claim}/submit`, { method: 'POST', headers: { authorization: bearer('provider') } });
  assert.equal(submitted.status, 503);
  assert.equal((await pool.query('SELECT claim_status FROM claims WHERE id=$1', [ids.claim])).rows[0].claim_status, 'draft');
  const fhirDenied = await fetch(`${baseUrl}/interop/fhir/Patient/${ids.patient}`, { headers: { authorization: bearer('otherPatient') } });
  assert.equal(fhirDenied.status, 404);
});

test('smart booking rejects missing intake and non-patient actors before creating appointments', async () => {
  const app = express();
  app.use(express.json()); app.use('/appointments', require('../../server/routes/appointments'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/appointments/smart-book`;
  try {
    const body = JSON.stringify({ category: 'primary_care', reasonForVisit: 'Synthetic request', scheduledAt: new Date(Date.now() + 86400000).toISOString() });
    const patient = await fetch(url, { method: 'POST', body, headers: { authorization: bearer('patient'), 'content-type': 'application/json' } });
    assert.equal(patient.status, 400);
    const provider = await fetch(url, { method: 'POST', body, headers: { authorization: bearer('provider'), 'content-type': 'application/json' } });
    assert.equal(provider.status, 403);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM appointments WHERE patient_id=$1', [ids.patient])).rows[0].count, 1);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('consultation pricing is server-owned and concurrent invoice creation is idempotent', async () => {
  await pool.query(`INSERT INTO ng_consultation_tariffs(id,service_key,display_name,amount_minor,effective_from,approved_by,approval_reference,active)
    VALUES ($1,'consultation_video','Synthetic test tariff',150005,NOW()-interval '1 day',$2,'synthetic-test-approval',true)`, [ids.tariff, ids.reviewer]);
  const env = { NG_PATIENT_CHECKOUT_ENABLED: 'true', PAYSTACK_SECRET_KEY: 'sk_test_synthetic' };
  const results = await Promise.all([billing.createInvoice(ids.patient, ids.appointment, { env }), billing.createInvoice(ids.patient, ids.appointment, { env })]);
  assert.equal(results[0].id, results[1].id);
  invoice = results[0]; assert.equal(invoice.amountMinor, 150005);
  await assert.rejects(billing.createInvoice(ids.otherPatient, ids.appointment, { env }), { statusCode: 404 });
});

test('ambiguous checkout retains one attempt and never initializes another collectible payment', async () => {
  let calls = 0;
  const gateway = { async initializeTransaction() { calls++; throw new Error('synthetic timeout after acceptance'); } };
  const env = { NG_PATIENT_CHECKOUT_ENABLED: 'true', PAYSTACK_SECRET_KEY: 'sk_test_synthetic' };
  await assert.rejects(billing.initializeCheckout(ids.patient, invoice.id, { gateway, env }), { code: 'PAYMENT_INITIALIZATION_AMBIGUOUS' });
  await assert.rejects(billing.initializeCheckout(ids.patient, invoice.id, { gateway, env }), { code: 'PAYMENT_RECONCILIATION_REQUIRED' });
  assert.equal(calls, 1);
});

test('wrong payment amount is rejected and concurrent confirmation posts one ledger entry', async () => {
  const attempt = (await pool.query('SELECT * FROM ng_consultation_payment_attempts WHERE invoice_id=$1', [invoice.id])).rows[0];
  const payment = { status: 'success', reference: attempt.reference, amount: invoice.amountMinor, currency: 'NGN', domain: 'test', id: 'synthetic-receipt', paid_at: new Date().toISOString() };
  await assert.rejects(billing.confirmReference(attempt.reference, { gateway: { verifyTransaction: async () => ({ data: { ...payment, amount: 1 } }) } }), { code: 'PAYMENT_MISMATCH' });
  assert.equal((await pool.query('SELECT status FROM ng_consultation_invoices WHERE id=$1', [invoice.id])).rows[0].status, 'open');
  const gateway = { verifyTransaction: async () => ({ data: payment }) };
  const results = await Promise.all([billing.confirmReference(attempt.reference, { gateway }), billing.confirmReference(attempt.reference, { gateway })]);
  assert.equal(results.filter((result) => result.alreadyConfirmed).length, 1);
  assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ng_payment_ledger_entries WHERE invoice_id=$1', [invoice.id])).rows[0].count, 1);
  const appointment = (await pool.query('SELECT status,payment_completed FROM appointments WHERE id=$1', [ids.appointment])).rows[0];
  assert.equal(appointment.payment_completed, true); assert.equal(appointment.status, 'scheduled');
  await assert.rejects(billing.verifyOwnedInvoice(ids.otherPatient, invoice.id, { gateway }), { statusCode: 404 });
});

test('verified webhook replay is durable and never repeats a confirmed financial posting', async () => {
  const gateway = require('../services/payments/paystackService');
  const previousVerify = gateway.verifyTransaction;
  const attempt = (await pool.query('SELECT * FROM ng_consultation_payment_attempts WHERE invoice_id=$1', [invoice.id])).rows[0];
  gateway.verifyTransaction = async () => ({ data: { status: 'success', reference: attempt.reference, amount: invoice.amountMinor, currency: 'NGN', domain: 'test', id: 'synthetic-receipt', paid_at: new Date().toISOString() } });
  const app = express();
  app.use(express.json({ verify: (req, _res, bytes) => { req.rawBody = Buffer.from(bytes); } }));
  app.use('/webhooks', require('../routes/webhooks'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/webhooks/paystack`;
  const raw = Buffer.from(JSON.stringify({ event: 'charge.success', data: { id: 'synthetic-event', reference: attempt.reference, amount: invoice.amountMinor } }));
  const signature = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(raw).digest('hex');
  try {
    const rejected = await fetch(url, { method: 'POST', body: Buffer.concat([raw, Buffer.from(' ')]), headers: { 'content-type': 'application/json', 'x-paystack-signature': signature } });
    assert.equal(rejected.status, 401);
    for (let index = 0; index < 2; index++) {
      const response = await fetch(url, { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-paystack-signature': signature } });
      assert.equal(response.status, 200);
    }
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM ng_payment_ledger_entries WHERE invoice_id=$1', [invoice.id])).rows[0].count, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM ng_integration_webhook_receipts WHERE provider='paystack' AND resource_reference=$1", [attempt.reference])).rows[0].count, 1);
  } finally {
    await pool.query("DELETE FROM ng_integration_webhook_receipts WHERE provider='paystack' AND resource_reference=$1", [attempt.reference]);
    gateway.verifyTransaction = previousVerify;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('report jurisdiction checks and list filtering reject a foreign facility and revoked assignment', async () => {
  for (const key of ['jurisdiction', 'otherJurisdiction']) await pool.query("INSERT INTO ng_jurisdictions(id,code,name,tier) VALUES ($1,$2,'Synthetic jurisdiction','area_council')", [ids[key], `T${ids[key].slice(0,7)}`]);
  for (const key of ['facility', 'otherFacility']) await pool.query("INSERT INTO public_health_facilities(id,name) VALUES ($1,'Synthetic facility')", [ids[key]]);
  for (const [report, facility, jurisdiction] of [['report', 'facility', 'jurisdiction'], ['otherReport', 'otherFacility', 'otherJurisdiction']]) {
    await pool.query(`INSERT INTO public_health_reports(id,report_period,facility_id,status,generated_by,approved_by,approved_at)
      VALUES ($1,'2026-09',$2,'approved',$3,$4,NOW())`, [ids[report], ids[facility], ids.provider, ids.reviewer]);
    await pool.query(`INSERT INTO ng_governance_submissions(report_id,facility_id,submitter_user_id,jurisdiction_id,submission_period)
      VALUES ($1,$2,$3,$4,'2026-09')`, [ids[report], ids[facility], ids.provider, ids[jurisdiction]]);
  }
  await pool.query("INSERT INTO ng_user_jurisdiction_roles(user_id,jurisdiction_id,role,active,can_approve) VALUES ($1,$2,'approver',true,true)", [ids.reviewer, ids.jurisdiction]);
  const actor = { id: ids.reviewer, role: 'provider' };
  assert.equal(await canAccessReport(actor, ids.report), true);
  assert.equal(await canAccessReport(actor, ids.otherReport), false);
  await pool.query("INSERT INTO ng_user_jurisdiction_roles(user_id,jurisdiction_id,role,active,can_approve,can_export) VALUES ($1,$2,'analyst',true,false,false)", [ids.reviewer, ids.otherJurisdiction]);
  assert.equal(await canAccessReport(actor, ids.otherReport), true);
  assert.equal(await canAccessReport(actor, ids.otherReport, 'approve'), false);
  assert.equal(await canAccessReport(actor, ids.otherReport, 'export'), false);
  assert.equal(await canAccessReport(actor, ids.report, 'approve'), true);
  const relocated = await fetch(`${baseUrl}/governance/submissions`, { method: 'POST', headers: { authorization: bearer('reviewer'), 'content-type': 'application/json' },
    body: JSON.stringify({ reportId: ids.otherReport, facilityId: ids.otherFacility, jurisdictionId: ids.jurisdiction, period: '2026-09' }) });
  assert.equal(relocated.status, 409, 'Submission metadata cannot relocate an existing report');
  const approvedForeign = await fetch(`${baseUrl}/public-health/reports/${ids.otherReport}/approve`, { method: 'POST', headers: { authorization: bearer('reviewer'), 'content-type': 'application/json' }, body: '{}' });
  assert.equal(approvedForeign.status, 404, 'Read rights cannot borrow approval from another jurisdiction');
  const nationalAnalytics = await fetch(`${baseUrl}/public-health/analytics`, { headers: { authorization: bearer('reviewer') } });
  assert.equal(nationalAnalytics.status, 403);
  assert.ok((await accessibleReportIds(actor)).includes(ids.report));
  await rbac.getUserJurisdictionScopes(ids.reviewer);
  await pool.query('UPDATE ng_user_jurisdiction_roles SET active=false WHERE user_id=$1', [ids.reviewer]);
  assert.equal(await canAccessReport(actor, ids.report), false);
});

test('durable delivery recovers ambiguous POST by GET reconciliation without duplicate submission', async () => {
  const report = (await pool.query('SELECT * FROM public_health_reports WHERE id=$1', [ids.report])).rows[0];
  const payload = { dataSet: 'a1234567890', orgUnit: 'b1234567890', period: '202609', dataValues: [{ dataElement: 'c1234567890', value: 0 }] };
  const baseUrl = 'https://synthetic-dhis2.example.test';
  const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const args = { report, payload, payloadHash, destinationHash: delivery.destinationIdentity(baseUrl, null, payload), actorUserId: ids.reviewer };
  const results = await Promise.all([delivery.enqueueDelivery(pool, args), delivery.enqueueDelivery(pool, args)]);
  assert.equal(results[0].id, results[1].id); job = results[0];
  let postCount = 0;
  const uncertain = await delivery.deliverOrReconcile(pool, job, { baseUrl, apiToken: 'synthetic-token', fetchImpl: async (_url, options) => { if (options.method === 'POST') postCount++; throw new Error('synthetic interrupted transport'); } });
  assert.equal(uncertain.delivery.status, 'reconciliation');
  const saved = (await pool.query('SELECT * FROM ng_dhis2_delivery_jobs WHERE id=$1', [job.id])).rows[0];
  await pool.query('UPDATE ng_dhis2_delivery_jobs SET next_attempt_at=NOW() WHERE id=$1', [job.id]);
  const recovered = await delivery.deliverOrReconcile(pool, saved, { baseUrl, apiToken: 'synthetic-token', fetchImpl: async (_url, options) => { assert.notEqual(options.method, 'POST'); return { ok: true, json: async () => ({ ...payload, dataValues: [{ dataElement: 'c1234567890', orgUnit: payload.orgUnit, period: payload.period, value: '0' }] }) }; } });
  assert.equal(recovered.delivery.status, 'confirmed'); assert.equal(postCount, 1);
  assert.equal((await pool.query('SELECT status FROM public_health_reports WHERE id=$1', [ids.report])).rows[0].status, 'synced');
  await assert.rejects(delivery.enqueueDelivery(pool, { ...args, payloadHash: 'a'.repeat(64) }), { code: 'REPORT_REVISION_REQUIRED' });
});

test('pharmacy payment confirmation credits wallet and revenue exactly once with an atomic audit', async () => {
  const orders = require('../services/pharmacy/orderService');
  const orchestrator = require('../services/payments/paymentOrchestrator');
  const previousVerify = orchestrator.verifyPayment;
  const reference = `synthetic-pharmacy-${ids.order}`;
  await pool.query(`INSERT INTO ng_pharmacies(id,name,slug,pcn_license_number,pcn_license_expiry,superintendent_name,superintendent_pcn_number,superintendent_phone,address_line1,city,state,phone,email)
    VALUES ($1,'Synthetic pharmacy',$2,$3,CURRENT_DATE+30,'Synthetic fixture','SYNTHETIC','00000000000','Synthetic test address','Abuja','FCT','00000000000',$4)`,
    [ids.pharmacy, ids.pharmacy, ids.pharmacy.slice(0,16), `${ids.pharmacy}@example.test`]);
  await pool.query('INSERT INTO ng_pharmacy_wallets(pharmacy_id) VALUES ($1)', [ids.pharmacy]);
  await pool.query(`INSERT INTO ng_orders(id,order_number,patient_user_id,pharmacy_id,subtotal,total_amount,platform_fee,pharmacy_payout_amount,payment_reference,payment_provider)
    VALUES ($1,$2,$3,$4,1500,1750,250,1500,$5,'paystack')`, [ids.order, `S${ids.order.slice(0,18)}`, ids.patient, ids.pharmacy, reference]);
  orchestrator.verifyPayment = async () => ({ verified: true, reference, amountMinor: 175000, amount: 1750, currency: 'NGN', environment: 'test' });
  try {
    const results = await Promise.all([orders.confirmPayment(reference, 'paystack'), orders.confirmPayment(reference, 'paystack')]);
    assert.equal(results.filter((result) => result.alreadyConfirmed).length, 1);
    const wallet = (await pool.query('SELECT pending_balance FROM ng_pharmacy_wallets WHERE pharmacy_id=$1', [ids.pharmacy])).rows[0];
    assert.equal(Number(wallet.pending_balance), 1500);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM ng_wallet_transactions WHERE order_id=$1', [ids.order])).rows[0].count, 1);
    assert.equal((await pool.query('SELECT total_orders FROM ng_platform_revenue WHERE pharmacy_id=$1', [ids.pharmacy])).rows[0].total_orders, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM ng_compliance_audit_log WHERE resource_id=$1 AND action='order.payment_confirmed'", [ids.order])).rows[0].count, 1);
  } finally { orchestrator.verifyPayment = previousVerify; }
});

test('media webhook evidence is durable, deduplicated and cannot admit an unknown participant', async () => {
  const { recordEvent } = require('../services/conferencing/livekitWebhookService');
  const roomId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  await pool.query(`INSERT INTO ng_conf_rooms(id,room_code,title,host_user_id,status,media_server) VALUES ($1,$2,'Synthetic conference',$3,'live','livekit')`, [roomId, `S${roomId}`, ids.provider]);
  let removals = 0;
  try {
    const event = { id: eventId, event: 'participant_joined', room: { name: roomId }, participant: { identity: ids.otherPatient } };
    const controls = { disconnect: async (room, identity) => { assert.equal(room, roomId); assert.equal(identity, ids.otherPatient); removals++; } };
    await recordEvent(pool, event, controls);
    assert.equal((await recordEvent(pool, event, controls)).duplicate, true);
    assert.equal(removals, 2);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM ng_conf_events WHERE room_id=$1', [roomId])).rows[0].count, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM ng_conf_participants WHERE room_id=$1', [roomId])).rows[0].count, 0);
  } finally {
    await pool.query("DELETE FROM ng_integration_webhook_receipts WHERE provider='livekit' AND event_key=$1", [eventId]);
    await pool.query('DELETE FROM ng_conf_rooms WHERE id=$1', [roomId]);
  }
});

test.after(async () => {
  try {
  if (appServer) await new Promise((resolve) => appServer.close(resolve));
  if (pool) {
    await pool.query('DELETE FROM ng_dhis2_delivery_jobs WHERE report_id=ANY($1::uuid[])', [[ids.report, ids.otherReport]]);
    await pool.query('DELETE FROM public_health_reports WHERE id=ANY($1::uuid[])', [[ids.report, ids.otherReport]]);
    await pool.query('DELETE FROM ng_user_jurisdiction_roles WHERE user_id=$1', [ids.reviewer]);
    await pool.query('DELETE FROM public_health_facilities WHERE id=ANY($1::uuid[])', [[ids.facility, ids.otherFacility]]);
    await pool.query('DELETE FROM ng_jurisdictions WHERE id=ANY($1::uuid[])', [[ids.jurisdiction, ids.otherJurisdiction]]);
    if (invoice) {
      await pool.query('DELETE FROM ng_payment_ledger_entries WHERE invoice_id=$1', [invoice.id]);
      await pool.query('DELETE FROM ng_consultation_payment_attempts WHERE invoice_id=$1', [invoice.id]);
      await pool.query('DELETE FROM ng_consultation_invoices WHERE id=$1', [invoice.id]);
    }
    await pool.query('DELETE FROM ng_consultation_tariffs WHERE id=$1', [ids.tariff]);
    await pool.query('DELETE FROM appointments WHERE id=$1', [ids.appointment]);
    await pool.query('DELETE FROM audit_logs WHERE user_id=ANY($1::uuid[])', [[ids.patient, ids.otherPatient, ids.usPatient, ids.provider, ids.otherProvider, ids.reviewer]]);
    const fixtureUsers = [ids.patient, ids.otherPatient, ids.usPatient, ids.provider, ids.otherProvider, ids.reviewer];
    await pool.query('UPDATE users SET is_active=false WHERE id=ANY($1::uuid[])', [fixtureUsers]);
    // Keep synthetic actors referenced by immutable financial audit evidence.
    await pool.query('DELETE FROM users u WHERE id=ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM ng_compliance_audit_log a WHERE a.actor_user_id=u.id)', [fixtureUsers]);
  }
  } finally { await db.close(); }
});
