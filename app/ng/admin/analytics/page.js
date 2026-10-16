'use client';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminPageHeader, ResourceState, useAdminResource } from '@/components/ng/admin/AdminWorkspaceTools';
import { formatCount, formatMoney, numericValue, requireRows } from '@/lib/ng/adminWorkspaceData';

export default function AdminAnalytics() {
  const overview = useAdminResource('/ng/admin/analytics/dashboard', {}, data => { if (!data?.users || !data?.orders || !data?.revenue) throw new Error(); return data; });
  const pharmacies = useAdminResource('/ng/admin/analytics/top-pharmacies', {}, data => requireRows(data));
  const signals = useAdminResource('/ng/admin/fraud/suspicious', {}, data => requireRows(data));
  const refresh = () => { void overview.refresh(); void pharmacies.refresh(); void signals.refresh(); };
  return <div className="space-y-6">
    <AdminPageHeader title="Operations analytics" description="Review stored account activity, pharmacy order values, and indicators that may need an operational review."><Button onClick={refresh} disabled={overview.loading || pharmacies.loading || signals.loading} variant="outline">Refresh analytics</Button></AdminPageHeader>
    <ResourceState resource={overview}><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
      ['Registered accounts', formatCount(overview.data?.users?.total_ng_users)],
      ['Delivered orders', formatCount(overview.data?.orders?.delivered_orders)],
      ['Cancelled orders', formatCount(overview.data?.orders?.cancelled_orders)],
      ['Paid order value', formatMoney(overview.data?.orders?.total_gmv)],
    ].map(([label, value]) => <Card key={label}><CardContent className="p-6"><p className="text-slate-600">{label}</p><p className="mt-3 break-words text-3xl font-semibold text-slate-950">{value}</p></CardContent></Card>)}</div></ResourceState>
    <div className="grid items-start gap-6 xl:grid-cols-2">
      <Card><CardHeader><CardTitle>Pharmacy order values</CardTitle><CardDescription>Approved pharmacies ranked by completed payment amounts</CardDescription></CardHeader><CardContent><ResourceState resource={pharmacies} empty={pharmacies.data?.length === 0} emptyMessage="No approved pharmacies are available in this report."><div className="space-y-4">{pharmacies.data?.map(row => <article key={row.id} className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-200 p-5"><div><h2 className="font-semibold text-slate-950">{row.name || 'Name not recorded'}</h2><p className="mt-2 text-slate-600">{[row.city, row.state].filter(Boolean).join(', ')}</p></div><span className="font-semibold text-blue-800">{formatMoney(row.revenue)}</span></article>)}</div></ResourceState></CardContent></Card>
      <Card><CardHeader><CardTitle>Pharmacy review signals</CardTitle><CardDescription>Cancellation and inventory pricing indicators; each signal requires administrative review.</CardDescription></CardHeader><CardContent><ResourceState resource={signals} empty={signals.data?.length === 0} emptyMessage="No pharmacy records match the report's current review criteria."><div className="space-y-4">{signals.data?.map(row => <article key={row.id} className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950"><h2 className="font-semibold">{row.name || 'Name not recorded'}</h2><p className="mt-3">Cancellation rate: {numericValue(row.cancellation_rate) === null ? 'Unavailable' : Math.round(Number(row.cancellation_rate)) + '%'}</p><p className="mt-2">Items above the report's markup threshold: {formatCount(row.overpriced_items)}</p></article>)}</div></ResourceState></CardContent></Card>
    </div>
  </div>;
}
