'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createMedicationFinanceService } = require('../services/logistics/medicationFinanceService');
const { buildPricing, stageAmounts } = require('../services/logistics/deliveryPricing');
const ENV = { NODE_ENV: 'test', PAYSTACK_SECRET_KEY: 'sk_test_isolated' };
const ORDER = '00000000-0000-4000-8000-000000000001';
function fixtureDatabase() {
  const state = { ledger: [], payments: [], refunds: [], bookings: [], settlements: [], events: [], orderStatus: 'cancelled', orderPaymentStatus: 'paid', deliveryType: 'delivery', calls: [], actor: { id: 'admin-1', role: 'super_admin', is_active: true }, pharmacyRecipient: { bank_code: '058', bank_account_number: '0123456789', paystack_transfer_recipient_code: 'RCP_isolated1', settlement_approval_reference: 'approved-bank', settlement_approved_at: '2026-01-01T00:00:00Z' } };
  const db = {
    state,
    async connect() { return { query: db.query, release() {} }; },
    async query(sql, params = []) {
      state.calls.push({ sql, params });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (sql.includes('INSERT INTO ng_medication_events')) { if (sql.includes('external_refund_reconciliation_required')) state.events.push({ order_id: params[0], action: 'external_refund_reconciliation_required' }); return { rows: [] }; }
      if (sql.includes("SELECT 1 FROM ng_medication_events")) return { rows: state.events.filter(row => row.order_id === params[0] && row.action === 'external_refund_reconciliation_required') };
      if (sql.includes('SELECT 1 FROM ng_medication_payment_attempts WHERE order_id=')) return { rows: state.payments.filter(row => row.order_id === params[0] && ['initializing', 'pending', 'reconciliation_required', 'refund_pending'].includes(row.status)).slice(0, 1) };
      if (sql.includes('SELECT id FROM ng_orders WHERE id=')) return { rows: [{ id: ORDER }] };
      if (sql.includes("UPDATE ng_orders SET payment_status='reconciliation'")) { assert.equal(params[0], ORDER); state.orderPaymentStatus = 'reconciliation'; return { rows: [] }; }
      if (sql.includes('FROM users WHERE id=')) return { rows: state.actor ? [state.actor] : [] };
      if (sql.includes('FROM ng_orders o JOIN ng_medication_fulfillments')) return { rows: [{ id: ORDER, order_status: state.orderStatus, return_received_at: state.returnReceivedAt || null, ...state.pharmacyRecipient }] };
      if (sql.includes('INSERT INTO ng_medication_settlements')) {
        const row = { id: `settlement-${state.settlements.length + 1}`, order_id: params[0], payee: params[1], amount_minor: params[2], provider_reference: params[3], status: 'pending', created_by: params[4], recipient_code: params[5], recipient_id: params[6], recipient_evidence_digest: params[7] };
        state.settlements.push(row); return { rows: [{ ...row }] };
      }
      if (sql.includes('UPDATE ng_medication_settlements')) {
        const row = state.settlements.find(row => row.id === params[0]);
        if (row) {
          if (sql.includes("status='verified'")) { row.status = 'verified'; row.processing_cost_minor = params[1]; row.evidence_reference = params[2]; }
          else if (sql.includes("status='reconciliation_required'")) row.status = 'reconciliation_required';
          else { row.status = params[1]; row.processing_cost_minor = params[2]; }
        }
        return { rows: [] };
      }
      if (sql.includes('FROM ng_medication_settlements')) {
        if (sql.includes('COUNT(*)::int AS count') && !sql.includes('GROUP BY')) return { rows: [{ count: state.settlements.filter(row => ['pending', 'reconciliation_required'].includes(row.status)).length }] };
        if (sql.includes('WHERE id=')) return { rows: state.settlements.filter(row => row.id === params[0]).map(row => ({ ...row })) };
        if (sql.includes('AND payee=')) return { rows: state.settlements.filter(row => row.order_id === params[0] && row.payee === params[1]).map(row => ({ ...row })) };
        if (sql.includes('GROUP BY')) return { rows: state.settlements.map(row => ({ payee: row.payee, status: row.status, count: 1, amount_minor: String(row.amount_minor) })) };
        return { rows: state.settlements.filter(row => row.order_id === params[0]).map(row => ({ ...row })) };
      }
      if (sql.includes('FROM ng_medication_ledger') && sql.includes('GROUP BY account')) {
        const amounts = new Map();
        for (const row of state.ledger.filter(row => !params[0] || row.order_id === params[0])) { const old = amounts.get(row.account) || { debit_minor: 0, credit_minor: 0 }; amounts.set(row.account, { debit_minor: old.debit_minor + row.debit_minor, credit_minor: old.credit_minor + row.credit_minor }); }
        return { rows: [...amounts].map(([account, totals]) => ({ account, debit_minor: String(totals.debit_minor), credit_minor: String(totals.credit_minor) })) };
      }
      if (sql.includes('FROM ng_medication_ledger') && sql.includes('WHERE account IN')) return { rows: [{ amount: String(state.ledger.filter(row => ['pharmacy_payable', 'courier_payable', 'tax_payable', 'management_unearned'].includes(row.account)).reduce((sum, row) => sum + row.credit_minor - row.debit_minor, 0)) }] };
      if (sql.includes('FROM ng_medication_ledger') && sql.includes('account=$2')) return { rows: [{ amount: String(state.ledger.filter(row => row.order_id === params[0] && row.account === params[1]).reduce((sum, row) => sum + row.credit_minor - row.debit_minor, 0)) }] };
      if (sql.includes('INSERT INTO ng_medication_ledger')) {
        if (state.ledger.some(row => row.posting_key === params[1])) return { rows: [] };
        const row = { id: state.ledger.length + 1, order_id: params[0], posting_key: params[1], account: params[2], debit_minor: params[3], credit_minor: params[4], currency: 'NGN', evidence_reference: params[5] };
        state.ledger.push(row); return { rows: [{ ...row }] };
      }
      if (sql.includes('FROM ng_medication_ledger l') && sql.includes('JOIN ng_medication_payment_attempts p')) {
        const previous = state.payments.filter(row => row.order_id === params[0] && row.stage === params[1] && row.id !== params[2] && ['verified', 'refund_pending'].includes(row.status));
        const amounts = new Map();
        for (const payment of previous) for (const row of state.ledger.filter(row => row.posting_key.startsWith(`payment:${payment.id}:`))) amounts.set(row.account, (amounts.get(row.account) || 0) + row.credit_minor);
        return { rows: [...amounts].map(([account, amount]) => ({ account, amount: String(amount) })) };
      }
      if (sql.includes('FROM ng_medication_ledger') && sql.includes("account='management_unearned'")) return { rows: [{ amount: String(state.ledger.filter(row => row.order_id === params[0] && row.account === 'management_unearned').reduce((sum, row) => sum + row.credit_minor - row.debit_minor, 0)) }] };
      if (sql.includes('SELECT * FROM ng_medication_ledger WHERE posting_key=')) return { rows: state.ledger.filter(row => row.posting_key === params[0]).map(row => ({ ...row })) };
      if (sql.includes('SELECT * FROM ng_medication_ledger WHERE order_id=')) return { rows: state.ledger.filter(row => row.order_id === params[0] && row.posting_key.startsWith(params[1].slice(0, -1))).map(row => ({ ...row })) };
      if (sql.includes('FROM ng_medication_bookings')) return { rows: state.bookings.map(row => ({ ...row })) };
      if (sql.includes('FROM ng_medication_fulfillments')) return { rows: [{ order_id: ORDER, status: state.orderStatus, delivery_type: state.deliveryType, return_received_at: state.returnReceivedAt || null }] };
      if (sql.includes('SELECT * FROM ng_medication_payment_attempts WHERE order_id=')) return { rows: state.payments.filter(row => row.order_id === params[0] && (!params[1] || row.stage === params[1]) && ['verified', 'refund_pending', 'refunded'].includes(row.status)).map(row => ({ ...row })) };
      if (sql.includes('SELECT * FROM ng_medication_payment_attempts WHERE provider_reference=')) return { rows: state.payments.filter(row => row.provider_reference === params[0]).map(row => ({ ...row })) };
      if (sql.includes('SELECT * FROM ng_medication_payment_attempts WHERE id=')) return { rows: state.payments.filter(row => row.id === params[0]).map(row => ({ ...row })) };
      if (sql.includes('SELECT order_id FROM ng_medication_payment_attempts')) return { rows: state.payments.filter(row => row.provider_reference === params[0]).map(row => ({ order_id: row.order_id })) };
      if (sql.includes('INSERT INTO ng_medication_refunds')) {
        if (state.refunds.some(row => row.payment_id === params[0])) return { rows: [] };
        const row = { id: `refund-${state.refunds.length + 1}`, payment_id: params[0], amount_minor: params[1], status: 'requested', provider_refund_id: null, reason_code: params[2] };
        state.refunds.push(row); return { rows: [{ ...row }] };
      }
      if (sql.includes('UPDATE ng_medication_payment_attempts')) {
        const row = state.payments.find(row => row.id === params[0]);
        if (row && sql.includes("status='reconciliation_required'")) row.status = 'reconciliation_required';
        else if (row && (sql.includes("status='refunded'") || row.status === 'verified')) row.status = sql.includes("status='refunded'") ? 'refunded' : 'refund_pending';
        return { rows: [] };
      }
      if (sql.includes('UPDATE ng_medication_refunds')) {
        const row = state.refunds.find(row => row.id === params[0]);
        if (row) {
          if (sql.includes("status='pending'")) { if (row.status === 'requested') { row.provider_refund_id = params[1]; row.status = 'pending'; } }
          else if (sql.includes("status='reconciliation_required'")) { if (row.status === 'requested') row.status = 'reconciliation_required'; }
          else { row.provider_refund_id = params[1]; row.status = params[2]; }
        }
        return { rows: [] };
      }
      if (sql.includes('FROM ng_medication_refunds r JOIN ng_medication_payment_attempts p') && sql.includes('WHERE r.id=')) {
        const refund = state.refunds.find(row => row.id === params[0]);
        const payment = state.payments.find(row => row.id === refund?.payment_id);
        return { rows: refund ? [{ ...refund, order_id: payment.order_id, provider_reference: payment.provider_reference, provider_transaction_id: payment.provider_transaction_id }] : [] };
      }
      if (sql.includes('FROM ng_medication_refunds r')) {
        if (sql.includes('WHERE p.provider_reference=')) return { rows: state.refunds.filter(row => state.payments.find(payment => payment.id === row.payment_id)?.provider_reference === params[0]).map(row => ({ ...row })) };
        const rows = state.refunds.filter(row => state.payments.find(payment => payment.id === row.payment_id)?.order_id === params[0]);
        return { rows: rows.filter(row => !sql.includes("r.status<>'processed'") || (row.status !== 'processed' && row.provider_refund_id)).map(row => ({ ...row })) };
      }
      throw new Error(`Unsupported finance fixture SQL: ${sql}`);
    },
  };
  return db;
}
function invoice(options = {}) {
  return buildPricing({ medicinesMinor: 900000, deliveryType: 'delivery', quote: { currency: 'NGN', feeMinor: 280000, expiresAt: '2099-01-01T00:00:00Z' }, ...options });
}
function payment(stage = 'medicines', amount = 900000, id = `payment-${stage}`) {
  return { id, order_id: ORDER, stage, provider_reference: `provider-${id}`, amount_minor: amount, currency: 'NGN', provider_transaction_id: stage === 'medicines' ? '1001' : '1002', status: 'verified' };
}
function verification(pay, fees = 15000) { return { verified: true, reference: pay.provider_reference, amountMinor: pay.amount_minor, currency: 'NGN', environment: 'test', processingCostMinor: fees }; }
function balance(db, account) { return db.state.ledger.filter(row => row.account === account).reduce((sum, row) => sum + row.debit_minor - row.credit_minor, 0); }
function assertBalanced(db) { assert.equal(db.state.ledger.reduce((sum, row) => sum + row.debit_minor - row.credit_minor, 0), 0); }
async function postStage(db, finance, stage, pricing = invoice(), fees = 1000, id) {
  const approval = { ...stageAmounts(pricing, stage), coverageAuthorizationReference: pricing.coverageAuthorizationReference };
  const pay = payment(stage, approval.patientMinor, id || `payment-${stage}`);
  db.state.payments.push(pay);
  await finance.postPayment(db, { orderId: ORDER, payment: pay, approval, verification: verification(pay, fees) });
  return pay;
}

