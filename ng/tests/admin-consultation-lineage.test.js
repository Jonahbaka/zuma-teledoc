'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const express = require('express');
const { getUSPatientControl } = require('./helpers/isolated-market-controls');

function lifecycleHandler(pool) {
  const sourceModule = { exports: {} };
  const filename = path.resolve(__dirname, '../routes/admin.js');
  const dependencies = {
    express,
    '../services/pharmacy/pharmacyOnboardingService': {}, '../services/compliance/complianceService': {},
    '../../server/db': { getPool: () => pool },
    '../../server/middleware/auth': { requireSuperAdmin: (_req, _res, next) => next() },
    '../../server/services/adminTestAccountService': {},
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: sourceModule, exports: sourceModule.exports,
    require(name) { assert.ok(name in dependencies, `Unexpected admin dependency: ${name}`); return dependencies[name]; },
  }, { filename });
  return sourceModule.exports.stack.find((layer) => layer.route?.path === '/consultations/lifecycle').route.stack[0].handle;
}
async function invoke(handler, query = {}) {
  const result = { status: 200, headers: {} };
  const response = { set(name, value) { result.headers[name.toLowerCase()] = value; return this; }, status(value) { result.status = value; return this; }, json(body) { result.body = body; return this; } };
  await handler({ query }, response);
  return result;
}

test('lifecycle endpoint queries only explicit patient/appointment/encounter references and marks missing linkage unknown', async () => {
  const calls = [];
  const row = { appointment_id: crypto.randomUUID(), prescription_id: null, rx_linkage: 'unknown' };
  const handler = lifecycleHandler({ async query(sql, parameters) { calls.push({ sql, parameters }); return { rows: [row] }; } });
  const result = await invoke(handler);
  assert.equal(result.status, 200); assert.equal(result.headers['cache-control'], 'private, no-store');
  assert.equal(result.body[0].rx_linkage, 'unknown');
  const { sql, parameters } = calls[0];
  assert.equal(parameters[0], 50);
  for (const predicate of ['dp.patient_user_id = a.patient_user_id', 'dp.appointment_id = a.id', 'dp.encounter_id = ce.id', 'ce.patient_user_id = a.patient_user_id', "pu.market_scope = 'NG'", "pu.role = 'patient'"]) assert.ok(sql.includes(predicate), predicate);
  assert.equal(sql.includes('dp.created_at'), false); assert.equal(sql.includes('INTERVAL'), false);
  assert.equal(sql.includes('pu.account_status'), false); assert.ok(sql.includes('pu.is_active'));
});

test('invalid lifecycle limits are rejected before querying clinical records', async () => {
  let calls = 0;
  const handler = lifecycleHandler({ async query() { calls++; throw new Error('Clinical data must not be queried'); } });
  for (const limit of ['-1', '0', '201', '1.5', 'unbounded', '']) assert.equal((await invoke(handler, { limit })).status, 400);
  assert.equal(calls, 0);
});

test('lifecycle storage failures are unavailable without exposing schema or patient details', async () => {
  const handler = lifecycleHandler({ async query() { throw new Error('Private SQL failure and patient details'); } });
  const result = await invoke(handler);
  assert.equal(result.status, 503); assert.equal(result.body.error, 'Consultation lifecycle could not be loaded.');
  assert.equal(JSON.stringify(result.body).includes('Private SQL'), false);
});

