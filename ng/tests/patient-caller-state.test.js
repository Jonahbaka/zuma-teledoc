'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { transformSync } = require('next/dist/build/swc');
const patientA = { id: 'patient-a', role: 'patient', marketScope: 'US' };
const patientB = { id: 'patient-b', role: 'patient', marketScope: 'US' };
const event = { preventDefault() {} };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

function viewHarness(filename, auth, api, guidance = async () => { throw new Error('Unavailable'); }) {
  const slots = []; const effects = []; let cursor = 0; let dirty = false; let tree;
  const react = {
    useState(initial) {
      const index = cursor++; if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, (next) => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; dirty = true; }];
    },
    useRef(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: { current: initial } }; return slots[index].value; },
    useEffect(callback, dependencies) {
      const index = cursor++; const previous = slots[index];
      if (!previous || dependencies.some((value, offset) => value !== previous.dependencies[offset])) {
        const next = { dependencies, cleanup: null }; slots[index] = next;
        effects.push(() => { previous?.cleanup?.(); next.cleanup = callback(); });
      }
    },
  };
  const jsxRuntime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
  const dependencies = {
    react, 'react/jsx-runtime': jsxRuntime,
    'next/link': { __esModule: true, default: Symbol('Link') },
    'lucide-react': new Proxy({}, { get: (_target, name) => Symbol(String(name)) }),
    '@/lib/api': { __esModule: true, default: api },
    '@/lib/doctaService': { DoctaService: { runAITriage: guidance } },
    '@/components/providers/AuthProvider': { useAuth: () => auth.value },
    '@/components/branding/PortalPageHeader': { __esModule: true, default: Symbol('PortalPageHeader') },
  };
  const sourceModule = { exports: {} };
  const absolute = path.resolve(__dirname, '../..', filename);
  const compiled = transformSync(fs.readFileSync(absolute, 'utf8'), { filename: absolute, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } }).code;
  vm.runInNewContext(compiled, { module: sourceModule, exports: sourceModule.exports, require(name) { assert.ok(name in dependencies, name); return dependencies[name]; }, AbortController, crypto: { randomUUID: crypto.randomUUID } });
  const Component = sourceModule.exports.default;
  const view = {
    render(runEffects = true) {
      do { cursor = 0; dirty = false; tree = Component(); if (runEffects) for (const effect of effects.splice(0)) effect(); } while (runEffects && dirty);
      return tree;
    },
    find(type) {
      const rows = [];
      function walk(node) { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) { node.forEach(walk); return; } if (node.type === type) rows.push(node); walk(node.props?.children); }
      walk(tree); return rows;
    },
    text: () => JSON.stringify(tree),
    button(label) { return view.find('button').find((button) => strings(button.props.children).includes(label)); },
    input(id, value) { view.find('input').find((input) => input.props.id === id).props.onChange({ target: { value } }); view.render(); },
    unmount() { for (const slot of slots) slot.cleanup?.(); },
  };
  return view;
}
function strings(value) { if (Array.isArray(value)) return value.map(strings).join(''); if (typeof value === 'string') return value; return value?.props ? strings(value.props.children) : ''; }
async function flush(view) { await new Promise((resolve) => setImmediate(resolve)); view.render(); }
function walletView(auth, api) { return viewHarness('app/(dashboard)/patient/wallet/page.js', auth, api); }
function triageView(auth, api, guidance) { return viewHarness('app/(dashboard)/patient/triage/page.js', auth, api, guidance); }
function fillInsurance(view) { view.button('Add insurance').props.onClick(); view.render(); view.input('insurance-payerName', 'Entered insurer'); view.input('insurance-memberId', 'Entered member ID'); }

test('wallet membership link follows the current trusted patient market', async () => {
  for (const [marketScope, href] of [['US', '/patient/subscription'], ['NG', '/ng/patient/subscription']]) {
    const auth = { value: { user: { ...patientA, marketScope }, loading: false } };
    const view = walletView(auth, { async get() { return { data: { success: true, wallet: [] } }; } });
    view.render(); await flush(view);
    assert.ok(view.text().includes('"href":"' + href + '"'));
  }
});

