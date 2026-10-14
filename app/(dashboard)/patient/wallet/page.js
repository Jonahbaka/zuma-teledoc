'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowRight, Loader2, Plus, Shield } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import PortalPageHeader from '@/components/branding/PortalPageHeader';

const emptyForm = { payerName: '', memberId: '', groupNumber: '', planName: '' };
const fieldStyle = 'mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-950 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100';
const emptyEntry = { showForm: false, form: emptyForm, saving: false, saveError: '', notice: '' };

function ownedRecord(record, userId) {
  return typeof record?.id === 'string' && record.id.length > 0
    && (!record.user_id && !record.patient_id || String(record.user_id || record.patient_id) === String(userId));
}

export default function InsuranceWalletPage() {
  const { user, loading: authLoading } = useAuth();
  const owner = user?.id ? JSON.stringify([user.id, user.role, user.marketScope || user.region || user.country]) : null;
  const ready = Boolean(user?.id && user.role === 'patient' && !authLoading);
  const [records, setRecords] = useState({ owner: null, wallet: [], loading: true, error: '' });
  const [entry, setEntry] = useState({ owner: null, ...emptyEntry });
  const [revision, setRevision] = useState(0);
  const request = useRef(null);
  const attempt = useRef(null);
  const reads = useRef(0);
  const account = useRef({ owner, ready, generation: 0 });
  if (account.current.owner !== owner || account.current.ready !== ready) {
    account.current = { owner, ready, generation: account.current.generation + 1 };
  }

  useEffect(() => {
    request.current?.controller.abort(); request.current = null;
    attempt.current = null;
    setEntry({ owner, ...emptyEntry });
    return () => { request.current?.controller.abort(); request.current = null; };
  }, [owner]);

  useEffect(() => {
    const controller = new AbortController();
    const generation = account.current.generation;
    const sequence = ++reads.current;
    const current = () => !controller.signal.aborted && reads.current === sequence
      && account.current.owner === owner && account.current.ready && account.current.generation === generation;
    if (!ready) {
      request.current?.controller.abort(); request.current = null;
      setEntry(previous => ({ ...previous, saving: false }));
      setRecords({ owner, wallet: [], loading: Boolean(authLoading), error: authLoading ? '' : 'Sign in to your patient account to view insurance details.' });
      return () => controller.abort();
    }
    setRecords({ owner, wallet: [], loading: true, error: '' });
    api.get('/insurance/wallet', { signal: controller.signal }).then(({ data }) => {
      if (!data?.success || !Array.isArray(data.wallet) || data.wallet.some(record => !ownedRecord(record, user.id))) throw new Error('Insurance records could not be confirmed.');
      if (current()) setRecords({ owner, wallet: data.wallet, loading: false, error: '' });
    }).catch((failure) => {
      if (current()) setRecords({ owner, wallet: [], loading: false, error: failure.response?.data?.error || 'Insurance records could not be loaded. Please try again.' });
    });
    return () => controller.abort();
    // owner includes the actor ID, role and market; generation covers readiness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, ready, authLoading, revision]);

  const visibleRecords = ready && records.owner === owner ? records : {
    wallet: [], loading: Boolean(authLoading || ready), error: authLoading || ready ? '' : 'Sign in to your patient account to view insurance details.',
  };
  const { wallet, loading, error } = visibleRecords;
  const { showForm, form, saving, saveError, notice } = ready && entry.owner === owner ? entry : emptyEntry;
  function updateEntry(change) {
    if (account.current.owner !== owner || !account.current.ready) return;
    setEntry(previous => ({ ...(previous.owner === owner ? previous : emptyEntry), owner, ...change }));
  }

  function updateField(name, value) {
    updateEntry({ form: { ...form, [name]: value }, saveError: '', notice: '' });
  }

  async function saveInsurance(event) {
    event.preventDefault();
    if (saving || !ready || account.current.owner !== owner || request.current) return;
    const generation = account.current.generation;
    const payload = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim()]));
    if (payload.payerName.length < 2 || !payload.memberId) {
      updateEntry({ saveError: 'Enter your insurance company and member ID.' }); return;
    }
    const content = JSON.stringify(payload);
    if (!attempt.current || attempt.current.owner !== owner || attempt.current.content !== content) attempt.current = { owner, key: crypto.randomUUID(), payload, content };
    const submission = attempt.current;
    const controller = new AbortController();
    const active = { controller, owner, generation };
    request.current = active;
    const current = () => !controller.signal.aborted && account.current.owner === owner
      && account.current.ready && account.current.generation === generation;
    updateEntry({ saving: true, saveError: '', notice: '' });
    try {
      const { data } = await api.post('/insurance/manual', submission.payload, {
        headers: { 'Idempotency-Key': submission.key }, signal: controller.signal,
      });
      if (!data?.success || !ownedRecord(data.insurance, user.id)) throw new Error('The server did not confirm a saved insurance record. Retry this submission.');
      if (current()) {
        reads.current += 1;
        setRecords(previous => ({ owner, wallet: [data.insurance, ...(previous.owner === owner ? previous.wallet : []).filter(item => item.id !== data.insurance.id)], loading: false, error: '' }));
        updateEntry({ notice: 'Insurance details saved. Current benefits still need insurer confirmation.', form: emptyForm, showForm: false });
        attempt.current = null;
        setRevision(value => value + 1);
      }
    } catch (failure) {
      if (current()) updateEntry({ saveError: failure.response?.data?.error || failure.message || 'Insurance details could not be saved. Retry without changing the form to reuse the same submission.' });
    } finally {
      if (current()) updateEntry({ saving: false });
      if (request.current === active) request.current = null;
    }
  }

  return <div className="clinical-readable space-y-6">
    <PortalPageHeader title="Insurance and benefits" description="Keep your insurance details with your DoctaRx account. Coverage, authorizations, and payment responsibility depend on your insurer's confirmation.">
      <button type="button" disabled={!ready} onClick={() => updateEntry({ showForm: true, notice: '' })} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-blue-700 px-5 py-3 font-semibold text-white hover:bg-blue-800 disabled:opacity-60"><Plus size={20} /> Add insurance</button>
      <Link href={['NG', 'NIGERIA'].includes(String(user?.marketScope || user?.region || user?.country || '').trim().toUpperCase()) ? '/ng/patient/subscription' : '/patient/subscription'} className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 px-5 py-3 font-semibold text-slate-900">Membership details <ArrowRight size={20} /></Link>
    </PortalPageHeader>
    {notice && <p role="status" className="rounded-2xl border border-blue-200 bg-blue-50 p-5 leading-7 text-blue-950">{notice}</p>}
    {showForm && <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8" aria-labelledby="insurance-entry-title">
      <h2 id="insurance-entry-title" className="text-2xl font-semibold text-slate-950">Add your insurance details</h2>
      <p className="mt-2 leading-7 text-slate-600">Copy the details from your insurance card. Saving a card does not verify coverage.</p>
      <form onSubmit={saveInsurance} className="mt-6 grid gap-5 sm:grid-cols-2">
        {[['payerName', 'Insurance company', true, 120], ['memberId', 'Member ID', true, 100], ['groupNumber', 'Group number (optional)', false, 100], ['planName', 'Plan name (optional)', false, 120]].map(([name, label, required, max]) => <label key={name} htmlFor={'insurance-' + name} className="font-medium text-slate-800">{label}<input id={'insurance-' + name} required={required} maxLength={max} autoComplete="off" disabled={saving} value={form[name]} onChange={event => updateField(name, event.target.value)} className={fieldStyle} /></label>)}
        {saveError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 leading-7 text-red-900 sm:col-span-2">{saveError}</p>}
        <div className="flex flex-wrap gap-3 sm:col-span-2"><button disabled={saving} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-blue-700 px-5 py-3 font-semibold text-white disabled:opacity-60">{saving && <Loader2 size={20} className="animate-spin" />}{saving ? 'Saving details…' : 'Save insurance details'}</button><button type="button" disabled={saving} onClick={() => updateEntry({ showForm: false, saveError: '' })} className="min-h-12 rounded-xl border border-slate-300 px-5 py-3 font-medium text-slate-800">Cancel</button></div>
      </form>
    </section>}
    <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8" aria-labelledby="saved-insurance-title">
      <h2 id="saved-insurance-title" className="text-2xl font-semibold text-slate-950">Your insurance</h2>
      {loading ? <p role="status" className="mt-6 flex items-center gap-3 text-slate-600"><Loader2 size={20} className="animate-spin" /> Loading insurance records…</p> : error ? <div role="alert" className="portal-error mt-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900"><p className="flex items-start gap-2"><AlertCircle size={22} className="shrink-0" />{error}</p><button onClick={() => setRevision(value => value + 1)} className="mt-3 min-h-12 rounded-xl border border-red-300 px-4 font-semibold">Try again</button></div> : wallet.length === 0 ? <div className="mt-6 rounded-2xl bg-slate-50 p-6"><Shield size={28} className="text-blue-700" /><p className="mt-3 font-semibold text-slate-950">No insurance details saved</p><p className="mt-2 leading-7 text-slate-600">Add a card when you are ready. Available payment options are shown during booking.</p></div> : <div className="mt-6 grid gap-4 lg:grid-cols-2">{wallet.map(record => {
        const verified = record.is_verified === true;
        const status = record.eligibility_status || 'unknown';
        return <article key={record.id} className="rounded-2xl border border-slate-200 p-6">
          <div className="flex items-start justify-between gap-3"><Shield size={26} className="shrink-0 text-blue-700" /><span className="rounded-full bg-slate-100 px-4 py-2 font-medium text-slate-800">{verified ? 'Verification recorded' : 'Coverage unverified'}</span></div>
          <h3 className="mt-5 text-xl font-semibold text-slate-950">{record.payerName || record.insurance_provider || 'Insurance company unavailable'}</h3>
          {Boolean(record.planName || record.plan_name) && <p className="mt-2 text-slate-600">{record.planName || record.plan_name}</p>}
          <dl className="mt-5 space-y-3 text-slate-700"><div><dt className="font-medium">Member ID</dt><dd className="mt-1 break-all">{record.memberId || record.policyNumber || record.member_id || 'Unavailable'}</dd></div>{Boolean(record.groupNumber || record.group_number) && <div><dt className="font-medium">Group number</dt><dd className="mt-1 break-all">{record.groupNumber || record.group_number}</dd></div>}<div><dt className="font-medium">Eligibility status</dt><dd className="mt-1 capitalize">{String(status).replace(/_/g, ' ')}</dd></div></dl>
          <p className="mt-5 border-t border-slate-100 pt-4 leading-7 text-slate-600">{verified ? 'A verification is on file. Benefits and authorization must be confirmed for each service.' : 'These are saved account details. They do not establish current coverage or guaranteed benefits.'}</p>
        </article>;
      })}</div>}
    </section>
  </div>;
}

