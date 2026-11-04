'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { once } = require('node:events');
const policy = require('../utils/runtimeStatePolicy');
const schema = require('../db/verifyMigrationHistory');
const { startCandidateServer } = require('../runtime/candidateServer');
const root = path.resolve(__dirname, '../..');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const expected = { core: [{ name: 'core-1', checksum: hash('core SQL') }], ng: [{ name: 'ng-1.sql', checksum: hash('ng SQL') }] };
const matching = () => Object.entries(expected).flatMap(([namespace, rows]) => rows.map(row => ({ ...row, namespace })));
function fakePool(rows = matching(), { queryFailure, rollbackFailure, readOnly = 'on' } = {}) {
  const trace = [], releases = [];
  return { trace, releases, async connect() { return {
    async query(sql, values) {
      trace.push({ sql, values });
      assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
      if (sql === 'ROLLBACK' && rollbackFailure) throw new Error('Synthetic rollback failure');
      if (sql === 'SHOW transaction_read_only') return { rows: [{ transaction_read_only: readOnly }] };
      if (sql.includes('FROM public.migrations')) {
        if (queryFailure) throw Object.assign(new Error('SYNTHETIC_PRIVATE_DATABASE_DETAIL'), { code: '42P01' });
        return { rows };
      }
      return { rows: [] };
    },
    release(destroy) { releases.push(destroy); },
  }; }, async end() {} };
}

test('both histories are checked in one bounded read-only transaction without running migrations', async () => {
  const pool = fakePool();
  const result = await schema.verifyMigrationHistory(pool, expected);
  assert.equal(result.migrationHistoryVerified, true);
  assert.equal(result.applicationSchemaVerified, false);
  assert.equal(result.dataCompatibilityVerified, false);
  assert.equal(pool.trace[0].sql, 'BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');
  assert.equal(pool.trace.at(-1).sql, 'COMMIT');
  assert.equal(pool.trace.filter(entry => entry.sql.includes('FROM public.migrations')).length, 1);
  assert.deepEqual(pool.trace.filter(entry => entry.sql.includes('pg_advisory_xact_lock_shared')).map(entry => entry.values[0]), schema.LOCKS);
  assert.deepEqual(pool.trace.filter(entry => entry.sql.includes('set_config')).map(entry => entry.values), [['lock_timeout', 2000], ['statement_timeout', 5000]]);
  assert.deepEqual(pool.releases, [false]);
});

for (const [name, rows, code] of [
  ['pending', matching().slice(0, 1), 'MIGRATION_HISTORY_PENDING'],
  ['legacy checksum', matching().map(row => ({ ...row, checksum: null })), 'MIGRATION_HISTORY_UNVERIFIED'],
  ['drift', matching().map(row => ({ ...row, checksum: '0'.repeat(64) })), 'MIGRATION_HISTORY_DRIFT'],
  ['duplicate', [...matching(), matching()[0]], 'MIGRATION_HISTORY_INVALID'],
  ['unknown future history', [...matching(), { namespace: 'core', name: 'newer', checksum: hash('newer') }], 'MIGRATION_HISTORY_NEWER_OR_UNKNOWN'],
]) test('read-only history refuses ' + name + ' without repair or checksum adoption', async () => {
  const pool = fakePool(rows);
  await assert.rejects(schema.verifyMigrationHistory(pool, expected), { code });
  assert.equal(pool.trace.at(-1).sql, 'ROLLBACK');
  assert.deepEqual(pool.releases, [true]);
});

test('missing schema, non-read-only sessions and cleanup failure cannot produce readiness', async () => {
  for (const options of [{ queryFailure: true }, { queryFailure: true, rollbackFailure: true }, { readOnly: 'off' }]) {
    const pool = fakePool(matching(), options);
    await assert.rejects(schema.verifyMigrationHistory(pool, expected), error => {
      assert.match(error.code, /^SCHEMA_CHECK_/);
      assert.doesNotMatch(error.message, /PRIVATE/);
      return true;
    });
    assert.deepEqual(pool.releases, [true]);
  }
});

