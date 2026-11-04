'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const service = require('../services/hospitalManagementService');
const actorId = crypto.randomUUID(), hospitalId = crypto.randomUUID(), otherId = crypto.randomUUID(), staffId = crypto.randomUUID();
const request = body => ({ user: { id: actorId, role: 'super_admin', marketScope: 'NG' }, body, headers: { 'x-market-scope': 'NG' } });
const staffInput = { full_name: 'Synthetic staff', role: 'doctor', department: 'Synthetic department', mdcn_or_license: 'Synthetic license' };
const registration = { name: 'Synthetic facility', facility_type: 'clinic', contact_name: 'Synthetic applicant', contact_email: 'fixture@example.invalid',
  contact_phone: '000', address_line1: 'Synthetic address', city: 'Synthetic city', state: 'Synthetic state' };

function fixture(options = {}) {
  const calls = [];
  let released = false;
  const client = {
    release() { released = true; },
    async query(sql, params) {
      calls.push({ sql, params });
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
      if (sql.includes('SELECT id, role, market_scope, is_active')) return { rows: options.noActor ? [] : [{ id: actorId, role: options.role || 'patient', market_scope: options.market || 'NG', is_active: options.active !== false }] };
      if (sql.includes('SELECT id,owner_user_id FROM ng_hospitals')) return { rows: options.missing ? [] : [{ id: hospitalId, owner_user_id: options.owner === undefined ? actorId : options.owner }] };
      if (sql.includes('SELECT id, role, market_scope FROM users')) return { rows: [{ id: options.owner || actorId, market_scope: options.ownerMarket || 'NG' }] };
      if (sql.includes("AND user_id=$2 AND status='active'")) return { rows: options.member ? [{ id: staffId }] : [] };
      if (sql.includes('INSERT INTO ng_hospitals')) return { rows: [{ id: hospitalId, slug: params[1], status: 'pending_review' }] };
      if (sql.includes('INSERT INTO ng_hospital_staff')) return { rows: [{ id: staffId, ...staffInput, status: 'active' }] };
      if (sql.startsWith('SELECT COUNT(*)')) return { rows: [{ count: '1' }] };
      if (sql.includes('FROM ng_hospitals h')) return { rows: [{ id: hospitalId, name: 'Synthetic facility', staff_count: 1 }] };
      if (sql.includes('FROM ng_hospital_staff')) return { rows: [{ id: staffId, ...staffInput, status: 'active' }] };
      if (sql.includes('INSERT INTO ng_audit_lineage')) {
        if (options.auditFailure) throw new Error('Sensitive internal database error');
        return { rows: [] };
      }
      throw new Error('Unexpected SQL: ' + sql);
    },
  };
  return { calls, pool: { connect: async () => client }, released: () => released };
}
const reads = [service.readHospital, service.readStaff];

test('hospital detail and staff reads use current NG owner/admin or active membership, never request claims', async () => {
  for (const read of reads) {
    for (const options of [{}, { owner: otherId, role: 'admin' }, { owner: null, role: 'super_admin' }, { owner: otherId, member: true }]) {
      const f = fixture(options);
      const result = await read(f.pool, request(), hospitalId);
      assert.equal(result.can_manage_staff, options.member ? false : true);
      assert.equal(f.calls.at(-1).sql, 'COMMIT');
      assert.equal(f.released(), true);
    }
    for (const options of [{ owner: otherId }, { owner: null }, { owner: otherId, member: false }, { market: 'US', role: 'admin' },
      { active: false }, { noActor: true }, { ownerMarket: 'US', role: 'admin' }, { missing: true }]) {
      const f = fixture(options);
      await assert.rejects(read(f.pool, request(), hospitalId), err => [403, 404].includes(err.status));
      assert.ok(!f.calls.some(call => call.sql.includes('FROM ng_hospitals h') || call.sql.startsWith('SELECT id,full_name')));
      assert.equal(f.calls.at(-1).sql, 'ROLLBACK');
      assert.equal(f.released(), true);
    }
  }
});

