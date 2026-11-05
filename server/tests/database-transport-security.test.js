'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const net = require('node:net');
const tls = require('node:tls');
const { once } = require('node:events');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const { buildDatabaseConfig, isNeonHost, readRootCertificates } = require('../db/connectionConfig');
const { resolveNeonConfig } = require('../db/resolve-neon-url');
const { createSchemaCheckPool } = require('../db/verifyMigrationHistory');
const { requireOpenSsl } = require('./deployment-test-capabilities.cjs');
const ROOT = path.resolve(__dirname, '../..');
const URL_BASE = 'postgresql://fictional:fixture-password@db.fixture.invalid/fictional';
const production = (extras = {}) => ({ NODE_ENV: 'production', DATABASE_URL: URL_BASE, ...extras });

function assertSecure(config, expectedHost) {
  assert.equal(Object.hasOwn(config, 'connectionString'), false);
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(config.ssl.minVersion, 'TLSv1.2');
  assert.equal(typeof config.ssl.checkServerIdentity, 'function');
  const client = new Client(config);
  assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
  assert.equal(client.connectionParameters.ssl.checkServerIdentity, config.ssl.checkServerIdentity);
  assert.equal(client.connectionParameters.host, config.host);
  const wrong = config.ssl.checkServerIdentity('localhost', { subjectaltname: 'DNS:localhost' });
  assert.equal(wrong.code, 'ERR_TLS_CERT_ALTNAME_INVALID', expectedHost);
}

test('production and remote connections default to certificate and pinned hostname verification in actual pg Client', () => {
  for (const NODE_ENV of ['production', 'development', 'test', undefined]) {
    for (const query of ['', '?sslmode=require', '?sslmode=verify-ca', '?sslmode=verify-full']) {
      const config = buildDatabaseConfig({ NODE_ENV, DATABASE_URL: URL_BASE + query });
      assertSecure(config, 'db.fixture.invalid');
      assert.equal(config.ssl.servername, 'db.fixture.invalid');
    }
  }
  const ip = buildDatabaseConfig(production({ DATABASE_URL: 'postgresql://fictional:fixture-password@192.0.2.1/fixture' }));
  assertSecure(ip, '192.0.2.1'); assert.equal(ip.ssl.servername, undefined);
  assert.equal(ip.ssl.checkServerIdentity('localhost', { subjectaltname: 'IP Address:192.0.2.1' }), undefined);
});

