'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import api from '@/lib/api';
import PortalPageHeader from '@/components/branding/PortalPageHeader';
import { Button } from '@/components/ui/button';
import {
  Video, Calendar, Clock, RefreshCw,
  Search, AlertTriangle, CheckCircle2, Loader2,
  Stethoscope,
} from 'lucide-react';

const STATUS_META = {
  scheduled:   { label: 'Scheduled',   cls: 'bg-blue-50   text-blue-700   border-blue-200'    },
  confirmed:   { label: 'Confirmed',   cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  in_progress: { label: 'In Progress', cls: 'bg-amber-50  text-amber-700  border-amber-200'   },
  completed:   { label: 'Completed',   cls: 'bg-slate-100 text-slate-600  border-slate-200'   },
  cancelled:   { label: 'Cancelled',   cls: 'bg-rose-50   text-rose-600   border-rose-200'    },
  no_show:     { label: 'No Show',     cls: 'bg-orange-50 text-orange-700 border-orange-200'  },
};

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Date not recorded';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function StatCard({ value, label, color = 'blue' }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-700',
    amber: 'bg-amber-50 text-amber-700',
    slate: 'bg-slate-100 text-slate-600',
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <div className={`inline-flex items-center justify-center w-10 h-10 rounded-xl mb-3 text-lg font-extrabold ${colors[color]}`}>
        {value}
      </div>
      <p className="font-medium text-slate-600">{label}</p>
    </div>
  );
}

