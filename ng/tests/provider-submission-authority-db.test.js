'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { encrypt } = require('../../lib/encryption');
const service = require('../services/rx-engine/privatePrescriptionUploadService');
const { fixtureTargetSafety } = require('../scripts/fixtureTargetSafety');
const target = process.env.SIMULATION_DATABASE_URL;
const pause = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('PostgreSQL provider submission reads hold current account/profile authority through durable audit', { skip: !target }, async t => {
  const safety = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL' });
  assert.equal(safety.skipped, false, safety.reason);
  const pool = new Pool({ connectionString: target, max: 8, statement_timeout: 15000 });
  const actualTarget = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL', pool });
  assert.equal(actualTarget.skipped, false, actualTarget.reason);
  const previous = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const owned = [];
  const fixture = async (witness = 'appointment') => {
    const ids = Object.fromEntries(['patient','otherPatient','actor','other','profile','submission','witness','fallback'].map(key => [key, crypto.randomUUID()]));
    owned.push(ids);
    for (const key of ['patient','otherPatient','actor','other']) await pool.query(`INSERT INTO users(id,email,password_hash,role,first_name,last_name,country,market_scope,region,is_active,is_verified,is_test_account,provider_status,account_status)
      VALUES($1,$2,'!isolated-fixture-not-a-login',$3,'Synthetic','Submission Test','NG','NG','NG',TRUE,TRUE,TRUE,$4,'active')`,
    [ids[key], `${key}-${ids[key]}@doctarx.test`, ['patient','otherPatient'].includes(key) ? 'patient' : 'provider', ['patient','otherPatient'].includes(key) ? null : 'approved']);
    await pool.query(`INSERT INTO ng_providers(id,user_id,full_name,email,phone,status) VALUES($1,$2,'Synthetic Submission Clinician',$3,'+2348000000010','verified')`, [ids.profile, ids.actor, `provider-${ids.actor}@doctarx.test`]);
    if (witness === 'appointment') await pool.query(`INSERT INTO ng_appointments(id,patient_user_id,provider_id,scheduled_at,status,consult_fee,total_amount) VALUES($1,$2,$3,'2099-06-15T12:00:00Z','canceled',0,0)`, [ids.witness, ids.patient, ids.profile]);
    else if (witness === 'encounter') await pool.query(`INSERT INTO ng_clinical_encounters(id,patient_user_id,provider_user_id,status) VALUES($1,$2,$3,'cancelled')`, [ids.witness, ids.patient, ids.actor]);
    else if (witness === 'relationship') await pool.query(`INSERT INTO provider_patient_relationships(id,patient_id,provider_id,is_active) VALUES($1,$2,$3,TRUE)`, [ids.witness, ids.patient, ids.actor]);
    else if (witness === 'shared') await pool.query(`INSERT INTO appointments(id,patient_id,provider_id,scheduled_at,status) VALUES($1,$2,$3,'2099-06-15T12:00:00Z','completed')`, [ids.witness, ids.patient, ids.actor]);
    else assert.fail(`Unknown witness: ${witness}`);
    await pool.query(`INSERT INTO ng_prescriptions(id,patient_user_id,status,submitted_text_encrypted) VALUES($1,$2,'uploaded',$3)`, [ids.submission, ids.patient, JSON.stringify(encrypt('Synthetic private submission instructions'))]);
    return { ...ids, req: { user: { id: ids.actor, role: 'provider' }, headers: {} } };
  };
  const read = (f, mode, database = pool) => mode === 'list' ? service.listProviderSubmissions(database, f.req, f.patient) : service.readProviderSubmission(database, f.req, f.patient, f.submission);
  const audits = async f => (await pool.query("SELECT * FROM audit_logs WHERE user_id=$1 AND resource_type='prescription_submission'", [f.actor])).rows;
  const change = (client, f, type) => type === 'profile' ? client.query("UPDATE ng_providers SET status='pending' WHERE id=$1", [f.profile])
    : type === 'owner' ? client.query('UPDATE ng_providers SET user_id=$2 WHERE id=$1', [f.profile,f.other])
    : type === 'inactive' ? client.query('UPDATE users SET is_active=FALSE WHERE id=$1', [f.actor])
    : type === 'approval' ? client.query("UPDATE users SET provider_status='pending' WHERE id=$1", [f.actor])
    : client.query("UPDATE users SET account_status='suspended' WHERE id=$1", [f.actor]);
  const blocked = async pid => {
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      if ((await pool.query('SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted', [pid])).rows.length) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail('Expected actual PostgreSQL row-lock contention');
  };
  try {
    await t.test('current authorized reads preserve encrypted storage, minimal list and audited content', async () => {
      const f = await fixture();
      const list = await read(f, 'list'); assert.equal(list.length, 1); assert.equal(list[0].id, f.submission); assert.equal(list[0].has_text, true);
      assert.equal(list[0].submitted_text_encrypted, undefined); assert.equal(list[0].text, undefined);
      assert.equal((await read(f, 'detail')).text, 'Synthetic private submission instructions');
      assert.equal((await audits(f)).length, 2);
    });
    await t.test('account or profile revocation committed first is rechecked before any prescription retrieval', async () => {
      for (const mode of ['list','detail']) for (const type of ['account','inactive','approval','profile','owner']) {
        const f = await fixture(); const updater = await pool.connect(), reader = await pool.connect(); let pending;
        const calls = [];
        try {
          await updater.query('BEGIN'); await change(updater, f, type);
          const pid = (await reader.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          const held = { connect: async () => ({ query(sql, values) { calls.push(sql); return reader.query(sql, values); }, release() {} }) };
          pending = read(f, mode, held).then(value => ({ value }), error => ({ error }));
          await blocked(pid); await updater.query('COMMIT');
          assert.equal((await pending).error?.status, 403, `${mode}/${type}`);
          assert.equal(calls.some(sql => sql.includes('FROM ng_prescriptions')), false);
          assert.equal((await audits(f)).length, 0);
        } finally { await updater.query('ROLLBACK'); if (pending) await pending; reader.release(); updater.release(); }
      }
    });
    await t.test('account suspension and profile reassignment wait until successful read audit commits', async () => {
      for (const mode of ['list','detail']) for (const type of ['account','owner']) {
        const f = await fixture(), reached = pause(), proceed = pause(); const updater = await pool.connect(); let revocation;
        const held = { async connect() { const client = await pool.connect(); return { release: () => client.release(), async query(sql, values) { const result = await client.query(sql, values); if (sql.includes('INSERT INTO audit_logs')) { reached.resolve(); await proceed.promise; } return result; } }; } };
        let readSettled = false;
        const pending = read(f, mode, held).then(value => { readSettled = true; return { value }; }, error => { readSettled = true; return { error }; });
        try {
          await Promise.race([reached.promise, pending.then(result => { throw result.error || new Error('Read missed audit boundary'); })]);
          assert.equal((await audits(f)).length, 0, 'Completed audit INSERT is still uncommitted');
          const pid = (await updater.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          revocation = change(updater, f, type).then(value => ({ value }), error => ({ error }));
          await blocked(pid); assert.equal(readSettled, false, 'Read must not resolve before audit COMMIT'); proceed.resolve(); assert.ifError((await pending).error); assert.ifError((await revocation).error);
          assert.equal((await audits(f)).length, 1);
          await assert.rejects(read(f, mode), error => error.status === 403);
        } finally { proceed.resolve(); await Promise.allSettled([pending,revocation].filter(Boolean)); updater.release(); }
      }
    });
    // Each case has exactly one sufficient witness, so losing it must fail closed.
    const witnessChanges = [
      ['appointment', 'delete', 'DELETE FROM ng_appointments WHERE id=$1'],
      ['appointment', 'reassign', 'UPDATE ng_appointments SET patient_user_id=$2 WHERE id=$1'],
      ['encounter', 'delete', 'DELETE FROM ng_clinical_encounters WHERE id=$1'],
      ['encounter', 'reassign', 'UPDATE ng_clinical_encounters SET patient_user_id=$2 WHERE id=$1'],
      ['relationship', 'revoke', 'UPDATE provider_patient_relationships SET is_active=FALSE WHERE id=$1'],
      ['relationship', 'reassign', 'UPDATE provider_patient_relationships SET patient_id=$2 WHERE id=$1'],
      ['shared', 'revoke', "UPDATE appointments SET status='cancelled' WHERE id=$1"],
      ['shared', 'reassign', 'UPDATE appointments SET patient_id=$2 WHERE id=$1'],
      ['appointment', 'submission-owner', 'UPDATE ng_prescriptions SET patient_user_id=$2 WHERE id=$1'],
    ];
    for (const mode of ['list','detail']) for (const [witness, operation, sql] of witnessChanges) {
      const submissionChange = operation === 'submission-owner';
      const mutate = (client, f) => client.query(sql, sql.includes('$2')
        ? [submissionChange ? f.submission : f.witness, f.otherPatient] : [f.witness]);
      const assertRevoked = async result => {
        if (submissionChange && mode === 'list') {
          assert.ifError(result.error); assert.deepEqual(result.value, []);
        } else assert.equal(result.error?.status || result.error?.statusCode, submissionChange ? 404 : 403);
      };
      await t.test(`${mode}/${witness}/${operation}: mutation commits first and locked read rechecks`, async () => {
        const f = await fixture(witness), updater = await pool.connect(), reader = await pool.connect();
        let pending; const calls = [];
        try {
          await updater.query('BEGIN'); await mutate(updater, f);
          const pid = (await reader.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          const held = { connect: async () => ({ query(sql, values) { calls.push(sql); return reader.query(sql, values); }, release() {} }) };
          pending = read(f, mode, held).then(value => ({ value }), error => ({ error }));
          await blocked(pid); await updater.query('COMMIT');
          await assertRevoked(await pending);
          if (!submissionChange) assert.equal(calls.some(sql => sql.includes('FROM ng_prescriptions')), false);
          assert.equal((await audits(f)).length, submissionChange && mode === 'list' ? 1 : 0);
        } finally { await updater.query('ROLLBACK'); if (pending) await pending; reader.release(); updater.release(); }
      });
      await t.test(`${mode}/${witness}/${operation}: mutation waits through completed audit until COMMIT`, async () => {
        const f = await fixture(witness), reached = pause(), proceed = pause(), updater = await pool.connect();
        let mutation;
        const held = { async connect() { const client = await pool.connect(); return {
          release: error => client.release(error), async query(sql, values) {
            const result = await client.query(sql, values);
            if (sql.includes('INSERT INTO audit_logs')) { reached.resolve(); await proceed.promise; }
            return result;
          },
        }; } };
        let readSettled = false;
        const pending = read(f, mode, held).then(value => { readSettled = true; return { value }; }, error => { readSettled = true; return { error }; });
        try {
          await Promise.race([reached.promise, pending.then(result => { throw result.error || new Error('Read missed completed audit boundary'); })]);
          assert.equal((await audits(f)).length, 0, 'Audit SQL completed but must not be visible before COMMIT');
          const pid = (await updater.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          mutation = mutate(updater, f).then(value => ({ value }), error => ({ error }));
          await blocked(pid); assert.equal(readSettled, false, 'Read must not resolve before audit COMMIT'); proceed.resolve();
          const result = await pending; assert.ifError(result.error);
          if (mode === 'list') assert.equal(result.value[0].id, f.submission);
          else assert.equal(result.value.text, 'Synthetic private submission instructions');
          assert.ifError((await mutation).error); assert.equal((await audits(f)).length, 1);
          await assertRevoked(await read(f, mode).then(value => ({ value }), error => ({ error })));
        } finally { proceed.resolve(); await Promise.allSettled([pending,mutation].filter(Boolean)); updater.release(); }
      });
    }
    await t.test('revoked first witness still permits an independent OR witness', async () => {
      for (const mode of ['list','detail']) for (const fallback of ['encounter','relationship','shared']) {
        const f = await fixture('appointment'), updater = await pool.connect(), reader = await pool.connect(); let pending;
        try {
          if (fallback === 'encounter') await pool.query("INSERT INTO ng_clinical_encounters(id,patient_user_id,provider_user_id,status) VALUES($1,$2,$3,'draft')", [f.fallback,f.patient,f.actor]);
          else if (fallback === 'relationship') await pool.query('INSERT INTO provider_patient_relationships(id,patient_id,provider_id,is_active) VALUES($1,$2,$3,TRUE)', [f.fallback,f.patient,f.actor]);
          else await pool.query("INSERT INTO appointments(id,patient_id,provider_id,scheduled_at,status) VALUES($1,$2,$3,'2099-06-15T12:00:00Z','completed')", [f.fallback,f.patient,f.actor]);
          await updater.query('BEGIN'); await updater.query('DELETE FROM ng_appointments WHERE id=$1', [f.witness]);
          const pid = (await reader.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          const held = { connect: async () => ({ query: (sql, values) => reader.query(sql, values), release() {} }) };
          pending = read(f, mode, held).then(value => ({ value }), error => ({ error }));
          await blocked(pid); await updater.query('COMMIT');
          const result = await pending; assert.ifError(result.error);
          assert.equal(mode === 'list' ? result.value[0].id : result.value.id, f.submission);
          assert.equal((await audits(f)).length, 1);
        } finally { await updater.query('ROLLBACK'); if (pending) await pending; reader.release(); updater.release(); }
      }
    });
    await t.test('actual SQL audit failure rolls back without reporting a completed read or exposing content', async () => {
      for (const mode of ['list','detail']) {
        const f = await fixture();
        const bad = { async connect() { const client = await pool.connect(); return { release: () => client.release(), query(sql, values) { return sql.includes('INSERT INTO audit_logs') ? client.query('SELECT 1/0') : client.query(sql, values); } }; } };
        await assert.rejects(read(f, mode, bad), error => error.code === '22012');
        assert.equal((await audits(f)).length, 0);
        assert.equal((await read(f, 'detail')).text, 'Synthetic private submission instructions');
        assert.equal((await audits(f)).length, 1);
      }
    });
  } finally {
    try {
      // Only run-owned IDs, including partially inserted fixtures; never broad fixture cleanup.
      for (const f of owned) {
        await pool.query("DELETE FROM audit_logs WHERE user_id=$1 AND resource_type='prescription_submission' AND resource_id=ANY($2::uuid[])", [f.actor,[f.patient,f.submission]]);
        await pool.query('DELETE FROM ng_prescriptions WHERE id=$1', [f.submission]);
        for (const table of ['ng_appointments','ng_clinical_encounters','provider_patient_relationships','appointments']) {
          await pool.query(`DELETE FROM ${table} WHERE id=ANY($1::uuid[])`, [[f.witness,f.fallback]]);
        }
        await pool.query('DELETE FROM ng_providers WHERE id=$1', [f.profile]);
        await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[]) AND is_test_account=TRUE', [[f.patient,f.otherPatient,f.actor,f.other]]);
      }
    } finally { await pool.end(); if (previous === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = previous; }
  }
});
