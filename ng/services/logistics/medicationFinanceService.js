'use strict';

const crypto = require('crypto');
const { assertMinor } = require('./deliveryPricing');
const { getPool } = require('../../../server/db');
const paystack = require('../payments/paystackService');

const LINE_ACCOUNTS = Object.freeze({ medicinesMinor: 'pharmacy_payable', courierMinor: 'courier_payable', managementMinor: 'management_unearned', coordinationMinor: 'coordination_revenue', taxMinor: 'tax_payable' });
function error(code, message, statusCode = 409) { return Object.assign(new Error(message), { code, statusCode }); }
function reference(value, label = 'Financial evidence reference') {
  if (typeof value !== 'string' || !value.trim() || value.length > 500 || /[\u0000-\u001f]/.test(value)) throw error('MEDICATION_FINANCE_EVIDENCE_REQUIRED', `${label} is required`);
  return value;
}
function sum(values) {
  const value = values.reduce((total, amount) => total + BigInt(assertMinor(amount)), 0n);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw error('MEDICATION_FINANCE_OVERFLOW', 'Financial amount exceeds supported range');
  return Number(value);
}
function stageLines(stage) {
  if (stage === 'medicines') return ['medicinesMinor', 'coordinationMinor', 'taxMinor'];
  if (stage === 'delivery') return ['courierMinor', 'managementMinor'];
  throw error('MEDICATION_FINANCE_STAGE_INVALID', 'A valid medication payment stage is required');
}
function approvedAmounts(approval, stage) {
  if (approval?.currency !== 'NGN' || approval.stage !== stage || !approval.allocations) throw error('MEDICATION_FINANCE_APPROVAL_INVALID', 'A confirmed NGN stage approval is required');
  const allocations = stageLines(stage).map(line => {
    const item = approval.allocations[line];
    if (!item || sum([item.patientMinor, item.insurerMinor]) !== assertMinor(item.amountMinor)) throw error('MEDICATION_FINANCE_APPROVAL_INVALID', 'Approved payer allocation does not balance');
    return { line, account: LINE_ACCOUNTS[line], amount: assertMinor(item.amountMinor), patient: assertMinor(item.patientMinor), insurer: assertMinor(item.insurerMinor) };
  });
  if (sum(allocations.map(item => item.patient)) !== assertMinor(approval.patientMinor) || sum(allocations.map(item => item.insurer)) !== assertMinor(approval.insurerMinor) || sum(allocations.map(item => item.amount)) !== assertMinor(approval.totalMinor)) throw error('MEDICATION_FINANCE_APPROVAL_INVALID', 'Approved stage totals do not balance');
  return allocations;
}
function entry(account, amount, side) { return { account, debit: side === 'debit' ? amount : 0, credit: side === 'credit' ? amount : 0 }; }
function netEntries(entries) {
  const net = new Map();
  for (const item of entries) net.set(item.account, (net.get(item.account) || 0n) + BigInt(item.debit) - BigInt(item.credit));
  return [...net.entries()].filter(([, value]) => value !== 0n).map(([account, value]) => entry(account, assertMinor(String(value < 0n ? -value : value)), value > 0n ? 'debit' : 'credit'));
}

