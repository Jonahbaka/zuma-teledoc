'use client';
import ManualLabPanel from '@/components/clinical/ManualLabPanel';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  FileText,
  PenLine,
  ShieldCheck,
  ExternalLink,
  Loader2,
  Plus,
  ClipboardSignature
} from 'lucide-react';

import { clinicalEhrAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { formatDateTime } from '@/lib/utils';
import { toProviderPortalPath } from '@/lib/providerPortal';

const SOAP_FIELDS = ['subjective', 'objective', 'assessment', 'plan'];
const soapFields = note => Object.fromEntries(SOAP_FIELDS.map(field => [field, typeof note?.[field] === 'string' ? note[field] : '']));
const validRevision = note => /^[a-f0-9]{64}$/.test(note?.revision || '');
const newestNote = notes => [...notes].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)
  || (b.version || 0) - (a.version || 0) || String(b.id).localeCompare(String(a.id)))[0] || null;

function ProviderEncounterChartContent() {
  const params = useParams();
  const pathname = usePathname();
  const encounterId = params.id;
  const searchParams = useSearchParams();
  const aiSuggestionId = searchParams.get('aiSuggestionId');
  const currentAiSuggestion = useRef(aiSuggestionId);
  currentAiSuggestion.current = aiSuggestionId;
  const currentEncounter = useRef(encounterId);
  currentEncounter.current = encounterId;
  const importVersion = useRef(0);
  const mounted = useRef(false);
  const loadVersion = useRef(0);
  const operation = useRef(null);
  const [editor, setEditor] = useState(null);
  const editorRef = useRef(null);
  const [signingNote, setSigningNote] = useState(false);
  const installEditor = value => { editorRef.current = value; setEditor(value); };
  const [importingDraft, setImportingDraft] = useState(false);
  const [importedAiSuggestionId, setImportedAiSuggestionId] = useState(null);
  const [aiStage, setAiStage] = useState('consultation_brief');
  const [aiWorking, setAiWorking] = useState(false);
  const [aiReviewDraft, setAiReviewDraft] = useState(null);
  const [aiEditable, setAiEditable] = useState(null);

  const [loading, setLoading] = useState(true);
  const [encounter, setEncounter] = useState(null);
  const [notes, setNotes] = useState([]);
  const [intents, setIntents] = useState([]);

  const [savingNote, setSavingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState({ noteType: 'soap', ...soapFields(null) });
  const currentNoteDraft = useRef(noteDraft);
  currentNoteDraft.current = noteDraft;
  const changeDraft = value => { currentNoteDraft.current = value; setNoteDraft(value); };
  const dirtyDraft = () => SOAP_FIELDS.some(field => currentNoteDraft.current[field] !== editorRef.current?.fields[field]);

  const [showAmend, setShowAmend] = useState(false);
  const [amending, setAmending] = useState(false);
  const [amendment, setAmendment] = useState({
    reason: '',
    subjective: '',
    objective: '',
    assessment: '',
    plan: ''
  });

  const [showRx, setShowRx] = useState(false);
  const [creatingIntent, setCreatingIntent] = useState(false);
  const [rxIntent, setRxIntent] = useState({
    medicationName: '',
    genericName: '',
    dosageStrength: '',
    dosageForm: '',
    route: 'oral',
    quantity: 30,
    daysSupply: 30,
    refillsAuthorized: 0,
    indication: '',
    indicationIcd10: '',
    rationale: '',
    sigDirections: '',
    patientInstructions: '',
    pharmacyName: '',
    pharmacyNpi: '',
    pharmacyAddress: '',
    isControlled: false,
    scheduleClass: ''
  });

  const load = async ({ reloadEditor = false } = {}) => {
    const requestedEncounter = encounterId;
    const requestedDraft = currentNoteDraft.current;
    const requestedEditor = editorRef.current;
    const request = ++loadVersion.current;
    const currentLoad = () => mounted.current && currentEncounter.current === requestedEncounter && request === loadVersion.current;
    setLoading(true);
    try {
      const [encRes, notesRes, intentsRes] = await Promise.all([
        clinicalEhrAPI.getEncounter(encounterId),
        clinicalEhrAPI.getEncounterNotes(encounterId),
        clinicalEhrAPI.getEncounterPrescriptionIntents(encounterId)
      ]);

      if (!currentLoad()) return;
      if (encRes.data?.success) setEncounter(encRes.data.encounter);
      if (notesRes.data?.success) {
        const loadedNotes = notesRes.data.notes || [];
        setNotes(loadedNotes);
        // An established editor owns its exact note and revision. Background
        // reads never replace a clinician's draft or silently retarget a save.
        if (!editorRef.current || reloadEditor && editorRef.current === requestedEditor && currentNoteDraft.current === requestedDraft) {
          const boundId = reloadEditor && editorRef.current?.note?.id;
          const note = boundId ? loadedNotes.find(item => item.id === boundId) : newestNote(loadedNotes);
          if (boundId && !note) throw new Error('The selected note could not be reloaded.');
          const fields = soapFields(note);
          installEditor({ encounterId: requestedEncounter, note, fields });
          changeDraft({ noteType: note?.noteType || 'soap', ...fields });
          if (reloadEditor) setImportedAiSuggestionId(null);
        }
      }
      if (intentsRes.data?.success) setIntents(intentsRes.data.prescriptionIntents || []);
    } catch (e) {
      if (currentLoad()) toast({ title: 'Error', description: 'Failed to load encounter chart', variant: 'destructive' });
    } finally {
      if (currentLoad()) setLoading(false);
    }
  };

  useEffect(() => {
    mounted.current = true;
    operation.current = null;
    installEditor(null);
    setSigningNote(false); setAmending(false); setShowAmend(false);
    setAmendment({ reason: '', ...soapFields(null) });
    importVersion.current += 1;
    setEncounter(null); setNotes([]); setIntents([]);
    setImportedAiSuggestionId(null); setImportingDraft(false); setSavingNote(false);
    setAiReviewDraft(null); setAiEditable(null); setAiWorking(false);
    changeDraft({ noteType: 'soap', ...soapFields(null) });
    load();
    return () => { mounted.current = false; loadVersion.current += 1; importVersion.current += 1; operation.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encounterId]);

  useEffect(() => {
    // A new source selection cancels only pending imports; preserve any already
    // loaded draft and its provenance until the clinician saves or clears it.
    importVersion.current += 1;
    setImportingDraft(false);
  }, [aiSuggestionId]);

  const latestNote = useMemo(() => newestNote(notes), [notes]);
  const selectedNote = editor ? editor.note : latestNote;
  const editorReady = editor?.encounterId === encounterId;
  const noteDirty = editorReady && SOAP_FIELDS.some(field => noteDraft[field] !== editor.fields[field]);
  const noteBusy = savingNote || signingNote || amending;
  const canSign = editorReady && editor?.note && !editor.note.isSigned && !editor.note.isLocked
    && validRevision(editor.note) && !noteDirty && !noteBusy && !importedAiSuggestionId && !importingDraft;
  const startNewNote = () => {
    if (!mounted.current || currentEncounter.current !== encounterId || operation.current || importingDraft || (editorRef.current && dirtyDraft())) return;
    installEditor({ encounterId, note: null, fields: soapFields(null) });
    changeDraft({ noteType: 'soap', ...soapFields(null) });
    setImportedAiSuggestionId(null);
  };

  const prepareEncounterAiDraft = async () => {
    const selectedEncounter = encounterId;
    setAiWorking(true);
    setAiReviewDraft(null);
    setAiEditable(null);
    try {
      const response = await clinicalEhrAPI.createEncounterAiDraft(selectedEncounter, aiStage);
      if (currentEncounter.current !== selectedEncounter) return;
      const suggestion = response.data?.suggestion;
      if (!suggestion?.id || suggestion.status !== 'drafted') throw new Error('AI draft unavailable');
      setAiReviewDraft(suggestion);
      setAiEditable(JSON.parse(JSON.stringify(suggestion.output)));
    } catch (e) {
      if (currentEncounter.current === selectedEncounter) toast({ title: 'AI draft unavailable', description: e?.response?.data?.error || 'This encounter may not be linked to an eligible PHC programme.', variant: 'destructive' });
    } finally { if (currentEncounter.current === selectedEncounter) setAiWorking(false); }
  };

  const reviewEncounterAiDraft = async (decision) => {
    const selected = aiReviewDraft;
    const selectedEncounter = encounterId;
    if (!selected || selected.status !== 'drafted') return;
    setAiWorking(true);
    try {
      const response = await clinicalEhrAPI.reviewEncounterAiDraft(selectedEncounter, selected.id, {
        decision,
        ...(decision === 'accepted_with_edits' ? { editedOutput: aiEditable } : {}),
        ...(decision === 'rejected' ? { rejectionReason: 'Clinician declined the draft after review.' } : {}),
      });
      if (currentEncounter.current !== selectedEncounter) return;
      setAiReviewDraft(current => current?.id === selected.id ? { ...current, status: response.data?.review?.status } : current);
      if (decision !== 'rejected' && selected.suggestion_type === 'soap_draft') {
        toast({ title: 'AI SOAP reviewed', description: 'Use the existing reviewed-draft import to load it as an unsigned note.' });
      } else {
        toast({ title: 'AI review saved', description: 'No clinical order, prescription, referral or record was changed.' });
      }
    } catch (e) {
      if (currentEncounter.current === selectedEncounter) toast({ title: 'Review failed', description: e?.response?.data?.error || 'Review was not saved.', variant: 'destructive' });
    } finally { if (currentEncounter.current === selectedEncounter) setAiWorking(false); }
  };

  const importReviewedDraft = async () => {
    if (operation.current || !mounted.current || !editorRef.current) return;
    const hasText = () => ['subjective', 'objective', 'assessment', 'plan', 'physicalExam'].some(field => currentNoteDraft.current[field]?.trim());
    if (hasText()) {
      toast({ title: 'Draft preserved', description: 'Save or clear your current draft before importing. Nothing was overwritten.', variant: 'destructive' });
      return;
    }
    const request = ++importVersion.current;
    const requestedEncounter = encounterId;
    setImportingDraft(true);
    try {
      const response = await clinicalEhrAPI.getReviewedAiDraft(encounterId, aiSuggestionId);
      if (request !== importVersion.current || currentEncounter.current !== requestedEncounter || currentAiSuggestion.current !== aiSuggestionId) return;
      if (hasText()) {
        toast({ title: 'Draft preserved', description: 'Your edits changed while loading. Nothing was overwritten.', variant: 'destructive' });
        return;
      }
      if (!response.data?.success || response.data.aiSuggestionId !== aiSuggestionId) throw new Error('Draft reference mismatch');
      installEditor({ encounterId: requestedEncounter, note: null, fields: soapFields(null) });
      changeDraft({ ...response.data.noteDraft, ...soapFields(response.data.noteDraft) });
      setImportedAiSuggestionId(response.data.aiSuggestionId);
      toast({ title: 'Reviewed draft loaded', description: 'Review and edit these fields, then save a new unsigned note. Signing remains a separate action.' });
    } catch (error) {
      if (request === importVersion.current && currentEncounter.current === requestedEncounter && currentAiSuggestion.current === aiSuggestionId) toast({ title: 'Import unavailable', description: error.response?.data?.error || 'The reviewed draft could not be loaded.', variant: 'destructive' });
    } finally {
      if (request === importVersion.current) setImportingDraft(false);
    }
  };

  const createOrUpdateNote = async () => {
    const baseline = editorRef.current;
    if (operation.current || importingDraft || !mounted.current || !baseline || baseline.encounterId !== encounterId) return;
    const target = baseline.note;
    if (target && (target.isSigned || target.isLocked || !validRevision(target))) return;
    const submitted = { ...currentNoteDraft.current };
    const changes = Object.fromEntries(SOAP_FIELDS.filter(field => submitted[field] !== baseline.fields[field]).map(field => [field, submitted[field]]));
    if (target && !Object.keys(changes).length || !target && !SOAP_FIELDS.some(field => submitted[field]?.trim())) return;
    const requestedEncounter = encounterId;
    const request = {};
    operation.current = request;
    loadVersion.current += 1;
    const currentSave = () => mounted.current && currentEncounter.current === requestedEncounter && operation.current === request;
    setSavingNote(true);
    try {
      const res = target
        ? await clinicalEhrAPI.updateNote(target.id, { ...changes, expectedRevision: target.revision })
        : await clinicalEhrAPI.createNote(requestedEncounter, { ...submitted, ...(importedAiSuggestionId ? { aiSuggestionId: importedAiSuggestionId } : {}) });
      if (!currentSave()) return;
      if (!res.data?.success || !res.data.note?.id || !validRevision(res.data.note)) throw new Error('The saved note revision could not be confirmed.');
      // Preserve edits typed after submission while advancing only the saved
      // baseline. Responses need not repeat decrypted SOAP content.
      const fields = soapFields(submitted);
      installEditor({ encounterId: requestedEncounter, note: res.data.note, fields });
      setNotes(current => [...current.filter(note => note.id !== res.data.note.id), { ...res.data.note, ...fields }]);
      setImportedAiSuggestionId(null);
      toast({ title: target ? 'Note updated' : 'Note created', variant: 'success' });
      await load();
    } catch (e) {
      if (currentSave()) toast({ title: 'Draft preserved', description: e?.response?.status === 409
        ? 'This note changed elsewhere. Your edits are preserved. Review the current saved note before trying again.'
        : e?.response?.data?.error || 'The save was not confirmed. Your edits are preserved.', variant: 'destructive' });
    } finally {
      if (currentSave()) { operation.current = null; setSavingNote(false); }
    }
  };

  const signNote = async () => {
    const baseline = editorRef.current;
    if (operation.current || importingDraft || importedAiSuggestionId || !mounted.current || !baseline || baseline.encounterId !== encounterId
      || !baseline.note || baseline.note.isSigned || baseline.note.isLocked || !validRevision(baseline.note) || dirtyDraft()) return;
    const requestedEncounter = encounterId;
    const request = {};
    operation.current = request;
    loadVersion.current += 1;
    const currentSign = () => mounted.current && currentEncounter.current === requestedEncounter && operation.current === request;
    setSigningNote(true);
    try {
      const res = await clinicalEhrAPI.signNote(baseline.note.id, { expectedRevision: baseline.note.revision });
      if (!currentSign()) return;
      if (!res.data?.success || !res.data.note?.isSigned) throw new Error('Signature could not be confirmed.');
      installEditor({ ...baseline, note: res.data.note });
      toast({ title: 'Note signed', variant: 'success' });
      await load();
    } catch (e) {
      if (currentSign()) toast({ title: 'Signature not confirmed', description: e?.response?.data?.error || 'Review the current saved note before signing.', variant: 'destructive' });
    } finally {
      if (currentSign()) { operation.current = null; setSigningNote(false); }
    }
  };

  const submitAmendment = async () => {
    if (!selectedNote || operation.current || !mounted.current || !editorReady || currentEncounter.current !== encounterId || editorRef.current?.note?.id !== selectedNote.id) return;
    const requestedEncounter = encounterId;
    const submitted = { ...amendment };
    const request = {};
    operation.current = request;
    loadVersion.current += 1;
    const currentAmendment = () => mounted.current && currentEncounter.current === requestedEncounter && operation.current === request;
    setAmending(true);
    try {
      const res = await clinicalEhrAPI.amendNote(selectedNote.id, submitted);
      if (!currentAmendment()) return;
      if (!res.data?.success || !res.data.note?.id || !validRevision(res.data.note)) throw new Error('The amendment revision could not be confirmed.');
      const fields = soapFields(submitted);
      installEditor({ encounterId: requestedEncounter, note: res.data.note, fields });
      changeDraft({ noteType: 'amendment', ...fields });
      setNotes(current => [...current.filter(note => note.id !== res.data.note.id), { ...res.data.note, ...fields }]);
      toast({ title: 'Amendment created', variant: 'success' });
      setShowAmend(false);
      setAmendment({ reason: '', ...soapFields(null) });
      await load();
    } catch (e) {
      if (currentAmendment()) toast({ title: 'Error', description: e?.response?.data?.error || 'Failed to create amendment', variant: 'destructive' });
    } finally {
      if (currentAmendment()) { operation.current = null; setAmending(false); }
    }
  };

  const createPrescriptionIntent = async () => {
    setCreatingIntent(true);
    try {
      const payload = {
        encounterId,
        patientId: encounter.patientId,
        ...rxIntent
      };
      const res = await clinicalEhrAPI.createPrescriptionIntent(payload);
      if (res.data?.success) {
        toast({ title: 'Prescription intent created', description: 'Ready for external handoff', variant: 'success' });
        setShowRx(false);
        await load();
      }
    } catch (e) {
      toast({ title: 'Error', description: e?.response?.data?.error || 'Failed to create intent', variant: 'destructive' });
    } finally {
      setCreatingIntent(false);
    }
  };

  const openHandoff = async (intentId) => {
    try {
      const res = await clinicalEhrAPI.initiateHandoff(intentId, 'iprescribe');
      if (res.data?.success && res.data?.handoff?.handoffUrl) {
        window.open(res.data.handoff.handoffUrl, '_blank', 'noopener,noreferrer');
      } else {
        throw new Error(res.data?.error || 'Handoff URL not available');
      }
    } catch (e) {
      toast({ title: 'External eRx unavailable', description: e?.response?.data?.error || e.message, variant: 'destructive' });
    }
  };

  if (loading && !encounter) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href={toProviderPortalPath(`/patients/${encounter?.patientId}/ehr`, { pathname })}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-blue-600" />
            Encounter Chart
          </h1>
          <p className="text-slate-500">
            {encounter?.encounterType?.replaceAll('_', ' ')} · {encounter?.encounterStart ? formatDateTime(encounter.encounterStart) : '—'}
          </p>
        </div>
      </div>

      <ManualLabPanel encounterId={encounterId} />
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Encounter</span>
                <Badge variant="outline">{encounter?.status}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div data-testid="encounter-patient"><span className="text-slate-500">Patient:</span> {[encounter?.patient?.firstName, encounter?.patient?.lastName].filter(Boolean).join(' ') || 'Name unavailable'}</div>
              <div data-testid="encounter-provider"><span className="text-slate-500">Provider:</span> {[encounter?.provider?.firstName, encounter?.provider?.lastName].filter(Boolean).join(' ') || 'Name unavailable'}</div>
              <div><span className="text-slate-500">Patient state:</span> {encounter?.patientState || '—'}</div>
              <div><span className="text-slate-500">Chief complaint:</span> {encounter?.chiefComplaint || '—'}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-blue-600" />
                External eRx (iPrescribe)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-600">
                This platform stores **prescription intent** only. Prescriptions are completed in an external eRx system.
              </p>
              <Button onClick={() => setShowRx(true)} className="w-full bg-blue-600 hover:bg-blue-700">
                <Plus className="w-4 h-4 mr-2" />
                Create Rx Intent
              </Button>
              {intents.length === 0 ? (
                <p className="text-sm text-slate-500">No intents yet.</p>
              ) : (
                <div className="space-y-2">
                  {intents.map((i) => (
                    <div key={i.id} className="p-2 border rounded-lg">
                      <div className="flex items-center justify-between">
                        <p className="font-medium text-sm">{i.medicationName}</p>
                        <Badge variant="outline">{i.status}</Badge>
                      </div>
                      <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => openHandoff(i.id)}>
                        Open in iPrescribe <ExternalLink className="w-4 h-4 ml-2" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader><CardTitle>AI clinical documentation review</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-600">Only PHC-linked encounters with an assigned clinician and programme approval can use this source-linked assistant. All drafts require clinician review; no diagnosis, medication, referral, or chart update is automated.</p>
              <Label htmlFor="encounter-ai-stage">Documentation stage</Label>
              <select id="encounter-ai-stage" className="w-full rounded-md border p-2" value={aiStage} onChange={e => { setAiStage(e.target.value); setAiReviewDraft(null); setAiEditable(null); }}>
                <option value="consultation_brief">Consultation brief</option>
                <option value="soap_draft">SOAP draft</option>
                <option value="emr_reconciliation">EMR documentation gaps</option>
                <option value="prescription_review">Prescription documentation checklist</option>
                <option value="referral_brief">Referral documentation brief</option>
                <option value="follow_up_draft">Follow-up proposals</option>
              </select>
              <Button variant="outline" onClick={prepareEncounterAiDraft} disabled={aiWorking}>{aiWorking ? 'Preparing…' : 'Prepare source-linked AI draft'}</Button>
              {aiReviewDraft && (
                <div className="space-y-2 rounded-lg border p-3">
                  <p className="text-sm font-semibold">Unverified AI draft · {aiReviewDraft.status}</p>
                  <p className="text-xs">Source references identify records; they do not establish factual correctness. Review each claim.</p>
                  {(aiReviewDraft.output?.assertions || []).map((claim, i) => (
                    <div key={i} className="text-sm"><p>{claim.text}</p><p className="text-xs text-slate-500">{(claim.sourceRefs || []).join(', ')}</p></div>
                  ))}
                  {aiReviewDraft.status === 'drafted' && aiEditable && (
                    <>
                      <Label htmlFor="ai-reviewed-summary">Clinician-edited summary</Label>
                      <Textarea id="ai-reviewed-summary" value={aiEditable.summary || ''} onChange={e => setAiEditable({ ...aiEditable, summary: e.target.value })} />
                      {aiReviewDraft.suggestion_type === 'soap_draft' && ['subjective', 'objective', 'assessment', 'plan'].map(field => (
                        <div key={field}>
                          <Label htmlFor={'review-soap-' + field}>{field}</Label>
                          <Textarea id={'review-soap-' + field} value={aiEditable.soapDraft?.[field] || ''} onChange={e => setAiEditable({ ...aiEditable, soapDraft: { ...aiEditable.soapDraft, [field]: e.target.value } })} />
                        </div>
                      ))}
                      <div className="flex flex-wrap gap-2">
                        <Button disabled={aiWorking} onClick={() => reviewEncounterAiDraft('accepted')}>Accept original</Button>
                        <Button disabled={aiWorking} variant="outline" onClick={() => reviewEncounterAiDraft('accepted_with_edits')}>Accept edits</Button>
                        <Button disabled={aiWorking} variant="outline" onClick={() => reviewEncounterAiDraft('rejected')}>Reject</Button>
                      </div>
                    </>
                  )}
                  {aiReviewDraft.status === 'accepted' && aiReviewDraft.suggestion_type === 'soap_draft' && (
                    <Link className="text-sm underline" href={pathname + '?aiSuggestionId=' + encodeURIComponent(aiReviewDraft.id)}>Select reviewed SOAP for separate chart import</Link>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PenLine className="w-5 h-5" />
                SOAP Note (append‑only)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedNote ? (
                <div className="flex items-center justify-between">
                  <div className="text-sm text-slate-600">
                    Latest note: {selectedNote.createdAt ? formatDateTime(selectedNote.createdAt) : '—'} · Version {selectedNote.version || 1}
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedNote.isSigned ? (
                      <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">Signed</Badge>
                    ) : (
                      <Badge variant="secondary">Unsigned</Badge>
                    )}
                    {selectedNote.isSigned ? (
                      <Button variant="outline" disabled={noteBusy} onClick={() => setShowAmend(true)}>Amend</Button>
                    ) : (
                      <Button disabled={!canSign} onClick={signNote} className="bg-blue-600 hover:bg-blue-700">
                        <ClipboardSignature className="w-4 h-4 mr-2" />
                        Sign
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">No note created yet.</p>
              )}

              {aiSuggestionId && (
                <div className="rounded-lg border border-violet-200 p-3 space-y-2">
                  <p className="text-sm">Import a clinician-reviewed SOAP draft into an empty editor. This does not save or sign a note, and never replaces an existing note.</p>
                  <Button variant="outline" onClick={importReviewedDraft} disabled={importingDraft || noteBusy || !editorReady}>
                    {importingDraft ? 'Loading reviewed draft…' : 'Load reviewed AI draft'}
                  </Button>
                  {importedAiSuggestionId && <p className="text-xs">Save creates a new unsigned note with recorded AI-source provenance. Verify every field before saving.</p>}
                </div>
              )}
              <div className="grid gap-4">
                <div className="space-y-2">
                  <Label htmlFor="note-subjective">Subjective</Label>
                  <Textarea id="note-subjective" value={noteDraft.subjective} disabled={!editorReady || signingNote || (editor?.note && !validRevision(editor.note)) || !!editor?.note?.isSigned || !!editor?.note?.isLocked} onChange={(e) => changeDraft({ ...currentNoteDraft.current, subjective: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="note-objective">Objective</Label>
                  <Textarea id="note-objective" value={noteDraft.objective} disabled={!editorReady || signingNote || (editor?.note && !validRevision(editor.note)) || !!editor?.note?.isSigned || !!editor?.note?.isLocked} onChange={(e) => changeDraft({ ...currentNoteDraft.current, objective: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="note-assessment">Assessment</Label>
                  <Textarea id="note-assessment" value={noteDraft.assessment} disabled={!editorReady || signingNote || (editor?.note && !validRevision(editor.note)) || !!editor?.note?.isSigned || !!editor?.note?.isLocked} onChange={(e) => changeDraft({ ...currentNoteDraft.current, assessment: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="note-plan">Plan</Label>
                  <Textarea id="note-plan" value={noteDraft.plan} disabled={!editorReady || signingNote || (editor?.note && !validRevision(editor.note)) || !!editor?.note?.isSigned || !!editor?.note?.isLocked} onChange={(e) => changeDraft({ ...currentNoteDraft.current, plan: e.target.value })} />
                </div>
              </div>

              <Button onClick={createOrUpdateNote} disabled={!editorReady || noteBusy || importingDraft || !!editor?.note?.isSigned || !!editor?.note?.isLocked || (editor?.note ? !validRevision(editor.note) || !noteDirty : !SOAP_FIELDS.some(field => noteDraft[field]?.trim()))} className="bg-blue-600 hover:bg-blue-700">
                {savingNote ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Save Note
              </Button>
              <Button variant="outline" onClick={startNewNote} disabled={!editorReady || noteBusy || importingDraft || noteDirty}>New Note</Button>
              <Button variant="outline" onClick={() => { if (!operation.current && !importingDraft) load({ reloadEditor: true }); }} disabled={!editorReady || noteBusy || importingDraft || loading}>Discard edits and reload saved note</Button>
              {noteDirty && <p className="text-sm text-amber-700">Unsaved edits. Save before signing.</p>}
              {editor?.note && !validRevision(editor.note) && <p className="text-sm text-amber-700">The saved note revision is unavailable. Reload the chart before editing or signing.</p>}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={showAmend} onOpenChange={setShowAmend}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Create Amendment</DialogTitle>
            <DialogDescription>Amendments are stored as new versions; originals are never overwritten.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Reason (required)</Label>
              <Input value={amendment.reason} onChange={(e) => setAmendment({ ...amendment, reason: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Subjective (optional)</Label>
              <Textarea value={amendment.subjective} onChange={(e) => setAmendment({ ...amendment, subjective: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Assessment (optional)</Label>
              <Textarea value={amendment.assessment} onChange={(e) => setAmendment({ ...amendment, assessment: e.target.value })} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowAmend(false)}>Cancel</Button>
            <Button onClick={submitAmendment} disabled={amending || !amendment.reason} className="bg-blue-600 hover:bg-blue-700">
              {amending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Create Amendment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showRx} onOpenChange={setShowRx}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Create Prescription Intent (External eRx)</DialogTitle>
            <DialogDescription>
              Stores clinical intent + rationale. The prescription itself is created in iPrescribe.
            </DialogDescription>
          </DialogHeader>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Medication Name *</Label>
              <Input value={rxIntent.medicationName} onChange={(e) => setRxIntent({ ...rxIntent, medicationName: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Generic Name</Label>
              <Input value={rxIntent.genericName} onChange={(e) => setRxIntent({ ...rxIntent, genericName: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Dosage Strength *</Label>
              <Input value={rxIntent.dosageStrength} onChange={(e) => setRxIntent({ ...rxIntent, dosageStrength: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Dosage Form *</Label>
              <Input value={rxIntent.dosageForm} onChange={(e) => setRxIntent({ ...rxIntent, dosageForm: e.target.value })} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Sig Directions *</Label>
              <Textarea value={rxIntent.sigDirections} onChange={(e) => setRxIntent({ ...rxIntent, sigDirections: e.target.value })} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Indication *</Label>
              <Input value={rxIntent.indication} onChange={(e) => setRxIntent({ ...rxIntent, indication: e.target.value })} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowRx(false)}>Cancel</Button>
            <Button
              onClick={createPrescriptionIntent}
              disabled={creatingIntent || !rxIntent.medicationName || !rxIntent.dosageStrength || !rxIntent.dosageForm || !rxIntent.sigDirections || !rxIntent.indication}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {creatingIntent ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Create Intent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


export default function ProviderEncounterChartPage() {
  return <Suspense fallback={<p className="p-6">Loading encounter chart…</p>}><ProviderEncounterChartContent /></Suspense>;
}
