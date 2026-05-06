#!/usr/bin/env node

const assert = require('assert');
const path = require('path');

const users = [];
const subscriptions = [];
const auditLogs = [];

function nowIso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function filterUsers(sql, params = []) {
  let result = [...users];
  const marketScope = params[0];

  if (marketScope) {
    result = result.filter((user) => (user.market_scope || 'US') === marketScope);
  }

  if (sql.includes('u.role = $2')) {
    result = result.filter((user) => user.role === params[1]);
  }

  if (sql.includes("u.is_active = TRUE")) {
    result = result.filter((user) => user.is_active === true);
  }

  if (sql.includes("u.is_active = FALSE")) {
    result = result.filter((user) => user.is_active === false);
  }

  if (sql.includes("deletedAt', '') = ''")) {
    result = result.filter((user) => !user.test_account_metadata?.deletedAt);
  }

  if (sql.includes("deletedAt', '') <> ''")) {
    result = result.filter((user) => Boolean(user.test_account_metadata?.deletedAt));
  }

  if (sql.includes("revokedAt', '') <> ''")) {
    result = result.filter((user) => Boolean(user.test_account_metadata?.revokedAt) || user.is_active === false);
  }

  const searchParam = params.find((param) => typeof param === 'string' && param.startsWith('%') && param.endsWith('%'));
  if (searchParam) {
    const search = searchParam.slice(1, -1).toLowerCase();
    result = result.filter((user) => {
      const metadataText = JSON.stringify(user.test_account_metadata || {}).toLowerCase();
      return [
        user.email,
        user.first_name,
        user.last_name,
        user.phone,
        user.specialty,
        metadataText,
      ].some((value) => String(value || '').toLowerCase().includes(search));
    });
  }

  return result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

async function query(sql, params = []) {
  if (/^\s*BEGIN/i.test(sql) || /^\s*COMMIT/i.test(sql) || /^\s*ROLLBACK/i.test(sql)) {
    return { rows: [] };
  }

  if (sql.includes('CREATE TYPE region_code') && sql.includes('ALTER TABLE users ADD COLUMN IF NOT EXISTS test_account_metadata')) {
    return { rows: [] };
  }

  if (sql.includes('SELECT id, email, role, market_scope')) {
    return {
      rows: users
        .filter((user) => user.email === params[0] && user.role === params[1])
        .slice(0, 1),
    };
  }

  if (sql.includes('INSERT INTO users')) {
    const createdAt = nowIso(users.length * 1000);
    const metadata = JSON.parse(params[20] || '{}');
    const row = {
      id: `test-account-${users.length + 1}`,
      email: params[0],
      password_hash: params[1],
      role: params[2],
      first_name: params[3],
      last_name: params[4],
      phone: params[5],
      country: params[6],
      region: params[7],
      market_scope: params[8],
      state: params[9],
      city: params[10],
      specialty: params[11],
      credentials: params[12],
      provider_status: params[13],
      access_level: params[14],
      is_active: true,
      is_verified: true,
      must_change_password: params[15],
      testing_bypass_active: params[17],
      testing_bypass_expires_at: params[18],
      testing_bypass_tier: params[19],
      test_account_metadata: metadata,
      created_at: createdAt,
      updated_at: createdAt,
      last_login_at: null,
    };
    users.push(row);
    return { rows: [row] };
  }

  if (sql.includes('INSERT INTO subscriptions')) {
    subscriptions.push({
      user_id: params[0],
      tier: params[1],
      current_period_end: params[2],
    });
    return { rows: [] };
  }

  if (sql.includes('UPDATE users u') && sql.includes('test_account_metadata')) {
    const [accountId, marketScope, patchJson, action] = params;
    const user = users.find((candidate) =>
      candidate.id === accountId &&
      (candidate.market_scope || 'US') === marketScope &&
      candidate.test_account_metadata?.testAccount === true &&
      (action !== 'delete' || !candidate.test_account_metadata?.deletedAt)
    );

    if (!user) return { rows: [] };

    const patch = JSON.parse(patchJson || '{}');
    user.is_active = false;
    user.testing_bypass_active = false;
    user.test_account_metadata = {
      ...(user.test_account_metadata || {}),
      ...patch,
    };
    user.updated_at = nowIso();
    return { rows: [user] };
  }

  if (sql.includes('INSERT INTO audit_logs')) {
    auditLogs.push({ params });
    return { rows: [] };
  }

  if (sql.includes('COUNT(*)::int AS count') && sql.includes('FROM users u')) {
    return { rows: [{ count: filterUsers(sql, params).length }] };
  }

  if (sql.includes('FROM users u') && sql.includes('ORDER BY u.created_at DESC')) {
    const limit = Number(params[params.length - 2] || 100);
    const offset = Number(params[params.length - 1] || 0);
    return { rows: filterUsers(sql, params).slice(offset, offset + limit) };
  }

  throw new Error(`Unhandled mock query: ${sql}`);
}

const mockDb = {
  query,
  getClient: async () => ({
    query,
    release: () => {},
  }),
};

const dbPath = require.resolve(path.join('..', 'server', 'db'));
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: mockDb,
};

