/**
 * Stripe Payment Service
 * Handles all Stripe-related operations including:
 * - Customer management
 * - Checkout sessions
 * - Subscription management
 * - Provider credentialing payments
 * - Consultation payments
 * - Webhooks
 */

const Stripe = require('stripe');
const db = require('../db');
const logger = require('../middleware/logger');
const membershipService = require('./membershipService');
const emailService = require('./email');
const notificationService = require('./notifications');

// Initialize Stripe with secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-11-20.acacia'
});

// Prefer Stripe "automatic payment methods" for global support (local cards/bank methods),
// but fall back to card-only if a given account/region doesn't support it.
const STRIPE_AUTOMATIC_PAYMENT_METHODS_ENABLED = String(
  process.env.STRIPE_AUTOMATIC_PAYMENT_METHODS_ENABLED ?? 'true'
).toLowerCase() === 'true';

async function createCheckoutSessionWithFallback(baseParams, { context = {} } = {}) {
  const base = {
    ...baseParams,
    // Cross-border reliability: collect billing address and allow Stripe to update customer.
    billing_address_collection: baseParams.billing_address_collection || 'required',
    customer_update: baseParams.customer_update || { address: 'auto', name: 'auto' }
  };

  if (STRIPE_AUTOMATIC_PAYMENT_METHODS_ENABLED) {
    try {
      const apmParams = { ...base };
      // Stripe rejects sessions that set both; keep it exclusive.
      delete apmParams.payment_method_types;
      apmParams.automatic_payment_methods = { enabled: true };
      return await stripe.checkout.sessions.create(apmParams);
    } catch (err) {
      logger.warn('Stripe automatic payment methods failed; falling back to card', {
        message: err?.message,
        type: err?.type,
        code: err?.code,
        context
      });
    }
  }

  const cardParams = { ...base, payment_method_types: ['card'] };
  delete cardParams.automatic_payment_methods;
  return await stripe.checkout.sessions.create(cardParams);
}

// ============================================================================
// PRICING CONFIGURATION (Industry Standard for Telehealth)
// ============================================================================
const PRICING = {
  // Patient Consultation Fees
  consultations: {
    initial: {
      name: 'Initial Consultation',
      amount: 7900, // $79.00 - Industry standard for initial telehealth visit
      currency: 'usd',
      description: 'First-time consultation with a healthcare provider'
    },
    followUp: {
      name: 'Follow-up Consultation',
      amount: 4900, // $49.00 - Industry standard for follow-up
      currency: 'usd',
      description: 'Follow-up consultation with your provider'
    },
    specialist: {
      name: 'Specialist Consultation',
      amount: 12900, // $129.00 - Specialist consultation
      currency: 'usd',
      description: 'Consultation with a specialist provider'
    },
    urgent: {
      name: 'Urgent Care Consultation',
      amount: 9900, // $99.00 - Urgent care
      currency: 'usd',
      description: 'Urgent care telehealth visit'
    },
    erectileDysfunction: {
      name: 'ED Consultation',
      amount: 0, // FREE - First consultation for ED
      currency: 'usd',
      description: 'Free initial consultation for erectile dysfunction'
    }
  },
  
  // Patient Subscription Plans
  subscriptions: {
    test: {
      name: 'Docta Test ($1)',
      priceId: null,
      amount: 100, // $1.00 for testing
      currency: 'usd',
      interval: 'month',
      features: [
        'Test plan for development',
        'All features unlocked',
        'Charges $1.00/month',
        'Cancel anytime'
      ]
    },
    basic: {
      name: 'Docta Basic',
      priceId: null, // Will be created/retrieved from Stripe
      amount: 1999, // $19.99/month
      currency: 'usd',
      interval: 'month',
      features: [
        'Unlimited messaging with providers',
        '2 telehealth consultations per month',
        'Prescription management',
        'Health records access'
      ]
    },
    gold: {
      name: 'Docta Gold',
      priceId: null,
      amount: 3999, // $39.99/month
      currency: 'usd',
      interval: 'month',
      features: [
        'Unlimited telehealth consultations',
        'Priority booking',
        'Mental health support',
        'Specialist referrals',
        '24/7 urgent care access',
        'Prescription delivery'
      ]
    },
    goldYearly: {
      name: 'Docta Gold (Annual)',
      priceId: null,
      amount: 29900, // $299.00/year (save $180)
      currency: 'usd',
      interval: 'year',
      features: [
        'All Gold features',
        'Save $180 per year',
        'Annual health check-in'
      ]
    },
    platinum: {
      name: 'Docta Platinum',
      priceId: null,
      amount: 7999, // $79.99/month
      currency: 'usd',
      interval: 'month',
      features: [
        'All Gold features',
        'Dedicated care coordinator',
        'Family plan (up to 4 members)',
        'Chronic care management',
        'Lab work coordination',
        'Second opinion consultations'
      ]
    }
  },
  
  // Provider Credentialing Fees
  providerCredentialing: {
    application: {
      name: 'Provider Application Fee',
      amount: 9900, // $99.00 - Initial application
      currency: 'usd',
      description: 'One-time application processing fee'
    },
    verification: {
      name: 'Credentials Verification',
      amount: 14900, // $149.00 - Background & license verification
      currency: 'usd',
      description: 'Background check and license verification'
    },
    fullCredentialing: {
      name: 'Full Credentialing Package',
      amount: 19900, // $199.00 - Complete credentialing
      currency: 'usd',
      description: 'Complete credentialing including all verifications'
    }
  },
  
  // Provider Subscription (Platform Fees)
  providerSubscription: {
    test: {
      name: 'Provider Test ($1)',
      amount: 100, // $1.00 for testing
      currency: 'usd',
      interval: 'month',
      features: [
        'Test plan for development',
        'All provider features unlocked',
        'Charges $1.00/month',
        'Cancel anytime'
      ]
    },
    starter: {
      name: 'Provider Starter',
      amount: 9900, // $99/month
      currency: 'usd',
      interval: 'month',
      features: [
        'Up to 50 patients',
        'Basic scheduling',
        'Telehealth platform access',
        'E-prescribing'
      ]
    },
    professional: {
      name: 'Provider Professional',
      amount: 19900, // $199/month
      currency: 'usd',
      interval: 'month',
      features: [
        'Unlimited patients',
        'Advanced scheduling',
        'Priority support',
        'Analytics dashboard',
        'Custom availability'
      ]
    },
    enterprise: {
      name: 'Provider Enterprise',
      amount: 49900, // $499/month
      currency: 'usd',
      interval: 'month',
      features: [
        'All Professional features',
        'Multi-provider practice',
        'White-label options',
        'API access',
        'Dedicated account manager'
      ]
    }
  }
};

