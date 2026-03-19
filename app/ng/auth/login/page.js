'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';

export default function NigeriaLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/api/auth/login', { email, password });
      if (res.data.user) {
        // Redirect based on role
        const role = res.data.user.role;
        if (role === 'admin' || role === 'super_admin') {
          router.push('/ng/admin');
        } else {
          router.push('/ng/patient/search');
        }
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/ng" className="inline-flex items-center space-x-2">
            <div className="w-10 h-10 bg-green-600 rounded-xl flex items-center justify-center">
              <span className="text-white font-bold">Rx</span>
            </div>
            <span className="text-2xl font-bold text-gray-900">ZumaRx</span>
          </Link>
          <p className="text-gray-500 mt-2">Sign in to your account</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                className="w-full px-3 py-2 border rounded-lg focus:ring-green-500 focus:border-green-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                className="w-full px-3 py-2 border rounded-lg focus:ring-green-500 focus:border-green-500" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50">
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="mt-4 text-center text-sm">
            <Link href="/ng/auth/register" className="text-green-600 hover:underline">
              Create an account
            </Link>
            <span className="mx-2 text-gray-300">|</span>
            <Link href="/(auth)/forgot-password" className="text-gray-500 hover:underline">
              Forgot password?
            </Link>
          </div>

          <div className="mt-6 pt-4 border-t text-center">
            <Link href="/ng/pharmacy/onboarding" className="text-sm text-green-600 font-medium hover:underline">
              Register as a Pharmacy
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
