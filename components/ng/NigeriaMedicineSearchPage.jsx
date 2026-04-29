'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ClipboardList, Loader2, MapPin, Search, ShieldCheck } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  CATEGORY_IMAGE_KEYS,
  MEDICINE_SEARCH_IMAGES,
  QUICK_SEARCH_IMAGE_KEYS,
} from '@/lib/ng/medicines/medicineSearchImages';
import {
  NIGERIA_MEDICATION_STARTER_CATALOG_COUNT,
  NIGERIA_MEDICATION_STARTER_SOURCE_LABEL,
  mergeMedicineSearchResults,
  searchNigeriaMedicationCatalog,
} from '@/lib/ng/medicines/nigeriaMedicationCatalog';

const UNKNOWN_AVAILABILITY_MESSAGE = 'Availability will be confirmed by partner pharmacies.';
const UNKNOWN_PRICE_MESSAGE = 'Price will be confirmed by the selected pharmacy.';

const REQUEST_DEFAULTS = {
  medicineCatalogId: '',
  starterCatalogId: '',
  medicineName: '',
  genericName: '',
  dosageStrength: '',
  quantity: '',
  requiresPrescription: false,
  prescriptionAttached: false,
  prescriptionAttachmentUrl: '',
  fulfillmentPreference: 'pickup_or_delivery',
  contactName: '',
  phone: '',
  whatsappNumber: '',
  email: '',
  state: '',
  city: '',
  lga: '',
  landmark: '',
  locationPermissionStatus: 'not_requested',
  locationLatitude: null,
  locationLongitude: null,
  locationAccuracy: null,
  notes: '',
};

const EXAMPLE_SEARCHES = ['malaria', 'cough', 'paracetamol', 'blood pressure', 'diabetes', 'ulcer'];

function statusLabel(value) {
  return String(value || '').replace(/_/g, ' ');
}

function buildRequestFromMedicine(medicine, query = '') {
  return {
    ...REQUEST_DEFAULTS,
    medicineCatalogId: medicine?.id && !String(medicine.id).startsWith('starter-') ? medicine.id : '',
    starterCatalogId: medicine?.starterCatalogId || (String(medicine?.id || '').startsWith('starter-') ? medicine.id : ''),
    medicineName: medicine?.name || medicine?.medicationName || query || '',
    genericName: medicine?.genericName || '',
    dosageStrength: medicine?.strength || medicine?.commonStrengths?.[0] || '',
    requiresPrescription: Boolean(medicine?.requiresPrescription || medicine?.requiresReview || medicine?.controlled),
  };
}

function MedicineImage({ imageKey, alt, className = '', eager = false, priority = false }) {
  const image = MEDICINE_SEARCH_IMAGES[imageKey] || MEDICINE_SEARCH_IMAGES.hero;
  const loadProps = priority
    ? { priority: true }
    : { loading: eager ? 'eager' : 'lazy' };

  return (
    <div className={`relative overflow-hidden bg-slate-100 ${className}`}>
      <Image
        src={image.src}
        alt={alt || image.alt}
        fill
        sizes="(max-width: 768px) 100vw, 420px"
        className="object-cover"
        {...loadProps}
      />
    </div>
  );
}

function QuickSearchCard({ imageKey, onSelect }) {
  const image = MEDICINE_SEARCH_IMAGES[imageKey];
  const searchTerm = image.relatedSearchTerms?.[0] || image.label;
  return (
    <button
      type="button"
      onClick={() => onSelect(searchTerm)}
      className="group min-w-[132px] overflow-hidden rounded-2xl border border-slate-200 bg-white text-left text-slate-950 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500 sm:min-w-0"
    >
      <MedicineImage imageKey={imageKey} alt={image.alt} eager className="aspect-square w-full" />
      <div className="p-3">
        <p className="text-sm font-bold text-slate-950">{image.label}</p>
        <p className="mt-1 text-xs leading-5 text-slate-600">Pharmacy will confirm</p>
      </div>
    </button>
  );
}

function CategoryCard({ imageKey, onSelect }) {
  const image = MEDICINE_SEARCH_IMAGES[imageKey];
  return (
    <button
      type="button"
      onClick={() => onSelect(image.category || image.label)}
      className="group overflow-hidden rounded-2xl border border-slate-200 bg-white text-left text-slate-950 shadow-sm transition hover:border-emerald-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
    >
      <MedicineImage imageKey={imageKey} alt={image.alt} className="aspect-[4/3] w-full" />
      <div className="p-4">
        <p className="text-base font-bold text-slate-950">{image.label}</p>
        <p className="mt-2 text-sm leading-6 text-slate-700">Search this medicine category. Stock and price still require partner pharmacy confirmation.</p>
      </div>
    </button>
  );
}

