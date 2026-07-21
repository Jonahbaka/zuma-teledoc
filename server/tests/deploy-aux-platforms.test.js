const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const originalSecret = process.env.DEPLOY_SECRET;
process.env.DEPLOY_SECRET = 'test-only-deploy-secret';
delete require.cache[require.resolve('../routes/deploy-aux-platforms')];
const route = require('../routes/deploy-aux-platforms');
const {
  authorizeRequest,
  parseStatus,
  safeSecretEqual,
  safeSha,
} = route._test;

test.after(() => {
  if (originalSecret === undefined) delete process.env.DEPLOY_SECRET;
  else process.env.DEPLOY_SECRET = originalSecret;
});

test('auxiliary deploy authentication fails closed and compares the full secret', async () => {
  assert.equal(safeSecretEqual('', ''), false);
  assert.equal(safeSecretEqual('wrong-secret'), false);
  assert.equal(safeSecretEqual('test-only-deploy-secret'), true);
  assert.equal(await authorizeRequest({ headers: {} }), null);
  assert.deepEqual(
    await authorizeRequest({ headers: { 'x-deploy-token': 'test-only-deploy-secret' } }),
    { method: 'deploy_secret' }
  );
});

test('auxiliary deploy accepts only full hexadecimal commit SHAs', () => {
  const fullSha = 'a'.repeat(40);
  assert.equal(safeSha(fullSha), fullSha);
  assert.equal(safeSha('abc1234'), '');
  assert.equal(safeSha(`${'b'.repeat(39)}z`), '');
  assert.equal(safeSha(`$(touch /tmp/not-allowed)`), '');
});

test('auxiliary deploy status follows PID liveness and terminal markers', () => {
  assert.deepEqual(parseStatus('', () => false), {
    status: 'idle',
    pid: null,
    alive: false,
    complete: false,
    lastLines: [],
  });

  const running = parseStatus('[aux-api:pid] 4321\ninstalling', (pid) => pid === 4321);
  assert.equal(running.status, 'running');
  assert.equal(running.alive, true);

  const success = parseStatus('[aux-api:pid] 4321\n[aux-deploy:result] success', () => false);
  assert.equal(success.status, 'success');
  assert.equal(success.complete, true);

  const failure = parseStatus('[aux-api:pid] 4321\n[aux-deploy:result] failure exit=1', () => false);
  assert.equal(failure.status, 'failed');
  assert.equal(failure.complete, true);
});

test('auxiliary workflow waits for the documented EC2 release and exact live commit', () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, '../../.github/workflows/deploy-aux-platforms.yml'),
    'utf8'
  );

  assert.match(workflow, /actions\/workflows\/deploy\.yml\/runs/);
  assert.match(workflow, /scripts\/doctarx-blue-green-switch\.sh/);
  assert.match(workflow, /select\(\.head_sha == \$sha\)/);
  assert.match(workflow, /\[ "\$DEPLOY_CONCLUSION" = success \]/);
  assert.match(workflow, /\[ "\$LIVE_COMMIT" = "\$EXPECTED_COMMIT" \]/);
  assert.match(workflow, /status endpoint returned HTTP \$\{CODE:-unavailable\}; retrying/);
  assert.match(workflow, /if \[ "\$CODE" != 200 \]; then/);
  assert.match(workflow, /NESTORA_SHA: c049eae34d89f8051d732ca94d6e2a21ae8731a8/);
});

test('auxiliary deployment installs and verifies the Linux sharp runtime', () => {
  const script = fs.readFileSync(
    path.join(__dirname, '../../.github/scripts/deploy_aux_platforms.sh'),
    'utf8'
  );

  assert.match(
    script,
    /npm install --include=dev --include=optional --no-save --no-package-lock/
  );
  assert.match(script, /--os=linux --cpu=x64 --libc=glibc sharp/);
  assert.match(script, /require\('sharp'\)/);
});

test('auxiliary deployment reconciles protected Nestora runtime configuration', () => {
  const script = fs.readFileSync(
    path.join(__dirname, '../../.github/scripts/deploy_aux_platforms.sh'),
    'utf8'
  );

  assert.match(script, /ensure_env_value "\$NESTORA_ENV" AWS_REGION/);
  assert.doesNotMatch(script, /for required_key in [^\n]*AWS_ACCESS_KEY_ID/);
  assert.match(script, /ensure_env_secret "\$NESTORA_ENV" NESTORA_JOB_SECRET 48/);
  assert.match(script, /Nestora runtime configuration is missing: \$required_key/);
});

