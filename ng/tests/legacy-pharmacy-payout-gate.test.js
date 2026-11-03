'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function fixture(){
  const calls={database:0,provider:0};
  const db={getPool(){calls.database++;throw new Error('No database access before disabled payout denial');}};
  const loaded={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../services/pharmacy/walletService.js'),'utf8'),{
    module:loaded,exports:loaded.exports,process:{env:{NODE_ENV:'production',NG_LEGACY_PAYMENTS_ENABLED:'true',NG_MEDICATION_SETTLEMENT_ENABLED:'true'}},
    require(name){if(name==='../../../server/db')return db;calls.provider++;throw new Error('No payment or network dependency is permitted: '+name);},
  });
  return{service:loaded.exports,calls,db};
}
test('direct, concurrent and repeated legacy payout calls fail before database, provider or network use',async()=>{
  const f=fixture();
  const results=await Promise.allSettled(Array.from({length:8},()=>f.service.processSettlement('synthetic-pharmacy',{approved:true,force:true,amount:100})));
  for(const result of results){assert.equal(result.status,'rejected');assert.equal(result.reason.status,503);assert.equal(result.reason.code,'LEGACY_PHARMACY_SETTLEMENT_DISABLED');assert.match(result.reason.message,/finance reconciliation/);}
  await assert.rejects(f.service.processSettlement(),error=>error.code==='LEGACY_PHARMACY_SETTLEMENT_DISABLED');
  assert.deepEqual(f.calls,{database:0,provider:0});
});
test('the mounted legacy payout route gives uniform private denial, while portal role restrictions remain intact',async()=>{
  const f=fixture();const routes=new Map();const middleware=[];
  const router={get(){},patch(){},delete(){},put(){},post(route,handler){routes.set(route,handler);},use(...args){if(args.length===1&&typeof args[0]==='function')middleware.push(args[0]);}};
  const loaded={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../routes/pharmacy.js'),'utf8'),{module:loaded,exports:loaded.exports,require(name){
    if(name==='express')return{Router:()=>router};if(name==='../../server/db')return f.db;if(name==='../services/pharmacy/walletService')return f.service;
    if(name.startsWith('../services/'))return{};throw new Error('Unexpected route dependency: '+name);
  }});
  const handler=routes.get('/:pharmacyId/wallet/settle');assert.equal(typeof handler,'function');
  for(const role of ['pharmacy','admin','super_admin'])for(const pharmacyId of ['owned','other','invalid']){
    const req={user:{id:'synthetic-user',role},params:{pharmacyId},body:{force:true,approved:true}};const result={headers:{}};
    const res={set(key,value){result.headers[key]=value;return this;},status(value){result.status=value;return this;},json(value){result.body=value;return this;}};
    let permitted=false;middleware[0](req,res,()=>{permitted=true;});assert.equal(permitted,true);
    await handler(req,res);assert.equal(result.status,503);assert.equal(result.body.code,'LEGACY_PHARMACY_SETTLEMENT_DISABLED');assert.match(result.body.error,/No new payout was initiated/);assert.equal(result.headers['Cache-Control'],'private, no-store');
  }
  for(const role of ['patient','provider',undefined]){
    let next=false;const result={};middleware[0]({user:{role}},{status(value){result.status=value;return this;},json(value){result.body=value;}},()=>{next=true;});assert.equal(result.status,403);assert.equal(next,false);
  }
  assert.deepEqual(f.calls,{database:0,provider:0});
});
