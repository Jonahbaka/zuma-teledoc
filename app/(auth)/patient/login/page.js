'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, Mail, Lock, Heart, Shield, Loader2, Zap } from 'lucide-react';
import { authAPI, testingLinksAPI } from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';

function PatientLoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const testToken = searchParams.get('test_token');
  const { login } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [testingMode, setTestingMode] = useState(null);
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });

  // Clear any stale tokens when landing on login page
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
    }
  }, []);

  // Check if test token is valid
  useEffect(() => {
    if (testToken) {
      testingLinksAPI.validate(testToken)
        .then(res => {
          if (res.data.success && res.data.linkType === 'patient') {
            setTestingMode(res.data);
          }
        })
        .catch(() => setTestingMode(null));
    }
  }, [testToken]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const fd = new FormData(e.currentTarget);
      const email = String(fd.get('email') || '').trim();
      const password = String(fd.get('password') || '');

      const result = await login(email, password, null, 'patient');

      if (result.success) {
        // If we have a test token, activate testing bypass
        if (testToken && testingMode) {
          try {
            await testingLinksAPI.activate(testToken);
            toast({
              title: 'Testing Access Activated!',
              description: `You now have ${testingMode.grantTier} tier access for testing.`,
            });
          } catch (err) {
            console.error('Failed to activate testing bypass:', err);
          }
        } else {
          toast({
            title: 'Welcome back!',
            description: 'Successfully signed in to your patient portal.',
          });
        }
        
        router.push('/patient/dashboard');
      } else {
        toast({
          title: 'Login Failed',
          description: result.error || 'Invalid credentials',
          variant: 'destructive'
        });
      }
    } catch (error) {
      toast({
        title: 'Login Failed',
        description: 'An unexpected error occurred',
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-purple-50 via-white to-blue-50 dark:from-slate-950 dark:via-slate-900 dark:to-purple-950">
      {/* Header */}
      <header className="p-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="rounded-xl bg-slate-950/95 px-3 py-2 shadow-[0_0_20px_rgba(34,211,238,0.18)] border border-slate-800">
            <DoctaRxLogo className="h-8 w-auto" />
          </span>
        </Link>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="bg-card border border-border rounded-2xl shadow-xl p-8">
            {/* Testing Mode Banner */}
            {testingMode && (
              <div className="mb-6 p-3 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-lg">
                <div className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-amber-600" />
                  <div>
                    <p className="font-medium text-amber-900">Testing Access</p>
                    <p className="text-sm text-amber-700">
                      Sign in to activate {testingMode.grantTier} tier access
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Icon & Title */}
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Heart className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-foreground">Patient Portal</h1>
              <p className="text-muted-foreground mt-2">Sign in to access your health records</p>
            </div>

            {/* Login Form */}
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="your@email.com"
                    value={formData.email}
                    onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                    className="pl-10"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link href="/forgot-password" className="text-sm text-purple-600 hover:text-purple-700">
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={formData.password}
                    onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                    className="pl-10 pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={isLoading}
                className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
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
            </form>

            {/* Sign Up Link */}
            <p className="text-center mt-6 text-muted-foreground">
              Don't have an account?{' '}
              <Link href="/patient/register" className="text-purple-600 hover:text-purple-700 font-medium">
                Sign up
              </Link>
            </p>
          </div>

          {/* Security Badge */}
          <div className="flex items-center justify-center gap-2 mt-6 text-sm text-muted-foreground">
            <Shield className="w-4 h-4" />
            <span>Secure Platform • End-to-End Encrypted • NemoClaw Protected</span>
          </div>
        </div>
      </main>
    </div>
  );
}

function LoginPageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 via-white to-blue-50 dark:from-slate-950 dark:via-slate-900 dark:to-purple-950">
      <div className="flex items-center gap-2">
        <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
        <span className="text-muted-foreground">Loading...</span>
      </div>
    </div>
  );
}

export default function PatientLoginPage() {
  return (
    <Suspense fallback={<LoginPageFallback />}>
      <PatientLoginContent />
    </Suspense>
  );
}
