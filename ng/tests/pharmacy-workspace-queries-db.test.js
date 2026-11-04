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
    const recordedOrders = await orders.listPharmacyOrders(pharmacy.id, { limit: 2 });
    assert.ok(recordedOrders.every((order) => order.pharmacy_id === pharmacy.id));
    assert.deepEqual(await orders.listPharmacyOrders(crypto.randomUUID()), []);
  } finally { db.getPool = originalGetPool; await pool.end(); }
});
