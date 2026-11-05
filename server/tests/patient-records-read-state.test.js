'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('next/dist/build/swc');
const filename = path.join(__dirname, '../../app/(dashboard)/patient/records/page.js');
const compiled = transformSync(fs.readFileSync(filename, 'utf8'), { filename, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } }).code;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
const note = (encounterId, assessment) => ({ id: 'note-' + encounterId, encounterId, assessment, noteType: 'soap', isSigned: true });
const response = notes => ({ data: { success: true, notes } });
function all(tree, predicate) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(child => all(child, predicate)); return [...(predicate(tree) ? [tree] : []), ...all(tree.props?.children, predicate)]; }
function text(tree) { return tree == null ? '' : typeof tree === 'string' ? tree : Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children); }
function harness() {
  const slots = [], effects = [], writes = []; let cursor = 0, dirty = false, unmounted = false;
  const react = {
    useState(value) { const index = cursor++; if (!slots[index]) slots[index] = { value }; return [slots[index].value, next => { if (unmounted) writes.push(index); slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; dirty = true; }]; },
    useRef(value) { const index = cursor++; return (slots[index] ??= { value: { current: value } }).value; },
    useEffect(fn, deps) { const index = cursor++; if (!slots[index] || deps.some((value, i) => value !== slots[index].deps[i])) { const old = slots[index]; slots[index] = { deps }; effects.push(() => { old?.cleanup?.(); slots[index].cleanup = fn(); }); } },
  };
  const api = {
    getPatientEncounters: async () => ({ data: { success: true, encounters: [{ id: 'enc-a', encounterType: 'visit A' }, { id: 'enc-b', encounterType: 'visit B' }] } }),
    getConsents: async () => ({ data: { success: true, consents: [] } }),
    getEncounterNotes: async id => response([note(id, 'Content ' + id)]),
  };
  const element = (type, props) => ({ type, props });
  const dependencies = {
    react, 'react/jsx-runtime': { jsx: element, jsxs: element },
    '@/lib/api': { __esModule: true, default: { get: async url => url === '/auth/me' ? { data: { user: { id: 'patient-a' } } } : { data: { success: true, records: [] } } }, clinicalEhrAPI: api },
    '@/lib/utils': { formatDateTime: String }, '@/components/ui/use-toast': { toast() {} },
  };
  const mod = { exports: {} };
  vm.runInNewContext(compiled, { module: mod, exports: mod.exports, require(name) { return dependencies[name] || new Proxy({}, { get: (_, key) => key }); } });
  function render() { let tree; do { cursor = 0; dirty = false; tree = mod.exports.default(); effects.splice(0).forEach(effect => effect()); } while (dirty); return tree; }
  return { api, writes, render, text: () => text(render()), async ready() { render(); await settle(); render(); }, click(index) { return all(render(), node => node.type === 'button')[index].props.onClick(); }, unmount() { unmounted = true; slots.forEach(slot => slot.cleanup?.()); }, retry() { return all(render(), node => node.type === 'Button').find(node => text(node) === 'Retry visit notes').props.onClick(); } };
}

test('switching visits clears prior notes; failure stays distinct from an empty clinical record', async () => {
  const view = harness(); await view.ready(); await view.click(0);
  assert.match(view.text(), /Content enc-a/);
  const pending = deferred(); view.api.getEncounterNotes = () => pending.promise;
  const next = view.click(1); assert.doesNotMatch(view.text(), /Content enc-a/);
  pending.reject(new Error('Network failure')); await next;
  assert.match(view.text(), /These visit notes could not be loaded/);
  assert.doesNotMatch(view.text(), /Content enc-a|No notes found/);
  view.api.getEncounterNotes = async id => response([note(id, 'Recovered B')]); await view.retry();
  assert.match(view.text(), /Recovered B/); assert.doesNotMatch(view.text(), /could not be loaded/);
});

test('out-of-order requests cannot replace the selected visit or end its loading state', async () => {
  const view = harness(); await view.ready(); const old = deferred(), recent = deferred();
  view.api.getEncounterNotes = id => id === 'enc-a' ? old.promise : recent.promise;
  const first = view.click(0), second = view.click(1);
  old.resolve(response([note('enc-a', 'Stale A')])); await first;
  assert.doesNotMatch(view.text(), /Stale A|No notes found/);
  recent.resolve(response([note('enc-b', 'Current B')])); await second;
  assert.match(view.text(), /Current B/); assert.doesNotMatch(view.text(), /Stale A/);
});

test('late failure cannot overwrite a successful newer visit', async () => {
  const view = harness(); await view.ready(); const old = deferred();
  view.api.getEncounterNotes = id => id === 'enc-a' ? old.promise : Promise.resolve(response([note('enc-b', 'Current B')]));
  const first = view.click(0); await view.click(1); old.reject(new Error('Old failure')); await first;
  assert.match(view.text(), /Current B/); assert.doesNotMatch(view.text(), /could not be loaded/);
});

test('wrong-encounter payload and unsuccessful responses never render clinical text', async () => {
  const view = harness(); await view.ready();
  view.api.getEncounterNotes = async () => response([note('enc-other', 'Wrong patient content')]);
  await view.click(0); assert.doesNotMatch(view.text(), /Wrong patient content/); assert.match(view.text(), /could not be loaded/);
  view.api.getEncounterNotes = async () => ({ data: { success: false, notes: [] } });
  await view.retry(); assert.match(view.text(), /could not be loaded/); assert.doesNotMatch(view.text(), /No notes found/);
});

test('unmount invalidates in-flight note updates', async () => {
  const view = harness(); await view.ready(); const pending = deferred();
  view.api.getEncounterNotes = () => pending.promise;
  const reading = view.click(0); view.unmount(); pending.resolve(response([note('enc-a', 'Late text')])); await reading;
  assert.deepEqual(view.writes, []);
});
