'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const db=require('../db');const service=require('../services/authSessionService');const {hash}=require('../../lib/encryption');
const request={ip:'127.0.0.1',get:()=> 'synthetic-session-test'};
const generated=new Map();
function generate(userId,role,claims){const accessToken=crypto.randomUUID(),refreshToken=crypto.randomUUID();generated.set(refreshToken,{userId,role,...claims});generated.set(accessToken,{userId,role,...claims});return{accessToken,refreshToken};}

test('current-session policy rejects stale credential epoch, inactive account and revoked family',async()=>{
 const id=crypto.randomUUID(),family=crypto.randomUUID();let active=true,queries=0;
 const client={async query(_sql,params){queries++;assert.deepEqual(params,[id,family]);return{rows:active?[{id:'token'}]:[]};}};
 const user={id,is_active:true,credential_version:0};
 await service.assertCurrentSession(client,{userId:id},user);assert.equal(queries,0);
 await service.assertCurrentSession(client,{userId:id,sessionVersion:0,sessionId:family},user);
 active=false;await assert.rejects(service.assertCurrentSession(client,{userId:id,sessionVersion:0,sessionId:family},user),{statusCode:401});
 await assert.rejects(service.assertCurrentSession(client,{userId:id},{...user,credential_version:1}),{statusCode:401});
 await assert.rejects(service.assertCurrentSession(client,{userId:id},{...user,is_active:false}),{statusCode:401});
 await assert.rejects(service.assertCurrentSession(client,{userId:id,sessionId:'malformed'},user),{statusCode:401});
});

test('session issuance revalidates credential snapshot inside the locked transaction',async()=>{
 const original=db.transaction;let inserts=0;const current={id:crypto.randomUUID(),role:'patient',is_active:true,password_hash:'changed',mfa_enabled:false,mfa_secret:null,credential_version:2};
 db.transaction=work=>work({async query(sql){if(sql.startsWith('SELECT * FROM users')){assert.ok(sql.includes('FOR UPDATE'));return{rows:[current]};}inserts++;return{rows:[]};}});
 try{await assert.rejects(service.issueSession({...current,password_hash:'old'},request,generate),{statusCode:401});assert.equal(inserts,0);
 const tokens=await service.issueSession(current,request,generate);assert.equal(generated.get(tokens.accessToken).sessionVersion,2);assert.ok(generated.get(tokens.accessToken).sessionId);assert.equal(inserts,1);
 }finally{db.transaction=original;}
});

