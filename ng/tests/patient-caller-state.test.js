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

function viewHarness(filename, auth, api, guidance = async () => { throw new Error('Unavailable'); }, exportName = 'default', componentProps = {}, storage = new Map()) {
  const slots = []; const effects = []; let cursor = 0; let dirty = false; let tree;
  const react = {
    useState(initial) {
      const index = cursor++; if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, (next) => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; dirty = true; }];
    },
    useCallback(callback, dependencies) {
      const index = cursor++; const previous = slots[index];
      if (!previous || dependencies.some((value, offset) => value !== previous.dependencies[offset])) slots[index] = { callback, dependencies };
      return slots[index].callback;
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
  const jsxRuntime = { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
  const dependencies = {
    react, 'react/jsx-runtime': jsxRuntime,
    'next/link': { __esModule: true, default: Symbol('Link') },
    'lucide-react': new Proxy({}, { get: (_target, name) => Symbol(String(name)) }),
    '@/lib/api': { __esModule: true, default: api },
    '@/components/ui/button': { Button: 'button' },
    '@/components/ui/card': { Card: 'section', CardContent: 'div', CardHeader: 'header', CardTitle: 'h2' },
    '@/lib/utils': { formatRelativeTime: () => 'Synthetic relative time' },
    '@/lib/doctaService': { DoctaService: { runAITriage: guidance } },
    '@/components/providers/AuthProvider': { useAuth: () => auth.value },
    '@/components/branding/PortalPageHeader': { __esModule: true, default: Symbol('PortalPageHeader') },
  };
  const sourceModule = { exports: {} };
  const absolute = path.resolve(__dirname, '../..', filename);
  const compiled = transformSync(fs.readFileSync(absolute, 'utf8'), { filename: absolute, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } }).code;
  vm.runInNewContext(compiled, { module: sourceModule, exports: sourceModule.exports, require(name) { assert.ok(name in dependencies, name); return dependencies[name]; }, AbortController, FormData, sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }, crypto: { randomUUID: crypto.randomUUID } });
  const Component = sourceModule.exports[exportName];
  const view = {
    storage,
    render(runEffects = true) {
      do { cursor = 0; dirty = false; tree = Component(componentProps); if (runEffects) for (const effect of effects.splice(0)) effect(); } while (runEffects && dirty);
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

const ngPatientA = { ...patientA, marketScope: 'NG' };
function messagingView(api, auth = { value: { user: ngPatientA, loading: false } }, exportName = 'NigeriaPatientMessagesWorkspace') {
  return viewHarness('app/ng/patient/messages/page.js', auth, api, undefined, exportName);
}
function messagingApi(options = {}) {
  return {
    get(url) {
      if (url === '/messages/conversations') return Promise.resolve({ data: { success: true, conversations: [
        { recipientId: 'doctor-a', recipientName: 'Doctor A' }, { recipientId: 'doctor-b', recipientName: 'Doctor B' },
      ] } });
      if (url === '/appointments') return Promise.resolve({ data: { success: true, appointments: [{ providerId: 'doctor-a', providerFirstName: 'A' }, { providerId: 'doctor-b', providerFirstName: 'B' }] } });
      return options.read ? options.read(url) : Promise.resolve({ data: { success: true, messages: [] } });
    },
    post: options.post || (() => { throw new Error('Unexpected message write'); }),
  };
}
async function openMessaging(api) { const view = messagingView(api); view.render(); await flush(view); await flush(view); return view; }
function messageDraft(view, text, label = 'Message to care team') {
  view.find('textarea').find((field) => field.props['aria-label'] === label).props.onChange({ target: { value: text } }); view.render();
}
function messageButton(view, text) { return view.find('button').find((button) => strings(button.props.children).trim() === text); }

test('NG messages trusted shell gates missing/loading/wrong role or market and keys actual workspace by account', () => {
  let reads = 0;
  const api = { get() { reads++; } };
  const auth = { value: { user: ngPatientA, loading: true } };
  const view = messagingView(api, auth, 'default');
  assert.equal(view.render().props.role, 'status');
  for (const user of [null, { ...ngPatientA, role: 'provider' }, patientA]) {
    auth.value = { user, loading: false }; assert.equal(view.render().props.role, 'status');
  }
  auth.value = { user: ngPatientA, loading: false }; const a = view.render();
  auth.value = { user: { ...ngPatientA, id: 'patient-b' }, loading: false }; const b = view.render(false);
  assert.equal(typeof a.type, 'function'); assert.equal(a.type, b.type); assert.notEqual(a.key, b.key);
  assert.notEqual(a.props.session.current, a.props.accountKey);
  assert.equal(b.props.session.current, b.props.accountKey);
  assert.equal(reads, 0);
});

test('NG pending send preserves newer draft, normalizes saved 201 response and rejects repeated same-render clicks', async () => {
  const post = deferred(); const payloads = [];
  const view = await openMessaging(messagingApi({ post(_url, payload) { payloads.push(payload); return post.promise; } }));
  messageDraft(view, 'First message');
  const button = messageButton(view, 'Send'); const sending = button.props.onClick();
  await button.props.onClick(); assert.equal(payloads.length, 1);
  view.render(); messageDraft(view, 'Newer unsent draft');
  post.resolve({ data: { success: true, data: { id: 'message-a', created_at: '2026-11-02T10:00:00Z' } } });
  await sending; await flush(view);
  assert.equal(view.find('textarea')[0].props.value, 'Newer unsent draft');
  assert.ok(view.text().includes('First message')); assert.ok(view.text().includes('Message sent.'));
  assert.equal(messageButton(view, 'Send').props.disabled, false);
});

test('NG failed message retries retain clientMessageId for normalized content and accept dedup 200 message', async () => {
  const payloads = []; let fail = true;
  const view = await openMessaging(messagingApi({ async post(_url, payload) {
    payloads.push(payload); if (fail) throw new Error('Response lost');
    return { data: { success: true, message: { id: 'dedup-message', createdAt: '2026-11-02T10:00:00Z' } } };
  } }));
  messageDraft(view, 'Retry message'); await messageButton(view, 'Send').props.onClick(); await flush(view);
  messageDraft(view, ' Retry message '); fail = false;
  await messageButton(view, 'Send').props.onClick(); await flush(view);
  assert.equal(payloads[0].clientMessageId, payloads[1].clientMessageId);
  assert.equal(view.find('textarea')[0].props.value, ''); assert.ok(view.text().includes('Retry message'));
  messageDraft(view, 'Different message'); await messageButton(view, 'Send').props.onClick();
  assert.notEqual(payloads[2].clientMessageId, payloads[0].clientMessageId);
});

test('NG late send errors cannot leak into another conversation or a newly opened composer', async () => {
  for (const navigate of ['conversation', 'composer', 'provider']) {
    const post = deferred();
    const view = await openMessaging(messagingApi({ post: () => post.promise }));
    messageDraft(view, 'Old recipient message'); const pending = messageButton(view, 'Send').props.onClick();
    if (navigate === 'conversation') view.button('Doctor B').props.onClick();
    else messageButton(view, 'New Message').props.onClick();
    view.render();
    if (navigate === 'provider') { view.find('select')[0].props.onChange({ target: { value: 'doctor-b' } }); view.render(); }
    messageDraft(view, 'New context draft', navigate === 'conversation' ? 'Message to care team' : 'New message');
    post.reject({ response: { data: { error: 'Old recipient failure detail' } } }); await pending; await flush(view);
    assert.equal(view.text().includes('Old recipient failure detail'), false);
    assert.ok(view.text().includes('New context draft')); assert.equal(view.text().includes('Old recipient message'), false);
  }
});

test('NG late composer send cannot close a newer composer or erase edits', async () => {
  for (const change of ['edit', 'provider', 'close-reopen']) {
    const post = deferred(); const view = await openMessaging(messagingApi({ post: () => post.promise }));
    messageButton(view, 'New Message').props.onClick(); view.render();
    view.find('select')[0].props.onChange({ target: { value: 'doctor-a' } }); view.render();
    messageDraft(view, 'Composer submission', 'New message'); const pending = messageButton(view, 'Send Message').props.onClick(); view.render();
    if (change === 'provider') { view.find('select')[0].props.onChange({ target: { value: 'doctor-b' } }); view.render(); }
    if (change === 'close-reopen') { messageButton(view, 'New Message').props.onClick(); view.render(); messageButton(view, 'New Message').props.onClick(); view.render(); }
    messageDraft(view, 'New composer draft', 'New message');
    post.resolve({ data: { success: true, data: { id: 'composer-saved' } } }); await pending; await flush(view);
    assert.equal(view.find('textarea').find((field) => field.props['aria-label'] === 'New message').props.value, 'New composer draft');
    if (change !== 'edit') assert.equal(view.text().includes('Message sent.'), false);
  }
});

test('NG delayed conversation read merges confirmed sent message instead of erasing it', async () => {
  const read = deferred();
  const view = await openMessaging(messagingApi({ read: () => read.promise, async post() { return { data: { success: true, data: { id: 'confirmed-message' } } }; } }));
  messageDraft(view, 'Confirmed message content'); await messageButton(view, 'Send').props.onClick(); await flush(view);
  read.resolve({ data: { success: true, messages: [{ id: 'older-message', content: 'Older content' }] } }); await flush(view);
  assert.ok(view.text().includes('Confirmed message content')); assert.ok(view.text().includes('Older content'));
});

test('NG unmounted account workspace discards pending send response and does not refresh old inbox', async () => {
  const post = deferred(); const base = messagingApi({ post: () => post.promise }); let reads = 0;
  const view = await openMessaging({ ...base, get(url) { reads++; return base.get(url); } });
  messageDraft(view, 'Private account A draft'); const pending = messageButton(view, 'Send').props.onClick(); view.render();
  const before = reads; view.unmount();
  const next = await openMessaging(messagingApi());
  post.resolve({ data: { success: true, data: { id: 'old-account-message' } } }); await pending; await flush(next);
  assert.equal(reads, before); assert.equal(next.text().includes('Private account A draft'), false); assert.equal(next.text().includes('Message sent.'), false);
});

const submissionId = '00000000-0000-4000-8000-000000000001';
function prescriptionView(api, props = {}, auth = { value: { user: ngPatientA, loading: false } }, exportName = 'NigeriaPatientPrescriptionsWorkspace', storage) {
  return viewHarness('app/ng/patient/prescriptions/page.js', auth, api, undefined, exportName, props, storage);
}
function prescriptionDraft(view, text) {
  if (!view.find('textarea').length) { view.button('Type medication details').props.onClick(); view.render(); }
  view.find('textarea')[0].props.onChange({ target: { value: text } }); view.render();
}
test('prescription submission keeps newer text and ignores repeated clicks while confirming saved receipt', async () => {
  const save = deferred(); const writes = [];
  const view = prescriptionView({ async get() { return { data: [] }; }, post(...args) { writes.push(args); return save.promise; } });
  view.render(); await flush(view); prescriptionDraft(view, 'Original synthetic instructions');
  const handler = view.button('Submit Prescription').props.onClick;
  const pending = handler(); const duplicate = handler(); await duplicate; view.render();
  prescriptionDraft(view, 'New synthetic instructions');
  save.resolve({ data: { prescriptionId: submissionId, status: 'uploaded' } }); await pending; await flush(view);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][1].text, 'Original synthetic instructions');
  assert.equal(view.find('textarea')[0].props.value, 'New synthetic instructions');
  assert.ok(view.text().includes('Prescription submitted for review.'));
});
test('unconfirmed prescription receipts preserve text and retry key instead of claiming success', async () => {
  const writes = [];
  const view = prescriptionView({ async get() { return { data: [] }; }, async post(...args) { writes.push(args); return { data: {} }; } });
  view.render(); await flush(view); prescriptionDraft(view, 'Synthetic instructions');
  await view.button('Submit Prescription').props.onClick(); await flush(view);
  assert.equal(view.find('textarea')[0].props.value, 'Synthetic instructions');
  assert.ok(!view.text().includes('Prescription submitted for review.'));
  assert.ok(view.text().includes('could not be confirmed'));
  await view.button('Submit Prescription').props.onClick(); await flush(view);
  assert.equal(writes[0][2].headers['Idempotency-Key'], writes[1][2].headers['Idempotency-Key']);
});
test('prescription account boundary prevents stale loads, completion refreshes and old-handler submissions', async () => {
  const list = deferred(), save = deferred(), session = { current: 'A' }; let reads = 0, writes = 0;
  const view = prescriptionView({ get() { reads++; return list.promise; }, post() { writes++; return save.promise; } }, { session, accountKey: 'A' });
  view.render(); prescriptionDraft(view, 'Private synthetic instructions');
  const handler = view.button('Submit Prescription').props.onClick;
  const pending = handler(); session.current = 'B';
  list.resolve({ data: [{ id: submissionId, prescriber_name: 'STALE PRIVATE PRESCRIBER' }] });
  save.resolve({ data: { prescriptionId: submissionId } }); await pending; await flush(view); await handler();
  assert.equal(reads, 1); assert.equal(writes, 1);
  assert.ok(!view.text().includes('STALE PRIVATE PRESCRIBER'));
  assert.ok(!view.text().includes('Prescription submitted for review.'));
});
test('prescription wrapper hides workspace without trusted Nigeria patient auth and keys account changes', () => {
  const auth = { value: { user: ngPatientA, loading: true } };
  const view = prescriptionView({}, {}, auth, 'default');
  assert.equal(typeof view.render().type, 'string');
  for (const user of [null, patientA, { ...ngPatientA, role: 'provider' }]) { auth.value = { user, loading: false }; assert.equal(typeof view.render().type, 'string'); }
  auth.value = { user: ngPatientA, loading: false }; const a = view.render();
  auth.value = { user: { ...ngPatientA, id: 'B' }, loading: false }; const b = view.render();
  assert.notEqual(a.key, b.key);
  assert.notEqual(a.props.session.current, a.props.accountKey);
});
test('image submissions retain retry key, reject unconfirmed responses and ignore completion after unmount', async () => {
  const writes = []; let pending;
  const view = prescriptionView({ async get() { return { data: [] }; }, post(...args) { writes.push(args); pending = deferred(); return pending.promise; } });
  view.render(); await flush(view); view.button('Upload image').props.onClick(); view.render();
  const file = new Blob(['synthetic-image'], { type: 'image/png' });
  const upload = () => view.find('input')[0].props.onChange({ target: { files: [file] } });
  let attempt = upload(); pending.resolve({ data: { prescriptionId: 'invalid' } }); await attempt; await flush(view);
  assert.ok(!view.text().includes('Prescription submitted for review.'));
  attempt = view.button('Retry selected image').props.onClick(); await upload();
  assert.equal(writes.length, 2);
  assert.equal(writes[0][2].headers['Idempotency-Key'], writes[1][2].headers['Idempotency-Key']);
  view.render(); view.unmount(); const before = view.text(); pending.resolve({ data: { prescriptionId: submissionId } }); await attempt; view.render();
  assert.equal(view.text(), before);
});

