'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('next/dist/build/swc');
const patientA = { id: 'patient-a', role: 'patient', marketScope: 'US', firstName: 'Account A', lastName: 'Member', subscriptionTier: 'platinum', accessLevel: 'gold_monthly' };
const patientB = { ...patientA, id: 'patient-b', firstName: 'Account B' };
const periodEnd = new Date(Date.now() + 10 * 86400000).toISOString();
const plan = { id: 'gold', name: 'DoctaRx Gold', price: 42.37, amount: 4237, currency: 'usd', interval: 'month', features: [], checkoutAvailable: true };
const historical = (user = patientA) => ({ id: 'history-a', user_id: user.id, tier: 'gold', status: 'active', current_period_end: periodEnd });
const verified = (user = patientA, extra = {}) => ({ ...historical(user), plan_key: 'gold', paymentVerified: true, verificationSource: 'stripe_verified_invoice', paymentEnvironment: 'live', cancel_at_period_end: false, ...extra });
const state = (user = patientA, extra = {}) => ({ success: true, subscription: null, recordedSubscription: null,
  hasActiveSubscription: false, paymentVerified: false, verificationSource: null, paymentEnvironment: null, accessLevel: 'read_only', accessSource: 'no_verified_paid_membership',
  testingBypassActive: false, testingBypassExpiresAt: null,
  capabilities: { market: user.marketScope, currency: user.marketScope === 'US' ? 'usd' : null, checkoutAvailable: user.marketScope === 'US', billingPortalAvailable: false, reason: null },
  plans: user.marketScope === 'US' ? [plan] : [], ...extra });
const activeState = (user = patientA, extra = {}) => state(user, { subscription: verified(user), hasActiveSubscription: true, paymentVerified: true,
  verificationSource: 'stripe_verified_invoice', paymentEnvironment: 'live', capabilities: { market: 'US', currency: 'usd', checkoutAvailable: false, billingPortalAvailable: true, reason: 'ALREADY_SUBSCRIBED' }, ...extra });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function compile(filename, dependencies = {}, globals = {}) {
  const absolute = path.resolve(__dirname, '../..', filename); const sourceModule = { exports: {} };
  const compiled = transformSync(fs.readFileSync(absolute, 'utf8'), { filename: absolute,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } }).code;
  vm.runInNewContext(compiled, { module: sourceModule, exports: sourceModule.exports, URL, AbortController, ...globals,
    require(name) { assert.ok(name in dependencies, 'Unexpected dependency: ' + name); return dependencies[name]; } });
  return sourceModule.exports;
}
const helpers = compile('lib/membershipWorkspace.js');
const MembershipCard = Symbol('MembershipCard');
function strings(value) { if (Array.isArray(value)) return value.map(strings).join(''); if (typeof value === 'string' || typeof value === 'number') return String(value); return value?.props ? strings(value.props.children) : ''; }
function harness(auth, api, query = '') {
  const slots = [], effects = [], redirects = []; let cursor = 0, dirty = false, tree;
  const react = {
    Suspense: Symbol('Suspense'),
    useState(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; dirty = true; }]; },
    useRef(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: { current: initial } }; return slots[index].value; },
    useEffect(callback, dependencies) { const index = cursor++; const previous = slots[index]; if (!previous || dependencies.some((value, offset) => value !== previous.dependencies[offset])) { const next = { dependencies, cleanup: null }; slots[index] = next; effects.push(() => { previous?.cleanup?.(); next.cleanup = callback(); }); } },
  };
  const dependencies = { react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'next/link': { __esModule: true, default: Symbol('Link') }, 'next/navigation': { useSearchParams: () => new URLSearchParams(query) },
    'lucide-react': new Proxy({}, { get: (_target, name) => Symbol(String(name)) }),
    '@/lib/api': { __esModule: true, default: api }, '@/lib/membershipWorkspace': helpers,
    '@/components/providers/AuthProvider': { useAuth: () => auth.value },
    '@/components/branding/PortalPageHeader': { __esModule: true, default: Symbol('PortalPageHeader') },
    '@/components/membership/MembershipCard': { __esModule: true, default: MembershipCard }, '@/components/ui/button': { Button: 'button' } };
  const Component = compile('components/membership/MembershipWorkspace.jsx', dependencies, { window: { location: { assign(url) { redirects.push(url); } } } }).SubscriptionContent;
  const view = {
    render(runEffects = true) { do { cursor = 0; dirty = false; tree = Component(); if (runEffects) for (const effect of effects.splice(0)) effect(); } while (runEffects && dirty); return tree; },
    find(type) { const rows = []; function walk(node) { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) { node.forEach(walk); return; } if (node.type === type) rows.push(node); walk(node.props?.children); } walk(tree); return rows; },
    text: () => JSON.stringify(tree),
    button(label) { return view.find('button').find(button => strings(button.props.children).includes(label)); },
    unmount() { for (const slot of slots) slot.cleanup?.(); }, redirects,
  };
  return view;
}
async function flush(view) { await new Promise(resolve => setImmediate(resolve)); view.render(); }
const actualRead = async () => ({ data: state() });

