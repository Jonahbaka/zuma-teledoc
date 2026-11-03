'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const filename = require.resolve('../routes/appointments');
const actual = createRequire(filename);
function fixture(overrides = {}) {
  const handlers = new Map(), router = {}, audits = [];
  for (const method of ['get','post','put','patch','delete','use']) router[method] = (path,...chain) => handlers.set(`${method} ${path}`,chain.at(-1));
  const row = { status:'scheduled', id:'synthetic-appointment',patient_id:'synthetic-patient',provider_id:'synthetic-provider',patient_market_scope:'NG',provider_market_scope:'NG',reason_for_visit:'Synthetic narrative',patient_notes:'Private patient note',provider_notes:'Private provider note',metadata:{triage:'Private triage'},patient_email:'private@example.invalid',room_id:'private-room',...overrides };
  let reads = 0;
  const deps = { express:{Router:()=>router},'../db':{query:async sql=>{
    reads++;
    if(sql.includes('COUNT(*)'))return {rows:[{count:1}]};
    if(sql.includes('AS patient_market_scope')) {assert.match(sql,/AS provider_market_scope/);assert.match(sql,/COALESCE\(p.market_scope/);assert.match(sql,/COALESCE\(pr.market_scope/);}
    if(sql.includes('xmin'))return {rows:[{...row,reservation_revision:'1'}]};
    return {rows:[row]};
  }},'../middleware/auth':{authenticate(){},requireRole:()=>()=>{}},'../middleware/audit':{auditMiddleware:(action,resource,options)=>{audits.push({action,resource,options});return()=>{};}},'../middleware/financialRecordScope':{patientFinancialAccess:async()=>true},'../middleware/logger':{error(){}} };
  const mod={exports:{}};vm.runInNewContext(fs.readFileSync(filename,'utf8'),{require:n=>deps[n]||actual(n),module:mod,exports:mod.exports,console,process});
  return {audits,get reads(){return reads;},async call(user,key='get /:id',body={}){const res={locals:{},set(){return this;},statusCode:200,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};await handlers.get(key)({params:{id:row.id},query:{},body,user},res);return res;}};
}
test('appointment detail permits own patient/provider and in-market administrators',async()=>{
 for(const role of ['patient','provider','admin','super_admin']){const f=fixture();const r=await f.call({id:`synthetic-${role}`,role,marketScope:'NG'});assert.equal(r.statusCode,200);if(['patient','provider'].includes(role))assert.equal(r.body.appointment.reasonForVisit,'Synthetic narrative');else {assert.equal(r.body.appointment.reasonForVisit,undefined);assert.equal(r.body.appointment.patientNotes,undefined);assert.equal(r.body.appointment.providerNotes,undefined);assert.equal(r.body.appointment.metadata,undefined);assert.equal(r.body.appointment.patientEmail,undefined);assert.equal(r.body.appointment.roomId,undefined);assert.equal(r.body.appointment.id,'synthetic-appointment');}assert.equal(r.body.appointment.patientMarketScope,undefined);assert.equal(r.body.appointment.providerMarketScope,undefined);}
});
test('appointment detail denies unrelated participants and unsupported roles without narrative disclosure',async()=>{
 for(const role of ['patient','provider','pharmacy','billing','agent']){const f=fixture();const r=await f.call({id:'unrelated',role,marketScope:'NG'});assert.equal(r.statusCode,403);assert.equal(r.body.appointment,undefined);assert.equal(JSON.stringify(r.body).includes('Synthetic narrative'),false);if(['pharmacy','billing','agent'].includes(role))assert.equal(f.reads,0);}
});
test('appointment detail denies cross-market admin and either participant market mismatch',async()=>{
 for(const [overrides,user] of [[{}, {id:'admin',role:'admin',marketScope:'US'}],[{patient_market_scope:'US'},{id:'admin',role:'admin',marketScope:'NG'}],[{provider_market_scope:'US'},{id:'synthetic-patient',role:'patient',marketScope:'NG'}]]){const r=await fixture(overrides).call(user);assert.equal(r.statusCode,403);assert.equal(r.body.appointment,undefined);}
});

test('admin list, upcoming and unchanged update expose scheduling only; admin clinical-note mutation is denied',async()=>{
 const user={id:'admin',role:'admin',marketScope:'NG'};
 for(const key of ['get /','get /upcoming','put /:id']){const r=await fixture().call(user,key,key==='put /:id'?{status:'scheduled'}:{});assert.equal(r.statusCode,200);const data=r.body.appointment||r.body.appointments[0];assert.equal(data.reasonForVisit,undefined);assert.equal(data.providerNotes,undefined);assert.equal(data.metadata,undefined);assert.equal(data.id,'synthetic-appointment');}
 for(const body of [{providerNotes:'Not a clinical actor'},{status:'in_progress'},{status:'completed'}]){const denied=await fixture().call(user,'put /:id',body);assert.equal(denied.statusCode,403);}
});
test('clinical read routes attach fail-closed metadata audit; writes declare field names only',()=>{
 const {audits}=fixture();const reads=audits.filter(a=>a.action==='read');assert.equal(reads.length,5);for(const audit of reads){assert.equal(audit.options.phiAccessed,true);assert.equal(audit.options.metadataOnly,true);assert.equal(audit.options.requireSuccess,true);}
 const updates=audits.filter(a=>a.action==='update');assert.ok(updates.some(a=>a.options.changedFields.includes('providerNotes')));for(const audit of updates)assert.equal(audit.options.metadataOnly,true);
});
