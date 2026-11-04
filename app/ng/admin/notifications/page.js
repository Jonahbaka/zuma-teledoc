'use client';
import { Bell, Check, Trash2 } from 'lucide-react';
import { notificationsAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ActionNotice, AdminPageHeader, ResourceState, useAdminAction, useAdminResource } from '@/components/ng/admin/AdminWorkspaceTools';
import { formatDate, requireRows, requireSuccess } from '@/lib/ng/adminWorkspaceData';

export default function AdminNotifications() {
  const resource = useAdminResource('/notifications', { limit: 50 }, data => { requireSuccess(data); return requireRows(data, 'notifications'); });
  const action = useAdminAction(resource.key);
  const update = (id, remove) => action.run(id, async isCurrent => {
    const { data } = remove ? await notificationsAPI.delete(id) : await notificationsAPI.markRead(id);
    requireSuccess(data);
    if (!isCurrent()) return { message: 'Notification updated.' };
    const refreshed = await resource.refresh();
    if (!refreshed.ok) throw new Error('The notification was updated. The current list could not be refreshed; try again.');
    return { message: remove ? 'Notification removed.' : 'Notification marked as read.' };
  });
  return <div className="space-y-6">
    <AdminPageHeader title="Administrative notifications" description="Review notifications addressed to your account and manage their read status." resource={resource} />
    <ActionNotice action={action} />
    <ResourceState resource={resource} empty={resource.data?.length === 0} emptyMessage="No notifications were returned for your account."><div className="space-y-4">{resource.data?.map(item => <Card key={item.id} className={item.isRead ? '' : 'border-blue-200 bg-blue-50/40'}><CardContent className="p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1"><h2 className="break-words font-semibold text-slate-950">{item.title || 'Title not recorded'}</h2><p className="mt-3 break-words leading-7 text-slate-600">{item.message}</p><p className="mt-3 text-slate-600">{formatDate(item.createdAt)}</p></div><div className="flex gap-2">{!item.isRead && <Button disabled={action.pending} variant="outline" onClick={() => update(item.id, false)} aria-label="Mark notification as read"><Check className="h-5 w-5" aria-hidden="true" /></Button>}<Button disabled={action.pending} variant="outline" onClick={() => update(item.id, true)} aria-label="Remove notification"><Trash2 className="h-5 w-5" aria-hidden="true" /></Button></div></div></CardContent></Card>)}</div></ResourceState>
  </div>;
}
