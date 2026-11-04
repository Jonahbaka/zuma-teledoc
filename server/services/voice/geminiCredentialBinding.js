'use strict';
const { createHash, timingSafeEqual } = require('node:crypto');
const { MODEL } = require('./geminiLiveEvaluationTransport');
const KEYS = ['provider', 'accountRef', 'projectRef', 'model', 'region', 'termsVersion', 'retentionVersion'];
const ref = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const fault = () => Object.assign(new Error('Approved voice credential binding is unavailable.'), { code: 'VOICE_CREDENTIAL_BINDING_REQUIRED', statusCode: 503 });
// Read-only secret/SDK dependencies are injected, never discovered from env or
// browser data. The enrollment reader must be an authoritative trusted source
// whose reviewer verified provider ownership and the processing agreement.
// A hash matches a key to that enrollment; it cannot prove vendor ownership,
// region enforcement or retention by itself. This module creates no keys.
function createGeminiCredentialBinding({ providerBinding, credentialRef, readCredentialSnapshot, readCredential, createClient, now = Date.now } = {}) {
  if (!providerBinding || KEYS.some(key => !ref(providerBinding[key])) || providerBinding.provider !== 'google' || providerBinding.model !== MODEL
    || !ref(credentialRef) || [readCredentialSnapshot, readCredential, createClient, now].some(value => typeof value !== 'function')) throw fault();
  const binding = Object.freeze(Object.fromEntries(KEYS.map(key => [key, providerBinding[key]])));
  let operations = 0;
  function readBounded(operation) {
    if (operations >= 50) return Promise.reject(fault());
    operations++;
    const work = Promise.resolve().then(operation).finally(() => { operations--; });
    let deadline;
    return Promise.race([work, new Promise((_, reject) => { deadline = setTimeout(() => reject(fault()), 750); deadline.unref?.(); })]).finally(() => clearTimeout(deadline));
  }
  async function snapshot() {
    let value;
    try { value = await readBounded(() => readCredentialSnapshot({ credentialRef })); }
    catch { throw fault(); }
    const at = now();
    if (!value || value.credentialRef !== credentialRef || value.status !== 'verified' || value.revokedAt != null || !ref(value.revision)
      || typeof value.fingerprintSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprintSha256)
      || !Number.isSafeInteger(value.observedAt) || value.observedAt > at || at - value.observedAt > 1000
      || !Number.isSafeInteger(value.validFrom) || value.validFrom > at || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= at
      || KEYS.some(key => value[key] !== binding[key])) throw fault();
    return Object.freeze({ ...binding, credentialRef, revision: value.revision, fingerprintSha256: value.fingerprintSha256, expiresAt: value.expiresAt });
  }
  async function connectLive(configuration, control) {
    const current = () => control?.isActive?.() === true;
    if (!current() || configuration?.model !== binding.model) throw fault();
    const enrollment = await snapshot(); if (!current()) throw fault();
    let key;
    try { key = await readBounded(() => readCredential({ credentialRef, revision: enrollment.revision })); }
    catch { throw fault(); }
    if (!current() || typeof key !== 'string' || key.length < 8 || key.length > 1024) throw fault();
    const fingerprint = createHash('sha256').update(key).digest();
    if (!timingSafeEqual(fingerprint, Buffer.from(enrollment.fingerprintSha256, 'hex'))) throw fault();
    const latest = await snapshot();
    if (!current() || latest.revision !== enrollment.revision || latest.fingerprintSha256 !== enrollment.fingerprintSha256) throw fault();
    // Do not log/return the key or SDK errors. createClient is a trusted server
    // factory for the approved SDK/product, not a browser-supplied callback.
    let client;
    try { client = createClient({ apiKey: key, providerBinding: binding }); } catch { throw fault(); }
    key = null;
    if (!current() || typeof client?.live?.connect !== 'function') throw fault();
    try { return await client.live.connect(configuration); } catch { throw fault(); }
  }
  return Object.freeze({ assertCurrentBinding: snapshot, connectLive });
}
module.exports = { createGeminiCredentialBinding };
