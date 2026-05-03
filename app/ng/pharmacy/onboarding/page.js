'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Building2, CheckCircle2, ClipboardCheck, Loader2, LockKeyhole, MessageCircle, ShieldCheck } from 'lucide-react';
import api from '@/lib/api';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';
import { Button } from '@/components/ui/button';

const STATES = [
  'FCT', 'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa',
  'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti',
  'Enugu', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina',
  'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun',
  'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba',
  'Yobe', 'Zamfara',
];

const SERVICE_CATEGORIES = [
  ['prescription', 'Prescription medicines'],
  ['otc', 'OTC and wellness'],
  ['pediatric', 'Pediatric medicines'],
  ['women_health', "Women's health"],
  ['chronic_care', 'Chronic care'],
  ['delivery', 'Pickup/delivery coordination'],
];

const emptyForm = {
  name: '',
  legalBusinessName: '',
  branchName: '',
  email: '',
  phone: '',
  whatsapp: '',
  whatsappBusinessNumber: '',
  addressLine1: '',
  addressLine2: '',
  city: 'Abuja',
  state: 'FCT',
  lga: '',
  pcnLicenseNumber: '',
  pcnLicenseExpiry: '',
  superintendentName: '',
  superintendentPcnNumber: '',
  superintendentPhone: '',
  superintendentEmail: '',
  operatingWeekday: 'Mon-Fri 8:00 AM - 8:00 PM',
  operatingSaturday: 'Saturday 9:00 AM - 6:00 PM',
  operatingSunday: 'Sunday emergency/on-call only',
  preferredPrescriptionReceivingMethod: 'dashboard_whatsapp',
  pickupEnabled: true,
  deliveryEnabled: true,
  deliveryRadiusKm: '10',
  minimumOrderAmount: '500',
  serviceCategories: ['prescription', 'otc'],
  bankName: '',
  bankAccountNumber: '',
  bankAccountName: '',
  acceptsBankTransfer: true,
  acceptsPos: true,
  acceptsCash: true,
  onboardingNotes: '',
};

function fieldClass(extra = '') {
  return `h-12 rounded-2xl border border-slate-300 bg-white px-4 text-sm text-slate-950 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15 ${extra}`;
}

