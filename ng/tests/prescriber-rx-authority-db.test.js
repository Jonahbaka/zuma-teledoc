'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {Pool}=require('pg');
const service=require('../services/rx-engine/prescriberRxService');
const {fixtureTargetSafety}=require('../scripts/fixtureTargetSafety');
const target=process.env.SIMULATION_DATABASE_URL;
const pause=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};

test('PostgreSQL external prescriber authority stays current through Rx ownership, workflow and audit commit',{skip:!target},async t=>{
  const safety=fixtureTargetSafety({source:'SIMULATION_DATABASE_URL'});
  assert.equal(safety.skipped,false,safety.reason);
  const pool=new Pool({connectionString:target,max:8,statement_timeout:15000});
  const actualTarget=fixtureTargetSafety({source:'SIMULATION_DATABASE_URL',pool});
  assert.equal(actualTarget.skipped,false,actualTarget.reason);
  const fixture=async()=>{
    const f=Object.fromEntries(['user','other','spare','patient','unrelated','profile','otherProfile','rx','otherRx','item','otherItem','refill'].map(key=>[key,crypto.randomUUID()]));
    for(const key of ['user','other','spare','patient','unrelated']){const provider=['user','other','spare'].includes(key);await pool.query(`INSERT INTO users(id,email,password_hash,role,first_name,last_name,country,market_scope,region,is_active,is_verified,is_test_account,provider_status,account_status)
      VALUES($1,$2,'!isolated-fixture-not-a-login',$3,'Synthetic','Prescriber Test','NG','NG','NG',TRUE,TRUE,TRUE,$4,'active')`,[f[key],`${key}-${f[key]}@doctarx.test`,provider?'provider':'patient',provider?'approved':null]);}
    for(const [profile,user] of [[f.profile,f.user],[f.otherProfile,f.other]])await pool.query(`INSERT INTO ng_providers(id,user_id,full_name,email,phone,status) VALUES($1,$2,'Synthetic Prescriber',$3,'+2348000000010','verified')`,[profile,user,`provider-${user}@doctarx.test`]);
    await pool.query(`INSERT INTO ng_appointments(patient_user_id,provider_id,scheduled_at,status,consult_fee,total_amount) VALUES($1,$2,'2099-06-15T12:00:00Z','confirmed',0,0)`,[f.patient,f.profile]);
    for(const [rx,profile,item]of[[f.rx,f.profile,f.item],[f.otherRx,f.otherProfile,f.otherItem]]){
      await pool.query(`INSERT INTO ng_digital_prescriptions(id,patient_user_id,provider_id,items,lifecycle_status,expires_at) VALUES($1,$2,$3,'[]','drafted',CURRENT_DATE+30)`,[rx,f.patient,profile]);
      await pool.query(`INSERT INTO ng_rx_items(id,prescription_id,drug_name,dosage,frequency,quantity,refills_authorized,refills_remaining) VALUES($1,$2,'Synthetic medication','Synthetic directions','Synthetic schedule',2,2,2)`,[item,rx]);
    }
    await pool.query(`INSERT INTO ng_rx_refills(id,prescription_id,item_id,requested_by_user,status) VALUES($1,$2,$3,$4,'requested')`,[f.refill,f.rx,f.item,f.patient]);
    return{...f,actor:{id:f.user,role:'provider'}};
  };
  const input=f=>({provider_id:f.otherProfile,patient_user_id:f.patient,appointment_id:'',preferred_pharmacy_id:'',items:[{drug_name:'Synthetic manually authored medication',dosage:'Synthetic directions',frequency:'Synthetic schedule',quantity:2,refills_authorized:0}],notes:'No actual medication ordered.'});
  const invoke=(f,action,database=pool)=>action==='read'?service.read(database,f.actor,f.rx):action==='list'?service.list(database,f.actor,{status:'drafted'}):action==='create'?service.create(database,f.actor,input(f)):service.mutate(database,f.actor,action==='approve_refill'?f.refill:f.rx,action,{});
  const history=async f=>({events:(await pool.query('SELECT * FROM ng_rx_events WHERE prescription_id=$1 ORDER BY id',[f.rx])).rows,audits:(await pool.query("SELECT * FROM audit_logs WHERE user_id=$1 AND resource_type='digital_prescription' ORDER BY id",[f.user])).rows});
  const snapshot=async f=>({rx:(await pool.query('SELECT * FROM ng_digital_prescriptions WHERE provider_id=$1 ORDER BY id',[f.profile])).rows,items:(await pool.query('SELECT * FROM ng_rx_items WHERE prescription_id=$1 ORDER BY id',[f.rx])).rows,refill:(await pool.query('SELECT * FROM ng_rx_refills WHERE id=$1',[f.refill])).rows[0],...await history(f)});
  const change=(client,f,type)=>type==='profile'?client.query("UPDATE ng_providers SET status='suspended' WHERE id=$1",[f.profile]):type==='owner'?client.query('UPDATE ng_providers SET user_id=$2 WHERE id=$1',[f.profile,f.spare]):type==='rx'?client.query('UPDATE ng_digital_prescriptions SET provider_id=$2 WHERE id=$1',[f.rx,f.otherProfile]):client.query("UPDATE users SET account_status='suspended' WHERE id=$1",[f.user]);
  const blocked=async pid=>{const until=Date.now()+5000;while(Date.now()<until){if((await pool.query('SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted',[pid])).rows.length)return;await new Promise(resolve=>setTimeout(resolve,20));}assert.fail('Expected actual PostgreSQL row-lock contention');};
  try{
    await t.test('manual creation uses established care and returns its uncommitted draft through the same client',async()=>{
      const f=await fixture();const created=await invoke(f,'create');assert.ok(created.id);assert.equal(created.provider_id,f.profile);assert.equal(created.lifecycle_status,'drafted');assert.equal(created.signed_at,null);assert.equal(created.routed_pharmacy_id,null);assert.equal(created.items.length,1);
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM audit_logs WHERE resource_id=$1 AND user_id=$2 AND action='create'",[created.id,f.user])).rows[0].count,1);
      assert.equal((await invoke(f,'list')).some(row=>row.id===created.id),true);
      await assert.rejects(service.create(pool,f.actor,{...input(f),patient_user_id:f.unrelated}),error=>error.status===403);
      await assert.rejects(service.create(pool,f.actor,{...input(f),aiSourceSuggestionId:crypto.randomUUID(),phcEncounterId:crypto.randomUUID()}),{code:'CLINICAL_AI_RX_CONTEXT_DENIED'});
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM ng_digital_prescriptions WHERE provider_id=$1',[f.profile])).rows[0].count,2);
    });
    await t.test('Rx/refill reassignment before service entry cannot reuse former clinician authority',async()=>{
      const f=await fixture();await pool.query('UPDATE ng_rx_refills SET prescription_id=$2,item_id=$3 WHERE id=$1',[f.refill,f.otherRx,f.otherItem]);
      await assert.rejects(invoke(f,'approve_refill'),error=>error.status===404);assert.equal((await history(f)).events.length,0);assert.equal((await history(f)).audits.length,0);
      assert.equal((await pool.query('SELECT refills_remaining FROM ng_rx_items WHERE id=$1',[f.otherItem])).rows[0].refills_remaining,2);
    });
    await t.test('refill metadata is rechecked against the Rx authorized under lock after a competing reassignment',async()=>{
      const f=await fixture(),updater=await pool.connect(),worker=await pool.connect();let pending;
      try{await updater.query('BEGIN');await updater.query('UPDATE ng_rx_refills SET prescription_id=$2,item_id=$3 WHERE id=$1',[f.refill,f.otherRx,f.otherItem]);const pid=(await worker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        pending=invoke(f,'approve_refill',{connect:async()=>({release(){},query:(...args)=>worker.query(...args)})}).then(value=>({value}),error=>({error}));await blocked(pid);await updater.query('COMMIT');assert.equal((await pending).error?.status,404);
        assert.deepEqual(await history(f),{events:[],audits:[]});assert.equal((await pool.query('SELECT status FROM ng_rx_refills WHERE id=$1',[f.refill])).rows[0].status,'requested');assert.equal((await pool.query('SELECT refills_remaining FROM ng_rx_items WHERE id=$1',[f.otherItem])).rows[0].refills_remaining,2);
      }finally{await updater.query('ROLLBACK');if(pending)await pending;worker.release();updater.release();}
    });
    await t.test('revocations and ownership changes committed while waiting are rechecked before PHI or writes',async()=>{
      for(const action of ['read','sign','approve_refill','create'])for(const type of action==='create'?['account','profile','owner']:['account','profile','owner','rx']){
        const f=await fixture(),updater=await pool.connect(),worker=await pool.connect();let pending;const calls=[];
        try{await updater.query('BEGIN');await change(updater,f,type);const pid=(await worker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          const adapter={connect:async()=>({release(){},query(sql,params){calls.push(sql);return worker.query(sql,params);}})};
          pending=invoke(f,action,adapter).then(value=>({value}),error=>({error}));await blocked(pid);await updater.query('COMMIT');assert.equal((await pending).error?.status,type==='rx'?404:403,`${action}/${type}`);
          assert.equal(calls.some(sql=>sql.startsWith('SELECT * FROM ng_digital_prescriptions')||sql.startsWith('UPDATE')||sql.startsWith('INSERT')),false);assert.deepEqual(await history(f),{events:[],audits:[]});
        }finally{await updater.query('ROLLBACK');if(pending)await pending;worker.release();updater.release();}
      }
    });
    await t.test('current account/profile/Rx locks remain held through the mandatory read or mutation audit',async()=>{
      for(const action of ['read','sign','approve_refill'])for(const type of ['account','owner','rx']){
        const f=await fixture(),reached=pause(),proceed=pause(),updater=await pool.connect();let revocation;
        const adapter={async connect(){const client=await pool.connect();return{release:()=>client.release(),async query(sql,params){if(sql.includes('INSERT INTO audit_logs')){reached.resolve();await proceed.promise;}return client.query(sql,params);}};}};
        const pending=invoke(f,action,adapter).then(value=>({value}),error=>({error}));
        try{await Promise.race([reached.promise,pending.then(result=>{throw result.error||new Error('Missing required audit');})]);const pid=(await updater.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;revocation=change(updater,f,type).then(value=>({value}),error=>({error}));await blocked(pid);proceed.resolve();assert.ifError((await pending).error);assert.ifError((await revocation).error);assert.equal((await history(f)).audits.length,1);
          await assert.rejects(invoke(f,'read'),error=>error.status===(type==='rx'?404:403));
        }finally{proceed.resolve();await Promise.allSettled([pending,revocation].filter(Boolean));updater.release();}
      }
    });
    await t.test('actual SQL failure in gateway audit rolls back clinical state, event, counters and draft creation',async()=>{
      for(const action of ['read','sign','approve_refill','create']){const f=await fixture(),before=await snapshot(f);const adapter={async connect(){const client=await pool.connect();return{release:()=>client.release(),query(sql,params){return sql.includes('INSERT INTO audit_logs')?client.query('SELECT 1/0'):client.query(sql,params);}};}};await assert.rejects(invoke(f,action,adapter),{code:'22012'});assert.deepEqual(await snapshot(f),before);}
    });
    await t.test('real JWT HTTP access cannot revive a suspended or reassigned prescriber',async()=>{
      const express=require('express'),jwt=require('jsonwebtoken'),db=require('../../server/db');const oldPool=db.getPool,oldQuery=db.query,previousSecret=process.env.JWT_ACCESS_SECRET;process.env.JWT_ACCESS_SECRET=crypto.randomBytes(48).toString('hex');db.getPool=()=>pool;db.query=(...args)=>pool.query(...args);let server;
      try{const f=await fixture(),token=jwt.sign({userId:f.user,role:'provider'},process.env.JWT_ACCESS_SECRET,{algorithm:'HS256',expiresIn:'15m'});const app=express();app.use(express.json());app.use('/rx',require('../../server/middleware/auth').authenticate,require('../routes/prescriptions'));server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
        const http=async(path,body)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/rx${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};};
        const allowed=await http(`/${f.rx}`);assert.equal(allowed.status,200,JSON.stringify(allowed.body));assert.equal(allowed.cache,'private, no-store');
        await pool.query("UPDATE users SET account_status='suspended' WHERE id=$1",[f.user]);for(const [path,body]of[['/',null],[`/${f.rx}`,null],[`/${f.rx}/sign`,{}],[`/refills/${f.refill}/approve`,{}],['/',input(f)]])assert.equal((await http(path,body)).status,403,path);
        await pool.query("UPDATE users SET account_status='active' WHERE id=$1",[f.user]);await change(pool,f,'rx');assert.equal((await http(`/${f.rx}/sign`,{})).status,404);
      }finally{if(server)await new Promise(resolve=>server.close(resolve));db.getPool=oldPool;db.query=oldQuery;if(previousSecret===undefined)delete process.env.JWT_ACCESS_SECRET;else process.env.JWT_ACCESS_SECRET=previousSecret;}
    });
  }finally{await pool.end();}
});
