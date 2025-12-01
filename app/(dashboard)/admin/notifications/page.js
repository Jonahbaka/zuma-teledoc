'use client';

import { useState, useEffect } from 'react';
import { 
  Bell, Send, Search, Filter, CheckCircle2, XCircle,
  Users, AlertCircle, Info, Mail
} from 'lucide-react';
import { notificationsAPI } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { formatDateTime } from '@/lib/utils';

export default function AdminNotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [broadcastForm, setBroadcastForm] = useState({
    title: '',
    message: '',
    type: 'info',
    targetRole: 'all'
  });
  const [showBroadcast, setShowBroadcast] = useState(false);

  useEffect(() => {
    fetchNotifications();
  }, []);

  const fetchNotifications = async () => {
    try {
      setLoading(true);
      const response = await notificationsAPI.getAll({ limit: 100, admin: true });
      if (response?.data?.success) {
        setNotifications(response.data.notifications || []);
      }
    } catch (error) {
      console.error('Error fetching notifications:', error);
      toast({
        title: 'Error',
        description: 'Failed to load notifications',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleBroadcast = async (e) => {
    e.preventDefault();
    try {
      const response = await notificationsAPI.broadcast(broadcastForm);
      if (response?.data?.success) {
        toast({
          title: 'Success',
          description: 'Notification broadcasted successfully'
        });
        setShowBroadcast(false);
        setBroadcastForm({ title: '', message: '', type: 'info', targetRole: 'all' });
        fetchNotifications();
      }
    } catch (error) {
      console.error('Error broadcasting notification:', error);
      toast({
        title: 'Error',
        description: 'Failed to broadcast notification',
        variant: 'destructive'
      });
    }
  };

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'success':
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'error':
        return <XCircle className="w-5 h-5 text-red-500" />;
      case 'warning':
        return <AlertCircle className="w-5 h-5 text-amber-500" />;
      default:
        return <Info className="w-5 h-5 text-blue-500" />;
    }
  };

  const filteredNotifications = notifications.filter(notif => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      notif.title?.toLowerCase().includes(query) ||
      notif.message?.toLowerCase().includes(query) ||
      notif.type?.toLowerCase().includes(query)
    );
  });

  if (loading) {
    return (
      <div className="space-y-8">
        <div className="h-8 w-64 bg-gray-200 rounded animate-pulse"></div>
        <div className="grid gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 bg-gray-200 rounded-xl animate-pulse"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-serif">Notifications</h1>
          <p className="text-gray-600 mt-1">Manage system notifications and broadcasts</p>
        </div>
        <Button onClick={() => setShowBroadcast(!showBroadcast)}>
          <Send className="w-4 h-4 mr-2" />
          Broadcast Notification
        </Button>
      </div>

      {/* Broadcast Form */}
      {showBroadcast && (
        <Card>
          <CardHeader>
            <CardTitle>Broadcast Notification</CardTitle>
            <CardDescription>Send a notification to all or specific user roles</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleBroadcast} className="space-y-4">
              <div>
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={broadcastForm.title}
                  onChange={(e) => setBroadcastForm(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Notification title"
                  required
                />
              </div>
              <div>
                <Label htmlFor="message">Message</Label>
                <textarea
                  id="message"
                  value={broadcastForm.message}
                  onChange={(e) => setBroadcastForm(prev => ({ ...prev, message: e.target.value }))}
                  placeholder="Notification message"
                  className="w-full min-h-[100px] px-3 py-2 border rounded-md"
                  required
                />
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="type">Type</Label>
                  <select
                    id="type"
                    value={broadcastForm.type}
                    onChange={(e) => setBroadcastForm(prev => ({ ...prev, type: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    <option value="info">Info</option>
                    <option value="success">Success</option>
                    <option value="warning">Warning</option>
                    <option value="error">Error</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="targetRole">Target Audience</Label>
                  <select
                    id="targetRole"
                    value={broadcastForm.targetRole}
                    onChange={(e) => setBroadcastForm(prev => ({ ...prev, targetRole: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    <option value="all">All Users</option>
                    <option value="patient">Patients Only</option>
                    <option value="provider">Providers Only</option>
                    <option value="admin">Admins Only</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-3">
                <Button type="submit">
                  <Send className="w-4 h-4 mr-2" />
                  Send Broadcast
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowBroadcast(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
        <Input
          placeholder="Search notifications..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Notifications List */}
      {filteredNotifications.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Bell className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2">No Notifications</h3>
            <p className="text-gray-500">No notifications found.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredNotifications.map((notif) => (
            <Card key={notif.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <div className="mt-1">
                    {getNotificationIcon(notif.type)}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="font-semibold">{notif.title}</h3>
                          <Badge variant="outline" className="capitalize">
                            {notif.type}
                          </Badge>
                          {notif.isBroadcast && (
                            <Badge variant="secondary">
                              <Users className="w-3 h-3 mr-1" />
                              Broadcast
                            </Badge>
                          )}
                        </div>
                        <p className="text-gray-600 mb-2">{notif.message}</p>
                        <div className="flex items-center gap-4 text-sm text-gray-500">
                          {notif.createdAt && (
                            <span>{formatDateTime(notif.createdAt)}</span>
                          )}
                          {notif.targetRole && notif.targetRole !== 'all' && (
                            <span className="capitalize">Target: {notif.targetRole}s</span>
                          )}
                        </div>
                      </div>
                    </div>
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

