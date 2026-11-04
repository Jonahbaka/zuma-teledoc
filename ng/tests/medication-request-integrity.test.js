'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const express = require('express');
const service = require('../services/pharmacy/medicationRequestService');
const ids = { actor: '00000000-0000-4000-8000-000000000001', pharmacy: '00000000-0000-4000-8000-000000000002', request: '00000000-0000-4000-8000-000000000003', other: '00000000-0000-4000-8000-000000000004' };
const pharmacist = { id: ids.actor, role: 'pharmacy', marketScope: 'NG' };
const administrator = { ...pharmacist, role: 'admin' };
function poolFor({ actor = true, pharmacy = true, request = true, status = 'pending_pharmacy_confirmation', auditFails = false, assigned = null } = {}) {
  const calls = [];
  const existing = { id: ids.request, status, assigned_pharmacy_id: assigned, preferred_pharmacy_id: ids.pharmacy, confirmed_price_ngn: '9500.00' };
  const client = { released: false, release() { this.released = true; }, async query(sql, values = []) {
    calls.push({ sql, values });
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    if (sql.includes('FROM users')) { assert.match(sql, /is_active=TRUE AND account_status='active' AND market_scope='NG' FOR SHARE/); return { rows: actor ? [{ id: values[0], role: values[1] }] : [] }; }
    if (sql.includes('FROM ng_pharmacies')) { assert.match(sql, /account_status='active'/); assert.match(sql, /verified_at IS NOT NULL AND pcn_license_expiry>=CURRENT_DATE FOR SHARE/); return { rows: pharmacy ? [{ id: values[0] }] : [] }; }
    if (sql.startsWith('SELECT r.*')) { assert.match(sql, /COALESCE\(r.assigned_pharmacy_id,r.preferred_pharmacy_id\)=\$2\) FOR UPDATE/); return { rows: request ? [{ ...existing }] : [] }; }
    if (sql.includes('FROM ng_medication_requests r')) { assert.match(sql, /COALESCE\(r.assigned_pharmacy_id,r.preferred_pharmacy_id\)=\$1/); assert.match(sql, /FOR SHARE OF r/); assert.match(sql, /ORDER BY CASE r.status[\s\S]*WHEN 'pending_pharmacy_confirmation' THEN 1[\s\S]*WHEN 'pharmacy_reviewing' THEN 2[\s\S]*WHEN 'clarification_requested' THEN 3[\s\S]*WHEN 'available' THEN 4[\s\S]*r.created_at DESC,r.id LIMIT 100/); assert.doesNotMatch(sql, /r\.\*|session_id|admin_notes|prescription_attachment_url|location_latitude/); return { rows: request ? [{ ...existing }] : [] }; }
    if (sql.startsWith('UPDATE ng_medication_requests')) {
      const row = { ...existing };
      for (const match of sql.matchAll(/(\w+)=\$(\d+)/g)) if (match[1] !== 'id') row[match[1]] = values[Number(match[2]) - 1];
      return { rows: [row] };
    }
    if (sql.includes('INSERT INTO ng_compliance_audit_log')) { if (auditFails) throw new Error('private connection failure'); return { rows: [] }; }
    throw new Error(`Unexpected query: ${sql}`);
  } };
  return { calls, client, async connect() { return client; } };
}
const rejected = status => error => error.statusCode === status;

test('availability payloads reject false completion, malformed prices, large notes and unknown fields', () => {
  assert.deepEqual(service.validate({ status: 'available', confirmedPriceNgn: '4500.25' }), { status: 'available', confirmedPriceNgn: 4500.25 });
  for (const admin of [false, true]) for (const status of ['fulfilled', 'completed']) assert.throws(() => service.validate({ status }, admin), rejected(409));
  for (const value of [-1, 1.001, true, {}, [], '1e3', '0x10', '-1', '10000000000.00', '1.234']) assert.throws(() => service.validate({ status: 'available', confirmedPriceNgn: value }), rejected(400));
  for (const input of [{ status: 'clarification_requested' }, { status: 'available', pharmacyNotes: 'x'.repeat(4001) }, { status: 'available', pharmacyNotes: 'bad\u0000note' }, { status: 'available', patientUserId: ids.other }, { status: 'available', assignedPharmacyId: ids.other }, []]) assert.throws(() => service.validate(input), rejected(400));
});

