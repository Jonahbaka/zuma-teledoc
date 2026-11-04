'use strict';

// No database import, environment access or connection creation. An approved
// composition must inject a PostgreSQL Pool-compatible query implementation.
const QUERY_TIMEOUT_MS = 750;
const MAX_OBSERVATION_AGE_MS = 1000;
// PostgreSQL and Node can round the same host clock differently (observed on
// Windows). Clamp this small lead to receipt time; never extend a permit/expiry.
const MAX_CLOCK_LEAD_MS = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = () => { throw Object.assign(new Error('Current voice session state could not be read.'), { code: 'VOICE_SESSION_SNAPSHOT_UNAVAILABLE', statusCode: 503 }); };
const aliases = Object.freeze({ administrator: 'admin', superadmin: 'super_admin', 'super-admin': 'super_admin' });
const canonicalRole = value => {
  if (typeof value !== 'string' || value.length > 64) fail();
  const role = value.trim().toLowerCase();
  return Object.hasOwn(aliases, role) ? aliases[role] : role;
};
const integer = value => {
  // PostgreSQL int8 is normally a decimal string. Never accept coercions such
  // as null, empty strings, floats, scientific notation or unsafe integers.
  if (typeof value === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(value)) value = Number(value);
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
};
// A single statement gives principal and family one PostgreSQL MVCC snapshot.
// No token hash, password, contact details or clinical records are selected.
// Family validity matches assertCurrentSession: any unrevoked, unexpired row
// for this exact user/family. Rotation can consume one row and create another.
const SNAPSHOT_SQL = `SELECT
  u.id, u.role, u.is_active, u.account_status, u.provider_status, u.must_change_password, u.credential_version,
  f.family_id, f.user_id AS family_user_id,
  FLOOR(EXTRACT(EPOCH FROM f.expires_at) * 1000)::bigint AS family_expires_at_ms,
  FLOOR(EXTRACT(EPOCH FROM statement_timestamp()) * 1000)::bigint AS observed_at_ms
FROM users u
LEFT JOIN LATERAL (
  SELECT r.user_id, r.family_id, MAX(r.expires_at) AS expires_at
  FROM refresh_tokens r
  WHERE r.user_id = u.id AND r.family_id = $2::uuid
    AND r.revoked_at IS NULL AND r.expires_at > clock_timestamp()
  GROUP BY r.user_id, r.family_id
) f ON TRUE
WHERE u.id = $1::uuid`;
function createPostgresVoiceSessionReader({ pool, now = Date.now } = {}) {
  if (typeof pool?.query !== 'function' || typeof now !== 'function') fail();
  return async function readSessionSnapshot({ userId, familyId } = {}) {
    if (typeof userId !== 'string' || !UUID.test(userId) || typeof familyId !== 'string' || !UUID.test(familyId)) fail();
    // Capture values before awaiting. The caller cannot redirect the query or
    // the matching checks by mutating its input object during I/O.
    const expectedUser = userId, expectedFamily = familyId, startedAt = now();
    if (!Number.isSafeInteger(startedAt)) fail();
    let result;
    try { result = await pool.query({ text: SNAPSHOT_SQL, values: [expectedUser, expectedFamily], query_timeout: QUERY_TIMEOUT_MS }); }
    catch { fail(); }
    const at = now();
    if (!Number.isSafeInteger(at) || at < startedAt || at - startedAt > MAX_OBSERVATION_AGE_MS || !Array.isArray(result?.rows) || result.rows.length !== 1) fail();
    const row = result.rows[0];
    if (!row || row.id !== expectedUser || typeof row.is_active !== 'boolean' || typeof row.must_change_password !== 'boolean') fail();
    if (row.account_status !== null && (typeof row.account_status !== 'string' || row.account_status.length > 64)) fail();
    if (row.provider_status !== null && (typeof row.provider_status !== 'string' || row.provider_status.length > 64)) fail();
    const observedAt = integer(row.observed_at_ms);
    if (observedAt - at > MAX_CLOCK_LEAD_MS || at - observedAt > MAX_OBSERVATION_AGE_MS) fail();
    const principal = Object.freeze({ id: row.id, active: row.is_active, accountStatus: row.account_status, role: canonicalRole(row.role),
      providerStatus: row.provider_status, mustChangePassword: row.must_change_password, credentialVersion: integer(row.credential_version) });
    let family;
    if (row.family_id === null && row.family_user_id === null && row.family_expires_at_ms === null) {
      family = Object.freeze({ id: expectedFamily, userId: expectedUser, active: false, expiresAt: 0 });
    } else {
      if (row.family_id !== expectedFamily || row.family_user_id !== expectedUser) fail();
      const expiresAt = integer(row.family_expires_at_ms);
      family = Object.freeze({ id: row.family_id, userId: row.family_user_id, active: expiresAt > at, expiresAt });
    }
    return Object.freeze({ observedAt: Math.min(observedAt, at), principal, family });
  };
}
module.exports = { createPostgresVoiceSessionReader, SNAPSHOT_SQL, QUERY_TIMEOUT_MS, MAX_OBSERVATION_AGE_MS };
