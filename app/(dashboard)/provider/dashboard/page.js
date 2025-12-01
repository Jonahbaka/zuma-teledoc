'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { 
  Calendar, Video, Users, Clock, FileText, 
  ChevronRight, Activity, TrendingUp, Play
} from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { providersAPI, appointmentsAPI, visitsAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime, formatTime } from '@/lib/utils';

export default function ProviderDashboard() {
  const { user } = useAuth();
  const router = useRouter();
  const [upcomingAppointments, setUpcomingAppointments] = useState([]);
  const [recentVisits, setRecentVisits] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [appointmentsRes, visitsRes] = await Promise.all([
          appointmentsAPI.getUpcoming(5),
          visitsAPI.getRecent(5)
        ]);

        if (appointmentsRes.data.success) {
          setUpcomingAppointments(appointmentsRes.data.appointments);
        }
        if (visitsRes.data.success) {
          setRecentVisits(visitsRes.data.visits);
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

  const todayAppointments = upcomingAppointments.filter(a => {
    const aptDate = new Date(a.scheduledAt);
    const today = new Date();
    return aptDate.toDateString() === today.toDateString();
  }).length;
  const completedToday = recentVisits.filter(v => {
    const visitDate = new Date(v.createdAt);
    const today = new Date();
    return visitDate.toDateString() === today.toDateString();
  }).length;

  return (
    <div className="space-y-8">
      {/* Welcome Section */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-serif">
            {getGreeting()}, Dr. {user?.lastName}!
          </h1>
          <p className="text-gray-600 mt-1">
            You have {todayAppointments} appointments today
          </p>
        </div>
        <Link href="/provider/schedule">
          <Button className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700">
            <Calendar className="w-4 h-4 mr-2" />
            View Schedule
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Today's Patients", value: todayAppointments, icon: Users, color: 'blue' },
          { label: 'Completed', value: completedToday, icon: Activity, color: 'emerald' },
          { label: 'Upcoming', value: upcomingAppointments.length, icon: Clock, color: 'amber' },
          { label: 'This Week', value: upcomingAppointments.length, icon: Calendar, color: 'purple' }
        ].map((stat, index) => (
          <Card key={index}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">{stat.label}</p>
                  <p className="text-3xl font-bold mt-1">{stat.value}</p>
                </div>
                <div className={`w-12 h-12 rounded-xl bg-${stat.color}-100 flex items-center justify-center`}>
                  <stat.icon className={`w-6 h-6 text-${stat.color}-600`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-8">

        {/* Recent Visit Notes */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-lg">Recent Visit Notes</CardTitle>
              <CardDescription>Your latest clinical documentation</CardDescription>
            </div>
            <Link href="/provider/visits">
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
            ) : recentVisits.length === 0 ? (
              <div className="text-center py-8">
                <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">No recent visits</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentVisits.map((visit) => (
                  <Link key={visit.id} href={`/provider/visits/${visit.id}`}>
                    <div className="p-3 rounded-xl border hover:border-blue-300 hover:bg-blue-50/50 transition-all cursor-pointer">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm">
                            {visit.patientFirstName} {visit.patientLastName}
                          </p>
                          <p className="text-xs text-gray-500">
                            {formatDateTime(visit.createdAt)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {visit.isSigned ? (
                            <span className="px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded-full">
                              Signed
                            </span>
                          ) : (
                            <span className="px-2 py-1 text-xs bg-amber-100 text-amber-700 rounded-full">
                              Draft
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Upcoming Schedule */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-lg">Upcoming Schedule</CardTitle>
            <CardDescription>Your appointments for the next few days</CardDescription>
          </div>
          <Link href="/provider/schedule">
            <Button variant="ghost" size="sm">
              Manage Schedule <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="animate-pulse">
              <div className="h-32 bg-gray-100 rounded-xl"></div>
            </div>
          ) : upcomingAppointments.length === 0 ? (
            <div className="text-center py-8">
              <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No upcoming appointments</p>
            </div>
          ) : (
            <div className="space-y-4">
              {upcomingAppointments.map((apt) => (
                <div 
                  key={apt.id} 
                  onClick={() => router.push(`/provider/appointments/${apt.id}/visit`)}
                  className="p-4 rounded-xl border hover:border-blue-300 hover:bg-blue-50/50 transition-all cursor-pointer"
                >
                  <div className="flex flex-col md:flex-row md:items-center gap-4">
                    {/* Patient Info */}
                    <div className="flex items-center gap-4 flex-1">
                      <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-lg font-medium">
                        {apt.patientFirstName?.[0]}{apt.patientLastName?.[0]}
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-900">
                          {apt.patientFirstName} {apt.patientLastName}
                        </h3>
                        <p className="text-sm text-slate-500">
                          {apt.reasonForVisit || 'No reason specified'}
                        </p>
                      </div>
                    </div>

                    {/* Date & Time */}
                    <div className="flex items-center gap-6 text-sm">
                      <div className="flex items-center gap-2 text-slate-600">
                        <Calendar className="w-4 h-4 text-blue-500" />
                        <span>{formatDateTime(apt.scheduledAt)}</span>
                      </div>
                      {apt.type === 'video' && (
                        <div className="flex items-center gap-2 text-blue-600">
                          <Video className="w-4 h-4" />
                          <span className="font-medium">Video</span>
                        </div>
                      )}
                    </div>

                    {/* Status & Actions */}
                    <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                      <span className={`px-3 py-1 text-xs font-medium rounded-full ${
                        apt.status === 'scheduled' ? 'bg-blue-100 text-blue-700' :
                        apt.status === 'confirmed' ? 'bg-purple-100 text-purple-700' :
                        apt.status === 'completed' ? 'bg-slate-100 text-slate-700' :
                        apt.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {apt.status.charAt(0).toUpperCase() + apt.status.slice(1)}
                      </span>
                      {apt.type === 'video' && (
                        <Link href={`/provider/appointments/${apt.id}/call`}>
                          <Button 
                            variant="outline" 
                            size="sm"
                            className="border-blue-500 text-blue-600 hover:bg-blue-50"
                          >
                            <Users className="w-4 h-4 mr-2" />
                            Join Waiting Room
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

