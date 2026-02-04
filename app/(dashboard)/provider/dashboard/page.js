'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { 
  Calendar, Video, Users, Clock, FileText, 
  ChevronRight, Activity, TrendingUp, Play, AlertTriangle,
  Bell, CheckCircle2, XCircle, Beaker, Phone, 
  ArrowRight, Zap, ClipboardList, AlertCircle, UserPlus,
  Stethoscope, Thermometer, Heart, FileWarning, Timer
} from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { providersAPI, appointmentsAPI, visitsAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime, formatTime, cn } from '@/lib/utils';

// Mock data for clinical widgets
const MOCK_WAITING_ROOM = [
  {
    id: 1,
    patientName: 'Jane Doe',
    waitTime: 5,
    triageReason: 'High Fever (102.4°F)',
    severity: 'high',
    appointmentType: 'video',
    avatarInitials: 'JD'
  },
  {
    id: 2,
    patientName: 'Robert Smith',
    waitTime: 2,
    triageReason: 'Medication Refill',
    severity: 'low',
    appointmentType: 'video',
    avatarInitials: 'RS'
  }
];

const MOCK_CRITICAL_LABS = [
  {
    id: 1,
    patientName: 'Michael Johnson',
    testName: 'HbA1c',
    value: '9.2%',
    status: 'critical',
    referenceRange: '4.0-5.6%',
    date: '2 hours ago'
  },
  {
    id: 2,
    patientName: 'Sarah Williams',
    testName: 'TSH',
    value: '0.15 mIU/L',
    status: 'abnormal',
    referenceRange: '0.4-4.0 mIU/L',
    date: '5 hours ago'
  },
  {
    id: 3,
    patientName: 'David Brown',
    testName: 'Lipid Panel - LDL',
    value: '165 mg/dL',
    status: 'abnormal',
    referenceRange: '<100 mg/dL',
    date: 'Yesterday'
  }
];

const MOCK_TASKS_ALERTS = [
  {
    id: 1,
    type: 'unsigned_note',
    title: '1 Unsigned Visit Note',
    description: 'Visit with Jane Doe needs your signature',
    severity: 'warning',
    action: '/provider/visits?filter=unsigned'
  },
  {
    id: 2,
    type: 'ai_alert',
    title: 'AI Triage Alert',
    description: 'High-risk patient flagged: Chest pain symptoms',
    severity: 'critical',
    action: '/provider/triage'
  },
  {
    id: 3,
    type: 'refill_request',
    title: 'Pending Refill Request',
    description: 'Metformin 500mg - Robert Smith',
    severity: 'info',
    action: '/provider/prescriptions'
  }
];