function MedicineResultCard({ medicine, onRequest }) {
  const hasVerifiedAvailability = medicine.availabilityStatus === 'verified_partner_stock' || medicine.liveAvailabilityClaimed;
  const commonUse = medicine.commonUses?.[0] || medicine.productLogicNote || 'Medication reference for pharmacy availability request.';

  return (
    <article className="overflow-hidden rounded-3xl border border-slate-200 bg-white text-slate-950 shadow-sm">
      <div className="grid gap-0 md:grid-cols-[180px_1fr]">
        <MedicineImage imageKey={medicine.imageKey || 'hero'} alt={`${medicine.name} medicine category visual`} className="aspect-[4/3] md:h-full md:min-h-[220px]" />
        <div className="space-y-4 p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xl font-bold text-slate-950">{medicine.name}</p>
              {medicine.genericName && medicine.genericName !== medicine.name ? (
                <p className="mt-1 text-sm text-slate-700">Generic name: {medicine.genericName}</p>
              ) : null}
              <p className="mt-2 text-sm leading-6 text-slate-700">{commonUse}</p>
            </div>
            <span className="w-fit rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">
              {medicine.category || medicine.featuredCategory || 'Medicine'}
            </span>
          </div>

          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            {(medicine.dosageForms || String(medicine.dosageForm || '').split(',')).filter(Boolean).slice(0, 4).map((form) => (
              <span key={form} className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">{form}</span>
            ))}
            {medicine.requiresPrescription || medicine.requiresReview || medicine.controlled ? (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">Prescription may be required</span>
            ) : (
              <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-800">Pharmacist review</span>
            )}
            {medicine.controlled ? (
              <span className="rounded-full bg-rose-100 px-3 py-1 text-rose-800">Special handling</span>
            ) : null}
          </div>

          {medicine.strength || medicine.commonStrengths?.length ? (
            <p className="text-sm text-slate-700">
              Common forms/strengths searched: {medicine.strength || medicine.commonStrengths.slice(0, 4).join(', ')}
            </p>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            <div className={`rounded-2xl border px-4 py-3 ${hasVerifiedAvailability ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
              <p className="font-bold">Availability</p>
              <p className="mt-1 text-sm leading-6">{hasVerifiedAvailability ? medicine.availabilityMessage : UNKNOWN_AVAILABILITY_MESSAGE}</p>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
              <p className="font-bold">Price</p>
              <p className="mt-1 text-sm leading-6">{hasVerifiedAvailability && medicine.pricingMessage ? medicine.pricingMessage : UNKNOWN_PRICE_MESSAGE}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
            Source: <span className="font-semibold text-slate-950">{medicine.sourceName || medicine.sourceLabel || NIGERIA_MEDICATION_STARTER_SOURCE_LABEL}</span>.
            {' '}This is not confirmed live pharmacy stock.
          </div>

          {medicine.requiresPrescription || medicine.requiresReview || medicine.controlled ? (
            <div className="rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm font-semibold text-amber-900">
              This medicine may require a prescription before dispensing.
            </div>
          ) : null}

          <Button onClick={() => onRequest(medicine)} className="h-11 w-full bg-emerald-600 text-white hover:bg-emerald-500 sm:w-auto">
            Request Availability
          </Button>
        </div>
      </div>
    </article>
  );
}

function ManualRequestForm({ form, setForm, onSubmit, onClose, submitting, statusMessage, onUseLocation }) {
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  return (
    <section className="rounded-3xl border border-emerald-200 bg-white text-slate-950 shadow-sm">
      <div className="grid gap-0 lg:grid-cols-[0.85fr_1.15fr]">
        <MedicineImage imageKey="manualRequest" className="aspect-[4/3] lg:h-full" />
        <div className="space-y-4 p-5 sm:p-6">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-emerald-700">Medicine Request</p>
            <h2 className="mt-2 text-2xl font-bold text-slate-950">Request medicine availability</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">Partner pharmacies will confirm availability and price before pickup or delivery.</p>
          </div>

          {statusMessage ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              {statusMessage}
            </div>
          ) : null}

          <form className="grid gap-3 md:grid-cols-2" onSubmit={onSubmit}>
            <input value={form.medicineName} onChange={(event) => update('medicineName', event.target.value)} required placeholder="Medicine name" className="h-12 rounded-2xl border border-slate-300 bg-white px-4 text-base text-slate-950 placeholder:text-slate-500" />
            <input value={form.dosageStrength} onChange={(event) => update('dosageStrength', event.target.value)} placeholder="Dosage/strength if known" className="h-12 rounded-2xl border border-slate-300 bg-white px-4 text-base text-slate-950 placeholder:text-slate-500" />
            <input value={form.quantity} onChange={(event) => update('quantity', event.target.value)} placeholder="Quantity if known" className="h-12 rounded-2xl border border-slate-300 bg-white px-4 text-base text-slate-950 placeholder:text-slate-500" />
            <select value={form.fulfillmentPreference} onChange={(event) => update('fulfillmentPreference', event.target.value)} className="h-12 rounded-2xl border border-slate-300 bg-white px-4 text-base text-slate-950">
              <option value="pickup_or_delivery">Pickup or delivery</option>
              <option value="pickup">Pickup preferred</option>
              <option value="delivery">Delivery preferred</option>
              <option value="pharmacy_confirmation">Let pharmacy confirm options</option>
            </select>
            <input value={form.contactName} onChange={(event) => update('contactName', event.target.value)} placeholder="Your name" className="h-12 rounded-2xl border border-slate-300 bg-white px-4 text-base text-slate-950 placeholder:text-slate-500" />
            <input value={form.phone} onChange={(event) => update('phone', event.target.value)} placeholder="Phone number" type="tel" className="h-12 rounded-2xl border border-slate-300 bg-white px-4 text-base text-slate-950 placeholder:text-slate-500" />
            <input value={form.whatsappNumber} onChange={(event) => update('whatsappNumber', event.target.value)} placeholder="WhatsApp number if different" type="tel" className="h-12 rounded-2xl border border-slate-300 bg-white px-4 text-base text-slate-950 placeholder:text-slate-500" />
            <input value={form.email} onChange={(event) => update('email', event.target.value)} placeholder="Email optional" type="email" className="h-12 rounded-2xl border border-slate-300 bg-white px-4 text-base text-slate-950 placeholder:text-slate-500" />

            <label className="flex min-h-12 items-center gap-3 rounded-2xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 md:col-span-2">
              <input type="checkbox" checked={form.prescriptionAttached} onChange={(event) => update('prescriptionAttached', event.target.checked)} className="h-4 w-4" />
              I have a prescription or prescription reference
            </label>
            <input value={form.prescriptionAttachmentUrl} onChange={(event) => update('prescriptionAttachmentUrl', event.target.value)} placeholder="Prescription upload link or reference if available" className="h-12 rounded-2xl border border-slate-300 bg-white px-4 text-base text-slate-950 placeholder:text-slate-500 md:col-span-2" />

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-bold text-slate-950">Location</p>
                  <p className="text-sm text-slate-700">Share location or enter your area manually.</p>
                </div>
                <Button type="button" variant="outline" onClick={onUseLocation}>
                  <MapPin className="mr-2 h-4 w-4" />
                  Use my location
                </Button>
              </div>
              <p className="mt-2 text-xs font-semibold text-slate-600">Location status: {statusLabel(form.locationPermissionStatus)}</p>
            </div>

            <input value={form.state} onChange={(event) => update('state', event.target.value)} placeholder="State / FCT" className="h-12 rounded-2xl border border-slate-300 bg-white px-4 text-base text-slate-950 placeholder:text-slate-500" />
            <input value={form.city} onChange={(event) => update('city', event.target.value)} placeholder="City / Area" className="h-12 rounded-2xl border border-slate-300 bg-white px-4 text-base text-slate-950 placeholder:text-slate-500" />
            <input value={form.lga} onChange={(event) => update('lga', event.target.value)} placeholder="LGA" className="h-12 rounded-2xl border border-slate-300 bg-white px-4 text-base text-slate-950 placeholder:text-slate-500" />
            <input value={form.landmark} onChange={(event) => update('landmark', event.target.value)} placeholder="Landmark" className="h-12 rounded-2xl border border-slate-300 bg-white px-4 text-base text-slate-950 placeholder:text-slate-500" />
            <textarea value={form.notes} onChange={(event) => update('notes', event.target.value)} placeholder="Notes for the pharmacy or DoctaRx care team" className="min-h-[112px] rounded-2xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-950 placeholder:text-slate-500 md:col-span-2" />

            <div className="flex flex-wrap gap-3 md:col-span-2">
              <Button type="submit" disabled={submitting || !form.medicineName || (!form.phone && !form.email && !form.whatsappNumber)} className="h-11 bg-emerald-600 text-white hover:bg-emerald-500">
                {submitting ? 'Submitting...' : 'Submit Request'}
              </Button>
              <Button type="button" variant="outline" onClick={onClose}>Close</Button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}

export default function NigeriaMedicineSearchPage() {
  const [query, setQuery] = useState('');
  const [apiResults, setApiResults] = useState([]);
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchSubmitted, setSearchSubmitted] = useState(false);
  const [focused, setFocused] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestForm, setRequestForm] = useState(REQUEST_DEFAULTS);
  const [requestStatus, setRequestStatus] = useState('');
  const [submittingRequest, setSubmittingRequest] = useState(false);

  const starterResults = useMemo(() => searchNigeriaMedicationCatalog(query, { limit: query ? 32 : 12 }), [query]);
  const results = useMemo(() => mergeMedicineSearchResults(apiResults, starterResults, 32), [apiResults, starterResults]);
  const suggestions = useMemo(() => searchNigeriaMedicationCatalog(query, { limit: 5 }), [query]);
  const hasQuery = query.trim().length > 0;
  const noUsefulMatch = hasQuery && !loading && results.length === 0;

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setApiResults([]);
      setApiError('');
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setApiError('');
      try {
        const response = await api.get('/ng/discovery/medicines', {
          params: { q: term, limit: 16 },
          signal: controller.signal,
        });
        setApiResults(Array.isArray(response.data?.medicines) ? response.data.medicines : []);
      } catch (error) {
        if (error.name !== 'CanceledError') {
          setApiResults([]);
          setApiError('We could not check live pharmacy data right now. You can still request this medicine and partner pharmacies will confirm availability.');
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, 260);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function selectSearch(term) {
    setQuery(term);
    setSearchSubmitted(true);
    setFocused(false);
  }

  function openRequest(medicine) {
    setRequestStatus('');
    setRequestForm(buildRequestFromMedicine(medicine, query));
    setRequestOpen(true);
  }

  function openManualRequest() {
    setRequestStatus('');
    setRequestForm({ ...REQUEST_DEFAULTS, medicineName: query.trim() });
    setRequestOpen(true);
  }

  function requestDeviceLocation() {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setRequestForm((current) => ({ ...current, locationPermissionStatus: 'manual_required' }));
      return;
    }

    setRequestForm((current) => ({ ...current, locationPermissionStatus: 'requesting' }));
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setRequestForm((current) => ({
          ...current,
          locationPermissionStatus: 'granted',
          locationLatitude: position.coords.latitude,
          locationLongitude: position.coords.longitude,
          locationAccuracy: position.coords.accuracy,
        }));
      },
      () => setRequestForm((current) => ({ ...current, locationPermissionStatus: 'denied_manual_location' })),
      { enableHighAccuracy: false, timeout: 7000, maximumAge: 300000 }
    );
  }

  async function submitRequest(event) {
    event.preventDefault();
    setSubmittingRequest(true);
    setRequestStatus('');

    try {
      const response = await api.post('/ng/discovery/medication-requests', requestForm);
      setRequestStatus(response.data?.statusMessage || 'Pending partner pharmacy confirmation.');
    } catch (error) {
      setRequestStatus('We could not submit online right now. You can try again, or contact DoctaRx support so partner pharmacies can confirm availability.');
    } finally {
      setSubmittingRequest(false);
    }
  }

  return (
    <main className="space-y-8 text-slate-950">
      <section className="overflow-hidden rounded-[2rem] border border-emerald-100 bg-white shadow-sm">
        <div className="grid lg:grid-cols-[1.08fr_0.92fr]">
          <div className="space-y-6 p-5 sm:p-7 lg:p-9">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-800">
              <ShieldCheck className="h-4 w-4" />
              Nigeria pharmacy confirmation
            </div>
            <div>
              <h1 className="text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">Find Medicine</h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-slate-700">
                Search by medicine name, illness, or symptom. Partner pharmacies will confirm availability and price.
              </p>
            </div>

            <form
              className="relative"
              onSubmit={(event) => {
                event.preventDefault();
                setSearchSubmitted(true);
                setFocused(false);
              }}
            >
              <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onFocus={() => setFocused(true)}
                placeholder="Search medicine, illness, or symptom"
                className="h-16 w-full rounded-3xl border border-slate-300 bg-white pl-12 pr-4 text-lg font-semibold text-slate-950 shadow-sm placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-4 focus:ring-emerald-100"
                aria-label="Search medicine, illness, or symptom"
              />
              {focused && query.trim() && suggestions.length > 0 ? (
                <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
                  {suggestions.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectSearch(item.name)}
                      className="flex w-full items-center justify-between border-b border-slate-100 px-4 py-3 text-left last:border-b-0 hover:bg-emerald-50"
                    >
                      <span>
                        <span className="block font-bold text-slate-950">{item.name}</span>
                        <span className="block text-sm text-slate-600">{item.category}</span>
                      </span>
                      <span className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Search</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </form>

            <p className="text-sm leading-6 text-slate-700">
              Try: {EXAMPLE_SEARCHES.map((item, index) => (
                <button key={item} type="button" onClick={() => selectSearch(item)} className="font-bold text-emerald-700 hover:text-emerald-600">
                  {index > 0 ? ', ' : ''}{item}
                </button>
              ))}
            </p>

            <div className="flex flex-wrap gap-2 text-xs font-semibold text-slate-700">
              <span className="rounded-full bg-slate-100 px-3 py-1">{NIGERIA_MEDICATION_STARTER_CATALOG_COUNT}+ starter catalog records</span>
              <span className="rounded-full bg-slate-100 px-3 py-1">No fake prices</span>
              <span className="rounded-full bg-slate-100 px-3 py-1">No fake stock</span>
            </div>
          </div>
          <MedicineImage imageKey="hero" alt={MEDICINE_SEARCH_IMAGES.hero.alt} priority className="min-h-[280px] lg:min-h-full" />
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black text-slate-950">Quick searches</h2>
            <p className="mt-1 text-sm text-slate-700">Tap a common need to search medicines and request pharmacy confirmation.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {QUICK_SEARCH_IMAGE_KEYS.map((key) => <QuickSearchCard key={key} imageKey={key} onSelect={selectSearch} />)}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-black text-slate-950">{hasQuery ? `Results for "${query}"` : 'Popular medicine references'}</h2>
              <p className="mt-1 text-sm text-slate-700">Every result still requires pharmacy confirmation for availability and price.</p>
            </div>
            {loading ? <span className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700"><Loader2 className="h-4 w-4 animate-spin" /> Checking</span> : null}
          </div>

          {apiError ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
              {apiError}
            </div>
          ) : null}

          {results.length > 0 ? (
            <div className="space-y-4">
              {results.map((medicine) => <MedicineResultCard key={`${medicine.sourceRank}-${medicine.id}`} medicine={medicine} onRequest={openRequest} />)}
            </div>
          ) : noUsefulMatch ? (
            <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white text-slate-950 shadow-sm">
              <div className="grid gap-0 lg:grid-cols-[0.8fr_1.2fr]">
                <MedicineImage imageKey="noExactMatch" className="aspect-[4/3] lg:h-full" />
                <div className="space-y-4 p-6">
                  <h3 className="text-2xl font-black text-slate-950">No exact match found.</h3>
                  <p className="text-sm leading-7 text-slate-700">
                    You can still request this medicine and partner pharmacies will confirm availability.
                  </p>
                  <Button onClick={openManualRequest} className="bg-emerald-600 text-white hover:bg-emerald-500">
                    Request Medicine
                  </Button>
                </div>
              </div>
            </section>
          ) : (
            <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-700">Start typing a medicine, illness, or symptom.</div>
          )}

          {requestOpen ? (
            <ManualRequestForm
              form={requestForm}
              setForm={setRequestForm}
              onSubmit={submitRequest}
              onClose={() => setRequestOpen(false)}
              submitting={submittingRequest}
              statusMessage={requestStatus}
              onUseLocation={requestDeviceLocation}
            />
          ) : null}
        </div>

        <aside className="space-y-4">
          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white text-slate-950 shadow-sm">
            <MedicineImage imageKey="pharmacyConfirmation" alt={MEDICINE_SEARCH_IMAGES.pharmacyConfirmation.alt} className="aspect-video" />
            <div className="space-y-3 p-5">
              <h2 className="text-xl font-black text-slate-950">How confirmation works</h2>
              {[
                'Search medicine or symptom.',
                'Request availability.',
                'Pharmacy confirms stock and price.',
                'You continue with pickup or delivery.',
              ].map((step) => (
                <div key={step} className="flex items-start gap-3 text-sm leading-6 text-slate-700">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-emerald-600" />
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-1 h-5 w-5 flex-none" />
              <div>
                <h2 className="font-black">Safety note</h2>
                <p className="mt-2 text-sm leading-6">
                  DoctaRx does not tell you what medicine to take. Prescription medicines may require provider review before dispensing.
                </p>
              </div>
            </div>
          </section>
        </aside>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-2xl font-black text-slate-950">Browse categories</h2>
          <p className="mt-1 text-sm text-slate-700">Category images are visual guides only. They do not show confirmed pharmacy stock.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CATEGORY_IMAGE_KEYS.map((key) => <CategoryCard key={key} imageKey={key} onSelect={selectSearch} />)}
        </div>
      </section>
    </main>
  );
}
