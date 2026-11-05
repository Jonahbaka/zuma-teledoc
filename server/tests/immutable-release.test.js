'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { createManifest, verifyBundle, digest, canonical, MANIFEST_FILE } = require('../../scripts/release/manifest.cjs');
const { prepareRelease, planPromotion, promoteRelease, planInterruptedRecovery, inspectStore, expectedIdentity, assertCompatibilityUnchanged } = require('../../scripts/release/store.cjs');
const { createFixtureAdapter } = require('./fixtures/immutable-release/adapter.cjs');
const { main: cli } = require('../../scripts/immutable-release.cjs');

const root = path.resolve(__dirname, '../..');
test('reviewed compatibility evidence cannot silently change during recovery', () => {
  const oldRelease = { digest: '1'.repeat(64), migrationDigest: '2'.repeat(64) };
  const newRelease = { digest: '3'.repeat(64), migrationDigest: '4'.repeat(64) };
  const proof = { compatible: true, previousDigest: oldRelease.digest, candidateDigest: newRelease.digest,
    previousMigrationDigest: oldRelease.migrationDigest, candidateMigrationDigest: newRelease.migrationDigest,
    schemaDigest: '5'.repeat(64), evidenceDigest: '6'.repeat(64) };
  assert.deepEqual(assertCompatibilityUnchanged({ ...proof }, proof, oldRelease, newRelease), proof);
  for (const field of ['schemaDigest', 'evidenceDigest']) {
    assert.throws(() => assertCompatibilityUnchanged({ ...proof, [field]: '7'.repeat(64) }, proof, oldRelease, newRelease), { code: 'COMPATIBILITY_CHANGED' });
  }
  assert.throws(() => assertCompatibilityUnchanged({ ...proof, candidateDigest: '7'.repeat(64) }, proof, oldRelease, newRelease), { code: 'COMPATIBILITY_UNPROVEN' });
});
function registerLinuxTests() {
const appSource = version => `// SYNTHETIC_IMMUTABLE_RELEASE_FIXTURE\n'use strict';
setTimeout(() => {
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const stateRoot = process.argv[2];
const configurationPath = process.argv[3];
if (!fs.existsSync(path.join(stateRoot, 'SYNTHETIC_RELEASE_TEST'))) process.exit(90);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'release-manifest.json')));
const configurationBytes = fs.readFileSync(configurationPath);
const configuration = JSON.parse(configurationBytes);
const configDigest = crypto.createHash('sha256').update(configurationBytes).digest('hex');
if (configDigest !== manifest.configuration.digest) process.exit(91);
const writerPath = path.join(stateRoot, 'fixture-writer.lock');
const writer = fs.openSync(writerPath, 'wx');
fs.closeSync(writer);
const nonce = crypto.randomUUID();
const tuple = { backend: ${JSON.stringify(version)}, frontend: fs.readFileSync(path.join(root,'.next/BUILD_ID'),'utf8').trim(), dependency: require('../node_modules/fictional-dependency'), configuration: configuration.version };
const identity = { releaseId:manifest.releaseId, digest:manifest.digest, sourceSha:manifest.source.sha, buildId:manifest.buildId, runtime:manifest.runtime, migrationDigest:manifest.migrationDigest, configuration:manifest.configuration };
const server = http.createServer((req,res) => { res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({identity,tuple,nonce,pid:process.pid})); });
server.listen(0,'127.0.0.1',()=>fs.writeFileSync(path.join(stateRoot,'fixture-process.json'),JSON.stringify({port:server.address().port,pid:process.pid,nonce})));
process.on('SIGTERM',()=>server.close(()=>{fs.unlinkSync(path.join(stateRoot,'fixture-process.json'));fs.unlinkSync(writerPath);process.exit(0);}));
}, Number(process.env.FIXTURE_START_DELAY_MS || 0));
`;
function write(filename, content) { fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, content); }
function git(repository, ...args) {
  return execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 'Synthetic Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Synthetic Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' } }).trim();
}
let master;
test.before(async () => {
  master = fs.mkdtempSync(path.join(os.tmpdir(), 'doctarx-immutable-master-'));
  const repository = path.join(master, 'repository'); fs.mkdirSync(repository);
  git(repository, 'init', '--quiet');
  write(path.join(repository, '.gitignore'), 'node_modules/\n.next/\n');
  for (const directory of ['app', 'components', 'lib', 'ng', 'shared', 'public']) write(path.join(repository, directory, 'fixture.txt'), 'Synthetic source\n');
  write(path.join(repository, 'server/db/migrate.js'), '// synthetic migration runner, never executed\n');
  write(path.join(repository, 'server/db/migrations/001.sql'), '-- synthetic schema only\n');
  write(path.join(repository, 'ng/migrations/migrate.js'), '// synthetic NG migration runner, never executed\n');
  write(path.join(repository, 'ng/migrations/001.sql'), '-- synthetic schema only\n');
  write(path.join(repository, 'next.config.js'), 'module.exports = {};\n');
  write(path.join(repository, 'package.json'), '{"name":"synthetic-release-fixture","version":"1.0.0"}\n');
  write(path.join(repository, 'package-lock.json'), '{"name":"synthetic-release-fixture","lockfileVersion":3}\n');
  master = { directory: master, repository, store: path.join(master, 'store'), configurations: {} };
  fs.mkdirSync(master.store);
  for (const version of ['old', 'new']) {
    write(path.join(repository, 'server/index.js'), appSource(version));
    git(repository, 'add', '.'); git(repository, 'commit', '--quiet', '-m', version);
    const sha = git(repository, 'rev-parse', 'HEAD');
    const bundle = path.join(master.directory, version + '-bundle');
    fs.cpSync(repository, bundle, { recursive: true, filter: source => path.basename(source) !== '.git' });
    write(path.join(bundle, '.next/BUILD_ID'), version + '-build\n');
    for (const pkg of ['next', 'express']) write(path.join(bundle, 'node_modules', pkg, 'package.json'), '{"name":"' + pkg + '","version":"0.0.0-synthetic"}\n');
    write(path.join(bundle, 'node_modules/fictional-dependency/index.js'), 'module.exports = ' + JSON.stringify(version + '-dependency') + ';\n');
    write(path.join(bundle, 'node_modules/.bin/fixture-target.js'), 'synthetic executable\n');
    fs.symlinkSync('fixture-target.js', path.join(bundle, 'node_modules/.bin/fixture'));
    const config = path.join(master.directory, version + '-configuration.json');
    write(config, JSON.stringify({ version: version + '-configuration', syntheticOnly: true }));
    master.configurations[version + '-configuration'] = config;
    const options = { storeRoot: master.store, bundleDirectory: bundle, sourceRepository: repository, sourceSha: sha, configuration: { version: version + '-configuration', digest: digest(fs.readFileSync(config)) } };
    master[version] = { ...(await prepareRelease(options)), options };
  }
});
test.after(() => { if (master?.directory) fs.rmSync(master.directory, { recursive: true, force: true }); });

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'doctarx-immutable-case-'));
  const store = path.join(directory, 'store');
  fs.cpSync(master.store, store, { recursive: true, verbatimSymlinks: true });
  fs.symlinkSync('releases/' + master.old.releaseId, path.join(store, 'current'));
  write(path.join(directory, 'SYNTHETIC_RELEASE_TEST'), 'synthetic only\n');
  const configurations = {};
  for (const [version, source] of Object.entries(master.configurations)) {
    const destination = path.join(directory, version + '.json'); fs.copyFileSync(source, destination); configurations[version] = destination;
  }
  const selection = { storeRoot: store, expectedCurrent: { releaseId: master.old.releaseId, digest: master.old.digest }, candidate: { releaseId: master.new.releaseId, digest: master.new.digest } };
  const plan = planPromotion(selection);
  return { directory, store, configurations, selection, plan, options: { ...selection, planDigest: plan.planDigest }, cleanup() { fs.rmSync(directory, { recursive: true, force: true }); } };
}
async function startOld(f, extra = {}) {
  const adapter = createFixtureAdapter({ root: f.directory, configurations: f.configurations, ...extra });
  await adapter.start({ release: f.plan.from, operationId: 'synthetic-bootstrap' });
  return adapter;
}
function tuple(version) { return { backend: version, frontend: version + '-build', dependency: version + '-dependency', configuration: version + '-configuration' }; }

