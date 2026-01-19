'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, Mail, Lock, Stethoscope, Shield, Loader2, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function ProviderLoginPage() {
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });

  // Check for invite token
  const inviteToken = searchParams.get('invite');
  const fromInvite = searchParams.get('from') === 'invite';

  useEffect(() => {
    if (fromInvite) {
      toast({
        title: 'Account Created',
        description: 'Your provider account has been created. Please sign in.',
      });
    }
  }, [fromInvite]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Read from DOM form fields to avoid any state/event edge-cases (autofill/automation/etc.)
      const fd = new FormData(e.currentTarget);
      const email = String(fd.get('email') || '').trim();
      const password = String(fd.get('password') || '');

      // Use the AuthProvider's login function directly with correct signature
      const result = await login(email, password, null, 'provider');

      if (result?.error) {
        // Check if error indicates pending/suspended status
        if (result.error.toLowerCase().includes('pending')) {
          toast({
            title: 'Account Pending Approval',
            description: 'Your provider account is pending approval. You will be notified once approved.',
            variant: 'default'
          });
        } else if (result.error.toLowerCase().includes('suspended') || result.error.toLowerCase().includes('restricted')) {
          toast({
            title: 'Account Restricted',
            description: 'Your provider account has been restricted. Please contact support.',
            variant: 'destructive'
          });
        } else {
          toast({
            title: 'Login Failed',
            description: result.error,
            variant: 'destructive'
          });
        }
        return;
      }

      if (result?.success) {
        toast({
          title: 'Welcome back, Doctor!',
          description: 'Successfully signed in to your provider portal.',
        });
        // AuthProvider handles redirect automatically
      }
    } catch (error) {
      const message = error.response?.data?.error || error.message || 'Invalid credentials';
      toast({
        title: 'Login Failed',
        description: message,
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Header */}
      <header className="p-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl flex items-center justify-center">
            <span className="text-white font-bold text-xl">D</span>
          </div>
          <span className="text-2xl font-bold text-white">
            Docta<span className="text-purple-400">.</span>
          </span>
        </Link>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 rounded-2xl shadow-2xl p-8">
            {/* Icon & Title */}
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Stethoscope className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-white">Provider Portal</h1>
              <p className="text-slate-400 mt-2">Access your clinical dashboard</p>
            </div>

            {/* Notice for non-invited users */}
            {!inviteToken && !fromInvite && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-6">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-amber-200 font-medium">Invite Required</p>
                    <p className="text-xs text-amber-300/70 mt-1">
                      Provider registration is by invitation only. Contact administration if you need access.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Login Form */}
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-slate-300">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="doctor@hospital.com"
                    name="email"
                    value={formData.email}
                    onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                    className="pl-10 bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500 focus:border-purple-500"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-slate-300">Password</Label>
                  <Link href="/forgot-password?role=provider" className="text-sm text-purple-400 hover:text-purple-300">
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
                    onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                    className="pl-10 pr-10 bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500 focus:border-purple-500"
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
                className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white"
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
          </div>

          {/* Security Badge */}
          <div className="flex items-center justify-center gap-2 mt-6 text-sm text-slate-400">
            <Shield className="w-4 h-4" />
            <span>HIPAA Compliant • Healthcare-Grade Security</span>
          </div>
        </div>
      </main>
    </div>
  );
}

