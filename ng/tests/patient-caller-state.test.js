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
  const toasts = []; const slots = []; const effects = []; let cursor = 0; let dirty = false; let tree;
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
    useMemo(callback, dependencies) {
      const index = cursor++; const previous = slots[index];
      if (!previous || dependencies.some((value, offset) => value !== previous.dependencies[offset])) slots[index] = { value: callback(), dependencies };
      return slots[index].value;
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
    '@/components/ui/card': { Card: 'section', CardContent: 'div', CardHeader: 'header', CardTitle: 'h2', CardDescription: 'p' },
    '@/components/ui/input': { Input: 'input' },
    '@/components/ui/label': { Label: 'label' },
    '@/components/ui/use-toast': { toast(value) { toasts.push(value); } },
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
    toasts,
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

const ngProvider = { id: 'provider-a', role: 'provider', marketScope: 'NG' };
function manualReferralView(api, props = {}, auth = { value: { user: ngProvider, loading: false } }, exportName = 'NigeriaProviderReferralsWorkspace', storage) {
  return viewHarness('app/ng/provider/referrals/page.js', auth, api, undefined, exportName, props, storage);
}
function manualReferralResponse(url) {
  return { data: url === '/providers/me/patients' ? { success: true, patients: [{ id: patientA.id, firstName: 'Synthetic patient' }] } : { ok: true, referrals: [{ id: 'ref-a', status: 'draft', reason: 'Synthetic referral reason', target_name: 'Synthetic destination' }] } };
}
function fillManualReferral(view) {
  view.button('Synthetic patient').props.onClick(); view.render();
  view.find('textarea').find(node => node.props.id === 'referral-reason').props.onChange({ target: { value: 'Synthetic new referral' } }); view.render();
}
test('manual referral shell gates trusted NG provider auth and replaces clinician workspace synchronously', () => {
  const auth = { value: { user: ngProvider, loading: true } }, view = manualReferralView({}, {}, auth, 'default');
  assert.equal(typeof view.render().type, 'string');
  for (const user of [null, ngPatientA, { ...ngProvider, marketScope: 'US' }]) { auth.value = { user, loading: false }; assert.equal(typeof view.render().type, 'string'); }
  auth.value = { user: ngProvider, loading: false }; const first = view.render();
  auth.value = { user: { ...ngProvider, id: 'provider-b' }, loading: false }; const second = view.render(false);
  assert.notEqual(first.key, second.key); assert.notEqual(first.props.session.current, first.props.accountKey);
});
test('manual referral old account reads and captured handlers cannot expose data or issue writes', async () => {
  const requests = [], session = { current: 'A' }; let writes = 0;
  const view = manualReferralView({ get(url) { const req = { url, ...deferred() }; requests.push(req); return req.promise; }, async post() { writes++; }, async patch() { writes++; } }, { session, accountKey: 'A' });
  view.render(); requests.forEach(req => req.resolve(manualReferralResponse(req.url))); await flush(view); fillManualReferral(view);
  const submit = view.find('form')[0].props.onSubmit, refresh = view.button('Refresh').props.onClick;
  view.find('textarea').find(node => node.props.id === 'referral-outcome-ref-a').props.onChange({ target: { value: 'Synthetic communication recorded' } }); view.render();
  const update = view.button('Record sending').props.onClick;
  const refreshing = refresh(); session.current = 'B';
  requests.slice(2).forEach(req => req.resolve({ data: { ok: true, referrals: [{ id: 'old', reason: 'STALE SECRET' }] } })); await refreshing; await flush(view);
  await submit(event); await update(); await refresh();
  assert.equal(requests.length, 4); assert.equal(writes, 0); assert.ok(!view.text().includes('STALE SECRET'));
});
test('manual referral in-flight save ignores old clinician completion and duplicate clicks', async () => {
  const pending = deferred(), session = { current: 'A' }; let reads = 0, writes = 0;
  const view = manualReferralView({ async get(url) { reads++; return manualReferralResponse(url); }, post() { writes++; return pending.promise; } }, { session, accountKey: 'A' });
  view.render(); await flush(view); fillManualReferral(view);
  const submit = view.find('form')[0].props.onSubmit;
  const first = submit(event); await submit(event); session.current = 'B';
  pending.resolve({ data: { ok: true, referral: { id: 'saved' } } }); await first; await flush(view);
  assert.equal(writes, 1); assert.equal(reads, 2);
  assert.equal(view.find('textarea').find(node => node.props.id === 'referral-reason').props.value, 'Synthetic new referral');
});
test('manual referral unmount discards pending status completion without old-account refresh', async () => {
  const pending = deferred(); let reads = 0, writes = 0;
  const view = manualReferralView({ async get(url) { reads++; return manualReferralResponse(url); }, patch() { writes++; return pending.promise; } });
  view.render(); await flush(view);
  view.find('textarea').find(node => node.props.id === 'referral-outcome-ref-a').props.onChange({ target: { value: 'Synthetic sending record' } }); view.render();
  const handler = view.button('Record sending').props.onClick;
  const first = handler(); await handler(); view.unmount();
  pending.resolve({ data: { ok: true, referral: { id: 'ref-a', status: 'sent' } } }); await first; await flush(view);
  assert.equal(writes, 1); assert.equal(reads, 2);
  assert.equal(view.find('textarea').find(node => node.props.id === 'referral-outcome-ref-a').props.value, 'Synthetic sending record');
});

test('manual referral stale save failure never displays the prior clinician error', async () => {
  const pending = deferred(), session = { current: 'A' };
  const view = manualReferralView({ async get(url) { return manualReferralResponse(url); }, post() { return pending.promise; } }, { session, accountKey: 'A' });
  view.render(); await flush(view); fillManualReferral(view);
  const action = view.find('form')[0].props.onSubmit(event); session.current = 'B';
  pending.reject({ response: { data: { error: 'PRIOR CLINICIAN PRIVATE ERROR' } } }); await action; await flush(view);
  assert.equal(view.toasts.length, 0);
  assert.ok(!view.text().includes('PRIOR CLINICIAN PRIVATE ERROR'));
});

const referralStorageKey = 'doctarx:referral-unresolved:A';
const savedReferral = { data: { ok: true, referral: { id: submissionId, status: 'draft' } } };
function referralReason(view, value) {
  view.find('textarea').find(node => node.props.id === 'referral-reason').props.onChange({ target: { value } }); view.render();
}
async function saveReferral(view) { await view.find('form')[0].props.onSubmit(event); await flush(view); }

test('manual referral lost-response reload reconciles an opaque account marker without resubmitting or storing PHI', async () => {
  const storage = new Map(); let writes = 0, key;
  const api = {
    async get(url) { return url.includes('/requests/') ? savedReferral : manualReferralResponse(url); },
    async post(url, body, options) {
      writes++; key = options.headers['Idempotency-Key'];
      assert.equal(url, '/ng/clinical/referrals');
      assert.deepEqual(JSON.parse(storage.get(referralStorageKey)), { requestId: key });
      assert.match(key, /^[0-9a-f-]{36}$/);
      assert.equal(body.reason, 'PRIVATE SYNTHETIC REASON');
      throw new Error('Lost response after commit');
    },
  };
  const first = manualReferralView(api, { accountKey: 'A' }, undefined, undefined, storage);
  first.render(); await flush(first); fillManualReferral(first);
  referralReason(first, 'PRIVATE SYNTHETIC REASON'); first.input('referral-destination', 'PRIVATE SYNTHETIC DESTINATION');
  await saveReferral(first);
  assert.deepEqual(JSON.parse(storage.get(referralStorageKey)), { requestId: key });
  assert.ok(!JSON.stringify([...storage]).includes('PRIVATE')); assert.ok(!JSON.stringify([...storage]).includes(patientA.id));
  first.unmount();
  const reloaded = manualReferralView(api, { accountKey: 'A' }, undefined, undefined, storage);
  reloaded.render(); await flush(reloaded);
  assert.equal(writes, 1); assert.equal(storage.size, 0);
  assert.ok(reloaded.toasts.some(toast => toast.title === 'Saved referral found'));
  assert.ok(!reloaded.button('Check saved referral'));
});

test('manual referral missing, malformed or failed receipts preserve reload barrier and never create', async () => {
  for (const response of [null, { data: { ok: true, referral: { id: 'bad', status: 'draft' } } }, { data: { ok: true, referral: { id: submissionId } } }]) {
    const storage = new Map([[referralStorageKey, JSON.stringify({ requestId: submissionId })]]); let writes = 0;
    const view = manualReferralView({ async get(url) { if (url.includes('/requests/')) { if (!response) throw { response: { status: 404 } }; return response; } return manualReferralResponse(url); }, async post() { writes++; } }, { accountKey: 'A' }, undefined, undefined, storage);
    view.render(); await flush(view); fillManualReferral(view);
    assert.equal(view.button('Save referral draft').props.disabled, true);
    await saveReferral(view); await view.button('Check saved referral').props.onClick(); await flush(view);
    assert.equal(storage.size, 1); assert.equal(writes, 0); assert.equal(view.toasts.length, 0);
  }
});

test('manual referral unchanged canonical retry reuses key, changed intent remains blocked until reconciliation', async () => {
  const keys = [];
  const view = manualReferralView({ async get(url) { return url.includes('/requests/') ? savedReferral : manualReferralResponse(url); }, async post(_url, _body, options) { keys.push(options.headers['Idempotency-Key']); throw new Error('Lost response'); } }, { accountKey: 'A' });
  view.render(); await flush(view); fillManualReferral(view); await saveReferral(view);
  referralReason(view, '  Synthetic new referral  '); await saveReferral(view);
  assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]);
  referralReason(view, 'Newer synthetic reason'); assert.equal(view.button('Save referral draft').props.disabled, true); await saveReferral(view);
  assert.equal(keys.length, 2);
  await view.button('Check saved referral').props.onClick(); await flush(view);
  assert.equal(view.find('textarea').find(node => node.props.id === 'referral-reason').props.value, 'Newer synthetic reason');
  // Even identical content after reconciliation is a genuinely new intent.
  referralReason(view, 'Synthetic new referral'); await saveReferral(view);
  assert.equal(keys.length, 3); assert.notEqual(keys[0], keys[2]);
});

