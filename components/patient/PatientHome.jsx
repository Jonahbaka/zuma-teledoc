'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Calendar, FileText, MessageSquare, Pill, Stethoscope } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import api, { appointmentsAPI, clinicalEhrAPI, messagesAPI } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import PortalPageHeader from '@/components/branding/PortalPageHeader';
import { Button } from '@/components/ui/button';

export default function PatientHome({ market = 'US' }) {
  const { user } = useAuth();
  const nigeria = market === 'NG';
  const base = nigeria ? '/ng/patient' : '/patient';
  const [sections, setSections] = useState({});
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!user?.id) return undefined;
    let cancelled = false;
    setLoading(true); setSections({});
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
    })).then((results) => { if (!cancelled) { setSections(Object.fromEntries(results)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [user?.id, nigeria, revision]);

  const displaySection = (key, empty, render) => loading ? <p role="status" className="py-6 text-slate-600">Loading your care information…</p> : sections[key]?.error ? <div className="portal-error"><p role="alert">This information could not be loaded.</p><Button variant="outline" className="mt-3" onClick={() => setRevision((value) => value + 1)}>Try again</Button></div> : sections[key]?.rows?.length ? render(sections[key].rows) : <p className="portal-empty">{empty}</p>;

  return <div className="space-y-6">
    <PortalPageHeader eyebrow="DoctaRx · Your health, connected" title={`Welcome${user?.firstName ? ', ' + user.firstName : ''}`} description="Find care, prepare for your next visit, and keep your health information together." image="/marketing/ng/doctor-video-call.jpg">
      <Link href={`${base}/appointments/book`}><Button className="bg-blue-600 text-white hover:bg-blue-700"><Stethoscope className="mr-2 h-5 w-5" aria-hidden="true" />Get care</Button></Link>
      <Link href={`${base}/records`}><Button variant="outline"><FileText className="mr-2 h-5 w-5" aria-hidden="true" />Health records</Button></Link>
    </PortalPageHeader>
    <div className="grid gap-4 sm:grid-cols-3">
      {[[Calendar, 'Visits', 'Appointments and consultation details', '/appointments'], [MessageSquare, 'Messages', 'Stay in touch with your care team', '/messages'], [Pill, 'Prescriptions', 'Review medication and pharmacy updates', '/prescriptions']].map(([Icon, title, description, path]) => <Link key={path} href={base + path} className="portal-surface flex items-start gap-4 transition-colors hover:border-blue-300"><span className="rounded-xl bg-blue-50 p-3 text-blue-800"><Icon className="h-6 w-6" aria-hidden="true" /></span><div><h2 className="font-semibold">{title}</h2><p className="mt-2 text-slate-600">{description}</p></div></Link>)}
    </div>
    <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
      <section className="portal-surface"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Upcoming visits</h2><Link href={`${base}/appointments`} className="font-medium text-blue-800">View visits</Link></div>
        {displaySection('appointments', 'You have no upcoming visits. Choose Get care when you are ready to book.', (rows) => <ul className="divide-y divide-slate-200">{rows.map((appointment) => <li key={appointment.id} className="py-5"><p className="font-semibold">{appointment.providerFirstName || appointment.providerLastName ? `Dr. ${appointment.providerFirstName || ''} ${appointment.providerLastName || ''}` : 'Your clinician'}</p><p className="mt-2 text-slate-600">{formatDateTime(appointment.scheduledAt)}</p><p className="mt-2 capitalize text-slate-600">{String(appointment.status || 'Status unavailable').replaceAll('_', ' ')} · {appointment.type || 'Consultation'}</p><Link href={`${base}/appointments/${appointment.id}`} className="mt-4 inline-flex min-h-12 items-center gap-2 font-medium text-blue-800">Visit details<ArrowRight className="h-5 w-5" aria-hidden="true" /></Link></li>)}</ul>)}
      </section>
      <div className="space-y-6">
        <section className="portal-surface"><h2 className="mb-5 text-xl font-semibold">{nigeria ? 'Prescription updates' : 'Medications on file'}</h2>{displaySection('prescriptions', 'No medication information is listed here yet. Review your history with your clinician.', (rows) => <ul className="divide-y divide-slate-200">{rows.slice(0, 4).map((row) => <li key={row.id} className="py-4"><p className="font-medium">{row.medicationName || row.medication_name || row.prescription_number || row.prescriber_name || 'Prescription'}</p><p className="mt-2 capitalize text-slate-600">{String(row.dispense_status || row.status || row.dosage || 'Status not recorded').replaceAll('_', ' ')}</p></li>)}</ul>)}<Link href={`${base}/prescriptions`} className="mt-4 inline-flex min-h-12 items-center font-medium text-blue-800">View prescriptions</Link></section>
        <section className="portal-surface"><h2 className="mb-5 text-xl font-semibold">Care-team messages</h2>{displaySection('messages', 'Your messages will appear here when a conversation starts.', (rows) => <p className="text-slate-600">{rows.length} conversation{rows.length === 1 ? '' : 's'} in your inbox.</p>)}<Link href={`${base}/messages`} className="mt-4 inline-flex min-h-12 items-center font-medium text-blue-800">Open messages</Link></section>
      </div>
    </div>
    <section className="rounded-2xl border border-slate-200 bg-blue-50 p-6"><h2 className="font-semibold text-blue-950">Prepare for your visit</h2><p className="mt-2 leading-7 text-slate-700">Have your current medication list and questions ready. Open your visit details to review the appointment and check video access. For an emergency, seek urgent in-person care.</p></section>
  </div>;
}
