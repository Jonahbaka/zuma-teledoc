'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('next/dist/build/swc');

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function compile(file, dependencies, globals = {}) {
  const filename = path.resolve(__dirname, '../..', file); const sourceModule = { exports: {} };
  const compiled = transformSync(fs.readFileSync(filename, 'utf8'), { filename, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } }).code;
  vm.runInNewContext(compiled, { module: sourceModule, exports: sourceModule.exports, AbortController, Map, Date, setInterval: () => 1, clearInterval() {}, ...globals, require(name) { assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; } });
  return sourceModule.exports;
}
function stateHarness() {
  const slots = [], effects = []; let cursor = 0, dirty = false;
  const equal = (next, before) => before && next.every((item, index) => item === before[index]);
  const react = {
    useState(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; dirty = true; }]; },
    useRef(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: { current: initial } }; return slots[index].value; },
    useEffect(callback, dependencies) { const index = cursor++; const previous = slots[index]; if (!equal(dependencies, previous?.dependencies)) { const next = { dependencies }; slots[index] = next; effects.push(() => { previous?.cleanup?.(); next.cleanup = callback(); }); } },
    useCallback(callback, dependencies) { const index = cursor++; if (!equal(dependencies, slots[index]?.dependencies)) slots[index] = { dependencies, value: callback }; return slots[index].value; },
  };
  return { react, render(callback) { let result; do { cursor = 0; dirty = false; result = callback(); for (const effect of effects.splice(0)) effect(); } while (dirty); return result; }, unmount() { for (const slot of slots) slot.cleanup?.(); } };
}
async function flush() { await new Promise(resolve => setImmediate(resolve)); }
function checkout(extra = {}) {
  return { orderId: 'owned-order', orderNumber: 'RX-001', version: 2, status: 'ready_for_pickup', pharmacy: { id: 'approved-pharmacy', name: 'Approved pharmacy' }, deliveryType: 'delivery', checkout: { enabled: true },
    items: [], pricing: { currency: 'NGN', medicinesMinor: 900000, courierMinor: 280000, managementMinor: 75000, coordinationMinor: 0, taxMinor: 0, patientTotalMinor: 1255000, insurerTotalMinor: 0, totalMinor: 1255000 },
    quote: { id: 'approved-quote', provider: 'uber_direct', fareMinor: 280000, expiresAt: '2099-01-01T00:00:00.000Z' }, payment: { medicines: { status: 'verified', amountMinor: 900000 }, delivery: { status: 'unpaid', amountMinor: 355000 } },
    actions: { canChoose: false, canApproveMedicines: false, canPayMedicines: false, canRequestQuote: true, canApproveQuote: true, canPayDelivery: true, canDispatch: false, canCancel: false, canMarkCollected: false }, ...extra };
}
function hookHarness(api) {
  const state = stateHarness(), redirects = []; let orderId = 'owned-order', latest, keys = 0;
  const helpers = { getMedicationCheckout: api.get, mutateMedicationCheckout: api.post, deliveryError: error => error.message, requestKey: () => `unique-${++keys}`, hostedMedicationPaymentUrl: data => data.authorizationUrl };
  const useCheckout = compile('components/ng/delivery/useMedicationCheckout.js', { react: state.react, '@/lib/ngDeliveryApi': helpers }, { window: { location: { assign(url) { redirects.push(url); } } } }).default;
  const render = () => (latest = state.render(() => useCheckout(orderId, null)));
  return { render, get current() { return latest; }, change(id) { orderId = id; return render(); }, unmount: state.unmount, redirects };
}

test('payment and approval cannot fire until the checkout read has completed', async () => {
  const pending = deferred(); let writes = 0;
  const view = hookHarness({ get: () => pending.promise, post() { writes++; } });
  view.render(); assert.equal(await view.current.mutate('pay', { stage: 'medicines' }), false); assert.equal(writes, 0);
  pending.resolve(checkout()); await flush(); assert.equal(view.render().checkout.orderId, 'owned-order'); view.unmount();
});