// ============================================================================
// CUSTOMER MANAGEMENT
// ============================================================================

/**
 * Get or create a Stripe customer for a user
 */
async function getOrCreateCustomer(userId) {
  try {
    // Check if user already has a Stripe customer ID
    const { rows } = await db.query(
      'SELECT stripe_customer_id, email, first_name, last_name, phone FROM users WHERE id = $1',
      [userId]
    );
    
    if (rows.length === 0) {
      throw new Error('User not found');
    }
    
    const user = rows[0];
    
    // Return existing customer ID if present
    if (user.stripe_customer_id) {
      // Verify customer still exists in Stripe
      try {
        const customer = await stripe.customers.retrieve(user.stripe_customer_id);
        if (!customer.deleted) {
          return customer;
        }
      } catch (e) {
        // Customer doesn't exist, create new one
      }
    }
    
    // Create new Stripe customer
    const customer = await stripe.customers.create({
      email: user.email,
      name: `${user.first_name} ${user.last_name}`.trim(),
      phone: user.phone || undefined,
      metadata: {
        userId: userId,
        platform: 'docta'
      }
    });
    
    // Save customer ID to database
    await db.query(
      'UPDATE users SET stripe_customer_id = $1 WHERE id = $2',
      [customer.id, userId]
    );
    
    logger.info('Stripe customer created', { userId, customerId: customer.id });
    
    return customer;
  } catch (error) {
    logger.error('Error getting/creating Stripe customer', { error: error.message, userId });
    throw error;
  }
}

// ============================================================================
// CHECKOUT SESSIONS
// ============================================================================

/**
 * Create checkout session for consultation payment
 */