test('patient payment posts exact pass-through amounts and actual processor cost separately from revenue', async () => {
  const db = fixtureDatabase(); const finance = createMedicationFinanceService({ pool: db, env: ENV });
  await postStage(db, finance, 'medicines', invoice(), 12000);
  const pay = await postStage(db, finance, 'delivery', invoice(), 3000);
  assert.equal(balance(db, 'gateway_cash'), 1240000);
  assert.equal(balance(db, 'pharmacy_payable'), -900000);
  assert.equal(balance(db, 'courier_payable'), -280000);
  assert.equal(balance(db, 'management_unearned'), -75000);
  assert.equal(balance(db, 'processing_expense'), 15000);
  assert.equal(balance(db, 'management_revenue'), 0);
  assertBalanced(db);
  const count = db.state.ledger.length;
  await finance.postPayment(db, { orderId: ORDER, payment: pay, approval: stageAmounts(invoice(), 'delivery'), verification: verification(pay, 3000) });
  assert.equal(db.state.ledger.length, count);
});

test('missing/fractional processing cost and mismatched payment cannot create ledger credits', async () => {
  for (const change of [value => { delete value.processingCostMinor; }, value => { value.processingCostMinor = 0.5; }, value => { value.amountMinor++; }, value => { value.currency = 'USD'; }, value => { value.environment = 'live'; }, value => { value.verified = false; }]) {
    const db = fixtureDatabase(); const finance = createMedicationFinanceService({ pool: db, env: ENV });
    const pay = payment(); const evidence = verification(pay); change(evidence);
    await assert.rejects(finance.postPayment(db, { orderId: ORDER, payment: pay, approval: stageAmounts(invoice(), 'medicines'), verification: evidence }));
    assert.equal(db.state.ledger.length, 0);
  }
});