test('manual referral only certified first-attempt validation rejection clears marker', async () => {
  for (const ambiguous of [false, true]) {
    const keys = [];
    const view = manualReferralView({ async get(url) { return manualReferralResponse(url); }, async post(_url, _body, options) {
      keys.push(options.headers['Idempotency-Key']);
      if (ambiguous && keys.length === 1) throw new Error('Lost');
      throw { response: { status: 400, data: { submissionNotStarted: true, error: 'Invalid details' } } };
    } }, { accountKey: 'A' });
    view.render(); await flush(view); fillManualReferral(view); await saveReferral(view);
    if (ambiguous) await saveReferral(view);
    assert.equal(view.storage.size, ambiguous ? 1 : 0);
    referralReason(view, 'Corrected synthetic reason'); await saveReferral(view);
    assert.equal(keys.length, 2);
    if (ambiguous) assert.equal(keys[0], keys[1]);
    else assert.notEqual(keys[0], keys[1]);
  }
});


test('manual referral generic 400, storage failure and different account fail safely', async () => {
  let writes = 0; const reads = [];
  const storage = new Map([[referralStorageKey, JSON.stringify({ requestId: submissionId })]]);
  const api = { async get(url) { reads.push(url); return manualReferralResponse(url); }, async post() { writes++; throw { response: { status: 400, data: { error: 'Invalid' } } }; } };
  const view = manualReferralView(api, { accountKey: 'B' }, undefined, undefined, storage);
  view.render(); await flush(view); fillManualReferral(view);
  assert.ok(!reads.some(url => url.includes('/requests/')));
  await saveReferral(view); assert.equal(storage.size, 2);
  assert.ok(view.button('Check saved referral'));
  storage.set = () => { throw new Error('Storage unavailable'); };
  await saveReferral(view); assert.equal(writes, 1); assert.ok(storage.has(referralStorageKey));
});

