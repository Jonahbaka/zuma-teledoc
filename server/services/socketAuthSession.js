'use strict';
const {assertCurrentSession}=require('./authSessionService');
// Keep an established transport across normal access-token refresh, but never
// process a packet on an expired token or revoked/changed account authority.
async function installSocketAuthorization(socket,{decoded,verify,db,onRevoke,refreshTimeoutMs=30000}) {
 let claims=decoded,pending=null;
 async function current(value){
  const user=(await db.query('SELECT id,role,first_name,last_name,is_active,credential_version FROM users WHERE id=$1',[value.userId||value.id])).rows[0];
  await assertCurrentSession(db,value,user);
  return user;
 }
 const initial=await current(claims);
 const revoke=()=>{onRevoke?.();socket.disconnect(true);};
 socket.authSessionId=claims.sessionId||null;
 socket.on('auth:reauthenticate',async(payload={},ack)=>{
  try{
   if(typeof payload.token!=='string'||payload.token.length>8192)throw new Error('Invalid token');
   const next=verify(payload.token),user=await current(next);
   if((next.userId||next.id)!==initial.id||user.id!==initial.id||user.role!==initial.role||(claims.sessionId&&next.sessionId!==claims.sessionId))throw new Error('Session context changed');
   claims=next;socket.authSessionId=next.sessionId||null;pending?.resolve();ack?.({ok:true});
  }catch(_){pending?.reject(new Error('Session is no longer valid'));ack?.({ok:false});revoke();}
 });
 socket.use(async(packet,done)=>{
  if(packet[0]==='auth:reauthenticate')return done();
  try{
   let user=await current(claims);if(user.role!==initial.role)throw new Error('Account authority changed');
   if(!claims.exp||claims.exp*1000<=Date.now()){
    if(!pending){
     let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
     const timer=setTimeout(()=>reject(new Error('Session refresh timed out')),refreshTimeoutMs);
     pending={promise,resolve,reject};promise.finally(()=>{clearTimeout(timer);pending=null;}).catch(()=>{});
     socket.emit('auth:refresh-required');
    }
    await pending.promise;
    user=await current(claims);
    if(!claims.exp||claims.exp*1000<=Date.now()||user.role!==initial.role)throw new Error('Session is no longer valid');
   }
   done();
  }catch(_){revoke();done(new Error('Session is no longer valid'));}
 });
 socket.on('disconnect',()=>pending?.reject(new Error('Socket disconnected')));
 return initial;
}
module.exports={installSocketAuthorization};