function releaseDirectory(f, version) { return path.join(f.store, 'releases', master[version].releaseId); }

test('serving activation requires intact selected content, external state and exact configuration', () => {
  const f = fixture();
  try {
    const policy = require('../utils/runtimeStatePolicy');
    const state = path.join(f.directory, 'state'); fs.mkdirSync(state);
    const options = { releaseRoot: f.plan.from.directory, env: {
      DOCTARX_EXPECTED_RELEASE_DIGEST: f.plan.from.digest, DOCTARX_RELEASE_STORE_ROOT: f.store,
      DOCTARX_CONFIG_VERSION: f.plan.from.configuration.version, DOCTARX_CONFIG_DIGEST: f.plan.from.configuration.digest,
      DOCTARX_STATE_ROOT: state, DOCTARX_RELEASE_HEALTH_TOKEN: 'a'.repeat(64),
    } };
    assert.deepEqual(policy.assertServingModeSupported(options), expectedIdentity(f.plan.from));
    assert.throws(() => policy.assertServingModeSupported({ ...options, env: { ...options.env, DOCTARX_CONFIG_DIGEST: 'b'.repeat(64) } }), { code: 'IMMUTABLE_SELECTION_MISMATCH' });
    assert.throws(() => policy.assertServingModeSupported({ ...options, env: { ...options.env, DOCTARX_STATE_ROOT: f.store } }), { code: 'RUNTIME_STATE_OVERLAP' });
    fs.appendFileSync(path.join(f.plan.from.directory, 'server/index.js'), '\n// changed');
    assert.throws(() => policy.assertServingModeSupported(options), { code: 'BUNDLE_MISMATCH' });
  } finally { f.cleanup(); }
});

