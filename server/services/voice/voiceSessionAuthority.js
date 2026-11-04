'use strict';
const ROLES = ['provider', 'admin', 'super_admin'];
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const fail = (code, statusCode = 401) => { throw Object.assign(new Error('Current voice session authority could not be verified.'), { code, statusCode }); };

// Unmounted: the approved composition must supply a fresh, consistent reader.
// Input is server-verified auth metadata, never request JSON or model output.
// No DB connection, credential reader, approval cache or fallback is installed.
function createVoiceSessionAuthority({ readSessionSnapshot, now = Date.now } = {}) {
  if (typeof readSessionSnapshot !== 'function' || typeof now !== 'function') fail('VOICE_SESSION_POLICY_UNCONFIGURED', 503);
  return async function assertSession(actor) {
    const binding = actor?.voiceAuth;
    if (!actor?.id || !ROLES.includes(actor.role) || binding?.userId !== actor.id || !uuid(binding.familyId)
      || !Number.isSafeInteger(binding.credentialVersion) || binding.credentialVersion < 0
      || !Number.isSafeInteger(binding.expiresAt) || binding.expiresAt <= now()) fail('VOICE_SESSION_AUTHORITY_REQUIRED');
    // Snapshot primitive values before awaiting the reader. Caller mutation
    // must not switch the family/version whose current state is being checked.
    const expected = { ...binding }, expectedRole = actor.role; let snapshot, timeout;
    try {
      snapshot = await Promise.race([
        readSessionSnapshot({ userId: expected.userId, familyId: expected.familyId }),
        new Promise((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Session read timed out.')), 1000); }),
      ]);
    } catch { fail('VOICE_SESSION_AUTHORITY_UNAVAILABLE', 503); }
    finally { clearTimeout(timeout); }
    const at = now(), principal = snapshot?.principal, family = snapshot?.family;
    if (!Number.isSafeInteger(at) || expected.expiresAt <= at || !Number.isSafeInteger(snapshot?.observedAt)
      || snapshot.observedAt > at || at - snapshot.observedAt > 1000
      || principal?.id !== expected.userId || principal.active !== true || principal.accountStatus !== 'active' || principal.role !== expectedRole || !ROLES.includes(principal.role)
      || principal.credentialVersion !== expected.credentialVersion || principal.mustChangePassword !== false
      || principal.role === 'provider' && principal.providerStatus !== 'approved'
      || family?.id !== expected.familyId || family.userId !== expected.userId || family.active !== true
      || !Number.isSafeInteger(family.expiresAt) || family.expiresAt <= at) fail('VOICE_SESSION_REVOKED');
  };
}
module.exports = { createVoiceSessionAuthority };