test('opaque prescription recovery marker survives lost response and reload without storing clinical content', async () => {
  const storage = new Map(), props = { accountKey: 'A', session: { current: 'A' } }; let key, writes = 0;
  const api = { async get(url) { return { data: url.includes('/requests/') ? { prescriptionId: submissionId, status: 'uploaded' } : [] }; }, async post(_url, _body, options) { writes++; key = options.headers['Idempotency-Key']; throw new Error('Lost response after commit'); } };
  const first = prescriptionView(api, props, undefined, undefined, storage);
  first.render(); await flush(first); prescriptionDraft(first, 'PRIVATE SYNTHETIC CONTENT');
  await first.button('Submit Prescription').props.onClick(); await flush(first);
  assert.deepEqual(JSON.parse(storage.get('doctarx:prescription-unresolved:A')), { requestId: key });
  assert.ok(!JSON.stringify([...storage]).includes('PRIVATE'));
  first.unmount();
  const reloaded = prescriptionView(api, props, undefined, undefined, storage); reloaded.render(); await flush(reloaded);
  assert.ok(reloaded.text().includes('Prescription submitted for review.'));
  assert.equal(storage.size, 0); assert.equal(writes, 1);
  assert.equal(reloaded.button('Type medication details').props.disabled, false);
});
test('missing or failed recovery lookup keeps opaque barrier and never automatically resubmits', async () => {
  const storage = new Map([['doctarx:prescription-unresolved:A', JSON.stringify({ requestId: submissionId })]]); let writes = 0;
  const view = prescriptionView({ async get(url) { if (url.includes('/requests/')) throw new Error('404 or offline'); return { data: [] }; }, post() { writes++; } }, { accountKey: 'A' }, undefined, undefined, storage);
  view.render(); await flush(view);
  assert.equal(view.button('Type medication details').props.disabled, true);
  await view.button('Check saved submission').props.onClick(); await flush(view);
  assert.equal(storage.size, 1); assert.equal(writes, 0);
  assert.ok(!view.text().includes('Prescription submitted for review.'));
});
test('storage failure prevents prescription mutation and another account cannot consume recovery marker', async () => {
  const storage = new Map([['doctarx:prescription-unresolved:A', JSON.stringify({ requestId: submissionId })]]); let writes = 0; const reads = [];
  const api = { async get(url) { reads.push(url); return { data: [] }; }, async post() { writes++; return { data: { prescriptionId: submissionId } }; } };
  const view = prescriptionView(api, { accountKey: 'B' }, undefined, undefined, storage); view.render(); await flush(view);
  assert.ok(!reads.some(url => url.includes('/requests/')));
  storage.set = () => { throw new Error('Storage denied'); };
  prescriptionDraft(view, 'Synthetic content'); await view.button('Submit Prescription').props.onClick(); await flush(view);
  assert.equal(writes, 0); assert.ok(storage.has('doctarx:prescription-unresolved:A'));
});
test('certified pre-write rejection of a fresh first image attempt allows corrected submission', async () => {
  const writes = [];
  const view = prescriptionView({ async get() { return { data: [] }; }, async post(...args) { writes.push(args); throw { response: { status: 400, data: { submissionNotStarted: true, error: 'Invalid image' } } }; } });
  view.render(); await flush(view); view.button('Upload image').props.onClick(); view.render();
  await view.find('input')[0].props.onChange({ target: { files: [new Blob(['bad-image'], { type: 'image/png' })] } }); await flush(view);
  assert.equal(view.storage.size, 0); assert.equal(view.find('input')[0].props.disabled, false);
  await view.find('input')[0].props.onChange({ target: { files: [new Blob(['new-image'], { type: 'image/png' })] } }); await flush(view);
  assert.notEqual(writes[0][2].headers['Idempotency-Key'], writes[1][2].headers['Idempotency-Key']);
});
test('pre-write rejection on retry cannot clear an older ambiguous submission', async () => {
  let count = 0;
  const view = prescriptionView({ async get() { return { data: [] }; }, async post() { if (++count === 1) throw new Error('Lost'); throw { response: { status: 400, data: { submissionNotStarted: true } } }; } });
  view.render(); await flush(view); prescriptionDraft(view, 'Synthetic text');
  await view.button('Submit Prescription').props.onClick(); await flush(view);
  await view.button('Submit Prescription').props.onClick(); await flush(view);
  assert.equal(view.storage.size, 1); assert.ok(view.text().includes('earlier submission'));
});
test('same-mounted successful recovery retires previous text key before a genuinely new same-content submission', async () => {
  const keys = [];
  const view = prescriptionView({ async get(url) { return { data: url.includes('/requests/') ? { prescriptionId: submissionId } : [] }; }, async post(_url, _body, options) { keys.push(options.headers['Idempotency-Key']); if (keys.length === 1) throw new Error('Lost response'); return { data: { prescriptionId: submissionId } }; } });
  view.render(); await flush(view); prescriptionDraft(view, 'Synthetic repeated content');
  await view.button('Submit Prescription').props.onClick(); await flush(view);
  await view.button('Check saved submission').props.onClick(); await flush(view);
  await view.button('Submit Prescription').props.onClick(); await flush(view);
  assert.equal(keys.length, 2); assert.notEqual(keys[0], keys[1]);
});
