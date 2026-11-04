'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Client } = require('pg');
const transport = require('../db/connectionConfig');
const root = path.resolve(__dirname, '../..');
const files = [
  'server/scripts/approve-provider.js', 'server/scripts/setup-admin.js', 'server/scripts/run-migration.js',
  'ng/scripts/simulationSafety.js', 'ng/scripts/simulate-live.js', 'ng/scripts/seed-demo-mode.js',
  'scripts/e2e-medication-delivery.cjs',
];
const REMOTE = 'postgresql://fictional:fictional-password@db.fixture.invalid/fixture';
const LOCAL = 'postgresql://fictional:fictional-password@127.0.0.1:5433/local_test';

// Only the actual constructor expression is evaluated, never an administrative,
// migration, approval, seeding or browser workflow. All pg operations are mocks.
function poolExpression(file, env, selected = env.DATABASE_URL) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const start = source.indexOf('new Pool(');
  let end = -1, depth = 0, quote = null, escaped = false;
  for (let index = source.indexOf('(', start); index < source.length; index++) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (['\"', "'", '`'].includes(character)) { quote = character; continue; }
    if (character === '(') depth++;
    if (character === ')' && --depth === 0) { end = index; break; }
  }
  assert.ok(start >= 0 && end > start);
  const configs = [];
  const evaluate = () => vm.runInNewContext(source.slice(start, end + 1), {
    process: { env }, env, resolved: { url: selected }, target: selected,
    Pool: class { constructor(config) { configs.push(config); this.options = config; } },
    require(name) { assert.ok(name.endsWith('/db/connectionConfig')); return transport; },
  });
  return { evaluate, configs };
}

for (const file of files) test('legacy pool uses explicit verified configuration: ' + file, () => {
  const env = Object.freeze({ NODE_ENV: 'production', DATABASE_URL: REMOTE + '?sslmode=require' });
  const fixture = poolExpression(file, env); fixture.evaluate();
  assert.equal(fixture.configs.length, 1);
  const config = fixture.configs[0];
  assert.equal(config.connectionString, undefined); assert.equal(config.host, 'db.fixture.invalid');
  const client = new Client(config);
  assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
  assert.equal(client.connectionParameters.ssl.servername, 'db.fixture.invalid');
  assert.equal(client.connectionParameters.ssl.checkServerIdentity('localhost', { subjectaltname: 'DNS:localhost' }).code, 'ERR_TLS_CERT_ALTNAME_INVALID');
  assert.deepEqual(env, { NODE_ENV: 'production', DATABASE_URL: REMOTE + '?sslmode=require' });
});

test('legacy entries cannot lower TLS, use native overrides, inherit absent targets or change global verification', () => {
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /NODE_TLS_REJECT_UNAUTHORIZED\s*=/);
    assert.doesNotMatch(source, /rejectUnauthorized\s*:\s*false/);
    for (const env of [
      { NODE_ENV: 'production', DATABASE_URL: REMOTE + '?sslmode=disable' },
      { NODE_ENV: 'production', DATABASE_URL: REMOTE + '?ssl=no-verify' },
      { NODE_ENV: 'production', DATABASE_URL: REMOTE, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
      { NODE_ENV: 'production', DATABASE_URL: REMOTE, NODE_PG_FORCE_NATIVE: '1' },
      { NODE_ENV: 'test' },
    ]) {
      const fixture = poolExpression(file, Object.freeze(env));
      assert.throws(fixture.evaluate, error => error.code.startsWith('DATABASE_'), file);
      assert.deepEqual(fixture.configs, [], file);
    }
    const local = poolExpression(file, { NODE_ENV: 'test', DATABASE_URL: LOCAL }); local.evaluate();
    assert.equal(local.configs[0].ssl, false, file);
    const unlabeled = poolExpression(file, { DATABASE_URL: LOCAL }); unlabeled.evaluate();
    assert.equal(unlabeled.configs[0].ssl.rejectUnauthorized, true, file);
  }
});

function simulationModule() {
  const isolated = { exports: {} }, configs = [];
  vm.runInNewContext(fs.readFileSync(path.join(root, 'ng/scripts/simulationSafety.js'), 'utf8'), {
    module: isolated, URL,
    require(name) {
      if (name === 'pg') return { Pool: class { constructor(config) { configs.push(config); this.options = config; } } };
      assert.equal(name, '../../server/db/connectionConfig'); return transport;
    },
  });
  return { ...isolated.exports, configs };
}

test('simulation transport uses the guarded selected URL and preserves limits without ambient target substitution', () => {
  const simulation = simulationModule();
  const env = Object.freeze({ NODE_ENV: 'test', SIMULATION_DATABASE_URL: LOCAL, DATABASE_URL: REMOTE + '?ssl=no-verify',
    SIMULATION_DB_POOL_MAX: '7', SIMULATION_DB_CONNECT_TIMEOUT_MS: '1234', SIMULATION_DB_QUERY_TIMEOUT_MS: '5678' });
  const result = simulation.createSimulationPool(env);
  assert.equal(result.source, 'SIMULATION_DATABASE_URL'); assert.equal(result.url, LOCAL);
  assert.equal(result.pool.options.host, '127.0.0.1'); assert.equal(result.pool.options.database, 'local_test'); assert.equal(result.pool.options.port, 5433);
  assert.equal(result.pool.options.max, 7); assert.equal(result.pool.options.connectionTimeoutMillis, 1234); assert.equal(result.pool.options.query_timeout, 5678);
  assert.equal(result.pool.options.ssl, false); assert.equal(result.pool.options.connectionString, undefined);
});

test('simulation source and production-like-target guards still run before transport/pool construction', () => {
  const simulation = simulationModule();
  assert.throws(() => simulation.createSimulationPool({ NODE_ENV: 'test', DATABASE_URL: LOCAL }), /Refusing to mutate DATABASE_URL/);
  assert.throws(() => simulation.createSimulationPool({ NODE_ENV: 'test', SIMULATION_DATABASE_URL: 'postgresql://fictional:fictional@fixture.neon.tech/fixture' }), /Refusing production-like simulation target/);
  assert.equal(simulation.configs.length, 0);
  assert.throws(() => simulation.createSimulationPool({ NODE_ENV: 'test', SIMULATION_DATABASE_URL: 'postgresql://fictional:fictional@fixture.neon.tech/fixture?sslmode=disable', ALLOW_PRODUCTION_SIMULATION: 'true' }), { code: 'DATABASE_TLS_REQUIRED' });
  assert.equal(simulation.configs.length, 0);
});

test('medication browser pool uses its explicit simulation target, not ambient DATABASE_URL', () => {
  const selected = LOCAL;
  const fixture = poolExpression('scripts/e2e-medication-delivery.cjs', { NODE_ENV: 'test', DATABASE_URL: REMOTE + '?ssl=no-verify', SIMULATION_DATABASE_URL: selected }, selected);
  fixture.evaluate(); assert.equal(fixture.configs[0].host, '127.0.0.1'); assert.equal(fixture.configs[0].database, 'local_test');
});
