'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { fixtureTargetSafety } = require('../scripts/fixtureTargetSafety');

const LOCAL = 'postgresql://fixture:isolated-password@127.0.0.1:5432/doctarx_guard_test';
const ENV = { NODE_ENV: 'test', DATABASE_URL: LOCAL };
function assertDisabled(result) {
  assert.equal(result.skipped, true);
  assert.equal(result.noWrites, true);
  assert.equal(result.code, 'FIXTURE_WRITES_DISABLED');
  assert.doesNotMatch(JSON.stringify(result), /isolated-password|production-password/);
}

test('production fixture refusal precedes pool access and cannot be overridden by old seed flags', () => {
  for (const NODE_ENV of ['production', 'PRODUCTION', ' production ']) {
    const pool = { get options() { throw new Error('Production guard must not inspect or connect to the pool'); } };
    assertDisabled(fixtureTargetSafety({ pool, env: { ...ENV, NODE_ENV, ALLOW_PRODUCTION_SIMULATION: 'true', ALLOW_DATABASE_URL_SIMULATION: 'true', NG_FORCE_SEED_DISCOVERY: 'true', ALLOW_DEFAULT_DEMO_PASSWORD: 'true' } }));
  }
});

test('only explicit loopback PostgreSQL databases ending in _test qualify for non-production fixtures', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const databaseUrl = `postgresql://fixture:isolated-password@${host}:5433/guard_test`;
    for (const NODE_ENV of ['test', 'development', undefined]) {
      const result = fixtureTargetSafety({ env: { NODE_ENV, DATABASE_URL: databaseUrl } });
      assert.equal(result.skipped, false);
      assert.equal(result.target.port, 5433);
      assert.equal(result.target.database, 'guard_test');
      assert.doesNotMatch(JSON.stringify(result), /isolated-password/);
    }
  }
});

test('remote, production-named, ambiguous and overridden connection URLs are refused without connecting', () => {
  for (const DATABASE_URL of [
    undefined, '', 'invalid', 'https://localhost/guard_test',
    'postgresql://fixture:production-password@db.example/guard_test',
    'postgresql://fixture@127.0.0.2/guard_test',
    'postgresql://fixture@localhost/doctarx',
    'postgresql://fixture@localhost/guard_test/other',
    'postgresql://fixture@localhost/guard_test?host=production.example',
    'postgresql://fixture@localhost/guard_test?database=production',
    'postgresql://fixture@localhost/guard_test?sslmode=disable',
    'postgresql://fixture@localhost/guard_test#ambiguous',
    'postgresql://fixture@localhost:0/guard_test',
    'postgresql://fixture@localhost/guard%2Funsafe_test',
  ]) assertDisabled(fixtureTargetSafety({ env: { ...ENV, DATABASE_URL } }));
});

test('a supplied pool or transaction client must match the exact approved target metadata', () => {
  for (const pool of [
    {}, null,
    { options: { connectionString: 'postgresql://fixture@remote.example/doctarx_guard_test' } },
    { options: { connectionString: LOCAL, host: 'remote.example' } },
    { options: { connectionString: LOCAL, database: 'other_test' } },
    { options: { connectionString: LOCAL, port: 5433 } },
    { options: { host: '127.0.0.1', database: 'doctarx_guard_test', port: 5432, stream: {} } },
    { options: { host: '127.0.0.1', database: 'doctarx_guard_test', port: 5432, service: 'hidden-target' } },
    { options: { host: '127.0.0.1', database: 'doctarx_guard_test', port: 5432, hostaddr: '192.0.2.1' } },
    { connectionParameters: { host: '127.0.0.1', database: 'production', port: 5432 } },
  ]) assertDisabled(fixtureTargetSafety({ pool, env: ENV }));
  for (const pool of [
    { options: { connectionString: LOCAL } },
    { options: { host: '127.0.0.1', database: 'doctarx_guard_test', port: 5432 } },
    { connectionParameters: { host: '127.0.0.1', database: 'doctarx_guard_test', port: 5432 } },
  ]) assert.equal(fixtureTargetSafety({ pool, env: ENV }).skipped, false);
});

