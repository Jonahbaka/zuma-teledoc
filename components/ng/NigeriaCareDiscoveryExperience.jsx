'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  Building2,
  ChevronRight,
  MapPin,
  PhoneCall,
  Pill,
  Search,
  ShieldCheck,
  Video,
  Waves,
} from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const TAB_OPTIONS = [
  { id: 'nearest', label: 'Nearest' },
  { id: 'teleconsult', label: 'Teleconsult Now' },
  { id: 'in_person', label: 'In-person' },
  { id: 'pharmacy', label: 'Pharmacy / Meds' },
  { id: 'labs', label: 'Labs / Diagnostics' },
];

const SYMPTOM_OPTIONS = [
  'malaria',
  'pain',
  'fever',
  'dehydration',
  'gastric',
  'respiratory',
  'hypertension',
  'diabetes',
];

const PROVIDER_TYPE_OPTIONS = [
  { value: 'all', label: 'All provider types' },
  { value: 'hospital', label: 'Hospitals' },
  { value: 'clinic', label: 'Clinics' },
  { value: 'specialist', label: 'Specialists' },
  { value: 'pharmacy', label: 'Pharmacies' },
  { value: 'lab', label: 'Labs' },
  { value: 'dental', label: 'Dental' },
  { value: 'optical', label: 'Optical' },
];

const STORAGE_KEY = 'ng-care-discovery-state';

function makeSessionId() {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `ng-${Date.now()}`;
}

