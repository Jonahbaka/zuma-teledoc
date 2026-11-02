'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
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
  const [createUncertain, setCreateUncertain] = useState(false);
  const { user, loading } = useAuth();
  const identity = !loading && user?.id && user?.role && (user.marketScope || user.market_scope) === 'NG' ? JSON.stringify([user.id, user.role, user.marketScope || user.market_scope]) : null;
  const identityRef = useRef(identity); identityRef.current = identity;
  const mounted = useRef(true);
  const operation = useRef(null);
  const matchVersion = useRef(0);
  const savedDraft = useRef(null);
  const selectedListing = useRef(null);
  const uncertain = useRef(false);
  const current = () => mounted.current && identity && identityRef.current === identity;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; matchVersion.current += 1; }; }, []);

  function patch(k, v) {
    if (savedDraft.current || uncertain.current || operation.current && operation.current !== 'match') return;
    matchVersion.current += 1; selectedListing.current = null; setChosen(null); setMatches([]);
    setForm(f => ({ ...f, [k]: v }));
  }

  async function runMatch() {
    if (!current() || operation.current || savedDraft.current || uncertain.current) return;
    operation.current = 'match';
    const version = ++matchVersion.current;
    setBusy(true); setErr(''); selectedListing.current = null; setChosen(null); setMatches([]);
    try {
      const response = await drn.match({ specialty: form.specialty, urgency: form.urgency,
        prefer_state: form.prefer_state, prefer_lga: form.prefer_lga,
        max_price: form.max_price ? Number(form.max_price) : undefined, accepts_insurance: form.accepts_insurance });
      if (!current() || version !== matchVersion.current) return;
      if (!response?.ok || !Array.isArray(response.matches)) throw new Error('Matches could not be confirmed.');
      setMatches(response.matches);
      if (!response.matches.length) setErr('No specialists matched. Try widening filters.');
    } catch (error) { if (current() && version === matchVersion.current) setErr(error.message); }
    finally { operation.current = null; if (current()) setBusy(false); }
  }

  async function sendSaved(draft, reconcile) {
    if (reconcile) {
      const response = await drn.getReferral(draft.id);
      if (!current()) return;
      if (!response?.ok || response.referral?.id !== draft.id) throw new Error('Saved referral status could not be confirmed. Check Outbox before retrying.');
      draft = response.referral; savedDraft.current = draft; setCreated(draft);
    }
    if (draft.status !== 'draft') return; // Already advanced: never send again.
    if (!draft.allowed_transitions?.includes('sent')) throw new Error('Sending this saved draft is not authorized. Check Outbox.');
    const response = await drn.transition(draft.id, { to_status: 'sent', notes: 'explicit composer send' });
    if (!current()) return;
    if (!response?.ok || response.referral?.id !== draft.id || response.referral.status !== 'sent') throw new Error('Send was not confirmed. Check the saved referral status before retrying.');
    savedDraft.current = response.referral; setCreated(response.referral);
  }

  async function submit() {
    if (!current() || operation.current || uncertain.current) return;
    if (!savedDraft.current && (!chosen?.id || selectedListing.current?.id !== chosen.id || !form.reason.trim() || !form.specialty.trim())) return;
    operation.current = 'send'; setBusy(true); setErr('');
    let creating = !savedDraft.current;
    try {
      if (creating) {
        const response = await drn.createReferral({
          specialty: form.specialty, urgency: form.urgency, reason: form.reason, clinical_summary: form.clinical_summary,
          patient_name: form.patient_name || undefined, patient_phone: form.patient_phone || undefined,
          patient_age: form.patient_age ? Number(form.patient_age) : undefined, patient_sex: form.patient_sex || undefined,
          destination_listing: chosen.id,
        });
        if (!current()) return;
        if (!response?.ok || !response.referral?.id || response.referral.status !== 'draft') throw new Error('Creation response could not be confirmed.');
        savedDraft.current = response.referral; setCreated(response.referral);
        creating = false;
        await sendSaved(response.referral, false);
      } else await sendSaved(savedDraft.current, true);
    } catch (error) {
      if (current()) {
        if (creating && !(error.status >= 400 && error.status < 500 && error.status !== 408)) {
          uncertain.current = true; setCreateUncertain(true);
          setErr('Creation outcome is uncertain. Do not create another referral. Check Outbox for the saved draft before continuing.');
        } else setErr(savedDraft.current ? `Draft saved (${savedDraft.current.ref_code || savedDraft.current.id}). Send not confirmed: ${error.message}` : error.message);
      }
    } finally { operation.current = null; if (current()) setBusy(false); }
  }

  async function mintQr() {
    if (!current() || operation.current || !savedDraft.current || savedDraft.current.status === 'draft' || ['cancelled', 'expired', 'declined'].includes(savedDraft.current.status)) return;
    operation.current = 'qr'; setBusy(true); setErr('');
    try {
      const response = await drn.mintQr(savedDraft.current.id, { scope: 'patient_slip', ttlDays: 30 });
      if (!response?.token) throw new Error('QR token was not confirmed.');
      if (current()) setQr(response);
    } catch (error) { if (current()) setErr(error.message); }
    finally { operation.current = null; if (current()) setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <fieldset className="space-y-5" disabled={Boolean(created) || createUncertain || busy && operation.current !== 'match'}>
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
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
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
              <li key={m.id} onClick={() => { if (!operation.current && !savedDraft.current && !uncertain.current) { selectedListing.current = m; setChosen(m); } }}
                className={`cursor-pointer rounded-xl border p-3 transition ${chosen?.id === m.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-bold text-slate-900">{m.title} <span className="text-xs font-normal text-slate-500">· {m.org_name}</span></p>
                    <p className="mt-1 text-xs text-slate-600">{(m.reasons || []).join(' · ')}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-black text-blue-700">{m.score}</p>
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

      </fieldset>

      {err && <p className="flex items-center gap-2 text-sm text-rose-700"><AlertCircle className="h-4 w-4" />{err}</p>}

      {!created && (
        <div className="flex items-center justify-end">
          <button onClick={submit} disabled={busy || createUncertain || !chosen?.id || !form.reason.trim() || !form.specialty.trim()}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
            <Send className="h-4 w-4" />
            {busy ? 'Sending…' : 'Send referral'}
          </button>
        </div>
      )}

      {created && (
        <section className="rounded-2xl border border-blue-300 bg-blue-50 p-5">
          <div className="flex items-center gap-2 text-blue-800">
            <CheckCircle2 className="h-5 w-5" />
            <h3 className="text-sm font-bold">Referral {created.status === 'draft' ? 'draft saved' : created.status} — {created.ref_code}</h3>
          </div>
          <p className="mt-1 text-xs text-blue-700">
            This is the last confirmed referral status. A sent status does not confirm that the receiving facility has read or acted on it.
          </p>
          {created.status === 'draft' ? (
            <button onClick={submit} disabled={busy} className="mt-3 rounded-lg bg-blue-700 px-3 py-1.5 text-sm text-white disabled:opacity-50">Check status and retry sending saved draft</button>
          ) : ['cancelled', 'expired', 'declined'].includes(created.status) ? null : !qr ? (
            <button onClick={mintQr} disabled={busy}
              className="mt-3 flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50">
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
