'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function CareOpsLogin() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [workspace, setWorkspace] = useState('/careops');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const result = await login(email.trim(), password, mfaRequired ? mfaCode : null, null, { redirect: false });
      if (result.mfaRequired) { setMfaRequired(true); return; }
      if (!result.success) { setError(result.error || 'Sign-in failed.'); return; }
      // Required password rotation continues through the existing protected flow.
      router.replace(result.redirectPath?.includes('create-password') ? result.redirectPath : workspace);
    } finally { setBusy(false); }
  }

  return <main className="mx-auto grid max-w-5xl gap-8 px-4 py-12 md:grid-cols-2 md:items-center">
    <section>
      <p className="font-medium text-emerald-700">Facility care and institutional reporting</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">The care team, together.</h1>
      <p className="mt-4 leading-7 text-slate-600">Prepare patients, coordinate remote consultations, and follow care through to completion. Reporting users work within their assigned programmes and jurisdictions.</p>
      <p className="mt-4 text-slate-600">Use your invited institutional account. Signing in does not grant additional clinical or government access.</p>
    </section>
    <form onSubmit={submit} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-2xl font-semibold">Sign in to CareOps</h2>
      <div className="space-y-2"><Label htmlFor="careops-workspace">Workspace</Label><select id="careops-workspace" className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3" value={workspace} onChange={(event) => setWorkspace(event.target.value)} disabled={busy}>
        <option value="/careops">Clinical care</option><option value="/careops/government">Government reporting</option><option value="/careops/partners">Funding and partners</option>
      </select></div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
      <div className="space-y-2"><Label htmlFor="careops-email">Email</Label><Input id="careops-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={busy} /></div>
      <div className="space-y-2"><Label htmlFor="careops-password">Password</Label><Input id="careops-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={busy} /></div>
      {mfaRequired && <div className="space-y-2"><Label htmlFor="careops-mfa">Authenticator code</Label><Input id="careops-mfa" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} required disabled={busy} /></div>}
      <Button type="submit" disabled={busy} className="w-full bg-emerald-700 hover:bg-emerald-800">{busy ? 'Signing in…' : 'Sign in'}</Button>
      <p className="text-slate-600">For an invitation, access change, or account recovery, contact your institution’s access administrator.</p>
    </form>
  </main>;
}
