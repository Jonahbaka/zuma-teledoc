'use client';
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminPageHeader, ResourceState, useAdminResource } from '@/components/ng/admin/AdminWorkspaceTools';
import { formatCount, formatDate, formatMoney, requireRows } from '@/lib/ng/adminWorkspaceData';

export default function AdminRevenue() {
  const [period, setPeriod] = useState('30d');
  const resource = useAdminResource('/ng/admin/analytics/revenue', { period }, data => requireRows(data));
  return <div className="space-y-6">
    <AdminPageHeader title="Revenue reporting" description="Review daily prescription fees, recorded order counts, and order values from the financial records." resource={resource} />
    <label className="block max-w-sm font-medium text-slate-800">Reporting range<select value={period} onChange={event => setPeriod(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4"><option value="7d">7-day range</option><option value="30d">30-day range</option><option value="90d">90-day range</option></select></label>
    <Card><CardHeader><CardTitle>Daily financial records</CardTitle><CardDescription>Amounts are reported in NGN. Missing values remain unavailable.</CardDescription></CardHeader><CardContent><ResourceState resource={resource} empty={resource.data?.length === 0} emptyMessage="No financial records were returned for this reporting range."><div className="space-y-4">{resource.data?.map(row => <article key={row.date} className="rounded-2xl border border-slate-200 p-5"><h2 className="font-semibold text-slate-950">{formatDate(row.date)}</h2><dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[['Prescription fees', formatMoney(row.rx_fees)], ['Subscription records', formatMoney(row.subscriptions)], ['Delivery markup', formatMoney(row.delivery_markup)], ['Margin share', formatMoney(row.margin_share)], ['Recorded orders', formatCount(row.orders)], ['Recorded order value', formatMoney(row.gmv)]].map(([label, value]) => <div key={label}><dt className="text-slate-600">{label}</dt><dd className="mt-2 font-semibold text-slate-950">{value}</dd></div>)}</dl></article>)}</div></ResourceState></CardContent></Card>
  </div>;
}
