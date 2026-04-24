'use client';

import Link from 'next/link';
import { ArrowRight, Building2, ClipboardList, Shield } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function PharmacySettingsPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Pharmacy Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">Workspace settings now avoid seeded business names, regional credentials, and placeholder contact details.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 size={18} />
            Verified Pharmacy Profile Required
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-6">
            <p className="font-semibold text-foreground">No seeded profile values are shown here anymore.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Pharmacy name, registration details, coverage area, and fulfillment rules should be loaded from a verified operational record before editing is enabled.
            </p>
          </div>
          <div className="space-y-3 text-sm text-muted-foreground">
            {[
              'Business identity and license details',
              'Contact channels and fulfillment coverage',
              'Pickup and delivery configuration',
              'Compliance and audit preferences',
            ].map((item) => (
              <div key={item} className="flex items-start gap-2">
                <ClipboardList className="w-4 h-4 mt-0.5 text-purple-500 shrink-0" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Link href="/pharmacy/dashboard">
          <Button variant="outline">Back to Dashboard</Button>
        </Link>
        <Link href="/pharmacy/register">
          <Button className="bg-purple-600 hover:bg-purple-500 text-white">
            Open Registration Flow
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </Link>
      </div>

      <div className="rounded-lg bg-muted/40 border border-border p-3 text-xs text-muted-foreground flex items-start gap-2">
        <Shield className="w-4 h-4 mt-0.5 shrink-0" />
        <span>Your pharmacy data must remain encrypted, access-controlled, and audited before operational editing is enabled.</span>
      </div>
    </div>
  );
}
