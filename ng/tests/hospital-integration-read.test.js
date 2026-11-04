'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const service=require('../services/hospitalIntegrationReadService');
const actor=crypto.randomUUID(),hospital=crypto.randomUUID(),other=crypto.randomUUID();
function fixture(options={}){
 const calls=[];const client={release(){},async query(sql,params){calls.push({sql,params});
  if(sql.includes('SELECT id, role, market_scope, is_active'))return {rows:[{id:actor,role:options.role||'hospital',market_scope:options.market||'NG',is_active:options.active!==false}]};
  if(sql.includes('SELECT id,owner_user_id FROM ng_hospitals'))return {rows:options.missing?[]:[{id:hospital,owner_user_id:options.owner===undefined?actor:options.owner}]};
  if(sql.includes('SELECT id, role, market_scope FROM users'))return {rows:[{id:options.owner||actor,market_scope:options.ownerMarket||'NG'}]};
  if(sql.includes('FROM ng_hospital_staff'))return {rows:options.staff?[{id:other}]:[]};
  if(sql.includes('FROM ng_hospital_integrations'))return {rows:[{id:other,integration_type:'lab_systems',status:'active',last_test_at:'2026-01-01',last_sync_at:'2026-01-01',endpoint_url:'https://private.invalid?token=secret',last_error:'private clinical narrative',admin_notes:'private notes',capabilities:['automatic alerts']}]};
  if(sql.includes('UPDATE ng_hospital_staff'))return {rows:[{id:other}]};
  if(sql.includes('INSERT INTO ng_audit_lineage')&&options.auditFailure)throw Error('Sensitive database detail');
  return {rows:[]};}};return {calls,pool:{connect:async()=>client}};
}
const req={user:{id:actor,role:'admin'}};
test('hospital integration status requires current NG owner, administrator or active linked staff',async()=>{
 for(const options of [{},{owner:other,role:'admin'},{owner:other,staff:true}]){const f=fixture(options);assert.equal((await service.readIntegrations(f.pool,req,hospital)).length,1);assert.equal(f.calls.at(-1).sql,'COMMIT');}
 for(const options of [{owner:other},{owner:other,role:'patient'},{active:false},{market:'US'},{ownerMarket:'US'},{missing:true}]){const f=fixture(options);await assert.rejects(service.readIntegrations(f.pool,req,hospital));assert.ok(!f.calls.some(x=>x.sql.includes('FROM ng_hospital_integrations')));assert.equal(f.calls.at(-1).sql,'ROLLBACK');}
});
test('integration read minimizes metadata, blocks false lab activation and fails closed on audit error',async()=>{
 const f=fixture();const rows=await service.readIntegrations(f.pool,req,hospital);assert.equal(rows[0].status,'unavailable');assert.equal(rows[0].last_sync_at,null);assert.match(rows[0].unavailable_reason,/not implemented/);
 const json=JSON.stringify(rows);for(const value of ['private.invalid','secret','private clinical','private notes','automatic alerts'])assert.ok(!json.includes(value));
 const query=f.calls.find(x=>x.sql.includes('FROM ng_hospital_integrations'));assert.doesNotMatch(query.sql,/SELECT \*|endpoint_url|admin_notes|last_error/);
 const audit=f.calls.find(x=>x.sql.includes('INSERT INTO ng_audit_lineage'));assert.equal(audit.params[1],'view');assert.equal(audit.params[6],JSON.stringify({recordCount:1}));
 const broken=fixture({auditFailure:true});await assert.rejects(service.readIntegrations(broken.pool,req,hospital));assert.equal(broken.calls.at(-1).sql,'ROLLBACK');
});
test('persisted lab flags cannot activate unavailable runtime workflow and unrelated flags retain status',()=>{
 for(const status of ['active','sandbox','pending','unavailable'])assert.equal(service.featureMetadata({feature_key:'ng_lab_orders',status}).status,'unavailable');
 assert.deepEqual(service.featureMetadata({feature_key:'other',status:'active'}),{feature_key:'other',status:'active'});
 assert.equal(service.integrationMetadata({id:other,integration_type:'other',status:'active'}).status,'active');
});
test('actual integration HTTP route sends no-store and hides database error details',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
 const file=require.resolve('../routes/hospital'),actual=createRequire(file),handlers=new Map(),router={};for(const method of ['get','post','put','patch','delete','use'])router[method]=(path,...chain)=>handlers.set(`${method} ${path}`,chain.at(-1));
 let pool=fixture().pool;const sandboxModule={exports:{}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module:sandboxModule,exports:sandboxModule.exports,console,process,require(name){if(name==='express')return {Router:()=>router};if(name==='../../server/db')return {getPool:()=>pool};if(name==='../../server/middleware/auth')return {authenticate(){},requireRole:()=>()=>{}};return actual(name);}},{filename:file});
 const response=()=>({headers:{},statusCode:200,set(k,v){this.headers[k]=v;return this;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;}});
 const call=async()=>{const res=response();await handlers.get('get /:hospitalId/integrations')({...req,params:{hospitalId:hospital}},res);return res;};
 const success=await call();assert.equal(success.headers['Cache-Control'],'private, no-store');assert.equal(success.body.integrations[0].status,'unavailable');
 pool=fixture({auditFailure:true}).pool;const failed=await call();assert.equal(failed.statusCode,503);assert.ok(!JSON.stringify(failed.body).includes('Sensitive'));
});

