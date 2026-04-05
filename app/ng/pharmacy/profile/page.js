'use client';

import { useEffect, useState } from 'react';
import NigeriaPharmacyPortalShell from '@/components/ng/NigeriaPharmacyPortalShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchNigeriaPharmacyWorkspace } from '@/lib/ngPharmacyPortal';

export default function NigeriaPharmacyProfilePage() {
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
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Pharmacy Profile</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Pharmacy identity and ownership profile</h1>
          <p className="mt-2 text-sm text-muted-foreground">Review the verified pharmacy workspace record tied to this operator account.</p>
        </section>

        {loading ? (
          <Card className="border-border/70">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">Loading pharmacy profile...</CardContent>
          </Card>
        ) : !workspace ? (
          <Card className="border-border/70">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">No pharmacy workspace exists for this account.</CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="border-border/70">
              <CardHeader>
                <CardTitle>Business identity</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="rounded-2xl border border-border px-4 py-4">
                  <p className="font-semibold text-foreground">{workspace.name}</p>
                  <p className="mt-1 text-muted-foreground">{workspace.address_line1}</p>
                  <p className="text-muted-foreground">{workspace.city}, {workspace.state}</p>
                </div>
                <div className="rounded-2xl border border-border px-4 py-4">
                  <p className="font-semibold text-foreground">Contact</p>
                  <p className="mt-1 text-muted-foreground">{workspace.phone || 'Phone not set'}</p>
                  <p className="text-muted-foreground">{workspace.owner_email || 'Owner email unavailable'}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/70">
              <CardHeader>
                <CardTitle>Compliance identity</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="rounded-2xl border border-border px-4 py-4">
                  <p className="font-semibold text-foreground">PCN License</p>
                  <p className="mt-1 text-muted-foreground">{workspace.pcn_license_number || 'Not configured yet'}</p>
                </div>
                <div className="rounded-2xl border border-border px-4 py-4">
                  <p className="font-semibold text-foreground">Status</p>
                  <p className="mt-1 text-muted-foreground">{String(workspace.status || 'pending').replace(/_/g, ' ')}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </NigeriaPharmacyPortalShell>
  );
}
