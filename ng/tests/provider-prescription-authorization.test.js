'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const express = require('express');
const { validatePrescriptionInput } = require('../services/rx-engine/providerPrescriptionGuardService');

const providerId = '00000000-0000-4000-8000-000000000011';
const profileId = '00000000-0000-4000-8000-000000000012';
const patientId = '00000000-0000-4000-8000-000000000013';
const appointmentId = '00000000-0000-4000-8000-000000000014';
const pharmacyId = '00000000-0000-4000-8000-000000000015';
const otherPharmacyId = '00000000-0000-4000-8000-000000000016';
const prescriptionId = '00000000-0000-4000-8000-000000000017';
const provider = { id: providerId, role: 'provider', marketScope: 'NG' };
let activePool;
let actor;
const usageEvents = [];
const notifications = [];
const routeFile = require.resolve('../routes/provider');
const originalLoad = Module._load;
let router;
try {
  Module._load = function prescriptionRouteDependencies(request, parent) {
    if (parent?.filename === routeFile) {
      if (request === '../../server/db') return { getPool: () => activePool };
      if (request === '../../server/middleware/auth') return {
        authenticate(req, res, next) { if (!actor) return res.status(401).json({ error: 'Authentication required' }); req.user = actor; return next(); },
        requireRole: (...roles) => (req, res, next) => roles.flat().includes(req.user?.role) || req.user?.role === 'super_admin' ? next() : res.status(403).json({ error: 'Access denied' }),
      };
      if (request === '../services/providers/providerAccessService') return {
        requireActiveProviderToolAccess: (_req, _res, next) => next(),
        recordProviderUsage: async (...args) => { usageEvents.push(args); },
        ensureProviderAccessForUser: async () => { throw new Error('Unexpected provider provisioning'); },
      };
      if (request === '../services/whatsapp/whatsappDispenseService') return {
        createPharmacyPrescriptionNotification: async (details) => { notifications.push(details); return { status: 'manual_fallback_pending' }; },
      };
    }
    return originalLoad.apply(this, arguments);
  };
  delete require.cache[routeFile];
  router = require(routeFile);
} finally { Module._load = originalLoad; }

function validInput(overrides = {}) {
  return { patientUserId: patientId, items: [{ drug_name: 'Review fixture medication', dosage: 'Clinician-specified dose', quantity: '20', instructions: 'Clinician-specified directions' }], ...overrides };
}

function scriptedPool(options = {}) {
  const state = { freshAccess: true, relationship: 'native', appointmentMatches: true, pharmacies: [{ id: pharmacyId, delivery_enabled: true }], ...options };
  const calls = [];
  const client = {
    released: false,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
      if (sql.includes('FROM users actor')) {
        for (const predicate of ["actor.role = 'provider'", 'actor.is_active = TRUE', "actor.market_scope = 'NG'", "actor.provider_status = 'approved'", "provider.status = 'verified'", "patient.role = 'patient'", "patient.market_scope = 'NG'", 'patient.is_active = TRUE', 'FOR SHARE OF actor, provider, patient']) assert.ok(sql.includes(predicate), predicate);
        return { rows: state.freshAccess ? [{ user_id: providerId, role: 'provider', provider_id: profileId }] : [] };
      }
      if (sql.includes('SELECT id FROM ng_appointments') && sql.includes('FOR SHARE')) {
        assert.deepEqual(params, [appointmentId, patientId, profileId]);
        assert.ok(sql.includes("status IN ('confirmed','in_progress','completed')"));
        return { rows: state.appointmentMatches ? [{ id: appointmentId }] : [] };
      }
      if (sql.includes("SELECT id, 'native' AS source")) {
        assert.ok(sql.includes("status = 'completed'"));
        assert.ok(sql.includes('provider_patient_relationships'));
        assert.deepEqual(params, [patientId, profileId, providerId]);
        return { rows: state.relationship ? [{ id: appointmentId, source: state.relationship }] : [] };
      }
      if (sql.includes('SELECT id FROM ng_providers')) return { rows: [{ id: profileId }] };
      if (sql.includes('FROM ng_appointments')) return { rows: [{ id: appointmentId }] };
      if (sql.includes('FROM ng_pharmacies')) {
        assert.ok(sql.includes("status = 'approved' AND account_status = 'active'"));
        assert.ok(sql.includes('pcn_license_expiry >= CURRENT_DATE'));
        assert.ok(sql.includes('FOR SHARE'));
        return { rows: state.pharmacies.filter((row) => params[0].includes(row.id)) };
      }
      if (sql.includes('INSERT INTO ng_digital_prescriptions')) return { rows: [{ id: prescriptionId, provider_id: params[0], patient_user_id: params[1], appointment_id: params[2], items: JSON.parse(params[4]), status: params[7], provider_user_id: params[12] }] };
      if (sql.includes('INSERT INTO audit_logs')) { if (state.failAudit) throw new Error('Audit unavailable'); return { rows: [] }; }
      throw new Error('Unexpected prescribing database operation');
    },
    release() { client.released = true; },
  };
  return { calls, client, connect: async () => client };
}

