'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Building2, ClipboardList, RefreshCw, Wallet } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import PortalPageHeader from '@/components/branding/PortalPageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

function numeric(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value))) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function count(value) {
  const parsed = numeric(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
function formatCount(value) {
  const parsed = count(value);
  return parsed === null ? '—' : parsed.toLocaleString('en-US');
}
function formatNaira(value) {
  const parsed = numeric(value);
  return parsed === null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'NGN', maximumFractionDigits: 2 }).format(parsed);
}
function location(pharmacy) { return [pharmacy.city, pharmacy.state].filter(Boolean).join(', '); }

export default function NigeriaAdminDashboardPage() {
  const { user } = useAuth();
  const [sources, setSources] = useState({ dashboard: null, pending: null, top: null });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true); setErrors({}); setSources({ dashboard: null, pending: null, top: null });
    const loaders = {
      dashboard: async () => {
        const { data } = await api.get('/ng/admin/analytics/dashboard');
        if (!data || !data.pharmacies || !data.orders || !data.revenue) throw new Error();
        return data;
      },
      pending: async () => {
        const { data } = await api.get('/ng/admin/pharmacies/pending', { params: { limit: 5 } });
        if (!Array.isArray(data?.pharmacies) || count(data.total) === null) throw new Error();
        return data;
      },
      top: async () => {
        const { data } = await api.get('/ng/admin/analytics/top-pharmacies');
        if (!Array.isArray(data)) throw new Error();
        return data;
      },
    };
    const keys = Object.keys(loaders);
    Promise.allSettled(keys.map(key => loaders[key]())).then(results => {
      if (!active) return;
      const values = {}; const failures = {};
      results.forEach((result, index) => {
        const key = keys[index]; values[key] = result.status === 'fulfilled' ? result.value : null;
        if (result.status === 'rejected') failures[key] = true;
      });
      setSources(values); setErrors(failures); setLoading(false);
    });
    return () => { active = false; };
  }, [reload, user?.id]);

  const dashboard = sources.dashboard;
  const metrics = [
    { label: 'Approved pharmacies', value: formatCount(dashboard?.pharmacies?.active_pharmacies), detail: count(dashboard?.pharmacies?.pending_pharmacies) === null ? 'Approval summary unavailable' : formatCount(dashboard.pharmacies.pending_pharmacies) + ' awaiting review', icon: Building2 },
    { label: 'Orders', value: formatCount(dashboard?.orders?.total_orders), detail: count(dashboard?.orders?.today_orders) === null ? 'Daily order count unavailable' : formatCount(dashboard.orders.today_orders) + ' created today', icon: ClipboardList },
    { label: 'Paid order value', value: formatNaira(dashboard?.orders?.total_gmv), detail: 'Orders with a completed payment status', icon: Wallet },
    { label: 'Recorded prescription fees', value: formatNaira(dashboard?.revenue?.total_rx_fees), detail: 'Prescription fees in the revenue records', icon: Wallet },
  ];

  return <div className="space-y-6">
    <PortalPageHeader eyebrow="DoctaRx · Administration" title="Operations overview" description="Review pharmacy applications, order activity, and recorded financial activity.">
      <Button onClick={() => setReload(value => value + 1)} disabled={loading} variant="outline"><RefreshCw className="mr-2 h-5 w-5" aria-hidden="true" />{loading ? 'Refreshing…' : 'Refresh overview'}</Button>
      <Link href="/ng/admin/pharmacies"><Button className="bg-blue-700 hover:bg-blue-800">Review pharmacies</Button></Link>
      <Link href="/ng/admin/compliance"><Button variant="outline">View audit and compliance</Button></Link>
    </PortalPageHeader>
    {loading && <p role="status" className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-900">Loading the latest operational data…</p>}
    {!loading && Object.keys(errors).length > 0 && <p role="alert" className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950"><AlertCircle className="mt-1 h-5 w-5 shrink-0" aria-hidden="true" />Some sections could not be loaded. Their values are unavailable; refresh to try again.</p>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map(({ label, value, detail, icon: Icon }) => <Card key={label}><CardContent className="flex items-start justify-between gap-3 p-6">
        <div><p className="text-slate-600">{label}</p><p className="mt-3 break-words text-3xl font-semibold text-slate-950">{value}</p><p className="mt-2 leading-6 text-slate-600">{value === '—' ? 'Data unavailable' : detail}</p></div>
        <Icon className="mt-1 h-6 w-6 shrink-0 text-blue-700" aria-hidden="true" />
      </CardContent></Card>)}
    </div>

    <div className="grid items-start gap-6 xl:grid-cols-2">
      <Card><CardHeader><CardTitle>Pharmacy review queue</CardTitle><CardDescription>{sources.pending ? formatCount(sources.pending.total) + ' applications awaiting review; showing up to five.' : 'Latest pharmacy applications'}</CardDescription></CardHeader><CardContent className="space-y-4">
        {sources.pending === null ? <p className="rounded-xl bg-slate-50 p-5 text-slate-600">{loading ? 'Loading pharmacy applications…' : 'Pharmacy applications unavailable.'}</p> : sources.pending.pharmacies.length === 0 ? <p className="rounded-xl bg-slate-50 p-5 text-slate-600">No pharmacy applications are awaiting review.</p> : sources.pending.pharmacies.map(pharmacy => <div key={pharmacy.id} className="rounded-2xl border border-slate-200 p-5">
          <p className="font-semibold text-slate-950">{pharmacy.name}</p><p className="mt-2 text-slate-600">{location(pharmacy)}</p>
          <p className="mt-2 text-slate-600">License: {pharmacy.pcn_license_number || 'Not provided'}</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><span className="rounded-lg bg-amber-50 px-3 py-2 font-medium text-amber-900">{pharmacy.status ? pharmacy.status.replace(/_/g, ' ') : 'Status unavailable'}</span><Link href="/ng/admin/pharmacies"><Button variant="outline">Review application</Button></Link></div>
        </div>)}
      </CardContent></Card>

      <Card><CardHeader><CardTitle>Pharmacy paid order value</CardTitle><CardDescription>Approved pharmacies, ranked by completed payment amounts</CardDescription></CardHeader><CardContent className="space-y-4">
        {sources.top === null ? <p className="rounded-xl bg-slate-50 p-5 text-slate-600">{loading ? 'Loading pharmacy order values…' : 'Pharmacy order values unavailable.'}</p> : sources.top.length === 0 ? <p className="rounded-xl bg-slate-50 p-5 text-slate-600">No approved pharmacy records are available.</p> : sources.top.slice(0, 6).map(pharmacy => <div key={pharmacy.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 p-5">
          <div><p className="font-semibold text-slate-950">{pharmacy.name}</p><p className="mt-2 text-slate-600">{location(pharmacy)}</p></div><span className="font-semibold text-blue-800">{formatNaira(pharmacy.revenue)}</span>
        </div>)}
        <Link href="/ng/admin/revenue" className="inline-flex min-h-12 items-center font-medium text-blue-800 hover:underline">View revenue reporting</Link>
      </CardContent></Card>
    </div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[['Consultation oversight', '/ng/admin/consultations', 'Follow appointments through clinical and pharmacy workflows.'], ['Providers', '/ng/admin/providers', 'Review provider accounts and onboarding.'], ['Public health reporting', '/ng/admin/public-health-programme', 'Review programme activity and reporting.'], ['Government data', '/ng/government-data', 'Open authorized reporting and data workflows.']].map(([title, href, description]) => <Link key={href} href={href} className="rounded-2xl border border-slate-200 bg-white p-6 transition hover:border-blue-400 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700"><h2 className="font-semibold text-slate-950">{title}</h2><p className="mt-3 leading-6 text-slate-600">{description}</p></Link>)}
    </div>
  </div>;
}
