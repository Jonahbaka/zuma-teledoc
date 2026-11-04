'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ChevronLeft, Users, Plus, Search, Stethoscope,
  Phone, Mail, CheckCircle, AlertCircle, X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import NgNav from '../../components/NgNav';

const ROLES = ['doctor', 'nurse', 'pharmacist', 'lab_scientist', 'admin', 'receptionist', 'other'];

export default function HospitalStaff() {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', role: 'doctor', specialty: '', mdcn_number: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const hospitalId = typeof window !== 'undefined' ? localStorage.getItem('ng_hospital_id') : null;
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

  useEffect(() => {
    if (!hospitalId || !token) { setLoading(false); return; }
    fetch(`/api/ng/hospitals/${hospitalId}/staff`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setStaff(d.staff || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    setError(''); setSubmitting(true);
    try {
      const res = await fetch(`/api/ng/hospitals/${hospitalId}/staff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add staff');
      setStaff(s => [data.staff, ...s]);
      setSuccess(true);
      setShowModal(false);
      setForm({ full_name: '', email: '', phone: '', role: 'doctor', specialty: '', mdcn_number: '' });
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = staff.filter(s =>
    s.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    s.role?.toLowerCase().includes(search.toLowerCase())
  );

  const roleBadge = (r) => ({
    doctor: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    nurse: 'bg-green-500/10 text-green-600 border-green-500/20',
    pharmacist: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
    lab_scientist: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    admin: 'bg-slate-500/10 text-slate-600 border-slate-500/20',
  }[r] || 'bg-muted text-muted-foreground border-border');

  return (
    <div className="min-h-screen bg-background text-foreground">
      <NgNav />
      <div className="pt-14 max-w-4xl mx-auto px-6 py-8 space-y-6">

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/ng/hospital/dashboard" className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center"><ChevronLeft size={16} /></Link>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Staff Management</h1>
              <p className="text-muted-foreground text-sm">Manage your facility's clinical and administrative team</p>
            </div>
          </div>
          <Button onClick={() => setShowModal(true)} className="bg-purple-600 hover:bg-purple-500 text-white">
            <Plus size={16} className="mr-1.5" /> Add Staff
          </Button>
        </div>

        {success && (
          <div className="bg-green-500/10 border border-green-500/20 text-green-600 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
            <CheckCircle size={16} /> Staff member added successfully.
          </div>
        )}

        {/* Search */}
        <div className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-2.5">
          <Search size={16} className="text-muted-foreground shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search staff by name or role…"
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
        </div>

        {/* Staff list */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <h3 className="font-bold text-foreground">Team ({filtered.length})</h3>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">{search ? 'No staff match your search.' : 'No staff added yet.'}</p>
              {!search && <button onClick={() => setShowModal(true)} className="text-purple-500 text-sm mt-2 hover:underline">Add your first team member →</button>}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map(s => (
                <div key={s.id} className="px-6 py-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-purple-500/10 rounded-full flex items-center justify-center shrink-0">
                      <Stethoscope size={14} className="text-purple-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{s.full_name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {s.email && <span className="text-xs text-muted-foreground flex items-center gap-1"><Mail size={10} />{s.email}</span>}
                        {s.phone && <span className="text-xs text-muted-foreground flex items-center gap-1"><Phone size={10} />{s.phone}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold capitalize ${roleBadge(s.role)}`}>{s.role?.replace(/_/g, ' ')}</span>
                    {s.specialty && <p className="text-xs text-muted-foreground mt-1">{s.specialty}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add staff modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="font-bold text-foreground">Add Staff Member</h3>
              <button onClick={() => setShowModal(false)} className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center">
                <X size={14} />
              </button>
            </div>
            <form onSubmit={handleAdd} className="p-6 space-y-4">
              {error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-600 rounded-xl px-4 py-3 text-sm flex items-start gap-2">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" /> {error}
                </div>
              )}
              <label>
                <span className="text-xs text-muted-foreground block mb-1">Full Name *</span>
                <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} required
                  placeholder="Dr. Amaka Obi" className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className="text-xs text-muted-foreground block mb-1">Role *</span>
                  <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} required
                    className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none">
                    {ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
                  </select>
                </label>
                <label>
                  <span className="text-xs text-muted-foreground block mb-1">Specialty</span>
                  <input value={form.specialty} onChange={e => setForm(f => ({ ...f, specialty: e.target.value }))}
                    placeholder="e.g. Cardiology" className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none" />
                </label>
              </div>
              <label>
                <span className="text-xs text-muted-foreground block mb-1">Email</span>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="staff@hospital.com" className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none" />
              </label>
              <label>
                <span className="text-xs text-muted-foreground block mb-1">Phone</span>
                <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="080XXXXXXXX" className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none" />
              </label>
              {(form.role === 'doctor') && (
                <label>
                  <span className="text-xs text-muted-foreground block mb-1">MDCN Number</span>
                  <input value={form.mdcn_number} onChange={e => setForm(f => ({ ...f, mdcn_number: e.target.value }))}
                    placeholder="MDCN-XXXXX" className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none" />
                </label>
              )}
              <div className="flex gap-2 pt-1">
                <Button type="button" onClick={() => setShowModal(false)} variant="outline" className="flex-1">Cancel</Button>
                <Button type="submit" disabled={submitting} className="flex-1 bg-purple-600 hover:bg-purple-500 text-white">
                  {submitting ? 'Adding…' : 'Add Staff Member'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
