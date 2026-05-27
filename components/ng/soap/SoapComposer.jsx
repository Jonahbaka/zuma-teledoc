'use client';

/**
 * components/ng/soap/SoapComposer.jsx
 * Template-driven SOAP composer. The user picks a Nigerian-clinic
 * template (malaria, HTN, antenatal, …) and edits each section.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  FileText, Sparkles, ListChecks, Stethoscope, Pill, AlertCircle,
  Search, ChevronRight, NotebookPen, ArrowRight,
} from 'lucide-react';

async function fetchJson(path) {
  const res = await fetch(path);
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) throw new Error(body?.error || `${res.status}`);
  return body;
}

export default function SoapComposer() {
  const [allTemplates, setAllTemplates] = useState([]);
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState(null);   // applied SOAP state
  const [pickedMeta, setPickedMeta] = useState(null); // raw template metadata
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { const r = await fetchJson('/api/ng/soap/templates'); setAllTemplates(r.templates || []); }
      catch (e) { setErr(e.message); }
      finally { setLoading(false); }
    })();
  }, []);

  const visibleTemplates = useMemo(() => {
    if (!filter) return allTemplates;
    const q = filter.toLowerCase();
    return allTemplates.filter(t =>
      t.label.toLowerCase().includes(q) ||
      t.chief_complaint.toLowerCase().includes(q) ||
      t.key.includes(q)
    );
  }, [allTemplates, filter]);

  async function applyTemplate(key) {
    setErr('');
    try {
      const r = await fetchJson(`/api/ng/soap/templates/${key}`);
      setPicked(r.applied);
      setPickedMeta(r.template);
    } catch (e) { setErr(e.message); }
  }

  function patch(section, field, value) {
    setPicked(p => ({ ...p, [section]: { ...p[section], [field]: value } }));
  }
  function patchVital(vital, value) {
    setPicked(p => ({ ...p, objective: { ...p.objective, vitals: { ...p.objective.vitals, [vital]: value } } }));
  }

  if (loading) return <p className="p-6 text-sm text-slate-500">Loading templates…</p>;
  if (err)     return <p className="flex items-center gap-2 p-6 text-sm text-rose-700"><AlertCircle className="h-4 w-4" />{err}</p>;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <header className="flex items-center gap-3">
        <div className="rounded-xl bg-green-600/10 p-2 text-green-700">
          <NotebookPen className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-black text-slate-900">SOAP Composer</h1>
          <p className="text-xs text-slate-500">
            Nigerian clinical templates — malaria, hypertension, antenatal, diabetes, URTI, diarrhea, mental health
          </p>
        </div>
      </header>

      {!picked ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <Search className="h-4 w-4 text-slate-400" />
            <input value={filter} onChange={e => setFilter(e.target.value)}
              placeholder="Filter templates by complaint, e.g. fever, BP, antenatal…"
              className="w-full bg-transparent text-base outline-none" />
          </div>
          <ul className="grid gap-3 md:grid-cols-2">
            {visibleTemplates.map(t => (
              <li key={t.key}>
                <button onClick={() => applyTemplate(t.key)}
                  className="block w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-green-400 hover:bg-green-50/30">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-900">{t.label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${t.age_group === 'pediatric' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>
                      {t.age_group}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{t.chief_complaint}</p>
                  <div className="mt-2 flex items-center gap-1 text-xs font-semibold text-green-700">
                    <ArrowRight className="h-3 w-3" />Apply template
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Template applied</p>
              <p className="text-sm font-bold text-emerald-900">{pickedMeta?.label}</p>
            </div>
            <button onClick={() => { setPicked(null); setPickedMeta(null); }}
              className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">
              Change template
            </button>
          </div>

          {/* Subjective */}
          <Section icon={FileText} title="S — Subjective">
            <div className="space-y-3">
              <Field label="Chief complaint">
                <input value={picked.chief_complaint || ''}
                  onChange={e => setPicked({ ...picked, chief_complaint: e.target.value })}
                  className="input" />
              </Field>
              <Field label="History of presenting complaint">
                <textarea rows={4} value={picked.subjective.narrative}
                  onChange={e => patch('subjective', 'narrative', e.target.value)}
                  className="input" />
              </Field>
              <details className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                <summary className="cursor-pointer font-semibold text-slate-700">
                  <ListChecks className="mr-1 inline h-3.5 w-3.5" />
                  Suggested history questions ({picked.subjective.questions.length})
                </summary>
                <ul className="mt-2 space-y-1 pl-5 text-slate-600">
                  {picked.subjective.questions.map((q, i) => <li key={i} className="list-disc">{q}</li>)}
                </ul>
              </details>
            </div>
          </Section>

          {/* Objective */}
          <Section icon={Stethoscope} title="O — Objective">
            <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-4">
              {Object.entries(picked.objective.vitals).map(([k, v]) => (
                <Field key={k} label={k.toUpperCase()}>
                  <input value={v || ''} onChange={e => patchVital(k, e.target.value)}
                    placeholder={vitalPlaceholder(k)} className="input" />
                </Field>
              ))}
            </div>
            <Field label="Examination findings">
              <textarea rows={6} value={picked.objective.exam_findings}
                onChange={e => patch('objective', 'exam_findings', e.target.value)}
                className="input font-mono text-xs" />
            </Field>
          </Section>

          {/* Assessment */}
          <Section icon={Sparkles} title="A — Assessment">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Primary diagnosis">
                <input value={picked.assessment.primary_diagnosis}
                  onChange={e => patch('assessment', 'primary_diagnosis', e.target.value)}
                  className="input" />
              </Field>
              <Field label="ICD-10">
                <input value={picked.assessment.icd10}
                  onChange={e => patch('assessment', 'icd10', e.target.value)}
                  className="input font-mono" />
              </Field>
            </div>
            {picked.assessment.differentials?.length > 0 && (
              <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
                <span className="font-semibold text-slate-700">Differentials:</span>{' '}
                {picked.assessment.differentials.join(' · ')}
              </div>
            )}
          </Section>

          {/* Plan */}
          <Section icon={Pill} title="P — Plan">
            <Subsection title="Investigations">
              <ul className="space-y-1 text-sm text-slate-700">
                {picked.plan.investigations.map((inv, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <ChevronRight className="h-3 w-3 text-slate-400" />{inv}
                  </li>
                ))}
              </ul>
            </Subsection>

            <Subsection title="Medications">
              <table className="w-full overflow-hidden rounded-lg border border-slate-200 text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-2 py-1 text-left">Generic</th>
                    <th className="px-2 py-1 text-left">Dose</th>
                    <th className="px-2 py-1 text-left">Frequency</th>
                    <th className="px-2 py-1 text-left">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {picked.plan.medications.map((m, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-2 py-1 font-semibold text-slate-900">{m.generic}</td>
                      <td className="px-2 py-1">{m.dose}</td>
                      <td className="px-2 py-1">{m.frequency}</td>
                      <td className="px-2 py-1 text-xs text-slate-600">{m.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[10px] text-slate-500">
                Drug search opens at <a className="underline" href="/ng/medications/search" target="_blank" rel="noreferrer">/ng/medications/search</a>
              </p>
            </Subsection>

            <Subsection title="Patient education">
              <ul className="space-y-1 text-sm text-slate-700">
                {picked.plan.patient_education.map((p, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1 block h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />{p}
                  </li>
                ))}
              </ul>
            </Subsection>

            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Follow-up">
                <input value={picked.plan.follow_up}
                  onChange={e => patch('plan', 'follow_up', e.target.value)}
                  className="input" />
              </Field>
              {picked.plan.referral && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs">
                  <p className="font-semibold text-amber-900">Suggested referral</p>
                  <p className="mt-1 text-amber-800">
                    {picked.plan.referral.specialty} ·{' '}
                    <span className="font-semibold">{picked.plan.referral.urgency}</span>
                  </p>
                  <p className="mt-1 text-amber-700">{picked.plan.referral.condition}</p>
                  <a href="/ng/referral-network?tab=compose" target="_blank" rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 rounded-md bg-amber-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-amber-700">
                    Compose referral <ChevronRight className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>
          </Section>

          <style jsx>{`
            .input { display: block; width: 100%; border: 1px solid rgb(226 232 240); border-radius: 0.5rem;
                     padding: 0.5rem 0.75rem; font-size: 0.875rem; background: white; }
            .input:focus { outline: 2px solid rgb(34 197 94); outline-offset: -1px; }
          `}</style>
        </>
      )}
    </div>
  );
}

function Section({ icon: Icon, title, children }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-green-700" />
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-900">{title}</h2>
      </div>
      {children}
    </section>
  );
}
function Subsection({ title, children }) {
  return (
    <div className="mt-3">
      <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">{title}</p>
      {children}
    </div>
  );
}
function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function vitalPlaceholder(k) {
  return {
    temp: '37.0 °C', pulse: '80 bpm', bp: '120/80', rr: '16/min', spo2: '98%',
    weight: 'kg', height: 'cm', bmi: 'kg/m²',
    bp_seated: '120/80', bp_standing: '120/80', fh: 'cm', fhr: 'bpm',
  }[k] || '';
}
