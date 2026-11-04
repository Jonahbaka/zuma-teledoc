'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const express = require('express');
const { validate, registerSchema } = require('../../lib/validation');

const password = 'Synthetic-only-password1!';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const payload = overrides => ({
  email: `registration-${crypto.randomUUID()}@example.invalid`,
  password, confirmPassword: password, firstName: 'Synthetic', lastName: 'Registration',
  role: 'patient', country: 'NG', hipaaConsent: true, termsAccepted: true, ...overrides,
});

function sessionService(db) {
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../services/authSessionService'), 'utf8'), {
    module: mod,
    require(name) {
      if (name === '../db') return db;
      if (name === '../../lib/encryption') return { hash };
      if (name === 'node:crypto') return crypto;
      assert.fail(`Unexpected session dependency: ${name}`);
    },
  });
  return mod.exports;
}

function registrationRoute(db, events, { notificationFailure = false } = {}) {
  const router = express.Router();
  const logs = [];
  const notification = async () => {
    events.push('notification');
    if (notificationFailure) throw new Error('Synthetic delivery outage');
  };
  const dependencies = {
    express: { Router: () => router },
    '../utils/authCookiePolicy': { authCookieDomain: () => undefined, legacyAuthCookieDomain: () => undefined },
    bcryptjs: { hash: async () => '!synthetic-password-hash' },
    jsonwebtoken: require('jsonwebtoken'), speakeasy: {}, qrcode: {}, uuid: { v4: crypto.randomUUID },
    '../utils/mfaAttestation': {}, '../db': db, '../services/consumerMembershipService': {},
    '../middleware/logger': Object.fromEntries(['error', 'info', 'warn'].map(level => [level, (...args) => logs.push([level, ...args])])),
    '../middleware/auth': { authenticate() {}, requireMfa() {} },
    '../middleware/audit': { auditLogin: async () => { await db.query('INSERT INTO audit_logs (user_id) VALUES ($1)', [null]); } },
    '../../lib/encryption': { hash, generateToken: () => crypto.randomBytes(32).toString('hex') },
    '../services/testingAccessService': {}, '../../lib/validation': { validate, registerSchema },
    crypto, '../services/authSessionService': sessionService(db),
    '../services/email': { sendVerificationEmail: notification, sendWelcomeEmail: notification },
    '../services/notifications': { sendWelcomeNotification: notification },
    '../services/agentNotificationService': { sendWelcomeFromNova: notification },
  };
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../routes/auth'), 'utf8'), {
    module: mod, process: { env: { JWT_ACCESS_SECRET: 'synthetic-access-secret', JWT_REFRESH_SECRET: 'synthetic-refresh-secret' } },
    console,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected route dependency: ${name}`);
      return dependencies[name];
    },
  });
  const handler = router.stack.find(layer => layer.route?.path === '/register').route.stack[0].handle;
  return {
    logs,
    async call(body) {
      const response = {
        statusCode: 200, cookies: [],
        clearCookie() {},
        cookie(...args) { events.push('cookie'); this.cookies.push(args); },
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = value; return this; },
      };
      await handler({ body, ip: '127.0.0.1', get: () => 'synthetic-registration-test' }, response);
      return response;
    },
  };
}

// Execute the actual route and session service against a stateful transactional
// adapter. It deliberately enforces connection visibility and unique email/role
// constraints; no production database, credentials, or mail service is loaded.
function fixture(options = {}) {
  const events = [];
  let committed = { users: [], subscriptions: [], verifications: [], sessions: [], audits: [] };
  let queue = Promise.resolve();
  const control = { failAt: options.failAt };
  const fail = stage => {
    if (control.failAt === stage) throw control.error || Object.assign(new Error('SYNTHETIC_PRIVATE_DATABASE_DETAIL'), { code: 'XX000' });
  };
  async function query(state, sql, values = []) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    if (/^SELECT id FROM users WHERE email/.test(normalized)) return { rows: state.users.filter(row => row.email === values[0] && row.role === values[1]) };
    if (/^INSERT INTO users/.test(normalized)) {
      fail('user');
      const columns = normalized.match(/INSERT INTO users\s*\((.*?)\) VALUES/)[1].split(',').map(value => value.trim());
      const expressions = normalized.match(/VALUES\s*\((.*?)\) RETURNING/)[1].split(',').map(value => value.trim());
      const row = { id: crypto.randomUUID(), is_active: true, credential_version: 0, mfa_enabled: false, mfa_secret: null, market_scope: 'US', region: 'US', account_status: 'active', coverage_status: 'self_pay' };
      columns.forEach((column, index) => { row[column] = expressions[index].startsWith('$') ? values[Number(expressions[index].slice(1)) - 1] : expressions[index].replace(/^'|'$/g, ''); });
      if (state.users.some(user => user.email === row.email && user.role === row.role)) throw Object.assign(new Error('Synthetic unique violation'), { code: '23505', constraint: 'users_email_role_key' });
      state.users.push(row);
      return { rows: [{ ...row }] };
    }
    if (/^UPDATE users/.test(normalized)) {
      fail('market');
      const row = state.users.find(user => user.id === values[0]);
      if (row) Object.assign(row, { region: 'NG', market_scope: 'NG', account_status: row.account_status || 'active', coverage_status: row.role === 'patient' ? 'self_pay' : row.coverage_status });
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }
    if (/^SELECT (market_scope|\*) FROM users/.test(normalized)) return { rows: state.users.filter(user => user.id === values[0]).map(user => ({ ...user })) };
    for (const [pattern, stage, table] of [
      ['subscriptions', 'subscription', 'subscriptions'], ['email_verification_tokens', 'verification', 'verifications'],
      ['refresh_tokens', 'session', 'sessions'], ['audit_logs', 'audit', 'audits'],
    ]) {
      if (normalized.startsWith(`INSERT INTO ${pattern}`)) {
        fail(stage); state[table].push([...values]); return { rows: [] };
      }
    }
    assert.fail(`Unexpected SQL: ${normalized}`);
  }
  const db = {
    query(sql, values) {
      if (/^\s*(INSERT|UPDATE|DELETE)\b/.test(sql)) events.push('autocommit');
      return query(committed, sql, values);
    },
    transaction(operation) {
      const result = queue.then(async () => {
        events.push('begin');
        const pending = structuredClone(committed);
        try {
          const value = await operation({ query: (sql, values) => query(pending, sql, values) });
          fail('commit'); committed = pending; events.push('commit'); return value;
        } catch (error) { events.push('rollback'); throw error; }
      });
      queue = result.catch(() => {});
      return result;
    },
  };
  return { ...registrationRoute(db, events, options), events, control, get state() { return committed; } };
}

for (const stage of ['user', 'market', 'subscription', 'verification', 'session', 'audit', 'commit']) {
  test(`registration rolls back ${stage} failure without issuing credentials or stranding retry`, async () => {
    const f = fixture({ failAt: stage });
    const body = payload();
    const failed = await f.call(body);
    assert.equal(failed.statusCode, 500);
    for (const rows of Object.values(f.state)) assert.equal(rows.length, 0);
    assert.equal(failed.cookies.length, 0);
    assert.equal(f.events.includes('notification'), false);
    assert.equal(JSON.stringify(f.logs).includes('SYNTHETIC_PRIVATE_DATABASE_DETAIL'), false);
    f.control.failAt = null;
    const retried = await f.call(body);
    assert.equal(retried.statusCode, 201);
    assert.equal(retried.body.user.marketScope, 'NG');
    for (const rows of Object.values(f.state)) assert.equal(rows.length, 1);
  });
}

test('both markets and public roles commit every required record before credentials and welcome delivery', async () => {
  for (const country of ['US', 'NG', 'ng', undefined]) for (const role of ['patient', 'provider', 'pharmacy']) {
    const f = fixture();
    const result = await f.call(payload({ country, role }));
    assert.equal(result.statusCode, 201);
    const market = String(country).toUpperCase() === 'NG' ? 'NG' : 'US';
    assert.equal(result.body.user.marketScope, market);
    assert.equal(f.state.users[0].market_scope, market);
    assert.equal(f.state.users[0].region, market);
    assert.equal(f.state.users[0].provider_status, role === 'provider' ? 'pending' : null);
    assert.equal(f.state.users[0].is_verified, false);
    for (const rows of Object.values(f.state)) assert.equal(rows.length, 1);
    assert.equal(f.events.includes('autocommit'), false, 'Every registration write shares the transaction');
    assert.equal(f.events.filter(event => event === 'begin').length, 1, 'No independent session transaction');
    assert.ok(f.events.indexOf('commit') < f.events.indexOf('cookie'));
    assert.ok(f.events.indexOf('commit') < f.events.indexOf('notification'));
    assert.ok(result.body.accessToken && result.body.refreshToken);
    assert.match(f.state.verifications[0][1], /^[a-f0-9]{64}$/);
    assert.equal(f.state.sessions[0][1], hash(result.body.refreshToken));
    const claims = require('jsonwebtoken').decode(result.body.accessToken);
    assert.equal(claims.userId, result.body.user.id);
    assert.equal(claims.sessionVersion, 0);
    assert.equal(claims.sessionId, f.state.sessions[0][4]);
    const audit = JSON.stringify(f.state.audits);
    assert.ok(audit.includes('registration'));
    assert.equal(audit.includes(result.body.refreshToken) || audit.includes(password), false);
  }
});

test('concurrent identical signup yields one complete account and one conflict; other roles remain allowed', async () => {
  const f = fixture();
  const body = payload();
  const results = await Promise.all([f.call(body), f.call(body)]);
  assert.deepEqual(results.map(result => result.statusCode).sort(), [201, 409]);
  for (const rows of Object.values(f.state)) assert.equal(rows.length, 1);
  assert.equal(results.find(result => result.statusCode === 409).cookies.length, 0);
  const provider = await f.call({ ...body, role: 'provider' });
  assert.equal(provider.statusCode, 201);
  for (const rows of Object.values(f.state)) assert.equal(rows.length, 2);
});

test('notification failure cannot turn a committed registration into a failed signup', async () => {
  const f = fixture({ notificationFailure: true });
  const result = await f.call(payload());
  assert.equal(result.statusCode, 201);
  for (const rows of Object.values(f.state)) assert.equal(rows.length, 1);
  assert.equal(result.cookies.length, 2);
});

test('an unrelated unique constraint failure remains a rollback failure, not an email conflict', async () => {
  const f = fixture({ failAt: 'subscription' });
  f.control.error = Object.assign(new Error('Synthetic unrelated conflict'), { code: '23505', constraint: 'subscriptions_unrelated_key' });
  assert.equal((await f.call(payload())).statusCode, 500);
  for (const rows of Object.values(f.state)) assert.equal(rows.length, 0);
});

test('invalid consent and public staff signup never start an account transaction', async () => {
  for (const overrides of [{ hipaaConsent: false }, { role: 'admin' }]) {
    const f = fixture();
    const result = await f.call(payload(overrides));
    assert.equal(result.statusCode, overrides.role ? 403 : 400);
    assert.equal(f.events.length, 0);
    for (const rows of Object.values(f.state)) assert.equal(rows.length, 0);
  }
});

const target = process.env.SIMULATION_DATABASE_URL;
test('PostgreSQL registration failure rollback, market ownership, and duplicate races', { skip: !target, timeout: 45000 }, async () => {
  // Only an explicitly selected, disposable, already-migrated local test DB.
  const url = new URL(target);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'));
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: target, max: 6, statement_timeout: 10000 });
  const emails = [];
  const events = [];
  let failAt;
  const stageFor = sql => {
    if (/^\s*INSERT INTO users/.test(sql)) return 'user';
    if (/^\s*UPDATE users/.test(sql)) return 'market';
    if (/^\s*INSERT INTO subscriptions/.test(sql)) return 'subscription';
    if (/^\s*INSERT INTO email_verification_tokens/.test(sql)) return 'verification';
    if (/^\s*INSERT INTO refresh_tokens/.test(sql)) return 'session';
    if (/^\s*INSERT INTO audit_logs/.test(sql)) return 'audit';
    return null;
  };
  const db = {
    query: (sql, values) => pool.query(sql, values),
    async transaction(operation) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN'); events.push('begin');
        const result = await operation({ async query(sql, values) {
          // A genuine PostgreSQL error marks the transaction aborted, rather
          // than relying only on a JavaScript rejection to test rollback.
          if (failAt && stageFor(sql) === failAt) await client.query('SELECT 1 / 0');
          return client.query(sql, values);
        } });
        if (failAt === 'commit') await client.query('SELECT 1 / 0');
        await client.query('COMMIT'); events.push('commit'); return result;
      } catch (error) { await client.query('ROLLBACK'); events.push('rollback'); throw error; }
      finally { client.release(); }
    },
  };
  const route = registrationRoute(db, events);
  const signup = overrides => { const body = payload(overrides); emails.push(body.email); return body; };
  const users = async email => (await pool.query('SELECT * FROM users WHERE email=$1', [email])).rows;
  const assertComplete = async (body, count = 1) => {
    const rows = await users(body.email);
    assert.equal(rows.length, count);
    for (const user of rows) {
      const market = String(body.country).toUpperCase() === 'NG' ? 'NG' : 'US';
      assert.equal(user.market_scope, market);
      assert.equal(user.region, market);
      for (const table of ['subscriptions', 'email_verification_tokens', 'refresh_tokens', 'audit_logs']) {
        assert.equal(Number((await pool.query(`SELECT count(*) AS n FROM ${table} WHERE user_id=$1`, [user.id])).rows[0].n), 1);
      }
    }
  };
  try {
    for (const stage of ['user', 'market', 'subscription', 'verification', 'session', 'audit', 'commit']) {
      const body = signup();
      failAt = stage; events.length = 0;
      const denied = await route.call(body);
      assert.equal(denied.statusCode, 500);
      assert.equal((await users(body.email)).length, 0);
      assert.equal(denied.cookies.length, 0);
      assert.equal(events.includes('notification'), false);
      failAt = null;
      assert.equal((await route.call(body)).statusCode, 201);
      await assertComplete(body);
    }
    for (const country of ['US', 'NG']) for (const role of ['patient', 'provider', 'pharmacy']) {
      const body = signup({ country, role });
      assert.equal((await route.call(body)).statusCode, 201);
      await assertComplete(body);
    }
    const body = signup();
    const raced = await Promise.all([route.call(body), route.call(body)]);
    assert.deepEqual(raced.map(result => result.statusCode).sort(), [201, 409]);
    await assertComplete(body);
    assert.equal((await route.call({ ...body, role: 'provider' })).statusCode, 201);
    await assertComplete(body, 2);
  } finally {
    try {
      await pool.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email=ANY($1::text[]))', [emails]);
      await pool.query('DELETE FROM users WHERE email=ANY($1::text[])', [emails]);
    } finally { await pool.end(); }
  }
});
