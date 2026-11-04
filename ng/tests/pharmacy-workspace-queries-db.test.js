'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const target = process.env.SIMULATION_DATABASE_URL;
test('pharmacy inventory counts and order lists execute against the migrated schema within pharmacy scope', { skip: !target }, async () => {
  const url = new URL(target);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'), 'Use a disposable loopback database ending in _test');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: target });
  const db = require('../../server/db');
  const originalGetPool = db.getPool;
  // These queries are read-only. Reuse an existing pharmacy when supplied;
  // otherwise exercise genuine empty scope without creating a workspace.
  try {
    db.getPool = () => pool;
    const inventory = require('../services/pharmacy/inventoryService');
    const orders = require('../services/pharmacy/orderService');
    const pharmacy = (await pool.query('SELECT id FROM ng_pharmacies ORDER BY id LIMIT 1')).rows[0] || { id: crypto.randomUUID() };
    const expected = await pool.query('SELECT COUNT(*)::int AS count FROM ng_pharmacy_inventory i JOIN ng_drug_catalog d ON d.id=i.drug_id WHERE i.pharmacy_id=$1', [pharmacy.id]);
    const page = await inventory.getInventory(pharmacy.id, { limit: 1 });
    assert.equal(page.total, expected.rows[0].count);
    assert.equal(page.totalPages, expected.rows[0].count);
    assert.ok(page.items.length <= 1);
    assert.ok(page.items.every((item) => item.pharmacy_id === pharmacy.id));
    const empty = await inventory.getInventory(crypto.randomUUID(), { search: 'nonexistent-regression-item', lowStock: true });
    assert.equal(empty.total, 0);
    assert.equal(empty.totalPages, 0);
    assert.deepEqual(empty.items, []);
    const authorized = (await pool.query(`SELECT p.id,p.owner_user_id FROM ng_pharmacies p JOIN users u ON u.id=p.owner_user_id
      WHERE p.status='approved' AND p.account_status='active' AND p.verified_at IS NOT NULL AND p.pcn_license_expiry>=CURRENT_DATE
        AND p.pcn_license_number IS NOT NULL AND p.superintendent_pcn_number IS NOT NULL
        AND u.role='pharmacy' AND u.is_active=TRUE AND u.account_status='active' AND u.market_scope='NG' LIMIT 1`)).rows[0];
    if (authorized) {
      const actor = { id: authorized.owner_user_id, role: 'pharmacy' };
      const recordedOrders = await orders.listPharmacyOrders(authorized.id, { limit: 2 }, actor);
      assert.ok(recordedOrders.every((order) => order.pharmacy_id === authorized.id));
      await assert.rejects(orders.listPharmacyOrders(crypto.randomUUID(), {}, actor), error => error.status === 403);
    }
    await assert.rejects(orders.listPharmacyOrders(pharmacy.id), error => error.status === 403);
  } finally { db.getPool = originalGetPool; await pool.end(); }
});
