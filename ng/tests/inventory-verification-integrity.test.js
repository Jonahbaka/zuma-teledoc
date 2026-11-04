'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const service=require('../services/pharmacy/inventoryVerificationService');
const ids={actor:'00000000-0000-4000-8000-000000000001',inventory:'00000000-0000-4000-8000-000000000002'};
const actor={id:ids.actor,role:'super_admin'};
function fixture(){
  const state={account:{id:ids.actor,role:'super_admin',is_active:true,account_status:'active'},row:{id:ids.inventory,availability_verification_status:'unverified',availability_verified_at:null,availability_verified_by:null,quantity_available:7,selling_price:'10.00'},audits:[],calls:[],connections:0,released:false,auditFails:false};let saved;
  const client={release(){state.released=true;},async query(sql,values=[]){
    state.calls.push({sql,values});
    if(sql==='BEGIN'){saved=structuredClone({row:state.row,audits:state.audits});return{rows:[]};}
    if(sql==='ROLLBACK'){Object.assign(state,saved);return{rows:[]};}if(sql==='COMMIT')return{rows:[]};
    if(sql.includes('FROM users')){assert.match(sql,/role='super_admin'.*is_active=TRUE.*account_status='active' FOR SHARE/);const a=state.account;return{rows:a&&a.id===values[0]&&a.role==='super_admin'&&a.is_active&&a.account_status==='active'?[{id:a.id}]:[]};}
    if(sql.startsWith('SELECT id,availability_verification_status')){assert.match(sql,/FOR UPDATE/);return{rows:state.row&&state.row.id===values[0]?[{...state.row}]:[]};}
    if(sql.startsWith('UPDATE ng_pharmacy_inventory')){Object.assign(state.row,{availability_verification_status:values[1],availability_verified_at:values[2]?'synthetic-timestamp':null,availability_verified_by:values[2]?values[3]:null,availability_source:values[4],availability_notes:values[5]});return{rows:[{...state.row}]};}
    if(sql.includes('INSERT INTO ng_medication_source_audit_log')){if(state.auditFails)throw new Error('Private inventory SQL audit failure');state.audits.push(values);return{rows:[]};}
    throw new Error('Unexpected inventory query: '+sql);
  }};
  return{state,pool:{async connect(){state.connections++;return client;}}};
}
test('explicit bounded verification input rejects before database access and cannot inject actor or inventory state',async()=>{
  for(const input of [{},{verified:'true'},{verified:null},{verified:true,quantityAvailable:900},{verified:true,actorUserId:ids.actor},{verified:true,availabilitySource:'x'.repeat(251)},{verified:true,availabilityNotes:'x'.repeat(4001)},{verified:true,availabilityNotes:'bad\u0000note'}]){
    const f=fixture();await assert.rejects(service.update(f.pool,actor,ids.inventory,input),error=>error.status===400);assert.equal(f.state.connections,0);
  }
  const f=fixture();await assert.rejects(service.update(f.pool,actor,'invalid',{verified:true}),error=>error.status===400);await assert.rejects(service.update(f.pool,{id:'invalid'},ids.inventory,{verified:true}),error=>error.status===403);assert.equal(f.state.connections,0);
});
test('current super-admin authority is locked before the inventory and stale privileges cannot mutate or audit',async()=>{
  for(const patch of [{role:'admin'},{is_active:false},{account_status:'suspended'}]){
    const f=fixture();Object.assign(f.state.account,patch);await assert.rejects(service.update(f.pool,actor,ids.inventory,{verified:true}),error=>error.status===403);
    assert.equal(f.state.calls.some(({sql})=>sql.includes('ng_pharmacy_inventory')||sql.includes('ng_medication_source_audit_log')),false);assert.equal(f.state.calls.at(-1).sql,'ROLLBACK');assert.equal(f.state.released,true);
  }
  const f=fixture();f.state.row=null;await assert.rejects(service.update(f.pool,actor,ids.inventory,{verified:true}),error=>error.status===404);assert.equal(f.state.audits.length,0);
});
test('verification and removal preserve unrelated stock and commit required same-client prior-status audit',async()=>{
  const f=fixture();const verified=await service.update(f.pool,actor,ids.inventory,{verified:true,availabilitySource:' explicit confirmation ',availabilityNotes:' Synthetic evidence '});
  assert.equal(verified.inventory.availability_verification_status,'verified');assert.equal(verified.inventory.availability_verified_by,ids.actor);assert.equal(verified.inventory.quantity_available,7);assert.equal(verified.inventory.selling_price,'10.00');
  assert.equal(f.state.audits[0][2],'unverified');assert.equal(f.state.audits[0][3],'verified');assert.deepEqual(JSON.parse(f.state.audits[0][4]),{availabilitySource:'explicit confirmation',availabilityNotes:'Synthetic evidence'});assert.equal(f.state.calls.at(-1).sql,'COMMIT');
  const removed=await service.update(f.pool,actor,ids.inventory,{verified:false});assert.equal(removed.inventory.availability_verified_at,null);assert.equal(removed.inventory.availability_verified_by,null);assert.equal(f.state.audits[1][2],'verified');assert.equal(f.state.audits[1][3],'unverified');assert.equal(f.state.calls.at(-1).sql,'COMMIT');
});
test('an audit failure rolls back verification and exposes no SQL or private notes',async()=>{
  const f=fixture();f.state.auditFails=true;const before=structuredClone(f.state.row);
  await assert.rejects(service.update(f.pool,actor,ids.inventory,{verified:true}),/Private inventory SQL/);assert.deepEqual(f.state.row,before);assert.equal(f.state.audits.length,0);assert.equal(f.state.calls.at(-1).sql,'ROLLBACK');assert.equal(f.state.released,true);
  const result={};service.sendError({status(value){result.status=value;return this;},json(body){result.body=body;}},new Error('Private inventory SQL and notes'));assert.equal(result.status,503);assert.doesNotMatch(JSON.stringify(result.body),/SQL|notes/);
});
test('registered admin route preserves super-admin middleware, service-owned actor and safe private error responses',async()=>{
  const f=fixture();const routes=new Map();const requireSuperAdmin=()=>{};
  const router={use(){},get(){},post(){},delete(){},patch(route,...handlers){routes.set(route,handlers);}};
  const loaded={exports:{}};vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../routes/admin.js'),'utf8'),{module:loaded,exports:loaded.exports,require(name){
    if(name==='express')return{Router:()=>router};if(name==='../../server/db')return{getPool:()=>f.pool};if(name==='../../server/middleware/auth')return{requireSuperAdmin};if(name==='../services/pharmacy/inventoryVerificationService')return service;return{};
  }});
  const handlers=routes.get('/pharmacy-inventory/:inventoryId/availability-verification');assert.equal(handlers[0],requireSuperAdmin);const result={headers:{}};const res={set(k,v){result.headers[k]=v;return this;},status(v){result.status=v;return this;},json(v){result.body=v;return this;}};
  f.state.auditFails=true;await handlers.at(-1)({params:{inventoryId:ids.inventory},user:actor,body:{verified:true}},res);assert.equal(result.status,503);assert.equal(result.headers['Cache-Control'],'private, no-store');assert.equal(f.state.row.availability_verification_status,'unverified');assert.doesNotMatch(JSON.stringify(result.body),/SQL/);
});
