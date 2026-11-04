'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('next/dist/build/swc');
const continuity = require('../../lib/patientAppointments.cjs');
const appointment = { id: 'synthetic-visit', providerFirstName: 'Synthetic clinician', status: 'in_progress', type: 'video', scheduledAt: '2026-01-01' };
const response = (rows) => ({ data: { success: true, appointments: rows } });
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function text(node) { return Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' ? node : node?.props ? text(node.props.children) : ''; }

function harness(filename, appointmentsAPI, detail = appointment) {
  let cursor = 0, dirty = false, tree;
  const slots = [], effects = [], listeners = new Map();
  const react = {
    useState(initial) { const i = cursor++; slots[i] ||= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; dirty = true; }]; },
    useEffect(callback, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((v, j) => v !== old.deps[j])) { const next = { deps }; slots[i] = next; effects.push(() => { old?.cleanup?.(); next.cleanup = callback(); }); } },
    useMemo(callback, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((v, j) => v !== old.deps[j])) slots[i] = { deps, value: callback() }; return slots[i].value; },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const dependencies = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'next/link': { __esModule: true, default: 'a' },
    'next/navigation': { useParams: () => ({ id: appointment.id }), useRouter: () => ({ push() {} }) },
    'lucide-react': new Proxy({}, { get: (_, key) => Symbol(key) }),
    '@/lib/api': { __esModule: true, appointmentsAPI, default: { get: async () => ({ data: { success: true, appointment: detail } }) } },
    '@/lib/patientAppointments.cjs': continuity,
    '@/components/ui/button': { Button: 'button' }, '@/components/ui/input': { Input: 'input' },
    '@/components/ui/card': { Card: 'section', CardContent: 'div', CardHeader: 'header', CardTitle: 'h2', CardDescription: 'p' },
    '@/components/ui/use-toast': { toast() {} },
    '@/components/branding/PortalPageHeader': { __esModule: true, default: 'header' },
    '@/lib/utils': { formatDateTime: String, formatDate: String },
  };
  const source = path.resolve(__dirname, '../..', filename);
  const compiled = transformSync(fs.readFileSync(source, 'utf8'), { filename: source, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } }).code;
  const mod = { exports: {} };
  vm.runInNewContext(compiled, { module: mod, exports: mod.exports, require(name) { assert.ok(name in dependencies, name); return dependencies[name]; }, document: { visibilityState: 'visible', addEventListener(name, listener) { listeners.set(name, listener); }, removeEventListener(name) { listeners.delete(name); } }, console });
  const view = {
    render() { do { cursor = 0; dirty = false; tree = mod.exports.default(); for (const effect of effects.splice(0)) effect(); } while (dirty); },
    find(type) { const matches = []; function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; if (node.type === type) matches.push(node); walk(node.props?.children); } walk(tree); return matches; },
    button(label) { return view.find('button').find(node => text(node.props.children).trim() === label); },
    text: () => text(tree),
    unmount() { for (const slot of slots) slot.cleanup?.(); },
    returnToPage() { listeners.get('visibilitychange')?.(); view.render(); },
  };
  return view;
}
async function flush(view) { await new Promise(resolve => setImmediate(resolve)); view.render(); }
const pages = ['app/(dashboard)/patient/appointments/page.js', 'app/ng/patient/appointments/page.js'];

test('active video navigation matches the server status allowlist', () => {
  for (const status of ['scheduled', 'confirmed', 'in_progress']) assert.equal(continuity.canOpenVideoVisit({ ...appointment, status }), true);
  for (const status of ['completed', 'cancelled', 'no_show', 'provider_reviewing', 'pharmacy_reviewing', 'unknown', '', null, undefined]) assert.equal(continuity.canOpenVideoVisit({ ...appointment, status }), false, String(status));
  assert.equal(continuity.canOpenVideoVisit({ ...appointment, type: 'phone' }), false);
  assert.equal(continuity.canOpenVideoVisit(null), false);
});

for (const filename of pages) {
  test(`${filename}: Upcoming requests its dedicated current-visit endpoint`, async () => {
    const reads = [];
    const rows = ['scheduled', 'confirmed', 'in_progress'].map(status => ({ ...appointment, id: status, status, providerFirstName: status }));
    const view = harness(filename, { getAll: async params => { reads.push(['all', params]); return response([]); }, getUpcoming: async limit => { reads.push(['upcoming', limit]); return response(rows); } });
    view.render(); await flush(view);
    view.button('Upcoming').props.onClick(); view.render(); await flush(view);
    assert.deepEqual(reads, [['all', undefined], ['upcoming', 50]]);
    for (const status of ['scheduled', 'confirmed', 'in_progress']) assert.ok(view.text().includes(status));
    if (filename.startsWith('app/ng/')) assert.ok(view.button('Return to Call'));
    view.unmount();
  });
  test(`${filename}: a failed list is retryable, not mistaken for no appointments`, async () => {
    let reads = 0;
    const view = harness(filename, { getAll: async () => { if (++reads === 1) throw new Error('synthetic outage'); return response([appointment]); } });
    view.render(); await flush(view);
    assert.ok(view.text().includes('Visits could not be loaded'));
    assert.equal(view.text().includes('No appointments found'), false);
    assert.equal(view.text().includes('No consultations matched'), false);
    view.button('Try again').props.onClick(); view.render(); await flush(view);
    assert.ok(view.text().includes(appointment.providerFirstName));
    assert.equal(view.button('Try again'), undefined);
    view.unmount();
  });
  test(`${filename}: late prior-filter responses cannot replace the current view`, async () => {
    const old = deferred();
    const view = harness(filename, { getAll: () => old.promise, getUpcoming: async () => response([appointment]) });
    view.render(); view.button('Upcoming').props.onClick(); view.render(); await flush(view);
    old.resolve(response([{ ...appointment, providerFirstName: 'Obsolete completed view', status: 'completed' }]));
    await flush(view);
    assert.ok(view.text().includes(appointment.providerFirstName));
    assert.equal(view.text().includes('Obsolete completed view'), false);
    view.unmount();
  });
}

test('Nigeria visit details retain ongoing-call entry without offering cancellation', async () => {
  const view = harness('app/ng/patient/appointments/[id]/page.js', {}, appointment);
  view.render(); await flush(view);
  assert.ok(view.find('a').some(link => link.props.href === `/ng/patient/appointments/${appointment.id}/call`));
  assert.equal(view.button('Cancel Consultation'), undefined);
  view.unmount();
});

test('Nigeria terminal and review states never offer a video-call link', async () => {
  for (const status of ['completed', 'cancelled', 'no_show', 'provider_reviewing', 'pharmacy_reviewing']) {
    const view = harness('app/ng/patient/appointments/[id]/page.js', {}, { ...appointment, status });
    view.render(); await flush(view);
    assert.equal(view.find('a').some(link => String(link.props.href).endsWith('/call')), false, status);
    view.unmount();
  }
});

test('returning to the US list refreshes status and removes its visibility listener on unmount', async () => {
  let reads = 0;
  const view = harness(pages[0], { getAll: async () => { reads++; return response([{ ...appointment, status: reads === 1 ? 'in_progress' : 'completed' }]); } });
  view.render(); await flush(view); view.returnToPage(); await flush(view);
  assert.equal(reads, 2); assert.ok(view.text().includes('Completed'));
  view.unmount(); view.returnToPage(); await flush(view); assert.equal(reads, 2);
});
