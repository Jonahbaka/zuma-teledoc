'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  Building2,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Cloud,
  HeartPulse,
  Loader2,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  Stethoscope,
  UserRound,
  UsersRound,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { phcAPI } from '@/lib/api';
import {
  applyOfflineSyncResults,
  clearOfflineClinicalData,
  countOfflineOperations,
  getOrCreateDevicePublicId,
  listOfflineOperations,
  queueOfflineOperation,
} from '@/lib/phc/offlineStore';

const CLINICAL_QUEUE_ROLES = new Set([
  'phc_nurse',
  'remote_clinician',
  'clinical_supervisor',
  'on_call_clinician',
]);
const FOLLOW_UP_ROLES = new Set(['phc_nurse', 'remote_clinician', 'referral_coordinator']);
const REPORTING_ROLES = new Set([
  'facility_admin', 'programme_admin', 'government_analyst',
  'government_reviewer', 'government_approver', 'executive_read_only',
]);

const NEXT_QUEUE_STATE = {
  claimed: 'called',
  called: 'in_consultation',
  in_consultation: 'completed',
};

const VITAL_OPTIONS = {
  blood_pressure: {
    label: 'Blood pressure',
    code: '85354-9',
    valueType: 'quantity_pair',
    unit: 'mmHg',
    primaryLabel: 'Systolic',
    secondaryLabel: 'Diastolic',
  },
  pulse: {
    label: 'Pulse',
    code: '8867-4',
    valueType: 'numeric',
    unit: 'beats/min',
    primaryLabel: 'Value',
  },
  temperature: {
    label: 'Temperature',
    code: '8310-5',
    valueType: 'numeric',
    unit: '°C',
    primaryLabel: 'Value',
  },
  oxygen_saturation: {
    label: 'Oxygen saturation',
    code: '59408-5',
    valueType: 'numeric',
    unit: '%',
    primaryLabel: 'Value',
  },
};

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (character) => (
    Number(character) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(character) / 4)))
  ).toString(16));
}

function errorMessage(error, fallback = 'The operation could not be completed.') {
  return error?.response?.data?.error || error?.message || fallback;
}

