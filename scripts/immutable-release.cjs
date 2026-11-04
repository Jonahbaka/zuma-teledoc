#!/usr/bin/env node
'use strict';

// Preparatory local tooling only. There is intentionally no live promotion,
// restart, migration, credentials, network, archive-extraction or PM2 command.
const path = require('node:path');
const { prepareRelease, planPromotion, inspectStore } = require('./release/store.cjs');
const { verifyBundle, fail } = require('./release/manifest.cjs');

function argumentsFor(argv) {
  const [command, ...rest] = argv;
  const options = {};
  if (rest.length % 2) fail('INVALID_ARGUMENTS', 'Use explicit --name value arguments');
  for (let i = 0; i < rest.length; i += 2) {
    if (!/^--[a-z-]+$/.test(rest[i]) || Object.hasOwn(options, rest[i].slice(2))) fail('INVALID_ARGUMENTS', 'Unknown or repeated argument');
    options[rest[i].slice(2)] = rest[i + 1];
  }
  return { command, options };
}
function allowOnly(options, keys) {
  if (Object.keys(options).some(key => !keys.includes(key)) || keys.some(key => !options[key])) fail('INVALID_ARGUMENTS', 'All documented arguments are required, with no extra flags');
}
async function main(argv) {
  const { command, options: opts } = argumentsFor(argv);
  if (['promote', 'rollback', 'recover', 'bootstrap'].includes(command)) fail('LIVE_PROMOTION_UNAVAILABLE', 'Live promotion and recovery remain blocked pending a reviewed production adapter and compatibility evidence');
  if (command === 'prepare') {
    allowOnly(opts, ['store', 'bundle', 'repository', 'sha', 'config-version', 'config-digest']);
    const result = await prepareRelease({ storeRoot: opts.store, bundleDirectory: opts.bundle, sourceRepository: opts.repository, sourceSha: opts.sha, configuration: { version: opts['config-version'], digest: opts['config-digest'] } });
    return { status: 'prepared-not-approved', releaseId: result.releaseId, digest: result.digest, reused: result.reused };
  }
  if (command === 'verify') {
    allowOnly(opts, ['directory', 'digest']);
    const result = verifyBundle(path.resolve(opts.directory), opts.digest);
    return { status: 'content-verified-not-approved', releaseId: result.releaseId, digest: result.digest };
  }
  if (command === 'inspect') {
    allowOnly(opts, ['store']);
    const state = inspectStore(opts.store);
    return { current: state.current, locked: state.locked, blocked: state.blocked, journalPhase: state.journal?.phase || null, operationId: state.journal?.operationId || null };
  }
  if (command === 'plan') {
    allowOnly(opts, ['store', 'current-id', 'current-digest', 'candidate-id', 'candidate-digest']);
    const plan = planPromotion({ storeRoot: opts.store, expectedCurrent: { releaseId: opts['current-id'], digest: opts['current-digest'] }, candidate: { releaseId: opts['candidate-id'], digest: opts['candidate-digest'] } });
    return { status: 'dry-run-only', current: plan.from.releaseId, candidate: plan.to.releaseId, planDigest: plan.planDigest, productionPromotionAvailable: false };
  }
  fail('INVALID_COMMAND', 'Supported commands: prepare, verify, inspect, plan');
}
if (require.main === module) main(process.argv.slice(2)).then(result => {
  process.stdout.write(JSON.stringify(result) + '\n');
}).catch(error => {
  // Never print input values, secret-derived configuration fingerprints, child
  // output, filesystem error contents or stack traces from a failed operation.
  process.stderr.write('[release] ' + (/^[A-Z0-9_]{1,80}$/.test(error.code || '') ? error.code : 'LOCAL_RELEASE_FAILURE') + '\n');
  process.exitCode = 1;
});
module.exports = { main };
