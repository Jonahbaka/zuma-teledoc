'use client';
import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { deliveryError } from '@/lib/ngDeliveryApi';
import { DeliveryNotice, deliveryButtonClass } from './DeliveryPresentation';

export default function MedicationFhirExport({ orderId }) {
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const lock=useRef(false);const active=useRef(false);const controller=useRef(null);
  useEffect(()=>{active.current=true;return()=>{active.current=false;controller.current?.abort();};},[orderId]);
  const download=async()=>{
    if(lock.current || !active.current)return;
    lock.current=true;setBusy(true);setError('');const abort=new AbortController();controller.current=abort;
    try {
      const response=await api.get(`/ng/medication-fhir/Bundle/${encodeURIComponent(orderId)}`,{signal:abort.signal,headers:{Accept:'application/fhir+json'}});
      if(response.data?.resourceType!=='Bundle' || response.data.id!==orderId || response.data.type!=='collection' || !Array.isArray(response.data.entry))throw new Error('The medication exchange record could not be confirmed.');
      if(!active.current || abort.signal.aborted)return;
      const url=URL.createObjectURL(new Blob([JSON.stringify(response.data,null,2)],{type:'application/fhir+json'}));
      const anchor=document.createElement('a');anchor.href=url;anchor.download=`DoctaRx-medication-${orderId}.json`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(failure){if(active.current && !abort.signal.aborted)setError(deliveryError(failure,'The FHIR medication record is temporarily unavailable.'));}
    finally{lock.current=false;if(active.current)setBusy(false);}
  };
  return <div className="mt-5 space-y-3 border-t border-slate-200 pt-5"><Button variant="outline" type="button" disabled={busy} className={deliveryButtonClass} onClick={download}><Download className="mr-2 h-5 w-5" aria-hidden="true" />{busy?'Preparing protected record…':'Export FHIR medication record'}</Button><p className="leading-7 text-slate-600">Downloads a private HL7 FHIR R4 record for this order. Share it only with an authorized care team or pharmacy.</p><DeliveryNotice error>{error}</DeliveryNotice></div>;
}
