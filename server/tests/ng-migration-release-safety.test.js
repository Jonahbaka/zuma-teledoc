'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {runNgMigrations,NG_LOCK_KEY}=require('../../ng/migrations/migrate');
test('NG schema runner uses one connection and advisory lock for schema and tracking',async()=>{
 const calls=[];
 const client={async query(sql,args=[]){
  calls.push({sql,args});
  if(sql.includes('SELECT filename, checksum FROM ng_migrations'))return {rows:[]};
  return {rows:[]};
 },release(){calls.push({sql:'RELEASE'});}};
 const pool={connect:async()=>client};
 const result=await runNgMigrations(pool);
 assert.ok(result.total>0);
 const all=calls.map(x=>x.sql);
 assert.ok(all.some(x=>x.includes('pg_advisory_lock')));
 assert.ok(all.some(x=>x.includes('pg_advisory_unlock')));
 assert.ok(all.some(x=>x.includes('INSERT INTO ng_migrations')));
 assert.equal(all.at(-1),'RELEASE');
 assert.equal(all.filter(x=>x==='BEGIN').length,all.filter(x=>x==='COMMIT').length);
 assert.equal(all.filter(x=>x==='ROLLBACK').length,0);
 assert.equal(NG_LOCK_KEY,'doctarx_ng_migrations_v1');
});
test('failed schema migration rolls back and always releases connection and advisory lock',async()=>{
 const calls=[];
 const client={async query(sql){
  calls.push(sql);
  if(sql.includes('SELECT filename, checksum FROM ng_migrations')) return {rows:[]};
  if(sql.includes('CREATE EXTENSION') || sql.includes('CREATE TABLE IF NOT EXISTS ng_drug_catalog'))throw Object.assign(new Error('synthetic schema failure'),{code:'SIMULATED'});
  return {rows:[]};
 },release(){calls.push('RELEASE');}};
 const pool={connect:async()=>client};
 await assert.rejects(runNgMigrations(pool),/synthetic schema failure/);
 assert.ok(calls.includes('ROLLBACK'));
 assert.ok(calls.some(x=>x.includes('pg_advisory_unlock')));
 assert.equal(calls.at(-1),'RELEASE');
});
