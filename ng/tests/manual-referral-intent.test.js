'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const service = require('../services/clinical/manualReferralIntentService');
const actor = crypto.randomUUID(), patient = crypto.randomUUID(), key = crypto.randomUUID(), saved = crypto.randomUUID();
function request(body = {}) { return {user:{id:actor,role:'provider'},body:{patient_user_id:patient,reason:'Synthetic referral',...body},headers:{'idempotency-key':key}}; }
function fixture(options = {}) {
  const log = [];
  const client = {release(){},async query(sql,params){
    log.push({sql,params});
    if (sql.includes('SELECT id, role, is_active')) return {rows:[{id:actor,role:'provider',is_active:true,market_scope:'NG',provider_status:'approved',...options.actor},{id:patient,role:'patient',is_active:true,market_scope:'NG',...options.patient}]};
    if (sql.includes('SELECT id,status FROM ng_providers')) return {rows:[{id:actor,status:options.mapping || 'verified'}]};
    if (sql.includes('SELECT id FROM ng_providers')) return {rows:[{id:actor}]};
    if (sql.includes('SELECT id,patient_user_id,provider_user_id')) return {rows:options.encounter ? [options.encounter] : []};
    if (sql.includes('FROM ng_appointments') || sql.includes('FROM provider_patient_relationships') || sql.includes('SELECT id FROM ng_clinical_encounters')) return {rows:options.revoked ? [] : [{id:actor}]};
    if (sql.includes('INSERT INTO ng_referrals')) return {rows:options.conflict ? [] : [{id:saved,status:options.status || 'draft'}]};
    if (sql.includes('SELECT id,patient_user_id,encounter_id FROM ng_referrals')) return {rows:options.absent ? [] : [{id:saved,patient_user_id:patient,encounter_id:null}]};
    if (sql.includes('SELECT id,status FROM ng_referrals')) return {rows:[{id:saved,status:options.status || 'draft'}]};
    if (sql.includes('INSERT INTO ng_audit_lineage') && options.failAudit) throw new Error('Synthetic audit outage');
    return {rows:[]};
  }};
  return {log,pool:{connect:async()=>client}};
}
test('manual canonical create normalizes null/default values without copying mutable status or summaries',()=>{
  const input = service.canonicalInput(request({target_name:'  ',clinical_notes:'',status:'completed',response_summary:'ignored'}).body);
  assert.equal(input.target_name,null); assert.equal(input.clinical_notes,null); assert.equal(input.referral_type,'specialist');
  assert.equal(input.status,undefined); assert.equal(input.response_summary,undefined);
  assert.equal(service.requestKey(key.toUpperCase()),key);
});
test('invalid canonical request is certified before any database write',async()=>{
  const pool={connect(){throw Error('must not connect');}};
  for (const body of [{reason:''},{patient_user_id:'wrong'},{reason:{}},{priority:'unknown'}]) {
    await assert.rejects(service.save(pool,request(body)),e=>e.statusCode===400 && e.submissionNotStarted===true);
  }
});
test('same request preserves current status, compares every original field and uses actor-bound unique identity',async()=>{
  const f=fixture({status:'completed'});
  assert.deepEqual(await service.save(f.pool,request()),{id:saved,status:'completed'});
  const insert=f.log.find(x=>x.sql.includes('INSERT INTO ng_referrals'));
  assert.match(insert.sql,/ON CONFLICT \(provider_user_id,manual_request_key\)/);
  assert.match(insert.sql,/ng_referrals.reason IS NOT DISTINCT FROM EXCLUDED.reason/);
  assert.ok(!insert.sql.includes('SET status'));
  assert.deepEqual(insert.params.slice(-2),[actor,key]);
  assert.ok(f.log.findIndex(x=>x.sql.includes('FROM users')) < f.log.findIndex(x=>x.sql.includes('INSERT INTO ng_referrals')));
  const audit=f.log.find(x=>x.sql.includes('INSERT INTO ng_audit_lineage'));
  assert.ok(!JSON.stringify(audit.params).includes('Synthetic referral'));
  assert.equal(f.log.at(-1).sql,'COMMIT');
});
test('changed request details conflict and audit failure roll back without certified no-write flag',async()=>{
  for(const opts of [{conflict:true},{failAudit:true}]) {
    const f=fixture(opts);
    await assert.rejects(service.save(f.pool,request()),e=>!e.submissionNotStarted && (e.statusCode===409 || /audit/.test(e.message)));
    assert.equal(f.log.at(-1).sql,'ROLLBACK');
  }
});
test('fresh account approval, market, clinician mapping and current relationship fail closed',async()=>{
  for(const options of [{actor:{is_active:false}},{actor:{role:'patient'}},{actor:{provider_status:'pending'}},{actor:{market_scope:'US'}},{patient:{is_active:false}},{patient:{role:'provider'}},{mapping:'suspended'},{revoked:true}]) {
    const f=fixture(options); await assert.rejects(service.save(f.pool,request()),e=>e.statusCode===403);
    assert.ok(!f.log.some(x=>x.sql.includes('INSERT INTO ng_referrals')));
  }
});
test('explicit encounter cannot use a different patient or clinician relationship',async()=>{
  for(const encounter of [null,{id:key,patient_user_id:actor,provider_user_id:actor},{id:key,patient_user_id:patient,provider_user_id:patient}]) {
    const f=fixture({encounter}); await assert.rejects(service.save(f.pool,request({encounter_id:key})),e=>e.statusCode===403);
  }
});
test('receipt is actor-bound metadata only and audits before return',async()=>{
  const f=fixture({status:'accepted'});
  assert.deepEqual(await service.receipt(f.pool,request(),key),{id:saved,status:'accepted'});
  const lookup=f.log.find(x=>x.sql.includes('FROM ng_referrals'));
  assert.deepEqual(lookup.params,[actor,key]); assert.ok(!lookup.sql.includes('reason'));
  assert.equal(f.log.at(-1).sql,'COMMIT');
  for(const options of [{absent:true},{revoked:true},{failAudit:true}]) {
    const bad=fixture(options); await assert.rejects(service.receipt(bad.pool,request(),key));
    assert.equal(bad.log.at(-1).sql,'ROLLBACK');
  }
});
test('actual HTTP handlers expose minimal no-store receipt and certified validation failure',async()=>{
  const Module = require('node:module');
  const file=require.resolve('../routes/clinical');
  const original=Module._load; const f=fixture(); let router;
  try {
    Module._load=function(name,parent){if(parent?.filename===file && name==='../../server/db')return {getPool:()=>f.pool};return original.apply(this,arguments);};
    delete require.cache[file]; router=require(file);
  } finally {Module._load=original;delete require.cache[file];}
  const response=()=>({statusCode:200,headers:{},set(k,v){this.headers[k]=v;return this;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;}});
  const read=router.stack.find(x=>x.route?.path==='/referrals/requests/:requestId').route.stack.at(-1).handle;
  const res=response(); await read({...request(),params:{requestId:key}},res);
  assert.equal(res.headers['Cache-Control'],'no-store');assert.deepEqual(res.body,{ok:true,referral:{id:saved,status:'draft'}});
  const create=router.stack.find(x=>x.route?.path==='/referrals' && x.route.methods.post).route.stack.at(-1).handle;
  const invalid=response();await create(request({reason:''}),invalid);
  assert.equal(invalid.statusCode,400);assert.equal(invalid.body.submissionNotStarted,true);
});