test('manual referral successful POST preserves newer entered form and mints a new subsequent intent', async () => {
  const pending = deferred(), keys = [];
  const view = manualReferralView({ async get(url) { return manualReferralResponse(url); }, post(_url, _body, options) { keys.push(options.headers['Idempotency-Key']); return keys.length === 1 ? pending.promise : Promise.resolve(savedReferral); } }, { accountKey: 'A' });
  view.render(); await flush(view); fillManualReferral(view);
  const action = view.find('form')[0].props.onSubmit(event);
  referralReason(view, 'Newer unsaved synthetic reason'); pending.resolve(savedReferral); await action; await flush(view);
  assert.equal(view.find('textarea').find(node => node.props.id === 'referral-reason').props.value, 'Newer unsaved synthetic reason');
  assert.equal(view.storage.size, 0);
  await saveReferral(view); assert.notEqual(keys[0], keys[1]);
});

test('manual referral stale recovery cannot clear another account marker or expose receipt', async () => {
  const lookup = deferred(), session = { current: 'A' }, storage = new Map([[referralStorageKey, JSON.stringify({ requestId: submissionId })]]);
  const view = manualReferralView({ async get(url) { return url.includes('/requests/') ? lookup.promise : manualReferralResponse(url); } }, { accountKey: 'A', session }, undefined, undefined, storage);
  view.render(); await flush(view); session.current = 'B'; lookup.resolve(savedReferral); await flush(view);
  assert.equal(storage.size, 1); assert.equal(view.toasts.length, 0);
});

