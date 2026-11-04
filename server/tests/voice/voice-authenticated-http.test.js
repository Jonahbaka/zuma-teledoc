'use strict';
// Real JWT verification, authenticate middleware, current-session policy,
// HTTP voice routes and broker. Database/membership/provider I/O and the
// synthetic authorization-policy callback are doubles. The PostgreSQL session
// snapshot adapter itself is real; its query execution remains fictional.
// Install doubles BEFORE loading auth so no real DB module or dotenv is loaded.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const signingKey = crypto.randomBytes(48).toString('hex');
let currentDb = null;
const overriddenModules = [];
function installDouble(relative, value) {
  const file = require.resolve(relative); const previous = require.cache[file];
  const replacement = new Module(file); replacement.filename = file; replacement.loaded = true; replacement.exports = value;
  require.cache[file] = replacement; overriddenModules.push({ file, previous });
}
installDouble('../../db', { query: (...args) => { if (!currentDb) throw new Error('No fictional database fixture is active.'); return currentDb.query(...args); } });
installDouble('../../services/consumerMembershipService', { readAuthority: async () => ({ accessLevel: 'read_only', financialAccessAvailable: false, paymentVerified: false }) });
installDouble('../../middleware/logger', { error() {}, warn() {}, info() {} });
// This ephemeral test key is never written, printed or sent to a provider.
const previousKey = process.env.JWT_ACCESS_SECRET;
process.env.JWT_ACCESS_SECRET = signingKey;
const { authenticate } = require('../../middleware/auth');
if (previousKey === undefined) delete process.env.JWT_ACCESS_SECRET; else process.env.JWT_ACCESS_SECRET = previousKey;
const { createVoiceLiveRouter } = require('../../routes/voiceLive');
const { createLiveVoiceBroker } = require('../../services/voice/liveVoiceBroker');
const { createVoiceSessionAuthority } = require('../../services/voice/voiceSessionAuthority');
const { createPostgresVoiceSessionReader, SNAPSHOT_SQL, QUERY_TIMEOUT_MS } = require('../../services/voice/postgresVoiceSessionReader');
test.after(() => { for (const { file, previous } of overriddenModules) { if (previous) require.cache[file] = previous; else delete require.cache[file]; } });

