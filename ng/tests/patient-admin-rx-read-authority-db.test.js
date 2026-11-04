'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const service = require('../services/rx-engine/patientAdminRxReadService');
const { fixtureTargetSafety } = require('../scripts/fixtureTargetSafety');
const target = process.env.SIMULATION_DATABASE_URL;
const pause = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

// This suite may write only to an explicitly selected disposable loopback _test
// database. It never falls back to DATABASE_URL or initializes the global pool.
test('PostgreSQL patient/admin Rx reads retain current authority and audit locks', { skip: !target }, async t => {
  const safety = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL' });
  assert.equal(safety.skipped, false, safety.reason);
  const pool = new Pool({ connectionString: target, max: 8, statement_timeout: 15000 });
  const actualTarget = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL', pool });
  assert.equal(actualTarget.skipped, false, actualTarget.reason);
  const fixtures = [];
  async function fixture(role) {
    const f = Object.fromEntries(['user', 'patient', 'other', 'provider', 'profile', 'rx', 'item', 'event'].map(key => [key, crypto.randomUUID()]));
    if (role === 'patient') f.patient = f.user;
    fixtures.push(f);
    for (const id of new Set([f.user, f.patient, f.other, f.provider])) {
      const currentRole = id === f.user ? role : id === f.provider ? 'provider' : 'patient';
      await pool.query(`INSERT INTO users(id,email,password_hash,role,first_name,last_name,country,market_scope,region,is_active,is_verified,is_test_account,provider_status,account_status)
        VALUES($1,$2,'!isolated-fixture-not-a-login',$3,'Synthetic','Read Test','NG','NG','NG',TRUE,TRUE,TRUE,$4,'active')`,
      [id, `rx-read-${id}@doctarx.test`, currentRole, currentRole === 'provider' ? 'approved' : null]);
    }
    await pool.query(`INSERT INTO ng_providers(id,user_id,full_name,email,phone,status)
      VALUES($1,$2,'Synthetic Read Prescriber',$3,'+2348000000010','verified')`, [f.profile, f.provider, `provider-${f.provider}@doctarx.test`]);
    await pool.query(`INSERT INTO ng_digital_prescriptions(id,patient_user_id,provider_id,items,lifecycle_status,expires_at)
      VALUES($1,$2,$3,'[]','drafted',CURRENT_DATE+30)`, [f.rx, f.patient, f.profile]);
    await pool.query(`INSERT INTO ng_rx_items(id,prescription_id,drug_name,dosage,frequency,quantity)
      VALUES($1,$2,'Synthetic read medication','Synthetic directions','Synthetic schedule',2)`, [f.item, f.rx]);
    await pool.query(`INSERT INTO ng_rx_events(id,prescription_id,actor_user_id,actor_kind,event_kind,notes)
      VALUES($1,$2,$3,'system','drafted','Synthetic fixture event')`, [f.event, f.rx, f.provider]);
    return { ...f, actor: { id: f.user, role } };
  }
  const invoke = (f, operation, database = pool) => operation === 'list'
    ? service.list(database, f.actor, { patient_user_id: f.patient })
    : service.read(database, f.actor, f.rx, operation === 'events');
  const history = async f => ({
    audits: (await pool.query("SELECT * FROM audit_logs WHERE user_id=$1 AND resource_type='digital_prescription' ORDER BY id", [f.user])).rows,
    events: (await pool.query('SELECT * FROM ng_rx_events WHERE prescription_id=$1 ORDER BY id', [f.rx])).rows,
  });
  const change = (client, f, type) => type === 'owner'
    ? client.query('UPDATE ng_digital_prescriptions SET patient_user_id=$2 WHERE id=$1', [f.rx, f.other])
    : type === 'role'
      ? client.query("UPDATE users SET role=$2 WHERE id=$1", [f.user, f.actor.role === 'admin' ? 'patient' : 'admin'])
      : client.query('UPDATE users SET is_active=FALSE WHERE id=$1', [f.user]);
  async function blocked(pid) {
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      if ((await pool.query('SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted', [pid])).rows.length) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail('Expected actual PostgreSQL row-lock contention');
  }
  try {
    await t.test('six successful operations commit read audit and never append clinical events', async () => {
      for (const role of ['patient', 'admin']) for (const operation of ['list', 'read', 'events']) {
        const f = await fixture(role), before = await history(f);
        const result = await invoke(f, operation);
        assert.equal(operation === 'read' ? result.id : result[0].id, operation === 'events' ? f.event : f.rx);
        const after = await history(f);
        assert.deepEqual(after.events, before.events);
        assert.equal(after.audits.length, 1);
        assert.equal(after.audits[0].action, 'read');
        assert.equal(after.audits[0].phi_accessed, true);
        assert.equal(after.audits[0].success, true);
        assert.equal(after.audits[0].resource_id, operation === 'list' ? null : f.rx);
        assert.equal(after.audits[0].patient_id, operation === 'list' ? null : f.patient);
        assert.deepEqual(after.audits[0].new_values, operation === 'list'
          ? { recordCount: 1, records: [{ id: f.rx, patientId: f.patient }] } : null);
      }
    });
    await t.test('revoker-first active-account and role changes deny all six operations before PHI', async () => {
      for (const role of ['patient', 'admin']) for (const operation of ['list', 'read', 'events']) for (const type of ['active', 'role']) {
        const f = await fixture(role), updater = await pool.connect(), worker = await pool.connect(), calls = [];
        let pending;
        try {
          await updater.query('BEGIN');
          await change(updater, f, type);
          const pid = (await worker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          pending = invoke(f, operation, { connect: async () => ({ release() {}, query(sql, params) { calls.push(sql); return worker.query(sql, params); } }) })
            .then(value => ({ value }), error => ({ error }));
          await blocked(pid);
          await updater.query('COMMIT');
          assert.equal((await pending).error?.code, 'FORBIDDEN', `${role}/${operation}/${type}`);
          assert.equal(calls.some(sql => /FROM ng_digital_prescriptions|FROM ng_rx_items|FROM ng_rx_events|INSERT INTO/.test(sql)), false);
          assert.equal((await history(f)).audits.length, 0);
        } finally {
          await updater.query('ROLLBACK');
          if (pending) await pending;
          worker.release(); updater.release();
        }
      }
    });
    await t.test('revoker-first patient ownership changes deny content/events and recheck list filtering', async () => {
      for (const role of ['patient', 'admin']) for (const operation of role === 'patient' ? ['list', 'read', 'events'] : ['list']) {
        const f = await fixture(role), updater = await pool.connect(), worker = await pool.connect(), calls = [];
        let pending;
        try {
          await updater.query('BEGIN'); await change(updater, f, 'owner');
          const pid = (await worker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          pending = invoke(f, operation, { connect: async () => ({ release() {}, query(sql, params) { calls.push(sql); return worker.query(sql, params); } }) })
            .then(value => ({ value }), error => ({ error }));
          await blocked(pid); await updater.query('COMMIT');
          const outcome = await pending;
          if (operation === 'list') { assert.ifError(outcome.error); assert.deepEqual(outcome.value, []); }
          else {
            assert.equal(outcome.error?.code, 'FORBIDDEN');
            assert.equal(calls.some(sql => /SELECT \* FROM ng_digital_prescriptions|FROM ng_rx_items|FROM ng_rx_events/.test(sql)), false);
          }
          const audits = (await history(f)).audits;
          assert.equal(audits.length, operation === 'list' ? 1 : 0);
          if (operation === 'list') assert.deepEqual(audits[0].new_values, { recordCount: 0, records: [] });
        } finally {
          await updater.query('ROLLBACK'); if (pending) await pending;
          worker.release(); updater.release();
        }
      }
    });
    await t.test('account, role and Rx ownership locks survive list/detail/events audit until commit', async () => {
      for (const role of ['patient', 'admin']) for (const operation of ['list', 'read', 'events']) for (const type of ['active', 'role', 'owner']) {
        const f = await fixture(role), reached = pause(), proceed = pause(), updater = await pool.connect();
        let revocation;
        const adapter = { async connect() {
          const client = await pool.connect();
          let audited = false;
          return { release: () => client.release(), async query(sql, params) {
            if (sql === 'COMMIT') { assert.equal(audited, true); reached.resolve(); await proceed.promise; }
            const result = await client.query(sql, params);
            if (sql.includes('INSERT INTO audit_logs')) audited = true;
            return result;
          } };
        } };
        const pending = invoke(f, operation, adapter).then(value => ({ value }), error => ({ error }));
        try {
          await Promise.race([reached.promise, pending.then(result => { throw result.error || new Error('Missing read audit'); })]);
          const pid = (await updater.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          revocation = change(updater, f, type).then(value => ({ value }), error => ({ error }));
          await blocked(pid);
          assert.equal((await history(f)).audits.length, 0, 'Read audit is not externally committed before release');
          proceed.resolve();
          const result = await pending;
          assert.ifError(result.error); assert.ifError((await revocation).error);
          assert.equal(operation === 'read' ? result.value.id : result.value[0].id, operation === 'events' ? f.event : f.rx);
          assert.equal((await history(f)).audits.length, 1);
          if (type !== 'owner' || role === 'patient') await assert.rejects(service.read(pool, f.actor, f.rx), { code: 'FORBIDDEN' });
          else assert.equal((await service.read(pool, f.actor, f.rx)).patient_user_id, f.other);
        } finally {
          proceed.resolve(); await Promise.allSettled([pending, revocation].filter(Boolean)); updater.release();
        }
      }
    });
    await t.test('actual SQL audit failure rolls back every read and releases account/Rx locks', async () => {
      for (const role of ['patient', 'admin']) for (const operation of ['list', 'read', 'events']) {
        const f = await fixture(role), before = await history(f), calls = [];
        const adapter = { async connect() {
          const client = await pool.connect();
          return { release: () => client.release(), query(sql, params) {
            calls.push(sql);
            return sql.includes('INSERT INTO audit_logs') ? client.query('SELECT 1/0') : client.query(sql, params);
          } };
        } };
        await assert.rejects(invoke(f, operation, adapter), { code: '22012' });
        assert.equal(calls.at(-1), 'ROLLBACK'); assert.equal(calls.includes('COMMIT'), false);
        assert.deepEqual(await history(f), before);
        await change(pool, f, 'active'); await change(pool, f, 'owner');
      }
    });
  } finally {
    // All identifiers belong to this run's synthetic fixtures; never truncate
    // tables or remove an existing account in the selected disposable database.
    try {
      for (const f of fixtures) {
        await pool.query('DELETE FROM audit_logs WHERE user_id=$1', [f.user]);
        await pool.query('DELETE FROM ng_digital_prescriptions WHERE id=$1', [f.rx]);
        await pool.query('DELETE FROM ng_providers WHERE id=$1', [f.profile]);
        await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[...new Set([f.user, f.patient, f.other, f.provider])]]);
      }
    } finally { await pool.end(); }
  }
});
