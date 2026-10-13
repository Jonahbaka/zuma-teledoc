'use client';

import { useEffect, useState } from 'react';
import api, { phcAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function CareOpsPartners() {
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
    }).catch(() => { if (!cancelled) setError('Your funding permissions could not be loaded.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPartners([]);
    if (!context) return;
    setLoading(true); setError('');
    api.get('/ng/funding/partners', { headers: { 'x-programme-id': context.programme_id, 'x-facility-id': context.facility_id } })
      .then(({ data }) => { if (!cancelled) setPartners(data.partners || []); })
      .catch((failure) => { if (!cancelled) setError(failure.response?.data?.error || 'Partners could not be loaded.'); })
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
    } catch (failure) { setError(failure.response?.data?.error || 'Partner could not be saved.'); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
    <div><h1 className="text-2xl font-semibold">Funding and insurance partners</h1><p className="mt-2 text-slate-600">Track onboarding within your programme. Registration does not activate eligibility checks or claim submission.</p></div>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
    {loading ? <p role="status">Loading funding access…</p> : contexts.length === 0 ? <p>No active funding-administration assignment. Contact your programme administrator.</p> : <>
      <div className="space-y-2"><Label htmlFor="funding-programme">Programme and facility</Label><select id="funding-programme" value={contextId} onChange={(event) => setContextId(event.target.value)} className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3">{contexts.map((item) => <option key={`${item.programme_id}:${item.facility_id}`} value={`${item.programme_id}:${item.facility_id}`}>{item.programme_name} — {item.facility_name}</option>)}</select></div>
      <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="text-lg font-semibold">Partner registry</h2>
        {partners.length ? <ul className="mt-3 divide-y divide-slate-200">{partners.map((partner) => <li key={partner.id} className="flex flex-wrap justify-between gap-3 py-4"><span className="font-medium">{partner.display_name}</span><span className="rounded-lg bg-slate-100 px-3 py-1 text-sm">{partner.onboarding_status.replaceAll('_', ' ')}</span></li>)}</ul> : <p className="mt-3 text-slate-600">{error ? 'Partner data is unavailable.' : 'No partners registered for this programme.'}</p>}
      </section>
      <form onSubmit={add} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5"><h2 className="text-lg font-semibold">Register an onboarding review</h2><Label htmlFor="partner-name">Insurance company or HMO</Label><Input id="partner-name" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={160} required disabled={busy} /><Button type="submit" disabled={busy} className="bg-emerald-700">{busy ? 'Saving…' : 'Add for review'}</Button></form>
    </>}
    <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="text-lg font-semibold">Separate funding responsibilities</h2><p className="mt-2 text-slate-600">Patient payments, insurer claims, and institutional sponsorship require their own agreements and receipts. Paystack consultation checkout remains disabled until merchant approval and an approved tariff are configured.</p></section>
  </main>;
}
