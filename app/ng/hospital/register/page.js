'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Hospital, CheckCircle, ArrowRight, ChevronLeft,
  Building2, Mail, Phone, MapPin, FileText,
  Users, AlertCircle, Plus, X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NG_STATES, FACILITY_TYPES } from '../../lib/ngUtils';

export default function HospitalRegisterPage() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [departments, setDepartments] = useState(['General Medicine', 'Emergency']);
  const [deptInput, setDeptInput] = useState('');
  const [form, setForm] = useState({
    name: '', facility_type: 'Private Clinic',
    contact_name: '', contact_email: '', contact_phone: '', contact_title: '',
    address_line1: '', address_line2: '', city: '', state: '', lga: '',
    phone: '', email: '', website: '',
    nhis_code: '', cac_number: '', facility_license_number: '', license_expiry: '',
    bed_count: '', has_pharmacy: false, has_lab: false,
    description: '',
  });

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm(f => ({ ...f, [name]: type === 'checkbox' ? checked : value }));
  };

  const addDept = () => {
    if (deptInput.trim() && !departments.includes(deptInput.trim())) {
      setDepartments(d => [...d, deptInput.trim()]);
      setDeptInput('');
    }
  };

  const removeDept = (dept) => setDepartments(d => d.filter(x => x !== dept));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const API = process.env.NEXT_PUBLIC_API_URL || '/api';
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`${API}/ng/hospitals/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ ...form, departments, bed_count: form.bed_count ? parseInt(form.bed_count) : null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');
      setSuccess(true);
      setTimeout(() => window.location.href = '/ng/hospital/dashboard', 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (success) return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="bg-card border border-border rounded-3xl p-12 max-w-md w-full text-center space-y-4">
        <div className="w-16 h-16 bg-rose-500/10 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle size={32} className="text-rose-500" />
        </div>
        <h2 className="text-2xl font-bold text-foreground">Hospital registered!</h2>
        <p className="text-muted-foreground text-sm">Your facility is under review. We'll notify you once verified. This typically takes 2–5 business days.</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left */}
      <div className="hidden lg:flex flex-col justify-between w-2/5 bg-gradient-to-br from-rose-900 via-slate-900 to-red-950 p-12">
        <Link href="/ng" className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-green-600 rounded-xl flex items-center justify-center">
            <span className="text-white font-black text-sm">Rx</span>
          </div>
          <span className="text-white font-bold text-xl">DoctaRx <span className="text-green-400">NG</span></span>
        </Link>
        <div className="space-y-6">
          <h2 className="text-4xl font-bold text-white leading-tight">Register your hospital or clinic on DoctaRx</h2>
          <p className="text-slate-400">Onboard your facility, manage staff, handle digital referrals, and prepare for the future of healthcare interoperability in Nigeria.</p>
          <div className="space-y-3">
            {[
              'Facility profile & verification',
              'Staff & department management',
              'Digital referral management',
              'Featured listing in provider directory',
              'FHIR R4 interoperability (coming soon)',
              'NHIA & HMO integration (coming soon)',
            ].map(item => (
              <div key={item} className="flex items-center gap-3 text-slate-300 text-sm">
                <CheckCircle size={16} className="text-rose-400 shrink-0" />{item}
              </div>
            ))}
          </div>
        </div>
        <div className="text-slate-500 text-xs">
          Already registered? <Link href="/ng/auth/login?role=hospital" className="text-rose-400">Sign in</Link>
        </div>
      </div>

      {/* Right */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 overflow-y-auto">
        <div className="w-full max-w-lg">
          <div className="flex items-center gap-2 mb-6">
            {[1, 2, 3].map(s => (
              <div key={s} className={`flex-1 h-1.5 rounded-full ${s <= step ? 'bg-rose-500' : 'bg-border'}`} />
            ))}
          </div>

          {error && (
            <div className="mb-4 bg-red-500/10 border border-red-500/20 text-red-600 rounded-xl px-4 py-3 text-sm flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <form onSubmit={step < 3 ? (e) => { e.preventDefault(); setStep(s => s + 1); } : handleSubmit}>
            {/* Step 1: Facility basics */}
            {step === 1 && (
              <div className="space-y-5">
                <div><h1 className="text-2xl font-bold text-foreground">Facility Details</h1><p className="text-muted-foreground text-sm mt-1">Step 1 of 3 — Basic Information</p></div>

                <label className="block">
                  <span className="text-sm font-medium text-foreground block mb-1.5">Facility Name *</span>
                  <div className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3 focus-within:border-rose-500/50 transition-all">
                    <Hospital size={16} className="text-muted-foreground shrink-0" />
                    <input name="name" value={form.name} onChange={handleChange} required placeholder="e.g., Lagos Island General Hospital" className="flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground" />
                  </div>
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-foreground block mb-1.5">Facility Type *</span>
                  <select name="facility_type" value={form.facility_type} onChange={handleChange} required className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none focus:border-rose-500/50">
                    {FACILITY_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-foreground block mb-1.5">Contact Person Name *</span>
                  <input name="contact_name" value={form.contact_name} onChange={handleChange} required placeholder="Full name" className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none" />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-foreground block mb-1.5">Contact Title</span>
                  <input name="contact_title" value={form.contact_title} onChange={handleChange} placeholder="e.g., Medical Director, Administrator" className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none" />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-sm font-medium text-foreground block mb-1.5">Contact Email *</span>
                    <input name="contact_email" type="email" value={form.contact_email} onChange={handleChange} required placeholder="contact@hospital.ng" className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-foreground block mb-1.5">Contact Phone *</span>
                    <input name="contact_phone" type="tel" value={form.contact_phone} onChange={handleChange} required placeholder="080XXXXXXXX" className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none" />
                  </label>
                </div>

                <Button type="submit" className="w-full bg-rose-600 hover:bg-rose-500 text-white h-12 rounded-2xl font-bold">Continue <ArrowRight className="ml-2 w-4 h-4" /></Button>
              </div>
            )}

            {/* Step 2: Location */}
            {step === 2 && (
              <div className="space-y-5">
                <div className="flex items-center gap-3 mb-2">
                  <button type="button" onClick={() => setStep(1)} className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center"><ChevronLeft size={16} /></button>
                  <div><h1 className="text-2xl font-bold text-foreground">Location Details</h1><p className="text-muted-foreground text-sm">Step 2 of 3</p></div>
                </div>

                <label className="block">
                  <span className="text-sm font-medium text-foreground block mb-1.5">Address *</span>
                  <input name="address_line1" value={form.address_line1} onChange={handleChange} required placeholder="Street address" className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none" />
                </label>
                <input name="address_line2" value={form.address_line2} onChange={handleChange} placeholder="Suite / Floor (optional)" className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none" />

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-sm font-medium text-foreground block mb-1.5">City *</span>
                    <input name="city" value={form.city} onChange={handleChange} required placeholder="e.g., Lagos" className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-foreground block mb-1.5">State *</span>
                    <select name="state" value={form.state} onChange={handleChange} required className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none">
                      <option value="">Select state</option>
                      {NG_STATES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </label>
                </div>

                <label className="block">
                  <span className="text-sm font-medium text-foreground block mb-1.5">LGA (Local Government Area)</span>
                  <input name="lga" value={form.lga} onChange={handleChange} placeholder="e.g., Ikeja" className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none" />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-sm font-medium text-foreground block mb-1.5">Facility Phone</span>
                    <input name="phone" type="tel" value={form.phone} onChange={handleChange} placeholder="01XXXXXXXX" className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-foreground block mb-1.5">Facility Email</span>
                    <input name="email" type="email" value={form.email} onChange={handleChange} placeholder="info@hospital.ng" className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none" />
                  </label>
                </div>

                <Button type="submit" className="w-full bg-rose-600 hover:bg-rose-500 text-white h-12 rounded-2xl font-bold">Continue <ArrowRight className="ml-2 w-4 h-4" /></Button>
              </div>
            )}

            {/* Step 3: Licensing & Departments */}
            {step === 3 && (
              <div className="space-y-5">
                <div className="flex items-center gap-3 mb-2">
                  <button type="button" onClick={() => setStep(2)} className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center"><ChevronLeft size={16} /></button>
                  <div><h1 className="text-2xl font-bold text-foreground">Licensing & Departments</h1><p className="text-muted-foreground text-sm">Step 3 of 3</p></div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-sm font-medium text-foreground block mb-1.5">NHIS Code</span>
                    <input name="nhis_code" value={form.nhis_code} onChange={handleChange} placeholder="e.g., NHIS12345" className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-foreground block mb-1.5">CAC Number</span>
                    <input name="cac_number" value={form.cac_number} onChange={handleChange} placeholder="RC 123456" className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none" />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-sm font-medium text-foreground block mb-1.5">License Number</span>
                    <input name="facility_license_number" value={form.facility_license_number} onChange={handleChange} placeholder="License #" className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-foreground block mb-1.5">License Expiry</span>
                    <input name="license_expiry" type="date" value={form.license_expiry} onChange={handleChange} className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none" />
                  </label>
                </div>

                <label className="block">
                  <span className="text-sm font-medium text-foreground block mb-1.5">Number of Beds</span>
                  <input name="bed_count" type="number" min="0" value={form.bed_count} onChange={handleChange} placeholder="e.g., 50" className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none" />
                </label>

                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" name="has_pharmacy" checked={form.has_pharmacy} onChange={handleChange} className="w-4 h-4 rounded accent-rose-500" />
                    <span className="text-sm text-foreground">Has Pharmacy</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" name="has_lab" checked={form.has_lab} onChange={handleChange} className="w-4 h-4 rounded accent-rose-500" />
                    <span className="text-sm text-foreground">Has Laboratory</span>
                  </label>
                </div>

                {/* Departments */}
                <div>
                  <span className="text-sm font-medium text-foreground block mb-2">Departments</span>
                  <div className="flex gap-2 mb-2">
                    <input value={deptInput} onChange={e => setDeptInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDept(); } }} placeholder="Add department…" className="flex-1 bg-card border border-border rounded-xl px-4 py-2.5 text-foreground text-sm outline-none" />
                    <Button type="button" onClick={addDept} variant="outline" size="sm" className="rounded-xl"><Plus size={16} /></Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {departments.map(dept => (
                      <span key={dept} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/10 text-rose-600 border border-rose-500/20 text-xs font-medium">
                        {dept}
                        <button type="button" onClick={() => removeDept(dept)} className="hover:opacity-70"><X size={11} /></button>
                      </span>
                    ))}
                  </div>
                </div>

                <label className="block">
                  <span className="text-sm font-medium text-foreground block mb-1.5">Description (optional)</span>
                  <textarea name="description" value={form.description} onChange={handleChange} rows={3} placeholder="Brief description of your facility…" className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground text-sm outline-none resize-none" />
                </label>

                <Button type="submit" disabled={loading} className="w-full bg-rose-600 hover:bg-rose-500 text-white h-12 rounded-2xl font-bold">
                  {loading ? 'Submitting…' : 'Register Hospital / Clinic'}
                </Button>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
