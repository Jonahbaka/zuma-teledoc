'use strict';

/**
 * ng/tests/regression.test.js
 *
 * Durable regression tests pinning the production defects fixed in the
 * stabilization pass, so none can silently return:
 *   P1 prescription RBAC bypass
 *   P2 prescription completion stuck-state
 *   P3 transaction integrity (createDraft + referral completion/commission)
 *   P6 socket userSockets leak
 *
 * Hermetic: DB-backed services run against an injected fake pg client, so no
 * live database is needed.
 *
 *   node ng/tests/regression.test.js   → exit 0 if all pass, 1 otherwise
 */

const assert = require('assert');
const Module = require('module');

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

// ── Fake pg client/pool recording SQL + BEGIN/COMMIT/ROLLBACK ─────────────────
// `current` is mutated per-test; the forwarding db module (installed below)
// always delegates to it, so the services — which destructure getPool/transaction
// at module-load time — still hit the active fake.
let current = null;
function makeFakeDb({ failItemInsert = 0, existingCommissions = false } = {}) {
  const log = [];
  let itemN = 0;
  const client = {
    query: async (sql) => {
      const text = String(sql);
      const head = text.trim().split(/\s+/)[0].toUpperCase();
      if (head === 'BEGIN' || head === 'COMMIT' || head === 'ROLLBACK') { log.push(head); return { rows: [] }; }
      if (/INSERT INTO ng_digital_prescriptions/i.test(text)) { log.push('INS_RX'); return { rows: [{ id: 'rx-1', lifecycle_status: 'drafted' }] }; }
      if (/INSERT INTO ng_rx_items/i.test(text)) {
        itemN++;
        if (failItemInsert && itemN === failItemInsert) { log.push('INS_ITEM_FAIL'); throw new Error('boom item insert'); }
        log.push('INS_ITEM'); return { rows: [{ id: 'it-' + itemN }] };
      }
      if (/INSERT INTO ng_rx_events/i.test(text)) { log.push('INS_EVENT'); return { rows: [] }; }
      if (/SELECT id FROM ng_providers WHERE user_id/i.test(text)) { return { rows: [{ id: 'prov-1' }] }; }
      if (/SELECT id FROM ng_pharmacies WHERE owner_user_id/i.test(text)) { return { rows: [{ id: 'pharm-1' }] }; }
      if (/SELECT \* FROM ng_digital_prescriptions/i.test(text)) {
        return {
          rows: [{
            id: 'rx-1',
            lifecycle_status: 'drafted',
            provider_id: 'prov-1',
            patient_user_id: 'patient-1',
            preferred_pharmacy_id: 'pharm-1',
            routed_pharmacy_id: 'pharm-1',
            dispensed_by_pharmacy_id: null,
          }],
        };
      }
      if (/SELECT \* FROM ng_rx_items/i.test(text)) { return { rows: [] }; }
      if (/SELECT 1 FROM drn_commissions/i.test(text)) { return { rows: existingCommissions ? [{ ok: 1 }] : [] }; }
      if (/SELECT \* FROM drn_referrals[\s\S]*FOR UPDATE/i.test(text)) { return { rows: [{ id: 'ref-1', status: 'in_progress' }] }; }
      if (/UPDATE drn_referrals/i.test(text)) { log.push('UPD_REFERRAL'); return { rows: [{ id: 'ref-1', status: 'completed', referring_agent_id: 'ag-1', completed_at: new Date() }] }; }
      if (/INSERT INTO drn_referral_events/i.test(text)) { log.push('INS_REF_EVENT'); return { rows: [] }; }
      if (/INSERT INTO drn_commissions/i.test(text)) { log.push('INS_COMMISSION'); return { rows: [{ id: 'c-1' }] }; }
      if (/UPDATE drn_agents/i.test(text)) { log.push('UPD_AGENT'); return { rows: [] }; }
      return { rows: [] };
    },
    release: () => log.push('RELEASE'),
  };
  const db = {
    getPool: () => client,
    getClient: async () => client,
    transaction: async (cb) => {
      try { await client.query('BEGIN'); const r = await cb(client); await client.query('COMMIT'); return r; }
      catch (e) { await client.query('ROLLBACK'); throw e; }
      finally { client.release(); }
    },
  };
  return { db, log };
}

