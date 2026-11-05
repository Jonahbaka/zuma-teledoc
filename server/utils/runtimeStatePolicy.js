'use strict';

const fs = require('node:fs');
const path = require('node:path');
const DEFAULT_RELEASE_ROOT = path.resolve(__dirname, '../..');
function policyError(code, message) { return Object.assign(new Error(message), { code, status: 503, statusCode: 503 }); }
function present(filename) {
  try { fs.lstatSync(filename); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function immutableRuntime({ env = process.env, releaseRoot = DEFAULT_RELEASE_ROOT } = {}) {
  // A sealed artifact cannot opt out by setting a flag false or deleting its env.
  return env.DOCTARX_IMMUTABLE_RELEASE === 'true' || present(path.join(releaseRoot, 'release-manifest.json'));
}
function assertCodeMutationAllowed(operation, options = {}) {
  const env = options.env || process.env;
  if (env.DOCTARX_DEPLOY_CHECK === 'true' || immutableRuntime(options)) {
    throw policyError('IMMUTABLE_RUNTIME_MUTATION_BLOCKED', 'Runtime code, shell and administrative SQL mutation is unavailable in this process.');
  }
}
function assertServingModeSupported(options = {}) {
  if (!immutableRuntime(options)) return null;
  const env = options.env || process.env;
  const releaseRoot = path.resolve(options.releaseRoot || DEFAULT_RELEASE_ROOT);
  if (!env.DOCTARX_EXPECTED_RELEASE_DIGEST || !env.DOCTARX_RELEASE_STORE_ROOT ||
      !env.DOCTARX_CONFIG_VERSION || !env.DOCTARX_CONFIG_DIGEST ||
      !/^[a-f0-9]{64}$/.test(env.DOCTARX_RELEASE_HEALTH_TOKEN || '')) {
    throw policyError('IMMUTABLE_SERVING_UNVERIFIED', 'A verified release selection, external configuration and health credential are required.');
  }
  const { verifyBundle } = require('../../scripts/release/manifest.cjs');
  const manifest = verifyBundle(releaseRoot, env.DOCTARX_EXPECTED_RELEASE_DIGEST, { matchRuntime: true });
  const store = realDirectory(env.DOCTARX_RELEASE_STORE_ROOT);
  if (fs.realpathSync(path.join(store, 'current')) !== releaseRoot ||
      releaseRoot !== path.join(store, 'releases', manifest.releaseId) ||
      manifest.configuration.version !== env.DOCTARX_CONFIG_VERSION ||
      manifest.configuration.digest !== env.DOCTARX_CONFIG_DIGEST) {
    throw policyError('IMMUTABLE_SELECTION_MISMATCH', 'Executing release or configuration differs from the selected release.');
  }
  for (const kind of ['publicUploads', 'agentChat', 'credentialDocuments']) runtimePath(kind, { env, releaseRoot });
  return { releaseId: manifest.releaseId, digest: manifest.digest, sourceSha: manifest.source.sha,
    buildId: manifest.buildId, runtime: manifest.runtime, migrationDigest: manifest.migrationDigest,
    configuration: manifest.configuration };
}
function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}
function overlaps(a, b) { return inside(a, b) || inside(b, a); }
function realDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw policyError('RUNTIME_STATE_UNCONFIGURED', 'An explicit absolute external runtime-state directory is required.');
  const normalized = path.resolve(directory);
  if (!fs.lstatSync(normalized).isDirectory() || fs.realpathSync(normalized) !== normalized) throw policyError('RUNTIME_STATE_UNSAFE', 'Runtime-state directories cannot be symlink aliases.');
  return normalized;
}
function validateAncestors(root, target) {
  let current = root;
  for (const segment of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!present(current)) break;
    if (!fs.lstatSync(current).isDirectory() || fs.realpathSync(current) !== current) throw policyError('RUNTIME_STATE_UNSAFE', 'Runtime-state paths cannot escape through symlinks or non-directories.');
  }
}
function runtimePath(kind, options = {}) {
  const env = options.env || process.env;
  const releaseRoot = path.resolve(options.releaseRoot || DEFAULT_RELEASE_ROOT);
  const legacy = {
    publicUploads: path.join(releaseRoot, 'uploads'),
    agentChat: path.join(releaseRoot, 'server', 'uploads', 'agent-chat'),
    credentialDocuments: path.join(releaseRoot, 'private-uploads', 'credentialing'),
  };
  if (!Object.hasOwn(legacy, kind)) throw policyError('UNKNOWN_RUNTIME_STATE', 'Unknown runtime-state category.');
  const immutable = immutableRuntime({ env, releaseRoot });
  if (!env.DOCTARX_STATE_ROOT && !immutable) return legacy[kind];
  const stateRoot = realDirectory(env.DOCTARX_STATE_ROOT);
  if (overlaps(stateRoot, releaseRoot)) throw policyError('RUNTIME_STATE_OVERLAP', 'Runtime state must be separate from release source.');
  const inferredStore = path.basename(path.dirname(releaseRoot)) === 'releases' ? realDirectory(path.dirname(path.dirname(releaseRoot))) : null;
  const configuredStore = env.DOCTARX_RELEASE_STORE_ROOT ? realDirectory(env.DOCTARX_RELEASE_STORE_ROOT) : null;
  if (inferredStore && configuredStore && inferredStore !== configuredStore) throw policyError('RUNTIME_STATE_STORE_MISMATCH', 'Configured release store differs from the executing release store.');
  for (const storeRoot of [inferredStore, configuredStore].filter(Boolean)) {
    if (overlaps(stateRoot, storeRoot)) throw policyError('RUNTIME_STATE_OVERLAP', 'Runtime state must be separate from the complete release store.');
  }
  const relative = {
    publicUploads: ['public', 'uploads'],
    agentChat: ['private', 'agent-chat'],
    credentialDocuments: ['private', 'credentialing'],
  }[kind];
  const target = path.join(stateRoot, ...relative);
  // Validate both boundaries even for a private write; a public alias must not
  // expose the private subtree through the generic static mount.
  validateAncestors(stateRoot, path.join(stateRoot, 'public', 'uploads'));
  validateAncestors(stateRoot, path.join(stateRoot, 'private', 'agent-chat'));
  validateAncestors(stateRoot, target);
  return target;
}
function ensureRuntimeDirectory(kind, options = {}) {
  if ((options.env || process.env).DOCTARX_DEPLOY_CHECK === 'true') throw policyError('CHECK_ONLY_WRITE_BLOCKED', 'Readiness probes cannot create runtime storage.');
  const directory = runtimePath(kind, options);
  fs.mkdirSync(directory, { recursive: true, mode: kind === 'publicUploads' ? 0o755 : 0o700 });
  // Preserve existing legacy upload aliases; strict opt-in storage never accepts them.
  const env = options.env || process.env;
  if (kind !== 'credentialDocuments' && !env.DOCTARX_STATE_ROOT && !immutableRuntime(options)) return directory;
  // Recheck after creation; never silently fall back to a source-local path.
  if (runtimePath(kind, options) !== directory || fs.realpathSync(directory) !== directory) throw policyError('RUNTIME_STATE_UNSAFE', 'Runtime-state directory changed during creation.');
  return directory;
}
module.exports = { immutableRuntime, assertCodeMutationAllowed, assertServingModeSupported, runtimePath, ensureRuntimeDirectory };