test('verified state requires owned, unexpired invoice evidence, never cached tier or legacy active history', () => {
  const result = helpers.readMembershipState(state(patientA, { recordedSubscription: historical() }), patientA);
  assert.equal(result.hasActiveSubscription, false); assert.equal(result.subscription, null);
  assert.equal(helpers.verifiedMembership(historical(), patientA), false);
  for (const extra of [{ paymentVerified: false }, { verificationSource: null }, { paymentEnvironment: null }, { user_id: patientB.id }, { current_period_end: '2001-01-01' }, { tier: 'platinum' }, { plan_key: 'unapproved' }, { status: 'past_due' }]) {
    assert.equal(helpers.verifiedMembership(verified(patientA, extra), patientA), false);
    assert.throws(() => helpers.readMembershipState(activeState(patientA, { subscription: verified(patientA, extra) }), patientA), /verification/);
  }
  assert.equal(helpers.readMembershipState(activeState(), patientA).hasActiveSubscription, true);
  assert.throws(() => helpers.readMembershipState(activeState(patientA, { paymentEnvironment: 'test' }), patientA), /verification/);
  assert.throws(() => helpers.readMembershipState(state(patientA, { paymentEnvironment: 'live' }), patientA), /verification/);
});

test('actual plans reject malformed amounts, duplicate keys, wrong market, and unconfirmed responses', () => {
  for (const extra of [{ success: false }, { success: 'true' }, { plans: null }, { recordedSubscription: historical(patientB) },
    { recordedSubscription: { ...historical(), status: 7 } }, { recordedSubscription: { ...historical(), tier: {} } }, { capabilities: { market: 'NG' } },
    { plans: [{ ...plan, amount: 0 }] }, { plans: [{ ...plan, price: 0 }] }, { plans: [{ ...plan, currency: 'ngn' }] },
    { plans: [{ ...plan, interval: 'forever' }] }, { plans: [{ ...plan, id: 'test' }] }, { plans: [plan, plan] }]) {
    assert.throws(() => helpers.readMembershipState(state(patientA, extra), patientA), /confirmed/);
  }
  const result = helpers.readMembershipState(state(), patientA);
  assert.equal(helpers.membershipPrice(result.plans[0]), '$42.37');
  assert.equal(helpers.canStartMembershipCheckout(result, patientA, 'gold'), true);
  assert.equal(helpers.canStartMembershipCheckout(result, { ...patientA, role: 'provider' }, 'gold'), false);
  assert.equal(helpers.canStartMembershipCheckout(result, { ...patientA, marketScope: 'NG' }, 'gold'), false);
  assert.equal(helpers.canStartMembershipCheckout(result, patientA, 'platinum'), false);
  assert.equal(helpers.canStartMembershipCheckout(helpers.readMembershipState(activeState(), patientA), patientA, 'gold'), false);
});

test('testing access is separate from paid evidence and expires without creating a membership card', () => {
  const testing = helpers.readMembershipState(state(patientA, { testingBypassActive: true, testingBypassExpiresAt: periodEnd, accessSource: 'authorized_testing_access' }), patientA);
  assert.equal(testing.testingBypassActive, true); assert.equal(testing.hasActiveSubscription, false);
  assert.equal(helpers.readMembershipState(state(patientA, { testingBypassActive: true, testingBypassExpiresAt: '2000-01-01' }), patientA).testingBypassActive, false);
  const both = helpers.readMembershipState(activeState(patientA, { testingBypassActive: true, testingBypassExpiresAt: periodEnd, accessSource: 'authorized_testing_access' }), patientA);
  assert.equal(both.hasActiveSubscription, true); assert.equal(both.testingBypassActive, true);
});

