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
    useRef(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: { current: initial } }; return slots[index].value; },
    useEffect(callback) { const index = cursor++; if (!slots[index]) { slots[index] = {}; effects.push(() => { slots[index].cleanup = callback(); }); } },
  };
  const filename = path.join(__dirname, '../../app/ng/pharmacy/orders/page.js');
  const source = fs.readFileSync(filename, 'utf8').replace('function PharmacyOrdersWorkspace()', 'export function PharmacyOrdersWorkspace()');
  const output = transformSync(source, { filename, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } }).code;
  const element = (type, props) => ({ type, props }); const runtime = { jsx: element, jsxs: element };
  const dependencies = {
    react, 'react/jsx-runtime': runtime, '@/lib/api': { default: api },
    '@/lib/ngPharmacyPortal': { fetchNigeriaPharmacyWorkspace: async () => ({ id: 'approved-pharmacy' }) },
    '@/components/providers/AuthProvider': { useAuth: () => ({}) },
    '@/components/ng/delivery/PharmacyMedicationOrder': { default: 'Fulfillment' },
    '@/components/ng/delivery/DeliveryPresentation': { DeliveryLoading: 'Loading', DeliveryNotice: 'Notice', DeliveryStatus: 'Status', deliveryButtonClass: 'button' },
    '@/components/ng/NigeriaPharmacyPortalShell': { default: 'Shell' },
    '@/components/ui/button': { Button: 'Button' }, '@/components/ui/card': { Card: 'Card', CardContent: 'CardContent' },
  };
  for (const dependency of Object.values(dependencies)) if (dependency.default) dependency.__esModule = true;
  const sourceModule = { exports: {} }; vm.runInNewContext(output, { module: sourceModule, exports: sourceModule.exports, require(name) { assert.ok(dependencies[name], name); return dependencies[name]; } });
  return {
    render() { let tree; do { cursor = 0; dirty = false; tree = sourceModule.exports.PharmacyOrdersWorkspace(); for (const effect of effects.splice(0)) effect(); } while (dirty); return tree; },
    unmount() { for (const slot of slots) slot.cleanup?.(); },
  };
}
function all(tree, predicate) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(child => all(child, predicate)); return [...(predicate(tree) ? [tree] : []), ...all(tree.props?.children, predicate)]; }
const settle = () => new Promise(resolve => setImmediate(resolve));
const row = { id: 'request-1', medicine_name: 'Requested medicine', status: 'pending_pharmacy_confirmation' };
test('availability response duplicate clicks are single-flight and no completion shortcut renders', async () => {
  const pending = deferred(); const writes = [];
  const view = harness({ get: async url => ({ data: url.endsWith('medication-requests') ? [row] : [] }), patch(...args) { writes.push(args); return pending.promise; } });
  view.render(); await settle(); const tree = view.render();
  const buttons = all(tree, node => node.type === 'Button');
  assert.equal(buttons.some(button => /Complete|Fulfilled/.test(button.props.children)), false);
  const available = buttons.find(button => button.props.children.includes('Confirm Available'));
  const first = available.props.onClick(); const second = available.props.onClick();
  await second; assert.equal(writes.length, 1);
  assert.ok(all(view.render(), node => node.type === 'Button' && /Confirm Available|Review Request|Mark Unavailable|Request Clarification/.test(node.props.children)).every(button => button.props.disabled));
  pending.resolve({ data: { request: { ...row, status: 'available' } } }); await first;
  assert.equal(all(view.render(), node => node.type === 'Button').find(button => button.props.children.includes('Confirm Available')).props.disabled, false);
  view.unmount();
});
test('leaving the pharmacy workspace during an update never reloads or applies its late result', async () => {
  const pending = deferred(); let reads = 0;
  const view = harness({ get: async url => { reads++; return { data: url.endsWith('medication-requests') ? [row] : [] }; }, patch: () => pending.promise });
  view.render(); await settle(); const tree = view.render();
  const update = all(tree, node => node.type === 'Button').find(button => button.props.children.includes('Confirm Available')).props.onClick();
  view.unmount(); pending.resolve({ data: { request: { ...row, status: 'available' } } }); await update;
  assert.equal(reads, 2);
});
