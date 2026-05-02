'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Building2, CheckCircle2, ShieldCheck } from 'lucide-react';
import api, { authAPI } from '@/lib/api';
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

function meetsPasswordPolicy(value) {
  return value.length >= 8 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value);
}

export default function NigeriaPharmacyRegisterPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    ownerFirstName: '',
    ownerLastName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    name: '',
    pcnLicenseNumber: '',
    pcnLicenseExpiry: '',
    superintendentName: '',
    superintendentPcnNumber: '',
    superintendentPhone: '',
    addressLine1: '',
    city: 'Abuja',
    state: 'FCT',
    whatsapp: '',
    whatsappBusinessNumber: '',
    preferredPrescriptionReceivingMethod: 'dashboard_whatsapp',
    acceptsBankTransfer: true,
    acceptsPos: true,
    acceptsCash: true,
    termsAccepted: true,
  });

  const passwordOk = useMemo(() => meetsPasswordPolicy(form.password), [form.password]);

  const update = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
    setError('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!passwordOk) {
      setError('Password must include uppercase, lowercase, number, and symbol.');
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const authResponse = await authAPI.register({
        firstName: form.ownerFirstName,
        lastName: form.ownerLastName,
        email: form.email,
        phone: form.phone,
        password: form.password,
        confirmPassword: form.confirmPassword,
        role: 'pharmacy',
        country: 'NG',
        city: form.city,
        region: form.state,
        hipaaConsent: true,
        termsAccepted: true,
      });

      if (authResponse.data?.accessToken) {
        localStorage.setItem('accessToken', authResponse.data.accessToken);
      }
      if (authResponse.data?.refreshToken) {
        localStorage.setItem('refreshToken', authResponse.data.refreshToken);
      }
      if (authResponse.data?.user) {
        localStorage.setItem('user', JSON.stringify(authResponse.data.user));
      }

      await api.post('/ng/pharmacy/register', {
        name: form.name,
        email: form.email,
        phone: form.phone,
        whatsapp: form.whatsapp || form.phone,
        whatsappBusinessNumber: form.whatsappBusinessNumber || form.whatsapp || form.phone,
        preferredPrescriptionReceivingMethod: form.preferredPrescriptionReceivingMethod,
        pcnLicenseNumber: form.pcnLicenseNumber,
        pcnLicenseExpiry: form.pcnLicenseExpiry,
        superintendentName: form.superintendentName,
        superintendentPcnNumber: form.superintendentPcnNumber,
        superintendentPhone: form.superintendentPhone || form.phone,
        addressLine1: form.addressLine1,
        city: form.city,
        state: form.state,
        acceptsBankTransfer: form.acceptsBankTransfer,
        acceptsPos: form.acceptsPos,
        acceptsCash: form.acceptsCash,
      });

      router.push('/ng/pharmacy/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.errors?.[0]?.message || 'Unable to create pharmacy account.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen overflow-x-hidden bg-slate-50 px-4 py-6 text-slate-950 sm:px-6">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-8 flex max-w-full flex-col items-start gap-4 overflow-hidden sm:flex-row sm:items-center sm:justify-between">
          <Link href="/ng" className="inline-flex max-w-full min-w-0 flex-wrap items-center gap-3">
            <span className="rounded-2xl border border-slate-800 bg-slate-950 px-3 py-2 shadow-sm">
              <DoctaRxLogo className="h-7 w-auto" />
            </span>
            <span className="text-sm font-semibold text-slate-700">Nigeria Pharmacy Portal</span>
          </Link>
          <Link href="/ng/pharmacy/login" className="text-sm font-semibold text-emerald-700 hover:text-emerald-600">
            Pharmacy login
          </Link>
        </header>

        <section className="grid w-full max-w-full min-w-0 gap-6 overflow-hidden lg:grid-cols-[0.9fr_1.1fr]">
          <div className="w-full max-w-[calc(100vw-2rem)] min-w-0 overflow-hidden rounded-3xl bg-emerald-950 p-6 text-white sm:p-8">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
              <Building2 className="h-6 w-6" />
            </div>
            <h1 className="break-words text-2xl font-bold tracking-tight sm:text-3xl">Join the DoctaRx Nigeria pharmacy network</h1>
            <p className="mt-4 break-words text-sm leading-6 text-emerald-50">
              Register your pharmacy, receive routed prescriptions, confirm medicine availability, and manage pickup or delivery requests from the DoctaRx platform.
            </p>
            <div className="mt-8 space-y-3 text-sm text-emerald-50">
              {['PCN and superintendent pharmacist details are reviewed', 'Dashboard and WhatsApp-assisted receiving are supported', 'No fake stock or prices are shown to patients'].map((item) => (
                <div key={item} className="flex gap-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                  <span className="min-w-0 break-words">{item}</span>
                </div>
              ))}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="w-full max-w-[calc(100vw-2rem)] min-w-0 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="mb-5 flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              <ShieldCheck className="h-5 w-5 shrink-0" />
              <p>Pharmacy access is created now. Dispensing tools activate after onboarding review.</p>
            </div>

            {error ? (
              <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <input className="h-12 rounded-2xl border border-slate-300 px-4 text-sm" placeholder="Owner first name" value={form.ownerFirstName} onChange={update('ownerFirstName')} required />
              <input className="h-12 rounded-2xl border border-slate-300 px-4 text-sm" placeholder="Owner last name" value={form.ownerLastName} onChange={update('ownerLastName')} required />
              <input className="h-12 rounded-2xl border border-slate-300 px-4 text-sm" placeholder="Email" type="email" value={form.email} onChange={update('email')} required />
              <input className="h-12 rounded-2xl border border-slate-300 px-4 text-sm" placeholder="+234 phone number" value={form.phone} onChange={update('phone')} required />
              <input className="h-12 rounded-2xl border border-slate-300 px-4 text-sm" placeholder="Password" type="password" value={form.password} onChange={update('password')} required />
              <input className="h-12 rounded-2xl border border-slate-300 px-4 text-sm" placeholder="Confirm password" type="password" value={form.confirmPassword} onChange={update('confirmPassword')} required />
              <p className={`sm:col-span-2 text-xs ${passwordOk ? 'text-emerald-700' : 'text-slate-500'}`}>Use at least 8 characters with uppercase, lowercase, number, and symbol.</p>

              <input className="h-12 rounded-2xl border border-slate-300 px-4 text-sm sm:col-span-2" placeholder="Pharmacy business name" value={form.name} onChange={update('name')} required />
              <input className="h-12 rounded-2xl border border-slate-300 px-4 text-sm" placeholder="PCN license number" value={form.pcnLicenseNumber} onChange={update('pcnLicenseNumber')} required />
              <input className="h-12 rounded-2xl border border-slate-300 px-4 text-sm" type="date" value={form.pcnLicenseExpiry} onChange={update('pcnLicenseExpiry')} required />
              <input className="h-12 rounded-2xl border border-slate-300 px-4 text-sm" placeholder="Superintendent pharmacist name" value={form.superintendentName} onChange={update('superintendentName')} required />
              <input className="h-12 rounded-2xl border border-slate-300 px-4 text-sm" placeholder="Superintendent PCN number" value={form.superintendentPcnNumber} onChange={update('superintendentPcnNumber')} required />
              <input className="h-12 rounded-2xl border border-slate-300 px-4 text-sm" placeholder="Superintendent phone" value={form.superintendentPhone} onChange={update('superintendentPhone')} />
              <input className="h-12 rounded-2xl border border-slate-300 px-4 text-sm" placeholder="WhatsApp business number" value={form.whatsappBusinessNumber} onChange={update('whatsappBusinessNumber')} />
              <input className="h-12 rounded-2xl border border-slate-300 px-4 text-sm sm:col-span-2" placeholder="Branch address" value={form.addressLine1} onChange={update('addressLine1')} required />
              <input className="h-12 rounded-2xl border border-slate-300 px-4 text-sm" placeholder="City" value={form.city} onChange={update('city')} required />
              <select className="h-12 rounded-2xl border border-slate-300 px-4 text-sm" value={form.state} onChange={update('state')} required>
                {STATES.map((state) => <option key={state} value={state}>{state}</option>)}
              </select>
              <select className="h-12 rounded-2xl border border-slate-300 px-4 text-sm sm:col-span-2" value={form.preferredPrescriptionReceivingMethod} onChange={update('preferredPrescriptionReceivingMethod')}>
                <option value="dashboard">Dashboard only</option>
                <option value="whatsapp">WhatsApp only</option>
                <option value="dashboard_whatsapp">Dashboard + WhatsApp</option>
              </select>
            </div>

            <div className="mt-5 grid gap-3 text-sm text-slate-700 sm:grid-cols-3">
              {[
                ['acceptsBankTransfer', 'Bank transfer ready'],
                ['acceptsPos', 'POS ready'],
                ['acceptsCash', 'Cash workflow ready'],
              ].map(([field, label]) => (
                <label key={field} className="flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-3">
                  <input type="checkbox" checked={form[field]} onChange={update(field)} />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            <Button type="submit" disabled={submitting} className="mt-6 h-12 w-full rounded-2xl bg-emerald-600 text-white hover:bg-emerald-500">
              {submitting ? 'Creating pharmacy account...' : 'Create Pharmacy Account'}
            </Button>
          </form>
        </section>
      </div>
    </main>
  );
}
