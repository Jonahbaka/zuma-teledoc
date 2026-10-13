'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Image from 'next/image';
import { ArrowRight, ShieldCheck, Video } from 'lucide-react';

export default function CareOpsLogin() {
  const router = useRouter();
  const { login, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [workspace, setWorkspace] = useState('/careops');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Prevent a pre-hydration native selection from being replaced by React's
  // default workspace on a cold load. Auth loading settles after hydration.
  const formDisabled = busy || loading;

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

  return <main className="mx-auto grid max-w-6xl gap-8 px-5 py-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:gap-14 lg:py-12">
    <section className="relative isolate overflow-hidden rounded-[2rem] bg-[#101d36] text-white shadow-[0_24px_60px_rgba(15,35,70,0.18)]">
      <div className="relative h-64 sm:h-80"><Image src="/marketing/ng/doctor-video-call.jpg" alt="" fill priority sizes="(min-width: 1024px) 600px, 100vw" className="object-cover object-[center_35%]" /><div className="absolute inset-0 bg-gradient-to-t from-[#101d36] via-transparent to-transparent" /></div>
      <div className="relative px-7 pb-8 sm:px-9">
        <p className="flex items-center gap-2 font-medium text-cyan-200"><Video className="h-5 w-5" /> DoctaRx for care teams</p>
        <h1 className="mt-4 max-w-lg text-4xl font-semibold leading-[1.12] sm:text-5xl">Better care.<br />A connected team.</h1>
        <p className="mt-5 max-w-lg leading-7 text-slate-200">Bring patient intake, remote consultations, and follow-up into one clear clinical workspace.</p>
        <div className="mt-7 flex items-center gap-3 border-t border-white/15 pt-6 text-slate-200"><ShieldCheck className="h-6 w-6 shrink-0 text-cyan-300" /><span>Institutional access. Clear accountability.</span></div>
      </div>
    </section>
    <form onSubmit={submit} className="space-y-6 rounded-[1.5rem] border border-slate-200/80 bg-white p-7 shadow-[0_12px_48px_rgba(15,35,70,0.06)] sm:p-9">
      <div><p className="font-medium text-blue-700">Welcome to DoctaRx</p><h2 className="mt-2 text-3xl font-semibold">Sign in to CareOps</h2><p className="mt-3 text-slate-600">Your care team’s workspace, ready when you are.</p></div>
      <div className="space-y-2"><Label htmlFor="careops-workspace">Workspace</Label><select id="careops-workspace" className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3" value={workspace} onChange={(event) => setWorkspace(event.target.value)} disabled={formDisabled}>
        <option value="/careops">Clinical care</option><option value="/careops/government">Public health</option>
      </select></div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
      <div className="space-y-2"><Label htmlFor="careops-email">Email</Label><Input id="careops-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={formDisabled} /></div>
      <div className="space-y-2"><Label htmlFor="careops-password">Password</Label><Input id="careops-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={formDisabled} /></div>
      {mfaRequired && <div className="space-y-2"><Label htmlFor="careops-mfa">Authenticator code</Label><Input id="careops-mfa" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} required disabled={formDisabled} /></div>}
      <Button type="submit" disabled={formDisabled} className="w-full bg-blue-600 hover:bg-blue-700">{busy ? 'Signing in…' : loading ? 'Preparing sign-in…' : 'Sign in'}<ArrowRight className="ml-3 h-5 w-5" /></Button>
      <p className="text-slate-600">For an invitation, access change, or account recovery, contact your institution’s access administrator.</p>
    </form>
  </main>;
}
