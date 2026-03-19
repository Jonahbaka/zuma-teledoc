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

// Paystack webhook
router.post('/paystack', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // Verify webhook signature
    if (!paystackService.verifyWebhookSignature(body, signature)) {
      console.error('Paystack webhook signature verification failed');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const result = await paystackService.handleWebhook(body);

    switch (result.type) {
      case 'payment_success': {
        const reference = result.data.reference;
        try {
          await orderService.confirmPayment(reference, 'paystack');
          console.log(`Payment confirmed: ${reference}`);
        } catch (err) {
          console.error(`Payment confirmation failed for ${reference}:`, err.message);
        }
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

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Paystack webhook error:', err.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
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

// Delivery partner webhooks
router.post('/delivery/:partner', async (req, res) => {
  try {
    const { partner } = req.params;
    const { tracking_id, status, rider_location, proof_url, recipient_name } = req.body;

    const deliveryService = require('../services/logistics/deliveryService');
    await deliveryService.updateDeliveryStatus(tracking_id, {
      status,
      riderLocation: rider_location,
      proofUrl: proof_url,
      recipientName: recipient_name,
    });

    res.status(200).json({ received: true });
  } catch (err) {
    console.error(`Delivery webhook error (${req.params.partner}):`, err.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;