test('concurrent double clicks send once; uncertain failures reuse the same idempotency key', async () => {
  const writes = []; let pending = deferred();
  const view = hookHarness({ get: async () => checkout(), post: (...args) => { writes.push(args); return pending.promise; } });
  view.render(); await flush(); view.render();
  const first = view.current.mutate('approve', { stage: 'delivery', quoteId: 'approved-quote', consent: true });
  assert.equal(await view.current.mutate('approve', { stage: 'delivery', quoteId: 'approved-quote', consent: true }), false);
  assert.equal(writes.length, 1); pending.reject(new Error('Provider timeout')); await first; view.render();
  assert.equal(view.current.error, 'Provider timeout'); pending = deferred();
  const retry = view.current.mutate('approve', { stage: 'delivery', quoteId: 'approved-quote', consent: true });
  assert.equal(writes[0][3].idempotencyKey, writes[1][3].idempotencyKey); assert.equal(writes[1][3].version, 2);
  pending.resolve(checkout({ version: 3 })); assert.equal(await retry, true); assert.equal(view.render().checkout.version, 3); view.unmount();
});

test('account or order teardown aborts pending requests and prevents late checkout navigation', async () => {
  const payment = deferred(); let signal;
  const view = hookHarness({ get: async () => checkout(), post: (...args) => { signal = args[4]; return payment.promise; } });
  view.render(); await flush(); view.render();
  const write = view.current.mutate('pay', { stage: 'delivery' }); view.unmount();
  payment.resolve({ authorizationUrl: 'https://checkout.paystack.com/approved' });
  assert.equal(await write, false); assert.equal(signal.aborted, true); assert.equal(view.redirects.length, 0);
});

test('a late old order read cannot replace the newly selected order', async () => {
  const reads = [];
  const view = hookHarness({ get: (orderId, _pharmacy, signal) => { const row = { ...deferred(), orderId, signal }; reads.push(row); return row.promise; }, post() {} });
  view.render(); view.change('new-order'); assert.equal(reads[0].signal.aborted, true);
  reads[0].resolve(checkout()); reads[1].resolve(checkout({ orderId: 'new-order' }));
  await flush(); assert.equal(view.render().checkout.orderId, 'new-order'); view.unmount();
});

function pageHarness(checkoutValue, file = 'MedicationCheckout') {
  const state = stateHarness(), writes = []; let tree;
  const helpers = { deliveryDate: value => value || 'Not confirmed', formatKobo: value => String(value), quoteIsCurrent: quote => Boolean(quote && quote.expired !== true && Date.parse(quote.expiresAt) > Date.now()), statusLabel: value => value || 'Not confirmed' };
  const dependencies = { react: state.react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'next/link': { __esModule: true, default: 'link' }, 'lucide-react': new Proxy({}, { get: (_value, name) => String(name) }),
    '@/components/ui/button': { Button: 'button' }, '@/lib/ngDeliveryApi': helpers,
    './useMedicationCheckout': { __esModule: true, default: () => ({ checkout: checkoutValue, loading: false, busy: false, error: '', notice: '', load() {}, mutate: (...args) => writes.push(args) }) },
    './MedicationPriceBreakdown': { __esModule: true, default: 'prices' }, './DeliveryPresentation': new Proxy({}, { get: (_value, name) => String(name) }) };
  const Component = compile(`components/ng/delivery/${file}.jsx`, dependencies).default;
  const find = type => { const result = []; function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; if (node.type === type) result.push(node); walk(node.props?.children); } walk(tree); return result; };
  const text = node => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' ? node : node?.props ? text(node.props.children) : '';
  return { render() { tree = state.render(() => Component({ orderId: 'owned-order', pharmacyId: 'approved-pharmacy' })); }, button(label) { return find('button').find(button => text(button.props.children).includes(label)); }, text: () => text(tree), writes, unmount: state.unmount };
}

test('expired quote cannot render delivery approval, payment or dispatch buttons', () => {
  const value = checkout({ quote: { ...checkout().quote, expiresAt: '2000-01-01T00:00:00.000Z' }, actions: { ...checkout().actions, canDispatch: true } });
  const patient = pageHarness(value); patient.render(); assert.equal(patient.button('Approve this delivery quote'), undefined); assert.equal(patient.button('Pay approved delivery amount'), undefined); assert.ok(patient.button('Get a fresh approved quote')); patient.unmount();
  const pharmacy = pageHarness(value, 'PharmacyMedicationOrder'); pharmacy.render(); assert.equal(pharmacy.button('Book approved courier'), undefined); pharmacy.unmount();
});