test('linked staff cannot reactivate themselves; only current owner/admin may change membership with atomic audit',async()=>{
 for(const options of [{owner:other,staff:true},{owner:other,role:'patient'},{active:false},{market:'US'}]){
  const f=fixture(options);await assert.rejects(service.updateStaff(f.pool,{...req,body:{status:'active'}},hospital,other));
  assert.ok(!f.calls.some(x=>x.sql.includes('UPDATE ng_hospital_staff')));
 }
 for(const options of [{},{owner:other,role:'admin'}]){
  const f=fixture(options);await service.updateStaff(f.pool,{...req,body:{status:'active',designation:'Private designation'}},hospital,other);
  const audit=f.calls.find(x=>x.sql.includes('INSERT INTO ng_audit_lineage'));assert.equal(audit.params[1],'modify');
  assert.ok(!JSON.stringify(audit.params).includes('Private designation'));assert.equal(f.calls.at(-1).sql,'COMMIT');
 }
 const broken=fixture({auditFailure:true});await assert.rejects(service.updateStaff(broken.pool,{...req,body:{status:'active'}},hospital,other));assert.equal(broken.calls.at(-1).sql,'ROLLBACK');
});
const target=process.env.SIMULATION_DATABASE_URL;
test('PostgreSQL hospital integration membership and metadata boundaries cannot be bypassed by staff reactivation', {skip:!target},async()=>{
 const url=new URL(target);assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.pathname.endsWith('_test'));
 const {Pool}=require('pg');const pool=new Pool({connectionString:target}),client=await pool.connect();
 try{
  await client.query('BEGIN');
  const owner=(await client.query("SELECT id FROM users WHERE email='doctor@demo.doctarx.com' AND is_active=TRUE AND market_scope='NG'")).rows[0];
  const member=(await client.query("SELECT id FROM users WHERE email='patient@demo.doctarx.com' AND is_active=TRUE AND market_scope='NG'")).rows[0];
  const admin=(await client.query("SELECT id FROM users WHERE role='admin' AND is_active=TRUE AND market_scope='NG' ORDER BY id LIMIT 1")).rows[0];
  assert.ok(owner&&member&&admin,'Existing isolated demo accounts required');
  const hospitalId=crypto.randomUUID(),staffId=crypto.randomUUID(),integrationId=crypto.randomUUID();
  await client.query("INSERT INTO ng_hospitals(id,name,slug,facility_type,owner_user_id,contact_name,contact_email,contact_phone,address_line1,city,state) VALUES($1::uuid,'Synthetic',$3::text,'clinic',$2::uuid,'Synthetic','fixture@example.invalid','000','Synthetic','Synthetic','Synthetic')",[hospitalId,owner.id,`synthetic-${hospitalId}`]);
  await client.query("INSERT INTO ng_hospital_staff(id,hospital_id,user_id,full_name,role,status) VALUES($1,$2,$3,'Synthetic','other','inactive')",[staffId,hospitalId,member.id]);
  await client.query("INSERT INTO ng_hospital_integrations(id,hospital_id,integration_type,status,endpoint_url,last_error,admin_notes) VALUES($1,$2,'lab_systems','active','https://private.invalid?token=synthetic','Synthetic private error','Synthetic private notes')",[integrationId,hospitalId]);
  const wrapped={connect:async()=>({release(){},query:(sql,params)=>['BEGIN','COMMIT','ROLLBACK'].includes(sql)?Promise.resolve({rows:[]}):client.query(sql,params)})};
  const request=id=>({user:{id,role:'super_admin'},body:{status:'active'}});
  const expectDenied=error=>error.status===404;
  await assert.rejects(service.readIntegrations(wrapped,request(member.id),hospitalId),expectDenied);
  await assert.rejects(service.updateStaff(wrapped,request(member.id),hospitalId,staffId),expectDenied);
  assert.equal((await client.query('SELECT status FROM ng_hospital_staff WHERE id=$1',[staffId])).rows[0].status,'inactive');
  await service.updateStaff(wrapped,request(owner.id),hospitalId,staffId);
  for(const user of [owner,member,admin]){
   const rows=await service.readIntegrations(wrapped,request(user.id),hospitalId);
   assert.equal(rows[0].status,'unavailable');assert.ok(!JSON.stringify(rows).includes('private.invalid'));assert.ok(!JSON.stringify(rows).includes('Synthetic private'));
  }
  await service.updateStaff(wrapped,{...request(owner.id),body:{status:'inactive'}},hospitalId,staffId);
  await assert.rejects(service.readIntegrations(wrapped,request(member.id),hospitalId),expectDenied);
  const audits=(await client.query("SELECT action,metadata_json FROM ng_audit_lineage WHERE resource_id=ANY($1::uuid[])",[[hospitalId,staffId]])).rows;
  assert.ok(audits.some(x=>x.action==='modify')&&audits.some(x=>x.action==='view'));
  assert.ok(!JSON.stringify(audits).includes('Synthetic private'));
 }finally{await client.query('ROLLBACK');client.release();await pool.end();}
});
