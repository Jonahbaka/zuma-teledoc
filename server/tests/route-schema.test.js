'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSchemaVerifier } = require('../db/verifyRouteSchema');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

for (const name of ['persistent-memory', 'event-bus', 'goal-engine']) {
  test(`${name} initialization checks schema without creating tables or reading records`, async () => {
    const filename = path.join(__dirname, '../services/agent-orchestrator', name + '.js');
    const actual = createRequire(filename);
    for (const unavailable of [false, true]) {
      const sourceModule = { exports: {} }, calls = [];
      vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module: sourceModule, exports: sourceModule.exports, console: { log() {}, error() {} },
        require(dependency) {
          if (dependency === '../../middleware/logger') return { error() {} };
          if (dependency === '../../db') return { async query(sql) {
            calls.push(sql);
            assert.match(sql, /^SELECT [a-z_, ]+ FROM [a-z_]+ LIMIT 0$/);
            if (unavailable) throw new Error('Fictional absent schema');
            return { rows: [] };
          } };
          return actual(dependency);
        },
      });
      const service = name === 'persistent-memory' ? sourceModule.exports
        : new sourceModule.exports[name === 'event-bus' ? 'EventBus' : 'GoalEngine']();
      assert.deepEqual(calls, [], 'import must not query the database');
      await service.initialize();
      assert.equal(service.initialized, !unavailable);
      assert.ok(calls.length > 0);
    }
  });
}

test('serving verifies migration history before importing routes or starting workers', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
  assert.doesNotMatch(source, /runNgMigrations|runMigrations/);
  // Execute the actual initialization prefix up to the first heavy dependency.
  const prefix = source.slice(source.indexOf('async function initializeApp()'), source.indexOf("  const helmet = require('helmet');"));
  for (const fails of [true, false]) {
    const calls = [];
    const failure = Object.assign(new Error('fictional migration mismatch'), { code: 'MIGRATION_HISTORY_DRIFT' });
    const pool = {};
    const context = { nextInitStatus: 'pending', nextInitError: null, console: { log() {}, error() {} }, require(name) {
      calls.push(name);
      if (name === './db') return { getPool: () => pool };
      if (name === './db/verifyMigrationHistory') return { async verifyMigrationHistory(actual) {
        assert.equal(actual, pool);
        calls.push('verified');
        if (fails) throw failure;
      } };
      assert.fail('Unexpected startup side effect: ' + name);
    } };
    const initialized = vm.runInNewContext(prefix + '\nreturn true; }\ninitializeApp()', context);
    if (fails) {
      await assert.rejects(initialized, error => error === failure);
      assert.equal(context.nextInitStatus, 'failed');
    } else assert.equal(await initialized, true);
    assert.deepEqual(calls, ['./db/verifyMigrationHistory', './db', 'verified']);
  }
});

test('route schema checks are lazy, read-only and share concurrent verification', async () => {
  const calls = [];
  const verify = createSchemaVerifier({ async query(sql, params) {
    calls.push({ sql, params });
    assert.match(sql, /^SELECT column_name FROM information_schema.columns WHERE/);
    return { rows: [{ column_name: 'id' }, { column_name: 'status' }] };
  } }, { example: ['id', 'status'] });
  assert.deepEqual(calls, []);
  await Promise.all([verify(), verify(), verify()]);
  await verify();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, ['public', 'example']);
});

test('missing schema and database errors fail closed without disclosing details and can retry', async () => {
  let attempt = 0;
  const verify = createSchemaVerifier({ async query() {
    attempt += 1;
    if (attempt === 1) return { rows: [{ column_name: 'id' }] };
    if (attempt === 2) throw new Error('FICTIONAL_PRIVATE_CONNECTION_DETAIL');
    return { rows: [{ column_name: 'id' }, { column_name: 'status' }] };
  } }, { example: ['id', 'status'] });
  for (let i = 0; i < 2; i += 1) {
    await assert.rejects(verify(), error => {
      assert.equal(error.code, 'ROUTE_SCHEMA_UNAVAILABLE');
      assert.equal(error.status, 503);
      assert.equal(error.message, 'Required database schema is unavailable.');
      assert.doesNotMatch(String(error), /FICTIONAL_PRIVATE/);
      return true;
    });
  }
  await verify();
  assert.equal(attempt, 3);
});