async function createConsultationCheckout(userId, consultationType, appointmentId, metadata = {}) {
  try {
    const customer = await getOrCreateCustomer(userId);
    const pricing = PRICING.consultations[consultationType];
    
    if (!pricing) {
      throw new Error(`Invalid consultation type: ${consultationType}`);
    }
    
    // Free consultations (ED) don't need checkout
    if (pricing.amount === 0) {
      return {
        free: true,
        consultationType,
        message: 'This consultation is free. No payment required.'
      };
    }
    
    const session = await createCheckoutSessionWithFallback({
      customer: customer.id,
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: pricing.currency,
          product_data: {
            name: pricing.name,
            description: pricing.description
          },
          unit_amount: pricing.amount
        },
        quantity: 1
      }],
      metadata: {
        userId,
        appointmentId,
        type: 'consultation',
        consultationType,
        ...metadata
      },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/patient/appointments/${appointmentId}?payment=success`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/patient/appointments/${appointmentId}?payment=cancelled`
    }, { context: { userId, appointmentId, type: 'consultation' } });
    
    logger.info('Consultation checkout created', { 
      userId, 
      appointmentId, 
      sessionId: session.id,
      amount: pricing.amount 
    });
    
    return {
      sessionId: session.id,
      url: session.url,
      amount: pricing.amount,
      currency: pricing.currency
    };
  } catch (error) {
    logger.error('Error creating consultation checkout', { error: error.message, userId });
    throw error;
  }
}

/**
 * Create checkout session for subscription
 */
async function createSubscriptionCheckout(userId, planKey, metadata = {}) {
  try {
    const customer = await getOrCreateCustomer(userId);
    const plan = PRICING.subscriptions[planKey];
    
    if (!plan) {
      throw new Error(`Invalid subscription plan: ${planKey}`);
    }
    
    // Create or get the price in Stripe
    const price = await getOrCreatePrice(plan, 'patient_subscription');
    
    const session = await createCheckoutSessionWithFallback({
      customer: customer.id,
      mode: 'subscription',
      line_items: [{
        price: price.id,
        quantity: 1
      }],
      subscription_data: {
        metadata: {
          userId,
          planKey,
          ...metadata
        }
      },
      metadata: {
        userId,
        type: 'subscription',
        planKey,
        ...metadata
      },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/patient/subscription?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/patient/subscription?cancelled=true`,
      allow_promotion_codes: true
    }, { context: { userId, type: 'subscription', planKey } });
    
    logger.info('Subscription checkout created', { 
      userId, 
      planKey, 
      sessionId: session.id 
    });
    
    return {
      sessionId: session.id,
      url: session.url,
      plan: planKey,
      amount: plan.amount,
      interval: plan.interval
    };
  } catch (error) {
    logger.error('Error creating subscription checkout', { error: error.message, userId });
    throw error;
  }
}

/**
 * Create checkout for provider credentialing
 */
async function createCredentialingCheckout(userId, packageType = 'fullCredentialing') {
  try {
    const customer = await getOrCreateCustomer(userId);
    const pricing = PRICING.providerCredentialing[packageType];
    
    if (!pricing) {
      throw new Error(`Invalid credentialing package: ${packageType}`);
    }
    
    const session = await createCheckoutSessionWithFallback({
      customer: customer.id,
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: pricing.currency,
          product_data: {
            name: pricing.name,
            description: pricing.description
          },
          unit_amount: pricing.amount
        },
        quantity: 1
      }],
      metadata: {
        userId,
        type: 'credentialing',
        packageType
      },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/provider/credentialing?payment=success`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/provider/credentialing?payment=cancelled`
    }, { context: { userId, type: 'credentialing', packageType } });
    
    logger.info('Credentialing checkout created', { 
      userId, 
      packageType, 
      sessionId: session.id,
      amount: pricing.amount 
    });
    
    return {
      sessionId: session.id,
      url: session.url,
      amount: pricing.amount,
      currency: pricing.currency,
      packageType
    };
  } catch (error) {
    logger.error('Error creating credentialing checkout', { error: error.message, userId });
    throw error;
  }
}

/**
 * Create checkout for provider platform subscription
 */
async function createProviderSubscriptionCheckout(userId, planKey) {
  try {
    const customer = await getOrCreateCustomer(userId);
    const plan = PRICING.providerSubscription[planKey];
    
    if (!plan) {
      throw new Error(`Invalid provider plan: ${planKey}`);
    }
    
    const price = await getOrCreatePrice(plan, 'provider_subscription');
    
    const session = await createCheckoutSessionWithFallback({
      customer: customer.id,
      mode: 'subscription',
      line_items: [{
        price: price.id,
        quantity: 1
      }],
      metadata: {
        userId,
        type: 'provider_subscription',
        planKey
      },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/provider/settings?subscription=success`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/provider/settings?subscription=cancelled`
    }, { context: { userId, type: 'provider_subscription', planKey } });
    
    logger.info('Provider subscription checkout created', { 
      userId, 
      planKey, 
      sessionId: session.id 
    });
    
    return {
      sessionId: session.id,
      url: session.url,
      plan: planKey,
      amount: plan.amount,
      interval: plan.interval
    };
  } catch (error) {
    logger.error('Error creating provider subscription checkout', { error: error.message, userId });
    throw error;
  }
}

// ============================================================================
// PRICE MANAGEMENT
// ============================================================================

/**
 * Get or create a Stripe price for a subscription plan
 */
async function getOrCreatePrice(plan, productType) {
  try {
    // Search for existing product
    const products = await stripe.products.search({
      query: `metadata['type']:'${productType}' AND metadata['planName']:'${plan.name}'`
    });
    
    let product;
    if (products.data.length > 0) {
      product = products.data[0];
    } else {
      // Create product
      product = await stripe.products.create({
        name: plan.name,
        description: plan.features ? plan.features.join(', ') : plan.description,
        metadata: {
          type: productType,
          planName: plan.name
        }
      });
    }
    
    // Search for existing price
    const prices = await stripe.prices.list({
      product: product.id,
      active: true,
      limit: 1
    });
    
    if (prices.data.length > 0 && prices.data[0].unit_amount === plan.amount) {
      return prices.data[0];
    }
    
    // Create price
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: plan.amount,
      currency: plan.currency,
      recurring: plan.interval ? {
        interval: plan.interval
      } : undefined
    });
    
    return price;
  } catch (error) {
    logger.error('Error getting/creating Stripe price', { error: error.message, plan: plan.name });
    throw error;
  }
}

// ============================================================================
// SUBSCRIPTION MANAGEMENT
// ============================================================================

/**
 * Cancel a subscription
 */
async function cancelSubscription(subscriptionId, cancelImmediately = false) {
  try {
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: !cancelImmediately
    });
    
    if (cancelImmediately) {
      await stripe.subscriptions.cancel(subscriptionId);
    }
    
    logger.info('Subscription cancelled', { 
      subscriptionId, 
      immediate: cancelImmediately 
    });
    
    return subscription;
  } catch (error) {
    logger.error('Error cancelling subscription', { error: error.message, subscriptionId });
    throw error;
  }
}

/**
 * Get subscription details
 */
async function getSubscription(subscriptionId) {
  try {
    return await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['default_payment_method', 'latest_invoice']
    });
  } catch (error) {
    logger.error('Error retrieving subscription', { error: error.message, subscriptionId });
    throw error;
  }
}

/**
 * Create billing portal session for customer to manage their subscription
 */
async function createBillingPortalSession(userId) {
  try {
    const customer = await getOrCreateCustomer(userId);
    
    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/patient/settings`
    });
    
    return { url: session.url };
  } catch (error) {
    logger.error('Error creating billing portal session', { error: error.message, userId });
    throw error;
  }
}

