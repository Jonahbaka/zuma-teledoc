'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const MANIFEST_FILE = 'release-manifest.json';
const REQUIRED = ['package.json', 'package-lock.json', 'next.config.js', 'server/index.js', '.next/BUILD_ID', 'node_modules/next/package.json', 'node_modules/express/package.json'];
const REQUIRED_DIRS = ['app', 'components', 'lib', 'server', 'ng', 'shared', 'public', '.next', 'node_modules'];
const SHA256 = /^[a-f0-9]{64}$/;
const SHA1 = /^[a-f0-9]{40}$/;
const BUILD_ID = /^[A-Za-z0-9._-]{1,128}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/;

class ReleaseError extends Error {
  constructor(code, message) { super(message); this.name = 'ReleaseError'; this.code = code; }
}
function fail(code, message) { throw new ReleaseError(code, message); }
function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function safeRelative(relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') || relative.startsWith('/') || relative.split('/').some(part => !part || part === '.' || part === '..')) fail('INVALID_PATH', 'Release contains an unsafe relative path');
  return relative;
}
function rootDirectory(root) {
  const absolute = path.resolve(root);
  if (!fs.lstatSync(absolute).isDirectory() || fs.realpathSync(absolute) !== absolute) fail('INVALID_ROOT', 'Release root must be a real directory without symlink parents');
  return absolute;
}
function readRegular(filename, maxBytes = 16 * 1024 * 1024) {
  const initial = fs.lstatSync(filename);
  if (!initial.isFile() || initial.nlink !== 1) fail('UNSAFE_FILE', 'Control/source file must be regular and not hard-linked');
  const handle = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(handle);
    if (!before.isFile() || before.nlink !== 1 || before.dev !== initial.dev || before.ino !== initial.ino) fail('UNSAFE_FILE', 'Release files must be regular, stable and not hard-linked');
    if (before.size > maxBytes) fail('FILE_TOO_LARGE', 'Control/source file exceeds the verification limit');
    const content = fs.readFileSync(handle);
    const after = fs.fstatSync(handle);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail('CHANGED_DURING_READ', 'Release file changed during verification');
    return { content, mode: before.mode & 0o777 };
  } finally { fs.closeSync(handle); }
}
function hashRegular(filename) {
  const initial = fs.lstatSync(filename);
  if (!initial.isFile() || initial.nlink !== 1) fail('UNSAFE_FILE', 'Release file must be regular and not hard-linked');
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.dev !== initial.dev || before.ino !== initial.ino) fail('UNSAFE_FILE', 'Release files must be regular, stable and not hard-linked');
    if (before.size > 4 * 1024 * 1024 * 1024) fail('FILE_TOO_LARGE', 'A release file exceeds the bounded verifier limit');
    const sha256 = crypto.createHash('sha256');
    const gitBlob = crypto.createHash('sha1').update(Buffer.from('blob ' + before.size + '\0'));
    const buffer = Buffer.alloc(64 * 1024);
    let size = 0, count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      size += count; sha256.update(buffer.subarray(0, count)); gitBlob.update(buffer.subarray(0, count));
    }
    const after = fs.fstatSync(fd);
    if (size !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail('CHANGED_DURING_READ', 'Release file changed during verification');
    return { size, mode: before.mode & 0o777, sha256: sha256.digest('hex'), gitBlob: gitBlob.digest('hex') };
  } finally { fs.closeSync(fd); }
}
function runtimeIdentity() {
  return { node: process.version, nodeBinarySha256: hashRegular(fs.realpathSync(process.execPath)).sha256,
    platform: process.platform, arch: process.arch, modulesAbi: process.versions.modules };
}
function migrationIdentity(entries) {
  const selected = entries.filter(entry => entry.type === 'file' && (entry.path.startsWith('server/db/') || entry.path.startsWith('ng/migrations/')));
  if (!selected.some(entry => entry.path === 'server/db/migrate.js') || !selected.some(entry => entry.path === 'ng/migrations/migrate.js')) fail('INCOMPLETE_MIGRATIONS', 'Both migration runners and manifests must be present');
  return digest(canonical(selected));
}
function prohibited(relative) {
  const parts = relative.split('/');
  // Secret-bearing names are rejected at every depth, including dependencies.
  // This is a bounded path safeguard, not a general secret/content scanner.
  return ['uploads', 'backups', 'logs'].includes(parts[0]) || parts.some(part =>
    ['.git', '.aws', '.ssh'].includes(part) ||
    (/^\.env(?:\.|$)/.test(part) && !['.env.example', '.env.sample', '.env.template'].includes(part)) ||
    /\.(?:pem|key|dump|sqlite|sqlite3)$/i.test(part));
}

