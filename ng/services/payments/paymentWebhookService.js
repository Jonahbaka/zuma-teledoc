'use strict';
const crypto = require('crypto');
const billing = require('./consultationBillingService');
const orders = require('../pharmacy/orderService');

async function processReceipt(pool, receipt, {
  billingService = billing, orderService = orders, medicationDeliveryService = null, verifiedEvent = null,
} = {}) {
  if (receipt.status === 'processed') return { alreadyProcessed: true };
  try {
    let outcome = { ignored: true };
    if (receipt.event_type === 'charge.success' && receipt.resource_reference) {
      const medication = await pool.query('SELECT id FROM ng_medication_payment_attempts WHERE provider_reference = $1', [receipt.resource_reference]);
      if (medication.rows.length) {
        const service = medicationDeliveryService || require('../logistics/medicationDeliveryWorkflowService');
        outcome = await service.confirmPaymentReference(receipt.resource_reference);
        if (outcome.status === 'pending') throw new Error('Payment verification is not yet complete');
      } else {
        const consultation = await pool.query('SELECT id FROM ng_consultation_payment_attempts WHERE reference = $1', [receipt.resource_reference]);
        if (consultation.rows.length) {
          outcome = await billingService.confirmReference(receipt.resource_reference);
          if (outcome.status === 'pending') throw new Error('Payment verification is not yet complete');
        } else {
          const pharmacy = await pool.query('SELECT id FROM ng_orders WHERE payment_reference = $1 AND payment_provider = $2', [receipt.resource_reference, 'paystack']);
          if (pharmacy.rows.length) outcome = await orderService.confirmPayment(receipt.resource_reference, 'paystack');
        }
      }
    } else if (['refund.processed', 'refund.failed'].includes(receipt.event_type) && receipt.resource_reference) {
      const medication = await pool.query('SELECT id FROM ng_medication_payment_attempts WHERE provider_reference = $1', [receipt.resource_reference]);
      if (medication.rows.length) {
        const service = medicationDeliveryService || require('../logistics/medicationDeliveryWorkflowService');
        // Recoverable receipts retain only the transaction reference. The service
        // re-fetches its recorded provider refund ID when raw event data is absent.
        const data = verifiedEvent?.event === receipt.event_type
          ? verifiedEvent.data : { transaction_reference: receipt.resource_reference };
        outcome = await service.handleRefundWebhook(receipt.event_type, data);
      }
    }
    await pool.query("UPDATE ng_integration_webhook_receipts SET status = 'processed', processed_at = NOW() WHERE id = $1", [receipt.id]);
    return outcome;
  } catch (error) {
    await pool.query("UPDATE ng_integration_webhook_receipts SET status = 'failed' WHERE id = $1", [receipt.id]);
    throw error;
  }
}

async function acceptVerifiedEvent(pool, event, rawBody, options = {}) {
  const eventType = String(event.event || '').slice(0, 100);
  const rawReference = eventType.startsWith('refund.') ? event.data?.transaction_reference : event.data?.reference;
  const reference = typeof rawReference === 'string' && rawReference.length <= 200 ? rawReference : null;
  const eventKey = crypto.createHash('sha256').update(rawBody).digest('hex');
  const { rows } = await pool.query(
    `INSERT INTO ng_integration_webhook_receipts (provider,event_key,event_type,resource_reference)
     VALUES ('paystack',$1,$2,$3) ON CONFLICT (provider,event_key) DO UPDATE SET event_key = EXCLUDED.event_key RETURNING *`,
    [eventKey, eventType, reference]
  );
  return processReceipt(pool, rows[0], { ...options, verifiedEvent: event });
}
module.exports = { acceptVerifiedEvent, processReceipt };
