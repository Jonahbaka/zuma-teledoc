'use strict';

// Execute the package's actual test commands, serializing test files so timing
// assertions do not compete with hundreds of independent Node workers. No tests
// are converted into skips, and every batch retains its nonzero exit status.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const scripts = require('../package.json').scripts;
const results = [];

function expand(command, seen = []) {
  return command.split(' && ').flatMap(part => {
    const words = part.trim().split(/\s+/);
    if (words[0] === 'npm' && words[1] === 'run' && words.length === 3) {
      const name = words[2];
      if (!scripts[name] || seen.includes(name)) throw new Error('Invalid readiness script graph');
      return expand(scripts[name], [...seen, name]);
    }
    if (words[0] !== 'node') throw new Error('Readiness requires an explicit Node command');
    const args = words.slice(1);
    if (args[0] === '--test') {
      for (let index = args.length - 1; index > 0; index--) if (args[index].startsWith('--test-concurrency=')) args.splice(index, 1);
      args.splice(1, 0, '--test-concurrency=1', '--test-timeout=120000');
    }
    return [args];
  });
}

function run(label, args) {
  console.log('\nREADINESS_BATCH ' + label);
  const started = Date.now();
  const result = spawnSync(process.execPath, args, { cwd: root, env: process.env, stdio: 'inherit', timeout: 20 * 60 * 1000 });
  const record = { label, args, exitCode: result.status, signal: result.signal, error: result.error?.code || null, elapsedMs: Date.now() - started };
  results.push(record);
  // A failed batch cannot hide independent coverage that still needs to run.
  if (result.status !== 0 || result.error) process.exitCode = 1;
}

if (process.platform !== 'linux') throw new Error('The complete production-profile gate requires Linux. Use focused local tests on other platforms.');
if (process.env.NODE_ENV !== 'test' || process.env.DOCTARX_VOICE_DB_TEST !== 'true') throw new Error('Explicit fictional database test configuration is required');
const target = new URL(process.env.SIMULATION_DATABASE_URL || '');
if (!['localhost','127.0.0.1','[::1]'].includes(target.hostname) || !target.pathname.endsWith('_test') || process.env.DATABASE_URL !== process.env.SIMULATION_DATABASE_URL) throw new Error('Use the same explicit disposable loopback test database');

for (const name of ['migrations:verify', 'test:deploy-guard', 'pretest', 'test', 'posttest', 'test:platform:db', 'test:ng:medication-delivery:db', 'test:sim']) {
  if (!scripts[name]) throw new Error('Missing readiness script: ' + name);
  for (const [index, args] of expand(scripts[name]).entries()) run(name + ':' + (index + 1), args);
}
const dbFiles = [];
function collect(directory) {
  for (const item of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relative = directory + '/' + item.name;
    if (item.isDirectory()) collect(relative);
    else if (item.isFile() && /-db\.test\.js$/.test(item.name)) dbFiles.push(relative);
  }
}
collect('server/tests'); collect('ng/tests');
run('all-explicit-postgres-files', ['--test','--test-concurrency=1','--test-timeout=120000',...dbFiles.sort()]);
const directory = path.join(root, 'artifacts', 'readiness'); fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ sourceSha: process.env.GITHUB_SHA || null, platform: process.platform, node: process.version, passed: !process.exitCode, dbFiles, results }, null, 2));
console.log('\nREADINESS_RESULT ' + JSON.stringify({ passed: !process.exitCode, batches: results.length, failed: results.filter(item => item.exitCode !== 0).map(item => item.label), databaseFiles: dbFiles.length }));
