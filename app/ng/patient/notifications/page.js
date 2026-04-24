'use client';

import { useEffect, useState } from 'react';
import { Bell, Check, Loader2, Trash2 } from 'lucide-react';
import { notificationsAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatRelativeTime } from '@/lib/utils';

export default function NigeriaPatientNotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadNotifications = async () => {
      try {
        const [listResponse, countResponse] = await Promise.all([
          notificationsAPI.getAll().catch(() => ({ data: { success: false, notifications: [] } })),
          notificationsAPI.getUnreadCount().catch(() => ({ data: { success: false, unreadCount: 0 } })),
        ]);

        setNotifications(listResponse.data?.success ? listResponse.data.notifications || [] : []);
        setUnreadCount(countResponse.data?.success ? countResponse.data.unreadCount || 0 : 0);
      } finally {
        setLoading(false);
      }
    };

    loadNotifications();
  }, []);

  const markAsRead = async (id) => {
    await notificationsAPI.markRead(id).catch(() => null);
    setNotifications((current) => current.map((item) => (item.id === id ? { ...item, isRead: true } : item)));
    setUnreadCount((count) => Math.max(0, count - 1));
  };

  const markAllAsRead = async () => {
    await notificationsAPI.markAllRead().catch(() => null);
    setNotifications((current) => current.map((item) => ({ ...item, isRead: true })));
    setUnreadCount(0);
  };

  const removeNotification = async (id) => {
    await notificationsAPI.delete(id).catch(() => null);
    setNotifications((current) => current.filter((item) => item.id !== id));
  };

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Patient Alerts</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Notifications</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}` : 'Your portal alerts are up to date.'}
          </p>
        </div>
        {unreadCount > 0 ? (
          <Button onClick={markAllAsRead} variant="outline">
            <Check className="mr-2 h-4 w-4" />
            Mark All Read
          </Button>
        ) : null}
      </section>

      {loading ? (
        <Card className="border-border/70">
          <CardContent className="p-8 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-emerald-600" />
          </CardContent>
        </Card>
      ) : notifications.length === 0 ? (
        <Card className="border-border/70">
          <CardContent className="p-10 text-center">
            <Bell className="mx-auto h-10 w-10 text-emerald-500/60" />
            <p className="mt-4 font-semibold text-foreground">No patient notifications yet.</p>
            <p className="mt-2 text-sm text-muted-foreground">Prescription updates, appointment alerts, and message notifications will appear here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {notifications.map((notification) => (
            <Card key={notification.id} className={`border-border/70 ${notification.isRead ? '' : 'border-emerald-200 bg-emerald-50/40'}`}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold text-foreground">{notification.title}</h2>
                      {!notification.isRead ? <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> : null}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{notification.message}</p>
                    <p className="mt-3 text-xs text-muted-foreground">{formatRelativeTime(notification.createdAt)}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {!notification.isRead ? (
                      <Button variant="ghost" size="icon" onClick={() => markAsRead(notification.id)}>
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
  );
}
