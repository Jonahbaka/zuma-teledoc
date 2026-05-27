'use client';

import { useEffect, useState } from 'react';
import { Activity, CheckCircle2, AlertCircle, Clock, Wallet, TrendingUp } from 'lucide-react';
import { drn, fmtNaira } from '../drnApi';

function KpiTile({ label, value, hint, icon: Icon, tone = 'slate' }) {
  const tones = {
    slate:  'bg-white border-slate-200',
    green:  'bg-emerald-50 border-emerald-200',
    amber:  'bg-amber-50 border-amber-200',
    blue:   'bg-blue-50 border-blue-200',
    rose:   'bg-rose-50 border-rose-200',
  };
  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${tones[tone]}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <Icon className="h-4 w-4 text-slate-400" />
      </div>
      <p className="text-3xl font-black text-slate-900">{value ?? '—'}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export default function OverviewTab() {
  const [kpis, setKpis] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { setKpis(await drn.kpis()); }
      catch (e) { setErr(e.message); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <p className="text-sm text-slate-500">Loading network KPIs…</p>;
  if (err)     return <p className="flex items-center gap-2 text-sm text-rose-700"><AlertCircle className="h-4 w-4" />{err}</p>;

  const k = kpis?.kpis || {};
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiTile label="Total referrals (30d)" value={k.total ?? 0} icon={Activity} tone="blue" />
        <KpiTile label="Completed" value={k.completed ?? 0} icon={CheckCircle2} tone="green" />
        <KpiTile label="In flight" value={k.in_flight ?? 0} icon={Clock} />
        <KpiTile label="Emergencies" value={k.emergencies ?? 0} icon={AlertCircle} tone="rose" />
        <KpiTile label="Failed / no-show" value={k.failed ?? 0} icon={AlertCircle} tone="amber" />
        <KpiTile label="Avg match score" value={k.avg_match_score ?? '—'} icon={TrendingUp} hint="0–100" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-slate-500" />
            <span className="text-sm font-semibold text-slate-700">Completed referral fees (30d)</span>
          </div>
          <span className="text-2xl font-black text-slate-900">{fmtNaira(k.completed_fees_naira)}</span>
        </div>
      </div>
    </div>
  );
}
