'use client';

import Link from 'next/link';
import { Calendar, ListOrdered, Users, Video } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { toProviderPortalPath } from '@/lib/providerPortal';

export default function ProviderCallEntryPage() {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-purple-700">Provider Visit Hub</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Launch live visits from the correct provider workflow</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Broken standalone-call redirects have been removed. Providers should open active video visits from schedule, triage, or patient appointment routes so charting and call context stay aligned.
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-border/70">
          <CardContent className="p-6">
            <Calendar className="h-8 w-8 text-purple-600" />
            <h2 className="mt-4 text-lg font-semibold text-foreground">Schedule</h2>
            <p className="mt-2 text-sm text-muted-foreground">Open confirmed appointments and launch the visit from the appointment call route.</p>
            <Link href={toProviderPortalPath('/schedule', { pathname })} className="mt-4 inline-flex">
              <Button className="bg-purple-600 text-white hover:bg-purple-500">Open Schedule</Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardContent className="p-6">
            <ListOrdered className="h-8 w-8 text-purple-600" />
            <h2 className="mt-4 text-lg font-semibold text-foreground">Triage Queue</h2>
            <p className="mt-2 text-sm text-muted-foreground">Move from a live queue case into consultation with the right clinical context attached.</p>
            <Link href={toProviderPortalPath('/triage-queue', { pathname })} className="mt-4 inline-flex">
              <Button variant="outline">Open Queue</Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardContent className="p-6">
            <Users className="h-8 w-8 text-purple-600" />
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