test('manual referral unavailable storage prevents the first mutation and removal cannot erase a known pending barrier', async () => {
  let writes = 0;
  const api = { async get(url) { return manualReferralResponse(url); }, async post() { writes++; throw new Error('Lost response'); } };
  const denied = manualReferralView(api, { accountKey: 'A' });
  denied.render(); await flush(denied); fillManualReferral(denied);
  denied.storage.set = () => { throw new Error('Storage unavailable'); };
  await saveReferral(denied); assert.equal(writes, 0);
  denied.storage.set = Map.prototype.set;
  await denied.button('Check saved referral').props.onClick(); await flush(denied);
  referralReason(denied, 'Corrected never-transmitted reason'); await saveReferral(denied);
  assert.equal(writes, 1); assert.equal(denied.storage.size, 1);
  const pending = manualReferralView(api, { accountKey: 'A' });
  pending.render(); await flush(pending); fillManualReferral(pending); await saveReferral(pending);
  pending.storage.clear();
  await pending.button('Check saved referral').props.onClick(); await flush(pending);
  referralReason(pending, 'Different synthetic reason'); await saveReferral(pending);
  assert.equal(writes, 2); assert.equal(pending.button('Save referral draft').props.disabled, true);
  assert.ok(pending.text().includes('recovery reference is missing'));
});


test('manual referral replay confirmation describes current completed or cancelled status without claiming a new draft', async () => {
  for (const status of ['completed', 'cancelled']) {
    const view = manualReferralView({ async get(url) { return manualReferralResponse(url); }, async post() { return { data: { ok: true, referral: { id: submissionId, status } } }; } }, { accountKey: 'A' });
    view.render(); await flush(view); fillManualReferral(view); await saveReferral(view);
    const confirmation = view.toasts.find(toast => toast.title === 'Referral save confirmed');
    assert.ok(confirmation); assert.ok(confirmation.description.includes('Current recorded status: ' + status));
    assert.ok(!confirmation.description.includes('Review the destination'));
    assert.equal(view.storage.size, 0);
  }
});

function searchManualPatients(view, term) {
  view.find('input').find(node => node.props['aria-label'] === 'Search patients').props.onChange({ target: { value: term } });
  view.render();
  return view.button('Search patients').props.onClick();
}

test('manual referral patient discovery can reach and select a patient beyond the original first twenty', async () => {
  const rows = Array.from({ length: 25 }, (_, index) => ({ id: `discovery-${index + 1}`, firstName: `Discovery patient ${index + 1}` }));
  const pages = []; let savedPatient;
  const view = manualReferralView({
    async get(url, options) {
      if (url !== '/providers/me/patients') return { data: { ok: true, referrals: [] } };
      const { page = 1, limit = 20 } = options?.params || {}; pages.push(page);
      return { data: { success: true, patients: rows.slice((page - 1) * limit, page * limit), pagination: { hasMore: page * limit < rows.length } } };
    },
    async post(_url, body) { savedPatient = body.patient_user_id; return savedReferral; },
  });
  view.render(); await flush(view);
  assert.ok(view.button('Load more patients'), 'patients after the first rendered page must be reachable');
  await view.button('Load more patients').props.onClick(); await flush(view);
  await view.button('Load more patients').props.onClick(); await flush(view);
  assert.equal(view.button('Load more patients'), undefined);
  view.button('Discovery patient 25').props.onClick(); view.render(); referralReason(view, 'Synthetic referral for later-page patient');
  await saveReferral(view); assert.equal(savedPatient, 'discovery-25'); assert.deepEqual(pages.slice(0, 3), [1, 2, 3]);
});

