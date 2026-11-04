'use strict';

const db = require('../db');
const { getTestingBypassState, getTestingBypassPayload } = require('./testingAccessService');

const PLAN_ACCESS = Object.freeze({ basic: { tier: 'basic', accessLevel: 'basic_monthly' }, gold: { tier: 'gold', accessLevel: 'gold_monthly' },
  goldYearly: { tier: 'gold', accessLevel: 'gold_yearly' }, platinum: { tier: 'platinum', accessLevel: 'platinum_monthly' }, test: { tier: 'gold', accessLevel: 'gold_monthly' } });
const objectId = value => typeof value === 'string' ? value : value?.id;
function paymentError(statusCode, code, message) { const error = new Error(message); Object.assign(error, { statusCode, code }); return error; }
function configuration() {
  const key = process.env.STRIPE_SECRET_KEY || '';
  const live = /^sk_live_[A-Za-z0-9]+$/.test(key); const test = /^sk_test_[A-Za-z0-9]+$/.test(key);
  const production = process.env.NODE_ENV === 'production';
  let origin;
  try { origin = new URL(process.env.NEXT_PUBLIC_APP_URL); } catch { /* An explicit safe return origin is required. */ }
  const available = (live || test) && !/(placeholder|changeme|example|your_)/i.test(key) && (!production || live) &&
    /^whsec_[A-Za-z0-9]+$/.test(process.env.STRIPE_WEBHOOK_SECRET || '') && !/(placeholder|changeme|example|your_)/i.test(process.env.STRIPE_WEBHOOK_SECRET || '') &&
    origin && !origin.username && !origin.password && (origin.protocol === 'https:' || (!production && origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)));
  return { available: Boolean(available), livemode: live, production, origin: origin?.origin };
}
async function account(database, userId, { lock = false } = {}) {
  const result = await database.query(`SELECT id,role,is_active,market_scope,is_test_account,stripe_customer_id,access_level,
    testing_bypass_active,testing_bypass_expires_at,testing_bypass_tier FROM users WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [userId]);
  const user = result.rows[0];
  if (!user?.is_active) throw paymentError(403, 'ACCOUNT_INACTIVE', 'An active account is required.');
  return user;
}
async function lockFinancialAccount(client, userId) {
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(String(userId || '')))
    throw paymentError(400, 'MEMBERSHIP_OWNER_REQUIRED', 'A valid current membership owner is required.');
  // Use this same account mutex before any authoritative gateway read or
  // mutation. A webhook's preliminary ownership hint is never payment proof.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['doctarx-stripe-membership:' + userId]);
}
function assertConsumer(user, config) {
  if (user.market_scope !== 'US' || user.role !== 'patient') throw paymentError(403, 'US_PATIENT_CHECKOUT_REQUIRED', 'This Stripe membership checkout is available only to eligible US patient accounts.');
  if (!config.available || (!config.livemode && !user.is_test_account)) throw paymentError(503, 'STRIPE_MEMBERSHIP_UNAVAILABLE', 'Stripe membership checkout is not activated for this account and environment. No payment was collected.');
}
function validPlan(pricing, planKey, user, config) {
  const plan = pricing.subscriptions[planKey];
  if (!PLAN_ACCESS[planKey] || !plan || !Number.isSafeInteger(plan.amount) || plan.amount <= 0 || plan.currency !== 'usd' || !['month', 'year'].includes(plan.interval) ||
    (planKey === 'test' && (config.production || config.livemode || !user.is_test_account))) throw paymentError(400, 'MEMBERSHIP_PLAN_UNAVAILABLE', 'Select an eligible server-configured membership plan.');
  return plan;
}

async function readState(userId, pricing) {
  const user = await account(db, userId); const config = configuration();
  const result = await db.query(`SELECT s.* FROM subscriptions s WHERE s.user_id=$1 ORDER BY s.created_at DESC LIMIT 1`, [userId]);
  const recordedSubscription = result.rows[0] || null;
  // A cached users.access_level, redirect flag or legacy completed payment is
  // not a receipt. Recorded history remains visible without being promoted.
  const paid = await db.query(`SELECT s.*,p.metadata AS receipt_metadata FROM subscriptions s
    JOIN payments p ON p.subscription_id=s.id AND p.user_id=s.user_id
    WHERE s.user_id=$1 AND s.status='active' AND s.current_period_end>NOW()
      AND p.status='completed' AND p.amount>0 AND LOWER(p.currency)='usd'
      AND p.metadata->>'source'='stripe_verified_invoice'
      AND p.metadata->>'stripeSubscriptionId'=s.stripe_subscription_id
      AND p.metadata->>'livemode'=$2
      AND (p.metadata->>'periodEnd')::timestamptz>=s.current_period_end
    ORDER BY s.current_period_end DESC,p.created_at DESC LIMIT 1`, [userId, String(config.livemode)]);
  const verified = user.market_scope === 'US' && user.role === 'patient' && (config.livemode || (!config.production && user.is_test_account)) ? paid.rows[0] : null;
  const mapped = verified && PLAN_ACCESS[verified.receipt_metadata?.planKey];
  const active = mapped ? verified : null;
  let reason = null;
  if (user.market_scope !== 'US' || user.role !== 'patient') reason = 'US_PATIENT_CHECKOUT_REQUIRED';
  else if (!config.available || (!config.livemode && !user.is_test_account)) reason = 'STRIPE_MEMBERSHIP_UNAVAILABLE';
  else if (recordedSubscription?.stripe_subscription_id && recordedSubscription.status === 'active' && new Date(recordedSubscription.current_period_end) > new Date()) reason = active ? 'ALREADY_SUBSCRIBED' : 'MEMBERSHIP_RECONCILIATION_REQUIRED';
  const plans = user.market_scope === 'US' && user.role === 'patient' ? Object.entries(pricing.subscriptions).filter(([key]) => key !== 'test' && PLAN_ACCESS[key]).map(([id, plan]) =>
    ({ id, name: plan.name.replace(/^Docta\b/, 'DoctaRx'), price: plan.amount / 100, amount: plan.amount, currency: plan.currency, interval: plan.interval, features: [], checkoutAvailable: !reason })) : [];
  const testing = getTestingBypassState(user);
  const paymentEnvironment = active ? active.receipt_metadata.livemode === true ? 'live' : 'test' : null;
  return { success: true, subscription: active ? { ...active, receipt_metadata: undefined, plan_key: active.receipt_metadata.planKey, paymentVerified: true, verificationSource: 'stripe_verified_invoice', paymentEnvironment } : null, recordedSubscription,
    hasActiveSubscription: Boolean(active), paymentVerified: Boolean(active), verificationSource: active ? 'stripe_verified_invoice' : null, paymentEnvironment,
    accessLevel: testing.active ? testing.accessLevel : mapped?.accessLevel || 'read_only',
    accessSource: testing.active ? 'authorized_testing_access' : active ? 'verified_stripe_invoice' : 'no_verified_paid_membership',
    ...getTestingBypassPayload(user), capabilities: { market: user.market_scope, currency: user.market_scope === 'US' ? 'usd' : null,
      checkoutAvailable: !reason, billingPortalAvailable: Boolean(config.available && user.market_scope === 'US' && user.role === 'patient' && user.stripe_customer_id && (config.livemode || user.is_test_account)), reason }, plans };
}

async function assertCheckout(userId, planKey, pricing, { database = db, lock = false } = {}) {
  const user = await account(database, userId, { lock }); const config = configuration(); assertConsumer(user, config);
  const plan = validPlan(pricing, planKey, user, config);
  // Receipt and event tables must be deployed before any collectible session.
  const schema = await database.query("SELECT to_regclass('public.payments') AS payments,to_regclass('public.subscriptions') AS subscriptions,to_regclass('public.stripe_webhook_events') AS events,to_regclass('public.membership_cards') AS cards,to_regclass('public.audit_logs') AS audits");
  if (!['payments', 'subscriptions', 'events', 'cards', 'audits'].every(key => schema.rows[0]?.[key])) throw paymentError(503, 'MEMBERSHIP_SCHEMA_UNAVAILABLE', 'Membership payment recording is unavailable. No payment was collected.');
  const existing = await database.query("SELECT id FROM subscriptions WHERE user_id=$1 AND stripe_subscription_id IS NOT NULL AND status IN ('active','past_due') AND (current_period_end>NOW() OR status='past_due') LIMIT 1", [userId]);
  if (existing.rows.length) throw paymentError(409, 'EXISTING_STRIPE_SUBSCRIPTION', 'Manage or reconcile the existing Stripe subscription before starting another checkout.');
  return { user, config, plan };
}

function assertEnvironment(value, config) {
  if (typeof value?.livemode !== 'boolean' || value.livemode !== config.livemode) throw paymentError(400, 'STRIPE_ENVIRONMENT_MISMATCH', 'Stripe environment does not match this integration.');
}
async function retrieveEvidence(event, stripe, pricing, { ownershipOnly = false, database = db } = {}) {
  const config = configuration();
  if (!config.available) throw paymentError(503, 'STRIPE_MEMBERSHIP_UNAVAILABLE', 'Stripe membership verification is unavailable.');
  assertEnvironment(event, config);
  const object = event.data?.object;
  assertEnvironment(object, config);
  let subscriptionId;
  if (event.type.startsWith('customer.subscription.')) subscriptionId = object.id;
  else if (event.type.startsWith('checkout.session.')) {
    const session = await stripe.checkout.sessions.retrieve(object.id);
    assertEnvironment(session, config);
    if (session.metadata?.type !== 'subscription') return null;
    if (session.mode !== 'subscription') throw paymentError(400, 'INVALID_MEMBERSHIP_SESSION', 'Invalid membership checkout session.');
    subscriptionId = objectId(session.subscription);
  } else if (event.type.startsWith('invoice.')) subscriptionId = objectId(object.subscription || object.parent?.subscription_details?.subscription);
  else if (event.type.startsWith('subscription_schedule.')) subscriptionId = objectId(object.subscription);
  else if (event.type.startsWith('charge.')) {
    const charge = await stripe.charges.retrieve(event.type.startsWith('charge.dispute.') ? objectId(object.charge) : object.id);
    assertEnvironment(charge, config);
    if (!objectId(charge.invoice)) return null;
    const invoice = await stripe.invoices.retrieve(objectId(charge.invoice));
    subscriptionId = objectId(invoice.subscription || invoice.parent?.subscription_details?.subscription);
  }
  else return null;
  if (!subscriptionId) return null;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price.product', 'latest_invoice.payment_intent.latest_charge'] });
  assertEnvironment(subscription, config);
  const item = subscription.items?.data?.length === 1 && subscription.items.data[0];
  const price = item?.price;
  const product = price?.product;
  // Provider platform plans have a separate entitlement model; never infer a
  // patient Gold membership from their low/high price or shared metadata.
  if (typeof product === 'object' && product.metadata?.type === 'provider_subscription') return null;
  const userId = subscription.metadata?.userId; const planKey = subscription.metadata?.planKey;
  if (!userId || !planKey || (subscription.metadata?.type && subscription.metadata.type !== 'subscription')) throw paymentError(400, 'UNBOUND_MEMBERSHIP_SUBSCRIPTION', 'Membership subscription ownership and plan must be explicit.');
  if (ownershipOnly) return { userId };
  const user = await account(database, userId); assertConsumer(user, config); const plan = validPlan(pricing, planKey, user, config);
  if (user.stripe_customer_id !== objectId(subscription.customer)) throw paymentError(403, 'STRIPE_CUSTOMER_MISMATCH', 'Membership customer ownership does not match.');
  if (!item || item.quantity !== 1 || !price || price.unit_amount !== plan.amount || price.currency !== plan.currency || price.recurring?.interval !== plan.interval ||
    (price.recurring.interval_count || 1) !== 1 || typeof product !== 'object' || product.metadata?.type !== 'patient_subscription' ||
    ![plan.name, plan.name.replace(/^DoctaRx\b/, 'Docta')].includes(product.metadata?.planName))
    throw paymentError(400, 'STRIPE_PLAN_MISMATCH', 'Stripe membership price does not match the approved server plan.');
  const start = subscription.current_period_start || item.current_period_start;
  const end = subscription.current_period_end || item.current_period_end;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start || end - start > 367 * 86400) throw paymentError(400, 'INVALID_MEMBERSHIP_PERIOD', 'Stripe membership period is invalid.');
  let invoice = subscription.latest_invoice;
  if (typeof invoice === 'string') invoice = await stripe.invoices.retrieve(invoice, { expand: ['payment_intent'] });
  if (invoice) assertEnvironment(invoice, config);
  let paid = false;
  if (subscription.status === 'active' && invoice?.status === 'paid' && invoice.paid === true) {
    const invoiceSubscriptionId = objectId(invoice.subscription || invoice.parent?.subscription_details?.subscription);
    const intent = invoice.payment_intent;
    // Paid out of band, zero-value invoices and status-only events do not prove
    // card/bank collection. Approved Stripe discounts/taxes may alter the final
    // invoice amount; the underlying price must still match the server plan.
    const charge = typeof intent?.latest_charge === 'string' ? await stripe.charges.retrieve(intent.latest_charge) : intent?.latest_charge;
    paid = end * 1000 > Date.now() && start * 1000 <= Date.now() + 60000 && invoiceSubscriptionId === subscriptionId && objectId(invoice.customer) === user.stripe_customer_id && invoice.currency === plan.currency &&
      Number.isSafeInteger(invoice.amount_paid) && invoice.amount_paid > 0 && invoice.amount_paid === invoice.amount_due &&
      invoice.lines?.data?.some(line => objectId(line.price) === price.id && line.quantity === 1 && line.period?.end >= end && line.period?.start <= start) &&
      typeof intent === 'object' && intent?.status === 'succeeded' &&
      intent.amount_received === invoice.amount_paid && intent.currency === plan.currency && objectId(intent.customer) === user.stripe_customer_id && intent.livemode === config.livemode &&
      charge && charge.paid === true && charge.status === 'succeeded' && !charge.refunded && !charge.disputed && charge.amount_refunded === 0 && charge.livemode === config.livemode;
  }
  return { user, config, subscription, planKey, plan, start, end, invoice, paid };
}

const MEMBER_EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed', 'charge.refunded', 'charge.dispute.created', 'charge.dispute.closed', 'subscription_schedule.aborted', 'subscription_schedule.canceled']);
async function processMembershipEvent(event, stripe, pricing) {
  if (!MEMBER_EVENTS.has(event.type)) return false;
  // One-time checkout events retain their existing payment handlers.
  if (event.type.startsWith('checkout.session.') && event.data?.object?.metadata?.type !== 'subscription') return false;
  // This first fetch only locates the account mutex. Never carry paid status,
  // invoice, charge or subscription snapshots across the wait for that lock.
  const hint = await retrieveEvidence(event, stripe, pricing, { ownershipOnly: true });
  if (!hint) return !event.type.startsWith('charge.');
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    await lockFinancialAccount(client, hint.userId);
    const user = await account(client, hint.userId, { lock: true }); assertConsumer(user, configuration());
    const evidence = await retrieveEvidence(event, stripe, pricing, { database: client });
    if (!evidence || evidence.user.id !== user.id) throw paymentError(409, 'MEMBERSHIP_CONTEXT_CHANGED', 'Membership ownership changed; reconciliation is required.');
    assertConsumer(user, evidence.config);
    if (user.stripe_customer_id !== objectId(evidence.subscription.customer)) throw paymentError(403, 'STRIPE_CUSTOMER_MISMATCH', 'Membership customer ownership changed.');
    const ledger = await client.query(`INSERT INTO stripe_webhook_events (event_id,event_type) VALUES ($1,$2) ON CONFLICT(event_id) DO NOTHING RETURNING event_id`, [event.id, event.type]);
    if (!ledger.rows.length) { await client.query('COMMIT'); return true; }
    const current = await client.query('SELECT * FROM subscriptions WHERE stripe_subscription_id=$1 FOR UPDATE', [evidence.subscription.id]);
    if (current.rows.some(row => row.user_id !== user.id) || current.rows.length > 1) throw paymentError(409, 'MEMBERSHIP_OWNERSHIP_CONFLICT', 'Membership subscription records require reconciliation.');
    const canceled = evidence.subscription.status === 'canceled';
    const status = evidence.paid ? 'active' : canceled ? 'cancelled' : 'past_due';
    const mapped = PLAN_ACCESS[evidence.planKey];
    const params = [user.id, evidence.subscription.id, status, mapped.tier, new Date(evidence.start * 1000), new Date(evidence.end * 1000), user.stripe_customer_id, Boolean(evidence.subscription.cancel_at_period_end)];
    const stored = current.rows.length ? await client.query(`UPDATE subscriptions SET status=$3::subscription_status,tier=$4::subscription_tier,current_period_start=$5,current_period_end=$6,
      stripe_customer_id=$7,cancel_at_period_end=$8,cancelled_at=CASE WHEN $3::text='cancelled' THEN NOW() ELSE NULL END,updated_at=NOW()
      WHERE user_id=$1 AND stripe_subscription_id=$2 RETURNING *`, params) : await client.query(`INSERT INTO subscriptions
      (user_id,stripe_subscription_id,status,tier,current_period_start,current_period_end,stripe_customer_id,cancel_at_period_end)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, params);
    const subscription = stored.rows[0];
    if (!subscription) throw paymentError(409, 'MEMBERSHIP_WRITE_CONFLICT', 'Membership recording could not be confirmed.');
    if (evidence.paid) {
      const metadata = { source: 'stripe_verified_invoice', invoiceId: evidence.invoice.id, stripeSubscriptionId: evidence.subscription.id,
        planKey: evidence.planKey, priceId: evidence.subscription.items.data[0].price.id, livemode: evidence.config.livemode, periodEnd: new Date(evidence.end * 1000).toISOString() };
      await client.query(`INSERT INTO payments (user_id,subscription_id,type,status,amount,currency,stripe_payment_id,paid_at,metadata)
        SELECT $1,$2,'subscription','completed',$3,$4,$5,NOW(),$6::jsonb
        WHERE NOT EXISTS (SELECT 1 FROM payments WHERE user_id=$1 AND metadata->>'source'='stripe_verified_invoice' AND metadata->>'invoiceId'=$7 AND metadata->>'livemode'=$8)`,
      [user.id, subscription.id, evidence.invoice.amount_paid / 100, evidence.plan.currency, objectId(evidence.invoice.payment_intent), JSON.stringify(metadata), evidence.invoice.id, String(evidence.config.livemode)]);
      await client.query('UPDATE users SET access_level=$1,subscription_tier=$2 WHERE id=$3', [mapped.accessLevel, mapped.tier, user.id]);
      if (['gold', 'platinum'].includes(mapped.tier)) {
        const cardNumber = (mapped.tier === 'gold' ? 'DG-' : 'DP-') + user.id.replace(/-/g, '').toUpperCase().slice(0, 8) + '-' + user.id.replace(/-/g, '').toUpperCase().slice(-4);
        await client.query(`INSERT INTO membership_cards (user_id,tier,status,card_number,stripe_subscription_id,current_period_end)
          VALUES ($1,$2,'active',$3,$4,$5) ON CONFLICT(card_number) DO UPDATE SET tier=EXCLUDED.tier,status='active',
          stripe_subscription_id=EXCLUDED.stripe_subscription_id,current_period_end=EXCLUDED.current_period_end,suspended_at=NULL,revoked_at=NULL,updated_at=NOW()`,
        [user.id, mapped.tier, cardNumber, evidence.subscription.id, new Date(evidence.end * 1000)]);
      }
    } else {
      // Another independently paid membership may still be valid. Do not let
      // an old failed event revoke that current subscription's access.
      const other = await client.query(`SELECT s.id FROM subscriptions s JOIN payments p ON p.subscription_id=s.id AND p.user_id=s.user_id
        WHERE s.user_id=$1 AND s.id<>$2 AND s.status='active' AND s.current_period_end>NOW() AND p.status='completed'
          AND p.metadata->>'source'='stripe_verified_invoice' AND p.metadata->>'livemode'=$3 AND (p.metadata->>'periodEnd')::timestamptz>=s.current_period_end LIMIT 1`, [user.id, subscription.id, String(evidence.config.livemode)]);
      if (!other.rows.length) await client.query("UPDATE users SET access_level='read_only',subscription_tier='free' WHERE id=$1 AND access_level IN ('basic_monthly','gold_monthly','gold_yearly','platinum_monthly')", [user.id]);
      await client.query(`UPDATE membership_cards SET status=$1::text,suspended_at=CASE WHEN $1::text='suspended' THEN NOW() ELSE suspended_at END,
        revoked_at=CASE WHEN $1::text='revoked' THEN NOW() ELSE revoked_at END,updated_at=NOW() WHERE user_id=$2 AND stripe_subscription_id=$3`, [canceled ? 'revoked' : 'suspended', user.id, evidence.subscription.id]);
    }
    await client.query(`INSERT INTO audit_logs (user_id,action,resource_type,resource_id,description,new_values,phi_accessed,success)
      VALUES ($1,'update','subscription',$2,'Stripe subscription independently reconciled',$3::jsonb,FALSE,TRUE)`,
    [user.id, subscription.id, JSON.stringify({ source: 'stripe_verified_invoice', eventId: event.id, invoiceId: evidence.paid ? evidence.invoice.id : null,
      status, paymentVerified: evidence.paid, livemode: evidence.config.livemode })]);
    await client.query('COMMIT'); return true;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function processConsultationEvent(event, stripe, pricing) {
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type) || event.data?.object?.metadata?.type !== 'consultation') return false;
  const config = configuration();
  if (!config.available) throw paymentError(503, 'STRIPE_UNAVAILABLE', 'Stripe payment verification is unavailable.');
  assertEnvironment(event, config);
  const hint = await stripe.checkout.sessions.retrieve(event.data.object.id);
  assertEnvironment(hint, config);
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    await lockFinancialAccount(client, hint.metadata?.userId);
    const user = await account(client, hint.metadata?.userId, { lock: true }); assertConsumer(user, config);
    const session = await stripe.checkout.sessions.retrieve(event.data.object.id, { expand: ['payment_intent.latest_charge', 'line_items'] });
    assertEnvironment(session, config);
    if (session.metadata?.userId !== user.id) throw paymentError(409, 'PAYMENT_OWNER_CHANGED', 'Payment ownership changed; reconciliation is required.');
    const plan = pricing.consultations[session.metadata?.consultationType];
    const item = session.line_items?.data?.length === 1 && session.line_items.data[0];
    const intent = session.payment_intent;
    const charge = typeof intent?.latest_charge === 'string' ? await stripe.charges.retrieve(intent.latest_charge) : intent?.latest_charge;
    if (!plan || plan.amount <= 0 || item?.quantity !== 1 || item.price?.unit_amount !== plan.amount || item.price?.currency !== plan.currency ||
      session.mode !== 'payment' || objectId(session.customer) !== user.stripe_customer_id || session.currency !== plan.currency || session.amount_total !== plan.amount)
      throw paymentError(400, 'STRIPE_CONSULTATION_MISMATCH', 'Consultation checkout does not match the server price and owner.');
    if (session.status !== 'complete' || session.payment_status !== 'paid' || intent?.status !== 'succeeded' || intent.amount_received !== plan.amount ||
      intent.currency !== plan.currency || objectId(intent.customer) !== user.stripe_customer_id || intent.livemode !== config.livemode || !charge ||
      !charge.paid || charge.status !== 'succeeded' || charge.refunded || charge.disputed || charge.amount_refunded !== 0 || charge.livemode !== config.livemode) {
      await client.query('COMMIT'); return true;
    }
    const appointment = (await client.query(`SELECT a.id,a.payment_completed FROM appointments a JOIN users p ON p.id=a.provider_id
      WHERE a.id=$1 AND a.patient_id=$2 AND p.role='provider' AND p.market_scope='US' AND p.is_active=TRUE
        AND a.status NOT IN ('cancelled','completed','no_show') FOR UPDATE OF a`, [session.metadata.appointmentId, user.id])).rows[0];
    if (!appointment) throw paymentError(404, 'APPOINTMENT_NOT_FOUND', 'The payment appointment is unavailable for this patient.');
    const ledger = await client.query('INSERT INTO stripe_webhook_events (event_id,event_type) VALUES ($1,$2) ON CONFLICT(event_id) DO NOTHING RETURNING event_id', [event.id, event.type]);
    if (!ledger.rows.length) { await client.query('COMMIT'); return true; }
    let receipt = (await client.query("SELECT id FROM payments WHERE user_id=$1 AND stripe_payment_id=$2 AND metadata->>'source'='stripe_verified_checkout' LIMIT 1", [user.id, intent.id])).rows[0];
    if (!receipt) receipt = (await client.query(`INSERT INTO payments (user_id,appointment_id,type,status,amount,currency,stripe_payment_id,paid_at,metadata)
      VALUES ($1,$2,'pay_per_visit','completed',$3,$4,$5,NOW(),$6::jsonb) RETURNING id`, [user.id, appointment.id, plan.amount / 100, plan.currency, intent.id,
      JSON.stringify({ source: 'stripe_verified_checkout', sessionId: session.id, consultationType: session.metadata.consultationType, livemode: config.livemode })])).rows[0];
    if (!receipt) throw paymentError(503, 'PAYMENT_RECORDING_UNAVAILABLE', 'Payment recording requires reconciliation.');
    await client.query('UPDATE appointments SET payment_id=$1,payment_completed=TRUE,payment_required=FALSE,updated_at=NOW() WHERE id=$2 AND patient_id=$3', [receipt.id, appointment.id, user.id]);
    await client.query(`INSERT INTO audit_logs (user_id,action,resource_type,resource_id,description,new_values,phi_accessed,success)
      VALUES ($1,'update','payment',$2,'Hosted consultation payment independently verified',$3::jsonb,FALSE,TRUE)`, [user.id, receipt.id, JSON.stringify({ eventId: event.id, sessionId: session.id, livemode: config.livemode })]);
    await client.query('COMMIT'); return true;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function readAuthority(userId, { knownUser } = {}) {
  try { return { ...(await readState(userId, { subscriptions: {} })), financialAccessAvailable: true }; }
  catch (error) {
    if (error.statusCode && error.statusCode < 500) throw error;
    // Financial storage being unavailable must not block authenticated clinical
    // record reads or be interpreted as a paid entitlement. The supplied user
    // is a fresh server-authenticated row, never a request body or token claim.
    const testing = getTestingBypassState(knownUser || {});
    return { subscription: null, paymentVerified: false, hasActiveSubscription: false,
      accessLevel: testing.active ? testing.accessLevel : 'read_only', accessSource: testing.active ? 'authorized_testing_access' : 'financial_verification_unavailable',
      ...getTestingBypassPayload(knownUser || {}), financialAccessAvailable: false };
  }
}

