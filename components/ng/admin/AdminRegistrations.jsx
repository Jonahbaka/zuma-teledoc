'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatCount, formatDate, requireRows, requireSuccess } from '@/lib/ng/adminWorkspaceData';
import { ActionNotice, AdminPageHeader, ResourceState, StatusBadge, useAdminAction, useAdminResource } from './AdminWorkspaceTools';

const CONFIG = {
  providers: { title: 'Provider credential reviews', description: 'Review provider registrations, professional credentials, and account decisions.', endpoint: '/ng/providers', rowKey: 'providers', initial: 'pending', statuses: ['all', 'pending', 'documents_submitted', 'under_review', 'verified', 'suspended', 'rejected'], pending: ['pending', 'documents_submitted', 'under_review'], approved: ['verified'], name: row => row.full_name, search: row => [row.full_name, row.mdcn_number, row.specialty, row.user_email], details: row => [['Specialty', row.specialty?.replace(/_/g, ' ')], ['Professional license', row.mdcn_number], ['Email', row.user_email || row.email], ['Phone', row.phone], ['Practice', [row.practice_name, row.practice_city, row.practice_state].filter(Boolean).join(', ')]] },
  hospitals: { title: 'Facility registrations', description: 'Review hospital and clinic registrations, licensing details, and operating access.', endpoint: '/ng/hospitals', rowKey: 'hospitals', initial: 'pending_review', statuses: ['all', 'pending_review', 'documents_submitted', 'verified', 'active', 'suspended', 'rejected'], pending: ['pending_review', 'documents_submitted'], approved: ['verified', 'active'], name: row => row.name, search: row => [row.name, row.city, row.state, row.facility_type], details: row => [['Facility type', row.facility_type?.replace(/_/g, ' ')], ['Location', [row.city, row.state].filter(Boolean).join(', ')], ['Contact', row.contact_name], ['Phone', row.contact_phone], ['Facility license', row.facility_license_number], ['Insurance facility code', row.nhis_code], ['Licensed beds', row.bed_count]] },
  organizations: { title: 'Organization accounts', description: 'Review organization registrations and manage their approved platform access.', endpoint: '/ng/organizations', rowKey: 'organizations', initial: 'pending_review', statuses: ['all', 'pending_review', 'active', 'suspended', 'rejected', 'deactivated'], pending: ['pending_review'], approved: ['active'], name: row => row.name, search: row => [row.name, row.type, row.admin_email], details: row => [['Organization type', row.type], ['Administrator', row.admin_name], ['Administrator email', row.admin_email], ['Location', [row.city, row.state].filter(Boolean).join(', ')], ['Registration number', row.rc_number], ['Active members', row.active_member_count]] },
};

