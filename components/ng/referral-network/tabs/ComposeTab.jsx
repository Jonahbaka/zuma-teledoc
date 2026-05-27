'use client';

import { useState } from 'react';
import { Send, Sparkles, AlertCircle, CheckCircle2, QrCode } from 'lucide-react';
import { drn, fmtNaira, urgencyBadge } from '../drnApi';

const URGENCIES = ['routine', 'urgent', 'emergency'];

export default function ComposeTab() {
  const [form, setForm] = useState({
    specialty: 'cardiology',
    urgency: 'routine',
    reason: '',
    clinical_summary: '',
    patient_name: '',
    patient_phone: '',
    patient_age: '',
    patient_sex: '',
    prefer_state: 'FCT',
    prefer_lga: 'AMAC',
    max_price: '',
    accepts_insurance: false,
  });

  const [matches, setMatches] = useState([]);
  const [chosen, setChosen] = useState(null);
  const [created, setCreated] = useState(null);
  const [qr, setQr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function patch(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function runMatch() {
    setBusy(true); setErr(''); setChosen(null); setMatches([]);
    try {
      const r = await drn.match({
        specialty: form.specialty,
        urgency: form.urgency,
        prefer_state: form.prefer_state,
        prefer_lga: form.prefer_lga,
        max_price: form.max_price ? Number(form.max_price) : undefined,
        accepts_insurance: form.accepts_insurance,
      });
      setMatches(r.matches || []);
      if (!r.matches?.length) setErr('No specialists matched. Try widening filters.');
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function submit() {
    setBusy(true); setErr('');
    try {
      const created = await drn.createReferral({
        specialty: form.specialty,
        urgency: form.urgency,
        reason: form.reason,
        clinical_summary: form.clinical_summary,
        patient_name: form.patient_name || undefined,
        patient_phone: form.patient_phone || undefined,
        patient_age: form.patient_age ? Number(form.patient_age) : undefined,
        patient_sex: form.patient_sex || undefined,
        destination_org: chosen?.organization_id,
        destination_listing: chosen?.id,
        match_score: chosen?.score,
        match_reasoning_json: chosen ? { reasons: chosen.reasons, scored_at: new Date().toISOString() } : undefined,
        service_fee_naira: chosen?.price_max_naira ?? chosen?.price_min_naira ?? undefined,
      });
      // Auto-advance draft → sent
      await drn.transition(created.referral.id, { to_status: 'sent', notes: 'auto-sent on creation' });
      setCreated(created.referral);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function mintQr() {
    if (!created) return;
    setBusy(true); setErr('');
    try {
      const r = await drn.mintQr(created.id, { scope: 'patient_slip', ttlDays: 30 });
      setQr(r);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-bold text-slate-900">Patient & clinical context</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Patient name"><input value={form.patient_name} onChange={e => patch('patient_name', e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></Field>
          <Field label="Phone"><input value={form.patient_phone} onChange={e => patch('patient_phone', e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></Field>
          <Field label="Age"><input type="number" value={form.patient_age} onChange={e => patch('patient_age', e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></Field>
          <Field label="Sex">
            <select value={form.patient_sex} onChange={e => patch('patient_sex', e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="">—</option><option>female</option><option>male</option><option>other</option>
            </select>
          </Field>
          <Field label="Specialty"><input value={form.specialty} onChange={e => patch('specialty', e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></Field>
          <Field label="Urgency">
            <div className="flex gap-2">
              {URGENCIES.map(u => (
                <button key={u} onClick={() => patch('urgency', u)} type="button"
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${form.urgency === u ? urgencyBadge(u) : 'bg-slate-100 text-slate-700'}`}>
                  {u}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Reason for referral" full>
            <input value={form.reason} onChange={e => patch('reason', e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder="e.g. uncontrolled hypertension with proteinuria" />
          </Field>
          <Field label="Clinical summary" full>
            <textarea rows={3} value={form.clinical_summary} onChange={e => patch('clinical_summary', e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </Field>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">AI specialist matching</h3>
          <button onClick={runMatch} disabled={busy}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            <Sparkles className="h-4 w-4" />
            {busy ? 'Matching…' : 'Find matches'}
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Prefer state"><input value={form.prefer_state} onChange={e => patch('prefer_state', e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></Field>
          <Field label="Prefer LGA"><input value={form.prefer_lga} onChange={e => patch('prefer_lga', e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></Field>
          <Field label="Max price (₦)"><input type="number" value={form.max_price} onChange={e => patch('max_price', e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></Field>
        </div>

        {matches.length > 0 && (
          <ul className="mt-4 space-y-2">
            {matches.slice(0, 8).map(m => (
              <li key={m.id} onClick={() => setChosen(m)}
                className={`cursor-pointer rounded-xl border p-3 transition ${chosen?.id === m.id ? 'border-green-500 bg-green-50' : 'border-slate-200 hover:border-slate-300'}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-bold text-slate-900">{m.title} <span className="text-xs font-normal text-slate-500">· {m.org_name}</span></p>
                    <p className="mt-1 text-xs text-slate-600">{m.reasons.join(' · ')}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-black text-green-700">{m.score}</p>
                    <p className="text-[10px] text-slate-400">match</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  <span>{fmtNaira(m.price_min_naira)} – {fmtNaira(m.price_max_naira)}</span>
                  <span>~{m.avg_wait_minutes || '?'} min wait</span>
                  <span>{m.acceptance_rate}% accept</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {err && <p className="flex items-center gap-2 text-sm text-rose-700"><AlertCircle className="h-4 w-4" />{err}</p>}

      {!created && (
        <div className="flex items-center justify-end">
          <button onClick={submit} disabled={busy || !form.reason || !form.specialty}
            className="flex items-center gap-2 rounded-xl bg-green-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-50">
            <Send className="h-4 w-4" />
            {busy ? 'Sending…' : 'Send referral'}
          </button>
        </div>
      )}

      {created && (
        <section className="rounded-2xl border border-emerald-300 bg-emerald-50 p-5">
          <div className="flex items-center gap-2 text-emerald-800">
            <CheckCircle2 className="h-5 w-5" />
            <h3 className="text-sm font-bold">Referral sent — {created.ref_code}</h3>
          </div>
          <p className="mt-1 text-xs text-emerald-700">
            The receiving facility has been notified. You can mint a QR slip for the patient to present on arrival.
          </p>
          {!qr ? (
            <button onClick={mintQr} disabled={busy}
              className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
              <QrCode className="h-4 w-4" />Mint patient QR slip
            </button>
          ) : (
            <div className="mt-3 rounded-xl bg-white p-3 font-mono text-xs">
              <p className="font-semibold text-slate-700">Token (show only once):</p>
              <p className="mt-1 break-all rounded bg-slate-50 p-2 text-slate-800">{qr.token}</p>
              <p className="mt-1 text-[10px] text-slate-500">
                Prefix: {qr.prefix} · Expires: {new Date(qr.expires_at).toLocaleDateString()}
              </p>
            </div>
          )}
        </section>
      )}

    </div>
  );
}

function Field({ label, children, full }) {
  return (
    <label className={`block ${full ? 'sm:col-span-2' : ''}`}>
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
