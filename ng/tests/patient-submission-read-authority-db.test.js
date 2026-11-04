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

test('PostgreSQL patient submission reads hold current eligibility and ownership through durable audit', { skip: !target }, async t => {
  const safety = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL' });
  assert.equal(safety.skipped, false, safety.reason);
  const pool = new Pool({ connectionString: target, max: 8, statement_timeout: 15000 });
  const actualTarget = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL', pool });
  assert.equal(actualTarget.skipped, false, actualTarget.reason);
  const previous = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const owned = [];
  const fixture = async () => {
    const ids = Object.fromEntries(['patient','other','submission','key'].map(key => [key, crypto.randomUUID()]));
    owned.push(ids);
    for (const key of ['patient','other']) await pool.query(`INSERT INTO users(id,email,password_hash,role,first_name,last_name,country,market_scope,region,is_active,is_verified,is_test_account,account_status)
      VALUES($1,$2,'!isolated-fixture-not-a-login','patient','Synthetic','Patient Read Test','NG','NG','NG',TRUE,TRUE,TRUE,'suspended')`,
    [ids[key], `${key}-${ids[key]}@doctarx.test`]);
    await pool.query(`INSERT INTO ng_prescriptions(id,patient_user_id,status,image_data_encrypted,image_mime,submission_key) VALUES($1,$2,'uploaded',$3,'image/png',$4)`, [ids.submission, ids.patient, JSON.stringify(encrypt(Buffer.from('Synthetic private image').toString('base64'))), ids.key]);
    return { ...ids, req: { user: { id: ids.patient, role: 'patient' }, headers: {} } };
  };
  const read = (f, mode, database = pool) => mode === 'image' ? service.readOwnedImage(database, f.req, f.submission) : service.readSubmissionReceipt(database, f.req, f.key);
  const audits = async f => (await pool.query("SELECT * FROM audit_logs WHERE user_id=$1 AND resource_type='prescription_submission'", [f.patient])).rows;
  const change = (client, f, type) => type === 'owner' ? client.query('UPDATE ng_prescriptions SET patient_user_id=$2 WHERE id=$1', [f.submission,f.other])
    : type === 'inactive' ? client.query('UPDATE users SET is_active=FALSE WHERE id=$1', [f.patient])
    : type === 'role' ? client.query("UPDATE users SET role='provider' WHERE id=$1", [f.patient])
    : client.query("UPDATE users SET market_scope='US' WHERE id=$1", [f.patient]);
  const blocked = async pid => {
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      if ((await pool.query('SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted', [pid])).rows.length) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail('Expected actual PostgreSQL row-lock contention');
  };
  try {
    await t.test('current authorized reads preserve bytes and minimal receipt without account-status expansion', async () => {
      const f = await fixture();
      assert.equal((await read(f, 'image')).toString(), 'Synthetic private image');
      assert.deepEqual(await read(f, 'receipt'), { prescriptionId: f.submission, status: 'uploaded', requiresVerification: true });
      assert.equal((await audits(f)).length, 2);
    });
    await t.test('eligibility or ownership revocation committed first is rechecked before returning content', async () => {
      for (const mode of ['image','receipt']) for (const type of ['inactive','role','market','owner']) {
        const f = await fixture(); const updater = await pool.connect(), reader = await pool.connect(); let pending;
        const calls = [];
        try {
          await updater.query('BEGIN'); await change(updater, f, type);
          const pid = (await reader.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          const held = { connect: async () => ({ query(sql, values) { calls.push(sql); return reader.query(sql, values); }, release() {} }) };
          pending = read(f, mode, held).then(value => ({ value }), error => ({ error }));
          await blocked(pid); await updater.query('COMMIT');
          assert.equal((await pending).error?.status, type === 'owner' ? 404 : 403, `${mode}/${type}`);
          if (type !== 'owner') assert.equal(calls.some(sql => sql.includes('FROM ng_prescriptions')), false);
          assert.equal((await audits(f)).length, 0);
        } finally { await updater.query('ROLLBACK'); if (pending) await pending; reader.release(); updater.release(); }
      }
    });
    await t.test('eligibility and submission ownership changes wait until successful read audit commits', async () => {
      for (const mode of ['image','receipt']) for (const type of ['inactive','role','market','owner']) {
        const f = await fixture(), reached = pause(), proceed = pause(); const updater = await pool.connect(); let revocation, audited = false;
        const held = { async connect() { const client = await pool.connect(); return { release: () => client.release(), async query(sql, values) {
          if (sql === 'COMMIT') { assert.equal(audited, true); reached.resolve(); await proceed.promise; }
          const result = await client.query(sql, values);
          if (sql.includes('INSERT INTO audit_logs')) audited = true;
          return result;
        } }; } };
        const pending = read(f, mode, held).then(value => ({ value }), error => ({ error }));
        try {
          await Promise.race([reached.promise, pending.then(result => { throw result.error || new Error('Read missed audit boundary'); })]);
          assert.equal(audited, true);
          assert.equal((await audits(f)).length, 0, 'Uncommitted audit must remain invisible to another connection');
          const pid = (await updater.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          revocation = change(updater, f, type).then(value => ({ value }), error => ({ error }));
          await blocked(pid); proceed.resolve(); assert.ifError((await pending).error); assert.ifError((await revocation).error);
          assert.equal((await audits(f)).length, 1);
          await assert.rejects(read(f, mode), error => error.status === (type === 'owner' ? 404 : 403));
        } finally { proceed.resolve(); await Promise.allSettled([pending,revocation].filter(Boolean)); updater.release(); }
      }
    });
    await t.test('actual SQL audit failure rolls back without reporting a completed read or exposing content', async () => {
      for (const mode of ['image','receipt']) {
        const f = await fixture();
        const bad = { async connect() { const client = await pool.connect(); return { release: () => client.release(), query(sql, values) { return sql.includes('INSERT INTO audit_logs') ? client.query('SELECT 1/0') : client.query(sql, values); } }; } };
        await assert.rejects(read(f, mode, bad), error => error.code === '22012');
        assert.equal((await audits(f)).length, 0);
        assert.equal((await read(f, 'image')).toString(), 'Synthetic private image');
        assert.equal((await audits(f)).length, 1);
      }
    });
  } finally {
    try {
      // Delete only identities generated by this suite, including partially built fixtures.
      for (const f of owned) {
        await pool.query("DELETE FROM audit_logs WHERE user_id=$1 AND resource_type='prescription_submission' AND resource_id=$2", [f.patient, f.submission]);
        await pool.query('DELETE FROM ng_prescriptions WHERE id=$1', [f.submission]);
        await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[]) AND is_test_account=TRUE', [[f.patient, f.other]]);
      }
    } finally { await pool.end(); if (previous === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = previous; }
  }
});
