'use strict';

const crypto = require('crypto');
const db = require('../../../server/db');
const paystack = require('./paystackService');
const { assertPaymentMatches } = require('./paymentIntegrity');

function billingError(statusCode, message, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

function checkoutEnvironment(env = process.env) {
  if (env.NG_PATIENT_CHECKOUT_ENABLED !== 'true') throw billingError(503, 'Patient checkout is not activated.', 'CHECKOUT_NOT_ACTIVATED');
  if (!/^sk_(test|live)_/.test(env.PAYSTACK_SECRET_KEY || '')) throw billingError(503, 'Paystack merchant configuration is unavailable.', 'PAYSTACK_NOT_CONFIGURED');
  if (env.PAYSTACK_SECRET_KEY.startsWith('sk_live_') && env.NG_PAYSTACK_LIVE_APPROVED !== 'true') {
    throw billingError(503, 'Live merchant activation has not been approved.', 'MERCHANT_APPROVAL_REQUIRED');
  }
  return env.PAYSTACK_SECRET_KEY.startsWith('sk_live_') ? 'live' : 'test';
}

function invoiceView(row) {
  return {
    id: row.id, appointmentId: row.appointment_id, amountMinor: Number(row.amount_minor), currency: row.currency,
    status: row.status, fundingSource: row.funding_source, createdAt: row.created_at, paidAt: row.paid_at,
    attemptStatus: row.attempt_status || null,
    receipt: row.receipt_json || null,
  };
}

async function listInvoices(patientId, database = db) {
  const result = await database.query(
    `SELECT i.*, a.status AS attempt_status, a.receipt_json FROM ng_consultation_invoices i
       LEFT JOIN ng_consultation_payment_attempts a ON a.invoice_id = i.id
      WHERE i.patient_user_id = $1 ORDER BY i.created_at DESC LIMIT 100`, [patientId]
  );
  return result.rows.map(invoiceView);
}

async function createInvoice(patientId, appointmentId, { database = db, env = process.env } = {}) {
  checkoutEnvironment(env);
  return database.transaction(async (client) => {
    const result = await client.query(
      `SELECT a.* FROM appointments a JOIN users p ON p.id = a.patient_id
       JOIN users c ON c.id = a.provider_id
       WHERE a.id = $1 AND a.patient_id = $2 AND p.is_active = true
         AND p.market_scope = 'NG' AND c.market_scope = 'NG' FOR UPDATE OF a`, [appointmentId, patientId]
    );
    const appointment = result.rows[0];
    if (!appointment) throw billingError(404, 'Appointment not found.', 'APPOINTMENT_NOT_FOUND');
    const existing = await client.query('SELECT * FROM ng_consultation_invoices WHERE appointment_id = $1', [appointmentId]);
    if (existing.rows[0]) return invoiceView(existing.rows[0]);
    if (['cancelled', 'completed', 'no_show'].includes(appointment.status) || !appointment.payment_required || appointment.payment_completed) {
      throw billingError(409, 'This appointment does not require a new patient payment.', 'PAYMENT_NOT_REQUIRED');
    }
    const tariffs = await client.query(
      `SELECT * FROM ng_consultation_tariffs WHERE service_key = $1 AND active = true
         AND effective_from <= NOW() AND (effective_to IS NULL OR effective_to > NOW())`, [`consultation_${appointment.type}`]
    );
    if (tariffs.rows.length !== 1) throw billingError(503, 'An unambiguous approved consultation tariff is required.', 'TARIFF_NOT_CONFIGURED');
    const tariff = tariffs.rows[0];
    const invoice = await client.query(
      `INSERT INTO ng_consultation_invoices
        (appointment_id, patient_user_id, tariff_id, amount_minor, currency, price_snapshot_json)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING *`,
      [appointmentId, patientId, tariff.id, tariff.amount_minor, tariff.currency,
        JSON.stringify({ tariffId: tariff.id, serviceKey: tariff.service_key, amountMinor: Number(tariff.amount_minor), currency: tariff.currency, approvalReference: tariff.approval_reference })]
    );
    return invoiceView(invoice.rows[0]);
  });
}

async function initializeCheckout(patientId, invoiceId, { database = db, gateway = paystack, env = process.env } = {}) {
  const environment = checkoutEnvironment(env);
  const origin = new URL(env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');
  if (environment === 'live' && origin.protocol !== 'https:') throw billingError(503, 'Live checkout requires an HTTPS application URL.', 'CHECKOUT_URL_INVALID');
  const attempt = await database.transaction(async (client) => {
    const result = await client.query(
      `SELECT i.*, u.email FROM ng_consultation_invoices i JOIN users u ON u.id = i.patient_user_id
       JOIN appointments a ON a.id = i.appointment_id
       WHERE i.id = $1 AND i.patient_user_id = $2 AND a.status NOT IN ('cancelled','completed','no_show') FOR UPDATE OF i`,
      [invoiceId, patientId]
    );
    const invoice = result.rows[0];
    if (!invoice) throw billingError(404, 'Invoice not found or appointment is unavailable.', 'INVOICE_NOT_FOUND');
    if (invoice.status !== 'open') throw billingError(409, 'This invoice is not open for payment.', 'INVOICE_NOT_OPEN');
    const existing = await client.query('SELECT * FROM ng_consultation_payment_attempts WHERE invoice_id = $1', [invoiceId]);
    if (existing.rows[0]) {
      if (existing.rows[0].environment !== environment) throw billingError(409, 'The payment attempt belongs to another environment.', 'PAYMENT_ENVIRONMENT_CHANGED');
      if (existing.rows[0].status === 'ready' && existing.rows[0].authorization_url) return { ...existing.rows[0], reused: true };
      throw billingError(409, 'An existing payment attempt requires verification or reconciliation.', 'PAYMENT_RECONCILIATION_REQUIRED');
    }
    const inserted = await client.query(
      `INSERT INTO ng_consultation_payment_attempts (invoice_id, reference, environment)
       VALUES ($1,$2,$3) RETURNING *`, [invoiceId, `NG-CONSULT-${crypto.randomUUID()}`, environment]
    );
    return { ...inserted.rows[0], amountMinor: Number(invoice.amount_minor), email: invoice.email };
  });
  if (attempt.reused) return { authorizationUrl: attempt.authorization_url, reference: attempt.reference };
  try {
    const response = await gateway.initializeTransaction({ email: attempt.email, amount: attempt.amountMinor, reference: attempt.reference,
      callbackUrl: new URL('/ng/patient/consultation-billing', origin).toString(), metadata: { invoice_id: invoiceId } });
    const url = new URL(response.data.authorization_url);
    if (url.protocol !== 'https:' || !['checkout.paystack.com', 'paystack.com'].includes(url.hostname)) throw new Error('Unexpected checkout destination');
    await database.query(
      `UPDATE ng_consultation_payment_attempts SET status = 'ready', authorization_url = $2, updated_at = NOW()
       WHERE id = $1 AND status = 'initializing'`, [attempt.id, url.toString()]
    );
    return { authorizationUrl: url.toString(), reference: attempt.reference };
  } catch {
    await database.query(
      `UPDATE ng_consultation_payment_attempts SET status = 'reconciliation', updated_at = NOW() WHERE id = $1 AND status = 'initializing'`, [attempt.id]
    );
    throw billingError(502, 'Checkout could not be confirmed. Verify the existing attempt before retrying.', 'PAYMENT_INITIALIZATION_AMBIGUOUS');
  }
}

async function confirmReference(reference, { database = db, gateway = paystack } = {}) {
  const remote = await gateway.verifyTransaction(reference);
  const payment = remote.data;
  return database.transaction(async (client) => {
    const result = await client.query(
      `SELECT a.*, i.patient_user_id, i.appointment_id, i.amount_minor, i.currency, i.status AS invoice_status
       FROM ng_consultation_payment_attempts a JOIN ng_consultation_invoices i ON i.id = a.invoice_id
       WHERE a.reference = $1 FOR UPDATE OF i, a`, [reference]
    );
    const attempt = result.rows[0];
    if (!attempt) throw billingError(404, 'Payment attempt not found.', 'PAYMENT_ATTEMPT_NOT_FOUND');
    if (payment.status !== 'success') return { invoiceId: attempt.invoice_id, status: 'pending', confirmed: false };
    assertPaymentMatches({ verified: payment.status === 'success', reference: payment.reference, amountMinor: payment.amount, currency: payment.currency, environment: payment.domain }, {
      reference, amountMinor: Number(attempt.amount_minor), currency: attempt.currency, environment: attempt.environment,
    });
    if (payment.id === null || payment.id === undefined || !String(payment.id).trim()) throw billingError(502, 'The payment receipt identifier is unavailable.', 'PAYMENT_RECEIPT_INVALID');
    if (attempt.status === 'confirmed') return { invoiceId: attempt.invoice_id, status: attempt.invoice_status, alreadyConfirmed: true };
    const receipt = { reference, gatewayId: String(payment.id), amountMinor: payment.amount, currency: payment.currency, paidAt: payment.paid_at, environment: payment.domain };
    const appointment = await client.query('SELECT status, payment_completed FROM appointments WHERE id = $1 FOR UPDATE', [attempt.appointment_id]);
    if (attempt.invoice_status !== 'open' || !appointment.rows[0] || appointment.rows[0].payment_completed || ['cancelled', 'no_show'].includes(appointment.rows[0].status)) {
      await client.query("UPDATE ng_consultation_payment_attempts SET status = 'reconciliation', receipt_json = $2::jsonb, updated_at = NOW() WHERE id = $1", [attempt.id, JSON.stringify(receipt)]);
      return { invoiceId: attempt.invoice_id, status: 'reconciliation', confirmed: false };
    }
    await client.query("UPDATE ng_consultation_payment_attempts SET status = 'confirmed', receipt_json = $2::jsonb, updated_at = NOW() WHERE id = $1", [attempt.id, JSON.stringify(receipt)]);
    await client.query("UPDATE ng_consultation_invoices SET status = 'paid', paid_at = NOW(), updated_at = NOW() WHERE id = $1", [attempt.invoice_id]);
    await client.query(
      `INSERT INTO ng_payment_ledger_entries (invoice_id, attempt_id, entry_type, amount_minor, currency, external_reference)
       VALUES ($1,$2,'payment',$3,$4,$5)`, [attempt.invoice_id, attempt.id, attempt.amount_minor, attempt.currency, reference]
    );
    await client.query('UPDATE appointments SET payment_completed = true, updated_at = NOW() WHERE id = $1', [attempt.appointment_id]);
    return { invoiceId: attempt.invoice_id, status: 'paid', confirmed: true };
  });
}

async function verifyOwnedInvoice(patientId, invoiceId, options = {}) {
  const database = options.database || db;
  const result = await database.query(
    `SELECT a.reference FROM ng_consultation_invoices i JOIN ng_consultation_payment_attempts a ON a.invoice_id = i.id
     WHERE i.id = $1 AND i.patient_user_id = $2`, [invoiceId, patientId]
  );
  if (!result.rows[0]) throw billingError(404, 'Payment attempt not found.', 'PAYMENT_ATTEMPT_NOT_FOUND');
  return confirmReference(result.rows[0].reference, options);
}

async function requestRefund(patientId, invoiceId, database = db) {
  const result = await database.query(
    `UPDATE ng_consultation_invoices SET status = 'refund_pending', updated_at = NOW()
     WHERE id = $1 AND patient_user_id = $2 AND status = 'paid' RETURNING *`, [invoiceId, patientId]
  );
  if (!result.rows[0]) throw billingError(409, 'A paid invoice is required for a new refund request.', 'REFUND_NOT_AVAILABLE');
  return invoiceView(result.rows[0]);
}

module.exports = { checkoutEnvironment, invoiceView, listInvoices, createInvoice, initializeCheckout, confirmReference, verifyOwnedInvoice, requestRefund };
