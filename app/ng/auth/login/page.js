'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Building2,
  Lock,
  Mail,
  Pill,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { authAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';

const STORY_POINTS = [
  'Search medicine and upload prescriptions without switching portals.',
  'See provider review, pharmacy confirmation, and local payment readiness in one flow.',
  'Keep every step readable on phone, tablet, and desktop.',
];

export default function NigeriaLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
  }, []);

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await authAPI.login({ email, password, role: 'patient' });

      if (res.data.success) {
        if (res.data.accessToken) localStorage.setItem('accessToken', res.data.accessToken);
        if (res.data.refreshToken) localStorage.setItem('refreshToken', res.data.refreshToken);
        router.push('/ng/patient');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.16),transparent_32%),radial-gradient(circle_at_85%_10%,rgba(245,158,11,0.12),transparent_26%),linear-gradient(160deg,#ecfdf5,#f8fafc_55%,#ecfeff)] px-4 py-6 text-foreground sm:px-6 sm:py-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex items-center justify-between gap-3">
          <Link href="/ng" className="flex items-center gap-3">
            <span className="rounded-2xl border border-slate-800 bg-slate-950 px-3 py-2 shadow-[0_0_24px_rgba(16,185,129,0.2)]">
              <DoctaRxLogo className="h-7 w-auto" />
            </span>
            <div className="hidden sm:block">
              <div className="text-sm font-semibold text-foreground">DoctaRx Nigeria</div>
              <div className="text-xs text-muted-foreground">Pharmacy-first care coordination</div>
            </div>
          </Link>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-white/75 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-700 shadow-sm backdrop-blur-xl">
            <Sparkles className="h-3.5 w-3.5" />
            Nigeria Patient Access
          </div>
        </header>

        <main className="grid gap-6 lg:grid-cols-[1.02fr_0.98fr] lg:items-center">
          <section className="rounded-[2rem] border border-white/70 bg-white/78 p-5 shadow-[0_24px_70px_rgba(15,23,42,0.12)] backdrop-blur-2xl sm:p-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700">
              <Pill className="h-4 w-4" />
              Mobile-ready care journey
            </div>
            <h1 className="mt-4 max-w-2xl text-4xl leading-tight text-foreground sm:text-5xl">
              Prescription access built for a faster Nigeria patient journey.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              Move from medicine search to provider review and pharmacy confirmation inside one responsive experience with fewer taps and no horizontal breakpoints.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                { label: 'Search drugs', tone: 'from-emerald-500/20 to-transparent' },
                { label: 'Review options', tone: 'from-cyan-500/20 to-transparent' },
                { label: 'Confirm fulfillment', tone: 'from-amber-500/20 to-transparent' },
              ].map((item) => (
                <div
                  key={item.label}
                  className={`rounded-[1.4rem] border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.9),rgba(255,255,255,0.65))] p-4 shadow-sm`}
                >
                  <div className={`h-1.5 w-16 rounded-full bg-gradient-to-r ${item.tone}`} />
                  <div className="mt-4 text-sm font-semibold text-foreground">{item.label}</div>
                </div>
              ))}
            </div>

            <div className="mt-6 grid gap-3">
              {STORY_POINTS.map((point) => (
                <div key={point} className="flex items-start gap-3 rounded-[1.25rem] border border-emerald-500/15 bg-emerald-500/5 px-4 py-3">
                  <ShieldCheck className="mt-0.5 h-4.5 w-4.5 shrink-0 text-emerald-600" />
                  <p className="text-sm leading-6 text-foreground/90">{point}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-800 bg-[linear-gradient(160deg,rgba(2,6,23,0.98),rgba(15,23,42,0.95))] p-5 text-white shadow-[0_28px_80px_rgba(15,23,42,0.28)] sm:p-7">
            <div className="text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 shadow-lg shadow-emerald-900/20">
                <Building2 className="h-8 w-8 text-white" />
              </div>
              <h2 className="mt-4 text-2xl font-bold">Sign in to your Nigeria portal</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Continue into prescription search, order tracking, and pharmacy-ready handoff.
              </p>
            </div>

            {error ? (
              <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/12 px-4 py-3 text-sm text-red-100">
                {error}
              </div>
            ) : null}

            <form onSubmit={handleLogin} className="mt-6 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-slate-200">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-500" />
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    placeholder="you@example.com"
                    className="h-12 border-slate-700 bg-slate-950/70 pl-10 text-white placeholder:text-slate-500 focus:border-emerald-500 focus:ring-emerald-500/20"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-slate-200">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-500" />
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    className="h-12 border-slate-700 bg-slate-950/70 pl-10 text-white placeholder:text-slate-500 focus:border-emerald-500 focus:ring-emerald-500/20"
                    required
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="h-12 w-full bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-500 hover:to-teal-500"
              >
                {loading ? 'Signing in...' : 'Open Patient Portal'}
              </Button>
            </form>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Link
                href="/ng/auth/register"
                className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/[0.1]"
              >
                Create account
              </Link>
              <Link
                href="/ng/pharmacy/login"
                className="inline-flex items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/16"
              >
                Pharmacy login
              </Link>
            </div>

            <div className="mt-6 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs text-slate-300">
              <span>Need provider access instead?</span>
              <Link href="/ng/provider/login" className="inline-flex items-center font-semibold text-emerald-300">
                Provider portal
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
