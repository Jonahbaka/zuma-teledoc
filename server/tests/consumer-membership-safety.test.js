'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');

test('membership environment configuration and test plan guard never authorize production test billing', () => {
  const service = require('../services/consumerMembershipService');
  const previous = { NODE_ENV: process.env.NODE_ENV, STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET, NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL };
  try {
    Object.assign(process.env, { NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_test_isolated', STRIPE_WEBHOOK_SECRET: 'whsec_isolated', NEXT_PUBLIC_APP_URL: 'https://doctarx.example' });
    assert.equal(service.configuration().available, false);
    process.env.STRIPE_SECRET_KEY = 'sk_live_isolated'; assert.equal(service.configuration().available, true);
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_placeholder'; assert.equal(service.configuration().available, false); process.env.STRIPE_WEBHOOK_SECRET = 'whsec_isolated';
    process.env.NEXT_PUBLIC_APP_URL = 'http://doctarx.example'; assert.equal(service.configuration().available, false);
    assert.throws(() => service.validPlan({ subscriptions: { test: { amount: 100, currency: 'usd', interval: 'month' } } }, 'test', { is_test_account: true }, { production: true, livemode: true }), { code: 'MEMBERSHIP_PLAN_UNAVAILABLE' });
    assert.throws(() => service.assertConsumer({ is_active: true, role: 'patient', market_scope: 'NG' }, { available: true, livemode: true }), { code: 'US_PATIENT_CHECKOUT_REQUIRED' });
  } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

const target = process.env.SIMULATION_DATABASE_URL;
test('actual membership/Stripe/payment HTTP routes require verified collection and roll receipts, access, cards, audit and event replay back atomically', { skip: !target }, async () => {
  const url = new URL(target);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'), 'Only an isolated loopback test database is permitted');
  const { Pool } = require('pg'); const pool = new Pool({ connectionString: target }); const client = await pool.connect();
  const previous = Object.fromEntries(['NODE_ENV', 'DATABASE_URL', 'JWT_ACCESS_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'NEXT_PUBLIC_APP_URL'].map(key => [key, process.env[key]]));
  Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: target, JWT_ACCESS_SECRET: 'doctarx-isolated-membership-http-test-secret',
    STRIPE_SECRET_KEY: 'sk_test_isolated', STRIPE_WEBHOOK_SECRET: 'whsec_isolated', NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000' });
  const db = require('../db'); const oldQuery = db.query; const oldPool = db.getPool;
  let serial = 0; let failAudit = false; let failFinancialRead = false; let server;
  const routePool = { query(sql, parameters) {
    if (failFinancialRead && sql.includes('JOIN payments p ON p.subscription_id=s.id')) throw new Error('Isolated financial storage outage');
    return client.query(sql, parameters);
  }, async connect() {
    const point = 'membership_' + (++serial);
    return { async query(sql, params) {
      if (sql === 'BEGIN') return client.query('SAVEPOINT ' + point);
      if (sql === 'COMMIT') return client.query('RELEASE SAVEPOINT ' + point);
      if (sql === 'ROLLBACK') { await client.query('ROLLBACK TO SAVEPOINT ' + point); return client.query('RELEASE SAVEPOINT ' + point); }
      if (failAudit && sql.includes('INSERT INTO audit_logs')) throw new Error('Isolated injected audit failure');
      return client.query(sql, params);
    }, release() {} };
  } };
  const routes = ['../routes/stripe', '../routes/subscriptions', '../routes/membership', '../routes/payments', '../routes/auth', '../middleware/auth', '../services/stripeService'];
  const cache = new Map(routes.map(name => { const file = require.resolve(name); return [file, require.cache[file]]; }));
  const ops = require('../services/opsAlerts'); const oldNotify = ops.notifyStripeWebhookFailure;
  ops.notifyStripeWebhookFailure = async () => {}; // No external notifications in an isolated test.
  let restoreStripe;
  try {
    await client.query('BEGIN'); db.query = routePool.query; db.getPool = () => routePool;
    for (const file of cache.keys()) delete require.cache[file];
    const usId = crypto.randomUUID(); const providerId = crypto.randomUUID(); const staffId = crypto.randomUUID(); const ngControlId = crypto.randomUUID();
    const customerId = 'cus_isolated_' + crypto.randomUUID().replace(/-/g, '');
    // These disposable controls exist only inside this rollback transaction.
    // Existing product/demo accounts are never changed or reset.
    const password = 'Isolated123!'; const passwordHash = await require('bcryptjs').hash(password, 4);
    for (const [id, role, market = 'US'] of [[usId, 'patient'], [providerId, 'provider'], [staffId, 'admin'], [ngControlId, 'patient', 'NG']]) await client.query(`INSERT INTO users
      (id,email,password_hash,role,first_name,last_name,is_active,market_scope,region,country,is_test_account,provider_status,must_change_password,stripe_customer_id)
      VALUES ($1,$2,$3,$4,'Isolated','Billing test',TRUE,$5,$6,$7,TRUE,'approved',FALSE,$8)`,
    [id, 'membership-' + id + '@example.invalid', passwordHash, role, market, market, market, id === usId ? customerId : null]);
    const ngPatient = (await client.query("SELECT id FROM users WHERE email='patient@demo.doctarx.com' AND role='patient' AND market_scope='NG' AND is_active=TRUE")).rows[0];
    assert.ok(ngPatient, 'Reuse the existing provisioned NG patient');
    const stripeService = require('../services/stripeService'); const stripe = stripeService.stripe;
    const start = Math.floor(Date.now() / 1000) - 60; const end = start + 30 * 86400;
    const subId = 'sub_isolated_' + crypto.randomUUID().replace(/-/g, '');
    const priceId = 'price_isolated'; const plan = stripeService.PRICING.subscriptions.gold;
    let subscription = { id: subId, livemode: false, customer: customerId, status: 'active', cancel_at_period_end: false,
      metadata: { userId: usId, type: 'subscription', planKey: 'gold' }, current_period_start: start, current_period_end: end,
      items: { data: [{ quantity: 1, price: { id: priceId, unit_amount: plan.amount, currency: 'usd', recurring: { interval: 'month' },
        product: { id: 'prod_isolated', metadata: { type: 'patient_subscription', planName: plan.name } } } }] },
      latest_invoice: { id: 'in_isolated', livemode: false, customer: customerId, subscription: subId, status: 'paid', paid: true,
        currency: 'usd', amount_paid: plan.amount, amount_due: plan.amount,
        lines: { data: [{ price: { id: priceId }, quantity: 1, period: { start, end } }] },
        payment_intent: { id: 'pi_isolated', livemode: false, customer: customerId, status: 'succeeded', amount_received: plan.amount, currency: 'usd',
          latest_charge: { id: 'ch_isolated', invoice: 'in_isolated', livemode: false, paid: true, status: 'succeeded', refunded: false, disputed: false, amount_refunded: 0 } } } };
    const baseline = structuredClone(subscription);
    const consultationSession = appointmentId => ({ id: 'cs_consultation', livemode: false, mode: 'payment', status: 'complete', payment_status: 'paid', customer: customerId, currency: 'usd', amount_total: stripeService.PRICING.consultations.initial.amount,
      metadata: { type: 'consultation', consultationType: 'initial', userId: usId, appointmentId }, line_items: { data: [{ quantity: 1, price: { unit_amount: stripeService.PRICING.consultations.initial.amount, currency: 'usd' } }] },
      payment_intent: { ...structuredClone(baseline.latest_invoice.payment_intent), id: 'pi_consultation', amount_received: stripeService.PRICING.consultations.initial.amount,
        latest_charge: { ...structuredClone(baseline.latest_invoice.payment_intent.latest_charge), id: 'ch_consultation', invoice: null, payment_intent: 'pi_consultation', customer: customerId, currency: 'usd' } } });
    const calls = []; let checkout; let oneTimeSession; let checkoutOptions; let loseCheckoutResponse = true; let lockObserved = false; let subscriptionReadHook;
    const gatewaySessions = [];
    const replacements = [
      [stripe.subscriptions, 'retrieve', async id => { calls.push(['subscription.retrieve', id]); const snapshot = structuredClone(subscription); if (subscriptionReadHook) await subscriptionReadHook(snapshot); return snapshot; }],
      [stripe.subscriptions, 'update', async (id, data) => { calls.push(['subscription.update', id]); subscription = { ...subscription, ...data }; return structuredClone(subscription); }],
      [stripe.subscriptions, 'cancel', async id => { calls.push(['subscription.cancel', id]); subscription.status = 'canceled'; return structuredClone(subscription); }],
      [stripe.customers, 'retrieve', async id => { calls.push(['customer.retrieve', id]); return { id: customerId, livemode: false, metadata: { userId: usId } }; }],
      [stripe.customers, 'create', async () => { throw new Error('Unexpected customer creation'); }],
      [stripe.products, 'search', async () => ({ data: [{ id: 'prod_isolated' }] })],
      [stripe.prices, 'list', async () => ({ data: [{ id: priceId, unit_amount: plan.amount, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } }] })],
      [stripe.checkout.sessions, 'list', async () => ({ data: structuredClone(gatewaySessions), has_more: false })],
      [stripe.checkout.sessions, 'create', async (body, options) => {
        calls.push(['checkout.create']); checkout = body; checkoutOptions = options;
        const observer = await pool.connect();
        try {
          await observer.query('BEGIN');
          const same = (await observer.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired', ['doctarx-stripe-membership:' + usId])).rows[0];
          const other = (await observer.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired', ['doctarx-stripe-membership:' + crypto.randomUUID()])).rows[0];
          lockObserved = same.acquired === false && other.acquired === true;
        } finally { await observer.query('ROLLBACK'); observer.release(); }
        const session = { id: 'cs_isolated', url: 'https://checkout.stripe.com/c/pay/cs_isolated', mode: body.mode, status: 'open',
          customer: customerId, metadata: body.metadata, livemode: false, expires_at: Math.floor(Date.now() / 1000) + 3600 };
        gatewaySessions.push(session);
        if (loseCheckoutResponse) { loseCheckoutResponse = false; throw Object.assign(new Error('Isolated response loss after gateway session creation'), { type: 'StripeConnectionError' }); }
        return structuredClone(session);
      }],
      [stripe.checkout.sessions, 'retrieve', async () => structuredClone(oneTimeSession || { id: 'cs_isolated', livemode: false, mode: 'subscription', metadata: { type: 'subscription' }, subscription: subId })],
      [stripe.billingPortal.sessions, 'create', async body => { calls.push(['portal.create', body]); return { url: 'https://billing.stripe.com/p/session/isolated' }; }],
      [stripe.invoices, 'retrieve', async () => structuredClone(subscription.latest_invoice)],
      [stripe.charges, 'retrieve', async id => structuredClone(id === 'ch_consultation' ? oneTimeSession.payment_intent.latest_charge : subscription.latest_invoice.payment_intent.latest_charge)],
    ];
    const originals = replacements.map(([object, key]) => [object, key, object[key]]); replacements.forEach(([object, key, value]) => { object[key] = value; });
    restoreStripe = () => originals.forEach(([object, key, value]) => { object[key] = value; });
    const app = express(); app.use('/api/stripe/webhook', express.raw({ type: 'application/json' })); app.use(express.json());
    app.use('/api/auth', require('../routes/auth'));
    app.use('/api/stripe', require('../routes/stripe')); app.use('/api/subscriptions', require('../routes/subscriptions'));
    app.use('/api/membership', require('../routes/membership')); app.use('/api/payments', require('../routes/payments'));
    const { authenticate } = require('../middleware/auth'); const access = require('../middleware/accessControl');
    const telehealth = require('../services/telehealthSessionService');
    app.get('/api/funding/projection', authenticate, (req, res) => res.json({ accessLevel: req.user.accessLevel, paymentVerified: req.user.paymentVerified }));
    app.get('/api/funding/check', authenticate, access.requirePaidAccess, (_req, res) => res.json({ allowed: true }));
    app.get('/api/funding/record', authenticate, access.requirePrescriptionAccess, (_req, res) => res.json({ readable: true }));
    const booking = express.Router(); booking.post('/', access.requirePaidAccess, (_req, res) => res.json({ bookingAllowed: true })); app.use('/api/funding/booking', authenticate, booking);
    app.get('/api/funding/appointment/:id', authenticate, async (req, res) => {
      try { await telehealth.getAuthorizedVideoAppointment(req.params.id, req.user); return res.json({ allowed: true }); }
      catch (error) { return res.status(error.statusCode || error.status || 503).json({ error: 'Visit access could not be verified.' }); }
    });
    server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    async function request(path, { method = 'GET', body, userId = usId, headers = {} } = {}) {
      const auth = userId ? { Authorization: 'Bearer ' + jwt.sign({ userId }, process.env.JWT_ACCESS_SECRET, { expiresIn: '5m' }) } : {};
      const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/' + path, { method, headers: { ...auth, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
      return { status: response.status, headers: response.headers, body: await response.json() };
    }
    async function webhook(type, { eventId = 'evt_' + crypto.randomUUID().replace(/-/g, ''), object = structuredClone(subscription), live = false } = {}) {
      const payload = JSON.stringify({ id: eventId, type, livemode: live, data: { object } });
      const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
      return request('stripe/webhook', { method: 'POST', body: payload, userId: null, headers: { 'stripe-signature': signature } });
    }
    const counts = async () => (await client.query(`SELECT
      (SELECT count(*)::int FROM payments WHERE user_id=$1) AS payments,
      (SELECT count(*)::int FROM subscriptions WHERE user_id=$1) AS subscriptions,
      (SELECT count(*)::int FROM membership_cards WHERE user_id=$1) AS cards,
      (SELECT count(*)::int FROM audit_logs WHERE user_id=$1) AS audits`, [usId])).rows[0];
    const defer = () => { let resolve; const promise = new Promise(accept => { resolve = accept; }); return { promise, resolve }; };
    async function bounded(promise) {
      let timer;
      try { return await Promise.race([promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Financial interleaving did not reach its expected boundary')), 5000); })]); }
      finally { clearTimeout(timer); }
    }
    const ordering = { pauseNextConnect: null, onLockAttempt: null };
    // Each competing operation acquires its advisory mutex on a different real
    // PostgreSQL connection. Clinical/payment controls and mutations stay in
    // savepoints on the outer rollback transaction, leaving no retained rows.
    const orderingPool = { query: routePool.query, async connect() {
      const pause = ordering.pauseNextConnect; ordering.pauseNextConnect = null; if (pause) await pause();
      const mutex = await pool.connect(); const point = 'ordering_' + (++serial); let dataStarted = false;
      return { async query(sql, parameters) {
        if (sql === 'BEGIN') return mutex.query('BEGIN');
        if (sql === 'COMMIT' || sql === 'ROLLBACK') {
          if (dataStarted) {
            if (sql === 'ROLLBACK') await client.query('ROLLBACK TO SAVEPOINT ' + point);
            await client.query('RELEASE SAVEPOINT ' + point); dataStarted = false;
          }
          return mutex.query(sql);
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          if (ordering.onLockAttempt) ordering.onLockAttempt(mutex.processID);
          return mutex.query(sql, parameters);
        }
        if (!dataStarted) { await client.query('SAVEPOINT ' + point); dataStarted = true; }
        return client.query(sql, parameters);
      }, release() { mutex.release(); } };
    } };
    async function withOrdering(run) {
      const previousPool = db.getPool; db.getPool = () => orderingPool;
      try { await run(); }
      finally { db.getPool = previousPool; ordering.pauseNextConnect = null; ordering.onLockAttempt = null; subscriptionReadHook = null; }
    }
    for (const [id, market] of [[usId, 'US'], [ngControlId, 'NG']]) {
      const login = await request('auth/login', { method: 'POST', userId: null, body: { email: 'membership-' + id + '@example.invalid', password, role: 'patient' } });
      assert.equal(login.status, 200); assert.equal(login.body.user.marketScope, market);
      const me = await request('auth/me', { userId: id }); assert.equal(me.status, 200); assert.equal(me.body.user.marketScope, market);
    }
    const usersBefore = (await client.query('SELECT count(*)::int AS count FROM users')).rows[0].count;
    const registration = await request('auth/register', { method: 'POST', userId: null, body: { email: 'staff-escalation@example.invalid', password, confirmPassword: password,
      firstName: 'Isolated', lastName: 'Escalation control', role: 'admin', hipaaConsent: true, termsAccepted: true } });
    assert.equal(registration.status, 403); assert.equal(registration.body.code, 'PUBLIC_ROLE_NOT_ALLOWED');
    assert.equal((await client.query('SELECT count(*)::int AS count FROM users')).rows[0].count, usersBefore);
    assert.equal((await request('subscriptions/me', { userId: null })).status, 401);
    const empty = await request('subscriptions/me?success=true');
    assert.equal(empty.body.paymentVerified, false); assert.equal(empty.body.subscription, null); assert.equal(empty.body.hasActiveSubscription, false);
    assert.equal(empty.headers.get('cache-control'), 'private, no-store'); assert.ok(empty.body.plans.every(p => p.name.startsWith('DoctaRx') && p.features.length === 0 && p.id !== 'test'));
    assert.equal((await request('funding/check')).status, 403); assert.equal((await request('funding/record')).status, 200);
    assert.equal((await request('funding/booking', { method: 'POST', body: {} })).status, 200);
    failFinancialRead = true;
    assert.equal((await request('funding/record')).status, 200); assert.equal((await request('funding/check')).status, 503);
    assert.equal((await request('subscriptions/me')).status, 503); failFinancialRead = false;
    const before = await counts();
    for (const path of ['subscriptions', 'payments/pay-per-visit', 'payments/insurance-copay']) assert.equal((await request(path, { method: 'POST', body: { type: 'gold_monthly', paymentMethodId: 'invented', paymentReference: 'invented', amount: 1 } })).status, 503);
    assert.deepEqual(await counts(), before);
    assert.equal((await request('stripe/test-checkout/patient', { method: 'POST', body: {}, userId: null })).status, 401);
    assert.equal((await request('stripe/test-checkout/patient', { method: 'POST', body: {} })).status, 503);
    assert.equal((await request('stripe/checkout/subscription', { method: 'POST', body: { planKey: 'gold' }, userId: ngPatient.id })).status, 403);
    assert.equal((await request('stripe/checkout/subscription', { method: 'POST', body: { planKey: 'gold' }, userId: providerId })).status, 403);
    const ngState = await request('subscriptions/me', { userId: ngPatient.id }); assert.equal(ngState.status, 200); assert.deepEqual(ngState.body.plans, []); assert.equal(ngState.body.capabilities.checkoutAvailable, false);
    assert.equal((await request('stripe/billing-portal', { method: 'POST', body: {}, userId: ngPatient.id })).status, 403);
    await assert.rejects(stripeService.cancelSubscription(subId, true), { code: 'OWNER_SCOPED_CANCELLATION_REQUIRED' });
    assert.equal(calls.length, 0);
    process.env.NODE_ENV = 'production';
    assert.equal((await request('stripe/checkout/subscription', { method: 'POST', body: { planKey: 'test' } })).status, 503);
    process.env.NODE_ENV = 'test';
    await client.query('SAVEPOINT financial_ordering');
    try {
      await withOrdering(async () => {
        assert.equal((await webhook('customer.subscription.updated')).status, 200);
        assert.equal((await request('subscriptions/me')).body.paymentVerified, true);
        // An old paid event has already located its owner, then waits before
        // obtaining a connection. A refund commits first. Its fresh evidence
        // inside the mutex must prevent the delayed event restoring access.
        const paused = defer(); const resume = defer(); let delayed;
        ordering.pauseNextConnect = async () => { paused.resolve(); await resume.promise; };
        try {
          delayed = webhook('customer.subscription.updated'); await bounded(paused.promise);
          subscription.latest_invoice.payment_intent.latest_charge.refunded = true;
          subscription.latest_invoice.payment_intent.latest_charge.amount_refunded = plan.amount;
          assert.equal((await webhook('charge.refunded', { object: subscription.latest_invoice.payment_intent.latest_charge })).status, 200);
          assert.equal((await request('subscriptions/me')).body.paymentVerified, false);
          resume.resolve(); assert.equal((await delayed).status, 200);
          assert.equal((await client.query('SELECT status FROM subscriptions WHERE stripe_subscription_id=$1', [subId])).rows[0].status, 'past_due');
          assert.equal((await request('subscriptions/me')).body.paymentVerified, false);
          assert.equal((await request('membership/me')).body.card, null);
        } finally { resume.resolve(); if (delayed) await Promise.allSettled([delayed]); }

        subscription = structuredClone(baseline); await webhook('customer.subscription.updated');
        // Hold a paid event at its authoritative gateway read while it owns
        // the mutex. Cancellation must wait in PostgreSQL before calling the
        // gateway; after both finish, cancelled access cannot be overwritten.
        const reading = defer(); const finishRead = defer(); const attempted = defer(); let reads = 0; let oldEvent; let cancellation;
        subscriptionReadHook = async () => { if (++reads === 2) { reading.resolve(); await finishRead.promise; } };
        try {
          oldEvent = webhook('customer.subscription.updated'); await bounded(reading.promise);
          const cancellationsBefore = calls.filter(call => call[0] === 'subscription.cancel').length;
          ordering.onLockAttempt = pid => attempted.resolve(pid);
          cancellation = request('stripe/subscription/cancel', { method: 'POST', body: { immediately: true } });
          const waitingPid = await bounded(attempted.promise);
          let waiting = false;
          for (let attempt = 0; attempt < 50 && !waiting; attempt++) {
            waiting = (await pool.query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted) AS waiting", [waitingPid])).rows[0].waiting;
            if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
          }
          assert.equal(waiting, true, 'The competing cancellation must actually wait on the same PostgreSQL advisory mutex');
          assert.equal(calls.filter(call => call[0] === 'subscription.cancel').length, cancellationsBefore, 'No gateway cancellation is issued before owning the financial mutex');
          subscriptionReadHook = null; finishRead.resolve();
          assert.equal((await oldEvent).status, 200); const result = await cancellation; assert.equal(result.status, 200); assert.equal(result.body.subscription.status, 'cancelled');
          assert.equal((await request('subscriptions/me')).body.paymentVerified, false);
          assert.equal((await request('membership/me')).body.card, null);
        } finally { subscriptionReadHook = null; finishRead.resolve(); await Promise.allSettled([oldEvent, cancellation].filter(Boolean)); }

        // A delayed one-time success event likewise must not restore a visit
        // payment after a current dispute has invalidated its receipt.
        const visitId = crypto.randomUUID();
        await client.query("INSERT INTO appointments (id,patient_id,provider_id,scheduled_at,status,type,payment_required,payment_completed) VALUES ($1,$2,$3,NOW()+INTERVAL '1 day','scheduled','video',TRUE,FALSE)", [visitId, usId, providerId]);
        oneTimeSession = consultationSession(visitId);
        const object = { id: oneTimeSession.id, livemode: false, metadata: oneTimeSession.metadata };
        assert.equal((await webhook('checkout.session.completed', { object })).status, 200);
        const visitPaused = defer(); const visitResume = defer(); let oldPayment;
        ordering.onLockAttempt = null; ordering.pauseNextConnect = async () => { visitPaused.resolve(); await visitResume.promise; };
        try {
          oldPayment = webhook('checkout.session.completed', { object }); await bounded(visitPaused.promise);
          oneTimeSession.payment_intent.latest_charge.disputed = true;
          assert.equal((await webhook('charge.dispute.created', { object: { id: 'dp_consultation', livemode: false, charge: 'ch_consultation' } })).status, 200);
          visitResume.resolve(); assert.equal((await oldPayment).status, 200);
          assert.equal((await client.query('SELECT payment_completed FROM appointments WHERE id=$1', [visitId])).rows[0].payment_completed, false);
          const actual = await request('payments/appointment/' + visitId); assert.equal(actual.body.paymentVerified, false); assert.equal(actual.body.recordedPayment.metadata.disputed, true);
        } finally { visitResume.resolve(); if (oldPayment) await Promise.allSettled([oldPayment]); }
      });
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT financial_ordering'); await client.query('RELEASE SAVEPOINT financial_ordering');
      subscription = structuredClone(baseline); oneTimeSession = undefined;
    }
    const lost = await request('stripe/checkout/subscription', { method: 'POST', body: { planKey: 'gold', amount: 1, userId: ngPatient.id, currency: 'ngn' } });
    assert.equal(lost.status, 503); assert.equal(lockObserved, true); assert.equal(calls.filter(call => call[0] === 'checkout.create').length, 1);
    assert.ok(checkoutOptions.idempotencyKey.startsWith('doctarx-membership-'));
    assert.equal((await request('stripe/checkout/subscription', { method: 'POST', body: { planKey: 'goldYearly' } })).status, 409);
    const hosted = await request('stripe/checkout/subscription', { method: 'POST', body: { planKey: 'gold', amount: 1, userId: ngPatient.id, currency: 'ngn' } });
    assert.equal(hosted.status, 200); assert.equal(checkout.line_items[0].price, priceId); assert.equal(checkout.metadata.userId, usId);
    assert.equal(hosted.body.checkout.reused, true); assert.equal(calls.filter(call => call[0] === 'checkout.create').length, 1);
    gatewaySessions[0].status = 'complete'; gatewaySessions[0].subscription = subId;
    assert.equal((await request('stripe/checkout/subscription', { method: 'POST', body: { planKey: 'gold' } })).status, 409);
    gatewaySessions[0].status = 'open';
    assert.equal(checkout.metadata.expectedAmount, String(plan.amount)); assert.equal(checkout.metadata.currency, 'usd'); assert.equal(checkout.metadata.environment, 'test');
    assert.deepEqual(checkout.subscription_data.metadata, checkout.metadata); assert.ok(!checkout.success_url.includes('success=true'));
    assert.deepEqual(await counts(), before);
    assert.equal((await request('stripe/checkout/provider-subscription', { method: 'POST', body: { planKey: 'starter' }, userId: providerId })).status, 503);
    assert.equal((await request('stripe/checkout/credentialing', { method: 'POST', body: {}, userId: providerId })).status, 503);

    await client.query('SAVEPOINT unverified_history');
    const legacy = (await client.query("INSERT INTO subscriptions (user_id,tier,status,current_period_end) VALUES ($1,'gold','active',NOW()+INTERVAL '30 days') RETURNING id", [usId])).rows[0];
    await client.query("INSERT INTO payments (user_id,subscription_id,type,status,amount,currency,metadata) VALUES ($1,$2,'subscription','completed',39.99,'USD','{}'::jsonb)", [usId, legacy.id]);
    await client.query("UPDATE users SET access_level='gold_monthly' WHERE id=$1", [usId]);
    const unverified = await request('subscriptions/me?success=true');
    assert.equal(unverified.body.recordedSubscription.id, legacy.id); assert.equal(unverified.body.hasActiveSubscription, false);
    assert.equal(unverified.body.paymentVerified, false); assert.equal(unverified.body.accessLevel, 'read_only');
    assert.deepEqual((await request('funding/projection')).body, { accessLevel: 'read_only', paymentVerified: false });
    assert.equal((await request('funding/check')).status, 403);
    assert.equal((await request('membership/me')).body.card, null);
    await client.query('ROLLBACK TO SAVEPOINT unverified_history'); await client.query('RELEASE SAVEPOINT unverified_history');

    for (const change of [
      sub => { sub.metadata.userId = ngPatient.id; }, sub => { sub.customer = 'cus_foreign'; }, sub => { sub.items.data[0].price.unit_amount = 1; },
      sub => { sub.items.data[0].price.currency = 'ngn'; }, sub => { sub.metadata.planKey = 'invented'; }, sub => { sub.livemode = true; },
    ]) {
      subscription = structuredClone(baseline); change(subscription);
      assert.equal((await webhook('customer.subscription.updated')).status, 400); assert.deepEqual(await counts(), before);
    }
    subscription = structuredClone(baseline);
    assert.equal((await webhook('customer.subscription.updated', { live: true })).status, 400); assert.deepEqual(await counts(), before);
    assert.equal((await request('stripe/webhook', { method: 'POST', userId: null, body: '{}', headers: { 'stripe-signature': 'invalid' } })).status, 400);
    const retryId = 'evt_retry_' + crypto.randomUUID().replace(/-/g, ''); failAudit = true;
    assert.equal((await webhook('customer.subscription.updated', { eventId: retryId })).status, 503); assert.deepEqual(await counts(), before);
    assert.equal((await client.query('SELECT 1 FROM stripe_webhook_events WHERE event_id=$1', [retryId])).rows.length, 0);
    failAudit = false;
    assert.equal((await webhook('customer.subscription.updated', { eventId: retryId })).status, 200);
    const afterPaid = await counts(); assert.equal(afterPaid.payments, 1); assert.equal(afterPaid.subscriptions, 1); assert.equal(afterPaid.cards, 1); assert.equal(afterPaid.audits, before.audits + 1);
    assert.equal((await webhook('customer.subscription.updated', { eventId: retryId })).status, 200); assert.deepEqual(await counts(), afterPaid);
    assert.equal((await webhook('invoice.paid', { object: subscription.latest_invoice })).status, 200); assert.equal((await counts()).payments, 1);
    const verified = await request('subscriptions/me'); assert.equal(verified.body.paymentVerified, true); assert.equal(verified.body.verificationSource, 'stripe_verified_invoice'); assert.equal(verified.body.paymentEnvironment, 'test');
    assert.equal(verified.body.subscription.plan_key, 'gold'); assert.equal(verified.body.hasActiveSubscription, true); assert.equal(verified.body.capabilities.checkoutAvailable, false);
    const card = await request('membership/me'); assert.equal(card.body.card.status, 'active'); assert.equal(card.body.paymentVerified, true);
    assert.equal((await request('stripe/checkout/subscription', { method: 'POST', body: { planKey: 'gold' } })).status, 409);
    assert.equal((await request('stripe/billing-portal', { method: 'POST', body: {} })).status, 200);
    const renewal = await request('subscriptions/me', { method: 'PATCH', body: { cancelAtPeriodEnd: true } }); assert.equal(renewal.status, 200); assert.equal(renewal.body.subscription.cancel_at_period_end, true);
    assert.equal((await request('subscriptions/me')).body.paymentVerified, true);
    assert.equal((await request('subscriptions/me', { method: 'PATCH', body: { autoRenew: true, cancelAtPeriodEnd: true } })).status, 400);


    // A stale event is reconciled against the current retrieved invoice, not
    // the event's old status. Refunds remove current financial entitlement.
    subscription.latest_invoice.payment_intent.latest_charge.refunded = true;
    subscription.latest_invoice.payment_intent.latest_charge.amount_refunded = plan.amount;
    assert.equal((await webhook('charge.refunded', { object: subscription.latest_invoice.payment_intent.latest_charge })).status, 200);
    assert.equal((await request('subscriptions/me?success=true')).body.paymentVerified, false);
    assert.equal((await request('membership/me')).body.card, null);
    assert.equal((await client.query('SELECT access_level FROM users WHERE id=$1', [usId])).rows[0].access_level, 'read_only');
    subscription = structuredClone(baseline); subscription.latest_invoice.paid = false; subscription.latest_invoice.status = 'open';
    assert.equal((await webhook('customer.subscription.updated')).status, 200); assert.equal((await request('subscriptions/me')).body.paymentVerified, false);
    subscription = structuredClone(baseline);
    assert.equal((await webhook('customer.subscription.updated')).status, 200);
    const canceled = await request('stripe/subscription/cancel', { method: 'POST', body: { immediately: true } });
    assert.equal(canceled.status, 200); assert.equal(canceled.body.subscription.status, 'cancelled'); assert.equal((await request('subscriptions/me')).body.paymentVerified, false);
    assert.equal((await client.query('SELECT access_level FROM users WHERE id=$1', [usId])).rows[0].access_level, 'read_only');

    const appointmentId = crypto.randomUUID();
    await client.query("INSERT INTO appointments (id,patient_id,provider_id,scheduled_at,status,type,payment_required,payment_completed) VALUES ($1,$2,$3,NOW()+INTERVAL '1 day','scheduled','video',FALSE,TRUE)", [appointmentId, usId, providerId]);
    // Historical free/paid flags cannot bypass receipt verification. Existing
    // non-cash care needs an explicit, current and auditable staff decision.
    assert.equal((await request('funding/appointment/' + appointmentId)).status, 402);
    const decision = { coverageStatus: 'approved', fundingSource: 'sponsored', approvalReference: 'ISOLATED-STAFF-DECISION',
      effectiveAt: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() };
    await client.query(`INSERT INTO audit_logs (user_id,action,resource_type,resource_id,patient_id,description,new_values,phi_accessed,success)
      VALUES ($1,'create','appointment_funding',$2,$3,'Isolated staff coverage control',$4::jsonb,FALSE,TRUE)`, [staffId, appointmentId, usId, JSON.stringify(decision)]);
    assert.equal((await request('funding/appointment/' + appointmentId)).status, 200);
    assert.equal((await request('subscriptions/me')).body.paymentVerified, false);
    await client.query('UPDATE users SET is_active=FALSE WHERE id=$1', [staffId]);
    assert.equal((await request('funding/appointment/' + appointmentId)).status, 402);
    await client.query('UPDATE users SET is_active=TRUE WHERE id=$1', [staffId]);
    await client.query(`INSERT INTO audit_logs (user_id,action,resource_type,resource_id,patient_id,description,new_values,phi_accessed,success,created_at)
      VALUES ($1,'update','appointment_funding',$2,$3,'Isolated expired coverage control',$4::jsonb,FALSE,TRUE,$5)`,
    [staffId, appointmentId, usId, JSON.stringify({ ...decision, expiresAt: new Date(Date.now() - 1000).toISOString() }), new Date(Date.now() + 1000)]);
    assert.equal((await request('funding/appointment/' + appointmentId)).status, 402);
    await client.query("UPDATE users SET testing_bypass_active=TRUE,testing_bypass_expires_at=NOW()+INTERVAL '1 hour',testing_bypass_tier='gold' WHERE id=$1", [usId]);
    assert.equal((await request('funding/appointment/' + appointmentId)).status, 200);
    const testingAccess = await request('subscriptions/me'); assert.equal(testingAccess.body.accessSource, 'authorized_testing_access'); assert.equal(testingAccess.body.paymentVerified, false);
    await client.query('UPDATE users SET testing_bypass_active=FALSE WHERE id=$1', [usId]);
    oneTimeSession = consultationSession(appointmentId);
    const consultationEvent = { id: oneTimeSession.id, livemode: false, metadata: oneTimeSession.metadata };
    assert.equal((await webhook('checkout.session.completed', { object: consultationEvent })).status, 200);
    const paidAppointment = (await client.query('SELECT a.payment_completed,a.payment_id,p.id,p.stripe_payment_id FROM appointments a JOIN payments p ON p.id=a.payment_id WHERE a.id=$1', [appointmentId])).rows[0];
    assert.equal(paidAppointment.payment_completed, true); assert.equal(paidAppointment.payment_id, paidAppointment.id); assert.equal(paidAppointment.stripe_payment_id, 'pi_consultation');
    assert.equal((await request('funding/appointment/' + appointmentId)).status, 200);
    oneTimeSession.payment_intent.latest_charge.disputed = true;
    assert.equal((await webhook('charge.dispute.created', { object: { id: 'dp_consultation', livemode: false, charge: 'ch_consultation' } })).status, 200);
    const disputed = await request('payments/appointment/' + appointmentId); assert.equal(disputed.body.paymentVerified, false);
    assert.equal(disputed.body.recordedPayment.status, 'completed'); assert.equal(disputed.body.recordedPayment.metadata.disputed, true); assert.equal(disputed.body.recordedPayment.refundedAt, null);
    oneTimeSession.payment_intent.latest_charge.disputed = false;
    oneTimeSession.payment_intent.latest_charge.refunded = true; oneTimeSession.payment_intent.latest_charge.amount_refunded = stripeService.PRICING.consultations.initial.amount;
    assert.equal((await webhook('charge.refunded', { object: oneTimeSession.payment_intent.latest_charge })).status, 200);
    assert.equal((await request('funding/appointment/' + appointmentId)).status, 402);
    const refunded = await request('payments/appointment/' + appointmentId); assert.equal(refunded.body.paymentVerified, false); assert.equal(refunded.body.paymentCompleted, false); assert.equal(refunded.body.recordedPayment.status, 'refunded');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve)); if (restoreStripe) restoreStripe();
    db.query = oldQuery; db.getPool = oldPool; ops.notifyStripeWebhookFailure = oldNotify;
    for (const [file, cached] of cache) { if (cached) require.cache[file] = cached; else delete require.cache[file]; }
    await client.query('ROLLBACK'); client.release(); await pool.end();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
