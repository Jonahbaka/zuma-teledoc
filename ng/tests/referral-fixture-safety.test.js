'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
function loadDemo(env) {
  const filename = path.resolve(__dirname, '../scripts/seed-demo-mode.js');
  const actual = createRequire(filename); const mod = { exports: {} };
  const customRequire = name => name === '../services/referral-network/referralNetworkService' ? {} : actual(name);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: mod, exports: mod.exports, require: customRequire, console, process: { env, argv: ['node', filename, '--force'] } }, { filename });
  return mod.exports;
}
test('demo force cannot bypass production, remote, unmarked database or pool mismatch guards', () => {
  for (const env of [
    { NODE_ENV: 'production', DATABASE_URL: 'postgres://localhost/drn_test' },
    { DATABASE_URL: 'postgres://remote.invalid/drn_test' },
    { DATABASE_URL: 'postgres://localhost/clinical' },
  ]) assert.throws(() => loadDemo({ ...env, DEMO_MODE: 'true' }).abortGuard(), /Fixture/);
  const seed = loadDemo({ DEMO_MODE: 'true', DATABASE_URL: 'postgres://localhost/drn_test' });
  assert.throws(() => seed.abortGuard({ options: { connectionString: 'postgres://localhost/other_test' } }), /same explicit/);
});
test('seed refuses existing non-test identity without promoting account or provider', async () => {
  const env = { DEMO_MODE: 'true', DATABASE_URL: 'postgres://localhost/drn_test' };
  const seed = loadDemo(env); const queries = [];
  const pool = { options: { connectionString: env.DATABASE_URL }, query: async sql => {
    queries.push(sql); return { rows: [{ id: 'existing', role: 'provider', market_scope: 'NG', is_active: true, is_test_account: false }] };
  } };
  await assert.rejects(seed.syntheticProvider(pool, 'origin'), /not an active synthetic/);
  assert.equal(queries.length, 1); assert.ok(queries[0].startsWith('SELECT'));
});
test('live simulation refuses remote database even with synthetic label before accessing a pool', () => {
  const filename = path.resolve(__dirname, '../scripts/simulate-live.js');
  const actual = createRequire(filename); let poolCreated = false;
  assert.throws(() => vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: name => name === 'dotenv' ? { config() {} } : name === 'pg' ? { Pool: class { constructor() { poolCreated = true; } } } : actual(name),
    console: { error() {}, log() {} },
    process: { env: { DATABASE_URL: 'postgres://remote.invalid/drn_test', NG_LIVE_SIMULATION_TARGET: 'synthetic' }, argv: [], exit: code => { throw new Error(`exit:${code}`); } },
  }, { filename }), /exit:2/);
  assert.equal(poolCreated, false);
});
test('new fixture provider uses disabled login, NG/test markers and a separate synthetic identity', async () => {
  const env = { DEMO_MODE: 'true', DATABASE_URL: 'postgres://localhost/drn_test' };
  const seed = loadDemo(env); const queries = [];
  const pool = { options: { connectionString: env.DATABASE_URL }, query: async (sql, values) => {
    queries.push({ sql, values });
    if (sql.startsWith('INSERT INTO users')) return { rows: [{ id: 'synthetic-user' }] };
    if (sql.startsWith('INSERT INTO ng_providers')) return { rows: [{ id: 'synthetic-provider' }] };
    return { rows: [] };
  } };
  const actor = await seed.syntheticProvider(pool, 'origin');
  assert.equal(actor.user_id, 'synthetic-user'); assert.equal(actor.provider_id, 'synthetic-provider');
  const account = queries.find(q => q.sql.startsWith('INSERT INTO users'));
  assert.match(account.sql, /!disabled-synthetic/); assert.match(account.sql, /TRUE,TRUE,'NG'/);
  assert.equal(account.values[0], 'drn-fixture-origin@example.invalid');
  assert.equal(queries.find(q => q.sql.startsWith('INSERT INTO ng_providers')).values[1], '[SYNTHETIC DRN] origin');
  assert.ok(!queries.some(q => /^UPDATE/.test(q.sql)));
});