const {
  createAdminTestAccount,
  listAdminTestAccounts,
  updateAdminTestAccountLifecycle,
} = require('../server/services/adminTestAccountService');

function makeReq({ body = {}, query = {} } = {}) {
  return {
    body,
    query,
    user: {
      id: 'super-admin-test',
      role: 'super_admin',
      email: 'admin@doctarx.test',
    },
    ip: '127.0.0.1',
    params: {},
    get: () => 'admin-test-access-verification',
  };
}

function makeRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

async function createAccount(body) {
  const res = makeRes();
  await createAdminTestAccount(makeReq({ body }), res, { marketScope: 'NG' });
  assert.strictEqual(res.statusCode, 201, JSON.stringify(res.payload));
  assert.strictEqual(res.payload.success, true);
  return res.payload.user;
}

async function createAccountRaw(body) {
  const res = makeRes();
  await createAdminTestAccount(makeReq({ body }), res, { marketScope: 'NG' });
  return res;
}

async function listAccounts(queryParams = {}) {
  const res = makeRes();
  await listAdminTestAccounts(makeReq({ query: queryParams }), res, { marketScope: 'NG' });
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.payload));
  assert.strictEqual(res.payload.success, true);
  return res.payload;
}

async function updateAccount(accountId, action) {
  const res = makeRes();
  const req = makeReq({ body: { action } });
  req.params = { id: accountId };
  await updateAdminTestAccountLifecycle(req, res, { marketScope: 'NG', action });
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.payload));
  assert.strictEqual(res.payload.success, true);
  return res.payload.account;
}