// ============================================================================
// WEBHOOK HANDLING
// ============================================================================

/**
 * Handle Stripe webhook events
 */
async function handleWebhook(event) {
  // Idempotency: Stripe may retry events. We must ensure we never double-process.
  try {
    const { rows } = await db.query(
      `INSERT INTO stripe_webhook_events (event_id, event_type)
       VALUES ($1, $2)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [event.id, event.type]
    );

    if (rows.length === 0) {
      logger.warn('Duplicate Stripe webhook ignored', { id: event.id, type: event.type });
      return;
    }
  } catch (e) {
    // If idempotency table isn't available, do not hard-fail webhooks in prod.
    // We still process, but log loudly to fix DB migration ASAP.
    logger.error('Stripe webhook idempotency check failed', { error: e.message, id: event.id, type: event.type });
  }

  logger.info('Processing Stripe webhook', { id: event.id, type: event.type });
  
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutComplete(event.data.object);
      break;
      
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleSubscriptionUpdate(event.data.object);
      break;
      
    case 'customer.subscription.deleted':
      await handleSubscriptionCancelled(event.data.object);
      break;
      
    case 'invoice.paid':
      await handleInvoicePaid(event.data.object);
      break;
      
    case 'invoice.payment_failed':
      await handlePaymentFailed(event.data.object);
      break;
      
    case 'payment_intent.succeeded':
      await handlePaymentSuccess(event.data.object);
      break;

    case 'payment_intent.created':
      logger.info('Payment intent created', { paymentIntentId: event.data.object.id });
      break;

    case 'invoice.payment_action_required':
      await handlePaymentActionRequired(event.data.object);
      break;

    case 'invoice.upcoming':
      await handleInvoiceUpcoming(event.data.object);
      break;

    case 'invoice.finalization_failed':
      logger.error('Invoice finalization failed', { invoiceId: event.data.object.id });
      break;

    case 'invoice.created':
    case 'invoice.finalized':
    case 'invoice.updated':
      logger.info('Invoice lifecycle event', { type: event.type, invoiceId: event.data.object.id });
      break;

    case 'entitlements.active_entitlement_summary.updated':
      logger.info('Entitlement summary updated', { customerId: event.data.object.customer });
      break;

    case 'subscription_schedule.aborted':
    case 'subscription_schedule.canceled':
      await handleSubscriptionScheduleEnded(event.data.object, event.type);
      break;

    case 'subscription_schedule.expiring':
      await handleSubscriptionScheduleExpiring(event.data.object);
      break;

    case 'subscription_schedule.completed':
    case 'subscription_schedule.created':
    case 'subscription_schedule.released':
    case 'subscription_schedule.updated':
      logger.info('Subscription schedule event', { type: event.type, scheduleId: event.data.object.id });
      break;

    default:
      logger.info('Unhandled webhook event', { type: event.type });
  }
}

/**
 * Handle completed checkout session
 */
async function handleCheckoutComplete(session) {
  const metadata = session.metadata || {};
  const { userId, type, appointmentId, packageType, planKey } = metadata;
  
  if (!userId) {
    logger.warn('Checkout completed without userId in metadata', { sessionId: session.id });
    return;
  }

  try {
    if (type === 'consultation') {
      // Mark appointment as paid
      await db.query(
        `UPDATE appointments 
         SET payment_completed = true, 
             payment_id = $1,
             payment_amount = $2,
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = $3`,
        [session.payment_intent, session.amount_total, appointmentId]
      );
      
      // Create payment record
      await db.query(
        `INSERT INTO payments (user_id, appointment_id, type, status, amount, currency, stripe_payment_id, metadata)
         VALUES ($1, $2, 'consultation', 'completed', $3, 'usd', $4, $5)`,
        [userId, appointmentId, session.amount_total / 100, session.payment_intent, JSON.stringify(metadata)]
      );
      
      logger.info('Consultation payment completed', { userId, appointmentId });
      
    } else if (type === 'credentialing') {
      // Update provider credentialing status
      await db.query(
        `UPDATE provider_credentialing 
         SET payment_completed = true,
             payment_id = $1,
             payment_amount = $2,
             status = CASE WHEN status = 'pending_payment' THEN 'documents_required' ELSE status END,
             updated_at = CURRENT_TIMESTAMP
         WHERE provider_id = $3`,
        [session.payment_intent, session.amount_total / 100, userId]
      );
      
      // Create payment record
      await db.query(
        `INSERT INTO payments (user_id, type, status, amount, currency, stripe_payment_id, metadata)
         VALUES ($1, 'credentialing', 'completed', $2, 'usd', $3, $4)`,
        [userId, session.amount_total / 100, session.payment_intent, JSON.stringify(metadata)]
      );
      
      logger.info('Credentialing payment completed', { userId, packageType });

    } else if (type === 'subscription') {
      // Subscription checkout completed — Stripe will fire customer.subscription.created next,
      // but we record the payment here as a safety net
      await db.query(
        `INSERT INTO payments (user_id, type, status, amount, currency, stripe_payment_id, metadata)
         VALUES ($1, 'subscription', 'completed', $2, 'usd', $3, $4)
         ON CONFLICT DO NOTHING`,
        [userId, (session.amount_total || 0) / 100, session.payment_intent || session.subscription, JSON.stringify(metadata)]
      );

      // If Stripe subscription ID is available, link it immediately
      if (session.subscription) {
        const mapped = { test: 'gold', basic: 'basic', gold: 'gold', goldYearly: 'gold', platinum: 'platinum' };
        const tier = mapped[planKey] || 'gold';
        await db.query(
          `UPDATE subscriptions 
           SET stripe_subscription_id = $1, status = 'active', tier = $2, updated_at = CURRENT_TIMESTAMP 
           WHERE user_id = $3 AND stripe_subscription_id IS NULL`,
          [session.subscription, tier, userId]
        );
      }

      logger.info('Subscription checkout completed', { userId, planKey });
    }
  } catch (error) {
    logger.error('Error handling checkout complete', { error: error.message, sessionId: session.id });
    throw error;
  }
}

/**
 * Handle subscription updates
 */
async function handleSubscriptionUpdate(subscription) {
  const userId = subscription.metadata?.userId;
  if (!userId) {
    logger.warn('Subscription update missing userId in metadata', { subscriptionId: subscription.id });
    return;
  }
  
  try {
    const status = subscription.status;
    const currentPeriodEnd = new Date(subscription.current_period_end * 1000);
    const currentPeriodStart = new Date(subscription.current_period_start * 1000);

    const planKey = subscription.metadata?.planKey;

    if (!planKey) {
      logger.warn('Subscription update missing planKey, inferring from price', { subscriptionId: subscription.id });
    }

    // Map Stripe planKey -> DB tier + access level
    const planMap = {
      test: { tier: 'gold', accessLevel: 'gold_monthly' },
      basic: { tier: 'basic', accessLevel: 'basic_monthly' },
      gold: { tier: 'gold', accessLevel: 'gold_monthly' },
      goldYearly: { tier: 'gold', accessLevel: 'gold_yearly' },
      platinum: { tier: 'platinum', accessLevel: 'platinum_monthly' }
    };

    // If planKey missing, try to infer from price amount
    let effectivePlanKey = planKey;
    if (!effectivePlanKey) {
      const priceAmount = subscription.items?.data?.[0]?.price?.unit_amount || 0;
      if (priceAmount <= 1999) effectivePlanKey = 'basic';
      else if (priceAmount <= 3999) effectivePlanKey = 'gold';
      else if (priceAmount >= 29900 && subscription.items?.data?.[0]?.price?.recurring?.interval === 'year') effectivePlanKey = 'goldYearly';
      else effectivePlanKey = 'platinum';
    }

    const mapped = planMap[effectivePlanKey] || planMap.basic;

    // Map Stripe subscription status -> DB subscription_status enum
    const statusMap = {
      active: 'active',
      trialing: 'active',
      past_due: 'past_due',
      unpaid: 'past_due',
      canceled: 'cancelled',
      incomplete: 'past_due',
      incomplete_expired: 'expired',
      paused: 'past_due'
    };
    const dbStatus = statusMap[status] || 'past_due';
    
    // Update or create subscription record
    await db.query(
      `INSERT INTO subscriptions (user_id, stripe_subscription_id, status, tier, current_period_start, current_period_end)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (stripe_subscription_id) 
       DO UPDATE SET status = $3, current_period_start = $5, current_period_end = $6, updated_at = CURRENT_TIMESTAMP`,
      [userId, subscription.id, dbStatus, mapped.tier, currentPeriodStart, currentPeriodEnd]
    );
    
    // Update user access level based on subscription status
    if (dbStatus === 'active') {
      await db.query(
        'UPDATE users SET access_level = $1, subscription_tier = $2 WHERE id = $3',
        [mapped.accessLevel, mapped.tier, userId]
      );

      // Issue membership card for Gold/Platinum
      await membershipService.upsertActiveCard({
        userId,
        tier: mapped.tier,
        stripeSubscriptionId: subscription.id,
        currentPeriodEnd
      });
    } else if (dbStatus === 'past_due') {
      await db.query(
        'UPDATE users SET access_level = $1, subscription_tier = $2 WHERE id = $3',
        ['read_only', 'free', userId]
      );
      await membershipService.suspendCardsForUser({ userId, reason: 'past_due' });
    } else {
      await db.query(
        'UPDATE users SET access_level = $1, subscription_tier = $2 WHERE id = $3',
        ['read_only', 'free', userId]
      );
      await membershipService.revokeCardsForUser({ userId, reason: `status_${dbStatus}` });
    }
    
    logger.info('Subscription updated', { userId, subscriptionId: subscription.id, status: dbStatus, planKey });
  } catch (error) {
    logger.error('Error handling subscription update', { error: error.message, subscriptionId: subscription.id });
    throw error;
  }
}

/**
 * Handle subscription cancellation
 */
async function handleSubscriptionCancelled(subscription) {
  const userId = subscription.metadata?.userId;
  if (!userId) return;
  
  try {
    await db.query(
      `UPDATE subscriptions 
       SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP 
       WHERE stripe_subscription_id = $1`,
      [subscription.id]
    );
    
    await db.query(
      'UPDATE users SET access_level = $1, subscription_tier = $2 WHERE id = $3',
      ['read_only', 'free', userId]
    );

    await membershipService.revokeCardsForUser({ userId, reason: 'subscription_cancelled' });
    
    logger.info('Subscription cancelled', { userId, subscriptionId: subscription.id });
  } catch (error) {
    logger.error('Error handling subscription cancellation', { error: error.message });
    throw error;
  }
}

/**
 * Handle paid invoice
 */
async function handleInvoicePaid(invoice) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;
  
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const userId = subscription.metadata?.userId;
    const planKey = subscription.metadata?.planKey || 'gold';
    const planMap = {
      test: { tier: 'gold', accessLevel: 'gold_monthly' },
      basic: { tier: 'basic', accessLevel: 'basic_monthly' },
      gold: { tier: 'gold', accessLevel: 'gold_monthly' },
      goldYearly: { tier: 'gold', accessLevel: 'gold_yearly' },
      platinum: { tier: 'platinum', accessLevel: 'platinum_monthly' }
    };
    const mapped = planMap[planKey] || planMap.gold;
    
    if (userId) {
      // Create payment record for recurring payment
      await db.query(
        `INSERT INTO payments (user_id, subscription_id, type, status, amount, currency, stripe_payment_id, metadata)
         VALUES ($1, (SELECT id FROM subscriptions WHERE stripe_subscription_id = $2), 'subscription_renewal', 'completed', $3, 'usd', $4, $5)`,
        [userId, subscriptionId, invoice.amount_paid / 100, invoice.payment_intent, JSON.stringify({ invoiceId: invoice.id })]
      );

      // Ensure access stays active on successful recurring payment
      await db.query(
        `UPDATE subscriptions
         SET status = 'active', updated_at = CURRENT_TIMESTAMP
         WHERE stripe_subscription_id = $1`,
        [subscriptionId]
      );
      await db.query(
        'UPDATE users SET access_level = $1, subscription_tier = $2 WHERE id = $3',
        [mapped.accessLevel, mapped.tier, userId]
      );
      await membershipService.upsertActiveCard({
        userId,
        tier: mapped.tier,
        stripeSubscriptionId: subscriptionId,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000)
      });
      
      logger.info('Invoice paid', { userId, invoiceId: invoice.id });
    }
  } catch (error) {
    logger.error('Error handling invoice paid', { error: error.message, invoiceId: invoice.id });
  }
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(invoice) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;
  
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const userId = subscription.metadata?.userId;
    
    if (userId) {
      // Revoke paid access immediately on failed payment (robust enforcement)
      await db.query(
        `UPDATE subscriptions
         SET status = 'past_due', updated_at = CURRENT_TIMESTAMP
         WHERE stripe_subscription_id = $1`,
        [subscriptionId]
      );
      await db.query(
        'UPDATE users SET access_level = $1, subscription_tier = $2 WHERE id = $3',
        ['read_only', 'free', userId]
      );
      await membershipService.suspendCardsForUser({ userId, reason: 'invoice_payment_failed' });

      // Notify user about failed payment via in-app + email
      try {
        await notificationService.sendBillingNotification(
          userId,
          'Payment Failed — Action Required',
          'Your subscription payment failed and your account has been temporarily downgraded. Please update your payment method to restore full access.',
          invoice.id
        );
      } catch (notifErr) {
        logger.warn('Failed to send billing notification', { userId, error: notifErr.message });
      }
      try {
        const userResult = await db.query('SELECT email, first_name FROM users WHERE id = $1', [userId]);
        const user = userResult.rows[0];
        if (user?.email) {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
          await emailService.sendEmail({
            to: user.email,
            subject: 'Action Required: Your DoctaRx Payment Failed',
            html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
              <h2 style="color:#7c3aed">Payment Failed</h2>
              <p>Hi ${user.first_name || 'there'},</p>
              <p>We were unable to process your subscription payment. Your account has been temporarily downgraded to the free plan and your membership card has been suspended.</p>
              <p>To restore full access, please update your payment method:</p>
              <a href="${appUrl}/dashboard/billing" style="display:inline-block;background:#7c3aed;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;margin:16px 0">Update Payment Method</a>
              <p style="color:#6b7280;font-size:13px">Invoice ID: ${invoice.id}</p>
              <p style="color:#6b7280;font-size:12px">DoctaRx | info@doctarx.com</p>
            </div>`
          });
        }
      } catch (emailErr) {
        logger.warn('Failed to send payment failed email', { userId, error: emailErr.message });
      }
      logger.warn('Payment failed — user notified', { userId, invoiceId: invoice.id });
    }
  } catch (error) {
    logger.error('Error handling payment failed', { error: error.message });
  }
}