export default function NigeriaPharmacyOnboardingPage() {
  const [checkedAuth, setCheckedAuth] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    setHasToken(Boolean(token));
    setCheckedAuth(true);
  }, []);

  const selectedServices = useMemo(() => new Set(form.serviceCategories), [form.serviceCategories]);

  const update = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
    setError('');
  };

  const toggleCategory = (category) => {
    setForm((current) => ({
      ...current,
      serviceCategories: current.serviceCategories.includes(category)
        ? current.serviceCategories.filter((item) => item !== category)
        : [...current.serviceCategories, category],
    }));
    setError('');
  };

  const validate = () => {
    const required = [
      ['name', 'Pharmacy business name'],
      ['email', 'Account email'],
      ['phone', 'Phone number'],
      ['addressLine1', 'Branch address'],
      ['city', 'City'],
      ['state', 'State'],
      ['pcnLicenseNumber', 'PCN license number'],
      ['pcnLicenseExpiry', 'PCN license expiry'],
      ['superintendentName', 'Superintendent pharmacist name'],
      ['superintendentPcnNumber', 'Superintendent PCN number'],
      ['superintendentPhone', 'Superintendent phone'],
    ];

    const missing = required.find(([field]) => !String(form[field] || '').trim());
    if (missing) return `${missing[1]} is required.`;
    if (!form.pickupEnabled && !form.deliveryEnabled) return 'Choose at least pickup or delivery support.';
    if (!form.serviceCategories.length) return 'Choose at least one medication or service coverage area.';
    return '';
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const response = await api.post('/ng/pharmacy/register', {
        ...form,
        legalBusinessName: form.legalBusinessName || form.name,
        whatsappBusinessNumber: form.whatsappBusinessNumber || form.whatsapp || form.phone,
        operatingHours: {
          weekday: form.operatingWeekday,
          saturday: form.operatingSaturday,
          sunday: form.operatingSunday,
        },
        deliveryRadiusKm: Number(form.deliveryRadiusKm || 0),
        minimumOrderAmount: Number(form.minimumOrderAmount || 0),
      });
      setSuccess(response.data?.pharmacy || true);
    } catch (err) {
      const code = err.response?.status;
      if (code === 401 || code === 403) {
        setError('Please log in with a pharmacy account before continuing onboarding, or register a new pharmacy account.');
      } else {
        setError(err.response?.data?.error || 'Unable to submit pharmacy onboarding.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!checkedAuth) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-700" />
      </main>
    );
  }

  if (!hasToken) {
    return (
      <main className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.16),transparent_30%),linear-gradient(160deg,#ecfdf5,#f8fafc_55%,#ecfeff)] px-4 py-6 text-slate-950 sm:px-6">
        <div className="mx-auto max-w-4xl">
          <Link href="/ng/pharmacy" className="inline-flex items-center gap-3">
            <span className="rounded-2xl border border-slate-800 bg-slate-950 px-3 py-2">
              <DoctaRxLogo className="h-7 w-auto" />
            </span>
            <span className="text-sm font-semibold">DoctaRx Nigeria Pharmacy Portal</span>
          </Link>

          <section className="mt-8 rounded-[2rem] border border-white/80 bg-white/90 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.12)] sm:p-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
              <LockKeyhole className="h-4 w-4" />
              Pharmacy account required
            </div>
            <h1 className="mt-5 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">Continue pharmacy onboarding from a pharmacy account.</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-700 sm:text-base">
              Existing pharmacy partners should log in. New pharmacies should create a pharmacy account first so the onboarding submission is visible to DoctaRx admin and attached to the correct pharmacy user.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link href="/ng/pharmacy/login" className="w-full sm:w-auto">
                <Button className="h-12 w-full bg-emerald-700 text-white hover:bg-emerald-600 sm:w-auto">Pharmacy Login</Button>
              </Link>
              <Link href="/ng/pharmacy/register" className="w-full sm:w-auto">
                <Button variant="outline" className="h-12 w-full border-emerald-700/30 bg-white text-emerald-800 hover:bg-emerald-50 sm:w-auto">Register Pharmacy</Button>
              </Link>
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (success) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950">
        <section className="mx-auto max-w-xl rounded-[2rem] border border-emerald-200 bg-white p-7 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <h1 className="mt-5 text-2xl font-bold">Pharmacy onboarding submitted</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            DoctaRx admin can now review the pharmacy profile, PCN details, receiving preferences, pickup/delivery setup, and operational notes.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link href="/ng/pharmacy/dashboard">
              <Button className="bg-emerald-700 text-white hover:bg-emerald-600">Open Dashboard</Button>
            </Link>
            <Link href="/ng/pharmacy/settings">
              <Button variant="outline">Review Settings</Button>
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-slate-50 px-4 py-6 text-slate-950 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/ng/pharmacy" className="inline-flex items-center gap-3">
            <span className="rounded-2xl border border-slate-800 bg-slate-950 px-3 py-2">
              <DoctaRxLogo className="h-7 w-auto" />
            </span>
            <span>
              <span className="block text-sm font-semibold">DoctaRx Nigeria Pharmacy Portal</span>
              <span className="block text-xs text-slate-600">Operational onboarding</span>
            </span>
          </Link>
          <Link href="/ng/pharmacy/dashboard">
            <Button variant="outline" className="border-emerald-700/30 bg-white text-emerald-800 hover:bg-emerald-50">Open Dashboard</Button>
          </Link>
        </header>

        <section className="mt-7 grid gap-6 lg:grid-cols-[0.86fr_1.14fr]">
          <aside className="rounded-[2rem] bg-emerald-950 p-6 text-white sm:p-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
              <Building2 className="h-6 w-6" />
            </div>
            <h1 className="mt-5 text-3xl font-bold leading-tight">Complete pharmacy onboarding for Nigeria operations.</h1>
            <p className="mt-4 text-sm leading-7 text-emerald-50">
              This form creates a real DoctaRx pharmacy workspace for admin review. It does not publish live stock or pricing.
            </p>
            <div className="mt-7 space-y-3 text-sm text-emerald-50">
              {[
                ['Dashboard receiving', ClipboardCheck],
                ['WhatsApp preference and manual fallback', MessageCircle],
                ['PCN and superintendent review', ShieldCheck],
              ].map(([label, Icon]) => (
                <div key={label} className="flex items-center gap-3">
                  <Icon className="h-4 w-4 text-emerald-300" />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </aside>

          <form onSubmit={handleSubmit} className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            {error ? <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <input className={fieldClass('sm:col-span-2')} placeholder="Pharmacy business name" value={form.name} onChange={update('name')} required />
              <input className={fieldClass('sm:col-span-2')} placeholder="Legal/business registration name, if different" value={form.legalBusinessName} onChange={update('legalBusinessName')} />
              <input className={fieldClass('sm:col-span-2')} placeholder="Branch/location name" value={form.branchName} onChange={update('branchName')} />
              <input className={fieldClass()} type="email" placeholder="Account email for pharmacy login" value={form.email} onChange={update('email')} required />
              <input className={fieldClass()} placeholder="+234 phone number" value={form.phone} onChange={update('phone')} required />
              <input className={fieldClass()} placeholder="WhatsApp number" value={form.whatsapp} onChange={update('whatsapp')} />
              <input className={fieldClass()} placeholder="WhatsApp business number" value={form.whatsappBusinessNumber} onChange={update('whatsappBusinessNumber')} />
              <input className={fieldClass('sm:col-span-2')} placeholder="Branch address" value={form.addressLine1} onChange={update('addressLine1')} required />
              <input className={fieldClass('sm:col-span-2')} placeholder="Address line 2" value={form.addressLine2} onChange={update('addressLine2')} />
              <input className={fieldClass()} placeholder="City" value={form.city} onChange={update('city')} required />
              <select className={fieldClass()} value={form.state} onChange={update('state')} required>
                {STATES.map((state) => <option key={state} value={state}>{state}</option>)}
              </select>
              <input className={fieldClass()} placeholder="LGA" value={form.lga} onChange={update('lga')} />
              <input className={fieldClass()} placeholder="PCN license number" value={form.pcnLicenseNumber} onChange={update('pcnLicenseNumber')} required />
              <input className={fieldClass()} type="date" value={form.pcnLicenseExpiry} onChange={update('pcnLicenseExpiry')} required />
              <input className={fieldClass()} placeholder="Superintendent pharmacist name" value={form.superintendentName} onChange={update('superintendentName')} required />
              <input className={fieldClass()} placeholder="Superintendent PCN number" value={form.superintendentPcnNumber} onChange={update('superintendentPcnNumber')} required />
              <input className={fieldClass()} placeholder="Superintendent phone" value={form.superintendentPhone} onChange={update('superintendentPhone')} required />
              <input className={fieldClass()} type="email" placeholder="Superintendent email" value={form.superintendentEmail} onChange={update('superintendentEmail')} />
              <select className={fieldClass('sm:col-span-2')} value={form.preferredPrescriptionReceivingMethod} onChange={update('preferredPrescriptionReceivingMethod')}>
                <option value="dashboard">Dashboard only</option>
                <option value="whatsapp">WhatsApp only</option>
                <option value="dashboard_whatsapp">Dashboard + WhatsApp</option>
              </select>
              <input className={fieldClass('sm:col-span-2')} placeholder="Weekday operating hours" value={form.operatingWeekday} onChange={update('operatingWeekday')} />
              <input className={fieldClass()} placeholder="Saturday operating hours" value={form.operatingSaturday} onChange={update('operatingSaturday')} />
              <input className={fieldClass()} placeholder="Sunday/holiday operating hours" value={form.operatingSunday} onChange={update('operatingSunday')} />
              <input className={fieldClass()} inputMode="decimal" placeholder="Delivery radius in km" value={form.deliveryRadiusKm} onChange={update('deliveryRadiusKm')} />
              <input className={fieldClass()} inputMode="decimal" placeholder="Minimum order amount (NGN)" value={form.minimumOrderAmount} onChange={update('minimumOrderAmount')} />
              <input className={fieldClass()} placeholder="Bank name" value={form.bankName} onChange={update('bankName')} />
              <input className={fieldClass()} placeholder="Bank account number" value={form.bankAccountNumber} onChange={update('bankAccountNumber')} />
              <input className={fieldClass('sm:col-span-2')} placeholder="Bank account name" value={form.bankAccountName} onChange={update('bankAccountName')} />
            </div>

            <div className="mt-5 grid gap-3 text-sm text-slate-700 sm:grid-cols-3">
              {[
                ['pickupEnabled', 'Pickup workflow ready'],
                ['deliveryEnabled', 'Delivery workflow ready'],
                ['acceptsBankTransfer', 'Bank transfer ready'],
                ['acceptsPos', 'POS ready'],
                ['acceptsCash', 'Cash workflow ready'],
              ].map(([field, label]) => (
                <label key={field} className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <input type="checkbox" checked={form[field]} onChange={update(field)} />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">Medication and service coverage</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {SERVICE_CATEGORIES.map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700">
                    <input type="checkbox" checked={selectedServices.has(value)} onChange={() => toggleCategory(value)} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>

            <textarea className="mt-5 min-h-[110px] w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm" placeholder="Onboarding notes, delivery areas, operating constraints, or prescription receiving instructions" value={form.onboardingNotes} onChange={update('onboardingNotes')} />

            <Button type="submit" disabled={submitting} className="mt-6 h-12 w-full rounded-2xl bg-emerald-700 text-white hover:bg-emerald-600">
              {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting onboarding...</> : 'Submit Pharmacy Onboarding'}
            </Button>
          </form>
        </section>
      </div>
    </main>
  );
}
