'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { createBrowserFixture } = require('./helpers/medication-delivery-fixture');

const target = process.env.SIMULATION_DATABASE_URL;
const input = (checkout, body = {}) => ({ version: checkout.version, idempotencyKey: crypto.randomUUID(), ...body });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function bounded(promise) { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Financial lock barrier timed out')), 10000); })]); } finally { clearTimeout(timer); } }

test('real PostgreSQL settlement reserves exact liabilities and verifies actual gateway payout evidence once', { skip: !target }, async t => {
  const url = new URL(target); assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname.endsWith('_test'));
  const previous = { NODE_ENV: process.env.NODE_ENV, ENCRYPTION_KEY: process.env.ENCRYPTION_KEY };
  process.env.NODE_ENV = 'test'; process.env.ENCRYPTION_KEY ||= 'c'.repeat(64);
  const pool = new Pool({ connectionString: target, max: 6 });
  try {
    async function fixture({ returned = false } = {}) {
      const f = await createBrowserFixture({ pool });
      const made = await f.service.createOrder(f.input, f.patient); const orderId = made.order.id;
      async function act(method, actor, body = {}) { const checkout = await f.service.getCheckout(orderId, actor); return f.service[method](orderId, actor, input(checkout, body)); }
      async function pay(stage) { const payment = await act('initiatePayment', f.patient, { stage }); return f.service.verifyPayment(orderId, f.patient, payment.reference); }
      await act('confirmPrice', f.pharmacist, { items: [{ drugId: f.drugId, unitPriceMinor: f.unitPriceMinor }], pharmacistRegistrationNumber: f.registration, attest: true, packageCategory: 'sealed_ambient_medication' });
      await act('setFulfillment', f.patient, { deliveryType: 'delivery', consent: true, contactConsent: true, address: f.address });
      await act('approve', f.patient, { stage: 'medicines', consent: true }); await pay('medicines');
      await act('confirmPharmacy', f.pharmacist); await act('markReady', f.pharmacist, { attest: true });
      const quoted = await act('requestQuote', f.patient);
      await act('approve', f.patient, { stage: 'delivery', quoteId: quoted.quote.id, consent: true }); await pay('delivery');
      await act('dispatch', f.pharmacist); await f.advanceDelivery(returned ? 'returned' : 'delivered'); await f.service.refresh(orderId, f.pharmacist);
      if (returned) await act('receiveReturn', f.pharmacist, { attest: true, evidenceReference: 'Isolated physical quarantine evidence' });
      const pharmacyCode = `RCP_${crypto.randomBytes(10).toString('hex')}`; const courierCode = `RCP_${crypto.randomBytes(10).toString('hex')}`;
      const pharmacyBank = { bank_code: '058', account_number: '0123456789' }; const courierBank = { bank_code: '044', account_number: '9876543210' };
      const recipient = (code, details) => ({ id: crypto.randomInt(100000000, 90000000000000), recipient_code: code, active: true, domain: 'test', currency: 'NGN', type: 'nuban', details });
      const recipients = new Map([[pharmacyCode, recipient(pharmacyCode, pharmacyBank)], [courierCode, recipient(courierCode, courierBank)]]);
      await pool.query(`UPDATE ng_pharmacies SET bank_code=$1,bank_account_number=$2,paystack_transfer_recipient_code=$3,settlement_approval_reference='Isolated approved bank recipient',settlement_approved_at=NOW()-INTERVAL '1 minute' WHERE id=$4`, [pharmacyBank.bank_code, pharmacyBank.account_number, pharmacyCode, f.pharmacyId]);
      Object.assign(f.env, { NG_MEDICATION_SETTLEMENTS_ENABLED: 'true', NG_MEDICATION_TRANSFER_FEE_APPROVAL_REFERENCE: 'Isolated approved transfer fee policy', NG_MEDICATION_TRANSFER_FEE_RESERVE_MINOR: '5000',
        UBER_DIRECT_SETTLEMENT_MODE: 'paystack_transfer', UBER_DIRECT_SETTLEMENT_APPROVAL_REFERENCE: 'Isolated explicit courier payout agreement', UBER_DIRECT_PAYSTACK_RECIPIENT_CODE: courierCode,
        UBER_DIRECT_SETTLEMENT_BANK_FINGERPRINT: crypto.createHash('sha256').update(`${courierBank.bank_code}:${courierBank.account_number}`).digest('hex') });
      const state = { transferCalls: 0, statusReads: 0, recipientReads: 0, transfers: new Map(), invalidRecipient: false, invalidStatusRecipient: false, invalidFee: false, nextStatus: 'success' };
      f.gateway.getTransferRecipient = async code => { state.recipientReads++; const data = structuredClone(recipients.get(code)); if (state.invalidRecipient) data.details.account_number = '0000000000'; return { status: true, data }; };
      f.gateway.getBalance = async () => ({ status: true, data: [{ currency: 'NGN', balance: 1000000000000 }] });
      f.gateway.initiateTransfer = async args => {
        state.transferCalls++;
        const data = { reference: args.reference, amount: args.amount, currency: 'NGN', domain: 'test', recipient: structuredClone(recipients.get(args.recipientCode)), fee_charged: 5000, status: state.nextStatus, transfer_code: `TRF_${crypto.randomBytes(10).toString('hex')}` };
        state.transfers.set(args.reference, data); return { status: true, data: { reference: args.reference } };
      };
      f.gateway.verifyTransfer = async reference => { state.statusReads++; const data = structuredClone(state.transfers.get(reference)); if (state.invalidStatusRecipient) data.recipient.details.account_number = '0000000000'; if (state.invalidFee) delete data.fee_charged; return { status: true, data }; };
      return { ...f, orderId, treasury: state };
    }
    const settle = (f, payee = 'pharmacy') => f.service.initiateSettlement(f.orderId, f.superAdmin, { payee, approvalReference: 'Isolated explicit payout approval', attest: true });
    const { createMedicationFinanceService } = require('../services/logistics/medicationFinanceService');
    function lockedFinance(f, lockReached) {
      return createMedicationFinanceService({ ...f.serviceOptions, pool: {
        query: (...args) => pool.query(...args),
        async connect() {
          const client = await pool.connect(); const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          return { release: () => client.release(), query(sql, parameters) {
            const pending = client.query(sql, parameters);
            if (sql === 'SELECT id FROM ng_orders WHERE id=$1 FOR UPDATE') lockReached.resolve(pid);
            return pending;
          } };
        },
      } });
    }
    async function waitingOnLock(pid) {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if ((await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0]?.wait_event_type === 'Lock') return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error('Expected actual PostgreSQL order lock contention');
    }

    await t.test('concurrent pharmacy payout pays the exact payable once and GET-confirmed fees balance the real ledger', async () => {
      const f = await fixture();
      const results = await Promise.all([settle(f), settle(f)]);
      assert.equal(f.treasury.transferCalls, 1); assert.ok(results.every(checkout => checkout.orderId === f.orderId));
      const row = (await pool.query('SELECT * FROM ng_medication_settlements WHERE order_id=$1 AND payee=\'pharmacy\'', [f.orderId])).rows[0];
      assert.equal(row.amount_minor, '900000'); assert.equal(row.processing_cost_minor, '5000'); assert.equal(row.status, 'verified'); assert.ok(row.evidence_reference.startsWith('TRF_'));
      await settle(f); assert.equal(f.treasury.transferCalls, 1);
      const due = (await pool.query('SELECT SUM(credit_minor-debit_minor)::text AS amount FROM ng_medication_ledger WHERE order_id=$1 AND account=\'pharmacy_payable\'', [f.orderId])).rows[0]; assert.equal(due.amount, '0');
      const fees = (await pool.query('SELECT SUM(debit_minor)::text AS amount FROM ng_medication_ledger WHERE order_id=$1 AND account=\'transfer_processing_expense\'', [f.orderId])).rows[0]; assert.equal(fees.amount, '5000');
      const ledger = (await pool.query('SELECT SUM(debit_minor)::text AS debit,SUM(credit_minor)::text AS credit FROM ng_medication_ledger WHERE order_id=$1', [f.orderId])).rows[0]; assert.equal(ledger.debit, ledger.credit);
    });

    await t.test('pharmacy and explicitly contracted courier payouts leave only DoctaRx earned fees less actual processing costs', async () => {
      const f = await fixture(); await settle(f, 'pharmacy'); await settle(f, 'courier');
      assert.equal(f.treasury.transferCalls, 2);
      const { createMedicationFinanceService } = require('../services/logistics/medicationFinanceService');
      const report = await createMedicationFinanceService(f.serviceOptions).report({ orderId: f.orderId });
      assert.equal(report.balanced, true); assert.equal(report.summary.pharmacyPayableMinor, 0); assert.equal(report.summary.courierPayableMinor, 0);
      assert.equal(report.summary.managementRevenueMinor, 75000); assert.equal(report.summary.processingCostMinor, 12000);
      assert.equal(report.summary.actualCashMinor, 63000); assert.equal(report.summary.netDoctaRxEarningsMinor, 63000); assert.equal(report.summary.cashAfterOutstandingLiabilitiesMinor, 63000);
    });

    await t.test('disabled payouts and changed bank recipient proof reject before issuing a transfer', async () => {
      const f = await fixture(); f.env.NG_MEDICATION_SETTLEMENTS_ENABLED = 'false';
      await assert.rejects(settle(f), { code: 'MEDICATION_SETTLEMENTS_DISABLED' }); assert.equal(f.treasury.transferCalls, 0);
      f.env.NG_MEDICATION_SETTLEMENTS_ENABLED = 'true'; f.treasury.invalidRecipient = true;
      await assert.rejects(settle(f), { code: 'MEDICATION_SETTLEMENT_RECIPIENT_MISMATCH' }); assert.equal(f.treasury.transferCalls, 0);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ng_medication_settlements WHERE order_id=$1', [f.orderId])).rows[0].count, 0);
    });

    await t.test('wrong GET beneficiary or absent actual fee holds the existing payout without financial posting or duplicate POST', async () => {
      for (const fault of ['invalidStatusRecipient', 'invalidFee']) {
        const f = await fixture(); f.treasury[fault] = true;
        await assert.rejects(settle(f)); assert.equal(f.treasury.transferCalls, 1);
        const held = (await pool.query('SELECT status FROM ng_medication_settlements WHERE order_id=$1', [f.orderId])).rows[0]; assert.ok(['pending', 'reconciliation_required'].includes(held.status));
        assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ng_medication_ledger WHERE order_id=$1 AND posting_key LIKE \'settlement:%\'', [f.orderId])).rows[0].count, 0);
        await assert.rejects(settle(f)); assert.equal(f.treasury.transferCalls, 1);
        f.treasury[fault] = false; await f.service.refreshSettlements(f.orderId, f.superAdmin);
        assert.equal((await pool.query('SELECT status FROM ng_medication_settlements WHERE order_id=$1', [f.orderId])).rows[0].status, 'verified'); assert.equal(f.treasury.transferCalls, 1);
      }
    });

    await t.test('an unresolved payment prevents payout until fresh exact verification restores safe payment evidence', async () => {
      const f = await fixture();
      const payment = (await pool.query("UPDATE ng_medication_payment_attempts SET status='pending' WHERE order_id=$1 AND stage='medicines' RETURNING provider_reference", [f.orderId])).rows[0];
      await assert.rejects(settle(f), { code: 'MEDICATION_SETTLEMENT_PAYMENT_RECONCILIATION' });
      assert.equal(f.treasury.transferCalls, 0);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ng_medication_settlements WHERE order_id=$1', [f.orderId])).rows[0].count, 0);
      await f.service.confirmPaymentReference(payment.provider_reference);
      await settle(f); assert.equal(f.treasury.transferCalls, 1);
      assert.equal((await pool.query('SELECT status FROM ng_medication_settlements WHERE order_id=$1', [f.orderId])).rows[0].status, 'verified');
    });

    await t.test('an external refund queued ahead of settlement wins the actual order lock and durably prevents payout', async () => {
      const f = await fixture();
      const payment = (await pool.query("SELECT provider_reference FROM ng_medication_payment_attempts WHERE order_id=$1 AND stage='medicines'", [f.orderId])).rows[0];
      const blocker = await pool.connect(); const refundLock = deferred(); const payoutLock = deferred();
      let refund; let payout;
      try {
        await blocker.query('BEGIN'); await blocker.query('SELECT id FROM ng_orders WHERE id=$1 FOR UPDATE', [f.orderId]);
        refund = lockedFinance(f, refundLock).handleRefundWebhook('refund.processed', { transaction_reference: payment.provider_reference });
        await waitingOnLock(await bounded(refundLock.promise));
        payout = lockedFinance(f, payoutLock).initiateSettlement(f.orderId, 'pharmacy', f.superAdmin.id, { approvalReference: 'Isolated explicit payout approval' }).then(value => ({ value }), error => ({ error }));
        await waitingOnLock(await bounded(payoutLock.promise));
        assert.equal(f.treasury.transferCalls, 0);
        await blocker.query('COMMIT');
        assert.equal((await refund).status, 'reconciliation_required');
        assert.equal((await payout).error?.code, 'MEDICATION_SETTLEMENT_PAYMENT_RECONCILIATION');
        await f.service.confirmPaymentReference(payment.provider_reference);
        await assert.rejects(settle(f), { code: 'MEDICATION_SETTLEMENT_PAYMENT_RECONCILIATION' });
        assert.equal(f.treasury.transferCalls, 0);
        assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ng_medication_settlements WHERE order_id=$1', [f.orderId])).rows[0].count, 0);
        assert.equal((await pool.query("SELECT status FROM ng_medication_payment_attempts WHERE provider_reference=$1", [payment.provider_reference])).rows[0].status, 'reconciliation_required');
        assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM ng_medication_events WHERE order_id=$1 AND action='external_refund_reconciliation_required'", [f.orderId])).rows[0].count, 1);
      } finally { await blocker.query('ROLLBACK'); blocker.release(); await Promise.allSettled([refund, payout].filter(Boolean)); }
    });

    await t.test('a return refund claim serializes before courier payout and permits it only after verified refund completion', async () => {
      const f = await fixture({ returned: true });
      // Exercise the actual super-admin approval transaction, then simulate a
      // process boundary before its durable financial claim is picked up.
      const { createMedicationDeliveryWorkflowService } = require('../services/logistics/medicationDeliveryWorkflowService');
      const approved = createMedicationDeliveryWorkflowService({ ...f.serviceOptions, finance: { async refundReturnedOrder() { return { awaitingFinancialClaim: true }; } } });
      await approved.refundReturn(f.orderId, f.superAdmin, { approvalReference: 'Isolated approved merchant-funded return', attest: true });
      const blocker = await pool.connect(); const refundLock = deferred(); const payoutLock = deferred(); const refundContinue = deferred(); const refundRequested = deferred();
      const originalRefund = f.gateway.createRefund;
      f.gateway.createRefund = async args => { refundRequested.resolve(); await refundContinue.promise; return originalRefund(args); };
      let refund; let payout;
      try {
        await blocker.query('BEGIN'); await blocker.query('SELECT id FROM ng_orders WHERE id=$1 FOR UPDATE', [f.orderId]);
        refund = lockedFinance(f, refundLock).refundReturnedOrder(f.orderId, 'Isolated approved merchant-funded return');
        await waitingOnLock(await bounded(refundLock.promise));
        payout = lockedFinance(f, payoutLock).initiateSettlement(f.orderId, 'courier', f.superAdmin.id, { approvalReference: 'Isolated explicit courier payout approval' }).then(value => ({ value }), error => ({ error }));
        await waitingOnLock(await bounded(payoutLock.promise));
        assert.equal(f.treasury.transferCalls, 0);
        await blocker.query('COMMIT'); await bounded(refundRequested.promise);
        assert.equal((await payout).error?.code, 'MEDICATION_SETTLEMENT_PAYMENT_RECONCILIATION');
        assert.equal(f.treasury.transferCalls, 0);
        assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ng_medication_settlements WHERE order_id=$1', [f.orderId])).rows[0].count, 0);
        refundContinue.resolve(); assert.equal((await refund).status, 'refunded');
        await settle(f, 'courier'); assert.equal(f.treasury.transferCalls, 1);
        const settlement = (await pool.query('SELECT status,amount_minor FROM ng_medication_settlements WHERE order_id=$1', [f.orderId])).rows[0];
        assert.deepEqual(settlement, { status: 'verified', amount_minor: '280000' });
      } finally { refundContinue.resolve(); await blocker.query('ROLLBACK'); blocker.release(); await Promise.allSettled([refund, payout].filter(Boolean)); }
    });

    await t.test('pharmacy wallet statement reads scoped medication payables and verified settlements without crediting the legacy wallet', async () => {
      const f = await fixture(); const foreign = await createBrowserFixture({ pool });
      for (const pharmacyId of [f.pharmacyId, foreign.pharmacyId]) await pool.query('INSERT INTO ng_pharmacy_wallets(pharmacy_id) VALUES($1)', [pharmacyId]);
      const db = require('../../server/db'); const originalGetPool = db.getPool;
      const filename = require.resolve('../services/pharmacy/walletService'); const cached = require.cache[filename];
      try {
        db.getPool = () => pool; delete require.cache[filename];
        const wallet = require(filename);
        const before = await wallet.getWallet(f.pharmacyId);
        assert.deepEqual(before.medicationStatement, { currency: 'NGN', outstandingMinor: 900000, settledMinor: 0, orderCount: 1, processingCostsBorneBy: 'DoctaRx' });
        const other = await wallet.getWallet(foreign.pharmacyId);
        assert.deepEqual(other.medicationStatement, { currency: 'NGN', outstandingMinor: 0, settledMinor: 0, orderCount: 0, processingCostsBorneBy: 'DoctaRx' });
        await settle(f);
        const after = await wallet.getWallet(f.pharmacyId);
        assert.deepEqual(after.medicationStatement, { currency: 'NGN', outstandingMinor: 0, settledMinor: 900000, orderCount: 1, processingCostsBorneBy: 'DoctaRx' });
        assert.equal(after.balance, '0.00'); assert.equal(after.pending_balance, '0.00'); assert.equal(after.total_earned, '0.00');
        assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ng_wallet_transactions WHERE pharmacy_id=$1', [f.pharmacyId])).rows[0].count, 0);
      } finally {
        db.getPool = originalGetPool;
        if (cached) require.cache[filename] = cached; else delete require.cache[filename];
      }
    });
  } finally {
    await pool.end();
    for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
