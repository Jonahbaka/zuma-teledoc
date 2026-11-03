'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('next/dist/build/swc');
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function harness(api) {
  const slots = [], effects = []; let cursor = 0, dirty = false;
  const react = {
    useState(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: initial }; return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; dirty = true; }]; },
    useCallback(callback) { const index = cursor++; if (!slots[index]) slots[index] = { value: callback }; return slots[index].value; },
    useRef(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: { current: initial } }; return slots[index].value; },
    useEffect(callback) { const index = cursor++; if (!slots[index]) { slots[index] = { effect: callback }; effects.push(() => { slots[index].cleanup = callback(); }); } },
  };
  const filename = path.join(__dirname, '../../app/ng/pharmacy/prescriptions/page.js');
  const source = fs.readFileSync(filename, 'utf8');
  const output = transformSync(source, { filename, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } }).code;
  const element = (type, props) => ({ type, props }); const runtime = { jsx: element, jsxs: element };
  const dependencies = {
    react, 'react/jsx-runtime': runtime, '@/lib/api': { default: api },
    '@/lib/ngPharmacyPortal': { fetchNigeriaPharmacyWorkspace: async () => ({ id: 'approved-pharmacy' }), formatNaira: value => String(value), getNigeriaStatusTone: () => 'status' },
    '@/components/providers/AuthProvider': { useAuth: () => ({}) },
    '@/components/ng/delivery/PharmacyMedicationOrder': { default: 'Fulfillment' },
    '@/components/ng/delivery/DeliveryPresentation': { DeliveryLoading: 'Loading', DeliveryNotice: 'Notice', DeliveryStatus: 'Status', deliveryButtonClass: 'button' },
    '@/components/ng/NigeriaPharmacyPortalShell': { default: 'Shell' },
    '@/components/ui/button': { Button: 'Button' }, '@/components/ui/card': { Card: 'Card', CardContent: 'CardContent' },
  };
  for (const dependency of Object.values(dependencies)) if (dependency.default) dependency.__esModule = true;
  const sourceModule = { exports: {} }; vm.runInNewContext(output, { module: sourceModule, exports: sourceModule.exports, require(name) { assert.ok(dependencies[name], name); return dependencies[name]; } });
  return {
    render() { let tree; do { cursor = 0; dirty = false; tree = sourceModule.exports.default(); for (const effect of effects.splice(0)) effect(); } while (dirty); return tree; },
    unmount() { for (const slot of slots) slot.cleanup?.(); },
    restartEffects() { for (const slot of slots) if (slot.effect) { slot.cleanup?.(); slot.cleanup = slot.effect(); } },
  };
}
function all(tree, predicate) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(child => all(child, predicate)); return [...(predicate(tree) ? [tree] : []), ...all(tree.props?.children, predicate)]; }
const settle = () => new Promise(resolve => setImmediate(resolve));
const row = { id: 'rx-1', items: [], lifecycle_status: 'sent_to_pharmacy', pharmacy_response_status: 'pending_pharmacy_confirmation', confirmed_price_ngn: '500.00', pharmacy_notes: 'Existing clinical note' };
test('prescription updates are single-flight, preserve untouched fields and disable premature fulfillment', async () => {
  const pending = deferred(); const writes = [];
  const view = harness({ get: async () => ({ data: [row] }), patch(...args) { writes.push(args); return pending.promise; } });
  view.render(); await settle(); const tree = view.render();
  const buttons = all(tree, node => node.type === 'Button');
  assert.equal(buttons.find(button => button.props.children === 'Fulfilled').props.disabled, true);
  const accept = buttons.find(button => button.props.children === 'Accept');
  const first = accept.props.onClick(); await accept.props.onClick(); assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0][1])), { status: 'accepted' });
  assert.ok(all(view.render(), node => node.type === 'Button').every(button => button.props.disabled));
  pending.resolve({ data: {} }); await first;
  assert.equal(all(view.render(), node => node.type === 'Button').find(button => button.props.children === 'Accept').props.disabled, false);
  view.unmount();
});
test('leaving the prescription page ignores late updates without reloading or applying success', async () => {
  const pending = deferred(); let reads = 0;
  const view = harness({ get: async () => { reads++; return { data: [row] }; }, patch: () => pending.promise });
  view.render(); await settle(); const tree = view.render();
  const update = all(tree, node => node.type === 'Button').find(button => button.props.children === 'Accept').props.onClick();
  view.unmount(); pending.resolve({ data: {} }); await update; assert.equal(reads, 1);
});
test('completed and cancelled responses expose no reopening controls', async () => {
  for (const status of ['fulfilled', 'cancelled']) {
    const view = harness({ get: async () => ({ data: [{ ...row, pharmacy_response_status: status }] }) });
    view.render(); await settle(); assert.ok(all(view.render(), node => node.type === 'Button').every(button => button.props.disabled)); view.unmount();
  }
});
test('a superseded page load cannot overwrite a newer prescription response', async () => {
  const late = deferred(); let reads = 0;
  const view = harness({ get: async () => ++reads === 1 ? late.promise : { data: [{ ...row, pharmacy_response_status: 'accepted' }] } });
  view.render(); await settle(); view.restartEffects(); await settle();
  assert.equal(all(view.render(), node => node.type === 'span' && node.props.children === 'accepted').length, 1);
  late.resolve({ data: [row] }); await settle();
  assert.equal(all(view.render(), node => node.type === 'span' && node.props.children === 'accepted').length, 1);
  view.unmount();
});
