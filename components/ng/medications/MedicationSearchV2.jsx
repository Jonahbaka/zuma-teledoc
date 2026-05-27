'use client';

/**
 * components/ng/medications/MedicationSearchV2.jsx
 * Demo-grade medication search with:
 *   - debounced autocomplete (alias-first)
 *   - relevance-ranked result list
 *   - drug interaction checker for a working basket
 * Calls /api/ng/medications/* (no auth required).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, Pill, Plus, X, AlertTriangle, ShieldAlert,
  Sparkles, CheckCircle2, Loader2,
} from 'lucide-react';

const SEVERITY_TONE = {
  contraindicated: 'bg-rose-600 text-white',
  high:            'bg-rose-100 text-rose-900',
  moderate:        'bg-amber-100 text-amber-900',
  low:             'bg-sky-100 text-sky-900',
};

const MATCHED_VIA_BADGE = {
  exact:  'bg-emerald-100 text-emerald-800',
  prefix: 'bg-blue-100 text-blue-800',
  alias:  'bg-violet-100 text-violet-800',
  fuzzy:  'bg-slate-100 text-slate-700',
};

async function api(path) {
  const res = await fetch(path);
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) throw new Error(body?.error || `${res.status}`);
  return body;
}
async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `${res.status}`);
  return data;
}

export default function MedicationSearchV2() {
  const [q, setQ] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSugg, setShowSugg] = useState(false);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [basket, setBasket] = useState([]);
  const [interactions, setInteractions] = useState([]);
  const [checking, setChecking] = useState(false);
  const debounceRef = useRef(null);

  // Debounced autocomplete on q
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q || q.length < 2) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await api(`/api/ng/medications/autocomplete?q=${encodeURIComponent(q)}&limit=8`);
        setSuggestions(data.suggestions || []);
        setShowSugg(true);
      } catch { /* swallow autocomplete errors */ }
    }, 180);
    return () => clearTimeout(debounceRef.current);
  }, [q]);

  async function runSearch(text) {
    setLoading(true); setErr(''); setShowSugg(false);
    try {
      const data = await api(`/api/ng/medications/search?q=${encodeURIComponent(text || q)}&limit=20`);
      setResults(data.medicines || []);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  function addToBasket(m) {
    const generic = (m.generic_name || m.name || '').toLowerCase().trim();
    if (!generic) return;
    if (basket.some(b => b.generic === generic)) return;
    setBasket(b => [...b, { id: m.id, name: m.name, generic, strength: m.strength }]);
  }

  function removeFromBasket(generic) {
    setBasket(b => b.filter(x => x.generic !== generic));
  }

  // Re-check interactions whenever basket changes
  useEffect(() => {
    if (basket.length < 2) { setInteractions([]); return; }
    let cancelled = false;
    (async () => {
      setChecking(true);
      try {
        const data = await apiPost('/api/ng/medications/check-interactions', {
          generics: basket.map(b => b.generic),
        });
        if (!cancelled) setInteractions(data.interactions || []);
      } catch (e) {
        if (!cancelled) setErr(e.message);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [basket]);

  const worstSeverity = useMemo(() => {
    const rank = { contraindicated: 4, high: 3, moderate: 2, low: 1 };
    return interactions.reduce((max, i) => Math.max(max, rank[i.severity] || 0), 0);
  }, [interactions]);

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <header className="flex items-center gap-3">
        <div className="rounded-xl bg-green-600/10 p-2 text-green-700">
          <Pill className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-black text-slate-900">Medication Search</h1>
          <p className="text-xs text-slate-500">
            Nigerian brand-aware · fuzzy · with interaction checker
          </p>
        </div>
      </header>

      <div className="relative">
        <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm focus-within:border-green-500">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            value={q} onChange={e => setQ(e.target.value)}
            onFocus={() => setShowSugg(true)}
            onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
            placeholder="Try: Coartem, Augmentin, amox 500mg, panadol, ors…"
            className="w-full bg-transparent text-base outline-none"
          />
          {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
          <button onClick={() => runSearch()} disabled={loading || !q}
            className="rounded-lg bg-green-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">
            Search
          </button>
        </div>

        {showSugg && suggestions.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
            {suggestions.map((s, i) => (
              <li key={`${s.suggestion}-${i}`}>
                <button onClick={() => { setQ(s.suggestion); runSearch(s.suggestion); }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50">
                  <span className="flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                    <span className="font-semibold text-slate-900">{s.suggestion}</span>
                    {s.resolves_to && s.resolves_to.toLowerCase() !== s.suggestion.toLowerCase() && (
                      <span className="text-xs text-slate-500">→ {s.resolves_to}</span>
                    )}
                  </span>
                  <span className="text-[10px] uppercase text-slate-400">{s.kind}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {err && <p className="flex items-center gap-2 text-sm text-rose-700"><AlertTriangle className="h-4 w-4" />{err}</p>}

      <section className="grid gap-5 md:grid-cols-[1fr_320px]">
        <div className="space-y-2">
          {results.length === 0 && !loading && (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
              Search for any medication, brand, or generic. Try a Nigerian brand like <strong>Coartem</strong> or <strong>Augmentin</strong>.
            </p>
          )}
          {results.map(m => (
            <article key={m.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">{m.name}</h3>
                    {m.matched_alias && (
                      <span className="text-xs italic text-violet-700">via "{m.matched_alias}"</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    {m.generic_name && <span>generic: <strong>{m.generic_name}</strong></span>}
                    {m.brand_name && m.brand_name !== m.name && <span> · brand: {m.brand_name}</span>}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {m.dosage_form} · {m.strength}
                    {m.therapeutic_class && <span> · {m.therapeutic_class}</span>}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${MATCHED_VIA_BADGE[m.matched_via] || ''}`}>
                    {m.matched_via}
                  </span>
                  <span className="text-xs font-mono text-slate-400">{m.relevance}</span>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                {m.requires_prescription && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">Rx</span>}
                {m.otc_candidate && <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">OTC</span>}
                {m.controlled && <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-800">Controlled</span>}
                {m.nhia_listed && <span className="rounded-full bg-blue-100 px-2 py-0.5 font-semibold text-blue-800">NHIA</span>}
                {m.price_ngn != null && <span className="ml-auto font-semibold text-slate-900">₦{Number(m.price_ngn).toLocaleString('en-NG')}</span>}
                <button onClick={() => addToBasket(m)}
                  className="ml-auto flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold hover:bg-slate-50">
                  <Plus className="h-3 w-3" />Add to basket
                </button>
              </div>
            </article>
          ))}
        </div>

        <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Prescription basket</h3>
            {basket.length > 0 && (
              <button onClick={() => setBasket([])} className="text-xs text-slate-500 hover:text-slate-900">Clear</button>
            )}
          </div>
          {basket.length === 0 && (
            <p className="text-xs text-slate-500">Add ≥2 drugs to check interactions.</p>
          )}
          <ul className="space-y-1">
            {basket.map(b => (
              <li key={b.generic} className="flex items-center justify-between rounded-lg bg-slate-50 px-2 py-1.5 text-sm">
                <div>
                  <p className="font-semibold text-slate-900">{b.name}</p>
                  <p className="text-[10px] text-slate-500">{b.generic} {b.strength ? `· ${b.strength}` : ''}</p>
                </div>
                <button onClick={() => removeFromBasket(b.generic)} className="text-slate-400 hover:text-rose-700">
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>

          {basket.length >= 2 && (
            <div className="mt-4">
              <div className="mb-2 flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-slate-500" />
                <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Interactions {checking && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />}
                </span>
              </div>
              {interactions.length === 0 && !checking && (
                <p className="flex items-center gap-1 text-xs text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />No known interactions.
                </p>
              )}
              <ul className="space-y-2">
                {interactions.map((i, idx) => (
                  <li key={idx} className="rounded-lg border border-slate-200 p-2 text-xs">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-mono text-[11px] text-slate-700">{i.a} ↔ {i.b}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${SEVERITY_TONE[i.severity] || ''}`}>{i.severity}</span>
                    </div>
                    {i.effect      && <p className="text-slate-700"><strong>Effect:</strong> {i.effect}</p>}
                    {i.mechanism   && <p className="text-slate-500"><strong>Mechanism:</strong> {i.mechanism}</p>}
                    {i.management  && <p className="text-slate-700"><strong>Management:</strong> {i.management}</p>}
                  </li>
                ))}
              </ul>
              {worstSeverity >= 3 && (
                <p className="mt-2 rounded-lg bg-rose-50 p-2 text-xs font-semibold text-rose-800">
                  ⚠ High-severity interaction(s) present — review before prescribing.
                </p>
              )}
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}
