'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertProgrammeScope,
  listUserProgrammeContexts,
  recordProgrammeAudit,
} = require('../services/phc/programmeScopeService');

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

const activeContext = {
  programme_id: 'programme-1',
  programme_key: 'phc-pilot',
  programme_name: 'PHC Pilot',
  demo_only: false,
  programme_status: 'active',
  programme_facility_id: 'programme-facility-1',
  programme_facility_status: 'active',
  facility_id: 'facility-1',
  facility_name: 'PHC One',
};

test('programme scope requires active membership with an allowed role', async () => {
  const pool = scriptedPool([
    { rows: [{ id: 'nurse-1', role: 'provider', is_active: true, is_test_account: false }] },
    { rows: [activeContext] },
    { rows: [{ id: 'membership-1', role: 'phc_nurse', permissions_json: {}, can_export: false, can_approve: false }] },
    { rows: [{ id: 'enrollment-1', status: 'active', consent_status: 'granted', local_patient_number: 'PHC-1' }] },
  ]);

  const context = await assertProgrammeScope(pool, { id: 'nurse-1', role: 'provider' }, {
    programmeId: 'programme-1',
    facilityId: 'facility-1',
    allowedRoles: ['phc_nurse'],
    patientUserId: 'patient-1',
    requireEnrollment: true,
  });

  assert.equal(context.programmeRole, 'phc_nurse');
  assert.equal(context.enrollment.id, 'enrollment-1');
  assert.equal(pool.calls.length, 4);
});

test('cross-programme role is denied when membership is absent', async () => {
  const pool = scriptedPool([
    { rows: [{ id: 'nurse-1', role: 'provider', is_active: true, is_test_account: false }] },
    { rows: [activeContext] },
    { rows: [] },
  ]);

  await assert.rejects(
    assertProgrammeScope(pool, { id: 'nurse-1', role: 'provider' }, {
      programmeId: 'programme-1',
      facilityId: 'facility-1',
    }),
    (error) => error.statusCode === 403 && error.code === 'PROGRAMME_MEMBERSHIP_REQUIRED'
  );
});

test('demo accounts and real programmes are mutually isolated', async () => {
  const pool = scriptedPool([
    { rows: [{ id: 'demo-1', role: 'provider', is_active: true, is_test_account: true }] },
    { rows: [activeContext] },
  ]);

  await assert.rejects(
    assertProgrammeScope(pool, { id: 'demo-1', role: 'provider' }, {
      programmeId: 'programme-1',
      facilityId: 'facility-1',
    }),
    (error) => error.statusCode === 403 && error.code === 'DEMO_PROGRAMME_ISOLATION'
  );
  assert.equal(pool.calls.length, 2);
});

test('platform administrator can resolve a real programme without inheriting a clinical membership', async () => {
  const pool = scriptedPool([
    { rows: [{ id: 'platform-1', role: 'platform_admin', is_active: true, is_test_account: false }] },
    { rows: [activeContext] },
  ]);

  const context = await assertProgrammeScope(pool, { id: 'platform-1', role: 'platform_admin' }, {
    programmeId: 'programme-1',
    facilityId: 'facility-1',
    allowedRoles: ['platform_admin'],
  });
  assert.equal(context.programmeRole, 'platform_admin');
  assert.equal(pool.calls.length, 2);
});

test('context listing removes a programme whose demo classification does not match the account', async () => {
  const pool = scriptedPool([
    { rows: [{ id: 'demo-1', role: 'provider', is_active: true, is_test_account: true }] },
    { rows: [
      { programme_id: 'real-1', demo_only: false },
      { programme_id: 'demo-1', demo_only: true },
    ] },
  ]);
  const contexts = await listUserProgrammeContexts(pool, { id: 'demo-1' });
  assert.deepEqual(contexts.map((row) => row.programme_id), ['demo-1']);
});

test('sensitive programme audit fails closed if its table is unavailable', async () => {
  const error = new Error('missing table');
  error.code = '42P01';
  await assert.rejects(
    recordProgrammeAudit(scriptedPool([error]), {}, {
      programme_id: 'programme-1',
      facility_id: 'facility-1',
      userId: 'nurse-1',
    }, {
      action: 'view',
      resourceType: 'encounter',
      dataClass: 'sensitive',
    }),
    (caught) => caught.statusCode === 503 && caught.code === 'PROGRAMME_AUDIT_UNAVAILABLE'
  );
});
