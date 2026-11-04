const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const http = require('node:http');
const express = require('express');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');

const repoRoot = path.resolve(__dirname, '../..');
const uploadRoutePath = path.resolve(__dirname, '../routes/upload-build-binary.js');

test('Docker runtime includes shared dependencies required by the Nigeria router', () => {
  const dockerfile = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');
  const runner = dockerfile.split(/FROM\s+\S+\s+AS\s+runner/i)[1];
  assert.ok(runner, 'production runner stage is explicit');
  const layout = fs.mkdtempSync(path.join(os.tmpdir(), 'doctarx-container-layout-'));
  try {
    // Reproduce only the runtime source COPY instructions, never build an image,
    // start the application, contact a database or run package install scripts.
    for (const directory of ['ng', 'shared']) {
      const copied = new RegExp(`^COPY --from=builder /app/${directory} \\./${directory}$`, 'm').test(runner);
      if (copied) fs.cpSync(path.join(repoRoot, directory), path.join(layout, directory), { recursive: true });
    }
    const regionRequire = createRequire(path.join(layout, 'ng/middleware/regionDetect.js'));
    assert.ok(regionRequire('../../shared/config/regions').getRegion);
    const phcRequire = createRequire(path.join(layout, 'ng/routes/phc.js'));
    assert.ok(phcRequire('../../shared/clinicalAiStages.json'));
  } finally {
    fs.rmSync(layout, { recursive: true, force: true });
  }
});

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
  assert.match(deployYaml, /^  workflow_dispatch:/m);
  assert.doesNotMatch(deployYaml, /^  (?:push|pull_request|workflow_run):/m);

  assert.match(deployYaml, /concurrency:\s*\n\s*group:\s*production-deploy\s*\n\s*cancel-in-progress:\s*false/);
  assert.match(deployYaml, /id-token:\s*write/);
  assert.match(deployYaml, /actions:\s*read/);
  assert.doesNotMatch(deployYaml, /actions:\s*write|workflow_run:/);
  assert.match(deployYaml, /if: github\.ref == 'refs\/heads\/main'/);
  const firstGate = deployYaml.indexOf('run: python3 .github/scripts/verify_release_checks.py');
  const finalGate = deployYaml.lastIndexOf('run: python3 .github/scripts/verify_release_checks.py');
  assert.ok(firstGate > 0 && firstGate < deployYaml.indexOf('run: npm ci'));
  assert.ok(finalGate > firstGate && finalGate < deployYaml.indexOf('- name: Upload artifact and start EC2 deploy'));
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

test('production artifact deploy preserves existing accounts without fixture commands or seeding overrides', () => {
  const route = loadUploadRouteWithSecret(undefined);
  assert.throws(() => route._test.artifactDeployScript({ deployId: 'guard-only' }), { code: 'DEPLOYMENT_ROLLBACK_UNVERIFIED' });
  // Preserve historical no-fixture constraints as source checks while this path
  // is blocked. This is not a successful deployment or rollback test.
  const script = fs.readFileSync(uploadRoutePath, 'utf8');
  assert.match(script, /fixture seeding skipped; existing accounts and records preserved/);
  assert.doesNotMatch(script, /ng:seed-demo|ingest-doctarx-nigeria-pack|seedDemoAccounts|ALLOW_(?:DEFAULT_DEMO_PASSWORD|DATABASE_URL_SIMULATION|PRODUCTION_SIMULATION)/);
  const ordered = [
    'npm run migrate', 'ensureAgentTables', 'node ng/migrations/migrate.js',
    'fixture seeding skipped', 'tar -xzf',
    'bash scripts/doctarx-blue-green-switch.sh',
    'pm2 reload ecosystem.config.js --only cronops',
    '/api/health', '/api/ng/health', '[verify:result] PASS',
  ];
  let previous = -1;
  for (const command of ordered) {
    const index = script.indexOf(command, previous + 1);
    assert.ok(index > previous, 'Established deploy order must retain: ' + command);
    previous = index;
  }
  assert.match(script, /restore_next_on_failure/);
  assert.match(script, /test -s \.next\.artifact-staging\/\.next\/BUILD_ID/);
});

