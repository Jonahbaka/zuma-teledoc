'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import {
  Video, Calendar, Clock, User, ChevronRight, RefreshCw,
  Search, AlertTriangle, CheckCircle2, Loader2, Activity,
  ChevronLeft, Plus, Stethoscope,
} from 'lucide-react';

const STATUS_META = {
  scheduled:   { label: 'Scheduled',   cls: 'bg-blue-50   text-blue-700   border-blue-200'    },
  confirmed:   { label: 'Confirmed',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  in_progress: { label: 'In Progress', cls: 'bg-amber-50  text-amber-700  border-amber-200'   },
  completed:   { label: 'Completed',   cls: 'bg-slate-100 text-slate-600  border-slate-200'   },
  cancelled:   { label: 'Cancelled',   cls: 'bg-rose-50   text-rose-600   border-rose-200'    },
  no_show:     { label: 'No Show',     cls: 'bg-orange-50 text-orange-700 border-orange-200'  },
};

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function StatCard({ value, label, color = 'indigo' }) {
  const colors = {
    indigo: 'bg-indigo-50 text-indigo-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    slate: 'bg-slate-100 text-slate-600',
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <div className={`inline-flex items-center justify-center w-10 h-10 rounded-xl mb-3 text-lg font-extrabold ${colors[color]}`}>
        {value}
      </div>
      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{label}</p>
    </div>
  );
}

export default function NGProviderAppointmentsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const meRes = await fetch('/api/ng/providers/me/access');
      const meData = meRes.ok ? await meRes.json() : {};
      const providerId =
        meData.providerAccess?.provider?.id ||
        meData.providerAccess?.providerId ||
        meData.providerAccess?.id;
      if (!providerId) throw new Error('Provider profile not found. Please complete your profile setup.');
      const res = await fetch(`/api/ng/providers/${providerId}/appointments?limit=100`);
      if (!res.ok) throw new Error('Failed to load appointments');
      const d = await res.json();
      setAppointments(d.appointments || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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
    upcoming: appointments.filter(a => ['scheduled', 'confirmed'].includes(a.status)).length,
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
    <div className="min-h-screen bg-slate-50 font-sans">
      {/* Top bar */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/ng/provider/dashboard')}
              className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 border border-slate-200 transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center shadow-sm">
                  <Activity size={16} className="text-white" />
                </div>
                <span className="font-extrabold text-slate-900 text-lg tracking-tight">DoctaRx</span>
                <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">Nigeria · Provider</span>
              </div>
              <p className="text-sm font-bold text-slate-800 mt-1">Appointments</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={load}
              className="p-2 text-slate-500 hover:bg-slate-100 border border-slate-200 rounded-lg shadow-sm"
              title="Refresh"
            >
              <RefreshCw size={16} />
            </button>
            <button
              onClick={() => router.push('/ng/provider/call')}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-sm font-bold rounded-xl shadow-md shadow-emerald-200 transition-all"
            >
              <Video size={16} /> Start Video Call
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard value={stats.upcoming} label="Upcoming" color="indigo" />
          <StatCard value={stats.today} label="Today" color="emerald" />
          <StatCard value={stats.completed} label="Completed" color="slate" />
          <StatCard value={stats.video} label="Telehealth" color="amber" />
        </div>

        {/* Filters */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-col sm:flex-row gap-3 items-center">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search patient name or ID…"
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-400 outline-none"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {['all', 'scheduled', 'confirmed', 'completed', 'cancelled'].map(s => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                  filter === s
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300'
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
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <Loader2 size={32} className="animate-spin mb-3 text-emerald-500" />
              <p className="text-sm">Loading appointments…</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-20 text-rose-500">
              <AlertTriangle size={32} className="mb-3" />
              <p className="text-sm font-semibold text-center max-w-sm">{error}</p>
              <button onClick={load} className="mt-3 text-xs text-emerald-600 underline">Retry</button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <Calendar size={40} className="mb-3 opacity-30" />
              <p className="text-sm font-medium">No appointments found</p>
              {filter !== 'all' && (
                <button onClick={() => setFilter('all')} className="mt-2 text-xs text-emerald-600 underline">
                  Clear filter
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Mobile cards */}
              <div className="sm:hidden divide-y divide-slate-100">
                {filtered.map(appt => {
                  const meta = STATUS_META[appt.status] || STATUS_META.scheduled;
                  const isVideo = ['video', 'telehealth'].includes(appt.appointment_type);
                  const isActive = ['scheduled', 'confirmed', 'in_progress'].includes(appt.status);
                  const name = appt.patient_name || appt.patient_email || `Patient`;
                  return (
                    <div key={appt.id} className="p-4 flex items-start gap-4">
                      <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 font-bold flex items-center justify-center text-sm shrink-0">
                        {name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-bold text-slate-900 text-sm truncate">{name}</p>
                          <span className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded border ${meta.cls}`}>{meta.label}</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">{fmtDate(appt.scheduled_at)}</p>
                        {appt.chief_complaint && <p className="text-xs text-slate-400 mt-0.5 truncate">{appt.chief_complaint}</p>}
                        {isActive && isVideo && (
                          <button
                            onClick={() => router.push(`/ng/provider/appointments/${appt.id}/call`)}
                            className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg"
                          >
                            <Video size={12} /> Join Call
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop table */}
              <table className="w-full text-left hidden sm:table">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-xs font-extrabold text-slate-500 uppercase tracking-wider">
                    <th className="px-6 py-3">Patient</th>
                    <th className="px-6 py-3">Date &amp; Time</th>
                    <th className="px-6 py-3">Type</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(appt => {
                    const meta = STATUS_META[appt.status] || STATUS_META.scheduled;
                    const isVideo = ['video', 'telehealth'].includes(appt.appointment_type);
                    const isActive = ['scheduled', 'confirmed', 'in_progress'].includes(appt.status);
                    const name = appt.patient_name || appt.patient_email || `Patient`;
                    return (
                      <tr key={appt.id} className="hover:bg-slate-50/60 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 font-bold text-sm flex items-center justify-center shrink-0">
                              {name.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-semibold text-slate-900 text-sm">{name}</div>
                              {appt.chief_complaint && (
                                <div className="text-xs text-slate-400 mt-0.5 truncate max-w-[200px]">{appt.chief_complaint}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-1.5 text-sm text-slate-700 font-medium">
                            <Clock size={14} className="text-slate-400" />
                            {fmtDate(appt.scheduled_at)}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-1.5 text-sm text-slate-600">
                            {isVideo
                              ? <Video size={14} className="text-emerald-500" />
                              : <Stethoscope size={14} className="text-slate-400" />
                            }
                            <span className="capitalize">{appt.appointment_type?.replace('_', ' ') || 'Consultation'}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2.5 py-1 text-xs font-bold rounded-md border ${meta.cls}`}>
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {isActive && isVideo && (
                              <button
                                onClick={() => router.push(`/ng/provider/appointments/${appt.id}/call`)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-bold rounded-lg shadow-sm transition-all"
                              >
                                <Video size={12} /> Join Call
                              </button>
                            )}
                            {appt.status === 'completed' && (
                              <button
                                onClick={() => router.push(`/ng/provider/appointments/${appt.id}/visit`)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors"
                              >
                                <CheckCircle2 size={12} /> View Notes
                              </button>
                            )}
                            <button
                              onClick={() => router.push(`/ng/provider/appointments/${appt.id}/call`)}
                              className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                            >
                              <ChevronRight size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
