'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, BarChart3, BrainCircuit, Calendar, ClipboardList, FileText, MessageSquare, Pill, Share2, Users, Video } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import api, { appointmentsAPI, providersAPI, visitsAPI } from '@/lib/api';
import { selectWorkspaceAppointments, noteSigningStatus, workspaceCount } from '@/lib/dashboard-workspace.cjs';
import WorkspaceCharts from '@/components/dashboard/WorkspaceCharts';
import { WorkspaceMetric, WorkspaceAction, WorkspaceDate, WorkspaceHeader, WorkspaceLink, WorkspaceSection, WorkspaceState, WorkspaceStatus } from '@/components/dashboard/WorkspaceElements';

async function fetchProviderAppointments(market) {
  const { data } = await appointmentsAPI.getUpcoming(8);
  if (!data.success || !Array.isArray(data.appointments)) throw new Error('Appointments unavailable');
  if (market === 'us') return { rows: data.appointments };
  try {
    const { data: access } = await api.get('/ng/providers/me/access');
    const providerId = access.providerAccess?.provider?.id || access.providerAccess?.providerId || access.providerAccess?.id;
    if (!providerId) throw new Error();
    const { data: legacy } = await api.get(`/ng/providers/${providerId}/appointments`, { params: { limit: 50 } });
    if (!Array.isArray(legacy.appointments)) throw new Error();
    const rows = [...data.appointments, ...legacy.appointments.map((row) => ({ ...row, legacy: true, scheduledAt: row.scheduled_at, type: row.appointment_type, patientName: row.patient_name }))];
    return { rows };
  } catch { return { rows: data.appointments, partial: true }; }
}
async function fetchProviderPatients() {
  const { data } = await providersAPI.getPatients({ limit: 20 });
  if (!data.success || !Array.isArray(data.patients)) throw new Error('Patients unavailable');
  return data.patients;
}

const patientName = (row) => row.patientFirstName || row.patientLastName
  ? `${row.patientFirstName || ''} ${row.patientLastName || ''}`.trim() : row.patientName || 'Patient';
const encounterPath = (base, appointment) => appointment.legacy
  ? appointment.patient_user_id ? `${base}/patients/${appointment.patient_user_id}/ehr` : `${base}/appointments`
  : `${base}/appointments/${appointment.id}/visit`;
const callPath = (base, appointment) => appointment.legacy
  ? `${base}/call?appointmentId=${encodeURIComponent(appointment.id)}` : `${base}/appointments/${appointment.id}/call`;

