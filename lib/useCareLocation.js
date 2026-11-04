'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import locationPolicy from '@/lib/careLocation';

export default function useCareLocation(market = 'US') {
  const controller=useRef(null);
  const [location,setLocation]=useState({mode:'device',status:'idle',latitude:null,longitude:null,city:'',state:'',postalCode:'',label:'',error:''});
  useEffect(()=>{
    let storage;
    try { storage=window.sessionStorage; } catch {}
    const current=locationPolicy.createCareLocationController({market,geolocation:window.navigator.geolocation,storage});
    controller.current=current;
    const unsubscribe=current.subscribe(setLocation);
    current.start();
    return()=>{unsubscribe();current.destroy();if(controller.current===current)controller.current=null;};
  },[market]);
  const useDeviceLocation=useCallback(()=>controller.current?.requestDevice(),[]);
  const chooseArea=useCallback((area)=>{if(!controller.current)throw new Error('Location is still loading.');return controller.current.chooseManual(area);},[]);
  return {location,useDeviceLocation,chooseArea,params:locationPolicy.discoveryLocationParams(location)};
}
