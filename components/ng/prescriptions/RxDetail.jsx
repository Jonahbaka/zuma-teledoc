'use client';

/**
 * components/ng/prescriptions/RxDetail.jsx
 * Detail view used by doctor and pharmacy alike — the available actions are
 * filtered by lifecycle_status, not by viewer role (the backend enforces
 * permission). Roles in the directive map onto lifecycle stages:
 *   doctor:     drafted → signed → sent
 *   pharmacy:   received → dispense per-item → complete
 *   either:     cancel (until terminal)
 */

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, AlertCircle, RefreshCw, FileSignature, Send, PackageCheck,
  Ban, CheckCircle2, History, Pill, XCircle, PackageX, Repeat,
} from 'lucide-react';
import { rx, statusBadge, STATUS_LABELS, fmtDate } from './rxApi';

export default function RxDetail({ id }) {
  const router = useRouter();
  const [data, setData]   = useState(null);
  const [events, setEvents] = useState([]);
  const [err, setErr]     = useState('');
  const [busy, setBusy]   = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [r, ev] = await Promise.all([rx.get(id), rx.events(id)]);
      setData(r.prescription);
      setEvents(ev.events || []);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function run(key, fn) {
    setBusy(key);
    try { await fn(); await load(); }
    catch (e) { alert(e.message); }
    finally { setBusy(null); }
  }

  if (loading) return <p className="p-8 text-sm text-slate-500">Loading prescription…</p>;
  if (err)     return <p className="flex items-center gap-2 p-8 text-sm text-rose-700"><AlertCircle className="h-4 w-4" />{err}</p>;
  if (!data)   return <p className="p-8 text-sm text-slate-500">Not found.</p>;

  const s = data.lifecycle_status;
  const canSign     = s === 'drafted';
  const canSend     = s === 'signed';
  const canReceive  = s === 'sent_to_pharmacy';
  const canDispense = s === 'received' || s === 'partially_dispensed';
  const canComplete = s === 'fully_dispensed';
  const canCancel   = !['completed', 'cancelled', 'expired'].includes(s);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-green-50/30">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-6 py-4">
          <button onClick={() => router.push('/ng/prescriptions')} className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to prescriptions
          </button>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Pill className="h-5 w-5 text-green-700" />
                <h1 className="font-mono text-lg font-black text-slate-900">{data.prescription_number}</h1>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusBadge(s)}`}>
                  {STATUS_LABELS[s] || s}
                </span>
                {data.is_controlled && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">CONTROLLED</span>}
              </div>
              <p className="mt-1 text-sm text-slate-800">{data.diagnosis || '(no diagnosis recorded)'}</p>
              <p className="text-[11px] text-slate-500">
                Created {fmtDate(data.created_at)} · provider {String(data.provider_id).slice(0,8)}… · patient {String(data.patient_user_id).slice(0,8)}…
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button onClick={load} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" title="Refresh">
                <RefreshCw className="h-4 w-4" />
              </button>
              {canSign && (
                <Btn busy={busy === 'sign'} onClick={() => run('sign', () => rx.sign(id))} className="bg-indigo-600 hover:bg-indigo-700">
                  <FileSignature className="h-3.5 w-3.5" /> Sign
                </Btn>
              )}
              {canSend && (
                <SendBtn busy={busy === 'send'} run={(pid) => run('send', () => rx.send(id, { pharmacy_id: pid }))} initial={data.preferred_pharmacy_id} />
              )}
              {canReceive && (
                <Btn busy={busy === 'recv'} onClick={() => run('recv', () => rx.receive(id))} className="bg-cyan-600 hover:bg-cyan-700">
                  <PackageCheck className="h-3.5 w-3.5" /> Acknowledge
                </Btn>
              )}
              {canComplete && (
                <Btn busy={busy === 'done'} onClick={() => run('done', () => rx.complete(id))} className="bg-emerald-600 hover:bg-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Mark complete
                </Btn>
              )}
              {canCancel && (
                <Btn busy={busy === 'cancel'} onClick={() => {
                  const reason = prompt('Cancellation reason?');
                  if (reason !== null) run('cancel', () => rx.cancel(id, { reason }));
                }} className="bg-white text-rose-700 ring-1 ring-rose-300 hover:bg-rose-50">
                  <Ban className="h-3.5 w-3.5" /> Cancel
                </Btn>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-6 py-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-bold text-slate-800">Medications ({data.items.length})</h2>
          <ul className="space-y-2">
            {data.items.map(it => (
              <RxItem key={it.id} prescriptionId={id} item={it} canDispense={canDispense} busyKey={busy} run={run} />
            ))}
          </ul>
        </section>

        {data.notes && (
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="mb-1 text-sm font-bold text-slate-800">Prescriber notes</h2>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{data.notes}</p>
          </section>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 inline-flex items-center gap-2 text-sm font-bold text-slate-800">
            <History className="h-4 w-4 text-slate-500" /> Audit trail ({events.length})
          </h2>
          {events.length === 0 ? (
            <p className="text-xs text-slate-400">No events yet.</p>
          ) : (
            <ol className="space-y-1 text-xs">
              {events.map(e => (
                <li key={e.id} className="flex items-baseline gap-2 border-b border-slate-100 pb-1 last:border-0">
                  <span className="font-mono text-[10px] text-slate-400">{fmtDate(e.created_at)}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">{e.event_kind || e.kind || e.transition || 'event'}</span>
                  <span className="text-slate-600">{e.note || e.message || ''}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </main>
    </div>
  );
}

function RxItem({ prescriptionId, item, canDispense, busyKey, run }) {
  const [open, setOpen] = useState(false);
  const status = item.dispense_status || (item.dispensed_at ? 'fully_dispensed' : 'pending');

  return (
    <li className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">{item.drug_name}</p>
          <p className="text-xs text-slate-500">
            {[item.generic_name, item.brand_name && `Brand: ${item.brand_name}`].filter(Boolean).join(' · ')}
          </p>
          <p className="mt-1 text-xs text-slate-700">
            <strong>{item.dosage}</strong> · {item.frequency}
            {item.duration_days ? ` · ${item.duration_days} days` : ''}
            {item.quantity ? ` · Qty ${item.quantity}` : ''}
            {item.refills_remaining > 0 ? ` · Refills: ${item.refills_remaining}/${item.refills_authorized}` : ''}
          </p>
          {item.notes && <p className="mt-1 text-xs text-slate-500">Note: {item.notes}</p>}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusBadge(status)}`}>{status}</span>
      </div>

      {canDispense && status !== 'fully_dispensed' && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {!open ? (
            <>
              <button onClick={() => setOpen(true)}
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700">
                <PackageCheck className="h-3 w-3" /> Dispense
              </button>
              <button onClick={() => run(`u-${item.id}`, () => rx.unavailable(prescriptionId, item.id, { notes: 'flagged unavailable' }))}
                      disabled={busyKey === `u-${item.id}`}
                      className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-300 hover:bg-rose-50">
                <PackageX className="h-3 w-3" /> Mark unavailable
              </button>
              {item.refills_remaining > 0 && (
                <button onClick={() => run(`r-${item.id}`, () => rx.requestRefill(prescriptionId, { item_id: item.id }))}
                        disabled={busyKey === `r-${item.id}`}
                        className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
                  <Repeat className="h-3 w-3" /> Request refill
                </button>
              )}
            </>
          ) : (
            <DispenseForm
              busy={busyKey === `d-${item.id}`}
              maxQty={item.quantity}
              onCancel={() => setOpen(false)}
              onSubmit={(form) => run(`d-${item.id}`, () => rx.dispense(prescriptionId, item.id, form)).then(() => setOpen(false))}
            />
          )}
        </div>
      )}
    </li>
  );
}

