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

test('provider submission database fixtures refuse unsafe targets before pool, encryption or SQL', async () => {
  const filename = path.resolve(__dirname, 'provider-submission-authority-db.test.js');
  const env = { NODE_ENV: 'test', SIMULATION_DATABASE_URL: LOCAL };
  for (const [configuration, poolOptions] of [
    [{ ...env, NODE_ENV: 'production' }, null],
    [{ ...env, SIMULATION_DATABASE_URL: 'postgresql://fixture@remote.example/guard_test' }, null],
    [{ ...env, SIMULATION_DATABASE_URL: LOCAL + '?host=remote.example' }, null],
    [{ ...env, SIMULATION_DATABASE_URL: LOCAL + '?database=production' }, null],
    [{ ...env, SIMULATION_DATABASE_URL: LOCAL + '#ambiguous' }, null],
    [{ ...env }, { connectionString: LOCAL, host: 'remote.example' }],
    [{ ...env }, { connectionString: LOCAL, database: 'other_test' }],
    [{ ...env }, { connectionString: LOCAL, port: 5433 }],
  ]) {
    let callback, constructors = 0;
    const before = { ...configuration };
    const refuse = () => { throw new Error('Unsafe fixture must not connect, encrypt or execute SQL'); };
    const dependencies = {
      'node:test': (_name, _options, run) => { callback = run; },
      'node:assert/strict': assert,
      'node:crypto': require('node:crypto'),
      pg: { Pool: class {
        constructor() { constructors++; assert.ok(poolOptions, 'Guard must precede Pool construction'); this.options = poolOptions; }
        query = refuse; connect = refuse; end = refuse;
      } },
      '../../lib/encryption': { encrypt: refuse },
      '../services/rx-engine/privatePrescriptionUploadService': {},
      '../scripts/fixtureTargetSafety': { fixtureTargetSafety: options => fixtureTargetSafety({ ...options, env: configuration }) },
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      process: { env: configuration }, require(name) { assert.ok(name in dependencies); return dependencies[name]; },
    }, { filename });
    await assert.rejects(callback({}), /Fixture writes|supplied database pool/);
    assert.equal(constructors, poolOptions ? 1 : 0);
    assert.deepEqual(configuration, before, 'Rejected fixture must not alter environment configuration');
  }
});

function medicationFixture(env) {
  const filename = path.resolve(__dirname, 'helpers/medication-delivery-fixture.js');
  const mod = { exports: {} };
  const dependencies = {
    'node:crypto': require('node:crypto'),
    '../../scripts/fixtureTargetSafety': { fixtureTargetSafety: options => fixtureTargetSafety({ ...options, env }) },
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: mod, process: { env }, require(name) { assert.ok(name in dependencies); return dependencies[name]; },
  }, { filename });
  return mod.exports;
}

test('shared medication fixture validates explicit target and pool before environment mutation or SQL', async () => {
  const env = { NODE_ENV: 'test', SIMULATION_DATABASE_URL: LOCAL };
  const valid = { connectionString: LOCAL };
  for (const [configuration, options] of [
    [{ ...env, NODE_ENV: 'production' }, valid],
    [{ ...env, NODE_ENV: 'development' }, valid],
    [{ NODE_ENV: 'test' }, valid],
    [{ ...env, SIMULATION_DATABASE_URL: LOCAL + '?host=remote.example' }, { connectionString: LOCAL + '?host=remote.example' }],
    [{ ...env, SIMULATION_DATABASE_URL: 'postgresql://fixture@remote.example/guard_test' }, { connectionString: 'postgresql://fixture@remote.example/guard_test' }],
    [{ ...env }, { connectionString: LOCAL, host: 'remote.example' }],
    [{ ...env }, { connectionString: LOCAL, database: 'other_test' }],
    [{ ...env }, { connectionString: LOCAL, stream: {} }],
    [{ ...env }, undefined],
    [{ ...env }, null],
    [{ ...env }, {}],
  ]) {
    const before = { ...configuration };
    const refuse = () => { throw new Error('Unsafe medication fixture must never connect or execute SQL'); };
    const pool = options == null ? options : { options, query: refuse, connect: refuse };
    await assert.rejects(medicationFixture(configuration).createBrowserFixture({ pool }), /Fixtures require|Fixture writes|supplied database pool/);
    assert.deepEqual(configuration, before);
  }
});

