'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Pill, Stethoscope, Users, Hospital, Package,
  ArrowRight, CheckCircle, Eye, EyeOff, Phone,
  Mail, Lock, User, Building2, ChevronLeft
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NG_STATES, ORG_TYPES } from '../../lib/ngUtils';

const ROLES = [
  {
    key: 'patient',
    icon: Pill,
    label: 'Patient',
    desc: 'Access consultations, prescriptions & health records',
    color: 'text-green-600',
    bg: 'bg-green-500/10',
    border: 'border-green-500/30',
    activeBorder: 'border-green-500',
    activeBg: 'bg-green-500/5',
  },
  {
    key: 'provider',
    icon: Stethoscope,
    label: 'Doctor / Provider',
    desc: 'Consult patients, issue prescriptions, track earnings',
    color: 'text-blue-600',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    activeBorder: 'border-blue-500',
    activeBg: 'bg-blue-500/5',
  },
  {
    key: 'organization',
    icon: Users,
    label: 'Organisation',
    desc: 'Manage corporate healthcare plans for your team',
    color: 'text-indigo-600',
    bg: 'bg-indigo-500/10',
    border: 'border-indigo-500/30',
    activeBorder: 'border-indigo-500',
    activeBg: 'bg-indigo-500/5',
  },
  {
    key: 'hospital',
    icon: Hospital,
    label: 'Hospital / Clinic',
    desc: 'Onboard your facility and manage staff',
    color: 'text-rose-600',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    activeBorder: 'border-rose-500',
    activeBg: 'bg-rose-500/5',
  },
  {
    key: 'pharmacy',
    icon: Package,
    label: 'Pharmacy',
    desc: 'Receive prescriptions and manage your pharmacy',
    color: 'text-teal-600',
    bg: 'bg-teal-500/10',
    border: 'border-teal-500/30',
    activeBorder: 'border-teal-500',
    activeBg: 'bg-teal-500/5',
  },
];

