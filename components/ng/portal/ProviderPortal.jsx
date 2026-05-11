'use client';

/**
 * components/ng/portal/ProviderPortal.jsx
 * Provider intelligence portal — workload, responsiveness, programme participation.
 * Requires provider or facility_admin role.
 */

import { useState, useEffect } from 'react';
import { Users, RefreshCw, Activity, Video } from 'lucide-react';

async function fetchJson(path) {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export default function ProviderPortal() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const overview = await fetchJson('/api/ng/public-health/programme/overview');
      setData(overview);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const m = data?.metrics || {};

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-violet-50/30">
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-violet-600" />
            <div>
              <h1 className="text-lg font-black text-slate-900">Provider Intelligence</h1>
              <p className="text-xs text-slate-500">Workload, activity, and programme participation</p>
            </div>
          </div>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-6 py-8">
        {error && (
          <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
        )}

        {loading ? (
          <div className="py-16 text-center text-sm text-slate-400">
            <RefreshCw className="mx-auto mb-3 h-8 w-8 animate-spin text-violet-400" />
            Loading provider intelligence…
          </div>
        ) : data ? (
          <div className="space-y-6">
            <div className="rounded-xl border border-violet-100 bg-violet-50 p-3 text-center text-xs text-violet-700">
              Aggregate provider metrics. No patient identifiers included.
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { icon: Users,    label: 'Active providers',    value: m.active_providers    },
                { icon: Activity, label: 'Total consultations', value: m.total_consultations  },
                { icon: Video,    label: 'Teleconsultations',   value: m.teleconsultations    },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
                  <item.icon className="mx-auto mb-2 h-6 w-6 text-violet-500" />
                  <p className="text-2xl font-black text-slate-900">{item.value != null ? item.value.toLocaleString() : '—'}</p>
                  <p className="text-xs text-slate-500">{item.label}</p>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-base font-black text-slate-900">Workload Metrics</h2>
              {[
                { label: 'Consultations per provider',      value: data.provider?.consultationsPerProvider },
                { label: 'Teleconsultations per provider',  value: data.provider?.teleconsultationsPerProvider },
                { label: 'Provider workload score',         value: data.provider?.providerWorkloadScore },
                { label: 'Capacity warnings',               value: data.provider?.providerCapacityWarnings },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between border-b border-slate-100 py-2.5 last:border-0">
                  <span className="text-sm text-slate-600">{label}</span>
                  <span className="text-sm font-bold text-slate-900">{value != null ? value : '—'}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="py-16 text-center text-sm text-slate-400">No data available.</div>
        )}
      </div>
    </div>
  );
}
