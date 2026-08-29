'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertClinicalAccess,
} = require('../services/clinical/clinicalAccessService');

function request(user, overrides = {}) {
  return {
    user,
    headers: {},
    body: {},
    ip: '127.0.0.1',
    get: () => 'clinical-access-test',
    ...overrides,
  };
}

function scriptedPool(results) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const next = results.shift();
      if (next instanceof Error) throw next;
      return next || { rows: [] };
    },
  };
}

test('patient may read only their own clinical record', async () => {
  const pool = scriptedPool([]);
  const access = await assertClinicalAccess(request({ id: 'patient-1', role: 'patient' }), {
    pool,
    patientUserId: 'patient-1',
    mode: 'read',
  });

  assert.equal(access.selfAccess, true);
  assert.equal(pool.calls.length, 0);

  await assert.rejects(
    assertClinicalAccess(request({ id: 'patient-1', role: 'patient' }), {
      pool,
      patientUserId: 'patient-2',
      mode: 'read',
    }),
    (error) => error.statusCode === 403 && error.code === 'CLINICAL_ACCESS_DENIED'
  );
});

test('patient cannot use a clinical write endpoint', async () => {
  await assert.rejects(
    assertClinicalAccess(request({ id: 'patient-1', role: 'patient' }), {
      pool: scriptedPool([]),
      patientUserId: 'patient-1',
      mode: 'write',
    }),
    (error) => error.statusCode === 403 && error.code === 'CLINICAL_ACCESS_DENIED'
  );
});

test('provider access requires a Nigeria provider profile and clinical relationship', async () => {
  const allowedPool = scriptedPool([
    { rows: [{ id: 'provider-profile-1' }] },
    { rows: [{ id: 'relationship-1' }] },
  ]);
  const access = await assertClinicalAccess(request({ id: 'provider-user-1', role: 'provider' }), {
    pool: allowedPool,
    patientUserId: 'patient-1',
    mode: 'read',
  });

  assert.equal(access.providerId, 'provider-profile-1');
  assert.equal(access.providerUserId, 'provider-user-1');
  assert.match(allowedPool.calls[1].sql, /provider_patient_relationships/);

  const deniedPool = scriptedPool([
    { rows: [{ id: 'provider-profile-1' }] },
    { rows: [] },
  ]);
  await assert.rejects(
    assertClinicalAccess(request({ id: 'provider-user-1', role: 'provider' }), {
      pool: deniedPool,
      patientUserId: 'patient-2',
      mode: 'read',
    }),
    (error) => error.statusCode === 403 && error.code === 'CLINICAL_ACCESS_DENIED'
  );
});

test('non-clinical role is denied without querying patient data', async () => {
  const pool = scriptedPool([]);
  await assert.rejects(
    assertClinicalAccess(request({ id: 'user-1', role: 'pharmacy' }), {
      pool,
      patientUserId: 'patient-1',
      mode: 'read',
    }),
    (error) => error.statusCode === 403 && error.code === 'CLINICAL_ACCESS_DENIED'
  );
  assert.equal(pool.calls.length, 0);
});

test('administrator requires a reason and every break-glass access is audited', async () => {
  const missingReasonPool = scriptedPool([]);
  await assert.rejects(
    assertClinicalAccess(request({ id: 'admin-1', role: 'super_admin' }), {
      pool: missingReasonPool,
      patientUserId: 'patient-1',
      mode: 'read',
    }),
    (error) => error.statusCode === 403 && error.code === 'BREAK_GLASS_REASON_REQUIRED'
  );

  const auditPool = scriptedPool([{ rows: [] }]);
  const access = await assertClinicalAccess(request(
    { id: 'admin-1', role: 'super_admin' },
    { headers: { 'x-break-glass-reason': 'Investigating an urgent patient safety incident' } }
  ), {
    pool: auditPool,
    patientUserId: 'patient-1',
    encounterId: 'encounter-1',
    mode: 'read',
  });

  assert.equal(access.adminOverride, true);
  assert.equal(auditPool.calls.length, 1);
  assert.match(auditPool.calls[0].sql, /INSERT INTO ng_audit_lineage/);
  assert.match(auditPool.calls[0].params[5], /patient safety incident/);
});

test('break-glass access fails closed when audit storage is unavailable', async () => {
  const unavailable = new Error('relation does not exist');
  unavailable.code = '42P01';
  await assert.rejects(
    assertClinicalAccess(request(
      { id: 'admin-1', role: 'admin' },
      { headers: { 'x-break-glass-reason': 'Emergency production support investigation' } }
    ), {
      pool: scriptedPool([unavailable]),
      patientUserId: 'patient-1',
      mode: 'write',
    }),
    (error) => error.statusCode === 503 && error.code === 'BREAK_GLASS_AUDIT_UNAVAILABLE'
  );
});
