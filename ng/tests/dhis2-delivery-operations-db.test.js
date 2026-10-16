'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const express = require('express');
const jwt = require('jsonwebtoken');

const target = process.env.SIMULATION_DATABASE_URL;
test('actual DHIS2 worker and HTTP commands enforce durable scheduling, async proof, current scope and rollback-only recovery', { skip: !target }, async () => {
  const url = new URL(target); assert.ok(['localhost','127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'));
  const previous = Object.fromEntries(['DATABASE_URL','ENCRYPTION_KEY','JWT_ACCESS_SECRET','NODE_ENV','DHIS2_ALLOW_LIVE_SYNC','DHIS2_DELIVERY_WORKER_ENABLED'].map(key => [key,process.env[key]]));
  Object.assign(process.env, { DATABASE_URL: target, ENCRYPTION_KEY: 'a'.repeat(64), JWT_ACCESS_SECRET: 'isolated-dhis2-operations-http-secret-at-least-32', NODE_ENV: 'test', DHIS2_ALLOW_LIVE_SYNC: 'true', DHIS2_DELIVERY_WORKER_ENABLED: 'true' });
  const database = new Pool({ connectionString: target }); const client = await database.connect();
  const db = require('../../server/db'); const oldPool = db.getPool; const oldQuery = db.query;
  let serial = 0; let server; let failAudit = false;
  let queryQueue = Promise.resolve();
  const isolatedQuery = (sql,params) => { const result=queryQueue.then(()=>client.query(sql,params));queryQueue=result.catch(()=>undefined);return result; };
  const isolated = { query: isolatedQuery, async connect() {
    const savepoint = 'dhis2_operation_' + (++serial);
    return { async query(sql, params) {
      if (sql === 'BEGIN') return client.query('SAVEPOINT ' + savepoint);
      if (sql === 'COMMIT') return client.query('RELEASE SAVEPOINT ' + savepoint);
      if (sql === 'ROLLBACK') { await client.query('ROLLBACK TO SAVEPOINT ' + savepoint); return client.query('RELEASE SAVEPOINT ' + savepoint); }
      if (failAudit && sql.includes('INSERT INTO audit_logs')) throw new Error('Isolated audit unavailable');
      return isolatedQuery(sql, params);
    }, release() {} };
  } };
  const reportIds = [];
  try {
    await client.query('BEGIN'); db.getPool = () => isolated; db.query = isolated.query;
    await client.query(fs.readFileSync(path.join(__dirname,'../migrations/028_ng_dhis2_delivery_operations.sql'),'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname,'../migrations/028_ng_dhis2_delivery_operations.sql'),'utf8'));
    const admin = (await client.query("SELECT id,role FROM users WHERE email='admin@demo.doctarx.com' AND is_active=TRUE AND market_scope='NG'")).rows[0];
    const author = (await client.query("SELECT id FROM users WHERE email='doctor@demo.doctarx.com' AND is_active=TRUE AND market_scope='NG'")).rows[0];
    const checker = (await client.query("SELECT id,role FROM users WHERE email='checker@demo.doctarx.com' AND is_active=TRUE")).rows[0];
    assert.ok(admin && author && checker, 'Use existing provisioned demo accounts; no seeds or password changes');
    await client.query('UPDATE users SET mfa_enabled=TRUE WHERE id=$1', [admin.id]);
    const programme = require('../services/public-health/publicHealthProgrammeService');
    const delivery = require('../services/public-health/dhis2DeliveryService');
    const operations = require('../services/public-health/dhis2DeliveryOperationsService');
    const { processDueJobs } = require('../services/public-health/dhis2DeliveryWorkerService');
    const settingsInput = { environment: 'sandbox', baseUrl: 'https://approved-dhis2.example.invalid', username: 'isolated-principal', apiToken: 'isolated-never-live-token',
      datasetId: 'a1234567890', orgUnitId: 'b1234567890', enabled: true, dryRunOnly: false, governmentApprovalStatus: 'approved', apiCredentialsStatus: 'configured',
      dataSharingAgreementStatus: 'approved', ndprReviewStatus: 'approved', apiVersion: '2.43', profileApprovalReference: 'Isolated approved profile', asyncImportEnabled: false };
    await programme.updateSettings(settingsInput, admin.id);
    const indicatorId = crypto.randomUUID();
    await client.query(`INSERT INTO public_health_indicators(id,programme_area,internal_key,display_name,dhis2_data_element_id)
      VALUES($1,'primary_healthcare',$2,'Rollback-only aggregate','c1234567890')`, [indicatorId,'rollback_'+indicatorId]);
    async function newJob({ asyncImport = false } = {}) {
      await programme.updateSettings({ ...settingsInput, asyncImportEnabled: asyncImport }, admin.id);
      const reportId = crypto.randomUUID(); reportIds.push(reportId);
      await client.query(`INSERT INTO public_health_reports(id,report_period,status,generated_by,approved_by,approved_at)
        VALUES($1,'2026-09','approved',$2,$3,NOW())`, [reportId,author.id,admin.id]);
      await client.query('INSERT INTO public_health_report_values(report_id,indicator_id,value) VALUES($1,$2,0)', [reportId,indicatorId]);
      const response = await programme.syncDhis2(reportId,admin.id);
      assert.equal(response.delivery.status,'queued'); assert.equal(response.workerEnabled,true);
      return (await client.query('SELECT * FROM ng_dhis2_delivery_jobs WHERE id=$1',[response.delivery.id])).rows[0];
    }
    async function step(run) { const name='scenario_'+(++serial); await client.query('SAVEPOINT '+name); try { await run(); } finally { failAudit=false; await client.query('ROLLBACK TO SAVEPOINT '+name); await client.query('RELEASE SAVEPOINT '+name); } }
    const matchingBody = () => ({ dataSet:'a1234567890',orgUnit:'b1234567890',period:'202609',
      dataValues:[{dataElement:'c1234567890',orgUnit:'b1234567890',period:'202609',value:'0'}] });
    const matching = () => ({ ok:true,status:200,json:async()=>matchingBody() });
    const summary = () => ({ ok:true,status:200,json:async()=>({status:'SUCCESS',importCount:{imported:1,updated:0,ignored:0}}) });
    await step(async()=>{
      const job=await newJob(); let posts=0;
      const first=await processDueJobs(isolated,{random:()=>0,fetchImpl:async(_url,options)=>{if(options.method==='POST')posts++;return{status:503,ok:false,headers:{get:()=> '120'},json:async()=>({})};}});
      assert.equal(first.pending,1); assert.equal(posts,1);
      const saved=(await client.query('SELECT * FROM ng_dhis2_delivery_jobs WHERE id=$1',[job.id])).rows[0];
      assert.equal(saved.status,'reconciliation'); assert.ok(new Date(saved.next_attempt_at)-Date.now()>118000);
      assert.equal((await processDueJobs(isolated,{fetchImpl:async()=>{throw new Error('Not due');}})).examined,0);
      await client.query('UPDATE ng_dhis2_delivery_jobs SET next_attempt_at=NOW() WHERE id=$1',[job.id]);
      const restarted=await processDueJobs(isolated,{fetchImpl:async(_url,options)=>{assert.notEqual(options.method,'POST');return matching();}});
      assert.equal(restarted.confirmed,1); assert.equal(posts,1);
    });
    await step(async()=>{
      const job=await newJob({asyncImport:true}); const paths=[]; let completed=false;
      const transport=async(value,options)=>{const parsed=new URL(value);paths.push(parsed.pathname);
        if(options.method==='POST'){assert.equal(parsed.searchParams.get('async'),'true');return{status:200,ok:true,json:async()=>({response:{id:'d1234567890',jobType:'DATAVALUE_IMPORT',relativeNotifierEndpoint:'https://foreign.example.invalid/secret'}})};}
        if(parsed.pathname.includes('taskSummaries'))return completed?summary():{status:404,ok:false};
        return matching();};
      assert.equal((await processDueJobs(isolated,{fetchImpl:transport,random:()=>0})).pending,1);
      assert.equal(paths.some(value=>value==='/secret'),false);assert.equal(paths.filter(value=>value==='/api/dataValueSets').length,1,'Pending task cannot be accepted by reading values early');
      const saved=(await client.query('SELECT * FROM ng_dhis2_delivery_jobs WHERE id=$1',[job.id])).rows[0];assert.equal(saved.remote_job_type,'DATAVALUE_IMPORT');
      completed=true;await client.query('UPDATE ng_dhis2_delivery_jobs SET next_attempt_at=NOW() WHERE id=$1',[job.id]);
      assert.equal((await processDueJobs(isolated,{fetchImpl:transport})).confirmed,1);assert.equal(paths.filter(value=>value==='/api/dataValueSets').length,2);
    });
    await step(async()=>{
      const job=await newJob({asyncImport:true});let reads=0;
      const result=await processDueJobs(isolated,{fetchImpl:async(_url,options)=>{if(options.method!=='POST')reads++;return summary();}});
      assert.equal(result.failed,1);assert.equal(reads,0,'An unconfirmed async task cannot claim success by reading values early');
      assert.equal((await client.query('SELECT last_error_code FROM ng_dhis2_delivery_jobs WHERE id=$1',[job.id])).rows[0].last_error_code,'DHIS2_TASK_NOT_CONFIRMED');
    });
    await step(async()=>{
      await newJob({asyncImport:true});let dataReads=0;
      const result=await processDueJobs(isolated,{fetchImpl:async(value,options)=>{
        if(options.method==='POST')return{status:200,ok:true,json:async()=>({response:{id:'d1234567890',jobType:'DATAVALUE_IMPORT'}})};
        if(new URL(value).pathname.includes('taskSummaries'))return summary();
        dataReads++;return{status:200,ok:true,json:async()=>({...matchingBody(),dataValues:[{...matchingBody().dataValues[0],value:'1'}]})};
      }});
      assert.equal(dataReads,1);assert.equal(result.pending,1);assert.equal(result.confirmed,0,'A complete task summary cannot replace matching absolute remote values');
    });
    for(const kind of ['dataset','unit','period','cellUnit','cellPeriod','missingScope'])await step(async()=>{
      const job=await newJob();let posts=0;let reads=0;
      const wrong=matchingBody();
      if(kind==='dataset')wrong.dataSet='e1234567890';
      if(kind==='unit')wrong.orgUnit='e1234567890';
      if(kind==='period')wrong.period='202501';
      if(kind==='cellUnit')wrong.dataValues[0].orgUnit='e1234567890';
      if(kind==='cellPeriod')wrong.dataValues[0].period='202501';
      if(kind==='missingScope')delete wrong.dataSet;
      const result=await processDueJobs(isolated,{fetchImpl:async(value,options)=>{
        if(options.method==='POST'){posts++;return summary();}
        const read=new URL(value);assert.equal(read.searchParams.get('orgUnit'),'b1234567890');assert.equal(read.searchParams.get('period'),'202609');
        reads++;return{status:200,ok:true,json:async()=>wrong};
      }});
      assert.equal(posts,1);assert.equal(reads,1);assert.equal(result.pending,1,kind);assert.equal(result.confirmed,0,kind);
      assert.equal((await client.query('SELECT status FROM public_health_reports WHERE id=$1',[job.report_id])).rows[0].status,'sync_pending',kind);
    });
    await step(async()=>{
      await newJob();let reads=0;
      const result=await processDueJobs(isolated,{fetchImpl:async(_value,options)=>{
        if(options.method==='POST'){await client.query('UPDATE users SET is_active=FALSE WHERE id=$1',[admin.id]);return summary();}
        reads++;return matching();
      }});
      assert.equal(result.failed,1);assert.equal(reads,0,'Current authority is rechecked before the subsequent read, not just before claiming work');
    });
    await step(async()=>{
      const job=await newJob();let release;let started;let posts=0;
      const gate=new Promise(resolve=>{release=resolve;});const entering=new Promise(resolve=>{started=resolve;});
      const first=processDueJobs(isolated,{fetchImpl:async(_value,options)=>{if(options.method==='POST'){posts++;started();await gate;return summary();}return matching();}});first.catch(()=>undefined);
      let timer;
      try{
        await Promise.race([entering,new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Expected retained POST did not start')),5000);})]);
        assert.equal((await processDueJobs(isolated,{fetchImpl:async()=>{throw new Error('Active lease must not send');}})).examined,0);
        await client.query("UPDATE ng_dhis2_delivery_jobs SET lease_until=NOW()-interval '1 second' WHERE id=$1",[job.id]);
        assert.equal((await processDueJobs(isolated,{fetchImpl:async(_value,options)=>{assert.notEqual(options.method,'POST');return matching();}})).confirmed,1);
        release();assert.equal((await first).contended,1);assert.equal(posts,1);
      }finally{clearTimeout(timer);release();await Promise.allSettled([first]);}
    });
    await step(async()=>{
      const job=await newJob();await client.query("UPDATE ng_dhis2_delivery_jobs SET status='submitting',attempts=8,lease_token=$2,lease_until=NOW()-interval '1 second' WHERE id=$1",[job.id,crypto.randomUUID()]);
      let calls=0;assert.equal((await processDueJobs(isolated,{fetchImpl:async()=>{calls++;throw new Error('Exhausted crash recovery requires review');}})).failed,1);assert.equal(calls,0);
      const saved=(await client.query('SELECT status,lease_token,next_attempt_at FROM ng_dhis2_delivery_jobs WHERE id=$1',[job.id])).rows[0];
      assert.deepEqual(saved,{status:'failed',lease_token:null,next_attempt_at:null});
    });
    await step(async()=>{
      const job=await newJob({asyncImport:true});
      await client.query("UPDATE ng_dhis2_delivery_jobs SET status='reconciliation',attempts=1,remote_job_id='d1234567890',remote_job_type='DATAVALUE_IMPORT',poll_deadline_at=NOW()-interval '1 second' WHERE id=$1",[job.id]);
      let calls=0;assert.equal((await processDueJobs(isolated,{fetchImpl:async()=>{calls++;throw new Error('Expired window');}})).failed,1);assert.equal(calls,0);
    });
    for(const kind of ['actor','mfa','approval','payload','retainedPayload','destination','profile'])await step(async()=>{
      const job=await newJob();
      if(kind==='actor')await client.query('UPDATE users SET is_active=FALSE WHERE id=$1',[admin.id]);
      if(kind==='mfa')await client.query('UPDATE users SET mfa_enabled=FALSE WHERE id=$1',[admin.id]);
      if(kind==='approval')await client.query("UPDATE public_health_reports SET approved_at=approved_at+interval '1 second' WHERE id=$1",[job.report_id]);
      if(kind==='payload')await client.query('UPDATE public_health_report_values SET value=1 WHERE report_id=$1',[job.report_id]);
      if(kind==='retainedPayload')await client.query("UPDATE ng_dhis2_delivery_jobs SET payload_json=jsonb_set(payload_json,'{dataValues,0,value}','1'::jsonb) WHERE id=$1",[job.id]);
      if(kind==='destination')await programme.updateSettings({...settingsInput,baseUrl:'https://changed.example.invalid'},admin.id);
      if(kind==='profile')await client.query("UPDATE dhis2_integration_settings SET api_version='unknown'");
      let calls=0;const result=await processDueJobs(isolated,{fetchImpl:async()=>{calls++;throw new Error('No unauthorized call');}});
      assert.equal(calls,0,kind);assert.equal(result.failed,1,kind);
    });
    const rbac=require('../middleware/rbac');const auth=require('../../server/middleware/auth').authenticate;const {issueMfaAttestation}=require('../../server/utils/mfaAttestation');
    const app=express();app.use(require('cookie-parser')());app.use(express.json());app.use('/api/dhis2',auth,rbac.requireGovernmentMfa,require('../routes/dhis2'));
    server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
    async function command(job,body,{key=crypto.randomUUID(),user=admin,mfa=true}={}){const token=jwt.sign({userId:user.id},process.env.JWT_ACCESS_SECRET,{expiresIn:'5m'});const response=await fetch(`http://127.0.0.1:${server.address().port}/api/dhis2/deliveries/${job.id}/commands`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Idempotency-Key':key,...(mfa?{Cookie:'mfaVerified='+issueMfaAttestation(user.id,token)}:{})},body:JSON.stringify(body)});return{status:response.status,body:await response.json()};}
    await step(async()=>{
      const job=await newJob();await client.query("UPDATE ng_dhis2_delivery_jobs SET status='failed',attempts=8,next_attempt_at=NULL WHERE id=$1",[job.id]);
      const body={action:'reconcile',expectedVersion:job.version,reason:'Review retained delivery after outage'};const key=crypto.randomUUID();
      assert.equal((await command(job,body,{mfa:false})).status,403);assert.equal((await command(job,body,{user:checker})).status,404);
      const response=await command(job,body,{key});assert.equal(response.status,200);assert.equal(response.body.delivery.status,'failed');assert.equal(response.body.delivery.operatorRetryBudget,1);
      assert.equal((await command(job,body,{key})).body.replayed,true);
      assert.equal((await command(job,{...body,reason:'Changed operation'},{key})).status,409);
      assert.equal((await command(job,body)).status,409);
      const read=await processDueJobs(isolated,{fetchImpl:async(_url,options)=>{assert.notEqual(options.method,'POST');return matching();}});assert.equal(read.confirmed,1);
      const replay=await command(job,body,{key});assert.equal(replay.body.replayed,true);assert.equal(replay.body.delivery.status,'confirmed');
      assert.equal((await command(job,{action:'close',expectedVersion:replay.body.delivery.version,reason:'Already confirmed'})).status,409);
    });
    await step(async()=>{
      const job=await newJob();const body={action:'close',expectedVersion:job.version,reason:'Close for separately approved correction'};
      failAudit=true;assert.equal((await command(job,body)).status,500);failAudit=false;
      assert.equal((await client.query('SELECT version FROM ng_dhis2_delivery_jobs WHERE id=$1',[job.id])).rows[0].version,job.version);
      assert.equal((await client.query('SELECT count(*)::int AS count FROM ng_dhis2_delivery_commands WHERE job_id=$1',[job.id])).rows[0].count,0);
      const closed=await command(job,body);assert.equal(closed.status,200);assert.equal(closed.body.delivery.resolution.code,'closed_unresolved');
      assert.equal((await processDueJobs(isolated,{fetchImpl:async()=>{throw new Error('Closed jobs never send');}})).examined,0);
    });
    // Direct service uses the same fresh authority, not a route-only check.
    assert.equal(typeof operations.retainedContext,'function');assert.equal(delivery.publicJob({}).remoteTask,null);
  } finally {
    if(server)await new Promise(resolve=>server.close(resolve));
    await client.query('ROLLBACK');assert.equal((await client.query('SELECT count(*)::int AS count FROM public_health_reports WHERE id=ANY($1::uuid[])',[reportIds])).rows[0].count,0);
    db.getPool=oldPool;db.query=oldQuery;client.release();await database.end();
    for(const[key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});
