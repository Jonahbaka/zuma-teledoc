'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, Search, Send, Share2 } from 'lucide-react';
import api from '@/lib/api';
import PortalPageHeader from '@/components/branding/PortalPageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/components/providers/AuthProvider';

const emptyForm = () => ({ patientUserId: '', targetName: '', referralType: 'specialist', priority: 'routine', reason: '', clinicalNotes: '' });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const referralPayload = (form) => ({
  patient_user_id: form.patientUserId,
  target_name: form.targetName.trim() || null,
  referral_type: form.referralType,
  priority: form.priority,
  reason: form.reason.trim(),
  clinical_notes: form.clinicalNotes.trim() || null,
  destination_type: 'internal',
});
// Keep patient names/emails out of URLs and URL-based telemetry.
const readPatients = (page, search, signal) => search
  ? api.post('/providers/me/patients/search', { limit: 12, page, search }, { signal })
  : api.get('/providers/me/patients', { signal, params: { limit: 12, page } });
const confirmedReferral = (data) => data?.ok === true && uuid.test(data.referral?.id || '')
  && ['draft', 'sent', 'accepted', 'declined', 'completed', 'cancelled'].includes(data.referral.status);
const transitions = {
  draft: [['sent', 'Record sending'], ['cancelled', 'Cancel draft']],
  sent: [['accepted', 'Record acceptance'], ['declined', 'Record decline'], ['cancelled', 'Cancel referral']],
  accepted: [['completed', 'Record completion'], ['cancelled', 'Cancel referral']],
  declined: [['cancelled', 'Close referral']],
};

export default function NigeriaProviderReferralsPage() {
  const { user, loading } = useAuth();
  const accountId = user?.id || user?.userId;
  const market = user?.marketScope || user?.market_scope;
  const ready = !loading && accountId && user?.role === 'provider' && market === 'NG';
  const accountKey = ready ? JSON.stringify([accountId, user.role, market]) : null;
  const session = useRef(accountKey);
  session.current = accountKey;
  if (!ready) return <p role="status">{loading ? 'Loading referrals…' : 'Sign in with your Nigeria provider account to view referrals.'}</p>;
  return <NigeriaProviderReferralsWorkspace key={accountKey} session={session} accountKey={accountKey} />;
}