test('fresh quote payment uses explicit delivery stage and never automatically dispatches', () => {
  const view = pageHarness(checkout()); view.render(); view.button('Pay approved delivery amount').props.onClick();
  assert.equal(view.writes.length, 1); assert.equal(view.writes[0][0], 'pay'); assert.equal(view.writes[0][1].stage, 'delivery'); view.unmount();
});

test('disabled merchant checkout exposes no medicine or delivery payment action', () => {
  const value = checkout({ checkout: { enabled: false }, actions: { ...checkout().actions, canPayMedicines: false, canPayDelivery: false } });
  const view = pageHarness(value); view.render();
  assert.equal(view.button('Pay for medicines securely'), undefined); assert.equal(view.button('Pay approved delivery amount'), undefined); assert.equal(view.writes.length, 0); view.unmount();
});

test('pending medicine and delivery stages explicitly resume through the existing pay action', () => {
  for (const stage of ['medicines', 'delivery']) {
    const base = checkout(); const value = checkout({ payment: { ...base.payment, [stage]: { ...base.payment[stage], status: 'pending', reference: 'existing-provider-reference' } }, actions: { ...base.actions, canPayMedicines: stage === 'medicines', canPayDelivery: stage === 'delivery' } });
    const view = pageHarness(value); view.render();
    const button = view.button(stage === 'medicines' ? 'Resume medicine payment securely' : 'Resume delivery payment securely'); assert.ok(button); button.props.onClick();
    assert.equal(view.writes.length, 1); assert.equal(view.writes[0][0], 'pay'); assert.equal(view.writes[0][1].stage, stage); assert.equal(Object.keys(view.writes[0][1]).join(), 'stage'); view.unmount();
  }
});

test('suspended pharmacy checkout explains the hold and preserves existing payment verification', () => {
  const base = checkout();
  const value = checkout({ pharmacy: { ...base.pharmacy, active: false },
    payment: { ...base.payment, medicines: { status: 'pending', reference: 'existing-receipt' } },
    actions: Object.fromEntries(Object.keys(base.actions).map(name => [name, name === 'canCancel'])) });
  const view = pageHarness(value); view.render();
  assert.match(view.text(), /This pharmacy is unavailable for new fulfillment/);
  assert.equal(view.button('Pay for medicines securely'), undefined); assert.equal(view.button('Pay approved delivery amount'), undefined);
  const verify = view.button('Verify with payment provider'); assert.ok(verify); verify.props.onClick();
  assert.equal(view.writes[0][0], 'payments/existing-receipt/verify'); view.unmount();
});


test('legacy quantity review stays visible alongside actual delivery and payment status', () => {
  const base=checkout(); const value=checkout({status:'delivered',clinicalReviewRequired:true,actions:Object.fromEntries(Object.keys(base.actions).map(name=>[name,false]))});
  const view=pageHarness(value);view.render();assert.match(view.text(),/Clinical review required: prescription dispensing records need reconciliation/);
  assert.match(view.text(),/Do not arrange additional medicine or assume a refund/);
  assert.equal(view.button('Pay for medicines securely'),undefined);assert.equal(view.button('Pay approved delivery amount'),undefined);assert.equal(view.writes.length,0);view.unmount();
});