test('only successful HTTPS links at exact Stripe hosts can leave the page', () => {
  assert.equal(helpers.hostedMembershipUrl({ success: true, checkout: { url: 'https://checkout.stripe.com/c/pay/cs_test_123' } }, 'checkout'), 'https://checkout.stripe.com/c/pay/cs_test_123');
  assert.equal(helpers.hostedMembershipUrl({ success: true, url: 'https://billing.stripe.com/p/session/test' }, 'portal'), 'https://billing.stripe.com/p/session/test');
  for (const url of ['javascript:alert(1)', 'http://checkout.stripe.com/a', 'https://checkout.stripe.com.attacker.test/a', 'https://checkout.stripe.com@attacker.test/a', 'https://user:pass@checkout.stripe.com/a', 'https://checkout.stripe.com:444/a', '/checkout']) {
    assert.throws(() => helpers.hostedMembershipUrl({ success: true, checkout: { url } }, 'checkout'), /valid Stripe/);
  }
  assert.throws(() => helpers.hostedMembershipUrl({ success: false, url: 'https://billing.stripe.com/p/session/test' }, 'portal'), /valid Stripe/);
  assert.throws(() => helpers.hostedMembershipUrl({ success: 'true', url: 'https://billing.stripe.com/p/session/test' }, 'portal'), /valid Stripe/);
});

test('checkout query flags never promote paid status or fabricate benefits, prices or canceled-payment claims', async () => {
  for (const query of ['success=true', 'checkout=returned', 'cancelled=true', 'checkout=cancelled']) {
    const auth = { value: { user: patientA, loading: false } }; let writes = 0, refreshes = 0;
    auth.value.refreshUser = () => { refreshes++; };
    const view = harness(auth, { async get() { return { data: state(patientA, { recordedSubscription: historical() }) }; }, post() { writes++; } }, query);
    view.render(); await flush(view);
    assert.ok(view.text().includes('No verified paid membership')); assert.ok(view.text().includes('Recorded subscription history'));
    assert.equal(view.find(MembershipCard)[0].props.subscription, null);
    assert.equal(view.text().includes('Active · payment verified'), false); assert.equal(view.text().includes('No charges were made'), false);
    assert.equal(view.text().includes('Unlimited'), false); assert.equal(view.text().includes('24/7'), false); assert.equal(view.text().includes('$39.99'), false);
    assert.ok(view.text().includes('$42.37')); assert.equal(writes, 0); assert.equal(refreshes, 0);
  }
});

test('missing or unavailable membership never becomes a confirmed empty status, and read retry recovers', async () => {
  const auth = { value: { user: patientA, loading: false } }; let failed = true;
  const view = harness(auth, { async get() { if (failed) throw new Error('Membership read unavailable'); return { data: state() }; } });
  view.render(); assert.ok(view.text().includes('Loading your membership')); await flush(view);
  assert.ok(view.text().includes('Membership unavailable')); assert.equal(view.text().includes('No verified paid membership'), false);
  failed = false; view.button('Try again').props.onClick(); view.render(); await flush(view);
  assert.ok(view.text().includes('No verified paid membership')); assert.equal(view.text().includes('Membership unavailable'), false);
});

test('trusted patient auth gates reads and old account data hides before effect cleanup on context changes', async () => {
  for (const next of [{ user: patientB, loading: false }, { user: { ...patientA, role: 'provider' }, loading: false }, { user: { ...patientA, marketScope: 'NG' }, loading: false }, { user: patientA, loading: true }]) {
    const auth = { value: { user: patientA, loading: false } }; const view = harness(auth, { async get() { return { data: activeState() }; } });
    view.render(); await flush(view); assert.ok(view.text().includes('Active · payment verified'));
    auth.value = next; view.render(false); assert.equal(view.text().includes('Active · payment verified'), false); assert.equal(view.text().includes('history-a'), false);
  }
  for (const value of [{ user: patientA, loading: true }, { user: { ...patientA, role: 'provider' }, loading: false }]) {
    let reads = 0; const view = harness({ value }, { get() { reads++; return actualRead(); } }); view.render(); assert.equal(reads, 0);
  }
  const unknown = harness({ value: { user: { ...patientA, marketScope: undefined }, loading: false } }, { get() { throw new Error('Must not guess a billing market'); } });
  unknown.render(); assert.ok(unknown.text().includes('billing market could not be confirmed'));
});

test('late reads and returning to a prior context do not resurrect previous-account membership', async () => {
  const auth = { value: { user: patientA, loading: false } }; const reads = [];
  const view = harness(auth, { get(_url, options) { const read = { ...deferred(), options }; reads.push(read); return read.promise; } });
  view.render(); auth.value = { user: patientB, loading: false }; view.render(false);
  auth.value = { user: patientA, loading: false }; view.render(false);
  reads[0].resolve({ data: activeState() }); await flush(view);
  assert.equal(reads[0].options.signal.aborted, true); assert.equal(view.text().includes('Active · payment verified'), false);
  reads.at(-1).resolve({ data: state() }); await flush(view); assert.ok(view.text().includes('No verified paid membership'));
});