test('only current active NG pharmacy owners may read scoped availability requests', async () => {
  for (const actor of [administrator, { ...pharmacist, role: 'patient' }, { ...pharmacist, id: 'not-a-uuid' }]) {
    const pool = poolFor(); await assert.rejects(service.listPharmacyRequests(pool, actor, ids.pharmacy), rejected(403));
    assert.equal(pool.calls.some(call => call.sql.includes('FROM ng_medication_requests')), false);
  }
  for (const options of [{ actor: false }, { pharmacy: false }]) {
    const pool = poolFor(options); await assert.rejects(service.listPharmacyRequests(pool, pharmacist, ids.pharmacy), rejected(403));
    assert.equal(pool.calls.some(call => call.sql.includes('FROM ng_medication_requests')), false);
    assert.equal(pool.calls.at(-1).sql, 'ROLLBACK');
  }
  const pool = poolFor(); assert.equal((await service.listPharmacyRequests(pool, pharmacist, ids.pharmacy)).length, 1);
  assert.ok(pool.calls.some(call => call.sql.includes('INSERT INTO ng_compliance_audit_log'))); assert.equal(pool.calls.at(-1).sql, 'COMMIT');
});

test('a reassigned request cannot be read or mutated through its former preferred pharmacy', async () => {
  const pool = poolFor({ request: false, assigned: ids.other });
  assert.deepEqual(await service.listPharmacyRequests(pool, pharmacist, ids.pharmacy), []);
  await assert.rejects(service.updateRequest(pool, pharmacist, ids.request, { status: 'available' }, ids.pharmacy), rejected(404));
  assert.equal(pool.calls.some(call => call.sql.startsWith('UPDATE ng_medication_requests')), false);
});

test('approved pharmacy availability responses are transactional, scoped and audited without clinical content in audit', async () => {
  const pool = poolFor();
  const row = await service.updateRequest(pool, pharmacist, ids.request, { status: 'available', confirmedPriceNgn: '25.50', pharmacyNotes: 'Private clinical note' }, ids.pharmacy);
  assert.equal(row.status, 'available'); assert.equal(row.confirmed_price_ngn, 25.5);
  assert.equal(pool.calls.at(-1).sql, 'COMMIT'); assert.equal(pool.client.released, true);
  const audit = pool.calls.find(call => call.sql.includes('INSERT INTO ng_compliance_audit_log'));
  assert.equal(audit.values[0], pharmacist.id); assert.equal(audit.values[5], ids.request); assert.doesNotMatch(JSON.stringify(audit.values), /Private clinical note/);
  const update = pool.calls.find(call => call.sql.startsWith('UPDATE ng_medication_requests'));
  assert.doesNotMatch(update.sql, /ng_orders|ng_rx_items|dispensed|fulfilled|completed/);
});

test('failed audit rolls back reads and writes without claiming success', async () => {
  for (const operation of [pool => service.listPharmacyRequests(pool, pharmacist, ids.pharmacy), pool => service.updateRequest(pool, pharmacist, ids.request, { status: 'available' }, ids.pharmacy)]) {
    const pool = poolFor({ auditFails: true }); await assert.rejects(operation(pool), /private connection failure/);
    assert.equal(pool.calls.at(-1).sql, 'ROLLBACK'); assert.equal(pool.calls.some(call => call.sql === 'COMMIT'), false); assert.equal(pool.client.released, true);
  }
});

test('closed request history cannot be reopened or overwritten by pharmacy or administrator', async () => {
  for (const status of ['cancelled', 'fulfilled', 'completed', 'unknown']) for (const actor of [pharmacist, administrator]) {
    const pool = poolFor({ status });
    await assert.rejects(service.updateRequest(pool, actor, ids.request, { status: 'available' }, actor.role === 'pharmacy' ? ids.pharmacy : null), rejected(409));
    assert.equal(pool.calls.some(call => call.sql.startsWith('UPDATE ng_medication_requests')), false);
  }
});