function inventory(root) {
  const absolute = rootDirectory(root);
  const entries = [];
  let totalBytes = 0;
  function walk(directory, prefix = '') {
    for (const name of fs.readdirSync(directory).sort()) {
      const relative = safeRelative(prefix ? prefix + '/' + name : name);
      if (entries.length >= 300000) fail('BUNDLE_TOO_LARGE', 'Release contains too many entries');
      if (relative === MANIFEST_FILE) continue;
      if (prohibited(relative)) fail('FORBIDDEN_BUNDLE_CONTENT', 'Release bundle contains secret or mutable-state paths');
      const filename = path.join(absolute, relative);
      const stat = fs.lstatSync(filename);
      if (stat.mode & 0o7000) fail('UNSAFE_FILE_MODE', 'Special permission bits are not allowed in release bundles');
      if (stat.isDirectory()) {
        entries.push({ path: relative, type: 'directory', mode: stat.mode & 0o777 });
        walk(filename, relative);
      } else if (stat.isFile()) {
        const { size, mode, sha256 } = hashRegular(filename);
        totalBytes += size;
        if (totalBytes > 16 * 1024 * 1024 * 1024) fail('BUNDLE_TOO_LARGE', 'Release exceeds the bounded preparation size');
        entries.push({ path: relative, type: 'file', mode, size, sha256 });
      } else if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(filename);
        if (path.isAbsolute(target) || target.includes('\\') || target.includes('\0')) fail('UNSAFE_SYMLINK', 'Release symlink must be relative and remain inside the bundle');
        let resolved;
        try { resolved = fs.realpathSync(filename); } catch { fail('UNSAFE_SYMLINK', 'Release symlink must resolve inside the bundle'); }
        if (resolved !== absolute && !resolved.startsWith(absolute + path.sep)) fail('UNSAFE_SYMLINK', 'Release symlink escapes the bundle');
        entries.push({ path: relative, type: 'symlink', target });
      } else fail('UNSAFE_FILE_TYPE', 'Special files are not allowed in release bundles');
    }
  }
  walk(absolute);
  return entries;
}
function readGitTree(repository, sha) {
  if (!SHA1.test(sha || '')) fail('INVALID_SOURCE', 'A complete source commit SHA is required');
  const invoke = args => execFileSync('git', ['-C', rootDirectory(repository), ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1' } });
  let commit, tree, raw;
  try {
    commit = invoke(['rev-parse', '--verify', sha + '^{commit}']).trim();
    tree = invoke(['rev-parse', '--verify', sha + '^{tree}']).trim();
    raw = invoke(['ls-tree', '-rz', '--full-tree', sha]);
  } catch { fail('SOURCE_UNAVAILABLE', 'The exact source commit is not available in the local repository'); }
  if (commit !== sha || !SHA1.test(tree)) fail('INVALID_SOURCE', 'Source commit identity does not match');
  const files = raw.split('\0').filter(Boolean).map(line => {
    const tab = line.indexOf('\t');
    const [mode, type, object] = line.slice(0, tab).split(' ');
    const relative = safeRelative(line.slice(tab + 1));
    if (type !== 'blob' || !['100644', '100755', '120000'].includes(mode) || !SHA1.test(object)) fail('UNSUPPORTED_SOURCE', 'Submodules and unsupported source entries require explicit packaging support');
    if (prohibited(relative) || relative === MANIFEST_FILE) fail('FORBIDDEN_SOURCE', 'Tracked source includes a reserved or secret-bearing bundle path');
    return { path: relative, mode, object };
  });
  if (!files.length) fail('INVALID_SOURCE', 'Source tree is empty');
  return { sha, tree, files };
}
function verifySourceFiles(root, source, entries) {
  for (const file of source.files) {
    const filename = path.join(root, safeRelative(file.path));
    const stat = fs.lstatSync(filename);
    let object;
    if (file.mode === '120000') {
      if (!stat.isSymbolicLink()) fail('SOURCE_MISMATCH', 'Tracked source symlink changed');
      const bytes = Buffer.from(fs.readlinkSync(filename));
      object = crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
    } else {
      if (!stat.isFile() || Boolean(stat.mode & 0o111) !== (file.mode === '100755')) fail('SOURCE_MISMATCH', 'Tracked source file type or executable mode changed');
      object = hashRegular(filename).gitBlob;
    }
    if (object !== file.object) fail('SOURCE_MISMATCH', 'Bundle source does not match the exact committed tree');
  }
  const tracked = new Set(source.files.map(file => file.path));
  const directories = new Set();
  for (const filename of tracked) {
    const parts = filename.split('/'); parts.pop();
    while (parts.length) { directories.add(parts.join('/')); parts.pop(); }
  }
  for (const entry of entries) {
    if (['.next', 'node_modules'].includes(entry.path.split('/')[0])) continue;
    // Prebuild copies these public browser assets directly from the pinned npm
    // dependency. Accept only byte-identical files, not an arbitrary public tree.
    if (entry.path === 'public/mediapipe-wasm' && entry.type === 'directory') continue;
    if (/^public\/mediapipe-wasm\/[A-Za-z0-9_.-]+\.(wasm|js)$/.test(entry.path) && entry.type === 'file') {
      const dependency = entries.find(item => item.path === 'node_modules/@mediapipe/tasks-vision/wasm/' + path.basename(entry.path));
      if (!dependency || dependency.type !== 'file' || dependency.sha256 !== entry.sha256) fail('GENERATED_ASSET_MISMATCH', 'Public runtime asset differs from its pinned dependency.');
      continue;
    }
    if (entry.type === 'directory' ? directories.has(entry.path) : tracked.has(entry.path)) continue;
    fail('UNTRACKED_SOURCE', 'Extra source/assets outside explicit build and dependency namespaces are not accepted');
  }
}
function validateShape(manifest) {
  if (!manifest || manifest.version !== 1 || !SHA256.test(manifest.digest || '') || !Array.isArray(manifest.entries) || !manifest.entries.length || !SHA1.test(manifest.source?.sha || '') || !SHA1.test(manifest.source?.tree || '') || !Array.isArray(manifest.source?.files) || !manifest.source.files.length) fail('INVALID_MANIFEST', 'Release manifest is incomplete');
  if (!BUILD_ID.test(manifest.buildId || '') || !ID.test(manifest.configuration?.version || '') || !SHA256.test(manifest.configuration?.digest || '')) fail('INVALID_IDENTITY', 'Build and configuration identities are required');
  if (!SHA256.test(manifest.runtime?.nodeBinarySha256 || '') || !/^\d+$/.test(manifest.runtime?.modulesAbi || '') || !/^v\d+\.\d+\.\d+$/.test(manifest.runtime?.node || '') || !['linux', 'darwin', 'win32'].includes(manifest.runtime?.platform) || !['x64', 'arm64'].includes(manifest.runtime?.arch)) fail('INVALID_RUNTIME', 'Runtime identity is incomplete');
  if (manifest.releaseId !== manifest.source.sha + '-' + manifest.digest.slice(0, 16)) fail('INVALID_IDENTITY', 'Release ID does not match its source and content digest');
  for (const entry of manifest.entries) safeRelative(entry.path);
  if (!SHA256.test(manifest.migrationDigest || '') || manifest.migrationDigest !== migrationIdentity(manifest.entries)) fail('INVALID_MIGRATIONS', 'Migration identity is inconsistent');
  const sourcePaths = new Set();
  for (const entry of manifest.source.files) {
    safeRelative(entry.path);
    if (sourcePaths.has(entry.path) || !['100644', '100755', '120000'].includes(entry.mode) || !SHA1.test(entry.object || '')) fail('INVALID_SOURCE', 'Source manifest entries are invalid or duplicated');
    sourcePaths.add(entry.path);
  }
  const body = { ...manifest }; delete body.digest; delete body.releaseId;
  if (digest(canonical(body)) !== manifest.digest) fail('MANIFEST_DIGEST_MISMATCH', 'Release manifest digest does not match');
}
function createManifest({ bundleDirectory, sourceRepository, sourceSha, configuration }) {
  const root = rootDirectory(bundleDirectory);
  if (!ID.test(configuration?.version || '') || !SHA256.test(configuration?.digest || '')) fail('INVALID_CONFIGURATION', 'A versioned configuration identity is required; never put secret values in the manifest');
  const source = readGitTree(sourceRepository, sourceSha);
  const entries = inventory(root);
  for (const required of REQUIRED) if (!entries.some(entry => entry.path === required && entry.type === 'file')) fail('INCOMPLETE_RELEASE', 'Full frontend, backend and installed dependencies are required');
  for (const required of REQUIRED_DIRS) if (!entries.some(entry => entry.path === required && entry.type === 'directory')) fail('INCOMPLETE_RELEASE', 'A complete runtime source directory is missing');
  verifySourceFiles(root, source, entries);
  const buildId = readRegular(path.join(root, '.next/BUILD_ID')).content.toString('utf8').trim();
  if (!BUILD_ID.test(buildId)) fail('INVALID_BUILD', 'Frontend build identity is invalid');
  const body = { version: 1, source, buildId, runtime: runtimeIdentity(), migrationDigest: migrationIdentity(entries), configuration: { version: configuration.version, digest: configuration.digest }, entries };
  const hash = digest(canonical(body));
  return { ...body, digest: hash, releaseId: source.sha + '-' + hash.slice(0, 16) };
}
function verifyBundle(directory, expectedDigest, { matchRuntime = false } = {}) {
  const root = rootDirectory(directory);
  let manifest;
  try { manifest = JSON.parse(readRegular(path.join(root, MANIFEST_FILE)).content.toString('utf8')); } catch (error) { if (error instanceof ReleaseError) throw error; fail('INVALID_MANIFEST', 'A readable release manifest is required'); }
  validateShape(manifest);
  if (!SHA256.test(expectedDigest || '') || manifest.digest !== expectedDigest) fail('UNTRUSTED_MANIFEST', 'An independently supplied expected manifest digest is required');
  if (canonical(inventory(root)) !== canonical(manifest.entries)) fail('BUNDLE_MISMATCH', 'Release content, permissions or dependency tree changed');
  verifySourceFiles(root, manifest.source, manifest.entries);
  if (matchRuntime && canonical(manifest.runtime) !== canonical(runtimeIdentity())) fail('RUNTIME_MISMATCH', 'Release was prepared for a different runtime');
  return manifest;
}

module.exports = { ReleaseError, fail, digest, canonical, safeRelative, rootDirectory, readRegular, hashRegular, runtimeIdentity, inventory, createManifest, verifyBundle, validateShape, MANIFEST_FILE, ID, SHA256 };
