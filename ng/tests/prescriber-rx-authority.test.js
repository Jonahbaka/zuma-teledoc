'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ids = Object.fromEntries(['user','profile','patient','rx','item','refill','other','pharmacy','suggestion','encounter'].map((key,index)=>[key,`00000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`]));
const actor = { id:ids.user,role:'provider' };
const body = () => ({ provider_id:ids.other,patient_user_id:ids.patient,appointment_id:'',preferred_pharmacy_id:'',diagnosis:'Synthetic indication',notes:'',is_controlled:false,items:[{ drug_name:'Synthetic medication',dosage:'Clinician directions',frequency:'Clinician schedule',duration_days:null,quantity:2,refills_authorized:0,notes:'' }] });
function load(relative, dependencies) {
  const filename=path.resolve(__dirname,relative),mod={ exports:{} };
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{ module:mod,exports:mod.exports,console,Date,Math,JSON,require(name) { return Object.hasOwn(dependencies,name) ? dependencies[name] : require(name.startsWith('.') ? path.resolve(path.dirname(filename),name) : name); } },{ filename });
  return mod.exports;
}
function fixture() {
  const state = { user:{ id:ids.user,role:'provider',is_active:true,account_status:'active',market_scope:'NG',provider_status:'approved' },profile:{ id:ids.profile,user_id:ids.user,status:'verified' },
    rx:{ id:ids.rx,provider_id:ids.profile,patient_user_id:ids.patient,lifecycle_status:'drafted',items:[],signed_at:null },
    items:[{ id:ids.item,prescription_id:ids.rx,quantity:2,dispensed_quantity:0,status:'pending',refills_remaining:2 }],
    refill:{ id:ids.refill,prescription_id:ids.rx,item_id:ids.item,status:'requested' },events:[],audits:[],calls:[],relationship:true,aiAllowed:true,aiChecks:0,failAudit:false,failEvent:false,failCommit:false,released:false };
  let before;
  const client={ release() { state.released=true; },async query(sql,params=[]) {
    state.calls.push({ sql,params });
    if(sql==='BEGIN') { before=structuredClone({ rx:state.rx,items:state.items,refill:state.refill,events:state.events,audits:state.audits });return{rows:[]}; }
    if(sql==='ROLLBACK') { Object.assign(state,before);return{rows:[]}; }
    if(sql==='COMMIT') { if(state.failCommit) throw new Error('Unconfirmed private database commit');return{rows:[]}; }
    if(sql.startsWith('SELECT id FROM users WHERE')) {
      assert.match(sql,/account_status='active'/);assert.match(sql,/FOR SHARE/);
      const u=state.user;return{rows:u.id===params[0]&&u.role==='provider'&&u.is_active&&u.account_status==='active'&&u.market_scope==='NG'&&u.provider_status==='approved'?[{id:u.id}]:[]};
    }
    if(sql.startsWith('SELECT id FROM ng_providers')) return{rows:state.profile.user_id===params[0]&&state.profile.status==='verified'?[{id:ids.profile}]:[]};
    if(sql.includes('FROM users actor')) {
      assert.match(sql,/actor.account_status = 'active'/);assert.match(sql,/FOR SHARE OF actor, provider, patient/);
      return{rows:state.patientDenied?[]:[{user_id:ids.user,role:'provider',provider_id:ids.profile}]};
    }
    if(sql.includes("SELECT id, 'native' AS source")) return{rows:state.relationship?[{id:ids.encounter,source:'native'}]:[]};
    if(sql.includes('FROM ng_appointments')) return{rows:state.relationship?[{id:ids.encounter}]:[]};
    if(sql.startsWith('SELECT id,patient_user_id FROM ng_digital_prescriptions')) {
      assert.match(sql,/provider_id=\$2 FOR (SHARE|UPDATE)/);return{rows:state.rx.id===params[0]&&state.rx.provider_id===params[1]?[{id:state.rx.id,patient_user_id:state.rx.patient_user_id}]:[]};
    }
    if(sql.startsWith('SELECT rx.*')) { assert.match(sql,/rx.provider_id=\$1/);assert.match(sql,/\$2::ng_rx_status IS NULL OR rx.lifecycle_status=\$2::ng_rx_status/);assert.match(sql,/FOR SHARE OF rx/);return{rows:state.rx.provider_id===params[0]?[structuredClone(state.rx)]:[]}; }
    if(sql.startsWith('SELECT * FROM ng_digital_prescriptions')) return{rows:[structuredClone(state.rx)]};
    if(sql.startsWith('SELECT * FROM ng_rx_items')) return{rows:structuredClone(state.items)};
    if(sql.startsWith('SELECT EXISTS(SELECT 1 FROM ng_medication_events')) return{rows:[{required:!!state.reviewHeld}]};
    if(sql.startsWith('SELECT id FROM ng_digital_prescriptions')) return{rows:params[0]===state.rx.id?[{id:state.rx.id}]:[]};
    if(sql.startsWith('SELECT prescription_id FROM ng_rx_refills')) return{rows:state.refill.id===params[0]?[{prescription_id:state.refill.prescription_id}]:[]};
    if(sql.startsWith('SELECT id FROM ng_rx_refills')||sql.startsWith('SELECT * FROM ng_rx_refills')) return{rows:state.refill.id===params[0]&&state.refill.prescription_id===params[1]?[structuredClone(state.refill)]:[]};
    if(sql.startsWith('SELECT id FROM ng_rx_items')) return{rows:state.items.filter(item=>item.id===params[0]&&item.prescription_id===params[1])};
    if(sql.includes('UPDATE ng_digital_prescriptions')) { const explicit=sql.match(/lifecycle_status = '(\w+)'/);state.rx.lifecycle_status=explicit?explicit[1]:params[1];if(state.rx.lifecycle_status==='sent_to_pharmacy')state.rx.routed_pharmacy_id=params[1];return{rows:[structuredClone(state.rx)]}; }
    if(sql.includes('UPDATE ng_rx_refills')) { if(state.refill.status!=='requested')return{rows:[]};state.refill.status=sql.includes("SET status = 'approved'")?'approved':'denied';return{rows:[structuredClone(state.refill)]}; }
    if(sql.includes('UPDATE ng_rx_items')) {state.items[0].refills_remaining--;return{rows:[]};}
    if(sql.includes('INSERT INTO ng_rx_refills')) {state.refill={id:ids.refill,prescription_id:params[0],item_id:params[1],status:'requested'};return{rows:[structuredClone(state.refill)]};}
    if(sql.includes('INSERT INTO ng_rx_events')) {if(state.failEvent)throw new Error('Private event storage failure');state.events.push(params);return{rows:[]};}
    if(sql.includes('SELECT * FROM ng_rx_events')) return{rows:structuredClone(state.events)};
    if(sql.includes('INSERT INTO audit_logs')) {if(state.failAudit)throw new Error('Private audit storage failure');state.audits.push(params);return{rows:[]};}
    if(sql.includes('SELECT e.id, e.programme_id')) return{rows:state.patientDenied?[]:[{id:ids.encounter,programme_id:ids.other,facility_id:ids.other,patient_user_id:ids.patient,clinician_user_id:ids.user}]};
    if(sql.includes('INSERT INTO ng_digital_prescriptions')) {state.rx={id:ids.rx,provider_id:params[0],patient_user_id:params[1],lifecycle_status:'drafted',signed_at:null,clinical_ai_source_suggestion_id:params[9],clinical_ai_source_encounter_id:params[10]};state.items=[];return{rows:[structuredClone(state.rx)]};}
    if(sql.includes('INSERT INTO ng_rx_items')) {state.items.push({id:ids.item,prescription_id:params[0],drug_name:params[3],dosage:params[6],frequency:params[7],quantity:params[9],dispensed_quantity:0,status:'pending'});return{rows:[]};}
    throw new Error('Unexpected prescriber SQL: '+sql);
  }};
  const workflow=load('../services/rx-engine/prescriptionWorkflowService.js',{
    '../../../server/db':{getPool(){throw new Error('Global pool access forbidden');},transaction(){throw new Error('Nested transaction forbidden');}},
    '../phc/programmeScopeService':{async assertProgrammeScope(_client,user){assert.equal(user.id,ids.user);return{programmeRole:'remote_clinician'};}},
    '../phc/clinicalAiService':{async assertAcceptedCareActionSource(_client,_context,input){state.aiChecks++;assert.equal(input.suggestionId,ids.suggestion);if(!state.aiAllowed)throw Object.assign(new Error('Private unaccepted source'),{code:'CLINICAL_AI_CARE_ACTION_SOURCE_INVALID',statusCode:409});}},
  });
  const service=load('../services/rx-engine/prescriberRxService.js',{'./prescriptionWorkflowService':workflow});
  return{state,client,service,workflow,pool:{connect:async()=>client}};
}
const operations = [f=>f.service.list(f.pool,actor),f=>f.service.read(f.pool,actor,ids.rx),f=>f.service.read(f.pool,actor,ids.rx,true),f=>f.service.create(f.pool,actor,body()),...['sign','send','cancel','complete','refill','approve_refill','deny_refill'].map(action=>f=>f.service.mutate(f.pool,actor,action.includes('_refill')?ids.refill:ids.rx,action,action==='send'?{pharmacy_id:ids.pharmacy}:{}))];
test('all eleven prescriber operations deny current suspended/unapproved/foreign authority before PHI',async()=>{
  for(const patch of [{account_status:'suspended'},{provider_status:'suspended'},{is_active:false},{role:'admin'},{market_scope:'US'}])for(const op of operations){const f=fixture();Object.assign(f.state.user,patch);await assert.rejects(op(f),error=>error.status===403);assert.equal(f.state.calls.some(({sql})=>/FROM ng_digital_prescriptions|FROM ng_rx_refills|INSERT|UPDATE ng_/.test(sql)),false);}
  for(const patch of [{status:'suspended'},{user_id:ids.other}])for(const op of operations){const f=fixture();Object.assign(f.state.profile,patch);await assert.rejects(op(f),error=>error.status===403);assert.equal(f.state.calls.some(({sql})=>/FROM ng_digital_prescriptions|FROM ng_rx_refills|INSERT|UPDATE ng_/.test(sql)),false);}
});
test('current Rx and refill ownership is checked under lock before clinical reads or writes',async()=>{
  for(const op of operations.filter((_,index)=>![0,3].includes(index))){const f=fixture();f.state.rx.provider_id=ids.other;await assert.rejects(op(f),error=>error.status===404);assert.equal(f.state.calls.some(({sql})=>sql.startsWith('SELECT * FROM ng_')||sql.startsWith('UPDATE')||sql.startsWith('INSERT')),false);}
  const f=fixture();f.state.rx.provider_id=ids.other;assert.deepEqual(await f.service.list(f.pool,actor,{provider_id:ids.other}),[]);
});
test('manual and approved-AI draft creation reuse existing care scope, stay unsigned and never use global pool',async()=>{
  for(const ai of [false,true]){const f=fixture(),input=body();if(ai)Object.assign(input,{aiSourceSuggestionId:ids.suggestion,phcEncounterId:ids.encounter});const rx=await f.service.create(f.pool,actor,input);assert.equal(rx.provider_id,ids.profile);assert.equal(rx.lifecycle_status,'drafted');assert.equal(rx.signed_at,null);assert.equal(rx.items.length,1);assert.equal(f.state.aiChecks,ai?1:0);assert.equal(f.state.calls.at(-1).sql,'COMMIT');assert.equal(f.state.calls.filter(({sql})=>sql==='BEGIN').length,1);assert.equal(f.state.events.length,1);assert.equal(f.state.audits.length,1);}
  for(const patch of [{relationship:false},{patientDenied:true},{aiAllowed:false}]){const f=fixture();Object.assign(f.state,patch);await assert.rejects(f.service.create(f.pool,actor,{...body(),aiSourceSuggestionId:ids.suggestion,phcEncounterId:ids.encounter}));assert.equal(f.state.calls.some(({sql})=>sql.includes('INSERT INTO ng_digital_prescriptions')),false);}
});
test('workflow and mandatory gateway audits share one transaction and preserve terminal/quantity guards',async()=>{
  for(const fail of ['failAudit','failEvent'])for(const action of ['sign','send','cancel','complete','refill','approve_refill','deny_refill']){const f=fixture();if(action==='send')f.state.rx.lifecycle_status='signed';if(action==='complete'){f.state.rx.lifecycle_status='fully_dispensed';Object.assign(f.state.items[0],{status:'dispensed',dispensed_quantity:2});}f.state[fail]=true;const before=structuredClone({rx:f.state.rx,items:f.state.items,refill:f.state.refill});await assert.rejects(f.service.mutate(f.pool,actor,action.includes('_refill')?ids.refill:ids.rx,action,action==='send'?{pharmacy_id:ids.pharmacy}:{}));assert.deepEqual({rx:f.state.rx,items:f.state.items,refill:f.state.refill},before);assert.equal(f.state.events.length,0);assert.equal(f.state.calls.at(-1).sql,'ROLLBACK');}
  const f=fixture();f.state.rx.lifecycle_status='completed';await assert.rejects(f.service.mutate(f.pool,actor,ids.rx,'sign'),{code:'INVALID_TRANSITION'});f.state.rx.lifecycle_status='fully_dispensed';await assert.rejects(f.service.mutate(f.pool,actor,ids.rx,'complete'),{code:'INVALID_STATE'});
});
test('read/create commit or audit failure never returns success and sensitive errors are sanitized',async()=>{
  for(const op of operations.slice(0,4))for(const failure of ['failAudit','failCommit']){const f=fixture();f.state[failure]=true;await assert.rejects(op(f));assert.equal(f.state.released,true);}
  const f=fixture(),response={status(code){this.code=code;return this;},json(value){this.body=value;return this;}};f.service.sendError(response,new Error('Private patient SQL'));assert.equal(response.code,503);assert.doesNotMatch(JSON.stringify(response.body),/Private patient/);
});
test('external bodies cannot choose trusted/internal scope and composer blank optional fields remain compatible',async()=>{
  for(const extra of [{system:true},{trusted:true},{provider_id:ids.other},{fulfillment_order_id:ids.other}]){const f=fixture();await assert.rejects(f.service.mutate(f.pool,actor,ids.rx,'sign',extra),error=>error.status===400);assert.equal(f.state.calls.length,0);}
  const f=fixture();await assert.rejects(f.service.create(f.pool,actor,{...body(),clinical_ai_source_suggestion_id:ids.suggestion}),error=>error.status===400);assert.equal(f.state.calls.length,0);
});
module.exports={fixture,ids,actor,body};

