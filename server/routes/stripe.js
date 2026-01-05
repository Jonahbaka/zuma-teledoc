/**
 * Stripe Payment Routes
 * Handles all Stripe-related API endpoints
 */

const express = require('express');
const router = express.Router();
const stripeService = require('../services/stripeService');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../../lib/validation');
const z = require('zod');
const logger = require('../middleware/logger');
const opsAlerts = require('../services/opsAlerts');

// ============================================================================
// PRICING ENDPOINTS (Public)
// ============================================================================

/**
 * Get all pricing information
 */
router.get('/pricing', (req, res) => {
  try {
    // Return public pricing info (amounts converted from cents to dollars)
    const pricing = {
      consultations: Object.entries(stripeService.PRICING.consultations).map(([key, val]) => ({
        id: key,
        name: val.name,
        price: val.amount / 100,
        currency: val.currency,
        description: val.description,
        isFree: val.amount === 0
      })),
      subscriptions: Object.entries(stripeService.PRICING.subscriptions).map(([key, val]) => ({
        id: key,
        name: val.name,
        price: val.amount / 100,
        currency: val.currency,
        interval: val.interval,
        features: val.features
      })),
      credentialing: Object.entries(stripeService.PRICING.providerCredentialing).map(([key, val]) => ({
        id: key,
        name: val.name,
        price: val.amount / 100,
        currency: val.currency,
        description: val.description
      }))
    };
    
    res.json({ success: true, pricing });
  } catch (error) {
    logger.error('Error fetching pricing', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch pricing' });
  }
});

// ============================================================================
// CONSULTATION PAYMENT ENDPOINTS
// ============================================================================

const consultationCheckoutSchema = z.object({
  consultationType: z.enum(['initial', 'followUp', 'specialist', 'urgent', 'erectileDysfunction']),
  appointmentId: z.string().uuid()
});

/**
 * Create checkout session for consultation
 */
router.post('/checkout/consultation', authenticate, async (req, res) => {
  try {
    const data = validate(consultationCheckoutSchema, req.body);
    
    // Check if payment is required
    const requiresPayment = await stripeService.requiresPayment(req.user.id, data.consultationType);
    
    if (!requiresPayment) {
      return res.json({
        success: true,
        paymentRequired: false,
        message: 'No payment required - you have an active subscription or this is a free consultation'
      });
    }
    
    const session = await stripeService.createConsultationCheckout(
      req.user.id,
      data.consultationType,
      data.appointmentId
    );
    
    // Handle free consultations
    if (session.free) {
      return res.json({
        success: true,
        paymentRequired: false,
        message: session.message
      });
    }
    
    res.json({
      success: true,
      paymentRequired: true,
      checkout: session
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ success: false, error: 'Validation failed', errors: error.errors });
    }
    logger.error('Consultation checkout error', { error: error.message, userId: req.user.id });
    res.status(500).json({ success: false, error: 'Failed to create checkout session' });
  }
});

// ============================================================================
// SUBSCRIPTION ENDPOINTS
// ============================================================================

const subscriptionCheckoutSchema = z.object({
  planKey: z.enum(['basic', 'gold', 'goldYearly', 'platinum'])
});

/**
 * Create checkout session for subscription
 */
router.post('/checkout/subscription', authenticate, async (req, res) => {
  try {
    const data = validate(subscriptionCheckoutSchema, req.body);
    
    const session = await stripeService.createSubscriptionCheckout(
      req.user.id,
      data.planKey
    );
    
    res.json({
      success: true,
      checkout: session
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ success: false, error: 'Validation failed', errors: error.errors });
    }
    logger.error('Subscription checkout error', { error: error.message, userId: req.user.id });
    res.status(500).json({ success: false, error: 'Failed to create subscription checkout' });
  }
});

/**
 * Get current subscription status
 */
router.get('/subscription/status', authenticate, async (req, res) => {
  try {
    const hasSubscription = await stripeService.hasActiveSubscription(req.user.id);
    
    res.json({
      success: true,
      hasActiveSubscription: hasSubscription
    });
  } catch (error) {
    logger.error('Subscription status error', { error: error.message, userId: req.user.id });
    res.status(500).json({ success: false, error: 'Failed to fetch subscription status' });
  }
});

/**
 * Create billing portal session
 */