export function NigeriaProviderReferralsWorkspace({ session, accountKey } = {}) {
  const [patients, setPatients] = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [patientPage, setPatientPage] = useState(1);
  const [patientHasMore, setPatientHasMore] = useState(false);
  const [patientLoading, setPatientLoading] = useState(false);
  const [patientError, setPatientError] = useState(null);
  const patientRequest = useRef(null);
  const patientQuery = useRef('');
  const [form, setForm] = useState(emptyForm);
  const [outcomes, setOutcomes] = useState({});
  const [recovery, setRecovery] = useState(true);
  const [recoveryError, setRecoveryError] = useState('');
  const [checking, setChecking] = useState(false);
  const pendingRequest = useRef(null);
  const attempt = useRef(null);
  const draftVersion = useRef(0);
  const storageKey = `doctarx:referral-unresolved:${accountKey}`;
  const request = useRef(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const isCurrent = useCallback(() => mounted.current && (!session || session.current === accountKey), [session, accountKey]);

  const loadData = useCallback(async () => {
    if (!isCurrent()) return;
    request.current?.abort();
    patientRequest.current?.abort();
    patientRequest.current = null;
    setPatientLoading(false); setPatientError(null);
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setErrors({});
    setPatients([]);
    setReferrals([]);
    const result = await Promise.allSettled([
      readPatients(1, patientQuery.current, controller.signal),
      api.get('/ng/clinical/referrals', { signal: controller.signal }),
    ]);
    if (!isCurrent() || controller.signal.aborted) return;
    const nextErrors = {};
    const patientResult = result[0];
    if (patientResult.status === 'fulfilled' && patientResult.value.data?.success && Array.isArray(patientResult.value.data.patients)) {
      const rows = patientResult.value.data.patients;
      setPatients(rows);
      setPatientPage(1);
      setPatientHasMore(patientResult.value.data.pagination?.hasMore === true);
    } else nextErrors.patients = 'Your patient list could not be loaded. Refresh before creating a referral.';
    const referralResult = result[1];
    if (referralResult.status === 'fulfilled' && referralResult.value.data?.ok && Array.isArray(referralResult.value.data.referrals)) setReferrals(referralResult.value.data.referrals);
    else nextErrors.referrals = 'Referral tracking could not be loaded. Refresh to check the latest status.';
    setErrors(nextErrors);
    setLoading(false);
  }, [isCurrent]);

  const searchPatients = async (page = 1, query = searchTerm.trim()) => {
    if (!isCurrent() || busy.current || loading) return;
    if (page > 1 && patientRequest.current) return;
    patientRequest.current?.abort();
    const controller = new AbortController();
    patientRequest.current = controller;
    patientQuery.current = query;
    setPatientLoading(true); setPatientError(null);
    if (page === 1) { setPatients([]); setPatientHasMore(false); setPatientPage(1); }
    try {
      const { data } = await readPatients(page, query, controller.signal);
      if (!isCurrent() || controller.signal.aborted || patientRequest.current !== controller) return;
      if (!data?.success || !Array.isArray(data.patients)) throw new Error();
      setPatients((current) => page === 1 ? data.patients : [...current, ...data.patients.filter(row => !current.some(known => known.id === row.id))]);
      setPatientPage(page); setPatientHasMore(data.pagination?.hasMore === true);
      setErrors((current) => { const next = { ...current }; delete next.patients; return next; });
    } catch {
      if (isCurrent() && !controller.signal.aborted && patientRequest.current === controller) setPatientError({ page, query });
    } finally {
      if (patientRequest.current === controller) {
        patientRequest.current = null;
        if (isCurrent()) setPatientLoading(false);
      }
    }
  };

  const checkSavedSubmission = useCallback(async () => {
    if (!isCurrent() || busy.current) return;
    busy.current = true;
    setChecking(true);
    try {
      const marker = sessionStorage.getItem(storageKey);
      if (!marker) {
        if (!pendingRequest.current && (!attempt.current || attempt.current.sends === 0)) {
          // A failed storage reservation never reached the server and can be retired.
          attempt.current = null; setRecovery(false); setRecoveryError('');
        } else {
          setRecovery(true);
          setRecoveryError('The recovery reference is missing, but a previous save is still unresolved. Retry the unchanged details with the same reference before starting another referral.');
        }
        return;
      }
      const { requestId } = JSON.parse(marker);
      if (!uuid.test(requestId || '')) throw new Error();
      pendingRequest.current = requestId;
      setRecovery(true);
      const { data } = await api.get(`/ng/clinical/referrals/requests/${encodeURIComponent(requestId)}`);
      if (!isCurrent() || sessionStorage.getItem(storageKey) !== marker) return;
      if (!confirmedReferral(data)) throw new Error();
      sessionStorage.removeItem(storageKey);
      pendingRequest.current = null;
      attempt.current = null;
      setRecovery(false); setRecoveryError('');
      // Reconciliation retires only the old attempt, never the current draft.
      toast({ title: 'Saved referral found', description: 'Saved status: ' + data.referral.status + '. Saving a draft does not deliver it to a receiving team.' });
      await loadData();
    } catch {
      if (isCurrent()) {
        setRecovery(true);
        setRecoveryError('A previous referral save is unresolved. Check its saved status before starting another. No clinical content is stored in this browser.');
      }
    } finally {
      busy.current = false;
      if (isCurrent()) setChecking(false);
    }
  }, [isCurrent, storageKey, loadData]);

  const confirmSubmission = (key) => {
    const marker = sessionStorage.getItem(storageKey);
    if (!marker || JSON.parse(marker).requestId !== key) throw new Error('Recovery marker changed');
    sessionStorage.removeItem(storageKey);
    pendingRequest.current = null; attempt.current = null;
    setRecovery(false); setRecoveryError('');
  };

  useEffect(() => {
    mounted.current = true;
    setSubmitting(false);
    setForm(emptyForm());
    setSelectedPatient(null);
    setOutcomes({});
    setSearchTerm('');
    loadData();
    checkSavedSubmission();
    return () => { request.current?.abort(); patientRequest.current?.abort(); mounted.current = false; };
  }, [loadData, checkSavedSubmission]);

  const updateForm = (field, value) => { draftVersion.current += 1; setForm((current) => ({ ...current, [field]: value })); };
  const canonicalDraft = JSON.stringify(referralPayload(form));
  const retryAllowed = attempt.current?.canonical === canonicalDraft;

  const submitReferral = async (event) => {
    event.preventDefault();
    if (!isCurrent() || busy.current || loading || errors.patients) return;
    if (selectedPatient?.id !== form.patientUserId || !form.reason.trim()) {
      toast({ title: 'Missing referral details', description: 'Select a patient and enter the referral reason.', variant: 'destructive' });
      return;
    }
    const canonical = JSON.stringify(referralPayload(form));
    if (recovery && attempt.current?.canonical !== canonical) return;
    const submittedVersion = draftVersion.current;
    busy.current = true;
    setSubmitting(true);
    let currentAttempt;
    try {
      const marker = sessionStorage.getItem(storageKey);
      if (!attempt.current) attempt.current = { canonical, key: crypto.randomUUID(), sends: 0, fresh: !marker && !pendingRequest.current };
      currentAttempt = attempt.current;
      if (currentAttempt.canonical !== canonical
        || (marker && JSON.parse(marker).requestId !== currentAttempt.key)
        || (pendingRequest.current && pendingRequest.current !== currentAttempt.key)) throw new Error('Earlier save unresolved');
      // Only an opaque account-scoped UUID is persisted, before the mutation.
      sessionStorage.setItem(storageKey, JSON.stringify({ requestId: currentAttempt.key }));
      pendingRequest.current = currentAttempt.key; setRecovery(true);
      currentAttempt.sends += 1;
      const { data } = await api.post('/ng/clinical/referrals', JSON.parse(canonical), { headers: { 'Idempotency-Key': currentAttempt.key } });
      if (!isCurrent()) return;
      if (!confirmedReferral(data)) throw new Error('Submission not confirmed');
      confirmSubmission(currentAttempt.key);
      toast({ title: 'Referral save confirmed', description: 'Current recorded status: ' + data.referral.status + '. This confirmation does not establish delivery to a receiving team.' });
      if (draftVersion.current === submittedVersion) { setForm(emptyForm()); setSelectedPatient(null); }
      await loadData();
    } catch (failure) {
      if (!isCurrent()) return;
      let rejectedBeforeWrite = false;
      if (failure.response?.status === 400 && failure.response?.data?.submissionNotStarted === true
        && currentAttempt?.fresh && currentAttempt.sends === 1) {
        try { confirmSubmission(currentAttempt.key); rejectedBeforeWrite = true; } catch { /* Keep the barrier if storage cannot be reconciled. */ }
      }
      if (!rejectedBeforeWrite) {
        setRecovery(true);
        setRecoveryError('Referral save is unresolved. Retry the unchanged details with the same reference or check saved status before starting another referral.');
      }
      toast({ title: 'Referral save not confirmed', description: failure.response?.data?.error || 'Your entered details are preserved. Check saved status before starting another referral.', variant: 'destructive' });
    } finally {
      busy.current = false;
      if (isCurrent()) setSubmitting(false);
    }
  };

  const updateReferralStatus = async (referral, status) => {
    if (!isCurrent() || busy.current || !transitions[referral.status]?.some(([allowed]) => allowed === status)) return;
    const summary = (outcomes[referral.id] || '').trim();
    if (!summary) {
      toast({ title: 'Outcome required', description: 'Record the communication, receiving decision, or closure outcome before changing this status.', variant: 'destructive' });
      return;
    }
    busy.current = true;
    setSubmitting(true);
    try {
      const { data } = await api.patch('/ng/clinical/referrals/' + referral.id + '/status', { status, response_summary: summary, reason: summary });
      if (!isCurrent()) return;
      if (!data.ok || data.referral?.status !== status) throw new Error('Update not confirmed');
      toast({ title: 'Referral status recorded', description: 'The recorded status is ' + status.replaceAll('_', ' ') + '.' });
      setOutcomes((current) => ({ ...current, [referral.id]: '' }));
      await loadData();
    } catch (failure) {
      if (!isCurrent()) return;
      toast({ title: 'Status update not confirmed', description: failure.response?.data?.error || 'Refresh referral tracking before trying again.', variant: 'destructive' });
    } finally {
      busy.current = false;
      if (isCurrent()) setSubmitting(false);
    }
  };

  return <div className="space-y-6">
    <PortalPageHeader eyebrow="DoctaRx · Clinical workspace" title="Referrals" description="Create a referral draft and keep the receiving decision, communication, and outcome with the care record." image="/marketing/ng/hero-image-container.png">
      <Button variant="outline" onClick={loadData} disabled={loading || submitting}><RefreshCw className="mr-2 h-5 w-5" aria-hidden="true" />Refresh</Button>
    </PortalPageHeader>
    {recovery && <div className="portal-error"><p role="status">An earlier referral save may still be processing. Reconcile it before starting another referral.</p><Button disabled={checking || submitting} onClick={checkSavedSubmission}>{checking ? 'Checking saved status…' : 'Check saved referral'}</Button></div>}
    {recoveryError && <p role="alert" className="portal-error">{recoveryError}</p>}
    {Object.values(errors).map((message) => <p key={message} role="alert" className="portal-error">{message}</p>)}
    <p className="rounded-2xl border border-blue-200 bg-blue-50 p-5 leading-7 text-blue-900">Saving a draft does not deliver it to a hospital or specialist. Coordinate through the approved channel and record the actual response and outcome.</p>
    {loading && <p role="status" className="flex items-center gap-3 text-slate-600"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />Loading patients and referrals…</p>}
    <div className="grid items-start gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Share2 className="h-5 w-5 text-blue-600" aria-hidden="true" />Select patient</CardTitle><CardDescription>Patients connected to your provider account.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" aria-hidden="true" /><Input aria-label="Search patients" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); searchPatients(); } }} maxLength={100} placeholder="Search name or email" className="pl-11" disabled={loading || submitting} /></div>
            <Button type="button" variant="outline" disabled={loading || submitting} onClick={() => searchPatients()}>Search patients</Button>
          </div>
          <p className="text-sm text-slate-600">Search your connected patients by name or email, or load the next page.</p>
          {patientLoading && <p role="status">Loading matching patients…</p>}
          {patientError && <div role="alert" className="portal-error"><p>Patient search could not be loaded. Your referral details are preserved.</p><Button variant="outline" disabled={patientLoading || loading || submitting} onClick={() => searchPatients(patientError.page, patientError.query)}>Retry patient search</Button></div>}
          {selectedPatient && <p className="rounded-xl bg-blue-50 p-3 text-blue-950">Selected patient: {[selectedPatient.firstName, selectedPatient.lastName].filter(Boolean).join(' ') || 'Patient'}{selectedPatient.email ? ' · ' + selectedPatient.email : ''}</p>}
          {!loading && !errors.patients && (patients.length ? <div className="space-y-3">{patients.map((patient) => <button key={patient.id} type="button" disabled={submitting} aria-pressed={form.patientUserId === patient.id} onClick={() => { setSelectedPatient(patient); updateForm('patientUserId', patient.id); }} className={'w-full rounded-2xl border px-4 py-4 text-left transition ' + (form.patientUserId === patient.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-blue-300')}>
            <p className="font-semibold text-slate-950">{[patient.firstName, patient.lastName].filter(Boolean).join(' ') || 'Patient'}</p><p className="mt-1 text-slate-600">{patient.email || 'Email not recorded'}</p>
          </button>)}</div> : !patientLoading && !patientError ? <p className="portal-empty">{patientQuery.current ? 'No patients match your search.' : 'No patients are available for this provider account.'}</p> : null)}
          {patientHasMore && <Button type="button" variant="outline" disabled={patientLoading || loading || submitting} onClick={() => searchPatients(patientPage + 1, patientQuery.current)}>Load more patients</Button>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Referral details</CardTitle><CardDescription>Enter the intended destination and clinical reason.</CardDescription></CardHeader>
        <CardContent><form onSubmit={submitReferral} className="space-y-5"><fieldset disabled={submitting || loading || Boolean(errors.patients)} className="space-y-5">
          <div className="space-y-2"><Label htmlFor="referral-destination">Destination or specialty</Label><Input id="referral-destination" maxLength={255} value={form.targetName} onChange={(event) => updateForm('targetName', event.target.value)} /></div>
          <div className="grid gap-5 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="referral-type">Referral type</Label><select id="referral-type" value={form.referralType} onChange={(event) => updateForm('referralType', event.target.value)} className="min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3"><option value="specialist">Specialist</option><option value="lab">Lab / diagnostics</option><option value="hospital">Hospital / clinic</option><option value="follow_up">Follow-up care</option></select></div>
          <div className="space-y-2"><Label htmlFor="referral-priority">Priority</Label><select id="referral-priority" value={form.priority} onChange={(event) => updateForm('priority', event.target.value)} className="min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3"><option value="routine">Routine</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option></select></div></div>
          <div className="space-y-2"><Label htmlFor="referral-reason">Reason for referral</Label><textarea id="referral-reason" value={form.reason} onChange={(event) => updateForm('reason', event.target.value)} rows={3} maxLength={6000} required className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3" /></div>
          <div className="space-y-2"><Label htmlFor="referral-notes">Supporting clinical notes</Label><textarea id="referral-notes" value={form.clinicalNotes} onChange={(event) => updateForm('clinicalNotes', event.target.value)} rows={5} maxLength={10000} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3" /></div>
          <Button type="submit" disabled={checking || !form.patientUserId || !form.reason.trim() || (recovery && !retryAllowed)} className="w-full bg-blue-600 text-white hover:bg-blue-700">{submitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" /> : <Send className="mr-2 h-5 w-5" aria-hidden="true" />}Save referral draft</Button>
        </fieldset></form></CardContent>
      </Card>
    </div>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-blue-600" aria-hidden="true" />Referral tracking</CardTitle><CardDescription>Statuses record care-team decisions. External delivery requires the agreed partner channel.</CardDescription></CardHeader>
      <CardContent className="space-y-5">{!loading && !errors.referrals && (referrals.length ? referrals.map((referral) => <div key={referral.id} className="rounded-2xl border border-slate-200 p-5">
        <div className="flex flex-wrap items-center gap-3"><h3 className="font-semibold">{referral.patient_display_name || 'Patient referral'}</h3><span className="rounded-lg bg-blue-50 px-3 py-2 font-medium text-blue-800">{String(referral.status || 'Status not recorded').replaceAll('_', ' ')}</span><span className="rounded-lg bg-slate-100 px-3 py-2 text-slate-700">{referral.priority || 'Priority not recorded'}</span></div>
        <p className="mt-3 leading-7 text-slate-700">{referral.reason || 'Reason not recorded'}</p><p className="mt-2 text-slate-600">Destination: {referral.target_name || 'Not recorded'}</p>
        {referral.response_summary && <p className="mt-3 rounded-xl bg-slate-50 p-4 text-slate-700">Recorded outcome: {referral.response_summary}</p>}
        {transitions[referral.status]?.length > 0 && <div className="mt-5 space-y-3"><Label htmlFor={'referral-outcome-' + referral.id}>Communication or outcome</Label><textarea id={'referral-outcome-' + referral.id} value={outcomes[referral.id] || ''} onChange={(event) => setOutcomes((current) => ({ ...current, [referral.id]: event.target.value }))} maxLength={6000} rows={2} disabled={submitting} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3" /><div className="flex flex-wrap gap-3">{transitions[referral.status].map(([status, label]) => <Button key={status} variant="outline" disabled={submitting || !(outcomes[referral.id] || '').trim()} onClick={() => updateReferralStatus(referral, status)}>{label}</Button>)}</div></div>}
      </div>) : <p className="portal-empty">No referrals are currently visible for this provider account.</p>)}</CardContent>
    </Card>
  </div>;
}
