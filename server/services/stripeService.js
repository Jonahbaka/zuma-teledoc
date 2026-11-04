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
const crypto = require('node:crypto');
const db = require('../db');
const logger = require('../middleware/logger');
const consumerMembership = require('./consumerMembershipService');

// Initialize Stripe with secret key
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-11-20.acacia', maxNetworkRetries: 2, timeout: 10000
}) : null;

// Prefer Stripe "automatic payment methods" for global support (local cards/bank methods),
// but fall back to card-only if a given account/region doesn't support it.
const STRIPE_AUTOMATIC_PAYMENT_METHODS_ENABLED = String(
  process.env.STRIPE_AUTOMATIC_PAYMENT_METHODS_ENABLED ?? 'true'
).toLowerCase() === 'true';

async function createCheckoutSessionWithFallback(baseParams, { context = {}, idempotencyKey } = {}) {
  const options = idempotencyKey ? { idempotencyKey } : {};
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
      return await stripe.checkout.sessions.create(apmParams, options);
    } catch (err) {
      if (err?.type !== 'StripeInvalidRequestError') throw err;
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
  return await stripe.checkout.sessions.create(cardParams, options);
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
      name: 'DoctaRx Test ($1)',
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
      name: 'DoctaRx Basic',
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
      name: 'DoctaRx Gold',
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
      name: 'DoctaRx Gold (Annual)',
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
      name: 'DoctaRx Platinum',
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
async function getOrCreateCustomer(userId, { database = db } = {}) {
  try {
    const current = await consumerMembership.account(database, userId);
    const config = consumerMembership.configuration();
    if (current.market_scope !== 'US' || !['patient', 'provider'].includes(current.role)) throw consumerMembership.paymentError(403, 'US_STRIPE_ACCOUNT_REQUIRED', 'This Stripe checkout requires an eligible US account.');
    if (!config.available || (!config.livemode && !current.is_test_account)) throw consumerMembership.paymentError(503, 'STRIPE_UNAVAILABLE', 'Stripe checkout is unavailable for this account and environment. No payment was collected.');
    // Check if user already has a Stripe customer ID
    const { rows } = await database.query(
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
          if (customer.metadata?.userId !== userId || customer.livemode !== config.livemode) throw consumerMembership.paymentError(403, 'STRIPE_CUSTOMER_MISMATCH', 'Stripe customer ownership or environment does not match.');
          return customer;
        }
      } catch (e) {
        if (e.code !== 'resource_missing') throw e;
      }
    }
    
    // Create new Stripe customer
    const customer = await stripe.customers.create({
      email: user.email,
      name: `${user.first_name} ${user.last_name}`.trim(),
      phone: user.phone || undefined,
      metadata: {
        userId: userId,
        platform: 'doctarx'
      }
    }, { idempotencyKey: 'doctarx-customer-' + userId + '-' + (config.livemode ? 'live' : 'test') });
    
    // Save customer ID to database
    await database.query(
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
    await assertOwnConsultation(userId, appointmentId);
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
        ...metadata,
        userId,
        appointmentId,
        type: 'consultation',
        consultationType
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
  const lock = await db.getPool().connect();
  try {
    await lock.query('BEGIN');
    await consumerMembership.lockFinancialAccount(lock, userId);
    const eligible = await consumerMembership.assertCheckout(userId, planKey, PRICING, { database: lock, lock: true });
    const customer = await getOrCreateCustomer(userId, { database: lock });
    const plan = PRICING.subscriptions[planKey];
    
    if (!plan) {
      throw new Error(`Invalid subscription plan: ${planKey}`);
    }
    
    const recent = await stripe.checkout.sessions.list({ customer: customer.id, limit: 100 });
    if (!Array.isArray(recent.data) || typeof recent.has_more !== 'boolean' || recent.has_more) throw consumerMembership.paymentError(503, 'CHECKOUT_RECONCILIATION_REQUIRED', 'Existing checkout sessions must be reconciled before another payment attempt.');
    const memberSessions = recent.data.filter(session => session.mode === 'subscription');
    const open = memberSessions.filter(session => session.status === 'open');
    if (open.length) {
      const session = open[0];
      const bound = session.metadata || {};
      let target; try { target = new URL(session.url); } catch { /* Cannot reuse an unverifiable redirect. */ }
      if (open.length !== 1 || bound.userId !== userId || bound.type !== 'subscription' || bound.planKey !== planKey ||
        bound.expectedAmount !== String(plan.amount) || bound.currency !== plan.currency || bound.interval !== plan.interval ||
        session.livemode !== eligible.config.livemode || !Number.isSafeInteger(session.expires_at) || session.expires_at * 1000 <= Date.now() ||
        !target || target.username || target.password || target.protocol !== 'https:' || target.hostname !== 'checkout.stripe.com')
        throw consumerMembership.paymentError(409, 'OPEN_CHECKOUT_REQUIRES_RECONCILIATION', 'An existing membership checkout must be completed, expired or reconciled before selecting another plan.');
      await lock.query('COMMIT');
      return { sessionId: session.id, url: target.toString(), plan: planKey, amount: plan.amount, currency: plan.currency, interval: plan.interval, reused: true };
    }
    const completed = memberSessions.filter(session => session.status === 'complete');
    if (completed.length > 10) throw consumerMembership.paymentError(503, 'CHECKOUT_RECONCILIATION_REQUIRED', 'Membership checkout history requires reconciliation.');
    for (const session of completed) {
      if (!session.subscription) throw consumerMembership.paymentError(409, 'CHECKOUT_RECONCILIATION_REQUIRED', 'A completed membership checkout requires reconciliation.');
      const previous = await stripe.subscriptions.retrieve(typeof session.subscription === 'string' ? session.subscription : session.subscription.id);
      if ((typeof previous.customer === 'string' ? previous.customer : previous.customer?.id) !== customer.id || previous.livemode !== eligible.config.livemode)
        throw consumerMembership.paymentError(409, 'CHECKOUT_RECONCILIATION_REQUIRED', 'Membership checkout ownership or environment requires reconciliation.');
      if (!['canceled', 'incomplete_expired'].includes(previous.status)) throw consumerMembership.paymentError(409, 'CHECKOUT_RECONCILIATION_REQUIRED', 'A completed membership checkout is awaiting reconciliation. Manage the existing subscription before starting another.');
    }
    // Create or get the price in Stripe
    const price = await getOrCreatePrice(plan, 'patient_subscription');
    const bound = { ...metadata, type: 'subscription', userId, planKey, priceId: price.id, market: 'US',
      expectedAmount: String(plan.amount), currency: plan.currency, interval: plan.interval, environment: eligible.config.livemode ? 'live' : 'test' };
    
    const idempotencyKey = 'doctarx-membership-' + crypto.createHash('sha256').update(JSON.stringify([userId, planKey, price.id, eligible.config.livemode, memberSessions[0]?.id || 'initial'])).digest('hex');
    const session = await createCheckoutSessionWithFallback({
      customer: customer.id,
      mode: 'subscription',
      line_items: [{
        price: price.id,
        quantity: 1
      }],
      subscription_data: {
        metadata: bound
      },
      metadata: bound,
      client_reference_id: userId,
      success_url: `${eligible.config.origin}/patient/subscription?checkout=returned`,
      cancel_url: `${eligible.config.origin}/patient/subscription?checkout=cancelled`,
      allow_promotion_codes: true
    }, { context: { userId, type: 'subscription', planKey }, idempotencyKey });
    
    await lock.query('COMMIT');
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
    await lock.query('ROLLBACK');
    logger.error('Error creating subscription checkout', { error: error.message, userId });
    throw error;
  } finally { lock.release(); }
}

/**
 * Create checkout for provider credentialing
 */
async function createCredentialingCheckout(userId, _packageType = 'fullCredentialing') {
  await consumerMembership.account(db, userId);
  throw consumerMembership.paymentError(503, 'CREDENTIALING_BILLING_NOT_ACTIVATED', 'Credentialing payment recording is not activated. No payment was collected.');
}

/**
 * Create checkout for provider platform subscription
 */
async function createProviderSubscriptionCheckout(userId, _planKey) {
  await consumerMembership.account(db, userId);
  throw consumerMembership.paymentError(503, 'PROVIDER_SUBSCRIPTION_NOT_ACTIVATED', 'Provider subscription entitlement recording is not activated. No payment was collected.');
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
        description: 'DoctaRx membership billing plan. Clinical service availability is assessed separately.',
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
      limit: 100
    });
    const matched = prices.data.find(price => price.unit_amount === plan.amount && price.currency === plan.currency &&
      price.recurring?.interval === plan.interval && (price.recurring?.interval_count || 1) === 1);
    if (matched) {
      return matched;
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

async function updateOwnSubscription(userId, { cancelAtPeriodEnd = true, immediately = false } = {}) {
  if (typeof cancelAtPeriodEnd !== 'boolean' || typeof immediately !== 'boolean')
    throw consumerMembership.paymentError(400, 'MEMBERSHIP_INPUT_INVALID', 'Choose a valid membership renewal change.');
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    await consumerMembership.lockFinancialAccount(client, userId);
    const user = await consumerMembership.account(client, userId, { lock: true });
    const config = consumerMembership.configuration(); consumerMembership.assertConsumer(user, config);
    const result = await client.query("SELECT * FROM subscriptions WHERE user_id=$1 AND stripe_subscription_id IS NOT NULL AND status IN ('active','past_due') ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [userId]);
    const current = result.rows[0];
    if (!current) throw consumerMembership.paymentError(404, 'SUBSCRIPTION_NOT_FOUND', 'No manageable Stripe subscription was found.');
    const owns = value => value?.id === current.stripe_subscription_id &&
      (typeof value.customer === 'string' ? value.customer : value.customer?.id) === user.stripe_customer_id &&
      value.metadata?.userId === userId && value.livemode === config.livemode;
    // The same mutex used by reconciliation and checkout is held before the
    // gateway read/change, so an older paid snapshot cannot outlive this cancel.
    const live = await stripe.subscriptions.retrieve(current.stripe_subscription_id);
    if (!owns(live)) throw consumerMembership.paymentError(403, 'STRIPE_CUSTOMER_MISMATCH', 'Stripe subscription ownership does not match.');
    const confirmed = immediately ? await stripe.subscriptions.cancel(live.id) : await stripe.subscriptions.update(live.id, { cancel_at_period_end: cancelAtPeriodEnd });
    if (!owns(confirmed) || (immediately && confirmed.status !== 'canceled') || (!immediately && confirmed.cancel_at_period_end !== cancelAtPeriodEnd))
      throw consumerMembership.paymentError(503, 'STRIPE_CANCELLATION_UNCONFIRMED', 'Stripe did not confirm the requested renewal change.');
    const saved = await client.query("UPDATE subscriptions SET cancel_at_period_end=$1,status=CASE WHEN $2 THEN 'cancelled'::subscription_status ELSE status END,cancelled_at=CASE WHEN $2 THEN NOW() ELSE cancelled_at END,updated_at=NOW() WHERE id=$3 AND user_id=$4 RETURNING *", [cancelAtPeriodEnd, immediately, current.id, userId]);
    if (!saved.rows[0]) throw consumerMembership.paymentError(409, 'MEMBERSHIP_WRITE_CONFLICT', 'Stripe accepted the change; local membership reconciliation is required.');
    if (immediately) {
      await client.query("UPDATE users SET access_level='read_only',subscription_tier='free' WHERE id=$1 AND access_level IN ('basic_monthly','gold_monthly','gold_yearly','platinum_monthly') AND NOT EXISTS (SELECT 1 FROM subscriptions WHERE user_id=$1 AND id<>$2 AND status='active' AND current_period_end>NOW())", [userId, current.id]);
      await client.query("UPDATE membership_cards SET status='revoked',revoked_at=NOW(),updated_at=NOW() WHERE user_id=$1 AND stripe_subscription_id=$2", [userId, current.stripe_subscription_id]);
    }
    await client.query("INSERT INTO audit_logs (user_id,action,resource_type,resource_id,description,new_values,phi_accessed,success) VALUES ($1,'update','subscription',$2,'Stripe confirmed membership renewal change',$3::jsonb,FALSE,TRUE)", [userId, current.id, JSON.stringify({ cancelAtPeriodEnd, immediately, source: 'stripe_confirmed' })]);
    await client.query('COMMIT');
    return saved.rows[0];
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function cancelSubscription() {
  // This unused legacy interface has no current owner context. Background or
  // future callers must use updateOwnSubscription and its shared account lock.
  throw consumerMembership.paymentError(503, 'OWNER_SCOPED_CANCELLATION_REQUIRED', 'Use the current account membership workflow to change a subscription.');
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
    const user = await consumerMembership.account(db, userId);
    const config = consumerMembership.configuration();
    consumerMembership.assertConsumer(user, config);
    if (!user.stripe_customer_id) throw consumerMembership.paymentError(404, 'STRIPE_CUSTOMER_NOT_FOUND', 'No Stripe billing customer exists for this account.');
    const customer = await stripe.customers.retrieve(user.stripe_customer_id);
    if (customer.deleted || customer.metadata?.userId !== userId || customer.livemode !== config.livemode) throw consumerMembership.paymentError(403, 'STRIPE_CUSTOMER_MISMATCH', 'Stripe billing customer ownership does not match.');
    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: `${config.origin}/patient/subscription`
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
  if (!stripe) throw consumerMembership.paymentError(503, 'STRIPE_UNAVAILABLE', 'Stripe is unavailable.');
  if (await consumerMembership.processMembershipEvent(event, stripe, PRICING)) return;
  if (await consumerMembership.processConsultationEvent(event, stripe, PRICING)) return;
  if (await consumerMembership.processConsultationAdjustment(event, stripe)) return;
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
    logger.error('Stripe webhook idempotency check failed', { error: e.message, id: event.id, type: event.type });
    throw e;
  }

  logger.info('Processing Stripe webhook', { id: event.id, type: event.type });
  
  switch (event.type) {
    case 'checkout.session.completed':
      // Unrecognized/legacy checkout types cannot activate a financial record.
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
  // Financial schedule events are reconciled by processMembershipEvent.
  logger.info('Subscription schedule observed', { type: eventType, scheduleId: schedule.id });
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
  return (await consumerMembership.readState(userId, PRICING)).hasActiveSubscription;
}

async function assertOwnConsultation(userId, appointmentId) {
  const user = await consumerMembership.account(db, userId);
  consumerMembership.assertConsumer(user, consumerMembership.configuration());
  const result = await db.query(`SELECT a.id FROM appointments a JOIN users p ON p.id=a.provider_id
    WHERE a.id=$1 AND a.patient_id=$2 AND p.market_scope='US' AND p.role='provider' AND p.is_active=TRUE
      AND a.status NOT IN ('cancelled','completed','no_show')`, [appointmentId, userId]);
  if (!result.rows.length) throw consumerMembership.paymentError(404, 'APPOINTMENT_NOT_FOUND', 'An eligible appointment owned by this patient is required.');
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
  updateOwnSubscription,
  getSubscription,
  createBillingPortalSession,
  
  // Webhooks
  handleWebhook,
  verifyWebhookSignature,
  
  // Verification
  hasActiveSubscription,
  requiresPayment,
  assertOwnConsultation,
  
  // Direct Stripe access
  stripe
};

