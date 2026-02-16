'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { User, Stethoscope, Mail, Lock, Calendar } from 'lucide-react';
import { authAPI } from '@/lib/api';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PhoneInputE164, isValidE164 } from '@/components/forms/PhoneInputE164';
import { GlobalAddressFields } from '@/components/forms/GlobalAddressFields';
import { useI18n } from '@/components/providers/I18nProvider';
import { jurisdictionForCountry } from '@/lib/compliance';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';

export default function GlobalSignupPage() {
  const router = useRouter();
  const { t } = useI18n();

  const [role, setRole] = useState('patient'); // patient | provider
  const [loading, setLoading] = useState(false);

  const [address, setAddress] = useState({
    country: 'US',
    addressLine1: '',
    addressLine2: '',
    city: '',
    region: '',
    postalCode: ''
  });

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    password: '',
    confirmPassword: '',
    hipaaConsent: true,
    termsAccepted: true
  });

  const canSubmit = useMemo(() => {
    if (!form.firstName || !form.lastName || !form.email || !form.password || !form.confirmPassword) return false;
    if (form.password !== form.confirmPassword) return false;
    if (form.phone && !isValidE164(form.phone)) return false;
    return true;
  }, [form]);

  const jurisdiction = useMemo(() => jurisdictionForCountry(address.country), [address.country]);

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;

    setLoading(true);
    try {
      const payload = {
        ...form,
        role,
        ...address
      };

      const res = await authAPI.register(payload);
      if (!res.data?.success) {
        throw new Error(res.data?.error || 'Registration failed');
      }

      if (res.data.accessToken) localStorage.setItem('accessToken', res.data.accessToken);
      if (res.data.refreshToken) localStorage.setItem('refreshToken', res.data.refreshToken);

      toast({ title: 'Account created', description: role === 'patient' ? 'Continue to activation.' : 'Provider account submitted.' });
      router.push(role === 'patient' ? '/patient/subscription' : '/provider/login?registered=true');
    } catch (err) {
      toast({
        title: 'Signup failed',
        description: err?.response?.data?.error || err.message || 'Signup failed',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50 dark:from-slate-950 dark:via-slate-900 dark:to-purple-950 p-6">
      <header className="max-w-3xl mx-auto mb-6">
        <Link href="/" className="inline-flex items-center gap-2">
          <DoctaRxLogo className="h-9 w-auto" />
        </Link>
      </header>

      <main className="max-w-3xl mx-auto">
        <div className="bg-card border border-border rounded-2xl shadow-xl p-6 md:p-8">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-foreground">{t('signup.title', 'Global Sign Up')}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Global-ready signup: country-aware address and E.164 phone format.
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant={role === 'patient' ? 'default' : 'outline'} onClick={() => setRole('patient')}>
                <User className="w-4 h-4 mr-2" /> {t('signup.patient', 'Patient')}
              </Button>
              <Button type="button" variant={role === 'provider' ? 'default' : 'outline'} onClick={() => setRole('provider')}>
                <Stethoscope className="w-4 h-4 mr-2" /> {t('signup.provider', 'Provider')}
              </Button>
            </div>
          </div>

          <form onSubmit={submit} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>First name</Label>
                <Input value={form.firstName} onChange={(e) => setForm(p => ({ ...p, firstName: e.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label>Last name</Label>
                <Input value={form.lastName} onChange={(e) => setForm(p => ({ ...p, lastName: e.target.value }))} required />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="email"
                  className="pl-9"
                  value={form.email}
                  onChange={(e) => setForm(p => ({ ...p, email: e.target.value }))}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Phone (E.164)</Label>
              <PhoneInputE164
                value={form.phone}
                onChange={(v) => setForm(p => ({ ...p, phone: v }))}
                defaultCountryIso2={address.country}
              />
              {form.phone && !isValidE164(form.phone) && (
                <p className="text-xs text-red-500">Use international E.164 format (example: +2348012345678).</p>
              )}
            </div>

            {role === 'patient' && (
              <div className="space-y-2">
                <Label>Date of birth</Label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="date"
                    className="pl-9"
                    value={form.dateOfBirth}
                    onChange={(e) => setForm(p => ({ ...p, dateOfBirth: e.target.value }))}
                  />
                </div>
              </div>
            )}

            <GlobalAddressFields value={address} onChange={setAddress} />
            {(jurisdiction.code === 'GDPR' || jurisdiction.code === 'LGPD') && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                Compliance: {jurisdiction.label} jurisdiction detected. Data handling will follow local requirements where supported.
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="password"
                    className="pl-9"
                    value={form.password}
                    onChange={(e) => setForm(p => ({ ...p, password: e.target.value }))}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Confirm password</Label>
                <Input
                  type="password"
                  value={form.confirmPassword}
                  onChange={(e) => setForm(p => ({ ...p, confirmPassword: e.target.value }))}
                  required
                />
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={!canSubmit || loading}>
              {loading ? 'Creating...' : 'Create account'}
            </Button>

            <p className="text-xs text-muted-foreground">
              Existing flows still available: <Link href="/patient/register" className="underline">patient</Link> ·{' '}
              <Link href="/provider/register" className="underline">provider</Link>
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}

