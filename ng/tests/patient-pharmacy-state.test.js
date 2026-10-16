'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('next/dist/build/swc');
const patientA = { id: 'patient-a', role: 'patient', marketScope: 'US' };
const patientB = { id: 'patient-b', role: 'patient', marketScope: 'US' };
const recordId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const PharmacyLocator = Symbol('PharmacyLocator');
const selection = { mode: 'manual', pharmacy: { name: 'Entered pharmacy', address: 'Entered pharmacy address', phone: 'Entered phone', latitude: 0, longitude: 0 } };
const savedRecord = (patientId = patientA.id) => ({ id: recordId, patientId, pharmacyName: 'Private saved pharmacy', pharmacyAddress: 'Private saved address', isPreferred: false });
const rxRecord = (patientId = patientA.id) => ({ id: otherId, patientId, medicationName: 'Private prescribed medication', status: 'pending' });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function strings(value) { if (Array.isArray(value)) return value.map(strings).join(''); if (typeof value === 'string') return value; return value?.props ? strings(value.props.children) : ''; }
function harness(auth, api) {
  const slots = []; const effects = []; let cursor = 0; let dirty = false; let tree;
  const react = {
    useState(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, (next) => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; dirty = true; }]; },
    useRef(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: { current: initial } }; return slots[index].value; },
    useEffect(callback, dependencies) {
      const index = cursor++; const previous = slots[index];
      if (!previous || dependencies.some((value, offset) => value !== previous.dependencies[offset])) {
        const next = { dependencies, cleanup: null }; slots[index] = next;
        effects.push(() => { previous?.cleanup?.(); next.cleanup = callback(); });
      }
    },
  };
  const dependencies = {
    react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'next/link': { __esModule: true, default: Symbol('Link') },
    'lucide-react': new Proxy({}, { get: (_target, name) => Symbol(String(name)) }),
    '@/lib/api': { __esModule: true, default: api },
    '@/components/providers/AuthProvider': { useAuth: () => auth.value },
    '@/components/branding/PortalPageHeader': { __esModule: true, default: Symbol('PortalPageHeader') },
    '@/components/PharmacyLocator': { __esModule: true, default: PharmacyLocator },
    '@/components/ui/button': { Button: 'button' },
  };
  const sourceModule = { exports: {} };
  const filename = path.resolve(__dirname, '../../app/(dashboard)/patient/pharmacy/page.js');
  const compiled = transformSync(fs.readFileSync(filename, 'utf8'), { filename, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } }).code;
  vm.runInNewContext(compiled, { module: sourceModule, exports: sourceModule.exports, require(name) { assert.ok(name in dependencies, name); return dependencies[name]; }, AbortController, window: { confirm: () => true } });
  const Component = sourceModule.exports.default;
  const view = {
    render(runEffects = true) { do { cursor = 0; dirty = false; tree = Component(); if (runEffects) for (const effect of effects.splice(0)) effect(); } while (runEffects && dirty); return tree; },
    find(type) { const rows = []; function walk(node) { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) { node.forEach(walk); return; } if (node.type === type) rows.push(node); walk(node.props?.children); } walk(tree); return rows; },
    text: () => JSON.stringify(tree),
    button(label) { return view.find('button').find((button) => strings(button.props.children) === label); },
    select(choice = selection) { view.find(PharmacyLocator)[0].props.onSelect(choice); view.render(); },
    tab(label) { view.button(label).props.onClick(); view.render(); },
    unmount() { for (const slot of slots) slot.cleanup?.(); },
  };
  return view;
}
async function flush(view) { await new Promise((resolve) => setImmediate(resolve)); view.render(); }
const actualReads = async (url) => ({ data: url === '/prescriptions' ? { success: true, prescriptions: [] } : { success: true, pharmacies: [] } });

test('pharmacy workspace waits for trusted patient auth and rejects stale nonpatient selection callbacks', async () => {
  for (const value of [{ user: patientA, loading: true }, { user: { ...patientA, role: 'provider' }, loading: false }]) {
    const auth = { value }; let reads = 0;
    const view = harness(auth, { get() { reads++; return Promise.resolve({ data: {} }); } });
    view.render(); view.select(); assert.equal(reads, 0); assert.equal(view.button('Save to your pharmacies'), undefined);
    view.tab('Saved pharmacies'); assert.equal(view.text().includes('Private saved pharmacy'), false);
  }
});

