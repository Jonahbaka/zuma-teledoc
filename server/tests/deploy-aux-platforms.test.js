const assert = require('node:assert/strict');
const fs = require('node:fs');
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

test('auxiliary workflow accepts the deploy log short SHA only as a prefix', () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, '../../.github/workflows/deploy-aux-platforms.yml'),
    'utf8'
  );

  assert.match(
    workflow,
    /\[ -n "\$LIVE_COMMIT" \].*\[\[ "\$EXPECTED_COMMIT" == "\$LIVE_COMMIT"\* \]\]/
  );
  assert.doesNotMatch(workflow, /\[\[ "\$LIVE_COMMIT" == "\$EXPECTED_COMMIT"\* \]\]/);
});
