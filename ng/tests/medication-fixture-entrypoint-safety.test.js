'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { fixtureTargetSafety } = require('../scripts/fixtureTargetSafety');

const LOCAL = 'postgresql://fixture:isolated-password@127.0.0.1:5432/medication_guard_test';
const SUITES = [
  'pharmacist-rx-authorization', 'clinical-inbox-integrity', 'medication-request-integrity',
  'return-custody', 'medication-delivery-workflow', 'medication-delivery-http', 'medication-delivery-settlement',
].map(name => `ng/tests/${name}-db.test.js`);
const TIMEZONES = 'ng/tests/sql-date-expiry-db.test.js';
const SCENARIO = 'ng/tests/helpers/sql-date-db-scenario.js';
const BROWSER = 'scripts/e2e-medication-delivery.cjs';

// Execute the real modules and registered callbacks in a VM. No pg, app,
// browser, transport or child-process implementation is loaded.
function entrypoint(file, configuration, { poolOptions, safeBoundary = false, stopOnMutation = false } = {}) {
  const filename = path.resolve(__dirname, '../..', file);
  const counts = { pools: 0, sql: 0, connects: 0, ends: 0, writes: 0, spawns: 0, network: 0, mutations: 0 };
  const stop = new Error('Approved fixture reached the mocked boundary');
  const callbacks = [], children = [];
  const env = new Proxy({ ...configuration }, {
    set(object, name, value) { counts.mutations++; if (stopOnMutation) throw stop; object[name] = value; return true; },
    deleteProperty(object, name) { counts.mutations++; delete object[name]; return true; },
  });
  const trip = kind => () => { counts[kind]++; throw new Error('Unexpected effect: ' + kind); };
  const pool = class {
    constructor(options) {
      counts.pools++;
      assert.ok(poolOptions, 'Guard must run before pool construction');
      this.options = poolOptions === true ? options : poolOptions;
      if (safeBoundary) throw stop;
    }
    query() { counts.sql++; throw stop; }
    connect() { counts.connects++; throw stop; }
    async end() { counts.ends++; }
  };
  const guard = { fixtureTargetSafety: options => fixtureTargetSafety({ ...options, env }) };
  const dependencies = {
    'node:test': (_name, options, run) => { if (!options.skip) callbacks.push(run); },
    'node:assert/strict': assert, 'node:crypto': require('node:crypto'), 'node:path': path,
    'node:util': require('node:util'),
    'node:child_process': {
      spawn: trip('spawns'),
      execFile(command, args, options, callback) {
        counts.spawns++; children.push({ command, args, options }); callback(null, '', '');
      },
    },
    'node:fs': { readFileSync: trip('writes'), mkdirSync: trip('writes'), writeFileSync: trip('writes'), openSync: trip('writes') },
    pg: { Pool: pool },
    '../server/db/connectionConfig': require('../../server/db/connectionConfig'),
    '@playwright/test': { chromium: { launch: trip('network') } },
    '@axe-core/playwright': { default: trip('network') },
    express: trip('network'), cors: trip('network'), 'cookie-parser': trip('network'), jsonwebtoken: {},
    '../services/pharmacy/pharmacistRxService': {}, '../services/pharmacy/clinicalInboxService': {},
    '../services/logistics/medicationFinanceService': {},
    '../services/pharmacy/medicationRequestService': {}, '../services/pharmacy/returnCustodyService': {},
    '../../services/pharmacy/pharmacistRxService': {}, '../../services/pharmacy/clinicalInboxService': {},
    '../../services/interop/medicationFhirService': {}, '../../services/shared/sqlDate': {},
    '../scripts/fixtureTargetSafety': guard, '../../scripts/fixtureTargetSafety': guard, '../ng/scripts/fixtureTargetSafety': guard,
  };
  const isolated = { exports: {} };
  const load = name => {
    if (name.endsWith('/medication-delivery-fixture')) {
      const fixtureModule = { exports: {} };
      const helper = path.resolve(__dirname, 'helpers/medication-delivery-fixture.js');
      vm.runInNewContext(fs.readFileSync(helper, 'utf8'), {
        module: fixtureModule, process: { env }, require: load,
      }, { filename: helper });
      return fixtureModule.exports;
    }
    assert.ok(name in dependencies, 'Unexpected dependency before safety boundary: ' + name);
    return dependencies[name];
  };
  load.resolve = name => name;
  load.cache = {};
  let loadError;
  try {
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      module: isolated, require: load, process: { env, execPath: '/mock/node' }, __dirname: path.dirname(filename),
      URL, fetch: trip('network'),
    }, { filename });
  } catch (error) { loadError = error; }
  return {
    env, counts, children, stop, callbacks,
    async run() {
      if (loadError) throw loadError;
      if (file === SCENARIO) return isolated.exports.run();
      for (const callback of callbacks) await callback({ test: (_name, run) => run() });
    },
  };
}

const rejected = [
  ...['production', 'PRODUCTION', ' production '].map(NODE_ENV => ({ NODE_ENV, SIMULATION_DATABASE_URL: LOCAL })),
  ...[
    'invalid', 'https://localhost/guard_test', 'postgresql://fixture@remote.example/guard_test',
    'postgresql://fixture@localhost/production', LOCAL + '?host=remote.example',
    LOCAL + '?database=production', LOCAL + '?sslmode=disable', LOCAL + '#fragment',
    'postgresql://fixture@localhost:0/guard_test', 'postgresql://fixture@localhost/guard%2Funsafe_test',
  ].map(SIMULATION_DATABASE_URL => ({ NODE_ENV: 'test', SIMULATION_DATABASE_URL })),
];

