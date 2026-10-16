'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Calendar, ClipboardList, FileText, MessageSquare, Pill, RefreshCw, Share2, Users, Video } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import api, { appointmentsAPI, providersAPI, visitsAPI } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import PortalPageHeader from '@/components/branding/PortalPageHeader';
import { Button } from '@/components/ui/button';

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
    return { rows: rows.sort((a,b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)) };
  } catch { return { rows: data.appointments, partial: true }; }
}
async function fetchProviderPatients() {
  const { data } = await providersAPI.getPatients({ limit: 20 });
  if (!data.success || !Array.isArray(data.patients)) throw new Error('Patients unavailable');
  return data.patients;
}

export default function NGProviderDashboard({ market = 'ng', view = 'today' }) {
  const base = market === 'us' ? '/provider' : '/ng/provider';
  const { user } = useAuth();
  const router = useRouter();
  const [workspace, setWorkspace] = useState({});
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!user?.id) return undefined;
    let cancelled = false;
    setLoading(true); setWorkspace({});
    // Shared scheduling/EMR endpoints enforce the authenticated market. The US
    // workspace must never bootstrap a Nigeria provider trial on a read.
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
    })).then((results) => { if (!cancelled) { setWorkspace(Object.fromEntries(results)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [user?.id, market, revision]);

  const appointments = workspace.appointments?.rows || [];
  const upcoming = appointments.filter((row) => ['scheduled', 'confirmed', 'in_progress'].includes(row.status) && (row.status === 'in_progress' || new Date(row.scheduledAt).getTime() >= Date.now())).slice(0, 8);
  const patients = workspace.patients?.rows || [];
  const notes = workspace.notes?.rows || [];
  const onStartAppointmentCall = (appt) => router.push(appt.legacy ? `${base}/call?appointmentId=${appt.id}` : `${base}/appointments/${appt.id}/call`);
  const state = (key, empty) => loading ? <p role="status" className="py-5 text-slate-600">Loading your workspace…</p> : workspace[key]?.error ? <div className="portal-error"><p role="alert">This information could not be loaded.</p><Button variant="outline" className="mt-3" onClick={() => setRevision((value) => value + 1)}>Try again</Button></div> : <p className="portal-empty">{empty}</p>;

  return <div className="space-y-6">
    <PortalPageHeader eyebrow="DoctaRx · Clinical workspace" title={view === 'notes' ? 'Clinical notes' : 'Your day in care'} description={view === 'notes' ? 'Review recent documentation and continue the patient encounter.' : 'Keep appointments, patient records, and care-team communication within reach.'} image="/marketing/ng/hero-image-container.png">
      <Link href={`${base}/appointments`}><Button className="bg-blue-600 text-white hover:bg-blue-700"><Calendar className="mr-2 h-5 w-5" aria-hidden="true" />Appointments</Button></Link>
      <Link href={`${base}/call`}><Button variant="outline"><Video className="mr-2 h-5 w-5" aria-hidden="true" />Video consultations</Button></Link>
      <Button variant="outline" disabled={loading} onClick={() => setRevision((value) => value + 1)}><RefreshCw className="mr-2 h-5 w-5" aria-hidden="true" />Refresh</Button>
    </PortalPageHeader>
    {workspace.appointments?.partial && <p role="alert" className="portal-error">Some appointment information could not be loaded. Select Refresh to try again.</p>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[[Users, 'Patients', '/patients'], [FileText, 'Clinical notes', '/visits'], [Pill, 'Prescriptions', '/prescriptions'], [Share2, 'Referrals', '/referrals']].map(([Icon, title, path]) => <Link key={path} href={base + path} className="portal-surface flex items-center gap-4 hover:border-blue-300"><span className="rounded-xl bg-blue-50 p-3 text-blue-800"><Icon className="h-6 w-6" aria-hidden="true" /></span><h2 className="font-semibold">{title}</h2></Link>)}
    </div>
    <div className="grid items-start gap-6 xl:grid-cols-[1.4fr_1fr]">
      <section className="portal-surface"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">{view === 'notes' ? 'Recent documentation' : 'Next appointments'}</h2><Link href={`${base}/schedule`} className="font-medium text-blue-800">Schedule</Link></div>
        {view === 'notes' ? loading || workspace.notes?.error || !notes.length ? state('notes', 'No recent clinical notes are available. Open a patient encounter to document care.') : <ul className="divide-y divide-slate-200">{notes.map((note) => <li key={note.id} className="py-5"><h3 className="font-semibold">{note.patientFirstName || note.patientLastName ? `${note.patientFirstName || ''} ${note.patientLastName || ''}` : 'Clinical note'}</h3><p className="mt-2 text-slate-600">{formatDateTime(note.createdAt || note.created_at)}</p><p className="mt-2 capitalize text-slate-600">{String(note.status || (note.signedAt ? 'signed' : 'Status not recorded')).replaceAll('_', ' ')}</p>{note.appointmentId && <Link href={`${base}/appointments/${note.appointmentId}/visit`} className="mt-3 inline-flex min-h-12 items-center font-medium text-blue-800">Open encounter</Link>}</li>)}</ul> : loading || workspace.appointments?.error || !upcoming.length ? state('appointments', 'No upcoming appointments are available in this view. Review the full appointment list or your schedule.') : <ul className="divide-y divide-slate-200">{upcoming.map((appt) => <li key={appt.id} className="py-5"><h3 className="font-semibold">{appt.patientFirstName || appt.patientLastName ? `${appt.patientFirstName || ''} ${appt.patientLastName || ''}` : appt.patientName || 'Patient'}</h3><p className="mt-2 text-slate-600">{formatDateTime(appt.scheduledAt)}</p><p className="mt-2 capitalize text-slate-600">{appt.status.replaceAll('_', ' ')} · {appt.type || 'Consultation'}</p><div className="mt-4 flex flex-wrap gap-3"><Link href={appt.legacy ? `${base}/patients/${appt.patient_user_id}/ehr` : `${base}/appointments/${appt.id}/visit`}><Button variant="outline"><ClipboardList className="mr-2 h-5 w-5" aria-hidden="true" />Open encounter</Button></Link>{appt.type === 'video' && <Button onClick={() => onStartAppointmentCall(appt)} className="bg-blue-600 text-white hover:bg-blue-700"><Video className="mr-2 h-5 w-5" aria-hidden="true" />Start call</Button>}</div></li>)}</ul>}
      </section>
      <div className="space-y-6"><section className="portal-surface"><h2 className="mb-5 text-xl font-semibold">Patients</h2>{loading || workspace.patients?.error || !patients.length ? state('patients', 'Patients appear here after a care relationship is recorded.') : <ul className="divide-y divide-slate-200">{patients.slice(0, 5).map((patient) => <li key={patient.id} className="py-4"><Link href={`${base}/patients/${patient.id}/ehr`} className="font-medium text-blue-800">{patient.firstName || patient.lastName ? `${patient.firstName || ''} ${patient.lastName || ''}` : 'Open patient record'}</Link><p className="mt-2 text-slate-600">{patient.lastVisit ? 'Last visit: ' + formatDateTime(patient.lastVisit) : 'Visit date not recorded'}</p></li>)}</ul>}</section>
      <section className="portal-surface"><MessageSquare className="h-6 w-6 text-blue-800" aria-hidden="true" /><h2 className="mt-4 text-xl font-semibold">Care-team communication</h2><p className="mt-3 leading-7 text-slate-600">Review patient conversations and coordinate the next step in care.</p><Link href={`${base}/messages`} className="mt-4 inline-flex min-h-12 items-center font-medium text-blue-800">Open messages</Link></section></div>
    </div>
  </div>;
}
