'use strict';
const crypto = require('node:crypto');
const db = require('../db');
const { hash } = require('../../lib/encryption');
function rejected(message = 'Session is no longer valid') { return Object.assign(new Error(message), {statusCode:401}); }
function version(value) { const n=Number(value ?? 0); return Number.isSafeInteger(n)&&n>=0?n:-1; }
async function lockedUser(client,id) {
  const user=(await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!user?.is_active)throw rejected();
  return user;
}
async function storeSession(client,user,request,generateTokens,familyId=crypto.randomUUID()) {
  const tokens=generateTokens(user.id,user.role,{sessionVersion:version(user.credential_version),sessionId:familyId});
  await client.query(`INSERT INTO refresh_tokens(user_id,token_hash,ip_address,device_info,expires_at,family_id)
    VALUES($1,$2,$3,$4,NOW()+INTERVAL '7 days',$5)`,[user.id,hash(tokens.refreshToken),request.ip||null,request.get?.('user-agent')||null,familyId]);
  return tokens;
}
async function issueSession(snapshot,request,generateTokens) {
  return db.transaction(async client=>{
    const current=await lockedUser(client,snapshot.id);
    // Password/MFA verification happened outside the transaction. Do not mint a
    // session if credentials or factor policy changed while it was in flight.
    if(snapshot.role!==current.role || snapshot.password_hash!==current.password_hash || Boolean(snapshot.mfa_enabled)!==Boolean(current.mfa_enabled) || (snapshot.mfa_secret??null)!==(current.mfa_secret??null))throw rejected('Credentials changed; sign in again');
    return storeSession(client,current,request,generateTokens);
  });
}
async function rotateSession(decoded,refreshToken,request,generateTokens) {
  return db.transaction(async client=>{
    // All session writers lock the user first, then token rows. This serializes
    // rotation against logout and credential changes without a lock-order cycle.
    const user=await lockedUser(client,decoded.userId);
    if(version(decoded.sessionVersion)!==version(user.credential_version))throw rejected();
    const token=(await client.query(`SELECT id,user_id,family_id FROM refresh_tokens
      WHERE token_hash=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE`,[hash(refreshToken),user.id])).rows[0];
    if(!token || (decoded.sessionId && decoded.sessionId!==token.family_id))throw rejected();
    const consumed=await client.query(`UPDATE refresh_tokens SET revoked_at=NOW() WHERE id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp() RETURNING id`,[token.id]);
    if(!consumed.rows.length)throw rejected();
    return {user,...await storeSession(client,user,request,generateTokens,token.family_id)};
  });
}
async function revokeSession(userId,refreshToken,sessionId) {
  const family=await db.transaction(async client=>{
    await lockedUser(client,userId);
    let family=sessionId;
    if(refreshToken){
      // Include already-consumed tokens so logout racing a successful rotation
      // revokes the successor in the same family, not merely the old row.
      const token=(await client.query('SELECT family_id FROM refresh_tokens WHERE token_hash=$1 AND user_id=$2 FOR UPDATE',[hash(refreshToken),userId])).rows[0];
      if(token)family=token.family_id;
    }
    if(family)await client.query('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,NOW()) WHERE user_id=$1 AND family_id=$2',[userId,family]);
    return family;
  });
  if(family){ require('./socketService').revokeUserSessions(userId,family);require('../routes/openclawAdapter').revokeAdapterSessions(userId,family); }
}
async function assertCurrentSession(client,decoded,user) {
  if(!user?.is_active || version(decoded.sessionVersion)!==version(user.credential_version))throw rejected();
  if(decoded.sessionId){
    if(typeof decoded.sessionId!=='string'||!/^[-a-f0-9]{36}$/i.test(decoded.sessionId))throw rejected();
    const active=await client.query(`SELECT id FROM refresh_tokens WHERE user_id=$1 AND family_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() LIMIT 1`,[user.id,decoded.sessionId]);
    if(!active.rows.length)throw rejected();
  }
}
async function changeCredentials({userId,expectedPasswordHash,newPasswordHash,resetTokenHash,request,generateTokens}) {
  const result=await db.transaction(async client=>{
    const user=await lockedUser(client,userId);
    if(resetTokenHash){
      const consumed=await client.query(`DELETE FROM password_reset_tokens WHERE user_id=$1 AND token_hash=$2 AND expires_at>clock_timestamp() RETURNING user_id`,[userId,resetTokenHash]);
      if(!consumed.rows.length)throw rejected('Invalid or expired reset token');
    }else if(user.password_hash!==expectedPasswordHash)throw rejected('Credentials changed; sign in again');
    const updated=(await client.query(`UPDATE users SET password_hash=$1,password_changed_at=NOW(),must_change_password=FALSE,
      credential_version=credential_version+1,updated_at=NOW() WHERE id=$2 RETURNING *`,[newPasswordHash,userId])).rows[0];
    await client.query('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,NOW()) WHERE user_id=$1',[userId]);
    await client.query('DELETE FROM password_reset_tokens WHERE user_id=$1',[userId]);
    const tokens=!resetTokenHash&&user.must_change_password?await storeSession(client,updated,request,generateTokens):null;
    await client.query(`INSERT INTO audit_logs(user_id,action,resource_type,resource_id,description,new_values,ip_address,user_agent,success)
      VALUES($1,'update','user',$1,$2,$3::jsonb,$4,$5,TRUE)`,[userId,resetTokenHash?'reset_password':'change_password',JSON.stringify({credentialRotation:true,sessionFamiliesRevoked:true}),request.ip||null,request.get?.('user-agent')||null]);
    return {user:updated,tokens};
  });
  require('./socketService').revokeUserSessions(userId);
  require('../routes/openclawAdapter').revokeAdapterSessions(userId);
  return result;
}
module.exports={issueSession,rotateSession,revokeSession,assertCurrentSession,changeCredentials};
