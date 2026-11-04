'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createPostgresVoiceSessionReader } = require('../../services/voice/postgresVoiceSessionReader');
const { createVoiceSessionAuthority } = require('../../services/voice/voiceSessionAuthority');
// Explicit opt-in only. Do not load application DB/dotenv or contact any target
// while discovering this test. The existing authorized CI may supply a local,
// disposable test database; no target or credentials are provisioned here.
const optedIn = process.env.DOCTARX_VOICE_DB_TEST === 'true';
test('PostgreSQL executes the minimal authority statement against disposable temporary tables', { skip: !optedIn }, async () => {
  const target = process.env.SIMULATION_DATABASE_URL;
  assert.ok(target, 'An explicitly approved disposable test target is required');
  const url = new URL(target);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol) && ['127.0.0.1', 'localhost'].includes(url.hostname)
    && /^\/[a-zA-Z0-9_]+_test$/.test(url.pathname) && !url.search && !url.hash,
  'Only an explicit loopback _test database without URL options is permitted');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: target, max: 1, connectionTimeoutMillis: 1000 });
  let client;
  try {
    client = await pool.connect(); await client.query('BEGIN');
    // Unqualified reads resolve these connection-local tables, never real user
    // rows. No migration, production schema or application account is changed.
    await client.query(`CREATE TEMP TABLE users (
      id uuid PRIMARY KEY, role text NOT NULL, is_active boolean NOT NULL, account_status text,
      provider_status text, must_change_password boolean NOT NULL, credential_version integer NOT NULL
    ) ON COMMIT DROP`);
    await client.query(`CREATE TEMP TABLE refresh_tokens (
      id uuid PRIMARY KEY, user_id uuid NOT NULL, family_id uuid NOT NULL,
      revoked_at timestamptz, expires_at timestamptz NOT NULL
    ) ON COMMIT DROP`);
    const userId = crypto.randomUUID(), familyId = crypto.randomUUID(), otherId = crypto.randomUUID();
    await client.query("INSERT INTO users VALUES ($1,'provider',TRUE,'active','approved',FALSE,2)", [userId]);
    await client.query("INSERT INTO refresh_tokens VALUES ($1,$2,$3,NULL,clock_timestamp()+INTERVAL '1 hour')", [crypto.randomUUID(), userId, familyId]);
    const reader = createPostgresVoiceSessionReader({ pool: client });
    const authority = createVoiceSessionAuthority({ readSessionSnapshot: reader });
    const actor = { id: userId, role: 'provider', voiceAuth: { userId, familyId, credentialVersion: 2, expiresAt: Date.now() + 60000 } };
    await authority(actor);
    for (const status of ['suspended', 'revoked', 'inactive', 'deleted', 'unknown', null]) {
      await client.query('UPDATE users SET account_status=$2 WHERE id=$1', [userId, status]);
      await assert.rejects(authority(actor), { code: 'VOICE_SESSION_REVOKED' });
    }
    await client.query("UPDATE users SET account_status='active' WHERE id=$1", [userId]);
    // A consumed predecessor must not invalidate its unrevoked successor.
    await client.query('UPDATE refresh_tokens SET revoked_at=clock_timestamp() WHERE user_id=$1', [userId]);
    await client.query("INSERT INTO refresh_tokens VALUES ($1,$2,$3,NULL,clock_timestamp()+INTERVAL '2 hours')", [crypto.randomUUID(), userId, familyId]);
    await authority(actor);
    await client.query('UPDATE refresh_tokens SET revoked_at=clock_timestamp() WHERE user_id=$1', [userId]);
    await assert.rejects(authority(actor), { code: 'VOICE_SESSION_REVOKED' });
    // Another user's row in the same claimed family cannot authorize this user.
    await client.query("INSERT INTO refresh_tokens VALUES ($1,$2,$3,NULL,clock_timestamp()+INTERVAL '1 hour')", [crypto.randomUUID(), otherId, familyId]);
    await assert.rejects(authority(actor), { code: 'VOICE_SESSION_REVOKED' });
    await client.query('UPDATE refresh_tokens SET revoked_at=NULL, expires_at=clock_timestamp()-INTERVAL \'1 second\' WHERE user_id=$1', [userId]);
    await assert.rejects(authority(actor), { code: 'VOICE_SESSION_REVOKED' });
    await client.query("UPDATE refresh_tokens SET expires_at=clock_timestamp()+INTERVAL '1 hour' WHERE user_id=$1", [userId]);
    await client.query('UPDATE users SET credential_version=3 WHERE id=$1', [userId]);
    await assert.rejects(authority(actor), { code: 'VOICE_SESSION_REVOKED' });
    await client.query("UPDATE users SET credential_version=2, role='Administrator' WHERE id=$1", [userId]);
    assert.equal((await reader({ userId, familyId })).principal.role, 'admin');
    await assert.rejects(authority(actor), { code: 'VOICE_SESSION_REVOKED' });
  } finally {
    if (client) { try { await client.query('ROLLBACK'); } finally { client.release(); } }
    await pool.end();
  }
});