test('patient pharmacy PHI and local choices hide before effects on ID, role, market or readiness change', async () => {
  for (const next of [{ user: patientB, loading: false }, { user: { ...patientA, role: 'provider' }, loading: false }, { user: { ...patientA, marketScope: 'NG' }, loading: false }, { user: patientA, loading: true }]) {
    const auth = { value: { user: patientA, loading: false } };
    const view = harness(auth, { async get(url) { return { data: url === '/prescriptions' ? { success: true, prescriptions: [rxRecord()] } : { success: true, pharmacies: [savedRecord()] } }; } });
    view.render(); await flush(view); view.select(); const staleSelection = view.find(PharmacyLocator)[0].props.onSelect;
    assert.ok(view.text().includes('Entered pharmacy address'));
    auth.value = next; view.render(false);
    assert.equal(view.text().includes('Entered pharmacy address'), false);
    staleSelection(selection); view.render(false); assert.equal(view.button('Save to your pharmacies'), undefined);
    view.tab('Saved pharmacies'); assert.equal(view.text().includes('Private saved pharmacy'), false);
    view.tab('Prescriptions'); assert.equal(view.text().includes('Private prescribed medication'), false);
  }
});

test('late pharmacy and prescription reads cannot publish PHI after a pre-effect context change', async () => {
  for (const field of ['id', 'marketScope', 'role']) {
    const auth = { value: { user: patientA, loading: false } }; const reads = [];
    const view = harness(auth, { get(url, options) { const read = { ...deferred(), url, options }; reads.push(read); return read.promise; } });
    view.render(); auth.value = { user: { ...patientA, [field]: field === 'id' ? patientB.id : field === 'role' ? 'provider' : 'NG' }, loading: false }; view.render(false);
    for (const read of reads) read.resolve({ data: read.url === '/prescriptions' ? { success: true, prescriptions: [rxRecord()] } : { success: true, pharmacies: [savedRecord()] } });
    await flush(view); view.tab('Saved pharmacies'); assert.equal(view.text().includes('Private saved pharmacy'), false);
    view.tab('Prescriptions'); assert.equal(view.text().includes('Private prescribed medication'), false);
    assert.ok(reads.slice(0, 2).every((read) => read.options.signal.aborted));
  }
});

test('returning to the same context before effect cleanup cannot resurrect old PHI or local selections', async () => {
  const auth = { value: { user: patientA, loading: false } };
  const view = harness(auth, { async get(url) { return { data: url === '/prescriptions' ? { success: true, prescriptions: [rxRecord()] } : { success: true, pharmacies: [savedRecord()] } }; } });
  view.render(); await flush(view); view.select();
  auth.value = { user: patientB, loading: false }; view.render(false);
  auth.value = { user: patientA, loading: false }; view.render(false);
  assert.equal(view.text().includes('Entered pharmacy address'), false);
  view.button('Saved pharmacies').props.onClick(); view.render(false);
  assert.equal(view.text().includes('Private saved pharmacy'), false);
  view.button('Prescriptions').props.onClick(); view.render(false);
  assert.equal(view.text().includes('Private prescribed medication'), false);
});

test('unconfirmed or foreign-owner pharmacy and prescription data is an error rather than a successful empty list', async () => {
  for (const [url, key, tab, emptyMessage] of [['/prescriptions', 'prescriptions', 'Prescriptions', 'No prescriptions are recorded for your account.'], ['/pharmacy/preferences', 'pharmacies', 'Saved pharmacies', 'No pharmacy choices are saved in your account.']]) {
    for (const bad of [{ success: false, [key]: [] }, { success: true, [key]: 'invalid' }, { success: true, [key]: [{ ...savedRecord(patientB.id), medicationName: 'Foreign private record' }] }]) {
      const auth = { value: { user: patientA, loading: false } };
      const view = harness(auth, { get: async (resource) => resource === url ? { data: bad } : actualReads(resource) });
      view.render(); await flush(view); view.tab(tab);
      assert.ok(view.text().includes('These records could not be loaded')); assert.equal(view.text().includes(emptyMessage), false); assert.equal(view.text().includes('Foreign private record'), false);
    }
  }
});

test('failed reads retry real results without clearing selected details or submitting a preference', async () => {
  const auth = { value: { user: patientA, loading: false } }; let failed = true; let writes = 0;
  const view = harness(auth, { async get(url) { if (failed && url === '/pharmacy/preferences') throw new Error('Test-only read outage'); return actualReads(url); }, post() { writes++; } });
  view.render(); await flush(view); view.select(); view.tab('Saved pharmacies'); assert.ok(view.text().includes('These records could not be loaded'));
  failed = false; view.button('Try again').props.onClick(); view.render(); await flush(view);
  assert.ok(view.text().includes('No pharmacy choices are saved in your account.')); view.tab('Find a pharmacy');
  assert.ok(view.text().includes('Entered pharmacy address')); assert.equal(writes, 0);
});

