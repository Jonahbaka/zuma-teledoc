'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
function load(filename, overrides = {}) {
  const local = createRequire(filename), loaded = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: loaded, exports: loaded.exports, Buffer, process, console,
    require(name) { return overrides[name] || local(name); },
  }, { filename });
  return loaded.exports;
}
const noPool = { getPool() { throw new Error('Every query must use the authorized transaction client'); } };
const inventory = load(require.resolve('../services/pharmacy/inventoryService'), { '../../../server/db': noPool });
const onboarding = load(require.resolve('../services/pharmacy/pharmacyOnboardingService'), { '../../../server/db': noPool });
const service = load(require.resolve('../services/pharmacy/inventoryMutationService'), { './inventoryService': inventory, './pharmacyOnboardingService': onboarding });
const ids = Object.fromEntries(['actor','pharmacy','inventory','drug','other'].map((key,i)=>[key,`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`]));
const actor = { id: ids.actor, role: 'pharmacy' };
const item = { drugId: ids.drug, quantity: 2, costPrice: 8, sellingPrice: 9, batchNumber: 'DEFAULT', expiryDate: '2099-01-01' };
function fixture() {
  const state = { account: { id: ids.actor, role: 'pharmacy', is_active: true, account_status: 'active', market_scope: 'NG' }, pharmacy: { id: ids.pharmacy, owner_user_id: ids.actor, account_status: 'active', status: 'approved' }, row: { id: ids.inventory, quantity_available: 10, quantity_reserved: 3, cost_price: 8, selling_price: 9, availability_verification_status: 'verified', availability_verified_at: 'original-proof', availability_verified_by: ids.other }, audits: [], calls: [], connections: 0, auditFails: false };
  let original, savepoint;
  const client = { release() {}, async query(sql, values = []) {
    state.calls.push(sql);
    if (sql === 'BEGIN') { original = structuredClone({ row: state.row, audits: state.audits }); return { rows: [] }; }
    if (sql === 'COMMIT') return { rows: [] };
    if (sql === 'ROLLBACK') { Object.assign(state, original); return { rows: [] }; }
    if (sql === 'SAVEPOINT inventory_import_row') { savepoint = structuredClone(state.row); return { rows: [] }; }
    if (sql === 'ROLLBACK TO SAVEPOINT inventory_import_row') { state.row = savepoint; return { rows: [] }; }
    if (sql === 'RELEASE SAVEPOINT inventory_import_row') return { rows: [] };
    if (sql.includes('FROM users')) { assert.match(sql, /FOR SHARE/); return { rows: [state.account] }; }
    if (sql.includes('FROM ng_pharmacies')) { if (sql.includes('owner_user_id')) assert.match(sql, /FOR SHARE|owner_user_id = \$2/); return { rows: state.pharmacy ? [state.pharmacy] : [] }; }
    if (sql.startsWith('SELECT availability_verification_status')) { assert.match(sql, /FOR UPDATE/); return { rows: values[0] === ids.inventory ? [state.row] : [] }; }
    if (sql.includes('SELECT id, name, category FROM ng_drug_catalog')) return { rows: values[0] === ids.drug ? [{ id: ids.drug, name: 'Synthetic catalogue item' }] : [] };
    if (sql.startsWith('UPDATE ng_pharmacy_inventory SET')) {
      for (const match of sql.matchAll(/(quantity_available|selling_price|cost_price|discount_percent|reorder_level|is_available|expiry_date|markup_percent) = \$(\d+)/g)) state.row[match[1]] = values[Number(match[2])-1];
      if (sql.includes("availability_verification_status = 'unverified'")) Object.assign(state.row, { availability_verification_status: 'unverified', availability_verified_at: null, availability_verified_by: null });
      return { rows: [{ ...state.row }] };
    }
    if (sql.includes('INSERT INTO ng_pharmacy_inventory')) {
      if (values[1] !== ids.drug) throw Object.assign(new Error('Private SQL foreign key details'), { code: '23503' });
      assert.match(sql, /availability_verification_status = 'unverified'/); assert.match(sql, /availability_verified_at = NULL/); assert.match(sql, /availability_verified_by = NULL/);
      state.row.quantity_available = sql.includes('quantity_available + EXCLUDED') ? state.row.quantity_available + values[2] : values[2];
      Object.assign(state.row, { cost_price: values[3], selling_price: values[4], availability_verification_status: 'unverified', availability_verified_at: null, availability_verified_by: null });
      return { rows: [{ ...state.row }] };
    }
    if (sql.includes('INSERT INTO ng_compliance_audit_log')) { if (state.auditFails) throw new Error('Private mandatory audit failure'); state.audits.push(values); return { rows: [] }; }
    throw new Error('Unexpected query: ' + sql);
  } };
  return { state, pool: { async connect() { state.connections++; return client; } }, run(action, input = action === 'update' ? { quantityAvailable: 7 } : { items: [item] }, who = actor) { return service.mutate(this.pool, who, ids.pharmacy, action, input, ids.inventory); } };
}
test('all mutation paths deny stale user, suspended workspace and reassigned ownership before inventory writes', async () => {
  for (const action of ['update','add','import']) for (const change of ['userSuspended','inactive','roleRevoked','wrongMarket','workspaceSuspended','statusSuspended','statusDeactivated','reassigned']) {
    const f = fixture();
    if (change === 'userSuspended') f.state.account.account_status = 'suspended';
    if (change === 'inactive') f.state.account.is_active = false;
    if (change === 'roleRevoked') f.state.account.role = 'patient';
    if (change === 'wrongMarket') f.state.account.market_scope = 'US';
    if (change === 'workspaceSuspended') f.state.pharmacy.account_status = 'suspended';
    if (change === 'statusSuspended') f.state.pharmacy.status = 'suspended';
    if (change === 'statusDeactivated') f.state.pharmacy.status = 'deactivated';
    if (change === 'reassigned') f.state.pharmacy.owner_user_id = ids.other;
    await assert.rejects(f.run(action), error => error.status === 403);
    assert.equal(f.state.calls.some(sql => /^(UPDATE|INSERT)/.test(sql)), false); assert.equal(f.state.calls.at(-1), 'ROLLBACK');
  }
});
test('pending workspace preparation and current administrator update/import semantics are preserved', async () => {
  for (const action of ['update','import']) {
    const f = fixture(); Object.assign(f.state.pharmacy, { status: 'pending_review', account_status: 'pending_onboarding' }); await f.run(action);
    assert.equal(f.state.row.availability_verification_status, 'unverified'); assert.equal(f.state.audits.length, 1); assert.equal(f.state.row.quantity_reserved, 3);
    const admin = fixture(); Object.assign(admin.state.account, { role: 'super_admin', market_scope: 'US' }); admin.state.pharmacy.owner_user_id = ids.other; await admin.run(action);
    assert.equal(admin.state.audits.length, 1);
  }
  const pending = fixture(); Object.assign(pending.state.pharmacy, { status: 'pending_review', account_status: 'pending_onboarding' }); await assert.rejects(pending.run('add'), error => error.status === 403);
  const admin = fixture(); admin.state.account.role = 'admin'; admin.state.pharmacy.owner_user_id = ids.other; await assert.rejects(admin.run('add'), error => error.status === 403);
});
test('adding stock to a previously verified batch invalidates proof and commits one mandatory audit', async () => {
  const f = fixture(); const result = await f.run('add');
  assert.equal(result.added[0].inventory.quantity_available, 12); assert.equal(f.state.row.availability_verification_status, 'unverified');
  assert.equal(f.state.row.availability_verified_at, null); assert.equal(f.state.row.availability_verified_by, null); assert.equal(f.state.row.quantity_reserved, 3);
  assert.equal(f.state.audits.length, 1); assert.equal(f.state.calls.at(-1), 'COMMIT');
});
test('batch import preserves row skips with savepoints and never leaks database errors', async () => {
  const f = fixture(); const result = await f.run('import', { items: [{ ...item, drugId: ids.other }, { drugName: 'Unmapped item' }, item] });
  assert.equal(result.imported, 1); assert.equal(result.skipped, 2); assert.equal(f.state.row.quantity_available, 2); assert.equal(f.state.audits.length, 1);
  assert.ok(f.state.calls.includes('ROLLBACK TO SAVEPOINT inventory_import_row')); assert.doesNotMatch(JSON.stringify(result), /Private SQL|foreign key/);
});
test('mandatory audit failure rolls all inventory mutations back, including successful import rows', async () => {
  for (const action of ['update','add','import']) {
    const f = fixture(); const before = structuredClone(f.state.row); f.state.auditFails = true;
    await assert.rejects(f.run(action), /Private mandatory audit failure/);
    assert.deepEqual(f.state.row, before); assert.equal(f.state.audits.length, 0); assert.equal(f.state.calls.at(-1), 'ROLLBACK');
  }
});
test('bounded payload cannot supply authority, verification or unsupported stock fields', async () => {
  for (const [action,input] of [['update',{ quantityReserved: 100 }],['update',{ quantityAvailable: 1, role: 'super_admin' }],['import',{ items: Array(501).fill(item) }],['add',{ items: [{ ...item, availabilityVerified: true }] }],['update',{ expiryDate: '2026-02-30' }]]) {
    const f = fixture(); await assert.rejects(f.run(action,input), error => error.status === 400); assert.equal(f.state.connections, 0);
  }
});
test('all three registered mutation routes delegate authenticated authority and sanitize unconfirmed errors', async () => {
  const f = fixture(), routes = new Map(); const router = { use() {}, get() {}, delete() {}, put() {} };
  for (const method of ['post','patch']) router[method] = (route,...handlers) => routes.set(method + route, handlers.at(-1));
  load(require.resolve('../routes/pharmacy'), new Proxy({ express: { Router: () => router }, '../../server/db': { getPool: () => f.pool }, '../services/pharmacy/inventoryMutationService': service }, { get(target,key) { return target[key] || {}; } }));
  for (const [method,path,body] of [['post','/:pharmacyId/inventory',{ items: [item] }],['patch','/:pharmacyId/inventory/:itemId',{ quantityAvailable: 5 }],['post','/:pharmacyId/inventory/bulk-import',{ items: [item] }]]) {
    f.state.auditFails = true; const result = { headers: {} }; const res = { set(k,v) { result.headers[k] = v; return this; }, status(v) { result.status = v; return this; }, json(v) { result.body = v; return this; } };
    await routes.get(method+path)({ user: actor, params: { pharmacyId: ids.pharmacy, itemId: ids.inventory }, body },res);
    assert.equal(result.status, 503); assert.equal(result.headers['Cache-Control'], 'private, no-store'); assert.doesNotMatch(JSON.stringify(result.body), /Private|audit failure/);
  }
});

test('inventory read pagination has a stable batch tie-breaker and preserves pharmacy-bound parameters', async () => {
  const calls = [];
  const pool = { async query(sql, params) { calls.push({ sql, params }); return { rows: sql.includes('COUNT(*)') ? [{ count: '51' }] : [{ id: 'synthetic-batch' }] }; } };
  const reader = load(require.resolve('../services/pharmacy/inventoryService'), { '../../../server/db': { getPool: () => pool } });
  const result = await reader.getInventory('current-pharmacy', { page: 2, limit: 50 });
  const page = calls.find(call => call.sql.includes('ORDER BY'));
  assert.match(page.sql, /WHERE i\.pharmacy_id = \$1/); assert.match(page.sql, /ORDER BY d\.name ASC, i\.id ASC LIMIT \$2 OFFSET \$3/);
  assert.deepEqual(Array.from(page.params), ['current-pharmacy', 50, 50]); assert.deepEqual(Array.from(calls.find(call => call.sql.includes('COUNT(*)')).params), ['current-pharmacy']);
  assert.equal(result.page, 2); assert.equal(result.totalPages, 2); assert.equal(result.total, 51);
});