const target = process.env.SIMULATION_DATABASE_URL;
test('PostgreSQL simultaneous visits cannot exchange prescriptions or inherit unlinked, conflicting, foreign-patient or cross-market records', { skip: !target }, async () => {
  const url = new URL(target);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'), 'Only an isolated loopback test database is permitted');
  const { Pool } = require('pg'); const pool = new Pool({ connectionString: target }); const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Reuse existing NG demo accounts. If fresh CI has no US patient, the
    // helper creates only a rollback-scoped negative control. All appointment,
    // encounter, room and Rx fixtures are visible only in this transaction.
    const patient = (await client.query("SELECT id FROM users WHERE email='patient@demo.doctarx.com' AND role='patient' AND market_scope='NG'")).rows[0];
    const other = (await client.query("SELECT id FROM users WHERE email='government@demo.doctarx.com' AND role='patient' AND market_scope='NG'")).rows[0];
    const usPatient = await getUSPatientControl(client);
    const provider = (await client.query("SELECT u.id,p.id AS profile_id FROM users u JOIN ng_providers p ON p.user_id=u.id WHERE u.email='doctor@demo.doctarx.com' AND u.role='provider' AND u.market_scope='NG'")).rows[0];
    assert.ok(patient && other && usPatient && provider, 'Existing NG demo accounts and an isolated US market control are required; no existing accounts are reset');
    const scheduledAt = new Date().toISOString();
    const appointments = [];
    for (const owner of [patient.id, patient.id, patient.id, patient.id, usPatient.id]) {
      const appointment = (await client.query(`INSERT INTO ng_appointments (patient_user_id,provider_id,scheduled_at,status,consult_fee,total_amount)
        VALUES ($1,$2,$3,'confirmed',0,0) RETURNING id`, [owner, provider.profile_id, scheduledAt])).rows[0];
      appointments.push(appointment.id);
    }
    const encounters = [];
    for (let index = 0; index < 3; index++) {
      const encounter = (await client.query(`INSERT INTO ng_clinical_encounters (patient_user_id,provider_user_id,appointment_id,status)
        VALUES ($1,$2,$3,'draft') RETURNING id`, [patient.id, provider.id, appointments[index]])).rows[0];
      encounters.push(encounter.id);
    }
    const foreignEncounter = (await client.query(`INSERT INTO ng_clinical_encounters (patient_user_id,provider_user_id,appointment_id,status)
      VALUES ($1,$2,$3,'draft') RETURNING id`, [other.id, provider.id, appointments[3]])).rows[0];
    for (const appointmentId of appointments.slice(0, 2)) await client.query(`INSERT INTO ng_conf_rooms (room_code,title,appointment_id,patient_user_id,host_user_id,status)
      VALUES ($1,'Lineage integrity test',$2,$3,$4,'scheduled')`, ['lineage-' + crypto.randomUUID(), appointmentId, patient.id, provider.id]);
    const prescriptions = [];
    for (const [owner, appointmentId, encounterId] of [
      [patient.id, appointments[0], encounters[0]], [patient.id, null, encounters[1]], [patient.id, appointments[2], null],
      [patient.id, null, null], [patient.id, appointments[0], encounters[1]], [other.id, appointments[0], encounters[0]],
    ]) {
      const prescription = (await client.query(`INSERT INTO ng_digital_prescriptions (patient_user_id,provider_id,provider_user_id,appointment_id,encounter_id,items,created_at)
        VALUES ($1,$2,$3,$4,$5,'[]'::jsonb,$6) RETURNING id`, [owner, provider.profile_id, provider.id, appointmentId, encounterId, scheduledAt])).rows[0];
      prescriptions.push(prescription.id);
    }
    const handler = lifecycleHandler({ query: (...args) => client.query(...args) });
    const response = await invoke(handler, { limit: '200' }); assert.equal(response.status, 200);
    const rows = response.body.filter((row) => appointments.includes(row.appointment_id));
    for (let index = 0; index < 3; index++) {
      const linked = rows.filter((row) => row.appointment_id === appointments[index]);
      assert.equal(linked.length, 1); assert.equal(linked[0].prescription_id, prescriptions[index]);
      assert.equal(linked[0].rx_linkage, index === 2 ? 'appointment' : 'encounter');
      assert.equal(linked[0].patient_status, 'active');
    }
    const unknown = rows.find((row) => row.appointment_id === appointments[3]);
    assert.ok(unknown); assert.equal(unknown.prescription_id, null); assert.equal(unknown.rx_linkage, 'unknown');
    assert.equal(unknown.encounter_id, null, 'A foreign-patient encounter cannot enter this clinical chain');
    assert.equal(rows.some((row) => row.appointment_id === appointments[4]), false, 'US patient records must not enter NG lifecycle oversight');
    for (const prescriptionId of prescriptions.slice(3)) assert.equal(response.body.some((row) => row.prescription_id === prescriptionId), false);
    assert.equal(response.body.some((row) => row.encounter_id === foreignEncounter.id), false);
  } finally { await client.query('ROLLBACK'); client.release(); await pool.end(); }
});
