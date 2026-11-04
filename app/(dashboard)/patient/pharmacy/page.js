'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Loader2, MapPin, Pill } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import PharmacyLocator from '@/components/PharmacyLocator';
import PortalPageHeader from '@/components/branding/PortalPageHeader';
import { Button } from '@/components/ui/button';

const empty = { owner: null, loading: true, rows: [], error: '' };
const emptyEntry = { selection: null, pending: false, notice: null };
const displayStatus = value => typeof value === 'string' && value.trim() ? value.replace(/_/g, ' ') : 'Status unavailable';
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const ownedRecord = (record, patientId) => uuid.test(String(record?.id || ''))
  && String(record.patientId || record.patient_id) === String(patientId);

export default function PatientPharmacyPage() {
  const { user, loading: authLoading } = useAuth();
  const owner = user?.id ? JSON.stringify([user.id, user.role, user.marketScope || user.region || user.country]) : null;
  const ready = Boolean(user?.id && user.role === 'patient' && !authLoading);
  const [tab, setTab] = useState('find');
  const [prescriptions, setPrescriptions] = useState(empty);
  const [preferences, setPreferences] = useState(empty);
  const [revision, setRevision] = useState(0);
  const [entry, setEntry] = useState({ owner: null, ...emptyEntry });
  const mutation = useRef(null);
  const mounted = useRef(false);
  const reads = useRef(0);
  const account = useRef({ owner, ready, generation: 0 });
  if (account.current.owner !== owner || account.current.ready !== ready) {
    account.current = { owner, ready, generation: account.current.generation + 1 };
  }
  const generation = account.current.generation;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; mutation.current?.controller.abort(); };
  }, []);
  useEffect(() => {
    mutation.current?.controller.abort(); mutation.current = null;
    setEntry({ owner, generation, ...emptyEntry });
    return () => { mutation.current?.controller.abort(); mutation.current = null; };
    // Account context changes clear local choices; readiness is generation-gated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);
  useEffect(() => {
    const controller = new AbortController();
    const sequence = ++reads.current;
    const current = () => !controller.signal.aborted && reads.current === sequence && account.current.owner === owner
      && account.current.ready && account.current.generation === generation;
    setPrescriptions({ ...empty, owner, generation }); setPreferences({ ...empty, owner, generation });
    if (!ready) {
      mutation.current?.controller.abort(); mutation.current = null;
      setEntry(previous => ({ ...previous, pending: false }));
      const unavailable = { owner, generation, rows: [], loading: Boolean(authLoading), error: authLoading ? '' : 'Sign in to your patient account to view these records.' };
      setPrescriptions(unavailable); setPreferences(unavailable);
      return () => controller.abort();
    }
    for (const [url, key, update] of [['/prescriptions', 'prescriptions', setPrescriptions], ['/pharmacy/preferences', 'pharmacies', setPreferences]]) {
      api.get(url, { signal: controller.signal }).then(({ data }) => {
        if (!data?.success || !Array.isArray(data[key]) || data[key].some(record => !ownedRecord(record, user.id))) throw new Error('These records could not be confirmed.');
        if (current()) update({ owner, generation, rows: data[key], loading: false, error: '' });
      }).catch(error => {
        if (current()) update({ owner, generation, rows: [], loading: false, error: error.response?.status === 403 ? 'Your account cannot access these records.' : 'These records could not be loaded. Please try again.' });
      });
    }
    return () => controller.abort();
    // owner includes ID, role and market; generation rejects readiness changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, ready, authLoading, revision]);

  const view = state => ready && state.owner === owner && state.generation === generation ? state : {
    rows: [], loading: Boolean(authLoading || ready), error: authLoading || ready ? '' : 'Sign in to your patient account to view these records.',
  };
  const rx = view(prescriptions), saved = view(preferences);
  const { selection: chosen, pending, notice } = ready && entry.owner === owner && entry.generation === generation ? entry : emptyEntry;
  function updateEntry(change) {
    if (account.current.owner !== owner || !account.current.ready || account.current.generation !== generation) return;
    setEntry(previous => ({ ...(previous.owner === owner && previous.generation === generation ? previous : emptyEntry), owner, generation, ...change }));
  }

  async function changePreference(kind, id) {
    if (mutation.current || !ready || account.current.owner !== owner || account.current.generation !== generation) return;
    if (!['save', 'preferred', 'remove'].includes(kind) || kind !== 'save' && !uuid.test(String(id || ''))) return;
    if (kind === 'remove' && !window.confirm('Remove this pharmacy from your saved choices?')) return;
    const controller = new AbortController();
    const active = { controller, owner, generation }; mutation.current = active;
    const current = () => !controller.signal.aborted && mounted.current && account.current.owner === owner
      && account.current.ready && account.current.generation === generation;
    updateEntry({ pending: true, notice: null });
    try {
      let response;
      if (kind === 'save') {
        if (!chosen?.pharmacy) throw new Error('Choose a pharmacy first.');
        const pharmacy = chosen.pharmacy;
        response = await api.post('/pharmacy/preferences', {
          pharmacyName: pharmacy.name,
          pharmacyAddress: pharmacy.address,
          ...(pharmacy.phone ? { pharmacyPhone: pharmacy.phone } : {}),
          ...(pharmacy.npi ? { pharmacyNpi: pharmacy.npi } : {}),
          ...(typeof pharmacy.latitude === 'number' ? { latitude: pharmacy.latitude } : {}),
          ...(typeof pharmacy.longitude === 'number' ? { longitude: pharmacy.longitude } : {}),
          isPreferred: false, source: 'patient_selected',
        }, { signal: controller.signal });
      } else if (kind === 'preferred') response = await api.put('/pharmacy/preferences/' + id + '/preferred', {}, { signal: controller.signal });
      else response = await api.delete('/pharmacy/preferences/' + id, { signal: controller.signal });
      const { data } = response;
      if (!data?.success || (kind !== 'remove' && (!ownedRecord(data.pharmacy, user.id) || kind === 'preferred' && data.pharmacy.id !== id))) throw new Error('The server did not confirm the change. Refresh your saved pharmacies before retrying.');
      if (current()) {
        reads.current += 1;
        updateEntry({ notice: { error: false, message: kind === 'save' ? 'Pharmacy details saved. No prescription has been sent.' : kind === 'preferred' ? 'Your preferred pharmacy was updated.' : 'The pharmacy was removed from your saved choices.' }, selection: null });
        setRevision(value => value + 1);
      }
    } catch (error) {
      if (current()) updateEntry({ notice: { error: true, message: error.response?.data?.error || error.message || 'The change could not be saved.' } });
    } finally {
      if (current()) updateEntry({ pending: false });
      if (mutation.current === active) mutation.current = null;
    }
  }

  function recordsState(resource, emptyMessage, children) {
    if (resource.loading) return <p role="status" className="flex items-center gap-3 rounded-2xl bg-blue-50 p-5 text-blue-900"><Loader2 size={20} className="animate-spin" /> Loading your records…</p>;
    if (resource.error) return <div role="alert" className="portal-error rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900"><p>{resource.error}</p><Button onClick={() => setRevision(value => value + 1)} variant="outline" className="mt-4">Try again</Button></div>;
    if (resource.rows.length === 0) return <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 leading-7 text-slate-600">{emptyMessage}</p>;
    return children;
  }

  return <div className="clinical-readable space-y-6">
    <PortalPageHeader title="Your pharmacies" description="Find a pharmacy near your device or choose an area near home or work. Save the details you want your care team to use, and review recorded prescription status.">
      <Link href="/patient/prescriptions" className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 px-5 py-3 font-semibold text-slate-900">Prescription details <ArrowRight size={20} /></Link>
    </PortalPageHeader>
    {notice && <p role={notice.error ? 'alert' : 'status'} className={'rounded-2xl border p-5 leading-7 ' + (notice.error ? 'border-red-200 bg-red-50 text-red-900' : 'border-blue-200 bg-blue-50 text-blue-950')}>{notice.message}</p>}
    <div className="flex flex-wrap gap-3" aria-label="Pharmacy workspace tabs">{[['find', 'Find a pharmacy'], ['saved', 'Saved pharmacies'], ['prescriptions', 'Prescriptions']].map(([value, label]) => <Button key={value} aria-pressed={tab === value} onClick={() => setTab(value)} variant={tab === value ? 'default' : 'outline'} className={tab === value ? 'bg-blue-700 hover:bg-blue-800' : ''}>{label}</Button>)}</div>
    {tab === 'find' && <div className="space-y-5">{chosen && <section className="rounded-2xl border border-blue-200 bg-blue-50 p-6"><h2 className="text-xl font-semibold text-slate-950">{chosen.pharmacy.name}</h2><p className="mt-2 break-words leading-7 text-slate-700">{chosen.pharmacy.address}</p><p className="mt-3 leading-7 text-slate-600">Confirm the pharmacy's details, availability, and pricing directly. Saving this choice does not verify coverage or send a prescription.</p><Button disabled={pending} onClick={() => changePreference('save')} className="mt-5 bg-blue-700 hover:bg-blue-800">{pending ? 'Saving choice…' : 'Save to your pharmacies'}</Button></section>}<PharmacyLocator includePrescriptionContacts={false} onSelect={choice => { if (!mutation.current && ready) updateEntry({ selection: choice, notice: null }); }} /></div>}
    {tab === 'saved' && <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8"><h2 className="mb-6 text-2xl font-semibold text-slate-950">Saved pharmacies</h2>{recordsState(saved, 'No pharmacy choices are saved in your account.', <div className="grid items-start gap-5 lg:grid-cols-2">{saved.rows.map(record => <article key={record.id} className="rounded-2xl border border-slate-200 p-5"><div className="flex items-start gap-3"><MapPin size={24} className="mt-1 shrink-0 text-blue-700" /><h3 className="break-words text-xl font-semibold text-slate-950">{record.pharmacyName || 'Pharmacy name unavailable'}</h3></div><p className="mt-4 break-words leading-7 text-slate-600">{record.pharmacyAddress || 'Address unavailable'}</p>{record.pharmacyPhone && <p className="mt-3 break-words text-slate-600">{record.pharmacyPhone}</p>}<p className="mt-4 font-medium text-slate-800">{record.isPreferred ? 'Your preferred choice' : 'Saved choice'} · Details not independently verified</p><div className="mt-5 flex flex-wrap gap-3">{!record.isPreferred && <Button disabled={pending} variant="outline" onClick={() => changePreference('preferred', record.id)}>Set as preferred</Button>}<Button disabled={pending} variant="outline" onClick={() => changePreference('remove', record.id)} className="text-red-800">Remove</Button></div></article>)}</div>)}</section>}
    {tab === 'prescriptions' && <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8"><h2 className="mb-6 text-2xl font-semibold text-slate-950">Recorded prescriptions</h2>{recordsState(rx, 'No prescriptions are recorded for your account.', <div className="space-y-5">{rx.rows.map(record => <article key={record.id} className="rounded-2xl border border-slate-200 p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-3"><Pill size={24} className="shrink-0 text-blue-700" /><h3 className="text-xl font-semibold text-slate-950">{record.medicationName || record.medication_name || 'Medication name unavailable'}</h3></div><span className="rounded-full bg-slate-100 px-4 py-2 font-medium capitalize text-slate-800">{displayStatus(record.status)}</span></div><p className="mt-4 leading-7 text-slate-600">{record.pharmacyName || record.pharmacy_name || 'Pharmacy is not recorded'}</p><Link href="/patient/prescriptions" className="mt-4 inline-flex min-h-12 items-center gap-2 font-semibold text-blue-700">View prescription <ArrowRight size={20} /></Link></article>)}</div>)}</section>}
  </div>;
}
