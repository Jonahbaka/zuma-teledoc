'use client';

import { useEffect, useState } from 'react';
import { Search, MapPin, Star, AlertCircle, Filter } from 'lucide-react';
import { drn, fmtNaira } from '../drnApi';

const COMMON_SPECIALTIES = [
  'general_practice', 'obstetrics', 'pediatrics', 'cardiology',
  'internal_medicine', 'orthopedics', 'mental_health', 'oncology',
  'imaging_mri', 'imaging_ct', 'lab_general', 'pharmacy_fulfilment',
];

export default function MarketplaceTab() {
  const [specialty, setSpecialty] = useState('');
  const [stateCode, setStateCode] = useState('FCT');
  const [emergency, setEmergency] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function load() {
    setLoading(true); setErr('');
    try {
      const r = await drn.listings({
        specialty,
        state: stateCode,
        accepts_emergency: emergency || undefined,
      });
      setRows(r.listings || []);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grow basis-44">
            <label className="block text-xs font-semibold text-slate-500">Specialty</label>
            <select
              value={specialty} onChange={e => setSpecialty(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">Any</option>
              {COMMON_SPECIALTIES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div className="grow basis-32">
            <label className="block text-xs font-semibold text-slate-500">State</label>
            <input value={stateCode} onChange={e => setStateCode(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={emergency} onChange={e => setEmergency(e.target.checked)} />
            Emergency-capable only
          </label>
          <button onClick={load} disabled={loading}
            className="ml-auto flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">
            <Search className="h-4 w-4" />
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
      </div>

      {err && <p className="flex items-center gap-2 text-sm text-rose-700"><AlertCircle className="h-4 w-4" />{err}</p>}

      {rows.length === 0 && !loading && (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          No listings match. Adjust filters or try a different specialty.
        </p>
      )}

      <ul className="grid gap-3 md:grid-cols-2">
        {rows.map(l => (
          <li key={l.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">{l.title}</h3>
                <p className="text-xs text-slate-500">{l.org_name}</p>
              </div>
              {l.featured && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Featured</span>}
            </div>
            <p className="mt-2 text-sm text-slate-700">{l.description || `${l.specialty.replace(/_/g, ' ')} — ${l.service_kind}`}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-600">
              <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{l.org_state} · {l.org_lga || '—'}</span>
              <span className="flex items-center gap-1"><Star className="h-3 w-3 text-amber-500" />{l.acceptance_rate}% accept</span>
              <span>~{l.avg_wait_minutes || '?'} min wait</span>
              {l.accepts_emergency && <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700">Emergency</span>}
              {l.accepts_insurance && <span className="rounded-full bg-blue-100 px-2 py-0.5 font-semibold text-blue-700">Insurance</span>}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
              <span className="text-xs text-slate-500">
                {l.completed_referrals} completed of {l.total_referrals} total
              </span>
              <span className="text-sm font-bold text-slate-900">
                {fmtNaira(l.price_min_naira)} – {fmtNaira(l.price_max_naira)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
