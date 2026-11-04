'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
const transitions = {
  draft: [['sent', 'Record sending'], ['cancelled', 'Cancel draft']],
  sent: [['accepted', 'Record acceptance'], ['declined', 'Record decline'], ['cancelled', 'Cancel referral']],
  accepted: [['completed', 'Record completion'], ['cancelled', 'Cancel referral']],
  declined: [['cancelled', 'Close referral']],
};

export default function NigeriaProviderReferralsPage() {
  const { user } = useAuth();
  const [patients, setPatients] = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [outcomes, setOutcomes] = useState({});
  const request = useRef(null);
  const busy = useRef(false);
  const currentUser = useRef(user?.id);
  currentUser.current = user?.id;

  const loadData = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setErrors({});
    setPatients([]);
    setReferrals([]);
    const result = await Promise.allSettled([
      api.get('/providers/me/patients', { signal: controller.signal }),
      api.get('/ng/clinical/referrals', { signal: controller.signal }),
    ]);
    if (controller.signal.aborted) return;
    const nextErrors = {};
    const patientResult = result[0];
    if (patientResult.status === 'fulfilled' && patientResult.value.data?.success && Array.isArray(patientResult.value.data.patients)) {
      const rows = patientResult.value.data.patients;
      setPatients(rows);
      setForm((current) => rows.some((patient) => patient.id === current.patientUserId) ? current : { ...current, patientUserId: '' });
    } else nextErrors.patients = 'Your patient list could not be loaded. Refresh before creating a referral.';
    const referralResult = result[1];
    if (referralResult.status === 'fulfilled' && referralResult.value.data?.ok && Array.isArray(referralResult.value.data.referrals)) setReferrals(referralResult.value.data.referrals);
    else nextErrors.referrals = 'Referral tracking could not be loaded. Refresh to check the latest status.';
    setErrors(nextErrors);
    setLoading(false);
  }, []);

  useEffect(() => {
    currentUser.current = user?.id;
    setSubmitting(false);
    setForm(emptyForm());
    setOutcomes({});
    setSearchTerm('');
    loadData();
    return () => { request.current?.abort(); currentUser.current = null; };
  }, [loadData, user?.id]);

  const filteredPatients = useMemo(() => patients.filter((patient) => {
    if (!searchTerm.trim()) return true;
    const query = searchTerm.toLowerCase();
    return ([patient.firstName, patient.lastName].filter(Boolean).join(' ') + ' ' + (patient.email || '')).toLowerCase().includes(query);
  }), [patients, searchTerm]);

  const updateForm = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const submitReferral = async (event) => {
    event.preventDefault();
    if (busy.current || loading || errors.patients) return;
    if (!patients.some((patient) => patient.id === form.patientUserId) || !form.reason.trim()) {
      toast({ title: 'Missing referral details', description: 'Select a patient and enter the referral reason.', variant: 'destructive' });
      return;
    }
    const actor = user?.id;
    busy.current = true;
    setSubmitting(true);
    try {
      const { data } = await api.post('/ng/clinical/referrals', {
        patient_user_id: form.patientUserId,
        target_name: form.targetName.trim() || null,
        referral_type: form.referralType,
        priority: form.priority,
        reason: form.reason.trim(),
        clinical_notes: form.clinicalNotes.trim() || null,
        destination_type: 'internal',
      });
      if (currentUser.current !== actor) return;
      if (!data.ok || !data.referral?.id) throw new Error('Submission not confirmed');
      toast({ title: 'Referral draft saved', description: 'Review the destination and coordinate delivery before recording that it was sent.' });
      setForm(emptyForm());
      await loadData();
    } catch (failure) {
      if (currentUser.current !== actor) return;
      toast({ title: 'Referral save not confirmed', description: failure.response?.data?.error || 'Refresh referral tracking before retrying. Your entered details are preserved.', variant: 'destructive' });
    } finally {
      busy.current = false;
      if (currentUser.current === actor) setSubmitting(false);
    }
  };

  const updateReferralStatus = async (referral, status) => {
    if (busy.current || !transitions[referral.status]?.some(([allowed]) => allowed === status)) return;
    const summary = (outcomes[referral.id] || '').trim();
    if (!summary) {
      toast({ title: 'Outcome required', description: 'Record the communication, receiving decision, or closure outcome before changing this status.', variant: 'destructive' });
      return;
    }
    const actor = user?.id;
    busy.current = true;
    setSubmitting(true);
    try {
      const { data } = await api.patch('/ng/clinical/referrals/' + referral.id + '/status', { status, response_summary: summary, reason: summary });
      if (currentUser.current !== actor) return;
      if (!data.ok || data.referral?.status !== status) throw new Error('Update not confirmed');
      toast({ title: 'Referral status recorded', description: 'The recorded status is ' + status.replaceAll('_', ' ') + '.' });
      setOutcomes((current) => ({ ...current, [referral.id]: '' }));
      await loadData();
    } catch (failure) {
      if (currentUser.current !== actor) return;
      toast({ title: 'Status update not confirmed', description: failure.response?.data?.error || 'Refresh referral tracking before trying again.', variant: 'destructive' });
    } finally {
      busy.current = false;
      if (currentUser.current === actor) setSubmitting(false);
    }
  };

  return <div className="space-y-6">
    <PortalPageHeader eyebrow="DoctaRx · Clinical workspace" title="Referrals" description="Create a referral draft and keep the receiving decision, communication, and outcome with the care record." image="/marketing/ng/hero-image-container.png">
      <Button variant="outline" onClick={loadData} disabled={loading || submitting}><RefreshCw className="mr-2 h-5 w-5" aria-hidden="true" />Refresh</Button>
    </PortalPageHeader>
    {Object.values(errors).map((message) => <p key={message} role="alert" className="portal-error">{message}</p>)}
    <p className="rounded-2xl border border-blue-200 bg-blue-50 p-5 leading-7 text-blue-900">Saving a draft does not deliver it to a hospital or specialist. Coordinate through the approved channel and record the actual response and outcome.</p>
    {loading && <p role="status" className="flex items-center gap-3 text-slate-600"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />Loading patients and referrals…</p>}
    <div className="grid items-start gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Share2 className="h-5 w-5 text-blue-600" aria-hidden="true" />Select patient</CardTitle><CardDescription>Patients connected to your provider account.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="relative"><Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" aria-hidden="true" /><Input aria-label="Search patients" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search patients" className="pl-11" disabled={loading || submitting} /></div>
          {!loading && !errors.patients && (filteredPatients.length ? <div className="space-y-3">{filteredPatients.slice(0, 12).map((patient) => <button key={patient.id} type="button" disabled={submitting} aria-pressed={form.patientUserId === patient.id} onClick={() => updateForm('patientUserId', patient.id)} className={'w-full rounded-2xl border px-4 py-4 text-left transition ' + (form.patientUserId === patient.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-blue-300')}>
            <p className="font-semibold text-slate-950">{[patient.firstName, patient.lastName].filter(Boolean).join(' ') || 'Patient'}</p><p className="mt-1 text-slate-600">{patient.email || 'Email not recorded'}</p>
          </button>)}</div> : <p className="portal-empty">{searchTerm ? 'No patients match your search.' : 'No patients are available for this provider account.'}</p>)}
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
          <Button type="submit" disabled={!form.patientUserId || !form.reason.trim()} className="w-full bg-blue-600 text-white hover:bg-blue-700">{submitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" /> : <Send className="mr-2 h-5 w-5" aria-hidden="true" />}Save referral draft</Button>
        </fieldset></form></CardContent>
      </Card>
    </div>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-blue-600" aria-hidden="true" />Referral tracking</CardTitle><CardDescription>Statuses record care-team decisions. External delivery requires the agreed partner channel.</CardDescription></CardHeader>
      <CardContent className="space-y-5">{!loading && !errors.referrals && (referrals.length ? referrals.map((referral) => <div key={referral.id} className="rounded-2xl border border-slate-200 p-5">
        <div className="flex flex-wrap items-center gap-3"><h3 className="font-semibold">{patients.find((patient) => patient.id === referral.patient_user_id) ? [patients.find((patient) => patient.id === referral.patient_user_id).firstName, patients.find((patient) => patient.id === referral.patient_user_id).lastName].filter(Boolean).join(' ') : 'Patient referral'}</h3><span className="rounded-lg bg-blue-50 px-3 py-2 font-medium text-blue-800">{String(referral.status || 'Status not recorded').replaceAll('_', ' ')}</span><span className="rounded-lg bg-slate-100 px-3 py-2 text-slate-700">{referral.priority || 'Priority not recorded'}</span></div>
        <p className="mt-3 leading-7 text-slate-700">{referral.reason || 'Reason not recorded'}</p><p className="mt-2 text-slate-600">Destination: {referral.target_name || 'Not recorded'}</p>
        {referral.response_summary && <p className="mt-3 rounded-xl bg-slate-50 p-4 text-slate-700">Recorded outcome: {referral.response_summary}</p>}
        {transitions[referral.status]?.length > 0 && <div className="mt-5 space-y-3"><Label htmlFor={'referral-outcome-' + referral.id}>Communication or outcome</Label><textarea id={'referral-outcome-' + referral.id} value={outcomes[referral.id] || ''} onChange={(event) => setOutcomes((current) => ({ ...current, [referral.id]: event.target.value }))} maxLength={6000} rows={2} disabled={submitting} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3" /><div className="flex flex-wrap gap-3">{transitions[referral.status].map(([status, label]) => <Button key={status} variant="outline" disabled={submitting || !(outcomes[referral.id] || '').trim()} onClick={() => updateReferralStatus(referral, status)}>{label}</Button>)}</div></div>}
      </div>) : <p className="portal-empty">No referrals are currently visible for this provider account.</p>)}</CardContent>
    </Card>
  </div>;
}