test('auxiliary seed overrides the parent DoctaRx database environment', () => {
  const script = fs.readFileSync(
    path.join(__dirname, '../../.github/scripts/deploy_aux_platforms.sh'),
    'utf8'
  );
  const seedBlock = script.slice(
    script.indexOf('Loading controlled Nursing pilot accounts'),
    script.indexOf('cat > "$ECOSYSTEM_FILE"')
  );

  assert.match(seedBlock, /source "\$NURSING_ENV"/);
  assert.match(seedBlock, /NURSING_TEST_ACCOUNT_PASSWORD=.*npm run seed/);
});

test('auxiliary PM2 processes inherit their isolated runtime environments', () => {
  const script = fs.readFileSync(
    path.join(__dirname, '../../.github/scripts/deploy_aux_platforms.sh'),
    'utf8'
  );

  assert.match(script, /start_with_env\(\) \(/);
  assert.match(script, /source "\$env_file"/);
  assert.match(script, /source \/home\/ec2-user\/\.config\/doctarx-aux\/nestora\.env/);
  assert.match(script, /source \/home\/ec2-user\/\.config\/doctarx-aux\/nursing\.env/);
  assert.match(script, /start_with_env "\$NESTORA_ENV" nestora/);
  assert.match(
    script,
    /start_with_env "\$NURSING_ENV" doctarx-nursing-education/
  );
});

test('auxiliary deployment probes the Nestora database before activation', () => {
  const script = fs.readFileSync(
    path.join(__dirname, '../../.github/scripts/deploy_aux_platforms.sh'),
    'utf8'
  );

  assert.match(script, /Verifying the Nestora runtime database connection/);
  assert.match(script, /await query\('SELECT 1'\)/);
  assert.match(script, /health check failed: \$url \(HTTP/);
  assert.match(script, /python3 "\$SCRIPT_DIR\/install_nursing_nginx\.py"/);
  assert.match(script, /PILOT_PUBLIC_KEY=.*nursing-pilot-recipient\.pub/);
  assert.match(script, /Nursing Education deployment route/);
  assert.match(script, /for attempt in \$\(seq 1 15\)/);
  assert.match(script, /curl -k -L -sS -o \/tmp\/nestora-public\.json/);
});

test('nginx installer applies Nursing routes to every DoctaRx server block', () => {
  const installer = fs.readFileSync(
    path.join(__dirname, '../../.github/scripts/install_nursing_nginx.py'),
    'utf8'
  );

  assert.match(installer, /targets\.setdefault\(path, \[\]\)\.append\(end\)/);
  assert.match(installer, /for target, closing_braces in targets\.items\(\)/);
  assert.match(installer, /sorted\(set\(closing_braces\), reverse=True\)/);
});

test('nginx installer updates both HTTP and TLS DoctaRx server blocks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctarx-nginx-'));
  const config = path.join(root, 'doctarx.conf');
  const installer = path.join(__dirname, '../../.github/scripts/install_nursing_nginx.py');
  fs.writeFileSync(config, `
server {
  listen 80;
  server_name doctarx.com www.doctarx.com;
  location / { proxy_pass http://127.0.0.1:3001; }
}
server {
  listen 443 ssl;
  server_name doctarx.com www.doctarx.com;
  ssl_certificate /tmp/fullchain.pem;
  location / { proxy_pass http://127.0.0.1:3001; }
}
`);

  try {
    const python = process.platform === 'win32' ? 'python' : 'python3';
    const result = spawnSync(python, [installer], {
      encoding: 'utf8',
      env: { ...process.env, NGINX_ROOT: root },
    });
    assert.equal(result.status, 0, result.stderr);
    const installed = fs.readFileSync(config, 'utf8');
    assert.equal((installed.match(/# BEGIN DOCTARX NURSING EDUCATION/g) || []).length, 2);
    assert.equal((installed.match(/location = \/nursing-education/g) || []).length, 4);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
