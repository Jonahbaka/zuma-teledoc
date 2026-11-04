'use client';
import api from '@/lib/api';
import {authSessionGeneration,authTokenOwnerHint} from '@/lib/authSession';

export function installSocketSessionRefresh(socket) {
 let cancelled=false,busy=false;
 const owner=authTokenOwnerHint(socket.auth?.token);
 const refresh=async()=>{
  if(cancelled||busy)return;busy=true;const generation=authSessionGeneration();
  try{
   // The existing HTTP client serializes refresh and rejects account switches.
   // /auth/me forces expiry handling even when local storage has not rotated yet.
   await api.get('/auth/me');
   const token=localStorage.getItem('accessToken');
   if(cancelled||generation!==authSessionGeneration()||!owner||authTokenOwnerHint(token)!==owner)throw new Error('Session context changed');
   await new Promise((resolve,reject)=>{
    socket.timeout(20000).emit('auth:reauthenticate',{token},(error,result)=>error||!result?.ok?reject(error||new Error('Session refresh rejected')):resolve());
   });
   if(!cancelled)socket.auth={...socket.auth,token};
  }catch(_){if(!cancelled)socket.disconnect();}
  finally{busy=false;}
 };
 const cleanup=()=>{cancelled=true;socket.off('auth:refresh-required',refresh);socket.off('disconnect',onDisconnect);};
 const onDisconnect=reason=>{if(reason==='io client disconnect'||reason==='io server disconnect')cleanup();};
 socket.on('auth:refresh-required',refresh);socket.on('disconnect',onDisconnect);
 return cleanup;
}