function inventorySuiteFixture(suite, env, poolOptions) {
  const filename = path.resolve(__dirname, suite);
  let callback, constructors = 0, queries = 0, closes = 0;
  const stop = new Error('Safe fixture reached the first mocked SQL boundary');
  const dependencies = {
    'node:test': (_name, options, run) => { if (!options.skip) callback = run; },
    'node:assert/strict': assert, 'node:crypto': require('node:crypto'),
    pg: { Pool: class {
      constructor() { constructors++; assert.ok(poolOptions, 'Guard must precede Pool construction'); this.options = poolOptions; }
      query() { queries++; throw stop; }
      connect() { throw new Error('Guard test must never connect'); }
      async end() { closes++; }
    } },
    '../services/pharmacy/inventoryMutationService': {}, '../services/pharmacy/inventoryVerificationService': {},
    './helpers/medication-delivery-fixture': medicationFixture(env),
    '../scripts/fixtureTargetSafety': { fixtureTargetSafety: options => fixtureTargetSafety({ ...options, env }) },
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    process: { env }, require(name) { assert.ok(name in dependencies); return dependencies[name]; },
  }, { filename });
  return { run: () => callback?.({ test: (_name, action) => action() }), counts: () => ({ constructors, queries, closes }), stop };
}

test('inventory database suites reject original production mode and unsafe targets before changing environment', async () => {
  for (const suite of ['inventory-mutation-authority-db.test.js', 'inventory-verification-integrity-db.test.js']) {
    for (const [env, options] of [
      [{ NODE_ENV: 'production', SIMULATION_DATABASE_URL: LOCAL }, null],
      [{ NODE_ENV: 'production', SIMULATION_DATABASE_URL: LOCAL + '?host=remote.example' }, null],
      [{ NODE_ENV: 'test', SIMULATION_DATABASE_URL: LOCAL + '?host=remote.example' }, null],
      [{ NODE_ENV: 'test', SIMULATION_DATABASE_URL: 'postgresql://fixture@remote.example/guard_test' }, null],
      [{ NODE_ENV: 'test', SIMULATION_DATABASE_URL: LOCAL }, { connectionString: LOCAL, host: 'remote.example' }],
      [{ NODE_ENV: 'test', SIMULATION_DATABASE_URL: LOCAL }, { connectionString: LOCAL, database: 'other_test' }],
    ]) {
      const before = { ...env }, fixture = inventorySuiteFixture(suite, env, options);
      await assert.rejects(fixture.run(), /Fixture writes|supplied database pool/);
      assert.deepEqual(fixture.counts(), { constructors: options ? 1 : 0, queries: 0, closes: 0 });
      assert.deepEqual(env, before);
    }
    const absent = inventorySuiteFixture(suite, { NODE_ENV: 'test' }, null);
    assert.equal(absent.run(), undefined);
    assert.deepEqual(absent.counts(), { constructors: 0, queries: 0, closes: 0 });
  }
});

test('explicit safe non-production inventory targets still reach the fixture boundary and restore environment', async () => {
  for (const suite of ['inventory-mutation-authority-db.test.js', 'inventory-verification-integrity-db.test.js']) {
    for (const NODE_ENV of ['test', 'development']) {
      const env = { NODE_ENV, SIMULATION_DATABASE_URL: LOCAL }, before = { ...env };
      const fixture = inventorySuiteFixture(suite, env, { connectionString: LOCAL });
      await assert.rejects(fixture.run(), error => error === fixture.stop);
      assert.deepEqual(fixture.counts(), { constructors: 1, queries: 1, closes: 1 });
      assert.deepEqual(env, before);
    }
  }
});

