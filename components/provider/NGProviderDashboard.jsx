'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, BarChart3, BrainCircuit, Calendar, ClipboardList, FileText, MessageSquare, Pill, Share2, Users, Video } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import api, { appointmentsAPI, providersAPI, visitsAPI } from '@/lib/api';
import { selectWorkspaceAppointments, noteSigningStatus, workspaceCount } from '@/lib/dashboard-workspace.cjs';
import { WorkspaceAction, WorkspaceDate, WorkspaceHeader, WorkspaceLink, WorkspaceSection, WorkspaceState, WorkspaceStatus } from '@/components/dashboard/WorkspaceElements';

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
const schedulingStatuses = ['scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'];

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
  const documentation = <WorkspaceSection title={view === 'notes' ? 'Recent documentation' : 'Documentation queue'} description="Up to 12 recent visit notes. Unsigned notes appear first." action={<Link href={`${base}/visits`} className="inline-flex min-h-11 items-center font-semibold text-teal-800">All notes</Link>}>
    {loading || workspace.notes?.error || !notes.length ? state('notes', 'No recent visit notes are available. Open a patient encounter to document care.') : <ul className="divide-y divide-slate-200">{orderedNotes.slice(0, view === 'notes' ? 12 : 4).map((note) => <li key={note.id} className="py-4"><div className="flex flex-wrap items-start justify-between gap-3"><h3 className="font-semibold text-slate-950">{patientName(note)}</h3><WorkspaceStatus>{noteSigningStatus(note)}</WorkspaceStatus></div><p className="mt-2 text-sm text-slate-600"><WorkspaceDate value={note.createdAt || note.created_at} /></p>{note.appointmentId ? <Link href={`${base}/appointments/${note.appointmentId}/visit`} className="mt-2 inline-flex min-h-11 items-center gap-2 font-semibold text-teal-800">{noteSigningStatus(note) === 'Unsigned' ? 'Continue documentation' : 'Review encounter'}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link> : <p className="mt-3 text-sm text-slate-600">Encounter link unavailable. Find this visit in Clinical notes.</p>}</li>)}</ul>}
  </WorkspaceSection>;

  return <div className="space-y-7">
    <WorkspaceHeader eyebrow="Clinical workspace" title={title} description={isAnalytics ? 'A transparent snapshot of the appointments, patient records, and documentation loaded for your account.' : 'Start the next visit, continue documentation, and keep every handoff in view.'} loading={loading} onRefresh={refresh} updatedAt={updatedAt}>
      <WorkspaceLink href={`${base}/appointments`} primary><Calendar className="h-5 w-5" aria-hidden="true" />Appointments</WorkspaceLink>
      <WorkspaceLink href={`${base}/call`}><Video className="h-5 w-5" aria-hidden="true" />Video consultations</WorkspaceLink>
    </WorkspaceHeader>
    {workspace.appointments?.partial && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">Some Nigeria appointment information could not be loaded. Appointment counts and lists are partial. Select Refresh to try again.</p>}

    {isAnalytics ? <>
      <section className="rounded-2xl border border-teal-200 bg-teal-50 p-5 sm:p-6"><h2 className="font-semibold text-teal-950">What this snapshot covers</h2><p className="mt-2 leading-7 text-teal-950">Up to 8 upcoming or ongoing shared appointments{market === 'ng' ? ', plus up to 50 Nigeria scheduling records' : ''}, up to 20 patient records, and the 12 most recent visit notes. These are loaded subsets, not daily totals or clinical outcome measures. Refresh to check for changes.</p></section>
      <div className="grid gap-5 sm:grid-cols-3">{[['appointments', 'Scheduling records loaded', '/appointments'], ['patients', 'Patient records loaded', '/patients'], ['notes', 'Recent visit notes loaded', '/visits']].map(([key, label, path]) => <section key={key} className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="font-medium text-slate-600">{label}</h2><p className="mt-3 break-words text-3xl font-semibold text-slate-950">{workspaceCount(workspace[key], loading)}</p>{workspace[key]?.error && state(key, '')}<Link href={base + path} className="mt-4 inline-flex min-h-11 items-center gap-2 font-semibold text-teal-800">Open workspace<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></section>)}</div>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <WorkspaceSection title="Scheduling status" description="Counts across all loaded scheduling records, including any legacy records.">
          {loading || workspace.appointments?.error || !workspace.appointments?.rows?.length ? state('appointments', 'No scheduling records were returned.') : <dl className="divide-y divide-slate-200">{[...schedulingStatuses, 'other'].map((status) => <div key={status} className="flex items-center justify-between gap-4 py-4"><dt className="capitalize text-slate-700">{status === 'other' ? 'Other / not recorded' : status.replaceAll('_', ' ')}</dt><dd className="font-semibold text-slate-950">{workspace.appointments.rows.filter((row) => status === 'other' ? !schedulingStatuses.includes(row.status) : row.status === status).length}</dd></div>)}</dl>}
        </WorkspaceSection>
        <WorkspaceSection title="Documentation status" description="Signing status for the recent visit notes returned by the records service.">
          {loading || workspace.notes?.error || !notes.length ? state('notes', 'No recent visit notes were returned.') : <dl className="divide-y divide-slate-200">{['Unsigned', 'Signed', 'Status not recorded'].map((status) => <div key={status} className="flex items-center justify-between gap-4 py-4"><dt className="text-slate-700">{status}</dt><dd className="font-semibold text-slate-950">{notes.filter((note) => noteSigningStatus(note) === status).length}</dd></div>)}</dl>}
          <Link href={`${base}/visits`} className="mt-4 inline-flex min-h-11 items-center font-semibold text-teal-800">Review documentation</Link>
        </WorkspaceSection>
      </div>
    </> : <>
      {view !== 'notes' && <section aria-labelledby="provider-next-visit" className="overflow-hidden rounded-3xl border border-slate-200 bg-white"><div className="grid lg:grid-cols-[1.6fr_1fr]">
        <div className="p-6 sm:p-8"><div className="mb-5 flex items-center gap-3"><span className="rounded-xl bg-teal-50 p-3 text-teal-800"><Video className="h-6 w-6" aria-hidden="true" /></span><h2 id="provider-next-visit" className="text-xl font-semibold text-slate-950">Next in your workspace</h2></div>
          {loading || workspace.appointments?.error || !next ? state('appointments', 'No upcoming appointments are available in this view. Review your schedule for the full list.') : <><div className="flex flex-wrap items-center gap-3"><h3 className="text-2xl font-semibold text-slate-950">{patientName(next)}</h3><WorkspaceStatus>{next.status}</WorkspaceStatus></div><p className="mt-4 text-slate-700"><WorkspaceDate value={next.scheduledAt} /></p><p className="mt-2 capitalize text-slate-600">{next.type || 'Consultation'}</p><div className="mt-6 flex flex-wrap gap-3">{next.type === 'video' && <WorkspaceLink href={callPath(base, next)} primary><Video className="h-5 w-5" aria-hidden="true" />Open video visit</WorkspaceLink>}<WorkspaceLink href={encounterPath(base, next)}><ClipboardList className="h-5 w-5" aria-hidden="true" />Open encounter</WorkspaceLink></div><p className="mt-3 text-sm leading-6 text-slate-600">Review the record and visit access before starting care.</p></>}
        </div>
        <div className="border-t border-slate-200 bg-slate-50 p-6 sm:p-8 lg:border-l lg:border-t-0"><p className="text-sm font-semibold uppercase tracking-widest text-teal-800">Continue the care</p><h3 className="mt-3 text-xl font-semibold text-slate-950">Documentation at a glance</h3>{loading || workspace.notes?.error ? state('notes', '') : <><p className="mt-5 text-3xl font-semibold text-slate-950">{unsigned.length}<span className="ml-2 text-base font-medium text-slate-600">unsigned</span></p><p className="mt-2 text-sm leading-6 text-slate-600">Among {notes.length} recent visit notes loaded. This is not the full outstanding workload.</p></>}<Link href={`${base}/visits`} className="mt-5 inline-flex min-h-11 items-center gap-2 font-semibold text-teal-800">Review notes<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></div>
      </div></section>}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <WorkspaceAction compact href={`${base}/patients`} icon={Users} title="Patient records">Open an authorized patient record and care history.</WorkspaceAction>
        <WorkspaceAction compact href={`${base}/prescriptions`} icon={Pill} title="Prescriptions">Review medications and prescription workflows.</WorkspaceAction>
        <WorkspaceAction compact href={`${base}/referrals`} icon={Share2} title="Referrals">Coordinate the next step with another care team.</WorkspaceAction>
        <WorkspaceAction compact href={`${base}/messages`} icon={MessageSquare} title="Messages">Continue patient and care-team conversations.</WorkspaceAction>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[1.35fr_1fr]">
        {view === 'notes' ? documentation : <WorkspaceSection title="Appointment timeline" description="Up to 8 active appointments. Ongoing visits and recent arrivals appear first." action={<Link href={`${base}/schedule`} className="inline-flex min-h-11 items-center font-semibold text-teal-800">Schedule</Link>}>
          {loading || workspace.appointments?.error || !appointments.length ? state('appointments', 'No active appointments are available in this view.') : <ol>{appointments.map((appointment) => <li key={`${appointment.legacy ? 'legacy-' : ''}${appointment.id}`} className="relative border-l-2 border-teal-100 py-4 pl-6"><span className="absolute -left-[7px] top-6 h-3 w-3 rounded-full border-2 border-white bg-teal-700" aria-hidden="true" /><p className="text-sm text-slate-600"><WorkspaceDate value={appointment.scheduledAt} /></p><h3 className="mt-2 font-semibold text-slate-950">{patientName(appointment)}</h3><div className="mt-2 flex flex-wrap items-center gap-3"><WorkspaceStatus>{appointment.status}</WorkspaceStatus><span className="text-sm capitalize text-slate-600">{appointment.type || 'Consultation'}</span></div><div className="mt-3 flex flex-wrap gap-3"><Link href={encounterPath(base, appointment)} className="inline-flex min-h-11 items-center gap-2 font-semibold text-teal-800">Open encounter<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>{appointment.type === 'video' && <Link href={callPath(base, appointment)} className="inline-flex min-h-11 items-center gap-2 font-semibold text-teal-800"><Video className="h-4 w-4" aria-hidden="true" />Open video visit</Link>}</div></li>)}</ol>}
        </WorkspaceSection>}
        <div className="space-y-6">{view !== 'notes' && documentation}<WorkspaceSection title="Patient records" description="A selection of the patient records available to your account." action={<Link href={`${base}/patients`} className="inline-flex min-h-11 items-center font-semibold text-teal-800">All patients</Link>}>
          {loading || workspace.patients?.error || !patients.length ? state('patients', 'Patients appear here after a care relationship is recorded.') : <ul className="divide-y divide-slate-200">{patients.slice(0, 4).map((patient) => <li key={patient.id} className="py-4"><Link href={`${base}/patients/${patient.id}/ehr`} className="inline-flex min-h-11 items-center gap-2 font-semibold text-teal-800"><FileText className="h-4 w-4 shrink-0" aria-hidden="true" />{patient.firstName || patient.lastName ? `${patient.firstName || ''} ${patient.lastName || ''}` : 'Open patient record'}</Link><p className="mt-1 text-sm text-slate-600">{patient.lastVisit ? <>Latest appointment: <WorkspaceDate value={patient.lastVisit} /></> : 'Appointment date not recorded'}</p></li>)}</ul>}
        </WorkspaceSection></div>
      </div>
    </>}

    <div className="grid gap-5 md:grid-cols-2"><WorkspaceAction href={`${base}/triage`} icon={BrainCircuit} title="Clinical guidance">Review available triage information in its clinical context. AI assistance requires clinician review and does not replace your assessment.</WorkspaceAction><WorkspaceAction href={`${base}/${isAnalytics ? 'dashboard' : 'analytics'}`} icon={BarChart3} title={isAnalytics ? 'Back to your workspace' : 'Practice activity'}>{isAnalytics ? 'Return to appointments, patient records, and the documentation queue.' : 'See the scope and status of your loaded appointments and visit notes.'}</WorkspaceAction></div>
  </div>;
}