test('separately authorized HMO coordination is a receivable, never another patient charge or cash', async () => {
  const db = fixtureDatabase(); const finance = createMedicationFinanceService({ pool: db, env: ENV });
  const price = invoice({ coordination: { authorized: true, billable: true, includedElsewhere: false, payer: 'insurer', authorizationReference: 'coordination-approval' }, coverage: { verified: true, authorizationReference: 'hmo-approval', allocations: { coordinationMinor: 50000 } } });
  const approval = { ...stageAmounts(price, 'medicines'), coverageAuthorizationReference: price.coverageAuthorizationReference };
  await finance.postCoverage(db, { orderId: ORDER, stage: 'medicines', approval });
  await finance.postCoverage(db, { orderId: ORDER, stage: 'medicines', approval });
  await postStage(db, finance, 'medicines', price, 0);
  assert.equal(balance(db, 'insurer_receivable'), 50000);
  assert.equal(balance(db, 'coordination_revenue'), -50000);
  assert.equal(balance(db, 'gateway_cash'), 900000);
  assertBalanced(db);
});

test('insurer allocation cannot be invented or silently changed after posting', async () => {
  const db = fixtureDatabase(); const finance = createMedicationFinanceService({ pool: db, env: ENV });
  const price = invoice({ coverage: { verified: true, authorizationReference: 'hmo-approval', allocations: { medicinesMinor: 100000 } } });
  const approval = { ...stageAmounts(price, 'medicines'), coverageAuthorizationReference: 'hmo-approval' };
  await assert.rejects(finance.postCoverage(db, { orderId: ORDER, stage: 'medicines', approval: { ...approval, coverageAuthorizationReference: null } }));
  await finance.postCoverage(db, { orderId: ORDER, stage: 'medicines', approval });
  const changed = { ...approval, coverageAuthorizationReference: 'different-approval' };
  await assert.rejects(finance.postCoverage(db, { orderId: ORDER, stage: 'medicines', approval: changed }), { code: 'MEDICATION_COVERAGE_RECONCILIATION_REQUIRED' });
});

