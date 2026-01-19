'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  FileText,
  ClipboardList,
  ShieldCheck,
  Pill,
  AlertTriangle,
  Plus,
  Loader2,
  ExternalLink
} from 'lucide-react';

import { clinicalEhrAPI, providersAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';
import { formatDateTime } from '@/lib/utils';

export default function ProviderPatientEhrPage() {
  const params = useParams();
  const patientId = params.id;

  const [loading, setLoading] = useState(true);
  const [patient, setPatient] = useState(null);
  const [summary, setSummary] = useState(null);

  const [encounters, setEncounters] = useState([]);
  const [allergies, setAllergies] = useState([]);
  const [medications, setMedications] = useState([]);
  const [problems, setProblems] = useState([]);
  const [consents, setConsents] = useState([]);

  const [showNewEncounter, setShowNewEncounter] = useState(false);
  const [creatingEncounter, setCreatingEncounter] = useState(false);
  const [encounterForm, setEncounterForm] = useState({
    encounterType: 'telehealth_video',
    patientState: 'CA',
    patientLocationMethod: 'self_reported',
    providerState: '',
    chiefComplaint: ''
  });

  const [addingAllergy, setAddingAllergy] = useState(false);
  const [allergyForm, setAllergyForm] = useState({
    allergen: '',
    allergenType: 'medication',
    reaction: '',
    severity: 'moderate',
    onsetDate: '',
    source: 'provider_documented'
  });

  const [addingMedication, setAddingMedication] = useState(false);
  const [medicationForm, setMedicationForm] = useState({
    medicationName: '',
    dosage: '',
    frequency: '',
    route: '',
    medicationType: 'prescription',
    isPrn: false,
    source: 'provider_documented',
    prescriberName: ''
  });

  const [addingProblem, setAddingProblem] = useState(false);
  const [problemForm, setProblemForm] = useState({
    icd10Code: '',
    icd10Description: '',
    problemDescription: '',
    problemType: 'chronic',
    priority: 'secondary'
  });

  const loadAll = async () => {
    setLoading(true);
    try {
      const [patientsRes, summaryRes, encountersRes, allergiesRes, medsRes, problemsRes, consentsRes] = await Promise.all([
        providersAPI.getPatients(),
        clinicalEhrAPI.getSummary(patientId),
        clinicalEhrAPI.getPatientEncounters(patientId),
        clinicalEhrAPI.getAllergies(patientId),
        clinicalEhrAPI.getMedications(patientId),
        clinicalEhrAPI.getProblems(patientId),
        clinicalEhrAPI.getConsents(patientId)
      ]);

      if (patientsRes.data?.success) {
        const p = (patientsRes.data.patients || []).find(x => x.id === patientId);
        if (p) setPatient(p);
      }
      if (summaryRes.data?.success) setSummary(summaryRes.data);
      if (encountersRes.data?.success) setEncounters(encountersRes.data.encounters || []);
      if (allergiesRes.data?.success) setAllergies(allergiesRes.data.allergies || []);
      if (medsRes.data?.success) setMedications(medsRes.data.medications || []);
      if (problemsRes.data?.success) setProblems(problemsRes.data.problems || []);
      if (consentsRes.data?.success) setConsents(consentsRes.data.consents || []);
    } catch (e) {
      toast({ title: 'Error', description: 'Failed to load EHR data', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const identityBadge = useMemo(() => {
    const verified = summary?.profile?.identityVerified;
    if (verified) return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Identity Verified</Badge>;
    return <Badge variant="secondary">Identity Not Verified</Badge>;
  }, [summary]);

  const createEncounter = async () => {
    setCreatingEncounter(true);
    try {
      const payload = {
        patientId,
        encounterType: encounterForm.encounterType,
        patientState: encounterForm.patientState,
        patientLocationMethod: encounterForm.patientLocationMethod,
        providerState: encounterForm.providerState || undefined,
        chiefComplaint: encounterForm.chiefComplaint || undefined
      };

      const res = await clinicalEhrAPI.createEncounter(payload);
      if (res.data?.success) {
        toast({ title: 'Encounter created', description: 'Clinical encounter started', variant: 'success' });
        setShowNewEncounter(false);
        await loadAll();
      } else {
        throw new Error(res.data?.error || 'Failed to create encounter');
      }
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Failed to create encounter';
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    } finally {
      setCreatingEncounter(false);
    }
  };

  const addAllergy = async () => {
    setAddingAllergy(true);
    try {
      const payload = { ...allergyForm };
      if (!payload.onsetDate) delete payload.onsetDate;
      const res = await clinicalEhrAPI.addAllergy(patientId, payload);
      if (res.data?.success) {
        toast({ title: 'Allergy added', variant: 'success' });
        setAllergyForm({ ...allergyForm, allergen: '', reaction: '', onsetDate: '' });
        await loadAll();
      }
    } catch (e) {
      toast({ title: 'Error', description: e?.response?.data?.error || 'Failed to add allergy', variant: 'destructive' });
    } finally {
      setAddingAllergy(false);
    }
  };

  const addMedication = async () => {
    setAddingMedication(true);
    try {
      const res = await clinicalEhrAPI.addMedication(patientId, medicationForm);
      if (res.data?.success) {
        toast({ title: 'Medication added', variant: 'success' });
        setMedicationForm({ ...medicationForm, medicationName: '', dosage: '', frequency: '', route: '', prescriberName: '' });
        await loadAll();
      }
    } catch (e) {
      toast({ title: 'Error', description: e?.response?.data?.error || 'Failed to add medication', variant: 'destructive' });
    } finally {
      setAddingMedication(false);
    }
  };

  const addProblem = async () => {
    setAddingProblem(true);
    try {
      const res = await clinicalEhrAPI.addProblem(patientId, problemForm);
      if (res.data?.success) {
        toast({ title: 'Problem added', variant: 'success' });
        setProblemForm({ ...problemForm, icd10Code: '', icd10Description: '', problemDescription: '' });
        await loadAll();
      }
    } catch (e) {
      toast({ title: 'Error', description: e?.response?.data?.error || 'Failed to add problem', variant: 'destructive' });
    } finally {
      setAddingProblem(false);
    }
  };

  if (loading && !patient) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href={`/provider/patients/${patientId}`}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <ClipboardList className="w-6 h-6 text-purple-600" />
              Clinical Chart: {patient?.firstName} {patient?.lastName}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              {identityBadge}
              <Badge variant="outline">Append‑only notes</Badge>
              <Badge variant="outline">External eRx intents</Badge>
            </div>
          </div>
        </div>

        <Button onClick={() => setShowNewEncounter(true)} className="bg-purple-600 hover:bg-purple-700">
          <Plus className="w-4 h-4 mr-2" />
          New Encounter
        </Button>
      </div>

      <Tabs defaultValue="encounters" className="w-full">
        <TabsList>
          <TabsTrigger value="encounters">Encounters</TabsTrigger>
          <TabsTrigger value="allergies">Allergies</TabsTrigger>
          <TabsTrigger value="medications">Medications</TabsTrigger>
          <TabsTrigger value="problems">Problems</TabsTrigger>
          <TabsTrigger value="consents">Telehealth Consent</TabsTrigger>
        </TabsList>

        <TabsContent value="encounters" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Clinical Encounters
              </CardTitle>
            </CardHeader>
            <CardContent>
              {encounters.length === 0 ? (
                <p className="text-slate-500">No clinical encounters yet.</p>
              ) : (
                <div className="space-y-3">
                  {encounters.map((e) => (
                    <div key={e.id} className="p-3 border rounded-lg flex items-center justify-between">
                      <div>
                        <p className="font-medium text-slate-900">{e.encounterType?.replaceAll('_', ' ')}</p>
                        <p className="text-sm text-slate-500">
                          Start: {e.encounterStart ? formatDateTime(e.encounterStart) : '—'} · Status: {e.status}
                        </p>
                      </div>
                      <Link href={`/provider/encounters/${e.id}`}>
                        <Button variant="outline" size="sm">
                          Open Chart <ExternalLink className="w-4 h-4 ml-2" />
                        </Button>
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="allergies" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-500" />
                Allergy List
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Allergen</Label>
                  <Input value={allergyForm.allergen} onChange={(e) => setAllergyForm({ ...allergyForm, allergen: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={allergyForm.allergenType} onValueChange={(v) => setAllergyForm({ ...allergyForm, allergenType: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="medication">Medication</SelectItem>
                      <SelectItem value="food">Food</SelectItem>
                      <SelectItem value="environmental">Environmental</SelectItem>
                      <SelectItem value="latex">Latex</SelectItem>
                      <SelectItem value="contrast">Contrast</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Reaction</Label>
                  <Input value={allergyForm.reaction} onChange={(e) => setAllergyForm({ ...allergyForm, reaction: e.target.value })} />
                </div>
              </div>
              <Button onClick={addAllergy} disabled={addingAllergy || !allergyForm.allergen} className="bg-purple-600 hover:bg-purple-700">
                {addingAllergy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                Add Allergy
              </Button>

              <div className="pt-2 space-y-2">
                {allergies.length === 0 ? (
                  <p className="text-slate-500">No allergies recorded.</p>
                ) : (
                  allergies.map((a) => (
                    <div key={a.id} className="p-3 border rounded-lg">
                      <div className="flex items-center justify-between">
                        <p className="font-medium">{a.allergen || '—'}</p>
                        <Badge variant="outline">{a.allergenType || '—'}</Badge>
                      </div>
                      {a.reaction && <p className="text-sm text-slate-600 mt-1">Reaction: {a.reaction}</p>}
                      <p className="text-xs text-slate-500 mt-1">Active: {String(a.isActive)}</p>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="medications" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Pill className="w-5 h-5 text-purple-600" />
                Medication List (informational)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Medication</Label>
                  <Input value={medicationForm.medicationName} onChange={(e) => setMedicationForm({ ...medicationForm, medicationName: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Dosage</Label>
                  <Input value={medicationForm.dosage} onChange={(e) => setMedicationForm({ ...medicationForm, dosage: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Frequency</Label>
                  <Input value={medicationForm.frequency} onChange={(e) => setMedicationForm({ ...medicationForm, frequency: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Route</Label>
                  <Input value={medicationForm.route} onChange={(e) => setMedicationForm({ ...medicationForm, route: e.target.value })} />
                </div>
              </div>
              <Button onClick={addMedication} disabled={addingMedication || !medicationForm.medicationName} className="bg-purple-600 hover:bg-purple-700">
                {addingMedication ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                Add Medication
              </Button>

              <div className="pt-2 space-y-2">
                {medications.length === 0 ? (
                  <p className="text-slate-500">No medications recorded.</p>
                ) : (
                  medications.map((m) => (
                    <div key={m.id} className="p-3 border rounded-lg">
                      <p className="font-medium">{m.medicationName || '—'}</p>
                      <p className="text-sm text-slate-600">
                        {m.dosage ? `Dosage: ${m.dosage}` : '—'} {m.frequency ? `· ${m.frequency}` : ''} {m.route ? `· ${m.route}` : ''}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">Active: {String(m.isActive)}</p>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="problems" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-blue-600" />
                Problem List / Diagnoses
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>ICD‑10 Code</Label>
                  <Input value={problemForm.icd10Code} onChange={(e) => setProblemForm({ ...problemForm, icd10Code: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>ICD‑10 Description</Label>
                  <Input value={problemForm.icd10Description} onChange={(e) => setProblemForm({ ...problemForm, icd10Description: e.target.value })} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Problem Description</Label>
                  <Textarea value={problemForm.problemDescription} onChange={(e) => setProblemForm({ ...problemForm, problemDescription: e.target.value })} />
                </div>
              </div>
              <Button onClick={addProblem} disabled={addingProblem} className="bg-purple-600 hover:bg-purple-700">
                {addingProblem ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                Add Problem
              </Button>

              <div className="pt-2 space-y-2">
                {problems.length === 0 ? (
                  <p className="text-slate-500">No problems recorded.</p>
                ) : (
                  problems.map((p) => (
                    <div key={p.id} className="p-3 border rounded-lg">
                      <div className="flex items-center justify-between">
                        <p className="font-medium">{p.icd10Code || '—'} {p.icd10Description || ''}</p>
                        <Badge variant="outline">{p.problemType || '—'}</Badge>
                      </div>
                      {p.problemDescription && <p className="text-sm text-slate-600 mt-1">{p.problemDescription}</p>}
                      <p className="text-xs text-slate-500 mt-1">Active: {String(p.isActive)}</p>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="consents" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-green-600" />
                Telehealth Consent History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {consents.length === 0 ? (
                <p className="text-slate-500">No consent records found.</p>
              ) : (
                <div className="space-y-2">
                  {consents.map((c) => (
                    <div key={c.id} className="p-3 border rounded-lg">
                      <div className="flex items-center justify-between">
                        <p className="font-medium">{c.templateTitle || 'Telehealth Consent'}</p>
                        <Badge variant={c.isValid ? 'outline' : 'secondary'}>{c.isValid ? 'Valid' : 'Revoked/Expired'}</Badge>
                      </div>
                      <p className="text-sm text-slate-600 mt-1">
                        State: {c.patientState || '—'} · Captured: {c.consentCapturedAt ? formatDateTime(c.consentCapturedAt) : '—'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={showNewEncounter} onOpenChange={setShowNewEncounter}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Clinical Encounter</DialogTitle>
            <DialogDescription>
              Creates the system-of-record encounter and establishes provider↔patient relationship.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Encounter Type</Label>
              <Select value={encounterForm.encounterType} onValueChange={(v) => setEncounterForm({ ...encounterForm, encounterType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="telehealth_video">Telehealth (Video)</SelectItem>
                  <SelectItem value="telehealth_phone">Telehealth (Phone)</SelectItem>
                  <SelectItem value="telehealth_async">Telehealth (Async)</SelectItem>
                  <SelectItem value="in_person">In‑person</SelectItem>
                  <SelectItem value="chart_review">Chart review</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Patient State (2‑letter)</Label>
                <Input value={encounterForm.patientState} onChange={(e) => setEncounterForm({ ...encounterForm, patientState: e.target.value.toUpperCase().slice(0, 2) })} />
              </div>
              <div className="space-y-2">
                <Label>Location Method</Label>
                <Select value={encounterForm.patientLocationMethod} onValueChange={(v) => setEncounterForm({ ...encounterForm, patientLocationMethod: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="self_reported">Self‑reported</SelectItem>
                    <SelectItem value="ip_geolocation">IP Geolocation</SelectItem>
                    <SelectItem value="gps">GPS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Chief Complaint</Label>
              <Textarea value={encounterForm.chiefComplaint} onChange={(e) => setEncounterForm({ ...encounterForm, chiefComplaint: e.target.value })} />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowNewEncounter(false)}>Cancel</Button>
            <Button onClick={createEncounter} disabled={creatingEncounter} className="bg-purple-600 hover:bg-purple-700">
              {creatingEncounter ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