(async () => {
  const suffix = Date.now();
  const patientPayload = {
    role: 'patient',
    firstName: 'Ngozi',
    lastName: 'Patient',
    email: `ng.patient.${suffix}@doctarx.test`,
    phone: '+2348011111111',
    temporaryPassword: 'TempPass123!',
    state: 'FCT',
    lga: 'Abuja Municipal',
    activateTestingBypass: true,
    testingBypassTier: 'gold',
    testingBypassDays: 30,
  };

  await createAccount(patientPayload);

  await createAccount({
    role: 'provider',
    firstName: 'Ada',
    lastName: 'Provider',
    email: `ng.provider.${suffix}@doctarx.test`,
    phone: '+2348022222222',
    temporaryPassword: 'TempPass123!',
    specialty: 'Family Medicine',
    state: 'FCT',
    lga: 'Garki',
    bypassCredentialing: true,
    activateTestingBypass: true,
    testingBypassTier: 'gold',
    testingBypassDays: 30,
  });

  await createAccount({
    role: 'pharmacy',
    businessName: 'DoctaRx QA Pharmacy Abuja',
    contactPerson: 'Pharmacy Test Lead',
    email: `ng.pharmacy.${suffix}@doctarx.test`,
    phone: '+2348033333333',
    whatsappNumber: '+2348033333333',
    branchLocation: 'Wuse 2, Abuja',
    temporaryPassword: 'TempPass123!',
    state: 'FCT',
    lga: 'Wuse',
    facilityType: 'pharmacy',
    preferredPrescriptionReceivingMethod: 'dashboard_plus_whatsapp',
    activateTestingBypass: true,
    testingBypassTier: 'gold',
    testingBypassDays: 30,
  });

  const all = await listAccounts({ limit: 100 });
  assert.strictEqual(all.accounts.length, 3, 'Expected all three created test accounts to list');
  assert.deepStrictEqual(
    all.accounts.map((account) => account.role).sort(),
    ['patient', 'pharmacy', 'provider']
  );
  assert.strictEqual(new Set(all.accounts.map((account) => account.id)).size, 3, 'Expected unique account IDs');
  assert(all.accounts.every((account) => account.marketScope === 'NG'), 'Expected NG market scope on every account');
  assert(all.accounts.every((account) => account.testAccountMetadata?.testAccount === true), 'Expected test account metadata flag');

  const pharmacyOnly = await listAccounts({ role: 'pharmacy', limit: 100 });
  assert.strictEqual(pharmacyOnly.accounts.length, 1, 'Expected role filter to return only pharmacy');
  assert.strictEqual(pharmacyOnly.accounts[0].businessName, 'DoctaRx QA Pharmacy Abuja');

  const search = await listAccounts({ query: 'qa pharmacy', limit: 100 });
  assert.strictEqual(search.accounts.length, 1, 'Expected search to find pharmacy business name from metadata');

  const duplicate = await createAccountRaw(patientPayload);
  assert.strictEqual(duplicate.statusCode, 409, 'Expected duplicate email + role to return 409');
  assert.strictEqual(duplicate.payload.success, false);

  const provider = all.accounts.find((account) => account.role === 'provider');
  const patient = all.accounts.find((account) => account.role === 'patient');
  const revokedProvider = await updateAccount(provider.id, 'revoke');
  assert.strictEqual(revokedProvider.status, 'revoked');
  assert.strictEqual(revokedProvider.isActive, false);

  const deletedPatient = await updateAccount(patient.id, 'delete');
  assert.strictEqual(deletedPatient.status, 'deleted');
  assert.strictEqual(deletedPatient.isActive, false);

  const defaultAfterDelete = await listAccounts({ limit: 100 });
  assert.strictEqual(defaultAfterDelete.accounts.length, 2, 'Expected soft-deleted patient to be hidden by default');

  const includeDeleted = await listAccounts({ includeDeleted: 'true', limit: 100 });
  assert.strictEqual(includeDeleted.accounts.length, 3, 'Expected includeDeleted to show all three accounts');

  const revokedOnly = await listAccounts({ status: 'revoked', limit: 100 });
  assert.strictEqual(revokedOnly.accounts.length, 1, 'Expected revoked filter to show only revoked provider');

  const evidence = {
    createdAccounts: all.accounts.map((account) => ({
      id: account.id,
      email: account.email,
      role: account.role,
      marketScope: account.marketScope,
      displayName: account.displayName,
      mustChangePassword: account.mustChangePassword,
      testingBypassActive: account.testingBypassActive,
      loginUrl: account.loginUrl,
    })),
    subscriptionsCreated: subscriptions.length,
    auditLogsWritten: auditLogs.length,
    listCount: all.accounts.length,
    roleFilterCount: pharmacyOnly.accounts.length,
    searchCount: search.accounts.length,
    duplicateEmailStatus: duplicate.statusCode,
    revokedAccount: {
      id: revokedProvider.id,
      email: revokedProvider.email,
      status: revokedProvider.status,
    },
    deletedAccount: {
      id: deletedPatient.id,
      email: deletedPatient.email,
      status: deletedPatient.status,
    },
    defaultListAfterDeleteCount: defaultAfterDelete.accounts.length,
    includeDeletedCount: includeDeleted.accounts.length,
    revokedFilterCount: revokedOnly.accounts.length,
  };

  console.log(JSON.stringify(evidence, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
