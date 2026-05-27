'use client';

import { useState } from 'react';
import { Mail, Copy, CheckCircle2, AlertCircle, Plus } from 'lucide-react';
import { conf, ROLE_OPTIONS } from './conferenceApi';

export default function InvitePanel({ roomId }) {
  const [form, setForm] = useState({ role: 'doctor', display_name: '', email: '', phone: '', ttlHours: 24 });
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const [issued, setIssued] = useState([]);
  const [copiedIdx, setCopiedIdx] = useState(null);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const out = await conf.createInvite(roomId, { ...form, ttlHours: Number(form.ttlHours) });
      const link = `${window.location.origin}/ng/conference/join/${encodeURIComponent(out.token)}`;
      setIssued(prev => [{ link, prefix: out.prefix, role: form.role, name: form.display_name, expires_at: out.expires_at }, ...prev]);
      setForm(f => ({ ...f, display_name: '', email: '', phone: '' }));
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function copy(text, idx) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    } catch { /* noop */ }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <select
            value={form.role}
            onChange={e => set('role', e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          >
            {ROLE_OPTIONS.filter(o => o.value !== 'host').map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <input
            value={form.display_name}
            onChange={e => set('display_name', e.target.value)}
            placeholder="Display name (optional)"
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          />
          <input
            value={form.email}
            onChange={e => set('email', e.target.value)}
            placeholder="Email (optional)"
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          />
          <input
            value={form.phone}
            onChange={e => set('phone', e.target.value)}
            placeholder="Phone (optional)"
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs text-slate-600">
            Expires in
            <input
              type="number" min="1" max="168"
              value={form.ttlHours}
              onChange={e => set('ttlHours', e.target.value)}
              className="ml-2 w-16 rounded-md border border-slate-300 px-1 py-0.5 text-xs"
            /> hours
          </label>
          <button
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            {busy ? 'Issuing…' : 'Issue invite'}
          </button>
        </div>
        {err && (
          <p className="flex items-center gap-1 text-xs text-rose-700"><AlertCircle className="h-3.5 w-3.5" />{err}</p>
        )}
      </form>

      {issued.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Issued this session</p>
          <ul className="space-y-1">
            {issued.map((inv, idx) => (
              <li key={idx} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-2 text-xs">
                <Mail className="mt-0.5 h-3.5 w-3.5 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-800">{inv.name || '(no name)'}</span>
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase">{inv.role}</span>
                  </div>
                  <p className="truncate font-mono text-[10px] text-slate-500">{inv.link}</p>
                </div>
                <button
                  onClick={() => copy(inv.link, idx)}
                  className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
                  title="Copy invite link"
                >
                  {copiedIdx === idx ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
