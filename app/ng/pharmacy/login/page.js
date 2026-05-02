'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Building2, Loader2, Lock, Mail, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';

export default function NigeriaPharmacyLoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await login(email.trim(), password, null, 'pharmacy');

      if (result?.mfaRequired) {
        setError('Additional verification is required for this account. Please contact support for pharmacy access.');
        return;
      }

      if (result?.error) {
        setError(result.error);
      }
    } catch (authError) {
      setError(authError.response?.data?.error || 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.16),transparent_30%),radial-gradient(circle_at_85%_10%,rgba(14,165,233,0.12),transparent_26%),linear-gradient(160deg,#ecfdf5,#f8fafc_55%,#ecfeff)] px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6 overflow-hidden lg:grid lg:grid-cols-[1.08fr_0.92fr] lg:items-center">
        <section className="w-full max-w-[calc(100vw-2rem)] min-w-0 overflow-hidden rounded-[2rem] border border-white/80 bg-white/82 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.12)] backdrop-blur-2xl sm:p-8">
          <Link href="/ng" className="inline-flex items-center gap-3">
            <span className="rounded-2xl border border-slate-800 bg-slate-950 px-3 py-2 shadow-[0_0_24px_rgba(16,185,129,0.2)]">
              <DoctaRxLogo className="h-7 w-auto" />
            </span>
            <div>
              <div className="text-sm font-semibold text-foreground">DoctaRx Nigeria</div>
              <div className="text-xs text-muted-foreground">Pharmacy operations portal</div>
            </div>
          </Link>

          <div className="mt-8 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">
            <Building2 className="h-4 w-4" />
            Nigeria Pharmacy Access
          </div>
          <h1 className="mt-4 break-words text-3xl font-bold leading-tight text-foreground sm:text-5xl">
            Manage orders, inventory, wallet settlement, and compliance from one workspace.
          </h1>
          <p className="mt-4 break-words text-base leading-7 text-muted-foreground">
            This login lands pharmacy operators in the actual Nigeria pharmacy portal with dashboard, orders, inventory, wallet, settings, and profile routes behind it.
          </p>

          <div className="mt-6 grid gap-3">
            {[
              'Review routed prescription orders and confirm fulfillment status.',
              'Monitor low-stock items and wallet balances without leaving the portal.',
              'Keep PCN, banking, and pharmacy identity details visible for operations and compliance.',
            ].map((item) => (
              <div key={item} className="flex items-start gap-3 rounded-[1.25rem] border border-emerald-500/15 bg-emerald-500/5 px-4 py-3">
                <ShieldCheck className="mt-0.5 h-4.5 w-4.5 shrink-0 text-emerald-600" />
                <p className="min-w-0 break-words text-sm leading-6 text-foreground/90">{item}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="w-full max-w-[calc(100vw-2rem)] min-w-0 rounded-[2rem] border border-slate-800 bg-[linear-gradient(160deg,rgba(2,6,23,0.98),rgba(15,23,42,0.95))] p-6 text-white shadow-[0_28px_80px_rgba(15,23,42,0.28)] sm:p-8">
          <div className="text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 shadow-lg shadow-emerald-900/20">
              <Building2 className="h-8 w-8 text-white" />
            </div>
            <h2 className="mt-4 text-2xl font-bold">Sign in to your Nigeria pharmacy portal</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">Access dashboard operations, compliance status, and pharmacy wallet settlement.</p>
          </div>

          {error ? <div className="mt-6 rounded-2xl border border-rose-500/30 bg-rose-500/12 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-slate-200">Email Address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-500" />
                <Input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="h-12 border-slate-700 bg-slate-950/70 pl-10 text-white placeholder:text-slate-500" placeholder="pharmacy@example.com" required />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-slate-200">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-500" />
                <Input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-12 border-slate-700 bg-slate-950/70 pl-10 text-white placeholder:text-slate-500" placeholder="Enter your password" required />
              </div>
            </div>

            <Button type="submit" disabled={loading} className="h-12 w-full bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-500 hover:to-teal-500">
              {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in...</> : 'Open Pharmacy Portal'}
            </Button>
          </form>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Link href="/ng/pharmacy/register" className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/[0.1]">
              Register Pharmacy
            </Link>
            <Link href="/ng/pharmacy/onboarding" className="inline-flex items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/16">
              Continue Onboarding
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
