'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Calendar, Video, MessageSquare, FileText, Clock,
  ChevronRight, User, Activity, Bell, Plus, Pill,
  Shield, Heart, AlertCircle, Phone, Stethoscope,
  TrendingUp, Droplets, Scale, ThermometerSun, CheckCircle2,
  ArrowRight, Sparkles, CreditCard, RefreshCw, Mail, X
} from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { appointmentsAPI, notificationsAPI } from '@/lib/api';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime, formatRelativeTime, cn } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';
import TriageFlow from '@/components/hive/TriageFlow';

// Mock data for patient-centric widgets
const MOCK_MEDICATIONS = [
  {
    id: 1,
    name: 'Lisinopril',
    dosage: '10mg',
    frequency: 'Once daily',
    refillsLeft: 3,
    nextRefill: '15 days',
    status: 'active'
  },
  {
    id: 2,
    name: 'Metformin',
    dosage: '500mg',
    frequency: 'Twice daily',
    refillsLeft: 1,
    nextRefill: '5 days',
    status: 'low_refill'
  },
  {
    id: 3,
    name: 'Amoxicillin',
    dosage: '250mg',
    frequency: 'Three times daily',
    refillsLeft: 0,
    nextRefill: 'Needs Refill',
    status: 'needs_refill'
  }
];

const MOCK_VITALS = {
  bloodPressure: { value: '120/80', unit: 'mmHg', status: 'normal', date: '2 days ago' },
  heartRate: { value: '72', unit: 'bpm', status: 'normal', date: '2 days ago' },
  weight: { value: '165', unit: 'lbs', trend: '-2 lbs', date: 'Last week' },
  temperature: { value: '98.6', unit: '°F', status: 'normal', date: 'Today' }
};

const MOCK_INSURANCE = {
  provider: 'Aetna',
  planName: 'PPO Gold',
  memberId: '****4521',
  status: 'active',
  balance: 0.00
};

// Mock messages with CORRECT sender (doctor, not patient)
const MOCK_MESSAGES = [
  {
    id: 1,
    senderName: 'Dr. Sarah Smith',
    senderRole: 'Primary Care',
    senderInitials: 'SS',
    message: 'Your lab results look great! Let\'s discuss at your next visit.',
    timestamp: '2 hours ago',
    isRead: false
  },
  {
    id: 2,
    senderName: 'Care Team',
    senderRole: 'Docta Support',
    senderInitials: 'CT',
    message: 'Reminder: Please complete your health questionnaire before your appointment.',
    timestamp: 'Yesterday',
    isRead: true
  }
];