test('local development keeps explicit local transport, never production plaintext or unknown environment downgrade', () => {
  for (const NODE_ENV of ['development', 'test']) {
    for (const host of ['localhost', '127.0.0.1', '127.0.0.2', '[::1]']) {
      assert.equal(buildDatabaseConfig({ NODE_ENV, DATABASE_URL: `postgresql://fixture@${host}/fixture?sslmode=disable` }).ssl, false);
    }
  }
  assert.equal(buildDatabaseConfig({ NODE_ENV: 'development', PGHOST: '/fictional/local/socket' }).ssl, false);
  for (const PGHOST of ['[localhost', 'localhost]', '[localhost]', '[127.0.0.1]', '[::1', '::1]']) assert.throws(() => buildDatabaseConfig({ NODE_ENV: 'development', PGHOST }), { code: 'DATABASE_HOST_INVALID' });
  assert.equal(buildDatabaseConfig({}).ssl.rejectUnauthorized, true);
  assert.throws(() => buildDatabaseConfig({ DATABASE_URL: 'postgresql://fixture@localhost/fixture?sslmode=disable' }), { code: 'DATABASE_TLS_REQUIRED' });
  for (const NODE_ENV of ['production', 'prod', 'staging']) assert.throws(() => buildDatabaseConfig({ NODE_ENV }), error => error.code.startsWith('DATABASE_'));
  for (const suffix of ['disable', 'prefer', 'allow', 'no-verify', 'false', '0', '']) {
    assert.throws(() => buildDatabaseConfig(production({ DATABASE_URL: URL_BASE + '?sslmode=' + suffix })), error => error.code.startsWith('DATABASE_'));
  }
  assert.throws(() => buildDatabaseConfig(production({ DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1/fixture?sslmode=disable' })), { code: 'DATABASE_TLS_REQUIRED' });
  assert.equal(buildDatabaseConfig({ NODE_ENV: 'development', PGHOST: 'remote.fixture.invalid', PGUSER: 'fixture', PGPASSWORD: 'fixture', PGDATABASE: 'fixture' }).ssl.rejectUnauthorized, true);
});

test('ambiguous URL and ambient driver options fail before any parser can override TLS or read credentials', () => {
  for (const query of ['ssl=no-verify', 'sslrootcert=/fictional/private', 'sslkey=/fictional/private', 'sslcert=/fictional/private', 'uselibpqcompat=true', 'host=localhost', 'port=1234', 'user=other', 'password=other', 'options=-cfoo', 'sslmode=require&sslmode=disable', 'sslmode=require&sslmode=require', 'application_name=a&application_name=b', 'channel_binding=require']) {
    assert.throws(() => buildDatabaseConfig(production({ DATABASE_URL: URL_BASE + '?' + query })), error => { assert.doesNotMatch(error.message, /fixture-password|fictional\/private/); return error.code.startsWith('DATABASE_'); });
  }
  for (const key of ['NODE_PG_FORCE_NATIVE', 'PGOPTIONS', 'PGREPLICATION', 'PGSSLKEY', 'PGSSLCERT', 'PGSSLCRL', 'PGSSLCRLDIR', 'PGSSLNEGOTIATION']) assert.throws(() => buildDatabaseConfig(production({ [key]: 'fictional-unsupported' })), error => error.code.startsWith('DATABASE_'));
  assert.throws(() => buildDatabaseConfig(production({ NODE_TLS_REJECT_UNAUTHORIZED: '0' })), { code: 'DATABASE_TLS_VERIFICATION_DISABLED' });
  assert.throws(() => buildDatabaseConfig(production({ DATABASE_URL: URL_BASE + '?sslmode=verify-full', PGSSLMODE: 'disable' })), { code: 'DATABASE_TLS_MODE_CONFLICT' });
  assert.throws(() => buildDatabaseConfig(production({ PGCHANNELBINDING: 'require' })), { code: 'DATABASE_CHANNEL_BINDING_UNSUPPORTED' });
  assert.equal(buildDatabaseConfig(production({ DATABASE_URL: URL_BASE + '?channel_binding=prefer' })).enableChannelBinding, true);
  assert.equal(buildDatabaseConfig(production({ DATABASE_URL: URL_BASE + '?channel_binding=disable' })).enableChannelBinding, false);
  for (const url of [URL_BASE + '#hidden', 'http://fixture:fixture@host/fixture', 'postgresql://fixture:fixture@db.fixture.invalid:65536/fixture', 'postgresql://fixture:fixture@%2flocalhost/fixture', 'postgresql://fixture:fixture@host%00/fixture', 'postgresql://fixture:%ZZ@host/fixture']) assert.throws(() => buildDatabaseConfig(production({ DATABASE_URL: url })), error => error.code.startsWith('DATABASE_'));
});

test('empty URL password cannot inherit an ambient password through pg truthiness fallbacks', () => {
  const config = buildDatabaseConfig({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://fixture@localhost/fixture', PGPASSWORD: 'fictional-must-not-override' });
  const client = new Client(config);
  assert.equal(typeof client.password, 'function');
  assert.equal(client.password(), '');
  assert.throws(() => buildDatabaseConfig(production({ DATABASE_URL: 'postgresql://fixture@db.fixture.invalid/fixture' })), { code: 'DATABASE_AUTH_UNCONFIGURED' });
});

test('candidate checker retains explicit test-only loopback plaintext and verifies production localhost', async () => {
  for (const options of [
    { NODE_ENV: 'test', DATABASE_URL: 'postgresql://fixture:fixture@localhost/fixture', encrypted: true },
    { NODE_ENV: 'test', DATABASE_URL: 'postgresql://fixture:fixture@localhost/fixture?sslmode=disable', encrypted: false },
    { NODE_ENV: 'production', DATABASE_URL: 'postgresql://fixture:fixture@localhost/fixture', encrypted: true },
  ]) {
    const pool = createSchemaCheckPool(options);
    assert.equal(Boolean(pool.options.ssl), options.encrypted); await pool.end();
  }
  assert.throws(() => createSchemaCheckPool({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://fixture:fixture@localhost/fixture?sslmode=disable' }), { code: 'SCHEMA_CHECK_DATABASE_CONFIGURATION' });
});

test('Neon classification uses the parsed host, preserves identity on IPv4 dialing and bounds DNS failures', async () => {
  for (const host of ['neon.tech.attacker.invalid', 'notneon.tech', 'example.invalid', '/fictional/local.neon.tech']) assert.equal(isNeonHost(host), false);
  let calls = 0;
  const plain = buildDatabaseConfig(production({ DATABASE_URL: 'postgresql://neon.tech:fixture@example.invalid/fixture' }));
  assert.equal(await resolveNeonConfig(plain, { lookup() { calls++; } }), plain); assert.equal(calls, 0);
  const config = buildDatabaseConfig(production({ DATABASE_URL: 'postgresql://fixture:fixture@tenant.fixture.neon.tech/fixture?sslmode=require' }));
  const resolved = await resolveNeonConfig(config, { lookup: async host => { assert.equal(host, 'tenant.fixture.neon.tech'); return ['192.0.2.5']; } });
  assert.equal(resolved.host, '192.0.2.5'); assert.equal(config.host, 'tenant.fixture.neon.tech');
  assert.equal(resolved.ssl.servername, config.host); assert.equal(resolved.ssl.checkServerIdentity, config.ssl.checkServerIdentity); assertSecure(resolved, config.host);
  for (const lookup of [async () => [], async () => ['::1'], async () => { throw new Error('PRIVATE_HOST_DETAIL'); }, () => new Promise(() => {})]) {
    await assert.rejects(resolveNeonConfig(config, { lookup, timeoutMs: 5 }), error => error.code === 'DATABASE_DNS_UNAVAILABLE' && !error.message.includes('PRIVATE'));
  }
});

function createCertificates(openssl) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'doctarx-synthetic-tls-'));
  const run = args => execFileSync(openssl, args, { cwd: directory, stdio: 'ignore', timeout: 10000 });
  try {
    run(['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '2', '-subj', '/CN=DoctaRx Synthetic Test CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-keyout', 'ca.key', '-out', 'ca.crt']);
    for (const [name, names] of [['matching', 'DNS:db.fixture.invalid,DNS:tenant.fixture.neon.tech,IP:127.0.0.1'], ['wrong', 'DNS:localhost']]) {
      run(['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-subj', '/CN=' + name + '.fixture.invalid', '-keyout', name + '.key', '-out', name + '.csr']);
      fs.writeFileSync(path.join(directory, name + '.ext'), 'subjectAltName=' + names + '\nbasicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\n');
      run(['x509', '-req', '-in', name + '.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-days', '2', '-extfile', name + '.ext', '-out', name + '.crt']);
    }
    return { directory, ca: path.join(directory, 'ca.crt'), cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
  } catch (error) { fs.rmSync(directory, { recursive: true, force: true }); throw error; }
}

async function postgresTlsFixture(certificates, name, supportsTls = true) {
  const sockets = new Set(); const events = [];
  const context = supportsTls ? tls.createSecureContext({ key: fs.readFileSync(path.join(certificates.directory, name + '.key')), cert: fs.readFileSync(path.join(certificates.directory, name + '.crt')) }) : null;
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    socket.once('data', bytes => {
      events.push('ssl-request'); assert.equal(bytes.toString('hex'), '0000000804d2162f');
      if (!supportsTls) { socket.end('N'); return; }
      socket.write('S');
      const secure = new tls.TLSSocket(socket, { isServer: true, secureContext: context });
      sockets.add(secure); secure.on('close', () => sockets.delete(secure)); secure.on('error', () => {});
      secure.once('data', () => {
        events.push('encrypted-startup');
        // AuthenticationOk then ReadyForQuery; no SQL or real credentials used.
        secure.write(Buffer.from('5200000008000000005a0000000549', 'hex'));
        secure.on('data', () => secure.end());
      });
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { port: server.address().port, events, async close() { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); } };
}

function readCaBytesFixture(bytes, { file = true, changedSize = false } = {}) {
  // Inject an already bounded synthetic descriptor to exercise the production
  // CA parser on every OS. Real pathname/no-follow behavior is tested below.
  let reads = 0, stats = 0, closed = false;
  const fakeFs = {
    constants: { O_RDONLY: 0, O_NOFOLLOW: 1, O_NONBLOCK: 2 },
    openSync(_filename, flags) { assert.equal(flags, 3); return 17; },
    fstatSync(descriptor) { assert.equal(descriptor, 17); return { isFile: () => file, size: bytes.length + (changedSize && stats++ ? 1 : 0), mtimeMs: 1, ctimeMs: 1 }; },
    readSync(descriptor, target, offset, length, position) { assert.equal(descriptor, 17); reads++; return bytes.copy(target, offset, position, position + length); },
    closeSync(descriptor) { assert.equal(descriptor, 17); closed = true; },
  };
  const loaded = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'server/db/connectionConfig.js'), 'utf8'), {
    module: loaded, exports: loaded.exports, Buffer, URL, process: { cwd: () => ROOT },
    require: name => name === 'node:fs' ? fakeFs : require(name),
  });
  return { read() { return loaded.exports.readRootCertificates('fictional-ca.pem'); }, reads: () => reads, closed: () => closed };
}

test('CA byte validation remains bounded and rejects malformed, mixed, changing or non-file descriptors on every OS', () => {
  const publicCa = Buffer.from(tls.rootCertificates[0]);
  const valid = readCaBytesFixture(publicCa);
  assert.match(valid.read(), /BEGIN CERTIFICATE/); assert.equal(valid.closed(), true);
  const privateMaterial = '\n-----BEGIN PRIVATE KEY-----\nFICTIONAL\n-----END PRIVATE KEY-----';
  for (const bytes of [Buffer.alloc(0), Buffer.from('NOT A CERTIFICATE'), Buffer.from(privateMaterial), Buffer.concat([publicCa, Buffer.from(privateMaterial)]), Buffer.concat([publicCa, Buffer.from('\nUNEXPECTED TRAILING DATA')]), Buffer.alloc(1024 * 1024 + 1)]) {
    const fixture = readCaBytesFixture(bytes);
    assert.throws(fixture.read, { code: 'DATABASE_CA_INVALID' }); assert.equal(fixture.closed(), true);
    if (bytes.length > 1024 * 1024) assert.equal(fixture.reads(), 0, 'Reject oversized metadata before reading bytes');
  }
  for (const options of [{ file: false }, { changedSize: true }]) assert.throws(readCaBytesFixture(publicCa, options).read, { code: 'DATABASE_CA_INVALID' });
});

test('CA loading accepts public certificates only with safe descriptor support, otherwise fails closed', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'doctarx-public-ca-'));
  const ca = path.join(directory, 'ca.crt');
  // A public certificate bundled with Node is a parser fixture only. It is
  // never installed into process trust or used as an impersonated TLS peer.
  assert.ok(tls.rootCertificates.length > 0);
  fs.writeFileSync(ca, tls.rootCertificates[0]);
  try {
    if (!Number.isInteger(fs.constants.O_NOFOLLOW) || !Number.isInteger(fs.constants.O_NONBLOCK)) {
      let opened = 0;
      t.mock.method(fs, 'openSync', () => { opened++; throw new Error('No pathname may be opened without safe flags'); });
      assert.throws(() => readRootCertificates(ca), { code: 'DATABASE_CA_INVALID' });
      assert.throws(() => buildDatabaseConfig(production({ PGSSLROOTCERT: ca })), { code: 'DATABASE_CA_INVALID' });
      assert.equal(opened, 0);
      return;
    }
    assert.match(readRootCertificates(ca), /BEGIN CERTIFICATE/);
    fs.symlinkSync(ca, path.join(directory, 'alias'));
    execFileSync('mkfifo', [path.join(directory, 'pipe')]);
    fs.writeFileSync(path.join(directory, 'large'), Buffer.alloc(1024 * 1024 + 1));
    fs.writeFileSync(path.join(directory, 'garbage'), 'NOT A CERTIFICATE');
    fs.writeFileSync(path.join(directory, 'key'), '-----BEGIN PRIVATE KEY-----\nFICTIONAL\n-----END PRIVATE KEY-----');
    fs.writeFileSync(path.join(directory, 'mixed'), tls.rootCertificates[0] + fs.readFileSync(path.join(directory, 'key'), 'utf8'));
    for (const name of ['absent', 'alias', 'pipe', 'large', 'garbage', 'mixed', 'key', '.']) {
      assert.throws(() => readRootCertificates(path.join(directory, name)), error => error.code === 'DATABASE_CA_INVALID' && !error.message.includes(directory));
    }
    assert.throws(() => buildDatabaseConfig(production({ PGSSLROOTCERT: path.join(directory, 'absent') })), { code: 'DATABASE_CA_INVALID' });
    assert.throws(() => buildDatabaseConfig({ NODE_ENV: 'development', PGSSLROOTCERT: ca }), { code: 'DATABASE_CA_WITHOUT_TLS' });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('actual pg TLS handshake accepts matching peers and rejects wrong identity, untrusted CA and plaintext fallback', { timeout: 20000 }, async t => {
  const openssl = requireOpenSsl(t);
  if (!openssl) return;
  const certificates = createCertificates(openssl);
  try {
    for (const scenario of ['dns', 'ip', 'neon', 'wrong-dns', 'wrong-ip', 'untrusted', 'no-tls']) {
      const server = await postgresTlsFixture(certificates, scenario.startsWith('wrong') ? 'wrong' : 'matching', scenario !== 'no-tls');
      let client;
      try {
        const host = scenario === 'ip' || scenario === 'wrong-ip' ? '127.0.0.1' : scenario === 'neon' ? 'tenant.fixture.neon.tech' : 'db.fixture.invalid';
        let config = buildDatabaseConfig(production({ DATABASE_URL: `postgresql://fixture:fixture@${host}:${server.port}/fixture`, ...(scenario === 'untrusted' ? {} : { PGSSLROOTCERT: certificates.ca }) }));
        if (scenario === 'neon') config = await resolveNeonConfig(config, { lookup: async () => ['127.0.0.1'] });
        else config = { ...config, host: '127.0.0.1' }; // Test transport only; pinned original identity remains unchanged.
        client = new Client({ ...config, connectionTimeoutMillis: 2000 });
        if (['dns', 'ip', 'neon'].includes(scenario)) { await client.connect(); assert.equal(client.connection.stream.authorized, true); assert.ok(server.events.includes('encrypted-startup')); }
        else { await assert.rejects(client.connect(), error => /certificate|SSL connections|verify/i.test(error.message)); assert.equal(server.events.includes('encrypted-startup'), false); }
      } finally { await client?.end().catch(() => {}); await server.close(); }
    }
  } finally { certificates.cleanup(); }
});

function loadPoolEntry(relative, env) {
  const pools = [], isolated = { exports: {} };
  const FakePool = class { constructor(config) { pools.push(config); } on() {} async end() {} };
  const filename = path.join(ROOT, relative);
  const importer = name => {
    if (name === 'dotenv') return { config() {} };
    if (name === 'pg') return { Pool: FakePool };
    if (name === './connectionConfig') return require('../db/connectionConfig');
    if (name === './resolve-neon-url') return { resolveNeonConfig() { assert.fail('No live DNS permitted'); } };
    if (['fs', 'path', 'crypto'].includes(name)) return require(name);
    assert.fail('Unexpected pool dependency: ' + name);
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: isolated, __dirname: path.dirname(filename), require: importer, process: { env }, console: { log() {}, warn() {}, error() {} } });
  return { pools, exports: isolated.exports };
}

test('actual primary, backup and canonical migration entries use explicit secure pool configuration', async () => {
  const primary = loadPoolEntry('server/db/index.js', production());
  await primary.exports.getPool();
  assert.equal(primary.pools.length, 1); assertSecure(primary.pools[0], 'db.fixture.invalid');
  const backup = loadPoolEntry('server/db/backup.js', production({ BACKUP_DATABASE_URL: URL_BASE + '?sslmode=require' }));
  assert.equal(backup.pools.length, 1); assertSecure(backup.pools[0], 'db.fixture.invalid');
  const migration = loadPoolEntry('server/db/migrate.js', production({ DATABASE_URL: URL_BASE + '?sslmode=verify-full' }));
  assert.equal(migration.pools.length, 0, 'definition imports remain side-effect free');
  await assert.rejects(migration.exports.runMigrations({ migrations: [] }), /connect/);
  assert.equal(migration.pools.length, 1); assertSecure(migration.pools[0], 'db.fixture.invalid');
  const blocked = loadPoolEntry('server/db/index.js', production({ DATABASE_URL: URL_BASE + '?ssl=no-verify' }));
  await assert.rejects(blocked.exports.query('SELECT 1'), { code: 'DATABASE_URL_OPTION_UNSUPPORTED' });
  assert.equal(blocked.pools.length, 0);
  assert.throws(() => loadPoolEntry('server/db/backup.js', production({ BACKUP_DATABASE_URL: URL_BASE + '?sslmode=disable' })), { code: 'DATABASE_TLS_REQUIRED' });
});