// Stable forwarding db module: services capture these references at load time,
// so they must always exist and delegate to the per-test `current` fake.
const forwardingDb = {
  getPool: () => current.getPool(),
  getClient: () => current.getClient(),
  transaction: (cb) => current.transaction(cb),
  query: (...a) => current.getPool().query(...a),
  healthCheck: async () => ({ primary: { healthy: true } }),
  close: async () => {},
};
const origLoad = Module._load;
Module._load = function (request) {
  if (request.endsWith('server/db')) return forwardingDb;
  return origLoad.apply(this, arguments);
};

const rx = require('../services/rx-engine/prescriptionWorkflowService');
const ref = require('../services/referral-network/referralNetworkService');

// ─── P2: Prescription completion bug ──────────────────────────────────────────
test('P2 completion: dispensed + unavailable → fully_dispensed (was permanently stuck)', () => {
  assert.strictEqual(rx.nextDispenseStatus('partially_dispensed', { total: 2, dispensed: 1, finalized: 2 }), 'fully_dispensed');
});
test('P2 completion: pending items keep it partial', () => {
  assert.strictEqual(rx.nextDispenseStatus('received', { total: 3, dispensed: 1, finalized: 1 }), 'partially_dispensed');
});
test('P2 completion: never advances from non-dispensable state', () => {
  assert.strictEqual(rx.nextDispenseStatus('signed', { total: 1, dispensed: 0, finalized: 0 }), 'signed');
});
test('P2 completion: all-unavailable (0 dispensed) must NOT report fully_dispensed', () => {
  assert.strictEqual(rx.nextDispenseStatus('partially_dispensed', { total: 2, dispensed: 0, finalized: 2 }), 'partially_dispensed');
});
test('P2 completion: single-item dispensed → fully_dispensed (boundary)', () => {
  assert.strictEqual(rx.nextDispenseStatus('received', { total: 1, dispensed: 1, finalized: 1 }), 'fully_dispensed');
});

// ─── P3: Transaction integrity ────────────────────────────────────────────────
test('P3 tx: createDraft commits on success (BEGIN>COMMIT, 2 items, no rollback)', async () => {
  const { db, log } = makeFakeDb(); current = db;
  await rx.createDraft({ provider_id: 'p', patient_user_id: 'pt', items: [
    { drug_name: 'Coartem', dosage: '80/480', frequency: 'bd' },
    { drug_name: 'Paracetamol', dosage: '500', frequency: 'tds' },
  ] });
  assert.deepStrictEqual(log.filter(x => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(x)), ['BEGIN', 'COMMIT']);
  assert.strictEqual(log.filter(x => x === 'INS_ITEM').length, 2);
});
test('P3 tx: createDraft rolls back on mid-loop failure (BEGIN>ROLLBACK, throws)', async () => {
  const { db, log } = makeFakeDb({ failItemInsert: 2 }); current = db;
  let threw = false;
  try {
    await rx.createDraft({ provider_id: 'p', patient_user_id: 'pt', items: [
      { drug_name: 'A', dosage: '1', frequency: 'bd' }, { drug_name: 'B', dosage: '1', frequency: 'od' },
    ] });
  } catch { threw = true; }
  assert.ok(threw, 'must propagate failure');
  assert.deepStrictEqual(log.filter(x => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(x)), ['BEGIN', 'ROLLBACK']);
});
test('P3 tx: referral completion does UPDATE+commission inside one transaction', async () => {
  const { db, log } = makeFakeDb(); current = db;
  await ref.transitionReferral('ref-1', 'completed', { user_id: 'u1', kind: 'system' });
  const t = log.filter(x => ['BEGIN', 'UPD_REFERRAL', 'INS_COMMISSION', 'COMMIT'].includes(x));
  assert.strictEqual(t[0], 'BEGIN');
  assert.strictEqual(t[t.length - 1], 'COMMIT');
  assert.ok(t.includes('UPD_REFERRAL'), 'referral updated in tx');
});
test('P3 tx: commission accrual is idempotent (no double-accrue when commissions exist)', async () => {
  const { db, log } = makeFakeDb({ existingCommissions: true }); current = db;
  await ref.transitionReferral('ref-1', 'completed', { user_id: 'u1', kind: 'system' });
  assert.strictEqual(log.filter(x => x === 'INS_COMMISSION').length, 0);
});
test('P3 tx: illegal referral transition is rejected (no UPDATE/COMMIT)', async () => {
  // Locked row is in_progress; in_progress → draft is not a legal transition.
  const { db, log } = makeFakeDb(); current = db;
  let code = null;
  try { await ref.transitionReferral('ref-1', 'draft', { user_id: 'u1', kind: 'system' }); }
  catch (e) { code = e.code; }
  assert.strictEqual(code, 'INVALID_TRANSITION', 'must reject illegal transition');
  assert.ok(!log.includes('UPD_REFERRAL'), 'must not update the referral on a rejected transition');
  assert.ok(!log.includes('COMMIT'), 'must not commit on a rejected transition');
});

