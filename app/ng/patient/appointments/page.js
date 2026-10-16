'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Calendar, Clock, MessageSquare, Plus, Video } from 'lucide-react';
import { appointmentsAPI } from '@/lib/api';
import PortalPageHeader from '@/components/branding/PortalPageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatDateTime } from '@/lib/utils';

function getStatusTone(status) {
  const normalized = String(status || '').toLowerCase();

  if (['scheduled', 'confirmed'].includes(normalized)) {
    return 'bg-blue-100 text-blue-700';
  }

  if (normalized === 'completed') {
    return 'bg-sky-100 text-sky-700';
  }

  if (['cancelled', 'no_show'].includes(normalized)) {
    return 'bg-rose-100 text-rose-700';
  }

  return 'bg-slate-100 text-slate-700';
}

export default function NigeriaPatientAppointmentsPage() {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const loadAppointments = async () => {
      setLoading(true); setError(''); setAppointments([]);
      try {
        const params = ['all','upcoming'].includes(filter) ? undefined : { status: filter };
        const response = await appointmentsAPI.getAll(params);
        if (!response.data?.success || !Array.isArray(response.data.appointments)) throw new Error();
        if (!cancelled) setAppointments(filter === 'upcoming' ? response.data.appointments.filter((item) => ['scheduled','confirmed','in_progress'].includes(item.status)) : response.data.appointments);
      } catch {
        if (!cancelled) setError('Visits could not be loaded. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadAppointments();
    return () => { cancelled = true; };
  }, [filter, revision]);

  const summary = useMemo(() => {
    const upcoming = appointments.filter((item) => ['scheduled', 'confirmed'].includes(String(item.status || '').toLowerCase())).length;
    const completed = appointments.filter((item) => String(item.status || '').toLowerCase() === 'completed').length;
    const video = appointments.filter((item) => String(item.type || '').toLowerCase() === 'video').length;
    return { upcoming, completed, video };
  }, [appointments]);

  return (
    <div className="space-y-6">
      <PortalPageHeader title="Visits" description="Review appointments, prepare for a consultation, and find your visit history."><Link href="/ng/patient/appointments/book"><Button className="bg-blue-600 text-white hover:bg-blue-700">Get care</Button></Link><Link href="/ng/patient/records"><Button variant="outline">Health records</Button></Link></PortalPageHeader>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Upcoming', value: summary.upcoming },
          { label: 'Completed', value: summary.completed },
          { label: 'Video Visits', value: summary.video },
        ].map((item) => (
          <Card key={item.label} className="border-border/70">
            <CardContent className="p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
              <p className="mt-3 text-3xl font-bold text-foreground">{loading || error ? '—' : item.value}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="flex flex-wrap gap-2">
        {[
          { label: 'All', value: 'all' },
          { label: 'Upcoming', value: 'upcoming' },
          { label: 'Completed', value: 'completed' },
          { label: 'Cancelled', value: 'cancelled' },
        ].map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setFilter(item.value)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              filter === item.value ? 'bg-blue-700 text-white' : 'border border-border bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            {item.label}
          </button>
        ))}
      </section>

      {error && <div className="portal-error"><p role="alert">{error}</p><Button variant="outline" className="mt-3" onClick={() => setRevision((value) => value + 1)}>Try again</Button></div>}

      <section className="space-y-4">
        {loading ? (
          <Card className="border-border/70">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">Loading appointments...</CardContent>
          </Card>
        ) : error ? null : appointments.length === 0 ? (
          <Card className="border-border/70">
            <CardContent className="p-8 text-center">
              <Calendar className="mx-auto h-10 w-10 text-blue-500/60" />
              <p className="mt-4 font-semibold text-foreground">No consultations matched this view.</p>
              <p className="mt-2 text-sm text-muted-foreground">Book a Nigeria consultation to choose a type, provider, time, and care context.</p>
              <Link href="/ng/patient/appointments/book" className="mt-5 inline-flex">
                <Button className="bg-blue-700 text-white hover:bg-blue-800">
                  <Plus className="mr-2 h-4 w-4" />
                  Book Consultation
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          appointments.map((appointment) => (
            <Card key={appointment.id} className="border-border/70">
              <CardContent className="p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold text-foreground">
                        Dr. {appointment.providerFirstName} {appointment.providerLastName}
                      </h2>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusTone(appointment.status)}`}>
                        {String(appointment.status || 'scheduled').replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{appointment.providerSpecialty || 'Consultation'}</p>
                    <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        {formatDateTime(appointment.scheduledAt)}
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <Video className="h-4 w-4" />
                        {appointment.type === 'video' ? 'Video consultation' : appointment.type || 'Consultation'}
                      </span>
                    </div>
                    {appointment.reasonForVisit ? (
                      <p className="text-sm leading-6 text-slate-600">{appointment.reasonForVisit}</p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Link href={`/ng/patient/appointments/${appointment.id}`}>
                      <Button variant="outline">View Details</Button>
                    </Link>
                    {appointment.type === 'video' && ['scheduled', 'confirmed'].includes(String(appointment.status || '').toLowerCase()) ? (
                      <Link href={`/ng/patient/appointments/${appointment.id}/call`}>
                        <Button className="bg-blue-700 text-white hover:bg-blue-800">Join Call</Button>
                      </Link>
                    ) : null}
                    <Link href="/ng/patient/messages">
                      <Button variant="outline">
                        <MessageSquare className="mr-2 h-4 w-4" />
                        Contact Care Team
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}
