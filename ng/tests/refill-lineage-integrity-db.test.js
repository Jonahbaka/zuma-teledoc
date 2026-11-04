'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixtureTargetSafety } = require('../scripts/fixtureTargetSafety');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const service = require('../services/rx-engine/prescriptionWorkflowService');
const target = process.env.SIMULATION_DATABASE_URL;
const pause = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('PostgreSQL refill lineage and mandatory events remain atomic under competing decisions', { skip: !target }, async t => {
  const safety = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL' });
  assert.equal(safety.skipped, false, safety.reason);
  const pool = new Pool({ connectionString: target, max: 8, statement_timeout: 15000 });
  const poolSafety = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL', pool });
  assert.equal(poolSafety.skipped, false, poolSafety.reason);
  const fixture = async () => {
    const f = Object.fromEntries(['patient','otherPatient','provider','profile','rx','otherRx','item','otherItem'].map(key => [key, crypto.randomUUID()]));
    for (const key of ['patient','otherPatient','provider']) await pool.query(`INSERT INTO users(id,email,password_hash,role,first_name,last_name,country,market_scope,region,is_active,is_verified,is_test_account,provider_status,account_status)
      VALUES($1,$2,'!isolated-fixture-not-a-login',$3,'Synthetic','Refill Test','NG','NG','NG',TRUE,TRUE,TRUE,$4,'active')`,
    [f[key], `${key}-${f[key]}@doctarx.test`, key === 'provider' ? 'provider' : 'patient', key === 'provider' ? 'approved' : null]);
    await pool.query(`INSERT INTO ng_providers(id,user_id,full_name,email,phone,status) VALUES($1,$2,'Synthetic Refill Clinician',$3,'+2348000000010','verified')`, [f.profile,f.provider,`provider-${f.provider}@doctarx.test`]);
    for (const [rx, patient, item] of [[f.rx,f.patient,f.item],[f.otherRx,f.otherPatient,f.otherItem]]) {
      await pool.query(`INSERT INTO ng_digital_prescriptions(id,patient_user_id,provider_id,items,lifecycle_status,signed_at,expires_at) VALUES($1,$2,$3,'[]','completed',NOW(),CURRENT_DATE+30)`, [rx,patient,f.profile]);
      await pool.query(`INSERT INTO ng_rx_items(id,prescription_id,drug_name,dosage,frequency,quantity,status,dispensed_quantity,refills_authorized,refills_remaining) VALUES($1,$2,'Synthetic refill medication','Synthetic clinician directions','Synthetic frequency',1,'dispensed',1,2,2)`, [item,rx]);
    }
    return { ...f, patientActor: { user_id: f.patient, kind: 'patient' }, actor: { user_id: f.provider, kind: 'prescriber' } };
  };
  const request = (f, item = f.item, database = pool) => service.requestRefill(f.rx,item,f.patientActor,{ quantity: 1 },database);
  const patientRequest = (f, database = pool, item = f.item) => service.requestPatientRefill(f.rx,item,f.patientActor,{ quantity: 1 },database);
  const changePatientAuthority = (client, f, type) => type === 'owner'
    ? client.query('UPDATE ng_digital_prescriptions SET patient_user_id=$2 WHERE id=$1', [f.rx, f.otherPatient])
    : type === 'role' ? client.query("UPDATE users SET role='provider' WHERE id=$1", [f.patient])
      : client.query('UPDATE users SET is_active=FALSE WHERE id=$1', [f.patient]);
  const decide = (f, refillId, mode, database = pool) => mode === 'approve' ? service.approveRefill(refillId,f.actor,database) : service.denyRefill(refillId,f.actor,{ reason: 'Synthetic reviewed denial' },database);
  const snapshot = async f => ({
    items: (await pool.query('SELECT id,prescription_id,refills_remaining FROM ng_rx_items WHERE id=ANY($1::uuid[]) ORDER BY id', [[f.item,f.otherItem]])).rows,
    refills: (await pool.query('SELECT id,prescription_id,item_id,status,quantity FROM ng_rx_refills WHERE prescription_id=ANY($1::uuid[]) ORDER BY id', [[f.rx,f.otherRx]])).rows,
    events: (await pool.query('SELECT id,event_kind,item_id FROM ng_rx_events WHERE prescription_id=ANY($1::uuid[]) ORDER BY id', [[f.rx,f.otherRx]])).rows,
  });
  const blocked = async pid => {
    const until = Date.now()+5000;
    while (Date.now()<until) {
      if ((await pool.query('SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted',[pid])).rows.length) return;
      await new Promise(resolve => setTimeout(resolve,20));
    }
    assert.fail('Expected actual PostgreSQL row-lock contention');
  };
  try {
    await t.test('foreign item requests and pre-existing inconsistent rows cannot change either prescription', async () => {
      const f = await fixture(), before = await snapshot(f);
      await assert.rejects(request(f,f.otherItem), { code: 'INVALID_STATE' }); assert.deepEqual(await snapshot(f), before);
      const bad = (await pool.query(`INSERT INTO ng_rx_refills(prescription_id,item_id,requested_by_user,status) VALUES($1,$2,$3,'requested') RETURNING id`, [f.rx,f.otherItem,f.patient])).rows[0];
      const legacy = await snapshot(f);
      for (const mode of ['approve','deny']) { await assert.rejects(decide(f,bad.id,mode), { code: 'INVALID_STATE' }); assert.deepEqual(await snapshot(f),legacy); }
    });
    await t.test('item and whole-prescription requests preserve existing decision semantics and attributed events', async () => {
      for (const mode of ['approve','deny']) for (const itemScoped of [true,false]) {
        const f = await fixture(), created = await request(f,itemScoped ? f.item : null);
        const result = await decide(f,created.id,mode); assert.equal(result.status,mode === 'approve' ? 'approved' : 'denied');
        const after = await snapshot(f); assert.equal(after.items.find(item => item.id===f.item).refills_remaining, mode==='approve' && itemScoped ? 1 : 2);
        assert.equal(after.items.find(item => item.id===f.otherItem).refills_remaining,2); assert.equal(after.events.length,2);
        assert.equal(after.events.filter(event => event.event_kind === 'refill_requested').length,1);
        const approved = (await pool.query('SELECT approved_by_user FROM ng_rx_refills WHERE id=$1',[created.id])).rows[0];
        assert.equal(approved.approved_by_user,mode==='approve' ? f.provider : null);
      }
    });
    await t.test('real SQL audit failure rolls back requests, counters and decisions before a valid retry', async () => {
      for (const action of ['request','approve','deny']) {
        const f = await fixture(), prior = action==='request' ? null : await request(f), before = await snapshot(f);
        const bad = { async connect() { const client = await pool.connect(); return { release: () => client.release(), query(sql, values) { return sql.includes('INSERT INTO ng_rx_events') ? client.query('SELECT 1/0') : client.query(sql,values); } }; } };
        await assert.rejects(action==='request' ? request(f,f.item,bad) : decide(f,prior.id,action,bad), { code:'22012' });
        assert.deepEqual(await snapshot(f),before);
        if (action==='request') await request(f); else await decide(f,prior.id,action);
        assert.equal((await snapshot(f)).events.length,before.events.length+1);
      }
    });
    await t.test('opposing decisions wait for the first event and only one status/counter/event commits', async () => {
      for (const firstMode of ['approve','deny']) {
        const f = await fixture(), created = await request(f), reached = pause(), proceed = pause(); const second = await pool.connect(); let competing;
        const held = { async connect() { const client = await pool.connect(); return { release: () => client.release(), async query(sql,values) { if (sql.includes('INSERT INTO ng_rx_events')) { reached.resolve(); await proceed.promise; } return client.query(sql,values); } }; } };
        const pending = decide(f,created.id,firstMode,held).then(value => ({ value }),error => ({ error }));
        try {
          await Promise.race([reached.promise,pending.then(result => { throw result.error || new Error('Decision missed audit'); })]);
          const pid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          competing = decide(f,created.id,firstMode==='approve' ? 'deny' : 'approve',{ connect: async () => ({ query: (...args) => second.query(...args), release() {} }) }).then(value => ({ value }),error => ({ error }));
          await blocked(pid); proceed.resolve(); assert.ifError((await pending).error); assert.equal((await competing).error?.code,'NOT_FOUND');
          const after = await snapshot(f); assert.equal(after.events.length,2); assert.equal(after.refills[0].status,firstMode==='approve' ? 'approved' : 'denied');
          assert.equal(after.items.find(item=>item.id===f.item).refills_remaining,firstMode==='approve' ? 1 : 2);
        } finally { proceed.resolve(); await Promise.allSettled([pending,competing].filter(Boolean)); second.release(); }
      }
    });
    await t.test('item or refill reassignment committed while acquiring locks cannot evade lineage recheck', async () => {
      for (const kind of ['item','refill']) {
        const f = await fixture(), created = kind==='refill' ? await request(f) : null;
        const updater = await pool.connect(), worker = await pool.connect(); let pending;
        try {
          await updater.query('BEGIN');
          if (kind==='item') await updater.query('UPDATE ng_rx_items SET prescription_id=$2,position=2 WHERE id=$1',[f.item,f.otherRx]);
          else await updater.query('UPDATE ng_rx_refills SET prescription_id=$2 WHERE id=$1',[created.id,f.otherRx]);
          const pid = (await worker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          const adapter = { connect: async () => ({ query:(...args)=>worker.query(...args),release() {} }) };
          pending = (kind==='item' ? request(f,f.item,adapter) : decide(f,created.id,'approve',adapter)).then(value=>({ value }),error=>({ error }));
          await blocked(pid); await updater.query('COMMIT');
          assert.equal((await pending).error?.code,kind==='item' ? 'INVALID_STATE' : 'NOT_FOUND');
          const after = await snapshot(f); assert.ok(after.items.every(item=>item.refills_remaining===2)); assert.equal(after.events.length,created ? 1 : 0);
          assert.equal(after.refills.length,created ? 1 : 0); if (created) assert.equal(after.refills[0].status,'requested');
        } finally { await updater.query('ROLLBACK'); if (pending) await pending; worker.release(); updater.release(); }
      }
    });
    await t.test('patient requests preserve item and whole-prescription semantics without new market or account-status policy', async () => {
      for (const itemScoped of [true, false]) {
        const f = await fixture();
        await pool.query("UPDATE users SET account_status='suspended',market_scope='US' WHERE id=$1", [f.patient]);
        const result = await patientRequest(f, pool, itemScoped ? f.item : null);
        assert.equal(result.requested_by_user, f.patient); assert.equal(result.status, 'requested');
        assert.equal(result.item_id, itemScoped ? f.item : null);
        const event = (await pool.query("SELECT actor_user_id,actor_kind,event_kind FROM ng_rx_events WHERE prescription_id=$1", [f.rx])).rows;
        assert.deepEqual(event, [{ actor_user_id: f.patient, actor_kind: 'patient', event_kind: 'refill_requested' }]);
      }
    });
    await t.test('patient authorization is rechecked after current authority or ownership changes commit first', async () => {
      for (const type of ['active', 'role', 'owner']) {
        const f = await fixture(), before = await snapshot(f), updater = await pool.connect(), worker = await pool.connect(); let pending;
        try {
          await updater.query('BEGIN'); await changePatientAuthority(updater, f, type);
          const pid = (await worker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          const adapter = { connect: async () => ({ query: (...args) => worker.query(...args), release() {} }) };
          pending = patientRequest(f, adapter).then(value => ({ value }), error => ({ error }));
          await blocked(pid); await updater.query('COMMIT');
          assert.equal((await pending).error?.code, 'FORBIDDEN', type);
          assert.deepEqual(await snapshot(f), before);
        } finally { await updater.query('ROLLBACK'); if (pending) await pending; worker.release(); updater.release(); }
      }
    });
    await t.test('patient authority and ownership remain locked through the mandatory refill event and commit', async () => {
      for (const type of ['active', 'role', 'owner']) {
        const f = await fixture(), reached = pause(), proceed = pause(), updater = await pool.connect(); let changed;
        const held = { async connect() { const client = await pool.connect(); return { release: () => client.release(), async query(sql, values) {
          if (sql.includes('INSERT INTO ng_rx_events')) { reached.resolve(); await proceed.promise; }
          return client.query(sql, values);
        } }; } };
        const pending = patientRequest(f, held).then(value => ({ value }), error => ({ error }));
        try {
          await Promise.race([reached.promise, pending.then(result => { throw result.error || new Error('Patient request missed required event'); })]);
          const pid = (await updater.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          changed = changePatientAuthority(updater, f, type).then(value => ({ value }), error => ({ error }));
          await blocked(pid); proceed.resolve();
          assert.ifError((await pending).error); assert.ifError((await changed).error);
          const after = await snapshot(f); assert.equal(after.refills.length, 1); assert.equal(after.events.length, 1);
          await assert.rejects(patientRequest(f), { code: 'FORBIDDEN' });
        } finally { proceed.resolve(); await Promise.allSettled([pending, changed].filter(Boolean)); updater.release(); }
      }
    });
    await t.test('patient request and event roll back together on actual SQL audit failure', async () => {
      const f = await fixture(), before = await snapshot(f);
      const bad = { async connect() { const client = await pool.connect(); return { release: () => client.release(), query(sql, values) {
        return sql.includes('INSERT INTO ng_rx_events') ? client.query('SELECT 1/0') : client.query(sql, values);
      } }; } };
      await assert.rejects(patientRequest(f, bad), { code: '22012' });
      assert.deepEqual(await snapshot(f), before);
    });
  } finally { await pool.end(); }
});