test('save double-click is guarded synchronously and only a real owned acknowledgment permits a success notice', async () => {
  const auth = { value: { user: patientA, loading: false } }; const posts = []; let readCalls = 0;
  const view = harness(auth, { get(url) { readCalls++; return actualReads(url); }, post(url, payload, options) { const post = { ...deferred(), url, payload, options }; posts.push(post); return post.promise; } });
  view.render(); await flush(view); view.select();
  const save = view.button('Save to your pharmacies').props.onClick;
  const pending = save(); const duplicate = save(); assert.equal(posts.length, 1); await duplicate; view.render(); assert.equal(view.button('Saving choice…').props.disabled, true);
  assert.equal(posts[0].payload.latitude, 0); assert.equal(posts[0].payload.longitude, 0); assert.equal(posts[0].payload.pharmacyPhone, 'Entered phone');
  posts[0].resolve({ data: { success: true } }); await pending; await flush(view);
  assert.equal(view.text().includes('Pharmacy details saved.'), false); assert.ok(view.text().includes('server did not confirm')); assert.equal(view.button('Save to your pharmacies').props.disabled, false);
  const retry = view.button('Save to your pharmacies').props.onClick();
  assert.deepEqual(posts[1].payload, posts[0].payload); posts[1].resolve({ data: { success: true, pharmacy: savedRecord() } }); await retry; await flush(view); await flush(view);
  assert.ok(view.text().includes('Pharmacy details saved. No prescription has been sent.')); assert.equal(view.button('Save to your pharmacies'), undefined); assert.ok(readCalls >= 4);
});

test('foreign-owner or wrong-record mutation acknowledgments cannot claim a preference change', async () => {
  for (const pharmacy of [savedRecord(patientB.id), { ...savedRecord(), id: otherId }]) {
    const auth = { value: { user: patientA, loading: false } };
    const view = harness(auth, { async get(url) { return url === '/prescriptions' ? actualReads(url) : { data: { success: true, pharmacies: [savedRecord()] } }; }, async put() { return { data: { success: true, pharmacy } }; } });
    view.render(); await flush(view); view.tab('Saved pharmacies'); await view.button('Set as preferred').props.onClick(); await flush(view);
    assert.equal(view.text().includes('Your preferred pharmacy was updated.'), false); assert.ok(view.text().includes('server did not confirm')); assert.equal(view.button('Set as preferred').props.disabled, false);
  }
});

test('old mutation callbacks cannot release a new account request or publish a stale success notice', async () => {
  const auth = { value: { user: patientA, loading: false } }; const posts = [];
  const view = harness(auth, { get: actualReads, post(_url, payload, options) { const post = { ...deferred(), payload, options }; posts.push(post); return post.promise; } });
  view.render(); await flush(view); view.select(); const first = view.button('Save to your pharmacies').props.onClick(); view.render();
  auth.value = { user: patientB, loading: false }; view.render(false); assert.equal(view.text().includes('Entered pharmacy address'), false);
  await flush(view); view.select({ ...selection, pharmacy: { ...selection.pharmacy, name: 'Account B pharmacy' } }); const second = view.button('Save to your pharmacies').props.onClick(); view.render();
  posts[0].resolve({ data: { success: true, pharmacy: savedRecord() } }); await first; await flush(view);
  assert.equal(posts[0].options.signal.aborted, true); assert.equal(view.text().includes('Pharmacy details saved.'), false); assert.equal(view.button('Saving choice…').props.disabled, true);
  const staleClick = view.button('Saving choice…').props.onClick; await staleClick(); assert.equal(posts.length, 2);
  posts[1].resolve({ data: { success: true, pharmacy: savedRecord(patientB.id) } }); await second; await flush(view);
  assert.ok(view.text().includes('Pharmacy details saved. No prescription has been sent.'));
});

test('unmount aborts a pending preference and late completion cannot publish state or trigger another read', async () => {
  const auth = { value: { user: patientA, loading: false } }; let readCalls = 0; const post = deferred(); let signal;
  const view = harness(auth, { get(url) { readCalls++; return actualReads(url); }, post(_url, _payload, options) { signal = options.signal; return post.promise; } });
  view.render(); await flush(view); view.select(); const pending = view.button('Save to your pharmacies').props.onClick(); view.render(); view.unmount();
  assert.equal(signal.aborted, true); post.resolve({ data: { success: true, pharmacy: savedRecord() } }); await pending; await flush(view);
  assert.equal(view.text().includes('Pharmacy details saved.'), false); assert.equal(readCalls, 2);
});