async function appointmentFunding(patientId, appointmentId) {
  const user = await account(db, patientId);
  const appointment = (await db.query(`SELECT a.id FROM appointments a JOIN users p ON p.id=a.patient_id JOIN users c ON c.id=a.provider_id
    WHERE a.id=$1 AND a.patient_id=$2 AND p.role='patient' AND p.is_active=TRUE AND c.role='provider' AND c.is_active=TRUE
      AND p.market_scope=c.market_scope AND p.market_scope=$3`, [appointmentId, patientId, user.market_scope])).rows[0];
  if (!appointment) throw paymentError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found in this account and market.');
  const testing = getTestingBypassState(user);
  if (testing.active) return { covered: true, paymentVerified: false, source: 'authorized_testing_access' };
  const authority = await readAuthority(patientId, { knownUser: user });
  if (authority.paymentVerified) return { covered: true, paymentVerified: true, source: 'stripe_verified_invoice' };
  const config = configuration();
  if (user.market_scope === 'US') {
    const receipt = await db.query(`SELECT p.id FROM payments p JOIN appointments a ON a.payment_id=p.id
      WHERE a.id=$1 AND a.patient_id=$2 AND p.user_id=$2 AND p.appointment_id=a.id AND p.status='completed' AND p.amount>0
        AND LOWER(p.currency)='usd' AND p.metadata->>'source'='stripe_verified_checkout' AND p.metadata->>'livemode'=$3
        AND COALESCE(p.metadata->>'disputed','false')<>'true' LIMIT 1`, [appointmentId, patientId, String(config.livemode)]);
    if (receipt.rows.length && (config.livemode || (!config.production && user.is_test_account))) return { covered: true, paymentVerified: true, source: 'stripe_verified_checkout' };
  } else if (user.market_scope === 'NG') {
    const receipt = await db.query(`SELECT i.id,a.environment FROM ng_consultation_invoices i
      JOIN ng_consultation_payment_attempts a ON a.invoice_id=i.id JOIN ng_payment_ledger_entries l ON l.attempt_id=a.id AND l.invoice_id=i.id
      WHERE i.appointment_id=$1 AND i.patient_user_id=$2 AND i.status IN ('paid','refund_pending') AND a.status='confirmed' AND a.provider='paystack'
        AND l.entry_type='payment' AND l.amount_minor=i.amount_minor AND l.currency=i.currency AND l.external_reference=a.reference
        AND a.receipt_json->>'reference'=a.reference AND a.receipt_json->>'currency'=i.currency
        AND a.receipt_json->>'amountMinor'=i.amount_minor::text AND a.receipt_json->>'environment'=a.environment
        AND COALESCE(a.receipt_json->>'gatewayId','')<>'' AND NOT EXISTS (SELECT 1 FROM ng_payment_ledger_entries r WHERE r.attempt_id=a.id AND r.entry_type='refund') LIMIT 1`, [appointmentId, patientId]);
    const actual = receipt.rows[0]; const environment = /^sk_live_/.test(process.env.PAYSTACK_SECRET_KEY || '') ? 'live' : /^sk_test_/.test(process.env.PAYSTACK_SECRET_KEY || '') ? 'test' : null;
    if (actual && actual.environment === environment && (environment === 'live' || (!config.production && user.is_test_account))) return { covered: true, paymentVerified: true, source: 'paystack_verified_consultation' };
  }
  // Non-cash care requires an explicit current staff decision, never a raw
  // payment_required=false flag or insurance cache. The latest audited decision
  // may revoke approval; actor authority and market are rechecked at read time.
  const latestDecision = (await db.query(`SELECT a.new_values,staff.is_active AS staff_active,staff.market_scope AS staff_market,staff.role AS staff_role FROM audit_logs a LEFT JOIN users staff ON staff.id=a.user_id
    WHERE a.resource_type='appointment_funding' AND a.resource_id=$1 AND a.patient_id=$2 AND a.success=TRUE
    ORDER BY a.created_at DESC,a.id DESC LIMIT 1`, [appointmentId, patientId])).rows[0];
  const decision = latestDecision?.new_values;
  if (latestDecision?.staff_active === true && latestDecision.staff_market === user.market_scope && ['admin', 'super_admin'].includes(latestDecision.staff_role) &&
    decision?.coverageStatus === 'approved' && ['sponsored', 'trial', 'manual'].includes(decision.fundingSource) &&
    typeof decision.approvalReference === 'string' && decision.approvalReference.trim() && decision.approvalReference.length <= 200 &&
    Number.isFinite(Date.parse(decision.effectiveAt)) && Date.parse(decision.effectiveAt) <= Date.now() && Number.isFinite(Date.parse(decision.expiresAt)) && Date.parse(decision.expiresAt) > Date.now())
    return { covered: true, paymentVerified: false, source: 'staff_approved_' + decision.fundingSource };
  return { covered: false, paymentVerified: false, source: authority.financialAccessAvailable ? 'funding_not_verified' : 'financial_verification_unavailable' };
}