test('higher reapproved quote collects only the exact courier difference and never doubles management revenue', async () => {
  const db = fixtureDatabase(); const finance = createMedicationFinanceService({ pool: db, env: ENV });
  const original = await postStage(db, finance, 'delivery', invoice(), 1000, 'payment-original');
  const revised = invoice({ quote: { currency: 'NGN', feeMinor: 300000, expiresAt: '2099-01-01T00:00:00Z' } });
  const additional = payment('delivery', 20000, 'payment-difference'); db.state.payments.push(additional);
  await finance.postPayment(db, { orderId: ORDER, payment: additional, approval: stageAmounts(revised, 'delivery'), verification: verification(additional, 500) });
  assert.equal(balance(db, 'courier_payable'), -300000);
  assert.equal(balance(db, 'management_unearned'), -75000);
  assert.equal(balance(db, 'gateway_cash'), 373500);
  assertBalanced(db);
  assert.equal((await finance.postPayment(db, { orderId: ORDER, payment: original, approval: stageAmounts(invoice(), 'delivery'), verification: verification(original, 1000) })).alreadyPosted, true);
  const lower = invoice({ quote: { currency: 'NGN', feeMinor: 100000, expiresAt: '2099-01-01T00:00:00Z' } });
  const bad = payment('delivery', 1, 'invalid-difference');
  await assert.rejects(finance.postPayment(db, { orderId: ORDER, payment: bad, approval: stageAmounts(lower, 'delivery'), verification: verification(bad, 0) }), { code: 'MEDICATION_PAYMENT_DIFFERENCE_RECONCILIATION' });
});

test('management fee earns only on proven completed delivery and exactly once', async () => {
  const db = fixtureDatabase(); const finance = createMedicationFinanceService({ pool: db, env: ENV });
  await postStage(db, finance, 'delivery');
  await assert.rejects(finance.recognizeDelivery(db, { orderId: ORDER, reference: 'del_isolated' }), { code: 'DELIVERY_PROOF_REQUIRED' });
  db.state.bookings.push({ status: 'delivered', delivery_proof: { recordedAt: '2026-10-15T15:00:00Z' }, normalized: { dropoff: { verification: { signatureUrl: 'https://tb-static.uber.com/proof.png' } } } });
  await finance.recognizeDelivery(db, { orderId: ORDER, reference: 'del_isolated' });
  assert.equal((await finance.recognizeDelivery(db, { orderId: ORDER, reference: 'del_isolated' })).alreadyRecognized, true);
  assert.equal(balance(db, 'management_unearned'), 0);
  assert.equal(balance(db, 'management_revenue'), -75000);
  assertBalanced(db);
});

