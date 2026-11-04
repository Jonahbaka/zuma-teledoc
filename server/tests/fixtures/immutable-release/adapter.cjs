'use strict';
// Linux-only isolated test adapter. It executes only the synthetic app marked
// below, on loopback in a temporary test store. Never use this for DoctaRx/PM2.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { digest, canonical } = require('../../../../scripts/release/manifest.cjs');
const { expectedIdentity } = require('../../../../scripts/release/store.cjs');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function createFixtureAdapter({ root, configurations, failHealthFor, failStartFor, failStop, failRollbackHealthFor, crashAt, onTuple, delayedStartFor, startDelayMs = 0, startTimeoutMs = 5000 }) {
  if (!fs.existsSync(path.join(root, 'SYNTHETIC_RELEASE_TEST')) || process.platform !== 'linux') throw new Error('Linux synthetic test marker required');
  const statePath = path.join(root, 'fixture-process.json');
  function checkpoint(name) { if (crashAt === name) process.kill(process.pid, 'SIGKILL'); }
  function records() { return fs.readdirSync(root).filter(name => /^fixture-spawn-\d+\.json$/.test(name)).map(name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'))); }
  function procState(pid) {
    try {
      const text = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const fields = text.slice(text.lastIndexOf(')') + 2).trim().split(/\s+/);
      return { state: fields[0], startTime: fields[19] };
    } catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return null; throw error; }
  }
  function running(record) {
    const before = procState(record.pid);
    if (!before || before.state === 'Z') return false;
    let cmdline;
    try { cmdline = fs.readFileSync(`/proc/${record.pid}/cmdline`, 'utf8').split('\0'); }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return false; throw error; }
    const after = procState(record.pid);
    if (!after || after.state === 'Z') return false;
    if (!record.startTime || before.startTime !== record.startTime || after.startTime !== record.startTime) throw new Error('Foreign or reused fixture PID');
    // cmdline can become empty between exit and the zombie/absence observation.
    // Keep that exact start-time-bound child counted as pending, never absent.
    if (cmdline.every(value => value === '')) return true;
    if (cmdline[1] !== record.entrypoint || cmdline[2] !== root || cmdline[3] !== record.configurationPath) throw new Error('Foreign or reused fixture PID');
    return true;
  }

  function active() { return records().filter(running); }
  async function readLive() {
    if (!fs.existsSync(statePath)) return null;
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const response = await fetch(`http://127.0.0.1:${state.port}/health`, { signal: AbortSignal.timeout(1000) });
    if (!response.ok) throw new Error('Fixture unhealthy');
    const body = await response.json();
    if (body.nonce !== state.nonce || body.pid !== state.pid) throw new Error('Foreign fixture process');
    if (onTuple) onTuple(body.tuple);
    return { ...state, body };
  }
  async function stopKnown(allowed) {
    const live = active();
    if (live.some(record => !allowed.some(identity => canonical(identity) === canonical(record.identity)))) throw new Error('Foreign fixture identity');
    for (const record of live) process.kill(record.pid, 'SIGTERM');
    const deadline = Date.now() + 5000;
    while (active().length && Date.now() < deadline) await pause(10);
    if (active().length) throw new Error('Pending fixture process did not stop');
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (!records().some(record => record.pid === state.pid)) throw new Error('Unregistered fixture state');
      fs.unlinkSync(statePath);
    }
    const writer = path.join(root, 'fixture-writer.lock');
    if (fs.existsSync(writer)) fs.unlinkSync(writer);
  }
  return {
    async inspect() {
      const live = active();
      if (live.length > 1) throw new Error('Multiple fixture processes/pending starts');
      if (!live.length) return null;
      const ready = await readLive();
      if (ready && (ready.pid !== live[0].pid || canonical(ready.body.identity) !== canonical(live[0].identity))) throw new Error('Fixture registration and listener disagree');
      // A spawned but not-yet-listening fixture is still a managed process. The
      // real argv and operation registry permit quiescence, never health success.
      return ready?.body.identity || live[0].identity;
    },
    async assertConfiguration(release) {
      const config = configurations[release.configuration.version];
      if (!config || digest(fs.readFileSync(config)) !== release.configuration.digest) throw Object.assign(new Error('Fixture config mismatch'), { code: 'CONFIGURATION_MISMATCH' });
      return release.configuration;
    },
    async assertCompatibility({ from, to }) {
      // Synthetic-only schema model: tests exercise evidence binding, not real SQL.
      return { compatible: true, previousDigest: from.digest, candidateDigest: to.digest,
        previousMigrationDigest: from.migrationDigest, candidateMigrationDigest: to.migrationDigest,
        schemaDigest: digest('synthetic-schema-v1'), evidenceDigest: digest('synthetic-compatible-records') };
    },
    async quiesce({ operationId, allowedReleases }) {
      checkpoint('before-quiesce');
      if (failStop && active().length) throw Object.assign(new Error('Injected stop failure'), { code: 'STOP_UNCERTAIN' });
      // Synchronous spawn registration covers every child, including a timed-out
      // start that has not published a health/state file. Wait for actual exit.
      await stopKnown(allowedReleases);
      checkpoint('after-quiesce');
      return { operationId, quiescent: true };
    },
    async start({ operationId, release }) {
      checkpoint('before-start');
      if (active().length || fs.existsSync(statePath)) throw new Error('Two fixture writers/pending starts prohibited');
      const entrypoint = path.join(release.directory, 'server/index.js');
      if (!fs.readFileSync(entrypoint, 'utf8').startsWith('// SYNTHETIC_IMMUTABLE_RELEASE_FIXTURE')) throw new Error('Real application is forbidden in fixture adapter');
      if (failStartFor === release.releaseId) throw Object.assign(new Error('Injected start failure'), { code: 'START_FAILED' });
      const configurationPath = configurations[release.configuration.version];
      const child = spawn(process.execPath, [entrypoint, root, configurationPath], {
        cwd: release.directory, detached: false, stdio: 'ignore',
        env: { PATH: path.dirname(process.execPath), NODE_ENV: 'test', FIXTURE_START_DELAY_MS: String(delayedStartFor === release.releaseId ? startDelayMs : 0) },
      });
      const record = { pid: child.pid, startTime: procState(child.pid)?.startTime || null, entrypoint, configurationPath, operationId, identity: expectedIdentity(release) };
      fs.writeFileSync(path.join(root, `fixture-spawn-${child.pid}.json`), JSON.stringify(record));
      child.unref();
      checkpoint('after-spawn');
      const deadline = Date.now() + startTimeoutMs;
      while (!fs.existsSync(statePath) && running(record) && Date.now() < deadline) await pause(10);
      if (!fs.existsSync(statePath)) throw Object.assign(new Error('Fixture start unverified'), { code: 'START_UNCERTAIN' });
      checkpoint('after-start');
    },
    async health({ release }) {
      checkpoint('before-health');
      if ([failHealthFor, failRollbackHealthFor].includes(release.releaseId)) throw Object.assign(new Error('Injected health failure'), { code: 'HEALTH_FAILED' });
      const live = await readLive();
      if (!live) throw new Error('Fixture missing');
      checkpoint('after-health');
      return live.body.identity;
    },
    async cleanup() { await stopKnown(records().map(record => record.identity)); },
    expectedIdentity,
  };
}
module.exports = { createFixtureAdapter };
