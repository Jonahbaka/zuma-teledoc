'use client';

import { useEffect, useState } from 'react';
import { UserPlus, AlertCircle, RefreshCw } from 'lucide-react';
import { drn, fmtNaira } from '../drnApi';

export default function AgentsTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({ full_name: '', phone: '', whatsapp_phone: '', email: '', commission_rate: 5 });
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true); setErr('');
    try { const r = await drn.listAgents(); setRows(r.agents || []); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    setCreating(true); setErr('');
    try {
      await drn.registerAgent(draft);
      setShowNew(false);
      setDraft({ full_name: '', phone: '', whatsapp_phone: '', email: '', commission_rate: 5 });
      await load();
    } catch (e) { setErr(e.message); }
    finally { setCreating(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-900">Field agents</h3>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh
          </button>
          <button onClick={() => setShowNew(v => !v)}
            className="flex items-center gap-2 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700">
            <UserPlus className="h-3.5 w-3.5" />{showNew ? 'Cancel' : 'Register agent'}
          </button>
        </div>
      </div>

      {err && <p className="flex items-center gap-2 text-sm text-rose-700"><AlertCircle className="h-4 w-4" />{err}</p>}

      {showNew && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Full name" value={draft.full_name} onChange={v => setDraft(d => ({ ...d, full_name: v }))} />
            <Input label="Phone" value={draft.phone} onChange={v => setDraft(d => ({ ...d, phone: v }))} />
            <Input label="WhatsApp phone" value={draft.whatsapp_phone} onChange={v => setDraft(d => ({ ...d, whatsapp_phone: v }))} />
            <Input label="Email" value={draft.email} onChange={v => setDraft(d => ({ ...d, email: v }))} />
            <Input label="Commission rate (%)" type="number" value={draft.commission_rate} onChange={v => setDraft(d => ({ ...d, commission_rate: Number(v) }))} />
          </div>
          <div className="mt-3 flex justify-end">
            <button onClick={create} disabled={creating || !draft.full_name || !draft.phone}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">
              {creating ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <table className="w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-sm shadow-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left">Code</th>
            <th className="px-3 py-2 text-left">Name</th>
            <th className="px-3 py-2 text-left">Phone</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-right">Completed</th>
            <th className="px-3 py-2 text-right">Pending payout</th>
            <th className="px-3 py-2 text-right">Total earned</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">No agents yet. Register the first one above.</td></tr>
          )}
          {rows.map(a => (
            <tr key={a.id} className="border-t border-slate-100">
              <td className="px-3 py-2 font-mono text-xs">{a.agent_code}</td>
              <td className="px-3 py-2 font-semibold text-slate-900">{a.full_name}</td>
              <td className="px-3 py-2 text-slate-600">{a.phone}</td>
              <td className="px-3 py-2 text-slate-600">{a.status}</td>
              <td className="px-3 py-2 text-right">{a.total_completed}</td>
              <td className="px-3 py-2 text-right">{fmtNaira(a.pending_payout)}</td>
              <td className="px-3 py-2 text-right">{fmtNaira(a.total_earned_naira)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Input({ label, value, onChange, type = 'text' }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
    </label>
  );
}