test('duplicate checkout is blocked synchronously and only the approved plan key is submitted', async () => {
  const auth = { value: { user: patientA, loading: false } }; const posts = [];
  const view = harness(auth, { get: actualRead, post(url, payload, options) { const request = { ...deferred(), url, payload, options }; posts.push(request); return request.promise; } });
  view.render(); await flush(view); const click = view.button('Continue to checkout').props.onClick;
  const first = click(); await click(); view.render(); assert.equal(posts.length, 1); assert.equal(posts[0].url, '/stripe/checkout/subscription');
  assert.deepEqual(JSON.parse(JSON.stringify(posts[0].payload)), { planKey: 'gold' }); assert.equal(view.button('Opening checkout').props.disabled, true);
  posts[0].resolve({ data: { success: true, checkout: { url: 'https://checkout.stripe.com/c/pay/cs_test_123' } } }); await first; await flush(view);
  assert.deepEqual(view.redirects, ['https://checkout.stripe.com/c/pay/cs_test_123']); assert.ok(view.text().includes('No verified paid membership'));
  await click(); assert.equal(posts.length, 1); assert.equal(view.button('Opening checkout').props.disabled, true, 'Controls remain pending through outgoing Stripe navigation.');
});

test('unconfirmed checkout links show an error and release controls for an actual retry', async () => {
  const auth = { value: { user: patientA, loading: false } }; let writes = 0;
  const view = harness(auth, { get: actualRead, async post() { writes++; return { data: { success: true, checkout: { url: 'https://unapproved.example/checkout' } } }; } });
  view.render(); await flush(view); await view.button('Continue to checkout').props.onClick(); await flush(view);
  assert.equal(view.redirects.length, 0); assert.ok(view.text().includes('valid Stripe link')); assert.equal(view.button('Continue to checkout').props.disabled, false);
  await view.button('Continue to checkout').props.onClick(); assert.equal(writes, 2);
});

test('billing portal uses only current eligible server capability and never locally changes a membership', async () => {
  const auth = { value: { user: patientA, loading: false } }; const posts = [];
  const view = harness(auth, { async get() { return { data: activeState() }; }, async post(url, payload) { posts.push({ url, payload }); return { data: { success: true, url: 'https://billing.stripe.com/p/session/confirmed' } }; } });
  view.render(); await flush(view); assert.equal(view.button('Continue to checkout').props.disabled, true);
  await view.button('Manage Stripe billing').props.onClick(); await flush(view);
  assert.equal(posts.length, 1); assert.equal(posts[0].url, '/stripe/billing-portal');
  assert.deepEqual(view.redirects, ['https://billing.stripe.com/p/session/confirmed']); assert.ok(view.text().includes('Active · payment verified'));
  assert.equal(view.button('Cancel membership'), undefined);
  const unavailable = harness(auth, { async get() { return { data: state() }; } }); unavailable.render(); await flush(unavailable);
  assert.equal(unavailable.button('Manage Stripe billing'), undefined);
});

test('refresh invalidates captured checkout callbacks before effects and rejects new disabled capability state', async () => {
  const auth = { value: { user: patientA, loading: false } }; let reads = 0, writes = 0;
  const view = harness(auth, { async get() { return { data: ++reads === 1 ? state() : state(patientA, { capabilities: { market: 'US', checkoutAvailable: false, billingPortalAvailable: false, reason: 'STRIPE_MEMBERSHIP_UNAVAILABLE' } }) }; }, post() { writes++; } });
  view.render(); await flush(view); const captured = view.button('Continue to checkout').props.onClick;
  view.button('Refresh membership').props.onClick(); await captured(); assert.equal(writes, 0); view.render(); await flush(view);
  await captured(); assert.equal(writes, 0); assert.equal(view.button('Continue to checkout').props.disabled, true);
});

