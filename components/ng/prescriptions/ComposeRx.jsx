'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Save, AlertCircle, FileSignature } from 'lucide-react';
import { rx } from './rxApi';

const BLANK_ITEM = {
  drug_name: '', generic_name: '', brand_name: '',
  dosage: '', frequency: '', duration_days: '', quantity: '',
  refills_authorized: 0, notes: '',
};

const FREQUENCY_PRESETS = [
  'OD', 'BD', 'TDS', 'QDS', 'PRN', 'Stat',
  '8 hourly', '12 hourly', 'Bedtime', 'Before meals', 'After meals',
];

export default function ComposeRx({ providerId, patientUserId, onCreated }) {
  const router = useRouter();
  const [meta, setMeta] = useState({
    provider_id: providerId || '',
    patient_user_id: patientUserId || '',
    appointment_id: '',
    diagnosis: '',
    notes: '',
    is_controlled: false,
    preferred_pharmacy_id: '',
  });
  const [items, setItems] = useState([{ ...BLANK_ITEM }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');

  function setMetaF(k, v) { setMeta(m => ({ ...m, [k]: v })); }
  function updateItem(i, k, v) { setItems(arr => arr.map((it, idx) => idx === i ? { ...it, [k]: v } : it)); }
  function addItem() { setItems(arr => [...arr, { ...BLANK_ITEM }]); }
  function removeItem(i) { setItems(arr => arr.filter((_, idx) => idx !== i)); }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const body = {
        ...meta,
        items: items.map(it => ({
          ...it,
          duration_days: it.duration_days ? Number(it.duration_days) : null,
          quantity: it.quantity ? Number(it.quantity) : null,
          refills_authorized: Number(it.refills_authorized) || 0,
        })),
      };
      const out = await rx.create(body);
      if (onCreated) onCreated(out.prescription);
      else router.push(`/ng/prescriptions/${out.prescription.id}`);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset className="rounded-xl border border-slate-200 bg-white p-4">
        <legend className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Patient + context</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Provider ID *">
            <input required value={meta.provider_id} onChange={e => setMetaF('provider_id', e.target.value)} className="rxinput" />
          </Field>
          <Field label="Patient user ID *">
            <input required value={meta.patient_user_id} onChange={e => setMetaF('patient_user_id', e.target.value)} className="rxinput" />
          </Field>
          <Field label="Appointment ID (optional)">
            <input value={meta.appointment_id} onChange={e => setMetaF('appointment_id', e.target.value)} className="rxinput" />
          </Field>
          <Field label="Preferred pharmacy ID (optional)">
            <input value={meta.preferred_pharmacy_id} onChange={e => setMetaF('preferred_pharmacy_id', e.target.value)} className="rxinput" />
          </Field>
          <Field label="Diagnosis" full>
            <input value={meta.diagnosis} onChange={e => setMetaF('diagnosis', e.target.value)} placeholder="e.g. Uncomplicated falciparum malaria" className="rxinput" />
          </Field>
          <Field label="Notes" full>
            <textarea value={meta.notes} onChange={e => setMetaF('notes', e.target.value)} rows={2} className="rxinput" />
          </Field>
          <label className="col-span-2 inline-flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={meta.is_controlled} onChange={e => setMetaF('is_controlled', e.target.checked)} />
            Controlled-substance prescription (extra audit)
          </label>
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-slate-200 bg-white p-4">
        <legend className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Medications</legend>
        <div className="space-y-3">
          {items.map((it, i) => (
            <div key={i} className="rounded-lg border border-slate-200 bg-slate-50/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">Item {i + 1}</span>
                {items.length > 1 && (
                  <button type="button" onClick={() => removeItem(i)} className="text-rose-600 hover:text-rose-800" aria-label="Remove">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label="Drug name *">
                  <input required value={it.drug_name} onChange={e => updateItem(i, 'drug_name', e.target.value)} className="rxinput" placeholder="e.g. Artemether/Lumefantrine 80/480" />
                </Field>
                <Field label="Generic">
                  <input value={it.generic_name} onChange={e => updateItem(i, 'generic_name', e.target.value)} className="rxinput" />
                </Field>
                <Field label="Brand">
                  <input value={it.brand_name} onChange={e => updateItem(i, 'brand_name', e.target.value)} className="rxinput" placeholder="e.g. Coartem" />
                </Field>
                <Field label="Dosage *">
                  <input required value={it.dosage} onChange={e => updateItem(i, 'dosage', e.target.value)} className="rxinput" placeholder="e.g. 1 tablet" />
                </Field>
                <Field label="Frequency *">
                  <input required list={`freq-${i}`} value={it.frequency} onChange={e => updateItem(i, 'frequency', e.target.value)} className="rxinput" placeholder="e.g. BD" />
                  <datalist id={`freq-${i}`}>
                    {FREQUENCY_PRESETS.map(f => <option key={f} value={f} />)}
                  </datalist>
                </Field>
                <Field label="Duration (days)">
                  <input type="number" value={it.duration_days} onChange={e => updateItem(i, 'duration_days', e.target.value)} className="rxinput" />
                </Field>
                <Field label="Quantity">
                  <input type="number" value={it.quantity} onChange={e => updateItem(i, 'quantity', e.target.value)} className="rxinput" />
                </Field>
                <Field label="Refills authorised">
                  <input type="number" min="0" value={it.refills_authorized} onChange={e => updateItem(i, 'refills_authorized', e.target.value)} className="rxinput" />
                </Field>
                <Field label="Item notes">
                  <input value={it.notes} onChange={e => updateItem(i, 'notes', e.target.value)} className="rxinput" />
                </Field>
              </div>
            </div>
          ))}
          <button type="button" onClick={addItem}
                  className="inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            <Plus className="h-3.5 w-3.5" /> Add another medication
          </button>
        </div>
      </fieldset>

      {err && <p className="flex items-center gap-2 text-sm text-rose-700"><AlertCircle className="h-4 w-4" />{err}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
          <Save className="h-4 w-4" />
          {busy ? 'Creating draft…' : 'Save as draft'}
        </button>
        <p className="text-xs text-slate-500 inline-flex items-center gap-1">
          <FileSignature className="h-3.5 w-3.5" />
          You'll sign & send to a pharmacy from the prescription detail page.
        </p>
      </div>

      <style jsx>{`
        :global(.rxinput) {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid #cbd5e1;
          padding: 0.375rem 0.625rem;
          font-size: 0.875rem;
          background: white;
        }
      `}</style>
    </form>
  );
}

function Field({ label, full, children }) {
  return (
    <label className={`block ${full ? 'sm:col-span-2' : ''}`}>
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}
