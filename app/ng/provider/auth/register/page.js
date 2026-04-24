'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Stethoscope, CheckCircle, ArrowRight, ChevronLeft,
  User, Mail, Phone, Lock, Eye, EyeOff, FileText,
  Building2, Award, AlertCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NG_STATES } from '../../../lib/ngUtils';

const SPECIALTIES = [
  'General Practice', 'Internal Medicine', 'Pediatrics', 'Obstetrics & Gynecology',
  'Cardiology', 'Dermatology', 'Psychiatry', 'Orthopedics', 'Ophthalmology',
  'ENT', 'Urology', 'Neurology', 'Oncology', 'Radiology', 'Surgery', 'Other',
];

export default function ProviderRegisterPage() {
  const [step, setStep] = useState(1);
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [form, setForm] = useState({
    full_name: '', email: '', phone: '', password: '', confirm_password: '',
    gender: '', mdcn_number: '', specialty: 'General Practice',
    sub_specialty: '', years_experience: '', qualifications: '',
    practice_name: '', practice_address: '', practice_city: '',
    practice_state: '', consult_fee_general: '3000', consult_fee_specialist: '8000',
    bio: '',
  });

  const handleChange = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm_password) { setError('Passwords do not match.'); return; }
    if (form.password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (!form.mdcn_number) { setError('MDCN Folio Number is required.'); return; }
    setLoading(true);
    try {
      const API = process.env.NEXT_PUBLIC_API_URL || '/api';
      // First create user account
      const authRes = await fetch(`${API}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: form.full_name, email: form.email, phone: form.phone, password: form.password, role: 'provider', region: 'NG' }),
      });
      const authData = await authRes.json();
      if (!authRes.ok) throw new Error(authData.error || 'Account creation failed');

      // Then register as provider
      const provRes = await fetch(`${API}/ng/providers/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authData.accessToken}` },
        body: JSON.stringify({
          user_id: authData.user?.id,
          ...form,
          consult_fee_general: parseInt(form.consult_fee_general),
          consult_fee_specialist: parseInt(form.consult_fee_specialist),
          years_experience: parseInt(form.years_experience) || 0,
        }),
      });
      const provData = await provRes.json();
      if (!provRes.ok) throw new Error(provData.error || 'Provider registration failed');
      setSuccess(true);
      setTimeout(() => window.location.href = '/ng/provider/dashboard', 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (success) return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="bg-card border border-border rounded-3xl p-12 max-w-md w-full text-center space-y-4">
        <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle size={32} className="text-green-500" />
        </div>
        <h2 className="text-2xl font-bold text-foreground">Registration submitted!</h2>
        <p className="text-muted-foreground text-sm">Your provider profile is under review. We'll notify you via email once verified.</p>
        <p className="text-muted-foreground text-xs">Redirecting to dashboard…</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left */}
      <div className="hidden lg:flex flex-col justify-between w-2/5 bg-gradient-to-br from-blue-900 via-slate-900 to-indigo-950 p-12">
        <Link href="/ng" className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-green-600 rounded-xl flex items-center justify-center">
            <span className="text-white font-black text-sm">Rx</span>
          </div>
          <span className="text-white font-bold text-xl">DoctaRx <span className="text-green-400">NG</span></span>
        </Link>
        <div className="space-y-6">
          <h2 className="text-4xl font-bold text-white leading-tight">Join as a Nigerian healthcare provider</h2>
          <p className="text-slate-400">Reach more patients, manage consultations, write digital prescriptions, and track your earnings — all from one platform.</p>
          <div className="space-y-3">
            {[
              'MDCN-verified provider profile',
              'Digital prescription writing',
              'Video & audio consultations',
              'Earnings tracking & payouts',
              'Patient records management',
              'Lab referral management',
            ].map(item => (
              <div key={item} className="flex items-center gap-3 text-slate-300 text-sm">
                <CheckCircle size={16} className="text-blue-400 shrink-0" />{item}
              </div>
            ))}
          </div>
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4 text-sm text-blue-300">
            <strong>Provider subscription from ₦10,000/month.</strong>{' '}
            Earn per consultation with 10–15% platform commission.
          </div>
        </div>
        <div className="text-slate-500 text-xs">
          Already registered? <Link href="/ng/auth/login?role=provider" className="text-blue-400">Sign in</Link>
        </div>
      </div>

      {/* Right */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 overflow-y-auto">
        <div className="w-full max-w-lg">
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-8">
            {[1, 2, 3].map(s => (
              <div key={s} className={`flex-1 h-1.5 rounded-full ${s <= step ? 'bg-blue-500' : 'bg-border'}`} />
            ))}
          </div>

          {error && (
            <div className="mb-4 bg-red-500/10 border border-red-500/20 text-red-600 rounded-xl px-4 py-3 text-sm flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <form onSubmit={step < 3 ? (e) => { e.preventDefault(); setStep(s => s + 1); } : handleSubmit}>
            {/* Step 1: Account */}
            {step === 1 && (
              <div className="space-y-5">
                <div><h1 className="text-2xl font-bold text-foreground">Create your account</h1><p className="text-muted-foreground text-sm mt-1">Step 1 of 3 — Account Details</p></div>
                {[
                  { name: 'full_name', label: 'Full Name', icon: User, type: 'text', placeholder: 'Dr. Jane Doe', required: true },
                  { name: 'email', label: 'Email Address', icon: Mail, type: 'email', placeholder: 'you@email.com', required: true },
                  { name: 'phone', label: 'Phone Number', icon: Phone, type: 'tel', placeholder: '08012345678', required: true },
                ].map(field => {
                  const Icon = field.icon;
                  return (
                    <label key={field.name} className="block">
                      <span className="text-sm font-medium text-foreground block mb-1.5">{field.label} {field.required && '*'}</span>
                      <div className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3 focus-within:border-blue-500/50 focus-within:ring-1 focus-within:ring-blue-500/30 transition-all">
                        <Icon size={16} className="text-muted-foreground shrink-0" />
                        {field.name === 'phone' && <span className="text-muted-foreground text-sm">+234</span>}
                        <input name={field.name} type={field.type} value={form[field.name]} onChange={handleChange} required={field.required} placeholder={field.placeholder} className="flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground" />
                      </div>
                    </label>
                  );
                })}
                <label className="block">
                  <span className="text-sm font-medium text-foreground block mb-1.5">Password *</span>
                  <div className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3 focus-within:border-blue-500/50 transition-all">
                    <Lock size={16} className="text-muted-foreground shrink-0" />
                    <input name="password" type={showPwd ? 'text' : 'password'} value={form.password} onChange={handleChange} required minLength={8} placeholder="Min. 8 characters" className="flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground" />
                    <button type="button" onClick={() => setShowPwd(v => !v)} className="text-muted-foreground">{showPwd ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                  </div>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-foreground block mb-1.5">Confirm Password *</span>
                  <div className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3 focus-within:border-blue-500/50 transition-all">
                    <Lock size={16} className="text-muted-foreground shrink-0" />
                    <input name="confirm_password" type={showPwd ? 'text' : 'password'} value={form.confirm_password} onChange={handleChange} required placeholder="Repeat password" className="flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground" />
                  </div>
                </label>
                <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white h-12 rounded-2xl font-bold">Continue <ArrowRight className="ml-2 w-4 h-4" /></Button>
              </div>
            )}

            {/* Step 2: Professional */}
            {step === 2 && (
              <div className="space-y-5">
                <div className="flex items-center gap-3 mb-2">
                  <button type="button" onClick={() => setStep(1)} className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center"><ChevronLeft size={16} /></button>
                  <div><h1 className="text-2xl font-bold text-foreground">Professional Details</h1><p className="text-muted-foreground text-sm">Step 2 of 3 — Credentials & Specialty</p></div>
                </div>
                <label className="block">
                  <span className="text-sm font-medium text-foreground block mb-1.5">MDCN Folio Number *</span>
                  <div className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3 focus-within:border-blue-500/50 transition-all">
                    <Award size={16} className="text-muted-foreground shrink-0" />
                    <input name="mdcn_number" value={form.mdcn_number} onChange={handleChange} required placeholder="e.g., 123456" className="flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Your Medical and Dental Council of Nigeria registration number.</p>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-foreground block mb-1.5">Specialty *</span>
                  <select name="specialty" value={form.specialty} onChange={handleChange} required className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none focus:border-blue-500/50">
                    {SPECIALTIES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-foreground block mb-1.5">Sub-Specialty (optional)</span>
                  <input name="sub_specialty" value={form.sub_specialty} onChange={handleChange} placeholder="e.g., Diabetologist" className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none" />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-sm font-medium text-foreground block mb-1.5">Years Experience</span>
                    <input name="years_experience" type="number" min="0" max="60" value={form.years_experience} onChange={handleChange} placeholder="e.g., 5" className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-foreground block mb-1.5">Gender</span>
                    <select name="gender" value={form.gender} onChange={handleChange} className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none">
                      <option value="">Select</option>
                      <option>Male</option><option>Female</option><option>Prefer not to say</option>
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-sm font-medium text-foreground block mb-1.5">General Consult Fee (₦)</span>
                    <input name="consult_fee_general" type="number" min="1000" value={form.consult_fee_general} onChange={handleChange} className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-foreground block mb-1.5">Specialist Consult Fee (₦)</span>
                    <input name="consult_fee_specialist" type="number" min="1000" value={form.consult_fee_specialist} onChange={handleChange} className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none" />
                  </label>
                </div>
                <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white h-12 rounded-2xl font-bold">Continue <ArrowRight className="ml-2 w-4 h-4" /></Button>
              </div>
            )}

            {/* Step 3: Practice */}
            {step === 3 && (
              <div className="space-y-5">
                <div className="flex items-center gap-3 mb-2">
                  <button type="button" onClick={() => setStep(2)} className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center"><ChevronLeft size={16} /></button>
                  <div><h1 className="text-2xl font-bold text-foreground">Practice Details</h1><p className="text-muted-foreground text-sm">Step 3 of 3 — Location & Bio</p></div>
                </div>
                {[
                  { name: 'practice_name', label: 'Practice/Hospital Name', placeholder: 'e.g., Lagos General Hospital' },
                  { name: 'practice_address', label: 'Practice Address', placeholder: 'Street address' },
                  { name: 'practice_city', label: 'City', placeholder: 'e.g., Lagos' },
                ].map(field => (
                  <label key={field.name} className="block">
                    <span className="text-sm font-medium text-foreground block mb-1.5">{field.label}</span>
                    <input name={field.name} value={form[field.name]} onChange={handleChange} placeholder={field.placeholder} className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none focus:border-blue-500/50" />
                  </label>
                ))}
                <label className="block">
                  <span className="text-sm font-medium text-foreground block mb-1.5">State</span>
                  <select name="practice_state" value={form.practice_state} onChange={handleChange} className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none">
                    <option value="">Select state</option>
                    {NG_STATES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-foreground block mb-1.5">Professional Bio</span>
                  <textarea name="bio" value={form.bio} onChange={handleChange} rows={4} placeholder="Briefly describe your expertise, experience, and approach to patient care…" className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none resize-none focus:border-blue-500/50" />
                </label>
                <p className="text-xs text-muted-foreground">By submitting you agree to our <Link href="/terms" className="text-blue-500 hover:underline">Terms</Link> and the DoctaRx Provider Agreement.</p>
                <Button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-500 text-white h-12 rounded-2xl font-bold">
                  {loading ? 'Submitting…' : 'Submit for Verification'}
                </Button>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
