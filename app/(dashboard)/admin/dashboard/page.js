'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Users, UserCheck, Calendar, Activity, Shield, BarChart3, Database, Server, Video, RefreshCw, AlertCircle, Mail, Bot } from 'lucide-react';
import api, { adminAPI } from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import PortalPageHeader from '@/components/branding/PortalPageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

// Missing or failed aggregates must remain unknown. An explicit availability
// flag comes from the server query result, rather than a substituted zero.
function nullableCount(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function dashboardCount(dashboard, section, field) {
  if (dashboard?.availability?.[section] !== true) return null;
  return nullableCount(dashboard?.[section]?.[field]);
}

function weeklyRows(dashboard) {
  if (dashboard?.availability?.weeklyActivity !== true || !Array.isArray(dashboard.weeklyActivity)) return null;
  const rows = [];
  for (const day of dashboard.weeklyActivity) {
    const date = typeof day?.date === 'string' ? day.date.slice(0, 10) : '';
    const parsed = new Date(date);
    const count = nullableCount(day?.appointments);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || count === null) return null;
    rows.push({ date, count });
  }
  return rows;
}

const displayCount = value => value === null ? '—' : value.toLocaleString('en-US');

function Metric({ title, value, detail, icon: Icon }) {
  return <Card><CardContent className="flex items-start justify-between gap-4 p-6">
    <div><p className="text-slate-600">{title}</p><p className="mt-3 text-3xl font-semibold text-slate-950">{displayCount(value)}</p><p className="mt-2 leading-6 text-slate-600">{value === null ? 'Data unavailable' : detail}</p></div>
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Icon className="h-6 w-6" aria-hidden="true" /></div>
  </CardContent></Card>;
}