test('prescription detail blocks clinical completion and dispensing while showing preserved quantity review', async () => {
  for(const lifecycle_status of ['fully_dispensed','partially_dispensed']) {
    const state=stateHarness(); const data={id:'isolated-rx',lifecycle_status,quantity_review_required:true,items:[{id:'isolated-item',quantity:2,dispensed_quantity:1,status:'dispensed'}]};
    const dependencies={react:state.react,'next/navigation':{useRouter:()=>({push(){}})},'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'lucide-react':new Proxy({},{get:(_value,name)=>String(name)}), './rxApi':{rx:{get:async()=>({prescription:data}),events:async()=>({events:[]})},statusBadge:()=>'',STATUS_LABELS:{},fmtDate:()=>''}};
    const Detail=compile('components/ng/prescriptions/RxDetail.jsx',dependencies).default;
    state.render(()=>Detail({id:data.id}));await flush();const tree=state.render(()=>Detail({id:data.id})); const nodes=[];
    function walk(node){if(Array.isArray(node))return node.forEach(walk);if(!node||typeof node!=='object')return;nodes.push(node);walk(node.props?.children);}walk(tree);
    assert.ok(nodes.some(node=>node.props?.role==='alert'&&String(node.props.children).includes('Clinical review required')));
    assert.equal(nodes.some(node=>node.props?.children==='Mark complete'),false);
    const item=nodes.find(node=>typeof node.type==='function'&&node.type.name==='RxItem');assert.equal(item.props.canDispense,false);state.unmount();
  }
});


test('responsible pharmacy sees the clinical review hold alongside retained order facts', () => {
  const base=checkout();const value=checkout({status:'delivered',clinicalReviewRequired:true,actions:Object.fromEntries(Object.keys(base.actions).map(name=>[name,false]))});
  const view=pageHarness(value,'PharmacyMedicationOrder');view.render();assert.match(view.text(),/Clinical review required: reconcile the prescription with the recorded handover/);
  assert.match(view.text(),/does not authorize replacement medicine or a refund/);assert.equal(view.writes.length,0);view.unmount();
});

test('legacy wallet view preserves recorded balances/history and refresh, with no payout action or success claim',async()=>{
  const state=stateHarness();let reads=0,writes=0,tree;
  const wallet={balance:'1200.50',pending_balance:'300.25',todayEarnings:'50.00',medicationStatement:{outstandingMinor:900000,settledMinor:450000,orderCount:2}};
  const dependencies={react:state.react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
    'lucide-react':new Proxy({},{get:(_value,name)=>String(name)}),'@/components/ui/button':{Button:'button'},
    '@/components/providers/AuthProvider':{useAuth:()=>({user:{id:'synthetic-pharmacist',role:'pharmacy'},loading:false,isAuthenticated:true})},
    '@/components/ng/NigeriaPharmacyPortalShell':{__esModule:true,default:'shell'},'@/components/branding/PortalPageHeader':{__esModule:true,default:'header'},
    '@/lib/ngPharmacyPortal':{fetchNigeriaPharmacyWorkspace:async()=>({id:'synthetic-pharmacy'})},
    '@/lib/ngDeliveryApi':{deliveryDate:value=>value,deliveryError:error=>error.message,formatKobo:String,legacyWalletAmount:String,readMedicationPharmacyStatement:value=>value,statusLabel:value=>value},
    '@/components/ng/delivery/DeliveryPresentation':new Proxy({},{get:(_value,name)=>String(name)}),
    '@/lib/api':{__esModule:true,default:{async get(url){reads++;return{data:url.endsWith('/transactions')?[{id:'historical-row',type:'settlement',amount:'100.00',reference:'existing-unreconciled-reference',created_at:'2026-11-03'}]:wallet};},post(){writes++;throw new Error('No legacy payout network request is permitted');}}},
  };
  const Page=compile('app/ng/pharmacy/wallet/page.js',dependencies).default;const Workspace=Page().type;
  const render=()=>{tree=state.render(()=>Workspace());};
  const nodes=()=>{const all=[];function walk(node){if(Array.isArray(node))return node.forEach(walk);if(!node||typeof node!=='object')return;all.push(node);walk(node.props?.children);}walk(tree);return all;};
  const text=node=>Array.isArray(node)?node.map(text).join(''):typeof node==='string'?node:node?.props?text(node.props.children):'';
  render();await flush();render();
  const hold=nodes().find(node=>node.type==='button'&&text(node)==='Legacy payouts paused');
  assert.equal(hold.props.disabled,true);assert.equal(hold.props.onClick,undefined);assert.equal(hold.props['aria-describedby'],'legacy-payout-hold');
  assert.match(text(tree),/pending finance reconciliation/);assert.match(text(tree),/does not cancel or refund/);assert.match(text(tree),/existing-unreconciled-reference/);assert.match(text(tree),/1200.50/);assert.match(text(tree),/300.25/);
  assert.equal(reads,2);assert.equal(writes,0);
  const refresh=nodes().find(node=>node.type==='button'&&text(node).includes('Refresh financial records'));await refresh.props.onClick();render();assert.equal(reads,4);assert.equal(writes,0);
  assert.doesNotMatch(text(tree),/settlement request returned|Submitting legacy|Request legacy wallet settlement/);state.unmount();
});

function inventoryView(api, { session = { current: 'A' }, accountKey = 'A', shell = false, auth = { value: { loading: false, isAuthenticated: true, user: { id: 'pharmacist', role: 'pharmacy', marketScope: 'NG' } } } } = {}) {
  const state = stateHarness(); let tree;
  const dependencies = {
    react: state.react, 'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    '@/components/providers/AuthProvider': { useAuth: () => auth.value },
    '@/components/ng/NigeriaPharmacyPortalShell': { __esModule: true, default: 'shell' },
    '@/components/ui/button': { Button: 'button' },
    '@/components/ui/card': { Card: 'section', CardContent: 'div', CardHeader: 'header', CardTitle: 'h2' },
    '@/lib/ngPharmacyPortal': { fetchNigeriaPharmacyWorkspace: async () => (await api.get('/ng/pharmacy/me')).data, formatNaira: value => `NGN ${value}` },
    '@/lib/api': { __esModule: true, default: api },
  };
  const loaded = compile('app/ng/pharmacy/inventory/page.js', dependencies);
  const Page = shell ? loaded.default : loaded.NigeriaPharmacyInventoryWorkspace || loaded.default;
  const text = node => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : node?.props ? text(node.props.children) : '';
  const nodes = () => { const result = []; function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; result.push(node); walk(node.props?.children); } walk(tree); return result; };
  return { render() { tree = state.render(() => Page({ session, accountKey })); return tree; }, text: () => text(tree), button: label => nodes().find(node => node.type === 'button' && text(node) === label), unmount: state.unmount, session, auth };
}
const inventoryPage = (items = [], extra = {}) => ({ items, page: 1, total: items.length, totalPages: items.length ? 1 : 0, ...extra });
const inventoryItem = (id = 'batch-a') => ({ id, drug_name: 'Synthetic medicine', quantity_available: 12, quantity_reserved: 2, selling_price: '100', batch_number: 'Synthetic batch' });

