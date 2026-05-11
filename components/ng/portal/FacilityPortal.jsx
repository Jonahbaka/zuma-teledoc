'use client';

/**
 * components/ng/portal/FacilityPortal.jsx
 * Facility-level intelligence portal — scoped to a single facility.
 * Shows consultations, referrals, pharmacy, lab, and programme intelligence
 * filtered to the facility's scope. Requires facility_admin+ for this facility.
 */

import { useState, useEffect } from 'react';
import { Building2, RefreshCw, Activity, ArrowRightLeft, Pill } from 'lucide-react';

async function fetchJson(path) {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function MetricRow({ label, value }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-2.5 last:border-0">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="text-sm font-bold text-slate-900">{value != null ? value.toLocaleString() : '—'}</span>
    </div>
  );
}

export default function FacilityPortal({ facilityId }) {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      // Load programme overview scoped to this facility
      const [overview, forecast] = await Promise.all([
        fetchJson(`/api/ng/public-health/programme/overview?facilityId=${facilityId}`),
        fetchJson(`/api/ng/public-health/forecast?metric=consultations&range=14`),
      ]);
      setData({ overview, forecast });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [facilityId]);

  const m = data?.overview?.metrics || {};

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-cyan-50/30">
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-cyan-600" />
            <div>
              <h1 className="text-lg font-black text-slate-900">Facility Intelligence</h1>
              <p className="text-xs text-slate-500">Facility-scoped aggregate health intelligence</p>
            </div>
          </div>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-700 disabled:opacity-50">
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
            <RefreshCw className="mx-auto mb-3 h-8 w-8 animate-spin text-cyan-400" />
            Loading facility intelligence…
          </div>
        ) : data ? (
          <div className="space-y-6">
            <div className="rounded-xl border border-cyan-100 bg-cyan-50 p-3 text-center text-xs text-cyan-700">
              All data is aggregate — facility scope ID: {facilityId}. No patient identifiers included.
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { icon: Activity,        label: 'Consultations',   value: m.total_consultations },
                { icon: ArrowRightLeft,  label: 'Referrals',       value: m.referrals_created   },
                { icon: Pill,            label: 'Prescriptions',   value: m.prescriptions_created },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
                  <item.icon className="mx-auto mb-2 h-6 w-6 text-cyan-500" />
                  <p className="text-2xl font-black text-slate-900">{item.value != null ? item.value.toLocaleString() : '—'}</p>
                  <p className="text-xs text-slate-500">{item.label}</p>
                </div>
              ))}
            </div>

            {data.forecast && (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-base font-black text-slate-900">14-day Consultation Forecast</h2>
                <div className="flex items-center gap-4">
                  <div>
                    <p className="text-3xl font-black text-slate-900">
                      {data.forecast.predicted_value != null ? Math.round(data.forecast.predicted_value) : '—'}
                    </p>
                    <p className="text-xs text-slate-500">predicted consultations</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    data.forecast.confidence_label === 'high'   ? 'bg-emerald-100 text-emerald-700' :
                    data.forecast.confidence_label === 'medium' ? 'bg-amber-100 text-amber-700' :
                    'bg-slate-100 text-slate-500'
                  }`}>
                    {data.forecast.confidence_label || 'insufficient_data'} confidence
                  </span>
                </div>
                <p className="mt-3 text-xs text-slate-400">
                  Planning signal only — not an outbreak prediction. Method: {data.forecast.method || '—'}.
                </p>
              </div>
            )}

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-base font-black text-slate-900">Period Metrics</h2>
              <MetricRow label="Active patients"         value={m.active_patients}         />
              <MetricRow label="New registrations"       value={m.new_patient_registrations} />
              <MetricRow label="Appointment bookings"    value={m.appointment_bookings}    />
              <MetricRow label="Follow-up appointments"  value={m.followup_appointments}   />
              <MetricRow label="Teleconsultations"       value={m.teleconsultations}       />
              <MetricRow label="Lab referrals"           value={m.lab_referrals}           />
              <MetricRow label="Pharmacy referrals"      value={m.pharmacy_referrals}      />
            </div>
          </div>
        ) : (
          <div className="py-16 text-center text-sm text-slate-400">No data available.</div>
        )}
      </div>
    </div>
  );
}
