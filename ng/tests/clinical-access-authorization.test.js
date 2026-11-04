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

test('default clinical access retains unlocked UNION witnesses without adding status policy', async () => {
  for (const lock of [undefined, false]) {
    const pool = scriptedPool([{ rows: [{ id: 'profile' }] }, { rows: [{ id: 'witness' }] }]);
    await assertClinicalAccess(request({ id: 'provider', role: 'provider' }), { pool, patientUserId: 'patient', ...(lock === undefined ? {} : { lock }) });
    assert.equal(pool.calls.length, 2);
    assert.match(pool.calls[1].sql, /UNION/);
    assert.match(pool.calls[1].sql, /is_active = TRUE/);
    for (const { sql } of pool.calls) assert.doesNotMatch(sql, /FOR SHARE|\bstatus\s*=/i);
  }
});

test('locked clinical access accepts each original OR witness and locks the selected row', async () => {
  const tables = ['ng_appointments', 'ng_clinical_encounters', 'provider_patient_relationships'];
  for (let branch = 0; branch < tables.length; branch++) {
    const pool = scriptedPool([{ rows: [{ id: 'profile' }] }, ...Array.from({ length: branch }, () => ({ rows: [] })), { rows: [{ id: 'witness' }] }]);
    const access = await assertClinicalAccess(request({ id: 'provider', role: 'provider' }), { pool, patientUserId: 'patient', lock: true });
    assert.equal(access.providerId, 'profile');
    assert.equal(pool.calls.length, branch + 2);
    assert.match(pool.calls[0].sql, /FOR SHARE/);
    for (let index = 0; index <= branch; index++) {
      const { sql, params } = pool.calls[index + 1];
      assert.match(sql, new RegExp(`FROM ${tables[index]}\\b`));
      assert.match(sql, /LIMIT 1\s+FOR SHARE/);
      assert.doesNotMatch(sql, /UNION|\bstatus\s*=/i);
      assert.deepEqual(params, ['patient', index === 0 ? 'profile' : 'provider']);
      if (index === 2) assert.match(sql, /is_active = TRUE/);
    }
  }
});

test('locked explicit witness misses fall through to other witnesses and exhaustion denies', async () => {
  const base = { patientUserId: 'patient', appointmentId: 'stale-appointment', encounterId: 'stale-encounter', lock: true };
  for (const allowed of [true, false]) {
    const pool = scriptedPool([{ rows: [{ id: 'profile' }] }, ...Array.from({ length: 4 }, () => ({ rows: [] })), { rows: allowed ? [{ id: 'relationship' }] : [] }]);
    const pending = assertClinicalAccess(request({ id: 'provider', role: 'provider' }), { pool, ...base });
    if (allowed) assert.equal((await pending).providerId, 'profile');
    else await assert.rejects(pending, error => error.statusCode === 403 && error.code === 'CLINICAL_ACCESS_DENIED');
    assert.equal(pool.calls.length, 6);
    assert.deepEqual(pool.calls[1].params, ['stale-appointment', 'patient', 'profile']);
    assert.deepEqual(pool.calls[2].params, ['stale-encounter', 'patient', 'provider']);
    for (const { sql } of pool.calls) assert.match(sql, /FOR SHARE/);
  }
});

test('locked explicit appointment or encounter remains sufficient regardless of status', async () => {
  for (const key of ['appointmentId', 'encounterId']) {
    const pool = scriptedPool([{ rows: [{ id: 'profile' }] }, { rows: [{ id: 'witness' }] }]);
    await assertClinicalAccess(request({ id: 'provider', role: 'provider' }), { pool, patientUserId: 'patient', [key]: 'witness', lock: true });
    assert.equal(pool.calls.length, 2);
    assert.match(pool.calls[1].sql, /FOR SHARE/);
    assert.doesNotMatch(pool.calls[1].sql, /\bstatus\s*=/i);
  }
});
