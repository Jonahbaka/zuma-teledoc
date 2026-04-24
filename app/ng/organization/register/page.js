'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Users, CheckCircle, ArrowRight, ChevronLeft,
  Building2, Mail, Phone, MapPin, FileText,
  Globe, AlertCircle, ChevronRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NG_STATES, ORG_TYPES } from '../../lib/ngUtils';

export default function OrgRegisterPage() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [form, setForm] = useState({
    name: '', type: 'company',
    admin_name: '', admin_email: '', admin_phone: '', admin_title: '',
    address_line1: '', city: '', state: '', lga: '',
    email: '', phone: '', website: '', rc_number: '', tax_id: '',
    description: '',
  });

  const handleChange = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const API = process.env.NEXT_PUBLIC_API_URL || '/api';
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`${API}/ng/organizations/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ ...form, user_id: null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');
      setSuccess(true);
      setTimeout(() => window.location.href = '/ng/organization/dashboard', 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (success) return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="bg-card border border-border rounded-3xl p-12 max-w-md w-full text-center space-y-4">
        <div className="w-16 h-16 bg-indigo-500/10 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle size={32} className="text-indigo-500" />
        </div>
        <h2 className="text-2xl font-bold text-foreground">Organisation registered!</h2>
        <p className="text-muted-foreground text-sm">Your registration is under review. We'll notify you by email once verified.</p>
        <p className="text-muted-foreground text-xs">Redirecting to dashboard…</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left panel */}
      <div className="hidden lg:flex flex-col justify-between w-2/5 bg-gradient-to-br from-indigo-900 via-slate-900 to-purple-950 p-12">
        <Link href="/ng" className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-green-600 rounded-xl flex items-center justify-center">
            <span className="text-white font-black text-sm">Rx</span>
          </div>
          <span className="text-white font-bold text-xl">DoctaRx <span className="text-green-400">NG</span></span>
        </Link>
        <div className="space-y-6">
          <h2 className="text-4xl font-bold text-white leading-tight">Healthcare for your entire organisation</h2>
          <p className="text-slate-400">Whether you're a company, church, school, or NGO — give your members access to quality healthcare with DoctaRx Nigeria corporate plans.</p>
          <div className="space-y-3">
            {[
              'Starter: ₦40,000/month (up to 25 members)',
              'Growth: ₦120,000/month (up to 100 members)',
              'Enterprise: Custom pricing & SLA',
              'Per-member pricing from ₦1,000/member/month',
              'Bulk CSV member upload',
              'Monthly or annual billing',
            ].map(item => (
              <div key={item} className="flex items-center gap-3 text-slate-300 text-sm">
                <CheckCircle size={16} className="text-indigo-400 shrink-0" />{item}
              </div>
            ))}
          </div>
          <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-2xl p-4 text-sm text-indigo-300">
            <strong>Supported organisations:</strong> Companies, churches, mosques, NGOs, schools, government bodies, associations, hospitals & cooperatives.
          </div>
        </div>
        <div className="text-slate-500 text-xs">
          Already registered? <Link href="/ng/auth/login?role=organization" className="text-indigo-400">Sign in</Link>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 overflow-y-auto">
        <div className="w-full max-w-lg">
          <div className="flex items-center gap-2 mb-6">
            {[1, 2].map(s => (
              <div key={s} className={`flex-1 h-1.5 rounded-full ${s <= step ? 'bg-indigo-500' : 'bg-border'}`} />
            ))}
          </div>

          {error && (
            <div className="mb-4 bg-red-500/10 border border-red-500/20 text-red-600 rounded-xl px-4 py-3 text-sm flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <form onSubmit={step < 2 ? (e) => { e.preventDefault(); setStep(2); } : handleSubmit}>
            {step === 1 && (
              <div className="space-y-5">
                <div>
                  <h1 className="text-2xl font-bold text-foreground">Register Your Organisation</h1>
                  <p className="text-muted-foreground text-sm mt-1">Step 1 of 2 — Organisation Details</p>
                </div>

                <label className="block">
                  <span className="text-sm font-medium text-foreground block mb-1.5">Organisation Name *</span>
                  <div className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3 focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/30 transition-all">
                    <Building2 size={16} className="text-muted-foreground shrink-0" />
                    <input name="name" value={form.name} onChange={handleChange} required placeholder="e.g., Dangote Group" className="flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground" />
                  </div>
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-foreground block mb-1.5">Organisation Type *</span>
                  <select name="type" value={form.type} onChange={handleChange} required className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none focus:border-indigo-500/50">
                    {ORG_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-foreground block mb-1.5">Admin / Contact Name *</span>
                  <div className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3 focus-within:border-indigo-500/50 transition-all">
                    <Users size={16} className="text-muted-foreground shrink-0" />
                    <input name="admin_name" value={form.admin_name} onChange={handleChange} required placeholder="Full name of the person managing this account" className="flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground" />
                  </div>
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-foreground block mb-1.5">Admin Title (optional)</span>
                  <input name="admin_title" value={form.admin_title} onChange={handleChange} placeholder="e.g., HR Manager, Executive Director" className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none" />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-sm font-medium text-foreground block mb-1.5">Admin Email *</span>
                    <div className="flex items-center gap-2 bg-card border border-border rounded-xl px-3 py-3 focus-within:border-indigo-500/50 transition-all">
                      <Mail size={14} className="text-muted-foreground shrink-0" />
                      <input name="admin_email" type="email" value={form.admin_email} onChange={handleChange} required placeholder="admin@org.com" className="flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground" />
                    </div>
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-foreground block mb-1.5">Admin Phone *</span>
                    <div className="flex items-center gap-2 bg-card border border-border rounded-xl px-3 py-3 focus-within:border-indigo-500/50 transition-all">
                      <Phone size={14} className="text-muted-foreground shrink-0" />
                      <input name="admin_phone" type="tel" value={form.admin_phone} onChange={handleChange} required placeholder="080XXXXXXXX" className="flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground" />
                    </div>
                  </label>
                </div>

                <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-500 text-white h-12 rounded-2xl font-bold">
                  Continue <ArrowRight className="ml-2 w-4 h-4" />
                </Button>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5">
                <div className="flex items-center gap-3 mb-2">
                  <button type="button" onClick={() => setStep(1)} className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center"><ChevronLeft size={16} /></button>
                  <div>
                    <h1 className="text-2xl font-bold text-foreground">Location & Details</h1>
                    <p className="text-muted-foreground text-sm">Step 2 of 2</p>
                  </div>
                </div>

                <label className="block">
                  <span className="text-sm font-medium text-foreground block mb-1.5">Office Address</span>
                  <input name="address_line1" value={form.address_line1} onChange={handleChange} placeholder="Street address" className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none" />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-sm font-medium text-foreground block mb-1.5">City</span>
                    <input name="city" value={form.city} onChange={handleChange} placeholder="e.g., Lagos" className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-foreground block mb-1.5">State</span>
                    <select name="state" value={form.state} onChange={handleChange} className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none">
                      <option value="">Select state</option>
                      {NG_STATES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-sm font-medium text-foreground block mb-1.5">Organisation Email</span>
                    <input name="email" type="email" value={form.email} onChange={handleChange} placeholder="info@org.com" className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-foreground block mb-1.5">Organisation Phone</span>
                    <input name="phone" type="tel" value={form.phone} onChange={handleChange} placeholder="01XXXXXXXX" className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none" />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-sm font-medium text-foreground block mb-1.5">CAC / RC Number</span>
                    <input name="rc_number" value={form.rc_number} onChange={handleChange} placeholder="RC 123456" className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-foreground block mb-1.5">Website (optional)</span>
                    <div className="flex items-center gap-2 bg-card border border-border rounded-xl px-3 py-3">
                      <Globe size={14} className="text-muted-foreground shrink-0" />
                      <input name="website" value={form.website} onChange={handleChange} placeholder="www.org.com" className="flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground" />
                    </div>
                  </label>
                </div>

                <label className="block">
                  <span className="text-sm font-medium text-foreground block mb-1.5">Description (optional)</span>
                  <textarea name="description" value={form.description} onChange={handleChange} rows={3} placeholder="Brief description of your organisation and its healthcare needs…" className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none resize-none" />
                </label>

                <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-2xl p-4 text-sm text-indigo-700 dark:text-indigo-300">
                  After registration, you'll select your plan and add members. An account manager will contact you within 1 business day.
                </div>

                <Button type="submit" disabled={loading} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white h-12 rounded-2xl font-bold">
                  {loading ? 'Registering…' : 'Register Organisation'}
                </Button>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