test('candidate database config enforces remote TLS and refuses unhandled security options', async () => {
  const pool = schema.createSchemaCheckPool({ DATABASE_URL: 'postgresql://fictional:password@example.invalid/db?sslmode=require', NODE_ENV: 'production' });
  assert.equal(pool.options.ssl.rejectUnauthorized, true);
  assert.equal(pool.options.ssl.servername, 'example.invalid');
  assert.equal(typeof pool.options.ssl.checkServerIdentity, 'function');
  assert.equal(pool.options.max, 1);
  assert.equal(pool.options.connectionTimeoutMillis, 5000);
  await pool.end();
  for (const suffix of ['sslmode=disable', 'sslmode=no-verify', 'options=unsafe', 'sslrootcert=unknown', 'channel_binding=require']) {
    assert.throws(() => schema.createSchemaCheckPool({ DATABASE_URL: 'postgresql://fictional:password@example.invalid/db?' + suffix }), error => error.code.startsWith('SCHEMA_CHECK_'));
  }
});

async function startCheck(options = {}) {
  const check = startCandidateServer({ port: 0, env: { DOCTARX_RELEASE_DIGEST: 'a'.repeat(64) },
    verifyArtifact: () => ({ releaseId: 'fictional-release', buildId: '-fictional-build', source: { sha: 'b'.repeat(40) } }),
    createPool: () => fakePool(), verifyHistory: pool => schema.verifyMigrationHistory(pool, expected), ...options });
  if (!check.server.listening) await once(check.server, 'listening');
  return check;
}

test('candidate HTTP reports narrow checks but never pretends API/Next serving readiness', async () => {
  const check = await startCheck();
  try {
    await check.verification;
    const base = `http://127.0.0.1:${check.server.address().port}`;
    assert.equal(check.server.address().address, '127.0.0.1');
    for (const route of ['/api/health', '/api/ng/health', '/api/release-check']) {
      const response = await fetch(base + route); const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.status, 'checks_passed');
      for (const field of ['initialized', 'nextReady', 'servingReady', 'productionReady', 'applicationSchemaVerified', 'dataCompatibilityVerified']) assert.equal(body[field], false);
    }
    assert.equal((await fetch(base + '/readyz')).status, 503);
    assert.equal((await fetch(base + '/api/social/post/id/publish-now', { method: 'POST' })).status, 503);
    assert.equal((await fetch(base + '/socket.io/?EIO=4&transport=polling')).status, 503);
    assert.equal(check.server.listenerCount('upgrade'), 0);
  } finally { await check.close(); }
});

test('candidate requires artifact acceptance before DB connection and successful cleanup before check success', async () => {
  let connected = 0;
  const failed = await startCheck({ verifyArtifact: () => { throw Object.assign(new Error('SYNTHETIC_PRIVATE_PATH'), { code: 'UNTRUSTED_MANIFEST' }); }, createPool: () => { connected += 1; return fakePool(); } });
  try {
    await failed.verification; assert.equal(connected, 0);
    const response = await fetch(`http://127.0.0.1:${failed.server.address().port}/api/release-check`);
    assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /PRIVATE/);
  } finally { await failed.close(); }
  let finish;
  const pending = await startCheck({ createPool: () => ({ ...fakePool(), end: () => new Promise(resolve => { finish = resolve; }) }) });
  try {
    while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(pending.getState().preflightComplete, false);
    finish(); await pending.verification;
    assert.equal(pending.getState().preflightComplete, true);
  } finally { await pending.close(); }
  const badCleanup = await startCheck({ createPool: () => ({ ...fakePool(), async end() { throw new Error('PRIVATE'); } }) });
  try { await badCleanup.verification; assert.equal(badCleanup.getState().preflightComplete, false); assert.equal(badCleanup.getState().failureCode, 'SCHEMA_CHECK_CLEANUP_FAILED'); }
  finally { await badCleanup.close(); }
});

test('actual server entrypoint branches before routes, migrations, telemetry or realtime modules', () => {
  const source = fs.readFileSync(path.join(root, 'server/index.js'), 'utf8');
  for (const sealed of [false, true]) {
    const imported = []; const isolated = { exports: {} }; const candidate = { checkOnly: true };
    vm.runInNewContext(source, {
      module: isolated, process: { env: { DOCTARX_DEPLOY_CHECK: 'true', SENTRY_DSN: 'fictional' } },
      require(name) {
        imported.push(name);
        if (name === './utils/runtimeStatePolicy') return { immutableRuntime: () => sealed, assertServingModeSupported() { assert.fail('candidate must not enter serving path'); } };
        if (name === 'dotenv' && !sealed) return { config() {} };
        if (name === './runtime/candidateServer') return { startCandidateServer: () => candidate };
        assert.fail('Candidate must not import ' + name);
      },
    });
    assert.equal(isolated.exports, candidate);
    assert.deepEqual(imported, sealed ? ['./utils/runtimeStatePolicy', './runtime/candidateServer'] : ['./utils/runtimeStatePolicy', 'dotenv', './runtime/candidateServer']);
  }
});