test('hospital and staff metadata reads are minimized and audited without copying personal details', async () => {
  for (const read of reads) {
    const f = fixture();
    await read(f.pool, request(), hospitalId);
    const sql = f.calls.map(call => call.sql).join('\n');
    assert.doesNotMatch(sql, /SELECT \*|fhir_endpoint|integration_notes|subscription_id/);
    const audit = f.calls.find(call => call.sql.includes('INSERT INTO ng_audit_lineage'));
    assert.equal(audit.params[0], actorId);
    assert.equal(audit.params[1], 'view');
    assert.doesNotMatch(JSON.stringify(audit.params), /Synthetic|fixture@/);
    const failed = fixture({ auditFailure: true });
    await assert.rejects(read(failed.pool, request(), hospitalId));
    assert.equal(failed.calls.at(-1).sql, 'ROLLBACK');
  }
});

test('only owner/admin may create a staff roster entry; active membership cannot create privilege', async () => {
  for (const options of [{ owner: otherId }, { owner: otherId, member: true }, { owner: null }, { market: 'US', role: 'admin' },
    { ownerMarket: 'US', role: 'admin' }, { active: false }, { noActor: true }, { missing: true }]) {
    const f = fixture(options);
    await assert.rejects(service.createStaff(f.pool, request(staffInput), hospitalId), err => [403, 404].includes(err.status));
    assert.ok(!f.calls.some(call => call.sql.includes('INSERT INTO ng_hospital_staff')));
  }
  for (const options of [{}, { owner: otherId, role: 'admin' }, { owner: null, role: 'super_admin' }]) {
    const f = fixture(options);
    const staff = await service.createStaff(f.pool, request({ ...staffInput, user_id: otherId, provider_id: otherId, status: 'active' }), hospitalId);
    assert.equal(staff.id, staffId); assert.equal(staff.full_name, staffInput.full_name);
    const insert = f.calls.find(call => call.sql.includes('INSERT INTO ng_hospital_staff'));
    assert.doesNotMatch(insert.sql.split('VALUES')[0], /user_id|provider_id|status/);
    assert.ok(!insert.params.includes(otherId));
    const audit = f.calls.find(call => call.sql.includes('INSERT INTO ng_audit_lineage'));
    assert.equal(audit.params[1], 'modify');
    assert.doesNotMatch(JSON.stringify(audit.params), /Synthetic|fixture@/);
    assert.equal(f.calls.at(-1).sql, 'COMMIT');
  }
  const failed = fixture({ auditFailure: true });
  await assert.rejects(service.createStaff(failed.pool, request(staffInput), hospitalId));
  assert.equal(failed.calls.at(-1).sql, 'ROLLBACK');
});

test('public registration never trusts an owner ID, signed-in registration binds the current NG account', async () => {
  for (const key of ['user_id', 'owner_user_id', 'userId', 'ownerUserId']) {
    for (const req of [{ body: { ...registration, [key]: otherId } }, request({ ...registration, [key]: actorId })]) {
      const f = fixture();
      await assert.rejects(service.registerHospital(f.pool, req), err => err.status === 400);
      assert.equal(f.calls.length, 0);
    }
  }
  for (const signedIn of [false, true]) {
    const f = fixture();
    const req = signedIn ? request(registration) : { body: registration };
    const result = await service.registerHospital(f.pool, req);
    const insert = f.calls.find(call => call.sql.includes('INSERT INTO ng_hospitals'));
    assert.equal(insert.params[24], signedIn ? actorId : null);
    assert.match(insert.sql, /'pending_review'/);
    assert.equal(result.ownerLinked, signedIn);
    assert.equal(result.hospital.status, 'pending_review');
    const audit = f.calls.find(call => call.sql.includes('INSERT INTO ng_audit_lineage'));
    assert.equal(audit.params[0], signedIn ? actorId : null);
    assert.equal(audit.params[1], 'submit');
    assert.doesNotMatch(JSON.stringify(audit.params), /Synthetic|fixture@/);
    assert.equal(f.calls.at(-1).sql, 'COMMIT');
  }
  for (const options of [{ active: false }, { market: 'US' }, { noActor: true }]) {
    const f = fixture(options);
    await assert.rejects(service.registerHospital(f.pool, request(registration)), err => err.status === 403);
    assert.ok(!f.calls.some(call => call.sql.includes('INSERT INTO ng_hospitals')));
  }
  const failed = fixture({ auditFailure: true });
  await assert.rejects(service.registerHospital(failed.pool, request(registration)));
  assert.equal(failed.calls.at(-1).sql, 'ROLLBACK');
});

