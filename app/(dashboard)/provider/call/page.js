'use client';

import Link from 'next/link';
import { Calendar, ListOrdered, ShieldCheck, Users, Video } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { toProviderPortalPath } from '@/lib/providerPortal';

export default function ProviderCallEntryPage() {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <section>
        <p className="text-xs font-semibold uppercase text-blue-700">Clinical Video</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">Start secure video consultations</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Open scheduled visits, verify camera and microphone readiness, or move from triage and patient records into a documented video encounter.
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-emerald-200 bg-emerald-50/70 dark:bg-emerald-950/20">
          <CardContent className="p-6">
            <ShieldCheck className="h-8 w-8 text-emerald-600" />
            <h2 className="mt-4 text-lg font-semibold text-foreground">Video Readiness Test</h2>
            <p className="mt-2 text-sm text-muted-foreground">Start a no-appointment self-test room using real browser media and WebRTC checks.</p>
            <Link href={toProviderPortalPath('/appointments/standalone/call', { pathname })} className="mt-4 inline-flex">
              <Button className="bg-emerald-600 text-white hover:bg-emerald-500">
                <Video className="mr-2 h-4 w-4" />
                Start Test
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardContent className="p-6">
            <Calendar className="h-8 w-8 text-blue-700" />
            <h2 className="mt-4 text-lg font-semibold text-foreground">Schedule</h2>
            <p className="mt-2 text-sm text-muted-foreground">Open confirmed appointments and launch the visit from the appointment call route.</p>
            <Link href={toProviderPortalPath('/schedule', { pathname })} className="mt-4 inline-flex">
              <Button className="bg-blue-700 text-white hover:bg-blue-600">Open Schedule</Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardContent className="p-6">
            <ListOrdered className="h-8 w-8 text-blue-700" />
            <h2 className="mt-4 text-lg font-semibold text-foreground">Triage Queue</h2>
            <p className="mt-2 text-sm text-muted-foreground">Move from a live queue case into consultation with the right clinical context attached.</p>
            <Link href={toProviderPortalPath('/triage-queue', { pathname })} className="mt-4 inline-flex">
              <Button variant="outline">Open Queue</Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardContent className="p-6">
            <Users className="h-8 w-8 text-blue-700" />
            <h2 className="mt-4 text-lg font-semibold text-foreground">Patients</h2>
            <p className="mt-2 text-sm text-muted-foreground">Review the patient list and appointment context before entering a video visit.</p>
            <Link href={toProviderPortalPath('/patients', { pathname })} className="mt-4 inline-flex">
              <Button variant="outline">
                <Video className="mr-2 h-4 w-4" />
                Open Patients
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