export default function PatientDashboard() {
  const { user } = useAuth();
  const [appointments, setAppointments] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [verifyBannerDismissed, setVerifyBannerDismissed] = useState(false);
  const [resendingVerify, setResendingVerify] = useState(false);

  // Mock states
  const [medications] = useState(MOCK_MEDICATIONS);
  const [vitals] = useState(MOCK_VITALS);
  const [insurance] = useState(MOCK_INSURANCE);
  const [messages] = useState(MOCK_MESSAGES);

  const handleResendVerification = async () => {
    setResendingVerify(true);
    try {
      await api.post('/auth/resend-verification');
      toast({ title: 'Verification email sent!', description: 'Check your inbox and click the link to verify.', variant: 'success' });
    } catch (err) {
      toast({ title: 'Could not resend', description: err.response?.data?.error || 'Try again in a moment.', variant: 'destructive' });
    } finally {
      setResendingVerify(false);
    }
  };

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

  const lowRefillMeds = medications.filter(m => m.refillsLeft <= 1).length;

  return (
    <div className="space-y-6">
      {/* Email Verification Banner */}
      {!user?.isVerified && !verifyBannerDismissed && (
        <div className="flex items-center gap-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 rounded-2xl px-5 py-4">
          <div className="bg-amber-100 dark:bg-amber-900/60 p-2 rounded-full flex-shrink-0">
            <Mail className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Verify your email to unlock full access</p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">We sent a link to <strong>{user?.email}</strong>. Click it to verify your account.</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button size="sm" variant="outline"
              className="border-amber-400 text-amber-700 hover:bg-amber-100 dark:border-amber-600 dark:text-amber-300 dark:hover:bg-amber-900/40 text-xs"
              onClick={handleResendVerification} disabled={resendingVerify}>
              {resendingVerify ? 'Sending…' : 'Resend email'}
            </Button>
            <button onClick={() => setVerifyBannerDismissed(true)}
              className="text-amber-500 hover:text-amber-700 dark:hover:text-amber-300 p-1 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Welcome Section with Dual CTAs */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-serif text-foreground">
            {getGreeting()}, {user?.firstName}!
          </h1>
          <p className="text-muted-foreground mt-1">
            {lowRefillMeds > 0 ? (
              <span className="text-amber-600 dark:text-amber-400">
                {lowRefillMeds} medication{lowRefillMeds > 1 ? 's' : ''} need{lowRefillMeds === 1 ? 's' : ''} attention
              </span>
            ) : (
              "Your health snapshot at a glance"
            )}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Urgent Care Button - Distinct Warning Color */}
          <Link href="/patient/triage">
            <Button 
              variant="outline" 
              className="border-2 border-amber-500 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950 dark:text-amber-400 shadow-lg shadow-amber-500/10"
            >
              <Phone className="w-4 h-4 mr-2" />
              Talk to a Doctor Now
            </Button>
          </Link>
          {/* Primary Booking Button */}
          <Link href="/patient/appointments/book">
            <Button className="bg-gradient-to-r from-purple-600 to-indigo-700 hover:from-purple-700 hover:to-indigo-800 text-white shadow-lg shadow-purple-500/25">
              <Plus className="w-4 h-4 mr-2" />
              Book Appointment
            </Button>
          </Link>
        </div>
      </div>

      {/* Quick Actions - MOVED UP */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Book Visit', icon: Calendar, href: '/patient/appointments/book', color: 'from-purple-500 to-indigo-600', bgLight: 'bg-purple-50 dark:bg-purple-950/50' },
          { label: 'Message Doctor', icon: MessageSquare, href: '/patient/messages', color: 'from-blue-500 to-cyan-600', bgLight: 'bg-blue-50 dark:bg-blue-950/50' },
          { label: 'View Records', icon: FileText, href: '/patient/records', color: 'from-emerald-500 to-teal-600', bgLight: 'bg-emerald-50 dark:bg-emerald-950/50' },
          { label: 'Refill Rx', icon: Pill, href: '/patient/prescriptions', color: 'from-amber-500 to-orange-600', bgLight: 'bg-amber-50 dark:bg-amber-950/50' }
        ].map((action, index) => (
          <Link key={index} href={action.href}>
            <Card className={cn(
              "hover:shadow-lg hover:scale-[1.02] transition-all cursor-pointer border-2 border-transparent hover:border-primary/30",
              action.bgLight
            )}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className={cn(
                  "w-12 h-12 rounded-xl flex items-center justify-center bg-gradient-to-br shadow-lg",
                  action.color
                )}>
                  <action.icon className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">{action.label}</p>
                  <p className="text-xs text-muted-foreground">Quick access</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* AI Triage — Describe symptoms to get the right care */}
      <TriageFlow />

      {/* Insurance Status Banner */}
      <Card className="bg-gradient-to-r from-emerald-500/10 to-teal-500/10 dark:from-emerald-500/5 dark:to-teal-500/5 border-emerald-500/30">
        <CardContent className="py-4 px-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg">
                <Shield className="w-6 h-6 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-foreground">Insurance: {insurance.provider}</p>
                  <span className="px-2 py-0.5 text-xs rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Active
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{insurance.planName} • Member ID: {insurance.memberId}</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Balance Due</p>
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">${insurance.balance.toFixed(2)}</p>
              </div>
              <Link href="/patient/billing">
                <Button variant="outline" size="sm" className="border-emerald-500 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950">
                  View Details
                </Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Grid */}
      <div className="grid lg:grid-cols-2 gap-6">
        
        {/* Active Medications Widget */}
        <Card className="border-2 border-purple-500/30 dark:border-purple-500/20">
          <CardHeader className="pb-3 bg-gradient-to-r from-purple-500/10 to-violet-500/10 dark:from-purple-500/5 dark:to-violet-500/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center">
                  <Pill className="w-5 h-5 text-white" />
                </div>
                <div>
                  <CardTitle className="text-lg">Current Medications</CardTitle>
                  <CardDescription>{medications.length} active prescriptions</CardDescription>
                </div>
              </div>
              <Link href="/patient/prescriptions">
                <Button variant="ghost" size="sm">
                  View All <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-3">
              {medications.map((med) => (
                <div 
                  key={med.id}
                  className={cn(
                    "p-3 rounded-xl border transition-all",
                    med.status === 'needs_refill' && "border-red-300 bg-red-50/50 dark:bg-red-950/20 dark:border-red-800",
                    med.status === 'low_refill' && "border-amber-300 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800",
                    med.status === 'active' && "border-border hover:border-purple-300 dark:hover:border-purple-700"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-foreground">{med.name}</p>
                      <p className="text-sm text-muted-foreground">{med.dosage} • {med.frequency}</p>
                    </div>
                    <div className="text-right">
                      {med.status === 'needs_refill' ? (
                        <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          Needs Refill
                        </span>
                      ) : med.status === 'low_refill' ? (
                        <span className="px-2 py-1 text-xs rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                          {med.refillsLeft} Refill Left
                        </span>
                      ) : (
                        <span className="px-2 py-1 text-xs rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                          {med.refillsLeft} Refills
                        </span>
                      )}
                    </div>
                  </div>
                  {med.status === 'needs_refill' && (
                    <Link href="/patient/prescriptions">
                      <Button size="sm" className="mt-3 w-full bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700">
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Request Refill
                      </Button>
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Messages - FIXED: Shows Doctor's name, not patient's */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center">
                  <MessageSquare className="w-5 h-5 text-white" />
                </div>
                <div>
                  <CardTitle className="text-lg">Messages</CardTitle>
                  <CardDescription>From your care team</CardDescription>
                </div>
              </div>
              <Link href="/patient/messages">
                <Button variant="ghost" size="sm">
                  View All <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {messages.map((msg) => (
                <Link key={msg.id} href="/patient/messages">
                  <div className={cn(
                    "p-3 rounded-xl border transition-all cursor-pointer hover:shadow-md",
                    !msg.isRead 
                      ? "border-blue-300 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-800" 
                      : "border-border hover:border-blue-300 dark:hover:border-blue-700"
                  )}>
                    <div className="flex items-start gap-3">
                      {/* Doctor/Sender Avatar - NOT patient's avatar */}
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-medium shadow-md flex-shrink-0">
                        {msg.senderInitials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm text-foreground">{msg.senderName}</p>
                          {!msg.isRead && (
                            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{msg.senderRole}</p>
                        <p className="text-sm text-muted-foreground truncate mt-1">{msg.message}</p>
                        <p className="text-xs text-muted-foreground/70 mt-1">{msg.timestamp}</p>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Upcoming Appointments - Improved Empty State */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                <Calendar className="w-5 h-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-lg">Upcoming Appointments</CardTitle>
                <CardDescription>Your scheduled visits</CardDescription>
              </div>
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
                {[1, 2].map(i => (
                  <div key={i} className="animate-pulse">
                    <div className="h-20 bg-muted rounded-xl"></div>
                  </div>
                ))}
              </div>
            ) : appointments.length === 0 ? (
              /* IMPROVED EMPTY STATE - Recommendation Based */
              <div className="text-center py-8 px-4">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-100 to-violet-100 dark:from-purple-900/50 dark:to-violet-900/50 flex items-center justify-center mx-auto mb-4">
                  <Stethoscope className="w-8 h-8 text-purple-600 dark:text-purple-400" />
                </div>
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  <p className="font-semibold text-foreground">Health Reminder</p>
                </div>
                <p className="text-muted-foreground mb-2">
                  You're due for your <span className="font-medium text-purple-600 dark:text-purple-400">Annual Physical</span>
                </p>
                <p className="text-sm text-muted-foreground/70 mb-6">
                  Regular check-ups help catch potential issues early. It's been over a year since your last visit.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <Link href="/patient/appointments/book">
                    <Button className="bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700">
                      <Calendar className="w-4 h-4 mr-2" />
                      Schedule Check-up
                    </Button>
                  </Link>
                  <Link href="/patient/triage">
                    <Button variant="outline" className="border-amber-500 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950">
                      <Phone className="w-4 h-4 mr-2" />
                      Need Care Now?
                    </Button>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {appointments.map((apt) => (
                  <Link key={apt.id} href={`/patient/appointments/${apt.id}`}>
                    <div className="p-4 rounded-xl border border-border hover:border-purple-300 dark:hover:border-purple-700 hover:bg-accent/50 transition-all cursor-pointer">
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
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 text-xs rounded-full">
                              <Video className="w-3 h-3" />
                              Video
                            </span>
                          )}
                          <span className={cn(
                            "px-2 py-1 text-xs rounded-full font-medium",
                            apt.status === 'scheduled' && 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
                            apt.status === 'confirmed' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300'
                          )}>
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

        {/* Latest Vitals Widget */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center">
                  <Heart className="w-5 h-5 text-white" />
                </div>
                <div>
                  <CardTitle className="text-lg">Latest Vitals</CardTitle>
                  <CardDescription>Your health metrics</CardDescription>
                </div>
              </div>
              <Link href="/patient/records">
                <Button variant="ghost" size="sm">
                  View History <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {/* Blood Pressure */}
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800">
                <div className="flex items-center gap-2 mb-1">
                  <Droplets className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                  <span className="text-xs text-muted-foreground">Blood Pressure</span>
                </div>
                <p className="text-xl font-bold text-foreground">{vitals.bloodPressure.value}</p>
                <p className="text-xs text-muted-foreground">{vitals.bloodPressure.unit} • {vitals.bloodPressure.date}</p>
              </div>
              
              {/* Heart Rate */}
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
                <div className="flex items-center gap-2 mb-1">
                  <Heart className="w-4 h-4 text-red-600 dark:text-red-400" />
                  <span className="text-xs text-muted-foreground">Heart Rate</span>
                </div>
                <p className="text-xl font-bold text-foreground">{vitals.heartRate.value} <span className="text-sm font-normal text-muted-foreground">{vitals.heartRate.unit}</span></p>
                <p className="text-xs text-muted-foreground">{vitals.heartRate.date}</p>
              </div>
              
              {/* Weight */}
              <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                <div className="flex items-center gap-2 mb-1">
                  <Scale className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span className="text-xs text-muted-foreground">Weight</span>
                </div>
                <p className="text-xl font-bold text-foreground">{vitals.weight.value} <span className="text-sm font-normal text-muted-foreground">{vitals.weight.unit}</span></p>
                <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" />
                  {vitals.weight.trend}
                </p>
              </div>
              
              {/* Temperature */}
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                <div className="flex items-center gap-2 mb-1">
                  <ThermometerSun className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  <span className="text-xs text-muted-foreground">Temperature</span>
                </div>
                <p className="text-xl font-bold text-foreground">{vitals.temperature.value}<span className="text-sm font-normal text-muted-foreground">{vitals.temperature.unit}</span></p>
                <p className="text-xs text-muted-foreground">{vitals.temperature.date}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Health Tips / Wellness Banner */}
      <Card className="bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-pink-500/10 dark:from-indigo-500/5 dark:via-purple-500/5 dark:to-pink-500/5 border-purple-500/30">
        <CardContent className="py-6 px-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg">
                <Sparkles className="w-7 h-7 text-white" />
              </div>
              <div>
                <p className="font-semibold text-lg text-foreground">Stay on Top of Your Health</p>
                <p className="text-muted-foreground">
                  Complete your annual wellness visit and earn rewards on your Docta account.
                </p>
              </div>
            </div>
            <Link href="/patient/appointments/book">
              <Button className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:from-indigo-600 hover:via-purple-600 hover:to-pink-600 text-white shadow-lg">
                Learn More
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