/**
 * Handle successful payment intent
 */
async function handlePaymentSuccess(paymentIntent) {
  logger.info('Payment intent succeeded', { paymentIntentId: paymentIntent.id });
}

/**
 * Handle invoice.payment_action_required
 * Customer must complete 3D Secure / SCA authentication
 */
async function handlePaymentActionRequired(invoice) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const userId = subscription.metadata?.userId;
    if (userId) {
      const { rows } = await db.query('SELECT email, first_name FROM users WHERE id = $1', [userId]);
      if (rows.length > 0) {
        const emailService = require('./email');
        const hostedUrl = invoice.hosted_invoice_url;
        await emailService.sendEmail({
          to: rows[0].email,
          subject: 'Action required: complete your DoctaRx payment',
          html: `<p>Hi ${rows[0].first_name},</p>
                 <p>Your payment requires additional authentication. Please click the link below to complete it:</p>
                 <p><a href="${hostedUrl}">Complete Payment</a></p>
                 <p>If you did not initiate this, please contact support.</p>`,
          text: `Hi ${rows[0].first_name}, your payment requires authentication. Visit: ${hostedUrl}`
        });
      }
      logger.warn('Payment action required notified', { userId, invoiceId: invoice.id });
    }
  } catch (error) {
    logger.error('Error handling payment_action_required', { error: error.message, invoiceId: invoice.id });
  }
}

