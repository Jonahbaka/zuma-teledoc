'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, RefreshCw, ChevronRight } from 'lucide-react';
import { drn, statusBadge, urgencyBadge, fmtNaira } from '../drnApi';

const NEXT_BY_STATUS = {
  sent: ['received', 'cancelled'],
  received: ['accepted', 'declined'],
  accepted: ['scheduled', 'cancelled'],
  scheduled: ['in_progress', 'no_show', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
};

export default function ReferralList({ mode = 'inbox', emptyHint }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [acting, setActing] = useState(null);

  async function load() {
    setLoading(true); setErr('');
    try {
      const q = {};
      // mode is just a label here; without per-user context we list everything
      // visible to the current user and let them filter by status.
      const r = await drn.listReferrals(q);
      setRows(r.referrals || []);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [mode]);

  async function advance(id, to_status) {
    setActing(id + ':' + to_status);
    try {
      await drn.transition(id, { to_status, notes: `${mode} action` });
      await load();
    } catch (e) { setErr(e.message); }
    finally { setActing(null); }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Showing {rows.length} referrals — newest first</p>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh
        </button>
      </div>
      {err && <p className="flex items-center gap-2 text-sm text-rose-700"><AlertCircle className="h-4 w-4" />{err}</p>}
      {rows.length === 0 && !loading && (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          {emptyHint || 'No referrals yet.'}
        </p>
      )}
      <ul className="space-y-2">
        {rows.map(r => (
          <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-bold text-slate-900">{r.ref_code}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusBadge(r.status)}`}>{r.status}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${urgencyBadge(r.urgency)}`}>{r.urgency}</span>
              <span className="text-xs text-slate-500">{r.specialty.replace(/_/g, ' ')}</span>
              <span className="ml-auto text-xs text-slate-400">{new Date(r.created_at).toLocaleString()}</span>
            </div>
            <p className="mt-2 text-sm font-semibold text-slate-800">{r.reason}</p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              {r.patient_name && <span>Patient: {r.patient_name}</span>}
              {r.destination_org_name && <span>→ {r.destination_org_name}</span>}
              {r.originating_org_name && <span>From: {r.originating_org_name}</span>}
              {r.service_fee_naira != null && <span>Fee: {fmtNaira(r.service_fee_naira)}</span>}
              {r.match_score != null && <span>Match: {r.match_score}</span>}
            </div>
            {(NEXT_BY_STATUS[r.status] || []).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {(NEXT_BY_STATUS[r.status] || []).map(next => (
                  <button key={next} onClick={() => advance(r.id, next)}
                    disabled={acting === r.id + ':' + next}
                    className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    {next} <ChevronRight className="h-3 w-3" />
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
