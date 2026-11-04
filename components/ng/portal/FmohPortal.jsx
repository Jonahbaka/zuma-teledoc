'use client';

/**
 * components/ng/portal/FmohPortal.jsx
 * National Layer Portal — FMOH aggregate view.
 * Read-only. Requires national or state tier jurisdiction access.
 * Data source: /api/ng/executive-view/* (aggregate, no patient identifiers)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Shield, RefreshCw, Building2, Users, Activity, BarChart3 } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';

async function fetchJson(path, signal) {
  const { data } = await api.get(path, { signal });
  return data;
}

function KpiTile({ label, value, icon: Icon }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <Icon className="h-4 w-4 text-slate-400" />
      </div>
      <p className="text-3xl font-black text-slate-900">
        {value != null ? value.toLocaleString() : '—'}
      </p>
    </div>
  );
}

export default function FmohPortal() {
  const { user } = useAuth();
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const [loadedAt, setLoadedAt] = useState(null);
  const request = useRef(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    setData(null);
    setLoadedAt(null);
    try {
      const [dashboard, gov] = await Promise.all([
        fetchJson('/ng/executive-view/dashboard', controller.signal),
        fetchJson('/ng/governance/executive-summary', controller.signal),
      ]);
      if (controller.signal.aborted) return;
      setData({ dashboard, gov });
      setLoadedAt(new Date());
    } catch (e) {
      if (!controller.signal.aborted) setError([401, 403].includes(e.response?.status)
        ? 'Your account is not authorized to view national aggregate data. Contact your programme administrator.'
        : 'National aggregate data could not be loaded. Refresh to try again.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); return () => request.current?.abort(); }, [load, user?.id]);

  const exec = data?.dashboard?.executive;
  const gov  = data?.gov;
  const m    = exec?.metrics || {};

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30">
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-600" />
            <div>
              <h1 className="text-lg font-black text-slate-900">FMOH — National Layer</h1>
              <p className="text-xs text-slate-500">Federal Ministry of Health aggregate intelligence</p>
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
          <div role="alert" className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-base text-rose-700">{error}</div>
        )}

        {loading && (
          <div role="status" className="py-24 text-center text-base text-slate-600">
            <RefreshCw className="mx-auto mb-3 h-8 w-8 animate-spin text-blue-400" />
            Loading national intelligence…
          </div>
        )}

        {!loading && exec && (
          <div className="space-y-8">
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700 text-center">
              All data is aggregate — no patient identifiers. Market scope: Nigeria (NG).
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiTile label="Total consultations"  value={m.total_consultations}   icon={Activity}   />
              <KpiTile label="Teleconsultations"    value={m.teleconsultations}     icon={Users}      />
              <KpiTile label="Active facilities"    value={m.active_facilities}     icon={Building2}  />
              <KpiTile label="Referrals created"    value={m.referrals_created}     icon={BarChart3}  />
            </div>

            {gov && (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-base font-black text-slate-900">Governance Workflow Status</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {Object.entries(gov.governance?.submissionByStatus || {}).map(([status, count]) => (
                    <div key={status} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                      <span className="text-sm capitalize text-slate-600">{status.replace(/_/g, ' ')}</span>
                      <span className="text-sm font-bold text-slate-900">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-base font-black text-slate-900">Programme Spaces</h2>
              <p className="text-sm text-slate-400">
                {gov?.programmeSpaces != null ? gov.programmeSpaces + ' programme spaces configured.' : 'Programme configuration counts are unavailable.'} Navigate to the admin portal for full programme intelligence.
              </p>
            </div>

            <p className="text-center text-xs text-slate-400">
              DoctaRx FMOH Portal — Live government submission requires official DHIS2 credentials,
              mappings, and authorization. Loaded {loadedAt?.toLocaleString('en-NG')}.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
