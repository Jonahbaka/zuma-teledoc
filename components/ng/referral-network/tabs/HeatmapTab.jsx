'use client';

import { useEffect, useState } from 'react';
import { Map, RefreshCw, AlertCircle, Flame } from 'lucide-react';
import { drn } from '../drnApi';

export default function HeatmapTab() {
  const [cells, setCells] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState({ specialty: '', state: 'FCT' });

  async function load() {
    setLoading(true); setErr('');
    try { const r = await drn.heatmap(filter); setCells(r.cells || []); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function refresh() {
    setLoading(true); setErr('');
    try { await drn.refreshHeatmap(); await load(); }
    catch (e) { setErr(e.message); setLoading(false); }
  }

  const maxScore = Math.max(1, ...cells.map(c => Number(c.underserved_score || 0)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grow basis-44">
          <label className="block text-xs font-semibold text-slate-500">Specialty</label>
          <input value={filter.specialty} onChange={e => setFilter(f => ({ ...f, specialty: e.target.value }))}
            placeholder="any"
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </div>
        <div className="grow basis-32">
          <label className="block text-xs font-semibold text-slate-500">State</label>
          <input value={filter.state} onChange={e => setFilter(f => ({ ...f, state: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">
          <Map className="h-4 w-4" />{loading ? 'Loading…' : 'Load'}
        </button>
        <button onClick={refresh} disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Recompute (admin)
        </button>
      </div>

      {err && <p className="flex items-center gap-2 text-sm text-rose-700"><AlertCircle className="h-4 w-4" />{err}</p>}

      {cells.length === 0 && !loading && (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          No heatmap data yet. Send some referrals or click <strong>Recompute</strong> after seed data lands.
        </p>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Cell</th>
              <th className="px-3 py-2 text-right">Referrals</th>
              <th className="px-3 py-2 text-right">Completed</th>
              <th className="px-3 py-2 text-right">Cancelled</th>
              <th className="px-3 py-2 text-right">Median match</th>
              <th className="px-3 py-2 text-right">Underserved</th>
            </tr>
          </thead>
          <tbody>
            {cells.map(c => {
              const score = Number(c.underserved_score || 0);
              const intensity = score / maxScore;
              const bg = `rgba(244, 63, 94, ${0.05 + intensity * 0.25})`;
              return (
                <tr key={c.cell_key} className="border-t border-slate-100" style={{ background: bg }}>
                  <td className="px-3 py-2 text-xs text-slate-700">
                    <span className="font-semibold text-slate-900">{c.specialty}</span>
                    <span className="ml-2 text-slate-500">{c.state} · {c.lga}</span>
                    <span className="ml-2 text-slate-400">{c.period_start?.slice(0, 10)}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">{c.referral_count}</td>
                  <td className="px-3 py-2 text-right text-emerald-700">{c.completed_count}</td>
                  <td className="px-3 py-2 text-right text-rose-700">{c.cancelled_count}</td>
                  <td className="px-3 py-2 text-right">{c.median_match_score ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <span className="inline-flex items-center gap-1 font-bold text-rose-700">
                      <Flame className="h-3.5 w-3.5" />{Number(score).toFixed(0)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
