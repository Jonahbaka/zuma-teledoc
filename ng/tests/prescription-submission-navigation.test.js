'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('next/dist/build/swc');

const sourcePath = path.resolve(__dirname, '../../components/provider/PatientPrescriptionSubmissions.jsx');
const compiled = transformSync(fs.readFileSync(sourcePath, 'utf8'), {
  filename: sourcePath,
  jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
  module: { type: 'commonjs' },
}).code;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Execute the actual component's async handlers with a deterministic hook
// scheduler. No JSX/text matching substitutes for the navigation race itself.
function componentHarness() {
  const slots = [];
  const requests = [];
  const effects = [];
  let cursor = 0;
  let dirty = false;
  let tree;
  let currentPatient;
  let updates = 0;
  const Button = Symbol('Button');
  const Dialog = Symbol('Dialog');
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = {
        value: typeof initial === 'function' ? initial() : initial,
        set(value) { this.value = typeof value === 'function' ? value(this.value) : value; dirty = true; updates += 1; },
      };
      const slot = slots[index];
      return [slot.value, (value) => slot.set(value)];
    },
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || dependencies.some((value, offset) => value !== previous.dependencies[offset])) {
        const next = { dependencies, cleanup: null };
        slots[index] = next;
        effects.push(() => { previous?.cleanup?.(); next.cleanup = effect(); });
      }
    },
  };
  const api = { get(url) { const request = { url, ...deferred() }; requests.push(request); return request.promise; } };
  const componentModule = { exports: {} };
  const jsxRuntime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
  const dependencies = {
    react,
    'react/jsx-runtime': jsxRuntime,
    'next/image': { __esModule: true, default: Symbol('Image') },
    '@/lib/api': { __esModule: true, default: api },
    '@/components/ui/button': { Button },
    '@/components/ui/dialog': { Dialog, DialogContent: Symbol('DialogContent'), DialogDescription: Symbol('DialogDescription'), DialogHeader: Symbol('DialogHeader'), DialogTitle: Symbol('DialogTitle') },
    '@/lib/utils': { formatDateTime: (value) => value },
  };
  vm.runInNewContext(compiled, {
    exports: componentModule.exports,
    module: componentModule,
    require(name) { assert.ok(name in dependencies, `Unexpected component dependency: ${name}`); return dependencies[name]; },
  });
  const Component = componentModule.exports.default;
  function render(patientId = currentPatient) {
    currentPatient = patientId;
    do {
      dirty = false;
      cursor = 0;
      tree = Component({ patientId });
      const pending = effects.splice(0);
      for (const effect of pending) effect();
    } while (dirty);
    return tree;
  }
  function find(type, node, found = []) {
    if (!node || typeof node !== 'object') return found;
    if (Array.isArray(node)) { for (const child of node) find(type, child, found); return found; }
    if (node.type === type) found.push(node);
    find(type, node.props?.children, found);
    return found;
  }
  return {
    render,
    requests,
    viewButtons: () => find(Button, tree).filter((node) => node.props.children === 'View submission'),
    dialog: () => find(Dialog, tree)[0],
    content: () => JSON.stringify(tree),
    updateCount: () => updates,
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

async function flush(harness) { await new Promise((resolve) => setImmediate(resolve)); harness.render(); }
function listResponse(items) { return { data: { success: true, submissions: items.map((id) => ({ id, status: 'uploaded', has_text: true, created_at: '2099-01-01' })) } }; }
function documentResponse(id, text) { return { data: { success: true, submission: { id, status: 'uploaded', text } } }; }

test('a late old-patient document response cannot open against the next patient chart', async () => {
  const harness = componentHarness();
  harness.render('patient-a');
  harness.requests[0].resolve(listResponse(['submission-a'])); await flush(harness);
  const opening = harness.viewButtons()[0].props.onClick();
  const oldDocument = harness.requests[1];
  harness.render('patient-b');
  harness.requests[2].resolve(listResponse(['submission-b'])); await flush(harness);
  oldDocument.resolve(documentResponse('submission-a', 'Private instructions for patient A'));
  await opening; await flush(harness);
  assert.equal(harness.dialog().props.open, false);
  assert.equal(harness.content().includes('Private instructions for patient A'), false);
  assert.equal(harness.viewButtons().length, 1);
  const currentOpening = harness.viewButtons()[0].props.onClick();
  assert.ok(harness.requests[3].url.includes('/patient-b/'));
  harness.requests[3].resolve(documentResponse('submission-b', 'Instructions for patient B'));
  await currentOpening; await flush(harness);
  assert.equal(harness.dialog().props.open, true);
  assert.equal(harness.content().includes('Instructions for patient B'), true);
});

test('already opened PHI and a stale failed request are cleared when the chart changes', async () => {
  const harness = componentHarness();
  harness.render('patient-a'); harness.requests[0].resolve(listResponse(['submission-a'])); await flush(harness);
  let opening = harness.viewButtons()[0].props.onClick();
  harness.requests[1].resolve(documentResponse('submission-a', 'Private instructions for patient A'));
  await opening; await flush(harness);
  assert.equal(harness.dialog().props.open, true);
  opening = harness.viewButtons()[0].props.onClick();
  const stale = harness.requests[2];
  harness.render('patient-b');
  assert.equal(harness.dialog().props.open, false);
  assert.equal(harness.content().includes('Private instructions for patient A'), false);
  stale.reject(new Error('Old chart document request failed'));
  await opening; await flush(harness);
  assert.equal(harness.content().includes('This submission could not be opened.'), false);
});

test('a late old-patient list does not replace the current chart submission list', async () => {
  const harness = componentHarness();
  harness.render('patient-a'); const oldList = harness.requests[0];
  harness.render('patient-b'); harness.requests[1].resolve(listResponse(['submission-b'])); await flush(harness);
  oldList.resolve(listResponse(['submission-a', 'submission-a2'])); await flush(harness);
  assert.equal(harness.viewButtons().length, 1);
  const opening = harness.viewButtons()[0].props.onClick();
  assert.ok(harness.requests[2].url.endsWith('/patient-b/prescription-submissions/submission-b'));
  harness.requests[2].resolve(documentResponse('submission-b', 'Instructions for patient B'));
  await opening; await flush(harness);
});

test('out-of-order document requests preserve the latest document selection', async () => {
  const harness = componentHarness();
  harness.render('patient-a'); harness.requests[0].resolve(listResponse(['submission-a', 'submission-a2'])); await flush(harness);
  const buttons = harness.viewButtons();
  const firstOpening = buttons[0].props.onClick();
  const secondOpening = buttons[1].props.onClick();
  harness.requests[2].resolve(documentResponse('submission-a2', 'Latest selected instructions'));
  await secondOpening; await flush(harness);
  harness.requests[1].resolve(documentResponse('submission-a', 'Earlier selected instructions'));
  await firstOpening; await flush(harness);
  assert.equal(harness.dialog().props.open, true);
  assert.equal(harness.content().includes('Latest selected instructions'), true);
  assert.equal(harness.content().includes('Earlier selected instructions'), false);
});

test('late document and list responses do not update state after component unmount', async () => {
  const harness = componentHarness();
  harness.render('patient-a'); harness.requests[0].resolve(listResponse(['submission-a'])); await flush(harness);
  const opening = harness.viewButtons()[0].props.onClick();
  harness.unmount();
  const before = harness.updateCount();
  harness.requests[1].resolve(documentResponse('submission-a', 'Unmounted patient document'));
  await opening; await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.updateCount(), before);
  const second = componentHarness();
  second.render('patient-a'); second.unmount(); const listBefore = second.updateCount();
  second.requests[0].resolve(listResponse(['submission-a'])); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(second.updateCount(), listBefore);
});