function toNaira(amount) {
  if (amount === null || amount === undefined || amount === '') {
    return 'Price on confirmation';
  }

  return `NGN ${Number(amount).toLocaleString()}`;
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function buildWhatsAppHref(whatsappNumber, message) {
  const digits = onlyDigits(whatsappNumber);
  if (!digits) {
    return null;
  }

  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function skeletonRows(count) {
  return Array.from({ length: count }, (_, index) => ({ id: `skeleton-${index}` }));
}

function EmptyState({ title, body }) {
  return (
    <div className="rounded-3xl border border-dashed border-border bg-background/70 px-5 py-10 text-center">
      <p className="text-base font-semibold text-foreground">{title}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}

function ResultCard({ provider, onRequestCallback, onTrackEvent, registerHref }) {
  return (
    <Card className="border-border/70">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-lg font-semibold text-foreground">{provider.canonicalName}</p>
              {(provider.sourceBadges || []).map((badge) => (
                <span key={badge} className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                  {badge}
                </span>
              ))}
            </div>
            <p className="text-sm font-medium text-slate-700">
              {provider.providerSubtype || provider.providerType || 'Provider'}
            </p>
            <p className="text-sm leading-6 text-muted-foreground">
              {[provider.addressRaw, provider.city, provider.state].filter(Boolean).join(' - ')}
            </p>
          </div>

          <div className="rounded-2xl bg-muted/40 px-4 py-3 text-sm">
            <p className="font-semibold text-foreground">
              {provider.distanceKm !== null && provider.distanceKm !== undefined
                ? `${provider.distanceKm.toFixed(1)} km away`
                : 'Location match by city/state'}
            </p>
            <p className="mt-1 text-muted-foreground">
              {provider.etaMinutes ? `ETA ${provider.etaMinutes} min` : 'ETA shown after confirmation'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
            Address confidence: {provider.addressConfidence || 'unresolved'}
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
            {provider.telehealthCapable ? 'Telehealth available' : 'In-person only'}
          </span>
          {(provider.acceptedPaymentTypes || []).map((item) => (
            <span key={item} className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
              {item.replace(/_/g, ' ')}
            </span>
          ))}
        </div>

        <div className="grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
          <p>Trust score: {Math.round(Number(provider.trustScore || 0) * 100)}%</p>
          <p>Last verified: {provider.lastVerifiedAt ? new Date(provider.lastVerifiedAt).toLocaleDateString('en-NG') : 'Recently refreshed'}</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link href={registerHref}>
            <Button
              className="bg-emerald-600 text-white hover:bg-emerald-500"
              onClick={() =>
                onTrackEvent('provider_selected', {
                  providerReference: provider.id,
                  payload: { providerType: provider.providerType, sourceType: provider.sourceType },
                })
              }
            >
              {provider.telehealthCapable ? 'Book a Consultation' : 'Open Care Flow'}
            </Button>
          </Link>
          <Button variant="outline" onClick={() => onRequestCallback(provider)}>
            <PhoneCall className="mr-2 h-4 w-4" />
            Request Callback
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MedicineCard({ medicine, onTrackEvent }) {
  return (
    <Card className="border-border/70">
      <CardContent className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-foreground">{medicine.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {[medicine.genericName, medicine.dosageForm, medicine.strength].filter(Boolean).join(' - ') || 'Medicine search result'}
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
            {medicine.featuredCategory || medicine.therapeuticClass || 'Care flow'}
          </span>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <span className={`rounded-full px-2.5 py-1 font-semibold ${
            medicine.controlled
              ? 'bg-rose-100 text-rose-700'
              : medicine.requiresPrescription
                ? 'bg-amber-100 text-amber-700'
                : 'bg-emerald-100 text-emerald-700'
          }`}>
            {medicine.controlled
              ? 'Controlled / restricted'
              : medicine.requiresPrescription
                ? 'Prescription required'
                : 'OTC candidate'}
          </span>
          {medicine.nhiaListed ? (
            <span className="rounded-full bg-blue-100 px-2.5 py-1 font-semibold text-blue-700">NHIA listed</span>
          ) : null}
        </div>

        <p className="text-sm leading-6 text-muted-foreground">
          {medicine.productLogicNote || 'Continue to provider review or pharmacy confirmation before checkout when required.'}
        </p>

        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-foreground">{toNaira(medicine.priceNgn)}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              onTrackEvent('medicine_selected', {
                medReference: medicine.id,
                payload: { accessMode: medicine.accessMode, category: medicine.featuredCategory },
              })
            }
          >
            Continue
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function NigeriaCareDiscoveryExperience({
  initialTab = 'nearest',
  embeddedInPortal = false,
  pageTitle = 'Find care, medicines, and trusted providers in Nigeria',
  pageBody = 'Use location or manual area details to find the next best provider, teleconsult path, or medicine discovery flow without stalling when connectivity is weak.',
}) {
  const [sessionId, setSessionId] = useState('');
  const [activeTab, setActiveTab] = useState(initialTab);
  const [query, setQuery] = useState('');
  const [symptom, setSymptom] = useState('');
  const [providerType, setProviderType] = useState('all');
  const [payer, setPayer] = useState('');
  const [manualState, setManualState] = useState('');
  const [manualCity, setManualCity] = useState('');
  const [landmark, setLandmark] = useState('');
  const [location, setLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState('detecting');
  const [lowBandwidthMode, setLowBandwidthMode] = useState(false);
  const [providers, setProviders] = useState([]);
  const [medicines, setMedicines] = useState([]);
  const [featuredCategories, setFeaturedCategories] = useState([]);
  const [telehealthOptions, setTelehealthOptions] = useState([]);
  const [support, setSupport] = useState({ whatsappNumber: '', callbackNumber: '', callbackLabel: 'Request a phone callback' });
  const [payers, setPayers] = useState({ hmos: [], stateSchemes: [] });
  const [loadingHome, setLoadingHome] = useState(true);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [loadingMedicines, setLoadingMedicines] = useState(false);
  const [submittingFallback, setSubmittingFallback] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const [fallbackForm, setFallbackForm] = useState({
    requestType: 'phone_callback',
    contactName: '',
    phone: '',
    email: '',
    preferredContactMethod: 'phone',
    notes: '',
  });

  const registerHref = embeddedInPortal ? '/ng/patient/appointments' : '/ng/auth/register';
  const whatsappHref = buildWhatsAppHref(
    support.whatsappNumber,
    `Hello DoctaRx Nigeria. I need help continuing care for ${query || symptom || 'a new request'}.`
  );

  async function trackEvent(eventType, details = {}) {
    try {
      await api.post('/api/ng/discovery/events', {
        eventType,
        sessionId,
        query,
        providerReference: details.providerReference || null,
        medReference: details.medReference || null,
        payload: {
          activeTab,
          symptom,
          providerType,
          payer,
          lowBandwidthMode,
          manualState,
          manualCity,
          ...details.payload,
        },
      });
    } catch (error) {
      console.error('[NG Discovery] Event tracking failed', error);
    }
  }

  async function loadHome(overrides = {}) {
    setLoadingHome(true);

    try {
      const response = await api.get('/api/ng/discovery/home', {
        params: {
          latitude: overrides.latitude ?? location?.latitude ?? undefined,
          longitude: overrides.longitude ?? location?.longitude ?? undefined,
          state: overrides.state ?? (manualState || undefined),
          city: overrides.city ?? (manualCity || undefined),
        },
      });

      setFeaturedCategories(response.data?.featuredCategories || []);
      setProviders(response.data?.nearestProviders || []);
      setTelehealthOptions(response.data?.telehealthOptions || []);
      setSupport(response.data?.support || { whatsappNumber: '', callbackNumber: '', callbackLabel: 'Request a phone callback' });
      setPayers(response.data?.payers || { hmos: [], stateSchemes: [] });
    } catch (error) {
      console.error('[NG Discovery] Failed to load home', error);
    } finally {
      setLoadingHome(false);
    }
  }

  async function runProviderSearch(modeOverride = activeTab) {
    setLoadingProviders(true);
    setFeedbackMessage('');

    try {
      const response = await api.get('/api/ng/discovery/providers', {
        params: {
          q: query || undefined,
          symptom: symptom || undefined,
          providerType: providerType === 'all' ? undefined : providerType,
          payer: payer || undefined,
          mode: modeOverride,
          state: manualState || undefined,
          city: manualCity || undefined,
          lga: landmark || undefined,
          latitude: location?.latitude,
          longitude: location?.longitude,
          medicine: modeOverride === 'pharmacy' ? query || undefined : undefined,
          sessionId,
        },
      });

      setProviders(response.data?.providers || []);
      await trackEvent('provider_search_performed', {
        payload: { resultCount: response.data?.total || 0, mode: modeOverride },
      });
    } catch (error) {
      console.error('[NG Discovery] Failed to search providers', error);
      setFeedbackMessage('Provider discovery is temporarily unavailable. Use manual fallback below.');
    } finally {
      setLoadingProviders(false);
    }
  }

  async function runMedicineSearch() {
    setLoadingMedicines(true);
    setFeedbackMessage('');

    try {
      const response = await api.get('/api/ng/discovery/medicines', {
        params: {
          q: query || undefined,
          symptom: symptom || undefined,
          category: undefined,
        },
      });

      setMedicines(response.data?.medicines || []);
      await trackEvent('medicine_search_performed', {
        payload: { resultCount: response.data?.total || 0 },
      });
    } catch (error) {
      console.error('[NG Discovery] Failed to search medicines', error);
      setFeedbackMessage('Medicine search is temporarily unavailable. Use callback or WhatsApp fallback.');
    } finally {
      setLoadingMedicines(false);
    }
  }

  async function handleSearch() {
    if (activeTab === 'pharmacy') {
      await Promise.all([runMedicineSearch(), runProviderSearch('pharmacy')]);
      return;
    }

    if (activeTab === 'labs') {
      await runProviderSearch('labs');
      return;
    }

    await runProviderSearch(activeTab);
  }

  function persistState() {
    if (typeof window === 'undefined') {
      return;
    }

    const snapshot = {
      activeTab,
      query,
      symptom,
      providerType,
      payer,
      manualState,
      manualCity,
      landmark,
      lowBandwidthMode,
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    setFeedbackMessage('Your care search was saved. You can resume from this device later.');
    trackEvent('care_state_saved');
  }

  function requestCallbackFor(provider) {
    setFallbackOpen(true);
    setFallbackForm((current) => ({
      ...current,
      requestType: 'phone_callback',
      notes: provider ? `Please continue with ${provider.canonicalName}.` : current.notes,
    }));
  }

  async function submitFallback(event) {
    event.preventDefault();
    setSubmittingFallback(true);
    setFeedbackMessage('');

    try {
      const response = await api.post('/api/ng/discovery/fallback', {
        ...fallbackForm,
        sessionId,
        query,
        symptom,
        careNeed: activeTab,
        state: manualState || location?.state || null,
        city: manualCity || location?.city || null,
        landmark,
        connection: { lowBandwidthMode, locationStatus },
      });

      setFeedbackMessage(response.data?.message || 'Fallback request submitted.');
      setFallbackOpen(false);
      setFallbackForm((current) => ({ ...current, notes: '' }));
    } catch (error) {
      console.error('[NG Discovery] Failed to submit fallback', error);
      setFeedbackMessage('We could not submit the fallback request. Try WhatsApp or phone support.');
    } finally {
      setSubmittingFallback(false);
    }
  }

  // This runs once to establish the initial location mode for the session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setSessionId(makeSessionId());

    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setActiveTab(parsed.activeTab || initialTab);
          setQuery(parsed.query || '');
          setSymptom(parsed.symptom || '');
          setProviderType(parsed.providerType || 'all');
          setPayer(parsed.payer || '');
          setManualState(parsed.manualState || '');
          setManualCity(parsed.manualCity || '');
          setLandmark(parsed.landmark || '');
          setLowBandwidthMode(Boolean(parsed.lowBandwidthMode));
        } catch (error) {
          console.error('[NG Discovery] Failed to restore stored state', error);
        }
      }

      const connectionType = window.navigator?.connection?.effectiveType;
      if (connectionType === '2g' || connectionType === 'slow-2g') {
        setLowBandwidthMode(true);
      }
    }
  }, [initialTab]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.navigator?.geolocation) {
      setLocationStatus('manual');
      loadHome();
      return;
    }

    window.navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setLocation(nextLocation);
        setLocationStatus('granted');
        trackEvent('location_permission_granted', { payload: nextLocation });
        loadHome(nextLocation);
      },
      () => {
        setLocationStatus('manual');
        trackEvent('location_permission_denied');
        loadHome();
      },
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 300000 }
    );
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (activeTab === 'pharmacy') {
      runMedicineSearch();
    }
  }, [activeTab]);

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-emerald-200/70 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_38%),linear-gradient(145deg,rgba(255,255,255,0.96),rgba(236,253,245,0.92))] px-5 py-6 shadow-sm sm:px-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
              <ShieldCheck className="h-4 w-4" />
              Nigeria care discovery
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">{pageTitle}</h1>
            <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">{pageBody}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Button variant="outline" onClick={persistState} className="border-emerald-200 text-emerald-700 hover:bg-emerald-50">
              Save and Resume
            </Button>
            <Button
              className={lowBandwidthMode ? 'bg-slate-900 text-white hover:bg-slate-800' : 'bg-emerald-600 text-white hover:bg-emerald-500'}
              onClick={() => setLowBandwidthMode((current) => !current)}
            >
              {lowBandwidthMode ? 'Low-bandwidth mode on' : 'Enable low-bandwidth mode'}
            </Button>
          </div>
        </div>
      </section>

      <Card className="border-border/70">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-col gap-3 lg:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by symptom, medicine, specialty, provider, or HMO"
                className="h-12 w-full rounded-2xl border border-border bg-background pl-10 pr-4 text-sm outline-none focus:border-emerald-500"
              />
            </div>
            <Button onClick={handleSearch} className="bg-emerald-600 text-white hover:bg-emerald-500">
              Search
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {TAB_OPTIONS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                  activeTab === tab.id
                    ? 'bg-emerald-600 text-white'
                    : 'border border-border bg-background text-foreground hover:bg-accent'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <select
              value={symptom}
              onChange={(event) => setSymptom(event.target.value)}
              className="h-11 rounded-2xl border border-border bg-background px-3 text-sm"
            >
              <option value="">All symptoms</option>
              {SYMPTOM_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  {item.replace(/_/g, ' ')}
                </option>
              ))}
            </select>

            <select
              value={providerType}
              onChange={(event) => setProviderType(event.target.value)}
              className="h-11 rounded-2xl border border-border bg-background px-3 text-sm"
            >
              {PROVIDER_TYPE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>

            <select
              value={payer}
              onChange={(event) => setPayer(event.target.value)}
              className="h-11 rounded-2xl border border-border bg-background px-3 text-sm"
            >
              <option value="">All payer badges</option>
              {(payers.hmos || []).slice(0, 20).map((item) => (
                <option key={item.id} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>

            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                value={manualState}
                onChange={(event) => setManualState(event.target.value)}
                placeholder="State"
                className="h-11 rounded-2xl border border-border bg-background px-3 text-sm"
              />
              <input
                type="text"
                value={manualCity}
                onChange={(event) => setManualCity(event.target.value)}
                placeholder="City / Area"
                className="h-11 rounded-2xl border border-border bg-background px-3 text-sm"
              />
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
            <input
              type="text"
              value={landmark}
              onChange={(event) => setLandmark(event.target.value)}
              placeholder="Landmark or LGA for manual fallback"
              className="h-11 rounded-2xl border border-border bg-background px-3 text-sm"
            />
            <div className="inline-flex items-center gap-2 rounded-2xl border border-border px-4 py-3 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4" />
              {locationStatus === 'granted'
                ? 'Location ready'
                : locationStatus === 'manual'
                  ? 'Using manual location fallback'
                  : 'Checking location permission'}
            </div>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
        <div className="space-y-4">
          {activeTab === 'pharmacy' ? (
            <>
              <Card className="border-border/70">
                <CardHeader className="pb-2">
                  <CardTitle>Featured medicine categories</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2">
                  {loadingHome
                    ? skeletonRows(4).map((row) => (
                        <div key={row.id} className="h-24 animate-pulse rounded-2xl bg-muted/50" />
                      ))
                    : featuredCategories.map((item) => (
                        <button
                          key={item.category}
                          type="button"
                          onClick={() => {
                            setQuery(item.medicineExamples?.[0] || item.category);
                            setFeedbackMessage(`Loaded ${item.category} guidance. Run search to see medicines and nearby options.`);
                          }}
                          className="rounded-2xl border border-border px-4 py-4 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-50/60"
                        >
                          <p className="text-base font-semibold text-foreground">{item.category}</p>
                          <p className="mt-2 text-sm text-muted-foreground">{item.medicineExamples?.slice(0, 3).join(', ')}</p>
                          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                            {item.medCount} tracked medicines
                          </p>
                        </button>
                      ))}
                </CardContent>
              </Card>

              <Card className="border-border/70">
                <CardHeader className="pb-2">
                  <CardTitle>Medicine results</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {loadingMedicines
                    ? skeletonRows(4).map((row) => <div key={row.id} className="h-36 animate-pulse rounded-2xl bg-muted/50" />)
                    : medicines.length === 0
                      ? (
                        <EmptyState
                          title="Search medicines with symptom-aware logic"
                          body="This catalog highlights OTC candidates, pharmacist review items, and prescription-only medicines without casually merchandising antibiotics."
                        />
                        )
                      : medicines.map((medicine) => (
                          <MedicineCard key={medicine.id} medicine={medicine} onTrackEvent={trackEvent} />
                        ))}
                </CardContent>
              </Card>
            </>
          ) : (
            <Card className="border-border/70">
              <CardHeader className="pb-2">
                <CardTitle>
                  {activeTab === 'teleconsult' ? 'Teleconsult and provider results' : 'Provider results'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {loadingProviders
                  ? skeletonRows(4).map((row) => <div key={row.id} className="h-40 animate-pulse rounded-2xl bg-muted/50" />)
                  : providers.length === 0
                    ? (
                      <EmptyState
                        title="No provider match yet"
                        body="Try a symptom, specialty, medicine name, or manual state and city. If location is weak, the flow stays open with callback and WhatsApp fallback."
                      />
                      )
                    : providers.map((provider) => (
                        <ResultCard
                          key={provider.id}
                          provider={provider}
                          onRequestCallback={requestCallbackFor}
                          onTrackEvent={trackEvent}
                          registerHref={registerHref}
                        />
                      ))}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card className="border-border/70">
            <CardHeader className="pb-2">
              <CardTitle>Low-bandwidth fallback</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <div className="flex items-center gap-2 font-semibold text-emerald-900">
                  <Waves className="h-4 w-4" />
                  {lowBandwidthMode ? 'Low-bandwidth mode active' : 'Graceful degradation ready'}
                </div>
                <p className="mt-2 text-emerald-800">
                  Audio-first consults, photo and voice-note follow-up, and manual location keep the flow moving when connectivity is unreliable.
                </p>
              </div>

              {(telehealthOptions || []).map((item) => (
                <div key={item.id} className="rounded-2xl border border-border px-4 py-3">
                  <p className="font-semibold text-foreground">{item.label}</p>
                  <p className="mt-1">{item.description}</p>
                </div>
              ))}

              <div className="grid gap-3">
                {whatsappHref ? (
                  <a href={whatsappHref} target="_blank" rel="noreferrer" className="inline-flex">
                    <Button
                      className="w-full bg-slate-900 text-white hover:bg-slate-800"
                      onClick={() => trackEvent('whatsapp_handoff_selected')}
                    >
                      Continue on WhatsApp
                    </Button>
                  </a>
                ) : null}
                <Button variant="outline" onClick={() => requestCallbackFor(null)}>
                  {support.callbackLabel || 'Request a phone callback'}
                </Button>
                {support.callbackNumber ? (
                  <a href={`tel:${support.callbackNumber}`} className="inline-flex">
                    <Button variant="outline" className="w-full">
                      Call {support.callbackNumber}
                    </Button>
                  </a>
                ) : null}
                <Button variant="outline" onClick={() => {
                  setActiveTab('teleconsult');
                  setLowBandwidthMode(true);
                  trackEvent('audio_first_selected');
                }}>
                  <Video className="mr-2 h-4 w-4" />
                  Use audio-first consult
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardHeader className="pb-2">
              <CardTitle>Guided care paths</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {SYMPTOM_OPTIONS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    setSymptom(item);
                    setActiveTab(item === 'hypertension' || item === 'diabetes' ? 'teleconsult' : 'pharmacy');
                    setQuery(item);
                  }}
                  className="flex w-full items-center justify-between rounded-2xl border border-border px-4 py-3 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-50/60"
                >
                  <div>
                    <p className="font-semibold text-foreground">{item.replace(/_/g, ' ')}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {item === 'malaria' ? 'Symptom to medicine to provider handoff.' : 'Continue with provider and medicine-aware guidance.'}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              ))}
            </CardContent>
          </Card>

          {feedbackMessage ? (
            <Card className="border-emerald-200 bg-emerald-50">
              <CardContent className="p-4 text-sm text-emerald-900">{feedbackMessage}</CardContent>
            </Card>
          ) : null}
        </div>
      </section>

      {fallbackOpen ? (
        <Card className="border-border/70">
          <CardHeader className="pb-2">
            <CardTitle>Continue with callback or async follow-up</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3 md:grid-cols-2" onSubmit={submitFallback}>
              <input
                type="text"
                value={fallbackForm.contactName}
                onChange={(event) => setFallbackForm((current) => ({ ...current, contactName: event.target.value }))}
                placeholder="Your name"
                className="h-11 rounded-2xl border border-border bg-background px-3 text-sm"
              />
              <input
                type="tel"
                value={fallbackForm.phone}
                onChange={(event) => setFallbackForm((current) => ({ ...current, phone: event.target.value }))}
                placeholder="Phone number"
                className="h-11 rounded-2xl border border-border bg-background px-3 text-sm"
              />
              <input
                type="email"
                value={fallbackForm.email}
                onChange={(event) => setFallbackForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="Email (optional)"
                className="h-11 rounded-2xl border border-border bg-background px-3 text-sm"
              />
              <select
                value={fallbackForm.preferredContactMethod}
                onChange={(event) => setFallbackForm((current) => ({ ...current, preferredContactMethod: event.target.value }))}
                className="h-11 rounded-2xl border border-border bg-background px-3 text-sm"
              >
                <option value="phone">Phone callback</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="email">Email</option>
              </select>
              <textarea
                value={fallbackForm.notes}
                onChange={(event) => setFallbackForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Tell the care team what you need next"
                className="min-h-[120px] rounded-2xl border border-border bg-background px-3 py-3 text-sm md:col-span-2"
              />
              <div className="flex flex-wrap gap-3 md:col-span-2">
                <Button type="submit" disabled={submittingFallback} className="bg-emerald-600 text-white hover:bg-emerald-500">
                  {submittingFallback ? 'Submitting...' : 'Submit fallback request'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setFallbackOpen(false)}>
                  Close
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {embeddedInPortal ? (
        <Card className="border-border/70">
          <CardContent className="grid gap-3 p-5 md:grid-cols-3">
            <Link href="/ng/patient/prescriptions" className="rounded-2xl border border-border px-4 py-4 transition-colors hover:border-emerald-300 hover:bg-emerald-50/60">
              <div className="inline-flex rounded-xl bg-emerald-500/10 p-2 text-emerald-600">
                <Pill className="h-5 w-5" />
              </div>
              <p className="mt-3 font-semibold text-foreground">Prescription follow-through</p>
              <p className="mt-2 text-sm text-muted-foreground">Upload or review prescriptions before routing to pharmacies.</p>
            </Link>
            <Link href="/ng/patient/orders" className="rounded-2xl border border-border px-4 py-4 transition-colors hover:border-emerald-300 hover:bg-emerald-50/60">
              <div className="inline-flex rounded-xl bg-emerald-500/10 p-2 text-emerald-600">
                <Building2 className="h-5 w-5" />
              </div>
              <p className="mt-3 font-semibold text-foreground">Continue last care plan</p>
              <p className="mt-2 text-sm text-muted-foreground">Return to the latest order, medicine request, or provider handoff without restarting the flow.</p>
            </Link>
            <button
              type="button"
              onClick={() => {
                setFallbackOpen(true);
                setActiveTab('teleconsult');
              }}
              className="rounded-2xl border border-border px-4 py-4 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-50/60"
            >
              <div className="inline-flex rounded-xl bg-emerald-500/10 p-2 text-emerald-600">
                <Activity className="h-5 w-5" />
              </div>
              <p className="mt-3 font-semibold text-foreground">Request chronic care follow-up</p>
              <p className="mt-2 text-sm text-muted-foreground">Escalate refill or repeat-care support for hypertension, diabetes, asthma, or gastric follow-through.</p>
            </button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