// Load the real suites, but select only their opt-in database callbacks. All
// dependencies are inert, including the provider suite's module-loader shim.
function prescriptionSuiteFixture(suite, env, poolOptions) {
  const filename = path.resolve(__dirname, suite);
  const callbacks = [];
  let constructors = 0, connections = 0, queries = 0, closes = 0;
  const stop = new Error('Safe prescription fixture reached the first mocked database boundary');
  const refuse = () => { throw new Error('Fixture guard must run before image, encryption or service work'); };
  const dependencies = {
    'node:test': (name, options, run) => { if (name.startsWith('PostgreSQL') && !options.skip) callbacks.push(run); },
    'node:assert/strict': assert, crypto: require('node:crypto'), 'node:crypto': require('node:crypto'),
    'node:module': { _load: refuse }, express: refuse, sharp: refuse,
    '../services/rx-engine/privatePrescriptionUploadService': {},
    '../services/rx-engine/prescriptionWorkflowService': {},
    '../services/rx-engine/providerPrescriptionGuardService': {},
    '../routes/provider': {},
    '../scripts/fixtureTargetSafety': { fixtureTargetSafety: options => fixtureTargetSafety({ ...options, env }) },
    pg: { Pool: class {
      constructor(options) {
        constructors++;
        assert.ok(poolOptions, 'Guard must precede Pool construction');
        assert.equal(options.connectionString, env.SIMULATION_DATABASE_URL);
        this.options = poolOptions;
      }
      connect() { connections++; throw stop; }
      query() { queries++; throw stop; }
      async end() { closes++; }
    } },
  };
  const load = name => { assert.ok(name in dependencies, 'Unexpected fixture dependency: ' + name); return dependencies[name]; };
  load.resolve = name => name;
  load.cache = {};
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { process: { env }, require: load }, { filename });
  return { callbacks, counts: () => ({ constructors, connections, queries, closes }), stop };
}

const PRESCRIPTION_SUITES = [
  ['private-prescription-upload.test.js', 2],
  ['refill-lineage-integrity-db.test.js', 1],
  ['provider-prescription-authorization.test.js', 1],
];

test('direct prescription database fixtures reject production, ambiguous targets and mismatched pools before any access or environment change', async () => {
  for (const [suite, count] of PRESCRIPTION_SUITES) {
    for (const [configuration, options] of [
      [{ NODE_ENV: 'production', SIMULATION_DATABASE_URL: LOCAL }, null],
      [{ NODE_ENV: ' PRODUCTION ', SIMULATION_DATABASE_URL: LOCAL }, null],
      [{ NODE_ENV: 'test', SIMULATION_DATABASE_URL: LOCAL + '?host=remote.example' }, null],
      [{ NODE_ENV: 'test', SIMULATION_DATABASE_URL: LOCAL + '?database=production' }, null],
      [{ NODE_ENV: 'test', SIMULATION_DATABASE_URL: LOCAL + '#ambiguous' }, null],
      [{ NODE_ENV: 'test', SIMULATION_DATABASE_URL: 'postgresql://fixture@remote.example/guard_test' }, null],
      [{ NODE_ENV: 'test', SIMULATION_DATABASE_URL: 'postgresql://fixture@localhost/production' }, null],
      [{ NODE_ENV: 'test', SIMULATION_DATABASE_URL: LOCAL }, { connectionString: LOCAL, host: 'remote.example' }],
      [{ NODE_ENV: 'test', SIMULATION_DATABASE_URL: LOCAL }, { connectionString: LOCAL, database: 'other_test' }],
      [{ NODE_ENV: 'test', SIMULATION_DATABASE_URL: LOCAL }, { connectionString: LOCAL, port: 5433 }],
      [{ NODE_ENV: 'test', SIMULATION_DATABASE_URL: LOCAL }, { connectionString: LOCAL, stream: {} }],
      [{ NODE_ENV: 'test', SIMULATION_DATABASE_URL: LOCAL }, {}],
    ]) {
      let mutations = 0;
      const before = { ...configuration };
      const env = new Proxy(configuration, {
        set() { mutations++; throw new Error('Unsafe fixture must not mutate environment'); },
        deleteProperty() { mutations++; throw new Error('Unsafe fixture must not mutate environment'); },
      });
      const f = prescriptionSuiteFixture(suite, env, options);
      assert.equal(f.callbacks.length, count);
      for (const callback of f.callbacks) await assert.rejects(callback({}), /Fixture writes|supplied database pool/);
      assert.deepEqual(f.counts(), { constructors: options ? count : 0, connections: 0, queries: 0, closes: 0 });
      assert.equal(mutations, 0);
      assert.deepEqual(configuration, before);
    }
    const absent = prescriptionSuiteFixture(suite, { NODE_ENV: 'test' }, null);
    assert.equal(absent.callbacks.length, 0);
    assert.deepEqual(absent.counts(), { constructors: 0, connections: 0, queries: 0, closes: 0 });
  }
});

