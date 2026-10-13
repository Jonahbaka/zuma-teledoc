'use strict';
const crypto = require('crypto');
const billing = require('./consultationBillingService');
const orders = require('../pharmacy/orderService');

async function processReceipt(pool, receipt, { billingService = billing, orderService = orders } = {}) {
  if (receipt.status === 'processed') return { alreadyProcessed: true };
  try {
    let outcome = { ignored: true };
    if (receipt.event_type === 'charge.success' && receipt.resource_reference) {
      const consultation = await pool.query('SELECT id FROM ng_consultation_payment_attempts WHERE reference = $1', [receipt.resource_reference]);
      if (consultation.rows.length) {
        outcome = await billingService.confirmReference(receipt.resource_reference);
        if (outcome.status === 'pending') throw new Error('Payment verification is not yet complete');
      }
      else {
        const pharmacy = await pool.query('SELECT id FROM ng_orders WHERE payment_reference = $1 AND payment_provider = $2', [receipt.resource_reference, 'paystack']);
        if (pharmacy.rows.length) outcome = await orderService.confirmPayment(receipt.resource_reference, 'paystack');
      }
    }
    await pool.query("UPDATE ng_integration_webhook_receipts SET status = 'processed', processed_at = NOW() WHERE id = $1", [receipt.id]);
    return outcome;
  } catch (error) {
    await pool.query("UPDATE ng_integration_webhook_receipts SET status = 'failed' WHERE id = $1", [receipt.id]);
    throw error;
  }
}

async function acceptVerifiedEvent(pool, event, rawBody) {
  const eventType = String(event.event || '').slice(0, 100);
  const reference = typeof event.data?.reference === 'string' ? event.data.reference.slice(0, 200) : null;
  const eventKey = crypto.createHash('sha256').update(rawBody).digest('hex');
  const { rows } = await pool.query(
    `INSERT INTO ng_integration_webhook_receipts (provider,event_key,event_type,resource_reference)
     VALUES ('paystack',$1,$2,$3) ON CONFLICT (provider,event_key) DO UPDATE SET event_key = EXCLUDED.event_key RETURNING *`,
    [eventKey, eventType, reference]
  );
  return processReceipt(pool, rows[0]);
}
module.exports = { acceptVerifiedEvent, processReceipt };
