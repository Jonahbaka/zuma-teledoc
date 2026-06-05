'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';

function statusBadge(status) {
  const s = String(status || '').replace(/_/g, ' ');
  const color =
    status === 'live' || status === 'active' || status === 'in_progress' ? 'bg-emerald-100 text-emerald-700' :
    status === 'ended' || status === 'completed' ? 'bg-slate-100 text-slate-700' :
    status === 'scheduled' ? 'bg-blue-100 text-blue-700' :
    'bg-amber-100 text-amber-700';
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${color}`}>{s || 'unknown'}</span>;
}

export default function AdminConsultationsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/ng/admin/consultations/lifecycle', { params: { limit: 50 } })
      .then((r) => setRows(Array.isArray(r.data) ? r.data : r.data?.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-emerald-200/70 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.12),transparent_35%),linear-gradient(145deg,rgba(255,255,255,0.96),rgba(236,253,245,0.92))] px-5 py-6 shadow-sm sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Admin · Lifecycle Oversight</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">Consultation → Prescription → Dispense Chain</h1>
            <p className="mt-2 text-sm text-slate-600">Every active and recent telehealth consultation linked to its EMR encounter, prescription, pharmacy dispense, and patient status.</p>
          </div>
          <Link href="/ng/admin" className="text-sm font-semibold text-emerald-700 hover:underline">← Admin Overview</Link>
        </div>
      </section>

      {loading ? (
        <div className="rounded-2xl border border-border/70 p-8 text-center text-sm text-muted-foreground">Loading lifecycle data…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          No consultation lifecycle records found. Lifecycle rows appear once a provider starts a video session linked to an appointment.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border/70">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {['Patient', 'Provider', 'Appointment', 'Call Status', 'Encounter', 'Prescription', 'Rx Status', 'Dispense', 'Patient Status'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row, i) => (
                <tr key={row.appointment_id || i} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">{row.patient_name || row.patient_id || '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{row.provider_name || row.provider_id || '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {row.appointment_id ? (
                      <Link href={`/ng/admin/providers`} className="text-emerald-700 hover:underline font-mono text-xs">{String(row.appointment_id).slice(0, 8)}…</Link>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">{statusBadge(row.room_status || row.call_status)}</td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{row.encounter_id ? String(row.encounter_id).slice(0, 8) + '…' : '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{row.prescription_id ? String(row.prescription_id).slice(0, 8) + '…' : '—'}</td>
                  <td className="px-4 py-3">{row.rx_status ? statusBadge(row.rx_status) : <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-4 py-3">{row.dispense_status ? statusBadge(row.dispense_status) : <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-4 py-3">{row.patient_status ? statusBadge(row.patient_status) : <span className="text-muted-foreground">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
