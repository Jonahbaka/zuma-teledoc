'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Eye, EyeOff, LockKeyhole, ShieldCheck, Stethoscope } from 'lucide-react';
import { authAPI } from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';
import { setPreferredProviderMarket, toProviderPortalPath } from '@/lib/providerPortal';

const MARKET_COPY = {
  US: {
    homeHref: '/',
    loginHref: '/provider/login',
    dashboardHref: '/provider/dashboard',
    title: 'Create a new provider password',
    subtitle: 'Set a permanent password before entering US provider ops.',
    accent: 'from-purple-600 to-indigo-600',
    focus: 'focus:border-purple-500 focus:ring-purple-500/20',
  },
  NG: {
    homeHref: '/ng',
    loginHref: '/ng/provider/login',
    dashboardHref: '/ng/provider/dashboard',
    title: 'Create a new provider password',
    subtitle: 'Set a permanent password before entering Nigeria provider ops.',
    accent: 'from-emerald-600 to-teal-600',
    focus: 'focus:border-emerald-500 focus:ring-emerald-500/20',
  },
};

function meetsPasswordPolicy(value) {
  return (
    value.length >= 8 &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /[0-9]/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
}

export default function ProviderCreatePasswordPage({ market = 'US' }) {
  const copy = MARKET_COPY[market] || MARKET_COPY.US;
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, isAuthenticated, refreshUser, updateUser } = useAuth();
  const [form, setForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmNewPassword: '',
  });
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setPreferredProviderMarket(market);
  }, [market]);

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!isAuthenticated) {
      router.replace(copy.loginHref);
      return;
    }

    if (user?.role !== 'provider') {
      router.replace('/');
      return;
    }

    if (!user?.mustChangePassword) {
      router.replace(copy.dashboardHref);
    }
  }, [copy.dashboardHref, copy.loginHref, isAuthenticated, loading, router, user]);

  const policySatisfied = useMemo(
    () => meetsPasswordPolicy(form.newPassword),
    [form.newPassword]
  );

  const passwordMismatch =
    form.confirmNewPassword.length > 0 &&
    form.newPassword !== form.confirmNewPassword;

  const handleChange = (field) => (event) => {
    setForm((current) => ({
      ...current,
      [field]: event.target.value,
    }));
    setError('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!policySatisfied) {
      setError('New password must meet the security requirements.');
      return;
    }

    if (form.newPassword !== form.confirmNewPassword) {
      setError('New passwords do not match.');
      return;
    }

    setSaving(true);

    try {
      const response = await authAPI.changePassword({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
        confirmNewPassword: form.confirmNewPassword,
      });

      if (response.data?.accessToken) {
        localStorage.setItem('accessToken', response.data.accessToken);
      }

      if (response.data?.refreshToken) {
        localStorage.setItem('refreshToken', response.data.refreshToken);
      }

      if (response.data?.user) {
        updateUser(response.data.user);
      } else {
        updateUser({ mustChangePassword: false });
      }

      await refreshUser();

      router.replace(
        toProviderPortalPath('/dashboard', {
          pathname,
          user: response.data?.user || { ...user, mustChangePassword: false },
        })
      );
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update password. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !isAuthenticated || user?.role !== 'provider') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-300">
        Checking secure session...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(145deg,#020617,#111827_48%,#020617)] px-4 py-6 text-white sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-6xl flex-col">
        <header className="flex items-center justify-between gap-4">
          <Link href={copy.homeHref} className="inline-flex items-center gap-3">
            <DoctaRxLogo className="h-9 w-auto" />
          </Link>
          <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs text-slate-300 sm:inline-flex">
            <ShieldCheck className="h-4 w-4" />
            Provider security
          </div>
        </header>

        <main className="grid flex-1 items-center gap-8 py-8 lg:grid-cols-[0.95fr_1.05fr]">
          <section className="max-w-xl">
            <div className={`mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${copy.accent}`}>
              <Stethoscope className="h-7 w-7" />
            </div>
            <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">
              {copy.title}
            </h1>
            <p className="mt-4 text-base leading-7 text-slate-300 sm:text-lg">
              {copy.subtitle}
            </p>
          </section>

          <section className="w-full rounded-2xl border border-white/10 bg-white/[0.07] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-7">
            {error ? (
              <div className="mb-5 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                {error}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="currentPassword" className="text-slate-200">
                  Temporary password
                </Label>
                <div className="relative">
                  <LockKeyhole className="absolute left-3 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-500" />
                  <Input
                    id="currentPassword"
                    type="password"
                    value={form.currentPassword}
                    onChange={handleChange('currentPassword')}
                    autoComplete="current-password"
                    className={`h-12 border-slate-700 bg-slate-950/70 pl-10 text-white placeholder:text-slate-500 ${copy.focus}`}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="newPassword" className="text-slate-200">
                  New password
                </Label>
                <div className="relative">
                  <LockKeyhole className="absolute left-3 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-500" />
                  <Input
                    id="newPassword"
                    type={showNew ? 'text' : 'password'}
                    value={form.newPassword}
                    onChange={handleChange('newPassword')}
                    autoComplete="new-password"
                    className={`h-12 border-slate-700 bg-slate-950/70 pl-10 pr-11 text-white placeholder:text-slate-500 ${copy.focus}`}
                    required
                  />
                  <button
                    type="button"
                    aria-label={showNew ? 'Hide new password' : 'Show new password'}
                    onClick={() => setShowNew((current) => !current)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-500 hover:text-slate-200"
                  >
                    {showNew ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                  </button>
                </div>
                <p className={policySatisfied ? 'text-xs text-emerald-300' : 'text-xs text-slate-400'}>
                  Use at least 8 characters with uppercase, lowercase, number, and symbol.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmNewPassword" className="text-slate-200">
                  Confirm new password
                </Label>
                <div className="relative">
                  <LockKeyhole className="absolute left-3 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-500" />
                  <Input
                    id="confirmNewPassword"
                    type={showConfirm ? 'text' : 'password'}
                    value={form.confirmNewPassword}
                    onChange={handleChange('confirmNewPassword')}
                    autoComplete="new-password"
                    className={`h-12 border-slate-700 bg-slate-950/70 pl-10 pr-11 text-white placeholder:text-slate-500 ${copy.focus}`}
                    required
                  />
                  <button
                    type="button"
                    aria-label={showConfirm ? 'Hide password confirmation' : 'Show password confirmation'}
                    onClick={() => setShowConfirm((current) => !current)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-500 hover:text-slate-200"
                  >
                    {showConfirm ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                  </button>
                </div>
                {passwordMismatch ? (
                  <p className="text-xs text-red-200">New passwords do not match.</p>
                ) : null}
              </div>

              <Button
                type="submit"
                disabled={saving}
                className={`h-12 w-full bg-gradient-to-r ${copy.accent} text-white hover:opacity-95`}
              >
                {saving ? 'Updating password...' : 'Create New Password'}
              </Button>
            </form>
          </section>
        </main>
      </div>
    </div>
  );
}
