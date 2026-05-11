'use client';

/**
 * components/ng/portal/AmacPortal.jsx
 * Abuja Municipal Area Council (AMAC) portal.
 * Shows area-council-level submissions, facility overview, and first-stage review.
 */

import { useState, useEffect } from 'react';
import { Building2, RefreshCw, Shield, Clock } from 'lucide-react';

async function fetchJson(path) {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function StatusPill({ status }) {
  const map = {
    submitted:           'bg-slate-100 text-slate-700',
    area_council_review: 'bg-amber-100 text-amber-700',
    fcta_review:         'bg-blue-100 text-blue-700',
    approved:            'bg-emerald-100 text-emerald-700',
    rejected:            'bg-rose-100 text-rose-700',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${map[status] || 'bg-slate-100 text-slate-500'}`}>
      {status?.replace(/_/g, ' ')}
    </span>
  );
}

export default function AmacPortal() {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [advancing, setAdvancing]     = useState(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchJson('/api/ng/governance/submissions?limit=50');
      setSubmissions(data.submissions || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function sendToAreaCouncilReview(id) {
    setAdvancing(id);
    try {
      await fetch(`/api/ng/governance/submissions/${id}/advance`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetStatus: 'area_council_review' }),
      });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setAdvancing(null);
    }
  }

  useEffect(() => { load(); }, []);

  const submitted       = submissions.filter((s) => s.status === 'submitted');
  const underReview     = submissions.filter((s) => s.status === 'area_council_review');
  const forwarded       = submissions.filter((s) => ['fcta_review', 'approved', 'exported'].includes(s.status));

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-amber-50/30">
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-amber-600" />
            <div>
              <h1 className="text-lg font-black text-slate-900">AMAC Area Council Portal</h1>
              <p className="text-xs text-slate-500">Facility submission review — first-stage governance</p>
            </div>
          </div>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-6 py-8">
        {error && (
          <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
        )}

        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          {[
            { label: 'New submissions',  value: submitted.length,   color: 'text-amber-600',   hl: submitted.length > 0 },
            { label: 'Under review',     value: underReview.length, color: 'text-blue-600' },
            { label: 'Forwarded / done', value: forwarded.length,   color: 'text-emerald-600' },
          ].map((item) => (
            <div key={item.label} className={`rounded-2xl border p-4 ${item.hl ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
              <p className="text-xs text-slate-500">{item.label}</p>
              <p className={`text-2xl font-black ${item.color}`}>{item.value}</p>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="py-16 text-center text-sm text-slate-400">
            <RefreshCw className="mx-auto mb-3 h-8 w-8 animate-spin text-amber-400" />
            Loading submissions…
          </div>
        ) : (
          <div className="space-y-6">
            {submitted.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-bold text-slate-700">New — awaiting area council review</h2>
                <div className="space-y-3">
                  {submitted.map((sub) => (
                    <div key={sub.id} className="flex items-center justify-between rounded-2xl border border-amber-200 bg-amber-50 p-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <StatusPill status={sub.status} />
                          <span className="text-sm font-semibold text-slate-800">{sub.submission_period}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">{sub.facility_name || 'Facility'}</p>
                      </div>
                      <button
                        onClick={() => sendToAreaCouncilReview(sub.id)}
                        disabled={advancing === sub.id}
                        className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                      >
                        {advancing === sub.id ? 'Processing…' : 'Begin Review'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {underReview.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-bold text-slate-700">Currently under area council review</h2>
                <div className="space-y-2">
                  {underReview.map((sub) => (
                    <div key={sub.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-amber-400" />
                        <StatusPill status={sub.status} />
                        <span className="text-sm text-slate-700">{sub.submission_period} — {sub.facility_name}</span>
                      </div>
                      <span className="text-xs text-slate-400">{new Date(sub.reviewed_at || sub.created_at).toLocaleDateString('en-NG')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {forwarded.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-bold text-slate-700">Forwarded to FCTA / completed</h2>
                <div className="space-y-2">
                  {forwarded.slice(0, 20).map((sub) => (
                    <div key={sub.id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-white px-4 py-3">
                      <div className="flex items-center gap-2">
                        <StatusPill status={sub.status} />
                        <span className="text-sm text-slate-600">{sub.submission_period}</span>
                        <span className="text-xs text-slate-400">{sub.facility_name}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!submitted.length && !underReview.length && !forwarded.length && (
              <div className="py-16 text-center text-sm text-slate-400">
                No submissions yet. Facilities submit reports from the admin portal.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