test('all eleven mounted prescriber endpoints use current gateway authority and notify only after committed routing',async()=>{
  const express=require('express');let active=fixture();let notices=0;
  const boundary=Object.fromEntries(['list','read','create','mutate','sendError'].map(name=>[name,(...args)=>active.service[name](...args)]));
  const router=load('../routes/prescriptions.js',{
    express,'../services/rx-engine/prescriberRxService':boundary,'../services/pharmacy/pharmacistRxService':{},'../services/rx-engine/prescriptionWorkflowService':active.workflow,
    '../../server/db':{getPool:()=>active.pool},
    '../services/whatsapp/whatsappDispenseService':{async createPharmacyPrescriptionNotification(){assert.equal(active.state.calls.at(-1).sql,'COMMIT');assert.equal(active.state.rx.lifecycle_status,'sent_to_pharmacy');notices++;return{status:'manual_fallback_pending'};}},
  });
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user=actor;next();});app.use('/rx',router);
  const server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
  const endpoints=[['GET','/',null,'drafted',200],['GET',`/${ids.rx}`,null,'drafted',200],['GET',`/${ids.rx}/events`,null,'drafted',200],['POST','/',body(),'drafted',201],['POST',`/${ids.rx}/sign`,{},'drafted',200],['POST',`/${ids.rx}/send`,{pharmacy_id:ids.pharmacy},'signed',200],['POST',`/${ids.rx}/cancel`,{},'drafted',200],['POST',`/${ids.rx}/complete`,{},'fully_dispensed',200],['POST',`/${ids.rx}/refill`,{item_id:ids.item},'completed',201],['POST',`/refills/${ids.refill}/approve`,{},'completed',200],['POST',`/refills/${ids.refill}/deny`,{},'completed',200]];
  const http=async(method,url,input)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/rx${url}`,{method,headers:{'Content-Type':'application/json'},...(input?{body:JSON.stringify(input)}:{})});return{status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};};
  try {
    for(const [method,url,input,status,expected] of endpoints){active=fixture();active.state.rx.lifecycle_status=status;if(status==='fully_dispensed')Object.assign(active.state.items[0],{status:'dispensed',dispensed_quantity:2});const response=await http(method,url,input);assert.equal(response.status,expected,JSON.stringify(response.body));assert.equal(response.cache,'private, no-store');assert.equal(active.state.audits.length,1);active=fixture();active.state.user.account_status='suspended';assert.equal((await http(method,url,input)).status,403,url);assert.equal(active.state.events.length,0);}
    assert.equal(notices,1);active=fixture();active.state.rx.lifecycle_status='signed';active.state.failAudit=true;assert.equal((await http('POST',`/${ids.rx}/send`,{pharmacy_id:ids.pharmacy})).status,503);assert.equal(notices,1);assert.equal(active.state.rx.lifecycle_status,'signed');
  } finally { await new Promise(resolve=>server.close(resolve)); }
});

test('prescriber PostgreSQL fixtures refuse remote, overridden and production targets before connecting',async()=>{
  const {fixtureTargetSafety}=require('../scripts/fixtureTargetSafety');
  const local='postgresql://fixture@127.0.0.1:5432/prescriber_guard_test';
  const filename=path.resolve(__dirname,'prescriber-rx-authority-db.test.js');
  for(const [env,poolOptions] of [
    [{NODE_ENV:'test',SIMULATION_DATABASE_URL:local+'?host=remote.example'},null],
    [{NODE_ENV:'test',SIMULATION_DATABASE_URL:local+'?database=production'},null],
    [{NODE_ENV:'test',SIMULATION_DATABASE_URL:'postgresql://fixture@remote.example/prescriber_guard_test'},null],
    [{NODE_ENV:'production',SIMULATION_DATABASE_URL:local},null],
    [{NODE_ENV:'test',SIMULATION_DATABASE_URL:local},{connectionString:local,host:'remote.example'}],
  ]){
    let callback,constructors=0;
    const refuse=()=>{throw new Error('Fixture guard must not connect or execute SQL');};
    const dependencies={
      'node:test':(_name,_options,run)=>{callback=run;},'node:assert/strict':assert,'node:crypto':require('node:crypto'),
      pg:{Pool:class {constructor(){constructors++;assert.ok(poolOptions,'Guard must precede Pool construction');this.options=poolOptions;}query=refuse;connect=refuse;end=refuse;}},
      '../services/rx-engine/prescriberRxService':{},
      '../scripts/fixtureTargetSafety':{fixtureTargetSafety:options=>fixtureTargetSafety({...options,env})},
    };
    vm.runInNewContext(fs.readFileSync(filename,'utf8'),{process:{env},require(name){assert.ok(name in dependencies);return dependencies[name];}},{filename});
    await assert.rejects(callback({}),/Fixture writes|supplied database pool/);
    assert.equal(constructors,poolOptions?1:0);
  }
});