test('explicit safe prescription targets still reach their first mocked database boundary', async () => {
  for (const [suite, count] of PRESCRIPTION_SUITES) {
    for (const NODE_ENV of ['test', 'development']) {
      const env = { NODE_ENV, SIMULATION_DATABASE_URL: LOCAL }, before = { ...env };
      const f = prescriptionSuiteFixture(suite, env, { connectionString: LOCAL });
      assert.equal(f.callbacks.length, count);
      for (const callback of f.callbacks) await assert.rejects(callback({ test: (_name, run) => run() }), error => error === f.stop);
      const isRefill = suite === 'refill-lineage-integrity-db.test.js';
      assert.deepEqual(f.counts(), { constructors: count, connections: isRefill ? 0 : count, queries: isRefill ? count : 0, closes: isRefill ? count : 0 });
      assert.deepEqual(env, before);
    }
  }
});

// Application db imports initialize their own pool. Unsafe configured targets
// must therefore fail at module preflight, before even those imports. For valid
// configuration, keep application dependencies inert and exercise the actual
// opt-in callback only; pool counts below refer to its explicit fixture Pool.
function clinicalSuiteFixture(suite, env, poolOptions) {
  const filename = path.resolve(__dirname, '../../server/tests', suite);
  const callbacks = [];
  let constructors = 0, connections = 0, queries = 0, closes = 0, applicationImports = 0;
  const stop = new Error('Safe clinical fixture reached the first mocked database boundary');
  const refuse = () => { throw new Error('Fixture guard must precede application, encryption and filesystem work'); };
  const inert = new Proxy({}, { get: () => refuse });
  const dependencies = {
    'node:test': (_name, options, run) => {
      if (options && typeof options === 'object' && !options.skip) callbacks.push(run);
    },
    'node:assert/strict': assert, 'node:crypto': require('node:crypto'),
    'node:fs': inert, 'node:path': path, 'node:vm': inert,
    express: refuse, jsonwebtoken: inert,
    '../../lib/encryption': inert, '../services/clinicalContentService': inert,
    '../../ng/scripts/fixtureTargetSafety': { fixtureTargetSafety: options => {
      assert.equal(options.source, 'SIMULATION_DATABASE_URL');
      assert.equal(options.env, undefined, 'Validate the original environment, without a DATABASE_URL rewrite');
      return fixtureTargetSafety({ ...options, env });
    } },
    pg: { Pool: class {
      constructor(options) {
        constructors++;
        assert.ok(poolOptions, 'Configured target guard must precede fixture Pool construction');
        assert.equal(options.connectionString, env.SIMULATION_DATABASE_URL);
        this.options = poolOptions;
      }
      connect() { connections++; throw stop; }
      query() { queries++; throw stop; }
      async end() { closes++; }
    } },
  };
  const applicationDependencies = new Set(['../db', '../services/clinicalEncounterService',
    '../services/patientClinicalProfileService', '../services/eRxIntegrationService', '../services/medicalRecordService',
    '../services/telehealthConsentService']);
  let loadError;
  try {
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      process: { env }, require(name) {
        if (applicationDependencies.has(name)) { applicationImports++; return inert; }
        assert.ok(name in dependencies, 'Unexpected clinical fixture dependency: ' + name);
        return dependencies[name];
      },
    }, { filename });
  } catch (error) { loadError = error; }
  return { callbacks, loadError, applicationImports: () => applicationImports,
    counts: () => ({ constructors, connections, queries, closes }), stop };
}

const CLINICAL_SUITES = ['clinical-encounter-integrity.test.js', 'patient-clinical-profile-integrity.test.js',
  'clinical-narrative-privacy.test.js', 'erx-intent-integrity.test.js', 'medical-record-integrity.test.js',
  'telehealth-consent-authorization.test.js'];

function immutableFixtureEnvironment(configuration) {
  return new Proxy(configuration, {
    set() { throw new Error('Fixture must not mutate environment before the database boundary'); },
    deleteProperty() { throw new Error('Fixture must not mutate environment before the database boundary'); },
  });
}

test('clinical suite entrypoints reject unsafe configured targets before application imports, constructors or environment changes', () => {
  for (const suite of CLINICAL_SUITES) {
    for (const configuration of [
      ...['production', 'PRODUCTION', ' production '].map(NODE_ENV => ({ NODE_ENV, SIMULATION_DATABASE_URL: LOCAL })),
      ...['invalid', 'https://localhost/guard_test', 'postgresql://fixture@remote.example/guard_test',
        'postgresql://fixture@127.0.0.2/guard_test', 'postgresql://fixture@localhost/production',
        'postgresql://fixture@localhost/guard_test/other', LOCAL + '?host=remote.example',
        LOCAL + '?database=production', LOCAL + '?port=5433', LOCAL + '?sslmode=disable',
        LOCAL + '#ambiguous', 'postgresql://fixture@localhost:0/guard_test',
        'postgresql://fixture@localhost/guard%2Funsafe_test', ' ',
      ].map(SIMULATION_DATABASE_URL => ({ NODE_ENV: 'test', SIMULATION_DATABASE_URL })),
    ]) {
      configuration.DATABASE_URL = LOCAL;
      const before = { ...configuration };
      const f = clinicalSuiteFixture(suite, immutableFixtureEnvironment(configuration), null);
      assert.match(f.loadError?.message || '', /Fixture writes/, suite);
      assert.equal(f.applicationImports(), 0, 'Unsafe target must fail before eager application pool initialization');
      assert.deepEqual(f.counts(), { constructors: 0, connections: 0, queries: 0, closes: 0 });
      assert.deepEqual(configuration, before);
    }
  }
});

