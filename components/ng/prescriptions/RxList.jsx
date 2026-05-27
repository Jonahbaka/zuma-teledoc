'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, AlertCircle, Pill, User, Calendar } from 'lucide-react';
import { rx, statusBadge, STATUS_LABELS, fmtDate } from './rxApi';

const STATUS_FILTERS = [
  { id: '',                    label: 'All'       },
  { id: 'drafted',             label: 'Drafts'    },
  { id: 'signed',              label: 'Signed'    },
  { id: 'sent_to_pharmacy',    label: 'Sent'      },
  { id: 'received',            label: 'Ack'       },
  { id: 'partially_dispensed', label: 'Partial'   },
  { id: 'fully_dispensed',     label: 'Dispensed' },
  { id: 'completed',           label: 'Done'      },
  { id: 'cancelled',           label: 'Cancelled' },
];

export default function RxList({ scope = 'doctor', providerId, pharmacyId }) {
  const [rows, setRows]       = useState([]);
  const [filter, setFilter]   = useState('');
  const [err, setErr]         = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true); setErr('');
    try {
      const q = {};
      if (scope === 'doctor'   && providerId) q.provider_id = providerId;
      if (scope === 'pharmacy' && pharmacyId) q.pharmacy_id = pharmacyId;
      if (filter) q.status = filter;
      const out = await rx.list(q);
      setRows(out?.prescriptions || []);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter, scope, providerId, pharmacyId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map(f => (
          <button key={f.id || 'all'}
                  onClick={() => setFilter(f.id)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    filter === f.id ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200'
                  }`}>
            {f.label}
          </button>
        ))}
        <button onClick={load} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:text-slate-900">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {err && <p className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertCircle className="h-4 w-4" />{err}</p>}

      {loading ? (
        <p className="text-sm text-slate-500">Loading prescriptions…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          {scope === 'doctor'
            ? 'No prescriptions match this filter. Use the Compose tab to write a new one.'
            : 'No prescriptions awaiting this pharmacy for the chosen filter.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map(p => (
            <li key={p.id}>
              <Link href={`/ng/prescriptions/${p.id}`}
                    className="block rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Pill className="h-4 w-4 text-slate-400" />
                      <span className="font-mono text-xs font-semibold text-slate-700">{p.prescription_number}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusBadge(p.lifecycle_status)}`}>
                        {STATUS_LABELS[p.lifecycle_status] || p.lifecycle_status}
                      </span>
                      {p.is_controlled && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">CONTROLLED</span>}
                    </div>
                    <p className="mt-1 text-sm font-semibold text-slate-800 truncate">{p.diagnosis || '(no diagnosis)'}</p>
                  </div>
                  <div className="text-right text-[11px] text-slate-500 space-y-0.5">
                    <p className="inline-flex items-center gap-1"><User className="h-3 w-3" />pt {String(p.patient_user_id).slice(0, 8)}…</p>
                    <p className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />{fmtDate(p.created_at)}</p>
                    <p>{p.item_count} item{p.item_count === 1 ? '' : 's'}</p>
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
