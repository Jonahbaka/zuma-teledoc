'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../../components/ng/conference/useConferenceSignaling.js'),'utf8');
function mediaCallback(navigator,ref,set){const start=source.indexOf('const acquireLocalMedia = useCallback(')+'const acquireLocalMedia = useCallback('.length;const end=source.indexOf(', []);',start);return new Function('navigator','localStreamRef','setLocalStream',`return (${source.slice(start,end)});`)(navigator,ref,set);}
test('late media permission result is stopped without overwriting a newer stream',async()=>{
 let resolve;let stopped=0,sets=0,cancelled=false;const old={getTracks:()=>[{stop(){stopped++;}}]},newer={id:'newer'};const ref={current:null};
 const acquire=mediaCallback({mediaDevices:{getUserMedia:()=>new Promise(r=>{resolve=r;})}},ref,()=>sets++);
 const result=acquire(()=>cancelled);cancelled=true;ref.current=newer;resolve(old);
 await assert.rejects(result,/cancelled/);assert.equal(stopped,1);assert.equal(sets,0);assert.equal(ref.current,newer);
});
test('cancelled camera failure never starts a second microphone permission request',async()=>{
 let reject,calls=0,cancelled=false;const acquire=mediaCallback({mediaDevices:{getUserMedia:()=>{calls++;return new Promise((_r,j)=>{reject=j;});}}},{current:null},()=>{});
 const result=acquire(()=>cancelled);cancelled=true;reject(new Error('synthetic camera denial'));await assert.rejects(result);assert.equal(calls,1);
});
test('active media acquisition retains audio-only fallback and publishes its stream once',async()=>{
 let calls=0,sets=0;const stream={getTracks:()=>[]},ref={current:null};const acquire=mediaCallback({mediaDevices:{getUserMedia:async()=>{if(++calls===1)throw new Error('synthetic camera denial');return stream;}}},ref,()=>sets++);
 assert.equal(await acquire(),stream);assert.equal(ref.current,stream);assert.equal(calls,2);assert.equal(sets,1);
});

function screenCallback(bindings){const start=source.indexOf('const startScreenShare = useCallback(')+'const startScreenShare = useCallback('.length;const end=source.indexOf(', [replaceVideoTrack]);',start);return new Function(...Object.keys(bindings),`return (${source.slice(start,end)});`)(...Object.values(bindings));}
test('screen picker settling after leave stops capture and repeated clicks open only one picker',async()=>{
 let resolve,calls=0,stops=0;const epoch={current:0};const stream={getTracks:()=>[{stop(){stops++;}}]};const screen={current:null};
 const start=screenCallback({navigator:{mediaDevices:{getDisplayMedia(){calls++;return new Promise(r=>{resolve=r;});}}},screenStreamRef:screen,screenRequestBusy:{current:false},mediaEpoch:epoch,socketRef:{current:{}},setScreenStream(){assert.fail('stale capture published');},setIsScreenSharing(){},replaceVideoTrack(){},localStreamRef:{current:null}});
 const pending=start();await start();assert.equal(calls,1);epoch.current++;resolve(stream);await pending;assert.equal(stops,1);assert.equal(screen.current,null);
});
test('active screen sharing publishes track and restores camera when sharing ends',async()=>{
 let ended,sharing,shown;const replacement=[];const track={addEventListener(name,callback){assert.equal(name,'ended');ended=callback;}};const stream={getVideoTracks:()=>[track]};const camera={};const screen={current:null};
 const start=screenCallback({navigator:{mediaDevices:{getDisplayMedia:async()=>stream}},screenStreamRef:screen,screenRequestBusy:{current:false},mediaEpoch:{current:0},socketRef:{current:{}},setScreenStream(value){shown=value;},setIsScreenSharing(value){sharing=value;},replaceVideoTrack(value){replacement.push(value);},localStreamRef:{current:{getVideoTracks:()=>[camera]}}});
 await start();assert.equal(screen.current,stream);assert.equal(shown,stream);assert.equal(sharing,true);assert.deepEqual(replacement,[track]);ended();assert.equal(screen.current,null);assert.equal(sharing,false);assert.deepEqual(replacement,[track,camera]);
});
