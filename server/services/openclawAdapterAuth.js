'use strict';
const crypto=require('node:crypto');const jwt=require('jsonwebtoken');
const defaultDb=require('../db');const {assertCurrentSession}=require('./authSessionService');
function createAdapterAuthenticator({db=defaultDb,env=process.env}={}) {
 return async token=>{
  if(typeof token!=='string'||!token||token.length>8192)return{ok:false,error:'Credentials required'};
  try{
   // This operator interface never substitutes a published/default credential.
   const gateway=env.OPENCLAW_GATEWAY_TOKEN;
   if(typeof gateway==='string'&&gateway.length>=32){
    const supplied=Buffer.from(token),expected=Buffer.from(gateway);
    if(supplied.length===expected.length&&crypto.timingSafeEqual(supplied,expected))return{ok:true,role:'operator',userId:'gateway',isGateway:true};
   }
   // Raw adapter user sessions require the explicitly configured access key.
   // Missing configuration is unavailable, not a development-secret fallback.
   if(!env.JWT_ACCESS_SECRET)return{ok:false,error:'Authentication unavailable'};
   const claims=jwt.verify(token,env.JWT_ACCESS_SECRET,{algorithms:['HS256']});
   if(!Number.isFinite(claims.exp)||claims.exp*1000<=Date.now())return{ok:false,error:'Invalid or expired credentials'};
   const id=claims.userId||claims.id||claims.sub;
   if(typeof id!=='string'||! /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id))return{ok:false,error:'Invalid credentials'};
   const user=(await db.query('SELECT id,role,is_active,credential_version FROM users WHERE id=$1',[id])).rows[0];
   await assertCurrentSession(db,claims,user);
   return{ok:true,role:user.role,userId:user.id,sessionId:claims.sessionId||null};
  }catch(_){return{ok:false,error:'Invalid or expired credentials'};}
 };
}
module.exports={createAdapterAuthenticator};
