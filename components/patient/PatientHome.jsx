'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Calendar, FileText, MessageSquare, Pill, Stethoscope, Video, ClipboardList } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import api, { appointmentsAPI, clinicalEhrAPI, messagesAPI } from '@/lib/api';
import { selectWorkspaceAppointments, workspaceCount } from '@/lib/dashboard-workspace.cjs';
import { WorkspaceAction, WorkspaceDate, WorkspaceHeader, WorkspaceLink, WorkspaceSection, WorkspaceState, WorkspaceStatus } from '@/components/dashboard/WorkspaceElements';

const clinicianName = (appointment) => appointment.providerFirstName || appointment.providerLastName
  ? `Dr. ${appointment.providerFirstName || ''} ${appointment.providerLastName || ''}`.trim() : 'Your clinician';

export default function PatientHome({ market = 'US' }) {
  const { user } = useAuth();
  const nigeria = market === 'NG';
  const base = nigeria ? '/ng/patient' : '/patient';
  const [sections, setSections] = useState({});
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(null);
  const refresh = () => setRevision((value) => value + 1);
  useEffect(() => {
    if (!user?.id) return undefined;
    let cancelled = false;
    setLoading(true); setSections({}); setUpdatedAt(null);
    const requests = [
      ['appointments', () => appointmentsAPI.getUpcoming(4), (data) => data.success ? data.appointments : null],
      ['prescriptions', () => nigeria ? api.get('/ng/patient/prescriptions', { params: { limit: 4 } }) : clinicalEhrAPI.getMedications(user.id), (data) => nigeria ? data : data.success ? data.medications : null],
      ['messages', () => messagesAPI.getConversations(), (data) => data.success ? data.conversations : null],
    ];
    Promise.all(requests.map(async ([key, fetch, extract]) => {
      try {
        const { data } = await fetch();
        const rows = extract(data);
        if (!Array.isArray(rows)) throw new Error('Unavailable');
        return [key, { rows }];
      } catch { return [key, { error: true }]; }
    })).then((results) => {
      if (!cancelled) { setSections(Object.fromEntries(results)); setUpdatedAt(new Date().toISOString()); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [user?.id, nigeria, revision]);

  const appointments = selectWorkspaceAppointments(sections.appointments?.rows, Date.now(), 4);
  const next = appointments[0];
  const displaySection = (key, empty, render) => !loading && !sections[key]?.error && sections[key]?.rows?.length
    ? render(sections[key].rows)
    : <WorkspaceState loading={loading} error={sections[key]?.error} onRetry={refresh} empty={empty} />;

  return <div className="space-y-7">
    <WorkspaceHeader eyebrow="Your care, connected" title={`Welcome${user?.firstName ? ', ' + user.firstName : ''}`} description="A clear next step for your health. Prepare for a visit, find your records, or connect with your care team." loading={loading} onRefresh={refresh} updatedAt={updatedAt}>
      <WorkspaceLink href={`${base}/appointments/book`} primary><Stethoscope className="h-5 w-5" aria-hidden="true" />Get care</WorkspaceLink>
      <WorkspaceLink href={`${base}/records`}><FileText className="h-5 w-5" aria-hidden="true" />Health records</WorkspaceLink>
    </WorkspaceHeader>

    <section aria-labelledby="patient-next-visit" className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
      <div className="grid lg:grid-cols-[1.6fr_1fr]">
        <div className="p-6 sm:p-8">
          <div className="mb-5 flex items-center gap-3"><span className="rounded-xl bg-teal-50 p-3 text-teal-800"><Video className="h-6 w-6" aria-hidden="true" /></span><h2 id="patient-next-visit" className="text-xl font-semibold text-slate-950">Your next visit</h2></div>
          {loading || sections.appointments?.error || !next ? <WorkspaceState loading={loading} error={sections.appointments?.error} onRetry={refresh} empty="No upcoming visits are listed. Choose Get care when you are ready to book." /> : <>
            <div className="flex flex-wrap items-center gap-3"><h3 className="text-2xl font-semibold text-slate-950">{clinicianName(next)}</h3><WorkspaceStatus>{next.status}</WorkspaceStatus></div>
            <p className="mt-4 flex items-start gap-2 text-slate-700"><Calendar className="mt-1 h-5 w-5 shrink-0" aria-hidden="true" /><WorkspaceDate value={next.scheduledAt} /></p>
            <p className="mt-2 capitalize text-slate-600">{next.type || 'Consultation'}</p>
            <div className="mt-6 flex flex-wrap gap-3">{next.type === 'video' && <WorkspaceLink href={`${base}/appointments/${next.id}/call`} primary><Video className="h-5 w-5" aria-hidden="true" />Open video visit</WorkspaceLink>}<WorkspaceLink href={`${base}/appointments/${next.id}`}>Visit details<ArrowRight className="h-4 w-4" aria-hidden="true" /></WorkspaceLink></div>
            {next.type === 'video' && <p className="mt-3 text-sm leading-6 text-slate-600">Review access and test your camera and microphone before joining.</p>}
          </>}
        </div>
        <div className="border-t border-slate-200 bg-slate-50 p-6 sm:p-8 lg:border-l lg:border-t-0">
          <p className="text-sm font-semibold uppercase tracking-widest text-teal-800">Before you meet</p><h3 className="mt-3 text-xl font-semibold text-slate-950">Make space for your care.</h3>
          <ol className="mt-5 space-y-4 text-slate-700">{['Find a quiet, private place.', 'Have your medication list ready.', 'Write down questions for your clinician.'].map((step, index) => <li key={step} className="flex items-start gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-teal-200 bg-white text-sm font-semibold text-teal-800">{index + 1}</span><span className="pt-0.5">{step}</span></li>)}</ol>
        </div>
      </div>
    </section>

    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <WorkspaceAction compact href={`${base}/records`} icon={FileText} title="Health records">Find documents, visit notes, and your recorded history.</WorkspaceAction>
      <WorkspaceAction compact href={`${base}/prescriptions`} icon={Pill} title="Prescriptions">Review medication information and pharmacy updates.</WorkspaceAction>
      <WorkspaceAction compact href={`${base}/messages`} icon={MessageSquare} title="Care-team messages">Continue a conversation with your care team.</WorkspaceAction>
      <WorkspaceAction compact href={`${base}/appointments`} icon={Calendar} title="All visits">Review appointments and consultation details.</WorkspaceAction>
    </div>

    <div className="grid items-start gap-6 xl:grid-cols-[1.35fr_1fr]">
      <WorkspaceSection title="Visit timeline" description="Upcoming and ongoing appointments returned for your account." action={<Link href={`${base}/appointments`} className="inline-flex min-h-11 items-center font-semibold text-teal-800">View visits</Link>}>
        {loading || sections.appointments?.error || !appointments.length ? <WorkspaceState loading={loading} error={sections.appointments?.error} onRetry={refresh} empty="Your appointments will appear here after booking." /> : <ol className="space-y-1">{appointments.map((appointment) => <li key={appointment.id} className="relative border-l-2 border-teal-100 py-4 pl-6"><span className="absolute -left-[7px] top-6 h-3 w-3 rounded-full border-2 border-white bg-teal-700" aria-hidden="true" /><p className="text-sm text-slate-600"><WorkspaceDate value={appointment.scheduledAt} /></p><h3 className="mt-2 font-semibold text-slate-950">{clinicianName(appointment)}</h3><div className="mt-2 flex flex-wrap items-center gap-3"><WorkspaceStatus>{appointment.status}</WorkspaceStatus><span className="text-sm capitalize text-slate-600">{appointment.type || 'Consultation'}</span></div><Link href={`${base}/appointments/${appointment.id}`} className="mt-2 inline-flex min-h-11 items-center gap-2 font-semibold text-teal-800">Visit details<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></li>)}</ol>}
      </WorkspaceSection>
      <div className="space-y-6">
        <WorkspaceSection title={nigeria ? 'Prescription updates' : 'Medications on file'} description="Recorded information; confirm your current medication list with your clinician.">
          {displaySection('prescriptions', 'No medication information is listed here yet.', (rows) => <ul className="divide-y divide-slate-200">{rows.slice(0, 4).map((row) => <li key={row.id} className="flex items-start gap-3 py-4"><Pill className="mt-1 h-5 w-5 shrink-0 text-teal-800" aria-hidden="true" /><div><p className="font-semibold text-slate-950">{row.medicationName || row.medication_name || row.prescription_number || 'Prescription'}</p><p className="mt-2 capitalize text-slate-600">{String(row.dispense_status || row.status || row.dosage || 'Status not recorded').replaceAll('_', ' ')}</p></div></li>)}</ul>)}
          <Link href={`${base}/prescriptions`} className="mt-3 inline-flex min-h-11 items-center font-semibold text-teal-800">View prescriptions</Link>
        </WorkspaceSection>
        <WorkspaceSection title="Your inbox" description="Messages are for ongoing care communication, not emergencies.">
          {displaySection('messages', 'Your messages will appear here when a conversation starts.', (rows) => <p className="leading-7 text-slate-700"><span className="font-semibold">{rows.length}</span> conversation{rows.length === 1 ? '' : 's'} loaded in your inbox.</p>)}
          <Link href={`${base}/messages`} className="mt-3 inline-flex min-h-11 items-center gap-2 font-semibold text-teal-800">Open messages<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        </WorkspaceSection>
      </div>
    </div>

    <section aria-labelledby="patient-workspace-snapshot" className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"><div className="flex items-center gap-2"><ClipboardList className="h-5 w-5 text-teal-800" aria-hidden="true" /><h2 id="patient-workspace-snapshot" className="font-semibold">In this view</h2></div><p className="mt-2 text-sm text-slate-600">Counts reflect the information loaded here, not your complete medical history.</p><dl className="mt-4 grid gap-4 sm:grid-cols-3">{[['appointments', 'Appointments loaded'], ['prescriptions', nigeria ? 'Prescriptions loaded' : 'Medication records loaded'], ['messages', 'Conversations loaded']].map(([key, label]) => <div key={key}><dt className="text-sm text-slate-600">{label}</dt><dd className="mt-1 text-xl font-semibold text-slate-950">{workspaceCount(sections[key], loading)}</dd></div>)}</dl></section>
    <p className="px-1 text-sm leading-6 text-slate-600">For an emergency, seek urgent in-person care. This dashboard does not provide emergency monitoring.</p>
  </div>;
}
