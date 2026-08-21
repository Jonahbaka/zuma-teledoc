'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Calendar, Clock, MessageSquare, Plus, Video } from 'lucide-react';
import { appointmentsAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatDateTime } from '@/lib/utils';

function getStatusTone(status) {
  const normalized = String(status || '').toLowerCase();

  if (['scheduled', 'confirmed'].includes(normalized)) {
    return 'bg-emerald-100 text-emerald-700';
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

  useEffect(() => {
    const loadAppointments = async () => {
      try {
        const params = filter === 'all' ? undefined : { status: filter };
        const response = await appointmentsAPI.getAll(params);
        setAppointments(response.data?.success ? response.data.appointments || [] : []);
      } finally {
        setLoading(false);
      }
    };

    loadAppointments();
  }, [filter]);

  const summary = useMemo(() => {
    const upcoming = appointments.filter((item) => ['scheduled', 'confirmed'].includes(String(item.status || '').toLowerCase())).length;
    const completed = appointments.filter((item) => String(item.status || '').toLowerCase() === 'completed').length;
    const video = appointments.filter((item) => String(item.type || '').toLowerCase() === 'video').length;
    return { upcoming, completed, video };
  }, [appointments]);

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-emerald-200/70 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.14),transparent_35%),linear-gradient(145deg,rgba(255,255,255,0.96),rgba(236,253,245,0.92))] px-5 py-6 shadow-sm sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Consultations</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Appointments and live consultation access</h1>
            <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">
              Review upcoming bookings, completed visits, and video-call access without leaving the Nigeria patient workspace.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link href="/ng/patient/appointments/book">
              <Button className="bg-emerald-700 text-white hover:bg-emerald-800">
                <Plus className="mr-2 h-4 w-4" />
                Book Consultation
              </Button>
            </Link>
            <Link href="/ng/patient/messages">
              <Button variant="outline">Request Consultation Support</Button>
            </Link>
            <Link href="/ng/patient/records">
              <Button variant="outline">Open Visit History</Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Upcoming', value: summary.upcoming },
          { label: 'Completed', value: summary.completed },
          { label: 'Video Visits', value: summary.video },
        ].map((item) => (
          <Card key={item.label} className="border-border/70">
            <CardContent className="p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
              <p className="mt-3 text-3xl font-bold text-foreground">{loading ? '...' : item.value}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="flex flex-wrap gap-2">
        {[
          { label: 'All', value: 'all' },
          { label: 'Upcoming', value: 'scheduled' },
          { label: 'Completed', value: 'completed' },
          { label: 'Cancelled', value: 'cancelled' },
        ].map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setFilter(item.value)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              filter === item.value ? 'bg-emerald-700 text-white' : 'border border-border bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            {item.label}
          </button>
        ))}
      </section>

      <section className="space-y-4">
        {loading ? (
          <Card className="border-border/70">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">Loading appointments...</CardContent>
          </Card>
        ) : appointments.length === 0 ? (
          <Card className="border-border/70">
            <CardContent className="p-8 text-center">
              <Calendar className="mx-auto h-10 w-10 text-emerald-500/60" />
              <p className="mt-4 font-semibold text-foreground">No consultations matched this view.</p>
              <p className="mt-2 text-sm text-muted-foreground">Book a Nigeria consultation to choose a type, provider, time, and care context.</p>
              <Link href="/ng/patient/appointments/book" className="mt-5 inline-flex">
                <Button className="bg-emerald-700 text-white hover:bg-emerald-800">
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
                        <Button className="bg-emerald-700 text-white hover:bg-emerald-800">Join Call</Button>
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