function directories() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'doctarx-runtime-state-'));
  const release = path.join(directory, 'release'), state = path.join(directory, 'state');
  fs.mkdirSync(release); fs.mkdirSync(state);
  return { directory, release, state, options: { releaseRoot: release, env: { DOCTARX_IMMUTABLE_RELEASE: 'true', DOCTARX_STATE_ROOT: state } }, cleanup() { fs.rmSync(directory, { recursive: true, force: true }); } };
}

test('legacy paths stay unchanged and external private agent state stays outside public uploads', () => {
  const f = directories();
  try {
    const legacy = { releaseRoot: f.release, env: {} };
    assert.equal(policy.runtimePath('publicUploads', legacy), path.join(f.release, 'uploads'));
    assert.equal(policy.runtimePath('agentChat', legacy), path.join(f.release, 'server/uploads/agent-chat'));
    assert.equal(policy.runtimePath('agentChat', f.options), path.join(f.state, 'private/agent-chat'));
    assert.equal(policy.runtimePath('publicUploads', f.options), path.join(f.state, 'public/uploads'));
    assert.deepEqual(fs.readdirSync(f.state), [], 'resolution itself must not create state');
    policy.ensureRuntimeDirectory('agentChat', f.options);
    assert.equal(fs.existsSync(path.join(f.release, 'server/uploads')), false);
    assert.equal(fs.lstatSync(path.join(f.state, 'private/agent-chat')).mode & 0o777, 0o700);
  } finally { f.cleanup(); }
});

test('sealed source cannot opt out or fall back, and invalid external paths fail before mkdir', () => {
  const f = directories();
  try {
    fs.writeFileSync(path.join(f.release, 'release-manifest.json'), '{}');
    assert.equal(policy.immutableRuntime({ releaseRoot: f.release, env: { DOCTARX_IMMUTABLE_RELEASE: 'false' } }), true);
    assert.throws(() => policy.runtimePath('agentChat', { releaseRoot: f.release, env: {} }), { code: 'RUNTIME_STATE_UNCONFIGURED' });
    assert.throws(() => policy.assertServingModeSupported({ releaseRoot: f.release, env: {} }), { code: 'IMMUTABLE_SERVING_UNVERIFIED' });
    for (const stateRoot of ['relative-state', '/', f.release, f.directory]) {
      assert.throws(() => policy.ensureRuntimeDirectory('agentChat', { releaseRoot: f.release, env: { DOCTARX_STATE_ROOT: stateRoot } }));
    }
    fs.mkdirSync(path.join(f.state, 'private'));
    fs.symlinkSync('private', path.join(f.state, 'public'));
    assert.throws(() => policy.ensureRuntimeDirectory('agentChat', f.options), { code: 'RUNTIME_STATE_UNSAFE' });
    assert.equal(fs.existsSync(path.join(f.state, 'private/agent-chat')), false);
  } finally { f.cleanup(); }
});

test('candidate mode cannot create state even under an otherwise valid external root', () => {
  const f = directories();
  try {
    assert.throws(() => policy.ensureRuntimeDirectory('agentChat', { ...f.options, env: { ...f.options.env, DOCTARX_DEPLOY_CHECK: 'true' } }), { code: 'CHECK_ONLY_WRITE_BLOCKED' });
    assert.deepEqual(fs.readdirSync(f.state), []);
  } finally { f.cleanup(); }
});

