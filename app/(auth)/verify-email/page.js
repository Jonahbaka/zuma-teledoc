'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CheckCircle, XCircle, Loader2, Mail, Sparkles } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { toProviderPortalPath } from '@/lib/providerPortal';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const { user }     = useAuth();
  const [status, setStatus]   = useState('verifying'); // verifying | success | error
  const [message, setMessage] = useState('Verifying your email address…');
  const [resending, setResending] = useState(false);
  const token = searchParams.get('token');

  useEffect(() => {
    if (token) {
      verifyEmail(token);
    } else {
      setStatus('error');
      setMessage('No verification token found in this link. Try clicking the button in your email again.');
    }
  }, [token]);

  const verifyEmail = async (verificationToken) => {
    try {
      const response = await api.post('/auth/verify-email', { token: verificationToken });
      if (response.data.success) {
        setStatus('success');
        setMessage("Your email is verified — you're all set!");
        toast({ title: 'Email verified ✓', description: 'Welcome aboard!', variant: 'success' });
        // Redirect to role-specific dashboard after 2.5 s
        setTimeout(() => {
          const role = user?.role;
          if (role === 'provider') router.push(toProviderPortalPath('/dashboard', {
            user,
            pathname: typeof window !== 'undefined' ? window.location.pathname : '',
          }));
          else if (role === 'admin' || role === 'super_admin') router.push('/admin/dashboard');
          else router.push('/patient/dashboard');
        }, 2500);
      }
    } catch (error) {
      setStatus('error');
      setMessage(
        error.response?.data?.error ||
        'This link may have expired. Request a new one below.'
      );
      toast({
        title: 'Verification failed',
        description: error.response?.data?.error || 'The link is invalid or expired.',
        variant: 'destructive'
      });
    }
  };

  const resendVerification = async () => {
    setResending(true);
    try {
      await api.post('/auth/resend-verification');
      toast({
        title: 'Email sent!',
        description: 'Check your inbox for a fresh verification link.',
        variant: 'success'
      });
    } catch (error) {
      toast({
        title: 'Could not resend',
        description: error.response?.data?.error || 'Please try again in a moment.',
        variant: 'destructive'
      });
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-950/30 to-slate-900 p-4">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-purple-600/10 rounded-full blur-[120px]" />
      </div>

      <div className="relative w-full max-w-md bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden">
        {/* Header bar */}
        <div className={`h-1.5 w-full ${status === 'success' ? 'bg-emerald-500' : status === 'error' ? 'bg-red-500' : 'bg-gradient-to-r from-purple-500 to-blue-500 animate-pulse'}`} />

        <div className="p-8 text-center space-y-6">
          {/* Icon */}
          <div className="flex justify-center">
            {status === 'verifying' && (
              <div className="w-20 h-20 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-blue-400 animate-spin" />
              </div>
            )}
            {status === 'success' && (
              <div className="w-20 h-20 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <CheckCircle className="w-10 h-10 text-emerald-400" />
              </div>
            )}
            {status === 'error' && (
              <div className="w-20 h-20 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                <XCircle className="w-10 h-10 text-red-400" />
              </div>
            )}
          </div>

          {/* Title */}
          <div>
            <h1 className="text-2xl font-bold text-white">
              {status === 'verifying' && 'Verifying your email…'}
              {status === 'success'   && 'Email verified!'}
              {status === 'error'     && 'Verification failed'}
            </h1>
            <p className="mt-2 text-slate-400 leading-relaxed">{message}</p>
          </div>

          {/* Success state */}
          {status === 'success' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 justify-center text-emerald-400 text-sm font-medium">
                <Sparkles className="w-4 h-4" />
                Redirecting you to your dashboard…
              </div>
              <Button
                onClick={() => {
                  const role = user?.role;
                  if (role === 'provider') router.push(toProviderPortalPath('/dashboard', {
                    user,
                    pathname: typeof window !== 'undefined' ? window.location.pathname : '',
                  }));
                  else if (role === 'admin' || role === 'super_admin') router.push('/admin/dashboard');
                  else router.push('/patient/dashboard');
                }}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl"
              >
                Go to Dashboard
              </Button>
            </div>
          )}

          {/* Error state */}
          {status === 'error' && (
            <div className="space-y-3">
              <Button
                onClick={resendVerification}
                disabled={resending}
                className="w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl"
              >
                {resending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</>
                ) : (
                  <><Mail className="w-4 h-4 mr-2" /> Send a new verification email</>
                )}
              </Button>
              <Button
                variant="ghost"
                onClick={() => router.push('/patient/login')}
                className="w-full text-slate-400 hover:text-white hover:bg-white/5 rounded-xl"
              >
                Back to login
              </Button>
            </div>
          )}
        </div>

        {/* Nova footer */}
        <div className="px-8 pb-6 text-center">
          <p className="text-xs text-slate-500">
            🤖 Need help? Nova, your DoctaRx AI concierge, is always available in your dashboard.
          </p>
        </div>
      </div>
    </div>
  );
}

function VerifyEmailFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <div className="flex items-center gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
        <span className="text-slate-400">Verifying…</span>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<VerifyEmailFallback />}>
      <VerifyEmailContent />
    </Suspense>
  );
}