test('pharmacy inventory failure never reports no stock alerts or a confirmed empty stock list', async () => {
  const view = inventoryView({ async get(url) { if (url === '/ng/pharmacy/me') return { data: { id: 'pharmacy' } }; throw new Error('Synthetic outage'); } });
  view.render(); await flush(); view.render();
  assert.doesNotMatch(view.text(), /No active low-stock alerts|No inventory items are currently loaded/);
  assert.ok(view.button('Retry stock alerts')); assert.ok(view.button('Retry inventory'));
});

test('pharmacy inventory can reach a recorded stock batch beyond the first fifty', async () => {
  const calls = [];
  const view = inventoryView({ async get(url, options) {
    if (url === '/ng/pharmacy/me') return { data: { id: 'pharmacy' } };
    if (url.endsWith('/alerts')) return { data: [] };
    const page = options?.params?.page || 1; calls.push(page);
    return { data: inventoryPage(page === 1 ? Array.from({ length: 50 }, (_, index) => inventoryItem(`first-${index}`)) : [{ ...inventoryItem('later-batch'), drug_name: 'Later recorded batch' }], { page, total: 51, totalPages: 2 }) };
  } });
  view.render(); await flush(); view.render(); assert.ok(view.button('Load more inventory'), 'Later stock records must be reachable');
  await view.button('Load more inventory').props.onClick(); await flush(); view.render();
  assert.match(view.text(), /Later recorded batch/); assert.deepEqual(calls, [1, 2]); assert.equal(view.button('Load more inventory'), undefined);
});

test('pharmacy workspace read failure is distinct from a confirmed missing workspace', async () => {
  let fail = true;
  const view = inventoryView({ async get() { if (fail) throw new Error('Synthetic workspace outage'); return { data: null }; } });
  view.render(); await flush(); view.render(); assert.doesNotMatch(view.text(), /Complete pharmacy onboarding/); assert.ok(view.button('Retry pharmacy access'));
  fail = false; await view.button('Retry pharmacy access').props.onClick(); await flush(); view.render(); assert.match(view.text(), /Complete pharmacy onboarding/);
});

