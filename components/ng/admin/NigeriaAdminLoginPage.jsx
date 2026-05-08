'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  BarChart3,
  Database,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  MapPin,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const ADMIN_SIGNALS = [
  'Nigeria operations dashboard',
  'Pharmacy approvals and compliance',
  'Public Health Intelligence Programme',
  'DHIS2/NHMIS readiness controls',
];

export default function NigeriaAdminLoginPage() {
  const { login } = useAuth();
  const searchParams = useSearchParams();
  const emailRef = useRef(null);
  const passwordRef = useRef(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');

    if (searchParams.get('session') === 'expired') {
      setNotice('Your Nigeria admin session expired. Sign in again to continue.');
    }
  }, [searchParams]);

  async function handleSubmit(event) {
    event.preventDefault();
    setIsLoading(true);
    setError('');
    setNotice('');

    const email = emailRef.current?.value?.trim() || '';
    const password = passwordRef.current?.value || '';

    if (!email || !password) {
      setError('Enter your admin email and password.');
      setIsLoading(false);
      return;
    }

    try {
      const result = await login(
        email,
        password,
        mfaRequired ? (mfaCode || null) : null,
        'admin'
      );

      if (result?.mfaRequired) {
        setMfaRequired(true);
        setNotice('Enter your 6-digit authentication code to continue.');
        return;
      }

      if (result?.error) {
        setError(result.error);
        return;
      }

      if (result?.success) {
        setNotice('Signed in. Opening the Nigeria admin portal...');
      }
    } catch (loginError) {
      setError(loginError.response?.data?.error || 'Invalid Nigeria admin credentials.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_14%_18%,rgba(16,185,129,0.24),transparent_30%),radial-gradient(circle_at_82%_14%,rgba(37,99,235,0.20),transparent_28%),linear-gradient(140deg,#ecfdf5,#f8fafc_48%,#eff6ff)] px-4 py-6 text-slate-950 sm:px-6 sm:py-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl flex-col">
        <header className="flex items-center justify-between gap-4">
          <Link href="/ng" className="flex items-center gap-3">
            <span className="rounded-2xl border border-slate-900 bg-slate-950 px-3 py-2 shadow-xl shadow-emerald-900/10">
              <DoctaRxLogo className="h-7 w-auto" />
            </span>
            <div>
              <p className="text-sm font-black text-slate-950">DoctaRx Nigeria</p>
              <p className="text-xs font-semibold text-emerald-700">Dedicated Admin Portal</p>
            </div>
          </Link>
          <Link
            href="/secure/admin"
            className="hidden rounded-full border border-slate-200 bg-white/75 px-4 py-2 text-xs font-bold text-slate-700 shadow-sm backdrop-blur transition-colors hover:bg-white sm:inline-flex"
          >
            US admin console
          </Link>
        </header>

        <main className="grid flex-1 items-center gap-6 py-8 lg:grid-cols-[1.08fr_0.92fr] lg:py-12">
          <section className="relative overflow-hidden rounded-[2rem] border border-white/80 bg-white/75 p-6 shadow-2xl shadow-emerald-950/10 backdrop-blur-2xl sm:p-8">
            <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-emerald-200/50 blur-3xl" />
            <div className="absolute -bottom-24 left-16 h-56 w-56 rounded-full bg-blue-200/50 blur-3xl" />
            <div className="relative">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-black uppercase tracking-[0.2em] text-emerald-700">
                <ShieldCheck className="h-4 w-4" />
                Nigeria admin only
              </div>
              <h1 className="mt-5 max-w-3xl text-4xl font-black leading-tight tracking-tight text-slate-950 sm:text-5xl">
                Sign in to the DoctaRx Nigeria Admin Portal.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-8 text-slate-600 sm:text-lg">
                This login is separate from the US admin console. Nigeria admins land in the Nigeria operations dashboard,
                with pharmacy approvals, public-health intelligence, revenue, compliance, and local market workflows.
              </p>

              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                {ADMIN_SIGNALS.map((item, index) => {
                  const Icon = [BarChart3, ShieldCheck, Database, MapPin][index] || Sparkles;
                  return (
                    <div key={item} className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm">
                      <Icon className="h-5 w-5 text-emerald-700" />
                      <p className="mt-3 text-sm font-bold text-slate-800">{item}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-800 bg-[radial-gradient(circle_at_20%_16%,rgba(16,185,129,0.18),transparent_28%),linear-gradient(155deg,#020617,#0f172a_55%,#064e3b)] p-5 text-white shadow-2xl shadow-slate-950/25 sm:p-7">
            <div className="text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-blue-600 shadow-lg shadow-emerald-900/30">
                <KeyRound className="h-8 w-8 text-white" />
              </div>
              <h2 className="mt-4 text-2xl font-black">Nigeria Admin Login</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Authorized Nigeria admin and super-admin access only.
              </p>
            </div>

            {notice ? (
              <div className="mt-6 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
                {notice}
              </div>
            ) : null}

            {error ? (
              <div className="mt-6 rounded-2xl border border-red-400/30 bg-red-500/12 px-4 py-3 text-sm text-red-100">
                {error}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="ng-admin-email" className="text-slate-200">Admin Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-500" />
                  <Input
                    ref={emailRef}
                    id="ng-admin-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="admin@doctarx.com"
                    className="h-12 border-slate-700 bg-slate-950/70 pl-10 text-white placeholder:text-slate-500 focus:border-emerald-500 focus:ring-emerald-500/20"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ng-admin-password" className="text-slate-200">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-500" />
                  <Input
                    ref={passwordRef}
                    id="ng-admin-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    className="h-12 border-slate-700 bg-slate-950/70 pl-10 pr-10 text-white placeholder:text-slate-500 focus:border-emerald-500 focus:ring-emerald-500/20"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 transition-colors hover:text-slate-200"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                  </button>
                </div>
              </div>

              {mfaRequired ? (
                <div className="space-y-2">
                  <Label htmlFor="ng-admin-mfa" className="text-slate-200">Authentication Code</Label>
                  <Input
                    id="ng-admin-mfa"
                    name="mfaCode"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    value={mfaCode}
                    onChange={(event) => setMfaCode(event.target.value)}
                    className="h-12 border-slate-700 bg-slate-950/70 text-white placeholder:text-slate-500 focus:border-emerald-500 focus:ring-emerald-500/20"
                    required
                  />
                </div>
              ) : null}

              <Button
                type="submit"
                disabled={isLoading}
                className="h-12 w-full bg-gradient-to-r from-emerald-600 to-blue-600 font-bold text-white hover:from-emerald-500 hover:to-blue-500"
              >
                {isLoading ? 'Authenticating...' : 'Open Nigeria Admin Portal'}
              </Button>
            </form>

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-xs leading-5 text-slate-300">
              This route opens <span className="font-bold text-white">/ng/admin</span> after successful admin authentication.
              It does not send Nigeria admins to the US dashboard.
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