function refundGateway(db, { creationFails = false, fetchedStatus = 'processed', mismatch = false } = {}) {
  const calls = [];
  const remote = new Map();
  return { calls,
    async createRefund(request) {
      calls.push(['create', request]); if (creationFails) throw new Error('Unknown network outcome');
      const pay = db.state.payments.find(row => row.provider_reference === request.transactionReference);
      const data = { id: String(2000 + remote.size), amount: request.amount, currency: 'NGN', domain: 'test', status: 'pending', transaction: { id: pay.provider_transaction_id, reference: pay.provider_reference } };
      remote.set(data.id, { ...data, transaction: pay.provider_transaction_id });
      return { status: true, data };
    },
    async getRefund(id) { calls.push(['get', id]); const data = remote.get(String(id)); return { status: true, data: { ...data, status: fetchedStatus, ...(mismatch ? { amount: 1 } : {}) } }; },
  };
}

test('full cancellation refunds each verified stage once after authoritative proof and retains processor expense', async () => {
  const db = fixtureDatabase(); const gateway = refundGateway(db); const finance = createMedicationFinanceService({ pool: db, gateway, env: ENV });
  await postStage(db, finance, 'medicines', invoice(), 12000);
  await postStage(db, finance, 'delivery', invoice(), 3000);
  const result = await finance.refundOrder(ORDER, 'pharmacy_cancellation');
  assert.equal(result.status, 'refunded');
  assert.equal(gateway.calls.filter(call => call[0] === 'create').length, 2);
  assert.ok(db.state.payments.every(row => row.status === 'refunded'));
  assert.equal(balance(db, 'gateway_cash'), -15000);
  assert.equal(balance(db, 'processing_expense'), 15000);
  assert.equal(balance(db, 'pharmacy_payable'), 0);
  assert.equal(balance(db, 'courier_payable'), 0);
  assert.equal(balance(db, 'management_unearned'), 0);
  await finance.refundOrder(ORDER, 'repeated_cancellation');
  assert.equal(gateway.calls.filter(call => call[0] === 'create').length, 2);
  assertBalanced(db);
});

test('ambiguous refund creation persists reconciliation and is never automatically reissued', async () => {
  const db = fixtureDatabase(); const gateway = refundGateway(db, { creationFails: true }); const finance = createMedicationFinanceService({ pool: db, gateway, env: ENV });
  await postStage(db, finance, 'medicines');
  assert.equal((await finance.refundOrder(ORDER)).status, 'refund_pending');
  assert.equal(db.state.refunds[0].status, 'reconciliation_required');
  await finance.refundOrder(ORDER);
  assert.equal(gateway.calls.length, 1);
  assert.equal(db.state.payments[0].status, 'refund_pending');
  assert.equal(balance(db, 'pharmacy_payable'), -900000);
});

test('pending, failed or mismatched refund evidence never claims the customer has been refunded', async () => {
  for (const options of [{ fetchedStatus: 'pending' }, { fetchedStatus: 'failed' }, { mismatch: true }]) {
    const db = fixtureDatabase(); const gateway = refundGateway(db, options); const finance = createMedicationFinanceService({ pool: db, gateway, env: ENV });
    await postStage(db, finance, 'medicines');
    if (options.mismatch) await assert.rejects(finance.refundOrder(ORDER), { code: 'MEDICATION_REFUND_EVIDENCE_MISMATCH' });
    else assert.equal((await finance.refundOrder(ORDER)).status, 'refund_pending');
    assert.equal(db.state.payments[0].status, 'refund_pending');
    assert.equal(db.state.ledger.some(row => row.posting_key.startsWith('refund:')), false);
  }
});

test('lower quote refunds only old delivery payments, preserving medicine payment and pharmacy payable', async () => {
  const db = fixtureDatabase(); db.state.orderStatus = 'ready_for_pickup';
  const gateway = refundGateway(db); const finance = createMedicationFinanceService({ pool: db, gateway, env: ENV });
  await postStage(db, finance, 'medicines');
  await postStage(db, finance, 'delivery');
  await finance.refundDeliveryStage(ORDER);
  assert.equal(db.state.payments.find(row => row.stage === 'medicines').status, 'verified');
  assert.equal(db.state.payments.find(row => row.stage === 'delivery').status, 'refunded');
  assert.equal(gateway.calls.filter(call => call[0] === 'create').length, 1);
  assert.equal(balance(db, 'pharmacy_payable'), -900000);
  assert.equal(balance(db, 'courier_payable'), 0);
  assert.equal(balance(db, 'management_unearned'), 0);
  assertBalanced(db);
});

test('courier or payout uncertainty prevents refunds and any new provider request', async () => {
  for (const kind of ['courier', 'settlement']) {
    const db = fixtureDatabase(); const gateway = refundGateway(db); const finance = createMedicationFinanceService({ pool: db, gateway, env: ENV });
    await postStage(db, finance, 'delivery');
    if (kind === 'courier') db.state.bookings.push({ status: 'reconciliation_required' });
    else db.state.settlements.push({ id: 'settlement', order_id: ORDER, status: 'pending' });
    await assert.rejects(finance.refundOrder(ORDER));
    assert.equal(gateway.calls.length, 0);
  }
});

