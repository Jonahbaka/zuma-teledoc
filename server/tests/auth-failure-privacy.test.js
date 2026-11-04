'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const express = require('express');

const source = fs.readFileSync(require.resolve('../middleware/auth'), 'utf8');
const secret = 'synthetic-auth-privacy-test-only-not-a-live-secret';
const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'synthetic-patient@example.invalid',
  role: 'patient',
  is_active: true,
  first_name: 'Synthetic',
  last_name: 'Patient',
  market_scope: 'NG',
  credential_version: 0,
};
const financialAccess = {
  accessLevel: 'basic',
  financialAccessAvailable: true,
  paymentVerified: false,
};
const marker = 'SYNTHETIC_PRIVATE_AUTH_FAILURE';

function privateFailure() {
  return Object.assign(new Error(`${marker}: patient note and connection detail`), {
    name: marker,
    stack: `${marker}: synthetic private stack`,
    code: marker,
    detail: marker,
    hint: marker,
  });
}

function loadAuth(options = {}) {
  const logs = [];
  const calls = [];
  const db = options.db || {
    async query() {
      calls.push('user_lookup');
      if (options.stage === 'user_lookup') throw options.failure;
      return { rows: options.rows || [user] };
    },
  };
  const dependencies = {
    jsonwebtoken: options.jwt || jwt,
    crypto,
    '../db': db,
    '../services/authSessionService': {
      async assertCurrentSession() {
        calls.push('session_verification');
        if (options.assertCurrentSession) return options.assertCurrentSession(...arguments);
        if (options.stage === 'session_verification') throw options.failure;
      },
    },
    '../services/consumerMembershipService': {
      async readAuthority() {
        calls.push('membership_lookup');
        if (options.stage === 'membership_lookup') throw options.failure;
        return financialAccess;
      },
    },
    './logger': {
      error: (...args) => logs.push(['error', ...args]),
      audit: (...args) => logs.push(['audit', ...args]),
    },
    '../services/testingAccessService': {
      getTestingBypassPayload() {
        if (options.stage === 'user_context') throw options.failure;
        return {};
      },
    },
  };
  const sandbox = {
    module: { exports: {} },
    process: { env: { JWT_ACCESS_SECRET: secret } },
    console: {
      error: (...args) => logs.push(['console.error', ...args]),
      warn: (...args) => logs.push(['console.warn', ...args]),
    },
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  };
  vm.runInNewContext(source, sandbox, { filename: 'auth.js' });
  return { authenticate: sandbox.module.exports.authenticate, logs, calls };
}

