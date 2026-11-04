'use strict';
// Actual chart component, synthetic in-memory React and API, no database/network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('next/dist/build/swc');
const filename = path.join(__dirname, '../../app/(dashboard)/provider/encounters/[id]/page.js');
const output = transformSync(fs.readFileSync(filename, 'utf8'), { filename, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } }).code;
const revision = 'a'.repeat(64), nextRevision = 'b'.repeat(64);
const makeNote = (changes = {}) => ({ id: 'note-1', encounterId: 'enc-1', providerId: 'provider-1', revision, version: 1, createdAt: '2026-11-03T12:00:00Z', isSigned: false, subjective: 'Recorded subjective', objective: 'Recorded objective', assessment: 'Recorded assessment', plan: 'Recorded plan', physicalExam: 'Hidden physical exam', ...changes });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));
function all(tree, predicate) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(child => all(child, predicate)); return [...(predicate(tree) ? [tree] : []), ...all(tree.props?.children, predicate)]; }
function text(tree) { return !tree ? '' : typeof tree === 'string' ? tree : Array.isArray(tree) ? tree.map(text).join('') : text(tree.props?.children); }
function harness(options = {}) {
  const slots = [], effects = [], calls = [], messages = []; let cursor = 0, dirty = false, encounterId = 'enc-1', aiSuggestionId = options.aiSuggestionId || null;
  let stored = options.notes || [makeNote()];
  const react = {
    Suspense: 'Suspense',
    useState(value) { const index = cursor++; if (!slots[index]) slots[index] = { value }; return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; dirty = true; }]; },
    useRef(value) { const index = cursor++; return (slots[index] ??= { value: { current: value } }).value; },
    useMemo(fn, deps) { const index = cursor++; if (!slots[index] || deps.some((value, i) => value !== slots[index].deps[i])) slots[index] = { value: fn(), deps }; return slots[index].value; },
    useEffect(fn, deps) { const index = cursor++; if (!slots[index] || deps.some((value, i) => value !== slots[index].deps[i])) { const old = slots[index]; slots[index] = { deps }; effects.push(() => { old?.cleanup?.(); slots[index].cleanup = fn(); }); } },
  };
  const api = {
    getEncounter: async id => ({ data: { success: true, encounter: { id, patientId: 'patient-' + id } } }),
    getEncounterNotes: async () => ({ data: { success: true, notes: plain(stored) } }),
    getEncounterPrescriptionIntents: async () => ({ data: { success: true, prescriptionIntents: [] } }),
    updateNote: async (id, data) => { calls.push(['update', id, plain(data)]); const note = { ...stored.find(item => item.id === id), ...data, revision: nextRevision }; stored = stored.map(item => item.id === id ? note : item); return { data: { success: true, note } }; },
    createNote: async (id, data) => { calls.push(['create', id, plain(data)]); const note = makeNote({ ...data, id: 'new-note', encounterId: id, revision: nextRevision }); stored.push(note); return { data: { success: true, note } }; },
    signNote: async (id, data) => { calls.push(['sign', id, plain(data)]); const note = { ...stored.find(item => item.id === id), isSigned: true, isLocked: true, revision: nextRevision }; stored = stored.map(item => item.id === id ? note : item); return { data: { success: true, note } }; },
    amendNote: async (id, data) => { calls.push(['amend', id, plain(data)]); const note = makeNote({ ...data, id: 'amendment-1', noteType: 'amendment', version: 2, revision: nextRevision }); stored.push(note); return { data: { success: true, note } }; },
    getReviewedAiDraft: async () => ({ data: { success: true, aiSuggestionId, noteDraft: { noteType: 'soap', subjective: 'Reviewed import', objective: '', assessment: '', plan: '' } } }),
    ...options.api,
  };
  const element = (type, props) => ({ type, props });
  const dependencies = {
    react, 'react/jsx-runtime': { jsx: element, jsxs: element },
    'next/navigation': { useParams: () => ({ id: encounterId }), usePathname: () => '/provider/encounters/' + encounterId, useSearchParams: () => ({ get: () => aiSuggestionId }) },
    'next/link': { default: 'Link', __esModule: true }, '@/lib/api': { clinicalEhrAPI: api }, '@/components/ui/use-toast': { toast: value => messages.push(value) }, '@/lib/utils': { formatDateTime: String }, '@/lib/providerPortal': { toProviderPortalPath: value => value },
  };
  const sourceModule = { exports: {} }; vm.runInNewContext(output, { module: sourceModule, exports: sourceModule.exports, require(name) { return dependencies[name] || new Proxy({}, { get: (_, key) => key }); } });
  const component = sourceModule.exports.default().props.children.type;
  function render() { let tree; do { cursor = 0; dirty = false; tree = component(); effects.splice(0).forEach(effect => effect()); } while (dirty); return tree; }
  const button = label => all(render(), node => node.type === 'Button').find(node => text(node) === label);
  const fields = () => all(render(), node => node.type === 'Textarea').slice(0, 4);
  return { api, calls, messages, render, button, fields, stored: () => stored, setStored: value => { stored = value; }, edit(index, value) { fields()[index].props.onChange({ target: { value } }); render(); }, async ready() { render(); await settle(); render(); }, switchEncounter(id) { encounterId = id; render(); }, unmount() { slots.forEach(slot => slot.cleanup?.()); }, changeSource(id) { aiSuggestionId = id; render(); } };
}

