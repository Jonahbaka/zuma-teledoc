'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { runMigrations, checksum, MIGRATION_LOCK_KEY } = require('../db/migrate');

const migration = { name: '001_test', up: 'SELECT 1' };
function fixture({ rows = [], fail = () => false } = {}) {
  const calls = [];
  let releases = [];
  const client = {
    async query(sql, args = []) {
      calls.push({ sql, args });
      if (fail(sql, args, calls)) throw new Error('Synthetic failure');
      if (sql === 'SHOW lock_timeout') return { rows: [{ lock_timeout: '7s' }] };
      if (sql === 'SELECT name, checksum FROM migrations') return { rows };
      return { rows: [] };
    },
    release(discard) { releases.push(discard); },
  };
  const pool = { connect: async () => client, end: async () => assert.fail('caller owns supplied pool') };
  return { pool, calls, releases };
}

test('server migrations lock one session, atomically track digests and restore its original settings', async () => {
  const f = fixture();
  assert.deepEqual(await runMigrations({ pool: f.pool, migrations: [migration] }), { ran: 1, total: 1, legacyBaselined: 0 });
  const sql = f.calls.map(call => call.sql);
  const lockIndex = sql.indexOf('SELECT pg_advisory_lock(hashtext($1))');
  assert.ok(lockIndex >= 0 && lockIndex < sql.indexOf('BEGIN'));
  assert.deepEqual(f.calls[lockIndex].args, [MIGRATION_LOCK_KEY]);
  const insertIndex = sql.indexOf('INSERT INTO migrations (name, checksum) VALUES ($1, $2)');
  assert.deepEqual(f.calls[insertIndex].args, [migration.name, checksum(migration.up)]);
  assert.equal(sql[insertIndex + 1], 'COMMIT');
  assert.equal(sql.filter(value => value === 'BEGIN').length, 2);
  assert.equal(sql.filter(value => value === 'COMMIT').length, 2);
  assert.equal(f.calls.filter(call => call.sql.includes('LEAST(COALESCE(NULLIF(setting::bigint, 0)') && call.args[0] === 'statement_timeout' && call.args[1] === 900_000 && call.args[2] === true).length, 2);
  assert.ok(f.calls.some(call => call.args[0] === 'lock_timeout' && call.args[1] === 30_000 && call.args[2] === false));
  assert.deepEqual(f.calls.at(-1), { sql: "SELECT set_config('lock_timeout', $1, false)", args: ['7s'] });
  assert.deepEqual(f.releases, [false]);
});

test('matching history skips SQL and preserves existing digest', async () => {
  const f = fixture({ rows: [{ name: migration.name, checksum: checksum(migration.up) }] });
  assert.equal((await runMigrations({ pool: f.pool, migrations: [migration] })).ran, 0);
  assert.ok(!f.calls.some(call => call.sql === migration.up || call.sql.startsWith('UPDATE migrations')));
});

test('all known history is checked before any pending migration or legacy digest is written', async () => {
  const pending = { name: '000_pending', up: 'SELECT 2' };
  const legacy = { name: '002_legacy', up: 'SELECT 3' };
  const f = fixture({ rows: [{ name: migration.name, checksum: checksum('changed') }, { name: legacy.name, checksum: null }] });
  await assert.rejects(runMigrations({ pool: f.pool, migrations: [pending, legacy, migration] }), /checksum mismatch/);
  assert.ok(!f.calls.some(call => [pending.up, migration.up, legacy.up].includes(call.sql) || call.sql.startsWith('UPDATE migrations')));
  assert.ok(f.calls.some(call => call.sql.includes('pg_advisory_unlock')));
  assert.deepEqual(f.releases, [false]);
});

test('legacy digest adoption is reported and never reruns its historical SQL', async () => {
  const f = fixture({ rows: [{ name: migration.name, checksum: null }] });
  assert.deepEqual(await runMigrations({ pool: f.pool, migrations: [migration] }), { ran: 0, total: 1, legacyBaselined: 1 });
  assert.ok(!f.calls.some(call => call.sql === migration.up));
  assert.ok(f.calls.some(call => call.sql.startsWith('UPDATE migrations') && call.args[1] === checksum(migration.up)));
});