const target=process.env.SIMULATION_DATABASE_URL;
test('PostgreSQL refresh/logout/password changes serialize with one successor and atomic audit', {skip:!target,timeout:45000},async()=>{
 const url=new URL(target);assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.pathname.endsWith('_test'));
 const {Pool}=require('pg');const pool=new Pool({connectionString:target,max:6,statement_timeout:10000});const original=db.transaction;const id=crypto.randomUUID();let failAudit=false;
 db.transaction=async work=>{const client=await pool.connect();try{await client.query('BEGIN');const result=await work({query(sql,params){if(failAudit&&sql.includes('INSERT INTO audit_logs'))throw new Error('Synthetic audit failure');return client.query(sql,params);}});await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}};
 const current=async()=>(await pool.query('SELECT * FROM users WHERE id=$1',[id])).rows[0];
 try{
  await pool.query(`INSERT INTO users(id,email,password_hash,role,first_name,last_name,is_active,is_test_account) VALUES($1,$2,'!synthetic-no-login','patient','Synthetic','Session',TRUE,TRUE)`,[id,`session-${id}@example.invalid`]);
  const snapshot=await current();const initial=await service.issueSession(snapshot,request,generate);const independent=await service.issueSession(snapshot,request,generate);
  const rotate=token=>service.rotateSession(generated.get(token),token,request,generate);
  const races=await Promise.allSettled([rotate(initial.refreshToken),rotate(initial.refreshToken)]);
  assert.equal(races.filter(r=>r.status==='fulfilled').length,1);assert.equal(races.find(r=>r.status==='rejected').reason.statusCode,401);
  const successor=races.find(r=>r.status==='fulfilled').value;
  assert.equal(generated.get(successor.refreshToken).sessionId,generated.get(initial.refreshToken).sessionId);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id=$1 AND family_id=$2 AND revoked_at IS NULL',[id,generated.get(initial.refreshToken).sessionId])).rows[0].n,1);
  // Logout holding the consumed predecessor must still revoke its successor.
  await service.revokeSession(id,initial.refreshToken);
  await assert.rejects(rotate(successor.refreshToken),{statusCode:401});
  await assert.rejects(service.assertCurrentSession(pool,generated.get(successor.accessToken),await current()),{statusCode:401});
  await service.assertCurrentSession(pool,generated.get(independent.accessToken),await current());
  const racing=await service.issueSession(await current(),request,generate);
  const logoutRace=await Promise.allSettled([rotate(racing.refreshToken),service.revokeSession(id,racing.refreshToken)]);
  assert.equal(logoutRace[1].status,'fulfilled');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id=$1 AND family_id=$2 AND revoked_at IS NULL',[id,generated.get(racing.refreshToken).sessionId])).rows[0].n,0);
  if(logoutRace[0].status==='fulfilled')await assert.rejects(service.assertCurrentSession(pool,generated.get(logoutRace[0].value.accessToken),await current()),{statusCode:401});
  else assert.equal(logoutRace[0].reason.statusCode,401);
  failAudit=true;await assert.rejects(service.changeCredentials({userId:id,expectedPasswordHash:snapshot.password_hash,newPasswordHash:'!changed',request,generateTokens:generate}),/Synthetic audit failure/);failAudit=false;
  assert.equal((await current()).password_hash,snapshot.password_hash);await service.assertCurrentSession(pool,generated.get(independent.accessToken),await current());
  await pool.query('UPDATE users SET must_change_password=TRUE WHERE id=$1',[id]);
  const changed=await service.changeCredentials({userId:id,expectedPasswordHash:snapshot.password_hash,newPasswordHash:'!changed',request,generateTokens:generate});
  assert.equal(changed.user.credential_version,1);assert.ok(changed.tokens);await service.assertCurrentSession(pool,generated.get(changed.tokens.accessToken),await current());
  await assert.rejects(rotate(independent.refreshToken),{statusCode:401});await assert.rejects(service.assertCurrentSession(pool,{userId:id},await current()),{statusCode:401});
  await assert.rejects(service.issueSession(snapshot,request,generate),{statusCode:401});
  const reset=crypto.randomUUID();await pool.query("INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL '1 hour')",[id,hash(reset)]);
  const resetOnce=()=>service.changeCredentials({userId:id,resetTokenHash:hash(reset),newPasswordHash:'!reset',request,generateTokens:generate});
  const resets=await Promise.allSettled([resetOnce(),resetOnce()]);assert.equal(resets.filter(r=>r.status==='fulfilled').length,1);assert.equal(resets.find(r=>r.status==='rejected').reason.statusCode,401);
  assert.equal((await current()).credential_version,2);await assert.rejects(service.assertCurrentSession(pool,generated.get(changed.tokens.accessToken),await current()),{statusCode:401});
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE user_id=$1 AND resource_type='user'",[id])).rows[0].n,2);
 }finally{db.transaction=original;await pool.query('DELETE FROM audit_logs WHERE user_id=$1',[id]);await pool.query('DELETE FROM users WHERE id=$1',[id]);await pool.end();}
});


test('actual HTTP authentication preserves deactivated-account403 while stale sessions return401',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');const source=fs.readFileSync(require.resolve('../middleware/auth'),'utf8');const start=source.indexOf('const authenticate =');const end=source.indexOf('\n/**',start);
 for(const active of [false,true]){
  let checked=0,status,body;const context={jwt:{verify:()=>({userId:'synthetic'})},ACCESS_TOKEN_SECRET:'synthetic',db:{query:async()=>({rows:[{id:'synthetic',is_active:active}]})},assertCurrentSession:async()=>{checked++;throw Object.assign(new Error('stale'),{statusCode:401});}};
  vm.runInNewContext(source.slice(start,end)+';this.handler=authenticate;',context);
  const response={status(value){status=value;return this;},json(value){body=value;return this;}};
  await context.handler({headers:{authorization:'Bearer synthetic'},cookies:{}},response,()=>assert.fail('Denied request continued'));
  assert.equal(status,active?401:403);assert.equal(checked,active?1:0);assert.equal(body.success,false);
 }
});