export default function NGProviderDashboard({ market = 'ng', view = 'today' }) {
  const base = market === 'us' ? '/provider' : '/ng/provider';
  const { user } = useAuth();
  const [workspace, setWorkspace] = useState({});
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(null);
  const refresh = () => setRevision((value) => value + 1);
  useEffect(() => {
    if (!user?.id) return undefined;
    let cancelled = false;
    setLoading(true); setWorkspace({}); setUpdatedAt(null);
    // Shared endpoints enforce the authenticated market. A US workspace read
    // must not bootstrap a Nigeria provider trial or request Nigeria records.
    const requests = [
      ['appointments', () => fetchProviderAppointments(market)],
      ['patients', fetchProviderPatients],
      ['notes', async () => {
        const { data } = await visitsAPI.getRecent(12);
        if (!data.success || !Array.isArray(data.visits)) throw new Error('Notes unavailable');
        return data.visits;
      }],
    ];
    Promise.all(requests.map(async ([key, fetch]) => {
      try { const result = await fetch(); return [key, Array.isArray(result) ? { rows: result } : result]; }
      catch { return [key, { error: true }]; }
    })).then((results) => {
      if (!cancelled) { setWorkspace(Object.fromEntries(results)); setUpdatedAt(new Date().toISOString()); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [user?.id, market, revision]);

  const appointments = selectWorkspaceAppointments(workspace.appointments?.rows);
  const next = appointments[0];
  const patients = workspace.patients?.rows || [];
  const notes = workspace.notes?.rows || [];
  const unsigned = notes.filter((note) => noteSigningStatus(note) === 'Unsigned');
  const orderedNotes = [...unsigned, ...notes.filter((note) => noteSigningStatus(note) !== 'Unsigned')];
  const state = (key, empty) => <WorkspaceState loading={loading} error={workspace[key]?.error} onRetry={refresh} empty={empty} />;
  const isAnalytics = view === 'analytics';
  const title = isAnalytics ? 'Practice activity' : view === 'notes' ? 'Clinical notes' : 'Your day in care';
  const documentation = <WorkspaceSection title={view === 'notes' ? 'Recent documentation' : 'Documentation queue'} description="Up to 12 recent visit notes. Unsigned notes appear first." action={<Link href={`${base}/visits`} className="inline-flex min-h-11 items-center font-semibold text-indigo-800">All notes</Link>}>
    {loading || workspace.notes?.error || !notes.length ? state('notes', 'No recent visit notes are available. Open a patient encounter to document care.') : <ul className="divide-y divide-slate-200">{orderedNotes.slice(0, view === 'notes' ? 12 : 4).map((note) => <li key={note.id} className="py-4"><div className="flex flex-wrap items-start justify-between gap-3"><h3 className="font-semibold text-slate-950">{patientName(note)}</h3><WorkspaceStatus>{noteSigningStatus(note)}</WorkspaceStatus></div><p className="mt-2 text-sm text-slate-600"><WorkspaceDate value={note.createdAt || note.created_at} /></p>{note.appointmentId ? <Link href={`${base}/appointments/${note.appointmentId}/visit`} className="mt-2 inline-flex min-h-11 items-center gap-2 font-semibold text-indigo-800">{noteSigningStatus(note) === 'Unsigned' ? 'Continue documentation' : 'Review encounter'}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link> : <p className="mt-3 text-sm text-slate-600">Encounter link unavailable. Find this visit in Clinical notes.</p>}</li>)}</ul>}
  </WorkspaceSection>;

  return <div className="premium-workspace">
    <WorkspaceHeader eyebrow="Clinical workspace" title={title} description={isAnalytics ? 'A transparent snapshot of the appointments, patient records, and documentation loaded for your account.' : 'Start the next visit, continue documentation, and keep every handoff in view.'} loading={loading} onRefresh={refresh} updatedAt={updatedAt}>
      <WorkspaceLink href={`${base}/appointments`} primary><Calendar className="h-5 w-5" aria-hidden="true" />Appointments</WorkspaceLink>
      <WorkspaceLink href={`${base}/call`}><Video className="h-5 w-5" aria-hidden="true" />Video consultations</WorkspaceLink>
    </WorkspaceHeader>
    {workspace.appointments?.partial && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">Some Nigeria appointment information could not be loaded. Appointment counts and lists are partial. Select Refresh to try again.</p>}

    <div className="workspace-metrics">
      <WorkspaceMetric title="Appointments" value={workspaceCount(workspace.appointments, loading)} detail="Scheduling records in view" icon={Calendar} tone="blue" />
      <WorkspaceMetric title="Patient records" value={workspaceCount(workspace.patients, loading)} detail="Your visible patient records" icon={Users} tone="violet" />
      <WorkspaceMetric title="Notes to sign" value={loading ? '…' : workspace.notes?.error ? 'Unavailable' : unsigned.length} detail="Across recent visit notes" icon={ClipboardList} tone="amber" />
      <WorkspaceMetric title="Signed notes" value={loading ? '…' : workspace.notes?.error ? 'Unavailable' : notes.filter(note => noteSigningStatus(note) === 'Signed').length} detail="Across recent visit notes" icon={FileText} tone="rose" />
    </div>
    {view !== 'notes' && <WorkspaceCharts appointments={workspace.appointments} notes={workspace.notes} loading={loading} onRetry={refresh} updatedAt={updatedAt} provider expanded={isAnalytics} />}
    <details className="workspace-scope"><summary>About your data · automatic aggregation</summary><p>Charts update from your account records when this page loads or you select Refresh. Up to 8 upcoming or ongoing shared appointments{market === 'ng' ? ', plus up to 50 Nigeria scheduling records' : ''}, up to 20 patient records, and the 12 most recent visit notes. These are loaded subsets, not daily totals or clinical outcome measures.</p></details>
    {!isAnalytics && <>
      {view !== 'notes' && <section aria-labelledby="provider-next-visit" className="workspace-feature"><div className="grid lg:grid-cols-[1.6fr_1fr]">
        <div className="workspace-feature-main"><div className="mb-5 flex items-center gap-3"><span className="rounded-xl bg-indigo-100 p-3 text-indigo-800"><Video className="h-6 w-6" aria-hidden="true" /></span><h2 id="provider-next-visit" className="text-xl font-semibold text-slate-950">Next in your workspace</h2></div>
          {loading || workspace.appointments?.error || !next ? state('appointments', 'No upcoming appointments are available in this view. Review your schedule for the full list.') : <><div className="flex flex-wrap items-center gap-3"><h3 className="text-2xl font-semibold text-slate-950">{patientName(next)}</h3><WorkspaceStatus>{next.status}</WorkspaceStatus></div><p className="mt-4 text-slate-700"><WorkspaceDate value={next.scheduledAt} /></p><p className="mt-2 capitalize text-slate-600">{next.type || 'Consultation'}</p><div className="mt-6 flex flex-wrap gap-3">{next.type === 'video' && <WorkspaceLink href={callPath(base, next)} primary><Video className="h-5 w-5" aria-hidden="true" />Open video visit</WorkspaceLink>}<WorkspaceLink href={encounterPath(base, next)}><ClipboardList className="h-5 w-5" aria-hidden="true" />Open encounter</WorkspaceLink></div><p className="mt-3 text-sm leading-6 text-slate-600">Review the record and visit access before starting care.</p></>}
        </div>
        <div className="workspace-feature-side"><p className="text-sm font-semibold uppercase tracking-widest text-indigo-800">Continue the care</p><h3 className="mt-3 text-xl font-semibold text-slate-950">Documentation at a glance</h3>{loading || workspace.notes?.error ? state('notes', '') : <><p className="mt-5 text-3xl font-semibold text-slate-950">{unsigned.length}<span className="ml-2 text-base font-medium text-slate-600">unsigned</span></p><p className="mt-2 text-sm leading-6 text-slate-600">Among {notes.length} recent visit notes loaded. This is not the full outstanding workload.</p></>}<Link href={`${base}/visits`} className="mt-5 inline-flex min-h-11 items-center gap-2 font-semibold text-indigo-800">Review notes<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></div>
      </div></section>}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <WorkspaceAction compact href={`${base}/patients`} tone="violet" icon={Users} title="Patient records">Open an authorized patient record and care history.</WorkspaceAction>
        <WorkspaceAction compact href={`${base}/prescriptions`} tone="amber" icon={Pill} title="Prescriptions">Review medications and prescription workflows.</WorkspaceAction>
        <WorkspaceAction compact href={`${base}/referrals`} tone="blue" icon={Share2} title="Referrals">Coordinate the next step with another care team.</WorkspaceAction>
        <WorkspaceAction compact href={`${base}/messages`} tone="rose" icon={MessageSquare} title="Messages">Continue patient and care-team conversations.</WorkspaceAction>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[1.35fr_1fr]">
        {view === 'notes' ? documentation : <WorkspaceSection title="Appointment timeline" description="Up to 8 active appointments. Ongoing visits and recent arrivals appear first." action={<Link href={`${base}/schedule`} className="inline-flex min-h-11 items-center font-semibold text-indigo-800">Schedule</Link>}>
          {loading || workspace.appointments?.error || !appointments.length ? state('appointments', 'No active appointments are available in this view.') : <ol>{appointments.map((appointment) => <li key={`${appointment.legacy ? 'legacy-' : ''}${appointment.id}`} className="workspace-timeline-item relative border-l-2 border-violet-200 py-4 pl-6"><span className="absolute -left-[7px] top-6 h-3 w-3 rounded-full border-2 border-white bg-violet-600" aria-hidden="true" /><p className="text-sm text-slate-600"><WorkspaceDate value={appointment.scheduledAt} /></p><h3 className="mt-2 font-semibold text-slate-950">{patientName(appointment)}</h3><div className="mt-2 flex flex-wrap items-center gap-3"><WorkspaceStatus>{appointment.status}</WorkspaceStatus><span className="text-sm capitalize text-slate-600">{appointment.type || 'Consultation'}</span></div><div className="mt-3 flex flex-wrap gap-3"><Link href={encounterPath(base, appointment)} className="inline-flex min-h-11 items-center gap-2 font-semibold text-indigo-800">Open encounter<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>{appointment.type === 'video' && <Link href={callPath(base, appointment)} className="inline-flex min-h-11 items-center gap-2 font-semibold text-indigo-800"><Video className="h-4 w-4" aria-hidden="true" />Open video visit</Link>}</div></li>)}</ol>}
        </WorkspaceSection>}
        <div className="space-y-6">{view !== 'notes' && documentation}<WorkspaceSection title="Patient records" description="A selection of the patient records available to your account." action={<Link href={`${base}/patients`} className="inline-flex min-h-11 items-center font-semibold text-indigo-800">All patients</Link>}>
          {loading || workspace.patients?.error || !patients.length ? state('patients', 'Patients appear here after a care relationship is recorded.') : <ul className="divide-y divide-slate-200">{patients.slice(0, 4).map((patient) => <li key={patient.id} className="py-4"><Link href={`${base}/patients/${patient.id}/ehr`} className="inline-flex min-h-11 items-center gap-2 font-semibold text-indigo-800"><FileText className="h-4 w-4 shrink-0" aria-hidden="true" />{patient.firstName || patient.lastName ? `${patient.firstName || ''} ${patient.lastName || ''}` : 'Open patient record'}</Link><p className="mt-1 text-sm text-slate-600">{patient.lastVisit ? <>Latest appointment: <WorkspaceDate value={patient.lastVisit} /></> : 'Appointment date not recorded'}</p></li>)}</ul>}
        </WorkspaceSection></div>
      </div>
    </>}

    <div className="grid gap-5 md:grid-cols-2"><WorkspaceAction href={`${base}/triage`} icon={BrainCircuit} title="Clinical guidance">Review available triage information in its clinical context. AI assistance requires clinician review and does not replace your assessment.</WorkspaceAction><WorkspaceAction href={`${base}/${isAnalytics ? 'dashboard' : 'analytics'}`} tone="blue" icon={BarChart3} title={isAnalytics ? 'Back to your workspace' : 'Practice activity'}>{isAnalytics ? 'Return to appointments, patient records, and the documentation queue.' : 'See the scope and status of your loaded appointments and visit notes.'}</WorkspaceAction></div>
  </div>;
}
