'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const user = '00000000-0000-4000-8000-000000000001', record = '00000000-0000-4000-8000-000000000002';
function fixture(fail = false) {
  const state={writes:[],logs:[]};const mod={exports:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../middleware/audit'),'utf8'),{module:mod,exports:mod.exports,require(name){
    if(name==='../db')return{query:async(sql,args)=>{state.writes.push(args);if(fail)throw Object.assign(new Error('SENSITIVE SQL ROW clinical narrative'),{code:'23505'});return{rows:[]};}};
    if(name==='./logger')return{error:(...args)=>state.logs.push(args),audit:(...args)=>state.logs.push(args)};throw Error(name);
  }});
  const req={user:{id:user,role:'patient'},params:{id:record},body:{providerNotes:'SENSITIVE NARRATIVE',cancellationReason:'SENSITIVE REASON',patientId:'00000000-0000-4000-8000-000000000099',password:'SENSITIVE PASSWORD'},ip:'127.0.0.1',get:()=> 'Synthetic audit test'};
  const res={statusCode:200,locals:{oldValues:{patientNotes:'SENSITIVE OLD'},patientId:user},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
  return{state,api:mod.exports,req,res};
}
test('metadata-only appointment audit records identities and declared change names, not narratives or attacker patient ID',async()=>{
  const f=fixture();await f.api.auditMiddleware('update','appointment',{metadataOnly:true,changedFields:['status','providerNotes','cancellationReason']})(f.req,f.res,()=>{});
  await f.res.json({success:true,appointment:{id:record}});
  const args=f.state.writes[0];assert.equal(args[7],null);assert.deepEqual(JSON.parse(args[8]),{changedFields:['providerNotes','cancellationReason']});assert.equal(args[10],user);
  assert.ok(!JSON.stringify(f.state).includes('SENSITIVE'));assert.ok(!JSON.stringify(f.state).includes('00000000-0000-4000-8000-000000000099'));
});
test('audited read includes only returned record identities and blocks disclosure when audit persistence fails',async()=>{
  for(const fail of [false,true]){
    const f=fixture(fail);await f.api.auditMiddleware('read','appointment',{metadataOnly:true,phiAccessed:true,requireSuccess:true})(f.req,f.res,()=>{});
    await f.res.json({success:true,appointments:[{id:record,patientId:user,providerNotes:'SENSITIVE NARRATIVE'}]});
    assert.deepEqual(JSON.parse(f.state.writes[0][8]),{recordCount:1,records:[{id:record,patientId:user}]});
    assert.equal(f.state.writes[0][9],true);
    if(fail){assert.equal(f.res.statusCode,503);assert.equal(f.res.body.code,'AUDIT_UNAVAILABLE');assert.equal(f.res.body.appointments,undefined);}
    else assert.equal(f.res.body.appointments.length,1);
    assert.ok(!JSON.stringify(f.state.logs).includes('SENSITIVE'));
  }
});
test('generic audit failure logger never duplicates raw auditData or database row error',async()=>{
  const f=fixture(true);assert.equal(await f.api.logAuditEvent({userId:user,action:'update',newValues:{notes:'SENSITIVE CLINICAL NOTE'}}),false);
  assert.ok(!JSON.stringify(f.state.logs).includes('SENSITIVE'));assert.ok(JSON.stringify(f.state.logs).includes('AUDIT_WRITE_FAILED'));
});