test('old callbacks and late Stripe completions cannot redirect or release a new account action', async () => {
  const auth = { value: { user: patientA, loading: false } }; const posts = [];
  const view = harness(auth, { async get() { return { data: state(auth.value.user) }; }, post(_url, _payload, options) { const request = { ...deferred(), options }; posts.push(request); return request.promise; } });
  view.render(); await flush(view); const staleClick = view.button('Continue to checkout').props.onClick; const first = staleClick(); view.render();
  auth.value = { user: patientB, loading: false }; view.render(false); await staleClick(); assert.equal(posts.length, 1);
  await flush(view); await flush(view); const second = view.button('Continue to checkout').props.onClick(); view.render();
  posts[0].resolve({ data: { success: true, checkout: { url: 'https://checkout.stripe.com/c/pay/old' } } }); await first; await flush(view);
  assert.equal(posts[0].options.signal.aborted, true); assert.equal(view.redirects.length, 0); assert.equal(view.button('Opening checkout').props.disabled, true);
  posts[1].resolve({ data: { success: true, checkout: { url: 'https://checkout.stripe.com/c/pay/current' } } }); await second; await flush(view);
  assert.deepEqual(view.redirects, ['https://checkout.stripe.com/c/pay/current']);
});

test('unmount aborts a pending checkout and late responses never navigate', async () => {
  const auth = { value: { user: patientA, loading: false } }; const post = deferred(); let signal;
  const view = harness(auth, { get: actualRead, post(_url, _payload, options) { signal = options.signal; return post.promise; } });
  view.render(); await flush(view); const pending = view.button('Continue to checkout').props.onClick(); view.unmount();
  assert.equal(signal.aborted, true); post.resolve({ data: { success: true, checkout: { url: 'https://checkout.stripe.com/c/pay/late' } } }); await pending;
  assert.equal(view.redirects.length, 0);
});

test('NG and sponsored care remain separate from US Stripe plans without blanket clinical-access denial', async () => {
  const user = { ...patientA, marketScope: 'NG' }; const auth = { value: { user, loading: false } };
  const view = harness(auth, { async get() { return { data: state(user, { capabilities: { market: 'NG', checkoutAvailable: false, billingPortalAvailable: false, reason: 'US_PATIENT_CHECKOUT_REQUIRED' } }) }; } });
  view.render(); await flush(view); assert.ok(view.text().includes('No online membership plans are available'));
  assert.ok(view.text().includes('/ng/patient/consultation-billing')); assert.equal(view.button('Continue to checkout'), undefined);
  assert.equal(view.text().includes('Cannot book'), false); assert.equal(view.text().includes('No prescription access'), false);
});

test('verified Stripe sandbox memberships are explicitly test-mode rather than a live-charge claim', async () => {
  const auth = { value: { user: patientA, loading: false } };
  const view = harness(auth, { async get() { return { data: activeState(patientA, { paymentEnvironment: 'test', subscription: verified(patientA, { paymentEnvironment: 'test' }) }) }; } });
  view.render(); await flush(view);
  assert.ok(view.text().includes('Active · test payment verified')); assert.ok(view.text().includes('does not confirm a live charge'));
  assert.equal(view.text().includes('Active · payment verified'), false);
});

test('membership card requires actual current owned Gold or Platinum evidence and labels dates truthfully', () => {
  const React = require('react'); const { renderToStaticMarkup } = require('react-dom/server');
  const Card = compile('components/membership/MembershipCard.jsx', { 'react/jsx-runtime': require('react/jsx-runtime'), 'lucide-react': require('lucide-react'), '@/lib/membershipWorkspace': helpers }).default;
  for (const subscription of [null, historical(), verified(patientB), verified(patientA, { tier: 'unknown' }), verified(patientA, { tier: 'basic', plan_key: 'basic' })]) {
    assert.equal(renderToStaticMarkup(React.createElement(Card, { user: patientA, subscription })), '');
  }
  for (const tier of ['gold', 'platinum']) {
    const html = renderToStaticMarkup(React.createElement(Card, { user: patientA, subscription: verified(patientA, { tier, plan_key: tier, cancel_at_period_end: true }) }));
    assert.ok(html.includes(tier === 'gold' ? 'DoctaRx Gold' : 'DoctaRx Platinum')); assert.ok(html.includes('Payment verified'));
    assert.ok(html.includes('Current period ends')); assert.ok(html.includes('Cancels at period end'));
    assert.equal(html.includes('Renews'), false); assert.equal(html.includes('HIPAA'), false); assert.equal(html.includes('Card number'), false); assert.equal(html.includes('Unlimited'), false);
  }
  const sandbox = renderToStaticMarkup(React.createElement(Card, { user: patientA, subscription: verified(patientA, { paymentEnvironment: 'test' }) }));
  assert.ok(sandbox.includes('Test payment verified')); assert.ok(sandbox.includes('does not confirm a live charge'));
});
