'use strict';

const KEY_PREFIX = 'doctarx-care-location:';
function coordinates(value) {
  const latitude = Number(value?.latitude), longitude = Number(value?.longitude);
  if (value?.latitude == null || value?.longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) throw new Error('A valid device location is required.');
  return { latitude, longitude };
}
function manualArea(value) {
  const clean = (name, length) => String(value?.[name] || '').trim().slice(0,length);
  const area = { city:clean('city',120),state:clean('state',120),postalCode:clean('postalCode',20),label:['Home','Work','Another area'].includes(value?.label) ? value.label : 'Another area' };
  if (!area.city && !area.state && !area.postalCode) throw new Error('Enter a city, region, or postal code.');
  return area;
}
function discoveryLocationParams(location) {
  if (location?.mode === 'device' && location.status === 'ready') return coordinates(location);
  if (location?.mode === 'manual' && location.status === 'ready') {
    const area = manualArea(location);
    return Object.fromEntries(Object.entries({city:area.city,state:area.state,postalCode:area.postalCode}).filter(([,value])=>value));
  }
  return {};
}
function createCareLocationController({ geolocation, storage, market = 'US' } = {}) {
  const key=KEY_PREFIX+market.toUpperCase();
  let state={mode:'device',status:'idle',latitude:null,longitude:null,city:'',state:'',postalCode:'',label:'',error:''};
  let generation=0;
  const listeners=new Set();
  const publish=(next)=>{state=next;for(const listener of listeners)listener(state);return state;};
  const controller={
    getState:()=>state,
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    async start(){
      try { const saved=JSON.parse(storage?.getItem(key) || 'null'); if(saved?.mode==='manual')return controller.chooseManual(saved); } catch {}
      return controller.requestDevice();
    },
    chooseManual(value){
      const area=manualArea(value);generation++;
      const next={...area,mode:'manual',status:'ready',latitude:null,longitude:null,error:''};
      try {storage?.setItem(key,JSON.stringify({mode:'manual',...area}));} catch {}
      return publish(next);
    },
    requestDevice(){
      const request=++generation;
      try {storage?.removeItem(key);} catch {}
      publish({...state,mode:'device',status:'locating',latitude:null,longitude:null,error:''});
      return new Promise(resolve=>{
        const unavailable=()=>{if(request!==generation)return resolve(state);resolve(publish({...state,mode:'device',status:'unavailable',latitude:null,longitude:null,error:'Device location is unavailable. Choose an area to continue.'}));};
        if(!geolocation?.getCurrentPosition)return unavailable();
        geolocation.getCurrentPosition(position=>{
          if(request!==generation)return resolve(state);
          try {const point=coordinates(position.coords);resolve(publish({...state,...point,mode:'device',status:'ready',city:'',state:'',postalCode:'',label:'Near your device',error:''}));} catch {unavailable();}
        },unavailable,{enableHighAccuracy:false,maximumAge:60000,timeout:10000});
      });
    },
    destroy(){generation++;listeners.clear();},
  };
  return controller;
}
module.exports={coordinates,manualArea,discoveryLocationParams,createCareLocationController};
