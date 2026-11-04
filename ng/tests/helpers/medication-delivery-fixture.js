'use strict';

// Test-only data and transports. Never import this module into application code.
const crypto = require('node:crypto');

async function createBrowserFixture({ pool, providerAvailable = true, uploaded = false } = {}) {
  const target = new URL(pool.options.connectionString);
  if (process.env.NODE_ENV !== 'test' || !['127.0.0.1', 'localhost'].includes(target.hostname) || !target.pathname.endsWith('_test')) {
    throw new Error('Fixtures require NODE_ENV=test and a disposable loopback database ending in _test');
  }
  process.env.ENCRYPTION_KEY ||= 'c'.repeat(64);
  const run = crypto.randomUUID();
  const suffix = run.replace(/-/g, '').slice(0, 16);
  const ids = Object.fromEntries(['patient', 'otherPatient', 'pharmacist', 'otherPharmacist', 'admin', 'superAdmin', 'pharmacy', 'drug', 'inventory', 'prescription'].map(name => [name, crypto.randomUUID()]));
  const actors = {};
  for (const [name, role] of [['patient', 'patient'], ['otherPatient', 'patient'], ['pharmacist', 'pharmacy'], ['otherPharmacist', 'pharmacy'], ['admin', 'admin'], ['superAdmin', 'super_admin']]) {
    const row = (await pool.query(`INSERT INTO users(id,email,password_hash,role,first_name,last_name,country,market_scope,region,is_active,is_verified,is_test_account)
      VALUES($1,$2,'!isolated-fixture-not-a-login',$3,'Isolated','Medication Test','NG','NG','NG',TRUE,TRUE,TRUE) RETURNING id,email,role`, [ids[name], `${name}-${suffix}@doctarx.test`, role])).rows[0];
    actors[name] = { ...row, marketScope: 'NG', country: 'NG', firstName: 'Isolated', lastName: 'Medication Test', accountStatus: 'active', mustChangePassword: false };
  }
  const registration = `TEST-PCN-${suffix}`;
  const pharmacy = (await pool.query(`INSERT INTO ng_pharmacies(id,name,slug,owner_user_id,pcn_license_number,pcn_license_expiry,superintendent_name,superintendent_pcn_number,superintendent_phone,address_line1,city,state,latitude,longitude,phone,email,status,verified_at,delivery_enabled,pickup_enabled)
    VALUES($1,'Isolated Medication Pharmacy',$2,$3,$4,CURRENT_DATE+365,'Authorized Test Pharmacist',$4,'+2348000000001','1 Isolated Test Street','Abuja','FCT',9.0765,7.3986,'+2348000000001',$5,'approved',NOW(),TRUE,TRUE) RETURNING *`, [ids.pharmacy, `isolated-${suffix}`, ids.pharmacist, registration, `pharmacy-${suffix}@doctarx.test`])).rows[0];
  await pool.query(`INSERT INTO ng_drug_catalog(id,name,category,requires_prescription,is_active,delivery_restriction) VALUES($1,$2,'prescription',TRUE,TRUE,'ambient_approved')`, [ids.drug, `Isolated verified medication ${suffix}`]);
  await pool.query(`INSERT INTO ng_pharmacy_inventory(id,pharmacy_id,drug_id,quantity_available,quantity_reserved,batch_number,expiry_date,cost_price,selling_price,is_available,availability_verification_status,availability_verified_at)
    VALUES($1,$2,$3,100,0,$4,CURRENT_DATE+180,8000.00,9000.00,TRUE,'verified',NOW())`, [ids.inventory, ids.pharmacy, ids.drug, suffix]);
  if (uploaded) {
    await pool.query(`INSERT INTO ng_prescriptions(id,patient_user_id,items,status,verified_by_pharmacist,verified_at,expires_at)
      VALUES($1,$2,$3,'verified',$4,NOW(),NOW()+INTERVAL '30 days')`, [ids.prescription, ids.patient, JSON.stringify([{ drug_id: ids.drug, drug_name: 'Isolated verified medication', quantity: 1 }]), ids.pharmacist]);
  } else {
    await pool.query(`INSERT INTO ng_digital_prescriptions(id,patient_user_id,routed_pharmacy_id,preferred_pharmacy_id,items,lifecycle_status,signed_at,sent_at,expires_at,is_controlled)
      VALUES($1,$2,$3,$3,$4,'sent_to_pharmacy',NOW(),NOW(),CURRENT_DATE+30,FALSE)`, [ids.prescription, ids.patient, ids.pharmacy, JSON.stringify([{ drug_id: ids.drug, drug_name: 'Isolated verified medication', quantity: 1 }])]);
    await pool.query(`INSERT INTO ng_rx_items(prescription_id,drug_id,drug_name,dosage,frequency,quantity,status,pharmacy_id)
      VALUES($1,$2,'Isolated verified medication','Verified test directions','Verified test schedule',1,'available',$3)`, [ids.prescription, ids.drug, ids.pharmacy]);
  }
  const state = { now: Date.now(), fareMinor: 280000, quoteCalls: 0, bookCalls: 0, initializeCalls: 0, verifyCalls: 0, refundCalls: 0,
    providerAvailable, providerStatus: 'booked', refundStatus: 'processed', booking: null, quoteRequests: [], payments: new Map(), refunds: new Map(), nextTransactionId: crypto.randomInt(100000000, 90000000000000), nextRefundId: crypto.randomInt(100000000, 90000000000000) };
  const provider = {
    getAvailability() { return { available: state.providerAvailable, providers: state.providerAvailable ? [{ id: 'uber_direct', name: 'Uber Direct' }] : [], reasons: state.providerAvailable ? [] : ['Approved courier activation is unavailable in this isolated scenario.'] }; },
    async getQuote(input) {
      state.quoteCalls++; state.quoteRequests.push(input);
      if (!state.providerAvailable || state.quoteError) throw Object.assign(new Error('Isolated courier unavailable'), { status: 503 });
      return { provider: 'uber_direct', providerQuoteId: `dqt_${crypto.randomUUID()}`, feeMinor: state.fareMinor, currency: 'NGN', expiresAt: new Date(state.now + 15 * 60000).toISOString(),
        pickupEta: new Date(state.now + 20 * 60000).toISOString(), dropoffEta: new Date(state.now + 40 * 60000).toISOString(), requestFingerprint: crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex') };
    },
    async book({ quote, delivery, idempotencyKey }) {
      state.bookCalls++; state.lastBookingRequest = { quote, delivery, idempotencyKey };
      if (state.bookError) throw Object.assign(new Error('Isolated ambiguous booking failure'), { ambiguous: state.bookingAmbiguous !== false });
      state.booking = { providerDeliveryId: `del_${crypto.randomUUID()}`, providerQuoteId: quote.providerQuoteId, externalId: delivery.id, currency: 'NGN', feeMinor: quote.feeMinor, status: 'booked', updatedAt: new Date(state.now).toISOString(), pickup: {}, dropoff: {} };
      return { ...state.booking };
    },
    async getStatus() {
      if (!state.booking) throw new Error('No isolated booking');
      return { ...state.booking, status: state.providerStatus, updatedAt: new Date(state.now).toISOString(),
        pickup: ['picked_up', 'in_transit', 'delivered'].includes(state.providerStatus) ? { completedAt: new Date(state.now).toISOString(), verification: { pictureUrl: 'https://proof.example.invalid/pickup' } } : {},
        dropoff: state.providerStatus === 'delivered' && !state.withholdProof ? { completedAt: new Date(state.now).toISOString(), verification: { signatureUrl: 'https://proof.example.invalid/recipient-signature' } } : {} };
    },
    async cancel() { state.providerStatus = 'cancelled'; return { ...state.booking, status: 'cancelled', updatedAt: new Date(state.now).toISOString() }; },
    verifyWebhook(raw, headers) {
      if (headers['x-isolated-courier-signature'] !== 'authorized-isolated-event') throw Object.assign(new Error('Invalid isolated webhook signature'), { status: 401 });
      return { ...JSON.parse(raw.toString()), payloadDigest: crypto.createHash('sha256').update(raw).digest('hex') };
    },
  };
  const gateway = {
    async initializeTransaction(input) {
      state.initializeCalls++;
      if (state.initializationError) throw new Error('Isolated uncertain initialization');
      state.payments.set(input.reference, { id: ++state.nextTransactionId, reference: input.reference, amount: input.amount, currency: 'NGN', domain: 'test', status: 'success', fees: Math.min(1000, input.amount), metadata: input.metadata });
      return { status: true, data: { reference: input.reference, authorization_url: `https://checkout.paystack.com/${encodeURIComponent(input.reference)}` } };
    },
    async verifyTransaction(reference) { state.verifyCalls++; if (state.verificationError) throw new Error('Isolated unavailable verification'); return { status: true, data: { ...state.payments.get(reference) } }; },
    async createRefund(input) {
      state.refundCalls++; if (state.refundError) throw new Error('Isolated uncertain refund');
      const payment = state.payments.get(input.transactionReference);
      const value = { id: ++state.nextRefundId, amount: input.amount, currency: 'NGN', domain: 'test', status: 'processing', transaction: { id: payment?.id, reference: input.transactionReference } };
      state.refunds.set(String(value.id), value); return { status: true, data: value };
    },
    async getRefund(refundId) { return { status: true, data: { ...state.refunds.get(String(refundId)), status: state.refundStatus } }; },
  };
  const env = { NODE_ENV: 'test', PAYSTACK_SECRET_KEY: 'sk_test_isolated_medication_transport', ENCRYPTION_KEY: process.env.ENCRYPTION_KEY, NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3008', NG_MEDICATION_CHECKOUT_ENABLED: 'true' };
  const serviceOptions = { pool, provider, gateway, env, now: () => state.now };
  const { createMedicationDeliveryWorkflowService } = require('../../services/logistics/medicationDeliveryWorkflowService');
  return { run, pool, ids, ...actors, pharmacyUser: actors.pharmacist, pharmacy, pharmacyId: ids.pharmacy, drugId: ids.drug, inventoryId: ids.inventory,
    prescriptionId: ids.prescription, unitPriceMinor: 900000, registration, service: createMedicationDeliveryWorkflowService(serviceOptions), serviceOptions, options: serviceOptions, state, provider, gateway, env,
    input: { pharmacyId: ids.pharmacy, ...(uploaded ? { prescriptionId: ids.prescription } : { digitalPrescriptionId: ids.prescription }), items: [{ drugId: ids.drug, quantity: 1 }], deliveryType: 'pickup', idempotencyKey: crypto.randomUUID() },
    address: { addressLine1: '2 Isolated Recipient Street', city: 'Abuja', state: 'FCT', postalCode: '900001', latitude: 9.08, longitude: 7.40, recipientName: 'Isolated Authorized Recipient', recipientPhone: '+2348000000002' },
    advance(milliseconds) { state.now += milliseconds; },
    markPaid(reference) { if (!state.payments.has(reference)) throw new Error('Unknown isolated payment'); state.payments.get(reference).status = 'success'; },
    async advanceDelivery(status) { state.providerStatus = status; state.now += 1000; },
    // Append-only financial/audit rows are intentionally retained in this
    // disposable test database. Never delete or reset existing accounts.
    async cleanup() { return { retainedInDisposableTestDatabase: true, fixtureRun: run }; },
  };
}

module.exports = { createBrowserFixture };
