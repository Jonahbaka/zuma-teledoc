'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Brain, ChevronDown, ChevronUp, Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { appointmentsAPI, clinicalEhrAPI } from '@/lib/api';
import { toProviderPortalPath } from '@/lib/providerPortal';
import contextHelpers from '@/lib/clinical-copilot-context.cjs';

export default function ClinicalCoPilot({ appointmentId, patientId, collapsed }) {
  const { user } = useAuth();
  return <ClinicalReview key={`${user?.id}:${user?.role}:${user?.marketScope}:${appointmentId}:${patientId}`} appointmentId={appointmentId} patientId={patientId} user={user} initiallyCollapsed={collapsed} />;
}

function ClinicalReview({ appointmentId, patientId, user, initiallyCollapsed }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(Boolean(initiallyCollapsed));
  const [loading, setLoading] = useState(true);
  const [contextReady, setContextReady] = useState(false);
  const [encounter, setEncounter] = useState(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [draft, setDraft] = useState(null);
  const [stage, setStage] = useState('consultation_brief');
  const mounted = useRef(false);
  const operation = useRef(false);
  const context = { appointmentId, patientId, providerId: user?.id };
  const portalPath = target => toProviderPortalPath(target, { pathname, user });

  useEffect(() => {
    mounted.current = true;
    let active = true;
    setLoading(true); setError(''); setContextReady(false); setEncounter(null); setDraft(null);
    contextHelpers.resolveContext({ appointments: appointmentsAPI, clinical: clinicalEhrAPI }, { appointmentId, patientId, providerId: user?.id })
      .then(result => { if (active) { setEncounter(result.encounter); setContextReady(true); } })
      .catch(() => { if (active) setError('The appointment and encounter could not be verified. Refresh or open the visit workspace.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; mounted.current = false; };
  }, [appointmentId, patientId, user?.id, revision]);

  async function prepare() {
    if (!encounter || operation.current) return;
    operation.current = true; setWorking(true); setError(''); setDraft(null);
    try {
      const result = await contextHelpers.prepareDraft(clinicalEhrAPI, context, encounter.id, stage);
      if (mounted.current) setDraft(result);
    } catch (failure) {
      if (mounted.current) setError(failure?.response?.data?.code === 'CLINICAL_AI_CONTEXT_UNAVAILABLE'
        ? 'This encounter has no eligible clinical AI context. Continue documentation in the chart.'
        : 'A clinical draft is unavailable. The encounter must have an authorized source record and configured clinical AI access. Continue documentation in the chart.');
    } finally { operation.current = false; if (mounted.current) setWorking(false); }
  }
  async function review(decision) {
    if (!encounter || !draft || draft.status !== 'drafted' || operation.current) return;
    operation.current = true; setWorking(true); setError('');
    try {
      const result = await clinicalEhrAPI.reviewEncounterAiDraft(encounter.id, draft.id, { decision,
        ...(decision === 'rejected' ? { rejectionReason: 'Clinician declined the draft after reviewing the source-linked output.' } : {}) });
      const status = result.data?.review?.status;
      if (!result.data?.success || !['accepted', 'rejected'].includes(status)) throw new Error('Review not confirmed');
      if (mounted.current) setDraft(current => ({ ...current, status }));
    } catch { if (mounted.current) setError('The review was not confirmed. Keep this draft and retry in the chart.'); }
    finally { operation.current = false; if (mounted.current) setWorking(false); }
  }
  const actionClass = 'min-h-11 rounded-lg border border-slate-600 px-3 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50';
  if (collapsed) return <button type="button" onClick={() => setCollapsed(false)} className={actionClass}><Brain className="mr-2 inline h-5 w-5" />Clinical Assist<ChevronDown className="ml-2 inline h-4 w-4" /></button>;
  const output = draft?.output;
  return <section aria-label="Clinical Assist" className="contrast-dark flex h-full max-h-[700px] flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 text-white">
    <header className="flex items-center justify-between border-b border-slate-700 p-4"><div><h2 className="font-semibold">Clinical Assist</h2><p className="mt-1 text-sm text-slate-300">Source-linked drafts for clinician review</p></div><button type="button" aria-label="Collapse Clinical Assist" onClick={() => setCollapsed(true)} className={actionClass}><ChevronUp className="h-5 w-5" /></button></header>
    <div className="space-y-4 overflow-y-auto p-4">
      {loading && <p role="status"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Checking the assigned encounter…</p>}
      {error && <p role="alert" className="rounded-lg border border-amber-500/50 bg-amber-950/40 p-3 text-sm text-amber-100">{error}</p>}
      {!loading && !encounter && <p className="text-sm leading-6 text-slate-200">Open or create this appointment’s encounter in the visit workspace. Clinical Assist uses the exact assigned record; an unrelated encounter is never selected.</p>}
      {!loading && <div className="flex flex-wrap gap-2"><button type="button" disabled={working} onClick={() => setRevision(value => value + 1)} className={actionClass}><RefreshCw className="mr-2 inline h-4 w-4" />Refresh context</button>{contextReady && <Link className={actionClass} href={portalPath(`/appointments/${appointmentId}/visit`)}>Open visit workspace</Link>}</div>}
      {encounter && <>
        <label className="block text-sm" htmlFor="copilot-stage">Draft type</label>
        <select id="copilot-stage" value={stage} disabled={working} onChange={event => setStage(event.target.value)} className="min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-base"><option value="consultation_brief">Consultation brief</option><option value="soap_draft">SOAP draft</option><option value="missing_information">Missing information</option><option value="follow_up_draft">Follow-up draft</option></select>
        <button type="button" onClick={prepare} disabled={working || loading} className={actionClass}>{working ? 'Working…' : 'Prepare draft from encounter'}</button>
        <p className="text-sm leading-6 text-slate-300">Review source observations, uncertainty and the proposed text. Approval here records your review; signing notes and placing orders remain separate chart actions.</p>
      </>}
      {output && <article className="space-y-4 rounded-xl border border-slate-600 bg-slate-900 p-4">
        <p className="text-sm font-semibold">{draft.status === 'drafted' ? 'Draft — awaiting your review' : `Review: ${draft.status}`}</p>
        {output.summary && <p className="whitespace-pre-wrap text-sm leading-6">{output.summary}</p>}
        {output.handoverDraft && <p className="whitespace-pre-wrap text-sm leading-6">{output.handoverDraft}</p>}
        {output.soapDraft && Object.entries(output.soapDraft).map(([name, text]) => <section key={name}><h3 className="font-semibold capitalize">{name}</h3><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{text || 'Not recorded'}</p></section>)}
        {output.assertions?.length > 0 && <section><h3 className="font-semibold">Source references</h3><ul className="mt-2 space-y-3">{output.assertions.map((assertion, index) => <li key={index} className="text-sm leading-6">{assertion.text}<p className="break-words text-xs text-slate-400">{assertion.sourceRefs.join(', ')}</p></li>)}</ul></section>}
        {output.missingInformation?.length > 0 && <section><h3 className="font-semibold">Missing information</h3><ul className="mt-2 space-y-2">{output.missingInformation.map((item, index) => <li key={index} className="text-sm">{item.field}: {item.reason}</li>)}</ul></section>}
        {output.uncertainties?.length > 0 && <section><h3 className="font-semibold">Uncertainties</h3><ul className="mt-2 space-y-2">{output.uncertainties.map((item, index) => <li key={index} className="text-sm">{item}</li>)}</ul></section>}
        {output.followUpDrafts?.length > 0 && <section><h3 className="font-semibold">Proposed follow-up</h3><ul className="mt-2 space-y-3">{output.followUpDrafts.map((item, index) => <li key={index} className="text-sm leading-6"><p className="font-medium">{item.title}</p><p className="whitespace-pre-wrap">{item.instructions}</p><p className="break-words text-xs text-slate-400">{item.sourceRefs.join(', ')}</p></li>)}</ul></section>}
        {draft.status === 'drafted' && <div className="flex flex-wrap gap-2"><button type="button" disabled={working} className={actionClass} onClick={() => review('accepted')}>Accept after review</button><button type="button" disabled={working} className={actionClass} onClick={() => review('rejected')}>Reject draft</button></div>}
        <Link className={`${actionClass} inline-flex`} href={portalPath(`/encounters/${encounter.id}${draft.status === 'accepted' && draft.suggestion_type === 'soap_draft' ? `?aiSuggestionId=${encodeURIComponent(draft.id)}` : ''}`)}>Continue in encounter chart</Link>
      </article>}
    </div>
  </section>;
}
