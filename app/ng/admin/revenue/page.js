'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function formatNaira(amount) {
  return `NGN ${Number(amount || 0).toLocaleString()}`;
}

export default function NigeriaAdminRevenuePage() {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    const loadRevenue = async () => {
      const response = await api.get('/api/ng/admin/analytics/revenue').catch(() => ({ data: [] }));
      setRows(Array.isArray(response.data) ? response.data : []);
    };

    loadRevenue();
  }, []);

  return (
    <div className="space-y-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Revenue Operations</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Revenue trend and order economics</h1>
        <p className="mt-2 text-sm text-muted-foreground">Review daily Nigeria marketplace revenue, order counts, and GMV from the admin portal.</p>
      </section>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>Revenue trend</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No revenue trend rows are available.</p>
          ) : (
            rows.map((row) => (
              <div key={row.date} className="grid gap-3 rounded-2xl border border-border px-4 py-4 text-sm md:grid-cols-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Date</p>
                  <p className="mt-1 font-semibold text-foreground">{row.date}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">RX Fees</p>
                  <p className="mt-1 font-semibold text-foreground">{formatNaira(row.rx_fees)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Orders</p>
                  <p className="mt-1 font-semibold text-foreground">{row.orders || 0}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">GMV</p>
                  <p className="mt-1 font-semibold text-foreground">{formatNaira(row.gmv)}</p>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