test('legacy adoption warns before its commit even when a later migration fails', async (t) => {
  const next = { name: '002_failure', up: 'SELECT 2' };
  const f = fixture({ rows: [{ name: migration.name, checksum: null }], fail: sql => sql === next.up });
  const warnings = [];
  t.mock.method(console, 'warn', message => warnings.push({ message, afterQueries: f.calls.length }));
  await assert.rejects(runMigrations({ pool: f.pool, migrations: [migration, next] }), /Synthetic failure/);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /001_test.*historical SQL is not verified/);
  const adoptionIndex = f.calls.findIndex(call => call.sql.startsWith('UPDATE migrations'));
  assert.ok(adoptionIndex >= 0 && warnings[0].afterQueries < adoptionIndex, 'warning precedes the first baseline write');
  assert.equal(f.calls[adoptionIndex + 1].sql, 'COMMIT', 'baseline remains committed despite the later failure');
  assert.equal(f.calls.filter(call => call.sql === 'COMMIT').length, 2);
  assert.ok(f.calls.some(call => call.sql === 'ROLLBACK'));
});

for (const stage of ['sql', 'tracking']) {
  test(`${stage} failure rolls back instead of completing or applying later migrations`, async () => {
    const next = { name: '002_later', up: 'SELECT 2' };
    const f = fixture({ fail: sql => stage === 'sql' ? sql === migration.up : sql.startsWith('INSERT INTO migrations') });
    await assert.rejects(runMigrations({ pool: f.pool, migrations: [migration, next] }), /Synthetic failure/);
    assert.ok(f.calls.some(call => call.sql === 'ROLLBACK'));
    assert.ok(!f.calls.some(call => call.sql === next.up));
    assert.equal(f.calls.filter(call => call.sql === 'COMMIT').length, 1, 'only tracking-table setup committed');
    assert.deepEqual(f.releases, [false]);
  });
}

for (const stage of ['rollback', 'unlock', 'restore']) {
  test(`${stage} failure discards a session whose transaction or lock state is uncertain`, async () => {
    let restores = 0;
    const f = fixture({ fail: sql => {
      if (stage === 'rollback') return sql === migration.up || sql === 'ROLLBACK';
      if (stage === 'unlock') return sql.includes('pg_advisory_unlock');
      return sql.startsWith("SELECT set_config('lock_timeout'") && ++restores === 2;
    } });
    if (stage === 'rollback') await assert.rejects(runMigrations({ pool: f.pool, migrations: [migration] }));
    else await runMigrations({ pool: f.pool, migrations: [migration] });
    assert.deepEqual(f.releases, [true]);
  });
}

test('advisory-lock timeout fails before schema changes and returns the original session setting', async () => {
  const f = fixture({ fail: sql => sql.includes('pg_advisory_lock(') });
  await assert.rejects(runMigrations({ pool: f.pool, migrations: [migration] }));
  assert.ok(!f.calls.some(call => call.sql === 'BEGIN' || call.sql.includes('CREATE TABLE')));
  assert.deepEqual(f.calls.at(-1).args, ['7s']);
});

test('invalid or duplicate manifests fail before pool access', async () => {
  const pool = { connect: async () => assert.fail('must validate before connecting') };
  for (const migrations of [[migration, migration], [{ name: '', up: 'SELECT 1' }], [{ name: 'test', up: '' }], [null]]) {
    await assert.rejects(runMigrations({ pool, migrations }), /Invalid or duplicate/);
  }
});

test('retired rollback command refuses without reading configuration or connecting to a database', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../db/rollback.js'), '15'], {
    encoding: 'utf8', env: { ...process.env, DATABASE_URL: 'invalid' }, timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Automated database rollback is disabled/);
  assert.doesNotMatch(result.stderr, /invalid|ECONN|password/);
  assert.throws(() => require('../db/rollback').refuseRollback(), /permanently delete clinical and audit records/);
});


test('deployment gate runs the static migration verifier before application checks', () => {
  const { scripts } = require('../../package.json');
  assert.match(scripts['test:deploy-gate'], /^npm run migrations:verify && npm run test:deploy-guard &&/);
});
