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
      // Clear stale tokens
      if (typeof window !== 'undefined') {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
      }

      const res = await api.post('/auth/login', { email, password });

      if (res.data.success) {
        // Store tokens
        if (res.data.accessToken) localStorage.setItem('accessToken', res.data.accessToken);
        if (res.data.refreshToken) localStorage.setItem('refreshToken', res.data.refreshToken);

        // Redirect based on role
        const role = res.data.user?.role;
        if (role === 'admin' || role === 'super_admin') {
          router.push('/ng/admin');
        } else {
          router.push('/ng/patient/search');
        }
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#f8fafc' }}>
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/ng" className="inline-flex items-center space-x-2">
            <div className="w-12 h-12 bg-green-600 rounded-2xl flex items-center justify-center shadow-lg shadow-green-600/20">
              <span className="text-white font-bold text-lg">Rx</span>
            </div>
            <span className="text-2xl font-bold" style={{ color: '#111827' }}>ZumaRx</span>
          </Link>
          <p className="mt-2 text-sm" style={{ color: '#6b7280' }}>Sign in to your account</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl shadow-xl p-6 sm:p-8" style={{ background: '#ffffff' }}>
          {error && (
            <div className="mb-4 px-4 py-3 rounded-xl text-sm" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#374151' }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@example.com"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  fontSize: '16px',
                  borderRadius: '12px',
                  border: '1.5px solid #d1d5db',
                  outline: 'none',
                  color: '#111827',
                  background: '#f9fafb',
                  WebkitAppearance: 'none',
                }}
                onFocus={e => { e.target.style.borderColor = '#16a34a'; e.target.style.boxShadow = '0 0 0 3px rgba(22,163,74,0.1)'; }}
                onBlur={e => { e.target.style.borderColor = '#d1d5db'; e.target.style.boxShadow = 'none'; }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#374151' }}>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="Enter your password"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  fontSize: '16px',
                  borderRadius: '12px',
                  border: '1.5px solid #d1d5db',
                  outline: 'none',
                  color: '#111827',
                  background: '#f9fafb',
                  WebkitAppearance: 'none',
                }}
                onFocus={e => { e.target.style.borderColor = '#16a34a'; e.target.style.boxShadow = '0 0 0 3px rgba(22,163,74,0.1)'; }}
                onBlur={e => { e.target.style.borderColor = '#d1d5db'; e.target.style.boxShadow = 'none'; }}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '14px',
                fontSize: '16px',
                fontWeight: '600',
                borderRadius: '12px',
                border: 'none',
                cursor: loading ? 'not-allowed' : 'pointer',
                color: '#ffffff',
                background: loading ? '#86efac' : '#16a34a',
                transition: 'background 0.2s',
              }}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="mt-5 text-center text-sm" style={{ color: '#6b7280' }}>
            <Link href="/ng/auth/register" style={{ color: '#16a34a', fontWeight: '500' }}>
              Create an account
            </Link>
            <span className="mx-2">|</span>
            <Link href="/forgot-password" style={{ color: '#6b7280' }}>
              Forgot password?
            </Link>
          </div>

          <div className="mt-6 pt-4 text-center" style={{ borderTop: '1px solid #e5e7eb' }}>
            <Link href="/ng/pharmacy/onboarding" className="text-sm font-medium" style={{ color: '#16a34a' }}>
              Register as a Pharmacy
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
