'use strict';
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
// No implicit global broadcast, including to operators. A future caller must
// authorize its payload/care scope and supply explicit recipient account IDs.
async function deliverScopedAdapterEvent({sessions,event,payload,recipientUserIds,send}) {
 if(!Array.isArray(recipientUserIds)||!recipientUserIds.length||recipientUserIds.length>100||recipientUserIds.some(id=>typeof id!=='string'||!UUID.test(id)))return{ok:false,queued:0,error:'EXPLICIT_RECIPIENTS_REQUIRED'};
 const allowed=new Set(recipientUserIds);let queued=0;
 for(const session of sessions){
  if(!allowed.has(session.userId))continue;
  try{
   if(await session.validateSession()){if(send(session.ws,event,payload)===true)queued++;}
   else session.ws.close(4001,'Unauthorized');
  }catch(_){session.ws.close(4001,'Unauthorized');}
 }
 return{ok:true,queued};
}
module.exports={deliverScopedAdapterEvent};
