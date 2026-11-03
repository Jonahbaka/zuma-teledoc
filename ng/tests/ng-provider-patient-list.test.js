'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {listNgProviderPatients}=require('../../server/services/ngProviderPatientList');
test('Nigeria patient listing uses one consistent scoped patient set for counts and pages',async()=>{
  const queries=[];const db={query:async(sql,params)=>{queries.push({sql,params});return {rows:sql.includes('SELECT COUNT(*) AS count')?[{count:'2'}]:[{id:'patient',total_appointments:'3'}]};}};
  const result=await listNgProviderPatients(db,'actor',{limit:10,offset:20});
  assert.equal(result.total,2);assert.equal(result.rows.length,1);
  for(const {sql}of queries){
    assert.match(sql,/FROM appointments a JOIN clinician c ON c.user_id=a.provider_id/);
    assert.match(sql,/FROM ng_appointments a JOIN clinician c ON c.provider_id=a.provider_id/);
    assert.match(sql,/p.user_id=u.id/);assert.match(sql,/p.status='verified'/);assert.match(sql,/u.provider_status='approved'/);
    assert.match(sql,/p.role='patient' AND p.is_active=TRUE AND p.market_scope='NG'/);
    assert.match(sql,/GROUP BY p.id/);assert.doesNotMatch(sql,/reason|clinical_notes/);
  }
  assert.deepEqual(queries[0].params,['actor']);assert.deepEqual(queries[1].params,['actor',10,20]);
  assert.equal(queries[0].sql.split(') SELECT')[0],queries[1].sql.split(') SELECT')[0]);
});
test('actual provider route selects native NG list only for authenticated Nigeria context',async()=>{
  const fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
  const file=require.resolve('../../server/routes/providers'),actual=createRequire(file),handlers=new Map();
  const router={};for(const method of ['get','post','put','patch','delete','use'])router[method]=(path,...chain)=>handlers.set(`${method} ${path}`,chain.at(-1));
  const queries=[];let market='NG';
  const db={query:async(sql)=>{queries.push(sql);return {rows:/COUNT/.test(sql)?[{count:'0'}]:[]};}};
  const sandboxModule={exports:{}};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{module:sandboxModule,exports:sandboxModule.exports,console,process,require(name){
    if(name==='express')return {Router:()=>router};if(name==='../db')return db;
    if(name==='../middleware/auth')return {authenticate(){},requireRole:()=>()=>{}};
    if(name==='../middleware/audit')return {auditMiddleware:()=>()=>{}};
    if(name==='../middleware/logger')return {error(){}};
    if(name==='../../lib/validation')return {validate:()=>({}),paginationSchema:{}};
    if(name==='../../lib/utils')return {parseQueryParams:()=>({page:1,limit:20}),getPaginationMeta:()=>({}),keysToCamel:x=>x};
    return actual(name);
  }},{filename:file});
  const call=async()=>{const res={json(body){this.body=body;return this;},status(){return this;}};await handlers.get('get /me/patients')({user:{id:'actor',marketScope:market},query:{}},res);assert.equal(res.body.success,true);};
  await call();assert.ok(queries.every(sql=>sql.includes('ng_appointments')));
  queries.length=0;market='US';await call();assert.ok(queries.every(sql=>!sql.includes('ng_appointments')));
});
const target=process.env.SIMULATION_DATABASE_URL;
test('PostgreSQL NG-only provider patients are visible once, scoped before count and pagination', {skip:!target},async()=>{
  const url=new URL(target);assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.pathname.endsWith('_test'));
  const {Pool}=require('pg');const pool=new Pool({connectionString:target});const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const provider=(await client.query("SELECT u.id,p.id AS mapping FROM users u JOIN ng_providers p ON p.user_id=u.id WHERE u.email='doctor@demo.doctarx.com' AND u.is_active=TRUE AND u.market_scope='NG' AND u.provider_status='approved' AND p.status='verified'")).rows[0];
    const other=(await client.query("SELECT p.id FROM ng_providers p WHERE p.user_id<>$1 ORDER BY p.id LIMIT 1",[provider?.id])).rows[0];
    assert.ok(provider&&other,'Existing isolated clinician fixtures are required');
    const baseline=await listNgProviderPatients(client,provider.id,{limit:1000,offset:0});
    const ids=Array.from({length:6},()=>crypto.randomUUID());
    for(let i=0;i<ids.length;i++) await client.query("INSERT INTO users(id,email,password_hash,role,first_name,last_name,is_active,is_test_account,market_scope) VALUES($1,$2,'!synthetic-no-login','patient','Synthetic','Picker',$3,TRUE,$4)",[ids[i],`picker-${ids[i]}@example.invalid`,i!==5,i===4?'US':'NG']);
    for(const i of [0,2,3,4,5]) await client.query("INSERT INTO ng_appointments(id,patient_user_id,provider_id,scheduled_at,status,consult_fee,total_amount) VALUES($1,$2,$3,'2099-06-15T12:00:00Z','confirmed',0,0)",[crypto.randomUUID(),ids[i],i===3?other.id:provider.mapping]);
    for(const i of [1,2]) await client.query("INSERT INTO appointments(id,patient_id,provider_id,scheduled_at,type,status) VALUES($1,$2,$3,'2099-06-15T12:00:00Z','video','scheduled')",[crypto.randomUUID(),ids[i],provider.id]);
    const result=await listNgProviderPatients(client,provider.id,{limit:1000,offset:0});
    assert.equal(result.total,baseline.total+3);
    assert.deepEqual(result.rows.filter(x=>ids.includes(x.id)).map(x=>x.id).sort(),ids.slice(0,3).sort());
    for(const [i,count]of [[0,1],[1,1],[2,2]])assert.equal(Number(result.rows.find(x=>x.id===ids[i]).total_appointments),count);
    assert.equal((await client.query('SELECT COUNT(*) FROM appointments WHERE patient_id=$1',[ids[0]])).rows[0].count,'0','The native-only patient has no core appointment');
    const page=await listNgProviderPatients(client,provider.id,{limit:1,offset:1});assert.equal(page.total,result.total);assert.deepEqual(page.rows,[result.rows[1]]);
    for(const sql of ["UPDATE users SET is_active=FALSE WHERE id=$1","UPDATE users SET market_scope='US' WHERE id=$1","UPDATE users SET provider_status='pending' WHERE id=$1"]){await client.query('SAVEPOINT revoke');await client.query(sql,[provider.id]);assert.equal((await listNgProviderPatients(client,provider.id,{limit:20,offset:0})).total,0);await client.query('ROLLBACK TO SAVEPOINT revoke');}
    await client.query("UPDATE ng_providers SET status='suspended' WHERE id=$1",[provider.mapping]);assert.equal((await listNgProviderPatients(client,provider.id,{limit:20,offset:0})).total,0);
  } finally {await client.query('ROLLBACK');client.release();await pool.end();}
});
