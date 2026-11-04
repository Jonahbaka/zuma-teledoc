'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const service = require('../services/pharmacy/medicationRequestService');
const { createBrowserFixture } = require('./helpers/medication-delivery-fixture');
const { fixtureTargetSafety } = require('../scripts/fixtureTargetSafety');
const target = process.env.SIMULATION_DATABASE_URL;

test('PostgreSQL availability response scope, audit rollback, reassignment and suspension stay intact', { skip: !target }, async () => {
  const safety = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL' });
  assert.equal(safety.skipped, false, safety.reason);
  const pool = new Pool({ connectionString: target });
  const actualTarget = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL', pool });
  assert.equal(actualTarget.skipped, false, actualTarget.reason);
  const previous = { NODE_ENV: process.env.NODE_ENV, ENCRYPTION_KEY: process.env.ENCRYPTION_KEY };
  process.env.NODE_ENV = 'test';
  try {
    const first = await createBrowserFixture({ pool });
    const second = await createBrowserFixture({ pool });
    const row = (await pool.query(`INSERT INTO ng_medication_requests(medicine_name,preferred_pharmacy_id,contact_name,phone,status,admin_notes,session_id,prescription_attachment_url)
      VALUES('Isolated availability integrity request',$1,'Isolated Patient','+2348000000002','pending_pharmacy_confirmation','Private internal note','private-session','https://private.invalid/prescription') RETURNING id`, [first.pharmacyId])).rows[0];
    const requestId = row.id;
    await pool.query("UPDATE ng_medication_requests SET created_at=NOW()-INTERVAL '7 days' WHERE id=$1", [requestId]);
    await pool.query(`INSERT INTO ng_medication_requests(medicine_name,preferred_pharmacy_id,status)
      SELECT 'Isolated queue history ' || n,$1,CASE WHEN n%3=0 THEN 'cancelled' WHEN n%3=1 THEN 'completed' ELSE 'available' END
      FROM generate_series(1,105) AS n`, [first.pharmacyId]);
    const prioritized = await service.listPharmacyRequests(pool, first.pharmacist, first.pharmacyId);
    assert.equal(prioritized.length, 100);
    assert.equal(prioritized[0].id, requestId, 'The oldest pending request remains visible ahead of more than 100 newer resolved requests');
    await pool.query("UPDATE users SET account_status='suspended' WHERE id=$1", [first.pharmacist.id]);
    await assert.rejects(service.listPharmacyRequests(pool, first.pharmacist, first.pharmacyId), error => error.statusCode === 403);
    await assert.rejects(service.updateRequest(pool, first.pharmacist, requestId, { status: 'available' }, first.pharmacyId), error => error.statusCode === 403);
    await pool.query("UPDATE users SET account_status='active' WHERE id=$1", [first.pharmacist.id]);
    const response = await service.updateRequest(pool, first.pharmacist, requestId, { status: 'available', confirmedPriceNgn: '2300.25', pharmacyNotes: 'Private patient note' }, first.pharmacyId);
    assert.equal(response.status, 'available'); assert.equal(response.confirmed_price_ngn, '2300.25');
    for (const key of ['admin_notes', 'session_id', 'prescription_attachment_url', 'source_snapshot', 'location_latitude']) assert.equal(Object.prototype.hasOwnProperty.call(response, key), false);
    const list = await service.listPharmacyRequests(pool, first.pharmacist, first.pharmacyId);
    assert.ok(list.some(item => item.id === requestId)); assert.equal(list.find(item => item.id === requestId).session_id, undefined);
    const audit = (await pool.query("SELECT details FROM ng_compliance_audit_log WHERE resource_id=$1 AND action='medication_request.updated'", [requestId])).rows;
    assert.equal(audit.length, 1); assert.doesNotMatch(JSON.stringify(audit), /Private patient note/);

    const failingPool = { async connect() {
      const client = await pool.connect();
      return { release: () => client.release(), query(sql, params) {
        if (sql.includes('INSERT INTO ng_compliance_audit_log')) throw new Error('Isolated audit failure');
        return client.query(sql, params);
      } };
    } };
    await assert.rejects(service.updateRequest(failingPool, first.pharmacist, requestId, { status: 'unavailable' }, first.pharmacyId), /Isolated audit failure/);
    assert.equal((await pool.query('SELECT status FROM ng_medication_requests WHERE id=$1', [requestId])).rows[0].status, 'available');
    await assert.rejects(service.updateRequest(pool, first.admin, requestId, { status: 'completed' }), error => error.statusCode === 409);

    const reassigned = await service.updateRequest(pool, first.admin, requestId, { assignedPharmacyId: second.pharmacyId, status: 'pending_pharmacy_confirmation' });
    assert.equal(reassigned.confirmed_price_ngn, null); assert.equal(reassigned.pharmacy_notes, null); assert.equal(reassigned.pharmacy_responded_at, null);
    assert.equal((await service.listPharmacyRequests(pool, first.pharmacist, first.pharmacyId)).some(item => item.id === requestId), false);
    await assert.rejects(service.updateRequest(pool, first.pharmacist, requestId, { status: 'available' }, first.pharmacyId), error => error.statusCode === 404);
    assert.ok((await service.listPharmacyRequests(pool, second.pharmacist, second.pharmacyId)).some(item => item.id === requestId));
    await service.updateRequest(pool, second.pharmacist, requestId, { status: 'available', confirmedPriceNgn: '2500.00' }, second.pharmacyId);
    await pool.query("UPDATE ng_pharmacies SET account_status='suspended' WHERE id=$1", [second.pharmacyId]);
    await assert.rejects(service.listPharmacyRequests(pool, second.pharmacist, second.pharmacyId), error => error.statusCode === 403);
    await assert.rejects(service.updateRequest(pool, second.pharmacist, requestId, { status: 'unavailable' }, second.pharmacyId), error => error.statusCode === 403);
    await pool.query("UPDATE ng_pharmacies SET account_status='active' WHERE id=$1", [second.pharmacyId]);
    const racing = await Promise.allSettled([
      service.updateRequest(pool, first.admin, requestId, { status: 'cancelled' }),
      service.updateRequest(pool, second.pharmacist, requestId, { status: 'available' }, second.pharmacyId),
    ]);
    assert.equal(racing[0].status, 'fulfilled');
    if (racing[1].status === 'rejected') assert.equal(racing[1].reason.statusCode, 409);
    await assert.rejects(service.updateRequest(pool, second.pharmacist, requestId, { status: 'available' }, second.pharmacyId), error => error.statusCode === 409);
    await assert.rejects(service.updateRequest(pool, first.admin, requestId, { status: 'pending_pharmacy_confirmation' }), error => error.statusCode === 409);
    assert.equal((await pool.query('SELECT status FROM ng_medication_requests WHERE id=$1', [requestId])).rows[0].status, 'cancelled');
    // Fixtures and append-only audits stay in this disposable database. No
    // provisioned account or production data is changed, reset or removed.
  } finally {
    await pool.end();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