test('manual referral search reaches the server and preserves the selected patient and draft across other results', async () => {
  const requests = [];
  const view = manualReferralView({ async get(url, options) {
    if (url !== '/providers/me/patients') return { data: { ok: true, referrals: [] } };
    assert.equal(options.params.search, undefined);
    return { data: { success: true, patients: [{ id: patientA.id, firstName: 'Synthetic patient' }], pagination: { hasMore: false } } };
  }, async post(url, body, options) {
    assert.equal(url, '/providers/me/patients/search'); assert.equal(options.params, undefined); requests.push(body);
    return { data: { success: true, patients: [{ id: 'found', firstName: 'Later patient' }], pagination: { hasMore: false } } };
  } });
  view.render(); await flush(view); fillManualReferral(view);
  await searchManualPatients(view, ' Later patient '); await flush(view);
  assert.equal(requests.at(-1).search, 'Later patient'); assert.equal(requests.at(-1).page, 1);
  assert.ok(view.button('Later patient')); assert.ok(view.text().includes('Selected patient: '));
  assert.ok(view.text().includes('Synthetic patient')); assert.equal(view.find('textarea').find(n => n.props.id === 'referral-reason').props.value, 'Synthetic new referral');
  assert.equal(view.button('Save referral draft').props.disabled, false);
});

test('manual referral failed additional page can retry without losing earlier results or duplicating patients', async () => {
  let later = 0;
  const view = manualReferralView({ async get(url, options) {
    if (url !== '/providers/me/patients') return { data: { ok: true, referrals: [] } };
    const first = { id: patientA.id, firstName: 'Synthetic patient' };
    if (options.params.page === 1) return { data: { success: true, patients: [first], pagination: { hasMore: true } } };
    if (++later === 1) throw new Error('Synthetic later-page failure');
    return { data: { success: true, patients: [first, { id: 'later', firstName: 'Later unique patient' }], pagination: { hasMore: false } } };
  } });
  view.render(); await flush(view); fillManualReferral(view);
  await view.button('Load more patients').props.onClick(); await flush(view);
  assert.ok(view.button('Synthetic patient')); assert.ok(view.button('Retry patient search'));
  await view.button('Retry patient search').props.onClick(); await flush(view);
  assert.equal(view.find('button').filter(node => strings(node.props.children).includes('Synthetic patient')).length, 1);
  assert.ok(view.button('Later unique patient')); assert.equal(view.button('Retry patient search'), undefined);
  assert.equal(view.find('textarea').find(n => n.props.id === 'referral-reason').props.value, 'Synthetic new referral');
});

test('manual referral search rejects late responses after a newer query or account change', async () => {
  const pending = [], session = { current: 'A' };
  const view = manualReferralView({ get(url) { return Promise.resolve(manualReferralResponse(url)); }, post(url, body, options) {
    assert.equal(url, '/providers/me/patients/search'); assert.equal(options.params, undefined);
    const request = { ...deferred(), signal: options.signal }; pending.push(request); return request.promise;
  } }, { session, accountKey: 'A' });
  view.render(); await flush(view);
  const first = searchManualPatients(view, 'First'); const second = searchManualPatients(view, 'Second');
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve({ data: { success: true, patients: [{ id: 'second', firstName: 'Current result' }] } }); await second; await flush(view);
  pending[0].resolve({ data: { success: true, patients: [{ id: 'first', firstName: 'Obsolete result' }] } }); await first; await flush(view);
  assert.ok(view.button('Current result')); assert.equal(view.button('Obsolete result'), undefined);
  const third = searchManualPatients(view, 'Third'); session.current = 'B';
  pending[2].resolve({ data: { success: true, patients: [{ id: 'third', firstName: 'Prior account result' }] } }); await third; await flush(view);
  assert.equal(view.button('Prior account result'), undefined); view.unmount();
});

