'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Calendar, History, Loader2, MessageCircle } from 'lucide-react';
import api from '@/lib/api';
import { DoctaService } from '@/lib/doctaService';
import { useAuth } from '@/components/providers/AuthProvider';
import PortalPageHeader from '@/components/branding/PortalPageHeader';

export default function PatientTriagePage() {
  const { user, loading: authLoading } = useAuth();
  const owner = user?.id ? JSON.stringify([user.id, user.role, user.marketScope || user.region || user.country]) : null;
  const ready = Boolean(user?.id && user.role === 'patient' && !authLoading);
  const [summary, setSummary] = useState({ owner: null, symptoms: '', processing: false, guidanceMessage: '' });
  const [visit, setVisit] = useState({ owner: null, appointment: null, loading: true, loadError: '' });
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const account = useRef({ owner, ready, version: 0 });
  const activeGuidance = useRef(null);
  if (account.current.owner !== owner || account.current.ready !== ready) {
    generation.current += 1;
    account.current = { owner, ready, version: account.current.version + 1 };
  }

  useEffect(() => {
    setSummary({ owner, symptoms: '', processing: false, guidanceMessage: '' });
    activeGuidance.current = null;
    return () => { generation.current += 1; activeGuidance.current = null; };
  }, [owner]);

  useEffect(() => {
    const controller = new AbortController();
    const version = account.current.version;
    const current = () => !controller.signal.aborted && account.current.owner === owner && account.current.ready && account.current.version === version;
    if (!ready) {
      activeGuidance.current = null;
      setSummary(previous => ({ ...previous, processing: false }));
      setVisit({ owner, appointment: null, loading: Boolean(authLoading), loadError: authLoading ? '' : 'Sign in to your patient account to view your next visit.' });
      return () => controller.abort();
    }
    setVisit({ owner, appointment: null, loading: true, loadError: '' });
    api.get('/appointments/upcoming', { params: { limit: 1 }, signal: controller.signal }).then(({ data }) => {
      const appointment = data?.appointments?.[0] || null;
      const patientId = appointment?.patientId || appointment?.patient_id;
      if (!data?.success || !Array.isArray(data.appointments)
        || appointment && (typeof appointment.id !== 'string' || patientId && String(patientId) !== String(user.id))) throw new Error('Your appointment could not be confirmed.');
      if (current()) setVisit({ owner, appointment, loading: false, loadError: '' });
    }).catch(() => {
      if (current()) setVisit({ owner, appointment: null, loading: false, loadError: 'Your next appointment could not be loaded. Try again when ready.' });
    });
    return () => controller.abort();
    // owner includes the actor ID, role and market.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, ready, authLoading, revision]);

  const { symptoms, processing, guidanceMessage } = ready && summary.owner === owner ? summary : { symptoms: '', processing: false, guidanceMessage: '' };
  const { appointment, loading, loadError } = ready && visit.owner === owner ? visit : {
    appointment: null, loading: Boolean(authLoading || ready), loadError: authLoading || ready ? '' : 'Sign in to your patient account to view your next visit.',
  };
  function updateSummary(change) {
    if (account.current.owner !== owner || !account.current.ready) return;
    setSummary(previous => ({ ...(previous.owner === owner ? previous : { symptoms: '', processing: false, guidanceMessage: '' }), owner, ...change }));
  }

  async function requestGuidance(event) {
    event.preventDefault();
    if (!ready || processing || activeGuidance.current !== null || !symptoms.trim() || account.current.owner !== owner) return;
    const request = ++generation.current;
    activeGuidance.current = request;
    const current = () => request === generation.current && account.current.owner === owner && account.current.ready;
    updateSummary({ processing: true, guidanceMessage: '' });
    try {
      await DoctaService.runAITriage(symptoms.trim());
      // An unvalidated response must never become a routine severity, diagnosis,
      // medication recommendation, or a clinician submission.
      if (current()) updateSummary({ guidanceMessage: 'Automated guidance could not be validated. No assessment was recorded or sent. Share your symptoms with a clinician.' });
    } catch {
      if (current()) updateSummary({ guidanceMessage: 'Optional automated symptom guidance is not connected. You can continue booking and share your symptoms with a clinician.' });
    } finally {
      if (current()) updateSummary({ processing: false });
      if (activeGuidance.current === request) activeGuidance.current = null;
    }
  }

  const provider = [appointment?.providerFirstName, appointment?.providerLastName].filter(Boolean).join(' ');
  const schedule = appointment?.scheduledAt ? new Date(appointment.scheduledAt) : null;
  return <div className="clinical-readable space-y-6">
    <PortalPageHeader title="Symptom guidance" description="Prepare for your visit and describe what you are experiencing. Automated guidance is optional; booking and clinician care remain available.">
      <Link href="/patient/appointments/book" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-blue-700 px-5 py-3 font-semibold text-white"><Calendar size={20} /> Book a visit</Link>
      <Link href="/patient/triage/history" className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 px-5 py-3 font-semibold text-slate-900"><History size={20} /> Guidance history</Link>
    </PortalPageHeader>
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
        <h2 className="text-2xl font-semibold text-slate-950">Prepare your symptom summary</h2>
        <p className="mt-3 leading-7 text-slate-600">Describe your symptoms, when they started, and any changes. Your clinician can review the summary you share during intake or your visit.</p>
        <form onSubmit={requestGuidance} className="mt-6 space-y-5">
          <label htmlFor="symptom-summary" className="block font-medium text-slate-800">Your symptoms<textarea id="symptom-summary" maxLength={5000} value={symptoms} disabled={!ready || processing} onChange={event => updateSummary({ symptoms: event.target.value, guidanceMessage: '' })} className="mt-2 min-h-48 w-full rounded-2xl border border-slate-300 bg-white p-4 text-base focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100" /></label>
          <button disabled={!ready || processing || !symptoms.trim()} className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-blue-300 px-5 py-3 font-semibold text-blue-800 disabled:opacity-60">{processing && <Loader2 size={20} className="animate-spin" />}{processing ? 'Checking availability…' : 'Check optional guidance'}</button>
          {guidanceMessage && <p role="status" className="rounded-2xl border border-blue-200 bg-blue-50 p-5 leading-7 text-blue-950">{guidanceMessage}</p>}
          <p className="leading-7 text-slate-600">No automated assessment or medication recommendation is available until a supported clinical service is connected. This summary stays on this page unless you separately share it with your care team.</p>
        </form>
      </section>
      <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
        <h2 className="text-2xl font-semibold text-slate-950">Your next visit</h2>
        {loading ? <p role="status" className="mt-5 flex items-center gap-3 text-slate-600"><Loader2 size={20} className="animate-spin" /> Loading appointment…</p> : loadError ? <div role="alert" className="portal-error mt-5 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900"><p>{loadError}</p><button onClick={() => setRevision(value => value + 1)} className="mt-3 min-h-12 rounded-xl border border-red-300 px-4 font-semibold">Try again</button></div> : appointment ? <div className="mt-5 rounded-2xl bg-slate-50 p-5"><p className="text-xl font-semibold text-slate-950">{provider ? 'Dr. ' + provider : 'Provider name unavailable'}</p><p className="mt-3 leading-7 text-slate-600">{schedule && !Number.isNaN(schedule.getTime()) ? schedule.toLocaleString() : 'Appointment time unavailable'}</p><Link href={'/patient/appointments/' + appointment.id} className="mt-4 inline-flex min-h-12 items-center font-semibold text-blue-700">View appointment</Link></div> : <p className="mt-5 rounded-2xl bg-slate-50 p-5 leading-7 text-slate-600">No upcoming appointment is recorded. Choose a provider and time when you are ready.</p>}
        <Link href="/patient/messages" className="mt-6 inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 px-5 py-3 font-semibold text-slate-900"><MessageCircle size={20} /> Contact your care team</Link>
      </section>
    </div>
  </div>;
}