test('manual recovery deploy also skips fixtures while preserving migration, build and health gates', () => {
  const { buildDeployCommand } = require('../routes/deploy-command');
  assert.throws(() => buildDeployCommand('guard-only'), { code: 'DEPLOYMENT_ROLLBACK_UNVERIFIED' });
  const script = fs.readFileSync(path.join(repoRoot, 'server/routes/deploy-command.js'), 'utf8');
  assert.match(script, /fixture seeding skipped; existing accounts and records preserved/);
  assert.doesNotMatch(script, /ng:seed-demo|ingest-doctarx-nigeria-pack|seedDemoAccounts|ALLOW_(?:DEFAULT_DEMO_PASSWORD|DATABASE_URL_SIMULATION|PRODUCTION_SIMULATION)/);
  assert.match(script, /npm run migrate/);
  assert.match(script, /node ng\/migrations\/migrate\.js/);
  assert.match(script, /npm run test:deploy-gate/);
  assert.match(script, /npm run build/);
  for (const phase of ['build', 'pm2', 'health', 'ngHealth']) assert.ok(script.includes(`wrapPhase('${phase}',`));
});


// Run the actual Express middleware/route stack, with every external mutator
// replaced by a trap. No live database, upload, process manager or provider.
function isolatedReleaseRoute(name, { realMulter = false } = {}) {
  const filename = path.join(repoRoot, 'server/routes', name + '.js');
  const isolated = { exports: {} };
  const touched = [];
  const trap = operation => () => { touched.push(operation); throw new Error('Forbidden side effect: ' + operation); };
  const mockFs = new Proxy({ existsSync: () => false, readFileSync: () => '' }, {
    get(target, property) { return target[property] || trap('fs.' + String(property)); },
  });
  const originalMkdir = fs.mkdirSync;
  const source = fs.readFileSync(filename, 'utf8');
  const actualMulter = realMulter ? require('multer') : null;
  try {
    if (realMulter) fs.mkdirSync = trap('real Multer fs.mkdirSync');
    vm.runInNewContext(source, {
    module: isolated, exports: isolated.exports, __dirname: path.dirname(filename),
    process: { env: { DEPLOY_SECRET: 'fictional-test-secret' }, kill: trap('process.kill') },
    console: { log() {}, warn() {}, error() {} },
    setInterval: trap('timer'), Buffer,
    require(name) {
      if (name === 'express') return express;
      if (name === 'fs') return mockFs;
      if (name === 'child_process') return { exec: trap('exec') };
      if (name === 'multer') return actualMulter || (() => ({ single: () => trap('upload parser') }));
      if (name === './run-detached-command') return { runDetachedCommand: trap('detached process') };
      if (name === '../utils/releaseRollbackPolicy') return require('../utils/releaseRollbackPolicy');
      if (name === './deploy-command') return require('../routes/deploy-command');
      if (['path', 'crypto', 'jsonwebtoken'].includes(name)) return require(name);
      throw new Error('Unexpected dependency: ' + name);
    },
    }, { filename });
  } finally { fs.mkdirSync = originalMkdir; }
  return { router: isolated.exports, touched };
}

