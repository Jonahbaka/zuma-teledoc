'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, RefreshCw, Wallet } from 'lucide-react';
import { drn, fmtNaira } from '../drnApi';

const KIND_BADGE = {
  agent:                'bg-emerald-100 text-emerald-800',
  originating_provider: 'bg-blue-100 text-blue-800',
  originating_org:      'bg-indigo-100 text-indigo-800',
  platform:             'bg-slate-200 text-slate-700',
};
const STATUS_BADGE = {
  accrued:     'bg-amber-100 text-amber-800',
  approved:    'bg-blue-100 text-blue-800',
  paid:        'bg-emerald-100 text-emerald-800',
  clawed_back: 'bg-rose-100 text-rose-800',
  void:        'bg-slate-200 text-slate-700',
};

export default function CommissionsTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  async function load() {
    setLoading(true); setErr('');
    try { const r = await drn.commissions({ status: statusFilter || undefined }); setRows(r.commissions || []); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusFilter]);

  const totals = rows.reduce((acc, r) => {
    acc.total += Number(r.amount_naira || 0);
    acc[r.status] = (acc[r.status] || 0) + Number(r.amount_naira || 0);
    return acc;
  }, { total: 0 });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Tile label="Total accrued" value={fmtNaira(totals.accrued || 0)} tone="amber" />
        <Tile label="Approved" value={fmtNaira(totals.approved || 0)} tone="blue" />
        <Tile label="Paid out" value={fmtNaira(totals.paid || 0)} tone="green" />
        <Tile label="All-time" value={fmtNaira(totals.total)} icon={Wallet} />
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs font-semibold text-slate-500">Filter:</label>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm">
          <option value="">All statuses</option>
          {['accrued', 'approved', 'paid', 'clawed_back', 'void'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={load} disabled={loading}
          className="ml-auto flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh
        </button>
      </div>

      {err && <p className="flex items-center gap-2 text-sm text-rose-700"><AlertCircle className="h-4 w-4" />{err}</p>}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">When</th>
              <th className="px-3 py-2 text-left">Beneficiary</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-right">Rate</th>
              <th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">No commissions accrued yet.</td></tr>
            )}
            {rows.map(c => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="px-3 py-2 text-xs text-slate-500">{new Date(c.created_at).toLocaleString()}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${KIND_BADGE[c.beneficiary_kind] || ''}`}>
                    {c.beneficiary_kind.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[c.status] || ''}`}>{c.status}</span>
                </td>
                <td className="px-3 py-2 text-right text-slate-500">{c.rate_pct != null ? `${c.rate_pct}%` : '—'}</td>
                <td className="px-3 py-2 text-right font-semibold">{fmtNaira(c.amount_naira)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tile({ label, value, tone = 'slate', icon: Icon }) {
  const tones = {
    slate:  'bg-white border-slate-200',
    green:  'bg-emerald-50 border-emerald-200',
    amber:  'bg-amber-50 border-amber-200',
    blue:   'bg-blue-50 border-blue-200',
  };
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${tones[tone]}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        {Icon && <Icon className="h-4 w-4 text-slate-400" />}
      </div>
      <p className="mt-1 text-2xl font-black text-slate-900">{value}</p>
    </div>
  );
}
