'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const {installSocketAuthorization}=require('../services/socketAuthSession');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(){
 const id=crypto.randomUUID(),family=crypto.randomUUID();const state={active:true,role:'provider',version:0,revoked:false};const handlers=new Map(),events=[];let middleware,disconnected=0;
 const claims={userId:id,sessionId:family,sessionVersion:0,exp:Math.floor(Date.now()/1000)+60};
 const socket={on(name,fn){handlers.set(name,fn);},use(fn){middleware=fn;},emit(name){events.push(name);},disconnect(){disconnected++;handlers.get('disconnect')?.();}};
 const db={async query(sql){return{rows:sql.includes('FROM users')?[{id,is_active:state.active,role:state.role,credential_version:state.version}]:state.revoked?[]:[{id:'active-token'}]};}};
 await installSocketAuthorization(socket,{decoded:claims,verify:token=>{const next=JSON.parse(token);assert.ok(next.exp*1000>Date.now());return next;},db,refreshTimeoutMs:100});
 return{claims,state,events,handlers,packet:()=>new Promise(resolve=>middleware(['clinical-message'],resolve)),disconnected:()=>disconnected};
}
test('long socket session pauses expired-token packet and resumes after same-family refresh without disconnect',async()=>{
 const f=await fixture();f.claims.exp=1;let settled=false;const packet=f.packet().then(error=>{settled=true;assert.equal(error,undefined);});
 await turn();assert.equal(settled,false);assert.deepEqual(f.events,['auth:refresh-required']);
 let ack;await f.handlers.get('auth:reauthenticate')({token:JSON.stringify({...f.claims,exp:Math.floor(Date.now()/1000)+60})},value=>{ack=value;});await packet;
 assert.deepEqual(ack,{ok:true});assert.equal(f.disconnected(),0);assert.equal(await f.packet(),undefined);
});
test('role downgrade, revoked family and credential rotation reject further socket packets',async()=>{
 for(const mutation of [state=>state.role='patient',state=>state.revoked=true,state=>state.version=1,state=>state.active=false]){
  const f=await fixture();mutation(f.state);assert.ok(await f.packet() instanceof Error);assert.ok(f.disconnected()>0);assert.deepEqual(f.events,[]);
 }
});
test('socket reauthentication cannot switch account or session family and timeout never releases packet',async()=>{
 for(const delta of [{userId:crypto.randomUUID()},{sessionId:crypto.randomUUID()}]){
  const f=await fixture();f.claims.exp=1;const packet=f.packet();await turn();let ack;
  await f.handlers.get('auth:reauthenticate')({token:JSON.stringify({...f.claims,...delta,exp:Math.floor(Date.now()/1000)+60})},value=>{ack=value;});
  assert.deepEqual(ack,{ok:false});assert.ok(await packet instanceof Error);assert.ok(f.disconnected()>0);
 }
 const f=await fixture();f.claims.exp=1;assert.ok(await f.packet() instanceof Error);assert.ok(f.disconnected()>0);
});

test('actual client socket refresh uses current HTTP session and never reauthenticates under a switched account',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');const {transformSync}=require('next/dist/build/swc');
 for(const switchAccount of [false,true]){
  let generation=1,stored='A:fresh',resolve;const requests=[],handlers=new Map();let disconnected=0;
  const socket={auth:{token:'A:expired'},on:(name,fn)=>handlers.set(name,fn),off:name=>handlers.delete(name),disconnect(){disconnected++;},timeout(){return{emit(name,body,ack){requests.push({name,body});ack(null,{ok:true});}};}};
  const sandboxModule={exports:{}};const dependencies={'@/lib/api':{__esModule:true,default:{get:()=>new Promise(done=>{resolve=done;})}},'@/lib/authSession':{authSessionGeneration:()=>generation,authTokenOwnerHint:value=>value?.split(':')[0]}};
  const code=transformSync(fs.readFileSync(require.resolve('../../lib/socketSession.js'),'utf8'),{jsc:{parser:{syntax:'ecmascript'}},module:{type:'commonjs'}}).code;
  vm.runInNewContext(code,{module:sandboxModule,exports:sandboxModule.exports,require:name=>dependencies[name],localStorage:{getItem:()=>stored}});
  const cleanup=sandboxModule.exports.installSocketSessionRefresh(socket);const pending=handlers.get('auth:refresh-required')();
  if(switchAccount){generation++;stored='B:fresh';}resolve();await pending;
  assert.equal(requests.length,switchAccount?0:1);assert.equal(disconnected,switchAccount?1:0);if(!switchAccount)assert.equal(socket.auth.token,'A:fresh');cleanup();assert.equal(handlers.size,0);
 }
});
