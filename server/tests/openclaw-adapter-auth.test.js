'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');const jwt=require('jsonwebtoken');
const {createAdapterAuthenticator}=require('../services/openclawAdapterAuth');
test('operator adapter has no implicit gateway credential and only accepts explicitly configured strong credentials',async()=>{
 const env={};const authenticate=createAdapterAuthenticator({env,db:{query(){assert.fail('Unconfigured gateway must not query users');}}});
 assert.equal((await authenticate('synthetic-unconfigured-token')).ok,false);assert.equal((await authenticate(null)).ok,false);assert.equal((await authenticate('x'.repeat(8193))).ok,false);
 env.OPENCLAW_GATEWAY_TOKEN='synthetic-operator-token-only-for-isolated-tests';assert.deepEqual(await authenticate(env.OPENCLAW_GATEWAY_TOKEN),{ok:true,role:'operator',userId:'gateway',isGateway:true});
 const old=env.OPENCLAW_GATEWAY_TOKEN;env.OPENCLAW_GATEWAY_TOKEN='synthetic-replaced-operator-token-for-tests';assert.equal((await authenticate(old)).ok,false);
 env.OPENCLAW_GATEWAY_TOKEN='short';assert.equal((await authenticate('short')).ok,false);
});
test('adapter JWT resolves current account identity/role and rejects inactive, revoked or rotated credentials',async()=>{
 const id=crypto.randomUUID(),family=crypto.randomUUID();const secret='synthetic-explicit-access-key-for-local-tests';const state={role:'patient',active:true,version:0,family:true};
 const auth=createAdapterAuthenticator({env:{JWT_ACCESS_SECRET:secret},db:{async query(sql,params){assert.equal(params[0],id);return{rows:sql.includes('FROM users')?[{id,role:state.role,is_active:state.active,credential_version:state.version}]:state.family?[{id:'refresh'}]:[]};}}});
 const access=jwt.sign({userId:id,role:'admin',sessionId:family,sessionVersion:0},secret,{expiresIn:'1m'});
 assert.deepEqual(await auth(access),{ok:true,role:'patient',userId:id,sessionId:family});
 state.role='provider';assert.equal((await auth(access)).role,'provider');state.active=false;assert.equal((await auth(access)).ok,false);state.active=true;
 state.family=false;assert.equal((await auth(access)).ok,false);state.family=true;state.version=1;assert.equal((await auth(access)).ok,false);state.version=0;
 assert.equal((await auth(jwt.sign({userId:id},secret,{expiresIn:-1}))).ok,false);
 assert.equal((await auth(jwt.sign({userId:id},'different-isolated-secret',{expiresIn:'1m'}))).ok,false);
});
test('raw adapter bounds payloads, awaits current authority on messages and broadcasts, and removes default-secret fallbacks',()=>{
 const fs=require('node:fs');const source=fs.readFileSync(require.resolve('../routes/openclawAdapter'),'utf8');
 assert.match(source,/maxPayload: 64 \* 1024/);assert.match(source,/await authenticate\(p\)/);assert.match(source,/await validateSession\(\)/);assert.match(source,/async function broadcastToOpenClaw/);assert.doesNotMatch(source,/dev-access-secret|gateway-token-2026/);
});


test('adapter events require explicit recipients and never reach unrelated or revoked sessions',async()=>{
 const {deliverScopedAdapterEvent}=require('../services/scopedAdapterEvents');const a=crypto.randomUUID(),b=crypto.randomUUID();const sent=[];let closed=0,validated=0;
 const sessions=[{userId:a,ws:{id:'a1',close(){closed++;}},validateSession:async()=>{validated++;return true;}},{userId:a,ws:{id:'a-revoked',close(){closed++;}},validateSession:async()=>false},{userId:b,ws:{id:'b'},validateSession:async()=>{assert.fail('Unrelated recipient checked');}}];
 const input={sessions,event:'synthetic-private-event',payload:{synthetic:true},send:ws=>{sent.push(ws.id);return true;}};
 assert.equal((await deliverScopedAdapterEvent(input)).ok,false);assert.equal(validated,0);assert.deepEqual(sent,[]);
 assert.equal((await deliverScopedAdapterEvent({...input,recipientUserIds:['gateway']})).ok,false);
 assert.deepEqual(await deliverScopedAdapterEvent({...input,recipientUserIds:[a]}),{ok:true,queued:1});assert.deepEqual(sent,['a1']);assert.equal(closed,1);
});