function ServiceStatus({ title, status, detail, icon: Icon }) {
  return <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
    <div className="flex items-center gap-2 font-medium text-slate-800"><Icon className="h-5 w-5 text-blue-700" aria-hidden="true" />{title}</div>
    <p className="mt-3 font-semibold text-slate-950">{status}</p><p className="mt-2 leading-6 text-slate-600">{detail}</p>
  </div>;
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const [sources, setSources] = useState({ dashboard: null, health: null, approvals: null });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [checkedAt, setCheckedAt] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true); setErrors({}); setCheckedAt(null);
    setSources({ dashboard: null, health: null, approvals: null });
    const loaders = {
      dashboard: async () => {
        const { data } = await adminAPI.getDashboard();
        if (!data?.success || !data.dashboard || typeof data.dashboard !== 'object') throw new Error();
        return { ...data.dashboard, credentialing: { underReview: data.dashboard.credentialing?.underReview ?? data.metrics?.pendingcredentialing } };
      },
      health: async () => {
        const { data } = await api.get('/health', { validateStatus: status => status === 200 || status === 503 });
        if (!data || typeof data.status !== 'string') throw new Error();
        return data;
      },
      approvals: async () => {
        const { data } = await adminAPI.getPendingProviders();
        if (!data?.success || !Array.isArray(data.providers)) throw new Error();
        return data.providers.length;
      },
    };
    const keys = Object.keys(loaders);
    Promise.allSettled(keys.map(key => loaders[key]())).then(results => {
      if (!active) return;
      const values = {}; const failures = {};
      results.forEach((result, index) => {
        const key = keys[index];
        values[key] = result.status === 'fulfilled' ? result.value : null;
        if (result.status === 'rejected') failures[key] = true;
      });
      setSources(values); setErrors(failures); setCheckedAt(new Date()); setLoading(false);
    });
    return () => { active = false; };
  }, [reload, user?.id]);

  const dashboard = sources.dashboard;
  const totalUsers = dashboardCount(dashboard, 'users', 'total');
  const totalProviders = dashboardCount(dashboard, 'users', 'providers');
  const pendingApproval = nullableCount(sources.approvals);
  const underReview = dashboardCount(dashboard, 'credentialing', 'underReview');
  const health = sources.health;
  const databaseHealthy = health?.database?.primary?.healthy;
  const databaseStatus = databaseHealthy === true ? 'Connected' : databaseHealthy === false ? 'Unreachable' : 'Status unavailable';
  const healthLabels = { healthy: 'Ready', degraded: 'Degraded', warming_up: 'Warming up', initializing: 'Initializing' };
  const uptime = nullableCount(health?.uptime);
  const activity = weeklyRows(dashboard);
  const maxActivity = activity?.length ? Math.max(...activity.map(day => day.count)) : 0;
  const distribution = ['patients', 'providers', 'admins'].map(key => ({
    key, label: { patients: 'Patients', providers: 'Providers', admins: 'Administrators' }[key],
    count: dashboardCount(dashboard, 'users', key),
  }));
  const quickLinks = [
    { title: 'User management', detail: 'Manage accounts and access', href: '/admin/users', icon: Users },
    { title: 'Credentialing', detail: 'Review clinical credentials', href: '/admin/credentialing', icon: UserCheck },
    { title: 'Audit logs', detail: 'Review recorded access and actions', href: '/admin/audit-logs', icon: Shield },
    { title: 'Analytics', detail: 'Explore platform activity', href: '/admin/analytics', icon: BarChart3 },
    { title: 'Revenue', detail: 'Review financial reporting', href: '/admin/revenue', icon: Activity },
    { title: 'Agent operations', detail: 'Monitoring and operational controls', href: '/admin/agent-ops', icon: Bot },
  ];

  return <div className="space-y-6">
    <PortalPageHeader eyebrow="DoctaRx · Administration" title="Platform overview" description="Review account activity, provider applications, and the latest operational status.">
      <Button onClick={() => setReload(value => value + 1)} disabled={loading} variant="outline"><RefreshCw className="mr-2 h-5 w-5" aria-hidden="true" />{loading ? 'Refreshing…' : 'Refresh overview'}</Button>
      <Link href="/admin/analytics"><Button className="bg-blue-700 hover:bg-blue-800">View analytics</Button></Link>
    </PortalPageHeader>
    {loading && <p role="status" className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-900">Loading the latest platform data…</p>}
    {!loading && (Object.keys(errors).length > 0 || dashboard?.unavailableSections?.length > 0) && <p role="alert" className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950"><AlertCircle className="mt-1 h-5 w-5 shrink-0" aria-hidden="true" />Some sections could not be loaded. Their values are unavailable; refresh to try again.</p>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric title="Active users" value={totalUsers} detail="Active accounts in the platform" icon={Users} />
      <Metric title="Providers" value={totalProviders} detail="Active provider accounts" icon={UserCheck} />
      <Metric title="Appointments today" value={dashboardCount(dashboard, 'appointments', 'today')} detail="Scheduled for the server reporting date" icon={Calendar} />
      <Metric title="Provider approvals" value={pendingApproval} detail="Accounts awaiting approval" icon={UserCheck} />
    </div>

    <Card><CardHeader><CardTitle>System status</CardTitle><CardDescription>{health && checkedAt ? 'Snapshot retrieved at ' + checkedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : loading ? 'Waiting for the latest operational snapshot' : 'Operational snapshot unavailable'}</CardDescription></CardHeader>
      <CardContent><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ServiceStatus title="Application" status={healthLabels[health?.status] || 'Status unavailable'} detail={uptime === null ? 'No process uptime was reported.' : 'Process uptime: ' + Math.floor(uptime / 60).toLocaleString('en-US') + ' minutes.'} icon={Server} />
        <ServiceStatus title="Database" status={databaseStatus} detail="Primary database health reported by the application." icon={Database} />
        <ServiceStatus title="Video service" status="Monitoring unavailable" detail="Live call and media health metrics are not connected to this overview." icon={Video} />
        <ServiceStatus title="Email service" status="Monitoring unavailable" detail="Delivery and queue health metrics are not connected to this overview." icon={Mail} />
      </div></CardContent>
    </Card>

    <div className="grid items-start gap-6 xl:grid-cols-2">
      <Card><CardHeader><CardTitle>Provider review queues</CardTitle><CardDescription>Current account approvals and credential reviews</CardDescription></CardHeader><CardContent className="space-y-4">
        {[{ title: 'Account approvals', count: pendingApproval, href: '/admin/providers', action: 'Review accounts' }, { title: 'Credentials under review', count: underReview, href: '/admin/credentialing', action: 'Review credentials' }].map(queue => <div key={queue.title} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 p-5">
          <div><p className="font-medium text-slate-950">{queue.title}</p><p className="mt-2 text-slate-600">{queue.count === null ? 'Queue summary unavailable' : displayCount(queue.count) + (queue.count === 1 ? ' application' : ' applications')}</p></div>
          <Link href={queue.href}><Button variant="outline">{queue.action}</Button></Link>
        </div>)}
      </CardContent></Card>

      <Card><CardHeader><CardTitle>User distribution</CardTitle><CardDescription>Active accounts by role</CardDescription></CardHeader><CardContent className="space-y-5">
        {distribution.map(item => {
          const percent = item.count !== null && totalUsers !== null && totalUsers > 0 ? Math.min(100, item.count / totalUsers * 100) : null;
          return <div key={item.key}><div className="flex justify-between gap-4"><span className="font-medium text-slate-900">{item.label}</span><span className="text-slate-600">{displayCount(item.count)}</span></div>
            {percent !== null && <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100" aria-hidden="true"><div className="h-full rounded-full bg-blue-600" style={{ width: percent + '%' }} /></div>}
          </div>;
        })}
      </CardContent></Card>

      <Card><CardHeader><CardTitle>Subscription plans</CardTitle><CardDescription>Active subscription counts reported by the platform</CardDescription></CardHeader><CardContent className="space-y-3">
        {[['free', 'Free'], ['gold', 'DoctaRx Gold'], ['platinum', 'Platinum']].map(([key, label]) => <div key={key} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4"><span className="font-medium text-slate-900">{label}</span><span className="text-lg font-semibold text-slate-950">{displayCount(dashboardCount(dashboard, 'subscriptions', key))}</span></div>)}
      </CardContent></Card>

      <Card><CardHeader><CardTitle>Weekly appointment activity</CardTitle><CardDescription>Appointments created during the last seven days</CardDescription></CardHeader><CardContent>
        {activity === null ? <p className="rounded-xl bg-slate-50 p-5 text-slate-600">Activity data unavailable.</p> : activity.length === 0 ? <p className="rounded-xl bg-slate-50 p-5 text-slate-600">No appointments were created in this reporting period.</p> : <div className="flex min-h-52 items-end justify-between gap-3">
          {activity.map(day => <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center gap-2"><div className="flex h-32 w-full items-end justify-center"><div className="w-full max-w-12 rounded-t-lg bg-blue-600" style={{ height: maxActivity > 0 ? day.count / maxActivity * 120 : 0 }} aria-hidden="true" /></div>
            <span className="text-slate-600">{new Date(day.date).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}</span><span className="font-semibold text-slate-950">{displayCount(day.count)}</span>
          </div>)}
        </div>}
      </CardContent></Card>
    </div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {quickLinks.map(({ title, detail, href, icon: Icon }) => <Link key={href} href={href} className="rounded-2xl border border-slate-200 bg-white p-6 transition hover:border-blue-400 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700">
        <div className="flex items-start gap-4"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Icon className="h-6 w-6" aria-hidden="true" /></div><div><h2 className="font-semibold text-slate-950">{title}</h2><p className="mt-2 leading-6 text-slate-600">{detail}</p></div></div>
      </Link>)}
    </div>
  </div>;
}