export default function AdminRegistrations({ kind }) {
  const config = CONFIG[kind];
  const [status, setStatus] = useState(config.initial);
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState(null);
  const [reason, setReason] = useState('');
  const resource = useAdminResource(config.endpoint, { limit: 50, ...(status === 'all' ? {} : { status }) }, data => ({ rows: requireRows(data, config.rowKey), total: data.total }));
  const action = useAdminAction(resource.key);
  useEffect(() => { setSelection(null); setReason(''); setSearch(''); }, [resource.key]);
  const rows = resource.data?.rows || [];
  const visible = rows.filter(row => config.search(row).filter(Boolean).join(' ').toLowerCase().includes(search.trim().toLowerCase()));
  const choose = (row, decision) => { setSelection({ id: row.id, name: config.name(row), decision }); setReason(''); };
  const submit = async event => {
    event.preventDefault();
    const selected = selection;
    if (!selected || ((selected.decision === 'reject' || selected.decision === 'suspend') && !reason.trim())) return;
    const result = await action.run(selected.id, async isCurrent => {
      const { data } = await api.post(config.endpoint + '/' + selected.id + '/verify', { action: selected.decision, reason: reason.trim() || null });
      requireSuccess(data);
      if (!isCurrent()) return { message: 'Decision recorded.' };
      const refreshed = await resource.refresh();
      if (!refreshed.ok) throw new Error('The decision was recorded. The latest list could not be loaded; refresh to review it.');
      return { message: 'Review decision recorded.' };
    });
    if (result) setSelection(null);
  };

  return <div className="space-y-6">
    <AdminPageHeader title={config.title} description={config.description} resource={resource} />
    <ActionNotice action={action} />
    <div className="flex flex-wrap gap-2" aria-label="Registration status filters">
      {config.statuses.map(value => <Button key={value} onClick={() => setStatus(value)} aria-pressed={status === value} variant={status === value ? 'default' : 'outline'} className={status === value ? 'bg-blue-700 hover:bg-blue-800' : ''}>{value === 'all' ? 'All statuses' : value.replace(/_/g, ' ')}</Button>)}
    </div>
    <label className="block max-w-xl font-medium text-slate-800">Search loaded registrations<input value={search} onChange={event => setSearch(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 font-normal" placeholder="Name, location, or registration details" /></label>
    <Card><CardHeader><CardTitle>Registration records</CardTitle><CardDescription>{resource.loading || resource.error ? 'Total unavailable' : formatCount(resource.data?.total) + ' matching this status; up to 50 records loaded.'}</CardDescription></CardHeader><CardContent>
      <ResourceState resource={resource} empty={visible.length === 0} emptyMessage={search.trim() ? 'No loaded registrations match your search.' : 'No registrations match this status.'}>
        <div className="space-y-4">{visible.map(row => <article key={row.id} className="rounded-2xl border border-slate-200 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-semibold text-slate-950">{config.name(row) || 'Name not recorded'}</h2><p className="mt-2 text-slate-600">Registered {formatDate(row.created_at)}</p></div><StatusBadge status={row.status} /></div>
          <dl className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-2">{config.details(row).map(([label, value]) => <div key={label}><dt className="font-medium text-slate-800">{label}</dt><dd className="mt-1 break-words text-slate-600">{value === null || value === undefined || value === '' ? 'Not recorded' : value}</dd></div>)}</dl>
          <div className="mt-5 flex flex-wrap gap-3">
            {config.pending.includes(row.status) && <><Button disabled={action.pending} onClick={() => choose(row, 'approve')} className="bg-blue-700 hover:bg-blue-800">Review approval</Button><Button disabled={action.pending} onClick={() => choose(row, 'reject')} variant="outline">Review rejection</Button></>}
            {config.approved.includes(row.status) && <Button disabled={action.pending} onClick={() => choose(row, 'suspend')} variant="outline">Review suspension</Button>}
            {row.status === 'suspended' && <Button disabled={action.pending} onClick={() => choose(row, 'approve')} variant="outline">Review reinstatement</Button>}
          </div>
        </article>)}</div>
      </ResourceState>
    </CardContent></Card>
    <Dialog open={Boolean(selection)} onOpenChange={open => { if (!open && !action.pending) setSelection(null); }}><DialogContent className="rounded-2xl bg-white text-slate-950"><DialogHeader><DialogTitle>Confirm registration decision</DialogTitle><DialogDescription>Review this decision for {selection?.name || 'the selected registration'}.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-5"><p className="font-medium capitalize">Decision: {selection?.decision}</p><label className="block font-medium">Decision notes<textarea required={selection?.decision === 'reject' || selection?.decision === 'suspend'} disabled={action.pending} value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} className="mt-2 min-h-28 w-full rounded-xl border border-slate-300 p-4 font-normal" /></label><ActionNotice action={action} /><div className="flex flex-wrap gap-3"><Button type="submit" disabled={action.pending} className="min-h-12 bg-blue-700 hover:bg-blue-800">{action.pending ? 'Saving decision…' : 'Confirm decision'}</Button><Button type="button" disabled={action.pending} onClick={() => setSelection(null)} variant="outline" className="min-h-12">Cancel</Button></div></form>
    </DialogContent></Dialog>
  </div>;
}