test('simulation URL selection is explicit and cannot approve a different actual database pool', () => {
  const env = { ...ENV, SIMULATION_DATABASE_URL: 'postgresql://fixture@localhost/other_test' };
  assert.equal(fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL', env }).target.database, 'other_test');
  assertDisabled(fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL', pool: { options: { connectionString: LOCAL } }, env }));
  assert.equal(fixtureTargetSafety({ source: 'DATABASE_URL', pool: { options: { connectionString: LOCAL } }, env }).skipped, false);
});

// Execute only guarded, refusing paths from the actual scripts. Every SQL,
// migration, password hash, CSV read and connection constructor is a tripwire.
function scriptFixture(script, env, poolOptions) {
  const filename = path.resolve(__dirname, '../scripts', script);
  const isolated = { exports: {} };
  let poolReads = 0;
  const refuse = () => { throw new Error('Guard test must never connect, seed, read fixture data or execute SQL'); };
  const pool = { options: poolOptions, query: refuse, connect: refuse };
  const dependencies = {
    './fixtureTargetSafety': { fixtureTargetSafety: options => fixtureTargetSafety({ ...options, env }) },
    fs: { readFileSync: refuse }, path,
    '../services/discovery/utils': {},
    '../../server/db': { getPool() { poolReads++; return pool; } },
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    __dirname: path.dirname(filename), module: isolated, process: { env },
    require(name) { assert.ok(name in dependencies, 'Guard must run before loading dependency: ' + name); return dependencies[name]; },
  }, { filename });
  return { service: isolated.exports, pool, poolReads: () => poolReads };
}

test('demo account and programme seeding refuse production before hashing, connection or SQL', async () => {
  const f = scriptFixture('seed-demo-accounts.js', { ...ENV, NODE_ENV: 'production' });
  assertDisabled(await f.service.seedDemoAccounts({ pool: f.pool, password: 'unused' }));
  assertDisabled(await f.service.ensureDemoProgrammeScope(f.pool, []));
  assert.equal(f.poolReads(), 0);
});

test('demo account and programme seeding refuse remote or mismatched supplied pools without touching SQL', async () => {
  for (const options of [{ connectionString: 'postgresql://fixture@remote.example/doctarx_guard_test' }, { connectionString: LOCAL, database: 'other_test' }]) {
    const f = scriptFixture('seed-demo-accounts.js', ENV, options);
    assertDisabled(await f.service.seedDemoAccounts({ pool: f.pool, password: 'unused' }));
    assertDisabled(await f.service.ensureDemoProgrammeScope(f.pool, []));
    assert.equal(f.poolReads(), 0);
  }
});

test('discovery ingestion refuses production or remote configured targets before importing database or migrations', async () => {
  for (const env of [{ ...ENV, NODE_ENV: 'production' }, { ...ENV, DATABASE_URL: 'postgresql://fixture@remote.example/doctarx_guard_test' }]) {
    const f = scriptFixture('ingest-doctarx-nigeria-pack.js', env);
    assertDisabled(await f.service.ingestNigeriaPack());
    assertDisabled(await f.service.seedNigeriaDiscoveryIfNeeded());
    assert.equal(f.poolReads(), 0);
  }
});

test('discovery validates actual eager or lazy pool metadata before migrations, CSV reads or queries', async () => {
  for (const options of [
    { connectionString: 'postgresql://fixture@remote.example/doctarx_guard_test' },
    async () => ({ connectionString: 'postgresql://fixture@localhost/other_test' }),
  ]) {
    const f = scriptFixture('ingest-doctarx-nigeria-pack.js', ENV, options);
    assertDisabled(await f.service.ingestNigeriaPack());
    assertDisabled(await f.service.seedNigeriaDiscoveryIfNeeded());
    assert.equal(f.poolReads(), 2);
  }
});