test('generated public WASM assets must match the installed locked dependency', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'doctarx-generated-assets-'));
  try {
    const bundle = path.join(directory, 'bundle');
    fs.cpSync(master.old.options.bundleDirectory, bundle, { recursive: true, verbatimSymlinks: true });
    write(path.join(bundle, 'node_modules/@mediapipe/tasks-vision/wasm/vision.wasm'), 'fictional dependency bytes');
    const asset = path.join(bundle, 'public/mediapipe-wasm/vision.wasm');
    write(asset, 'fictional dependency bytes');
    assert.ok(createManifest({ ...master.old.options, bundleDirectory: bundle }).digest);
    fs.writeFileSync(asset, 'tampered');
    assert.throws(() => createManifest({ ...master.old.options, bundleDirectory: bundle }), { code: 'GENERATED_ASSET_MISMATCH' });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('preparation preserves complete source, frontend, dependency, runtime/config and migration identity', async () => {
  for (const version of ['old', 'new']) {
    const prepared = master[version];
    const manifest = verifyBundle(prepared.directory, prepared.digest, { matchRuntime: true });
    assert.equal(manifest.source.sha, prepared.options.sourceSha);
    assert.equal(manifest.buildId, version + '-build');
    assert.match(manifest.runtime.nodeBinarySha256, /^[a-f0-9]{64}$/);
    assert.match(manifest.runtime.modulesAbi, /^\d+$/);
    assert.match(manifest.migrationDigest, /^[a-f0-9]{64}$/);
    assert.equal(manifest.configuration.version, version + '-configuration');
    assert.equal(fs.readlinkSync(path.join(prepared.directory, 'node_modules/.bin/fixture')), 'fixture-target.js');
    assert.equal(fs.existsSync(path.join(prepared.directory, '.git')), false);
  }
  assert.equal((await prepareRelease(master.old.options)).reused, true);
});

test('preparation rejects uncommitted source, external symlinks, hardlinks and secret/mutable paths', async () => {
  for (const mutation of [
    bundle => fs.appendFileSync(path.join(bundle, 'server/index.js'), '\n// uncommitted'),
    bundle => fs.symlinkSync('/etc/passwd', path.join(bundle, 'external-link')),
    bundle => fs.linkSync(path.join(bundle, 'package.json'), path.join(bundle, 'hardlink')),
    bundle => write(path.join(bundle, '.env'), 'MUST_NOT_COPY=fictional'),
    bundle => write(path.join(bundle, 'uploads/record.txt'), 'must not copy mutable data'),
  ]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctarx-invalid-bundle-'));
    try {
      const bundle = path.join(dir, 'bundle'); fs.cpSync(master.old.options.bundleDirectory, bundle, { recursive: true, verbatimSymlinks: true }); mutation(bundle);
      assert.throws(() => createManifest({ ...master.old.options, bundleDirectory: bundle }));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('staged copy is reverified and failed preparation never publishes a corrupt release', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'doctarx-copy-failure-'));
  const original = fs.cpSync;
  try {
    fs.cpSync = (source, destination, options) => { original(source, destination, options); fs.appendFileSync(path.join(destination, 'node_modules/fictional-dependency/index.js'), '\n// corrupt copy'); };
    await assert.rejects(prepareRelease({ ...master.old.options, storeRoot: directory }), { code: 'BUNDLE_MISMATCH' });
    assert.deepEqual(fs.readdirSync(path.join(directory, 'releases')), []);
    assert.equal(fs.existsSync(path.join(directory, '.release-lock')), false);
  } finally { fs.cpSync = original; fs.rmSync(directory, { recursive: true, force: true }); }
});

test('whole-tree verification rejects changed dependencies, extra assets and tampered manifests', () => {
  for (const mutate of [
    dir => fs.appendFileSync(path.join(dir, 'node_modules/fictional-dependency/index.js'), ' changed'),
    dir => write(path.join(dir, 'public/unlisted.txt'), 'unlisted'),
    dir => fs.chmodSync(path.join(dir, 'server/index.js'), 0o755),
    dir => { const filename = path.join(dir, MANIFEST_FILE); const value = JSON.parse(fs.readFileSync(filename)); value.configuration.version = 'other'; fs.writeFileSync(filename, JSON.stringify(value)); },
  ]) {
    const f = fixture();
    try { const directory = releaseDirectory(f, 'new'); mutate(directory); assert.throws(() => verifyBundle(directory, master.new.digest)); }
    finally { f.cleanup(); }
  }
});

test('dry-run is read-only and rejects stale selection, wrong digest and malformed/nonterminal journal', async () => {
  const f = fixture();
  try {
    const before = fs.readdirSync(f.store).sort();
    const result = await cli(['plan', '--store', f.store, '--current-id', master.old.releaseId, '--current-digest', master.old.digest, '--candidate-id', master.new.releaseId, '--candidate-digest', master.new.digest]);
    assert.equal(result.productionPromotionAvailable, false);
    assert.equal(result.status, 'dry-run-only');
    assert.deepEqual(fs.readdirSync(f.store).sort(), before);
    assert.throws(() => planPromotion({ ...f.selection, expectedCurrent: f.selection.candidate }), { code: 'CURRENT_CHANGED' });
    assert.throws(() => planPromotion({ ...f.selection, candidate: { ...f.selection.candidate, digest: '0'.repeat(64) } }), { code: 'UNTRUSTED_MANIFEST' });
    write(path.join(f.store, 'journal.json'), '{truncated');
    assert.throws(() => planPromotion(f.selection), { code: 'INVALID_JOURNAL' });
  } finally { f.cleanup(); }
});

test('CLI has no promote, rollback, recovery, bootstrap or environment override', async () => {
  for (const command of ['promote', 'rollback', 'recover', 'bootstrap']) await assert.rejects(cli([command]), { code: 'LIVE_PROMOTION_UNAVAILABLE' });
  await assert.rejects(cli(['inspect', '--store', master.store, '--force', 'true']), { code: 'INVALID_ARGUMENTS' });
});

test('actual child-process promotion selects one coherent full release and retains prior bundle', async () => {
  const f = fixture(); const seen = []; const adapter = await startOld(f, { onTuple: actual => seen.push(actual) });
  try {
    assert.deepEqual(await adapter.health({ release: f.plan.from }), expectedIdentity(f.plan.from));
    const result = await promoteRelease({ ...f.options, adapter });
    assert.equal(result.status, 'succeeded');
    assert.equal(inspectStore(f.store).current, master.new.releaseId);
    assert.equal(inspectStore(f.store).journal.phase, 'succeeded');
    assert.deepEqual(await adapter.inspect(), expectedIdentity(f.plan.to));
    assert.ok(seen.some(actual => canonical(actual) === canonical(tuple('old'))));
    assert.ok(seen.some(actual => canonical(actual) === canonical(tuple('new'))));
    assert.ok(seen.every(actual => ['old', 'new'].some(version => canonical(actual) === canonical(tuple(version)))));
    verifyBundle(releaseDirectory(f, 'old'), master.old.digest);
  } finally { await adapter.cleanup(); f.cleanup(); }
});

for (const failure of ['health', 'start']) test('actual ' + failure + ' failure restores complete backend/frontend/dependency/config identity', async () => {
  const f = fixture(); const seen = []; const adapter = await startOld(f, { onTuple: actual => seen.push(actual), ...(failure === 'health' ? { failHealthFor: master.new.releaseId } : { failStartFor: master.new.releaseId }) });
  try {
    await assert.rejects(promoteRelease({ ...f.options, adapter }), { code: 'PROMOTION_ROLLED_BACK' });
    assert.equal(inspectStore(f.store).current, master.old.releaseId);
    assert.equal(inspectStore(f.store).journal.phase, 'rolled-back');
    assert.deepEqual(await adapter.inspect(), expectedIdentity(f.plan.from));
    assert.deepEqual(seen.at(-1), tuple('old'));
    assert.ok(seen.every(actual => ['old', 'new'].some(version => canonical(actual) === canonical(tuple(version)))));
  } finally { await adapter.cleanup(); f.cleanup(); }
});

test('missing configuration or compatibility fails before any process stop or journal write', async () => {
  for (const failure of ['configuration', 'compatibility']) {
    const f = fixture(); const adapter = await startOld(f);
    try {
      if (failure === 'configuration') write(f.configurations['new-configuration'], '{"version":"changed"}');
      else adapter.assertCompatibility = async () => ({ compatible: true, previousDigest: '0'.repeat(64) });
      await assert.rejects(promoteRelease({ ...f.options, adapter }), { code: failure === 'configuration' ? 'CONFIGURATION_MISMATCH' : 'COMPATIBILITY_UNPROVEN' });
      assert.equal(inspectStore(f.store).journal, null);
      assert.deepEqual(await adapter.inspect(), expectedIdentity(f.plan.from));
    } finally { await adapter.cleanup(); f.cleanup(); }
  }
});

test('unproven quiescence and failed rollback health require recovery and block another promotion', async () => {
  for (const failure of ['stop', 'rollback-health']) {
    const f = fixture(); const adapter = await startOld(f, failure === 'stop' ? { failStop: true } : { failHealthFor: master.new.releaseId, failRollbackHealthFor: master.old.releaseId });
    try {
      await assert.rejects(promoteRelease({ ...f.options, adapter }), { code: 'RECOVERY_REQUIRED' });
      assert.equal(inspectStore(f.store).journal.phase, 'recovery-required');
      await assert.rejects(promoteRelease({ ...f.options, adapter }), { code: 'RELEASE_BUSY' });
      assert.deepEqual(await adapter.inspect(), expectedIdentity(f.plan.from));
    } finally { await adapter.cleanup(); f.cleanup(); }
  }
});

test('interrupted recovery refuses changed compatibility evidence without touching the writer', async () => {
  const f = fixture(); const adapter = await startOld(f, { failStop: true });
  try {
    await assert.rejects(promoteRelease({ ...f.options, adapter }), { code: 'RECOVERY_REQUIRED' });
    const original = adapter.assertCompatibility;
    const before = inspectStore(f.store);
    assert.equal((await planInterruptedRecovery({ storeRoot: f.store, adapter })).requiresExclusiveFence, true);
    for (const field of ['schemaDigest', 'evidenceDigest']) {
      adapter.assertCompatibility = async args => ({ ...await original(args), [field]: '7'.repeat(64) });
      await assert.rejects(planInterruptedRecovery({ storeRoot: f.store, adapter }), { code: 'COMPATIBILITY_CHANGED' });
      assert.deepEqual(inspectStore(f.store), before);
      assert.deepEqual(await adapter.inspect(), expectedIdentity(f.plan.from));
    }
  } finally { await adapter.cleanup(); f.cleanup(); }
});

test('rollback refuses modified previous content instead of starting a mixed release', async () => {
  const f = fixture(); const adapter = await startOld(f);
  const originalHealth = adapter.health;
  adapter.health = async input => {
    if (input.release.releaseId === master.new.releaseId) {
      fs.appendFileSync(path.join(releaseDirectory(f, 'old'), 'node_modules/fictional-dependency/index.js'), '\n// changed');
      throw Object.assign(new Error('Failed candidate'), { code: 'HEALTH_FAILED' });
    }
    return originalHealth(input);
  };
  try {
    await assert.rejects(promoteRelease({ ...f.options, adapter }), { code: 'RECOVERY_REQUIRED' });
    assert.equal(await adapter.inspect(), null);
    assert.equal(inspectStore(f.store).journal.phase, 'recovery-required');
  } finally { await adapter.cleanup(); f.cleanup(); }
});

test('a foreign observed process is not stopped or replaced during failure recovery', async () => {
  const f = fixture(); const adapter = await startOld(f);
  const inspect = adapter.inspect; let foreign = false, stopAfterForeign = 0;
  const quiesce = adapter.quiesce;
  adapter.health = async () => { foreign = true; throw new Error('Synthetic identity changed'); };
  adapter.inspect = async () => foreign ? { ...expectedIdentity(f.plan.to), buildId: 'foreign-build' } : inspect();
  adapter.quiesce = async args => { if (foreign) stopAfterForeign += 1; return quiesce(args); };
  try {
    await assert.rejects(promoteRelease({ ...f.options, adapter }), { code: 'RECOVERY_REQUIRED' });
    assert.equal(stopAfterForeign, 0);
    assert.deepEqual(await inspect(), expectedIdentity(f.plan.to));
  } finally { await adapter.cleanup(); f.cleanup(); }
});

const crashCheckpoints = ['before-quiesce', 'after-quiesce', 'before-start', 'after-spawn', 'after-start', 'before-health', 'after-health', 'target-before-rename', 'target-after-rename'];
for (const phase of ['prepared', 'stopping-current', 'current-stopped', 'selecting-candidate', 'starting-candidate', 'verifying-candidate', 'succeeded', 'rolling-back', 'selecting-previous', 'starting-previous', 'verifying-previous', 'rolled-back', 'recovery-required']) {
  for (const boundary of ['before', 'after']) crashCheckpoints.push(`journal-${phase}-${boundary}-rename`);
}
for (const checkpoint of crashCheckpoints) {
  test('coordinator termination at ' + checkpoint + ' leaves a hard blocker and never starts a second writer', async () => {
    const f = fixture(); const adapter = await startOld(f);
    try {
      const rollbackCheckpoint = /journal-(rolling-back|selecting-previous|starting-previous|verifying-previous|rolled-back)/.test(checkpoint);
      const settings = { promotion: f.options, adapter: { root: f.directory, configurations: f.configurations, crashAt: checkpoint, ...(rollbackCheckpoint ? { failHealthFor: master.new.releaseId } : {}), ...(checkpoint.includes('recovery-required') ? { failStop: true } : {}) } };
      const settingsPath = path.join(f.directory, 'operation.json'); write(settingsPath, JSON.stringify(settings));
      const result = spawnSync(process.execPath, [path.join(__dirname, 'fixtures/immutable-release/run-operation.cjs'), settingsPath], { encoding: 'utf8', timeout: 20000 });
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.signal, 'SIGKILL', result.stderr);
      const state = inspectStore(f.store);
      assert.equal(state.locked, true);
      assert.equal(state.blocked, true);
      assert.ok([master.old.releaseId, master.new.releaseId].includes(state.current));
      if (state.journal && !['succeeded', 'rolled-back'].includes(state.journal.phase)) {
        const recovery = await planInterruptedRecovery({ storeRoot: f.store, adapter });
        assert.equal(recovery.requiresExclusiveFence, true);
        assert.equal(recovery.restore.releaseId, master.old.releaseId);
      } else {
        await assert.rejects(planInterruptedRecovery({ storeRoot: f.store, adapter }), { code: 'NO_INTERRUPTED_RELEASE' });
      }
      const actual = await adapter.inspect();
      assert.ok(actual === null || [f.plan.from, f.plan.to].some(release => canonical(actual) === canonical(expectedIdentity(release))));
      await assert.rejects(promoteRelease({ ...f.options, adapter }), { code: 'RELEASE_BUSY' });
    } finally { await adapter.cleanup(); f.cleanup(); }
  });
}

test('extra shadowing source and nested secret paths cannot claim the accepted source tree', () => {
  for (const relative of ['server/db.js', 'server/.env', 'ng/keys/private.key']) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'doctarx-source-boundary-'));
    try {
      fs.cpSync(master.old.options.bundleDirectory, directory, { recursive: true, verbatimSymlinks: true });
      write(path.join(directory, relative), 'synthetic extra content');
      assert.throws(() => createManifest({ ...master.old.options, bundleDirectory: directory }), { code: relative === 'server/db.js' ? 'UNTRACKED_SOURCE' : 'FORBIDDEN_BUNDLE_CONTENT' });
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
});