test('pharmacy inventory waits for trusted NG pharmacy auth and replaces account workspace synchronously', () => {
  let reads = 0;
  const auth = { value: { loading: true, isAuthenticated: true, user: { id: 'actor-a', role: 'pharmacy', marketScope: 'NG' } } };
  const view = inventoryView({ get() { reads++; } }, { shell: true, auth });
  assert.equal(view.render().type, 'shell');
  for (const user of [null, { id: 'actor', role: 'patient', marketScope: 'NG' }, { id: 'actor', role: 'pharmacy', marketScope: 'US' }]) { auth.value = { loading: false, isAuthenticated: true, user }; assert.equal(view.render().type, 'shell'); }
  auth.value = { loading: false, isAuthenticated: true, user: { id: 'actor-a', role: 'pharmacy', marketScope: 'NG' } }; const first = view.render();
  auth.value.user = { ...auth.value.user, id: 'actor-b' }; const second = view.render();
  assert.notEqual(first.key, second.key); assert.notEqual(first.props.session.current, first.props.accountKey); assert.equal(reads, 0);
  auth.value.isAuthenticated = false; assert.equal(view.render().type, 'shell');
});

test('pharmacy malformed workspace and list envelopes never masquerade as confirmed empty records', async () => {
  for (const data of [{}, [], '', { id: 4 }]) {
    const view = inventoryView({ async get() { return { data }; } }); view.render(); await flush(); view.render();
    assert.ok(view.button('Retry pharmacy access')); assert.doesNotMatch(view.text(), /Complete pharmacy onboarding/); view.unmount();
  }
  for (const data of [null, [], {}, { items: [], total: 0, page: 2, totalPages: 0 }, { items: [{ id: null }], total: 1, page: 1, totalPages: 1 }, { items: [], total: '0', page: 1, totalPages: 0 }]) {
    const view = inventoryView({ async get(url) { return { data: url === '/ng/pharmacy/me' ? { id: 'pharmacy' } : url.endsWith('/alerts') ? [{ id: null }] : data }; } });
    view.render(); await flush(); view.render(); assert.ok(view.button('Retry inventory')); assert.ok(view.button('Retry stock alerts')); assert.doesNotMatch(view.text(), /No active low-stock|No inventory items were returned/); view.unmount();
  }
});

test('pharmacy partial reads and independent retry retain the successful section', async () => {
  for (const failedSection of ['alerts', 'inventory']) {
    let failed = true; const reads = [];
    const view = inventoryView({ async get(url) { reads.push(url); if (url === '/ng/pharmacy/me') return { data: { id: 'pharmacy' } }; const section = url.endsWith('/alerts') ? 'alerts' : 'inventory'; if (section === failedSection && failed) throw new Error('Synthetic section outage'); return { data: section === 'alerts' ? [{ ...inventoryItem(), drug_name: 'Synthetic low-stock record', reorder_level: 15 }] : inventoryPage([inventoryItem()]) }; } });
    view.render(); await flush(); view.render(); assert.match(view.text(), failedSection === 'alerts' ? /Synthetic medicine/ : /Synthetic low-stock record/);
    failed = false; await view.button(failedSection === 'alerts' ? 'Retry stock alerts' : 'Retry inventory').props.onClick(); await flush(); view.render();
    assert.match(view.text(), /Synthetic medicine/); assert.match(view.text(), /Synthetic low-stock record/); assert.equal(reads.length, 4); assert.equal(reads.filter(url => url === '/ng/pharmacy/me').length, 1); view.unmount();
  }
});

test('pharmacy inventory later-page retry preserves earlier records, deduplicates overlap and rejects duplicate clicks', async () => {
  const pending = deferred(); let laterReads = 0;
  const view = inventoryView({ async get(url, options) {
    if (url === '/ng/pharmacy/me') return { data: { id: 'pharmacy' } }; if (url.endsWith('/alerts')) return { data: [] };
    if (options.params.page === 1) return { data: inventoryPage([inventoryItem()], { total: 51, totalPages: 2 }) };
    if (++laterReads === 1) return pending.promise;
    return { data: inventoryPage([inventoryItem(), { ...inventoryItem('later'), drug_name: 'Later unique record' }], { page: 2, total: 51, totalPages: 2 }) };
  } });
  view.render(); await flush(); view.render(); const load = view.button('Load more inventory').props.onClick; const first = load(); await load(); assert.equal(laterReads, 1);
  pending.reject(new Error('Synthetic page outage')); await first; view.render(); assert.match(view.text(), /Synthetic medicine/); assert.match(view.text(), /list is incomplete/);
  await view.button('Retry inventory').props.onClick(); await flush(); view.render(); assert.equal(laterReads, 2); assert.equal((view.text().match(/Synthetic medicine/g) || []).length, 1); assert.match(view.text(), /Later unique record/);
});