function DispenseForm({ busy, maxQty, onCancel, onSubmit }) {
  const [qty, setQty] = useState(maxQty || '');
  const [sub, setSub] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          quantity: qty ? Number(qty) : null,
          substitute_drug_id: sub || null,
          substitute_reason: reason || null,
          notes: notes || null,
        });
      }}
      className="flex flex-wrap items-end gap-2 rounded-md bg-emerald-50/50 p-2"
    >
      <label className="text-[11px] text-slate-700">
        Quantity
        <input type="number" min="1" max={maxQty || undefined} value={qty} onChange={e => setQty(e.target.value)}
               className="ml-1 w-16 rounded-md border border-slate-300 px-1 py-0.5 text-xs" />
      </label>
      <label className="text-[11px] text-slate-700">
        Substitute drug ID
        <input value={sub} onChange={e => setSub(e.target.value)} placeholder="(optional)"
               className="ml-1 w-32 rounded-md border border-slate-300 px-1 py-0.5 text-xs" />
      </label>
      <label className="text-[11px] text-slate-700">
        Reason
        <input value={reason} onChange={e => setReason(e.target.value)}
               className="ml-1 w-32 rounded-md border border-slate-300 px-1 py-0.5 text-xs" />
      </label>
      <label className="text-[11px] text-slate-700">
        Notes
        <input value={notes} onChange={e => setNotes(e.target.value)}
               className="ml-1 w-32 rounded-md border border-slate-300 px-1 py-0.5 text-xs" />
      </label>
      <button type="submit" disabled={busy}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
        <PackageCheck className="h-3 w-3" />{busy ? '…' : 'Confirm'}
      </button>
      <button type="button" onClick={onCancel}
              className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-300">
        <XCircle className="h-3 w-3" /> Close
      </button>
    </form>
  );
}

function Btn({ children, onClick, busy, className }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${className}`}
    >{busy ? '…' : children}</button>
  );
}

function SendBtn({ busy, run, initial }) {
  const [open, setOpen] = useState(false);
  const [pid, setPid]   = useState(initial || '');
  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
              className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
        <Send className="h-3.5 w-3.5" /> Send to pharmacy
      </button>
    );
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (pid) run(pid); setOpen(false); }}
          className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 ring-1 ring-blue-300">
      <input value={pid} onChange={e => setPid(e.target.value)} placeholder="pharmacy_id"
             className="w-44 rounded-md border border-slate-300 px-2 py-1 text-xs" />
      <button type="submit" disabled={busy || !pid}
              className="rounded-md bg-blue-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50">Send</button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500">×</button>
    </form>
  );
}
