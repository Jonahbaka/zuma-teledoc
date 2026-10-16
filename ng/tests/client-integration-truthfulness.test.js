'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('next/dist/build/swc');

function loadClientSource(relativePath, dependencies, globals = {}) {
  const filename = path.resolve(__dirname, '../..', relativePath);
  const compiled = transformSync(fs.readFileSync(filename, 'utf8'), {
    filename,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  }).code;
  const sourceModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: sourceModule,
    exports: sourceModule.exports,
    require(name) { assert.ok(name in dependencies, `Unexpected client dependency: ${name}`); return dependencies[name]; },
    AbortController,
    console,
    ...globals,
  });
  return sourceModule.exports;
}

function serviceHarness(response) {
  const calls = [];
  const api = {
    async get(url, options) { calls.push({ url, options }); if (response instanceof Error) throw response; return { data: response }; },
    async post(url, body, options) { calls.push({ url, body, options }); if (response instanceof Error) throw response; return { data: response }; },
  };
  return { calls, service: loadClientSource('lib/doctaService.js', { './api': { __esModule: true, default: api } }).DoctaService };
}

const device = { mode: 'device', status: 'ready', latitude: 0, longitude: 0, city: '', state: '', postalCode: '' };
const manual = { mode: 'manual', status: 'ready', latitude: 40, longitude: -73, city: 'Entered city', state: 'Entered region', postalCode: '12345', label: 'Home' };

test('unconnected OCR, insurance, pricing, prior authorization and optional triage never return fabricated success', async () => {
  const { service, calls } = serviceHarness({});
  for (const [method, code] of [
    ['ocrScan', 'INSURANCE_OCR_NOT_CONNECTED'], ['verifyInsuranceReal', 'INSURANCE_ELIGIBILITY_NOT_CONNECTED'],
    ['comparePrices', 'LIVE_MEDICATION_PRICING_NOT_CONNECTED'], ['submitPA', 'PRIOR_AUTHORIZATION_NOT_CONNECTED'],
    ['runAITriage', 'OPTIONAL_SYMPTOM_GUIDANCE_NOT_CONNECTED'],
  ]) {
    await assert.rejects(service[method]('Patient-entered information'), (error) => error.status === 503 && error.code === code && error.source === 'unavailable');
  }
  assert.equal(calls.length, 0, 'Unavailable adapters must not route into simulated backend services');
  await assert.rejects(service.runAITriage('Chest symptoms'), (error) => !error.suggestedMeds && !error.soapDraft && error.message.includes('continue booking'));
});

test('device search uses the public API and preserves zero coordinates without availability claims', async () => {
  const { service, calls } = serviceHarness({ success: true, pharmacies: [{ id: 'osm-1', name: 'Directory response pharmacy', address: 'Recorded address', source: 'openstreetmap', isOpen: true, isPreferred: true, hasDelivery: true }] });
  const controller = new AbortController();
  const rows = await service.findPharmacies({ location: device, authenticated: true, signal: controller.signal });
  assert.equal(calls[0].url, '/directory/pharmacies');
  assert.equal(JSON.stringify(calls[0].body), JSON.stringify({ market: 'US', mode: 'device', latitude: 0, longitude: 0, radius: 5000, limit: 15 }));
  assert.equal(calls[0].options.skipAuth, true);
  assert.equal(calls[0].options.signal, controller.signal);
  assert.equal(rows.length, 1); assert.equal(rows[0].name, 'Directory response pharmacy');
  assert.equal(rows[0].source, 'OpenStreetMap public directory'); assert.equal(rows[0].verificationStatus, 'details_not_verified');
  assert.equal(rows[0].isOpen, null); assert.equal(rows[0].isPreferred, null); assert.equal(rows[0].hasDelivery, undefined);
});