function blockedIde() {
  const filename = path.join(root, 'server/services/agentIdeService.js'); const isolatedModule = { exports: {} }; const touched = [];
  const trap = name => () => { touched.push(name); throw new Error('Unexpected side effect'); };
  const options = { env: { DOCTARX_IMMUTABLE_RELEASE: 'true' }, releaseRoot: root };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: isolatedModule, __dirname: path.dirname(filename), process: { env: {} }, console: { log() {}, error() {} },
    require(name) {
      if (name === 'path') return path;
      if (name === 'fs') return new Proxy({}, { get: (_target, key) => trap('fs.' + String(key)) });
      if (name === 'child_process') return { execSync: trap('exec'), spawn: trap('spawn') };
      if (name === '../utils/runtimeStatePolicy') return { assertCodeMutationAllowed: operation => policy.assertCodeMutationAllowed(operation, options) };
      if (name === '../db') return { query: trap('query') };
      throw new Error('Unexpected dependency: ' + name);
    },
  });
  return { service: isolatedModule.exports, touched };
}

test('every IDE source mutation, execution, git mutation and arbitrary SQL entry refuses first', async () => {
  const { service, touched } = blockedIde();
  const calls = {
    writeFile: ['server/test.js', 'x'], createFile: ['server/test.js'], deleteFile: ['server/test.js'],
    executeCode: ['x'], spawnProcess: ['x'], getLintErrors: [], gitAdd: [], gitCommit: ['x'], gitPush: [], gitPull: [],
    gitDiff: ['$(touch /tmp/never-executed)'], gitLog: ['1; echo forbidden'], gitStatus: [], gitBranches: [], gitRemoteInfo: [],
    gitCreateBranch: ['x'], gitCheckout: ['x'], gitCommitAndPush: ['x'], dbQuery: ['SELECT 1'], dbExecute: ['CREATE TABLE x(x int)', [], { approved: true }],
    createSubAgent: [{ name: 'x', agentType: 'x' }], createTool: ['x'], deactivateSubAgent: ['x'], killProcess: ['x'],
  };
  for (const [method, args] of Object.entries(calls)) {
    await assert.rejects(async () => service[method](...args), { code: 'IMMUTABLE_RUNTIME_MUTATION_BLOCKED' }, method);
  }
  assert.deepEqual(touched, []);
});

test('DevOps auto-fix and dynamic-skill writes/watchers cannot mutate sealed source', async () => {
  for (const file of ['server/services/agent-orchestrator/agents/devops-agent.js', 'server/services/agent-orchestrator/dynamic-skills.js']) {
    const filename = path.join(root, file); const isolatedModule = { exports: {} }; const touched = [];
    const trap = () => { touched.push('mutation'); throw new Error('Unexpected mutation'); };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      module: isolatedModule, __dirname: path.dirname(filename), process: { env: {} }, console: { log() {}, error() {} },
      setInterval: trap,
      require(name) {
        if (name === 'path') return path;
        if (name === 'crypto') return crypto;
        if (name === 'fs') return { existsSync: () => false, mkdirSync: trap, readFileSync: trap, writeFileSync: trap };
        if (name.endsWith('runtimeStatePolicy')) return { immutableRuntime: () => true, assertCodeMutationAllowed: operation => policy.assertCodeMutationAllowed(operation, { env: { DOCTARX_IMMUTABLE_RELEASE: 'true' } }) };
        if (name === '../base-agent') return class {};
        if (name.endsWith('/db') || name === '../../db') return {};
        throw new Error('Unexpected dependency: ' + name);
      },
    });
    if (file.includes('devops-agent')) await assert.rejects(isolatedModule.exports.prototype.applyFix.call({}, 'x', 'a', 'b', 'test'), { code: 'IMMUTABLE_RUNTIME_MUTATION_BLOCKED' });
    else {
      const loader = new isolatedModule.exports.DynamicSkillLoader({ register() {} });
      assert.equal(await loader.loadAll(), 0); loader.startWatching();
    }
    assert.deepEqual(touched, []);
  }
});

test('default migration definition loading has no dotenv, pool or environment read side effects', () => {
  const filename = path.join(root, 'server/db/migrate.js'); const isolatedModule = { exports: {} }; const imported = [];
  const definitionRequire = name => {
    imported.push(name);
    if (name === 'fs') return { readFileSync: fs.readFileSync };
    if (name === 'path') return path;
    if (name === 'crypto') return crypto;
    assert.fail('Definition import must not load configuration or database driver: ' + name);
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: isolatedModule, __dirname: path.dirname(filename), require: definitionRequire,
    process: new Proxy({}, { get() { assert.fail('Definition import must not inspect process configuration'); } }),
  });
  const entries = isolatedModule.exports.getMigrations();
  assert.ok(entries.length > 0);
  const normal = schema.loadExpectedHistory();
  assert.equal(normal.core.length, entries.length);
  assert.deepEqual(JSON.parse(JSON.stringify(entries.map(entry => ({ name: entry.name, checksum: hash(entry.up) })))), normal.core);
  assert.deepEqual(imported, ['fs', 'path', 'crypto']);
});

