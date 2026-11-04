'use client';

import Link from 'next/link';
import { ArrowRight, ClipboardList, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function PharmacyPrescriptionsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Prescriptions</h1>
        <p className="text-muted-foreground text-sm mt-1">Only live prescriptions routed to this pharmacy account will appear here.</p>
      </div>

      <Card className="border-purple-500/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-purple-500" />
            Live Queue Required
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center">
            <ClipboardList className="w-14 h-14 mx-auto mb-4 text-muted-foreground/60" />
            <p className="font-semibold text-foreground">No live prescriptions are available yet.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              This page no longer displays demo patients, demo prescribers, seeded medication prices, or regional placeholder records.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Link href="/pharmacy/dashboard">
              <Button variant="outline" className="w-full justify-between">
                Back to Dashboard
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
            <Link href="/pharmacy/settings">
              <Button variant="outline" className="w-full justify-between">
                Review Settings
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
