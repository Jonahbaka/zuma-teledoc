'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function formatNaira(amount) {
  return `NGN ${Number(amount || 0).toLocaleString()}`;
}

export default function NigeriaAdminAnalyticsPage() {
  const [dashboard, setDashboard] = useState({});
  const [topPharmacies, setTopPharmacies] = useState([]);
  const [suspicious, setSuspicious] = useState([]);

  useEffect(() => {
    const loadAnalytics = async () => {
      const [dashboardResponse, topResponse, suspiciousResponse] = await Promise.all([
        api.get('/ng/admin/analytics/dashboard').catch(() => ({ data: {} })),
        api.get('/ng/admin/analytics/top-pharmacies').catch(() => ({ data: [] })),
        api.get('/ng/admin/fraud/suspicious').catch(() => ({ data: [] })),
      ]);

      setDashboard(dashboardResponse.data || {});
      setTopPharmacies(Array.isArray(topResponse.data) ? topResponse.data : []);
      setSuspicious(Array.isArray(suspiciousResponse.data) ? suspiciousResponse.data : []);
    };

    loadAnalytics();
  }, []);

  return (
    <div className="space-y-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Analytics</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Operations analytics and marketplace health</h1>
        <p className="mt-2 text-sm text-muted-foreground">Review top-performing pharmacies, marketplace volume, and suspicious activity patterns.</p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'NG Users', value: dashboard.users?.total_ng_users || 0 },
          { label: 'Delivered Orders', value: dashboard.orders?.delivered_orders || 0 },
          { label: 'Cancelled Orders', value: dashboard.orders?.cancelled_orders || 0 },
          { label: 'GMV', value: formatNaira(dashboard.revenue?.platform_gmv || dashboard.orders?.total_gmv) },
        ].map((item) => (
          <Card key={item.label} className="border-border/70">
            <CardContent className="p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
              <p className="mt-3 text-2xl font-bold text-foreground">{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle>Top pharmacies by revenue</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {topPharmacies.length === 0 ? (
              <p className="text-sm text-muted-foreground">No revenue leaderboard yet.</p>
            ) : (
              topPharmacies.map((pharmacy, index) => (
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

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle>Suspicious marketplace activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {suspicious.length === 0 ? (
              <p className="text-sm text-muted-foreground">No suspicious pharmacy patterns are currently flagged.</p>
            ) : (
              suspicious.map((item) => (
                <div key={item.id} className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                  <p className="font-semibold">{item.name}</p>
                  <p className="mt-1">Cancellation rate: {Math.round(Number(item.cancellation_rate || 0))}%</p>
                  <p className="mt-1">Overpriced items: {item.overpriced_items || 0}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
