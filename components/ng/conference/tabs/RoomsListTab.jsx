'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, AlertCircle, Calendar, Users, Radio } from 'lucide-react';
import { conf, statusBadge, fmtDateTime } from '../conferenceApi';

const FILTERS = [
  { id: 'all',       label: 'All'       },
  { id: 'live',      label: 'Live'      },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'ended',     label: 'Ended'     },
  { id: 'cancelled', label: 'Cancelled' },
];

export default function RoomsListTab() {
  const [rooms, setRooms]   = useState([]);
  const [filter, setFilter] = useState('all');
  const [err, setErr]       = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true); setErr('');
    try {
      const q = filter === 'all' ? {} : { status: filter };
      const out = await conf.listRooms(q);
      setRooms(out?.rooms || []);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              filter === f.id ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200'
            }`}
          >{f.label}</button>
        ))}
        <button onClick={load} className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:text-slate-900">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {err && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <AlertCircle className="h-4 w-4" /> {err}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading rooms…</p>
      ) : rooms.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          No rooms in this view. Create one from the <strong>Schedule</strong> tab.
        </p>
      ) : (
        <ul className="space-y-2">
          {rooms.map(r => (
            <li key={r.id}>
              <Link
                href={`/ng/conference/${r.id}`}
                className="block rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-slate-900">{r.title || 'Untitled'}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusBadge(r.status)}`}>
                        {r.status}
                      </span>
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-slate-500">{r.room_code}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                      <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{fmtDateTime(r.scheduled_start || r.created_at)}</span>
                      <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />Up to {r.max_participants}</span>
                      <span className="inline-flex items-center gap-1"><Radio className="h-3.5 w-3.5" />{r.media_server}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                        {r.kind || 'consultation'}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
