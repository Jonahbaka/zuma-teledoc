'use client';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ActionNotice, AdminPageHeader, ResourceState, StatusBadge, useAdminAction, useAdminResource } from '@/components/ng/admin/AdminWorkspaceTools';
import { countValue, formatCount, formatDate, requireRows } from '@/lib/ng/adminWorkspaceData';

export default function AdminCompliance() {
  const resource = useAdminResource('/ng/admin/compliance/audit-log', { limit: 50 }, data => requireRows(data));
  const action = useAdminAction(resource.key);
  const runCheck = () => action.run('inventory', async isCurrent => {
    const { data } = await api.post('/ng/admin/compliance/check-expired');
    if (countValue(data?.deactivated) === null || countValue(data?.expiringWithin90Days) === null) throw new Error('The inventory check result could not be verified.');
    if (!isCurrent()) return { message: 'Inventory check completed.' };
    const refreshed = await resource.refresh();
    if (!refreshed.ok) throw new Error('The inventory check completed. The audit list could not be refreshed; try loading it again.');
    return { message: 'Inventory check completed: ' + formatCount(data.deactivated) + ' expired items deactivated; ' + formatCount(data.expiringWithin90Days) + ' items in the 90-day expiry report.' };
  });
  return <div className="space-y-6">
    <AdminPageHeader title="Audit and compliance" description="Review recorded pharmacy actions and check inventory expiry. The inventory check deactivates expired available items." resource={resource}><Button onClick={runCheck} disabled={action.pending} className="bg-blue-700 hover:bg-blue-800">{action.pending ? 'Checking inventory…' : 'Check inventory expiry'}</Button></AdminPageHeader>
    <ActionNotice action={action} />
    <Card><CardHeader><CardTitle>Compliance audit records</CardTitle><CardDescription>Up to 50 of the latest recorded events</CardDescription></CardHeader><CardContent><ResourceState resource={resource} empty={resource.data?.length === 0} emptyMessage="No compliance audit events were returned."><div className="space-y-4">{resource.data?.map(entry => <article key={entry.id} className="rounded-2xl border border-slate-200 p-5"><div className="flex flex-wrap items-start justify-between gap-4"><h2 className="font-semibold text-slate-950">{entry.action || 'Action unavailable'}</h2><StatusBadge status={entry.severity} /></div><p className="mt-3 text-slate-600">{formatDate(entry.created_at)} · {entry.resource_type || 'Resource type unavailable'}</p>{entry.details && <details className="mt-4"><summary className="min-h-12 cursor-pointer py-3 font-medium text-blue-800">View recorded details</summary><pre className="mt-3 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 font-sans text-base text-slate-700">{typeof entry.details === 'object' ? JSON.stringify(entry.details, null, 2) : String(entry.details)}</pre></details>}</article>)}</div></ResourceState></CardContent></Card>
  </div>;
}
