'use client';

/**
 * components/ng/portal/FctaHsesPortal.jsx
 * FCTA / HSES Governance Portal.
 * Supports: governance workflow review, approval, DHIS2-readiness visibility.
 * Requires: reviewer+ role with FCT or national jurisdiction.
 */

import { useState, useEffect } from 'react';
import { Shield, RefreshCw, CheckCircle2, Clock, AlertTriangle, ChevronRight } from 'lucide-react';

async function fetchJson(path, opts = {}) {
  const res = await fetch(path, { credentials: 'include', ...opts });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function StatusPill({ status }) {
  const map = {
    submitted:           'bg-slate-100 text-slate-700',
    area_council_review: 'bg-amber-100 text-amber-700',
    fcta_review:         'bg-blue-100 text-blue-700',
    approved:            'bg-emerald-100 text-emerald-700',
    dhis2_ready:         'bg-violet-100 text-violet-700',
    exported:            'bg-cyan-100 text-cyan-700',
    rejected:            'bg-rose-100 text-rose-700',
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${map[status] || 'bg-slate-100 text-slate-500'}`}>
      {status?.replace(/_/g, ' ') || 'unknown'}
    </span>
  );
}

export default function FctaHsesPortal() {
  const [submissions, setSubmissions]   = useState([]);
  const [gov, setGov]                   = useState(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [advancing, setAdvancing]       = useState(null);
  const [notes, setNotes]               = useState('');
  const [actionTarget, setActionTarget] = useState(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [submData, govData] = await Promise.all([
        fetchJson('/api/ng/governance/submissions?limit=50'),
        fetchJson('/api/ng/governance/executive-summary'),
      ]);
      setSubmissions(submData.submissions || []);
      setGov(govData);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdvance(submissionId, targetStatus) {
    setAdvancing(submissionId);
    try {
      await fetchJson(`/api/ng/governance/submissions/${submissionId}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetStatus, notes }),
      });
      setNotes('');
      setActionTarget(null);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setAdvancing(null);
    }
  }

  useEffect(() => { load(); }, []);

  const pending = submissions.filter((s) =>
    ['submitted', 'area_council_review', 'fcta_review'].includes(s.status)
  );
  const completed = submissions.filter((s) =>
    ['approved', 'dhis2_ready', 'exported', 'rejected'].includes(s.status)
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30">
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-600" />
            <div>
              <h1 className="text-lg font-black text-slate-900">FCTA / HSES Governance Portal</h1>
              <p className="text-xs text-slate-500">Review and approve facility-submitted aggregate reports</p>
            </div>
          </div>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-8">
        {error && (
          <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
        )}

        {/* Governance stats */}
        {gov && (
          <div className="mb-8 grid gap-4 sm:grid-cols-4">
            {[
              { label: 'Pending review', value: gov.governance?.pendingReview ?? 'Data unavailable',    icon: Clock,          hl: true  },
              { label: 'Pending approval', value: gov.governance?.pendingApproval ?? 'Data unavailable', icon: AlertTriangle, hl: true  },
              { label: 'Approved',       value: gov.governance?.approved ?? 'Data unavailable',          icon: CheckCircle2,  hl: false },
              { label: 'Total',          value: gov.governance?.totalSubmissions ?? 'Data unavailable',  icon: Shield,        hl: false },
            ].map((item) => (
              <div key={item.label} className={`rounded-2xl border p-4 ${item.hl && item.value > 0 ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">{item.label}</span>
                  <item.icon className="h-4 w-4 text-slate-400" />
                </div>
                <p className={`mt-1 text-2xl font-black ${item.hl && item.value > 0 ? 'text-amber-600' : 'text-slate-800'}`}>
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        )}

        {loading && (
          <div className="py-16 text-center text-sm text-slate-400">
            <RefreshCw className="mx-auto mb-3 h-8 w-8 animate-spin text-blue-400" />
            Loading submissions…
          </div>
        )}

        {!loading && (
          <>
            <h2 className="mb-4 text-base font-black text-slate-900">
              Pending Action ({pending.length})
            </h2>

            {!pending.length && (
              <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
                No submissions pending action.
              </div>
            )}

            <div className="mb-8 space-y-4">
              {pending.map((sub) => (
                <div key={sub.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <StatusPill status={sub.status} />
                        <span className="text-sm font-bold text-slate-800">{sub.submission_period}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {sub.facility_name || sub.jurisdiction_name || 'Unknown facility'} •{' '}
                        Submitted {new Date(sub.created_at).toLocaleDateString('en-NG')}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {sub.status === 'area_council_review' && (
                        <button
                          onClick={() => setActionTarget({ id: sub.id, target: 'fcta_review' })}
                          disabled={advancing === sub.id}
                          className="rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          Send to FCTA
                        </button>
                      )}
                      {sub.status === 'fcta_review' && (
                        <button
                          onClick={() => setActionTarget({ id: sub.id, target: 'approved' })}
                          disabled={advancing === sub.id}
                          className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Approve
                        </button>
                      )}
                      <button
                        onClick={() => setActionTarget({ id: sub.id, target: 'rejected' })}
                        disabled={advancing === sub.id}
                        className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </div>

                  {/* Inline action form */}
                  {actionTarget?.id === sub.id && (
                    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="mb-2 text-xs font-semibold text-slate-600">
                        Action: <span className="capitalize">{actionTarget.target.replace(/_/g, ' ')}</span>
                      </p>
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Notes (optional)"
                        rows={2}
                        className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleAdvance(sub.id, actionTarget.target)}
                          disabled={advancing === sub.id}
                          className="rounded-xl bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => { setActionTarget(null); setNotes(''); }}
                          className="rounded-xl border border-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-600"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {completed.length > 0 && (
              <>
                <h2 className="mb-4 text-base font-black text-slate-900">Completed ({completed.length})</h2>
                <div className="space-y-2">
                  {completed.map((sub) => (
                    <div key={sub.id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-white px-4 py-3">
                      <div className="flex items-center gap-3">
                        <StatusPill status={sub.status} />
                        <span className="text-sm text-slate-700">{sub.submission_period}</span>
                        <span className="text-xs text-slate-400">{sub.facility_name || sub.jurisdiction_name}</span>
                      </div>
                      <span className="text-xs text-slate-400">
                        {new Date(sub.created_at).toLocaleDateString('en-NG')}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
