'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Building2,
  CheckCircle,
  Clock,
  MapPin,
  Navigation,
  Package,
  Phone,
  Pill,
  Search,
  ShieldCheck,
  Star,
  Trash2,
  Truck,
} from 'lucide-react';
import { pharmacyAPI, prescriptionAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/use-toast';
import { formatDateTime } from '@/lib/utils';

const STATUS_CONFIG = {
  draft: { label: 'Draft', tone: 'bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300' },
  sent: { label: 'Sent', tone: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' },
  ready: { label: 'Ready', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300' },
  picked_up: { label: 'Picked Up', tone: 'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300' },
  delivered: { label: 'Delivered', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300' },
  cancelled: { label: 'Cancelled', tone: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' },
};

function formatPrescriptionDate(value) {
  if (!value) return 'Date unavailable';
  return formatDateTime(value);
}

function formatPharmacyDistance(pharmacy) {
  if (pharmacy?.distanceMiles) return `${pharmacy.distanceMiles} mi`;
  if (pharmacy?.distanceKm) return `${pharmacy.distanceKm} km`;
  return 'Distance unavailable';
}

function getPreferenceKey(pharmacy) {
  return pharmacy?.pharmacyNpi || pharmacy?.npi || `${pharmacy?.pharmacyName || pharmacy?.name}-${pharmacy?.pharmacyAddress || pharmacy?.address}`;
}

export default function PatientPharmacyPage() {
  const [tab, setTab] = useState('prescriptions');
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [savingKey, setSavingKey] = useState(null);
  const [search, setSearch] = useState('');
  const [prescriptions, setPrescriptions] = useState([]);
  const [preferences, setPreferences] = useState([]);
  const [results, setResults] = useState([]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [prescriptionsRes, preferencesRes] = await Promise.all([
        prescriptionAPI.getAll().catch(() => ({ data: { success: false, prescriptions: [] } })),
        pharmacyAPI.getPreferences().catch(() => ({ data: { success: false, pharmacies: [] } })),
      ]);

      setPrescriptions(prescriptionsRes.data?.success ? prescriptionsRes.data.prescriptions || [] : []);
      setPreferences(preferencesRes.data?.success ? preferencesRes.data.pharmacies || [] : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const savedPreferenceKeys = useMemo(() => new Set(preferences.map(getPreferenceKey)), [preferences]);

  const handleSearch = async () => {
    const query = search.trim();
    if (query.length < 2) {
      setResults([]);
      toast({ title: 'Search too short', description: 'Enter at least 2 characters to search pharmacies.', variant: 'destructive' });
      return;
    }

    setSearching(true);
    try {
      const response = await pharmacyAPI.search(query);
      setResults(response.data?.pharmacies || []);
      setTab('find');
    } catch (error) {
      toast({ title: 'Search failed', description: error.response?.data?.error || 'Could not search pharmacies right now.', variant: 'destructive' });
    } finally {
      setSearching(false);
    }
  };

  const handleUseLocation = async () => {
    if (!navigator.geolocation) {
      toast({ title: 'Location unavailable', description: 'This browser does not support location-based pharmacy search.', variant: 'destructive' });
      return;
    }

    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const response = await pharmacyAPI.findNearby(position.coords.latitude, position.coords.longitude, 10000);
          setResults(response.data?.pharmacies || []);
          setTab('find');
        } catch (error) {
          toast({ title: 'Location search failed', description: error.response?.data?.error || 'Could not load nearby pharmacies.', variant: 'destructive' });
        } finally {
          setGeoLoading(false);
        }
      },
      () => {
        setGeoLoading(false);
        toast({ title: 'Location permission denied', description: 'Enable location access to find nearby pharmacies.', variant: 'destructive' });
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSavePreference = async (pharmacy) => {
    const key = getPreferenceKey(pharmacy);
    setSavingKey(key);
    try {
      await pharmacyAPI.addPreference({
        pharmacyName: pharmacy.name,
        pharmacyAddress: pharmacy.address,
        pharmacyPhone: pharmacy.phone || undefined,
        pharmacyNpi: pharmacy.npi || undefined,
        latitude: pharmacy.latitude || undefined,
        longitude: pharmacy.longitude || undefined,
        distanceMiles: pharmacy.distanceMiles || undefined,
        isPreferred: preferences.length === 0,
        source: 'patient_selected',
      });
      toast({ title: 'Pharmacy saved', description: `${pharmacy.name} is now in your pharmacy preferences.` });
      await loadData();
    } catch (error) {
      toast({ title: 'Could not save pharmacy', description: error.response?.data?.error || 'Try again in a moment.', variant: 'destructive' });
    } finally {
      setSavingKey(null);
    }
  };

  const handleSetPreferred = async (id) => {
    setSavingKey(id);
    try {
      await pharmacyAPI.setPreferred(id);
      toast({ title: 'Preferred pharmacy updated', description: 'Your preferred pharmacy has been saved.' });
      await loadData();
    } catch (error) {
      toast({ title: 'Could not update preference', description: error.response?.data?.error || 'Try again in a moment.', variant: 'destructive' });
    } finally {
      setSavingKey(null);
    }
  };

  const handleRemovePreference = async (id) => {
    setSavingKey(id);
    try {
      await pharmacyAPI.removePreference(id);
      toast({ title: 'Pharmacy removed', description: 'The pharmacy was removed from your saved list.' });
      await loadData();
    } catch (error) {
      toast({ title: 'Could not remove pharmacy', description: error.response?.data?.error || 'Try again in a moment.', variant: 'destructive' });
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-foreground">Pharmacy &amp; Medications</h1>
        <p className="text-muted-foreground mt-1">Search pharmacies, save your preferences, and review live prescription routing without seeded records.</p>
      </div>

      <div className="flex gap-2 border-b border-border pb-0 overflow-x-auto">
        {[
          { key: 'prescriptions', label: 'Prescriptions', icon: Pill },
          { key: 'preferences', label: 'Saved Pharmacies', icon: Building2 },
          { key: 'find', label: 'Find Pharmacy', icon: MapPin },
        ].map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-[1px] ${tab === item.key ? 'border-purple-600 text-purple-600' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            <item.icon size={16} /> {item.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by pharmacy name or address..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSearch();
              }
            }}
            className="pl-9"
          />
        </div>
        <Button variant="outline" onClick={handleUseLocation} disabled={geoLoading}>
          <Navigation className="w-4 h-4 mr-2" />
          {geoLoading ? 'Locating...' : 'Use My Location'}
        </Button>
        <Button className="bg-purple-600 hover:bg-purple-500 text-white" onClick={handleSearch} disabled={searching}>
          {searching ? 'Searching...' : 'Search'}
        </Button>
      </div>

      {tab === 'prescriptions' && (
        <div className="space-y-4">
          {loading ? (
            <div className="space-y-3">{[1, 2].map((item) => <div key={item} className="h-28 rounded-xl bg-muted animate-pulse" />)}</div>
          ) : prescriptions.length === 0 ? (
            <Card><CardContent className="p-8 text-center"><Pill className="w-14 h-14 mx-auto mb-4 text-muted-foreground/50" /><p className="font-semibold text-foreground">No live prescriptions found.</p><p className="mt-2 text-sm text-muted-foreground">When a provider creates or routes prescriptions for your account, they will appear here.</p></CardContent></Card>
          ) : (
            prescriptions.map((prescription) => {
              const status = STATUS_CONFIG[prescription.status] || STATUS_CONFIG.draft;
              return (
                <Card key={prescription.id} className="hover:border-purple-500/20 transition-colors">
                  <CardContent className="p-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1">
                        <div className="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center shrink-0"><Pill size={18} className="text-purple-500" /></div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap"><span className="text-sm font-bold text-foreground">{prescription.medicationName || 'Medication pending'}</span><span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${status.tone}`}>{status.label}</span></div>
                          <div className="text-xs text-muted-foreground mt-0.5">{prescription.providerFirstName ? `Dr. ${prescription.providerFirstName} ${prescription.providerLastName || ''}`.trim() : 'Provider pending'} | {formatPrescriptionDate(prescription.createdAt || prescription.created_at)}</div>
                          <div className="text-xs text-muted-foreground mt-1">{prescription.dosageStrength || 'Dose pending'} {prescription.dosageForm || ''}{prescription.pharmacyName ? ` | Routed to ${prescription.pharmacyName}` : ' | Pharmacy selection pending'}</div>
                        </div>
                      </div>
                      <Link href="/patient/prescriptions"><Button variant="outline" size="sm">Open Activity <ArrowRight className="w-4 h-4 ml-2" /></Button></Link>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}

      {tab === 'preferences' && (
        <div className="space-y-4">
          {loading ? (
            <div className="space-y-3">{[1, 2].map((item) => <div key={item} className="h-24 rounded-xl bg-muted animate-pulse" />)}</div>
          ) : preferences.length === 0 ? (
            <Card><CardContent className="p-8 text-center"><Building2 className="w-14 h-14 mx-auto mb-4 text-muted-foreground/50" /><p className="font-semibold text-foreground">No saved pharmacy preferences yet.</p><p className="mt-2 text-sm text-muted-foreground">Search pharmacies above to save a preferred location for future routing.</p></CardContent></Card>
          ) : (
            preferences.map((pharmacy) => (
              <Card key={pharmacy.id} className="hover:border-purple-500/20 transition-colors">
                <CardContent className="p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1">
                      <div className="w-12 h-12 bg-purple-500/10 rounded-xl flex items-center justify-center shrink-0"><Building2 size={22} className="text-purple-500" /></div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap"><div className="text-sm font-bold text-foreground">{pharmacy.pharmacyName || pharmacy.pharmacy_name}</div>{(pharmacy.isPreferred || pharmacy.is_preferred) && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"><CheckCircle size={10} /> Preferred</span>}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1"><MapPin size={10} /> {pharmacy.pharmacyAddress || pharmacy.pharmacy_address}</div>
                        {(pharmacy.pharmacyPhone || pharmacy.pharmacy_phone) && <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1"><Phone size={10} /> {pharmacy.pharmacyPhone || pharmacy.pharmacy_phone}</div>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!(pharmacy.isPreferred || pharmacy.is_preferred) && <Button variant="outline" size="sm" onClick={() => handleSetPreferred(pharmacy.id)} disabled={savingKey === pharmacy.id}>Make Preferred</Button>}
                      <Button variant="outline" size="sm" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => handleRemovePreference(pharmacy.id)} disabled={savingKey === pharmacy.id}><Trash2 className="w-4 h-4 mr-2" /> Remove</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {tab === 'find' && (
        <div className="space-y-4">
          {results.length === 0 ? (
            <Card><CardContent className="p-8 text-center"><MapPin className="w-14 h-14 mx-auto mb-4 text-muted-foreground/50" /><p className="font-semibold text-foreground">No pharmacy search results yet.</p><p className="mt-2 text-sm text-muted-foreground">Search by pharmacy name, address, or use your current location to find options.</p></CardContent></Card>
          ) : (
            results.map((pharmacy) => {
              const key = getPreferenceKey(pharmacy);
              const alreadySaved = savedPreferenceKeys.has(key);
              return (
                <Card key={key} className="hover:border-purple-500/30 transition-all">
                  <CardContent className="p-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1">
                        <div className="w-12 h-12 bg-purple-500/10 rounded-xl flex items-center justify-center shrink-0"><Building2 size={22} className="text-purple-500" /></div>
                        <div className="flex-1">
                          <div className="text-sm font-bold text-foreground">{pharmacy.name}</div>
                          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1"><MapPin size={10} /> {pharmacy.address}</div>
                          <div className="flex flex-wrap items-center gap-3 mt-2"><span className="text-xs text-muted-foreground flex items-center gap-1"><Navigation size={10} /> {formatPharmacyDistance(pharmacy)}</span><span className="text-xs text-muted-foreground flex items-center gap-1"><Clock size={10} /> {pharmacy.hours?.monday || 'Hours unavailable'}</span>{pharmacy.phone && <span className="text-xs text-muted-foreground flex items-center gap-1"><Phone size={10} /> {pharmacy.phone}</span>}</div>
                          <div className="flex gap-2 mt-2 flex-wrap"><span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 text-blue-600"><Package size={10} /> eRx Ready</span>{pharmacy.capabilities?.hasDelivery && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/10 text-purple-600"><Truck size={10} /> Delivery</span>}{pharmacy.isPreferred && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600"><Star size={10} /> Network Preferred</span>}</div>
                        </div>
                      </div>
                      <div className="shrink-0">{alreadySaved ? <Button variant="outline" disabled><ShieldCheck className="w-4 h-4 mr-2" /> Saved</Button> : <Button className="bg-purple-600 hover:bg-purple-500 text-white" onClick={() => handleSavePreference(pharmacy)} disabled={savingKey === key}><ShieldCheck className="w-4 h-4 mr-2" /> {savingKey === key ? 'Saving...' : 'Save Pharmacy'}</Button>}</div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
