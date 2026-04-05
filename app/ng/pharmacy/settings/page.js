'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import NigeriaPharmacyPortalShell from '@/components/ng/NigeriaPharmacyPortalShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchNigeriaPharmacyWorkspace } from '@/lib/ngPharmacyPortal';

export default function NigeriaPharmacySettingsPage() {
  const [loading, setLoading] = useState(true);
  const [workspace, setWorkspace] = useState(null);

  useEffect(() => {
    const loadWorkspace = async () => {
      const pharmacyWorkspace = await fetchNigeriaPharmacyWorkspace().catch(() => null);
      setWorkspace(pharmacyWorkspace);
      setLoading(false);
    };

    loadWorkspace();
  }, []);

  return (
    <NigeriaPharmacyPortalShell>
      <div className="space-y-6">
        <section>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Pharmacy Settings</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Workspace settings and operational readiness</h1>
          <p className="mt-2 text-sm text-muted-foreground">Review the pharmacy identity, fulfillment readiness, and onboarding links that support the Nigeria pharmacy portal.</p>
        </section>

        {loading ? (
          <Card className="border-border/70">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">Loading settings...</CardContent>
          </Card>
        ) : !workspace ? (
          <Card className="border-border/70">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">No pharmacy workspace exists for this account yet.</CardContent>
          </Card>
        ) : (
          <>
            <Card className="border-border/70">
              <CardHeader>
                <CardTitle>Pharmacy identity</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="rounded-2xl border border-border px-4 py-4">
                  <p className="font-semibold text-foreground">{workspace.name}</p>
                  <p className="mt-1 text-muted-foreground">{workspace.address_line1}, {workspace.city}, {workspace.state}</p>
                </div>
                <div className="rounded-2xl border border-border px-4 py-4">
                  <p className="font-semibold text-foreground">PCN License</p>
                  <p className="mt-1 text-muted-foreground">{workspace.pcn_license_number || 'Not configured yet'}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/70">
              <CardHeader>
                <CardTitle>Next operational actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>Use onboarding to complete banking, superintendent pharmacist details, and final registration review.</p>
                <p>Inventory and wallet routes in this portal now resolve to real pages instead of placeholders.</p>
                <div className="flex flex-wrap gap-3 pt-2">
                  <Link href="/ng/pharmacy/onboarding">
                    <Button className="bg-emerald-600 text-white hover:bg-emerald-500">Continue Onboarding</Button>
                  </Link>
                  <Link href="/ng/pharmacy/profile">
                    <Button variant="outline">Open Profile</Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </NigeriaPharmacyPortalShell>
  );
}
