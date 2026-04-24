'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronLeft, User, Phone, Mail, MapPin, AlertCircle, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import NgNav from '../../components/NgNav';
import { NG_STATES } from '../../lib/ngUtils';

export default function PatientProfile() {
  const [form, setForm] = useState({ full_name: '', phone: '', email: '', dob: '', gender: '', blood_group: '', address: '', state: '', allergies: '', emergency_name: '', emergency_phone: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) { setLoading(false); return; }
    fetch('/api/ng/patients/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (d.patient) setForm(p => ({ ...p, ...d.patient })); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setSaving(true);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch('/api/ng/patients/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <NgNav />
      <div className="pt-14 max-w-2xl mx-auto px-6 py-8 space-y-6">

        <div className="flex items-center gap-3">
          <Link href="/ng/patient/dashboard" className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center"><ChevronLeft size={16} /></Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">My Profile</h1>
            <p className="text-muted-foreground text-sm">Update your personal and medical information</p>
          </div>
        </div>

        {success && (
          <div className="bg-green-500/10 border border-green-500/20 text-green-600 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
            <CheckCircle size={16} /> Profile updated successfully.
          </div>
        )}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-600 rounded-xl px-4 py-3 text-sm flex items-start gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
            <h3 className="font-bold text-foreground text-sm flex items-center gap-2"><User size={15} className="text-green-500" /> Personal Info</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <label>
                <span className="text-xs text-muted-foreground block mb-1">Full Name *</span>
                <input name="full_name" value={form.full_name} onChange={handleChange} required placeholder="Your full name"
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none" />
              </label>
              <label>
                <span className="text-xs text-muted-foreground block mb-1">Phone *</span>
                <input name="phone" value={form.phone} onChange={handleChange} required placeholder="080XXXXXXXX"
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none" />
              </label>
              <label>
                <span className="text-xs text-muted-foreground block mb-1">Email</span>
                <input name="email" type="email" value={form.email} onChange={handleChange} placeholder="you@email.com"
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none" />
              </label>
              <label>
                <span className="text-xs text-muted-foreground block mb-1">Date of Birth</span>
                <input name="dob" type="date" value={form.dob} onChange={handleChange}
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none" />
              </label>
              <label>
                <span className="text-xs text-muted-foreground block mb-1">Gender</span>
                <select name="gender" value={form.gender} onChange={handleChange}
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none">
                  <option value="">Select</option>
                  <option>Male</option><option>Female</option><option>Other</option><option>Prefer not to say</option>
                </select>
              </label>
              <label>
                <span className="text-xs text-muted-foreground block mb-1">Blood Group</span>
                <select name="blood_group" value={form.blood_group} onChange={handleChange}
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none">
                  <option value="">Select</option>
                  {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(g => <option key={g}>{g}</option>)}
                </select>
              </label>
            </div>
            <label>
              <span className="text-xs text-muted-foreground block mb-1">State of Residence</span>
              <select name="state" value={form.state} onChange={handleChange}
                className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none">
                <option value="">Select state</option>
                {NG_STATES.map(s => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label>
              <span className="text-xs text-muted-foreground block mb-1">Known Allergies</span>
              <input name="allergies" value={form.allergies} onChange={handleChange} placeholder="e.g., Penicillin, Sulfa drugs, Peanuts — or 'None'"
                className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none" />
            </label>
          </div>

          <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
            <h3 className="font-bold text-foreground text-sm flex items-center gap-2"><Phone size={15} className="text-green-500" /> Emergency Contact</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <label>
                <span className="text-xs text-muted-foreground block mb-1">Contact Name</span>
                <input name="emergency_name" value={form.emergency_name} onChange={handleChange} placeholder="e.g., Adaeze Okafor"
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none" />
              </label>
              <label>
                <span className="text-xs text-muted-foreground block mb-1">Contact Phone</span>
                <input name="emergency_phone" value={form.emergency_phone} onChange={handleChange} placeholder="080XXXXXXXX"
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none" />
              </label>
            </div>
          </div>

          <Button type="submit" disabled={saving} className="w-full bg-green-600 hover:bg-green-500 text-white h-12 rounded-2xl font-bold">
            {saving ? 'Saving…' : 'Save Profile'}
          </Button>
        </form>
      </div>
    </div>
  );
}