test('manual home/work areas use text searches and never reuse previous GPS or invent distance', async () => {
  const { service, calls } = serviceHarness({ success: true, pharmacies: [{ id: 'record-1', name: 'Recorded registry pharmacy', source: 'network', distanceKm: 0.2 }] });
  const rows = await service.findPharmacies({ location: manual, authenticated: true });
  assert.equal(calls[0].url, '/directory/pharmacies');
  assert.equal(JSON.stringify(calls[0].body), JSON.stringify({ market: 'US', mode: 'manual', city: 'Entered city', state: 'Entered region', postalCode: '12345', limit: 15 }));
  assert.equal(calls[0].body.latitude, undefined); assert.equal(calls[0].body.longitude, undefined);
  assert.equal(rows[0].distanceKm, undefined); assert.equal(rows[0].isOpen, null);
  assert.equal(rows[0].source, 'DoctaRx pharmacy registry');
});

test('public NG device and manual searches use the existing public pharmacy directory with explicit context', async () => {
  for (const location of [device, manual]) {
    const { service, calls } = serviceHarness({ providers: [{ id: 'pharmacy:record-1', canonicalName: 'Recorded pharmacy', addressRaw: 'Recorded address', sourceType: 'internal_pharmacy', stockAvailable: true }] });
    const rows = await service.findPharmacies({ market: 'NG', location });
    assert.equal(calls[0].url, '/ng/discovery/providers');
    assert.equal(calls[0].options.params.mode, 'pharmacy'); assert.equal(calls[0].options.params.providerType, 'pharmacy');
    if (location.mode === 'manual') {
      assert.equal(calls[0].options.params.latitude, undefined); assert.equal(calls[0].options.params.longitude, undefined);
      assert.equal(calls[0].options.params.city, 'Entered city');
    } else { assert.equal(calls[0].options.params.latitude, 0); assert.equal(calls[0].options.params.longitude, 0); }
    assert.equal(rows[0].name, 'Recorded pharmacy'); assert.equal(rows[0].stockAvailable, undefined);
  }
});

test('anonymous US search uses only the public directory and sends a name query separately from the entered area', async () => {
  const { service, calls } = serviceHarness({ success: true, pharmacies: [] });
  for (const location of [device, manual]) {
    const rows = await service.findPharmacies({ location, query: '  Pharmacy name  ' });
    assert.equal(rows.length, 0);
  }
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url, '/directory/pharmacies'); assert.equal(call.options.skipAuth, true);
    assert.equal(call.body.q, 'Pharmacy name'); assert.equal(call.body.market, 'US');
  }
  assert.equal(calls[1].body.city, 'Entered city'); assert.equal(calls[1].body.latitude, undefined);
});

test('postal-only NG manual lookup is rejected before any broad or device directory request', async () => {
  const { service, calls } = serviceHarness({ providers: [] });
  await assert.rejects(service.findPharmacies({ market: 'NG', location: { ...manual, city: '', state: '' } }), (error) => error.status === 400 && error.code === 'POSTAL_AREA_UNSUPPORTED' && error.message.includes('Enter a city or state'));
  assert.equal(calls.length, 0);
});

test('directory failures and malformed responses do not turn into invented pharmacies or empty-success claims', async () => {
  const failure = new Error('Directory connection failed');
  const unavailable = serviceHarness(failure);
  await assert.rejects(unavailable.service.findPharmacies({ location: device, authenticated: true }), (error) => error === failure);
  for (const response of [{ success: false, pharmacies: [] }, { success: true }, { success: true, pharmacies: [{ id: 'fake', name: 'Fallback pharmacy', source: 'fallback' }] }, { success: true, pharmacies: [{ id: 'sample', name: 'Sample pharmacy', synthetic: true }] }, { success: true, pharmacies: [{}] }]) {
    await assert.rejects(serviceHarness(response).service.findPharmacies({ location: device, authenticated: true }), (error) => error.status === 503);
  }
  const empty = serviceHarness({ success: true, pharmacies: [] });
  assert.equal((await empty.service.findPharmacies({ location: device, authenticated: true })).length, 0);
});