async function processConsultationAdjustment(event, stripe) {
  if (!['charge.refunded', 'charge.dispute.created', 'charge.dispute.closed'].includes(event.type)) return false;
  const config = configuration();
  if (!config.available) throw paymentError(503, 'STRIPE_UNAVAILABLE', 'Stripe payment verification is unavailable.');
  assertEnvironment(event, config);
  const chargeId = event.type.startsWith('charge.dispute.') ? objectId(event.data?.object?.charge) : event.data?.object?.id;
  const hint = await stripe.charges.retrieve(chargeId);
  assertEnvironment(hint, config);
  if (!objectId(hint.payment_intent)) return true;
  const owners = await db.query("SELECT DISTINCT user_id FROM payments WHERE stripe_payment_id=$1 AND metadata->>'source'='stripe_verified_checkout' AND metadata->>'livemode'=$2", [objectId(hint.payment_intent), String(config.livemode)]);
  if (!owners.rows.length) return true;
  if (owners.rows.length !== 1) throw paymentError(409, 'PAYMENT_RECONCILIATION_REQUIRED', 'Payment adjustment requires reconciliation.');
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    await lockFinancialAccount(client, owners.rows[0].user_id);
    const owner = await account(client, owners.rows[0].user_id, { lock: true }); assertConsumer(owner, config);
    const charge = await stripe.charges.retrieve(chargeId);
    assertEnvironment(charge, config);
    if (objectId(charge.payment_intent) !== objectId(hint.payment_intent)) throw paymentError(409, 'PAYMENT_CONTEXT_CHANGED', 'Payment adjustment context changed; reconciliation is required.');
    if (!charge.refunded && !charge.disputed && !(charge.amount_refunded > 0)) { await client.query('COMMIT'); return true; }
    const receipts = await client.query("SELECT * FROM payments WHERE stripe_payment_id=$1 AND metadata->>'source'='stripe_verified_checkout' AND metadata->>'livemode'=$2 FOR UPDATE", [objectId(charge.payment_intent), String(config.livemode)]);
    if (!receipts.rows.length) { await client.query('COMMIT'); return true; }
    if (receipts.rows.length !== 1) throw paymentError(409, 'PAYMENT_RECONCILIATION_REQUIRED', 'Payment adjustment requires reconciliation.');
    const receipt = receipts.rows[0];
    if (receipt.user_id !== owner.id) throw paymentError(409, 'PAYMENT_OWNER_CHANGED', 'Payment adjustment ownership changed; reconciliation is required.');
    if (objectId(charge.customer) !== owner.stripe_customer_id || charge.currency !== String(receipt.currency).toLowerCase()) throw paymentError(403, 'STRIPE_CUSTOMER_MISMATCH', 'Payment adjustment ownership or currency does not match.');
    const ledger = await client.query('INSERT INTO stripe_webhook_events (event_id,event_type) VALUES ($1,$2) ON CONFLICT(event_id) DO NOTHING RETURNING event_id', [event.id, event.type]);
    if (!ledger.rows.length) { await client.query('COMMIT'); return true; }
    await client.query("UPDATE payments SET status=CASE WHEN $2::boolean THEN 'refunded'::payment_status ELSE status END,refunded_at=CASE WHEN $2::boolean THEN NOW() ELSE refunded_at END,updated_at=NOW(),metadata=metadata||$3::jsonb WHERE id=$1", [receipt.id, Boolean(charge.refunded || charge.amount_refunded > 0),
      JSON.stringify({ adjustmentSource: 'stripe_verified_charge', chargeId: charge.id, disputed: Boolean(charge.disputed), amountRefundedMinor: charge.amount_refunded || 0 })]);
    await client.query('UPDATE appointments SET payment_completed=FALSE,payment_required=TRUE,updated_at=NOW() WHERE id=$1 AND patient_id=$2 AND payment_id=$3', [receipt.appointment_id, owner.id, receipt.id]);
    await client.query(`INSERT INTO audit_logs (user_id,action,resource_type,resource_id,description,new_values,phi_accessed,success)
      VALUES ($1,'update','payment',$2,'Hosted consultation refund or dispute independently verified',$3::jsonb,FALSE,TRUE)`, [owner.id, receipt.id, JSON.stringify({ eventId: event.id, source: 'stripe_verified_charge', chargeId: charge.id })]);
    await client.query('COMMIT'); return true;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

module.exports = { PLAN_ACCESS, configuration, account, lockFinancialAccount, assertConsumer, validPlan, readState, readAuthority, appointmentFunding, assertCheckout, processMembershipEvent, processConsultationEvent, processConsultationAdjustment, paymentError };
