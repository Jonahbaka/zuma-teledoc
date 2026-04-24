'use client';

import { useEffect, useState } from 'react';
import NigeriaPharmacyPortalShell from '@/components/ng/NigeriaPharmacyPortalShell';
import { notificationsAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatRelativeTime } from '@/lib/utils';
import { Bell, Check, Trash2 } from 'lucide-react';

export default function NigeriaPharmacyNotificationsPage() {
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    const loadNotifications = async () => {
      const response = await notificationsAPI.getAll().catch(() => ({ data: { success: false, notifications: [] } }));
      setNotifications(response.data?.success ? response.data.notifications || [] : []);
    };

    loadNotifications();
  }, []);

  const markRead = async (id) => {
    await notificationsAPI.markRead(id).catch(() => null);
    setNotifications((current) => current.map((item) => (item.id === id ? { ...item, isRead: true } : item)));
  };

  const removeNotification = async (id) => {
    await notificationsAPI.delete(id).catch(() => null);
    setNotifications((current) => current.filter((item) => item.id !== id));
  };

  return (
    <NigeriaPharmacyPortalShell>
      <div className="space-y-6">
        <section>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Pharmacy Alerts</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Notifications</h1>
          <p className="mt-2 text-sm text-muted-foreground">Operational alerts, routed-order updates, and account notifications for the pharmacy workspace.</p>
        </section>

        {notifications.length === 0 ? (
          <Card className="border-border/70">
            <CardContent className="p-10 text-center">
              <Bell className="mx-auto h-10 w-10 text-emerald-500/60" />
              <p className="mt-4 font-semibold text-foreground">No pharmacy notifications yet.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {notifications.map((notification) => (
              <Card key={notification.id} className={`border-border/70 ${notification.isRead ? '' : 'border-emerald-200 bg-emerald-50/40'}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold text-foreground">{notification.title}</p>
                      <p className="mt-2 text-sm text-slate-600">{notification.message}</p>
                      <p className="mt-3 text-xs text-muted-foreground">{formatRelativeTime(notification.createdAt)}</p>
                    </div>
                    <div className="flex gap-2">
                      {!notification.isRead ? (
                        <Button variant="ghost" size="icon" onClick={() => markRead(notification.id)}>
                          <Check className="h-4 w-4" />
                        </Button>
                      ) : null}
                      <Button variant="ghost" size="icon" onClick={() => removeNotification(notification.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </NigeriaPharmacyPortalShell>
  );
}
