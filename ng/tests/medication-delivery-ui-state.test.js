'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('next/dist/build/swc');

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function compile(file, dependencies, globals = {}) {
  const filename = path.resolve(__dirname, '../..', file); const sourceModule = { exports: {} };
  const compiled = transformSync(fs.readFileSync(filename, 'utf8'), { filename, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } }).code;
  vm.runInNewContext(compiled, { module: sourceModule, exports: sourceModule.exports, AbortController, Map, Date, setInterval: () => 1, clearInterval() {}, ...globals, require(name) { assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; } });
  return sourceModule.exports;
}
function stateHarness() {
  const slots = [], effects = []; let cursor = 0, dirty = false;
  const equal = (next, before) => before && next.every((item, index) => item === before[index]);
  const react = {
    useState(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; dirty = true; }]; },
    useRef(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: { current: initial } }; return slots[index].value; },
    useEffect(callback, dependencies) { const index = cursor++; const previous = slots[index]; if (!equal(dependencies, previous?.dependencies)) { const next = { dependencies }; slots[index] = next; effects.push(() => { previous?.cleanup?.(); next.cleanup = callback(); }); } },
    useCallback(callback, dependencies) { const index = cursor++; if (!equal(dependencies, slots[index]?.dependencies)) slots[index] = { dependencies, value: callback }; return slots[index].value; },
  };
  return { react, render(callback) { let result; do { cursor = 0; dirty = false; result = callback(); for (const effect of effects.splice(0)) effect(); } while (dirty); return result; }, unmount() { for (const slot of slots) slot.cleanup?.(); } };
}
async function flush() { await new Promise(resolve => setImmediate(resolve)); }
function checkout(extra = {}) {
  return { orderId: 'owned-order', orderNumber: 'RX-001', version: 2, status: 'ready_for_pickup', pharmacy: { id: 'approved-pharmacy', name: 'Approved pharmacy' }, deliveryType: 'delivery', checkout: { enabled: true },
    items: [], pricing: { currency: 'NGN', medicinesMinor: 900000, courierMinor: 280000, managementMinor: 75000, coordinationMinor: 0, taxMinor: 0, patientTotalMinor: 1255000, insurerTotalMinor: 0, totalMinor: 1255000 },
    quote: { id: 'approved-quote', provider: 'uber_direct', fareMinor: 280000, expiresAt: '2099-01-01T00:00:00.000Z' }, payment: { medicines: { status: 'verified', amountMinor: 900000 }, delivery: { status: 'unpaid', amountMinor: 355000 } },
    actions: { canChoose: false, canApproveMedicines: false, canPayMedicines: false, canRequestQuote: true, canApproveQuote: true, canPayDelivery: true, canDispatch: false, canCancel: false, canMarkCollected: false }, ...extra };
}
function hookHarness(api) {
  const state = stateHarness(), redirects = []; let orderId = 'owned-order', latest, keys = 0;
  const helpers = { getMedicationCheckout: api.get, mutateMedicationCheckout: api.post, deliveryError: error => error.message, requestKey: () => `unique-${++keys}`, hostedMedicationPaymentUrl: data => data.authorizationUrl };
  const useCheckout = compile('components/ng/delivery/useMedicationCheckout.js', { react: state.react, '@/lib/ngDeliveryApi': helpers }, { window: { location: { assign(url) { redirects.push(url); } } } }).default;
  const render = () => (latest = state.render(() => useCheckout(orderId, null)));
  return { render, get current() { return latest; }, change(id) { orderId = id; return render(); }, unmount: state.unmount, redirects };
}

test('payment and approval cannot fire until the checkout read has completed', async () => {
  const pending = deferred(); let writes = 0;
  const view = hookHarness({ get: () => pending.promise, post() { writes++; } });
  view.render(); assert.equal(await view.current.mutate('pay', { stage: 'medicines' }), false); assert.equal(writes, 0);
  pending.resolve(checkout()); await flush(); assert.equal(view.render().checkout.orderId, 'owned-order'); view.unmount();
});

test('concurrent double clicks send once; uncertain failures reuse the same idempotency key', async () => {
  const writes = []; let pending = deferred();
  const view = hookHarness({ get: async () => checkout(), post: (...args) => { writes.push(args); return pending.promise; } });
  view.render(); await flush(); view.render();
  const first = view.current.mutate('approve', { stage: 'delivery', quoteId: 'approved-quote', consent: true });
  assert.equal(await view.current.mutate('approve', { stage: 'delivery', quoteId: 'approved-quote', consent: true }), false);
  assert.equal(writes.length, 1); pending.reject(new Error('Provider timeout')); await first; view.render();
  assert.equal(view.current.error, 'Provider timeout'); pending = deferred();
  const retry = view.current.mutate('approve', { stage: 'delivery', quoteId: 'approved-quote', consent: true });
  assert.equal(writes[0][3].idempotencyKey, writes[1][3].idempotencyKey); assert.equal(writes[1][3].version, 2);
  pending.resolve(checkout({ version: 3 })); assert.equal(await retry, true); assert.equal(view.render().checkout.version, 3); view.unmount();
});

