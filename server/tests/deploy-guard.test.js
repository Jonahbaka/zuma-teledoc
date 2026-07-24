const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '../..');
const uploadRoutePath = path.resolve(__dirname, '../routes/upload-build-binary.js');

function loadUploadRouteWithSecret(secret) {
  const previous = process.env.DEPLOY_SECRET;
  if (secret === undefined) {
    delete process.env.DEPLOY_SECRET;
  } else {
    process.env.DEPLOY_SECRET = secret;
  }

  delete require.cache[require.resolve(uploadRoutePath)];
  const route = require(uploadRoutePath);

  if (previous === undefined) {
    delete process.env.DEPLOY_SECRET;
  } else {
    process.env.DEPLOY_SECRET = previous;
  }

  return route;
}

function writeTempDeployLog(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctarx-deploy-guard-'));
  const logPath = path.join(dir, 'deploy.log');
  fs.writeFileSync(logPath, content);
  return { dir, logPath };
}

function startedIso(msAgo = 0) {
  return new Date(Date.now() - msAgo).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

test('upload-build-binary auth fails closed when DEPLOY_SECRET is unset', async () => {
  const route = loadUploadRouteWithSecret(undefined);
  const auth = await route._test.authorizeDeployRequest({
    headers: { 'x-deploy-token': 'doctarx-deploy-2026' },
    body: {},
  });

  assert.equal(auth, null);
});

test('upload-build-binary auth accepts explicit DEPLOY_SECRET only', async () => {
  const route = loadUploadRouteWithSecret('test-secret');
  const auth = await route._test.authorizeDeployRequest({
    headers: { 'x-deploy-token': 'test-secret' },
    body: {},
  });

  assert.deepEqual(auth, { method: 'deploy_secret' });
});

test('deploy log parser recovers deploy identity and terminal markers', () => {
  const route = loadUploadRouteWithSecret(undefined);
  const parsed = route._test.parseDeployLog([
    '[deploy:id] 20260609120000-abc123',
    '[deploy:pid] 12345',
    '[deploy] start 2026-06-09T12:00:00Z',
    '[deploy] failed (exit 1) 2026-06-09T12:01:00Z',
  ].join('\n'));

  assert.equal(parsed.deployId, '20260609120000-abc123');
  assert.equal(parsed.pid, 12345);
  assert.equal(parsed.startedAt, '2026-06-09T12:00:00Z');
  assert.equal(parsed.failed, true);
  assert.equal(parsed.exitCode, 1);
});

test('active live-pid deploy blocks a second artifact deploy', () => {
  const route = loadUploadRouteWithSecret(undefined);
  const { dir, logPath } = writeTempDeployLog([
    '[deploy:id] active-1',
    '[deploy:pid] 12345',
    `[deploy] start ${startedIso(60_000)}`,
  ].join('\n'));

  try {
    const active = route._test.getActiveDeploy({
      logPath,
      isPidAlive: () => true,
    });

    assert.equal(active.deployId, 'active-1');
    assert.equal(active.pid, 12345);
    assert.equal(active.status, 'running');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('terminal deploy log releases artifact deploy lock', () => {
  const route = loadUploadRouteWithSecret(undefined);
  const { dir, logPath } = writeTempDeployLog([
    '[deploy:id] complete-1',
    '[deploy:pid] 12345',
    `[deploy] start ${startedIso(60_000)}`,
    '[deploy] complete 2026-06-09T12:02:00Z',
  ].join('\n'));

  try {
    assert.equal(route._test.getActiveDeploy({ logPath, isPidAlive: () => true }), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('dead pid and stale timeout release artifact deploy lock', () => {
  const route = loadUploadRouteWithSecret(undefined);
  const dead = writeTempDeployLog([
    '[deploy:id] dead-1',
    '[deploy:pid] 12345',
    `[deploy] start ${startedIso(60_000)}`,
  ].join('\n'));
  const stale = writeTempDeployLog([
    '[deploy:id] stale-1',
    '[deploy:pid] 12345',
    `[deploy] start ${startedIso(route._test.DEPLOY_LOCK_TIMEOUT_MS + 1_000)}`,
  ].join('\n'));

  try {
    assert.equal(route._test.getActiveDeploy({ logPath: dead.logPath, isPidAlive: () => false }), null);
    assert.equal(route._test.getActiveDeploy({ logPath: stale.logPath, isPidAlive: () => true }), null);
  } finally {
    fs.rmSync(dead.dir, { recursive: true, force: true });
    fs.rmSync(stale.dir, { recursive: true, force: true });
  }
});

test('production deploy workflow keeps artifact flow and queues deployments', () => {
  const deployYaml = fs.readFileSync(path.join(repoRoot, '.github/workflows/deploy.yml'), 'utf8');

  assert.match(deployYaml, /concurrency:\s*\n\s*group:\s*production-deploy\s*\n\s*cancel-in-progress:\s*false/);
  assert.match(deployYaml, /id-token:\s*write/);
  assert.match(deployYaml, /\/api\/upload-build-binary/);
  assert.match(deployYaml, /verify_production\.py/);
  assert.doesNotMatch(deployYaml, /\/api\/deploy(?:\s|["'])/);
});

test('blue-green verification accepts build IDs that begin with a dash', () => {
  const source = fs.readFileSync(
    path.join(repoRoot, 'scripts/doctarx-blue-green-switch.sh'),
    'utf8'
  );

  assert.match(source, /grep -Fq -- "\$expected_build_id"/);
});

test('deploy source does not contain the burned public deploy secret', () => {
  const files = [
    '.github/workflows/deploy.yml',
    'server/routes/deploy.js',
    'server/routes/force-rebuild.js',
    'server/routes/restart.js',
    'server/routes/upload-build-binary.js',
    'server/routes/upload-build-chunked.js',
    'server/routes/upload-build.js',
    'server/services/agent-orchestrator/skills/devops_deploy.md',
  ];

  for (const file of files) {
    assert.doesNotMatch(
      fs.readFileSync(path.join(repoRoot, file), 'utf8'),
      /doctarx-deploy-2026/,
      `${file} must not contain the burned deploy secret`
    );
  }
});

test('Cloud Run deployment sources the OpenClaw gateway token from Secret Manager', () => {
  const cloudBuild = fs.readFileSync(path.join(repoRoot, 'cloudbuild.yaml'), 'utf8');
  assert.doesNotMatch(cloudBuild, /OPENCLAW_GATEWAY_TOKEN=[^,\s]+-token-/);
  assert.match(
    cloudBuild,
    /OPENCLAW_GATEWAY_TOKEN=OPENCLAW_GATEWAY_TOKEN:latest/,
    'OPENCLAW_GATEWAY_TOKEN must be injected through Cloud Run Secret Manager'
  );
});

test('artifact deploy runs migrations before agent table backfill', () => {
  const source = fs.readFileSync(uploadRoutePath, 'utf8');
  const migrateIndex = source.indexOf('npm run migrate');
  const ensureIndex = source.indexOf('ensureAgentTables');

  assert.notEqual(migrateIndex, -1);
  assert.notEqual(ensureIndex, -1);
  assert.ok(migrateIndex < ensureIndex);
  assert.match(source, /artifactDeployScript/);
  assert.match(source, /\.next\.artifact-prev/);
  assert.match(source, /verifyGithubOidcToken/);
});
