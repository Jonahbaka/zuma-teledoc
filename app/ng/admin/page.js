'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function formatNaira(amount) {
  return `NGN ${Number(amount || 0).toLocaleString()}`;
}

export default function NigeriaAdminDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState({});
  const [pendingPharmacies, setPendingPharmacies] = useState([]);
  const [topPharmacies, setTopPharmacies] = useState([]);

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        const [dashboardResponse, pendingResponse, topResponse] = await Promise.all([
          api.get('/api/ng/admin/analytics/dashboard').catch(() => ({ data: {} })),
          api.get('/api/ng/admin/pharmacies/pending', { params: { limit: 5 } }).catch(() => ({ data: { pharmacies: [] } })),
          api.get('/api/ng/admin/analytics/top-pharmacies').catch(() => ({ data: [] })),
        ]);

        setDashboard(dashboardResponse.data || {});
        setPendingPharmacies(pendingResponse.data?.pharmacies || pendingResponse.data || []);
        setTopPharmacies(Array.isArray(topResponse.data) ? topResponse.data : []);
      } finally {
        setLoading(false);
      }
    };

    loadDashboard();
  }, []);

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-emerald-200/70 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.14),transparent_35%),linear-gradient(145deg,rgba(255,255,255,0.96),rgba(236,253,245,0.92))] px-5 py-6 shadow-sm sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Admin / Operations Portal</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Marketplace oversight, pharmacy approvals, and revenue operations</h1>
            <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">
              This is now the actual Nigeria operations portal for DoctaRx, with pharmacy verification, analytics, compliance review, and revenue visibility behind the route.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/ng/admin/pharmacies">
              <Button className="bg-emerald-600 text-white hover:bg-emerald-500">Review Pharmacies</Button>
            </Link>
            <Link href="/ng/admin/compliance">
              <Button variant="outline">Open Compliance</Button>
            </Link>
          </div>
        </div>
      </section>

      {loading ? (
        <Card className="border-border/70">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">Loading Nigeria admin operations...</CardContent>
        </Card>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: 'Approved Pharmacies',
                value: dashboard.pharmacies?.active_pharmacies || 0,
                detail: `${dashboard.pharmacies?.pending_pharmacies || 0} pending`,
              },
              {
                label: 'Total Orders',
                value: dashboard.orders?.total_orders || 0,
                detail: `${dashboard.orders?.today_orders || 0} today`,
              },
              {
                label: 'Platform GMV',
                value: formatNaira(dashboard.orders?.total_gmv),
                detail: 'Completed payments only',
              },
              {
                label: 'Platform Revenue',
                value: formatNaira(dashboard.revenue?.total_rx_fees),
                detail: 'Rx fees captured',
              },
            ].map((item) => (
              <Card key={item.label} className="border-border/70">
                <CardContent className="p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
                  <p className="mt-3 text-3xl font-bold text-foreground">{item.value}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{item.detail}</p>
                </CardContent>
              </Card>
            ))}
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <Card className="border-border/70">
              <CardHeader>
                <CardTitle>Pending pharmacy approvals</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {pendingPharmacies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No pending pharmacy submissions right now.</p>
                ) : (
                  pendingPharmacies.map((pharmacy) => (
                    <div key={pharmacy.id} className="rounded-2xl border border-border px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-foreground">{pharmacy.name}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{pharmacy.city}, {pharmacy.state}</p>
                          <p className="mt-1 text-sm text-muted-foreground">PCN: {pharmacy.pcn_license_number}</p>
                        </div>
                        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
                          {String(pharmacy.status || '').replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="border-border/70">
              <CardHeader>
                <CardTitle>Top pharmacies by revenue</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {topPharmacies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No top-pharmacy revenue data yet.</p>
                ) : (
                  topPharmacies.slice(0, 6).map((pharmacy, index) => (
                    <div key={pharmacy.id} className="flex items-center justify-between rounded-2xl border border-border px-4 py-4 text-sm">
                      <div>
                        <p className="font-semibold text-foreground">{index + 1}. {pharmacy.name}</p>
                        <p className="mt-1 text-muted-foreground">{pharmacy.city}, {pharmacy.state}</p>
                      </div>
                      <span className="font-semibold text-emerald-700">{formatNaira(pharmacy.revenue)}</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