async function withRoute(pool, user, run) {
  activePool = pool; actor = user;
  const app = express(); app.use(express.json()); app.use('/api/ng/providers', router);
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  try {
    await run((body) => fetch(`http://127.0.0.1:${server.address().port}/api/ng/providers/prescriptions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  } finally { await new Promise((resolve) => server.close(resolve)); activePool = null; actor = null; }
}

test('prescription validation bounds identifiers, medications, quantities and database string fields', () => {
  const input = validatePrescriptionInput(validInput({ diagnosis: '  Clinical indication  ', notes: 'Provider instructions' }));
  assert.equal(input.items[0].quantity, 20); assert.equal(input.diagnosis, 'Clinical indication'); assert.equal(input.appointmentId, null);
  for (const invalid of [
    validInput({ patientUserId: '-'.repeat(36) }), validInput({ appointmentId: 'not-an-appointment' }), validInput({ preferredPharmacyId: 'wrong' }),
    validInput({ diagnosis: 'x'.repeat(256) }), validInput({ notes: 'x'.repeat(4001) }), validInput({ fulfillmentPreference: 'unverified-option' }),
    validInput({ items: [] }), validInput({ items: Array.from({ length: 21 }, () => ({ drug_name: 'Medication' })) }),
    validInput({ items: [{ drug_name: 'x'.repeat(256) }] }), validInput({ items: [{ drug_name: ' ' }] }),
    ...[0, -1, 1.5, '5 tablets', '10001', {}, true, null].map((quantity) => validInput({ items: [{ drug_name: 'Medication', quantity }] })),
    validInput({ items: [{ drug_name: 'Medication', isControlled: 'false' }] }), validInput({ items: [{ drug_name: 'Medication', instructions: 'x'.repeat(1001) }] }),
    validInput({ notes: 'Invalid\u0000text' }), validInput({ items: [{ drug_name: 'Medication', arbitrary_nested_payload: { value: 'unknown' } }] }),
  ]) assert.throws(() => validatePrescriptionInput(invalid), (error) => error.status === 400);
});

test('malformed prescription requests never insert or report successful creation', async () => {
  const pool = scriptedPool();
  await withRoute(pool, provider, async (post) => { assert.equal((await post(validInput({ diagnosis: 'x'.repeat(256) }))).status, 400); });
  assert.equal(pool.calls.some((call) => call.sql.includes('INSERT INTO ng_digital_prescriptions')), false);
  assert.equal(pool.calls.some((call) => call.sql === 'COMMIT'), false); assert.equal(pool.client.released, true);
});

test('native and completed shared NG care relationships authorize attributed, audited prescriptions', async () => {
  for (const relationship of ['native', 'shared']) {
    const pool = scriptedPool({ relationship });
    await withRoute(pool, provider, async (post) => {
      const response = await post(validInput()); assert.equal(response.status, 201);
      const prescription = (await response.json()).prescription;
      assert.equal(prescription.provider_id, profileId); assert.equal(prescription.provider_user_id, providerId);
      assert.equal(prescription.patient_user_id, patientId); assert.equal(prescription.items[0].quantity, 20);
    });
    assert.equal(pool.calls.filter((call) => call.sql.includes('INSERT INTO audit_logs')).length, 1);
    assert.equal(pool.calls.filter((call) => call.sql === 'COMMIT').length, 1);
  }
});

test('stale actor approval, cross-market/foreign patient context and missing care relationships deny prescribing', async () => {
  for (const options of [{ freshAccess: false }, { relationship: null }]) {
    const pool = scriptedPool(options);
    await withRoute(pool, provider, async (post) => { assert.equal((await post(validInput())).status, 403); });
    assert.equal(pool.calls.some((call) => call.sql.includes('INSERT INTO ng_digital_prescriptions')), false);
    assert.equal(pool.calls.some((call) => call.sql === 'COMMIT'), false);
    assert.equal(pool.calls.filter((call) => call.sql === 'ROLLBACK').length, 1);
  }
});

test('supplied native appointment must belong to the exact provider and patient before prescribing', async () => {
  const allowed = scriptedPool();
  await withRoute(allowed, provider, async (post) => { assert.equal((await post(validInput({ appointmentId }))).status, 201); });
  const denied = scriptedPool({ appointmentMatches: false });
  await withRoute(denied, provider, async (post) => { assert.equal((await post(validInput({ appointmentId }))).status, 403); });
  assert.equal(denied.calls.some((call) => call.sql.includes('INSERT INTO ng_digital_prescriptions')), false);
});

test('both pharmacy references must be approved/current and delivery must be enabled', async () => {
  for (const [options, body] of [
    [{ pharmacies: [] }, validInput({ preferredPharmacyId: pharmacyId })],
    [{ pharmacies: [{ id: pharmacyId, delivery_enabled: true }] }, validInput({ preferredPharmacyId: otherPharmacyId, routedPharmacyId: pharmacyId })],
    [{ pharmacies: [{ id: pharmacyId, delivery_enabled: false }] }, validInput({ preferredPharmacyId: pharmacyId, fulfillmentPreference: 'delivery' })],
  ]) {
    const pool = scriptedPool(options);
    await withRoute(pool, provider, async (post) => { assert.equal((await post(body)).status, 409); });
    assert.equal(pool.calls.some((call) => call.sql.includes('INSERT INTO ng_digital_prescriptions')), false);
  }
});

test('approved pharmacy routing remains pending fulfillment and audit failure rolls creation back', async () => {
  await withRoute(scriptedPool(), provider, async (post) => {
    const response = await post(validInput({ preferredPharmacyId: pharmacyId, fulfillmentPreference: 'delivery' }));
    assert.equal(response.status, 201); const body = await response.json();
    assert.equal(body.prescription.status, 'routed'); assert.equal(body.whatsappNotification.status, 'manual_fallback_pending');
  });
  const pool = scriptedPool({ failAudit: true });
  const usageBefore = usageEvents.length; const notificationsBefore = notifications.length;
  await withRoute(pool, provider, async (post) => {
    const response = await post(validInput({ preferredPharmacyId: pharmacyId })); assert.equal(response.status, 503);
    assert.equal((await response.json()).prescription, undefined);
  });
  assert.equal(pool.calls.some((call) => call.sql === 'COMMIT'), false); assert.equal(pool.calls.filter((call) => call.sql === 'ROLLBACK').length, 1);
  assert.equal(usageEvents.length, usageBefore); assert.equal(notifications.length, notificationsBefore);
});

test('patient and administrative sessions do not inherit provider prescribing rights', async () => {
  for (const user of [{ id: patientId, role: 'patient' }, { id: providerId, role: 'super_admin' }]) {
    const pool = scriptedPool({ freshAccess: false });
    await withRoute(pool, user, async (post) => { assert.equal((await post(validInput())).status, 403); });
    assert.equal(pool.calls.some((call) => call.sql.includes('INSERT INTO ng_digital_prescriptions')), false);
  }
});

const target = process.env.SIMULATION_DATABASE_URL;
test('PostgreSQL prescribing binds real demo care context and rolls back every fixture and failed write', { skip: !target }, async () => {
  const url = new URL(target);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'), 'Only isolated loopback test databases are accepted');
  const { Pool } = require('pg'); const pool = new Pool({ connectionString: target }); const client = await pool.connect();
  let savepoint = false;
  let failAudit = false;
  let databaseFailure;
  try {
    await client.query('BEGIN');
    const existingProvider = (await client.query("SELECT u.id,p.id AS profile_id FROM users u JOIN ng_providers p ON p.user_id=u.id WHERE u.email='doctor@demo.doctarx.com' AND u.provider_status='approved' AND p.status='verified'")).rows[0];
    const patient = (await client.query("SELECT id FROM users WHERE email='patient@demo.doctarx.com' AND market_scope='NG' AND role='patient'")).rows[0];
    const other = (await client.query("SELECT id FROM users WHERE email='government@demo.doctarx.com' AND market_scope='NG' AND role='patient'")).rows[0];
    assert.ok(existingProvider && patient && other, 'Reuse the existing provisioned DoctaRx demo accounts; do not seed or reset them');
    const ownVisit = (await client.query("INSERT INTO ng_appointments(patient_user_id,provider_id,scheduled_at,status,consult_fee,total_amount) VALUES($1,$2,'2099-07-01T12:00:00Z','completed',0,0) RETURNING id", [patient.id, existingProvider.profile_id])).rows[0];
    const otherVisit = (await client.query("INSERT INTO ng_appointments(patient_user_id,provider_id,scheduled_at,status,consult_fee,total_amount) VALUES($1,$2,'2099-07-01T13:00:00Z','completed',0,0) RETURNING id", [other.id, existingProvider.profile_id])).rows[0];
    const transactionalClient = {
      async query(sql, params) {
        if (sql === 'BEGIN') { savepoint = true; return client.query('SAVEPOINT prescription_request'); }
        if (sql === 'COMMIT') { savepoint = false; return client.query('RELEASE SAVEPOINT prescription_request'); }
        if (sql === 'ROLLBACK') {
          if (!savepoint) return { rows: [] };
          await client.query('ROLLBACK TO SAVEPOINT prescription_request'); savepoint = false; return client.query('RELEASE SAVEPOINT prescription_request');
        }
        if (failAudit && sql.includes('INSERT INTO audit_logs')) throw new Error('Injected audit unavailability');
        try { return await client.query(sql, params); }
        catch (error) { databaseFailure = { code: error.code, message: error.message }; throw error; }
      },
      release() {},
    };
    const transactionalPool = { connect: async () => transactionalClient };
    const user = { id: existingProvider.id, role: 'provider', marketScope: 'NG' };
    const marker = `Rollback prescribing fixture ${crypto.randomUUID()}`;
    await withRoute(transactionalPool, user, async (post) => {
      const ownInput = validInput({ patientUserId: patient.id, appointmentId: ownVisit.id, notes: marker });
      const accepted = await post(ownInput); assert.equal(accepted.status, 201, JSON.stringify(databaseFailure)); const created = (await accepted.json()).prescription;
      const stored = (await client.query('SELECT patient_user_id,provider_id,provider_user_id,appointment_id FROM ng_digital_prescriptions WHERE id=$1', [created.id])).rows[0];
      assert.deepEqual(stored, { patient_user_id: patient.id, provider_id: existingProvider.profile_id, provider_user_id: existingProvider.id, appointment_id: ownVisit.id });
      const rejected = await post({ ...ownInput, appointmentId: otherVisit.id }); assert.equal(rejected.status, 403);
      assert.equal((await client.query('SELECT COUNT(*) FROM ng_digital_prescriptions WHERE notes=$1', [marker])).rows[0].count, '1');
      failAudit = true;
      const failed = await post({ ...ownInput, notes: marker + ' audit failure' }); assert.equal(failed.status, 503);
      assert.equal((await client.query('SELECT COUNT(*) FROM ng_digital_prescriptions WHERE notes=$1', [marker + ' audit failure'])).rows[0].count, '0');
    });
    await withRoute(transactionalPool, { id: other.id, role: 'provider', marketScope: 'NG' }, async (post) => {
      const denied = await post(validInput({ patientUserId: patient.id })); assert.equal(denied.status, 403);
    });
  } finally { await client.query('ROLLBACK'); client.release(); await pool.end(); }
});
