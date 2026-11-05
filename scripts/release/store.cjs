'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fail, digest, canonical, rootDirectory, readRegular, createManifest, verifyBundle, MANIFEST_FILE, SHA256 } = require('./manifest.cjs');
const TERMINAL = new Set(['succeeded', 'rolled-back']);
const PHASES = new Set(['prepared', 'stopping-current', 'current-stopped', 'selecting-candidate', 'starting-candidate', 'verifying-candidate', 'rolling-back', 'selecting-previous', 'starting-previous', 'verifying-previous', 'succeeded', 'rolled-back', 'recovery-required']);
const RELEASE_ID = /^[a-f0-9]{40}-[a-f0-9]{16}$/;

function existsWithoutFollowing(filename) {
  try { fs.lstatSync(filename); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function syncDirectory(directory) {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function realChild(root, name, { create = false } = {}) {
  const child = path.join(root, name);
  if (create && !fs.existsSync(child)) { fs.mkdirSync(child, { mode: 0o700 }); syncDirectory(root); }
  if (rootDirectory(child) !== child) fail('UNSAFE_STORE', 'Release store directory is not real');
  return child;
}
function openStore(storeRoot) {
  const root = rootDirectory(storeRoot);
  return { root, releases: realChild(root, 'releases', { create: true }) };
}
function inspectStore(storeRoot) {
  const root = rootDirectory(storeRoot);
  // Inspection never creates a layout or clears a stale lock.
  const current = readCurrent(root, { optional: true });
  const journal = readJournal(root);
  return { current, journal, locked: existsWithoutFollowing(path.join(root, '.release-lock')), blocked: existsWithoutFollowing(path.join(root, '.release-lock')) || Boolean(journal && !TERMINAL.has(journal.phase)) };
}
function writeAtomicJson(directory, filename, data) {
  const temporary = path.join(directory, '.' + filename + '.' + crypto.randomUUID());
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, canonical(data) + '\n');
    fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(temporary, path.join(directory, filename));
    syncDirectory(directory);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
function validateDescriptorShape(value, root) {
  if (!value || !RELEASE_ID.test(value.releaseId || '') || !SHA256.test(value.digest || '') ||
      value.releaseId !== value.sourceSha + '-' + value.digest.slice(0, 16) ||
      value.directory !== path.join(root, 'releases', value.releaseId) ||
      !/^[A-Za-z0-9._-]{1,128}$/.test(value.buildId || '') || !SHA256.test(value.migrationDigest || '') ||
      !SHA256.test(value.runtime?.nodeBinarySha256 || '') || !/^v\d+\.\d+\.\d+$/.test(value.runtime?.node || '') ||
      !/^\d+$/.test(value.runtime?.modulesAbi || '') || !['linux', 'darwin', 'win32'].includes(value.runtime?.platform) || !['x64', 'arm64'].includes(value.runtime?.arch) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value.configuration?.version || '') || !SHA256.test(value.configuration?.digest || '')) fail('INVALID_JOURNAL', 'Stored deployment descriptor is incomplete or inconsistent');
}
function checkedCompatibility(value, from, to) {
  if (value?.compatible !== true || value.previousDigest !== from.digest || value.candidateDigest !== to.digest ||
      value.previousMigrationDigest !== from.migrationDigest || value.candidateMigrationDigest !== to.migrationDigest ||
      !SHA256.test(value.schemaDigest || '') || !SHA256.test(value.evidenceDigest || '')) fail('COMPATIBILITY_UNPROVEN', 'Old/new release and schema compatibility evidence is missing');
  // Keep only bounded evidence identities, never adapter output or secret values.
  return { compatible: true, previousDigest: value.previousDigest, candidateDigest: value.candidateDigest,
    previousMigrationDigest: value.previousMigrationDigest, candidateMigrationDigest: value.candidateMigrationDigest,
    schemaDigest: value.schemaDigest, evidenceDigest: value.evidenceDigest };
}
function assertCompatibilityUnchanged(value, expected, from, to) {
  const current = checkedCompatibility(value, from, to);
  const reviewed = checkedCompatibility(expected, from, to);
  if (canonical(current) !== canonical(reviewed)) fail('COMPATIBILITY_CHANGED', 'Schema/compatibility evidence changed during the release');
  return current;
}
function archiveTerminalJournal(root, journal) {
  if (!journal) return;
  if (!TERMINAL.has(journal.phase)) fail('RECOVERY_REQUIRED', 'Unfinished release evidence cannot be archived as complete');
  const directory = realChild(root, 'journals', { create: true });
  const filename = path.join(directory, journal.operationId + '.json');
  if (fs.existsSync(filename)) {
    if (readRegular(filename).content.toString('utf8') !== canonical(journal) + '\n') fail('JOURNAL_CONFLICT', 'Retained release evidence must not be overwritten');
    return;
  }
  const fd = fs.openSync(filename, 'wx', 0o600);
  try { fs.writeFileSync(fd, canonical(journal) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  syncDirectory(directory);
}
function readJournal(root) {
  const filename = path.join(root, 'journal.json');
  if (!existsWithoutFollowing(filename)) return null;
  try {
    const raw = readRegular(filename).content;
    if (raw.length > 1024 * 1024) fail('INVALID_JOURNAL', 'Release journal is oversized');
    const value = JSON.parse(raw.toString('utf8'));
    if (value.version !== 1 || !PHASES.has(value.phase) || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.operationId || '') || !RELEASE_ID.test(value.from?.releaseId || '') || !RELEASE_ID.test(value.to?.releaseId || '') || !SHA256.test(value.from?.digest || '') || !SHA256.test(value.to?.digest || '')) fail('INVALID_JOURNAL', 'Release journal is incomplete');
    validateDescriptorShape(value.from, root);
    validateDescriptorShape(value.to, root);
    if (!SHA256.test(value.planDigest || '') || value.planDigest !== digest(canonical({ version: 1, from: value.from, to: value.to })) ||
        !Array.isArray(value.history) || !value.history.length || value.history.length > 100 || value.history[0].phase !== 'prepared' || value.history.at(-1).phase !== value.phase ||
        value.history.some(entry => !PHASES.has(entry.phase) || typeof entry.at !== 'string' || !Number.isFinite(Date.parse(entry.at)))) fail('INVALID_JOURNAL', 'Release journal plan/history is incomplete');
    checkedCompatibility(value.compatibility, value.from, value.to);
    return value;
  } catch (error) { if (error.code === 'INVALID_JOURNAL') throw error; fail('INVALID_JOURNAL', 'Release journal is unreadable; manual recovery is required'); }
}
function readCurrent(root, { optional = false } = {}) {
  const filename = path.join(root, 'current');
  let stat;
  try { stat = fs.lstatSync(filename); } catch (error) { if (error.code === 'ENOENT' && optional) return null; fail('CURRENT_UNAVAILABLE', 'A known existing serving target is required'); }
  if (!stat.isSymbolicLink()) fail('INVALID_CURRENT', 'Serving target must be a relative release symlink');
  const target = fs.readlinkSync(filename);
  if (!/^releases\/[a-f0-9]{40}-[a-f0-9]{16}$/.test(target)) fail('INVALID_CURRENT', 'Serving target is not a direct immutable release');
  const resolved = fs.realpathSync(filename);
  if (resolved !== path.join(root, target)) fail('INVALID_CURRENT', 'Serving target escapes the release store');
  return target.slice('releases/'.length);
}
async function withLock(root, callback) {
  const directory = path.join(root, '.release-lock');
  const nonce = crypto.randomUUID();
  let retainLock = false;
  const lock = { retain() { retainLock = true; } };
  try { fs.mkdirSync(directory, { mode: 0o700 }); } catch (error) { if (error.code === 'EEXIST') fail('RELEASE_BUSY', 'Release lock exists; it is never cleared by PID or timeout'); throw error; }
  try {
    try {
      writeAtomicJson(directory, 'owner.json', { version: 1, nonce, pid: process.pid });
      syncDirectory(root);
    } catch (error) { lock.retain(); throw error; }
    return await callback(lock);
  } finally {
    // Never delete a replaced lock. A crash leaves it for explicitly fenced recovery.
    if (!retainLock) {
      const owner = JSON.parse(readRegular(path.join(directory, 'owner.json')).content.toString('utf8'));
      if (owner.nonce !== nonce) fail('LOCK_CHANGED', 'Release lock ownership changed; manual recovery is required');
      fs.unlinkSync(path.join(directory, 'owner.json'));
      fs.rmdirSync(directory);
      syncDirectory(root);
    }
  }
}
function syncTree(root, entries) {
  for (const entry of entries) if (entry.type === 'file') {
    const fd = fs.openSync(path.join(root, entry.path), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  for (const entry of [...entries].reverse()) if (entry.type === 'directory') syncDirectory(path.join(root, entry.path));
  syncDirectory(root);
}
async function prepareRelease(options) {
  const root = rootDirectory(options.storeRoot);
  const source = rootDirectory(options.bundleDirectory);
  if (source === root || source.startsWith(root + path.sep) || root.startsWith(source + path.sep)) fail('OVERLAPPING_ROOTS', 'Bundle and release store must be separate directories');
  const { releases } = openStore(root);
  return withLock(root, async () => {
    const manifest = createManifest(options);
    const destination = path.join(releases, manifest.releaseId);
    if (fs.existsSync(destination)) {
      const existing = verifyBundle(destination, manifest.digest);
      syncTree(destination, existing.entries);
      const manifestFd = fs.openSync(path.join(destination, MANIFEST_FILE), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try { fs.fsyncSync(manifestFd); } finally { fs.closeSync(manifestFd); }
      syncDirectory(releases);
      return { releaseId: manifest.releaseId, digest: manifest.digest, directory: destination, reused: true };
    }
    const staging = path.join(releases, '.preparing-' + crypto.randomUUID());
    try {
      fs.cpSync(source, staging, { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false, preserveTimestamps: true });
      const target = path.join(staging, MANIFEST_FILE);
      const fd = fs.openSync(target, 'wx', 0o600);
      try { fs.writeFileSync(fd, canonical(manifest) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      // Reverify copied source, dependency tree and links, not just the input.
      verifyBundle(staging, manifest.digest);
      syncTree(staging, manifest.entries);
      fs.renameSync(staging, destination);
      syncDirectory(releases);
      return { releaseId: manifest.releaseId, digest: manifest.digest, directory: destination, reused: false };
    } finally { if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true }); }
  });
}
function descriptor(releases, wanted) {
  if (!wanted || !RELEASE_ID.test(wanted.releaseId || '') || !SHA256.test(wanted.digest || '')) fail('INVALID_RELEASE_SELECTION', 'Exact release ID and independently accepted digest are required');
  const directory = path.join(releases, wanted.releaseId);
  const manifest = verifyBundle(directory, wanted.digest, { matchRuntime: true });
  if (manifest.releaseId !== wanted.releaseId) fail('INVALID_RELEASE_SELECTION', 'Directory and release identity differ');
  return { releaseId: wanted.releaseId, digest: wanted.digest, directory, sourceSha: manifest.source.sha, buildId: manifest.buildId, runtime: manifest.runtime, migrationDigest: manifest.migrationDigest, configuration: manifest.configuration };
}
function planPromotion({ storeRoot, expectedCurrent, candidate }) {
  const root = rootDirectory(storeRoot);
  const releases = realChild(root, 'releases');
  const journal = readJournal(root);
  if (journal && !TERMINAL.has(journal.phase)) fail('RECOVERY_REQUIRED', 'An incomplete release journal blocks new promotion');
  if (readCurrent(root) !== expectedCurrent?.releaseId) fail('CURRENT_CHANGED', 'Serving target differs from the explicitly expected release');
  const from = descriptor(releases, expectedCurrent);
  const to = descriptor(releases, candidate);
  if (from.releaseId === to.releaseId) fail('SAME_RELEASE', 'Candidate already matches the serving release');
  const body = { version: 1, from, to };
  return { ...body, planDigest: digest(canonical(body)) };
}
function expectedIdentity(release) {
  return { releaseId: release.releaseId, digest: release.digest, sourceSha: release.sourceSha, buildId: release.buildId, runtime: release.runtime, migrationDigest: release.migrationDigest, configuration: release.configuration };
}
function assertIdentity(actual, release) {
  if (canonical(actual) !== canonical(expectedIdentity(release))) fail('IDENTITY_MISMATCH', 'Managed process or health identity does not match the complete release');
}
function selectTarget(root, releaseId) {
  if (!RELEASE_ID.test(releaseId)) fail('INVALID_RELEASE_SELECTION', 'Invalid serving release');
  const temporary = path.join(root, '.current-' + crypto.randomUUID());
  try {
    fs.symlinkSync('releases/' + releaseId, temporary);
    fs.renameSync(temporary, path.join(root, 'current'));
    syncDirectory(root);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function requireAdapter(adapter) {
  // No production adapter or CLI promotion is provided until host/configuration,
  // schema read-only startup, identity and operation-fencing are independently verified.
  for (const method of ['inspect', 'assertConfiguration', 'assertCompatibility', 'quiesce', 'start', 'health']) {
    if (typeof adapter?.[method] !== 'function') fail('ADAPTER_UNAVAILABLE', 'A reviewed bounded process adapter is required');
  }
}
async function assertConfiguration(adapter, release) {
  if (canonical(await adapter.assertConfiguration(release)) !== canonical(release.configuration)) fail('CONFIGURATION_MISMATCH', 'Release configuration version or digest is unavailable');
}
async function quiesce(adapter, operationId, releases) {
  // The adapter must fence ALL in-flight starts in this operation and confirm
  // the exact named writer is gone. A timeout/PID check alone is not sufficient.
  const observed = await adapter.inspect();
  if (observed !== null && !releases.some(release => canonical(observed) === canonical(expectedIdentity(release)))) fail('FOREIGN_PROCESS', 'An unexpected managed process must not be stopped automatically');
  const proof = await adapter.quiesce({ operationId, allowedReleases: releases.map(expectedIdentity) });
  if (proof?.quiescent !== true || proof.operationId !== operationId || (await adapter.inspect()) !== null) fail('QUIESCENCE_UNPROVEN', 'Cannot prove the managed writer and pending starts are stopped');
}
async function promoteRelease(options) {
  requireAdapter(options.adapter);
  const root = rootDirectory(options.storeRoot);
  return withLock(root, async lock => {
    const plan = planPromotion(options);
    if (!SHA256.test(options.planDigest || '') || options.planDigest !== plan.planDigest) fail('PLAN_CHANGED', 'The explicitly reviewed release plan no longer matches');
    const { from, to } = plan;
    const adapter = options.adapter;
    assertIdentity(await adapter.inspect(), from);
    await assertConfiguration(adapter, from);
    await assertConfiguration(adapter, to);
    const compatibility = checkedCompatibility(await adapter.assertCompatibility({ from, to }), from, to);
    async function recheckCompatibility() {
      assertCompatibilityUnchanged(await adapter.assertCompatibility({ from, to }), compatibility, from, to);
    }
    // Preflight must not change the selected or running release.
    if (readCurrent(root) !== from.releaseId) fail('CURRENT_CHANGED', 'Serving target changed during preflight');
    assertIdentity(await adapter.inspect(), from);
    const operationId = crypto.randomUUID();
    let journal = { version: 1, operationId, planDigest: plan.planDigest, from, to, compatibility, phase: 'prepared', history: [] };
    function record(phase, failureCode) {
      journal = { ...journal, phase, history: [...journal.history, { phase, at: new Date().toISOString() }], ...(failureCode ? { failureCode } : {}) };
      try { writeAtomicJson(root, 'journal.json', journal); }
      catch (error) { lock.retain(); throw error; }
    }
    archiveTerminalJournal(root, readJournal(root));
    record('prepared');
    try {
      record('stopping-current');
      await quiesce(adapter, operationId, [from, to]);
      record('current-stopped');
      await recheckCompatibility();
      // Verify immutable content/configuration again immediately before selection.
      descriptor(realChild(root, 'releases'), to);
      await assertConfiguration(adapter, to);
      if (readCurrent(root) !== from.releaseId) fail('CURRENT_CHANGED', 'Serving target changed before promotion');
      record('selecting-candidate');
      selectTarget(root, to.releaseId);
      record('starting-candidate');
      await adapter.start({ operationId, release: to });
      assertIdentity(await adapter.inspect(), to);
      record('verifying-candidate');
      assertIdentity(await adapter.health({ operationId, release: to }), to);
      if (readCurrent(root) !== to.releaseId) fail('CURRENT_CHANGED', 'Serving target changed during candidate verification');
      descriptor(realChild(root, 'releases'), to);
      await assertConfiguration(adapter, to);
      record('succeeded');
      return { status: 'succeeded', operationId, releaseId: to.releaseId, previousReleaseId: from.releaseId };
    } catch (error) {
      const failureCode = /^[A-Z0-9_]{1,80}$/.test(error.code || '') ? error.code : 'PROMOTION_FAILED';
      try {
        record('rolling-back', failureCode);
        await quiesce(adapter, operationId, [from, to]);
        descriptor(realChild(root, 'releases'), from);
        await recheckCompatibility();
        await assertConfiguration(adapter, from);
        const current = readCurrent(root);
        if (![from.releaseId, to.releaseId].includes(current)) fail('CURRENT_CHANGED', 'Unexpected serving target requires manual recovery');
        record('selecting-previous');
        selectTarget(root, from.releaseId);
        record('starting-previous');
        await adapter.start({ operationId, release: from });
        assertIdentity(await adapter.inspect(), from);
        record('verifying-previous');
        assertIdentity(await adapter.health({ operationId, release: from }), from);
        if (readCurrent(root) !== from.releaseId) fail('CURRENT_CHANGED', 'Serving target changed during rollback verification');
        descriptor(realChild(root, 'releases'), from);
        await assertConfiguration(adapter, from);
        record('rolled-back', failureCode);
      } catch {
        // No optimistic restart or database restore follows an uncertain outcome.
        lock.retain();
        try { record('recovery-required', failureCode); } catch { /* retained operation lock is the independent hard blocker */ }
        fail('RECOVERY_REQUIRED', 'Promotion and complete-release rollback could not both be verified; inspect the durable journal');
      }
      fail('PROMOTION_ROLLED_BACK', 'Candidate failed; the complete prior release and its health were independently restored');
    }
  });
}

async function planInterruptedRecovery({ storeRoot, adapter }) {
  requireAdapter(adapter);
  const root = rootDirectory(storeRoot);
  const journal = readJournal(root);
  if (!journal || TERMINAL.has(journal.phase)) fail('NO_INTERRUPTED_RELEASE', 'No incomplete release journal exists');
  const from = descriptor(realChild(root, 'releases'), journal.from);
  const to = descriptor(realChild(root, 'releases'), journal.to);
  const current = readCurrent(root);
  if (![from.releaseId, to.releaseId].includes(current)) fail('CURRENT_CHANGED', 'Unexpected serving target requires operator investigation');
  const observed = await adapter.inspect();
  if (observed !== null && ![from, to].some(release => canonical(observed) === canonical(expectedIdentity(release)))) fail('FOREIGN_PROCESS', 'Unknown managed process must not be changed');
  await assertConfiguration(adapter, from);
  // A fresh but different proof cannot silently replace the evidence recorded
  // before interruption. Changed schema/evidence requires independent review.
  assertCompatibilityUnchanged(await adapter.assertCompatibility({ from, to }), journal.compatibility, from, to);
  return { version: 1, operationId: journal.operationId, selectedReleaseId: current,
    observedReleaseId: observed?.releaseId || null, restore: from, requiresExclusiveFence: true,
    actions: ['establish-exclusive-operation-fence', 'confirm-all-managed-writers-and-pending-starts-stopped', 'reverify-previous-release-config-and-compatibility', 'select-complete-previous-release', 'start-and-independently-verify-previous-release'] };
}

module.exports = { prepareRelease, planPromotion, promoteRelease, planInterruptedRecovery, inspectStore, expectedIdentity, readCurrent, readJournal, assertCompatibilityUnchanged };