test('registration and roster inputs reject invalid schemas before database acquisition', async () => {
  for (const change of [{ name: {} }, { address_line1: ' ' }, { contact_email: 'invalid' }, { contact_phone: 'x'.repeat(21) },
    { departments: 'not-an-array' }, { departments: [null] }, { bed_count: -1 }, { bed_count: 1.2 }, { has_lab: 'false' },
    { license_expiry: '2025-02-29' }, { name: 'x'.repeat(256) }]) {
    const f = fixture();
    await assert.rejects(service.registerHospital(f.pool, { body: { ...registration, ...change } }), err => err.status === 400);
    assert.equal(f.calls.length, 0);
  }
  for (const change of [{ full_name: ' ' }, { role: 'super_admin' }, { role: 'lab_scientist' }, { role: {} }, { phone: ['000'] }, { email: 'invalid' }, { department: 'x'.repeat(101) }]) {
    const f = fixture();
    await assert.rejects(service.createStaff(f.pool, request({ ...staffInput, ...change }), hospitalId), err => err.status === 400);
    assert.equal(f.calls.length, 0);
  }
  for (const fn of [...reads, (pool, req, id) => service.createStaff(pool, request(staffInput), id)]) {
    const f = fixture();
    await assert.rejects(fn(f.pool, request(), 'invalid'), err => err.status === 400);
    assert.ok(!f.calls.some(call => /FROM |INSERT INTO/.test(call.sql)));
  }
});

test('admin list rechecks current NG authority, scopes both queries and limits input', async () => {
  for (const options of [{}, { market: 'US', role: 'admin' }, { active: false, role: 'admin' }, { noActor: true }]) {
    const f = fixture(options);
    await assert.rejects(service.listHospitals(f.pool, request()), err => err.status === 403);
    assert.ok(!f.calls.some(call => call.sql.includes('FROM ng_hospitals h')));
  }
  const f = fixture({ role: 'admin' });
  const result = await service.listHospitals(f.pool, { ...request(), query: { status: 'documents_submitted', state: 'Synthetic state', limit: '10', offset: '0' } });
  assert.equal(result.total, 1);
  const queries = f.calls.filter(call => call.sql.includes('FROM ng_hospitals h'));
  assert.equal(queries.length, 2);
  for (const query of queries) { assert.match(query.sql, /h.owner_user_id IS NULL OR EXISTS/); assert.match(query.sql, /u.market_scope='NG'/); assert.doesNotMatch(query.sql, /SELECT \*|fhir_endpoint|integration_notes/); }
  assert.deepEqual(queries[0].params, ['documents_submitted', 'Synthetic state', 10, 0]);
  for (const query of [{ limit: '-1' }, { limit: '101' }, { offset: 'x' }, { offset: '-1' }, { status: 'invalid' }, { state: ['Lagos'] }]) {
    const invalid = fixture({ role: 'admin' });
    await assert.rejects(service.listHospitals(invalid.pool, { ...request(), query }), err => err.status === 400);
    assert.equal(invalid.calls.length, 0);
  }
});

function routes(pool) {
  const file = require.resolve('../routes/hospital'), actual = createRequire(file), handlers = new Map(), router = {};
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'use']) router[method] = (path, ...chain) => handlers.set(`${method} ${path}`, chain);
  let authCalls = 0;
  const authenticate = (req, res, next) => { authCalls++; if (req.rejectAuth) return res.status(401).json({ error: 'Authentication required' }); req.user = request().user; return next(); };
  const isolatedModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module: isolatedModule, exports: isolatedModule.exports, console, process, require(name) {
    if (name === 'express') return { Router: () => router };
    if (name === '../../server/db') return { getPool: () => pool };
    if (name === '../../server/middleware/auth') return { authenticate, requireRole: () => (req, res, next) => next() };
    return actual(name);
  } }, { filename: file });
  return { handlers, authCalls: () => authCalls };
}
const response = () => ({ headers: {}, statusCode: 200, set(key, value) { this.headers[key] = value; return this; }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } });

