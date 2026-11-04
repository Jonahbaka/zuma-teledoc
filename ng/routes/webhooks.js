/**
 * Nigeria Payment Webhooks
 * Handles Paystack and Flutterwave webhook callbacks
 */

const express = require('express');
const router = express.Router();
const paystackService = require('../services/payments/paystackService');
const flutterwaveService = require('../services/payments/flutterwaveService');
const orderService = require('../services/pharmacy/orderService');
const complianceService = require('../services/compliance/complianceService');
const { getPool } = require('../../server/db');
const paymentWebhookService = require('../services/payments/paymentWebhookService');

// Paystack webhook
router.post('/paystack', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    const rawBody = req.rawBody || (Buffer.isBuffer(req.body) ? req.body : null);

    // Verify webhook signature
    if (!paystackService.verifyWebhookSignature(rawBody, signature)) {
      console.error('Paystack webhook signature verification failed');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const body = JSON.parse(rawBody.toString('utf8'));
    if (!body || typeof body.event !== 'string') return res.status(400).json({ error: 'Invalid payment event' });
    const receiptOutcome = await paymentWebhookService.acceptVerifiedEvent(getPool(), body, rawBody);

    const result = await paystackService.handleWebhook(body);

    switch (result.type) {
      case 'payment_success': {
        // The durable receipt handler verifies the consultation invoice or order.
        break;
      }

      case 'settlement_success':
        console.log(`Settlement successful: ${result.data.reference}`);
        break;

      case 'settlement_failed':
        console.error(`Settlement failed: ${result.data.reference}`);
        await complianceService.logAction({
          actorType: 'system',
          action: 'settlement.failed',
          resourceType: 'settlement',
          details: result.data,
          severity: 'critical',
        });
        break;

      case 'refund_success':
        console.log(`Refund processed: ${result.data.transaction_reference}`);
        break;
    }

    res.status(200).json({ received: true, handled: !receiptOutcome.ignored });
  } catch (err) {
    console.error('Paystack webhook error:', err.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Flutterwave webhook
router.post('/livekit', express.raw({ type: 'application/webhook+json' }), async (req, res) => {
  const service = require('../services/conferencing/livekitWebhookService');
  const rawBody = req.rawBody || (Buffer.isBuffer(req.body) ? req.body : null);
  let event;
  try { event = await service.receiveEvent(rawBody, req.headers.authorization); }
  catch { return res.status(401).json({ error: 'Invalid LiveKit event signature' }); }
  try { res.json({ received: true, ...await service.recordEvent(getPool(), event) }); }
  catch { res.status(500).json({ error: 'LiveKit event could not be persisted' }); }
});

// Flutterwave webhook
router.post('/flutterwave', async (req, res) => {
  try {
    const signature = req.headers['verif-hash'];

    if (!flutterwaveService.verifyWebhookSignature(signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const result = await flutterwaveService.handleWebhook(req.body);

    switch (result.type) {
      case 'payment_success': {
        const reference = result.data.tx_ref;
        try {
          await orderService.confirmPayment(reference, 'flutterwave');
        } catch (err) {
          console.error(`FLW payment confirmation failed for ${reference}:`, err.message);
          throw err;
        }
        break;
      }

      case 'settlement_success':
        console.log(`FLW settlement successful: ${result.data.reference}`);
        break;
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Flutterwave webhook error:', err.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Uber Direct signs the original bytes. Never accept client-supplied internal
// tracking IDs/statuses or reserialize a parsed body to verify its signature.
router.post('/delivery/uber_direct', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  try {
    const rawBody = req.rawBody || (Buffer.isBuffer(req.body) ? req.body : null);
    const workflow = require('../services/logistics/medicationDeliveryWorkflowService');
    const result = await workflow.acceptCourierWebhook(rawBody, req.headers);
    res.status(200).json({ received: true, duplicate: result?.duplicate === true });
  } catch (err) {
    const status = [400, 401, 403, 409, 422, 503].includes(err.statusCode || err.status) ? (err.statusCode || err.status) : 500;
    // Provider payloads and addresses must not enter public error responses/logs.
    console.error('Courier webhook rejected:', /^[A-Z0-9_]{1,80}$/.test(err.code || '') ? err.code : 'COURIER_EVENT_FAILED');
    res.status(status).json({ error: status === 401 ? 'Invalid courier signature' : 'Courier event could not be accepted' });
  }
});

router.post('/delivery/:partner', (_req, res) => res.status(404).json({ error: 'Courier integration is not available' }));

module.exports = router;