test('refund webhook triggers actual provider evidence refresh and ignores unrelated transactions', async () => {
  const db = fixtureDatabase(); const gateway = refundGateway(db, { fetchedStatus: 'pending' }); const finance = createMedicationFinanceService({ pool: db, gateway, env: ENV });
  await postStage(db, finance, 'medicines');
  await finance.refundOrder(ORDER);
  const count = gateway.calls.filter(call => call[0] === 'get').length;
  await finance.handleRefundWebhook('refund.processed', { transaction_reference: 'provider-payment-medicines', status: 'processed' });
  assert.equal(gateway.calls.filter(call => call[0] === 'get').length, count + 1);
  assert.equal(db.state.payments[0].status, 'refund_pending');
  assert.equal((await finance.handleRefundWebhook('refund.processed', { transaction_reference: 'another-customer' })).ignored, true);
});

const SETTLEMENT_ENV = { ...ENV, NG_MEDICATION_SETTLEMENTS_ENABLED: 'true', NG_MEDICATION_TRANSFER_FEE_RESERVE_MINOR: '1000', NG_MEDICATION_TRANSFER_FEE_APPROVAL_REFERENCE: 'approved-merchant-fee-policy' };
function settlementGateway({ creationFails = false, recipientMismatch = false, availableMinor = 2000000, verifiedStatus = 'success', evidenceMismatch = false } = {}) {
  const calls = []; const transfers = new Map();
  const recipient = { recipient_code: 'RCP_isolated1', id: 3001, active: true, domain: 'test', currency: 'NGN', type: 'nuban', details: { bank_code: '058', account_number: '0123456789' } };
  return { calls,
    async getTransferRecipient(code) { calls.push(['recipient', code]); return { status: true, data: { ...recipient, ...(recipientMismatch ? { details: { bank_code: '058', account_number: '9876543210' } } : {}) } }; },
    async getBalance() { calls.push(['balance']); return { status: true, data: [{ currency: 'NGN', balance: availableMinor }] }; },
    async initiateTransfer(request) { calls.push(['create', request]); if (creationFails) throw new Error('Unknown transfer outcome'); transfers.set(request.reference, { amount: request.amount, reference: request.reference }); return { status: true, data: { reference: request.reference, status: 'pending' } }; },
    async verifyTransfer(reference) { calls.push(['verify', reference]); return { status: true, data: { ...transfers.get(reference), reference, currency: 'NGN', domain: 'test', status: verifiedStatus, transfer_code: 'TRF_isolated1', fee_charged: 1000, recipient: { ...recipient, ...(evidenceMismatch ? { id: 9999 } : {}) } } }; },
  };
}

test('settlement remains disabled until independently approved and unsupported recipients never receive a transfer', async () => {
  const db = fixtureDatabase(); const gateway = settlementGateway();
  const disabled = createMedicationFinanceService({ pool: db, gateway, env: ENV });
  await assert.rejects(disabled.initiateSettlement(ORDER, 'pharmacy', 'admin-1', { approvalReference: 'approved-request' }), { code: 'MEDICATION_SETTLEMENTS_DISABLED' });
  assert.equal(gateway.calls.length, 0);
  db.state.orderStatus = 'delivered';
  const badGateway = settlementGateway({ recipientMismatch: true }); const finance = createMedicationFinanceService({ pool: db, gateway: badGateway, env: SETTLEMENT_ENV });
  await assert.rejects(finance.initiateSettlement(ORDER, 'pharmacy', 'admin-1', { approvalReference: 'approved-request' }), { code: 'MEDICATION_SETTLEMENT_RECIPIENT_MISMATCH' });
  assert.equal(badGateway.calls.filter(call => call[0] === 'create').length, 0);
});

test('settlement pays only the full pharmacy payable, leaves DoctaRx margin and accounts for actual transfer cost', async () => {
  const db = fixtureDatabase(); const gateway = settlementGateway(); const finance = createMedicationFinanceService({ pool: db, gateway, env: SETTLEMENT_ENV });
  await postStage(db, finance, 'medicines', invoice(), 12000);
  await postStage(db, finance, 'delivery', invoice(), 3000);
  db.state.orderStatus = 'delivered';
  await finance.initiateSettlement(ORDER, 'pharmacy', 'admin-1', { approvalReference: 'approved-payout-1' });
  assert.equal(gateway.calls.find(call => call[0] === 'create')[1].amount, 900000);
  assert.equal(db.state.settlements[0].status, 'verified');
  assert.equal(balance(db, 'pharmacy_payable'), 0);
  assert.equal(balance(db, 'courier_payable'), -280000);
  assert.equal(balance(db, 'gateway_cash'), 339000);
  assert.equal(balance(db, 'transfer_processing_expense'), 1000);
  await finance.initiateSettlement(ORDER, 'pharmacy', 'admin-1', { approvalReference: 'repeat-approved-request' });
  assert.equal(gateway.calls.filter(call => call[0] === 'create').length, 1);
  assertBalanced(db);
});