test('wallet waits for trusted patient auth and immediately hides prior-account identity before effect cleanup', async () => {
  const auth = { value: { user: patientA, loading: true } }; const reads = [];
  const view = walletView(auth, { get(_url, options) { const read = { ...deferred(), options }; reads.push(read); return read.promise; } });
  view.render(); assert.equal(reads.length, 0); assert.equal(view.button('Add insurance').props.disabled, true);
  auth.value.loading = false; view.render(); reads[0].resolve({ data: { success: true, wallet: [{ id: 'card-a', user_id: patientA.id, payerName: 'Account A private insurer' }] } }); await flush(view);
  fillInsurance(view); assert.ok(view.text().includes('Account A private insurer')); assert.ok(view.text().includes('Entered member ID'));
  auth.value = { user: patientB, loading: false }; view.render(false);
  assert.equal(view.text().includes('Account A private insurer'), false); assert.equal(view.text().includes('Entered member ID'), false);
  await flush(view); assert.equal(reads[0].options.signal.aborted, true);
});

test('wallet discards late success from a previous account even before cleanup aborts that request', async () => {
  const auth = { value: { user: patientA, loading: false } }; const pending = deferred();
  const view = walletView(auth, { get() { return pending.promise; } });
  view.render(); auth.value = { user: patientB, loading: false }; view.render(false);
  pending.resolve({ data: { success: true, wallet: [{ id: 'card-a', user_id: patientA.id, payerName: 'Prior account insurance' }] } });
  await flush(view); assert.equal(view.text().includes('Prior account insurance'), false);
});

test('wallet uncertain-save retry survives read retry, cancel/reopen and whitespace edits but changes key for changed content', async () => {
  const auth = { value: { user: patientA, loading: false } }; let read = 0; let saved = [];
  const posts = [];
  const view = walletView(auth, {
    async get() { if (++read === 1) throw new Error('Wallet unavailable'); return { data: { success: true, wallet: saved } }; },
    post(_url, payload, options) { const post = { ...deferred(), payload, options }; posts.push(post); return post.promise; },
  });
  view.render(); await flush(view); fillInsurance(view);
  const first = view.find('form')[0].props.onSubmit(event); view.render(); posts[0].reject(new Error('Response was lost')); await first; await flush(view);
  assert.equal(view.button('Save insurance details').props.disabled, false);
  view.button('Try again').props.onClick(); view.render(); await flush(view);
  assert.equal(view.find('input').find((input) => input.props.id === 'insurance-memberId').props.value, 'Entered member ID');
  view.button('Cancel').props.onClick(); view.render(); view.button('Add insurance').props.onClick(); view.render();
  view.input('insurance-payerName', ' Entered insurer ');
  const second = view.find('form')[0].props.onSubmit(event); posts[1].reject(new Error('Still unavailable')); await second; await flush(view);
  assert.equal(posts[1].options.headers['Idempotency-Key'], posts[0].options.headers['Idempotency-Key']);
  view.input('insurance-memberId', 'Changed member ID');
  const third = view.find('form')[0].props.onSubmit(event);
  saved = [{ id: 'saved-card', user_id: patientA.id, payerName: 'Entered insurer', memberId: '••••r ID', is_verified: false, eligibility_status: 'pending' }];
  posts[2].resolve({ data: { success: true, insurance: saved[0] } }); await third; await flush(view);
  await flush(view); // The acknowledged save starts a separate owned-wallet refresh.
  assert.notEqual(posts[2].options.headers['Idempotency-Key'], posts[0].options.headers['Idempotency-Key']);
  assert.ok(view.text().includes('Current benefits still need insurer confirmation')); assert.ok(view.text().includes('Coverage unverified'));
  assert.equal(view.text().includes('Changed member ID'), false);
});

test('wallet pending submission cannot publish prior-account card data or notices after account change', async () => {
  const auth = { value: { user: patientA, loading: false } }; const post = deferred();
  const view = walletView(auth, { async get() { return { data: { success: true, wallet: [] } }; }, post() { return post.promise; } });
  view.render(); await flush(view); fillInsurance(view); const pending = view.find('form')[0].props.onSubmit(event); view.render();
  auth.value = { user: patientB, loading: false }; view.render(false);
  post.resolve({ data: { success: true, insurance: { id: 'card-a', user_id: patientA.id, payerName: 'Prior account card' } } });
  await pending; await flush(view);
  assert.equal(view.text().includes('Prior account card'), false); assert.equal(view.text().includes('Insurance details saved'), false);
});