async function fixture(t, { production = false } = {}) {
  const users = new Map(), activeFamilies = new Set(), reads = [], providerCalls = [], policyCalls = [];
  let terminationObserver = null; const sessionBindings = [];
  function addUser(extra = {}) {
    const user = { id: crypto.randomUUID(), email: 'fictional-evaluator@example.invalid', role: 'provider', is_active: true, account_status: 'active',
      provider_status: 'approved', credential_version: 1, must_change_password: false, ...extra };
    const family = crypto.randomUUID(); users.set(user.id, user); activeFamilies.add(`${user.id}:${family}`);
    return { user, family };
  }
  const owner = addUser(), other = addUser();
  currentDb = { async query(sql, params) {
    if (typeof sql === 'object' && sql.text === SNAPSHOT_SQL) {
      reads.push('voice_session_snapshot'); assert.equal(sql.query_timeout, QUERY_TIMEOUT_MS); assert.equal(sql.values.length, 2);
      const [userId, familyId] = sql.values, user = users.get(userId), at = Date.now();
      if (!user) return { rows: [] };
      const active = activeFamilies.has(`${userId}:${familyId}`);
      return { rows: [{ id: user.id, role: user.role, is_active: user.is_active, account_status: user.account_status, provider_status: user.provider_status,
        must_change_password: user.must_change_password, credential_version: user.credential_version,
        family_id: active ? familyId : null, family_user_id: active ? userId : null,
        family_expires_at_ms: active ? String(at + 3600000) : null, observed_at_ms: String(at) }] };
    }
    const normalized = sql.replace(/\s+/g, ' ').trim();
    if (normalized.startsWith('SELECT id, email, role,') && normalized.includes('FROM users WHERE id = $1')) {
      reads.push('current_user'); assert.equal(params.length, 1); const user = users.get(params[0]); return { rows: user ? [{ ...user }] : [] };
    }
    if (normalized === 'SELECT id FROM refresh_tokens WHERE user_id=$1 AND family_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() LIMIT 1') {
      reads.push('current_session_family'); assert.equal(params.length, 2);
      return { rows: activeFamilies.has(`${params[0]}:${params[1]}`) ? [{ id: 'fictional-token-row' }] : [] };
    }
    throw new Error('Unexpected statement in read-only fictional authority database.');
  } };
  const assertSession = createVoiceSessionAuthority({ readSessionSnapshot: createPostgresVoiceSessionReader({ pool: currentDb }) });
  const broker = createLiveVoiceBroker({ assertSession: async actor => { sessionBindings.push(actor.voiceAuth); await assertSession(actor); }, env: { NODE_ENV: production ? 'production' : 'test', DOCTARX_VOICE_LIVE_PROTOTYPE_ENABLED: 'true' },
    async authorize({ actor, language, context }) {
      policyCalls.push({ id: actor.id, role: actor.role, language });
      return { actorId: actor.id, language, dataClass: 'synthetic', observedAt: Date.now(), validUntil: Date.now() + 180000, consentActive: true, providerApproved: true, consentVersion: context.consentVersion };
    },
    provider: {
      async connect(input) { providerCalls.push({ action: 'connect', language: input.language }); return { providerSessionId: 'fictional-provider-session', sdp: 'v=0\r\nfictional-answer', sideband: { close() {} } }; },
      async terminate() { providerCalls.push({ action: 'terminate' }); if (terminationObserver) { const observed = terminationObserver; terminationObserver = null; observed(); } return { finalUsageConfirmed: false }; },
    } });
  const app = express(); app.use(cookieParser()); app.use(express.json({ limit: '70kb' }));
  app.use('/api/voice-live', createVoiceLiveRouter({ authenticate, broker }));
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  function token(account = owner, claims = {}, options = {}) {
    return jwt.sign({ userId: account.user.id, role: account.user.role, sessionId: account.family, sessionVersion: 1, ...claims }, signingKey, { expiresIn: '5m', ...options });
  }
  async function request(route, body, { accessToken = token(), cookie = false } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (accessToken) headers[cookie ? 'Cookie' : 'Authorization'] = cookie ? `accessToken=${accessToken}` : `Bearer ${accessToken}`;
    const response = await fetch(`${origin}/api/voice-live${route}`, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json(); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(JSON.stringify(data).includes(signingKey), false);
    return { status: response.status, data };
  }
  const reserve = (extra, options) => request('/permits', { language: 'ha', consentVersion: 'voice-live-synthetic-v1', ...extra }, options);
  t.after(async () => { await broker.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); currentDb = null; });
  return { users, activeFamilies, reads, providerCalls, policyCalls, sessionBindings, owner, other, token, request, reserve, close: () => broker.close(),
    nextTermination: () => new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('Expected background termination did not occur.')), 6500); terminationObserver = () => { clearTimeout(timeout); resolve(); }; }) };
}