export default function ProviderDashboard() {
  const { user } = useAuth();
  const router = useRouter();
  const [upcomingAppointments, setUpcomingAppointments] = useState([]);
  const [recentVisits, setRecentVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Mock states for demo
  const [waitingRoom] = useState(MOCK_WAITING_ROOM);
  const [criticalLabs] = useState(MOCK_CRITICAL_LABS);
  const [tasksAlerts] = useState(MOCK_TASKS_ALERTS);

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

  const unsignedNotes = recentVisits.filter(v => !v.isSigned).length;

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-serif text-foreground">
            {getGreeting()}, Dr. {user?.lastName}!
          </h1>
          <p className="text-muted-foreground mt-1">
            {waitingRoom.length > 0 ? (
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                {waitingRoom.length} patient{waitingRoom.length > 1 ? 's' : ''} waiting
              </span>
            ) : (
              `You have ${todayAppointments} appointments today`
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/provider/call">
            <Button className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-lg shadow-emerald-500/25">
              <Phone className="w-4 h-4 mr-2" />
              Instant Call
            </Button>
          </Link>
          <Link href="/provider/schedule">
            <Button variant="outline" className="border-purple-500 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950">
              <Calendar className="w-4 h-4 mr-2" />
              View Schedule
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Today's Patients", value: todayAppointments || waitingRoom.length, icon: Users, color: 'bg-blue-100 dark:bg-blue-950', iconColor: 'text-blue-600' },
          { label: 'Completed', value: completedToday, icon: CheckCircle2, color: 'bg-emerald-100 dark:bg-emerald-950', iconColor: 'text-emerald-600' },
          { label: 'Waiting Now', value: waitingRoom.length, icon: Timer, color: 'bg-amber-100 dark:bg-amber-950', iconColor: 'text-amber-600', pulse: waitingRoom.length > 0 },
          { label: 'Unsigned Notes', value: unsignedNotes || 1, icon: FileWarning, color: 'bg-red-100 dark:bg-red-950', iconColor: 'text-red-600', alert: unsignedNotes > 0 || true }
        ].map((stat, index) => (
          <Card key={index} className={cn(stat.pulse && "ring-2 ring-amber-400 ring-offset-2 dark:ring-offset-background")}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className="text-3xl font-bold mt-1 text-foreground">{stat.value}</p>
                </div>
                <div className={cn(
                  "w-12 h-12 rounded-xl flex items-center justify-center",
                  stat.color,
                  stat.pulse && "animate-pulse"
                )}>
                  <stat.icon className={cn("w-6 h-6", stat.iconColor)} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Grid - Clinical Widgets */}
      <div className="grid lg:grid-cols-2 gap-6">
        
        {/* LIVE WAITING ROOM - Priority Widget */}
        <Card className="border-2 border-emerald-500/50 dark:border-emerald-500/30 shadow-lg shadow-emerald-500/10">
          <CardHeader className="pb-3 bg-gradient-to-r from-emerald-500/10 to-teal-500/10 dark:from-emerald-500/5 dark:to-teal-500/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                  <Users className="w-5 h-5 text-white" />
                </div>
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    Live Waiting Room
                    {waitingRoom.length > 0 && (
                      <span className="flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription>Patients currently online</CardDescription>
                </div>
              </div>
              <Link href="/provider/triage-queue">
                <Button variant="ghost" size="sm">
                  View Queue <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            {waitingRoom.length === 0 ? (
              <div className="text-center py-8">
                <Users className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground">No patients waiting</p>
                <p className="text-sm text-muted-foreground/70 mt-1">Your waiting room is empty</p>
              </div>
            ) : (
              <div className="space-y-3">
                {waitingRoom.map((patient) => (
                  <div 
                    key={patient.id} 
                    className={cn(
                      "p-4 rounded-xl border-2 transition-all",
                      patient.severity === 'high' 
                        ? "border-red-300 bg-red-50/50 dark:bg-red-950/20 dark:border-red-800" 
                        : "border-border hover:border-emerald-300 dark:hover:border-emerald-700"
                    )}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold",
                          patient.severity === 'high' 
                            ? "bg-gradient-to-br from-red-500 to-rose-600" 
                            : "bg-gradient-to-br from-blue-500 to-indigo-600"
                        )}>
                          {patient.avatarInitials}
                        </div>
                        <div>
                          <p className="font-semibold text-foreground">{patient.patientName}</p>
                          <div className="flex items-center gap-2 text-sm">
                            <span className={cn(
                              "flex items-center gap-1",
                              patient.severity === 'high' ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground"
                            )}>
                              {patient.severity === 'high' && <Thermometer className="w-3.5 h-3.5" />}
                              {patient.triageReason}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Waiting {patient.waitTime}m
                          </p>
                        </div>
                      </div>
                      <Button 
                        size="sm"
                        className={cn(
                          "shadow-lg",
                          patient.severity === 'high' 
                            ? "bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 shadow-red-500/25"
                            : "bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-emerald-500/25"
                        )}
                        onClick={() => router.push('/provider/call')}
                      >
                        <Video className="w-4 h-4 mr-1.5" />
                        Join Call
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* TASKS & ALERTS Widget */}
        <Card className="border-2 border-amber-500/50 dark:border-amber-500/30">
          <CardHeader className="pb-3 bg-gradient-to-r from-amber-500/10 to-orange-500/10 dark:from-amber-500/5 dark:to-orange-500/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
                  <Bell className="w-5 h-5 text-white" />
                </div>
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    Tasks & Alerts
                    <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">
                      {tasksAlerts.length}
                    </span>
                  </CardTitle>
                  <CardDescription>Action items requiring attention</CardDescription>
                </div>
              </div>
              <Link href="/provider/notifications">
                <Button variant="ghost" size="sm">
                  View All <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-3">
              {tasksAlerts.map((task) => (
                <Link key={task.id} href={task.action}>
                  <div className={cn(
                    "p-3 rounded-xl border transition-all cursor-pointer hover:shadow-md",
                    task.severity === 'critical' && "border-red-300 bg-red-50/50 dark:bg-red-950/20 dark:border-red-800 hover:border-red-400",
                    task.severity === 'warning' && "border-amber-300 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800 hover:border-amber-400",
                    task.severity === 'info' && "border-border hover:border-blue-300 dark:hover:border-blue-700"
                  )}>
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                        task.severity === 'critical' && "bg-red-100 dark:bg-red-900",
                        task.severity === 'warning' && "bg-amber-100 dark:bg-amber-900",
                        task.severity === 'info' && "bg-blue-100 dark:bg-blue-900"
                      )}>
                        {task.type === 'unsigned_note' && <FileWarning className={cn("w-4 h-4", task.severity === 'warning' ? "text-amber-600" : "text-blue-600")} />}
                        {task.type === 'ai_alert' && <Zap className="w-4 h-4 text-red-600" />}
                        {task.type === 'refill_request' && <ClipboardList className="w-4 h-4 text-blue-600" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          "font-medium text-sm",
                          task.severity === 'critical' && "text-red-700 dark:text-red-400",
                          task.severity === 'warning' && "text-amber-700 dark:text-amber-400",
                          task.severity === 'info' && "text-foreground"
                        )}>
                          {task.title}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{task.description}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* CRITICAL LABS Widget */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center">
                  <Beaker className="w-5 h-5 text-white" />
                </div>
                <div>
                  <CardTitle className="text-lg">Critical Lab Results</CardTitle>
                  <CardDescription>Flagged results requiring review</CardDescription>
                </div>
              </div>
              <Link href="/provider/patients">
                <Button variant="ghost" size="sm">
                  View All <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {criticalLabs.map((lab) => (
                <div 
                  key={lab.id}
                  className={cn(
                    "p-3 rounded-xl border transition-all cursor-pointer hover:shadow-md",
                    lab.status === 'critical' && "border-red-300 bg-red-50/50 dark:bg-red-950/20 dark:border-red-800",
                    lab.status === 'abnormal' && "border-amber-300 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm text-foreground">{lab.patientName}</p>
                      <p className="text-xs text-muted-foreground">{lab.testName}</p>
                    </div>
                    <div className="text-right">
                      <p className={cn(
                        "font-bold text-sm",
                        lab.status === 'critical' && "text-red-600 dark:text-red-400",
                        lab.status === 'abnormal' && "text-amber-600 dark:text-amber-400"
                      )}>
                        {lab.value}
                        {lab.status === 'critical' && (
                          <AlertTriangle className="w-4 h-4 inline ml-1" />
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">Ref: {lab.referenceRange}</p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className={cn(
                      "text-xs px-2 py-0.5 rounded-full font-medium",
                      lab.status === 'critical' && "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
                      lab.status === 'abnormal' && "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
                    )}>
                      {lab.status === 'critical' ? 'CRITICAL' : 'ABNORMAL'}
                    </span>
                    <span className="text-xs text-muted-foreground">{lab.date}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent Visit Notes */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-lg">Recent Visit Notes</CardTitle>
                <CardDescription>Your latest clinical documentation</CardDescription>
              </div>
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
                    <div className="h-16 bg-muted rounded-xl"></div>
                  </div>
                ))}
              </div>
            ) : recentVisits.length === 0 ? (
              <div className="text-center py-8">
                <FileText className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground">No recent visits</p>
                <Link href="/provider/visits?action=new">
                  <Button variant="outline" size="sm" className="mt-4">
                    <FileText className="w-4 h-4 mr-2" />
                    Create New Note
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {recentVisits.slice(0, 4).map((visit) => (
                  <Link key={visit.id} href={`/provider/visits/${visit.id}`}>
                    <div className="p-3 rounded-xl border hover:border-blue-300 dark:hover:border-blue-700 hover:bg-accent/50 transition-all cursor-pointer">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm text-foreground">
                            {visit.patientFirstName} {visit.patientLastName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDateTime(visit.createdAt)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {visit.isSigned ? (
                            <span className="px-2 py-1 text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 rounded-full flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              Signed
                            </span>
                          ) : (
                            <span className="px-2 py-1 text-xs bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 rounded-full flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" />
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
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
              <Calendar className="w-5 h-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-lg">Upcoming Schedule</CardTitle>
              <CardDescription>Your appointments for the next few days</CardDescription>
            </div>
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
              <div className="h-32 bg-muted rounded-xl"></div>
            </div>
          ) : upcomingAppointments.length === 0 ? (
            <div className="text-center py-12 px-4">
              <div className="w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center mx-auto mb-4">
                <Calendar className="w-8 h-8 text-purple-600 dark:text-purple-400" />
              </div>
              <p className="text-muted-foreground font-medium">No upcoming appointments</p>
              <p className="text-sm text-muted-foreground/70 mt-1 mb-6">
                Your schedule is clear. Set your availability or add a new patient.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Link href="/provider/schedule?action=availability">
                  <Button className="bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700">
                    <Calendar className="w-4 h-4 mr-2" />
                    Open Availability
                  </Button>
                </Link>
                <Link href="/provider/patients?action=new">
                  <Button variant="outline" className="border-purple-500 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950">
                    <UserPlus className="w-4 h-4 mr-2" />
                    Add Patient
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {upcomingAppointments.map((apt) => (
                <div 
                  key={apt.id} 
                  onClick={() => router.push(`/provider/appointments/${apt.id}/visit`)}
                  className="p-4 rounded-xl border hover:border-purple-300 dark:hover:border-purple-700 hover:bg-accent/50 transition-all cursor-pointer"
                >
                  <div className="flex flex-col md:flex-row md:items-center gap-4">
                    {/* Patient Info */}
                    <div className="flex items-center gap-4 flex-1">
                      <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-lg font-medium">
                        {apt.patientFirstName?.[0]}{apt.patientLastName?.[0]}
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground">
                          {apt.patientFirstName} {apt.patientLastName}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {apt.reasonForVisit || 'General Consultation'}
                        </p>
                      </div>
                    </div>

                    {/* Date & Time */}
                    <div className="flex items-center gap-6 text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Calendar className="w-4 h-4 text-purple-500" />
                        <span>{formatDateTime(apt.scheduledAt)}</span>
                      </div>
                      {apt.type === 'video' && (
                        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                          <Video className="w-4 h-4" />
                          <span className="font-medium">Video</span>
                        </div>
                      )}
                    </div>

                    {/* Status & Actions */}
                    <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                      <span className={cn(
                        "px-3 py-1 text-xs font-medium rounded-full",
                        apt.status === 'scheduled' && 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
                        apt.status === 'confirmed' && 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
                        apt.status === 'completed' && 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
                        apt.status === 'cancelled' && 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                      )}>
                        {apt.status.charAt(0).toUpperCase() + apt.status.slice(1)}
                      </span>
                      {apt.type === 'video' && (
                        <Link href={`/provider/appointments/${apt.id}/call`}>
                          <Button 
                            size="sm"
                            className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-md"
                          >
                            <Video className="w-4 h-4 mr-2" />
                            Join Call
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
