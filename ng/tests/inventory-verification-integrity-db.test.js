'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const service=require('../services/pharmacy/inventoryVerificationService');
const {createBrowserFixture}=require('./helpers/medication-delivery-fixture');
const {fixtureTargetSafety}=require('../scripts/fixtureTargetSafety');
const target=process.env.SIMULATION_DATABASE_URL;
const pause=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
test('PostgreSQL inventory verification commits with its audit and serializes current authority and prior status',{skip:!target},async t=>{
  const safety=fixtureTargetSafety({source:'SIMULATION_DATABASE_URL'});
  assert.equal(safety.skipped,false,safety.reason);
  const pool=new Pool({connectionString:target,max:8});
  const actualTarget=fixtureTargetSafety({source:'SIMULATION_DATABASE_URL',pool});
  assert.equal(actualTarget.skipped,false,actualTarget.reason);
  const previous={NODE_ENV:process.env.NODE_ENV,ENCRYPTION_KEY:process.env.ENCRYPTION_KEY};process.env.NODE_ENV='test';
  try{
    const f=await createBrowserFixture({pool});const other=await createBrowserFixture({pool});const actor=f.superAdmin;const id=f.inventoryId;
    const row=async()=>(await pool.query('SELECT availability_verification_status,availability_verified_at,availability_verified_by,availability_source,availability_notes,quantity_available,quantity_reserved,selling_price FROM ng_pharmacy_inventory WHERE id=$1',[id])).rows[0];
    const audits=async()=>(await pool.query("SELECT actor_user_id,from_status,to_status,details FROM ng_medication_source_audit_log WHERE inventory_id=$1 AND action='pharmacy_availability_verification_updated' ORDER BY created_at,id",[id])).rows;
    await t.test('both boolean states execute with typed SQL and exact before/after provenance',async()=>{
      const before=await row();const removed=await service.update(pool,actor,id,{verified:false});assert.equal(removed.inventory.availability_verified_at,null);assert.equal(removed.inventory.availability_verified_by,null);
      const updated=await service.update(pool,actor,id,{verified:true,availabilitySource:'isolated confirmation',availabilityNotes:'Synthetic evidence'});assert.ok(updated.inventory.availability_verified_at instanceof Date);assert.equal(updated.inventory.availability_verified_by,actor.id);assert.equal(updated.inventory.quantity_available,before.quantity_available);assert.equal(updated.inventory.quantity_reserved,before.quantity_reserved);assert.equal(updated.inventory.selling_price,before.selling_price);
      const history=await audits();assert.equal(history.length,2);assert.deepEqual(history.map(a=>[a.from_status,a.to_status]),[['verified','unverified'],['unverified','verified']]);assert.equal(history[1].actor_user_id,actor.id);assert.deepEqual(history[1].details,{availabilitySource:'isolated confirmation',availabilityNotes:'Synthetic evidence'});
    });
    await t.test('failed required audit rolls back all inventory fields and inserts no history',async()=>{
      const before=await row(),history=await audits();const bad={async connect(){const client=await pool.connect();return{release:()=>client.release(),query(sql,values){if(sql.includes('INSERT INTO ng_medication_source_audit_log'))return client.query('SELECT 1/0');return client.query(sql,values);}};}};
      await assert.rejects(service.update(bad,actor,id,{verified:false}),error=>error.code==='22012');assert.deepEqual(await row(),before);assert.deepEqual(await audits(),history);
    });
    await t.test('a waiting request observes a committed account suspension and makes no inventory change',async()=>{
      const revoker=await pool.connect();let waiting;const before=await row(),history=await audits();
      try{await revoker.query('BEGIN');await revoker.query("UPDATE users SET account_status='suspended' WHERE id=$1",[actor.id]);let settled=false;
        waiting=service.update(pool,actor,id,{verified:false}).then(value=>{settled=true;return{value};},error=>{settled=true;return{error};});await new Promise(resolve=>setTimeout(resolve,75));assert.equal(settled,false);await revoker.query('COMMIT');assert.equal((await waiting).error.status,403);
      }finally{await revoker.query('ROLLBACK');revoker.release();if(waiting)await waiting;}
      assert.deepEqual(await row(),before);assert.deepEqual(await audits(),history);await pool.query("UPDATE users SET account_status='active' WHERE id=$1",[actor.id]);
    });
    await t.test('inventory status and actor authority remain locked through audit and commit',async()=>{
      const atAudit=pause(),proceed=pause();const held={async connect(){const client=await pool.connect();return{release:()=>client.release(),async query(sql,values){if(sql.includes('INSERT INTO ng_medication_source_audit_log')){atAudit.resolve();await proceed.promise;}return client.query(sql,values);}};}};
      const first=service.update(held,actor,id,{verified:false});let second,revocation;
      try{await Promise.race([atAudit.promise,first]);let nextDone=false,revoked=false;
        second=service.update(pool,other.superAdmin,id,{verified:true}).then(value=>{nextDone=true;return{value};},error=>{nextDone=true;return{error};});
        revocation=pool.query("UPDATE users SET account_status='suspended' WHERE id=$1",[actor.id]).then(value=>{revoked=true;return value;});
        await new Promise(resolve=>setTimeout(resolve,75));assert.equal(nextDone,false);assert.equal(revoked,false);proceed.resolve();assert.equal((await first).inventory.availability_verification_status,'unverified');assert.equal((await second).value.inventory.availability_verification_status,'verified');await revocation;
      }finally{proceed.resolve();await Promise.allSettled([first,second,revocation].filter(Boolean));}
      await assert.rejects(service.update(pool,actor,id,{verified:true}),error=>error.status===403);
      const history=await audits();assert.equal(history[2].from_status,'verified');assert.equal(history[2].to_status,'unverified');assert.equal(history.length,4);assert.equal(history[3].from_status,'unverified');assert.equal(history[3].to_status,'verified');assert.equal(history[3].actor_user_id,other.superAdmin.id);
    });
  }finally{await pool.end();for(const[k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