test('invalid/unavailable device locations are rejected before any directory network request', async () => {
  const { service, calls } = serviceHarness({});
  for (const location of [{ ...device, latitude: null }, { ...device, latitude: 91 }, { ...device, longitude: -181 }, { ...device, latitude: Infinity }, { ...device, status: 'unavailable' }]) {
    await assert.rejects(service.findPharmacies({ location, authenticated: true }));
  }
  assert.equal(calls.length, 0);
});

function viewHarness(relativePath, additions) {
  const slots = [];
  const effects = [];
  let cursor = 0;
  let dirty = false;
  let tree;
  const react = {
    useState(initial) {
      const index = cursor++;
      slots[index] ||= { value: typeof initial === 'function' ? initial() : initial };
      const slot = slots[index];
      return [slot.value, (value) => { slot.value = typeof value === 'function' ? value(slot.value) : value; dirty = true; }];
    },
    useId() { const index = cursor++; slots[index] ||= { value: 'view-' + index }; return slots[index].value; },
    useEffect(effect, dependencies) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || dependencies.some((value, offset) => value !== previous.dependencies[offset])) {
        const next = { dependencies, cleanup: null }; slots[index] = next;
        effects.push(() => { previous?.cleanup?.(); next.cleanup = effect(); });
      }
    },
  };
  const Button = Symbol('Button');
  const Input = Symbol('Input');
  const jsxRuntime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
  const dependencies = {
    react,
    'react/jsx-runtime': jsxRuntime,
    'lucide-react': new Proxy({}, { get: (_target, name) => Symbol(String(name)) }),
    'next/link': { __esModule: true, default: Symbol('Link') },
    '@/components/ui/button': { Button },
    '@/components/ui/input': { Input },
    '@/components/ui/label': { Label: Symbol('Label') },
    '@/components/ui/card': { Card: Symbol('Card'), CardContent: Symbol('CardContent'), CardHeader: Symbol('CardHeader'), CardTitle: Symbol('CardTitle') },
    '@/components/branding/PortalPageHeader': { __esModule: true, default: Symbol('PortalPageHeader') },
    '@/lib/utils': { formatDateTime: (value) => value },
    ...additions,
  };
  const Component = loadClientSource(relativePath, dependencies).default;
  let currentProps = {};
  const harness = {
    render(props = currentProps) {
      currentProps = props;
      do { dirty = false; cursor = 0; tree = Component(props); for (const effect of effects.splice(0)) effect(); } while (dirty);
      return tree;
    },
    content: () => JSON.stringify(tree),
    find(type) {
      const found = [];
      const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { for (const child of node) walk(child); return; }
        if (node.type === type) found.push(node);
        walk(node.props?.children);
      };
      walk(tree); return found;
    },
    Button,
    Input,
  };
  return harness;
}
async function flush(harness) { await new Promise((resolve) => setImmediate(resolve)); harness.render(); }
function deferred() { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('clinician hospital network does not publish invented partners, counts or unimplemented connection actions', () => {
  let apiCalls = 0;
  const view = viewHarness('app/(dashboard)/provider/hospital-network/page.js', {
    'next/navigation': { usePathname: () => '/ng/provider/hospital-network' },
    '@/components/providers/AuthProvider': { useAuth: () => ({ user: { id: 'provider-1', role: 'provider' }, loading: false }) },
    '@/lib/api': { __esModule: true, default: { get() { apiCalls++; throw new Error('Clinicians must not call an admin-only registry'); } } },
  });
  view.render(); const text = view.content();
  assert.equal(apiCalls, 0); assert.ok(text.includes('Connection status is unavailable'));
  for (const invented of ['Stanford', 'Kaiser', 'UCSF', 'Sutter', 'John Muir', 'Active Connections', 'Test Connection', 'Request Connection']) assert.equal(text.includes(invented), false);
  assert.ok(text.includes('/ng/provider/referrals')); assert.ok(text.includes('/ng/provider/patients'));
});

test('authorized hospital registry displays actual configuration data and hides stale rows after role changes', async () => {
  let user = { id: 'admin-1', role: 'admin' };
  let loading = false;
  const calls = [];
  const view = viewHarness('app/(dashboard)/provider/hospital-network/page.js', {
    'next/navigation': { usePathname: () => '/provider/hospital-network' },
    '@/components/providers/AuthProvider': { useAuth: () => ({ user, loading }) },
    '@/lib/api': { __esModule: true, default: { async get(url) { calls.push(url); return { data: { success: true, organizations: [{ id: 'record-1', name: 'Actual API organization', status: 'pending', last_sync_at: null }] } }; } } },
  });
  view.render(); await flush(view);
  assert.deepEqual(calls, ['/interop/organizations']); assert.ok(view.content().includes('Actual API organization'));
  assert.ok(view.content().includes('Configuration: ')); assert.ok(view.content().includes('No synchronization result is recorded.'));
  loading = true; view.render();
  assert.equal(view.content().includes('Actual API organization'), false); assert.ok(view.content().includes('Loading organization connection information'));
  loading = false;
  user = { id: 'provider-1', role: 'provider' }; view.render();
  assert.equal(view.content().includes('Actual API organization'), false); assert.ok(view.content().includes('Connection status is unavailable'));
});

test('hospital registry outage renders an error instead of fabricated or zero active connection counts', async () => {
  const view = viewHarness('app/(dashboard)/provider/hospital-network/page.js', {
    'next/navigation': { usePathname: () => '/provider/hospital-network' },
    '@/components/providers/AuthProvider': { useAuth: () => ({ user: { id: 'admin-1', role: 'admin' }, loading: false }) },
    '@/lib/api': { __esModule: true, default: { async get() { throw new Error('Registry unavailable'); } } },
  });
  view.render(); await flush(view);
  assert.ok(view.content().includes('could not be loaded')); assert.equal(view.content().includes('No organizations were returned'), false);
  assert.equal(view.content().includes('Active Connections'), false);
});

test('pharmacy view uses route market and shared manual/device location; stale GPS results cannot replace a chosen area', async () => {
  let location = { ...device };
  const requests = [];
  const markets = [];
  const selections = [];
  const view = viewHarness('components/PharmacyLocator.jsx', {
    'next/navigation': { usePathname: () => '/ng/pharmacies' },
    '@/lib/useCareLocation': { __esModule: true, default: (market) => { markets.push(market); return { location, useDeviceLocation() {}, chooseArea() {} }; } },
    '@/components/discovery/CareLocationPicker': { __esModule: true, default: Symbol('CareLocationPicker') },
    '@/components/providers/AuthProvider': { useAuth: () => ({ user: null, loading: false }) },
    '@/lib/doctaService': { DoctaService: { findPharmacies(options) { const request = { options, ...deferred() }; requests.push(request); return request.promise; } } },
    '@/components/ui/use-toast': { toast() {} },
  });
  view.render({ onSelect: (selection) => selections.push(selection) });
  const old = requests[0]; location = { ...manual, latitude: null, longitude: null }; view.render();
  assert.equal(old.options.signal.aborted, true);
  requests[1].resolve([{ id: 'manual-area-result', name: 'Chosen-area pharmacy', address: 'Recorded address', source: 'Pharmacy directory record' }]); await flush(view);
  old.resolve([{ id: 'old-location-result', name: 'Old device pharmacy', address: 'Old address', source: 'Pharmacy directory record' }]); await flush(view);
  assert.equal(view.content().includes('Old device pharmacy'), false); assert.ok(view.content().includes('Chosen-area pharmacy'));
  assert.ok(view.content().includes('no address has been geocoded')); assert.ok(markets.every((market) => market === 'NG'));
  const choice = view.find('button').find((button) => JSON.stringify(button.props.children).includes('Chosen-area pharmacy'));
  choice.props.onClick(); assert.equal(selections.length, 1); assert.equal(selections[0].pharmacy.id, 'manual-area-result');
});

test('pharmacy lookup failure remains distinguishable from an empty directory result', async () => {
  const view = viewHarness('components/PharmacyLocator.jsx', {
    'next/navigation': { usePathname: () => '/pharmacies' },
    '@/lib/useCareLocation': { __esModule: true, default: () => ({ location: device, useDeviceLocation() {}, chooseArea() {} }) },
    '@/components/discovery/CareLocationPicker': { __esModule: true, default: Symbol('CareLocationPicker') },
    '@/components/providers/AuthProvider': { useAuth: () => ({ user: { id: 'patient-1' }, loading: false }) },
    '@/lib/doctaService': { DoctaService: { async findPharmacies() { throw new Error('Directory unavailable'); } } },
    '@/components/ui/use-toast': { toast() {} },
  });
  view.render(); await flush(view);
  assert.ok(view.content().includes('could not be reached')); assert.equal(view.content().includes('No pharmacies were returned'), false);
});

test('manual pharmacy selection is labeled unverified and never claims durable save or external routing', () => {
  const selections = []; const notices = [];
  const view = viewHarness('components/PharmacyLocator.jsx', {
    'next/navigation': { usePathname: () => '/pharmacies' },
    '@/lib/useCareLocation': { __esModule: true, default: () => ({ location: { ...device, status: 'unavailable' }, useDeviceLocation() {}, chooseArea() {} }) },
    '@/components/discovery/CareLocationPicker': { __esModule: true, default: Symbol('CareLocationPicker') },
    '@/components/providers/AuthProvider': { useAuth: () => ({ user: null, loading: false }) },
    '@/lib/doctaService': { DoctaService: { findPharmacies() { throw new Error('No lookup without a location'); } } },
    '@/components/ui/use-toast': { toast: (notice) => notices.push(notice) },
  });
  view.render({ onSelect: (selection) => selections.push(selection) });
  view.find(view.Input).find((input) => input.props.id.endsWith('-name')).props.onChange({ target: { value: 'Entered pharmacy' } });
  view.render(); view.find(view.Input).find((input) => input.props.id.endsWith('-address')).props.onChange({ target: { value: 'Entered pharmacy address' } });
  view.render(); view.find(view.Button).find((button) => button.props.children === 'Use these pharmacy details').props.onClick();
  assert.equal(selections[0].mode, 'manual'); assert.equal(selections[0].pharmacy.verificationStatus, 'unverified_user_entry');
  assert.equal(notices[0].title, 'Pharmacy details selected'); assert.ok(notices[0].description.includes('No prescription'));
  assert.equal(view.content().includes('Country detected'), false);
});

test('pharmacy view explains unsupported NG postal-only areas without presenting a directory outage', async () => {
  const view = viewHarness('components/PharmacyLocator.jsx', {
    'next/navigation': { usePathname: () => '/ng/pharmacies' },
    '@/lib/useCareLocation': { __esModule: true, default: () => ({ location: { ...manual, city: '', state: '' }, useDeviceLocation() {}, chooseArea() {} }) },
    '@/components/discovery/CareLocationPicker': { __esModule: true, default: Symbol('CareLocationPicker') },
    '@/lib/doctaService': { DoctaService: { async findPharmacies() { throw Object.assign(new Error('Unsupported area'), { code: 'POSTAL_AREA_UNSUPPORTED' }); } } },
    '@/components/ui/use-toast': { toast() {} },
  });
  view.render(); await flush(view);
  assert.ok(view.content().includes('Enter a city or state')); assert.equal(view.content().includes('could not be reached'), false);
});