test('public registration middleware authenticates supplied credentials, never downgrading rejected sessions', async () => {
  const f = fixture(), r = routes(f.pool);
  const middleware = r.handlers.get('post /register')[0];
  let next = 0;
  await middleware({ headers: {} }, response(), () => { next++; });
  assert.equal(next, 1); assert.equal(r.authCalls(), 0);
  for (const context of [{ headers: { authorization: 'Bearer stale' } }, { headers: { authorization: '' } }, { cookies: { accessToken: 'revoked' } }]) {
    const res = response();
    await middleware({ ...context, rejectAuth: true }, res, () => { next++; });
    assert.equal(res.statusCode, 401);
  }
  assert.equal(next, 1); assert.equal(r.authCalls(), 3); assert.equal(f.calls.length, 0);
});

test('actual hospital routes return staff payload, no-store and safe errors even on connection/audit failure', async () => {
  const paths = ['post /register', 'get /:hospitalId', 'get /:hospitalId/staff', 'post /:hospitalId/staff', 'get /'];
  for (const path of paths) {
    const f = fixture({ role: 'admin' }), r = routes(f.pool), res = response();
    const req = { ...request(path === 'post /register' ? registration : staffInput), params: { hospitalId } };
    await r.handlers.get(path).at(-1)(req, res);
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
    assert.equal(res.statusCode, path.startsWith('post ') ? 201 : 200);
    if (path === 'post /:hospitalId/staff') { assert.equal(res.body.staff_id, staffId); assert.equal(res.body.staff.full_name, staffInput.full_name); }
    for (const pool of [fixture({ role: 'admin', auditFailure: true }).pool, { connect: async () => { throw new Error('Sensitive connection details'); } }]) {
      const broken = routes(pool), failed = response();
      await broken.handlers.get(path).at(-1)(req, failed);
      assert.equal(failed.statusCode, 503);
      assert.doesNotMatch(JSON.stringify(failed.body), /Sensitive|Synthetic|fixture@/);
    }
  }
});

