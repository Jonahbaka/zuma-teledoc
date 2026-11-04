'use strict';
// Synthetic, DB-free regression coverage. Loads the actual Express router,
// authentication/role/MFA and audit middleware with isolated dependencies.
// This is not PostgreSQL, cascade, retention-policy, or deployment proof.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const actorId = '00000000-0000-4000-8000-000000000001';
const targetId = '00000000-0000-4000-8000-000000000002';
const privateMarker = 'SYNTHETIC_PRIVATE_CLINICAL_DETAIL';
function load(relative, dependencies) {
  const filename = path.resolve(__dirname, relative), sourceModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: sourceModule, exports: sourceModule.exports, console,
    process: { env: { NODE_ENV: 'production', JWT_ACCESS_SECRET: 'synthetic-test-secret' } },
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unstubbed dependency prohibited: ${name}`);
      return dependencies[name];
    },
  }, { filename });
  return sourceModule.exports;
}
function fixture({ role = 'super_admin', auditFailure = false, active = true, mfa = false } = {}) {
  // Refuse to execute a regressed destructive path, even against stubs.
  assertRouteSourceSafe();
  const calls = [], audits = [], logs = [], actorReads = [];
  const logger = Object.fromEntries(['info', 'error', 'warn', 'audit'].map(name => [name, (...args) => logs.push([name, ...args])]));
  const forbidden = async (...args) => { calls.push(args); throw new Error('Target data access prohibited'); };
  const audit = load('../middleware/audit.js', { '../db': { async query(sql, values) {
    assert.match(sql, /^INSERT INTO audit_logs/); audits.push({ sql, values });
    if (auditFailure) throw new Error(privateMarker);
    return { rows: [] };
  } }, './logger': logger });
  const auth = load('../middleware/auth.js', {
    jsonwebtoken: { verify: () => ({ userId: actorId }) }, crypto: require('node:crypto'),
    '../db': { async query(sql, values) {
      actorReads.push({ sql, values }); assert.equal(values[0], actorId);
      assert.match(sql, /FROM users WHERE id = \$1/);
      return { rows: [{ id: actorId, role, is_active: active, mfa_enabled: mfa }] };
    } },
    '../services/authSessionService': { async assertCurrentSession() {} },
    '../services/consumerMembershipService': { async readAuthority() { return {}; } },
    '../services/testingAccessService': { getEffectiveAccessLevel() {}, getTestingBypassPayload: () => ({}) },
    './logger': logger, '../utils/mfaAttestation': { hasVerifiedMfa: () => false },
  });
  const router = load('../routes/admin.js', {
    express, bcryptjs: {}, '../db': { query: forbidden, getClient: forbidden, transaction: forbidden },
    '../middleware/logger': logger, '../middleware/auth': auth, '../middleware/audit': audit,
    '../../lib/validation': { validate: () => (req, res, next) => next() },
    '../../lib/utils': {}, '../services/notifications': {}, '../services/adminTestAccountService': {},
  });
  const app = express(); app.use(express.json()); app.use('/api/admin', router);
  return { calls, audits, logs, actorReads, async request(id, authenticated = true) {
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/users/${encodeURIComponent(id)}`, {
        method: 'DELETE', headers: { 'content-type': 'application/json', ...(authenticated ? { authorization: 'Bearer synthetic' } : {}) },
        body: JSON.stringify({ email: 'private-target@example.invalid', clinicalNote: privateMarker, patientId: targetId, isActive: false }),
      });
      return { status: response.status, body: await response.json() };
    } finally { await new Promise(resolve => server.close(resolve)); }
  } };
}
function assertNoTargetAccess(h) { assert.deepEqual(h.calls, [], 'No target read, transaction, delete, or fallback deactivation'); }
function assertPrivate(h, response) {
  const observable = JSON.stringify([h.audits, h.logs, response]);
  assert.ok(!observable.includes(privateMarker));
  assert.ok(!observable.includes('private-target@example.invalid'));
}
for (const [label, options, authenticated, status] of [
  ['unauthenticated', {}, false, 401], ['ordinary admin', { role: 'admin' }, true, 403],
  ['patient', { role: 'patient' }, true, 403], ['inactive super admin', { active: false }, true, 403],
  ['unverified MFA', { mfa: true }, true, 403],
]) test(`${label} is rejected by actual middleware before deletion intent`, async () => {
  const h = fixture(options), result = await h.request(targetId, authenticated);
  assert.equal(result.status, status); assert.equal(result.body.success, false);
  assert.equal(h.audits.length, 0); assertNoTargetAccess(h);
  if (!authenticated) assert.equal(h.actorReads.length, 0);
});
for (const [label, id] of [ ['valid', targetId], ['nonexistent', '00000000-0000-4000-8000-999999999999'],
  ['malformed', 'not-a-uuid'], ['SQL-like', "x'; DELETE FROM users; --"] ]) {
  test(`super admin gets uniform refusal for ${label} target without lookup`, async () => {
    const h = fixture(), result = await h.request(id);
    assert.equal(result.status, 409); assert.equal(result.body.success, false);
    assert.equal(result.body.code, 'USER_DELETION_UNAVAILABLE');
    assert.match(result.body.error, /clinical history/i); assert.match(result.body.error, /deactivat/i);
    assertNoTargetAccess(h); assertPrivate(h, result);
    assert.equal(h.audits.length, 1);
    const values = h.audits[0].values;
    assert.equal(values[0], actorId); assert.equal(values[1], 'delete'); assert.equal(values[2], 'user');
    assert.equal(values[3], ['valid', 'nonexistent'].includes(label) ? id : undefined);
    assert.equal(values[7], null); assert.equal(values[8], null); assert.equal(values[9], false);
    assert.equal(values[10], undefined); assert.equal(values[11], false);
    assert.equal(values[12], 'Request failed with status 409');
  });
}
test('self deletion retains existing 400 guard and failed metadata-only audit', async () => {
  const h = fixture(), result = await h.request(actorId);
  assert.equal(result.status, 400); assert.equal(result.body.error, 'Cannot delete your own account');
  assert.equal(h.audits[0].values[11], false); assertNoTargetAccess(h); assertPrivate(h, result);
});
test('audit outage cannot cause deletion, target lookup, deactivation, or success', async () => {
  const h = fixture({ auditFailure: true }), result = await h.request(targetId);
  assert.equal(result.status, 409); assert.equal(result.body.code, 'USER_DELETION_UNAVAILABLE');
  assert.equal(result.body.success, false); assert.equal(h.audits.length, 1);
  assertNoTargetAccess(h); assertPrivate(h, result);
});
function assertRouteSourceSafe() {
  const source = fs.readFileSync(path.resolve(__dirname, '../routes/admin.js'), 'utf8');
  const route = source.slice(source.indexOf("router.delete('/users/:id'"), source.indexOf(' * POST /api/admin/test-email'));
  assert.doesNotMatch(route, /db\.(query|getClient|transaction)|DELETE FROM|UPDATE users/);
  assert.match(route, /metadataOnly: true/);
}
test('source safety gate prohibits a destructive route before execution', assertRouteSourceSafe);
