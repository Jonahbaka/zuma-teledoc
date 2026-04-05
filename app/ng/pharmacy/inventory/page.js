'use client';

import { useEffect, useState } from 'react';
import NigeriaPharmacyPortalShell from '@/components/ng/NigeriaPharmacyPortalShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchNigeriaPharmacyWorkspace, formatNaira } from '@/lib/ngPharmacyPortal';
import api from '@/lib/api';

export default function NigeriaPharmacyInventoryPage() {
  const [loading, setLoading] = useState(true);
  const [workspace, setWorkspace] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    const loadInventory = async () => {
      const pharmacyWorkspace = await fetchNigeriaPharmacyWorkspace().catch(() => null);
      setWorkspace(pharmacyWorkspace);

      if (!pharmacyWorkspace?.id) {
        setLoading(false);
        return;
      }

      const [inventoryResponse, alertsResponse] = await Promise.all([
        api.get(`/api/ng/pharmacy/${pharmacyWorkspace.id}/inventory`).catch(() => ({ data: { items: [] } })),
        api.get(`/api/ng/pharmacy/${pharmacyWorkspace.id}/inventory/alerts`).catch(() => ({ data: [] })),
      ]);

      const inventoryItems = Array.isArray(inventoryResponse.data)
        ? inventoryResponse.data
        : inventoryResponse.data?.items || inventoryResponse.data?.results || [];

      setInventory(inventoryItems);
      setAlerts(Array.isArray(alertsResponse.data) ? alertsResponse.data : []);
      setLoading(false);
    };

    loadInventory();
  }, []);

  return (
    <NigeriaPharmacyPortalShell>
      <div className="space-y-6">
        <section>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Pharmacy Inventory</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Inventory and stock alerts</h1>
          <p className="mt-2 text-sm text-muted-foreground">Monitor live inventory, pricing, and low-stock exceptions for the active pharmacy workspace.</p>
        </section>

        {loading ? (
          <Card className="border-border/70">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">Loading inventory...</CardContent>
          </Card>
        ) : !workspace ? (
          <Card className="border-border/70">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">Complete pharmacy onboarding to manage inventory.</CardContent>
          </Card>
        ) : (
          <>
            <Card className="border-border/70">
              <CardHeader>
                <CardTitle>Low-stock alerts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {alerts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active low-stock alerts.</p>
                ) : (
                  alerts.map((alert) => (
                    <div key={alert.id} className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                      <p className="font-semibold">{alert.drug_name}</p>
                      <p className="mt-1">Available {alert.quantity_available} • Reorder at {alert.reorder_level}</p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="border-border/70">
              <CardHeader>
                <CardTitle>Inventory feed</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {inventory.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No inventory items are currently loaded for this pharmacy.</p>
                ) : (
                  inventory.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-border px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-foreground">{item.drug_name || item.name}</p>
                          <p className="mt-1 text-sm text-muted-foreground">Batch {item.batch_number || 'N/A'}</p>
                        </div>
                        <div className="text-right text-sm">
                          <p className="font-semibold text-foreground">{formatNaira(item.selling_price)}</p>
                          <p className="text-muted-foreground">Qty {item.quantity_available}</p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </NigeriaPharmacyPortalShell>
  );
}
