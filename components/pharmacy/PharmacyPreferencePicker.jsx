 'use client';
 
 import { useEffect, useMemo, useState } from 'react';
 import { LocateFixed, MapPin, Phone, Search, Star, Loader2 } from 'lucide-react';
 import api from '@/lib/api';
 import { Button } from '@/components/ui/button';
 import { Input } from '@/components/ui/input';
 import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
 import { toast } from '@/components/ui/use-toast';
 
 function normalizePharmacy(p) {
   return {
     id: p.id,
     name: p.name || p.pharmacyName || 'Pharmacy',
     address: p.address || p.pharmacyAddress || '',
     phone: p.phone || p.pharmacyPhone || null,
     latitude: p.latitude ?? null,
     longitude: p.longitude ?? null,
     distanceMiles: p.distanceMiles ?? p.distance_miles ?? null,
     isPreferred: !!(p.isPreferred ?? p.is_preferred),
     source: p.source || null
   };
 }
 
 export default function PharmacyPreferencePicker({ title = 'Preferred Pharmacy' }) {
   const [loadingPrefs, setLoadingPrefs] = useState(true);
   const [saving, setSaving] = useState(false);
   const [locating, setLocating] = useState(false);
   const [loadingNearby, setLoadingNearby] = useState(false);
   const [loadingSearch, setLoadingSearch] = useState(false);
 
   const [prefs, setPrefs] = useState([]);
   const [nearby, setNearby] = useState([]);
   const [searchQuery, setSearchQuery] = useState('');
   const [searchResults, setSearchResults] = useState([]);
 
   const [coords, setCoords] = useState(null); // { latitude, longitude, source }
 
   const preferred = useMemo(
     () => prefs.find(p => p.isPreferred) || null,
     [prefs]
   );
 
   const loadPreferences = async () => {
     setLoadingPrefs(true);
     try {
       const res = await api.get('/pharmacy/preferences');
       if (res.data?.success) {
         setPrefs((res.data.pharmacies || []).map(normalizePharmacy));
       }
     } catch (e) {
       toast({
         title: 'Error',
         description: 'Failed to load pharmacy preferences',
         variant: 'destructive'
       });
     } finally {
       setLoadingPrefs(false);
     }
   };
 
   useEffect(() => {
     loadPreferences();
   }, []);
 
   const requestDeviceLocation = async () => {
     setLocating(true);
     try {
       if (!navigator.geolocation) {
         throw new Error('Geolocation not supported');
       }
 
       await new Promise((resolve, reject) => {
         navigator.geolocation.getCurrentPosition(
           (pos) => resolve(pos),
           (err) => reject(err),
           { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
         );
       }).then((pos) => {
         setCoords({
           latitude: pos.coords.latitude,
           longitude: pos.coords.longitude,
           source: 'device'
         });
       });
 
       toast({
         title: 'Location detected',
         description: 'Using your device location to find nearby pharmacies.'
       });
     } catch (err) {
       toast({
         title: 'Location denied or unavailable',
         description: 'Please allow location access, or use Search below.',
         variant: 'destructive'
       });
     } finally {
       setLocating(false);
     }
   };
 
   const loadNearby = async () => {
     if (!coords?.latitude || !coords?.longitude) return;
     setLoadingNearby(true);
     try {
       const res = await api.get('/pharmacy/nearby', {
         params: { latitude: coords.latitude, longitude: coords.longitude, radius: 5000 }
       });
       if (res.data?.success) {
         setNearby((res.data.pharmacies || []).map(normalizePharmacy));
       } else {
         throw new Error(res.data?.error || 'Failed');
       }
     } catch (e) {
       toast({
         title: 'Error',
         description: 'Failed to load nearby pharmacies',
         variant: 'destructive'
       });
     } finally {
       setLoadingNearby(false);
     }
   };
 
   useEffect(() => {
     if (coords) loadNearby();
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [coords?.latitude, coords?.longitude]);
 
   const runSearch = async () => {
     const q = searchQuery.trim();
     if (q.length < 2) return;
     setLoadingSearch(true);
     try {
       const res = await api.get('/pharmacy/search', {
         params: {
           q,
           latitude: coords?.latitude ?? undefined,
           longitude: coords?.longitude ?? undefined,
           limit: 20
         }
       });
       if (res.data?.success) {
         setSearchResults((res.data.pharmacies || []).map(normalizePharmacy));
       } else {
         throw new Error(res.data?.error || 'Failed');
       }
     } catch (e) {
       toast({
         title: 'Error',
         description: 'Failed to search pharmacies',
         variant: 'destructive'
       });
     } finally {
       setLoadingSearch(false);
     }
   };
 
   const savePreferred = async (pharmacy) => {
     setSaving(true);
     try {
       const payload = {
         pharmacyName: pharmacy.name,
         pharmacyAddress: pharmacy.address || '',
         pharmacyPhone: pharmacy.phone || undefined,
         pharmacyNpi: undefined,
         latitude: pharmacy.latitude ?? undefined,
         longitude: pharmacy.longitude ?? undefined,
         distanceMiles: pharmacy.distanceMiles ?? undefined,
         isPreferred: true,
         source: coords?.source === 'device' ? 'gps_located' : 'patient_selected'
       };
 
       const res = await api.post('/pharmacy/preferences', payload);
       if (!res.data?.success) throw new Error(res.data?.error || 'Failed');
 
       toast({
         title: 'Preferred pharmacy saved',
         description: pharmacy.name
       });
 
       await loadPreferences();
     } catch (e) {
       toast({
         title: 'Error',
         description: e.response?.data?.error || e.message || 'Failed to save pharmacy',
         variant: 'destructive'
       });
     } finally {
       setSaving(false);
     }
   };
 
   const renderPharmacyRow = (p) => (
     <div key={p.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
       <div className="min-w-0">
         <div className="flex items-center gap-2">
           <p className="font-medium text-foreground truncate">{p.name}</p>
           {p.isPreferred && (
             <span className="inline-flex items-center gap-1 text-xs text-amber-600">
               <Star className="h-3 w-3 fill-amber-500 text-amber-500" /> Preferred
             </span>
           )}
         </div>
         {p.address ? (
           <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
             <MapPin className="h-4 w-4" />
             <span className="truncate">{p.address}</span>
           </p>
         ) : null}
         <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
           {typeof p.distanceMiles === 'number' ? (
             <span>{p.distanceMiles} mi</span>
           ) : null}
           {p.phone ? (
             <span className="inline-flex items-center gap-1">
               <Phone className="h-3 w-3" /> {p.phone}
             </span>
           ) : null}
           {p.source ? <span className="uppercase">{p.source}</span> : null}
         </div>
       </div>
       <Button
         size="sm"
         variant="outline"
         disabled={saving}
         onClick={() => savePreferred(p)}
       >
         Set Preferred
       </Button>
     </div>
   );
 
   return (
     <Card>
       <CardHeader>
         <CardTitle className="flex items-center justify-between gap-3">
           <span>{title}</span>
           <Button
             type="button"
             size="sm"
             variant="outline"
             onClick={requestDeviceLocation}
             disabled={locating}
           >
             {locating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <LocateFixed className="h-4 w-4 mr-2" />}
             Use my location
           </Button>
         </CardTitle>
       </CardHeader>
       <CardContent className="space-y-4">
         {loadingPrefs ? (
           <div className="flex items-center gap-2 text-muted-foreground">
             <Loader2 className="h-4 w-4 animate-spin" /> Loading preferences…
           </div>
         ) : preferred ? (
           <div className="rounded-lg border border-border p-3 bg-muted/30">
             <p className="text-sm text-muted-foreground mb-1">Current preferred pharmacy</p>
             <p className="font-medium text-foreground">{preferred.name}</p>
             {preferred.address ? <p className="text-sm text-muted-foreground">{preferred.address}</p> : null}
           </div>
         ) : (
           <p className="text-sm text-muted-foreground">No preferred pharmacy selected yet.</p>
         )}
 
         <div className="space-y-2">
           <div className="flex items-center gap-2">
             <div className="relative flex-1">
               <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
               <Input
                 value={searchQuery}
                 onChange={(e) => setSearchQuery(e.target.value)}
                 placeholder="Search pharmacy by name or city (e.g., CVS, Walgreens, Miami)"
                 className="pl-9"
               />
             </div>
             <Button type="button" onClick={runSearch} disabled={loadingSearch || searchQuery.trim().length < 2}>
               {loadingSearch ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
             </Button>
           </div>
           <p className="text-xs text-muted-foreground">
             We only use your location to fetch nearby pharmacies when you click “Use my location”.
           </p>
         </div>
 
         {coords && (
           <div className="text-xs text-muted-foreground">
             Location source: <span className="font-medium">{coords.source}</span> • Lat {coords.latitude.toFixed(4)}, Lon {coords.longitude.toFixed(4)}
           </div>
         )}
 
         {coords && (
           <div className="space-y-2">
             <div className="flex items-center justify-between">
               <p className="text-sm font-medium text-foreground">Nearby pharmacies (real-time)</p>
               {loadingNearby ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
             </div>
             <div className="space-y-2">
               {nearby.length > 0 ? nearby.map(renderPharmacyRow) : (
                 <p className="text-sm text-muted-foreground">No nearby pharmacies found.</p>
               )}
             </div>
           </div>
         )}
 
         {searchResults.length > 0 && (
           <div className="space-y-2">
             <p className="text-sm font-medium text-foreground">Search results</p>
             <div className="space-y-2">
               {searchResults.map(renderPharmacyRow)}
             </div>
           </div>
         )}
       </CardContent>
     </Card>
   );
 }


