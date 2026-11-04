'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createCareLocationController,discoveryLocationParams,coordinates}=require('../..//lib/careLocation');

function storage(){const rows=new Map();return{getItem:key=>rows.get(key),setItem:(key,value)=>rows.set(key,value),removeItem:key=>rows.delete(key)};}
test('device discovery uses real coordinates including zero and rejects invalid values',async()=>{
  const controller=createCareLocationController({geolocation:{getCurrentPosition:success=>success({coords:{latitude:0,longitude:0}})}});
  await controller.start();assert.deepEqual(discoveryLocationParams(controller.getState()),{latitude:0,longitude:0});
  for(const value of [{latitude:91,longitude:0},{latitude:0,longitude:181},{latitude:null,longitude:0},{latitude:'x',longitude:0}])assert.throws(()=>coordinates(value));
});
test('denied geolocation provides no invented area or coordinates',async()=>{
  const controller=createCareLocationController({geolocation:{getCurrentPosition:(_success,failure)=>failure({code:1})}});
  await controller.start();assert.equal(controller.getState().status,'unavailable');assert.deepEqual(discoveryLocationParams(controller.getState()),{});
});
test('manual home/work area excludes device coordinates and survives the session',async()=>{
  const saved=storage();let requested=false;
  const controller=createCareLocationController({storage:saved,geolocation:{getCurrentPosition:()=>{requested=true;}}});
  controller.chooseManual({city:'Brooklyn',state:'New York',label:'Work'});
  const restored=createCareLocationController({storage:saved,geolocation:{getCurrentPosition:()=>{requested=true;}}});
  await restored.start();assert.equal(requested,false);assert.equal(restored.getState().label,'Work');
  assert.deepEqual(discoveryLocationParams(restored.getState()),{city:'Brooklyn',state:'New York'});assert.equal(restored.getState().latitude,null);
});
test('a late GPS response cannot overwrite a newer manual selection or destroyed view',async()=>{
  let received;const controller=createCareLocationController({geolocation:{getCurrentPosition:success=>{received=success;}}});
  const pending=controller.requestDevice();controller.chooseManual({city:'Abuja',label:'Home'});received({coords:{latitude:40,longitude:-73}});await pending;
  assert.equal(controller.getState().mode,'manual');assert.equal(controller.getState().city,'Abuja');assert.deepEqual(discoveryLocationParams(controller.getState()),{city:'Abuja'});
  let published=0;controller.subscribe(()=>published++);const abandoned=controller.requestDevice();controller.destroy();const prior=published;received({coords:{latitude:40,longitude:-73}});await abandoned;assert.equal(published,prior);
});
