'use client';

import { useEffect, useId, useState } from 'react';
import { usePathname } from 'next/navigation';
import { MapPin, Loader2, CheckCircle, Search } from 'lucide-react';
import { DoctaService } from '@/lib/doctaService';
import useCareLocation from '@/lib/useCareLocation';
import CareLocationPicker from '@/components/discovery/CareLocationPicker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';

export default function PharmacyLocator({ onSelect, includePrescriptionContacts = true }) {
  const pathname = usePathname();
  const market = pathname?.startsWith('/ng/') ? 'NG' : 'US';
  const careLocation = useCareLocation(market);
  const { location } = careLocation;
  const [result, setResult] = useState({ key: '', pharmacies: [], loading: false, error: '' });
  const [selectedPharmacy, setSelectedPharmacy] = useState(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  const fieldId = useId();
  const [manual, setManual] = useState({ name: '', address: '', phone: '', emailOrFax: '', whatsapp: '' });
  const searchKey = JSON.stringify({
    market, mode: location.mode, status: location.status,
    latitude: location.latitude, longitude: location.longitude, city: location.city,
    state: location.state, postalCode: location.postalCode, query, revision,
  });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setSelectedPharmacy(null);
    if (location.status !== 'ready') {
      setResult({ key: searchKey, pharmacies: [], loading: false, error: '' });
      return () => { cancelled = true; controller.abort(); };
    }
    setResult({ key: searchKey, pharmacies: [], loading: true, error: '' });
    DoctaService.findPharmacies({ market, location, query, signal: controller.signal })
      .then((pharmacies) => { if (!cancelled) setResult({ key: searchKey, pharmacies, loading: false, error: '' }); })
      .catch((error) => {
        if (!cancelled) setResult({
          key: searchKey, pharmacies: [], loading: false,
          error: error.code === 'POSTAL_AREA_UNSUPPORTED' || error.response?.data?.code === 'POSTAL_AREA_UNSUPPORTED'
            ? 'Postal-code search is not available for the Nigeria directory. Enter a city or state, or use your device location.'
            : 'The pharmacy directory could not be reached. Try again or enter pharmacy details below.',
        });
      });
    return () => { cancelled = true; controller.abort(); };
    // searchKey contains every location and submitted-query field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey]);

  const visibleResult = result.key === searchKey ? result : { pharmacies: [], loading: location.status === 'ready', error: '' };
  const manualArea = location.mode === 'manual' && location.status === 'ready';
  function handleSelectPharmacy(pharmacy) {
    setSelectedPharmacy(pharmacy);
    onSelect?.({ mode: 'geo', pharmacy });
    toast({ title: 'Pharmacy details selected', description: 'Contact the pharmacy to confirm availability. No prescription has been sent.' });
  }
  function handleSaveManual() {
    const details = Object.fromEntries(Object.entries(manual).map(([key, value]) => [key, value.trim()]));
    if (!details.name || !details.address) {
      toast({ title: 'Missing details', description: 'Pharmacy name and address are required.', variant: 'destructive' });
      return;
    }
    setSelectedPharmacy(null);
    onSelect?.({ mode: 'manual', pharmacy: { ...details, source: 'User-entered pharmacy details', verificationStatus: 'unverified_user_entry' } });
    toast({ title: 'Pharmacy details selected', description: 'No prescription, email, fax, or message has been sent.' });
  }

  return <div className="doctarx-portal space-y-5">
    <CareLocationPicker careLocation={careLocation} />
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-3"><MapPin className="h-5 w-5 text-blue-600" aria-hidden="true" />Find a pharmacy</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-base">
        <p className="leading-7 text-muted-foreground">Directory results contain recorded pharmacy details. Opening hours, licensing, stock, insurance participation, and prescription delivery have not been verified.</p>
        {manualArea && <p className="leading-7 text-slate-600">Results use the area you entered. Device coordinates are cleared; no address has been geocoded and distance is not calculated for this search.</p>}
        <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); setQuery(search.trim()); setRevision((value) => value + 1); }}>
          <div className="min-w-0 flex-1 space-y-2"><Label htmlFor={fieldId + '-search'}>Search the directory</Label><Input id={fieldId + '-search'} maxLength={120} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pharmacy name or area" /></div>
          <Button type="submit" variant="outline" disabled={location.status !== 'ready' || visibleResult.loading}><Search className="mr-2 h-5 w-5" aria-hidden="true" />Search</Button>
        </form>
        {location.status !== 'ready' && <p className="text-base text-slate-600">Use your device location or choose a home, work, or other area to search.</p>}
      </CardContent>
    </Card>

    {location.status === 'ready' && <Card>
      <CardHeader><CardTitle className="text-xl">Pharmacy directory results</CardTitle></CardHeader>
      <CardContent>
        {visibleResult.loading ? <p role="status" className="flex items-center gap-3 py-6 text-base"><Loader2 className="h-5 w-5 animate-spin text-blue-600" aria-hidden="true" />Searching the pharmacy directory…</p>
          : visibleResult.error ? <div className="portal-error"><p role="alert">{visibleResult.error}</p><Button variant="outline" className="mt-3" onClick={() => setRevision((value) => value + 1)}>Try again</Button></div>
            : !visibleResult.pharmacies.length ? <p className="text-base leading-7 text-muted-foreground">No pharmacies were returned for this search. You can enter pharmacy details below.</p>
              : <div className="space-y-3">{visibleResult.pharmacies.map((pharmacy) => <button key={pharmacy.id} type="button" onClick={() => handleSelectPharmacy(pharmacy)}
                className={'w-full rounded-xl border px-4 py-4 text-left transition-colors hover:bg-slate-50 ' + (selectedPharmacy?.id === pharmacy.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200')}>
                <div className="flex items-start justify-between gap-4"><div><p className="text-base font-semibold">{pharmacy.name}</p><p className="mt-2 text-base text-muted-foreground">{pharmacy.address}</p><p className="mt-2 text-base text-muted-foreground">{pharmacy.source} · Details not verified</p></div>
                  {selectedPharmacy?.id === pharmacy.id && <CheckCircle className="h-5 w-5 shrink-0 text-blue-600" aria-hidden="true" />}</div>
              </button>)}</div>}
      </CardContent>
    </Card>}

    <Card>
      <CardHeader><CardTitle className="text-xl">Enter pharmacy details</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-base">
        <p className="leading-7 text-muted-foreground">Enter details you have confirmed with the pharmacy. Selecting these details does not send a prescription.</p>
        {[
          ['name', 'Pharmacy name', 255], ['address', 'Pharmacy address', 1000],
          ...(includePrescriptionContacts
            ? [['emailOrFax', 'Email or fax (optional)', 255], ['whatsapp', 'WhatsApp number (optional)', 30]]
            : [['phone', 'Pharmacy phone (optional)', 30]]),
        ].map(([key, label, maxLength]) => <div key={key} className="space-y-2"><Label htmlFor={fieldId + '-' + key}>{label}</Label><Input id={fieldId + '-' + key} maxLength={maxLength} value={manual[key]}
          placeholder={key === 'whatsapp' ? 'Include country code' : undefined} onChange={(event) => setManual((old) => ({ ...old, [key]: event.target.value }))} /></div>)}
        <Button type="button" onClick={handleSaveManual}>Use these pharmacy details</Button>
      </CardContent>
    </Card>
  </div>;
}

