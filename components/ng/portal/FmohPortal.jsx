'use client';

/**
 * components/ng/portal/FmohPortal.jsx
 * National Layer Portal — FMOH aggregate view.
 * Read-only. Requires national or state tier jurisdiction access.
 * Data source: /api/ng/executive-view/* (aggregate, no patient identifiers)
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Shield, RefreshCw, Building2, Users, Activity, BarChart3 } from 'lucide-react';
import {
  PRESENTATION_DEMO_LABEL,
  buildMinistryDemoData,
  shouldShowPresentationDemoData,
} from '@/lib/ngPresentationDemoData';

async function fetchJson(path) {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
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
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const [usingDemoData, setUsingDemoData] = useState(false);
  const demoData = useMemo(() => buildMinistryDemoData(), []);

  const applyDemoData = useCallback(() => {
    setData({ dashboard: demoData.dashboard, gov: demoData.fmohGov });
    setUsingDemoData(true);
    setError('');
  }, [demoData]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    if (shouldShowPresentationDemoData()) {
      applyDemoData();
      setLoading(false);
      return;
    }
    try {
      const [dashboard, gov] = await Promise.all([
        fetchJson('/api/ng/executive-view/dashboard'),
        fetchJson('/api/ng/governance/executive-summary'),
      ]);
      setData({ dashboard, gov });
      setUsingDemoData(false);
    } catch (e) {
      if (/^(401|403)\b/.test(e.message || '')) {
        applyDemoData();
      } else {
        setUsingDemoData(false);
        setError(e.message);
      }
    } finally {
      setLoading(false);
    }
  }, [applyDemoData]);

  useEffect(() => { load(); }, [load]);

  const exec = data?.dashboard?.executive;
  const gov  = data?.gov;
  const m    = exec?.metrics || {};

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-green-50/30">
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-green-600" />
            <div>
              <h1 className="text-lg font-black text-slate-900">FMOH — National Layer</h1>
              <p className="text-xs text-slate-500">Federal Ministry of Health aggregate intelligence</p>
            </div>
          </div>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-8">
        {usingDemoData && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-3 text-center text-xs font-semibold text-amber-800">
            {PRESENTATION_DEMO_LABEL} - Abuja pilot aggregate sample for presentation only; no real patient data.
          </div>
        )}

        {error && (
          <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
        )}

        {loading && (
          <div className="py-24 text-center text-sm text-slate-400">
            <RefreshCw className="mx-auto mb-3 h-8 w-8 animate-spin text-green-400" />
            Loading national intelligence…
          </div>
        )}

        {!loading && exec && (
          <div className="space-y-8">
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-700 text-center">
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
                {gov?.programmeSpaces ?? 0} programme spaces configured. Navigate to the admin portal for full programme intelligence.
              </p>
            </div>

            <p className="text-center text-xs text-slate-400">
              DoctaRx FMOH Portal — Live government submission requires official DHIS2 credentials,
              mappings, and authorization. Data as of {new Date().toLocaleString('en-NG')}.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
