'use client';

import { useId, useState } from 'react';
import { MapPin, Navigation } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function CareLocationPicker({ careLocation, compact = false }) {
  const {location,useDeviceLocation: requestDeviceLocation,chooseArea}=careLocation;
  const formId=useId();
  const [open,setOpen]=useState(false);
  const [draft,setDraft]=useState({city:'',state:'',postalCode:'',label:'Another area'});
  const [error,setError]=useState('');
  const description=location.status==='locating' ? 'Finding your device location…' : location.mode==='manual' ? `${location.label}: ${[location.city,location.state,location.postalCode].filter(Boolean).join(', ')}` : location.status==='ready' ? 'Using your device location' : 'Choose an area for nearby results';
  function submit(event){event.preventDefault();try{chooseArea(draft);setError('');setOpen(false);}catch(failure){setError(failure.message);}}
  return <section aria-label="Care discovery location" className={compact ? 'rounded-2xl border border-slate-200 bg-white p-4' : 'rounded-3xl border border-slate-200 bg-white p-5 sm:p-6'}>
    <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-start gap-3"><MapPin className="mt-1 h-5 w-5 shrink-0 text-blue-700" aria-hidden="true" /><div><p className="font-semibold text-slate-950">{description}</p><p className="mt-1 leading-6 text-slate-600">Browse near you, home, work, or another area.</p></div></div><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={location.status==='locating'} onClick={()=>{setError('');requestDeviceLocation();}}><Navigation className="mr-2 h-4 w-4" aria-hidden="true" />Use my location</Button><Button type="button" variant="outline" aria-expanded={open} onClick={()=>{setDraft({city:location.city||'',state:location.state||'',postalCode:location.postalCode||'',label:location.mode==='manual'?location.label:'Another area'});setOpen(value=>!value);}}>Change location</Button></div></div>
    {location.error && <p role="status" className="mt-3 leading-6 text-slate-600">{location.error}</p>}
    {open && <form className="mt-5 grid gap-4 border-t border-slate-200 pt-5 sm:grid-cols-2" onSubmit={submit}><label className="block font-medium" htmlFor={formId+'-label'}>Search near<select id={formId+'-label'} className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base" value={draft.label} onChange={event=>setDraft(old=>({...old,label:event.target.value}))}><option>Another area</option><option>Home</option><option>Work</option></select></label>{[['city','City or town',120],['state','State or region',120],['postalCode','Postal code',20]].map(([key,label,max])=><label key={key} className="block font-medium" htmlFor={formId+'-'+key}>{label}<input id={formId+'-'+key} className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base" maxLength={max} value={draft[key]} onChange={event=>setDraft(old=>({...old,[key]:event.target.value}))} autoComplete={key==='postalCode'?'postal-code':key==='city'?'address-level2':'address-level1'} /></label>)}{error&&<p role="alert" className="text-red-700 sm:col-span-2">{error}</p>}<div className="flex flex-wrap gap-3 sm:col-span-2"><Button className="bg-blue-600 text-white hover:bg-blue-700" type="submit">Use this area</Button><Button type="button" variant="outline" onClick={()=>setOpen(false)}>Cancel</Button></div></form>}
  </section>;
}