test('all medication callers reject original production mode and unsafe URLs before any effect', async () => {
  for (const file of [...SUITES, TIMEZONES, SCENARIO, BROWSER]) {
    for (const env of rejected) {
      const f = entrypoint(file, env);
      await assert.rejects(f.run(), /Fixture writes/, file);
      assert.deepEqual(f.counts, { pools: 0, sql: 0, connects: 0, ends: 0, writes: 0, spawns: 0, network: 0, mutations: 0 }, file);
      assert.deepEqual({ ...f.env }, env);
    }
  }
});

test('actual medication pools must match the approved target before SQL or environment changes', async () => {
  for (const file of [...SUITES, SCENARIO, BROWSER]) {
    for (const poolOptions of [
      {}, { connectionString: LOCAL, host: 'remote.example' }, { connectionString: LOCAL, database: 'other_test' },
      { connectionString: LOCAL, port: 5433 }, { connectionString: LOCAL, stream: {} },
    ]) {
      const env = { NODE_ENV: 'test', SIMULATION_DATABASE_URL: LOCAL };
      const f = entrypoint(file, env, { poolOptions });
      await assert.rejects(f.run(), /supplied database pool/, file);
      assert.deepEqual(f.counts, { pools: 1, sql: 0, connects: 0, ends: file === SCENARIO ? 1 : 0, writes: 0, spawns: 0, network: 0, mutations: 0 }, file);
      assert.deepEqual({ ...f.env }, env);
    }
  }
});

test('optional suites still skip absent targets; explicit helper and browser entrypoints refuse', async () => {
  for (const file of [...SUITES, TIMEZONES, SCENARIO, BROWSER]) {
    const f = entrypoint(file, { NODE_ENV: 'production', DATABASE_URL: LOCAL });
    if ([SCENARIO, BROWSER].includes(file)) await assert.rejects(f.run(), /Fixture writes/);
    else { await f.run(); assert.equal(f.callbacks.length, 0); }
    assert.equal(Object.values(f.counts).every(value => value === 0), true, file);
  }
});

test('valid non-production callers reach pool construction with original environment unchanged', async () => {
  for (const file of [...SUITES, SCENARIO, BROWSER]) {
    for (const NODE_ENV of file === SCENARIO ? ['test'] : ['test', 'development', undefined]) {
      for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
        const env = { NODE_ENV, SIMULATION_DATABASE_URL: `postgresql://fixture@${host}:5433/safe_test` };
        const f = entrypoint(file, env, { poolOptions: true, safeBoundary: true });
        await assert.rejects(f.run(), error => error === f.stop, file);
        assert.equal(f.counts.pools, 1);
        assert.equal(f.counts.mutations, 0);
      }
    }
  }
});

test('SQL date child launch preserves all three timezone scenarios only after approval', async () => {
  for (const NODE_ENV of ['test', 'development', undefined]) {
    const env = { NODE_ENV, SIMULATION_DATABASE_URL: LOCAL };
    const f = entrypoint(TIMEZONES, env);
    await f.run();
    assert.deepEqual(f.children.map(child => child.options.env.TZ), ['UTC', 'Africa/Lagos', 'America/New_York']);
    for (const child of f.children) {
      assert.equal(child.command, '/mock/node');
      assert.equal(child.options.env.NODE_ENV, 'test');
      assert.equal(child.options.env.SIMULATION_DATABASE_URL, LOCAL);
      assert.match(child.args[1], /sql-date-db-scenario/);
      assert.equal(child.options.timeout, 90000);
    }
    assert.equal(f.counts.mutations, 0);
  }
});

test('SQL date scenario verifies its actual pool before connecting even before shared fixture creation', async () => {
  const f = entrypoint(SCENARIO, { NODE_ENV: 'test', SIMULATION_DATABASE_URL: LOCAL }, { poolOptions: true });
  await assert.rejects(f.run(), error => error === f.stop);
  assert.equal(f.counts.connects, 1);
  assert.equal(f.counts.ends, 1);
  assert.equal(f.counts.sql, 0);
});

test('approved actual pools pass validation before callers configure their isolated test mode', async () => {
  for (const file of [...SUITES, BROWSER]) {
    for (const NODE_ENV of ['test', 'development', undefined]) {
      const env = { NODE_ENV, SIMULATION_DATABASE_URL: LOCAL };
      const f = entrypoint(file, env, { poolOptions: true, stopOnMutation: true });
      await assert.rejects(f.run(), error => error === f.stop, file);
      assert.deepEqual(f.counts, { pools: 1, sql: 0, connects: 0, ends: 0, writes: 0, spawns: 0, network: 0, mutations: 1 }, file);
      assert.deepEqual({ ...f.env }, env);
    }
  }
});

test('safe database suites still enter the real shared fixture and restore their original environment', async () => {
  for (const file of SUITES.filter(name => !name.includes('medication-delivery-http'))) {
    for (const NODE_ENV of ['test', 'development', undefined]) {
      const env = { NODE_ENV, SIMULATION_DATABASE_URL: LOCAL };
      const f = entrypoint(file, env, { poolOptions: true });
      await assert.rejects(f.run(), error => error === f.stop, file);
      assert.equal(f.counts.pools, 1);
      assert.equal(f.counts.sql, 1);
      assert.equal(f.counts.ends, 1);
      // Restoring an originally absent variable removes it from process.env.
      const expected = { ...env };
      if (NODE_ENV === undefined) delete expected.NODE_ENV;
      assert.deepEqual({ ...f.env }, expected, file);
    }
  }
});
