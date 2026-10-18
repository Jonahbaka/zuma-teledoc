'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { portalReturnPath } from '@/lib/portalSignIn.cjs';

function SignInForm({ market, portalRole }) {
  const { login, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const nigeria = market === 'NG';
  const requested = params.get('role') || 'patient';
  const role = ['patient','provider','pharmacy','admin'].includes(portalRole) ? portalRole : nigeria && ['provider','pharmacy','admin','super_admin'].includes(requested) ? requested : 'patient';
  const copy = role === 'pharmacy' ? {title:'Pharmacy sign in',hero:'Your pharmacy.',heroSecond:'Connected.',description:'Review prescriptions, coordinate medication orders, and manage your pharmacy workspace.',image:'/marketing/ng/pharmacy-handoff.jpg'} : ['admin','super_admin'].includes(role) ? {title:'Administration sign in',hero:'Connected care.',heroSecond:'Clear oversight.',description:'Manage care operations, access, and reporting through one secure DoctaRx workspace.',image:'/marketing/ng/doctor-phone-notes.jpg'} : {title:'Sign in',hero:'Your care.',heroSecond:'Within reach.',description:'Connect with your care team, prepare for visits, and keep your health information in one place.',image:'/marketing/ng/doctor-video-call.jpg'};
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const disabled = loading || busy;
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await login(email.trim(), password, mfaRequired ? mfaCode : null, role, { redirect: false });
      if (result.mfaRequired) { setMfaRequired(true); return; }
      if (!result.success) { setError(result.error || 'Sign-in failed. Please try again.'); return; }
      if (result.redirectPath?.includes('create-password')) { router.replace(result.redirectPath); return; }
      const portal = (nigeria ? '/ng' : '') + (role === 'super_admin' ? '/admin' : '/' + role);
      const returnTo = params.get('returnTo');
      router.replace(portalReturnPath(returnTo,portal) || (role === 'patient' ? nigeria ? '/ng/patient' : '/patient/dashboard' : result.redirectPath || portal));
    } finally { setBusy(false); }
  }
  return <main className="doctarx-portal min-h-screen bg-slate-50">
    <header className="bg-[#101d36] px-6 py-6"><Link href={nigeria ? '/ng' : '/'} aria-label="DoctaRx home"><DoctaRxLogo glow={false} className="h-10" /></Link></header>
    <div className="mx-auto grid max-w-6xl gap-8 px-5 py-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:gap-14">
      <section className="relative overflow-hidden rounded-3xl bg-[#101d36] text-white"><div className="relative h-64 sm:h-80"><Image src={copy.image} alt="" fill priority sizes="600px" className={portalRole ? 'object-contain' : 'object-cover object-[center_35%]'} /><div className="absolute inset-0 bg-gradient-to-t from-[#101d36] via-transparent to-transparent" /></div><div className="p-8"><p className="font-medium text-cyan-200">DoctaRx · Care that connects</p><h1 className="mt-4 text-4xl font-semibold leading-tight sm:text-5xl">{copy.hero}<br />{copy.heroSecond}</h1><p className="mt-5 leading-7 text-slate-200">{copy.description}</p></div></section>
      <form onSubmit={submit} className="space-y-6 rounded-3xl border border-slate-200 bg-white p-7 shadow-sm sm:p-9"><div><p className="font-medium text-blue-800">Welcome to DoctaRx</p><h2 className="mt-3 text-3xl font-semibold">{copy.title}</h2><p className="mt-3 text-slate-600">Continue to your {role === 'patient' ? 'care' : 'professional'} workspace.</p></div>
        {params.get('session')==='expired' && <p role="status" className="rounded-2xl bg-blue-50 p-4 text-blue-900">Your session expired. Sign in again to continue.</p>}
        {error && <p role="alert" className="portal-error">{error}</p>}
        <div className="space-y-2"><Label htmlFor="patient-email">Email</Label><Input id="patient-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={disabled} /></div>
        <div className="space-y-2"><Label htmlFor="patient-password">Password</Label><div className="relative"><Input id="patient-password" type={visible ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={disabled} className="pr-14" /><button type="button" aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible} className="absolute inset-y-0 right-0 w-12 text-slate-600" onClick={() => setVisible(!visible)}>{visible ? <EyeOff className="mx-auto h-5 w-5" /> : <Eye className="mx-auto h-5 w-5" />}</button></div></div>
        {mfaRequired && <div className="space-y-2"><Label htmlFor="patient-mfa">Authenticator code</Label><Input id="patient-mfa" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} required disabled={disabled} /></div>}
        <Button type="submit" disabled={disabled} className="w-full bg-blue-600 text-white hover:bg-blue-700">{busy ? 'Signing in…' : loading ? 'Preparing sign-in…' : 'Sign in'}<ArrowRight className="ml-3 h-5 w-5" aria-hidden="true" /></Button>
        <Link href="/forgot-password" className="inline-flex min-h-12 items-center font-medium text-blue-800">Forgot password?</Link>
        {role === 'patient' && <p className="text-slate-600">New to DoctaRx? <Link href={nigeria ? '/ng/patient/register' : '/patient/register'} className="font-medium text-blue-800 underline">Create an account</Link></p>}
        {role === 'pharmacy' && <div className="flex flex-wrap gap-x-6 gap-y-2"><Link href={nigeria?'/ng/pharmacy/register':'/pharmacy/register'} className="inline-flex min-h-12 items-center font-medium text-blue-800 underline">Register a pharmacy</Link><Link href={nigeria?'/ng/pharmacy':'/pharmacy'} className="inline-flex min-h-12 items-center font-medium text-blue-800 underline">Pharmacy onboarding</Link></div>}
      </form>
    </div>
  </main>;
}
export default function PatientSignIn({ market = 'US', portalRole }) {
  return <Suspense fallback={<p role="status" className="p-8 text-base">Preparing DoctaRx sign-in…</p>}><SignInForm market={market} portalRole={portalRole} /></Suspense>;
}