/**
 * Handle invoice.upcoming
 * Subscription renewal is coming up — optionally remind the user
 */
async function handleInvoiceUpcoming(invoice) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const userId = subscription.metadata?.userId;
    if (userId) {
      logger.info('Upcoming invoice', {
        userId,
        invoiceId: invoice.id,
        amountDue: invoice.amount_due,
        dueDate: invoice.next_payment_attempt
      });
    }
  } catch (error) {
    logger.error('Error handling invoice upcoming', { error: error.message });
  }
}

/**
 * Handle subscription_schedule.aborted / canceled
 * Mark any associated subscription as cancelled in the DB
 */
async function handleSubscriptionScheduleEnded(schedule, eventType) {
  try {
    const subscriptionId = schedule.subscription;
    if (subscriptionId) {
      await db.query(
        `UPDATE subscriptions SET status = 'canceled', updated_at = CURRENT_TIMESTAMP
         WHERE stripe_subscription_id = $1`,
        [subscriptionId]
      );
    }
    logger.info('Subscription schedule ended', { type: eventType, scheduleId: schedule.id });
  } catch (error) {
    logger.error('Error handling subscription schedule end', { error: error.message, scheduleId: schedule.id });
  }
}

/**
 * Handle subscription_schedule.expiring
 * Notify the user their scheduled plan is about to expire
 */