test('a medicine-only pickup pays the pharmacy in full while DoctaRx bears processing costs from funded merchant balance', async () => {
  const db = fixtureDatabase(); const gateway = settlementGateway(); const finance = createMedicationFinanceService({ pool: db, gateway, env: SETTLEMENT_ENV });
  await postStage(db, finance, 'medicines', invoice({ deliveryType: 'pickup' }), 12000);
  db.state.orderStatus = 'delivered';
  await finance.initiateSettlement(ORDER, 'pharmacy', 'admin-1', { approvalReference: 'merchant-funded-pickup-costs' });
  assert.equal(balance(db, 'pharmacy_payable'), 0);
  assert.equal(balance(db, 'gateway_cash'), -13000);
  assert.equal(balance(db, 'processing_expense') + balance(db, 'transfer_processing_expense'), 13000);
  assertBalanced(db);
});

test('insufficient actual merchant funds and inactive admin cannot initiate payout', async () => {
  const db = fixtureDatabase(); db.state.orderStatus = 'delivered';
  const gateway = settlementGateway({ availableMinor: 900000 }); const finance = createMedicationFinanceService({ pool: db, gateway, env: SETTLEMENT_ENV });
  await postStage(db, finance, 'medicines');
  await assert.rejects(finance.initiateSettlement(ORDER, 'pharmacy', 'admin-1', { approvalReference: 'approved-request' }), { code: 'MEDICATION_SETTLEMENT_FUNDS_RESERVED' });
  db.state.actor.is_active = false;
  await assert.rejects(finance.initiateSettlement(ORDER, 'pharmacy', 'admin-1', { approvalReference: 'approved-request' }), { code: 'MEDICATION_SETTLEMENT_AUTHORIZATION_REQUIRED' });
  assert.equal(gateway.calls.filter(call => call[0] === 'create').length, 0);
});

test('a held payment or durable external refund event prevents any pharmacy payout request', async () => {
  for (const hold of ['initializing', 'pending', 'reconciliation_required', 'refund_pending', 'external_event']) {
    const db = fixtureDatabase(); const gateway = settlementGateway(); const finance = createMedicationFinanceService({ pool: db, gateway, env: SETTLEMENT_ENV });
    await postStage(db, finance, 'medicines'); db.state.orderStatus = 'delivered';
    if (hold === 'external_event') db.state.events.push({ order_id: ORDER, action: 'external_refund_reconciliation_required' });
    else db.state.payments[0].status = hold;
    await assert.rejects(finance.initiateSettlement(ORDER, 'pharmacy', 'admin-1', { approvalReference: 'approved-request' }), { code: 'MEDICATION_SETTLEMENT_PAYMENT_RECONCILIATION' });
    assert.equal(gateway.calls.length, 0);
    assert.equal(db.state.settlements.length, 0);
    assert.equal(balance(db, 'pharmacy_payable'), -900000);
  }
});

test('ambiguous payout creation persists a unique reconciliation claim and never starts a replacement transfer', async () => {
  const db = fixtureDatabase(); const gateway = settlementGateway({ creationFails: true }); const finance = createMedicationFinanceService({ pool: db, gateway, env: SETTLEMENT_ENV });
  await postStage(db, finance, 'medicines'); db.state.orderStatus = 'delivered';
  await assert.rejects(finance.initiateSettlement(ORDER, 'pharmacy', 'admin-1', { approvalReference: 'approved-request' }), { code: 'MEDICATION_SETTLEMENT_RECONCILIATION_REQUIRED' });
  assert.equal(db.state.settlements[0].status, 'reconciliation_required');
  await assert.rejects(finance.initiateSettlement(ORDER, 'pharmacy', 'admin-1', { approvalReference: 'approved-request' }));
  assert.equal(gateway.calls.filter(call => call[0] === 'create').length, 1);
});

test('pending or mismatched transfer evidence cannot extinguish the pharmacy liability', async () => {
  for (const options of [{ verifiedStatus: 'pending' }, { evidenceMismatch: true }]) {
    const db = fixtureDatabase(); const gateway = settlementGateway(options); const finance = createMedicationFinanceService({ pool: db, gateway, env: SETTLEMENT_ENV });
    await postStage(db, finance, 'medicines'); db.state.orderStatus = 'delivered';
    if (options.evidenceMismatch) await assert.rejects(finance.initiateSettlement(ORDER, 'pharmacy', 'admin-1', { approvalReference: 'approved-request' }), { code: 'MEDICATION_SETTLEMENT_EVIDENCE_MISMATCH' });
    else await finance.initiateSettlement(ORDER, 'pharmacy', 'admin-1', { approvalReference: 'approved-request' });
    assert.equal(balance(db, 'pharmacy_payable'), -900000);
    assert.equal(db.state.settlements[0].status, 'pending');
  }
});

