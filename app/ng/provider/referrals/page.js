'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardList, Loader2, RefreshCw, Search, Send, Share2 } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/use-toast';

export default function NigeriaProviderReferralsPage() {
  const [patients, setPatients] = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [form, setForm] = useState({
    patientUserId: '',
    targetName: '',
    referralType: 'specialist',
    priority: 'routine',
    reason: '',
    clinicalNotes: '',
  });

  const loadData = useCallback(async () => {
    try {
      const [patientResponse, referralResponse] = await Promise.all([
        api.get('/providers/me/patients').catch(() => ({ data: { success: false, patients: [] } })),
        api.get('/ng/clinical/referrals').catch(() => ({ data: { referrals: [] } })),
      ]);
      if (patientResponse.data?.success) setPatients(patientResponse.data.patients || []);
      setReferrals(referralResponse.data?.referrals || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredPatients = useMemo(() => patients.filter((patient) => {
    if (!searchTerm.trim()) return true;
    const query = searchTerm.toLowerCase();
    return `${patient.firstName || ''} ${patient.lastName || ''}`.toLowerCase().includes(query)
      || String(patient.email || '').toLowerCase().includes(query);
  }), [patients, searchTerm]);

  const updateForm = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const submitReferral = async (event) => {
    event.preventDefault();
    if (!form.patientUserId || !form.reason.trim()) {
      toast({ title: 'Missing referral details', description: 'Select a patient and enter the referral reason.', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/ng/clinical/referrals', {
        ...form,
        destinationType: 'internal',
      });
      toast({ title: 'Referral sent', description: 'The referral was saved, exchanged internally, and mapped to a FHIR ServiceRequest.' });
      setForm({ patientUserId: '', targetName: '', referralType: 'specialist', priority: 'routine', reason: '', clinicalNotes: '' });
      await loadData();
    } catch (error) {
      toast({ title: 'Referral failed', description: error.response?.data?.error || 'Unable to send Nigeria referral.', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const updateReferralStatus = async (referralId, status) => {
    setSubmitting(true);
    try {
      await api.patch(`/ng/clinical/referrals/${referralId}/status`, { status });
      toast({ title: 'Referral updated', description: `Referral status changed to ${status.replace(/_/g, ' ')}.` });
      await loadData();
    } catch (error) {
      toast({ title: 'Status update failed', description: error.response?.data?.error || 'Unable to update referral.', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-emerald-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria care referrals</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Send referrals through the Nigeria clinical exchange</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Referrals created here are stored in DoctaRx Nigeria, added to the patient timeline, and mapped to a FHIR R4 ServiceRequest. External hospital delivery stays dependent on a configured partner connection.
        </p>
      </section>

      <Card className="border-emerald-200 bg-emerald-50/70 dark:bg-emerald-950/20">
        <CardContent className="flex items-start gap-3 p-4 text-sm text-emerald-900 dark:text-emerald-100">
          <ClipboardList className="mt-0.5 h-5 w-5 flex-none" />
          <p>Simple steps: choose patient, enter destination or specialty, add clinical reason, send. The system handles the FHIR and exchange records in the background.</p>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Share2 className="h-5 w-5 text-emerald-600" />
              Select patient
            </CardTitle>
            <CardDescription>Use a patient already connected to your provider account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search patients" className="pl-9" />
            </div>
            {filteredPatients.length ? (
              <div className="space-y-3">
                {filteredPatients.slice(0, 12).map((patient) => (
                  <button
                    key={patient.id}
                    type="button"
                    onClick={() => updateForm('patientUserId', patient.id)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                      form.patientUserId === patient.id ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30' : 'border-border hover:border-emerald-300'
                    }`}
                  >
                    <p className="font-semibold text-foreground">{patient.firstName} {patient.lastName}</p>
                    <p className="text-sm text-muted-foreground">{patient.email || 'No email on file'}</p>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                No patients are available yet. Create an appointment or provider-patient relationship first.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle>Referral details</CardTitle>
            <CardDescription>Destination can be a specialist, clinic, hospital team, lab, or internal care coordination.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitReferral} className="space-y-4">
              <Input value={form.targetName} onChange={(event) => updateForm('targetName', event.target.value)} placeholder="Destination or specialty" />
              <div className="grid gap-3 sm:grid-cols-2">
                <select value={form.referralType} onChange={(event) => updateForm('referralType', event.target.value)} className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground">
                  <option value="specialist">Specialist</option>
                  <option value="lab">Lab / diagnostics</option>
                  <option value="hospital">Hospital / clinic</option>
                  <option value="follow_up">Follow-up care</option>
                </select>
                <select value={form.priority} onChange={(event) => updateForm('priority', event.target.value)} className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground">
                  <option value="routine">Routine</option>
                  <option value="urgent">Urgent</option>
                  <option value="emergency">Emergency</option>
                </select>
              </div>
              <Input value={form.reason} onChange={(event) => updateForm('reason', event.target.value)} placeholder="Reason for referral" />
              <textarea value={form.clinicalNotes} onChange={(event) => updateForm('clinicalNotes', event.target.value)} rows={5} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground" placeholder="Clinical notes to include" />
              <Button type="submit" disabled={submitting} className="w-full bg-emerald-600 text-white hover:bg-emerald-500">
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Send referral
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              Referral tracking
            </CardTitle>
            <CardDescription>{'Provider Dashboard -> Referrals -> Status Tracking'}</CardDescription>
          </div>
          <Button type="button" variant="outline" onClick={loadData}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {referrals.length ? referrals.slice(0, 10).map((referral) => (
            <div key={referral.id} className="rounded-2xl border border-border px-4 py-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-foreground">
                      {[referral.patient_first_name, referral.patient_last_name].filter(Boolean).join(' ') || 'Patient referral'}
                    </p>
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                      {String(referral.status || 'sent').replace(/_/g, ' ')}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                      {referral.priority || 'routine'}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{referral.reason || referral.target_name || 'No reason recorded'}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{referral.target_name || 'Internal care coordination'}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={submitting} onClick={() => updateReferralStatus(referral.id, 'accepted')}>
                    Accept
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={submitting} onClick={() => updateReferralStatus(referral.id, 'completed')}>
                    Complete
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={submitting} onClick={() => updateReferralStatus(referral.id, 'declined')}>
                    Decline
                  </Button>
                </div>
              </div>
            </div>
          )) : (
            <div className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
              No referrals are currently visible for this provider account.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
