'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const service = require('../services/pharmacy/inventoryMutationService');
const { createBrowserFixture } = require('./helpers/medication-delivery-fixture');
const { fixtureTargetSafety } = require('../scripts/fixtureTargetSafety');
const target = process.env.SIMULATION_DATABASE_URL;
const pause = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
test('PostgreSQL inventory mutations retain current authority through stock changes and mandatory audit', { skip: !target }, async t => {
  const safety = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL' });
  assert.equal(safety.skipped, false, safety.reason);
  const pool = new Pool({ connectionString: target, max: 8 });
  const actualTarget = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL', pool });
  assert.equal(actualTarget.skipped, false, actualTarget.reason);
  const previous = { NODE_ENV: process.env.NODE_ENV, ENCRYPTION_KEY: process.env.ENCRYPTION_KEY }; process.env.NODE_ENV = 'test';
  const fixture = () => createBrowserFixture({ pool });
  const row = async f => (await pool.query('SELECT row_to_json(i) AS data FROM ng_pharmacy_inventory i WHERE id=$1', [f.inventoryId])).rows[0].data;
  const audits = async f => (await pool.query("SELECT actor_user_id,action,details FROM ng_compliance_audit_log WHERE pharmacy_id=$1 AND action LIKE 'pharmacy_inventory_%' ORDER BY created_at,id", [f.pharmacyId])).rows;
  const item = async f => ({ drugId: f.drugId, quantity: 2, costPrice: 8000, sellingPrice: 9000, batchNumber: (await row(f)).batch_number, expiryDate: '2099-01-01' });
  const input = async (f, action) => action === 'update' ? { quantityAvailable: 8, sellingPrice: 9500 } : { items: [await item(f)] };
  const mutate = (f, action, body, connection = pool, actor = f.pharmacist) => service.mutate(connection, actor, f.pharmacyId, action, body, f.inventoryId);
  try {
    await t.test('pending preparation needs no clinical license approval and preserves current admin update/import scope', async () => {
      const f = await fixture();
      await pool.query("UPDATE ng_pharmacies SET status='pending_review',account_status='pending_onboarding',verified_at=NULL,pcn_license_expiry=DATE '2000-01-01' WHERE id=$1", [f.pharmacyId]);
      await mutate(f, 'update', { quantityAvailable: 6 }); await mutate(f, 'import', { items: [await item(f)] });
      assert.equal((await row(f)).availability_verification_status, 'unverified');
      await assert.rejects(mutate(f, 'add', { items: [await item(f)] }), error => error.status === 403);
      await mutate(f, 'update', { quantityAvailable: 7 }, pool, f.superAdmin);
      await mutate(f, 'import', { items: [await item(f)] }, pool, f.admin);
      const history = await audits(f); assert.equal(history.length, 4); assert.equal(history[2].actor_user_id, f.superAdmin.id); assert.equal(history[3].actor_user_id, f.admin.id);
    });
    await t.test('add conflict requires renewed verification and retains owner-only add behavior', async () => {
      const f = await fixture(); const before = await row(f);
      const result = await mutate(f, 'add', { items: [await item(f)] });
      assert.equal(result.added[0].inventory.quantity_available, before.quantity_available + 2);
      const after = await row(f); assert.equal(after.availability_verification_status, 'unverified'); assert.equal(after.availability_verified_at, null); assert.equal(after.availability_verified_by, null);
      assert.equal(after.availability_source, 'pharmacy_addition_pending_admin_review'); assert.equal(after.quantity_reserved, before.quantity_reserved);
      await assert.rejects(mutate(f, 'add', { items: [await item(f)] }, pool, f.superAdmin), error => error.status === 403);
      assert.equal((await audits(f)).length, 1);
    });
    await t.test('real foreign-key import failures roll back to savepoints and later valid rows still commit with audit', async () => {
      const f = await fixture(); const good = await item(f);
      const result = await mutate(f, 'import', { items: [good, { ...good, drugId: crypto.randomUUID() }, { drugName: 'Unmapped synthetic item' }, { ...good, quantity: 3 }] });
      assert.equal(result.imported, 2); assert.equal(result.skipped, 2); assert.equal((await row(f)).quantity_available, 3);
      assert.doesNotMatch(JSON.stringify(result.errors), /constraint|violates|ng_drug_catalog/);
      const history = await audits(f); assert.equal(history.length, 1); assert.deepEqual(history[0].details, { itemCount: 4, imported: 2, skipped: 2 });
    });
    await t.test('all successful mutations roll back if their required audit raises an actual SQL error', async () => {
      for (const action of ['update','add','import']) {
        const f = await fixture(), before = await row(f), body = await input(f, action);
        const bad = { async connect() { const client = await pool.connect(); return { release: () => client.release(), query(sql, values) { return sql.includes('INSERT INTO ng_compliance_audit_log') ? client.query('SELECT 1/0') : client.query(sql, values); } }; } };
        await assert.rejects(mutate(f, action, body, bad), error => error.code === '22012');
        assert.deepEqual(await row(f), before); assert.equal((await audits(f)).length, 0);
      }
    });
    await t.test('each mutation waits for suspension or reassignment and denies stale ownership without stock/audit writes', async () => {
      for (const action of ['update','add','import']) for (const change of ['user','workspace','status','owner']) {
        const f = await fixture(), before = await row(f), body = await input(f, action); const updater = await pool.connect(); let pending;
        try {
          await updater.query('BEGIN');
          if (change === 'user') await updater.query("UPDATE users SET account_status='suspended' WHERE id=$1", [f.pharmacist.id]);
          else if (change === 'owner') await updater.query('UPDATE ng_pharmacies SET owner_user_id=$2 WHERE id=$1', [f.pharmacyId, f.otherPharmacist.id]);
          else if (change === 'status') await updater.query("UPDATE ng_pharmacies SET status='suspended' WHERE id=$1", [f.pharmacyId]);
          else await updater.query("UPDATE ng_pharmacies SET account_status='suspended' WHERE id=$1", [f.pharmacyId]);
          let settled = false; pending = mutate(f, action, body).then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
          await new Promise(resolve => setTimeout(resolve, 75)); assert.equal(settled, false);
          await updater.query('COMMIT'); assert.equal((await pending).error?.status, 403);
          assert.deepEqual(await row(f), before); assert.equal((await audits(f)).length, 0);
        } finally { await updater.query('ROLLBACK'); updater.release(); if (pending) await pending; }
      }
    });
    await t.test('authority and ownership locks persist through mandatory audit for every mutation', async () => {
      for (const action of ['update','add','import']) {
        const f = await fixture(), body = await input(f, action), reached = pause(), proceed = pause();
        const held = { async connect() { const client = await pool.connect(); return { release: () => client.release(), async query(sql, values) { if (sql.includes('INSERT INTO ng_compliance_audit_log')) { reached.resolve(); await proceed.promise; } return client.query(sql, values); } }; } };
        const pending = mutate(f, action, body, held).then(value => ({ value }), error => ({ error })); let suspended, reassigned;
        try {
          await Promise.race([reached.promise, pending.then(result => { throw result.error || new Error('Mutation missed mandatory audit'); })]);
          let userDone = false, ownerDone = false;
          suspended = pool.query("UPDATE users SET account_status='suspended' WHERE id=$1", [f.pharmacist.id]).then(value => { userDone = true; return { value }; }, error => ({ error }));
          reassigned = pool.query('UPDATE ng_pharmacies SET owner_user_id=$2 WHERE id=$1', [f.pharmacyId, f.otherPharmacist.id]).then(value => { ownerDone = true; return { value }; }, error => ({ error }));
          await new Promise(resolve => setTimeout(resolve, 75)); assert.equal(userDone, false); assert.equal(ownerDone, false);
          proceed.resolve(); assert.ifError((await pending).error); assert.ifError((await suspended).error); assert.ifError((await reassigned).error);
          assert.equal((await audits(f)).length, 1);
          await assert.rejects(mutate(f, action, body), error => error.status === 403);
        } finally { proceed.resolve(); await Promise.allSettled([pending,suspended,reassigned].filter(Boolean)); }
      }
    });
  } finally { await pool.end(); for (const [key,value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