test('account or order teardown aborts pending requests and prevents late checkout navigation', async () => {
  const payment = deferred(); let signal;
  const view = hookHarness({ get: async () => checkout(), post: (...args) => { signal = args[4]; return payment.promise; } });
  view.render(); await flush(); view.render();
  const write = view.current.mutate('pay', { stage: 'delivery' }); view.unmount();
  payment.resolve({ authorizationUrl: 'https://checkout.paystack.com/approved' });
  assert.equal(await write, false); assert.equal(signal.aborted, true); assert.equal(view.redirects.length, 0);
});

test('a late old order read cannot replace the newly selected order', async () => {
  const reads = [];
  const view = hookHarness({ get: (orderId, _pharmacy, signal) => { const row = { ...deferred(), orderId, signal }; reads.push(row); return row.promise; }, post() {} });
  view.render(); view.change('new-order'); assert.equal(reads[0].signal.aborted, true);
  reads[0].resolve(checkout()); reads[1].resolve(checkout({ orderId: 'new-order' }));
  await flush(); assert.equal(view.render().checkout.orderId, 'new-order'); view.unmount();
});

function pageHarness(checkoutValue, file = 'MedicationCheckout') {
  const state = stateHarness(), writes = []; let tree;
  const helpers = { deliveryDate: value => value || 'Not confirmed', formatKobo: value => String(value), quoteIsCurrent: quote => Boolean(quote && quote.expired !== true && Date.parse(quote.expiresAt) > Date.now()), statusLabel: value => value || 'Not confirmed' };
  const dependencies = { react: state.react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'next/link': { __esModule: true, default: 'link' }, 'lucide-react': new Proxy({}, { get: (_value, name) => String(name) }),
    '@/components/ui/button': { Button: 'button' }, '@/lib/ngDeliveryApi': helpers,
    './useMedicationCheckout': { __esModule: true, default: () => ({ checkout: checkoutValue, loading: false, busy: false, error: '', notice: '', load() {}, mutate: (...args) => writes.push(args) }) },
    './MedicationPriceBreakdown': { __esModule: true, default: 'prices' }, './DeliveryPresentation': new Proxy({}, { get: (_value, name) => String(name) }) };
  const Component = compile(`components/ng/delivery/${file}.jsx`, dependencies).default;
  const find = type => { const result = []; function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; if (node.type === type) result.push(node); walk(node.props?.children); } walk(tree); return result; };
  const text = node => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' ? node : node?.props ? text(node.props.children) : '';
  return { render() { tree = state.render(() => Component({ orderId: 'owned-order', pharmacyId: 'approved-pharmacy' })); }, button(label) { return find('button').find(button => text(button.props.children).includes(label)); }, writes, unmount: state.unmount };
}

test('expired quote cannot render delivery approval, payment or dispatch buttons', () => {
  const value = checkout({ quote: { ...checkout().quote, expiresAt: '2000-01-01T00:00:00.000Z' }, actions: { ...checkout().actions, canDispatch: true } });
  const patient = pageHarness(value); patient.render(); assert.equal(patient.button('Approve this delivery quote'), undefined); assert.equal(patient.button('Pay approved delivery amount'), undefined); assert.ok(patient.button('Get a fresh approved quote')); patient.unmount();
  const pharmacy = pageHarness(value, 'PharmacyMedicationOrder'); pharmacy.render(); assert.equal(pharmacy.button('Book approved courier'), undefined); pharmacy.unmount();
});

test('fresh quote payment uses explicit delivery stage and never automatically dispatches', () => {
  const view = pageHarness(checkout()); view.render(); view.button('Pay approved delivery amount').props.onClick();
  assert.equal(view.writes.length, 1); assert.equal(view.writes[0][0], 'pay'); assert.equal(view.writes[0][1].stage, 'delivery'); view.unmount();
});

test('disabled merchant checkout exposes no medicine or delivery payment action', () => {
  const value = checkout({ checkout: { enabled: false }, actions: { ...checkout().actions, canPayMedicines: false, canPayDelivery: false } });
  const view = pageHarness(value); view.render();
  assert.equal(view.button('Pay for medicines securely'), undefined); assert.equal(view.button('Pay approved delivery amount'), undefined); assert.equal(view.writes.length, 0); view.unmount();
});

test('pending medicine and delivery stages explicitly resume through the existing pay action', () => {
  for (const stage of ['medicines', 'delivery']) {
    const base = checkout(); const value = checkout({ payment: { ...base.payment, [stage]: { ...base.payment[stage], status: 'pending', reference: 'existing-provider-reference' } }, actions: { ...base.actions, canPayMedicines: stage === 'medicines', canPayDelivery: stage === 'delivery' } });
    const view = pageHarness(value); view.render();
    const button = view.button(stage === 'medicines' ? 'Resume medicine payment securely' : 'Resume delivery payment securely'); assert.ok(button); button.props.onClick();
    assert.equal(view.writes.length, 1); assert.equal(view.writes[0][0], 'pay'); assert.equal(view.writes[0][1].stage, stage); assert.equal(Object.keys(view.writes[0][1]).join(), 'stage'); view.unmount();
  }
});