for (const name of ['deploy', 'force-rebuild', 'upload-build', 'upload-build-binary', 'upload-build-chunked']) {
  test(name + ' refuses release requests before body/upload processing or mutations', async () => {
    const { router, touched } = isolatedReleaseRoute(name);
    const app = express();
    app.use('/', router);
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      for (const routePath of name === 'upload-build-chunked' ? ['/', '/assemble'] : ['/']) {
        for (const token of ['', 'fictional-test-secret']) {
          const response = await fetch(base + routePath + '?force=true&rollbackVerified=true', {
            method: 'POST', headers: { 'x-deploy-token': token, 'content-type': 'multipart/form-data; boundary=fictional' },
            body: '--fictional\r\nContent-Disposition: form-data; name="envJson"\r\n\r\n{"JWT_ACCESS_SECRET":"must-not-write"}\r\n--fictional--',
          });
          assert.equal(response.status, 503);
          const body = await response.json();
          assert.equal(body.success, false);
          assert.equal(body.code, 'DEPLOYMENT_ROLLBACK_UNVERIFIED');
          assert.doesNotMatch(JSON.stringify(body), /must-not-write|fictional-test-secret/);
        }
      }
      if (name === 'deploy') {
        for (const routePath of ['/status', '/log']) {
          assert.equal((await fetch(base + routePath)).status, 401);
          const response = await fetch(base + routePath, { headers: { 'x-deploy-token': 'fictional-test-secret' } });
          assert.equal(response.status, 200, routePath);
        }
      }
      assert.deepEqual(touched, [], 'blocked requests cannot write, parse uploads, authenticate remotely or launch processes');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
}

test('deployment workflow quarantine precedes credentials, build, upload and legacy AWS actions', () => {
  for (const name of ['deploy.yml', 'doctarx-aws-emergency-recover.yml', 'doctarx-aws-new-ec2-deploy.yml']) {
    const source = fs.readFileSync(path.join(repoRoot, '.github/workflows', name), 'utf8');
    const guard = source.indexOf('run: bash scripts/check-release-rollback.sh');
    assert.ok(guard > source.indexOf('uses: actions/checkout@v4'));
    for (const operation of ['run: npm ci', 'run: python3 .github/scripts/verify_release_checks.py', 'secrets.ACCESS_KEY_ID', 'secrets.DEPLOY_SECRET']) {
      if (source.includes(operation)) assert.ok(guard < source.indexOf(operation), operation);
    }
  }
  const cloud = fs.readFileSync(path.join(repoRoot, 'cloudbuild.yaml'), 'utf8');
  assert.ok(cloud.indexOf("args: ['scripts/check-release-rollback.sh']") < cloud.indexOf("args: ['build'"));
  const recovery = fs.readFileSync(path.join(repoRoot, '.github/workflows/recover-ec2.yml'), 'utf8');
  assert.doesNotMatch(recovery, /check-release-rollback|git reset|npm install|npm run migrate/);
  assert.match(recovery, /diagnose-only/);
  assert.match(recovery, /restart-services/);
});

test('real shell deployment entrypoints stop with no working-tree or process-manager changes', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctarx-rollback-block-'));
  try {
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.writeFileSync(path.join(dir, '.env'), 'echo unsafe-env-sourced > env-side-effect\n');
    fs.writeFileSync(path.join(dir, 'previous-release'), 'untouched');
    for (const command of ['pm2', 'git', 'npm', 'curl', 'sudo', 'tar', 'aws', 'gcloud']) {
      fs.writeFileSync(path.join(dir, 'bin', command), '#!/bin/sh\necho forbidden >> "$PROJECT_ROOT/mutations"\nexit 99\n', { mode: 0o755 });
    }
    for (const script of ['scripts/check-release-rollback.sh', 'scripts/doctarx-blue-green-switch.sh', 'deploy.sh']) {
      const result = spawnSync('/bin/bash', [path.join(repoRoot, script), 'incoming'], {
        cwd: dir, encoding: 'utf8', timeout: 5000,
        env: { ...process.env, PATH: path.join(dir, 'bin') + ':/usr/bin:/bin', PROJECT_ROOT: dir,
          DEPLOY_ROLLBACK_VERIFIED: 'true', FORCE_DEPLOY: 'true', DOCTARX_DEPLOY_CHECK: 'false' },
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 78, result.stdout + result.stderr);
      assert.match(result.stderr, /DEPLOYMENT_ROLLBACK_UNVERIFIED/);
      assert.equal(fs.readFileSync(path.join(dir, 'previous-release'), 'utf8'), 'untouched');
      assert.equal(fs.existsSync(path.join(dir, 'mutations')), false);
      assert.equal(fs.existsSync(path.join(dir, 'env-side-effect')), false);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


test('real Multer storage is not constructed on quarantined route imports', () => {
  for (const name of ['upload-build-binary', 'upload-build-chunked']) {
    const { touched } = isolatedReleaseRoute(name, { realMulter: true });
    assert.deepEqual(touched, []);
  }
});
