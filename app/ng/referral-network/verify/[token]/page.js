'use client';

/**
 * /ng/referral-network/verify/[token]
 * Public patient-facing landing page for QR slip scans.
 * Calls /api/ng/referral-network/public/verify-qr/:token (no auth).
 */

import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, QrCode, Phone, MapPin } from 'lucide-react';

export default function VerifyQrPage({ params }) {
  const { token } = params;
  const [state, setState] = useState({ loading: true, slip: null, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/ng/referral-network/public/verify-qr/${encodeURIComponent(token)}`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok || !body.ok) {
          setState({ loading: false, slip: null, error: body.error || 'Invalid or expired referral slip' });
        } else {
          setState({ loading: false, slip: body.slip, error: null });
        }
      } catch (e) {
        if (!cancelled) setState({ loading: false, slip: null, error: e.message });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-green-50/40 p-6">
      <div className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-md">
        <div className="mb-4 flex items-center gap-2">
          <div className="rounded-xl bg-green-600/10 p-2 text-green-700">
            <QrCode className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-black text-slate-900">DoctaRx Referral Slip</h1>
            <p className="text-xs text-slate-500">Patient-facing verification</p>
          </div>
        </div>

        {state.loading && <p className="text-sm text-slate-500">Verifying token…</p>}

        {state.error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <p className="flex items-center gap-2 font-semibold"><AlertCircle className="h-4 w-4" />Couldn’t verify slip</p>
            <p className="mt-1 text-xs">{state.error}</p>
          </div>
        )}

        {state.slip && (
          <div className="space-y-3">
            <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
              <p className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4" />Valid referral</p>
              <p className="mt-1 font-mono text-xs">{state.slip.ref_code}</p>
            </div>
            <Row label="Status" value={state.slip.status} />
            <Row label="Specialty" value={state.slip.specialty?.replace(/_/g, ' ')} />
            {state.slip.patient_name && <Row label="Patient" value={state.slip.patient_name} />}
            {state.slip.patient_phone && (
              <Row label="Phone" value={<span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{state.slip.patient_phone}</span>} />
            )}
            <Row label="Destination" value={<span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />Facility on file</span>} />
            <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              Present this slip at the destination facility reception. Slip scanned {state.slip.scan_count} time{state.slip.scan_count === 1 ? '' : 's'}.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <span className="text-sm text-slate-900">{value}</span>
    </div>
  );
}
