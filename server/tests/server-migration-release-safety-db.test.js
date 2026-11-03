'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixtureTargetSafety } = require('../../ng/scripts/fixtureTargetSafety');
const { runMigrations, MIGRATION_LOCK_KEY, checksum } = require('../db/migrate');
const target = process.env.SIMULATION_DATABASE_URL;

// Explicit, disposable loopback _test database only. No production fallback.
// All test objects are session-local TEMP tables, removed when the pool closes.
test('real PostgreSQL legacy adoption, transactions, drift refusal and bounded locks preserve records', { skip: !target }, async () => {
  const safety = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL' });
  assert.equal(safety.skipped, false, safety.reason);
  const { Pool, Client } = require('pg');
  const pool = new Pool({ connectionString: target, max: 1 });
  const blocker = new Client({ connectionString: target });
  try {
    await pool.query('CREATE TEMP TABLE migrations (id SERIAL PRIMARY KEY, name VARCHAR(255) UNIQUE NOT NULL)');
    await pool.query('SET search_path TO pg_temp');
    await pool.query("SET lock_timeout TO '5s'; SET statement_timeout TO '5s'");
    const legacy = { name: '000_legacy', up: 'SELECT * FROM legacy_sql_must_not_be_replayed' };
    await pool.query('INSERT INTO migrations (name) VALUES ($1)', [legacy.name]);
    const first = { name: '001_probe', up: "CREATE TEMP TABLE migration_probe (id INTEGER PRIMARY KEY, value TEXT, lock_timeout TEXT DEFAULT current_setting('lock_timeout'), statement_timeout TEXT DEFAULT current_setting('statement_timeout')); INSERT INTO migration_probe (id, value) VALUES (1, 'fictional')" };
    assert.deepEqual(await runMigrations({ pool, migrations: [legacy, first] }), { ran: 1, total: 2, legacyBaselined: 1 });
    assert.equal((await runMigrations({ pool, migrations: [legacy, first] })).ran, 0);
    assert.deepEqual((await pool.query('SELECT name, checksum FROM migrations ORDER BY name')).rows, [
      { name: legacy.name, checksum: checksum(legacy.up) },
      { name: first.name, checksum: checksum(first.up) },
    ]);

    const broken = { name: '002_failure', up: "INSERT INTO migration_probe (id, value) VALUES (2, 'must roll back'); SELECT * FROM missing_release_safety_table" };
    await assert.rejects(runMigrations({ pool, migrations: [legacy, first, broken] }), /does not exist/);
    assert.deepEqual((await pool.query('SELECT * FROM migration_probe ORDER BY id')).rows, [{ id: 1, value: 'fictional', lock_timeout: '5s', statement_timeout: '5s' }]);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM migrations')).rows[0].count, 2);

    const pending = { name: '000_pending', up: "INSERT INTO migration_probe (id, value) VALUES (3, 'must not run')" };
    await assert.rejects(runMigrations({ pool, migrations: [pending, legacy, { ...first, up: first.up + '; SELECT 1' }] }), /checksum mismatch/);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM migration_probe')).rows[0].count, 1);

    // Hold the actual advisory lock from a second PostgreSQL session and prove
    // the runner waits; release it and verify the original session resumes.
    await blocker.connect();
    await blocker.query('SELECT pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK_KEY]);
    const { rows: [{ pid }] } = await pool.query('SELECT pg_backend_pid() AS pid');
    const waiting = runMigrations({ pool, migrations: [legacy, first] });
    try {
      let observedWaiting = false;
      for (let attempt = 0; attempt < 50 && !observedWaiting; attempt += 1) {
        const locks = await blocker.query("SELECT granted FROM pg_locks WHERE pid=$1 AND locktype='advisory'", [pid]);
        observedWaiting = locks.rows.some(lock => lock.granted === false);
        if (!observedWaiting) await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(observedWaiting, true, 'runner must wait on the held PostgreSQL advisory lock');
    } finally {
      await blocker.query('SELECT pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK_KEY]);
      await waiting;
    }
    assert.equal((await pool.query('SHOW lock_timeout')).rows[0].lock_timeout, '5s');
    assert.equal((await pool.query('SHOW statement_timeout')).rows[0].statement_timeout, '5s');

    // A stricter session limit must expire the real lock wait, preserve the
    // manifest, and leave the connection usable for a later retry.
    await pool.query("SET lock_timeout TO '100ms'");
    await blocker.query('SELECT pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK_KEY]);
    try {
      await assert.rejects(runMigrations({ pool, migrations: [legacy, first] }), error => error.code === '55P03');
    } finally {
      await blocker.query('SELECT pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK_KEY]);
    }
    assert.equal((await pool.query('SHOW lock_timeout')).rows[0].lock_timeout, '100ms');
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM migrations')).rows[0].count, 2);
    assert.equal((await runMigrations({ pool, migrations: [legacy, first] })).ran, 0);
  } finally {
    await blocker.end();
    await pool.end();
  }
});