test('hospital browser paths use canonical roster fields, preserve confirmed ownership and show load failures', () => {
  const staff = fs.readFileSync(require.resolve('../../app/ng/hospital/staff/page'), 'utf8');
  assert.match(staff, /lab_technician/); assert.doesNotMatch(staff, /lab_scientist|mdcn_number|specialty/);
  assert.match(staff, /can_manage_staff === true/); assert.match(staff, /if \(!response.ok\) throw/);
  assert.match(staff, /if \(!data.staff\?\.id/); assert.match(staff, /saving.current/); assert.match(staff, /Staff details are unavailable/);
  const register = fs.readFileSync(require.resolve('../../app/ng/hospital/register/page'), 'utf8');
  assert.match(register, /if \(selected\) localStorage.setItem\('ng_hospital_id', data.hospital.id\)/);
  assert.match(register, /operation.generation === authSessionGeneration\(\)/);
  assert.doesNotMatch(register, /setTimeout|2–5 business days/);
  assert.match(register, /public application is not linked to an account/);
});

function pageText(node) {
  if (Array.isArray(node)) return node.map(pageText).join(' ');
  return typeof node === 'string' ? node : node?.props ? pageText(node.props.children) : '';
}
function pageNodes(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(child => pageNodes(child, predicate));
  if (!node?.props) return [];
  return [...(predicate(node) ? [node] : []), ...pageNodes(node.props.children, predicate)];
}
function pendingResult() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function staffPageHarness(fetchResponse, { page = 'staff', initialToken = 'synthetic-access-token' } = {}) {
  const { transformSync } = require('next/dist/build/swc');
  const file = require.resolve(`../../app/ng/hospital/${page}/page`);
  const slots = [], effects = [], requests = [];
  const storage = { ng_hospital_id: hospitalId, accessToken: initialToken };
  const writes = [], events = new Map();
  const localStorage = { getItem: key => storage[key] ?? null, setItem(key, value) { writes.push([key, value]); storage[key] = value; }, removeItem(key) { delete storage[key]; } };
  const browser = { addEventListener(name, callback) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(callback); }, removeEventListener(name, callback) { events.get(name)?.delete(callback); } };
  const authFile = require.resolve('../../lib/authSession');
  const authCode = transformSync(fs.readFileSync(authFile, 'utf8'), { filename: authFile, jsc: { parser: { syntax: 'ecmascript' } }, module: { type: 'commonjs' } }).code;
  const authModule = { exports: {} };
  vm.runInNewContext(authCode, { module: authModule, exports: authModule.exports, localStorage, window: browser, atob, AbortController, setTimeout, clearTimeout });
  const session = authModule.exports;
  let cursor = 0, tree;
  const react = {
    useState(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: initial }; return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
    useRef(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: { current: initial } }; return slots[index].value; },
    useEffect(callback, deps) { const index = cursor++, previous = slots[index]; if (!previous || deps.some((value, i) => value !== previous.deps[i])) { const current = { deps }; slots[index] = current; effects.push(() => { previous?.cleanup?.(); current.cleanup = callback(); }); } },
  };
  const jsx = (type, props) => ({ type, props });
  const dependencies = { react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'next/link': { __esModule: true, default: 'a' },
    'lucide-react': new Proxy({}, { get: (_, key) => `icon-${String(key)}` }), '@/components/ui/button': { Button: 'button' }, '../../components/NgNav': { __esModule: true, default: 'nav' }, '@/lib/authSession': session, '../../lib/ngUtils': { NG_STATES: ['Lagos'], FACILITY_TYPES: ['Private Clinic'] } };
  const code = transformSync(fs.readFileSync(file, 'utf8'), { filename: file, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } }).code;
  const isolated = { exports: {} };
  vm.runInNewContext(code, { module: isolated, exports: isolated.exports, AbortController, window: browser, localStorage, process: { env: {} },
    fetch: async (url, options) => { requests.push({ url, options }); return fetchResponse(url, options); },
    require(name) { assert.ok(name in dependencies, name); return dependencies[name]; } });
  return {
    requests, storage, writes, session,
    unmount() { for (const slot of slots) slot.cleanup?.(); },
    storageChanged() { for (const callback of events.get('storage') || []) callback({ key: 'accessToken' }); },
    render() { cursor = 0; tree = isolated.exports.default(); for (const effect of effects.splice(0)) effect(); return tree; },
    async ready() { this.render(); await new Promise(resolve => setImmediate(resolve)); return this.render(); },
    nodes(predicate) { return pageNodes(tree, predicate); },
    text() { return pageText(tree); },
  };
}
const apiResponse = (body, ok = true) => ({ ok, json: async () => body });

test('rendered staff page adds the confirmed saved record once and protects an in-flight submission', async () => {
  const deferred = pendingResult();
  const view = staffPageHarness((url, options) => options.method === 'POST' ? deferred.promise : apiResponse({ staff: [], can_manage_staff: true }));
  await view.ready();
  const add = view.nodes(node => node.type === 'button' && pageText(node).trim() === 'Add Staff')[0];
  assert.equal(add.props.disabled, false); add.props.onClick(); view.render();
  view.nodes(node => node.type === 'input' && node.props.placeholder === 'Dr. Amaka Obi')[0].props.onChange({ target: { value: 'Synthetic clinician' } });
  view.render();
  const submit = view.nodes(node => node.type === 'form')[0].props.onSubmit;
  const work = submit({ preventDefault() {} });
  await submit({ preventDefault() {} });
  view.render();
  assert.equal(view.requests.filter(call => call.options.method === 'POST').length, 1);
  assert.ok(view.nodes(node => node.type === 'button' && ['Cancel', 'Adding…'].includes(pageText(node))).every(node => node.props.disabled));
  const body = JSON.parse(view.requests.at(-1).options.body);
  assert.equal(body.full_name, 'Synthetic clinician'); assert.ok('department' in body); assert.ok('mdcn_or_license' in body);
  deferred.resolve(apiResponse({ staff_id: staffId, staff: { id: staffId, full_name: 'Synthetic clinician', role: 'doctor' } }));
  await work; view.render();
  assert.match(view.text(), /Synthetic clinician/); assert.match(view.text(), /Staff member added successfully/);
  assert.equal(view.nodes(node => node.props.role === 'dialog').length, 0);
});

