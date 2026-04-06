'use client';

import Link from 'next/link';
import { Calendar, MessageSquare, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function PatientCallEntryPage() {
  return (
    <div className="space-y-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-purple-700">Patient Video Visits</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Access scheduled video visits from your appointment flow</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Standalone test-call redirects have been removed. Use your appointment list to join a live visit, or message the care team if you need help accessing a scheduled session.
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-border/70">
          <CardContent className="p-6">
            <Video className="h-8 w-8 text-purple-600" />
            <h2 className="mt-4 text-lg font-semibold text-foreground">Join a scheduled call</h2>
            <p className="mt-2 text-sm text-muted-foreground">Open your appointments to join a confirmed video consultation from the correct appointment route.</p>
            <Link href="/patient/appointments" className="mt-4 inline-flex">
              <Button className="bg-purple-600 text-white hover:bg-purple-500">
                <Calendar className="mr-2 h-4 w-4" />
                Open Appointments
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardContent className="p-6">
            <MessageSquare className="h-8 w-8 text-purple-600" />
            <h2 className="mt-4 text-lg font-semibold text-foreground">Need support first?</h2>
            <p className="mt-2 text-sm text-muted-foreground">Use secure messaging if you need to reschedule or confirm a video visit before joining.</p>
            <Link href="/patient/messages" className="mt-4 inline-flex">
              <Button variant="outline">Open Messages</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
