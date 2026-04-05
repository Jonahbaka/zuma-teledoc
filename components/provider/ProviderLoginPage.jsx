'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Mail, Lock, Stethoscope, Shield, Loader2, Zap } from 'lucide-react';
import { testingLinksAPI } from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';
import { setPreferredProviderMarket } from '@/lib/providerPortal';

const MARKET_THEMES = {
  US: {
    icon: 'from-purple-500 to-indigo-600',
    button: 'from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700',
    link: 'text-purple-400 hover:text-purple-300',
    focus: 'focus:border-purple-500',
    badge: 'HIPAA compliant • Healthcare-grade security',
    subtitle: 'Access your clinical dashboard',
  },
  NG: {
    icon: 'from-emerald-500 to-teal-600',
    button: 'from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700',
    link: 'text-emerald-400 hover:text-emerald-300',
    focus: 'focus:border-emerald-500',
    badge: 'NDPA aligned • Encrypted clinical sessions',
    subtitle: 'Access your Nigeria doctor, clinic, and hospital operations portal',
  },
};

function ProviderLoginContent({ market = 'US', allowTestingAccess = true }) {
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [testingMode, setTestingMode] = useState(null);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });

  const theme = MARKET_THEMES[market] || MARKET_THEMES.US;
  const homeHref = market === 'NG' ? '/ng' : '/';
  const registerHref = market === 'NG' ? '/ng/provider/register' : '/provider/register';
  const fromInvite = searchParams.get('from') === 'invite';
  const justRegistered = searchParams.get('registered') === 'true';
  const testToken = allowTestingAccess ? searchParams.get('test_token') : null;

  useEffect(() => {
    setPreferredProviderMarket(market);

    if (typeof window !== 'undefined') {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
    }
  }, [market]);

  useEffect(() => {
    if (justRegistered) {
      toast({
        title: 'Registration Successful',
        description: market === 'NG'
          ? 'Sign in to continue credential review and activate your Nigeria care workspace.'
          : 'Sign in to complete your credentialing and set up your practice.',
      });
    } else if (fromInvite) {
      toast({
        title: 'Account Created',
        description: 'Your provider account has been created. Please sign in.',
      });
    }
  }, [fromInvite, justRegistered, market]);

  useEffect(() => {
    if (!testToken) {
      setTestingMode(null);
      return;
    }

    testingLinksAPI.validate(testToken)
      .then((res) => {
        if (res.data.success && res.data.linkType === 'provider') {
          setTestingMode(res.data);
        }
      })
      .catch(() => setTestingMode(null));
  }, [testToken]);

  const title = useMemo(
    () => (market === 'NG' ? 'Nigeria Provider Portal' : 'Provider Portal'),
    [market]
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setPreferredProviderMarket(market);

    try {
      const fd = new FormData(e.currentTarget);
      const email = String(fd.get('email') || '').trim();
      const password = String(fd.get('password') || '');
      const result = await login(email, password, null, 'provider');

      if (result?.error) {
        if (result.error.toLowerCase().includes('pending')) {
          toast({
            title: 'Account Pending Approval',
            description: 'Your provider account is pending approval. You will be notified once approved.',
          });
        } else if (result.error.toLowerCase().includes('suspended') || result.error.toLowerCase().includes('restricted')) {
          toast({
            title: 'Account Restricted',
            description: 'Your provider account has been restricted. Please contact support.',
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Login Failed',
            description: result.error,
            variant: 'destructive',
          });
        }
        return;
      }

      if (result?.success) {
        if (testToken && testingMode) {
          try {
            await testingLinksAPI.activate(testToken);
            toast({
              title: 'Testing Access Activated',
              description: `You now have ${testingMode.grantTier} tier access for testing.`,
            });
          } catch (err) {
            console.error('Failed to activate testing bypass:', err);
            toast({
              title: 'Welcome back',
              description: 'Successfully signed in to your provider portal.',
            });
          }
        } else {
          toast({
            title: 'Welcome back',
            description: market === 'NG'
              ? 'Successfully signed in to your Nigeria provider portal.'
              : 'Successfully signed in to your provider portal.',
          });
        }
      }
    } catch (error) {
      const message = error.response?.data?.error || error.message || 'Invalid credentials';
      toast({
        title: 'Login Failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <header className="px-4 py-5 sm:p-6">
        <Link href={homeHref} className="flex items-center gap-2">
          <DoctaRxLogo className="h-9 w-auto" />
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-6 sm:p-6">
        <div className="w-full max-w-md">
          <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 rounded-2xl shadow-2xl p-5 sm:p-8">
            {testingMode && (
              <div className="mb-6 p-3 bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/30 rounded-lg">
                <div className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-amber-400" />
                  <div>
                    <p className="font-medium text-amber-200">Testing Access</p>
                    <p className="text-sm text-amber-300/80">
                      Sign in to activate {testingMode.grantTier} tier access
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="text-center mb-8">
              <div className={`w-16 h-16 bg-gradient-to-br ${theme.icon} rounded-2xl flex items-center justify-center mx-auto mb-4`}>
                <Stethoscope className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-white">{title}</h1>
              <p className="text-slate-400 mt-2">{theme.subtitle}</p>
            </div>

            {(fromInvite || justRegistered) && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 mb-6">
                <div className="flex items-start gap-3">
                  <Shield className="w-5 h-5 text-emerald-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-emerald-200 font-medium">Registration Complete</p>
                    <p className="text-xs text-emerald-300/70 mt-1">
                      {market === 'NG'
                        ? 'Sign in to continue credential review and configure your Nigeria care workspace.'
                        : 'Sign in to complete your credentialing. Credential review typically takes 1-2 business days.'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-slate-300">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                  <Input
                    id="email"
                    type="email"
                    placeholder={market === 'NG' ? 'doctor@clinic.ng' : 'doctor@hospital.com'}
                    name="email"
                    value={formData.email}
                    onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                    className={`pl-10 bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500 ${theme.focus}`}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-slate-300">Password</Label>
                  <Link href="/forgot-password?role=provider" className={`text-sm ${theme.link}`}>
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    name="password"
                    value={formData.password}
                    onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
                    className={`pl-10 pr-10 bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500 ${theme.focus}`}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={isLoading}
                className={`w-full bg-gradient-to-r ${theme.button} text-white`}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Signing in...
                  </>
                ) : (
                  'Sign In'
                )}
              </Button>

              <p className="text-center text-sm text-slate-400">
                Don't have an account?{' '}
                <Link href={registerHref} className={`${theme.link} font-medium`}>
                  Register as Provider
                </Link>
              </p>
            </form>
          </div>

          <div className="flex items-center justify-center gap-2 mt-6 text-sm text-slate-400">
            <Shield className="w-4 h-4" />
            <span>{theme.badge}</span>
          </div>
        </div>
      </main>
    </div>
  );
}

function ProviderLoginFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="flex items-center gap-2">
        <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
        <span className="text-slate-400">Loading...</span>
      </div>
    </div>
  );
}

export default function ProviderLoginPage(props) {
  return (
    <Suspense fallback={<ProviderLoginFallback />}>
      <ProviderLoginContent {...props} />
    </Suspense>
  );
}