test('wallet rejects a foreign-owner response rather than displaying it as the current account card', async () => {
  const auth = { value: { user: patientA, loading: false } };
  const view = walletView(auth, { async get() { return { data: { success: true, wallet: [{ id: 'foreign-card', user_id: patientB.id, payerName: 'Foreign insurer data' }] } }; } });
  view.render(); await flush(view);
  assert.equal(view.text().includes('Foreign insurer data'), false); assert.ok(view.text().includes('Insurance records could not be loaded'));
});

test('symptom and appointment PHI is hidden synchronously on account change and late guidance cannot become another account message', async () => {
  const auth = { value: { user: patientA, loading: false } }; const guidance = deferred();
  const view = triageView(auth, { async get() { return { data: { success: true, appointments: [{ id: 'visit-a', patientId: patientA.id, providerFirstName: 'Account A clinician' }] } }; } }, () => guidance.promise);
  view.render(); await flush(view);
  view.find('textarea')[0].props.onChange({ target: { value: 'Private account A summary' } }); view.render();
  const pending = view.find('form')[0].props.onSubmit(event); view.render();
  auth.value = { user: patientB, loading: false }; view.render(false);
  assert.equal(view.text().includes('Private account A summary'), false); assert.equal(view.text().includes('Account A clinician'), false);
  guidance.resolve({ severity: 'routine', suggestedMeds: ['Do not display generated medication'] }); await pending; await flush(view);
  assert.equal(view.text().includes('could not be validated'), false); assert.equal(view.text().includes('Do not display generated medication'), false);
});

test('appointment retry preserves symptom text and unavailable guidance while care links and controls remain usable', async () => {
  const auth = { value: { user: patientA, loading: false } }; let reads = 0; let writes = 0;
  const view = triageView(auth, { async get() { if (++reads === 1) throw new Error('Appointment outage'); return { data: { success: true, appointments: [] } }; }, post() { writes++; throw new Error('No clinical writes'); } }, async () => { throw new Error('Untrusted generated clinical error message'); });
  view.render(); await flush(view); view.find('textarea')[0].props.onChange({ target: { value: 'Local visit preparation summary' } }); view.render();
  await view.find('form')[0].props.onSubmit(event); await flush(view);
  assert.equal(view.button('Check optional guidance').props.disabled, false); assert.ok(view.text().includes('continue booking'));
  assert.equal(view.text().includes('Untrusted generated clinical error'), false);
  view.button('Try again').props.onClick(); view.render(); await flush(view);
  assert.equal(view.find('textarea')[0].props.value, 'Local visit preparation summary'); assert.ok(view.text().includes('continue booking'));
  assert.ok(view.text().includes('/patient/appointments/book')); assert.equal(writes, 0);
});

test('unvalidated guidance success is discarded and never becomes a medication, diagnosis, severity or clinical submission', async () => {
  const auth = { value: { user: patientA, loading: false } }; let writes = 0;
  const view = triageView(auth, { async get() { return { data: { success: true, appointments: [] } }; }, post() { writes++; } }, async () => ({ severity: 'Routine', suggestedMeds: ['Invented medication'], soapDraft: 'Invented diagnosis' }));
  view.render(); await flush(view); view.find('textarea')[0].props.onChange({ target: { value: 'Visit preparation only' } }); view.render();
  await view.find('form')[0].props.onSubmit(event); await flush(view);
  assert.ok(view.text().includes('No assessment was recorded or sent')); assert.equal(view.text().includes('Invented medication'), false); assert.equal(view.text().includes('Invented diagnosis'), false);
  assert.equal(writes, 0); assert.equal(view.button('Check optional guidance').props.disabled, false);
});

test('symptom guidance rejects either API naming form of a foreign-patient appointment', async () => {
  for (const patientField of ['patientId', 'patient_id']) {
    const auth = { value: { user: patientA, loading: false } };
    const view = triageView(auth, { async get() { return { data: { success: true, appointments: [{ id: 'foreign-visit', [patientField]: patientB.id, providerFirstName: 'Foreign private clinician' }] } }; } });
    view.render(); await flush(view);
    assert.equal(view.text().includes('Foreign private clinician'), false); assert.ok(view.text().includes('Your next appointment could not be loaded'));
  }
});
