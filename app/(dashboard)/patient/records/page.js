'use client';

import { useState, useEffect } from 'react';
import { FileText, Calendar, Eye, Loader2, Search, ShieldCheck, ClipboardList } from 'lucide-react';
import api, { clinicalEhrAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDateTime } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export default function PatientRecordsPage() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [me, setMe] = useState(null);

  const [encounters, setEncounters] = useState([]);
  const [selectedEncounterId, setSelectedEncounterId] = useState(null);
  const [encounterNotes, setEncounterNotes] = useState([]);
  const [loadingNotes, setLoadingNotes] = useState(false);

  const [consents, setConsents] = useState([]);
  const [consentState, setConsentState] = useState('CA');
  const [capturingConsent, setCapturingConsent] = useState(false);
  const [consentTemplate, setConsentTemplate] = useState(null);
  const [consentAcknowledged, setConsentAcknowledged] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [viewedRecord, setViewedRecord] = useState(null);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const meRes = await api.get('/auth/me');
      const user = meRes?.data?.user;
      if (!user?.id) throw new Error('Your account could not be loaded');
      setMe(user);

      const [recordsRes, encountersRes, consentsRes] = await Promise.all([
        api.get(`/medical-records/patient/${user.id}`).catch(() => ({ data: { success: false } })),
        clinicalEhrAPI.getPatientEncounters(user.id).catch(() => ({ data: { success: false } })),
        clinicalEhrAPI.getConsents(user.id).catch(() => ({ data: { success: false } }))
      ]);

      if (recordsRes.data.success) setRecords(recordsRes.data.records || []);
      if (encountersRes.data.success) setEncounters(encountersRes.data.encounters || []);
      if (consentsRes.data.success) setConsents(consentsRes.data.consents || []);
      if (!recordsRes.data.success || !encountersRes.data.success || !consentsRes.data.success) {
        setLoadError('Some records could not be loaded. Retry before treating this list as complete.');
      }
    } catch {
      setLoadError('Health records could not be loaded. Please retry.');
    } finally {
      setLoading(false);
    }
  };

  const filteredRecords = records.filter(record => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      record.title?.toLowerCase().includes(query) ||
      record.recordType?.toLowerCase().includes(query) ||
      record.content?.toLowerCase().includes(query)
    );
  });

  const loadEncounterNotes = async (encounterId) => {
    setSelectedEncounterId(encounterId);
    setLoadingNotes(true);
    try {
      const res = await clinicalEhrAPI.getEncounterNotes(encounterId);
      if (res.data?.success) {
        setEncounterNotes(res.data.notes || []);
      }
    } catch (e) {
      toast({ title: 'Error', description: 'Failed to load clinical notes', variant: 'destructive' });
    } finally {
      setLoadingNotes(false);
    }
  };

  const reviewConsent = async () => {
    setCapturingConsent(true);
    setConsentAcknowledged(false);
    try {
      const { data } = await clinicalEhrAPI.getConsentTemplate(consentState);
      if (!data?.success || !data.template?.id || !data.template.contentPlain?.trim()) throw new Error('Readable consent text is unavailable. Contact your care team.');
      setConsentTemplate({ ...data.template, patientState: consentState });
    } catch (error) {
      toast({ title: 'Consent unavailable', description: error.message, variant: 'destructive' });
    } finally {
      setCapturingConsent(false);
    }
  };

  const captureConsent = async () => {
    if (!me?.id) return;
    if (!consentTemplate || !consentAcknowledged || consentTemplate.patientState !== consentState) return;
    setCapturingConsent(true);
    try {
      const template = consentTemplate;
      const res = await clinicalEhrAPI.captureConsent({
        templateId: template.id,
        templateVersion: template.version,
        patientState: consentState,
        consentMethod: 'electronic_signature',
        signatureData: { type: 'patient_ack', reviewed: true, timestamp: new Date().toISOString() }
      });
      if (res.data?.success) {
        toast({ title: 'Consent captured', variant: 'success' });
        setConsentTemplate(null);
        setConsentAcknowledged(false);
        const consentsRes = await clinicalEhrAPI.getConsents(me.id);
        if (consentsRes.data?.success) setConsents(consentsRes.data.consents || []);
      }
    } catch (e) {
      toast({ title: 'Error', description: e?.response?.data?.error || e.message || 'Failed to capture consent', variant: 'destructive' });
    } finally {
      setCapturingConsent(false);
    }
  };

  return (
    <div className="clinical-readable space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-blue-500" />
            Health Records
          </h1>
          <p className="text-slate-500 mt-1">Documents and visit notes</p>
        </div>
      </div>

      {loadError && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-base text-amber-950">
        <p>{loadError}</p><Button variant="outline" className="mt-3" onClick={fetchAll} disabled={loading}>Retry loading records</Button>
      </div>}

      <Dialog open={Boolean(viewedRecord)} onOpenChange={(open) => { if (!open) setViewedRecord(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{viewedRecord?.title || 'Health record'}</DialogTitle><DialogDescription>Review the recorded information.</DialogDescription></DialogHeader>
          <p className="whitespace-pre-wrap text-base leading-7">{viewedRecord?.content || 'No readable content is available for this record. Contact your care team for the attachment.'}</p>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(consentTemplate)} onOpenChange={(open) => { if (!open) { setConsentTemplate(null); setConsentAcknowledged(false); } }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{consentTemplate?.title || 'Telehealth consent'}</DialogTitle><DialogDescription>Version {consentTemplate?.version}. Read the consent before signing.</DialogDescription></DialogHeader>
          <div className="whitespace-pre-wrap text-base leading-7">{consentTemplate?.contentPlain}</div>
          <label className="flex min-h-11 items-start gap-3 text-base">
            <input type="checkbox" className="mt-1 h-5 w-5" checked={consentAcknowledged} onChange={(event) => setConsentAcknowledged(event.target.checked)} />
            <span>I have read this consent and agree to the described telehealth service.</span>
          </label>
          <Button onClick={captureConsent} disabled={!consentAcknowledged || capturingConsent}>{capturingConsent ? 'Saving consent...' : 'Agree and sign'}</Button>
        </DialogContent>
      </Dialog>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : (
        <Tabs defaultValue="documents" className="w-full">
          <TabsList>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="clinical">Clinical Notes</TabsTrigger>
            <TabsTrigger value="consent">Telehealth Consent</TabsTrigger>
          </TabsList>

          <TabsContent value="documents" className="mt-4 space-y-4">
            <Card>
              <CardContent className="p-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <Input
                    placeholder="Search documents..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </CardContent>
            </Card>

            {filteredRecords.length === 0 ? (
              <Card className="py-16">
                <div className="text-center">
                  <FileText className="w-16 h-16 text-slate-200 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-slate-700">No Documents Found</h3>
                  <p className="text-sm text-slate-500 mt-1">
                    {searchQuery ? 'No documents match your search' : 'Your uploaded medical records will appear here'}
                  </p>
                </div>
              </Card>
            ) : (
              <div className="grid gap-4">
                {filteredRecords.map((record) => (
                  <Card key={record.id} className="hover:shadow-lg transition-shadow">
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="text-lg font-semibold text-slate-900">{record.title}</h3>
                            <span className="px-2 py-1 bg-slate-100 text-slate-600 text-xs rounded-full capitalize">
                              {record.recordType?.replace('_', ' ')}
                            </span>
                          </div>
                          <p className="text-sm text-slate-600 mb-3 line-clamp-2">{record.content}</p>
                          <div className="flex items-center gap-4 text-sm text-slate-500">
                            <span className="flex items-center gap-1">
                              <Calendar className="w-4 h-4" />
                              {formatDateTime(record.createdAt)}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm" onClick={() => setViewedRecord(record)}>
                            <Eye className="w-4 h-4 mr-2" />
                            View
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="clinical" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="w-5 h-5 text-blue-600" />
                  Visit History
                </CardTitle>
              </CardHeader>
              <CardContent>
                {encounters.length === 0 ? (
                  <p className="text-slate-500">No visits yet.</p>
                ) : (
                  <div className="space-y-3">
                    {encounters.map((e) => (
                      <button
                        key={e.id}
                        onClick={() => loadEncounterNotes(e.id)}
                        className={`w-full text-left p-3 border rounded-lg hover:bg-slate-50 ${selectedEncounterId === e.id ? 'border-blue-300' : ''}`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{e.encounterType?.replaceAll('_', ' ')}</p>
                            <p className="text-sm text-slate-500">
                              {e.encounterStart ? formatDateTime(e.encounterStart) : '—'} · {e.status}
                            </p>
                          </div>
                          <Badge variant="outline">View notes</Badge>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {selectedEncounterId && (
                  <div className="mt-4">
                    <h3 className="font-semibold text-slate-900 mb-2">Visit Notes</h3>
                    {loadingNotes ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                      </div>
                    ) : encounterNotes.length === 0 ? (
                      <p className="text-slate-500">No notes found for this encounter.</p>
                    ) : (
                      <div className="space-y-3">
                        {encounterNotes.map((n) => (
                          <div key={n.id} className="p-3 border rounded-lg">
                            <div className="flex items-center justify-between">
                              <p className="font-medium capitalize">{n.noteType}</p>
                              <Badge variant={n.isSigned ? 'outline' : 'secondary'}>{n.isSigned ? 'Signed' : 'Unsigned'}</Badge>
                            </div>
                            <p className="text-sm text-slate-600 mt-2 whitespace-pre-wrap">{n.assessment || n.subjective || '—'}</p>
                            <p className="text-xs text-slate-500 mt-2">Created: {n.createdAt ? formatDateTime(n.createdAt) : '—'}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="consent" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-blue-600" />
                  Telehealth Consent
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">Protected by encryption, role-based access controls, and audit logging.</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid md:grid-cols-3 gap-4 items-end">
                  <div className="space-y-2">
                    <Label>State</Label>
                    <Select value={consentState} onValueChange={(value) => { setConsentState(value); setConsentTemplate(null); setConsentAcknowledged(false); }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {['CA','NY','TX','FL','WA','IL','AZ','CO','GA','NC'].map(s => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={reviewConsent} disabled={capturingConsent} className="bg-blue-600 hover:bg-blue-700">
                    {capturingConsent ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Review & Sign
                  </Button>
                </div>

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
      )}
    </div>
  );
}