test('rendered staff page shows denied reads as unavailable and never treats a failed load as an empty roster', async () => {
  const view = staffPageHarness(() => apiResponse({ error: 'Hospital not found.', staff: [{ full_name: 'Must not render' }], can_manage_staff: true }, false));
  await view.ready();
  assert.match(view.text(), /Hospital not found/); assert.match(view.text(), /Staff details are unavailable/);
  assert.doesNotMatch(view.text(), /No staff added yet|Must not render/);
  assert.equal(view.nodes(node => node.type === 'button' && pageText(node).trim() === 'Add Staff')[0].props.disabled, true);
});

test('rendered staff page ignores an old successful write after the selected facility changes', async () => {
  const deferred = pendingResult();
  const view = staffPageHarness((url, options) => options.method === 'POST' ? deferred.promise : apiResponse({ staff: [], can_manage_staff: true }));
  await view.ready(); view.nodes(node => node.type === 'button' && pageText(node).trim() === 'Add Staff')[0].props.onClick(); view.render();
  const work = view.nodes(node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  view.storage.ng_hospital_id = otherId;
  await view.ready();
  deferred.resolve(apiResponse({ staff: { id: staffId, full_name: 'Old facility clinician', role: 'doctor' } }));
  await work; view.render();
  assert.doesNotMatch(view.text(), /Old facility clinician|Staff member added successfully/);
  assert.equal(view.requests.filter(call => call.options.method === 'POST').length, 1);
});

const browserToken = (id, suffix = 'original') => `synthetic.${Buffer.from(JSON.stringify({ userId: id })).toString('base64url')}.${suffix}`;
function registrationSubmit(view) {
  view.render();
  for (let step = 1; step < 3; step++) {
    view.nodes(node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} });
    view.render();
  }
  return () => view.nodes(node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} });
}
const registrationResponse = (id = hospitalId, ownerLinked = true) => apiResponse({ hospital: { id }, owner_linked: ownerLinked });

test('rendered registration selects the confirmed facility once only for the same mounted owner', async () => {
  const deferred = pendingResult();
  const view = staffPageHarness(() => deferred.promise, { page: 'register', initialToken: browserToken(actorId) });
  const submit = registrationSubmit(view);
  const work = submit(); await submit();
  assert.equal(view.requests.length, 1);
  deferred.resolve(registrationResponse(otherId));
  await work; view.render();
  assert.deepEqual(view.writes, [['ng_hospital_id', otherId]]);
  assert.match(view.text(), /Hospital registered!/);
  assert.equal(view.nodes(node => node.type === 'a' && pageText(node).includes('Open facility dashboard'))[0].props.href, '/ng/hospital/dashboard');
});

test('delayed registration cannot select account A facility after switching to B without a storage event', async () => {
  const deferred = pendingResult();
  const view = staffPageHarness(() => deferred.promise, { page: 'register', initialToken: browserToken(actorId) });
  const work = registrationSubmit(view)();
  view.storage.accessToken = browserToken(otherId);
  view.storage.ng_hospital_id = otherId;
  deferred.resolve(registrationResponse(hospitalId));
  await work; await new Promise(resolve => setImmediate(resolve)); view.render();
  assert.equal(view.storage.ng_hospital_id, otherId);
  assert.deepEqual(view.writes, []);
  assert.doesNotMatch(view.text(), /Hospital registered!|Open facility dashboard/);
  assert.match(view.text(), /Your sign-in changed/);
});

