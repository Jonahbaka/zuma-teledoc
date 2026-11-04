'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Mail } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ActionNotice, AdminPageHeader, ResourceState, StatusBadge, useAdminAction, useAdminResource } from '@/components/ng/admin/AdminWorkspaceTools';
import { formatCount, formatDate, requireSuccess } from '@/lib/ng/adminWorkspaceData';

export default function InboxPage() {
  const [filter, setFilter] = useState('all');
  const resource = useAdminResource('/inbox', { limit: 100, ...(filter === 'unread' ? { unread: true } : ['alert', 'report'].includes(filter) ? { type: filter } : {}) }, response => {
    requireSuccess(response);
    if (!Array.isArray(response.data?.items)) throw new Error('Inbox records could not be confirmed.');
    return response.data;
  });
  const action = useAdminAction(resource.key);

  async function markRead(ids) {
    await action.run('mark-read', async isCurrent => {
      const { data } = await api.post('/inbox/mark-read', { ids });
      requireSuccess(data);
      if (!isCurrent()) return { message: 'Read status updated.' };
      if (!(await resource.refresh()).ok) throw new Error('Read status was updated. Refresh to load the current inbox.');
      return { message: 'Read status updated.' };
    });
  }

  async function deleteItem(id) {
    if (!window.confirm('Delete this inbox message?')) return;
    await action.run(id, async isCurrent => {
      const { data } = await api.delete('/inbox/' + id);
      requireSuccess(data);
      if (!isCurrent()) return { message: 'Message deleted.' };
      if (!(await resource.refresh()).ok) throw new Error('The message was deleted. Refresh to load the current inbox.');
      return { message: 'Message deleted.' };
    });
  }

  return <div className="clinical-readable space-y-6">
    <AdminPageHeader title="Administrative inbox" description="Review actual operational messages, reports, and alerts. Patient conversations remain in their authorized clinical workspace." resource={resource}>
      <Link href="/admin/agent-ops" className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 px-5 py-3 font-semibold text-slate-900">Automation operations <ArrowRight size={20} /></Link>
    </AdminPageHeader>
    <ActionNotice action={action} />
    <div className="flex flex-wrap items-center gap-3"><p className="mr-auto font-medium text-slate-800">Unread messages: {resource.loading || resource.error ? '—' : formatCount(resource.data?.unreadCount)}</p><Button variant="outline" disabled={action.pending || resource.loading || Boolean(resource.error) || !resource.data?.unreadCount} onClick={() => markRead('all')}><Check size={20} className="mr-2" /> Mark all as read</Button></div>
    <div className="flex flex-wrap gap-3" aria-label="Inbox filters">{[['all', 'All messages'], ['unread', 'Unread'], ['alert', 'Alerts'], ['report', 'Reports']].map(([value, name]) => <Button key={value} aria-pressed={filter === value} variant={filter === value ? 'default' : 'outline'} onClick={() => setFilter(value)} className={filter === value ? 'bg-blue-700 hover:bg-blue-800' : ''}>{name}</Button>)}</div>
    <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8" aria-label="Inbox messages"><ResourceState resource={resource} empty={resource.data?.items.length === 0} emptyMessage="No messages match this filter."><div className="space-y-5">{(resource.data?.items || []).map(item => <article key={item.id} className="rounded-2xl border border-slate-200 p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex min-w-0 items-start gap-3"><Mail size={24} className="mt-1 shrink-0 text-blue-700" /><div className="min-w-0"><h2 className="break-words text-xl font-semibold text-slate-950">{item.sender_name || item.sender_type || 'Sender unavailable'}</h2><p className="mt-2 text-slate-600">{formatDate(item.created_at)}</p></div></div><div className="flex flex-wrap gap-2"><StatusBadge status={item.message_type} /><StatusBadge status={item.read_at ? 'read' : 'unread'} /></div></div><details className="mt-5"><summary className="min-h-12 cursor-pointer py-3 font-semibold text-blue-700">Read message</summary><p className="whitespace-pre-wrap break-words leading-7 text-slate-700">{item.content || 'Message content unavailable'}</p></details><div className="mt-5 flex flex-wrap gap-3">{!item.read_at && <Button variant="outline" disabled={action.pending} onClick={() => markRead([item.id])}>Mark as read</Button>}<Button variant="outline" disabled={action.pending} onClick={() => deleteItem(item.id)} className="text-red-800">Delete message</Button></div></article>)}</div></ResourceState></section>
  </div>;
}
