'use strict';

// Operator-only Linux adapter. Configuration and rehearsal evidence stay outside
// the source bundle; no deployment credential or patient data enters a receipt.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { canonical, digest, fail, verifyBundle, runtimeIdentity } = require('./manifest.cjs');
const { expectedIdentity } = require('./store.cjs');

function privateJson(filename) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) || fs.realpathSync(filename) !== filename) fail('UNSAFE_CONFIGURATION', 'Operator control files must be private regular files.');
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}
function createPm2Adapter({ storeRoot, configurationFile, evidenceFile, schemaFingerprint, pm2 = '/usr/bin/pm2', name = 'doctarx' }) {
  if (process.platform !== 'linux' || !/^[a-zA-Z0-9_-]+$/.test(name)) fail('UNSUPPORTED_ADAPTER', 'This adapter requires Linux and a fixed PM2 application name.');
  const initial = privateJson(configurationFile);
  const configurationBytes = fs.readFileSync(configurationFile);
  const run = args => execFileSync(pm2, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const processes = () => JSON.parse(run(['jlist']));
  function configuration(release) {
    if (!fs.readFileSync(configurationFile).equals(configurationBytes)) fail('CONFIGURATION_CHANGED', 'Frozen configuration changed during the operation.');
    const current = privateJson(configurationFile);
    if (canonical(current.identity) !== canonical(release.configuration) || digest(canonical(current.descriptor)) !== current.identity.digest || current.descriptor.version !== current.identity.version) fail('CONFIGURATION_MISMATCH', 'Configuration descriptor differs from the sealed release.');
    if (!current.env || !/^[a-f0-9]{64}$/.test(current.env.DOCTARX_RELEASE_HEALTH_TOKEN || '') || !/^\d+$/.test(String(current.env.PORT || ''))) fail('CONFIGURATION_INCOMPLETE', 'Private runtime configuration is incomplete.');
    return current;
  }
  function managed() {
    const all = processes();
    const writers = all.filter(p => p.name === name);
    // A second application under either the legacy root or release store is a
    // foreign writer, even if it has a different PM2 name.
    if (all.some(p => p.name !== name && p.pm2_env.status === 'online' &&
        (String(p.pm2_env.pm_cwd).startsWith(storeRoot + '/') || (name === 'doctarx' && p.pm2_env.pm_cwd === '/opt/zuma-teledoc')))) fail('FOREIGN_WRITER', 'An additional managed application writer is active.');
    if (writers.length > 1) fail('MULTIPLE_WRITERS', 'Only one application process is supported.');
    return writers[0];
  }
  async function inspect() {
    const p = managed();
    if (!p || p.pm2_env.status === 'stopped') return null;
    if (p.pm2_env.status !== 'online' || !p.pid || p.pm2_env.exec_mode !== 'fork_mode') fail('PROCESS_UNCERTAIN', 'Managed process is not a single online fork.');
    const directory = fs.realpathSync('/proc/' + p.pid + '/cwd');
    if (directory !== p.pm2_env.pm_cwd || !directory.startsWith(path.join(storeRoot, 'releases') + '/')) fail('FOREIGN_PROCESS', 'Process is outside the selected release store.');
    const manifest = verifyBundle(directory, p.pm2_env.DOCTARX_EXPECTED_RELEASE_DIGEST, { matchRuntime: true });
    if (fs.realpathSync('/proc/' + p.pid + '/exe') !== fs.realpathSync(process.execPath) || canonical(manifest.runtime) !== canonical(runtimeIdentity()) || p.pm2_env.pm_exec_path !== path.join(directory, 'server/index.js')) fail('PROCESS_IDENTITY_MISMATCH', 'Actual process runtime or backend differs.');
    const release = { ...manifest, sourceSha: manifest.source.sha };
    const config = configuration(release);
    for (const [key, value] of Object.entries(config.env)) {
      if (String(p.pm2_env[key]) !== String(value)) fail('PROCESS_CONFIGURATION_MISMATCH', 'Managed process environment differs from the frozen configuration.');
    }
    return expectedIdentity(release);
  }
  async function health({ release }) {
    const config = configuration(release);
    for (let attempt = 0; attempt < 90; attempt++) {
      try {
        const response = await fetch('http://127.0.0.1:' + config.env.PORT + '/internal/release-identity', {
          headers: { 'x-doctarx-release-token': config.env.DOCTARX_RELEASE_HEALTH_TOKEN }, signal: AbortSignal.timeout(3000),
        });
        if (response.ok) {
          const identity = await response.json();
          if (canonical(identity) !== canonical(expectedIdentity(release))) fail('HEALTH_IDENTITY_MISMATCH', 'HTTP identity does not match the executing release.');
          return identity;
        }
      } catch (error) { if (error.code === 'HEALTH_IDENTITY_MISMATCH') throw error; }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    fail('HEALTH_TIMEOUT', 'Full application readiness did not pass.');
  }
  return {
    inspect, health,
    async assertConfiguration(release) { return configuration(release).identity; },
    async assertCompatibility({ from, to }) {
      const proof = privateJson(evidenceFile);
      const schemaDigest = await schemaFingerprint();
      if (proof.version !== 1 || proof.passed !== true || proof.schemaDigest !== schemaDigest ||
          canonical(proof.releases?.slice().sort()) !== canonical([from.digest, to.digest].sort()) ||
          proof.previousMigrationDigest !== from.migrationDigest || proof.candidateMigrationDigest !== to.migrationDigest ||
          proof.fullApplicationHealth !== true || proof.protectedDataReadback !== true) fail('COMPATIBILITY_UNPROVEN', 'Exact releases require successful restored-database rehearsal evidence.');
      return { compatible: true, previousDigest: from.digest, candidateDigest: to.digest,
        previousMigrationDigest: from.migrationDigest, candidateMigrationDigest: to.migrationDigest,
        schemaDigest, evidenceDigest: digest(canonical(proof)) };
    },
    async quiesce({ operationId }) {
      const p = managed();
      const pid = p?.pid;
      if (p) run(['delete', name]);
      if (managed()) fail('WRITER_STOP_FAILED', 'Managed process or restart entry remains.');
      if (pid && fs.existsSync('/proc/' + pid)) fail('WRITER_STOP_FAILED', 'Prior process has not exited.');
      // A live listener or orphan restart must not survive the PM2 stop.
      const net = require('node:net');
      await new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', () => reject(Object.assign(new Error('Application port is still occupied.'), { code: 'WRITER_STOP_FAILED' })));
        probe.listen(Number(initial.env.PORT), '0.0.0.0', () => probe.close(resolve));
      });
      return { quiescent: true, operationId };
    },
    async start({ release }) {
      const config = configuration(release);
      verifyBundle(release.directory, release.digest, { matchRuntime: true });
      if (fs.realpathSync(path.join(storeRoot, 'current')) !== release.directory || managed()) fail('START_FENCE_FAILED', 'Release is not exclusively selected.');
      const env = { ...config.env, NODE_ENV: 'production', DOCTARX_IMMUTABLE_RELEASE: 'true',
        DOCTARX_EXPECTED_RELEASE_DIGEST: release.digest, DOCTARX_RELEASE_STORE_ROOT: storeRoot,
        DOCTARX_CONFIG_VERSION: config.identity.version, DOCTARX_CONFIG_DIGEST: config.identity.digest };
      const file = path.join(path.dirname(configurationFile), name + '-ecosystem.json');
      fs.writeFileSync(file, JSON.stringify({ apps: [{ name, cwd: release.directory, script: 'server/index.js',
        interpreter: process.execPath, exec_mode: 'fork', instances: 1, autorestart: true,
        min_uptime: 30000, max_restarts: 3, kill_timeout: 30000, env,
        out_file: path.join(path.dirname(configurationFile), name + '.out.log'),
        error_file: path.join(path.dirname(configurationFile), name + '.error.log'),
      }] }), { mode: 0o600 });
      run(['start', file, '--only', name]);
    },
  };
}
module.exports = { createPm2Adapter, privateJson };