async function handleSubscriptionScheduleExpiring(schedule) {
  try {
    const subscriptionId = schedule.subscription;
    if (subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const userId = subscription.metadata?.userId;
      if (userId) {
        logger.info('Subscription schedule expiring', { userId, scheduleId: schedule.id });
      }
    }
  } catch (error) {
    logger.error('Error handling subscription schedule expiring', { error: error.message });
  }
}

// ============================================================================
// VERIFICATION HELPERS
// ============================================================================

/**
 * Verify webhook signature
 */
function verifyWebhookSignature(payload, signature, webhookSecret) {
  try {
    return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (error) {
    logger.error('Webhook signature verification failed', { error: error.message });
    throw error;
  }
}

/**
 * Check if user has active subscription
 */
async function hasActiveSubscription(userId) {
  try {
    const { rows } = await db.query(
      `SELECT * FROM subscriptions 
       WHERE user_id = $1 
       AND status = 'active' 
       AND current_period_end > CURRENT_TIMESTAMP`,
      [userId]
    );
    return rows.length > 0;
  } catch (error) {
    logger.error('Error checking subscription status', { error: error.message, userId });
    return false;
  }
}

/**
 * Check if consultation requires payment
 */
async function requiresPayment(userId, consultationType) {
  // ED consultations are always free for first visit
  if (consultationType === 'erectileDysfunction') {
    const { rows } = await db.query(
      `SELECT COUNT(*) as count FROM appointments 
       WHERE patient_id = $1 AND metadata->>'consultationType' = 'erectileDysfunction'`,
      [userId]
    );
    return rows[0].count > 0; // Free only for first ED consultation
  }
  
  // Check if user has active subscription
  const hasSubscription = await hasActiveSubscription(userId);
  return !hasSubscription;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Pricing info
  PRICING,
  
  // Customer management
  getOrCreateCustomer,
  
  // Checkout sessions
  createConsultationCheckout,
  createSubscriptionCheckout,
  createCredentialingCheckout,
  createProviderSubscriptionCheckout,
  
  // Subscription management
  cancelSubscription,
  getSubscription,
  createBillingPortalSession,
  
  // Webhooks
  handleWebhook,
  verifyWebhookSignature,
  
  // Verification
  hasActiveSubscription,
  requiresPayment,
  
  // Direct Stripe access
  stripe
};