function createMedicationFinanceService({ pool = null, gateway = paystack, env = process.env, now = Date.now } = {}) {
  if (gateway !== paystack && !['test', 'development'].includes(env.NODE_ENV)) throw error('MEDICATION_TEST_GATEWAY_FORBIDDEN', 'Test payment gateways are restricted to isolated test or development environments', 500);
  const database = () => pool || getPool();
  function environment() {
    if (!/^sk_(test|live)_/.test(env.PAYSTACK_SECRET_KEY || '')) throw error('PAYMENT_NOT_CONFIGURED', 'Payment merchant configuration is unavailable', 503);
    const value = env.PAYSTACK_SECRET_KEY.startsWith('sk_live_') ? 'live' : 'test';
    if ((value === 'live' && env.NG_PAYSTACK_LIVE_APPROVED !== 'true') || (env.NODE_ENV === 'production' && value !== 'live')) throw error('PAYMENT_MERCHANT_APPROVAL_REQUIRED', 'This merchant environment is not approved', 503);
    return value;
  }
  async function transaction(callback) {
    const client = await database().connect();
    try { await client.query('BEGIN'); const result = await callback(client); await client.query('COMMIT'); return result; }
    catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  }
  async function post(client, { orderId, group, evidence, entries }) {
    reference(String(orderId), 'Order reference'); reference(group, 'Posting group'); reference(evidence);
    const values = netEntries(entries);
    if (sum(values.map(item => item.debit)) !== sum(values.map(item => item.credit))) throw error('MEDICATION_LEDGER_UNBALANCED', 'Medication ledger posting does not balance');
    for (const item of values) {
      const key = `${group}:${item.account}`;
      const result = await client.query(
        `INSERT INTO ng_medication_ledger (order_id,posting_key,account,debit_minor,credit_minor,currency,evidence_reference)
         VALUES ($1,$2,$3,$4,$5,'NGN',$6) ON CONFLICT (posting_key) DO NOTHING RETURNING *`,
        [orderId, key, item.account, item.debit, item.credit, evidence]
      );
      const persisted = result.rows[0] || (await client.query('SELECT * FROM ng_medication_ledger WHERE posting_key=$1', [key])).rows[0];
      if (!persisted || persisted.order_id !== orderId || persisted.account !== item.account || assertMinor(persisted.debit_minor) !== item.debit || assertMinor(persisted.credit_minor) !== item.credit || persisted.currency !== 'NGN' || persisted.evidence_reference !== evidence) throw error('MEDICATION_LEDGER_CONFLICT', 'Financial posting conflicts with previously recorded evidence');
    }
    return { posted: true, totalMinor: sum(values.map(item => item.debit)) };
  }
  async function postPayment(client, { orderId, payment, approval, verification }) {
    const allocations = approvedAmounts(approval, payment?.stage);
    const expected = assertMinor(payment.amount_minor);
    if (!payment?.id || payment.order_id !== orderId || expected <= 0 || verification?.verified !== true || verification.reference !== payment.provider_reference || verification.currency !== 'NGN' || assertMinor(verification.amountMinor) !== expected || verification.environment !== environment()) throw error('MEDICATION_PAYMENT_EVIDENCE_MISMATCH', 'Verified payment does not match the approved medication charge');
    const processing = assertMinor(verification.processingCostMinor ?? verification.raw?.fees, 'Actual payment processing cost');
    if (processing > expected) throw error('MEDICATION_PAYMENT_FEE_INVALID', 'Payment processing cost exceeds the verified payment');
    if (payment.approval_digest && payment.approval_digest !== crypto.createHash('sha256').update(JSON.stringify(approval)).digest('hex')) throw error('MEDICATION_PAYMENT_APPROVAL_MISMATCH', 'Payment does not match its recorded approval');
    const existing = await client.query('SELECT * FROM ng_medication_ledger WHERE order_id=$1 AND posting_key LIKE $2 ORDER BY id', [orderId, `payment:${payment.id}:%`]);
    if (existing.rows.length) {
      const credits = sum(existing.rows.map(row => row.credit_minor));
      const debits = sum(existing.rows.map(row => row.debit_minor));
      const fees = sum(existing.rows.filter(row => row.account === 'processing_expense').map(row => row.debit_minor));
      if (credits !== expected || debits !== expected || fees !== processing || existing.rows.some(row => row.currency !== 'NGN' || row.evidence_reference !== payment.provider_reference)) throw error('MEDICATION_LEDGER_CONFLICT', 'Financial posting conflicts with previously recorded payment evidence');
      return { alreadyPosted: true, totalMinor: expected };
    }
    const previous = await client.query(`SELECT l.account,COALESCE(SUM(l.credit_minor),0)::text AS amount FROM ng_medication_ledger l
      JOIN ng_medication_payment_attempts p ON p.order_id=l.order_id
      WHERE p.order_id=$1 AND p.stage=$2 AND p.id<>$3 AND p.status IN ('verified','refund_pending')
        AND l.posting_key LIKE 'payment:' || p.id::text || ':%' GROUP BY l.account`, [orderId, payment.stage, payment.id]);
    const prior = new Map(previous.rows.map(row => [row.account, assertMinor(row.amount)]));
    const delta = allocations.map(item => {
      const amount = item.patient - (prior.get(item.account) || 0);
      if (amount < 0) throw error('MEDICATION_PAYMENT_DIFFERENCE_RECONCILIATION', 'A decreased delivery charge requires refund reconciliation before payment or dispatch');
      return { account: item.account, amount };
    });
    if (sum(delta.map(item => item.amount)) !== expected) throw error('MEDICATION_PAYMENT_EVIDENCE_MISMATCH', 'Payment does not match the exact approved stage difference');
    const entries = [entry('gateway_cash', expected - processing, 'debit'), entry('processing_expense', processing, 'debit'), ...delta.map(item => entry(item.account, item.amount, 'credit'))];
    return post(client, { orderId, group: `payment:${payment.id}`, evidence: reference(payment.provider_reference), entries });
  }
  async function postCoverage(client, { orderId, stage, approval }) {
    const allocations = approvedAmounts(approval, stage);
    const amount = assertMinor(approval.insurerMinor);
    if (!amount) return { posted: false, insurerMinor: 0 };
    const authorization = reference(approval.coverageAuthorizationReference, 'Verified insurance authorization');
    const digest = crypto.createHash('sha256').update(JSON.stringify({ stage, authorization, allocations: allocations.map(item => ({ line: item.line, insurer: item.insurer })) })).digest('hex');
    const evidence = `insurance-authorization:${digest}`;
    // Stage coverage is posted once. A changed authorization requires explicit
    // financial correction, rather than quietly duplicating a receivable.
    const existing = await client.query("SELECT * FROM ng_medication_ledger WHERE order_id=$1 AND posting_key LIKE $2 ORDER BY id", [orderId, `coverage:${orderId}:${stage}:%`]);
    if (existing.rows.length) {
      if (existing.rows.some(row => row.evidence_reference !== evidence)) throw error('MEDICATION_COVERAGE_RECONCILIATION_REQUIRED', 'A changed insurance allocation requires financial reconciliation');
    }
    await post(client, { orderId, group: `coverage:${orderId}:${stage}`, evidence, entries: [entry('insurer_receivable', amount, 'debit'), ...allocations.map(item => entry(item.account, item.insurer, 'credit'))] });
    return { posted: true, insurerMinor: amount };
  }
  async function recognizeDelivery(client, { orderId, reference: evidence }) {
    const booking = (await client.query('SELECT * FROM ng_medication_bookings WHERE order_id=$1 FOR UPDATE', [orderId])).rows[0];
    const proof = booking?.delivery_proof;
    const signature = booking?.normalized?.dropoff?.verification?.signatureUrl;
    if (booking?.status !== 'delivered' || !proof || !signature) throw error('DELIVERY_PROOF_REQUIRED', 'Completed delivery and recipient proof are required before earning the management fee');
    const existing = await client.query('SELECT * FROM ng_medication_ledger WHERE posting_key=$1', [`delivery-earned:${orderId}:management_revenue`]);
    if (existing.rows.length) return { alreadyRecognized: true, earnedMinor: assertMinor(existing.rows[0].credit_minor) };
    const result = await client.query("SELECT COALESCE(SUM(credit_minor-debit_minor),0)::text AS amount FROM ng_medication_ledger WHERE order_id=$1 AND account='management_unearned'", [orderId]);
    const amount = assertMinor(result.rows[0]?.amount || '0');
    if (amount !== 75000) throw error('DELIVERY_MANAGEMENT_BALANCE_INVALID', 'The confirmed delivery-management fee must be fully funded or covered');
    await post(client, { orderId, group: `delivery-earned:${orderId}`, evidence: reference(evidence), entries: [entry('management_unearned', amount, 'debit'), entry('management_revenue', amount, 'credit')] });
    return { earnedMinor: amount };
  }
  function refundEvidence(data, refund, payment) {
    const id = String(data?.id ?? '');
    const transactionId = typeof data?.transaction === 'object' ? data.transaction?.id : data?.transaction;
    const transactionReference = typeof data?.transaction === 'object' ? data.transaction?.reference : null;
    if (!/^[1-9]\d{0,19}$/.test(id) || (refund.provider_refund_id && id !== String(refund.provider_refund_id)) || data.currency !== 'NGN' || assertMinor(data.amount) !== assertMinor(refund.amount_minor) || data.domain !== environment() || (transactionReference ? transactionReference !== payment.provider_reference : !payment.provider_transaction_id || String(transactionId) !== String(payment.provider_transaction_id))) throw error('MEDICATION_REFUND_EVIDENCE_MISMATCH', 'Refund evidence does not match the verified medication payment');
    if (!['pending', 'processing', 'needs-attention', 'processed', 'failed'].includes(data.status)) throw error('MEDICATION_REFUND_EVIDENCE_MISMATCH', 'Refund has an unsupported provider status');
    return { id, status: data.status === 'processed' ? 'processed' : data.status === 'failed' ? 'failed' : 'pending' };
  }
  async function applyRefund(refundId, data) {
    return transaction(async client => {
      const result = await client.query(`SELECT r.*, p.order_id, p.provider_reference, p.provider_transaction_id
        FROM ng_medication_refunds r JOIN ng_medication_payment_attempts p ON p.id=r.payment_id
        WHERE r.id=$1 FOR UPDATE OF r,p`, [refundId]);
      const refund = result.rows[0];
      if (!refund) throw error('MEDICATION_REFUND_NOT_FOUND', 'Refund not found', 404);
      const verified = refundEvidence(data, refund, refund);
      if (refund.status === 'processed') return { status: 'processed', alreadyProcessed: true };
      if (verified.status === 'processed') {
        const original = await client.query('SELECT * FROM ng_medication_ledger WHERE order_id=$1 AND posting_key LIKE $2 ORDER BY id', [refund.order_id, `payment:${refund.payment_id}:%`]);
        const credited = original.rows.filter(row => assertMinor(row.credit_minor) > 0);
        if (sum(credited.map(row => row.credit_minor)) !== assertMinor(refund.amount_minor)) throw error('MEDICATION_REFUND_LEDGER_MISMATCH', 'Refund does not match the original payable allocation');
        await post(client, { orderId: refund.order_id, group: `refund:${refund.id}`, evidence: `paystack-refund:${verified.id}`, entries: [...credited.map(row => entry(['returned_order_approved','booked_cancellation_approved'].includes(refund.reason_code) && row.account === 'courier_payable' ? 'merchant_refund_expense' : row.account, assertMinor(row.credit_minor), 'debit')), entry('gateway_cash', assertMinor(refund.amount_minor), 'credit')] });
        await client.query("UPDATE ng_medication_payment_attempts SET status='refunded',updated_at=NOW() WHERE id=$1", [refund.payment_id]);
      }
      await client.query('UPDATE ng_medication_refunds SET provider_refund_id=$2,status=$3,updated_at=NOW() WHERE id=$1', [refund.id, verified.id, verified.status]);
      return { status: verified.status, providerRefundId: verified.id };
    });
  }
  async function refreshRefunds(orderId) {
    const result = await database().query(`SELECT r.id,r.provider_refund_id FROM ng_medication_refunds r
      JOIN ng_medication_payment_attempts p ON p.id=r.payment_id
      WHERE p.order_id=$1 AND r.status<>'processed' AND r.provider_refund_id IS NOT NULL ORDER BY r.created_at`, [orderId]);
    let refreshed = 0;
    for (const refund of result.rows) {
      environment();
      const remote = await gateway.getRefund(refund.provider_refund_id);
      if (remote?.status !== true || !remote.data) throw error('MEDICATION_REFUND_UNVERIFIED', 'Authoritative refund status is unavailable', 503);
      await applyRefund(refund.id, remote.data); refreshed++;
    }
    const states = await database().query(`SELECT r.id,r.status,r.amount_minor,r.provider_refund_id FROM ng_medication_refunds r
      JOIN ng_medication_payment_attempts p ON p.id=r.payment_id WHERE p.order_id=$1 ORDER BY r.created_at`, [orderId]);
    return { refreshed, status: !states.rows.length ? 'not_required' : states.rows.every(row => row.status === 'processed') ? 'refunded' : 'refund_pending', refunds: states.rows.map(row => ({ id: row.id, status: row.status, amountMinor: assertMinor(row.amount_minor), providerRefundId: row.provider_refund_id })) };
  }
  async function refundPayments(orderId, reason, { stage = null, returnedOrder = false, approvalReference = null } = {}) {
    let reasonCode = /^[a-z0-9_]{1,80}$/.test(reason) ? reason : 'order_cancellation';
    const claims = await transaction(async client => {
      // Match the workflow, external-refund and settlement lock order. A payout
      // claim must not race cancellation/refund claims for the same order.
      await client.query('SELECT id FROM ng_orders WHERE id=$1 FOR UPDATE', [orderId]);
      const fulfillment = await client.query('SELECT f.order_id,o.status,o.delivery_type,f.return_received_at FROM ng_medication_fulfillments f JOIN ng_orders o ON o.id=f.order_id WHERE f.order_id=$1 FOR UPDATE OF f', [orderId]);
      if (!fulfillment.rows.length || (!stage && fulfillment.rows[0].status !== 'cancelled')) throw error('MEDICATION_REFUND_CANCELLATION_REQUIRED', 'Cancel the medication order before requesting a full refund');
      if (stage && (fulfillment.rows[0].delivery_type !== 'delivery' || ['cancelled', 'delivered', 'in_transit', 'refunded'].includes(fulfillment.rows[0].status))) throw error('MEDICATION_REFUND_REPRICE_INVALID', 'Only an undispatched delivery stage can be repriced');
      const booking = await client.query('SELECT status FROM ng_medication_bookings WHERE order_id=$1 FOR UPDATE', [orderId]);
      if (!returnedOrder && !stage && booking.rows[0]?.status === 'cancelled') reasonCode = 'booked_cancellation_approved';
      if (returnedOrder) {
        reference(approvalReference, 'Explicit merchant-funded return refund approval');
        if (!fulfillment.rows[0].return_received_at || new Date(fulfillment.rows[0].return_received_at).getTime() > now() || !['returned','return_pending'].includes(booking.rows[0]?.status)) throw error('MEDICATION_RETURN_RECEIPT_REQUIRED', 'Verified physical pharmacy return and courier evidence are required before this refund');
      } else if (booking.rows.length && (stage || !['cancelled', 'booking_failed'].includes(booking.rows[0].status))) throw error('MEDICATION_REFUND_COURIER_RECONCILIATION', 'Confirm courier cancellation before refunding a delivery');
      const settlements = await client.query("SELECT id FROM ng_medication_settlements WHERE order_id=$1 AND ($2::boolean=false OR payee='pharmacy') AND status IN ('pending','verified','reconciliation_required')", [orderId, returnedOrder]);
      if (settlements.rows.length) throw error('MEDICATION_REFUND_SETTLEMENT_RECONCILIATION', 'Existing payouts must be reconciled before cancellation refunds');
      const result = await client.query("SELECT * FROM ng_medication_payment_attempts WHERE order_id=$1 AND ($2::text IS NULL OR stage=$2) AND status IN ('verified','refund_pending','refunded') ORDER BY created_at FOR UPDATE", [orderId, stage]);
      const newClaims = [];
      for (const payment of result.rows) {
        if (payment.status === 'refunded') continue;
        const inserted = await client.query(`INSERT INTO ng_medication_refunds (payment_id,amount_minor,status,reason_code)
          VALUES ($1,$2,'requested',$3) ON CONFLICT (payment_id) DO NOTHING RETURNING *`, [payment.id, payment.amount_minor, reasonCode]);
        if (inserted.rows.length) newClaims.push({ refund: inserted.rows[0], payment });
        await client.query("UPDATE ng_medication_payment_attempts SET status='refund_pending',updated_at=NOW() WHERE id=$1 AND status='verified'", [payment.id]);
      }
      if (!stage) {
        const coverage = await client.query('SELECT * FROM ng_medication_ledger WHERE order_id=$1 AND posting_key LIKE $2 ORDER BY id', [orderId, `coverage:${orderId}:%`]);
        if (coverage.rows.length) await post(client, { orderId, group: `coverage-refund:${orderId}`, evidence: `order-cancellation:${orderId}`, entries: coverage.rows.map(row => ({ account: (returnedOrder || reasonCode === 'booked_cancellation_approved') && row.account === 'courier_payable' ? 'merchant_refund_expense' : row.account, debit: assertMinor(row.credit_minor), credit: assertMinor(row.debit_minor) })) });
      }
      return newClaims;
    });
    for (const claim of claims) {
      try {
        environment();
        // This request is made once after committing its unique claim. A crash
        // or unknown response leaves reconciliation_required, never a reissue.
        const remote = await gateway.createRefund({ transactionReference: claim.payment.provider_reference, amount: assertMinor(claim.refund.amount_minor), reason: reasonCode });
        if (remote?.status !== true || !remote.data) throw error('MEDICATION_REFUND_UNVERIFIED', 'Refund creation could not be confirmed', 503);
        const verified = refundEvidence(remote.data, claim.refund, claim.payment);
        await database().query("UPDATE ng_medication_refunds SET provider_refund_id=$2,status='pending',updated_at=NOW() WHERE id=$1 AND status='requested'", [claim.refund.id, verified.id]);
      } catch {
        await database().query("UPDATE ng_medication_refunds SET status='reconciliation_required',updated_at=NOW() WHERE id=$1 AND status='requested'", [claim.refund.id]);
      }
    }
    return refreshRefunds(orderId);
  }
  async function refundOrder(orderId, reason = 'pharmacy_cancellation') { return refundPayments(orderId, reason); }
  async function refundDeliveryStage(orderId, reason = 'delivery_quote_repriced') { return refundPayments(orderId, reason, { stage: 'delivery' }); }
  async function refundReturnedOrder(orderId, approvalReference) { reference(approvalReference, 'Explicit merchant-funded return refund approval'); return refundPayments(orderId, 'returned_order_approved', { returnedOrder: true, approvalReference }); }
  async function handleRefundWebhook(event, data) {
    if (!['refund.processed', 'refund.failed'].includes(event) || typeof data?.transaction_reference !== 'string') return { ignored: true };
    const paymentResult = await database().query('SELECT * FROM ng_medication_payment_attempts WHERE provider_reference=$1', [data.transaction_reference]);
    const payment = paymentResult.rows[0];
    if (!payment) return { ignored: true };
    const localRefund = (await database().query(`SELECT r.* FROM ng_medication_refunds r JOIN ng_medication_payment_attempts p ON p.id=r.payment_id
      WHERE p.provider_reference=$1`, [data.transaction_reference])).rows[0];
    let known = !!localRefund?.provider_refund_id;
    try {
      if (data.id != null && String(data.id) !== String(localRefund?.provider_refund_id)) known = false;
      if (data.amount != null && assertMinor(data.amount) !== assertMinor(localRefund?.amount_minor)) known = false;
      if ((data.currency != null && data.currency !== 'NGN') || (data.domain != null && data.domain !== environment())) known = false;
    } catch { known = false; }
    if (!known) {
      // A dashboard/other-system refund must revoke the local verified-payment
      // entitlement even when DoctaRx never initiated a refund. Retaining only
      // an empty local refund list would incorrectly permit later dispatch.
      await transaction(async client => {
        await client.query('SELECT id FROM ng_orders WHERE id=$1 FOR UPDATE', [payment.order_id]);
        const current = (await client.query('SELECT * FROM ng_medication_payment_attempts WHERE id=$1 FOR UPDATE', [payment.id])).rows[0];
        if (!current) throw error('MEDICATION_PAYMENT_NOT_FOUND', 'Medication payment not found', 404);
        await client.query("UPDATE ng_medication_payment_attempts SET status='reconciliation_required',updated_at=NOW() WHERE id=$1", [payment.id]);
        await client.query("UPDATE ng_orders SET payment_status='reconciliation',updated_at=NOW() WHERE id=$1", [payment.order_id]);
        await client.query(`INSERT INTO ng_medication_events(order_id,actor_user_id,action,details)
          VALUES($1,NULL,'external_refund_reconciliation_required',$2)`, [payment.order_id, JSON.stringify({ event, paymentReference: payment.provider_reference, providerRefundId: /^[1-9]\d{0,19}$/.test(String(data.id ?? '')) ? String(data.id) : null })]);
      });
      let externalEvidenceVerified = false;
      // A documented numeric refund ID can supply evidence for review, but it
      // cannot be silently attached to a locally initiated claim or auto-posted.
      if (/^[1-9]\d{0,19}$/.test(String(data.id ?? ''))) {
        try {
          const remote = await gateway.getRefund(String(data.id));
          const proof = remote?.data;
          const transactionId = typeof proof?.transaction === 'object' ? proof.transaction.id : proof?.transaction;
          const transactionReference = typeof proof?.transaction === 'object' ? proof.transaction.reference : null;
          if (remote?.status === true && String(proof?.id) === String(data.id) && proof.currency === 'NGN' && proof.domain === environment() && assertMinor(proof.amount) > 0 && assertMinor(proof.amount) <= assertMinor(payment.amount_minor) && (transactionReference ? transactionReference === payment.provider_reference : payment.provider_transaction_id && String(transactionId) === String(payment.provider_transaction_id))) {
            externalEvidenceVerified = true;
            await database().query(`INSERT INTO ng_medication_events(order_id,actor_user_id,action,details)
              VALUES($1,NULL,'external_refund_evidence_review_required',$2)`, [payment.order_id, JSON.stringify({ providerRefundId: String(proof.id), amountMinor: assertMinor(proof.amount), currency: 'NGN', status: ['pending', 'processing', 'needs-attention', 'processed', 'failed'].includes(proof.status) ? proof.status : 'unknown', paymentReference: payment.provider_reference })]);
          }
        } catch { /* The durable payment hold remains even when remote proof is unavailable. */ }
      }
      return { status: 'reconciliation_required', orderId: payment.order_id, externalEvidenceVerified };
    }
    // A signed event triggers fresh verification. It is never itself enough
    // to move money in the ledger or to mark a customer as refunded.
    return refreshRefunds(payment.order_id);
  }
  function settlementConfiguration() {
    if (env.NG_MEDICATION_SETTLEMENTS_ENABLED !== 'true') throw error('MEDICATION_SETTLEMENTS_DISABLED', 'Medication payouts are not activated', 503);
    environment();
    reference(env.NG_MEDICATION_TRANSFER_FEE_APPROVAL_REFERENCE, 'Approved merchant transfer fee policy');
    const reserve = assertMinor(env.NG_MEDICATION_TRANSFER_FEE_RESERVE_MINOR, 'Approved merchant transfer fee reserve');
    return { reserve };
  }
  async function settlementContext(client, orderId, payee, { lock = false } = {}) {
    if (!['pharmacy', 'courier'].includes(payee)) throw error('MEDICATION_SETTLEMENT_PAYEE_INVALID', 'Select an approved pharmacy or courier payee');
    if (lock) {
      await client.query('SELECT id FROM ng_orders WHERE id=$1 FOR UPDATE', [orderId]);
      await client.query('SELECT order_id FROM ng_medication_fulfillments WHERE order_id=$1 FOR UPDATE', [orderId]);
    }
    const row = (await client.query(`SELECT o.id,o.status AS order_status,o.pharmacy_id,f.collected_at,f.return_received_at,
      p.bank_code,p.bank_account_number,p.paystack_transfer_recipient_code,p.settlement_approval_reference,p.settlement_approved_at
      FROM ng_orders o JOIN ng_medication_fulfillments f ON f.order_id=o.id
      JOIN ng_pharmacies p ON p.id=o.pharmacy_id WHERE o.id=$1`, [orderId])).rows[0];
    if (!row || (row.order_status !== 'delivered' && !row.collected_at && !(payee === 'courier' && row.return_received_at))) throw error('MEDICATION_SETTLEMENT_NOT_FULFILLED', 'Confirmed delivery or pharmacy handover is required before payout');
    if ((await client.query("SELECT 1 FROM ng_medication_payment_attempts WHERE order_id=$1 AND status IN ('initializing','pending','reconciliation_required','refund_pending') LIMIT 1", [orderId])).rows.length
      || (await client.query("SELECT 1 FROM ng_medication_events WHERE order_id=$1 AND action='external_refund_reconciliation_required' LIMIT 1", [orderId])).rows.length) throw error('MEDICATION_SETTLEMENT_PAYMENT_RECONCILIATION', 'Payment or external refund evidence requires reconciliation before payout');
    if ((await client.query(`SELECT r.id FROM ng_medication_refunds r JOIN ng_medication_payment_attempts p ON p.id=r.payment_id
      WHERE p.order_id=$1 AND r.status<>'processed' LIMIT 1`, [orderId])).rows.length) throw error('MEDICATION_SETTLEMENT_REFUND_PENDING', 'Refunds require reconciliation before payout');
    if (payee === 'pharmacy') {
      if (!row.settlement_approved_at || new Date(row.settlement_approved_at).getTime() > now()) throw error('MEDICATION_SETTLEMENT_RECIPIENT_UNAPPROVED', 'Pharmacy bank recipient approval is required');
      reference(row.settlement_approval_reference, 'Approved pharmacy bank recipient');
      return { code: row.paystack_transfer_recipient_code, bankCode: row.bank_code, accountNumber: row.bank_account_number };
    }
    // Uber billing may debit the merchant automatically. A separate bank payout
    // is forbidden unless the agreement explicitly uses this settlement mode.
    if (env.UBER_DIRECT_SETTLEMENT_MODE !== 'paystack_transfer') throw error('COURIER_SETTLEMENT_MODE_UNAPPROVED', 'Courier billing must be reconciled using its approved settlement agreement');
    reference(env.UBER_DIRECT_SETTLEMENT_APPROVAL_REFERENCE, 'Approved courier settlement agreement');
    if (!/^[a-f0-9]{64}$/.test(env.UBER_DIRECT_SETTLEMENT_BANK_FINGERPRINT || '')) throw error('MEDICATION_SETTLEMENT_RECIPIENT_UNAPPROVED', 'Verified courier bank fingerprint is required');
    return { code: env.UBER_DIRECT_PAYSTACK_RECIPIENT_CODE, fingerprint: env.UBER_DIRECT_SETTLEMENT_BANK_FINGERPRINT };
  }
  function approvedRecipient(remote, context) {
    const data = remote?.data;
    if (remote?.status !== true || !data || !/^RCP_[A-Za-z0-9]{5,100}$/.test(context.code || '') || data.recipient_code !== context.code || data.active !== true || data.domain !== environment() || data.currency !== 'NGN' || data.type !== 'nuban' || !/^[1-9]\d*$/.test(String(data.id || ''))) throw error('MEDICATION_SETTLEMENT_RECIPIENT_MISMATCH', 'The registered bank recipient could not be verified');
    const bank = data.details?.bank_code;
    const account = data.details?.account_number;
    if (typeof bank !== 'string' || typeof account !== 'string' || !bank || !account) throw error('MEDICATION_SETTLEMENT_RECIPIENT_MISMATCH', 'The registered bank details could not be verified');
    const fingerprint = crypto.createHash('sha256').update(`${bank}:${account}`).digest('hex');
    if (context.fingerprint ? context.fingerprint !== fingerprint : context.bankCode !== bank || context.accountNumber !== account) throw error('MEDICATION_SETTLEMENT_RECIPIENT_MISMATCH', 'The registered bank recipient no longer matches its approval');
    return { code: data.recipient_code, id: String(data.id), fingerprint };
  }
  async function refreshSettlements(orderId) {
    environment();
    const settlements = await database().query('SELECT * FROM ng_medication_settlements WHERE order_id=$1 ORDER BY created_at', [orderId]);
    for (const settlement of settlements.rows) {
      const remote = await gateway.verifyTransfer(settlement.provider_reference);
      const data = remote?.data;
      if (remote?.status !== true || !data || data.reference !== settlement.provider_reference || data.currency !== 'NGN' || data.domain !== environment() || assertMinor(data.amount) !== assertMinor(settlement.amount_minor) || data.recipient?.recipient_code !== settlement.recipient_code || String(data.recipient?.id) !== String(settlement.recipient_id)) throw error('MEDICATION_SETTLEMENT_EVIDENCE_MISMATCH', 'Transfer evidence does not match the approved payout');
      const fingerprint = crypto.createHash('sha256').update(`${data.recipient.details?.bank_code}:${data.recipient.details?.account_number}`).digest('hex');
      if (fingerprint !== settlement.recipient_evidence_digest) throw error('MEDICATION_SETTLEMENT_EVIDENCE_MISMATCH', 'Transfer beneficiary no longer matches the approved bank evidence');
      if (!['success', 'failed', 'reversed', 'pending', 'processing', 'otp', 'received'].includes(data.status)) throw error('MEDICATION_SETTLEMENT_EVIDENCE_MISMATCH', 'Transfer returned an unsupported status');
      const fees = assertMinor(data.fee_charged, 'Actual transfer processing cost');
      await transaction(async client => {
        const locked = (await client.query('SELECT * FROM ng_medication_settlements WHERE id=$1 FOR UPDATE', [settlement.id])).rows[0];
        if (!locked) throw error('MEDICATION_SETTLEMENT_NOT_FOUND', 'Payout not found', 404);
        if (data.status === 'success') {
          if (!/^TRF_[A-Za-z0-9]+$/.test(data.transfer_code || '')) throw error('MEDICATION_SETTLEMENT_EVIDENCE_MISMATCH', 'A provider transfer evidence reference is required');
          await post(client, { orderId, group: `settlement:${settlement.id}`, evidence: `paystack-transfer:${data.transfer_code}`, entries: [entry(`${settlement.payee}_payable`, assertMinor(settlement.amount_minor), 'debit'), entry('gateway_cash', assertMinor(settlement.amount_minor), 'credit')] });
          if (fees) await post(client, { orderId, group: `settlement-fee:${settlement.id}`, evidence: `paystack-transfer:${data.transfer_code}`, entries: [entry('transfer_processing_expense', fees, 'debit'), entry('gateway_cash', fees, 'credit')] });
          await client.query("UPDATE ng_medication_settlements SET status='verified',processing_cost_minor=$2,evidence_reference=$3 WHERE id=$1", [settlement.id, fees, data.transfer_code]);
        } else {
          // A reversal of an already-posted payout needs an explicit bank-ledger
          // reconciliation. Never silently retain the 'verified' designation.
          const next = locked.status === 'verified' || data.status === 'reversed' ? 'reconciliation_required' : data.status === 'failed' ? 'failed' : 'pending';
          if (data.status === 'failed' && fees > 0 && /^TRF_[A-Za-z0-9]+$/.test(data.transfer_code || '')) await post(client, { orderId, group: `settlement-fee:${settlement.id}`, evidence: `paystack-transfer:${data.transfer_code}`, entries: [entry('transfer_processing_expense', fees, 'debit'), entry('gateway_cash', fees, 'credit')] });
          await client.query('UPDATE ng_medication_settlements SET status=$2,processing_cost_minor=$3 WHERE id=$1', [settlement.id, next, fees]);
        }
      });
    }
    return (await database().query('SELECT id,payee,amount_minor,status,provider_reference,processing_cost_minor FROM ng_medication_settlements WHERE order_id=$1 ORDER BY created_at', [orderId])).rows;
  }
  async function initiateSettlement(orderId, payee, actorId, { approvalReference } = {}) {
    const { reserve } = settlementConfiguration();
    reference(approvalReference, 'Explicit payout approval reference');
    const actor = (await database().query('SELECT id,role,is_active FROM users WHERE id=$1', [actorId])).rows[0];
    if (!actor?.is_active || actor.role !== 'super_admin') throw error('MEDICATION_SETTLEMENT_AUTHORIZATION_REQUIRED', 'An active super administrator must approve this payout', 403);
    const initial = await settlementContext(database(), orderId, payee);
    const recipient = approvedRecipient(await gateway.getTransferRecipient(initial.code), initial);
    const remoteBalance = await gateway.getBalance();
    const available = remoteBalance?.status === true && Array.isArray(remoteBalance.data) ? remoteBalance.data.filter(item => item.currency === 'NGN') : [];
    if (available.length !== 1) throw error('MEDICATION_SETTLEMENT_BALANCE_UNVERIFIED', 'Actual merchant settlement balance could not be verified');
    const availableMinor = assertMinor(available[0].balance);
    const reserved = await transaction(async client => {
      const actor = (await client.query('SELECT id,role,is_active FROM users WHERE id=$1', [actorId])).rows[0];
      if (!actor?.is_active || actor.role !== 'super_admin') throw error('MEDICATION_SETTLEMENT_AUTHORIZATION_REQUIRED', 'An active super administrator must approve this payout', 403);
      // Serialize treasury reservations across medication orders, including
      // cash-funded fees and liabilities to other pharmacies/couriers.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('doctarx-medication-settlements'))");
      const context = await settlementContext(client, orderId, payee, { lock: true });
      if (context.code !== initial.code || context.bankCode !== initial.bankCode || context.accountNumber !== initial.accountNumber || context.fingerprint !== initial.fingerprint) throw error('MEDICATION_SETTLEMENT_RECIPIENT_CHANGED', 'Refresh the changed recipient approval before payout');
      const old = (await client.query('SELECT * FROM ng_medication_settlements WHERE order_id=$1 AND payee=$2', [orderId, payee])).rows[0];
      if (old) return { existing: true, settlement: old };
      const payable = await client.query('SELECT COALESCE(SUM(credit_minor-debit_minor),0)::text AS amount FROM ng_medication_ledger WHERE order_id=$1 AND account=$2', [orderId, `${payee}_payable`]);
      const amount = assertMinor(payable.rows[0]?.amount || '0');
      if (!amount) throw error('MEDICATION_SETTLEMENT_NOT_DUE', 'There is no outstanding amount due to this payee');
      const liabilities = await client.query("SELECT COALESCE(SUM(credit_minor-debit_minor),0)::text AS amount FROM ng_medication_ledger WHERE account IN ('pharmacy_payable','courier_payable','tax_payable','management_unearned')");
      const pending = await client.query("SELECT COUNT(*)::int AS count FROM ng_medication_settlements WHERE status IN ('pending','reconciliation_required')");
      const reserveCount = assertMinor(pending.rows[0]?.count || 0) + 1;
      const required = BigInt(assertMinor(liabilities.rows[0]?.amount || '0')) + BigInt(reserve) * BigInt(reserveCount);
      if (BigInt(availableMinor) < required) throw error('MEDICATION_SETTLEMENT_FUNDS_RESERVED', 'Merchant funds must cover medication liabilities and approved transfer costs before payout');
      const providerReference = `drx-stl-${crypto.randomUUID()}`;
      const result = await client.query(`INSERT INTO ng_medication_settlements(order_id,payee,amount_minor,provider_reference,status,created_by,recipient_code,recipient_id,recipient_evidence_digest)
        VALUES($1,$2,$3,$4,'pending',$5,$6,$7,$8) RETURNING *`, [orderId, payee, amount, providerReference, actorId, recipient.code, recipient.id, recipient.fingerprint]);
      await client.query(`INSERT INTO ng_medication_events(order_id,actor_user_id,action,details) VALUES($1,$2,'settlement_authorized',$3)`, [orderId, actorId, JSON.stringify({ payee, amountMinor: amount, reference: providerReference, approvalReference, recipientEvidenceDigest: recipient.fingerprint })]);
      return { existing: false, settlement: result.rows[0] };
    });
    if (!reserved.existing) {
      try {
        const result = await gateway.initiateTransfer({ amount: assertMinor(reserved.settlement.amount_minor), recipientCode: recipient.code, reason: 'DoctaRx approved fulfillment payout', reference: reserved.settlement.provider_reference });
        if (result?.status !== true || result.data?.reference !== reserved.settlement.provider_reference) throw error('MEDICATION_SETTLEMENT_UNCONFIRMED', 'Payout initiation could not be confirmed');
      } catch {
        await database().query("UPDATE ng_medication_settlements SET status='reconciliation_required' WHERE id=$1 AND status='pending'", [reserved.settlement.id]);
        throw error('MEDICATION_SETTLEMENT_RECONCILIATION_REQUIRED', 'Payout outcome is unknown. Verify its existing reference before any further action', 503);
      }
    }
    return refreshSettlements(orderId);
  }
  async function report({ orderId = null } = {}) {
    const db = database();
    const balances = await db.query(`SELECT account,COALESCE(SUM(debit_minor),0)::text AS debit_minor,
      COALESCE(SUM(credit_minor),0)::text AS credit_minor FROM ng_medication_ledger
      WHERE ($1::uuid IS NULL OR order_id=$1) GROUP BY account ORDER BY account`, [orderId]);
    const refunds = await db.query(`SELECT r.status,COUNT(*)::int AS count,SUM(r.amount_minor)::text AS amount_minor
      FROM ng_medication_refunds r JOIN ng_medication_payment_attempts p ON p.id=r.payment_id
      WHERE ($1::uuid IS NULL OR p.order_id=$1) GROUP BY r.status`, [orderId]);
    const settlements = await db.query(`SELECT payee,status,COUNT(*)::int AS count,SUM(amount_minor)::text AS amount_minor
      FROM ng_medication_settlements WHERE ($1::uuid IS NULL OR order_id=$1) GROUP BY payee,status`, [orderId]);
    const rows = balances.rows.map(row => ({ account: row.account, debitMinor: assertMinor(row.debit_minor), creditMinor: assertMinor(row.credit_minor) }));
    const totalDebitsMinor = sum(rows.map(row => row.debitMinor));
    const totalCreditsMinor = sum(rows.map(row => row.creditMinor));
    const debitBalance = account => { const row = rows.find(item => item.account === account); return row ? row.debitMinor - row.creditMinor : 0; };
    const pharmacyPayableMinor = -debitBalance('pharmacy_payable') || 0;
    const courierPayableMinor = -debitBalance('courier_payable') || 0;
    const taxPayableMinor = -debitBalance('tax_payable') || 0;
    const managementUnearnedMinor = -debitBalance('management_unearned') || 0;
    const managementRevenueMinor = -debitBalance('management_revenue') || 0;
    const coordinationRevenueMinor = -debitBalance('coordination_revenue') || 0;
    const processingCostMinor = debitBalance('processing_expense') + debitBalance('transfer_processing_expense');
    const merchantRefundExpenseMinor = debitBalance('merchant_refund_expense');
    return { currency: 'NGN', totalDebitsMinor, totalCreditsMinor, balanced: totalDebitsMinor === totalCreditsMinor, accounts: rows,
      summary: { actualCashMinor: debitBalance('gateway_cash'), insurerReceivableMinor: debitBalance('insurer_receivable'), pharmacyPayableMinor, courierPayableMinor, taxPayableMinor, managementUnearnedMinor, managementRevenueMinor, coordinationRevenueMinor, processingCostMinor, merchantRefundExpenseMinor, netDoctaRxEarningsMinor: managementRevenueMinor + coordinationRevenueMinor - processingCostMinor - merchantRefundExpenseMinor, cashAfterOutstandingLiabilitiesMinor: debitBalance('gateway_cash') - pharmacyPayableMinor - courierPayableMinor - taxPayableMinor - managementUnearnedMinor },
      refunds: refunds.rows.map(row => ({ status: row.status, count: row.count, amountMinor: assertMinor(row.amount_minor) })),
      settlements: settlements.rows.map(row => ({ payee: row.payee, status: row.status, count: row.count, amountMinor: assertMinor(row.amount_minor) })) };
  }
  return { postPayment, postCoverage, recognizeDelivery, refundOrder, refundDeliveryStage, refundReturnedOrder, refreshRefunds, handleRefundWebhook, initiateSettlement, refreshSettlements, report };
}

module.exports = { createMedicationFinanceService };
