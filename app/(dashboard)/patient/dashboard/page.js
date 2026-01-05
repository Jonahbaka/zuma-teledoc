'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  Calendar, Video, MessageSquare, FileText, Clock, 
  ChevronRight, User, Activity, Bell, Plus
} from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { appointmentsAPI, notificationsAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime, formatRelativeTime } from '@/lib/utils';

export default function PatientDashboard() {
  const { user } = useAuth();
  const [appointments, setAppointments] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [appointmentsRes, notificationsRes] = await Promise.all([
          appointmentsAPI.getUpcoming(3),
          notificationsAPI.getAll({ limit: 5 })
        ]);

        if (appointmentsRes.data.success) {
          setAppointments(appointmentsRes.data.appointments);
        }
        if (notificationsRes.data.success) {
          setNotifications(notificationsRes.data.notifications);
        }
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const statColors = {
    purple: { bg: 'bg-purple-500/10 dark:bg-purple-500/20', icon: 'text-purple-600 dark:text-purple-400' },
    blue: { bg: 'bg-blue-500/10 dark:bg-blue-500/20', icon: 'text-blue-600 dark:text-blue-400' },
    amber: { bg: 'bg-amber-500/10 dark:bg-amber-500/20', icon: 'text-amber-600 dark:text-amber-400' },
    indigo: { bg: 'bg-indigo-500/10 dark:bg-indigo-500/20', icon: 'text-indigo-600 dark:text-indigo-400' }
  };

  return (
    <div className="space-y-8">
      {/* Welcome Section */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-serif text-foreground">
            {getGreeting()}, {user?.firstName}!
          </h1>
          <p className="text-muted-foreground mt-1">
            Here's your health overview
          </p>
        </div>
        <Link href="/patient/appointments/book">
          <Button className="bg-gradient-to-r from-purple-600 to-indigo-700 hover:from-purple-700 hover:to-indigo-800 text-white shadow-lg shadow-purple-500/25">
            <Plus className="w-4 h-4 mr-2" />
            Book Appointment
          </Button>
        </Link>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Upcoming Visits', value: appointments.length, icon: Calendar, color: 'purple', href: '/patient/appointments' },
          { label: 'Messages', value: '2 new', icon: MessageSquare, color: 'blue', href: '/patient/messages' },
          { label: 'Health Records', value: 'View', icon: FileText, color: 'indigo', href: '/patient/records' },
          { label: 'Notifications', value: notifications.filter(n => !n.isRead).length, icon: Bell, color: 'amber', href: '/patient/notifications' }
        ].map((stat, index) => (
          <Link key={index} href={stat.href}>
            <Card className="hover:shadow-lg hover:border-primary/30 transition-all cursor-pointer bg-card">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{stat.label}</p>
                    <p className="text-2xl font-bold mt-1 text-foreground">{stat.value}</p>
                  </div>
                  <div className={`w-12 h-12 rounded-xl ${statColors[stat.color]?.bg} flex items-center justify-center`}>
                    <stat.icon className={`w-6 h-6 ${statColors[stat.color]?.icon}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-8">
        {/* Upcoming Appointments */}
        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-lg text-foreground">Upcoming Appointments</CardTitle>
              <CardDescription>Your scheduled visits</CardDescription>
            </div>
            <Link href="/patient/appointments">
              <Button variant="ghost" size="sm">
                View all <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="animate-pulse">
                    <div className="h-20 bg-muted rounded-xl"></div>
                  </div>
                ))}
              </div>
            ) : appointments.length === 0 ? (
              <div className="text-center py-8">
                <Calendar className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-muted-foreground">No upcoming appointments</p>
                <Link href="/patient/appointments/book">
                  <Button variant="link" className="mt-2">
                    Schedule your first visit
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {appointments.map((apt) => (
                  <Link key={apt.id} href={`/patient/appointments/${apt.id}`}>
                    <div className="p-4 rounded-xl border border-border hover:border-primary/30 hover:bg-accent transition-all cursor-pointer">
                      <div className="flex items-start justify-between">
                        <div className="flex gap-4">
                          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white font-medium shadow-lg shadow-purple-500/25">
                            {apt.providerFirstName?.[0]}{apt.providerLastName?.[0]}
                          </div>
                          <div>
                            <p className="font-medium text-foreground">
                              Dr. {apt.providerFirstName} {apt.providerLastName}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {apt.providerSpecialty || 'General Practice'}
                            </p>
                            <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
                              <Clock className="w-4 h-4" />
                              <span>{formatDateTime(apt.scheduledAt)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          {apt.type === 'video' && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-500/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 text-xs rounded-full">
                              <Video className="w-3 h-3" />
                              Video
                            </span>
                          )}
                          <span className={`px-2 py-1 text-xs rounded-full status-${apt.status}`}>
                            {apt.status.charAt(0).toUpperCase() + apt.status.slice(1)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Notifications */}
        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-lg text-foreground">Recent Activity</CardTitle>
              <CardDescription>Latest updates and notifications</CardDescription>
            </div>
            <Link href="/patient/notifications">
              <Button variant="ghost" size="sm">
                View all <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="animate-pulse">
                    <div className="h-16 bg-muted rounded-xl"></div>
                  </div>
                ))}
              </div>
            ) : notifications.length === 0 ? (
              <div className="text-center py-8">
                <Bell className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-muted-foreground">No recent notifications</p>
              </div>
            ) : (
              <div className="space-y-3">
                {notifications.slice(0, 5).map((notification) => (
                  <div 
                    key={notification.id}
                    className={`p-3 rounded-xl border ${
                      notification.isRead 
                        ? 'bg-background border-border' 
                        : 'bg-primary/5 border-primary/20'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        notification.type === 'appointment' ? 'bg-blue-500/10 dark:bg-blue-500/20' :
                        notification.type === 'message' ? 'bg-purple-500/10 dark:bg-purple-500/20' :
                        'bg-muted'
                      }`}>
                        {notification.type === 'appointment' ? (
                          <Calendar className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        ) : notification.type === 'message' ? (
                          <MessageSquare className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                        ) : (
                          <Bell className="w-4 h-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate text-foreground">{notification.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{notification.message}</p>
                        <p className="text-xs text-muted-foreground/70 mt-1">
                          {formatRelativeTime(notification.createdAt)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-lg text-foreground">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Book Appointment', icon: Calendar, href: '/patient/appointments/book', color: 'purple' },
              { label: 'Message Provider', icon: MessageSquare, href: '/patient/messages', color: 'blue' },
              { label: 'View Records', icon: FileText, href: '/patient/records', color: 'indigo' },
              { label: 'Update Profile', icon: User, href: '/patient/profile', color: 'amber' }
            ].map((action, index) => (
              <Link key={index} href={action.href}>
                <div className="p-4 rounded-xl border-2 border-dashed border-border hover:border-primary/50 hover:bg-accent transition-all cursor-pointer text-center group">
                  <div className={`w-12 h-12 rounded-xl ${statColors[action.color]?.bg} flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform`}>
                    <action.icon className={`w-6 h-6 ${statColors[action.color]?.icon}`} />
                  </div>
                  <p className="font-medium text-sm text-foreground">{action.label}</p>
                </div>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