test('candidate refuses checking another release and binds default verification to its executing source', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'doctarx-other-release-'));
  let artifactCalls = 0;
  const mismatch = await startCheck({ directory, verifyArtifact() { artifactCalls++; assert.fail('Mismatched release cannot be verified'); } });
  try {
    await mismatch.verification;
    assert.equal(mismatch.getState().failureCode, 'BUNDLE_EXECUTION_ROOT_MISMATCH');
    assert.equal(mismatch.getState().preflightComplete, false);
    assert.equal(artifactCalls, 0);
  } finally { await mismatch.close(); fs.rmSync(directory, { recursive: true, force: true }); }
  const check = await startCheck({ verifyArtifact(actualDirectory) {
    assert.equal(fs.realpathSync(actualDirectory), fs.realpathSync(root));
    return { releaseId: 'fictional', buildId: 'fictional', source: { sha: 'a'.repeat(40) } };
  } });
  try { await check.verification; assert.equal(check.getState().preflightComplete, true); }
  finally { await check.close(); }
});

test('real Multer agent upload storage performs no eager mkdir and resolves destination lazily', () => {
  const source = fs.readFileSync(path.join(root, 'server/routes/agentChat.js'), 'utf8');
  const block = source.slice(source.indexOf("const { ensureRuntimeDirectory }"), source.indexOf('async function extractTextBestEffort'));
  const multer = require('multer');
  const originalMkdir = fs.mkdirSync; let created = 0; let resolved = 0; let upload;
  try {
    fs.mkdirSync = () => { created++; assert.fail('Import must not create upload storage'); };
    upload = vm.runInNewContext(block + '\nupload;', {
      multer, crypto, require(name) {
        assert.equal(name, '../utils/runtimeStatePolicy');
        return { ensureRuntimeDirectory(kind) { assert.equal(kind, 'agentChat'); resolved++; return '/fictional/private/agent-chat'; } };
      },
    });
    assert.equal(created, 0); assert.equal(resolved, 0);
    upload.storage.getDestination({}, {}, (error, destination) => { assert.equal(error, null); assert.equal(destination, '/fictional/private/agent-chat'); });
    assert.equal(resolved, 1);
  } finally { fs.mkdirSync = originalMkdir; }
});


test('ordinary unconfigured uploads retain existing symlink storage compatibility', () => {
  const f = directories();
  try {
    fs.mkdirSync(path.join(f.release, 'server'));
    fs.symlinkSync(f.state, path.join(f.release, 'server/uploads'));
    const options = { releaseRoot: f.release, env: {} };
    assert.equal(policy.ensureRuntimeDirectory('agentChat', options), path.join(f.release, 'server/uploads/agent-chat'));
    assert.equal(fs.statSync(path.join(f.state, 'agent-chat')).isDirectory(), true);
  } finally { f.cleanup(); }
});


test('configured store cannot override the executing canonical release store', () => {
  const f = directories();
  try {
    const releaseRoot = path.join(f.release, 'releases', 'fictional');
    const insideStore = path.join(f.release, 'state');
    fs.mkdirSync(releaseRoot, { recursive: true }); fs.mkdirSync(insideStore);
    const env = { DOCTARX_IMMUTABLE_RELEASE: 'true', DOCTARX_STATE_ROOT: insideStore, DOCTARX_RELEASE_STORE_ROOT: f.state };
    assert.throws(() => policy.runtimePath('agentChat', { releaseRoot, env }), { code: 'RUNTIME_STATE_STORE_MISMATCH' });
    delete env.DOCTARX_RELEASE_STORE_ROOT;
    assert.throws(() => policy.runtimePath('agentChat', { releaseRoot, env }), { code: 'RUNTIME_STATE_OVERLAP' });
    assert.deepEqual(fs.readdirSync(insideStore), []);
  } finally { f.cleanup(); }
});