test('admin reassignment rechecks the destination and clears prior pharmacy confirmation without SQL parameter gaps', async () => {
  const pool = poolFor({ status: 'available' });
  const row = await service.updateRequest(pool, administrator, ids.request, { assignedPharmacyId: ids.other, status: 'pending_pharmacy_confirmation', pharmacyNotes: null });
  assert.equal(row.assigned_pharmacy_id, ids.other); assert.equal(row.status, 'pending_pharmacy_confirmation'); assert.equal(row.confirmed_price_ngn, null); assert.equal(row.pharmacy_notes, null);
  const update = pool.calls.find(call => call.sql.startsWith('UPDATE ng_medication_requests'));
  const numbers = new Set([...update.sql.matchAll(/\$(\d+)/g)].map(match => +match[1]));
  assert.equal(numbers.size, update.values.length);
  assert.match(update.sql, /pharmacy_responded_at=NULL/);
  for (const body of [{ assignedPharmacyId: ids.other, status: 'available' }, { assignedPharmacyId: ids.other, confirmedPriceNgn: 25 }]) {
    const rejectedPool = poolFor(); await assert.rejects(service.updateRequest(rejectedPool, administrator, ids.request, body), rejected(409));
    assert.equal(rejectedPool.calls.some(call => call.sql.startsWith('UPDATE ng_medication_requests')), false);
  }
  await assert.rejects(service.updateRequest(poolFor({ pharmacy: false }), administrator, ids.request, { assignedPharmacyId: ids.other }), rejected(403));
});

let activePool, actor;
const routeFile = require.resolve('../routes/pharmacy');
const originalLoad = Module._load;
let router;
try {
  Module._load = function(request, parent) {
    if (parent?.filename === routeFile && request === '../../server/db') return { getPool: () => activePool };
    return originalLoad.apply(this, arguments);
  };
  delete require.cache[routeFile]; router = require(routeFile);
} finally { Module._load = originalLoad; }
async function withRoute(pool, account, run) {
  activePool = pool; actor = account;
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.user = actor; next(); }); app.use('/pharmacy', router);
  const server = await new Promise(resolve => { const result = app.listen(0, '127.0.0.1', () => resolve(result)); });
  try { await run((suffix = '', body) => fetch(`http://127.0.0.1:${server.address().port}/pharmacy/${ids.pharmacy}/medication-requests${suffix}`, body === undefined ? {} : { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
test('authenticated HTTP routes preserve deny/error statuses, private cache policy and no fake completion', async () => {
  await withRoute(poolFor(), pharmacist, async request => {
    const read = await request(); assert.equal(read.status, 200); assert.match(read.headers.get('cache-control'), /private, no-store/);
    const completed = await request(`/${ids.request}`, { status: 'completed' }); assert.equal(completed.status, 409);
    const available = await request(`/${ids.request}`, { status: 'available' }); assert.equal(available.status, 200);
  });
  await withRoute(poolFor(), administrator, async request => assert.equal((await request()).status, 403));
  await withRoute(poolFor({ auditFails: true }), pharmacist, async request => {
    const response = await request(`/${ids.request}`, { status: 'available' }); assert.equal(response.status, 503);
    assert.doesNotMatch(JSON.stringify(await response.json()), /private connection failure/);
  });
});
test('both portals remove fulfillment shortcuts and admin updates use the shared guarded service', () => {
  for (const name of ['app/ng/pharmacy/orders/page.js', 'app/ng/admin/medications/page.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../../', name), 'utf8');
    assert.doesNotMatch(source, /(?:respondToMedicationRequest|updateRequestStatus)\(request.id, '(?:fulfilled|completed)'/);
    assert.match(source, /verified (?:medication )?order workflow/);
  }
  const admin = fs.readFileSync(path.join(__dirname, '../routes/admin.js'), 'utf8');
  const block = admin.slice(admin.indexOf("router.patch('/medication-requests/:requestId'"), admin.indexOf('// Medication source audit'));
  assert.match(block, /medicationRequests.updateRequest/); assert.doesNotMatch(block, /UPDATE ng_medication_requests/);
});
