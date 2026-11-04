'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { CreditCard, Loader2, CheckCircle2, XCircle, Stethoscope, User, Shield, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

function getApiBase() {
  if (typeof window === 'undefined') return '';
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:8080';
  return window.location.origin;
}

function TestPaymentContent() {
  const searchParams = useSearchParams();
  const success = searchParams.get('success') === 'true';
  const cancelled = searchParams.get('cancelled') === 'true';
  const role = searchParams.get('role');

  const [loadingPatient, setLoadingPatient] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState(false);
  const [error, setError] = useState('');

  const startCheckout = async (type) => {
    const setter = type === 'patient' ? setLoadingPatient : setLoadingProvider;
    setter(true);
    setError('');
    try {
      const res = await fetch(`${getApiBase()}/api/stripe/test-checkout/${type}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json();
      if (data.success && data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || 'Failed to create checkout session. Check that STRIPE_SECRET_KEY is set.');
      }
    } catch (err) {
      setError(err.message || 'Network error');
    }
    setter(false);
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-gray-900 border border-green-800/50 rounded-2xl p-8 text-center">
          <CheckCircle2 className="w-16 h-16 text-green-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Payment Successful</h1>
          <p className="text-gray-400 mb-2">
            {role === 'provider' ? 'Provider' : 'Patient'} test subscription ($1/month) is now active.
          </p>
          <p className="text-sm text-gray-500 mb-6">Stripe processed the charge. Webhook will update your account status.</p>
          <div className="flex gap-3 justify-center">
            <Link href={role === 'provider' ? '/provider/dashboard' : '/patient/dashboard'} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-500">
              Go to Dashboard
            </Link>
            <Link href="/test-payment" className="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-700">
              Test Again
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (cancelled) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-gray-900 border border-amber-800/50 rounded-2xl p-8 text-center">
          <XCircle className="w-16 h-16 text-amber-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Payment Cancelled</h1>
          <p className="text-gray-400 mb-6">No charge was made. You can try again anytime.</p>
          <Link href="/test-payment" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-500">
            Try Again
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="max-w-lg w-full space-y-6">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <CreditCard className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">Stripe Test Checkout</h1>
          <p className="text-gray-400 mt-2">$1.00/month test subscriptions for development</p>
          <p className="text-xs text-gray-600 mt-1 flex items-center justify-center gap-1">
            <Shield className="w-3 h-3" /> Use Stripe test card: 4242 4242 4242 4242
          </p>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-800/50 rounded-xl p-4 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="grid gap-4">
          {/* Patient Test */}
          <button
            onClick={() => startCheckout('patient')}
            disabled={loadingPatient}
            className="w-full bg-gray-900 border border-gray-800 rounded-xl p-6 hover:border-blue-700/50 hover:bg-gray-900/80 transition-all text-left group"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-600/20 flex items-center justify-center">
                <User className="w-6 h-6 text-blue-400" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-white group-hover:text-blue-300 transition-colors">Patient Test Subscription</h2>
                <p className="text-sm text-gray-400">$1.00/month — all features unlocked, cancel anytime</p>
              </div>
              {loadingPatient ? (
                <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
              ) : (
                <span className="text-2xl font-bold text-blue-400">$1</span>
              )}
            </div>
          </button>

          {/* Provider Test */}
          <button
            onClick={() => startCheckout('provider')}
            disabled={loadingProvider}
            className="w-full bg-gray-900 border border-gray-800 rounded-xl p-6 hover:border-purple-700/50 hover:bg-gray-900/80 transition-all text-left group"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-purple-600/20 flex items-center justify-center">
                <Stethoscope className="w-6 h-6 text-purple-400" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-white group-hover:text-purple-300 transition-colors">Provider Test Subscription</h2>
                <p className="text-sm text-gray-400">$1.00/month — all provider features, cancel anytime</p>
              </div>
              {loadingProvider ? (
                <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
              ) : (
                <span className="text-2xl font-bold text-purple-400">$1</span>
              )}
            </div>
          </button>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2">
          <h3 className="text-sm font-medium text-gray-300">Test Card Details</h3>
          <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
            <div>Card Number</div><div className="text-gray-300 font-mono">4242 4242 4242 4242</div>
            <div>Expiry</div><div className="text-gray-300 font-mono">Any future date (e.g. 12/30)</div>
            <div>CVC</div><div className="text-gray-300 font-mono">Any 3 digits (e.g. 123)</div>
            <div>ZIP</div><div className="text-gray-300 font-mono">Any 5 digits (e.g. 10001)</div>
          </div>
        </div>

        <div className="text-center">
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-300 flex items-center justify-center gap-1">
            <ArrowLeft className="w-3 h-3" /> Back to homepage
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function TestPaymentPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
      </div>
    }>
      <TestPaymentContent />
    </Suspense>
  );
}
