'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ChevronLeft, User, Stethoscope, CreditCard,
  AlertCircle, CheckCircle, MapPin, Clock
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import NgNav from '../../components/NgNav';
import { NG_STATES } from '../../lib/ngUtils';

const SPECIALTIES = [
  'general_practice','internal_medicine','pediatrics','obstetrics_gynecology',
  'surgery','orthopedics','cardiology','dermatology','psychiatry','neurology',
  'ophthalmology','ent','urology','oncology','radiology','anesthesiology',
  'emergency_medicine','family_medicine','geriatrics','pathology',
];

const BANKS = [
  'Access Bank','First Bank','GTBank','Zenith Bank','UBA','Fidelity Bank',
  'Stanbic IBTC','Sterling Bank','Union Bank','Wema Bank','Polaris Bank','FCMB',
];

export default function ProviderProfile() {
  const [form, setForm] = useState({
    full_name: '', phone: '', email: '', specialty: '', sub_specialty: '',
    years_experience: '', mdcn_number: '', consultation_fee: '', bio: '',
    practice_name: '', practice_address: '', practice_city: '', practice_state: '',
    bank_name: '', account_number: '', account_name: '',
    available_from: '', available_to: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('profile');

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    const providerId = localStorage.getItem('ng_provider_id');
    if (!token || !providerId) { setLoading(false); return; }
    fetch(`/api/ng/providers/profile/${providerId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (d.provider) setForm(p => ({ ...p, ...d.provider })); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setSaving(true);
    try {
      const token = localStorage.getItem('accessToken');
      const providerId = localStorage.getItem('ng_provider_id');
      const res = await fetch(`/api/ng/providers/profile/${providerId}`, {
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
          <Link href="/ng/provider/dashboard" className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center"><ChevronLeft size={16} /></Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">My Profile</h1>
            <p className="text-muted-foreground text-sm">Update your professional details, availability and bank info</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-accent rounded-xl p-1 w-fit">
          {['profile', 'availability', 'bank'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-all ${tab === t ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
              {t === 'bank' ? 'Bank Details' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {success && (
          <div className="bg-green-500/10 border border-green-500/20 text-green-600 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
            <CheckCircle size={16} /> Changes saved successfully.
          </div>
        )}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-600 rounded-xl px-4 py-3 text-sm flex items-start gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {tab === 'profile' && (
            <>
              <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
                <h3 className="font-bold text-foreground text-sm flex items-center gap-2"><User size={15} className="text-blue-500" /> Personal</h3>
                <div className="grid sm:grid-cols-2 gap-3">
                  <label>
                    <span className="text-xs text-muted-foreground block mb-1">Full Name *</span>
                    <input name="full_name" value={form.full_name} onChange={handleChange} required className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none" />
                  </label>
                  <label>
                    <span className="text-xs text-muted-foreground block mb-1">Phone</span>
                    <input name="phone" value={form.phone} onChange={handleChange} className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none" />
                  </label>
                </div>
                <label>
                  <span className="text-xs text-muted-foreground block mb-1">Bio / Professional Summary</span>
                  <textarea name="bio" value={form.bio} onChange={handleChange} rows={3}
                    placeholder="Describe your experience, specialisations, and approach to patient care…"
                    className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none resize-none" />
                </label>
              </div>

              <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
                <h3 className="font-bold text-foreground text-sm flex items-center gap-2"><Stethoscope size={15} className="text-blue-500" /> Professional</h3>
                <div className="grid sm:grid-cols-2 gap-3">
                  <label>
                    <span className="text-xs text-muted-foreground block mb-1">Specialty</span>
                    <select name="specialty" value={form.specialty} onChange={handleChange}
                      className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none">
                      <option value="">Select specialty</option>
                      {SPECIALTIES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
                    </select>
                  </label>
                  <label>
                    <span className="text-xs text-muted-foreground block mb-1">MDCN Number</span>
                    <input name="mdcn_number" value={form.mdcn_number} onChange={handleChange}
                      className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none" />
                  </label>
                  <label>
                    <span className="text-xs text-muted-foreground block mb-1">Years Experience</span>
                    <input name="years_experience" type="number" min="0" max="60" value={form.years_experience} onChange={handleChange}
                      className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none" />
                  </label>
                  <label>
                    <span className="text-xs text-muted-foreground block mb-1">Consultation Fee (₦)</span>
                    <input name="consultation_fee" type="number" min="0" value={form.consultation_fee} onChange={handleChange}
                      placeholder="e.g. 5000" className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none" />
                  </label>
                </div>
              </div>
            </>
          )}

          {tab === 'availability' && (
            <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
              <h3 className="font-bold text-foreground text-sm flex items-center gap-2"><Clock size={15} className="text-blue-500" /> Working Hours</h3>
              <p className="text-xs text-muted-foreground">Set your daily availability window. Full scheduling will be available in a future update.</p>
              <div className="grid sm:grid-cols-2 gap-3">
                <label>
                  <span className="text-xs text-muted-foreground block mb-1">Available From</span>
                  <input name="available_from" type="time" value={form.available_from} onChange={handleChange}
                    className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none" />
                </label>
                <label>
                  <span className="text-xs text-muted-foreground block mb-1">Available Until</span>
                  <input name="available_to" type="time" value={form.available_to} onChange={handleChange}
                    className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none" />
                </label>
              </div>
            </div>
          )}

          {tab === 'bank' && (
            <div id="bank" className="bg-card border border-border rounded-2xl p-6 space-y-4">
              <h3 className="font-bold text-foreground text-sm flex items-center gap-2"><CreditCard size={15} className="text-blue-500" /> Payout Account</h3>
              <p className="text-xs text-muted-foreground">Earnings will be paid to this account every Friday.</p>
              <div className="space-y-3">
                <label>
                  <span className="text-xs text-muted-foreground block mb-1">Bank Name</span>
                  <select name="bank_name" value={form.bank_name} onChange={handleChange}
                    className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none">
                    <option value="">Select bank</option>
                    {BANKS.map(b => <option key={b}>{b}</option>)}
                  </select>
                </label>
                <label>
                  <span className="text-xs text-muted-foreground block mb-1">Account Number</span>
                  <input name="account_number" value={form.account_number} onChange={handleChange}
                    placeholder="10-digit account number" maxLength={10}
                    className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none" />
                </label>
                <label>
                  <span className="text-xs text-muted-foreground block mb-1">Account Name</span>
                  <input name="account_name" value={form.account_name} onChange={handleChange}
                    placeholder="Name as registered with bank"
                    className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none" />
                </label>
              </div>
            </div>
          )}

          <Button type="submit" disabled={saving} className="w-full bg-blue-600 hover:bg-blue-500 text-white h-12 rounded-2xl font-bold">
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </form>
      </div>
    </div>
  );
}
