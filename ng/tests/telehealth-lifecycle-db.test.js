'use strict';

/**
 * ng/tests/telehealth-lifecycle-db.test.js
 *
 * DB-BACKED lifecycle integration test. Unlike the hermetic test
 * (telehealth-lifecycle-integration.test.js), this one connects to a real
 * Postgres/Neon database and proves that records PERSIST and CONNECT through
 * the actual data model:
 *
 *   Patient → Appointment/Consultation → Conference Room → Clinical Encounter
 *           → Digital Prescription → Pharmacy Dispense → Admin lifecycle JOIN
 *
 * It seeds rows, reads them back through the SAME join the admin oversight
 * endpoint uses (ng/routes/admin.js → /consultations/lifecycle), asserts the
 * chain is linked by foreign keys, then cleans up.
 *
 * SAFETY: uses createSimulationPool() which refuses production-like targets
 * unless ALLOW_PRODUCTION_SIMULATION=true. When no SIMULATION_DATABASE_URL /
 * DATABASE_URL is configured (e.g. CI without the secret, or local dev), the
 * whole suite SKIPS with a clear message instead of failing — so the deploy
 * gate stays green while still being a real DB test where a DB exists.
 *
 * Run:
 *   SIMULATION_DATABASE_URL=postgres://... node --test ng/tests/telehealth-lifecycle-db.test.js
 *   # or on EC2 with the server .env:
 *   ALLOW_DATABASE_URL_SIMULATION=true node -r dotenv/config --test ng/tests/telehealth-lifecycle-db.test.js
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

// Decide up front whether a DB is reachable/permitted. If not, skip cleanly.
let dbAvailable = false;
let skipReason = '';
let pool = null;

try {
  const { resolveSimulationDatabaseUrl } = require('../scripts/simulationSafety');
  resolveSimulationDatabaseUrl(process.env); // throws if not configured/permitted
  dbAvailable = true;
} catch (err) {
  skipReason = err.message;
}

const suite = { skip: !dbAvailable };
if (!dbAvailable) {
  // Surface why we skipped so CI logs are explicit (no silent pass).
  console.log(`[telehealth-lifecycle-db] SKIPPED — no DB configured: ${skipReason}`);
}

// Unique suffix so repeated runs do not collide and cleanup is targeted.
const RUN = `lcdbtest_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const ROOM_CODE = `LC${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
const ids = {};

before(async () => {
  if (!dbAvailable) return;
  const { createSimulationPool } = require('../scripts/simulationSafety');
  ({ pool } = createSimulationPool(process.env));
});

after(async () => {
  if (!dbAvailable || !pool) return;
  // Best-effort cleanup in FK-safe order.
  const cleanup = [
    ['ng_digital_prescription_items', 'prescription_id', ids.prescriptionId],
    ['ng_digital_prescriptions', 'id', ids.prescriptionId],
    ['ng_clinical_encounters', 'id', ids.encounterId],
    ['ng_conf_rooms', 'id', ids.roomId],
    ['ng_appointments', 'id', ids.appointmentId],
    ['ng_providers', 'id', ids.providerProfileId],
    ['users', 'id', ids.patientId],
    ['users', 'id', ids.providerId],
  ];
  for (const [table, col, val] of cleanup) {
    if (!val) continue;
    await pool.query(`DELETE FROM ${table} WHERE ${col} = $1`, [val]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

async function colsExist(table) {
  const r = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [table]);
  return new Set(r.rows.map((row) => row.column_name));
}

test('required NG clinical tables exist', { skip: suite.skip }, async () => {
  const required = [
    'users', 'ng_appointments', 'ng_conf_rooms',
    'ng_clinical_encounters', 'ng_digital_prescriptions',
  ];
  const r = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_name = ANY($1)`, [required]);
  const found = new Set(r.rows.map((row) => row.table_name));
  for (const t of required) {
    assert.ok(found.has(t), `missing required table ${t}`);
  }
});

test('seed patient + provider users', { skip: suite.skip }, async () => {
  const patient = await pool.query(
    `INSERT INTO users (email, password_hash, role, first_name, last_name, country, is_active, is_verified, created_at, updated_at)
     VALUES ($1, 'x', 'patient', 'LifecyclePatient', $2, 'Nigeria', TRUE, TRUE, NOW(), NOW())
     RETURNING id`,
    [`patient.${RUN}@doctarx.test`, RUN]);
  ids.patientId = patient.rows[0].id;

  const provider = await pool.query(
    `INSERT INTO users (email, password_hash, role, first_name, last_name, country, is_active, is_verified, created_at, updated_at)
     VALUES ($1, 'x', 'provider', 'LifecycleDoctor', $2, 'Nigeria', TRUE, TRUE, NOW(), NOW())
     RETURNING id`,
    [`provider.${RUN}@doctarx.test`, RUN]);
  ids.providerId = provider.rows[0].id;

  const providerProfile = await pool.query(
    `INSERT INTO ng_providers
       (user_id, full_name, email, phone, status, is_available)
     VALUES ($1, 'Lifecycle Doctor', $2, '+2340000000000', 'verified', TRUE)
     RETURNING id`,
    [ids.providerId, `provider.${RUN}@doctarx.test`]
  );
  ids.providerProfileId = providerProfile.rows[0].id;

  assert.ok(ids.patientId, 'patient id created');
  assert.ok(ids.providerId, 'provider id created');
  assert.ok(ids.providerProfileId, 'provider profile created');
});

test('create appointment/consultation linked to patient + provider', { skip: suite.skip }, async () => {
  const cols = await colsExist('ng_appointments');
  // Build an insert from only the columns that exist, to be schema-tolerant.
  const candidate = {
    patient_user_id: ids.patientId,
    provider_id: ids.providerProfileId,
    status: 'confirmed',
    appointment_type: 'general',
    mode: 'video',
    scheduled_at: new Date().toISOString(),
    consult_fee: 0,
    total_amount: 0,
  };
  const usable = Object.entries(candidate).filter(([k]) => cols.has(k));
  const fields = usable.map(([k]) => k);
  const placeholders = usable.map((_, i) => `$${i + 1}`);
  const values = usable.map(([, v]) => v);
  const res = await pool.query(
    `INSERT INTO ng_appointments (${fields.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
    values);
  ids.appointmentId = res.rows[0].id;
  assert.ok(ids.appointmentId, 'appointment created');
});

test('create conference room linked to the appointment', { skip: suite.skip }, async () => {
  const cols = await colsExist('ng_conf_rooms');
  const candidate = {
    room_code: ROOM_CODE,
    appointment_id: ids.appointmentId,
    patient_user_id: ids.patientId,
    status: 'live',
    kind: 'consultation',
    title: `Lifecycle room ${RUN}`,
    host_user_id: ids.providerId,
  };
  const usable = Object.entries(candidate).filter(([k]) => cols.has(k));
  const fields = usable.map(([k]) => k);
  const placeholders = usable.map((_, i) => `$${i + 1}`);
  const values = usable.map(([, v]) => v);
  const res = await pool.query(
    `INSERT INTO ng_conf_rooms (${fields.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
    values);
  ids.roomId = res.rows[0].id;

  // Prove the linkage persisted.
  const back = await pool.query(
    `SELECT appointment_id FROM ng_conf_rooms WHERE id = $1`, [ids.roomId]);
  assert.equal(String(back.rows[0].appointment_id), String(ids.appointmentId),
    'room.appointment_id must equal the appointment id');
});

test('create clinical encounter linked to the appointment', { skip: suite.skip }, async () => {
  const cols = await colsExist('ng_clinical_encounters');
  const candidate = {
    appointment_id: ids.appointmentId,
    patient_user_id: ids.patientId,
    provider_user_id: ids.providerId,
    status: 'in_progress',
    encounter_type: 'video_consultation',
  };
  const usable = Object.entries(candidate).filter(([k]) => cols.has(k));
  const fields = usable.map(([k]) => k);
  const placeholders = usable.map((_, i) => `$${i + 1}`);
  const values = usable.map(([, v]) => v);
  const res = await pool.query(
    `INSERT INTO ng_clinical_encounters (${fields.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
    values);
  ids.encounterId = res.rows[0].id;
  assert.ok(ids.encounterId, 'encounter created');
});

test('create digital prescription linked to the patient', { skip: suite.skip }, async () => {
  const cols = await colsExist('ng_digital_prescriptions');
  const candidate = {
    patient_user_id: ids.patientId,
    provider_user_id: ids.providerId,
    prescriber_user_id: ids.providerId,
    status: 'sent_to_pharmacy',
    dispense_status: 'pending',
    appointment_id: ids.appointmentId,
    encounter_id: ids.encounterId,
  };
  const usable = Object.entries(candidate).filter(([k]) => cols.has(k));
  const fields = usable.map(([k]) => k);
  const placeholders = usable.map((_, i) => `$${i + 1}`);
  const values = usable.map(([, v]) => v);
  const res = await pool.query(
    `INSERT INTO ng_digital_prescriptions (${fields.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
    values);
  ids.prescriptionId = res.rows[0].id;
  assert.ok(ids.prescriptionId, 'prescription created');
});

test('pharmacy dispense status update persists', { skip: suite.skip }, async () => {
  const cols = await colsExist('ng_digital_prescriptions');
  if (!cols.has('dispense_status')) {
    // Schema variant without dispense_status — assert status transition instead.
    await pool.query(`UPDATE ng_digital_prescriptions SET status = 'dispensed' WHERE id = $1`, [ids.prescriptionId]);
    const back = await pool.query(`SELECT status FROM ng_digital_prescriptions WHERE id = $1`, [ids.prescriptionId]);
    assert.equal(back.rows[0].status, 'dispensed');
    return;
  }
  await pool.query(
    `UPDATE ng_digital_prescriptions SET dispense_status = 'fully_dispensed' WHERE id = $1`, [ids.prescriptionId]);
  const back = await pool.query(
    `SELECT dispense_status FROM ng_digital_prescriptions WHERE id = $1`, [ids.prescriptionId]);
  assert.equal(back.rows[0].dispense_status, 'fully_dispensed',
    'dispense status update must persist');
});

test('admin lifecycle JOIN returns the full linked chain', { skip: suite.skip }, async () => {
  // Mirrors the admin oversight endpoint join: appointment → room → encounter → rx.
  const res = await pool.query(`
    SELECT
      a.id            AS appointment_id,
      a.patient_user_id,
      np.user_id      AS provider_user_id,
      cr.id           AS room_id,
      ce.id           AS encounter_id,
      dp.id           AS prescription_id,
      dp.status       AS rx_status
    FROM ng_appointments a
    LEFT JOIN ng_providers np ON np.id = a.provider_id
    LEFT JOIN ng_conf_rooms cr ON cr.appointment_id = a.id
    LEFT JOIN ng_clinical_encounters ce ON ce.appointment_id = a.id
    LEFT JOIN ng_digital_prescriptions dp ON dp.patient_user_id = a.patient_user_id
    WHERE a.id = $1
    LIMIT 1
  `, [ids.appointmentId]);

  assert.equal(res.rows.length, 1, 'lifecycle row found');
  const row = res.rows[0];
  assert.equal(String(row.patient_user_id), String(ids.patientId), 'patient linked');
  assert.equal(String(row.provider_user_id), String(ids.providerId), 'provider linked');
  assert.equal(String(row.room_id), String(ids.roomId), 'video room linked to appointment');
  assert.equal(String(row.encounter_id), String(ids.encounterId), 'encounter linked to appointment');
  assert.equal(String(row.prescription_id), String(ids.prescriptionId), 'prescription linked to patient');
});
