'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { createPostgresVoiceSessionReader, SNAPSHOT_SQL, QUERY_TIMEOUT_MS } = require('../../services/voice/postgresVoiceSessionReader');
const { createVoiceSessionAuthority } = require('../../services/voice/voiceSessionAuthority');
function fixture() {
  let at = 10000; const id = crypto.randomUUID(), family = crypto.randomUUID(); const calls = [];
  const row = { id, role: 'provider', is_active: true, account_status: 'active', provider_status: 'approved', must_change_password: false, credential_version: 2,
    family_id: family, family_user_id: id, family_expires_at_ms: '100000', observed_at_ms: '10000' };
  let result = { rows: [row] };
  const pool = { async query(config) { calls.push(config); return result; } };
  const input = { userId: id, familyId: family };
  const reader = createPostgresVoiceSessionReader({ pool, now: () => at });
  const actor = { id, role: 'provider', voiceAuth: { userId: id, familyId: family, credentialVersion: 2, expiresAt: 100000 } };
  return { row, calls, pool, input, reader, actor, now: () => at, advance: ms => { at += ms; }, setResult: value => { result = value; },
    authority: createVoiceSessionAuthority({ readSessionSnapshot: reader, now: () => at }) };
}
const denied = error => error.code === 'VOICE_SESSION_SNAPSHOT_UNAVAILABLE';
test('reader requires an injected query source and never imports a connection or credential', () => {
  assert.throws(() => createPostgresVoiceSessionReader(), denied);
  const source = fs.readFileSync(require.resolve('../../services/voice/postgresVoiceSessionReader'), 'utf8');
  assert.doesNotMatch(source, /require\(['"](?:pg|\.\.\/\.\.\/db)|process\.env|new Pool|password_hash|token_hash/);
  assert.doesNotMatch(fs.readFileSync(require.resolve('../../routes/voiceLive'), 'utf8'), /createPostgresVoiceSessionReader/);
});
test('single parameterized consistent read returns only immutable authority metadata', async () => {
  const f = fixture(); f.row.secret_extra = 'never forward'; const snapshot = await f.reader(f.input);
  assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0], { text: SNAPSHOT_SQL, values: [f.input.userId, f.input.familyId], query_timeout: QUERY_TIMEOUT_MS });
  assert.match(SNAPSHOT_SQL, /LEFT JOIN LATERAL/); assert.match(SNAPSHOT_SQL, /statement_timestamp\(\)/);
  assert.match(SNAPSHOT_SQL, /r\.user_id = u\.id AND r\.family_id = \$2::uuid/);
  assert.match(SNAPSHOT_SQL, /r\.revoked_at IS NULL AND r\.expires_at > clock_timestamp\(\)/);
  assert.match(SNAPSHOT_SQL, /MAX\(r\.expires_at\)/); assert.doesNotMatch(SNAPSHOT_SQL, /\b(?:INSERT|UPDATE|DELETE|ALTER|SELECT \*)\b/i);
  assert.deepEqual(Object.keys(snapshot), ['observedAt', 'principal', 'family']);
  assert.equal(snapshot.principal.credentialVersion, 2); assert.equal(snapshot.family.expiresAt, 100000);
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.principal) && Object.isFrozen(snapshot.family));
  assert.doesNotMatch(JSON.stringify(snapshot), /secret_extra|never forward/); await f.authority(f.actor); assert.equal(f.calls.length, 2);
});
test('invalid identifiers never reach PostgreSQL', async () => {
  const f = fixture();
  for (const input of [undefined, {}, { ...f.input, userId: 'not-uuid' }, { ...f.input, familyId: "x' OR 1=1" }]) await assert.rejects(f.reader(input), denied);
  assert.equal(f.calls.length, 0);
});
test('missing, multiple and malformed rows fail closed', async () => {
  for (const result of [undefined, {}, { rows: [] }, { rows: [null] }, { rows: [{}, {}] }, { rows: [Object.create(null)] }]) {
    const f = fixture(); f.setResult(result); await assert.rejects(f.reader(f.input), denied);
  }
});
test('cross-owner or wrong family results cannot be substituted', async () => {
  for (const patch of [{ id: crypto.randomUUID() }, { family_id: crypto.randomUUID() }, { family_user_id: crypto.randomUUID() }]) {
    const f = fixture(); Object.assign(f.row, patch); await assert.rejects(f.reader(f.input), denied);
  }
});
test('no active family maps only to inactive authority, not legacy acceptance', async () => {
  const f = fixture(); Object.assign(f.row, { family_id: null, family_user_id: null, family_expires_at_ms: null });
  assert.deepEqual((await f.reader(f.input)).family, { id: f.input.familyId, userId: f.input.userId, active: false, expiresAt: 0 });
  await assert.rejects(f.authority(f.actor), { code: 'VOICE_SESSION_REVOKED' });
  f.row.family_user_id = f.input.userId; await assert.rejects(f.reader(f.input), denied);
});
test('credential epoch and millisecond integers reject coercions and unsafe values', async () => {
  for (const field of ['credential_version', 'observed_at_ms', 'family_expires_at_ms']) for (const value of [null, undefined, '', false, -1, 1.5, Infinity, NaN, '1e4', '01', ' 10000', '9007199254740992']) {
    const f = fixture(); f.row[field] = value; await assert.rejects(f.reader(f.input), denied);
  }
});
test('strict booleans do not promote malformed active/password states', async () => {
  for (const field of ['is_active', 'must_change_password']) for (const value of [null, undefined, 0, 1, 'false', 'true']) {
    const f = fixture(); f.row[field] = value; await assert.rejects(f.reader(f.input), denied);
  }
});
test('canonical role aliases match authentication without importing authentication secrets', async () => {
  for (const [raw, expected] of [[' Provider ', 'provider'], ['Administrator', 'admin'], ['superadmin', 'super_admin'], ['super-admin', 'super_admin'], ['SUPER_ADMIN', 'super_admin'], ['patient', 'patient'], ['__proto__', '__proto__']]) {
    const f = fixture(); f.row.role = raw; assert.equal((await f.reader(f.input)).principal.role, expected);
    f.actor.role = expected;
    if (['provider', 'admin', 'super_admin'].includes(expected)) await f.authority(f.actor);
    else await assert.rejects(f.authority(f.actor), { code: 'VOICE_SESSION_AUTHORITY_REQUIRED' });
  }
});
test('account, epoch, approval and role changes are reread and revoke authority', async () => {
  for (const patch of [{ is_active: false }, { credential_version: 3 }, { role: 'patient' }, { provider_status: 'pending' }, { must_change_password: true }]) {
    const f = fixture(); await f.authority(f.actor); Object.assign(f.row, patch); await assert.rejects(f.authority(f.actor), { code: 'VOICE_SESSION_REVOKED' }); assert.equal(f.calls.length, 2);
  }
});
test('stale/future observation or expiry cannot grant authority', async () => {
  for (const value of ['8999', '10051']) { const f = fixture(); f.row.observed_at_ms = value; await assert.rejects(f.reader(f.input), denied); }
  const f = fixture(); f.row.family_expires_at_ms = '10000'; assert.equal((await f.reader(f.input)).family.active, false); await assert.rejects(f.authority(f.actor), { code: 'VOICE_SESSION_REVOKED' });
});
test('slow snapshot cannot be made fresh by stamping the response on arrival', async () => {
  const f = fixture(); f.pool.query = async () => { f.advance(1001); f.row.observed_at_ms = String(f.now()); return { rows: [f.row] }; };
  await assert.rejects(f.reader(f.input), denied);
});
test('small database clock lead is clamped without extending family or session expiry', async () => {
  for (const lead of [1, 10, 50]) {
    const f = fixture(); f.row.observed_at_ms = String(f.now() + lead);
    const snapshot = await f.reader(f.input);
    assert.equal(snapshot.observedAt, f.now());
    assert.equal(snapshot.family.expiresAt, 100000);
    await f.authority(f.actor);
    f.row.family_expires_at_ms = String(f.now());
    await assert.rejects(f.authority(f.actor), { code: 'VOICE_SESSION_REVOKED' });
  }
});
test('mutation while query waits cannot change the checked owner or family', async () => {
  const f = fixture(); let finish; f.pool.query = () => new Promise(resolve => { finish = resolve; });
  const pending = f.reader(f.input); f.input.userId = crypto.randomUUID(); f.input.familyId = crypto.randomUUID(); finish({ rows: [f.row] });
  const snapshot = await pending; assert.equal(snapshot.principal.id, f.row.id); assert.equal(snapshot.family.id, f.row.family_id);
});
test('driver failure is sanitized, while upstream authority still bounds a stalled reader', async () => {
  const f = fixture(); f.pool.query = async () => { throw new Error('private query metadata'); };
  await assert.rejects(f.reader(f.input), error => denied(error) && !error.message.includes('private'));
  f.pool.query = () => new Promise(() => {}); await assert.rejects(f.authority(f.actor), { code: 'VOICE_SESSION_AUTHORITY_UNAVAILABLE' });
});

test('independent account status denies non-active and legacy-null authority', async () => {
  for (const status of ['suspended', 'revoked', 'inactive', 'deleted', 'unknown', 'ACTIVE', '', null]) {
    const f = fixture(); f.row.account_status = status;
    assert.equal((await f.reader(f.input)).principal.accountStatus, status);
    await assert.rejects(f.authority(f.actor), { code: 'VOICE_SESSION_REVOKED' });
  }
  for (const value of [undefined, false, 0, {}, 'x'.repeat(65)]) {
    const f = fixture(); f.row.account_status = value; await assert.rejects(f.reader(f.input), denied);
  }
});