test('clinical database callbacks recheck configuration and effective Pool metadata before connecting', async () => {
  for (const suite of CLINICAL_SUITES) {
    for (const options of [
      { connectionString: LOCAL, host: 'remote.example' }, { connectionString: LOCAL, database: 'other_test' },
      { connectionString: LOCAL, port: 5433 }, { connectionString: LOCAL, stream: {} },
      { connectionString: LOCAL, hostaddr: '192.0.2.1' }, { connectionString: LOCAL, service: 'hidden-target' },
      { connectionString: 'postgresql://fixture@remote.example/guard_test' },
      { connectionString: LOCAL + '?host=remote.example' }, {},
    ]) {
      const configuration = { NODE_ENV: 'test', SIMULATION_DATABASE_URL: LOCAL, DATABASE_URL: 'postgresql://fixture@remote.example/production' };
      const before = { ...configuration };
      const f = clinicalSuiteFixture(suite, immutableFixtureEnvironment(configuration), options);
      assert.equal(f.loadError, undefined); assert.equal(f.callbacks.length, 1);
      await assert.rejects(f.callbacks[0]({}), /supplied database pool/);
      assert.deepEqual(f.counts(), { constructors: 1, connections: 0, queries: 0, closes: 0 });
      assert.deepEqual(configuration, before);
    }
    // Changing configuration after registration must not bypass callback checks.
    for (const changed of [{ NODE_ENV: 'production' }, { SIMULATION_DATABASE_URL: LOCAL + '?host=remote.example' }]) {
      const configuration = { NODE_ENV: 'test', SIMULATION_DATABASE_URL: LOCAL };
      const f = clinicalSuiteFixture(suite, immutableFixtureEnvironment(configuration), null);
      assert.equal(f.loadError, undefined); assert.equal(f.callbacks.length, 1);
      Object.assign(configuration, changed);
      await assert.rejects(f.callbacks[0]({}), /Fixture writes/);
      assert.deepEqual(f.counts(), { constructors: 0, connections: 0, queries: 0, closes: 0 });
    }
  }
});

test('clinical suites preserve absent-target skips and explicit safe target selection without database access', async () => {
  for (const suite of CLINICAL_SUITES) {
    for (const SIMULATION_DATABASE_URL of [undefined, '']) {
      const configuration = { NODE_ENV: 'test', DATABASE_URL: LOCAL };
      if (SIMULATION_DATABASE_URL !== undefined) configuration.SIMULATION_DATABASE_URL = SIMULATION_DATABASE_URL;
      const f = clinicalSuiteFixture(suite, immutableFixtureEnvironment(configuration), null);
      assert.equal(f.loadError, undefined); assert.equal(f.callbacks.length, 0);
      assert.deepEqual(f.counts(), { constructors: 0, connections: 0, queries: 0, closes: 0 });
    }
    for (const NODE_ENV of ['test', 'development', undefined]) {
      for (const host of ['localhost', '127.0.0.1', '[::1]']) {
        const target = `postgresql://fixture@${host}:5433/guard_test`;
        const configuration = { NODE_ENV, SIMULATION_DATABASE_URL: target, DATABASE_URL: 'postgresql://fixture@remote.example/production' };
        const before = { ...configuration };
        const f = clinicalSuiteFixture(suite, immutableFixtureEnvironment(configuration), { connectionString: target });
        assert.equal(f.loadError, undefined); assert.equal(f.callbacks.length, 1);
        await assert.rejects(f.callbacks[0]({}), error => error === f.stop);
        assert.deepEqual(f.counts(), { constructors: 1, connections: 1, queries: 0, closes: 0 });
        assert.deepEqual(configuration, before);
      }
    }
  }
});