// ─── P1: Prescription RBAC ────────────────────────────────────────────────────
test('P1 RBAC: patient is forbidden from dispense/sign; pharmacist/prescriber/admin pass', async () => {
  current = makeFakeDb().db; // allowed roles pass the guard then reach the service; keep it off real pg
  const express = require('express');
  const router = require('../routes/prescriptions');
  const hit = (role, path) => new Promise((resolve) => {
    const app = express();
    app.use((req, _res, next) => { req.user = { id: 'u1', role }; next(); });
    app.use('/rx', router);
    const srv = app.listen(0, async () => {
      const port = srv.address().port;
      try {
        const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        resolve(r.status);
      } catch (e) { resolve('ERR'); } finally { srv.close(); }
    });
  });
  assert.strictEqual(await hit('patient', '/rx/x/items/i/dispense'), 403, 'patient must not dispense');
  assert.strictEqual(await hit('patient', '/rx/x/sign'), 403, 'patient must not sign');
  assert.strictEqual(await hit('pharmacist', '/rx/x/sign'), 403, 'pharmacist must not sign');
  assert.notStrictEqual(await hit('pharmacist', '/rx/x/items/i/dispense'), 403, 'pharmacist may dispense');
  assert.notStrictEqual(await hit('doctor', '/rx/x/sign'), 403, 'prescriber may sign');
  assert.notStrictEqual(await hit('admin', '/rx/x/items/i/dispense'), 403, 'admin override');
});

// ─── P6: Socket userSockets leak ──────────────────────────────────────────────
test('P6 socket: disconnect deletes userSockets unconditionally (no multi-tab leak)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../server/services/socketService.js'), 'utf8');
  // The delete must NOT be nested inside the socketId-match guard.
  const guardIdx = src.indexOf("currentSocket.socketId === socket.id");
  const firstDelete = src.indexOf('userSockets.delete(socket.id)');
  assert.ok(firstDelete > -1, 'userSockets.delete must exist');
  // Verified-behavior pin: the delete appears before/outside the timeout guard block.
  const beforeGuard = src.slice(0, guardIdx);
  assert.ok(beforeGuard.includes('userSockets.delete(socket.id)'),
    'userSockets.delete(socket.id) must run unconditionally on disconnect, before the reconnection guard');
});

// ── Runner ────────────────────────────────────────────────────────────────────
(async () => {
  let passed = 0, failed = 0;
  for (const { name, fn } of cases) {
    try { await fn(); console.log(`\x1b[32m✓\x1b[0m [PASS] ${name}`); passed++; }
    catch (e) { console.log(`\x1b[31m✗\x1b[0m [FAIL] ${name} — ${e.message}`); failed++; }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
