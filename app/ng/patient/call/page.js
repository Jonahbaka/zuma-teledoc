'use client';

import Link from 'next/link';
import { Calendar, MessageSquare, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function NigeriaPatientVideoVisitsPage() {
  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-emerald-200/70 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.14),transparent_35%),linear-gradient(145deg,rgba(255,255,255,0.96),rgba(236,253,245,0.92))] px-5 py-6 shadow-sm sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Video Visits</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Join scheduled video consultations from your appointments</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600 sm:text-base">
          Video access is linked to a booked consultation. Open your appointment list to join a confirmed visit, or book a consultation if you do not have one yet.
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-border/70">
          <CardContent className="p-6">
            <Video className="h-8 w-8 text-emerald-600" />
            <h2 className="mt-4 text-lg font-semibold text-foreground">Join a scheduled consultation</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Open your Nigeria appointments and use the Join Call button on an active video consultation.
            </p>
            <Link href="/ng/patient/appointments" className="mt-4 inline-flex">
              <Button className="bg-emerald-600 text-white hover:bg-emerald-500">
                <Calendar className="mr-2 h-4 w-4" />
                Open Appointments
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardContent className="p-6">
            <MessageSquare className="h-8 w-8 text-emerald-600" />
            <h2 className="mt-4 text-lg font-semibold text-foreground">No consultation yet?</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Book a consultation to choose your visit type, provider, time, and Nigeria pricing context.
            </p>
            <Link href="/ng/patient/appointments/book" className="mt-4 inline-flex">
              <Button variant="outline">Book Consultation</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
