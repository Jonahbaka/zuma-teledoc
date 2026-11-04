'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import api from '@/lib/api';

function AcceptGovernmentInvitationForm() {
  const search = useSearchParams();
  const [form, setForm] = useState({ firstName: '', lastName: '', password: '', token: search.get('token') || '' });
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api.post('/ng/government-data/public/accept-invitation', form, { skipAuth: true });
      setComplete(true);
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'The invitation could not be accepted.');
    } finally { setBusy(false); }
  }

  return <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-950">
    <section className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">Invitation-only government access</p>
      <h1 className="mt-3 text-3xl font-black">Accept your scoped account</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">Your assigned jurisdiction and least-privilege role are fixed by the invitation. MFA enrollment is mandatory before government data can be accessed.</p>
      {error && <div role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
      {complete ? <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><h2 className="font-black text-emerald-950">Account created</h2><p className="mt-2 text-sm leading-6 text-emerald-900">Sign in as a patient account, enroll MFA in account security, then open the government workspace. Access remains blocked until MFA is enrolled and verified.</p><Link href="/login" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white">Continue to secure sign-in</Link></div> : <form onSubmit={submit} className="mt-6 grid gap-4"><label className="grid gap-1 text-sm font-bold">First name<input required value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} className="min-h-11 rounded-xl border border-slate-300 px-3" /></label><label className="grid gap-1 text-sm font-bold">Last name<input required value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} className="min-h-11 rounded-xl border border-slate-300 px-3" /></label><label className="grid gap-1 text-sm font-bold">Password (12+ characters)<input type="password" minLength={12} required value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className="min-h-11 rounded-xl border border-slate-300 px-3" autoComplete="new-password" /></label>{!search.get('token') && <label className="grid gap-1 text-sm font-bold">Invitation token<input required value={form.token} onChange={(event) => setForm({ ...form, token: event.target.value })} className="min-h-11 rounded-xl border border-slate-300 px-3" /></label>}<button disabled={busy} className="min-h-12 rounded-xl bg-emerald-700 px-4 font-bold text-white disabled:opacity-50">{busy ? 'Creating protected account…' : 'Accept invitation'}</button></form>}
    </section>
  </main>;
}

export default function AcceptGovernmentInvitationPage() {
  return <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">Loading protected invitation…</div>}><AcceptGovernmentInvitationForm /></Suspense>;
}