export default function ProviderAppointments({ market = 'ng' }) {
  const router = useRouter();
  const base = market === 'us' ? '/provider' : '/ng/provider';
  const { user } = useAuth();
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const request = useRef(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    setAppointments([]);
    try {
      const [shared, legacy] = await Promise.allSettled([
        api.get('/appointments', { params: { limit: 100, sortOrder: 'desc' }, signal: controller.signal }),
        market === 'us' ? Promise.resolve({ data: { appointments: [] } }) : (async () => {
          const { data } = await api.get('/ng/providers/me/access', { signal: controller.signal });
          const providerId = data.providerAccess?.provider?.id || data.providerAccess?.providerId || data.providerAccess?.id;
          if (!providerId) throw new Error('Provider profile is unavailable.');
          return api.get(`/ng/providers/${providerId}/appointments`, { params: { limit: 100 }, signal: controller.signal });
        })(),
      ]);
      if (controller.signal.aborted) return;
      const rows = [];
      if (shared.status === 'fulfilled' && shared.value.data.success && Array.isArray(shared.value.data.appointments)) {
        rows.push(...shared.value.data.appointments.map((row) => ({ ...row, source: 'shared', patient_name: [row.patientFirstName, row.patientLastName].filter(Boolean).join(' '), scheduled_at: row.scheduledAt, appointment_type: row.type, chief_complaint: row.reasonForVisit, patient_user_id: row.patientId })));
      }
      if (legacy.status === 'fulfilled' && Array.isArray(legacy.value.data.appointments)) rows.push(...legacy.value.data.appointments.map((row) => ({ ...row, source: 'legacy' })));
      const complete = shared.status === 'fulfilled' && shared.value.data.success && Array.isArray(shared.value.data.appointments) && legacy.status === 'fulfilled' && Array.isArray(legacy.value.data.appointments);
      if (!complete) setError('Some appointment information could not be loaded. Refresh to try again.');
      setAppointments(rows.sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at)));
    } catch (e) {
      if (!controller.signal.aborted) setError('Appointments could not be loaded. Refresh to try again.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [market]);

  useEffect(() => { load(); return () => request.current?.abort(); }, [load, user?.id]);

  const openCall = (appointment) => router.push(appointment.source === 'legacy' ? `${base}/call?appointmentId=${appointment.id}` : `${base}/appointments/${appointment.id}/call`);
  const openRecord = (appointment) => router.push(appointment.source === 'legacy' ? `${base}/patients/${appointment.patient_user_id}/ehr` : `${base}/appointments/${appointment.id}/visit`);
  const filtered = appointments.filter(a => {
    if (filter !== 'all' && a.status !== filter) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      (a.patient_name || '').toLowerCase().includes(q) ||
      (a.patient_email || '').toLowerCase().includes(q) ||
      String(a.id).includes(q)
    );
  });

  const stats = {
    upcoming: appointments.filter(a => ['scheduled', 'confirmed', 'in_progress'].includes(a.status) && (a.status === 'in_progress' || new Date(a.scheduled_at).getTime() >= Date.now())).length,
    today: appointments.filter(a => {
      if (!a.scheduled_at) return false;
      const d = new Date(a.scheduled_at);
      const now = new Date();
      return d.toDateString() === now.toDateString();
    }).length,
    completed: appointments.filter(a => a.status === 'completed').length,
    video: appointments.filter(a => ['video', 'telehealth'].includes(a.appointment_type)).length,
  };

  return (
    <div className="space-y-6">
      <PortalPageHeader eyebrow="DoctaRx · Clinical workspace" title="Appointments" description="Review scheduled care, join an active video consultation, and continue the patient record." image="/marketing/ng/hero-image-container.png">
        <Button variant="outline" onClick={load} disabled={loading}><RefreshCw size={18} className="mr-2" aria-hidden="true" />Refresh</Button>
        <Button onClick={() => router.push(base + '/call')} className="bg-blue-600 text-white hover:bg-blue-700"><Video size={18} className="mr-2" aria-hidden="true" />Video consultations</Button>
      </PortalPageHeader>
      <div className="space-y-6">
        {error && <p role="alert" className="portal-error">{error}</p>}
        <p className="text-slate-600">Counts reflect the appointments loaded in this view.</p>
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard value={loading || error ? '—' : stats.upcoming} label="Upcoming" />
          <StatCard value={loading || error ? '—' : stats.today} label="Today" />
          <StatCard value={loading || error ? '—' : stats.completed} label="Completed" color="slate" />
          <StatCard value={loading || error ? '—' : stats.video} label="Video consultations" />
        </div>

        {/* Filters */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-col sm:flex-row gap-3 items-center">
          <div className="relative w-full flex-1 sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" size={16} />
            <input
              value={query}
              aria-label="Search appointments by patient name or identifier"
              onChange={e => setQuery(e.target.value)}
              placeholder="Search patient name or ID…"
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-base focus:ring-2 focus:ring-blue-400 outline-none"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {['all', 'scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled'].map(s => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                aria-pressed={filter === s}
                className={`px-3 py-1.5 rounded-xl text-base font-bold border transition-colors ${
                  filter === s
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                }`}
              >
                {s === 'all' ? 'All' : STATUS_META[s]?.label || s}
              </button>
            ))}
          </div>
        </div>

        {/* Appointment list */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {loading ? (
            <div role="status" className="flex flex-col items-center justify-center py-20 text-slate-600">
              <Loader2 size={32} className="animate-spin mb-3 text-blue-500" />
              <p className="text-base">Loading appointments…</p>
            </div>
          ) : error && appointments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-rose-500">
              <AlertTriangle size={32} className="mb-3" />
              <p className="font-semibold text-center max-w-sm">Appointment data is unavailable.</p>
              <button onClick={load} className="mt-3 text-base text-blue-600 underline">Retry</button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-600">
              <Calendar size={40} className="mb-3 opacity-30" />
              <p className="font-medium">{query || filter !== 'all' ? 'No appointments match these filters.' : 'No appointments are available in this view.'}</p>
              {filter !== 'all' && (
                <button onClick={() => setFilter('all')} className="mt-2 text-base text-blue-600 underline">
                  Clear filter
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Mobile cards */}
              <div className="sm:hidden divide-y divide-slate-100">
                {filtered.map(appt => {
                  const meta = STATUS_META[appt.status] || { label: 'Status not recorded', cls: 'bg-slate-100 text-slate-700 border-slate-200' };
                  const isVideo = ['video', 'telehealth'].includes(appt.appointment_type);
                  const isActive = ['scheduled', 'confirmed', 'in_progress'].includes(appt.status);
                  const name = appt.patient_name || appt.patient_email || `Patient`;
                  return (
                    <div key={`${appt.source}:${appt.id}`} className="p-4 flex items-start gap-4">
                      <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-base shrink-0">
                        {name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-bold text-slate-900 text-base truncate">{name}</p>
                          <span className={`shrink-0 px-2 py-0.5 text-base font-bold rounded border ${meta.cls}`}>{meta.label}</span>
                        </div>
                        <p className="text-base text-slate-500 mt-1">{fmtDate(appt.scheduled_at)}</p>
                        {appt.chief_complaint && <p className="text-base text-slate-600 mt-0.5 truncate">{appt.chief_complaint}</p>}
                        {isActive && isVideo && (
                          <button
                            onClick={() => openCall(appt)}
                            className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-base font-bold rounded-lg"
                          >
                            <Video size={18} /> Join Call
                          </button>
                        )}
                        {(appt.source === 'shared' || appt.patient_user_id) && <Button variant="outline" className="mt-3" onClick={() => openRecord(appt)}>{appt.source === 'legacy' ? 'Health record' : 'Open encounter'}</Button>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop table */}
              <div className="hidden overflow-x-auto sm:block"><table className="w-full min-w-[760px] text-left">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-base font-extrabold text-slate-500 uppercase tracking-wider">
                    <th className="px-6 py-3">Patient</th>
                    <th className="px-6 py-3">Date &amp; Time</th>
                    <th className="px-6 py-3">Type</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(appt => {
                    const meta = STATUS_META[appt.status] || { label: 'Status not recorded', cls: 'bg-slate-100 text-slate-700 border-slate-200' };
                    const isVideo = ['video', 'telehealth'].includes(appt.appointment_type);
                    const isActive = ['scheduled', 'confirmed', 'in_progress'].includes(appt.status);
                    const name = appt.patient_name || appt.patient_email || `Patient`;
                    return (
                      <tr key={`${appt.source}:${appt.id}`} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 font-bold text-base flex items-center justify-center shrink-0">
                              {name.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-semibold text-slate-900 text-base">{name}</div>
                              {appt.chief_complaint && (
                                <div className="text-base text-slate-600 mt-0.5 truncate max-w-[200px]">{appt.chief_complaint}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-1.5 text-base text-slate-700 font-medium">
                            <Clock size={18} className="text-slate-600" />
                            {fmtDate(appt.scheduled_at)}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-1.5 text-base text-slate-600">
                            {isVideo
                              ? <Video size={18} className="text-blue-500" />
                              : <Stethoscope size={18} className="text-slate-600" />
                            }
                            <span className="capitalize">{appt.appointment_type?.replace('_', ' ') || 'Consultation'}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2.5 py-1 text-base font-bold rounded-md border ${meta.cls}`}>
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {isActive && isVideo && (
                              <button
                                onClick={() => openCall(appt)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700 text-white text-base font-bold rounded-lg shadow-sm transition-all"
                              >
                                <Video size={18} /> Join Call
                              </button>
                            )}
                            {(appt.source === 'shared' || appt.patient_user_id) && (
                              <button
                                onClick={() => openRecord(appt)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-base font-bold rounded-lg transition-colors"
                              >
                                <CheckCircle2 size={18} aria-hidden="true" />{appt.source === 'legacy' ? 'Health record' : 'Open encounter'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