function RegisterContent() {
  const searchParams = useSearchParams();
  const initialRole = searchParams.get('role') || null;

  const [step, setStep] = useState(initialRole ? 2 : 1);
  const [role, setRole] = useState(initialRole);
  const [form, setForm] = useState({
    full_name: '', email: '', phone: '', password: '', confirm_password: '',
    state: '', org_name: '', org_type: 'company',
  });
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const selectedRole = ROLES.find(r => r.key === role);

  const handleChange = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm_password) {
      setError('Passwords do not match.');
      return;
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    try {
      const API = process.env.NEXT_PUBLIC_API_URL || '/api';
      const body = { ...form, role, region: 'NG' };
      const res = await fetch(`${API}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');
      setSuccess(true);

      // Redirect based on role after short delay
      setTimeout(() => {
        const dashMap = {
          patient: '/ng/patient/dashboard',
          provider: '/ng/provider/dashboard',
          organization: '/ng/organization/dashboard',
          hospital: '/ng/hospital/dashboard',
          pharmacy: '/ng/pharmacy/dashboard',
        };
        window.location.href = dashMap[role] || '/ng';
      }, 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="bg-card border border-border rounded-3xl p-12 max-w-md w-full text-center space-y-4">
          <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle size={32} className="text-green-500" />
          </div>
          <h2 className="text-2xl font-bold text-foreground">Account created!</h2>
          <p className="text-muted-foreground">Redirecting you to your dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left panel */}
      <div className="hidden lg:flex flex-col justify-between w-2/5 bg-gradient-to-br from-green-900 via-slate-900 to-emerald-950 p-12">
        <Link href="/ng" className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-green-600 rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(22,163,74,0.35)]">
            <span className="text-white font-black text-sm">Rx</span>
          </div>
          <span className="text-white font-bold text-xl">DoctaRx <span className="text-green-400">NG</span></span>
        </Link>

        <div className="space-y-6">
          <h2 className="text-4xl font-bold text-white leading-tight">
            Join Nigeria's healthcare platform
          </h2>
          <p className="text-slate-400 leading-relaxed">
            Patients, doctors, hospitals, pharmacies, and organisations — DoctaRx Nigeria connects every part of the healthcare system.
          </p>
          <div className="space-y-4">
            {[
              'Free to register for patients',
              'MDCN-verified providers',
              'PCN & NAFDAC compliant pharmacies',
              'Paystack & Flutterwave payments',
              'NDPA data protection compliant',
            ].map((item) => (
              <div key={item} className="flex items-center gap-3 text-slate-300 text-sm">
                <CheckCircle size={16} className="text-green-400 shrink-0" />
                {item}
              </div>
            ))}
          </div>
        </div>

        <div className="text-slate-500 text-xs">
          Already have an account?{' '}
          <Link href="/ng/auth/login" className="text-green-400 hover:text-green-300">Sign in</Link>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 overflow-y-auto">
        <div className="w-full max-w-lg">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center justify-between mb-8">
            <Link href="/ng" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-black text-xs">Rx</span>
              </div>
              <span className="font-bold text-foreground">DoctaRx NG</span>
            </Link>
            <Link href="/ng/auth/login" className="text-sm text-green-600 font-medium">Sign in →</Link>
          </div>

          {/* Step 1: Role selector */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h1 className="text-3xl font-bold text-foreground">Create your account</h1>
                <p className="text-muted-foreground mt-2">Select the type of account you'd like to create.</p>
              </div>

              <div className="grid gap-3">
                {ROLES.map((r) => {
                  const Icon = r.icon;
                  const isSelected = role === r.key;
                  return (
                    <button
                      key={r.key}
                      onClick={() => setRole(r.key)}
                      className={`flex items-center gap-4 p-4 rounded-2xl border text-left transition-all ${
                        isSelected
                          ? `${r.activeBg} ${r.activeBorder} border-2`
                          : `border-border bg-card hover:bg-accent hover:${r.border}`
                      }`}
                    >
                      <div className={`w-12 h-12 rounded-xl ${r.bg} flex items-center justify-center shrink-0`}>
                        <Icon size={22} className={r.color} />
                      </div>
                      <div>
                        <div className={`font-bold ${isSelected ? r.color : 'text-foreground'}`}>{r.label}</div>
                        <div className="text-sm text-muted-foreground">{r.desc}</div>
                      </div>
                      {isSelected && <CheckCircle size={18} className={`ml-auto ${r.color} shrink-0`} />}
                    </button>
                  );
                })}
              </div>

              <Button
                onClick={() => setStep(2)}
                disabled={!role}
                className="w-full bg-green-600 hover:bg-green-500 text-white h-12 rounded-2xl font-bold"
              >
                Continue <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </div>
          )}

          {/* Step 2: Details form */}
          {step === 2 && (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="flex items-center gap-3 mb-4">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center hover:bg-border transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
                {selectedRole && (
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl ${selectedRole.bg} ${selectedRole.color} border ${selectedRole.border} text-sm font-semibold`}>
                    <selectedRole.icon size={14} />
                    {selectedRole.label}
                  </div>
                )}
              </div>

              <h1 className="text-2xl font-bold text-foreground">Your details</h1>

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-600 rounded-xl px-4 py-3 text-sm">
                  {error}
                </div>
              )}

              <div className="space-y-4">
                {/* Org name if organisation or hospital */}
                {(role === 'organization' || role === 'hospital') && (
                  <label className="block">
                    <span className="text-sm font-medium text-foreground block mb-1.5">
                      {role === 'organization' ? 'Organisation Name' : 'Hospital / Clinic Name'} *
                    </span>
                    <div className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3 focus-within:border-green-500/50 focus-within:ring-1 focus-within:ring-green-500/30 transition-all">
                      <Building2 size={16} className="text-muted-foreground shrink-0" />
                      <input
                        name="org_name"
                        value={form.org_name}
                        onChange={handleChange}
                        required
                        placeholder="Enter name"
                        className="flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground"
                      />
                    </div>
                  </label>
                )}

                {role === 'organization' && (
                  <label className="block">
                    <span className="text-sm font-medium text-foreground block mb-1.5">Organisation Type *</span>
                    <select
                      name="org_type"
                      value={form.org_type}
                      onChange={handleChange}
                      required
                      className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none focus:border-green-500/50"
                    >
                      {ORG_TYPES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </label>
                )}

                <label className="block">
                  <span className="text-sm font-medium text-foreground block mb-1.5">
                    {role === 'organization' ? 'Admin Full Name' : 'Full Name'} *
                  </span>
                  <div className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3 focus-within:border-green-500/50 focus-within:ring-1 focus-within:ring-green-500/30 transition-all">
                    <User size={16} className="text-muted-foreground shrink-0" />
                    <input
                      name="full_name"
                      value={form.full_name}
                      onChange={handleChange}
                      required
                      placeholder="Your full name"
                      className="flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-foreground block mb-1.5">Email Address *</span>
                  <div className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3 focus-within:border-green-500/50 focus-within:ring-1 focus-within:ring-green-500/30 transition-all">
                    <Mail size={16} className="text-muted-foreground shrink-0" />
                    <input
                      name="email"
                      type="email"
                      value={form.email}
                      onChange={handleChange}
                      required
                      placeholder="you@email.com"
                      className="flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-foreground block mb-1.5">Phone Number *</span>
                  <div className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3 focus-within:border-green-500/50 focus-within:ring-1 focus-within:ring-green-500/30 transition-all">
                    <Phone size={16} className="text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground text-sm shrink-0">+234</span>
                    <input
                      name="phone"
                      type="tel"
                      value={form.phone}
                      onChange={handleChange}
                      required
                      placeholder="08012345678"
                      className="flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-foreground block mb-1.5">State *</span>
                  <select
                    name="state"
                    value={form.state}
                    onChange={handleChange}
                    required
                    className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none focus:border-green-500/50"
                  >
                    <option value="">Select state</option>
                    {NG_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-foreground block mb-1.5">Password *</span>
                  <div className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3 focus-within:border-green-500/50 focus-within:ring-1 focus-within:ring-green-500/30 transition-all">
                    <Lock size={16} className="text-muted-foreground shrink-0" />
                    <input
                      name="password"
                      type={showPwd ? 'text' : 'password'}
                      value={form.password}
                      onChange={handleChange}
                      required
                      minLength={8}
                      placeholder="Min. 8 characters"
                      className="flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground"
                    />
                    <button type="button" onClick={() => setShowPwd(v => !v)} className="text-muted-foreground hover:text-foreground">
                      {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-foreground block mb-1.5">Confirm Password *</span>
                  <div className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3 focus-within:border-green-500/50 focus-within:ring-1 focus-within:ring-green-500/30 transition-all">
                    <Lock size={16} className="text-muted-foreground shrink-0" />
                    <input
                      name="confirm_password"
                      type={showPwd ? 'text' : 'password'}
                      value={form.confirm_password}
                      onChange={handleChange}
                      required
                      placeholder="Repeat password"
                      className="flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                </label>
              </div>

              <p className="text-xs text-muted-foreground">
                By creating an account you agree to our{' '}
                <Link href="/terms" className="text-green-600 hover:underline">Terms of Service</Link>
                {' '}and{' '}
                <Link href="/privacy" className="text-green-600 hover:underline">Privacy Policy</Link>.
              </p>

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-green-600 hover:bg-green-500 text-white h-12 rounded-2xl font-bold"
              >
                {loading ? 'Creating account…' : 'Create Account'}
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{' '}
                <Link href="/ng/auth/login" className="text-green-600 font-semibold hover:underline">Sign in</Link>
              </p>

              {role === 'provider' && (
                <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-4 text-sm text-blue-700 dark:text-blue-300">
                  <strong>For Providers:</strong> After registration you will complete your MDCN verification and provider profile before seeing patients.
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><div className="text-muted-foreground">Loading…</div></div>}>
      <RegisterContent />
    </Suspense>
  );
}