test('courier bank payout cannot duplicate provider automatic billing without a verified separate agreement', async () => {
  const db = fixtureDatabase(); const gateway = settlementGateway(); const finance = createMedicationFinanceService({ pool: db, gateway, env: SETTLEMENT_ENV });
  db.state.orderStatus = 'delivered';
  await assert.rejects(finance.initiateSettlement(ORDER, 'courier', 'admin-1', { approvalReference: 'approved-request' }), { code: 'COURIER_SETTLEMENT_MODE_UNAPPROVED' });
  assert.equal(gateway.calls.length, 0);
});

test('admin-approved physically returned order refunds patient in full while DoctaRx bears the actual courier cost', async () => {
  const db = fixtureDatabase(); const gateway = refundGateway(db); const finance = createMedicationFinanceService({ pool: db, gateway, env: ENV });
  await postStage(db, finance, 'medicines', invoice(), 12000);
  await postStage(db, finance, 'delivery', invoice(), 3000);
  db.state.bookings.push({ status: 'returned' });
  await assert.rejects(finance.refundReturnedOrder(ORDER, 'approved-merchant-funded-return'), { code: 'MEDICATION_RETURN_RECEIPT_REQUIRED' });
  db.state.returnReceivedAt = '2026-10-15T12:00:00Z';
  await finance.refundReturnedOrder(ORDER, 'approved-merchant-funded-return');
  assert.equal(balance(db, 'pharmacy_payable'), 0);
  assert.equal(balance(db, 'courier_payable'), -280000);
  assert.equal(balance(db, 'management_unearned'), 0);
  assert.equal(balance(db, 'merchant_refund_expense'), 280000);
  assert.equal(balance(db, 'gateway_cash'), -15000);
  assertBalanced(db);
});

test('financial report distinguishes collected cash, payables, insurer receivables, revenue and net merchant result', async () => {
  const db = fixtureDatabase(); const finance = createMedicationFinanceService({ pool: db, env: ENV });
  await postStage(db, finance, 'medicines', invoice(), 12000);
  await postStage(db, finance, 'delivery', invoice(), 3000);
  const report = await finance.report({ orderId: ORDER });
  assert.equal(report.balanced, true);
  assert.equal(report.summary.actualCashMinor, 1240000);
  assert.equal(report.summary.managementRevenueMinor, 0);
  assert.equal(report.summary.managementUnearnedMinor, 75000);
  assert.equal(report.summary.pharmacyPayableMinor, 900000);
  assert.equal(report.summary.courierPayableMinor, 280000);
  assert.equal(report.summary.processingCostMinor, 15000);
  assert.equal(report.summary.netDoctaRxEarningsMinor, -15000);
});

test('authenticated external refund with no local claim durably holds the verified payment instead of silently retaining dispatch entitlement', async () => {
  const db = fixtureDatabase(); const finance = createMedicationFinanceService({ pool: db, env: ENV });
  const pay = await postStage(db, finance, 'medicines');
  const ledgerCount = db.state.ledger.length;
  const result = await finance.handleRefundWebhook('refund.processed', { transaction_reference: pay.provider_reference, amount: '20000', currency: 'NGN', domain: 'test', customer: { email: 'DO_NOT_PERSIST' } });
  assert.equal(result.status, 'reconciliation_required');
  assert.equal(db.state.payments[0].status, 'reconciliation_required');
  assert.equal(db.state.orderPaymentStatus, 'reconciliation');
  assert.equal(db.state.refunds.length, 0);
  assert.equal(db.state.ledger.length, ledgerCount);
  const audit = db.state.calls.find(call => call.sql.includes('external_refund_reconciliation_required'));
  assert.ok(audit);
  assert.doesNotMatch(JSON.stringify(audit.params), /DO_NOT_PERSIST|customer/);
  assertBalanced(db);
});

test('numeric external refund ID is fetched only for reviewed evidence and never auto-posts a customer refund', async () => {
  const db = fixtureDatabase(); const calls = [];
  const gateway = { async getRefund(id) { calls.push(id); return { status: true, data: { id, amount: 20000, currency: 'NGN', domain: 'test', status: 'processed', transaction: { id: '1001', reference: 'provider-payment-medicines' } } }; } };
  const finance = createMedicationFinanceService({ pool: db, gateway, env: ENV });
  const pay = await postStage(db, finance, 'medicines');
  const result = await finance.handleRefundWebhook('refund.processed', { id: 9999, transaction_reference: pay.provider_reference });
  assert.deepEqual(calls, ['9999']);
  assert.equal(result.externalEvidenceVerified, true);
  assert.equal(result.status, 'reconciliation_required');
  assert.equal(db.state.refunds.length, 0);
  assert.equal(db.state.payments[0].status, 'reconciliation_required');
  assert.equal(db.state.orderPaymentStatus, 'reconciliation');
  assert.equal(db.state.ledger.some(row => row.posting_key.startsWith('refund:')), false);
  assert.ok(db.state.calls.find(call => call.sql.includes('external_refund_evidence_review_required')));
});
