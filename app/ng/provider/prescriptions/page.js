'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Pill, Plus, Search, ChevronLeft, FileText,
  AlertCircle, CheckCircle, Clock, User, Download
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import NgNav from '../../components/NgNav';
import { formatNaira } from '../../lib/ngUtils';

const COMMON_DRUGS = [
  'Amoxicillin', 'Paracetamol', 'Ibuprofen', 'Metformin', 'Amlodipine',
  'Lisinopril', 'Omeprazole', 'Atorvastatin', 'Ciprofloxacin', 'Azithromycin',
  'Artemether-Lumefantrine', 'Chloroquine', 'Cotrimoxazole', 'Fluconazole', 'Metronidazole',
];

const EMPTY_LINE = { drug: '', dosage: '', frequency: '', duration: '', notes: '' };

export default function ProviderPrescriptions() {
  const [tab, setTab] = useState('write');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    patient_name: '', patient_phone: '', patient_dob: '', diagnosis: '', notes: '',
    lines: [{ ...EMPTY_LINE }],
  });

  useEffect(() => {
    if (tab !== 'history') return;
    const token = localStorage.getItem('accessToken');
    const providerId = localStorage.getItem('ng_provider_id');
    if (!token || !providerId) return;
    setLoading(true);
    fetch(`/api/ng/providers/${providerId}/prescriptions`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setHistory(d.prescriptions || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tab]);

  const updateLine = (idx, field, val) =>
    setForm(f => ({ ...f, lines: f.lines.map((l, i) => i === idx ? { ...l, [field]: val } : l) }));

  const addLine = () => setForm(f => ({ ...f, lines: [...f.lines, { ...EMPTY_LINE }] }));
  const removeLine = (idx) => setForm(f => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch('/api/ng/prescriptions/digital', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to issue prescription');
      setSuccess(true);
      setForm({ patient_name: '', patient_phone: '', patient_dob: '', diagnosis: '', notes: '', lines: [{ ...EMPTY_LINE }] });
      setTimeout(() => setSuccess(false), 4000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const statusBadge = (s) => ({
    issued: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    dispensed: 'bg-green-500/10 text-green-600 border-green-500/20',
    expired: 'bg-red-500/10 text-red-600 border-red-500/20',
    cancelled: 'bg-muted text-muted-foreground border-border',
  }[s] || 'bg-muted text-muted-foreground border-border');

  return (
    <div className="min-h-screen bg-background text-foreground">
      <NgNav />
      <div className="pt-14 max-w-4xl mx-auto px-6 py-8 space-y-6">

        <div className="flex items-center gap-3">
          <Link href="/ng/provider/dashboard" className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center"><ChevronLeft size={16} /></Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Prescriptions</h1>
            <p className="text-muted-foreground text-sm">Write and manage digital prescriptions</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-accent rounded-xl p-1 w-fit">
          {['write', 'history'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-1.5 rounded-lg text-sm font-medium capitalize transition-all ${tab === t ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
              {t === 'write' ? '+ Write Rx' : 'History'}
            </button>
          ))}
        </div>

        {success && (
          <div className="bg-green-500/10 border border-green-500/20 text-green-600 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
            <CheckCircle size={16} /> Prescription issued successfully. Patient can present it at any registered pharmacy.
          </div>
        )}

        {tab === 'write' && (
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-600 rounded-xl px-4 py-3 text-sm flex items-start gap-2">
                <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
              </div>
            )}

            {/* Patient info */}
            <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
              <h3 className="font-bold text-foreground flex items-center gap-2"><User size={16} className="text-blue-500" /> Patient Information</h3>
              <div className="grid sm:grid-cols-3 gap-3">
                <label className="sm:col-span-2">
                  <span className="text-xs font-medium text-muted-foreground block mb-1">Patient Name *</span>
                  <input value={form.patient_name} onChange={e => setForm(f => ({ ...f, patient_name: e.target.value }))} required
                    placeholder="Full name" className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-blue-500/50" />
                </label>
                <label>
                  <span className="text-xs font-medium text-muted-foreground block mb-1">Phone</span>
                  <input value={form.patient_phone} onChange={e => setForm(f => ({ ...f, patient_phone: e.target.value }))}
                    placeholder="080XXXXXXXX" className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none" />
                </label>
              </div>
              <label>
                <span className="text-xs font-medium text-muted-foreground block mb-1">Diagnosis / Clinical Notes</span>
                <textarea value={form.diagnosis} onChange={e => setForm(f => ({ ...f, diagnosis: e.target.value }))}
                  rows={2} placeholder="e.g., Acute upper respiratory tract infection, Malaria — P. falciparum"
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none resize-none" />
              </label>
            </div>

            {/* Drug lines */}
            <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
              <h3 className="font-bold text-foreground flex items-center gap-2"><Pill size={16} className="text-blue-500" /> Medications</h3>
              {form.lines.map((line, idx) => (
                <div key={idx} className="border border-border rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-muted-foreground uppercase">Drug {idx + 1}</span>
                    {form.lines.length > 1 && (
                      <button type="button" onClick={() => removeLine(idx)} className="text-xs text-red-500 hover:underline">Remove</button>
                    )}
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <label>
                      <span className="text-xs text-muted-foreground block mb-1">Drug Name *</span>
                      <input list={`drugs-${idx}`} value={line.drug} onChange={e => updateLine(idx, 'drug', e.target.value)} required
                        placeholder="e.g., Amoxicillin 500mg" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none" />
                      <datalist id={`drugs-${idx}`}>{COMMON_DRUGS.map(d => <option key={d} value={d} />)}</datalist>
                    </label>
                    <label>
                      <span className="text-xs text-muted-foreground block mb-1">Dosage</span>
                      <input value={line.dosage} onChange={e => updateLine(idx, 'dosage', e.target.value)}
                        placeholder="e.g., 500mg, 1 tablet" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none" />
                    </label>
                    <label>
                      <span className="text-xs text-muted-foreground block mb-1">Frequency</span>
                      <select value={line.frequency} onChange={e => updateLine(idx, 'frequency', e.target.value)}
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none">
                        <option value="">Select…</option>
                        {['Once daily', 'Twice daily', 'Three times daily', 'Four times daily', 'Every 8 hours', 'Every 12 hours', 'As needed (PRN)', 'Stat (immediately)'].map(f => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className="text-xs text-muted-foreground block mb-1">Duration</span>
                      <input value={line.duration} onChange={e => updateLine(idx, 'duration', e.target.value)}
                        placeholder="e.g., 5 days, 2 weeks" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none" />
                    </label>
                  </div>
                  <label>
                    <span className="text-xs text-muted-foreground block mb-1">Special instructions</span>
                    <input value={line.notes} onChange={e => updateLine(idx, 'notes', e.target.value)}
                      placeholder="e.g., Take after meals, avoid dairy" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none" />
                  </label>
                </div>
              ))}
              <button type="button" onClick={addLine} className="text-sm text-blue-500 font-medium hover:underline flex items-center gap-1">
                <Plus size={14} /> Add another drug
              </button>
            </div>

            <label className="block">
              <span className="text-xs font-medium text-muted-foreground block mb-1">Additional Notes (for pharmacist)</span>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2} placeholder="Any special instructions for the dispensing pharmacist…"
                className="w-full bg-card border border-border rounded-xl px-4 py-3 text-sm text-foreground outline-none resize-none" />
            </label>

            <Button type="submit" disabled={submitting} className="w-full bg-blue-600 hover:bg-blue-500 text-white h-12 rounded-2xl font-bold">
              {submitting ? 'Issuing Prescription…' : 'Issue Digital Prescription'}
            </Button>
          </form>
        )}

        {tab === 'history' && (
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h3 className="font-bold text-foreground">Prescription History</h3>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : history.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FileText size={32} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">No prescriptions issued yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {history.map(rx => (
                  <div key={rx.id} className="px-6 py-4 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">{rx.patient_name}</p>
                      <p className="text-xs text-muted-foreground">{rx.diagnosis || 'No diagnosis noted'}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{new Date(rx.issued_at || rx.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                    </div>
                    <div className="text-right">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${statusBadge(rx.status)}`}>{rx.status}</span>
                      <p className="text-xs text-muted-foreground mt-1">{rx.rx_code}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