test('registration generation rejects an old response after logout and return to the same account', async () => {
  const deferred = pendingResult();
  const view = staffPageHarness(() => deferred.promise, { page: 'register', initialToken: browserToken(actorId) });
  const work = registrationSubmit(view)();
  view.session.beginAuthSessionTransition();
  view.session.writeAuthSessionTokens(null, null);
  view.session.beginAuthSessionTransition();
  view.session.writeAuthSessionTokens(browserToken(actorId), 'synthetic-refresh');
  const before = view.writes.length;
  deferred.resolve(registrationResponse(otherId));
  await work; view.render();
  assert.equal(view.storage.ng_hospital_id, hospitalId);
  assert.equal(view.writes.length, before);
  assert.doesNotMatch(view.text(), /Hospital registered!/);
  assert.match(view.text(), /Your sign-in changed/);
});

test('unmounted registration aborts and ignores late successful responses even if fetch ignores cancellation', async () => {
  const deferred = pendingResult();
  const view = staffPageHarness(() => deferred.promise, { page: 'register', initialToken: browserToken(actorId) });
  const work = registrationSubmit(view)();
  view.unmount();
  assert.equal(view.requests[0].options.signal.aborted, true);
  deferred.resolve(registrationResponse(otherId));
  await work;
  assert.deepEqual(view.writes, []);
  assert.equal(view.storage.ng_hospital_id, hospitalId);
});

test('account B can finish its registration while an older A error is ignored', async () => {
  const first = pendingResult(), second = pendingResult();
  let requests = 0;
  const view = staffPageHarness(() => ++requests === 1 ? first.promise : second.promise, { page: 'register', initialToken: browserToken(actorId) });
  const firstWork = registrationSubmit(view)();
  view.storage.accessToken = browserToken(otherId);
  view.storageChanged();
  await new Promise(resolve => setImmediate(resolve));
  view.render();
  assert.equal(view.requests[0].options.signal.aborted, true);
  const secondWork = view.nodes(node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  first.resolve(apiResponse({ error: 'Account A private registration failure' }, false));
  await firstWork; view.render();
  assert.equal(view.writes.length, 0);
  assert.doesNotMatch(view.text(), /Account A private/);
  assert.ok(view.nodes(node => node.type === 'button' && node.props.type === 'submit').every(node => node.props.disabled));
  second.resolve(registrationResponse(otherId));
  await secondWork; view.render();
  assert.deepEqual(view.writes, [['ng_hospital_id', otherId]]);
  assert.match(view.text(), /Hospital registered!/);
});

test('same-owner token refresh preserves a current registration but cookie-only ownership never selects globally', async () => {
  const deferred = pendingResult();
  const view = staffPageHarness(() => deferred.promise, { page: 'register', initialToken: browserToken(actorId) });
  const work = registrationSubmit(view)();
  view.session.writeAuthSessionTokens(browserToken(actorId, 'refreshed'), 'synthetic-refresh');
  deferred.resolve(registrationResponse(otherId));
  await work; view.render();
  assert.equal(view.storage.ng_hospital_id, otherId);
  assert.match(view.text(), /Hospital registered!/);
  for (const linked of [false, true]) {
    const anonymous = staffPageHarness(() => registrationResponse(otherId, linked), { page: 'register', initialToken: null });
    await registrationSubmit(anonymous)(); anonymous.render();
    assert.deepEqual(anonymous.writes, []);
    assert.doesNotMatch(anonymous.text(), /Open facility dashboard/);
    assert.match(anonymous.text(), linked ? /Sign in with that account/ : /public application is not linked/);
  }
});

test('a queued account-change notification does not cancel a registration newly submitted under that owner', async () => {
  const deferred = pendingResult();
  const view = staffPageHarness(() => deferred.promise, { page: 'register', initialToken: browserToken(actorId) });
  const submit = registrationSubmit(view);
  view.storage.accessToken = browserToken(otherId);
  const work = submit();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.requests[0].options.headers.Authorization, `Bearer ${browserToken(otherId)}`);
  assert.equal(view.requests[0].options.signal.aborted, false);
  deferred.resolve(registrationResponse(otherId));
  await work; view.render();
  assert.deepEqual(view.writes, [['ng_hospital_id', otherId]]);
  assert.match(view.text(), /Hospital registered!/);
});
