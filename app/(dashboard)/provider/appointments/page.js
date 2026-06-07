'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import {
  Video, Calendar, Clock, User, ChevronRight, RefreshCw,
  Search, Filter, Plus, CheckCircle2, AlertTriangle, Loader2,
} from 'lucide-react';

const STATUS_META = {
  scheduled:  { label: 'Scheduled',   cls: 'bg-blue-50   text-blue-700   border-blue-200'   },
  confirmed:  { label: 'Confirmed',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  in_progress:{ label: 'In Progress', cls: 'bg-amber-50  text-amber-700  border-amber-200'  },
  completed:  { label: 'Completed',   cls: 'bg-slate-100 text-slate-600  border-slate-200'  },
  cancelled:  { label: 'Cancelled',   cls: 'bg-rose-50   text-rose-600   border-rose-200'   },
  no_show:    { label: 'No Show',     cls: 'bg-orange-50 text-orange-700 border-orange-200' },
};

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) +
    ' at ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ProviderAppointmentsPage() {
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
      const providerId = meData.providerAccess?.provider?.id ||
        meData.providerAccess?.providerId || meData.providerAccess?.id;
      if (!providerId) throw new Error('Provider profile not found');
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
    if (query) {
      const q = query.toLowerCase();
      return (a.patient_name || '').toLowerCase().includes(q) ||
        (a.patient_email || '').toLowerCase().includes(q) ||
        String(a.id).includes(q);
    }
    return true;
  });

  const upcoming = appointments.filter(a => ['scheduled', 'confirmed'].includes(a.status)).length;
  const completed = appointments.filter(a => a.status === 'completed').length;

  return (
    <div className="min-h-screen bg-slate-50 p-6 font-sans">
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Appointments</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {upcoming} upcoming · {completed} completed today
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={load}
            className="p-2 text-slate-500 hover:bg-white border border-slate-200 rounded-lg shadow-sm"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => router.push('/provider/call')}
            className="flex items-center px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-lg shadow-sm gap-2"
          >
            <Video size={16} /> Start Ad-hoc Call
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm mb-6 p-4 flex flex-col sm:flex-row gap-3 items-center">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search patient name or ID…"
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-400 outline-none"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {['all', 'scheduled', 'confirmed', 'completed', 'cancelled'].map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                filter === s
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
              }`}
            >
              {s === 'all' ? 'All' : STATUS_META[s]?.label || s}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <Loader2 size={32} className="animate-spin mb-3" />
            <p className="text-sm">Loading appointments…</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20 text-rose-500">
            <AlertTriangle size={32} className="mb-3" />
            <p className="text-sm font-semibold">{error}</p>
            <button onClick={load} className="mt-3 text-xs text-indigo-600 underline">Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <Calendar size={40} className="mb-3 opacity-30" />
            <p className="text-sm font-medium">No appointments found</p>
          </div>
        ) : (
          <table className="w-full text-left">
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
              {filtered.map((appt) => {
                const meta = STATUS_META[appt.status] || STATUS_META.scheduled;
                const isVideo = ['video', 'telehealth'].includes(appt.appointment_type);
                const isActive = ['scheduled', 'confirmed', 'in_progress'].includes(appt.status);
                const name = appt.patient_name || appt.patient_email || `Patient ${appt.patient_user_id?.slice(0, 6) || ''}`;
                return (
                  <tr key={appt.id} className="hover:bg-slate-50/60 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 font-bold text-sm flex items-center justify-center shrink-0">
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
                        {isVideo ? <Video size={14} className="text-blue-500" /> : <User size={14} className="text-slate-400" />}
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
                            onClick={() => router.push(`/provider/appointments/${appt.id}/call`)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-sm"
                          >
                            <Video size={12} /> Join Call
                          </button>
                        )}
                        {appt.status === 'completed' && (
                          <button
                            onClick={() => router.push(`/provider/appointments/${appt.id}/visit`)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg"
                          >
                            <CheckCircle2 size={12} /> View Notes
                          </button>
                        )}
                        <button
                          onClick={() => router.push(`/provider/appointments/${appt.id}/call`)}
                          className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
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
        )}
      </div>
    </div>
  );
}
