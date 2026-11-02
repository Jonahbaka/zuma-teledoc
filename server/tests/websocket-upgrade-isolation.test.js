'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const http=require('node:http');
const {Server}=require('socket.io');const {io}=require('socket.io-client');const WebSocket=require('ws');
const {initOpenClawAdapter}=require('../routes/openclawAdapter');
test('real Socket.IO and OpenClaw upgrades share one HTTP server without corrupting frames', {timeout:10000},async()=>{
 const server=http.createServer((_req,res)=>res.end('synthetic'));
 const sockets=new Server(server);const adapter=initOpenClawAdapter(server);let client,raw;
 sockets.on('connection',socket=>socket.emit('synthetic:ready',{ok:true}));
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  client=io(base,{transports:['websocket'],reconnection:false,timeout:2000});
  const result=await new Promise((resolve,reject)=>{client.once('synthetic:ready',resolve);client.once('connect_error',reject);});assert.deepEqual(result,{ok:true});
  raw=new WebSocket(base.replace('http:','ws:')+'/openclaw');
  const challenge=await new Promise((resolve,reject)=>{raw.once('message',data=>resolve(JSON.parse(data)));raw.once('error',reject);});assert.ok(challenge.nonce);
  // Route isolation must not bypass the adapter's own authentication.
  raw.send(JSON.stringify({type:'req',id:'synthetic-connect',method:'connect',params:{}}));
  const denied=await new Promise(resolve=>raw.once('message',data=>resolve(JSON.parse(data))));assert.equal(denied.ok,false);
 }finally{client?.disconnect();raw?.terminate();for(const socket of adapter.clients)socket.terminate();await new Promise(resolve=>adapter.close(resolve));await new Promise(resolve=>sockets.close(resolve));if(server.listening)await new Promise(resolve=>server.close(resolve));}
});