test('overlapping preparation roots are refused before modifying the source', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'doctarx-overlap-'));
  try {
    fs.cpSync(master.old.options.bundleDirectory, directory, { recursive: true, verbatimSymlinks: true });
    const before = fs.readdirSync(directory).sort();
    await assert.rejects(prepareRelease({ ...master.old.options, bundleDirectory: directory, storeRoot: directory }), { code: 'OVERLAPPING_ROOTS' });
    assert.deepEqual(fs.readdirSync(directory).sort(), before);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('FIFO and dangling control files fail promptly rather than blocking or disappearing', () => {
  for (const kind of ['manifest-fifo', 'journal-fifo', 'journal-dangling']) {
    const f = fixture();
    try {
      const filename = kind.startsWith('manifest') ? path.join(releaseDirectory(f, 'new'), MANIFEST_FILE) : path.join(f.store, 'journal.json');
      if (fs.existsSync(filename)) fs.unlinkSync(filename);
      if (kind.endsWith('dangling')) fs.symlinkSync('missing-journal', filename);
      else execFileSync('mkfifo', [filename]);
      const code = kind.startsWith('manifest')
        ? `require(${JSON.stringify(path.join(root, 'scripts/release/manifest.cjs'))}).verifyBundle(${JSON.stringify(releaseDirectory(f, 'new'))},${JSON.stringify(master.new.digest)})`
        : `require(${JSON.stringify(path.join(root, 'scripts/release/store.cjs'))}).inspectStore(${JSON.stringify(f.store)})`;
      const result = spawnSync(process.execPath, ['-e', `try{${code};process.exit(1)}catch(error){process.stdout.write(error.code||'UNKNOWN');process.exit(42)}`], { encoding: 'utf8', timeout: 2000 });
      assert.equal(result.error, undefined, 'control file inspection must not hang');
      assert.equal(result.status, 42);
      assert.equal(result.stdout, kind.startsWith('manifest') ? 'UNSAFE_FILE' : 'INVALID_JOURNAL');
    } finally { f.cleanup(); }
  }
});

test('a timed-out spawned candidate is fenced and killed before the prior process restarts', async () => {
  const f = fixture();
  const adapter = await startOld(f, { delayedStartFor: master.new.releaseId, startDelayMs: 2500, startTimeoutMs: 1000 });
  try {
    await assert.rejects(promoteRelease({ ...f.options, adapter }), error => {
      if (error.code !== 'PROMOTION_ROLLED_BACK') console.error('Synthetic pending-start phases:', inspectStore(f.store).journal?.history);
      assert.equal(error.code, 'PROMOTION_ROLLED_BACK'); return true;
    });
    assert.deepEqual(await adapter.inspect(), expectedIdentity(f.plan.from));
    assert.equal(inspectStore(f.store).journal.phase, 'rolled-back');
    await new Promise(resolve => setTimeout(resolve, 2600));
    assert.deepEqual(await adapter.inspect(), expectedIdentity(f.plan.from), 'timed-out candidate cannot appear after rollback');
  } finally { await adapter.cleanup(); f.cleanup(); }
});

test('terminal journal fsync plus recovery-write failures retain an independent operation lock', async () => {
  const f = fixture(); const adapter = await startOld(f);
  const originalFsync = fs.fsyncSync, originalOpen = fs.openSync;
  let injected = false;
  try {
    fs.fsyncSync = fd => {
      const target = fs.readlinkSync(`/proc/self/fd/${fd}`);
      const journalPath = path.join(f.store, 'journal.json');
      if (!injected && target === f.store && fs.existsSync(journalPath) && JSON.parse(fs.readFileSync(journalPath, 'utf8')).phase === 'succeeded') {
        injected = true; throw Object.assign(new Error('Synthetic directory fsync failure'), { code: 'EIO' });
      }
      return originalFsync(fd);
    };
    fs.openSync = (filename, ...args) => {
      if (injected && typeof filename === 'string' && path.dirname(filename) === f.store && path.basename(filename).startsWith('.journal.json.')) throw Object.assign(new Error('Synthetic recovery journal failure'), { code: 'EIO' });
      return originalOpen(filename, ...args);
    };
    await assert.rejects(promoteRelease({ ...f.options, adapter }), { code: 'RECOVERY_REQUIRED' });
    assert.equal(injected, true);
    assert.equal(inspectStore(f.store).journal.phase, 'succeeded', 'terminal rename happened before the injected uncertainty');
    assert.equal(inspectStore(f.store).locked, true);
    assert.equal(inspectStore(f.store).blocked, true);
    await assert.rejects(promoteRelease({ ...f.options, adapter }), { code: 'RELEASE_BUSY' });
  } finally { fs.fsyncSync = originalFsync; fs.openSync = originalOpen; await adapter.cleanup(); f.cleanup(); }
});

test('completed evidence is archived and malformed terminal records block later promotion', async () => {
  const f = fixture(); const adapter = await startOld(f);
  try {
    const first = await promoteRelease({ ...f.options, adapter });
    const reverse = { storeRoot: f.store, expectedCurrent: f.selection.candidate, candidate: f.selection.expectedCurrent };
    const reversePlan = planPromotion(reverse);
    await promoteRelease({ ...reverse, planDigest: reversePlan.planDigest, adapter });
    const archived = JSON.parse(fs.readFileSync(path.join(f.store, 'journals', first.operationId + '.json')));
    assert.equal(archived.phase, 'succeeded');
    const filename = path.join(f.store, 'journal.json');
    const value = JSON.parse(fs.readFileSync(filename)); delete value.planDigest;
    fs.writeFileSync(filename, JSON.stringify(value));
    assert.throws(() => inspectStore(f.store), { code: 'INVALID_JOURNAL' });
  } finally { await adapter.cleanup(); f.cleanup(); }
});


test('a retry re-syncs a verified release after publication rename succeeded but parent fsync failed', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'doctarx-publish-durability-'));
  const original = fs.fsyncSync;
  let injected = false, parentSyncs = 0;
  try {
    fs.fsyncSync = fd => {
      if (fs.readlinkSync(`/proc/self/fd/${fd}`) === path.join(directory, 'releases')) {
        parentSyncs += 1;
        if (!injected && fs.existsSync(path.join(directory, 'releases', master.old.releaseId))) {
          injected = true; throw Object.assign(new Error('Synthetic publication fsync failure'), { code: 'EIO' });
        }
      }
      return original(fd);
    };
    await assert.rejects(prepareRelease({ ...master.old.options, storeRoot: directory }), { code: 'EIO' });
    assert.equal(injected, true);
    const retried = await prepareRelease({ ...master.old.options, storeRoot: directory });
    assert.equal(retried.reused, true);
    assert.ok(parentSyncs >= 2, 'retry cannot report durable success without syncing publication directory');
    verifyBundle(retried.directory, retried.digest);
  } finally { fs.fsyncSync = original; fs.rmSync(directory, { recursive: true, force: true }); }
});

}
if (process.platform === 'linux') registerLinuxTests();
else test('immutable release requires Linux process and durable-filesystem fixtures', { skip: 'Run the production-profile tests on Linux' }, () => {});
