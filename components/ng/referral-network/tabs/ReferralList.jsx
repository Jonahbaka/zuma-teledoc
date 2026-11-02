'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { AlertCircle, RefreshCw, ChevronRight } from 'lucide-react';
import { drn, statusBadge, urgencyBadge, fmtNaira } from '../drnApi';

export default function ReferralList({ mode = 'inbox', emptyHint }) {
  const { user, loading: authLoading } = useAuth();
  const id = user?.id || user?.userId;
  const market = user?.marketScope || user?.market_scope;
  const accountKey = !authLoading && id && user?.role && market === 'NG' ? JSON.stringify([id, user.role, market]) : null;
  const session = useRef(accountKey); session.current = accountKey;
  if (!accountKey) return <p role="status">Sign in to view your referral worklist.</p>;
  return <ReferralWorklist key={accountKey} session={session} accountKey={accountKey} mode={mode} emptyHint={emptyHint} />;
}

export function ReferralWorklist({ mode = 'inbox', emptyHint, session, accountKey } = {}) {
  const [record, setRecord] = useState({ mode, rows: [] });
  const rows = record.mode === mode ? record.rows : [];
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [acting, setActing] = useState(null);
  const mounted = useRef(true);
  const requestVersion = useRef(0);
  const currentMode = useRef({ mode });
  if (currentMode.current.mode !== mode) currentMode.current = { mode };
  const openedScope = currentMode.current;
  const action = useRef(null);
  const current = (openedMode) => mounted.current && currentMode.current === openedScope && openedScope.mode === openedMode && (!session || session.current === accountKey);

  async function load() {
    const openedMode = mode;
    if (!current(openedMode) || action.current) return;
    const version = ++requestVersion.current;
    setLoading(true); setErr('');
    try {
      // Server scopes all results. Inbox/outbox are presentation labels only.
      const response = await drn.listReferrals({});
      if (!response?.ok || !Array.isArray(response.referrals)) throw new Error('Referral list could not be confirmed.');
      if (current(openedMode) && version === requestVersion.current) setRecord({ mode: openedMode, rows: response.referrals });
    } catch (error) { if (current(openedMode) && version === requestVersion.current) setErr(error.message); }
    finally { if (current(openedMode) && version === requestVersion.current) setLoading(false); }
  }
  useEffect(() => {
    mounted.current = true; action.current = null; setErr(''); setActing(null); load();
    return () => { mounted.current = false; requestVersion.current += 1; };
    // load deliberately captures the selected mode; request versions own each result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  async function advance(id, to_status) {
    const openedMode = mode;
    const row = rows.find(item => item.id === id);
    if (!current(openedMode) || action.current || !Array.isArray(row?.allowed_transitions) || !row.allowed_transitions.includes(to_status)) return;
    const operation = {}; action.current = operation;
    ++requestVersion.current; // Older reads cannot overwrite an acknowledged mutation.
    setLoading(false); setErr(''); setActing(id + ':' + to_status);
    try {
      const response = await drn.transition(id, { to_status, notes: `${mode} action` });
      if (!response?.ok || response.referral?.id !== id) throw new Error('Referral update could not be confirmed. Refresh before retrying.');
      if (!current(openedMode)) return;
      setRecord(previous => ({ mode: openedMode, rows: previous.rows.map(item => item.id === id ? { ...item, ...response.referral, allowed_transitions: Array.isArray(response.referral.allowed_transitions) ? response.referral.allowed_transitions : [] } : item) }));
    } catch (error) { if (current(openedMode)) setErr(error.message); }
    finally {
      if (action.current === operation) action.current = null;
      if (current(openedMode)) setActing(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Showing {rows.length} referrals — newest first</p>
        <button onClick={load} disabled={loading || Boolean(acting)}
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
              <span className="text-xs text-slate-500">{String(r.specialty || '').replace(/_/g, ' ')}</span>
              <span className="ml-auto text-xs text-slate-400">{new Date(r.created_at).toLocaleString()}</span>
            </div>
            <p className="mt-2 text-sm font-semibold text-slate-800">{r.reason}</p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>{r.patient_user_id ? 'Linked patient record' : 'Unlinked patient details—not identity verified'}{r.patient_name ? `: ${r.patient_name}` : ''}</span>
              {r.destination_org_name && <span>→ {r.destination_org_name}</span>}
              {r.originating_org_name && <span>From: {r.originating_org_name}</span>}
              {r.service_fee_naira != null && <span>Fee: {fmtNaira(r.service_fee_naira)}</span>}
              {r.match_score != null && <span>Match: {r.match_score}</span>}
            </div>
            {(Array.isArray(r.allowed_transitions) ? r.allowed_transitions : []).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {(Array.isArray(r.allowed_transitions) ? r.allowed_transitions : []).map(next => (
                  <button key={next} onClick={() => advance(r.id, next)}
                    disabled={Boolean(acting)}
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