router.post('/billing-portal', authenticate, async (req, res) => {
  try {
    const session = await stripeService.createBillingPortalSession(req.user.id);
    
    res.json({
      success: true,
      url: session.url
    });
  } catch (error) {
    logger.error('Billing portal error', { error: error.message, userId: req.user.id });
    res.status(500).json({ success: false, error: 'Failed to create billing portal session' });
  }
});

/**
 * Cancel subscription
 */
router.post('/subscription/cancel', authenticate, async (req, res) => {
  try {
    const { immediately } = req.body;
    
    // Get user's subscription
    const db = require('../db');
    const { rows } = await db.query(
      `SELECT stripe_subscription_id FROM subscriptions 
       WHERE user_id = $1 AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );
    
    if (rows.length === 0 || !rows[0].stripe_subscription_id) {
      return res.status(404).json({ success: false, error: 'No active subscription found' });
    }
    
    await stripeService.cancelSubscription(rows[0].stripe_subscription_id, immediately === true);
    
    res.json({
      success: true,
      message: immediately 
        ? 'Subscription cancelled immediately' 
        : 'Subscription will be cancelled at end of billing period'
    });
  } catch (error) {
    logger.error('Cancel subscription error', { error: error.message, userId: req.user.id });
    res.status(500).json({ success: false, error: 'Failed to cancel subscription' });
  }
});

// ============================================================================
// PROVIDER CREDENTIALING PAYMENT ENDPOINTS
// ============================================================================

const credentialingCheckoutSchema = z.object({
  packageType: z.enum(['application', 'verification', 'fullCredentialing']).default('fullCredentialing')
});

/**
 * Create checkout for provider credentialing
 */
router.post('/checkout/credentialing', authenticate, requireRole(['provider']), async (req, res) => {
  try {
    const data = validate(credentialingCheckoutSchema, req.body);
    
    const session = await stripeService.createCredentialingCheckout(
      req.user.id,
      data.packageType
    );
    
    res.json({
      success: true,
      checkout: session
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ success: false, error: 'Validation failed', errors: error.errors });
    }
    logger.error('Credentialing checkout error', { error: error.message, userId: req.user.id });
    res.status(500).json({ success: false, error: 'Failed to create credentialing checkout' });
  }
});

// ============================================================================
// PROVIDER SUBSCRIPTION ENDPOINTS
// ============================================================================

const providerSubscriptionSchema = z.object({
  planKey: z.enum(['starter', 'professional', 'enterprise'])
});

/**
 * Create checkout for provider platform subscription
 */
router.post('/checkout/provider-subscription', authenticate, requireRole(['provider']), async (req, res) => {
  try {
    const data = validate(providerSubscriptionSchema, req.body);
    
    const session = await stripeService.createProviderSubscriptionCheckout(
      req.user.id,
      data.planKey
    );
    
    res.json({
      success: true,
      checkout: session
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ success: false, error: 'Validation failed', errors: error.errors });
    }
    logger.error('Provider subscription checkout error', { error: error.message, userId: req.user.id });
    res.status(500).json({ success: false, error: 'Failed to create provider subscription checkout' });
  }
});

// ============================================================================
// WEBHOOK ENDPOINT
// ============================================================================

/**
 * Handle Stripe webhooks
 * Note: This route uses raw body parsing (configured in server/index.js)
 * Production-ready with signature verification
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  try {
    let event;
    
    // Verify webhook signature (required for production)
    if (!webhookSecret || webhookSecret === 'whsec_placeholder') {
      logger.error('Stripe webhook secret not configured - rejecting request');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }
    
    // Verify signature
    event = stripeService.verifyWebhookSignature(
      req.body,
      signature,
      webhookSecret
    );
    
    logger.info('Webhook received', { type: event.type, id: event.id });
    
    await stripeService.handleWebhook(event);
    
    res.json({ received: true });
  } catch (error) {
    logger.error('Webhook error', { error: error.message });
    // Alert ops on production webhook failures (email + optional in-app)
    try {
      await opsAlerts.notifyStripeWebhookFailure({
        requestId: req.id,
        eventId: typeof req.body === 'object' ? req.body?.id : undefined,
        eventType: typeof req.body === 'object' ? req.body?.type : undefined,
        errorMessage: error.message
      });
    } catch (alertErr) {
      logger.error('Failed to send webhook failure alert', { error: alertErr.message });
    }
    res.status(400).json({ error: `Webhook Error: ${error.message}` });
  }
});

module.exports = router;

