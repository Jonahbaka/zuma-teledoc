'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const service = require('../services/rx-engine/patientPrescriptionListService');
const { fixtureTargetSafety } = require('../scripts/fixtureTargetSafety');
const target = process.env.SIMULATION_DATABASE_URL;
const pause = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('PostgreSQL combined own prescription list locks current actor and both sources through durable audit', { skip: !target }, async t => {
  const safety = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL' });
  assert.equal(safety.skipped, false, safety.reason);
  const pool = new Pool({ connectionString: target, max: 8, statement_timeout: 15000 });
  const actualTarget = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL', pool });
  assert.equal(actualTarget.skipped, false, actualTarget.reason);
  const owned = [];
  const fixture = async () => {
    const f = Object.fromEntries(['actor','other','provider','profile','upload','digital'].map(key => [key, crypto.randomUUID()])); owned.push(f);
    for (const key of ['actor','other','provider']) await pool.query(`INSERT INTO users(id,email,password_hash,role,first_name,last_name,country,market_scope,region,is_active,is_verified,is_test_account,provider_status,account_status)
      VALUES($1,$2,'!isolated-fixture-not-a-login',$3,'Synthetic','Prescription List Test','NG','NG','NG',TRUE,TRUE,TRUE,$4,'suspended')`, [f[key],`${key}-${f[key]}@doctarx.test`,key === 'provider' ? 'provider' : 'patient',key === 'provider' ? 'approved' : null]);
    await pool.query(`INSERT INTO ng_providers(id,user_id,full_name,email,phone,status) VALUES($1,$2,'Synthetic List Provider',$3,'+2348000000010','verified')`, [f.profile,f.provider,`provider-${f.provider}@doctarx.test`]);
    await pool.query(`INSERT INTO ng_prescriptions(id,patient_user_id,status,items) VALUES($1,$2,'uploaded','[]')`,[f.upload,f.actor]);
    await pool.query(`INSERT INTO ng_digital_prescriptions(id,patient_user_id,provider_id,items,lifecycle_status,expires_at) VALUES($1,$2,$3,'[]','drafted',CURRENT_DATE+30)`,[f.digital,f.actor,f.profile]);
    return f;
  };
  const read = (f, database = pool) => service.list(database,{ id: f.actor, role: 'stale' },{});
  const audits = async f => (await pool.query("SELECT * FROM audit_logs WHERE user_id=$1 AND resource_type IN ('prescription_submission','digital_prescription')",[f.actor])).rows;
  const change = (client,f,type) => type === 'actor' ? client.query('UPDATE users SET is_active=FALSE WHERE id=$1',[f.actor])
    : type === 'provider' ? client.query("UPDATE users SET role='provider',provider_status='pending' WHERE id=$1",[f.actor])
    : type === 'password' ? client.query("UPDATE users SET role='pharmacy',must_change_password=TRUE WHERE id=$1",[f.actor])
    : client.query(`UPDATE ${type === 'upload' ? 'ng_prescriptions' : 'ng_digital_prescriptions'} SET patient_user_id=$2 WHERE id=$1`,[f[type],f.other]);
  const blocked = async pid => {
    const until = Date.now() + 5000;
    while (Date.now() < until) { if ((await pool.query('SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted',[pid])).rows.length) return; await new Promise(resolve => setTimeout(resolve,20)); }
    assert.fail('Expected actual PostgreSQL row-lock contention');
  };
  try {
    await t.test('real joins keep unassigned pharmacies and audit only metadata', async () => {
      const f = await fixture(), result = await read(f); assert.equal(result.length,2);
      const digital = result.find(row => row.id === f.digital); assert.equal(digital.pharmacy_name,null); assert.equal(digital.prescriber_name,'Synthetic List Provider');
      const history = await audits(f); assert.equal(history.length,2);
      for (const audit of history) { assert.equal(audit.patient_id,f.actor); assert.deepEqual(Object.keys(audit.new_values).sort(),['recordCount','records']); assert.equal(audit.new_values.recordCount,1); assert.deepEqual(Object.keys(audit.new_values.records[0]),['id']); }
      // Existing account-status and market do not revoke this endpoint's self access.
      await pool.query("UPDATE users SET market_scope='US',role='admin' WHERE id=$1",[f.actor]); assert.equal((await read(f)).length,2);
    });
    await t.test('revoker first rechecks both source ownership predicates and current actor eligibility', async () => {
      for (const type of ['actor','provider','password','upload','digital']) {
        const f = await fixture(), updater = await pool.connect(), reader = await pool.connect(); let pending;
        try {
          await updater.query('BEGIN'); await change(updater,f,type);
          const pid = (await reader.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          pending = read(f,{ connect: async () => ({ query: (...args) => reader.query(...args), release() {} }) }).then(value => ({ value }),error => ({ error }));
          await blocked(pid); await updater.query('COMMIT'); const result = await pending;
          if (['upload','digital'].includes(type)) { assert.ifError(result.error); assert.deepEqual(result.value.map(row => row.id),[f[type === 'upload' ? 'digital' : 'upload']]); const history = await audits(f); assert.equal(history.length,2); assert.equal(history.find(a => a.resource_type === (type === 'upload' ? 'prescription_submission' : 'digital_prescription')).new_values.recordCount,0); }
          else { assert.equal(result.error?.status,403); assert.equal((await audits(f)).length,0); }
        } finally { await updater.query('ROLLBACK'); if (pending) await pending; reader.release(); updater.release(); }
      }
    });
    await t.test('reader first keeps both source and actor locks after both audits until COMMIT', async () => {
      for (const type of ['actor','provider','password','upload','digital']) {
        const f = await fixture(), reached = pause(), proceed = pause(), updater = await pool.connect(); let revocation, count = 0, returned = false;
        const adapter = { async connect() { const client = await pool.connect(); return { release: error => client.release(error), async query(sql,params) {
          if (sql === 'COMMIT') { assert.equal(count,2); reached.resolve(); await proceed.promise; }
          const result = await client.query(sql,params); if (sql.includes('INSERT INTO audit_logs')) count++; return result;
        } }; } };
        const pending = read(f,adapter).then(value => { returned = true; return { value }; },error => ({ error }));
        try {
          await Promise.race([reached.promise,pending.then(result => { throw result.error || new Error('Read missed post-audit boundary'); })]); assert.equal(returned,false); assert.equal((await audits(f)).length,0);
          const pid = (await updater.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          revocation = change(updater,f,type).then(value => ({ value }),error => ({ error })); await blocked(pid); assert.equal(returned,false);
          proceed.resolve(); const result = await pending; assert.ifError(result.error); assert.equal(result.value.length,2); assert.ifError((await revocation).error); assert.equal((await audits(f)).length,2);
          if (['upload','digital'].includes(type)) assert.equal((await read(f)).length,1); else await assert.rejects(read(f),{ status: 403 });
        } finally { proceed.resolve(); await Promise.allSettled([pending,revocation].filter(Boolean)); updater.release(); }
      }
    });
    await t.test('second read, either audit and commit SQL failures roll back all audits without returning partial data', async () => {
      for (const failure of ['digital','audit1','audit2','commit']) {
        const f = await fixture(); let count = 0;
        const adapter = { async connect() { const client = await pool.connect(); return { release: error => client.release(error), query(sql,params) {
          if (sql.includes('INSERT INTO audit_logs')) count++;
          const fail = failure === 'digital' && sql.includes('FROM ng_digital_prescriptions') || failure === 'audit1' && count === 1 && sql.includes('INSERT INTO audit_logs') || failure === 'audit2' && count === 2 && sql.includes('INSERT INTO audit_logs') || failure === 'commit' && sql === 'COMMIT';
          return fail ? client.query('SELECT 1/0') : client.query(sql,params);
        } }; } };
        await assert.rejects(read(f,adapter),{ code: '22012' }); assert.equal((await audits(f)).length,0); assert.equal((await read(f)).length,2);
      }
    });
  } finally {
    try {
      // Cleanup is restricted to random synthetic identities created by this suite.
      for (const f of owned) {
        await pool.query("DELETE FROM audit_logs WHERE user_id=$1 AND resource_type IN ('prescription_submission','digital_prescription')",[f.actor]);
        await pool.query('DELETE FROM ng_digital_prescriptions WHERE id=$1',[f.digital]);
        await pool.query('DELETE FROM ng_prescriptions WHERE id=$1',[f.upload]);
        await pool.query('DELETE FROM ng_providers WHERE id=$1',[f.profile]);
        await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[]) AND is_test_account=TRUE',[[f.actor,f.other,f.provider]]);
      }
    } finally { await pool.end(); }
  }
});
