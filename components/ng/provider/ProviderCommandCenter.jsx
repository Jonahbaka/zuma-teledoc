'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AlertTriangle,
  BarChart3,
  BrainCircuit,
  Calendar,
  CheckCircle2,
  ClipboardList,
  FileText,
  HeartPulse,
  Hospital,
  Loader2,
  Pill,
  RefreshCw,
  Route,
  Share2,
  ShieldCheck,
  Stethoscope,
  Users,
  Video,
} from 'lucide-react';
import api, { appointmentsAPI, visitsAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/components/providers/AuthProvider';
import { formatDateTime } from '@/lib/utils';
import { toProviderPortalPath } from '@/lib/providerPortal';
import clinicalIntelligence from '@/lib/ng/providerClinicalIntelligence';

const { deriveProviderClinicalIntelligence } = clinicalIntelligence;

const REFRESH_INTERVAL_MS = 30000;

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatStatus(value) {
  return String(value || 'pending')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function useProviderPath() {
  const pathname = usePathname();
  const { user } = useAuth();
  return useCallback((target) => toProviderPortalPath(target, { pathname, user }), [pathname, user]);
}

function compactPatientName(item = {}) {
  return [
    item.patientFirstName || item.patient_first_name || item.firstName || item.first_name,
    item.patientLastName || item.patient_last_name || item.lastName || item.last_name,
  ].filter(Boolean).join(' ').trim() || item.email || 'Patient';
}

function statusTone(status) {
  const normalized = String(status || '').toLowerCase();
  if (['in_progress', 'accepted_by_pharmacy', 'dispensed', 'completed', 'signed'].includes(normalized)) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  }
  if (['urgent', 'emergency', 'declined_by_pharmacy', 'cancelled', 'no_show'].includes(normalized)) {
    return 'border-red-200 bg-red-50 text-red-800';
  }
  if (['sent', 'confirmed', 'scheduled', 'created'].includes(normalized)) {
    return 'border-sky-200 bg-sky-50 text-sky-800';
  }
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

function FeatureAction({ icon: Icon, label, route, detail, action, tone = 'emerald' }) {
  const toneClasses = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    sky: 'border-sky-200 bg-sky-50 text-sky-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    rose: 'border-rose-200 bg-rose-50 text-rose-700',
    violet: 'border-violet-200 bg-violet-50 text-violet-700',
  };

  return (
    <Link href={route} className="group block rounded-2xl border border-border bg-background p-4 transition hover:border-emerald-300 hover:bg-emerald-50/60">
      <div className="flex items-start gap-3">
        <span className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl border ${toneClasses[tone] || toneClasses.emerald}`}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-foreground">{label}</p>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{detail}</p>
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">{action}</p>
        </div>
      </div>
    </Link>
  );
}

function Metric({ label, value, icon: Icon, detail }) {
  return (
    <Card className="border-border/70">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
            <p className="mt-2 text-3xl font-bold text-slate-950 dark:text-white">{value}</p>
            {detail ? <p className="mt-1 text-sm text-muted-foreground">{detail}</p> : null}
          </div>
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700">
            <Icon className="h-5 w-5" />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function QueueItem({ appointment, providerPath }) {
  const callPath = providerPath(`/appointments/${appointment.id}/call`);
  const visitPath = providerPath(`/appointments/${appointment.id}/visit`);

  return (
    <div className="rounded-2xl border border-border bg-background p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-foreground">{compactPatientName(appointment)}</p>
            <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(appointment.status)}`}>
              {formatStatus(appointment.status)}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{appointment.reasonForVisit || appointment.reason_for_visit || 'Clinical consultation'}</p>
          <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(appointment.scheduledAt || appointment.scheduled_at)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={visitPath}>
            <Button variant="outline" size="sm">
              <FileText className="mr-2 h-4 w-4" />
              SOAP
            </Button>
          </Link>
          <Link href={callPath}>
            <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-500">
              <Video className="mr-2 h-4 w-4" />
              Start Video Call
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

function WorkflowStep({ icon: Icon, label, route, action, providerPath }) {
  return (
    <Link href={providerPath(route)} className="rounded-2xl border border-border bg-background p-4 transition hover:border-emerald-300 hover:bg-emerald-50/60">
      <Icon className="h-5 w-5 text-emerald-700" />
      <p className="mt-3 font-semibold text-foreground">{label}</p>
      <p className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">{action}</p>
    </Link>
  );
}

function IntelligencePanel({ title, value, detail, icon: Icon, tone = 'emerald' }) {
  const toneClasses = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    rose: 'border-rose-200 bg-rose-50 text-rose-800',
    sky: 'border-sky-200 bg-sky-50 text-sky-800',
  };

  return (
    <div className={`rounded-2xl border p-4 ${toneClasses[tone] || toneClasses.emerald}`}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 flex-none" />
        <div>
          <p className="font-semibold">{title}</p>
          <p className="mt-2 text-2xl font-bold">{value}</p>
          <p className="mt-1 text-sm leading-5 opacity-90">{detail}</p>
        </div>
      </div>
    </div>
  );
}

function DataModelPill({ label, active }) {
  return (
    <div className={`rounded-xl border px-3 py-2 text-sm font-medium ${
      active
        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
        : 'border-slate-200 bg-slate-50 text-slate-600'
    }`}>
      {active ? 'Verified in workspace' : 'Needs data'}
      <span className="block text-xs font-normal opacity-80">{label}</span>
    </div>
  );
}

export default function ProviderCommandCenter() {
  const providerPath = useProviderPath();
  const [snapshot, setSnapshot] = useState({
    appointments: [],
    visits: [],
    prescriptions: [],
    referrals: [],
    patients: [],
  });
  const [loading, setLoading] = useState(true);
  const [lastLoadedAt, setLastLoadedAt] = useState(null);
  const [loadErrors, setLoadErrors] = useState([]);

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    const errors = [];
    const [appointmentsResult, visitsResult, prescriptionsResult, referralsResult, patientsResult] = await Promise.allSettled([
      appointmentsAPI.getUpcoming(12),
      visitsAPI.getRecent(12),
      api.get('/ng/clinical/prescriptions', { params: { limit: 20 } }),
      api.get('/ng/clinical/referrals', { params: { limit: 20 } }),
      api.get('/providers/me/patients', { params: { limit: 20 } }),
    ]);

    const nextSnapshot = {
      appointments: appointmentsResult.status === 'fulfilled' ? toArray(appointmentsResult.value.data?.appointments) : [],
      visits: visitsResult.status === 'fulfilled' ? toArray(visitsResult.value.data?.visits) : [],
      prescriptions: prescriptionsResult.status === 'fulfilled' ? toArray(prescriptionsResult.value.data?.prescriptions) : [],
      referrals: referralsResult.status === 'fulfilled' ? toArray(referralsResult.value.data?.referrals) : [],
      patients: patientsResult.status === 'fulfilled' ? toArray(patientsResult.value.data?.patients) : [],
    };

    [
      ['appointments', appointmentsResult],
      ['visits', visitsResult],
      ['prescriptions', prescriptionsResult],
      ['referrals', referralsResult],
      ['patients', patientsResult],
    ].forEach(([key, result]) => {
      if (result.status === 'rejected') {
        errors.push(key);
      }
    });

    setSnapshot(nextSnapshot);
    setLoadErrors(errors);
    setLastLoadedAt(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    load(true);
    const intervalId = window.setInterval(() => {
      if (active && document.visibilityState === 'visible') {
        load(false);
      }
    }, REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [load]);

  const intelligence = useMemo(() => deriveProviderClinicalIntelligence(snapshot), [snapshot]);
  const queue = snapshot.appointments.slice(0, 5);
  const riskTone = intelligence.operationalRisk.score >= 55 ? 'rose' : intelligence.operationalRisk.score >= 35 ? 'amber' : 'emerald';

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-emerald-200/80 bg-[linear-gradient(145deg,rgba(255,255,255,0.98),rgba(236,253,245,0.92))] px-5 py-6 shadow-sm sm:px-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-4xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">DoctaRx Nigeria Provider Command Center</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 md:text-4xl">
              Clinical operations, consultations, EMR, pharmacy, referrals, and intelligence in one workspace
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              Monitor consultations, patient queues, prescriptions, referrals, care-team tasks, and clinical intelligence across the Nigeria provider workspace.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => load(true)}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh
            </Button>
            <Link href={providerPath('/call')}>
              <Button className="bg-emerald-600 text-white hover:bg-emerald-500">
                <Video className="mr-2 h-4 w-4" />
                Open Conferencing
              </Button>
            </Link>
          </div>
        </div>
        {loadErrors.length ? (
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-none" />
            <span>Some panels could not load live data: {loadErrors.join(', ')}.</span>
          </div>
        ) : null}
      </section>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="Active consultations" value={intelligence.counts.activeConsultations} icon={Video} detail="Video queue now" />
        <Metric label="Patient queue" value={intelligence.counts.todayAppointments} icon={Users} detail="Scheduled today" />
        <Metric label="Rx lifecycle" value={intelligence.counts.openPrescriptions} icon={Pill} detail="Open prescriptions" />
        <Metric label="Referral backlog" value={intelligence.counts.pendingReferrals} icon={Share2} detail={`${intelligence.counts.urgentReferrals} urgent`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-emerald-700" />
              Active Consultations
            </CardTitle>
            <CardDescription>{'Provider Dashboard -> Active Consultations -> Start Video Call'}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="flex min-h-40 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
              </div>
            ) : queue.length ? (
              queue.map((appointment) => (
                <QueueItem key={appointment.id} appointment={appointment} providerPath={providerPath} />
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-border p-8 text-center">
                <Video className="mx-auto h-10 w-10 text-emerald-600/70" />
                <p className="mt-3 font-semibold text-foreground">No active consultation queue</p>
                <Link href={providerPath('/call')} className="mt-4 inline-flex">
                  <Button variant="outline">Open Conferencing</Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BrainCircuit className="h-5 w-5 text-emerald-700" />
              AI Clinical Intelligence
            </CardTitle>
            <CardDescription>Risk scoring, care gaps, medication warnings, and operational forecasts</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <IntelligencePanel
              title="Operational risk"
              value={`${intelligence.operationalRisk.score}%`}
              detail={intelligence.operationalRisk.drivers.join(', ') || 'No active driver detected'}
              icon={HeartPulse}
              tone={riskTone}
            />
            <IntelligencePanel
              title={intelligence.forecasts.noShowRisk.label}
              value={intelligence.forecasts.noShowRisk.display}
              detail="Appointment attendance signal"
              icon={Calendar}
              tone={intelligence.forecasts.noShowRisk.value >= 50 ? 'amber' : 'sky'}
            />
            <IntelligencePanel
              title={intelligence.forecasts.pharmacyLoad.label}
              value={intelligence.forecasts.pharmacyLoad.display}
              detail="Prescription workload forecast"
              icon={Pill}
              tone="emerald"
            />
            <IntelligencePanel
              title={intelligence.forecasts.referralEscalation.label}
              value={intelligence.forecasts.referralEscalation.display}
              detail="Referral coordinator workload"
              icon={Route}
              tone={intelligence.forecasts.referralEscalation.value ? 'amber' : 'emerald'}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-emerald-700" />
            Clinical Workflow
          </CardTitle>
          <CardDescription>{'Appointment -> Video -> SOAP -> Diagnosis -> Prescription -> Referral -> Pharmacy -> Follow-up -> EMR'}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <WorkflowStep icon={Calendar} label="Appointments" route="/schedule" action="Open schedule" providerPath={providerPath} />
          <WorkflowStep icon={Video} label="Conferencing" route="/call" action="Start call" providerPath={providerPath} />
          <WorkflowStep icon={FileText} label="SOAP Notes" route="/visits" action="Document visit" providerPath={providerPath} />
          <WorkflowStep icon={Stethoscope} label="EMR Review" route="/patients" action="Open record" providerPath={providerPath} />
          <WorkflowStep icon={Pill} label="Prescriptions" route="/prescriptions" action="Track pharmacy" providerPath={providerPath} />
          <WorkflowStep icon={Share2} label="Referrals" route="/referrals" action="Create referral" providerPath={providerPath} />
          <WorkflowStep icon={Users} label="Care Teams" route="/hospital-network" action="Coordinate care" providerPath={providerPath} />
          <WorkflowStep icon={BarChart3} label="Forecasts" route="/analytics" action="Review analytics" providerPath={providerPath} />
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="border-border/70 xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-700" />
              Operating Workspace
            </CardTitle>
            <CardDescription>Visible provider-dashboard entry points for the major clinical subsystems</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <FeatureAction icon={Video} label="Conference System" route={providerPath('/call')} detail="Visit hub, self-test room, appointment call entry, reconnect controls, chat, and clinical side panel." action="Provider Dashboard -> Conferencing" tone="emerald" />
            <FeatureAction icon={FileText} label="SOAP Workflow" route={providerPath('/visits')} detail="Live note workspace remains attached to appointment visits and the call side panel." action="Provider Dashboard -> SOAP & Visits" tone="sky" />
            <FeatureAction icon={Pill} label="Prescriptions + Pharmacy Status" route={providerPath('/prescriptions')} detail="Digital prescription creation, pharmacy routing, lifecycle status, refill, and audit log panels." action="Provider Dashboard -> Prescriptions" tone="amber" />
            <FeatureAction icon={Share2} label="Referral Network" route={providerPath('/referrals')} detail="Patient-linked referral creation and status queue with FHIR exchange fields where configured." action="Provider Dashboard -> Referrals" tone="violet" />
            <FeatureAction icon={Users} label="Patient Records / EMR" route={providerPath('/patients')} detail="Patient list and record routes, including Nigeria longitudinal clinical record endpoints." action="Provider Dashboard -> EMR" tone="emerald" />
            <FeatureAction icon={Hospital} label="Care Teams + Facility Network" route={providerPath('/hospital-network')} detail="Hospital, specialist, and care-team coordination entry point." action="Provider Dashboard -> Care Teams" tone="sky" />
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HeartPulse className="h-5 w-5 text-emerald-700" />
              Care Model Coverage
            </CardTitle>
            <CardDescription>Coverage is derived from loaded workspace records</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <DataModelPill label="Longitudinal patient records" active={intelligence.careModelCoverage.longitudinalRecords} />
            <DataModelPill label="Chronic disease tracking" active={intelligence.careModelCoverage.chronicDiseaseTracking} />
            <DataModelPill label="Medication history" active={intelligence.careModelCoverage.medicationHistory} />
            <DataModelPill label="Referral chains" active={intelligence.careModelCoverage.referralChains} />
            <DataModelPill label="Outcome tracking" active={intelligence.careModelCoverage.outcomeTracking} />
            <DataModelPill label="Population health signals" active={intelligence.careModelCoverage.populationHealthSignals} />
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            Clinical Alerts
          </CardTitle>
          <CardDescription>Medication warnings, referral recommendations, and care gaps from the loaded records</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-border p-4">
            <p className="font-semibold text-foreground">Medication Safety</p>
            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              {intelligence.medicationWarnings.length ? intelligence.medicationWarnings.map((warning) => (
                <p key={`${warning.title}-${warning.detail}`}>
                  <span className="font-medium text-foreground">{warning.title}:</span> {warning.detail}
                </p>
              )) : <p>No medication warning from loaded records.</p>}
            </div>
          </div>
          <div className="rounded-2xl border border-border p-4">
            <p className="font-semibold text-foreground">Care Gaps</p>
            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              {intelligence.careGaps.length ? intelligence.careGaps.map((gap) => <p key={gap}>{gap}</p>) : <p>No care gap from loaded records.</p>}
            </div>
          </div>
          <div className="rounded-2xl border border-border p-4">
            <p className="font-semibold text-foreground">Referral Recommendations</p>
            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              {intelligence.referralRecommendations.length ? intelligence.referralRecommendations.map((item) => <p key={item}>{item}</p>) : <p>No referral recommendation from loaded records.</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Last refreshed: {lastLoadedAt ? lastLoadedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'not loaded'}
      </p>
    </div>
  );
}
