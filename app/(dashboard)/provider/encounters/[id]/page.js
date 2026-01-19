'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
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

export default function ProviderEncounterChartPage() {
  const params = useParams();
  const encounterId = params.id;

  const [loading, setLoading] = useState(true);
  const [encounter, setEncounter] = useState(null);
  const [notes, setNotes] = useState([]);
  const [intents, setIntents] = useState([]);

  const [savingNote, setSavingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState({
    noteType: 'soap',
    subjective: '',
    objective: '',
    assessment: '',
    plan: '',
    physicalExam: ''
  });

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

  const load = async () => {
    setLoading(true);
    try {
      const [encRes, notesRes, intentsRes] = await Promise.all([
        clinicalEhrAPI.getEncounter(encounterId),
        clinicalEhrAPI.getEncounterNotes(encounterId),
        clinicalEhrAPI.getEncounterPrescriptionIntents(encounterId)
      ]);

      if (encRes.data?.success) setEncounter(encRes.data.encounter);
      if (notesRes.data?.success) setNotes(notesRes.data.notes || []);
      if (intentsRes.data?.success) setIntents(intentsRes.data.prescriptionIntents || []);
    } catch (e) {
      toast({ title: 'Error', description: 'Failed to load encounter chart', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encounterId]);

  const latestNote = useMemo(() => {
    if (!notes.length) return null;
    return notes[0];
  }, [notes]);

  const createOrUpdateNote = async () => {
    setSavingNote(true);
    try {
      if (latestNote && !latestNote.isSigned && latestNote.providerId) {
        // Update existing unsigned note
        const res = await clinicalEhrAPI.updateNote(latestNote.id, noteDraft);
        if (res.data?.success) toast({ title: 'Note updated', variant: 'success' });
      } else {
        const res = await clinicalEhrAPI.createNote(encounterId, noteDraft);
        if (res.data?.success) toast({ title: 'Note created', variant: 'success' });
      }
      await load();
    } catch (e) {
      toast({ title: 'Error', description: e?.response?.data?.error || 'Failed to save note', variant: 'destructive' });
    } finally {
      setSavingNote(false);
    }
  };

  const signNote = async () => {
    if (!latestNote) return;
    try {
      const res = await clinicalEhrAPI.signNote(latestNote.id);
      if (res.data?.success) toast({ title: 'Note signed', variant: 'success' });
      await load();
    } catch (e) {
      toast({ title: 'Error', description: e?.response?.data?.error || 'Failed to sign note', variant: 'destructive' });
    }
  };

  const submitAmendment = async () => {
    if (!latestNote) return;
    setAmending(true);
    try {
      const res = await clinicalEhrAPI.amendNote(latestNote.id, amendment);
      if (res.data?.success) toast({ title: 'Amendment created', variant: 'success' });
      setShowAmend(false);
      setAmendment({ reason: '', subjective: '', objective: '', assessment: '', plan: '' });
      await load();
    } catch (e) {
      toast({ title: 'Error', description: e?.response?.data?.error || 'Failed to create amendment', variant: 'destructive' });
    } finally {
      setAmending(false);
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
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/provider/patients/${encounter?.patientId}/ehr`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-purple-600" />
            Encounter Chart
          </h1>
          <p className="text-slate-500">
            {encounter?.encounterType?.replaceAll('_', ' ')} · {encounter?.encounterStart ? formatDateTime(encounter.encounterStart) : '—'}
          </p>
        </div>
      </div>

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
              <div><span className="text-slate-500">Patient:</span> {encounter?.patientFirstName} {encounter?.patientLastName}</div>
              <div><span className="text-slate-500">Provider:</span> {encounter?.providerFirstName} {encounter?.providerLastName}</div>
              <div><span className="text-slate-500">Patient state:</span> {encounter?.patientState || '—'}</div>
              <div><span className="text-slate-500">Chief complaint:</span> {encounter?.chiefComplaint || '—'}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-green-600" />
                External eRx (iPrescribe)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-600">
                This platform stores **prescription intent** only. Prescriptions are completed in an external eRx system.
              </p>
              <Button onClick={() => setShowRx(true)} className="w-full bg-purple-600 hover:bg-purple-700">
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
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PenLine className="w-5 h-5" />
                SOAP Note (append‑only)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {latestNote ? (
                <div className="flex items-center justify-between">
                  <div className="text-sm text-slate-600">
                    Latest note: {latestNote.createdAt ? formatDateTime(latestNote.createdAt) : '—'} · Version {latestNote.version || 1}
                  </div>
                  <div className="flex items-center gap-2">
                    {latestNote.isSigned ? (
                      <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Signed</Badge>
                    ) : (
                      <Badge variant="secondary">Unsigned</Badge>
                    )}
                    {latestNote.isSigned ? (
                      <Button variant="outline" onClick={() => setShowAmend(true)}>Amend</Button>
                    ) : (
                      <Button onClick={signNote} className="bg-purple-600 hover:bg-purple-700">
                        <ClipboardSignature className="w-4 h-4 mr-2" />
                        Sign
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">No note created yet.</p>
              )}

              <div className="grid gap-4">
                <div className="space-y-2">
                  <Label>Subjective</Label>
                  <Textarea value={noteDraft.subjective} onChange={(e) => setNoteDraft({ ...noteDraft, subjective: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Objective</Label>
                  <Textarea value={noteDraft.objective} onChange={(e) => setNoteDraft({ ...noteDraft, objective: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Assessment</Label>
                  <Textarea value={noteDraft.assessment} onChange={(e) => setNoteDraft({ ...noteDraft, assessment: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Plan</Label>
                  <Textarea value={noteDraft.plan} onChange={(e) => setNoteDraft({ ...noteDraft, plan: e.target.value })} />
                </div>
              </div>

              <Button onClick={createOrUpdateNote} disabled={savingNote} className="bg-purple-600 hover:bg-purple-700">
                {savingNote ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Save Note
              </Button>
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
            <Button onClick={submitAmendment} disabled={amending || !amendment.reason} className="bg-purple-600 hover:bg-purple-700">
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
              className="bg-purple-600 hover:bg-purple-700"
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

