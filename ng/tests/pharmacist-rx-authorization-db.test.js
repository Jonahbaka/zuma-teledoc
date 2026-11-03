'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const service = require('../services/pharmacy/pharmacistRxService');
const { createBrowserFixture } = require('./helpers/medication-delivery-fixture');
const target = process.env.SIMULATION_DATABASE_URL;
const pause = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('PostgreSQL pharmacist gateway serializes suspension/rerouting and never commits without its audit', { skip: !target }, async t => {
  const url = new URL(target); assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'), 'Only an explicitly disposable loopback database is supported.');
  const previous = { NODE_ENV: process.env.NODE_ENV, ENCRYPTION_KEY: process.env.ENCRYPTION_KEY }; process.env.NODE_ENV = 'test';
  const pool = new Pool({ connectionString: target, max: 8 });
  try {
    const f = await createBrowserFixture({ pool }); const other = await createBrowserFixture({ pool });
    await t.test('nullable and explicit lifecycle filters use the PostgreSQL prescription enum consistently', async () => {
      assert.equal((await service.list(pool,f.pharmacist)).some(rx=>rx.id===f.prescriptionId),true);
      assert.equal((await service.list(pool,f.pharmacist,{status:'sent_to_pharmacy'})).some(rx=>rx.id===f.prescriptionId),true);
      for (const status of ['received','partially_dispensed','fully_dispensed','completed']) assert.equal((await service.list(pool,f.pharmacist,{status})).some(rx=>rx.id===f.prescriptionId),false);
      assert.equal((await service.list(pool,f.pharmacist,{status:'sent_to_pharmacy',since:'2099-01-01T00:00:00Z'})).length,0);
    });
    await t.test('partial quantities fail closed, full quantities complete once, and historical short records cannot fulfill', async () => {
      const quantityFixture = await createBrowserFixture({ pool });
      const rxId = quantityFixture.prescriptionId; const pharmacist = quantityFixture.pharmacist;
      await pool.query('UPDATE ng_rx_items SET quantity=2 WHERE prescription_id=$1', [rxId]);
      const item = (await pool.query('SELECT id FROM ng_rx_items WHERE prescription_id=$1', [rxId])).rows[0];
      await service.mutate(pool, pharmacist, rxId, 'receive');
      const before = (await pool.query('SELECT count(*)::int AS count FROM ng_rx_events WHERE prescription_id=$1', [rxId])).rows[0].count;
      await assert.rejects(service.mutate(pool, pharmacist, rxId, 'dispense', { quantity: 1 }, item.id), { code: 'INVALID_STATE' });
      assert.deepEqual((await pool.query('SELECT status,dispensed_quantity FROM ng_rx_items WHERE id=$1', [item.id])).rows[0], { status: 'available', dispensed_quantity: 0 });
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM ng_rx_events WHERE prescription_id=$1', [rxId])).rows[0].count, before);
      const full = await service.mutate(pool, pharmacist, rxId, 'dispense', { quantity: 2 }, item.id);
      assert.equal(full.lifecycle_status, 'fully_dispensed'); assert.equal(full.quantity_review_required, false);
      await assert.rejects(service.mutate(pool, pharmacist, rxId, 'dispense', { quantity: 2 }, item.id), { code: 'INVALID_STATE' });
      await pool.query('UPDATE ng_rx_items SET dispensed_quantity=1 WHERE id=$1', [item.id]); // Isolated historical corruption, not a repair operation.
      assert.equal((await service.read(pool, pharmacist, rxId)).quantity_review_required, true);
      await assert.rejects(service.mutate(pool, pharmacist, rxId, 'complete'), { code: 'INVALID_STATE' });
      const inbox = require('../services/pharmacy/clinicalInboxService');
      await assert.rejects(inbox.updateStatus(pool, pharmacist, quantityFixture.pharmacyId, rxId, { status: 'fulfilled' }), error => error.status === 409);
      assert.equal((await pool.query('SELECT dispensed_quantity FROM ng_rx_items WHERE id=$1', [item.id])).rows[0].dispensed_quantity, 1);
      const valid = await createBrowserFixture({ pool });
      const validItem = (await pool.query('SELECT id FROM ng_rx_items WHERE prescription_id=$1', [valid.prescriptionId])).rows[0];
      await service.mutate(pool, valid.pharmacist, valid.prescriptionId, 'receive');
      await service.mutate(pool, valid.pharmacist, valid.prescriptionId, 'dispense', {}, validItem.id);
      assert.equal((await service.mutate(pool, valid.pharmacist, valid.prescriptionId, 'complete')).lifecycle_status, 'completed');
    });
    await t.test('low-level Rx events and lifecycle mutation roll back on gateway compliance failure', async () => {
      const bad = { async connect() { const client=await pool.connect(); return {release:()=>client.release(),query(sql,values){if(sql.includes('INSERT INTO ng_compliance_audit_log'))throw new Error('Isolated gateway audit failure');return client.query(sql,values);}};}};
      await assert.rejects(service.mutate(bad,f.pharmacist,f.prescriptionId,'receive'),/Isolated gateway audit failure/);
      assert.equal((await pool.query('SELECT lifecycle_status FROM ng_digital_prescriptions WHERE id=$1',[f.prescriptionId])).rows[0].lifecycle_status,'sent_to_pharmacy');
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM ng_rx_events WHERE prescription_id=$1',[f.prescriptionId])).rows[0].count,0);
      await assert.rejects(service.read(bad,f.pharmacist,f.prescriptionId),/Isolated gateway audit failure/);
    });
    await t.test('account authority stays locked through clinical read and audit, then new reads see suspension',async()=>{
      const atRead=pause(),proceed=pause();
      const paused={async connect(){const client=await pool.connect();return{release:()=>client.release(),async query(sql,values){if(sql.startsWith('SELECT id,to_char(expires_at')){atRead.resolve();await proceed.promise;}return client.query(sql,values);}};}};
      const reading=service.read(paused,f.pharmacist,f.prescriptionId);let suspending;
      try{
        await Promise.race([atRead.promise,reading]);let done=false;
        suspending=pool.query("UPDATE users SET account_status='suspended' WHERE id=$1",[f.pharmacist.id]).then(value=>{done=true;return value;});
        await new Promise(resolve=>setTimeout(resolve,75));assert.equal(done,false);
        proceed.resolve();assert.equal((await reading).id,f.prescriptionId);await suspending;
        await assert.rejects(service.read(pool,f.pharmacist,f.prescriptionId),error=>error.status===403);
        await assert.rejects(service.list(pool,f.pharmacist),error=>error.status===403);
      }finally{proceed.resolve();await Promise.allSettled([reading,suspending].filter(Boolean));}
      await pool.query("UPDATE users SET account_status='active' WHERE id=$1",[f.pharmacist.id]);
    });
    await t.test('a response waiting behind rerouting rechecks the explicit destination before calling internal workflow',async()=>{
      const rerouter=await pool.connect();let waiting;
      try{
        await rerouter.query('BEGIN');await rerouter.query('UPDATE ng_digital_prescriptions SET routed_pharmacy_id=$1 WHERE id=$2',[other.pharmacyId,f.prescriptionId]);let settled=false;
        waiting=service.mutate(pool,f.pharmacist,f.prescriptionId,'receive').then(value=>{settled=true;return{value};},error=>{settled=true;return{error};});
        await new Promise(resolve=>setTimeout(resolve,75));assert.equal(settled,false);
        await rerouter.query('COMMIT');assert.equal((await waiting).error.status,404);
      }finally{await rerouter.query('ROLLBACK');rerouter.release();if(waiting)await waiting;}
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM ng_rx_events WHERE prescription_id=$1',[f.prescriptionId])).rows[0].count,0);
      await assert.rejects(service.read(pool,f.pharmacist,f.prescriptionId,true),error=>error.status===404);
      assert.equal((await service.list(pool,f.pharmacist)).some(rx=>rx.id===f.prescriptionId),false);
      const received=await service.mutate(pool,other.pharmacist,f.prescriptionId,'receive');assert.equal(received.lifecycle_status,'received');
      assert.equal((await service.read(pool,other.pharmacist,f.prescriptionId)).items.length,1);
    });
    await t.test('unverified or suspended receiving workspace cannot retain external history or item authority',async()=>{
      const item=(await pool.query('SELECT id FROM ng_rx_items WHERE prescription_id=$1',[f.prescriptionId])).rows[0];
      await pool.query("UPDATE ng_pharmacies SET account_status='suspended' WHERE id=$1",[other.pharmacyId]);
      await assert.rejects(service.read(pool,other.pharmacist,f.prescriptionId,true),error=>error.status===403);
      await assert.rejects(service.mutate(pool,other.pharmacist,f.prescriptionId,'dispense',{quantity:1},item.id),error=>error.status===403);
      assert.equal((await pool.query('SELECT status FROM ng_rx_items WHERE id=$1',[item.id])).rows[0].status,'available');
    });
  } finally {
    await pool.end();for(const[name,value]of Object.entries(previous)){if(value===undefined)delete process.env[name];else process.env[name]=value;}
  }
});
