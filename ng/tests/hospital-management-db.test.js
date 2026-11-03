'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const service = require('../services/hospitalManagementService');
const integration = require('../services/hospitalIntegrationReadService');
const { fixtureTargetSafety } = require('../scripts/fixtureTargetSafety');
const { getUSPatientControl } = require('./helpers/isolated-market-controls');
const target = process.env.SIMULATION_DATABASE_URL;

test('PostgreSQL hospital registration, read scope and staff writes enforce current ownership and atomic audits', { skip: !target }, async () => {
  const safety = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL' });
  assert.equal(safety.skipped, false, 'Only an explicit isolated loopback *_test database may be used.');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: target });
  assert.equal(fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL', pool }).skipped, false);
  const client = await pool.connect();
  let serial = 0, failAudit = false;
  const routePool = { async connect() {
    const savepoint = `hospital_management_${++serial}`;
    return { release() {}, async query(sql, params) {
      if (sql === 'BEGIN') return client.query('SAVEPOINT ' + savepoint);
      if (sql === 'COMMIT') return client.query('RELEASE SAVEPOINT ' + savepoint);
      if (sql === 'ROLLBACK') {
        await client.query('ROLLBACK TO SAVEPOINT ' + savepoint);
        return client.query('RELEASE SAVEPOINT ' + savepoint);
      }
      if (failAudit && sql.includes('INSERT INTO ng_audit_lineage')) throw new Error('Synthetic audit failure');
      return client.query(sql, params);
    } };
  } };
  const registration = { name: 'Synthetic hospital management fixture', facility_type: 'clinic', contact_name: 'Synthetic applicant',
    contact_email: 'fixture@example.invalid', contact_phone: '000', address_line1: 'Synthetic address', city: 'Synthetic', state: 'Synthetic' };
  const staff = { full_name: 'Synthetic roster fixture', role: 'lab_technician', department: 'Synthetic laboratory', mdcn_or_license: 'Synthetic license' };
  const request = (id, body) => ({ user: { id, role: 'super_admin', marketScope: 'NG' }, body, headers: { 'x-market-scope': 'NG' } });
  try {
    await client.query('BEGIN');
    const owner = (await client.query("SELECT id FROM users WHERE email='doctor@demo.doctarx.com' AND is_active=TRUE AND market_scope='NG'")).rows[0];
    const member = (await client.query("SELECT id FROM users WHERE email='patient@demo.doctarx.com' AND is_active=TRUE AND market_scope='NG'")).rows[0];
    const admin = (await client.query("SELECT id FROM users WHERE role='admin' AND is_active=TRUE AND market_scope='NG' ORDER BY id LIMIT 1")).rows[0];
    const usUser = await getUSPatientControl(client);
    assert.ok(owner && member && admin && usUser, 'Existing isolated demo accounts required; this test does not reset or provision them.');
    const created = await service.registerHospital(routePool, request(owner.id, registration));
    const id = created.hospital.id;
    assert.equal(created.ownerLinked, true);
    assert.equal((await client.query('SELECT owner_user_id FROM ng_hospitals WHERE id=$1', [id])).rows[0].owner_user_id, owner.id);
    await assert.rejects(service.registerHospital(routePool, { body: { ...registration, user_id: owner.id } }), error => error.status === 400);
    await assert.rejects(service.registerHospital(routePool, request(usUser.id, registration)), error => error.status === 403);
    const anonymous = await service.registerHospital(routePool, { body: registration });
    assert.equal(anonymous.ownerLinked, false);
    assert.equal((await client.query('SELECT owner_user_id FROM ng_hospitals WHERE id=$1', [anonymous.hospital.id])).rows[0].owner_user_id, null);

    for (const fn of [service.readHospital, service.readStaff]) {
      await assert.rejects(fn(routePool, request(member.id), id), error => error.status === 404);
      await assert.rejects(fn(routePool, request(usUser.id), id), error => error.status === 403);
      assert.ok(await fn(routePool, request(owner.id), id));
      assert.ok(await fn(routePool, request(admin.id), id));
      await assert.rejects(fn(routePool, request(owner.id), anonymous.hospital.id), error => error.status === 404);
    }
    const staffId = crypto.randomUUID();
    await client.query("INSERT INTO ng_hospital_staff(id,hospital_id,user_id,full_name,role,status) VALUES($1,$2,$3,'Synthetic linked member','other','active')", [staffId, id, member.id]);
    for (const fn of [service.readHospital, service.readStaff]) assert.equal((await fn(routePool, request(member.id), id)).can_manage_staff, false);
    await assert.rejects(service.createStaff(routePool, request(member.id, staff), id), error => error.status === 404);
    await assert.rejects(integration.updateStaff(routePool, request(member.id, { status: 'active' }), id, staffId), error => error.status === 404);
    await integration.updateStaff(routePool, request(owner.id, { status: 'inactive' }), id, staffId);
    for (const fn of [service.readHospital, service.readStaff]) await assert.rejects(fn(routePool, request(member.id), id), error => error.status === 404);

    const added = await service.createStaff(routePool, request(owner.id, { ...staff, user_id: member.id, provider_id: crypto.randomUUID() }), id);
    assert.equal(added.role, 'lab_technician'); assert.equal(added.department, staff.department);
    assert.equal((await client.query('SELECT user_id FROM ng_hospital_staff WHERE id=$1', [added.id])).rows[0].user_id, null);
    assert.equal((await service.readHospital(routePool, request(owner.id), id)).hospital.staff_count, 2);
    const before = (await client.query('SELECT COUNT(*)::integer AS count FROM ng_hospital_staff WHERE hospital_id=$1', [id])).rows[0].count;
    failAudit = true;
    await assert.rejects(service.createStaff(routePool, request(owner.id, staff), id));
    failAudit = false;
    assert.equal((await client.query('SELECT COUNT(*)::integer AS count FROM ng_hospital_staff WHERE hospital_id=$1', [id])).rows[0].count, before);

    const foreignId = crypto.randomUUID();
    await client.query(`INSERT INTO ng_hospitals(id,name,slug,facility_type,owner_user_id,contact_name,contact_email,contact_phone,address_line1,city,state)
      VALUES($1,'Synthetic foreign fixture',$2,'clinic',$3,'Synthetic','fixture@example.invalid','000','Synthetic','Synthetic','Synthetic')`, [foreignId, `synthetic-${foreignId}`, usUser.id]);
    for (const fn of [service.readHospital, service.readStaff]) await assert.rejects(fn(routePool, request(admin.id), foreignId), error => error.status === 404);
    await assert.rejects(service.createStaff(routePool, request(admin.id, staff), foreignId), error => error.status === 404);
    const list = await service.listHospitals(routePool, { ...request(admin.id), query: { state: 'Synthetic', limit: '100' } });
    assert.ok(list.hospitals.some(hospital => hospital.id === id));
    assert.ok(!list.hospitals.some(hospital => hospital.id === foreignId));
    const audit = (await client.query('SELECT metadata_json FROM ng_audit_lineage WHERE resource_id=ANY($1::uuid[])', [[id, added.id, anonymous.hospital.id]])).rows;
    assert.ok(audit.length >= 8);
    assert.doesNotMatch(JSON.stringify(audit), /Synthetic|fixture@example/);
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); await pool.end(); }
  }
});
