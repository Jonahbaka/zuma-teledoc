'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const ts = require('typescript');
const { Client } = require('pg');
const databaseTransport = require('../db/connectionConfig');
const root = path.resolve(__dirname, '../..');
const DATABASE_URL = 'postgresql://fixture:fictional-password@db.fixture.invalid/fixture';

// Transpile actual source, but never load config, a scheduler, reporting, external
// SDKs or real DB clients. Every non-pure dependency must be explicitly trapped.
function loadTs(file, dependencies, env = {}, expose = '') {
  const source = fs.readFileSync(path.join(root, file), 'utf8') + '\n' + expose;
  const result = ts.transpileModule(source, { fileName: file, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
  assert.equal(result.diagnostics.length, 0);
  const isolated = { exports: {} };
  vm.runInNewContext(result.outputText, { module: isolated, exports: isolated.exports, URL, Date,
    process: { env: Object.freeze({ ...env }) }, __dirname: path.dirname(path.join(root, file)),
    console: { error() {}, log() {} },
    require(name) { assert.ok(Object.hasOwn(dependencies, name), 'Unexpected dependency: ' + name); return dependencies[name]; },
  }, { filename: file });
  return isolated.exports;
}
function probeModule() {
  return loadTs('cronops/services/transport.ts', { tls: require('node:tls'), '../../server/db/connectionConfig': databaseTransport });
}
function databaseModule(env, queryError) {
  const pools = [], queries = [];
  class Pool {
    constructor(config) { this.options = config; pools.push(this); }
    on(event, fn) { assert.equal(event, 'error'); this.error = fn; }
    async query(text, params) { queries.push({ text, params }); if (queryError) throw queryError; return { rows: [{ ping: 1 }] }; }
    async end() { this.ended = true; }
  }
  const loaded = loadTs('cronops/services/db.ts', { pg: { Pool },
    '../config': { DATABASE_URL: env.DATABASE_URL, PGSSLROOTCERT: env.PGSSLROOTCERT || '', NODE_ENV: env.NODE_ENV || 'production', DRY_RUN: true },
    '../../server/db/connectionConfig': databaseTransport,
  }, env);
  return { module: loaded, pools, queries };
}

test('CronOps pool uses explicit verified fields, preserves limits, caches lazily and closes', async () => {
  const fixture = databaseModule({ DATABASE_URL, NODE_ENV: 'production' });
  assert.equal(fixture.pools.length, 0);
  assert.equal((await fixture.module.healthCheck()).ok, true);
  const options = fixture.pools[0].options;
  assert.equal(options.connectionString, undefined);
  assert.equal(options.ssl.rejectUnauthorized, true); assert.equal(options.ssl.minVersion, 'TLSv1.2');
  assert.equal(options.ssl.servername, 'db.fixture.invalid');
  assert.equal(options.ssl.checkServerIdentity('localhost', { subjectaltname: 'DNS:localhost' }).code, 'ERR_TLS_CERT_ALTNAME_INVALID');
  const client = new Client(options); assert.equal(client.connectionParameters.ssl, options.ssl);
  assert.equal(options.max, 3); assert.equal(options.idleTimeoutMillis, 30000); assert.equal(options.connectionTimeoutMillis, 10000);
  await fixture.module.healthCheck(); assert.equal(fixture.pools.length, 1);
  await fixture.module.closePool(); assert.equal(fixture.pools[0].ended, true);
  await fixture.module.healthCheck(); assert.equal(fixture.pools.length, 2);
});

test('CronOps invalid or weakened DB transport fails before pool, reports no raw secrets, preserves dry-run gate', async () => {
  for (const env of [
    { DATABASE_URL: DATABASE_URL + '?sslmode=disable' },
    { DATABASE_URL: DATABASE_URL + '?ssl=no-verify' },
    { DATABASE_URL: DATABASE_URL + '?sslrootcert=/fictional/private' },
    { DATABASE_URL, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    { DATABASE_URL, NODE_PG_FORCE_NATIVE: '1' },
    { DATABASE_URL, PGSSLROOTCERT: '/fictional/missing-ca.pem' },
    {},
  ]) {
    const fixture = databaseModule({ NODE_ENV: 'production', ...env });
    const result = await fixture.module.healthCheck();
    assert.equal(result.ok, false); assert.equal(result.error, 'Database connection unavailable.');
    assert.equal(fixture.pools.length, 0); assert.equal(fixture.queries.length, 0);
    await fixture.module.write('FICTIONAL WRITE'); assert.equal(fixture.pools.length, 0);
  }
  const fixture = databaseModule({ DATABASE_URL, NODE_ENV: 'production' }, new Error('fictional-secret DSN path'));
  const result = await fixture.module.healthCheck(); assert.equal(result.error, 'Database connection unavailable.');
});

test('CronOps local plaintext remains limited to explicitly development/test loopback', async () => {
  const local = 'postgresql://fictional:fictional@127.0.0.1/fixture';
  for (const NODE_ENV of ['development', 'test']) {
    const fixture = databaseModule({ DATABASE_URL: local, NODE_ENV });
    assert.equal((await fixture.module.healthCheck()).ok, true); assert.equal(fixture.pools[0].options.ssl, false);
  }
  for (const NODE_ENV of [undefined, 'production']) {
    const fixture = databaseModule({ DATABASE_URL: local, NODE_ENV });
    assert.equal((await fixture.module.healthCheck()).ok, true); assert.equal(fixture.pools[0].options.ssl.rejectUnauthorized, true);
  }
});

test('CronOps configuration uses platform trust by default and preserves an explicit CA path', () => {
  for (const PGSSLROOTCERT of [undefined, '/fictional/operator-public-ca.pem']) {
    const env = { DATABASE_URL, ...(PGSSLROOTCERT ? { PGSSLROOTCERT } : {}) };
    const fakeFs = { existsSync: () => false, mkdirSync() {} };
    const config = loadTs('cronops/config.ts', { path, fs: fakeFs, dotenv: { config() {} } }, env);
    assert.equal(config.PGSSLROOTCERT, PGSSLROOTCERT || ''); assert.equal(config.NODE_ENV, 'production');
  }
});

test('probe policy pins identity and refuses invalid transport without changing global environment', () => {
  const { buildProbeRequestOptions } = probeModule();
  const env = Object.freeze({ NODE_ENV: 'production' });
  const options = buildProbeRequestOptions('https://probe.fixture.invalid/health', env);
  assert.equal(options.rejectUnauthorized, true); assert.equal(options.minVersion, 'TLSv1.2');
  assert.equal(options.checkServerIdentity('localhost', { subjectaltname: 'DNS:localhost' }).code, 'ERR_TLS_CERT_ALTNAME_INVALID');
  assert.equal(options.checkServerIdentity('wrong.fixture.invalid', { subjectaltname: 'DNS:probe.fixture.invalid' }), undefined);
  const ip = buildProbeRequestOptions('https://127.0.0.1/health', env);
  assert.equal(ip.checkServerIdentity('localhost', { subjectaltname: 'DNS:localhost' }).code, 'ERR_TLS_CERT_ALTNAME_INVALID');
  assert.equal(ip.checkServerIdentity('localhost', { subjectaltname: 'IP Address:127.0.0.1' }), undefined);
  for (const target of ['http://probe.fixture.invalid/', 'http://localhost/', 'ftp://probe.fixture.invalid/',
    'https://fictional:private@probe.fixture.invalid/', 'https://probe.fixture.invalid/#fragment', 'not-a-url']) {
    assert.throws(() => buildProbeRequestOptions(target, env), { code: 'CRONOPS_PROBE_TRANSPORT_UNSAFE' });
  }
  assert.throws(() => buildProbeRequestOptions('https://probe.fixture.invalid/', { NODE_TLS_REJECT_UNAUTHORIZED: '0' }), { code: 'CRONOPS_PROBE_TRANSPORT_UNSAFE' });
  assert.throws(() => buildProbeRequestOptions('https://probe.fixture.invalid/', { NODE_ENV: 'prod' }), { code: 'CRONOPS_PROBE_TRANSPORT_UNSAFE' });
  assert.throws(() => buildProbeRequestOptions('http://localhost/', {}), { code: 'CRONOPS_PROBE_TRANSPORT_UNSAFE' });
  for (const NODE_ENV of ['development', 'test']) {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) assert.equal(Object.keys(buildProbeRequestOptions(`http://${host}/`, { NODE_ENV })).length, 0);
    assert.throws(() => buildProbeRequestOptions('http://remote.fixture.invalid/', { NODE_ENV }), { code: 'CRONOPS_PROBE_TRANSPORT_UNSAFE' });
  }
  assert.deepEqual(env, { NODE_ENV: 'production' });
});

function taskModule(file, env = {}, failure = false, httpOverride) {
  const calls = [];
  const http = httpOverride || { request(...args) {
    calls.push(args); const request = new EventEmitter();
    request.end = () => {
      if (failure) request.emit('error', new Error('certificate rejected'));
      else args.at(-1)({ statusCode: 200, resume() {}, socket: { getPeerCertificate: () => ({ valid_to: 'Jan 1 00:00:00 2099 GMT', issuer: { O: 'fictional' } }) } });
    };
    request.destroy = () => {};
    return request;
  } };
  const transport = loadTs('cronops/services/transport.ts', { tls: require('node:tls'), '../../server/db/connectionConfig': databaseTransport }, env);
  const loaded = loadTs(file, { https: http, http, os: {}, path,
    child_process: { execSync() { assert.fail('No command execution'); } },
    '../services/transport': transport, '../logger': {}, '../services/db': {}, '../services/reportWriter': {}, '../config': {},
  }, env, file.endsWith('security.ts') ? 'export const __probes = { checkSSL, checkEndpoint };' : 'export const __probes = { httpGet };');
  return { ...loaded.__probes, calls };
}

test('actual health/security request paths retain strict TLS and return failure on certificate errors', async () => {
  for (const failure of [false, true]) {
    const health = taskModule('cronops/tasks/healthcheck.ts', { NODE_ENV: 'production' }, failure);
    const security = taskModule('cronops/tasks/security.ts', { NODE_ENV: 'production' }, failure);
    assert.equal((await health.httpGet('https://probe.fixture.invalid/health')).ok, !failure);
    assert.equal((await security.checkEndpoint('https://probe.fixture.invalid/health')).ok, !failure);
    assert.equal((await security.checkSSL('probe.fixture.invalid')).valid, !failure);
    for (const args of [...health.calls, ...security.calls]) {
      const options = typeof args[0] === 'string' ? args[1] : args[0];
      assert.equal(options.rejectUnauthorized, true); assert.equal(options.minVersion, 'TLSv1.2');
      assert.equal(options.checkServerIdentity('localhost', { subjectaltname: 'DNS:localhost' }).code, 'ERR_TLS_CERT_ALTNAME_INVALID');
    }
  }
});

test('unsafe probe policy returns failed health and security results before any request', async () => {
  for (const env of [{ NODE_ENV: 'production' }, {}, { NODE_ENV: 'test', NODE_TLS_REJECT_UNAUTHORIZED: '0' }]) {
    const health = taskModule('cronops/tasks/healthcheck.ts', env);
    const security = taskModule('cronops/tasks/security.ts', env);
    assert.equal((await health.httpGet('http://localhost/health')).ok, false);
    assert.equal((await security.checkEndpoint('http://localhost/health')).ok, false);
    assert.equal(health.calls.length + security.calls.length, 0);
    if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
      assert.equal((await security.checkSSL('probe.fixture.invalid')).valid, false); assert.equal(security.calls.length, 0);
    }
  }
  const health = taskModule('cronops/tasks/healthcheck.ts', { NODE_ENV: 'test' });
  assert.equal((await health.httpGet('http://localhost/health')).ok, true);
});

test('real loopback HTTPS rejects an untrusted certificate before health/security success', async () => {
  const https = require('node:https');
  const os = require('node:os');
  const { once } = require('node:events');
  const { execFileSync } = require('node:child_process');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cronops-probe-tls-'));
  const keyFile = path.join(directory, 'fixture.key'), certFile = path.join(directory, 'fixture.crt');
  let server;
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes',
      '-keyout', keyFile, '-out', certFile, '-subj', '/CN=localhost', '-days', '1',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore', timeout: 10000 });
    const key = fs.readFileSync(keyFile), cert = fs.readFileSync(certFile);
    let received = 0;
    server = https.createServer({ key, cert }, (_request, response) => { received++; response.end('fixture'); });
    server.on('tlsClientError', () => {});
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const url = `https://127.0.0.1:${server.address().port}/health`;
    const health = taskModule('cronops/tasks/healthcheck.ts', { NODE_ENV: 'production' }, false, https);
    const security = taskModule('cronops/tasks/security.ts', { NODE_ENV: 'production' }, false, https);
    assert.equal((await health.httpGet(url)).ok, false);
    assert.equal((await security.checkEndpoint(url)).ok, false);
    assert.equal(received, 0, 'Untrusted TLS must not reach an HTTP handler');
    // Same synthetic endpoint succeeds with its explicit test CA and pinned IP.
    // This changes only this test request, never process trust or application config.
    const options = probeModule().buildProbeRequestOptions(url, { NODE_ENV: 'production' });
    const status = await new Promise((resolve, reject) => {
      const request = https.get(url, { ...options, ca: cert, agent: false }, response => { response.resume(); resolve(response.statusCode); });
      request.on('error', reject);
    });
    assert.equal(status, 200); assert.equal(received, 1);
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