function titleCase(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readableDate(value) {
  if (!value) return 'Not scheduled';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Not scheduled' : parsed.toLocaleString();
}

function priorityVariant(priority) {
  if (priority === 'emergency') return 'destructive';
  if (priority === 'urgent' || priority === 'priority') return 'warning';
  return 'secondary';
}

function WorkspaceShell({ children, user, context, online, pendingCount, onSync, syncing, onLogout }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1480px] flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-700 text-white shadow-sm">
              <HeartPulse className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">DoctaRx Nigeria</p>
              <h1 className="text-xl font-bold">PHC Care Workspace</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={online ? 'success' : 'warning'} className="gap-1.5">
              {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
              {online ? 'Online' : 'Offline'}
            </Badge>
            {pendingCount > 0 && (
              <Button variant="outline" size="sm" onClick={onSync} disabled={!online || syncing}>
                {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Cloud className="mr-2 h-4 w-4" />}
                Sync {pendingCount}
              </Button>
            )}
            {context?.programme_role && <Badge variant="outline">{titleCase(context.programme_role)}</Badge>}
            <span className="hidden text-slate-600 md:inline">
              {user?.firstName || user?.first_name || user?.email}
            </span>
            <Button variant="ghost" size="sm" onClick={onLogout}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}

export default function PhcWorkspace() {
  const router = useRouter();
  const { user, loading: authLoading, isAuthenticated, logout } = useAuth();
  const [online, setOnline] = useState(true);
  const [contexts, setContexts] = useState([]);
  const [contextKey, setContextKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [patients, setPatients] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [activeEncounter, setActiveEncounter] = useState(null);
  const [vitalType, setVitalType] = useState('blood_pressure');
  const [vitalPrimary, setVitalPrimary] = useState('');
  const [vitalSecondary, setVitalSecondary] = useState('');
  const [priority, setPriority] = useState('routine');
  const [queue, setQueue] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [followUpTitle, setFollowUpTitle] = useState('');
  const [followUpDueAt, setFollowUpDueAt] = useState('');
  const [reportPeriod, setReportPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [reportPreview, setReportPreview] = useState(null);
  const [reports, setReports] = useState([]);
  const [dhis2Preview, setDhis2Preview] = useState(null);
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [referrals, setReferrals] = useState([]);
  const [referralEntry, setReferralEntry] = useState(null);
  const [referralTarget, setReferralTarget] = useState('');
  const [referralReason, setReferralReason] = useState('');
  const [referralOutcome, setReferralOutcome] = useState('');
  const [clinicalDevices, setClinicalDevices] = useState([]);
  const [capabilities, setCapabilities] = useState({
    offlineClinicalSyncEnabled: false,
    clinicalAiEnabled: false,
  });
  const [offlineCounts, setOfflineCounts] = useState({ pending: 0, failed: 0, conflict: 0, rejected: 0 });

  const context = useMemo(() => contexts.find((item) => (
    `${item.programme_id}:${item.facility_id}` === contextKey
  )) || contexts[0] || null, [contexts, contextKey]);
  const programmeRole = context?.programme_role;
  const canViewQueue = CLINICAL_QUEUE_ROLES.has(programmeRole);
  const canIntake = programmeRole === 'phc_nurse' || programmeRole === 'remote_clinician';
  const canClaim = programmeRole === 'remote_clinician';
  const canFollowUp = FOLLOW_UP_ROLES.has(programmeRole);
  const canReport = REPORTING_ROLES.has(programmeRole);
  const canViewReferrals = ['remote_clinician', 'referral_coordinator'].includes(programmeRole);
  const canGenerateReport = ['facility_admin', 'programme_admin', 'government_analyst'].includes(programmeRole);
  const ownerUserId = user?.id || user?.userId;
  const pendingOfflineCount = offlineCounts.pending + offlineCounts.failed;

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const update = () => setOnline(window.navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      router.replace('/ng/auth/login?role=provider&returnTo=%2Fng%2Fphc');
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    let cancelled = false;
    setLoading(true);
    phcAPI.getContexts()
      .then(({ data }) => {
        if (cancelled) return;
        const available = data.contexts || [];
        setContexts(available);
        if (available[0]) setContextKey(`${available[0].programme_id}:${available[0].facility_id}`);
      })
      .catch((requestError) => {
        if (!cancelled) setError(errorMessage(requestError, 'Programme access could not be loaded.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [authLoading, isAuthenticated]);

  const refreshOfflineCounts = useCallback(async () => {
    if (!context || !ownerUserId || typeof window === 'undefined') return;
    try {
      setOfflineCounts(await countOfflineOperations(ownerUserId, context));
    } catch {
      setOfflineCounts({ pending: 0, failed: 0, conflict: 0, rejected: 0 });
    }
  }, [context, ownerUserId]);

  const refreshWorklists = useCallback(async () => {
    if (!context) return;
    setBusy('refresh');
    setError('');
    try {
      const [queueResponse, followUpResponse, reportResponse, referralResponse, deviceResponse] = await Promise.all([
        CLINICAL_QUEUE_ROLES.has(context.programme_role)
          ? phcAPI.listQueue(context)
          : Promise.resolve({ data: { entries: [] } }),
        FOLLOW_UP_ROLES.has(context.programme_role)
          ? phcAPI.listFollowUps(context)
          : Promise.resolve({ data: { tasks: [] } }),
        REPORTING_ROLES.has(context.programme_role)
          ? phcAPI.listReports(context)
          : Promise.resolve({ data: { reports: [] } }),
        ['remote_clinician', 'referral_coordinator'].includes(context.programme_role)
          ? phcAPI.listReferrals(context)
          : Promise.resolve({ data: { referrals: [] } }),
        context.programme_role === 'phc_nurse'
          ? phcAPI.listClinicalDevices(context)
          : Promise.resolve({ data: { devices: [] } }),
      ]);
      setQueue(queueResponse.data.entries || []);
      setFollowUps(followUpResponse.data.tasks || []);
      setReports(reportResponse.data.reports || []);
      setReferrals(referralResponse.data.referrals || []);
      setClinicalDevices(deviceResponse.data.devices || []);
    } catch (requestError) {
      setError(errorMessage(requestError, 'Worklists could not be refreshed.'));
    } finally {
      setBusy('');
    }
  }, [context]);

  useEffect(() => {
    setSelectedPatient(null);
    setActiveEncounter(null);
    setPatients([]);
    setReportPreview(null);
    setDhis2Preview(null);
    setAiSuggestion(null);
    setReferralEntry(null);
    if (!context) return;
    refreshWorklists();
    refreshOfflineCounts();
    phcAPI.getConfiguration(context)
      .then(({ data }) => setCapabilities(data.capabilities || {}))
      .catch((requestError) => setError(errorMessage(requestError, 'Programme configuration could not be loaded.')));
  }, [context, refreshOfflineCounts, refreshWorklists]);

  const synchronizeOffline = useCallback(async () => {
    if (!online || !context || !ownerUserId || !capabilities.offlineClinicalSyncEnabled) return;
    setBusy('sync');
    setError('');
    try {
      const operations = await listOfflineOperations(ownerUserId, context);
      if (!operations.length) {
        await refreshOfflineCounts();
        return;
      }
      const devicePublicId = await getOrCreateDevicePublicId(ownerUserId);
      await phcAPI.registerOfflineDevice(context, {
        devicePublicId,
        displayName: 'PHC web workspace',
        metadata: {
          platform: window.navigator.platform?.slice(0, 80) || 'web',
          browser: window.navigator.userAgent?.slice(0, 120) || 'browser',
          appVersion: 'phc-web-v1',
        },
      });
      const response = await phcAPI.synchronizeOfflineOperations(context, { devicePublicId, operations });
      await applyOfflineSyncResults(ownerUserId, response.data.results || []);
      await refreshOfflineCounts();
      const rejected = (response.data.results || []).filter((result) => result.status !== 'applied');
      if (rejected.length) {
        setError(`${rejected.length} protected offline operation${rejected.length === 1 ? '' : 's'} require review.`);
      } else {
        setNotice(`${operations.length} protected offline operation${operations.length === 1 ? '' : 's'} synchronized.`);
        await refreshWorklists();
      }
    } catch (requestError) {
      setError(errorMessage(requestError, 'Protected offline operations could not be synchronized.'));
    } finally {
      setBusy('');
    }
  }, [
    capabilities.offlineClinicalSyncEnabled,
    context,
    online,
    ownerUserId,
    refreshOfflineCounts,
    refreshWorklists,
  ]);

  useEffect(() => {
    if (online && pendingOfflineCount > 0 && capabilities.offlineClinicalSyncEnabled) {
      synchronizeOffline();
    }
  }, [capabilities.offlineClinicalSyncEnabled, online, pendingOfflineCount, synchronizeOffline]);

  const run = async (name, operation, successMessage) => {
    setBusy(name);
    setError('');
    setNotice('');
    try {
      const result = await operation();
      if (successMessage) setNotice(successMessage);
      return result;
    } catch (requestError) {
      setError(errorMessage(requestError));
      return null;
    } finally {
      setBusy('');
    }
  };

  const searchPatients = async (event) => {
    event.preventDefault();
    if (query.trim().length < 2) {
      setError('Enter at least two characters to search.');
      return;
    }
    const response = await run('search', () => phcAPI.searchPatients(context, query.trim()));
    if (response) setPatients(response.data.patients || []);
  };

  const createEncounter = async (event) => {
    event.preventDefault();
    if (!selectedPatient || !chiefComplaint.trim()) return;
    const encounterPayload = {
      patientUserId: selectedPatient.id,
      encounterType: 'phc_assisted_telehealth',
      chiefComplaint: chiefComplaint.trim(),
      reasonForVisit: chiefComplaint.trim(),
      identityVerified: true,
      identityVerificationMethod: 'phc_registration_record',
    };
    if (!online) {
      if (!capabilities.offlineClinicalSyncEnabled) {
        setError('Offline clinical capture is not enabled for this programme. Reconnect before opening an encounter.');
        return;
      }
      const clientEncounterId = uuid();
      await run('encounter', async () => {
        await queueOfflineOperation({
          ownerUserId,
          context,
          entityType: 'encounter_draft',
          entityId: clientEncounterId,
          payload: encounterPayload,
        });
        await refreshOfflineCounts();
        return { data: { encounter: { id: clientEncounterId, offline: true } } };
      }, 'Encrypted encounter draft saved on this device.');
      setActiveEncounter({ id: clientEncounterId, offline: true });
      return;
    }
    const response = await run('encounter', () => phcAPI.createEncounter(context, {
      ...encounterPayload,
      idempotencyKey: uuid(),
    }), 'Encounter started. Record observations, then place the patient in the clinician queue.');
    if (response) setActiveEncounter(response.data.encounter);
  };

  const saveVital = async (event) => {
    event.preventDefault();
    const definition = VITAL_OPTIONS[vitalType];
    const primary = Number(vitalPrimary);
    const secondary = Number(vitalSecondary);
    if (!activeEncounter || !Number.isFinite(primary)
      || (definition.valueType === 'quantity_pair' && !Number.isFinite(secondary))) {
      setError('Enter valid observation values.');
      return;
    }
    const observationPayload = {
      encounterId: activeEncounter.id,
      observationCode: definition.code,
      displayName: definition.label,
      valueType: definition.valueType,
      valueNumeric: primary,
      valueNumericSecondary: definition.valueType === 'quantity_pair' ? secondary : null,
      unit: definition.unit,
      method: 'manual',
      observedAt: new Date().toISOString(),
      provenance: { captureSurface: 'phc_workspace', enteredByRole: programmeRole },
    };
    const response = !online
      ? await run('vital', async () => {
        if (!capabilities.offlineClinicalSyncEnabled) throw new Error('Offline clinical capture is not enabled for this programme.');
        await queueOfflineOperation({
          ownerUserId,
          context,
          entityType: 'observation',
          entityId: uuid(),
          payload: observationPayload,
        });
        await refreshOfflineCounts();
        return { data: { observation: { offline: true } } };
      }, `Encrypted ${definition.label.toLowerCase()} saved on this device.`)
      : await run('vital', () => phcAPI.createObservation(context, {
        ...observationPayload,
        idempotencyKey: uuid(),
      }), `${definition.label} recorded with provenance.`);
    if (response) {
      setVitalPrimary('');
      setVitalSecondary('');
    }
  };

  const enqueueEncounter = async () => {
    if (!activeEncounter) return;
    const queuePayload = {
      encounterId: activeEncounter.id,
      priority,
      priorityScore: priority === 'emergency' ? 100 : priority === 'urgent' ? 80 : priority === 'priority' ? 65 : 50,
    };
    const response = !online
      ? await run('enqueue', async () => {
        if (!capabilities.offlineClinicalSyncEnabled) throw new Error('Offline clinical capture is not enabled for this programme.');
        await queueOfflineOperation({
          ownerUserId,
          context,
          entityType: 'queue_entry',
          entityId: uuid(),
          payload: queuePayload,
        });
        await refreshOfflineCounts();
        return { data: { queueEntry: { offline: true } } };
      }, 'Encrypted queue request saved on this device.')
      : await run('enqueue', () => phcAPI.enqueue(context, {
        ...queuePayload,
        idempotencyKey: uuid(),
      }), 'Patient added to the remote clinician queue.');
    if (response) {
      setActiveEncounter(null);
      setSelectedPatient(null);
      setChiefComplaint('');
      if (online) await refreshWorklists();
    }
  };

  const claimEntry = async (entryId) => {
    const response = await run(`claim-${entryId}`, () => phcAPI.claimQueueEntry(context, entryId), 'Encounter assigned to you.');
    if (response) await refreshWorklists();
  };

  const advanceEntry = async (entry) => {
    const toStatus = NEXT_QUEUE_STATE[entry.status];
    if (!toStatus) return;
    const response = await run(`advance-${entry.id}`, () => phcAPI.transitionQueueEntry(context, entry.id, {
      toStatus,
      expectedVersion: entry.record_version,
    }), `Encounter moved to ${titleCase(toStatus)}.`);
    if (response) await refreshWorklists();
  };

  const createFollowUp = async (event) => {
    event.preventDefault();
    if (!selectedPatient || !followUpTitle.trim()) return;
    const response = await run('follow-up', () => phcAPI.createFollowUp(context, {
      patientUserId: selectedPatient.id,
      encounterId: activeEncounter?.id || null,
      taskType: 'care_follow_up',
      title: followUpTitle.trim(),
      priority: 'routine',
      dueAt: followUpDueAt ? new Date(followUpDueAt).toISOString() : null,
      idempotencyKey: uuid(),
    }), 'Follow-up task created.');
    if (response) {
      setFollowUpTitle('');
      setFollowUpDueAt('');
      await refreshWorklists();
    }
  };

  const previewAggregateReport = async () => {
    const response = await run('report-preview', () => phcAPI.previewReport(context, reportPeriod));
    if (response) setReportPreview(response.data.preview);
  };

  const generateAggregateReport = async () => {
    const response = await run('report-generate', () => phcAPI.generateReport(context, {
      period: reportPeriod,
      notes: 'Generated from programme-scoped PHC aggregate sources.',
    }), 'Aggregate report generated with versioned source lineage.');
    if (response) {
      setReportPreview({
        period: response.data.report.report_period,
        containsPatientIdentifiers: false,
        values: response.data.values,
        sourceReconciliationHash: response.data.report.source_reconciliation_hash,
      });
      await refreshWorklists();
    }
  };

  const previewDhis2 = async (reportId) => {
    const response = await run(`dhis2-${reportId}`, () => phcAPI.previewDhis2(context, reportId));
    if (response) {
      setDhis2Preview(response.data.preview);
      setNotice('DHIS2 dry run created. No data was transmitted.');
    }
  };

  const requestAiDraft = async (encounterId, suggestionType = 'encounter_summary') => {
    const response = await run(`ai-${encounterId}`, () => phcAPI.createAiSuggestion(context, {
      encounterId,
      suggestionType,
    }), 'AI draft created from the displayed encounter sources. Human review is required.');
    if (response) setAiSuggestion(response.data.suggestion);
  };

  const reviewAiDraft = async (decision) => {
    if (!aiSuggestion) return;
    const response = await run('ai-review', () => phcAPI.reviewAiSuggestion(context, aiSuggestion.id, {
      decision,
      rejectionReason: decision === 'rejected' ? 'Clinician rejected this draft after review.' : null,
    }), decision === 'rejected' ? 'AI draft rejected.' : 'AI draft accepted as reviewed; it was not automatically written to the medical record.');
    if (response) setAiSuggestion((current) => ({ ...current, status: response.data.review.status }));
  };

  const createReferral = async (event) => {
    event.preventDefault();
    if (!referralEntry || !referralReason.trim()) return;
    const response = await run('referral-create', () => phcAPI.createReferral(context, {
      patientUserId: referralEntry.patient_user_id,
      encounterId: referralEntry.encounter_id,
      targetName: referralTarget.trim() || null,
      destinationType: 'external_facility',
      referralType: 'specialist',
      priority: referralEntry.priority === 'emergency' ? 'emergency' : referralEntry.priority === 'urgent' ? 'urgent' : 'routine',
      reason: referralReason.trim(),
      idempotencyKey: uuid(),
    }), 'Referral draft created. It must be sent, accepted and closed through the referral worklist.');
    if (response) {
      setReferralEntry(null);
      setReferralTarget('');
      setReferralReason('');
      await refreshWorklists();
    }
  };

  const transitionReferral = async (referral, toStatus) => {
    const responseSummary = ['declined', 'cancelled', 'completed'].includes(toStatus)
      ? referralOutcome.trim()
      : null;
    if (['declined', 'cancelled', 'completed'].includes(toStatus) && responseSummary.length < 3) {
      setError('Record an outcome or reason before closing this referral stage.');
      return;
    }
    const response = await run(`referral-${referral.id}`, () => phcAPI.transitionReferral(context, referral.id, {
      toStatus,
      responseSummary,
    }), `Referral moved to ${titleCase(toStatus)}.`);
    if (response) {
      setReferralOutcome('');
      await refreshWorklists();
    }
  };

  const captureSyntheticDeviceReading = async (fixtureName) => {
    const device = clinicalDevices.find((item) => item.adapter_key === 'mock_device_v1');
    if (!device || !activeEncounter) return;
    await run(`device-${fixtureName}`, () => phcAPI.captureMockDevice(context, {
      deviceId: device.id,
      encounterId: activeEncounter.id,
      fixtureName,
      idempotencyKey: uuid(),
    }), `Synthetic ${titleCase(fixtureName)} reading captured through the test adapter. Human confirmation remains required.`);
  };

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <Loader2 className="mx-auto h-9 w-9 animate-spin text-emerald-700" />
          <p className="mt-3 text-sm text-slate-600">Loading your programme workspace…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  const handleLogout = async () => {
    if (pendingOfflineCount > 0 && !window.confirm(
      'Signing out securely removes unsynchronized clinical drafts from this device. Continue?'
    )) return;
    try {
      await clearOfflineClinicalData(ownerUserId);
    } finally {
      await logout();
    }
  };

  return (
    <WorkspaceShell
      user={user}
      context={context}
      online={online}
      pendingCount={pendingOfflineCount}
      onSync={synchronizeOffline}
      syncing={busy === 'sync'}
      onLogout={handleLogout}
    >
      <main className="mx-auto max-w-[1480px] px-4 py-6 sm:px-6 lg:px-8">
        {contexts.length === 0 ? (
          <Card className="mx-auto max-w-2xl border-amber-200">
            <CardHeader>
              <CardTitle>No active PHC programme assignment</CardTitle>
              <CardDescription>
                Your account is signed in, but it has no active programme and facility membership.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" onClick={() => router.push('/ng/provider/dashboard')}>Return to portal</Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <section className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="rounded-2xl bg-gradient-to-br from-emerald-800 to-teal-700 p-6 text-white shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-emerald-100">Active care context</p>
                    <h2 className="mt-1 text-2xl font-bold">{context?.facility_name}</h2>
                    <p className="mt-2 max-w-2xl text-sm text-emerald-50">{context?.programme_name}</p>
                  </div>
                  {context?.demo_only && (
                    <Badge className="border-white/20 bg-white/15 text-white hover:bg-white/15">Synthetic demo data only</Badge>
                  )}
                </div>
                <div className="mt-6 flex flex-wrap gap-4 text-sm text-emerald-50">
                  <span className="flex items-center gap-2"><Building2 className="h-4 w-4" /> {context?.facility_code || 'Programme facility'}</span>
                  <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Scoped access and audited activity</span>
                </div>
              </div>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Programme and facility</CardTitle>
                </CardHeader>
                <CardContent>
                  <Label htmlFor="phc-context" className="sr-only">Programme and facility</Label>
                  <select
                    id="phc-context"
                    value={contextKey}
                    onChange={(event) => setContextKey(event.target.value)}
                    className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  >
                    {contexts.map((item) => (
                      <option key={`${item.programme_id}:${item.facility_id}`} value={`${item.programme_id}:${item.facility_id}`}>
                        {item.programme_name} — {item.facility_name}
                      </option>
                    ))}
                  </select>
                  <Button className="mt-3 w-full" variant="outline" onClick={refreshWorklists} disabled={busy === 'refresh'}>
                    <RefreshCw className={`mr-2 h-4 w-4 ${busy === 'refresh' ? 'animate-spin' : ''}`} /> Refresh worklists
                  </Button>
                </CardContent>
              </Card>
            </section>

            {(error || notice || !online) && (
              <div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${
                error ? 'border-red-200 bg-red-50 text-red-800' : !online ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-800'
              }`} role="status">
                {error || (!online
                  ? capabilities.offlineClinicalSyncEnabled
                    ? 'You are offline. Clinical drafts are AES-GCM encrypted on this device and sync only through the registered-device service.'
                    : 'You are offline. Clinical capture is read-only because this programme has not enabled protected offline synchronization.'
                  : notice)}
              </div>
            )}

            <Tabs defaultValue={canIntake ? 'intake' : canViewQueue ? 'queue' : canFollowUp ? 'follow-ups' : 'reporting'}>
              <TabsList className="mb-4 h-auto w-full justify-start gap-1 overflow-x-auto bg-white p-1.5 shadow-sm">
                {canIntake && <TabsTrigger value="intake" className="gap-2"><UserRound className="h-4 w-4" /> Patient intake</TabsTrigger>}
                {canViewQueue && <TabsTrigger value="queue" className="gap-2"><UsersRound className="h-4 w-4" /> Clinician queue <Badge variant="secondary">{queue.length}</Badge></TabsTrigger>}
                {canFollowUp && <TabsTrigger value="follow-ups" className="gap-2"><ClipboardList className="h-4 w-4" /> Follow-ups <Badge variant="secondary">{followUps.length}</Badge></TabsTrigger>}
                {canReport && <TabsTrigger value="reporting" className="gap-2"><ClipboardList className="h-4 w-4" /> Aggregate reporting</TabsTrigger>}
                {canViewReferrals && <TabsTrigger value="referrals" className="gap-2"><ArrowRight className="h-4 w-4" /> Referrals <Badge variant="secondary">{referrals.length}</Badge></TabsTrigger>}
              </TabsList>

              {canIntake && (
                <TabsContent value="intake">
                  <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Find enrolled patient</CardTitle>
                        <CardDescription>Search stays inside the selected programme and facility.</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <form className="flex gap-2" onSubmit={searchPatients}>
                          <Label htmlFor="patient-search" className="sr-only">Name or local patient number</Label>
                          <Input id="patient-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or patient number" />
                          <Button type="submit" size="icon" disabled={busy === 'search'} aria-label="Search patients">
                            {busy === 'search' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                          </Button>
                        </form>
                        <div className="mt-4 space-y-2">
                          {patients.map((patient) => (
                            <button
                              type="button"
                              key={patient.id}
                              onClick={() => { setSelectedPatient(patient); setActiveEncounter(null); }}
                              className={`w-full rounded-xl border p-3 text-left transition ${selectedPatient?.id === patient.id ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200 bg-white hover:border-emerald-300'}`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="font-semibold">{patient.first_name} {patient.last_name}</p>
                                  <p className="mt-1 text-xs text-slate-600">{patient.local_patient_number || 'No local number'} · Phone ending {patient.phone_suffix || '—'}</p>
                                </div>
                                <Badge variant={patient.consent_status === 'granted' ? 'success' : 'warning'}>{titleCase(patient.consent_status)}</Badge>
                              </div>
                            </button>
                          ))}
                          {query && patients.length === 0 && busy !== 'search' && (
                            <p className="py-6 text-center text-sm text-slate-500">No enrolled patients in this context.</p>
                          )}
                        </div>
                      </CardContent>
                    </Card>

                    <div className="space-y-5">
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2 text-lg"><Stethoscope className="h-5 w-5 text-emerald-700" /> Start assisted encounter</CardTitle>
                          <CardDescription>
                            {selectedPatient ? `${selectedPatient.first_name} ${selectedPatient.last_name}` : 'Select an enrolled patient to continue.'}
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <form className="space-y-4" onSubmit={createEncounter}>
                            <div>
                              <Label htmlFor="complaint">Chief complaint</Label>
                              <Textarea id="complaint" className="mt-1.5" value={chiefComplaint} onChange={(event) => setChiefComplaint(event.target.value)} disabled={!selectedPatient || Boolean(activeEncounter)} placeholder="Record the patient’s own words and relevant intake context." />
                            </div>
                            {!activeEncounter && (
                              <Button type="submit" disabled={!selectedPatient || !chiefComplaint.trim() || busy === 'encounter'}>
                                {busy === 'encounter' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                                Open encounter
                              </Button>
                            )}
                            {activeEncounter && (
                              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                                <CheckCircle2 className="mr-2 inline h-4 w-4" /> Encounter open · record ID {activeEncounter.id.slice(0, 8)}
                              </div>
                            )}
                          </form>
                        </CardContent>
                      </Card>

                      {activeEncounter && (
                        <div className="grid gap-5 lg:grid-cols-2">
                          <Card>
                            <CardHeader>
                              <CardTitle className="flex items-center gap-2 text-lg"><Activity className="h-5 w-5 text-rose-600" /> Record observation</CardTitle>
                              <CardDescription>Manual readings are append-only and include capture provenance.</CardDescription>
                            </CardHeader>
                            <CardContent>
                              <form className="space-y-4" onSubmit={saveVital}>
                                <div>
                                  <Label htmlFor="vital-type">Observation</Label>
                                  <select id="vital-type" value={vitalType} onChange={(event) => setVitalType(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">
                                    {Object.entries(VITAL_OPTIONS).map(([key, definition]) => <option key={key} value={key}>{definition.label}</option>)}
                                  </select>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <Label htmlFor="vital-primary">{VITAL_OPTIONS[vitalType].primaryLabel}</Label>
                                    <Input id="vital-primary" type="number" step="any" className="mt-1.5" value={vitalPrimary} onChange={(event) => setVitalPrimary(event.target.value)} />
                                  </div>
                                  {VITAL_OPTIONS[vitalType].valueType === 'quantity_pair' && (
                                    <div>
                                      <Label htmlFor="vital-secondary">{VITAL_OPTIONS[vitalType].secondaryLabel}</Label>
                                      <Input id="vital-secondary" type="number" step="any" className="mt-1.5" value={vitalSecondary} onChange={(event) => setVitalSecondary(event.target.value)} />
                                    </div>
                                  )}
                                </div>
                                <Button type="submit" variant="outline" disabled={busy === 'vital'}>Save observation</Button>
                                {context.demo_only && clinicalDevices.some((item) => item.adapter_key === 'mock_device_v1') && online && (
                                  <div className="rounded-lg border border-dashed border-slate-300 p-3">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Developer device-gateway test</p>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      <Button type="button" size="sm" variant="outline" onClick={() => captureSyntheticDeviceReading('blood_pressure')}>Mock blood pressure</Button>
                                      <Button type="button" size="sm" variant="outline" onClick={() => captureSyntheticDeviceReading('oxygen_saturation')}>Mock oxygen saturation</Button>
                                    </div>
                                    <p className="mt-2 text-xs text-slate-500">Synthetic fixture only; no vendor protocol or hardware support is claimed.</p>
                                  </div>
                                )}
                              </form>
                            </CardContent>
                          </Card>

                          <Card>
                            <CardHeader>
                              <CardTitle className="flex items-center gap-2 text-lg"><Cloud className="h-5 w-5 text-blue-700" /> Send to clinician</CardTitle>
                              <CardDescription>Priority is visible to eligible, verified clinicians only.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                              <div>
                                <Label htmlFor="queue-priority">Priority</Label>
                                <select id="queue-priority" value={priority} onChange={(event) => setPriority(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">
                                  <option value="routine">Routine</option>
                                  <option value="priority">Priority</option>
                                  <option value="urgent">Urgent</option>
                                  <option value="emergency">Emergency</option>
                                </select>
                              </div>
                              {programmeRole === 'phc_nurse' ? (
                                <Button className="w-full" onClick={enqueueEncounter} disabled={busy === 'enqueue'}>Add to clinician queue</Button>
                              ) : (
                                <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">A PHC nurse places completed intake encounters into the dispatch queue.</p>
                              )}
                            </CardContent>
                          </Card>
                        </div>
                      )}

                      {activeEncounter && capabilities.clinicalAiEnabled && online && (
                        <Card className="border-violet-200 bg-violet-50/40">
                          <CardHeader>
                            <CardTitle className="text-lg">AI-assisted handover draft</CardTitle>
                            <CardDescription>Generated only from encounter fields and saved observations. It never signs or changes the medical record.</CardDescription>
                          </CardHeader>
                          <CardContent>
                            <Button variant="outline" onClick={() => requestAiDraft(activeEncounter.id)} disabled={busy === `ai-${activeEncounter.id}`}>
                              {busy === `ai-${activeEncounter.id}` && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                              Prepare grounded draft
                            </Button>
                            {aiSuggestion && (
                              <div className="mt-4 rounded-xl border border-violet-200 bg-white p-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <Badge className="bg-violet-700 text-white hover:bg-violet-700">AI draft · human review required</Badge>
                                  <Badge variant="outline">{titleCase(aiSuggestion.status)}</Badge>
                                </div>
                                <p className="mt-3 whitespace-pre-wrap text-sm text-slate-800">{aiSuggestion.output?.handoverDraft || aiSuggestion.output?.summary}</p>
                                {(aiSuggestion.output?.missingInformation || []).length > 0 && (
                                  <div className="mt-4 rounded-lg bg-violet-50 p-3">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Missing information</p>
                                    {aiSuggestion.output.missingInformation.map((item) => (
                                      <p key={`${item.field}-${item.reason}`} className="mt-1 text-sm">{item.field}: {item.reason}</p>
                                    ))}
                                  </div>
                                )}
                                <p className="mt-3 text-xs text-slate-500">This draft is advisory and cannot update or sign the medical record.</p>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      )}

                      {selectedPatient && canFollowUp && (
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-lg">Create follow-up</CardTitle>
                            <CardDescription>Keep care continuity visible in the programme worklist.</CardDescription>
                          </CardHeader>
                          <CardContent>
                            <form className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-end" onSubmit={createFollowUp}>
                              <div>
                                <Label htmlFor="follow-up-title">Task</Label>
                                <Input id="follow-up-title" className="mt-1.5" value={followUpTitle} onChange={(event) => setFollowUpTitle(event.target.value)} placeholder="e.g. Review blood pressure in 7 days" />
                              </div>
                              <div>
                                <Label htmlFor="follow-up-due">Due date</Label>
                                <Input id="follow-up-due" type="datetime-local" className="mt-1.5" value={followUpDueAt} onChange={(event) => setFollowUpDueAt(event.target.value)} />
                              </div>
                              <Button type="submit" disabled={!followUpTitle.trim() || busy === 'follow-up'}>Create task</Button>
                            </form>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  </div>
                </TabsContent>
              )}

              {canViewQueue && (
                <TabsContent value="queue">
                  <Card>
                    <CardHeader className="flex-row items-start justify-between space-y-0">
                      <div>
                        <CardTitle className="text-lg">Remote clinician queue</CardTitle>
                        <CardDescription>Programme-scoped dispatch ordered by clinical priority and time waiting.</CardDescription>
                      </div>
                      <Button variant="outline" size="sm" onClick={refreshWorklists}><RefreshCw className="mr-2 h-4 w-4" /> Refresh</Button>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {queue.map((entry) => {
                          const next = NEXT_QUEUE_STATE[entry.status];
                          return (
                            <div key={entry.id} className="grid gap-4 rounded-xl border border-slate-200 p-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] lg:items-center">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="font-semibold">{entry.patient_first_name} {entry.patient_last_name}</p>
                                  <Badge variant={priorityVariant(entry.priority)}>{titleCase(entry.priority)}</Badge>
                                  <Badge variant="outline">{titleCase(entry.status)}</Badge>
                                </div>
                                <p className="mt-1 text-sm text-slate-600">{entry.local_patient_number || 'No local number'} · {entry.chief_complaint || 'No complaint recorded'}</p>
                              </div>
                              <div className="text-sm text-slate-600">
                                <p className="flex items-center gap-2"><Clock3 className="h-4 w-4" /> Entered {readableDate(entry.entered_at)}</p>
                                {entry.requested_specialty && <p className="mt-1">Specialty: {titleCase(entry.requested_specialty)}</p>}
                              </div>
                              <div className="flex gap-2 lg:justify-end">
                                {canClaim && entry.status === 'waiting' && (
                                  <Button size="sm" onClick={() => claimEntry(entry.id)} disabled={busy === `claim-${entry.id}`}>Claim</Button>
                                )}
                                {canClaim && next && entry.assigned_provider_user_id && (
                                  <Button size="sm" variant="outline" onClick={() => advanceEntry(entry)} disabled={busy === `advance-${entry.id}`}>
                                    Move to {titleCase(next)}
                                  </Button>
                                )}
                                {canClaim && capabilities.clinicalAiEnabled
                                  && String(entry.assigned_provider_user_id || '') === String(ownerUserId || '')
                                  && ['claimed', 'called', 'in_consultation'].includes(entry.status) && (
                                    <Button size="sm" variant="outline" onClick={() => requestAiDraft(entry.encounter_id)} disabled={busy === `ai-${entry.encounter_id}`}>
                                      AI draft
                                    </Button>
                                  )}
                                {canClaim
                                  && entry.canonical_encounter_id
                                  && String(entry.assigned_provider_user_id || '') === String(ownerUserId || '') && (
                                    <Button size="sm" asChild>
                                      <Link href={`/ng/provider/encounters/${entry.canonical_encounter_id}`}>Open chart</Link>
                                    </Button>
                                  )}
                                {canClaim && entry.assigned_provider_user_id
                                  && String(entry.assigned_provider_user_id) === String(ownerUserId || '') && (
                                    <Button size="sm" variant="outline" onClick={() => setReferralEntry(entry)}>Refer</Button>
                                  )}
                              </div>
                            </div>
                          );
                        })}
                        {queue.length === 0 && <p className="py-12 text-center text-sm text-slate-500">No queue entries in this programme and facility.</p>}
                      </div>

                      {aiSuggestion && (
                        <div className="mt-5 rounded-xl border border-violet-200 bg-violet-50 p-5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <Badge className="bg-violet-700 text-white hover:bg-violet-700">AI draft · human review required</Badge>
                              <h3 className="mt-3 font-semibold">Grounded encounter handover</h3>
                            </div>
                            <Badge variant="outline">{titleCase(aiSuggestion.status)}</Badge>
                          </div>
                          <p className="mt-3 whitespace-pre-wrap text-sm text-slate-800">{aiSuggestion.output?.handoverDraft || aiSuggestion.output?.summary}</p>
                          {(aiSuggestion.output?.missingInformation || []).length > 0 && (
                            <div className="mt-4 rounded-lg bg-white p-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Missing information</p>
                              {aiSuggestion.output.missingInformation.map((item) => (
                                <p key={`${item.field}-${item.reason}`} className="mt-1 text-sm">{item.field}: {item.reason}</p>
                              ))}
                            </div>
                          )}
                          {programmeRole === 'remote_clinician' && aiSuggestion.status === 'drafted' && (
                            <div className="mt-4 flex gap-2">
                              <Button size="sm" onClick={() => reviewAiDraft('accepted')} disabled={busy === 'ai-review'}>Accept reviewed draft</Button>
                              <Button size="sm" variant="outline" onClick={() => reviewAiDraft('rejected')} disabled={busy === 'ai-review'}>Reject</Button>
                            </div>
                          )}
                          <p className="mt-3 text-xs text-slate-500">Acceptance records a review decision only. Clinical documentation still requires the normal clinician-controlled workflow and sign-off.</p>
                        </div>
                      )}

                      {referralEntry && (
                        <form className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-5" onSubmit={createReferral}>
                          <h3 className="font-semibold">Create referral for {referralEntry.patient_first_name} {referralEntry.patient_last_name}</h3>
                          <p className="mt-1 text-sm text-slate-600">Creating a referral does not mark it completed. Coordination and outcome closure remain required.</p>
                          <div className="mt-4 grid gap-3 md:grid-cols-2">
                            <div>
                              <Label htmlFor="referral-target">Destination or specialist</Label>
                              <Input id="referral-target" className="mt-1.5" value={referralTarget} onChange={(event) => setReferralTarget(event.target.value)} placeholder="Receiving facility or specialty" />
                            </div>
                            <div>
                              <Label htmlFor="referral-reason">Clinical reason</Label>
                              <Textarea id="referral-reason" className="mt-1.5" value={referralReason} onChange={(event) => setReferralReason(event.target.value)} />
                            </div>
                          </div>
                          <div className="mt-3 flex gap-2">
                            <Button type="submit" disabled={!referralReason.trim() || busy === 'referral-create'}>Create draft</Button>
                            <Button type="button" variant="ghost" onClick={() => setReferralEntry(null)}>Cancel</Button>
                          </div>
                        </form>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              )}

              {canFollowUp && (
                <TabsContent value="follow-ups">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Care continuity worklist</CardTitle>
                      <CardDescription>Open and scheduled tasks for patients enrolled in this programme.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid gap-3 lg:grid-cols-2">
                        {followUps.map((task) => (
                          <div key={task.id} className="rounded-xl border border-slate-200 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-semibold">{task.title}</p>
                                <p className="mt-1 text-sm text-slate-600">{task.patient_first_name} {task.patient_last_name} · {task.local_patient_number || 'No local number'}</p>
                              </div>
                              <Badge variant={task.status === 'completed' ? 'success' : 'outline'}>{titleCase(task.status)}</Badge>
                            </div>
                            <p className="mt-3 flex items-center gap-2 text-xs text-slate-500"><Clock3 className="h-3.5 w-3.5" /> Due {readableDate(task.due_at)}</p>
                          </div>
                        ))}
                        {followUps.length === 0 && <p className="col-span-full py-12 text-center text-sm text-slate-500">No follow-up tasks in this context.</p>}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              )}

              {canReport && (
                <TabsContent value="reporting">
                  <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Programme aggregate report</CardTitle>
                        <CardDescription>
                          Counts are calculated inside the active programme and facility. Patient names, identifiers and row-level records are excluded.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                          <div className="w-full sm:max-w-[220px]">
                            <Label htmlFor="report-period">Reporting month</Label>
                            <Input id="report-period" type="month" className="mt-1.5" value={reportPeriod} onChange={(event) => setReportPeriod(event.target.value)} />
                          </div>
                          <Button variant="outline" onClick={previewAggregateReport} disabled={busy === 'report-preview'}>
                            {busy === 'report-preview' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Preview
                          </Button>
                          {canGenerateReport && (
                            <Button onClick={generateAggregateReport} disabled={busy === 'report-generate'}>
                              {busy === 'report-generate' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Generate report
                            </Button>
                          )}
                        </div>

                        {reportPreview && (
                          <div className="mt-6">
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                              <h3 className="font-semibold">{reportPreview.period} source-backed values</h3>
                              <Badge variant="success">No patient identifiers</Badge>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              {(reportPreview.values || []).map((value) => (
                                <div key={value.internalKey} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                  <p className="text-xs text-slate-600">{value.displayName}</p>
                                  <p className="mt-1 text-2xl font-bold">{value.value}</p>
                                  <p className="mt-1 text-[11px] text-slate-500">Source v{value.sourceVersion} · {value.sourceTable}</p>
                                </div>
                              ))}
                            </div>
                            {reportPreview.sourceReconciliationHash && (
                              <p className="mt-3 break-all text-[11px] text-slate-500">Reconciliation hash: {reportPreview.sourceReconciliationHash}</p>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    <div className="space-y-5">
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-lg">Generated reports</CardTitle>
                          <CardDescription>DHIS2 actions remain dry-run only from this workspace.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          {reports.map((report) => (
                            <div key={report.id} className="rounded-lg border border-slate-200 p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="font-semibold">{report.report_period}</p>
                                  <p className="text-xs text-slate-500">{titleCase(report.status)} · source v{report.source_definition_version}</p>
                                </div>
                                <Badge variant="success">Aggregate</Badge>
                              </div>
                              {context.can_export && ['programme_admin', 'government_analyst', 'government_reviewer', 'government_approver'].includes(programmeRole) && (
                                <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => previewDhis2(report.id)} disabled={busy === `dhis2-${report.id}`}>
                                  DHIS2 dry run
                                </Button>
                              )}
                            </div>
                          ))}
                          {reports.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No generated reports yet.</p>}
                        </CardContent>
                      </Card>

                      {dhis2Preview && (
                        <Card className="border-blue-200">
                          <CardHeader>
                            <CardTitle className="text-lg">DHIS2 dry-run readiness</CardTitle>
                            <CardDescription>No network submission occurred.</CardDescription>
                          </CardHeader>
                          <CardContent>
                            <div className="flex items-center justify-between text-sm">
                              <span>Mapped aggregate values</span>
                              <strong>{dhis2Preview.payload?.dataValues?.length || 0}</strong>
                            </div>
                            <div className="mt-2 flex items-center justify-between text-sm">
                              <span>Readiness blockers</span>
                              <strong>{dhis2Preview.blockers?.length || 0}</strong>
                            </div>
                            {(dhis2Preview.blockers || []).map((blocker) => <p key={blocker} className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-900">{blocker}</p>)}
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  </div>
                </TabsContent>
              )}

              {canViewReferrals && (
                <TabsContent value="referrals">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Referral coordination and closure</CardTitle>
                      <CardDescription>A referral remains open until its acceptance and outcome are recorded.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="mb-4">
                        <Label htmlFor="referral-outcome">Outcome or closure reason</Label>
                        <Textarea id="referral-outcome" className="mt-1.5 max-w-2xl" value={referralOutcome} onChange={(event) => setReferralOutcome(event.target.value)} placeholder="Required when completing, declining or cancelling a referral." />
                      </div>
                      <div className="space-y-3">
                        {referrals.map((referral) => (
                          <div key={referral.id} className="grid gap-4 rounded-xl border border-slate-200 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-semibold">{referral.patient_first_name} {referral.patient_last_name}</p>
                                <Badge variant={priorityVariant(referral.priority)}>{titleCase(referral.priority)}</Badge>
                                <Badge variant="outline">{titleCase(referral.status)}</Badge>
                              </div>
                              <p className="mt-1 text-sm text-slate-700">{referral.reason}</p>
                              <p className="mt-1 text-xs text-slate-500">Destination: {referral.target_name || titleCase(referral.destination_type)} · Created {readableDate(referral.created_at)}</p>
                              {referral.response_summary && <p className="mt-2 rounded bg-slate-50 p-2 text-sm">Outcome: {referral.response_summary}</p>}
                            </div>
                            <div className="flex flex-wrap gap-2 lg:justify-end">
                              {programmeRole === 'remote_clinician' && referral.status === 'draft' && (
                                <Button size="sm" onClick={() => transitionReferral(referral, 'sent')}>Send referral</Button>
                              )}
                              {programmeRole === 'referral_coordinator' && referral.status === 'sent' && (
                                <>
                                  <Button size="sm" onClick={() => transitionReferral(referral, 'accepted')}>Record acceptance</Button>
                                  <Button size="sm" variant="outline" onClick={() => transitionReferral(referral, 'declined')}>Decline</Button>
                                </>
                              )}
                              {programmeRole === 'referral_coordinator' && referral.status === 'accepted' && (
                                <Button size="sm" onClick={() => transitionReferral(referral, 'completed')}>Close with outcome</Button>
                              )}
                            </div>
                          </div>
                        ))}
                        {referrals.length === 0 && <p className="py-12 text-center text-sm text-slate-500">No referrals in this programme and facility.</p>}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              )}
            </Tabs>
          </>
        )}
      </main>
    </WorkspaceShell>
  );
}