function loadDatabase(query) {
  const logs = [];
  const sandbox = {
    module: { exports: {} },
    process: { env: {} },
    console: {
      error: (...args) => logs.push(args),
      log: (...args) => logs.push(args),
    },
    require(name) {
      if (name === 'dotenv') return { config() {} };
      if (name === 'pg') return { Pool: class {
        on() {}
        query(...args) { return query(...args); }
      } };
      if (name === 'fs' || name === 'path') return require(name);
      if (name === './resolve-neon-url') return { resolveNeonConfig() { assert.fail('No external database resolver allowed'); } };
      if (name === './connectionConfig') return require('../db/connectionConfig');
      assert.fail(`Unexpected database dependency: ${name}`);
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../db'), 'utf8'), sandbox, { filename: 'db/index.js' });
  return { db: sandbox.module.exports, logs };
}

function loadSessionCheck(db) {
  const sandbox = {
    module: { exports: {} },
    require(name) {
      if (name === 'node:crypto') return crypto;
      if (name === '../db') return db;
      if (name === '../../lib/encryption') return { hash() { assert.fail('No credential mutation expected'); } };
      assert.fail(`Unexpected session dependency: ${name}`);
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../services/authSessionService'), 'utf8'), sandbox, { filename: 'authSessionService.js' });
  return sandbox.module.exports.assertCurrentSession;
}

function token(claims = {}, options = {}) {
  return jwt.sign({ userId: user.id, sessionVersion: 0, ...claims }, secret, options);
}

async function invoke(harness, overrides = {}) {
  let status;
  let body;
  let nextCalls = 0;
  const req = {
    headers: { authorization: `Bearer ${token()}` },
    cookies: {},
    originalUrl: `/api/clinical-encounters?private=${marker}`,
    body: { patientNote: marker },
    ...overrides,
  };
  const response = {
    status(value) { status = value; return this; },
    json(value) { body = JSON.parse(JSON.stringify(value)); return this; },
  };
  await harness.authenticate(req, response, () => { nextCalls++; });
  return { status, body, nextCalls, req };
}

for (const stage of ['user_lookup', 'session_verification', 'membership_lookup', 'user_context']) {
  test(`unexpected ${stage} failures stay private and fail closed`, async () => {
    const harness = loadAuth({ stage, failure: privateFailure() });
    const result = await invoke(harness);
    assert.equal(result.status, 500);
    assert.equal(result.nextCalls, 0);
    assert.deepEqual(result.body, {
      success: false,
      error: 'Authentication failed',
      code: 'AUTHENTICATION_FAILED',
    });
    assert.deepEqual(JSON.parse(JSON.stringify(harness.logs)), [
      ['error', 'Authentication error', { code: 'AUTHENTICATION_FAILED', stage }],
    ]);
    assert.ok(!JSON.stringify([result.body, harness.logs]).includes(marker));
    if (stage === 'user_lookup') assert.deepEqual(harness.calls, ['user_lookup']);
    if (stage === 'session_verification') assert.deepEqual(harness.calls, ['user_lookup', 'session_verification']);
  });
}

test('unexpected verification failure omits raw token, exception and request context', async () => {
  const harness = loadAuth({ jwt: { verify() { throw privateFailure(); } } });
  const result = await invoke(harness, { headers: { authorization: `Bearer ${marker}` } });
  assert.equal(result.status, 500);
  assert.equal(result.nextCalls, 0);
  assert.equal(harness.logs[0][2].stage, 'token_verification');
  assert.ok(!JSON.stringify([result.body, harness.logs]).includes(marker));
  assert.deepEqual(harness.calls, []);
});

for (const failure of [null, undefined, marker]) {
  test(`non-Error rejection (${String(failure)}) still produces a private denial`, async () => {
    const harness = loadAuth({ stage: 'user_lookup', failure });
    const result = await invoke(harness);
    assert.equal(result.status, 500);
    assert.equal(result.body.code, 'AUTHENTICATION_FAILED');
    assert.equal(result.nextCalls, 0);
    assert.ok(!JSON.stringify([result.body, harness.logs]).includes(marker));
  });
}

test('missing, invalid and expired tokens preserve established 401 responses', async () => {
  for (const [headers, expected] of [
    [{}, { success: false, error: 'Authentication required', code: 'AUTH_REQUIRED' }],
    [{ authorization: 'Bearer synthetic-invalid-token' }, { success: false, error: 'Invalid token', code: 'INVALID_TOKEN' }],
    [{ authorization: `Bearer ${token({}, { expiresIn: -1 })}` }, { success: false, error: 'Token expired', code: 'TOKEN_EXPIRED' }],
  ]) {
    const harness = loadAuth();
    const result = await invoke(harness, { headers });
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, expected);
    assert.equal(result.nextCalls, 0);
    assert.deepEqual(harness.logs, []);
    assert.deepEqual(harness.calls, []);
  }
});

test('revoked-session rejection remains 401 without logging private rejection details', async () => {
  const harness = loadAuth({ stage: 'session_verification', failure: Object.assign(privateFailure(), { statusCode: 401 }) });
  const result = await invoke(harness);
  assert.equal(result.status, 401);
  assert.deepEqual(result.body, { success: false, error: 'Session is no longer valid' });
  assert.equal(result.nextCalls, 0);
  assert.deepEqual(harness.logs, []);
});

test('inactive accounts, pending providers and mandatory password changes remain blocked', async () => {
  for (const row of [
    { ...user, is_active: false },
    { ...user, role: 'provider', provider_status: 'pending' },
    { ...user, role: 'provider', provider_status: 'approved', must_change_password: true },
  ]) {
    const harness = loadAuth({ rows: [row] });
    const result = await invoke(harness);
    assert.equal(result.status, 403);
    assert.equal(result.nextCalls, 0);
    assert.equal(result.body.success, false);
    assert.deepEqual(harness.logs, []);
  }
});

test('successful bearer and cookie authentication keep current identity and financial authority', async () => {
  for (const overrides of [{}, { headers: {}, cookies: { accessToken: token() } }]) {
    const harness = loadAuth();
    const result = await invoke(harness, overrides);
    assert.equal(result.status, undefined);
    assert.equal(result.nextCalls, 1);
    assert.equal(result.req.user.id, user.id);
    assert.equal(result.req.user.marketScope, 'NG');
    assert.equal(result.req.user.paymentVerified, false);
    assert.equal(result.req.financialAccess, financialAccess);
    assert.deepEqual(harness.logs, []);
  }
});

test('real HTTP boundary returns only the private failure contract', async () => {
  const harness = loadAuth({ stage: 'user_lookup', failure: privateFailure() });
  const app = express();
  let protectedCalls = 0;
  app.get('/protected', harness.authenticate, (_req, res) => {
    protectedCalls++;
    res.json({ protected: true });
  });
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/protected?private=${marker}`, {
      headers: { authorization: `Bearer ${token()}` },
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { success: false, error: 'Authentication failed', code: 'AUTHENTICATION_FAILED' });
    assert.equal(protectedCalls, 0);
    assert.ok(!JSON.stringify(harness.logs).includes(marker));
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('actual database query keeps its original rejection without logging SQL, params or exception', async () => {
  const failure = privateFailure();
  const { db, logs } = loadDatabase(async () => { throw failure; });
  await assert.rejects(db.query(`SELECT '${marker}'`, [marker]), error => error === failure);
  assert.deepEqual(JSON.parse(JSON.stringify(logs)), [
    ['Database query error:', { code: 'DATABASE_QUERY_FAILED' }],
  ]);
});

for (const failureQuery of [1, 2]) {
  test(`actual database and session modules keep auth query ${failureQuery} failures private`, async () => {
    let queryCount = 0;
    const database = loadDatabase(async () => {
      queryCount++;
      if (queryCount === failureQuery) throw privateFailure();
      return { rows: [user], rowCount: 1 };
    });
    const harness = loadAuth({ db: database.db, assertCurrentSession: loadSessionCheck(database.db) });
    const result = await invoke(harness, { headers: { authorization: `Bearer ${token({ sessionId: '22222222-2222-4222-8222-222222222222' })}` } });
    assert.equal(queryCount, failureQuery);
    assert.equal(result.status, 500);
    assert.equal(result.body.code, 'AUTHENTICATION_FAILED');
    assert.equal(result.nextCalls, 0);
    assert.equal(harness.logs[0][2].stage, failureQuery === 1 ? 'user_lookup' : 'session_verification');
    assert.equal(database.logs[0][1].code, 'DATABASE_QUERY_FAILED');
    assert.ok(!JSON.stringify([result.body, harness.logs, database.logs]).includes(marker));
  });
}