test('hydrates newest note independently of server history order and only updates changed displayed SOAP fields', async () => {
  const view = harness({ notes: [makeNote({ id: 'old', version: 5, createdAt: '2026-11-01' }), makeNote({ id: 'newest' })] }); await view.ready();
  assert.deepEqual(view.fields().map(field => field.props.value), ['Recorded subjective', 'Recorded objective', 'Recorded assessment', 'Recorded plan']);
  assert.equal(view.button('Save Note').props.disabled, true);
  view.edit(0, 'Corrected subjective'); await view.button('Save Note').props.onClick();
  assert.deepEqual(view.calls, [['update', 'newest', { subjective: 'Corrected subjective', expectedRevision: revision }]]);
  assert.equal(view.stored().find(note => note.id === 'newest').physicalExam, 'Hidden physical exam');
  assert.equal(view.fields()[1].props.value, 'Recorded objective');
});

test('explicit clearing remains valid while untouched clinical content is retained', async () => {
  const view = harness(); await view.ready(); view.edit(2, ''); await view.button('Save Note').props.onClick();
  assert.deepEqual(view.calls[0][2], { assessment: '', expectedRevision: revision });
});

test('dirty notes cannot sign, saved content signs with its exact revision, and signed text is read-only', async () => {
  const view = harness(); await view.ready(); const staleSign = view.button('Sign').props.onClick;
  view.edit(0, 'Unsaved correction'); assert.equal(view.button('Sign').props.disabled, true); await staleSign(); assert.equal(view.calls.length, 0);
  await view.button('Save Note').props.onClick(); await view.button('Sign').props.onClick();
  assert.deepEqual(view.calls[1], ['sign', 'note-1', { expectedRevision: nextRevision }]);
  assert.equal(view.fields()[0].props.value, 'Unsaved correction'); assert.equal(view.fields()[0].props.disabled, true);
});

test('saving is single-flight, excludes signing, and preserves edits typed after submission', async () => {
  const pending = deferred(); const calls = [];
  const view = harness({ api: { updateNote: (id, data) => { calls.push([id, plain(data)]); return pending.promise; } } }); await view.ready();
  view.edit(0, 'Submitted'); const save = view.button('Save Note').props.onClick; const first = save(); await save(); await view.button('Sign').props.onClick();
  assert.equal(calls.length, 1); assert.equal(view.calls.length, 0);
  view.edit(0, 'Newer local typing'); pending.resolve({ data: { success: true, note: makeNote({ subjective: 'Submitted', revision: nextRevision }) } }); await first;
  assert.equal(view.fields()[0].props.value, 'Newer local typing'); assert.equal(view.button('Sign').props.disabled, true);
  assert.equal(view.button('Save Note').props.disabled, false);
});