test('manual referral tracking identity survives pending, empty, failed and replaced patient searches', async () => {
  const patient = { id: 'patient-tracked', firstName: 'Synthetic', lastName: 'Identity' };
  const tracked = { id: 'tracked-referral', patient_user_id: patient.id, patient_display_name: 'Synthetic Identity', status: 'draft', reason: 'Synthetic tracking reason' };
  const searches = [];
  const search = () => { const pending = deferred(); searches.push(pending); return pending.promise; };
  const view = manualReferralView({
    get(url, options) {
      if (url === '/ng/clinical/referrals') return Promise.resolve({ data: { ok: true, referrals: [tracked] } });
      if (options?.params?.search) return search(); // Also reproduces the pre-fix GET behavior.
      return Promise.resolve({ data: { success: true, patients: [patient] } });
    },
    post(url) { assert.equal(url, '/providers/me/patients/search'); return search(); },
  });
  const heading = () => strings(view.find('h3')[0].props.children);
  view.render(); await flush(view); assert.equal(heading(), 'Synthetic Identity');
  view.find('textarea').find(node => node.props.id === 'referral-outcome-tracked-referral').props.onChange({ target: { value: 'Synthetic sending outcome' } }); view.render();
  const empty = searchManualPatients(view, 'No match'); view.render();
  assert.equal(heading(), 'Synthetic Identity', 'pending picker changes cannot strip tracking identity');
  searches[0].resolve({ data: { success: true, patients: [], pagination: { hasMore: false } } }); await empty; await flush(view);
  assert.equal(heading(), 'Synthetic Identity'); assert.equal(view.button('Record sending').props.disabled, false);
  const failure = searchManualPatients(view, 'Different search'); searches[1].reject(new Error('Synthetic offline')); await failure; await flush(view);
  assert.equal(heading(), 'Synthetic Identity'); assert.ok(view.button('Retry patient search'));
  const retry = view.button('Retry patient search').props.onClick(); searches[2].resolve({ data: { success: true, patients: [{ id: 'other', firstName: 'Other synthetic patient' }] } }); await retry; await flush(view);
  assert.equal(heading(), 'Synthetic Identity');
  const refresh = view.button('Refresh').props.onClick(); searches[3].resolve({ data: { success: true, patients: [] } }); await refresh; await flush(view);
  assert.equal(heading(), 'Synthetic Identity');
});

test('manual referral tracking names come from each referral, including patients outside every picker page', async () => {
  const view = manualReferralView({ async get(url) {
    return { data: url === '/providers/me/patients' ? { success: true, patients: [] } : { ok: true, referrals: [
      { id: 'later-ref', patient_user_id: 'later-patient', patient_display_name: 'Later page synthetic patient', status: 'sent' },
      { id: 'unknown-ref', patient_user_id: 'unknown-patient', patient_display_name: null, status: 'completed' },
    ] } };
  } });
  view.render(); await flush(view);
  assert.deepEqual(view.find('h3').map(node => strings(node.props.children)), ['Later page synthetic patient', 'Patient referral']);
});

test('manual referral patient search, later pages, retry and refresh keep names and emails out of request URLs', async () => {
  const term = 'Synthetic Patient synthetic@example.invalid', requests = []; let attempt = 0;
  const view = manualReferralView({
    async get(url, options) { requests.push({ url, options }); return manualReferralResponse(url); },
    async post(url, body, options) {
      requests.push({ url, body, options });
      if (++attempt === 2) throw new Error('Synthetic offline');
      return { data: { success: true, patients: [{ id: 'search-result', firstName: 'Synthetic result' }], pagination: { hasMore: attempt === 1 } } };
    },
  });
  view.render(); await flush(view); await searchManualPatients(view, term); await flush(view);
  await view.button('Load more patients').props.onClick(); await flush(view);
  await view.button('Retry patient search').props.onClick(); await flush(view);
  await view.button('Refresh').props.onClick(); await flush(view);
  const searched = requests.filter(request => request.body);
  assert.equal(searched.length, 4); assert.deepEqual(searched.map(request => request.body.page), [1, 2, 2, 1]);
  for (const request of searched) { assert.equal(request.body.search, term); assert.equal(request.url, '/providers/me/patients/search'); }
  for (const request of requests) assert.equal(JSON.stringify({ url: request.url, params: request.options?.params }).includes('Synthetic'), false);
});
