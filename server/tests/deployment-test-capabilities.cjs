'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

function requireOpenSsl(t) {
  const command = process.env.TEST_OPENSSL_BINARY || 'openssl';
  const probe = spawnSync(command, ['version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  if (process.platform === 'win32' && !process.env.TEST_OPENSSL_BINARY && probe.error?.code === 'ENOENT') {
    t.skip('OpenSSL executable is unavailable on this Windows host; real certificate-generation/TLS integration remains mandatory on Linux.');
    return null;
  }
  assert.ifError(probe.error);
  assert.equal(probe.status, 0, 'OpenSSL is required for real TLS fixture generation.');
  assert.match(probe.stdout, /OpenSSL/i);
  return command;
}

module.exports = { requireOpenSsl };