test('pharmacy inventory refresh discards obsolete workspace, stock and alert responses', async () => {
  const reads = [];
  const view = inventoryView({ get(url, options) { const request = { url, options, ...deferred() }; reads.push(request); return request.promise; } });
  view.render(); reads[0].resolve({ data: { id: 'old-workspace' } }); await flush(); view.render(); assert.equal(reads.length, 3);
  const refreshing = view.button('Refresh inventory records').props.onClick(); assert.equal(reads[1].options.signal.aborted, true); assert.equal(reads[2].options.signal.aborted, true);
  reads[3].resolve({ data: { id: 'current-workspace' } }); await flush(); view.render(); assert.equal(reads.length, 6);
  reads[4].resolve({ data: inventoryPage([{ ...inventoryItem('current'), drug_name: 'Current stock record' }]) }); reads[5].resolve({ data: [] }); await refreshing; await flush(); view.render();
  reads[1].resolve({ data: inventoryPage([{ ...inventoryItem('old'), drug_name: 'Obsolete private stock' }]) }); reads[2].resolve({ data: [{ ...inventoryItem('old-alert'), drug_name: 'Obsolete private alert' }] }); await flush(); view.render();
  assert.match(view.text(), /Current stock record/); assert.doesNotMatch(view.text(), /Obsolete private/); assert.ok(reads[4].url.includes('current-workspace'));
});

test('pharmacy account change and unmount reject late reads and captured reload handlers', async () => {
  for (const stage of ['workspace', 'inventory']) {
    const reads = [], session = { current: 'A' };
    const view = inventoryView({ get(url, options) { const request = { url, options, ...deferred() }; reads.push(request); return request.promise; } }, { session });
    view.render(); if (stage === 'inventory') { reads[0].resolve({ data: { id: 'workspace-a' } }); await flush(); view.render(); }
    const refresh = view.button('Refresh inventory records').props.onClick; session.current = 'B'; await refresh(); assert.equal(reads.length, stage === 'workspace' ? 1 : 3);
    for (const request of reads) request.resolve({ data: request.url.endsWith('/me') ? { id: 'workspace-a' } : request.url.endsWith('/alerts') ? [{ ...inventoryItem(), drug_name: 'Old-account private alert' }] : inventoryPage([{ ...inventoryItem(), drug_name: 'Old-account private stock' }]) });
    await flush(); view.render(); assert.doesNotMatch(view.text(), /Old-account private/); view.unmount();
  }
});

test('pharmacy inventory does not invent a zero price or quantity for unknown recorded fields', async () => {
  const view = inventoryView({ async get(url) { return { data: url === '/ng/pharmacy/me' ? { id: 'pharmacy' } : url.endsWith('/alerts') ? [] : inventoryPage([{ ...inventoryItem(), selling_price: null, quantity_available: null, quantity_reserved: null }, { ...inventoryItem('zero'), drug_name: 'Actual zero record', selling_price: '0', quantity_available: 0, quantity_reserved: 0 }]) }; } });
  view.render(); await flush(); view.render(); assert.match(view.text(), /Price not recorded/); assert.match(view.text(), /Recorded quantity Not recorded/); assert.match(view.text(), /Reserved quantity Not recorded/); assert.match(view.text(), /NGN 0/); assert.match(view.text(), /Recorded quantity 0/);
});


test('pharmacy inventory teardown aborts pending workspace and data requests', async () => {
  for (const stage of ['workspace', 'inventory']) {
    const reads = [];
    const view = inventoryView({ get(url, options) { const request = { url, options, ...deferred() }; reads.push(request); return request.promise; } });
    view.render();
    if (stage === 'inventory') { reads[0].resolve({ data: { id: 'workspace' } }); await flush(); view.render(); }
    const before = view.text(); view.unmount();
    assert.ok((stage === 'workspace' ? reads : reads.slice(1)).every(request => request.options.signal.aborted));
    for (const request of reads) request.resolve({ data: request.url.endsWith('/me') ? { id: 'workspace' } : request.url.endsWith('/alerts') ? [] : inventoryPage([inventoryItem()]) });
    await flush(); view.render(); assert.equal(view.text(), before);
  }
});