test('signature is single-flight and blocks a stale save handler', async () => {
  const pending = deferred(); let signs = 0;
  const view = harness({ api: { signNote: () => { signs++; return pending.promise; } } }); await view.ready();
  const save = view.button('Save Note').props.onClick, sign = view.button('Sign').props.onClick;
  const first = sign(); await sign(); await save(); assert.equal(signs, 1); assert.equal(view.calls.length, 0);
  pending.resolve({ data: { success: true, note: makeNote({ isSigned: true, revision: nextRevision }) } }); await first;
});

test('conflicts preserve draft and old revision until explicit successful reload; failed reload preserves it too', async () => {
  const view = harness({ api: { updateNote: async () => { throw { response: { status: 409, data: { code: 'CLINICAL_NOTE_REVISION_CONFLICT' } } }; } } }); await view.ready();
  view.edit(0, 'My retained work'); await view.button('Save Note').props.onClick(); assert.equal(view.fields()[0].props.value, 'My retained work');
  const normalRead = view.api.getEncounterNotes; view.api.getEncounterNotes = async () => { throw new Error('Read failure'); };
  await view.button('Discard edits and reload saved note').props.onClick(); await settle(); assert.equal(view.fields()[0].props.value, 'My retained work');
  view.api.getEncounterNotes = normalRead; view.setStored([makeNote({ subjective: 'Other tab saved', revision: nextRevision })]);
  await view.button('Discard edits and reload saved note').props.onClick(); await settle(); assert.equal(view.fields()[0].props.value, 'Other tab saved');
});

test('no revision token means existing note cannot be edited or signed through handlers', async () => {
  const view = harness({ notes: [makeNote({ revision: undefined })] }); await view.ready(); view.edit(0, 'Correction');
  assert.equal(view.button('Save Note').props.disabled, true); assert.equal(view.button('Sign').props.disabled, true);
  await view.button('Save Note').props.onClick(); await view.button('Sign').props.onClick(); assert.equal(view.calls.length, 0);
});

test('encounter switch and unmount ignore late save success and preserve new encounter identity', async () => {
  const pending = deferred(); const view = harness({ api: { updateNote: () => pending.promise } }); await view.ready(); view.edit(0, 'Old draft'); const first = view.button('Save Note').props.onClick();
  view.setStored([makeNote({ id: 'other-note', encounterId: 'enc-2', subjective: 'Other patient text' })]); view.switchEncounter('enc-2'); await settle();
  pending.resolve({ data: { success: true, note: makeNote({ subjective: 'Old draft', revision: nextRevision }) } }); await first;
  assert.equal(view.fields()[0].props.value, 'Other patient text'); assert.equal(view.messages.filter(message => /Note updated/.test(message.title)).length, 0);
  const later = deferred(); view.api.updateNote = () => later.promise; view.edit(0, 'Unmounted change'); const second = view.button('Save Note').props.onClick(); view.unmount();
  later.resolve({ data: { success: true, note: makeNote({ revision: nextRevision }) } }); await second;
  assert.equal(view.messages.filter(message => /Note updated/.test(message.title)).length, 0);
});

test('newer same-encounter reload wins, and typing during reload is never overwritten', async () => {
  const view = harness(); await view.ready(); const first = deferred(), second = deferred(); let reads = 0;
  view.api.getEncounterNotes = () => (++reads === 1 ? first : second).promise;
  const reload = view.button('Discard edits and reload saved note').props.onClick; reload(); reload();
  second.resolve({ data: { success: true, notes: [makeNote({ subjective: 'Newest response' })] } }); await settle();
  first.resolve({ data: { success: true, notes: [makeNote({ subjective: 'Stale response' })] } }); await settle(); assert.equal(view.fields()[0].props.value, 'Newest response');
  const third = deferred(); view.api.getEncounterNotes = () => third.promise; view.button('Discard edits and reload saved note').props.onClick(); view.edit(0, 'Typed while reading');
  third.resolve({ data: { success: true, notes: [makeNote({ subjective: 'Late read' })] } }); await settle(); assert.equal(view.fields()[0].props.value, 'Typed while reading');
});