test('real JWT verifier rejects missing, malformed, forged and expired credentials before DB reads', async t => {
  const f = await fixture(t);
  const forged = jwt.sign({ userId: f.owner.user.id }, crypto.randomBytes(48).toString('hex'), { expiresIn: '5m' });
  for (const accessToken of [null, 'not-a-token', forged, f.token(f.owner, {}, { expiresIn: -1 })]) {
    assert.equal((await f.reserve({}, { accessToken })).status, 401);
  }
  assert.deepEqual(f.reads, []); assert.deepEqual(f.policyCalls, []); assert.deepEqual(f.providerCalls, []);
});
for (const language of ['ha', 'ig', 'yo']) test(`${language}: actual JWT and current session authorize a fictional HTTP permit`, async t => {
  const f = await fixture(t); const result = await f.reserve({ language });
  assert.equal(result.status, 200); assert.equal(result.data.language, language); assert.equal(result.data.dataClass, 'synthetic');
  assert.deepEqual(f.reads, ['current_user', 'current_session_family', 'voice_session_snapshot', 'voice_session_snapshot']); assert.equal(f.policyCalls.length, 1); assert.deepEqual(f.providerCalls, []);
  assert.equal((await f.request(`/permits/${result.data.permitId}/stop`, {})).data.providerCleanupConfirmed, true);
});
test('cookie access token uses the same actual signature and current-session checks', async t => {
  const f = await fixture(t); assert.equal((await f.reserve({}, { cookie: true })).status, 200);
  f.activeFamilies.clear(); assert.equal((await f.reserve({}, { cookie: true })).status, 401); assert.equal(f.policyCalls.length, 1);
});
test('token role and body actor claims cannot override the current database identity', async t => {
  const f = await fixture(t); f.owner.user.role = 'patient';
  assert.equal((await f.reserve({}, { accessToken: f.token(f.owner, { role: 'super_admin' }) })).status, 403);
  assert.deepEqual(f.policyCalls, []); f.owner.user.role = 'provider';
  assert.equal((await f.reserve({ actorId: f.other.user.id })).status, 400); assert.deepEqual(f.policyCalls, []);
});
test('credential epoch change rejects an existing token before voice connect and lease', async t => {
  const f = await fixture(t); const reserved = await f.reserve(), id = reserved.data.permitId; f.owner.user.credential_version = 2;
  assert.equal((await f.request(`/permits/${id}/connect`, { sdp: 'v=0\r\nfictional-offer' })).status, 401);
  assert.equal((await f.request(`/permits/${id}/lease`, {})).status, 401); assert.deepEqual(f.providerCalls, []);
});
test('refresh-family revocation rejects an existing token before provider creation', async t => {
  const f = await fixture(t); const reserved = await f.reserve(); f.activeFamilies.delete(`${f.owner.user.id}:${f.owner.family}`);
  assert.equal((await f.request(`/permits/${reserved.data.permitId}/connect`, { sdp: 'v=0\r\nfictional-offer' })).status, 401);
  assert.equal((await f.reserve()).status, 401); assert.equal(f.policyCalls.length, 1); assert.deepEqual(f.providerCalls, []);
});
test('inactive, unapproved and forced-password-change providers cannot reach voice policy', async t => {
  const f = await fixture(t);
  f.owner.user.is_active = false; assert.equal((await f.reserve()).status, 403);
  f.owner.user.is_active = true; f.owner.user.provider_status = 'pending'; assert.equal((await f.reserve()).status, 403);
  f.owner.user.provider_status = 'approved'; f.owner.user.must_change_password = true;
  const result = await f.reserve(); assert.equal(result.status, 403); assert.equal(result.data.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.deepEqual(f.policyCalls, []); assert.deepEqual(f.providerCalls, []);
});
test('current-role removal forbids reserve/connect/lease but preserves authenticated owner cleanup', async t => {
  const f = await fixture(t); const reserved = await f.reserve(), id = reserved.data.permitId;
  const oldToken = f.token(); f.owner.user.role = 'patient'; const options = { accessToken: oldToken };
  assert.equal((await f.reserve({}, options)).status, 403);
  assert.equal((await f.request(`/permits/${id}/connect`, { sdp: 'v=0\r\nfictional-offer' }, options)).status, 403);
  assert.equal((await f.request(`/permits/${id}/lease`, {}, options)).status, 403);
  assert.equal((await f.request(`/permits/${id}/stop`, {}, { accessToken: f.token(f.other) })).status, 404);
  const stopped = await f.request(`/permits/${id}/stop`, {}, options); assert.equal(stopped.status, 200); assert.equal(stopped.data.providerCleanupConfirmed, true);
  assert.equal((await f.request(`/permits/${id}/stop`, {}, options)).status, 200); assert.deepEqual(f.providerCalls, []);
});
test('real authenticated actors remain isolated across connect, lease and terminal receipts', async t => {
  const f = await fixture(t); const reserved = await f.reserve(), id = reserved.data.permitId, other = { accessToken: f.token(f.other) };
  for (const [route, body] of [['connect', { sdp: 'v=0\r\nfictional-offer' }], ['lease', {}], ['stop', {}]]) assert.equal((await f.request(`/permits/${id}/${route}`, body, other)).status, 404);
  assert.deepEqual(f.providerCalls, []);
  assert.equal((await f.request(`/permits/${id}/connect`, { sdp: 'v=0\r\nfictional-offer' })).status, 200);
  assert.equal((await f.request(`/permits/${id}/lease`, {})).status, 200);
  assert.equal((await f.request(`/permits/${id}/stop`, {})).data.providerCleanupConfirmed, true);
  assert.equal((await f.request(`/permits/${id}/stop`, {}, other)).status, 404);
  assert.deepEqual(f.providerCalls.map(item => item.action), ['connect', 'terminate']);
});
test('missing user and malformed session family fail before voice policy', async t => {
  const f = await fixture(t);
  assert.equal((await f.reserve({}, { accessToken: f.token(f.owner, { userId: crypto.randomUUID() }) })).status, 401);
  assert.equal((await f.reserve({}, { accessToken: f.token(f.owner, { sessionId: 'not-a-family-uuid' }) })).status, 401);
  assert.ok(!f.reads.includes('current_session_family')); assert.deepEqual(f.policyCalls, []); assert.deepEqual(f.providerCalls, []);
});
test('production remains disabled after successful actual authentication, even with provider fixtures and flag', async t => {
  const f = await fixture(t, { production: true }); const capabilities = await f.request('/capabilities');
  assert.equal(capabilities.status, 200); assert.equal(capabilities.data.capabilities.enabled, false);
  assert.equal((await f.reserve()).status, 503); assert.deepEqual(f.policyCalls, []); assert.deepEqual(f.providerCalls, []);
});


test('active-family revocation denies HTTP and independently terminates through the bound background checker', { timeout: 10000 }, async t => {
  const f = await fixture(t); const reserved = await f.reserve(), id = reserved.data.permitId;
  assert.equal((await f.request(`/permits/${id}/connect`, { sdp: 'v=0\r\nfictional-offer' })).status, 200);
  const terminated = f.nextTermination(); f.activeFamilies.clear();
  assert.equal((await f.request(`/permits/${id}/lease`, {})).status, 401);
  assert.equal((await f.request(`/permits/${id}/stop`, {})).status, 401);
  await terminated;
  assert.deepEqual(f.providerCalls.map(item => item.action), ['connect', 'terminate']);
  await f.close(); assert.deepEqual(f.providerCalls.map(item => item.action), ['connect', 'terminate']);
});


test('voice rejects legacy unbound tokens without changing general authentication compatibility', async t => {
  const f = await fixture(t);
  for (const claims of [{ sessionId: undefined }, { sessionVersion: undefined }, { exp: undefined }]) {
    if (claims.sessionVersion === undefined && Object.hasOwn(claims, 'sessionVersion')) f.owner.user.credential_version = 0;
    const payload = { userId: f.owner.user.id, role: 'provider', sessionId: f.owner.family, sessionVersion: f.owner.user.credential_version, exp: Math.floor(Date.now() / 1000) + 300, ...claims };
    for (const key of Object.keys(payload)) if (payload[key] === undefined) delete payload[key];
    const accessToken = jwt.sign(payload, signingKey);
    assert.equal((await f.request('/capabilities', undefined, { accessToken })).status, 200);
    assert.equal((await f.reserve({}, { accessToken })).status, 401);
  }
  assert.deepEqual(f.providerCalls, []);
});

test('verified metadata is frozen and another session family cannot resume an old permit', async t => {
  const f = await fixture(t); const reserved = await f.reserve();
  assert.ok(f.sessionBindings.every(binding => Object.isFrozen(binding)));
  assert.equal(f.sessionBindings[0].familyId, f.owner.family); assert.equal(f.sessionBindings[0].credentialVersion, 1);
  const newFamily = crypto.randomUUID(); f.activeFamilies.add(`${f.owner.user.id}:${newFamily}`);
  const accessToken = f.token(f.owner, { sessionId: newFamily });
  assert.equal((await f.request(`/permits/${reserved.data.permitId}/connect`, { sdp: 'v=0\r\nfictional-offer' }, { accessToken })).status, 404);
  assert.equal((await f.request(`/permits/${reserved.data.permitId}/stop`, {}, { accessToken })).status, 200);
  assert.deepEqual(f.providerCalls, []);
});

test('credential epoch revocation during an active session triggers independent server termination', { timeout: 10000 }, async t => {
  const f = await fixture(t); const reserved = await f.reserve(), id = reserved.data.permitId;
  await f.request(`/permits/${id}/connect`, { sdp: 'v=0\r\nfictional-offer' });
  const terminated = f.nextTermination(); f.owner.user.credential_version = 2;
  assert.equal((await f.request(`/permits/${id}/stop`, {})).status, 401);
  await terminated; assert.deepEqual(f.providerCalls.map(item => item.action), ['connect', 'terminate']);
});

test('original verified token expiry bounds the permit and independently ends active provider use', { timeout: 10000 }, async t => {
  const f = await fixture(t), options = { accessToken: f.token(f.owner, {}, { expiresIn: 2 }) };
  const reserved = await f.reserve({}, options), id = reserved.data.permitId;
  assert.equal(reserved.status, 200); assert.equal(reserved.data.expiresAt, jwt.decode(options.accessToken).exp * 1000);
  await f.request(`/permits/${id}/connect`, { sdp: 'v=0\r\nfictional-offer' }, options);
  const terminated = f.nextTermination(); await terminated; assert.deepEqual(f.providerCalls.map(item => item.action), ['connect', 'terminate']);
});

test('independent account suspension stops an active provider session without changing generic authentication', { timeout: 10000 }, async t => {
  const f = await fixture(t); const reserved = await f.reserve(), id = reserved.data.permitId;
  assert.equal((await f.request(`/permits/${id}/connect`, { sdp: 'v=0\r\nfictional-offer' })).status, 200);
  const terminated = f.nextTermination(); f.owner.user.account_status = 'suspended';
  await terminated; assert.deepEqual(f.providerCalls.map(item => item.action), ['connect', 'terminate']);
  assert.equal((await f.reserve()).status, 401);
  assert.equal((await f.request(`/permits/${id}/stop`, {})).status, 200);
});
