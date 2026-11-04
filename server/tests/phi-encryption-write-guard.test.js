'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
function encryption(env) {
  const sourceModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../../lib/encryption'), 'utf8'), {
    module: sourceModule, exports: sourceModule.exports, process: { env }, Buffer,
    require(name) { assert.equal(name, 'crypto'); return crypto; },
  });
  return sourceModule.exports;
}
test('production PHI writes require a dedicated 256-bit hex key despite fallback credentials', () => {
  for (const key of [undefined, '', 'short', 'z'.repeat(64), 'a'.repeat(63)]) {
    const api = encryption({ NODE_ENV: 'production', ENCRYPTION_KEY: key, SESSION_SECRET: 'synthetic-only-session', DATABASE_URL: 'synthetic-only-db' });
    assert.throws(() => api.encrypt('Synthetic protected text'), error => error.code === 'PHI_ENCRYPTION_KEY_REQUIRED');
  }
});
test('explicit production key protects new records and configured legacy read remains possible', () => {
  const env = { NODE_ENV: 'development', SESSION_SECRET: 'synthetic-only-legacy' };
  const legacy = encryption(env).encrypt('Synthetic legacy text');
  const api = encryption({ ...env, NODE_ENV: 'production', ENCRYPTION_KEY: 'ab'.repeat(32) });
  const saved = api.encrypt('Synthetic current text');
  assert.equal(api.decrypt(saved.encrypted, saved.iv, saved.tag), 'Synthetic current text');
  assert.equal(api.decrypt(legacy.encrypted, legacy.iv, legacy.tag), 'Synthetic legacy text');
  assert.notEqual(saved.encrypted, 'Synthetic current text');
});
test('cached development fallback cannot authorize later production writes', () => {
  const env = { NODE_ENV: 'development' }; const api = encryption(env);
  const previous = api.encrypt('Synthetic development text');
  assert.equal(api.decrypt(previous.encrypted, previous.iv, previous.tag), 'Synthetic development text');
  env.NODE_ENV = 'production';
  assert.throws(() => api.encrypt('Synthetic production text'), error => error.code === 'PHI_ENCRYPTION_KEY_REQUIRED');
  env.ENCRYPTION_KEY = 'cd'.repeat(32);
  const saved = api.encrypt('Synthetic configured text');
  assert.equal(api.decrypt(saved.encrypted, saved.iv, saved.tag), 'Synthetic configured text');
  assert.equal(api.decrypt(previous.encrypted, previous.iv, previous.tag), 'Synthetic development text');
  const reader = encryption({ ...env });
  assert.equal(reader.decrypt(saved.encrypted, saved.iv, saved.tag), 'Synthetic configured text');
});

test('current-key reader rejects shortened tags and every malformed encoding before decrypting', () => {
  const api = encryption({ NODE_ENV: 'production', ENCRYPTION_KEY: 'ab'.repeat(32) });
  const saved = api.encrypt('X');
  // A one-byte ciphertext has two padding characters. Changing unused pad bits
  // yields the same bytes under permissive Buffer.from but is not canonical.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const noncanonical = saved.encrypted[0] + alphabet[alphabet.indexOf(saved.encrypted[1]) + 1] + '==';
  assert.deepEqual(Buffer.from(noncanonical, 'base64'), Buffer.from(saved.encrypted, 'base64'));
  for (const patch of [
    ...[8, 16, 24, 26, 28, 30, 31].map(length => ({ tag: saved.tag.slice(0, length) })),
    { tag: saved.tag + 'INVALID' }, { tag: saved.tag + '00' }, { tag: saved.tag + '\n' }, { tag: Buffer.from(saved.tag, 'hex') },
    { iv: saved.iv + 'INVALID' }, { iv: saved.iv + '00' }, { iv: saved.iv.slice(0, 22) }, { iv: saved.iv + '\n' },
    { encrypted: saved.encrypted + '\n' }, { encrypted: '!' + saved.encrypted }, { encrypted: saved.encrypted.replace(/=+$/, '') },
    { encrypted: saved.encrypted + '=' }, { encrypted: noncanonical }, { encrypted: null },
  ]) {
    const candidate = { ...saved, ...patch };
    assert.throws(() => api.decryptCurrentKey(candidate.encrypted, candidate.iv, candidate.tag), { code: 'PHI_DECRYPTION_FAILED' });
  }
  assert.equal(api.decryptCurrentKey(saved.encrypted, saved.iv.toUpperCase(), saved.tag.toUpperCase()), 'X');
});