test('reviewed import is explicitly a new note with provenance and never overwrites an existing note', async () => {
  const view = harness({ aiSuggestionId: 'reviewed-source' }); await view.ready(); await view.button('Load reviewed AI draft').props.onClick();
  assert.equal(view.fields()[0].props.value, 'Recorded subjective');
  view.button('New Note').props.onClick(); await view.button('Load reviewed AI draft').props.onClick(); assert.equal(view.fields()[0].props.value, 'Reviewed import');
  assert.equal(view.button('Sign'), undefined); await view.button('Save Note').props.onClick();
  assert.equal(view.calls[0][0], 'create'); assert.equal(view.calls[0][2].aiSuggestionId, 'reviewed-source'); assert.equal(view.stored()[0].subjective, 'Recorded subjective');
});


test('amendment becomes the exact editable and signable selected note, without changing signed source', async () => {
  const view = harness({ notes: [makeNote({ isSigned: true, isLocked: true })] }); await view.ready();
  view.button('Amend').props.onClick(); let tree = view.render();
  const reason = all(tree, node => node.type === 'Input' && node.props.value === '')[0];
  // The amendment reason input is identified by its required reason placeholder.
  const reasonInput = all(tree, node => node.type === 'Textarea' || node.type === 'Input').find(node => /reason|correct|amend/i.test(node.props.placeholder || '')) || reason;
  reasonInput.props.onChange({ target: { value: 'Documented correction' } }); view.render();
  await view.button('Create Amendment').props.onClick();
  assert.equal(view.button('Sign').props.disabled, false);
  view.edit(0, 'Amended text'); await view.button('Save Note').props.onClick();
  assert.equal(view.calls[1][1], 'amendment-1'); assert.equal(view.stored()[0].subjective, 'Recorded subjective');
});

test('new note mode never displays or targets the previous note and creates only once in flight', async () => {
  const pending = deferred(); let creates = 0;
  const view = harness({ api: { createNote: () => { creates++; return pending.promise; } } }); await view.ready(); view.button('New Note').props.onClick();
  assert.equal(view.button('Sign'), undefined); assert.equal(view.button('Amend'), undefined);
  view.edit(0, 'New note'); const save = view.button('Save Note').props.onClick; const first = save(); await save(); assert.equal(creates, 1);
  pending.resolve({ data: { success: true, note: makeNote({ id: 'created-note', revision: nextRevision }) } }); await first;
  assert.equal(view.button('Sign').props.disabled, false);
});

test('a reload containing a newer unrelated note never retargets the bound editor', async () => {
  const view = harness(); await view.ready(); view.edit(0, 'First correction');
  view.api.getEncounterNotes = async () => ({ data: { success: true, notes: [makeNote(), makeNote({ id: 'different-note', createdAt: '2026-11-04', subjective: 'Different note' })] } });
  await view.button('Save Note').props.onClick();
  assert.equal(view.fields()[0].props.value, 'First correction');
  view.edit(1, 'Second correction'); await view.button('Save Note').props.onClick();
  assert.equal(view.calls[1][1], 'note-1'); assert.deepEqual(view.calls[1][2], { objective: 'Second correction', expectedRevision: nextRevision });
});

test('failed saves retain clinical text and leave signing disabled without automatic retries', async () => {
  let attempts = 0; const view = harness({ api: { updateNote: async () => { attempts++; throw new Error('Synthetic transport failure'); } } }); await view.ready();
  view.edit(3, 'Retain this plan'); await view.button('Save Note').props.onClick();
  assert.equal(view.fields()[3].props.value, 'Retain this plan'); assert.equal(view.button('Sign').props.disabled, true); assert.equal(attempts, 1);
});
