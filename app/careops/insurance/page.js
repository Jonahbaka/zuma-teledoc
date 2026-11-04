'use client';

import { useEffect, useState } from 'react';
import api, { phcAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function InsuranceManagement() {
  const [contexts, setContexts] = useState([]);
  const [contextId, setContextId] = useState('');
  const [partners, setPartners] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const context = contexts.find((item) => `${item.programme_id}:${item.facility_id}` === contextId);

  useEffect(() => {
    let cancelled = false;
    phcAPI.getContexts().then(({ data }) => {
      if (cancelled) return;
      const available = (data.contexts || []).filter((item) => ['programme_admin', 'facility_admin'].includes(item.programme_role));
      setContexts(available); setContextId(available[0] ? `${available[0].programme_id}:${available[0].facility_id}` : '');
    }).catch(() => { if (!cancelled) setError('Your insurance administration access could not be loaded.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPartners([]);
    if (!context) return;
    setLoading(true); setError('');
    api.get('/ng/funding/partners', { headers: { 'x-programme-id': context.programme_id, 'x-facility-id': context.facility_id } })
      .then(({ data }) => { if (!cancelled) setPartners(data.partners || []); })
      .catch((failure) => { if (!cancelled) setError(failure.response?.data?.error || 'Insurers could not be loaded.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [context]);

  async function add(event) {
    event.preventDefault(); if (!context) return;
    setBusy(true); setError('');
    try {
      const { data } = await api.post('/ng/funding/partners', {
        displayName: name.trim(), partnerKey: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''), onboardingStatus: 'review',
      }, { headers: { 'x-programme-id': context.programme_id, 'x-facility-id': context.facility_id } });
      setPartners((current) => [...current, data.partner]); setName('');
    } catch (failure) { setError(failure.response?.data?.error || 'Insurer could not be saved.'); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
    <div><p className="font-medium text-blue-700">DoctaRx · Administration</p><h1 className="mt-2 text-3xl font-semibold">Insurance management</h1><p className="mt-3 text-slate-600">Manage HMO and insurer onboarding within your programme.</p></div>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
    {loading ? <p role="status">Loading insurance administration…</p> : contexts.length === 0 ? <p>Insurance administration access is required. Contact your programme administrator.</p> : <>
      <div className="space-y-2"><Label htmlFor="insurance-programme">Programme and facility</Label><select id="insurance-programme" value={contextId} onChange={(event) => setContextId(event.target.value)} className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3">{contexts.map((item) => <option key={`${item.programme_id}:${item.facility_id}`} value={`${item.programme_id}:${item.facility_id}`}>{item.programme_name} — {item.facility_name}</option>)}</select></div>
      <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="text-xl font-semibold">Insurer registry</h2>
        {partners.length ? <ul className="mt-3 divide-y divide-slate-200">{partners.map((partner) => <li key={partner.id} className="flex flex-wrap justify-between gap-3 py-4"><span className="font-medium">{partner.display_name}</span><span className="rounded-lg bg-slate-100 px-3 py-1 text-sm">{partner.onboarding_status.replaceAll('_', ' ')}</span></li>)}</ul> : <p className="mt-3 text-slate-600">{error ? 'Insurer data is unavailable.' : 'No insurers registered for this programme.'}</p>}
      </section>
      <form onSubmit={add} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5"><h2 className="text-xl font-semibold">Insurer onboarding</h2><Label htmlFor="insurer-name">Insurance company or HMO</Label><Input id="insurer-name" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={160} required disabled={busy} /><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add for review'}</Button></form>
    </>}
    <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="text-xl font-semibold">Coverage and claims readiness</h2><p className="mt-2 text-slate-600">An insurer must complete contracting and integration approval before eligibility checks, authorisation requests, or claims can be submitted.</p></section>
  </main>;
}
