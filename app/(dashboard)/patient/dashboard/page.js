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

  return (
    <div className="space-y-8">
      {/* Welcome Section */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-serif">
            {getGreeting()}, {user?.firstName}!
          </h1>
          <p className="text-gray-600 mt-1">
            Here's your health overview
          </p>
        </div>
        <Link href="/patient/appointments/book">
          <Button className="bg-gradient-to-r from-purple-600 to-purple-800 hover:from-purple-700 hover:to-purple-900 text-white">
            <Plus className="w-4 h-4 mr-2" />
            Book Appointment
          </Button>
        </Link>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { 
            label: 'Upcoming Visits', 
            value: appointments.length, 
            icon: Calendar, 
            color: 'emerald',
            href: '/patient/appointments'
          },
          { 
            label: 'Messages', 
            value: '2 new', 
            icon: MessageSquare, 
            color: 'blue',
            href: '/patient/messages'
          },
          { 
            label: 'Health Records', 
            value: 'View', 
            icon: FileText, 
            color: 'purple',
            href: '/patient/records'
          },
          { 
            label: 'Notifications', 
            value: notifications.filter(n => !n.isRead).length, 
            icon: Bell, 
            color: 'amber',
            href: '/patient/notifications'
          }
        ].map((stat, index) => (
          <Link key={index} href={stat.href}>
            <Card className="hover:shadow-lg transition-shadow cursor-pointer">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">{stat.label}</p>
                    <p className="text-2xl font-bold mt-1">{stat.value}</p>
                  </div>
                  <div className={`w-12 h-12 rounded-xl bg-${stat.color}-100 flex items-center justify-center`}>
                    <stat.icon className={`w-6 h-6 text-${stat.color}-600`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-8">
        {/* Upcoming Appointments */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-lg">Upcoming Appointments</CardTitle>
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
                    <div className="h-20 bg-gray-100 rounded-xl"></div>
                  </div>
                ))}
              </div>
            ) : appointments.length === 0 ? (
              <div className="text-center py-8">
                <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">No upcoming appointments</p>
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
                    <div className="p-4 rounded-xl border hover:border-emerald-300 hover:bg-emerald-50/50 transition-all cursor-pointer">
                      <div className="flex items-start justify-between">
                        <div className="flex gap-4">
                          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center text-white font-medium">
                            {apt.providerFirstName?.[0]}{apt.providerLastName?.[0]}
                          </div>
                          <div>
                            <p className="font-medium">
                              Dr. {apt.providerFirstName} {apt.providerLastName}
                            </p>
                            <p className="text-sm text-gray-500">
                              {apt.providerSpecialty || 'General Practice'}
                            </p>
                            <div className="flex items-center gap-2 mt-2 text-sm">
                              <Clock className="w-4 h-4 text-gray-400" />
                              <span>{formatDateTime(apt.scheduledAt)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          {apt.type === 'video' && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">
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
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-lg">Recent Activity</CardTitle>
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
                    <div className="h-16 bg-gray-100 rounded-xl"></div>
                  </div>
                ))}
              </div>
            ) : notifications.length === 0 ? (
              <div className="text-center py-8">
                <Bell className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">No recent notifications</p>
              </div>
            ) : (
              <div className="space-y-3">
                {notifications.slice(0, 5).map((notification) => (
                  <div 
                    key={notification.id}
                    className={`p-3 rounded-xl border ${
                      notification.isRead ? 'bg-white' : 'bg-emerald-50 border-emerald-200'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        notification.type === 'appointment' ? 'bg-blue-100' :
                        notification.type === 'message' ? 'bg-purple-100' :
                        'bg-gray-100'
                      }`}>
                        {notification.type === 'appointment' ? (
                          <Calendar className="w-4 h-4 text-blue-600" />
                        ) : notification.type === 'message' ? (
                          <MessageSquare className="w-4 h-4 text-purple-600" />
                        ) : (
                          <Bell className="w-4 h-4 text-gray-600" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{notification.title}</p>
                        <p className="text-xs text-gray-500 truncate">{notification.message}</p>
                        <p className="text-xs text-gray-400 mt-1">
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
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { 
                label: 'Book Appointment', 
                icon: Calendar, 
                href: '/patient/appointments/book',
                color: 'emerald'
              },
              { 
                label: 'Message Provider', 
                icon: MessageSquare, 
                href: '/patient/messages',
                color: 'blue'
              },
              { 
                label: 'View Records', 
                icon: FileText, 
                href: '/patient/records',
                color: 'purple'
              },
              { 
                label: 'Update Profile', 
                icon: User, 
                href: '/patient/profile',
                color: 'amber'
              }
            ].map((action, index) => (
              <Link key={index} href={action.href}>
                <div className={`p-4 rounded-xl border-2 border-dashed hover:border-${action.color}-300 hover:bg-${action.color}-50 transition-all cursor-pointer text-center group`}>
                  <div className={`w-12 h-12 rounded-xl bg-${action.color}-100 flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform`}>
                    <action.icon className={`w-6 h-6 text-${action.color}-600`} />
                  </div>
                  <p className="font-medium text-sm">{action.label}</p>
                </div>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

