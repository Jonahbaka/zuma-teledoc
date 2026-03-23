'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Calendar,
  ChevronRight,
  FileText,
  Heart,
  Mail,
  MessageSquare,
  Phone,
  Pill,
  Plus,
  Shield,
  Sparkles,
  Stethoscope,
  Video,
  X,
} from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { appointmentsAPI, clinicalEhrAPI, insuranceAPI, notificationsAPI } from '@/lib/api';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime, formatRelativeTime, cn } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';
import TriageFlow from '@/components/hive/TriageFlow';

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function isNotificationRead(notification) {
  return Boolean(notification?.isRead || notification?.readAt || notification?.read_at);
}

function getPrimaryInsurance(wallet) {
  if (!Array.isArray(wallet) || wallet.length === 0) return null;
  return wallet.find((item) => item?.isPrimary || item?.is_primary) || wallet[0];
}

export default function PatientDashboard() {
  const { user } = useAuth();
  const [appointments, setAppointments] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [medications, setMedications] = useState([]);
  const [insuranceWallet, setInsuranceWallet] = useState([]);
  const [loading, setLoading] = useState(true);
  const [verifyBannerDismissed, setVerifyBannerDismissed] = useState(false);
  const [resendingVerify, setResendingVerify] = useState(false);

  const handleResendVerification = async () => {
    setResendingVerify(true);
    try {
      await api.post('/auth/resend-verification');
      toast({ title: 'Verification email sent', description: 'Check your inbox and click the link to verify.', variant: 'success' });
    } catch (err) {
      toast({ title: 'Could not resend', description: err.response?.data?.error || 'Try again in a moment.', variant: 'destructive' });
    } finally {
      setResendingVerify(false);
    }
  };

  useEffect(() => {
    if (!user?.id) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        const [appointmentsRes, notificationsRes, medicationsRes, insuranceRes] = await Promise.all([
          appointmentsAPI.getUpcoming(3).catch(() => ({ data: { success: false, appointments: [] } })),
          notificationsAPI.getAll({ limit: 5 }).catch(() => ({ data: { success: false, notifications: [] } })),
          clinicalEhrAPI.getMedications(user.id).catch(() => ({ data: { success: false, medications: [] } })),
          insuranceAPI.getWallet().catch(() => ({ data: { success: false, wallet: [] } })),
        ]);

        setAppointments(appointmentsRes.data?.success ? appointmentsRes.data.appointments || [] : []);
        setNotifications(notificationsRes.data?.success ? notificationsRes.data.notifications || [] : []);
        setMedications(medicationsRes.data?.success ? medicationsRes.data.medications || [] : []);
        setInsuranceWallet(insuranceRes.data?.success ? insuranceRes.data.wallet || [] : []);
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user?.id]);

  const primaryInsurance = useMemo(() => getPrimaryInsurance(insuranceWallet), [insuranceWallet]);
  const unreadNotifications = useMemo(
    () => notifications.filter((notification) => !isNotificationRead(notification)).length,
    [notifications]
  );
  const recentNotifications = useMemo(() => notifications.slice(0, 3), [notifications]);
  const activeMedications = useMemo(
    () => medications.filter((medication) => medication?.isActive ?? medication?.is_active ?? true),
    [medications]
  );

  return (
    <div className="space-y-6">
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
            <Button size="sm" variant="outline" className="border-amber-400 text-amber-700 hover:bg-amber-100 dark:border-amber-600 dark:text-amber-300 dark:hover:bg-amber-900/40 text-xs" onClick={handleResendVerification} disabled={resendingVerify}>
              {resendingVerify ? 'Sending...' : 'Resend email'}
            </Button>
            <button onClick={() => setVerifyBannerDismissed(true)} className="text-amber-500 hover:text-amber-700 dark:hover:text-amber-300 p-1 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-serif text-foreground">{getGreeting()}, {user?.firstName || 'there'}!</h1>
          <p className="text-muted-foreground mt-1">
            {unreadNotifications > 0 ? (
              <span className="text-amber-600 dark:text-amber-400">{unreadNotifications} new alert{unreadNotifications === 1 ? '' : 's'} need your attention</span>
            ) : activeMedications.length > 0 ? (
              `${activeMedications.length} active medication${activeMedications.length === 1 ? '' : 's'} on file`
            ) : (
              'Your health snapshot at a glance'
            )}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <Link href="/patient/triage">
            <Button variant="outline" className="border-2 border-amber-500 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950 dark:text-amber-400 shadow-lg shadow-amber-500/10">
              <Phone className="w-4 h-4 mr-2" /> Talk to a Doctor Now
            </Button>
          </Link>
          <Link href="/patient/appointments/book">
            <Button className="bg-gradient-to-r from-purple-600 to-indigo-700 hover:from-purple-700 hover:to-indigo-800 text-white shadow-lg shadow-purple-500/25">
              <Plus className="w-4 h-4 mr-2" /> Book Appointment
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Book Visit', icon: Calendar, href: '/patient/appointments/book', color: 'from-purple-500 to-indigo-600', bgLight: 'bg-purple-50 dark:bg-purple-950/50' },
          { label: 'Messages', icon: MessageSquare, href: '/patient/messages', color: 'from-blue-500 to-cyan-600', bgLight: 'bg-blue-50 dark:bg-blue-950/50' },
          { label: 'View Records', icon: FileText, href: '/patient/records', color: 'from-emerald-500 to-teal-600', bgLight: 'bg-emerald-50 dark:bg-emerald-950/50' },
          { label: 'Pharmacy', icon: Pill, href: '/patient/pharmacy', color: 'from-amber-500 to-orange-600', bgLight: 'bg-amber-50 dark:bg-amber-950/50' },
        ].map((action) => (
          <Link key={action.label} href={action.href}>
            <Card className={cn('hover:shadow-lg hover:scale-[1.02] transition-all cursor-pointer border-2 border-transparent hover:border-primary/30', action.bgLight)}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center bg-gradient-to-br shadow-lg', action.color)}>
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

      <TriageFlow />

      {primaryInsurance ? (
        <Card className="bg-gradient-to-r from-emerald-500/10 to-teal-500/10 dark:from-emerald-500/5 dark:to-teal-500/5 border-emerald-500/30">
          <CardContent className="py-4 px-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg">
                  <Shield className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">Insurance: {primaryInsurance.insuranceProvider || primaryInsurance.insurance_provider || 'Coverage on file'}</p>
                  <p className="text-sm text-muted-foreground">
                    Eligibility: {primaryInsurance.eligibilityStatus || primaryInsurance.eligibility_status || 'pending'}
                    {(primaryInsurance.policyNumber || primaryInsurance.policy_number) ? ` | Member ID: ${primaryInsurance.policyNumber || primaryInsurance.policy_number}` : ''}
                  </p>
                </div>
              </div>
              <Link href="/patient/wallet">
                <Button variant="outline" size="sm" className="border-emerald-500 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950">Review Coverage</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-gradient-to-r from-slate-100 to-slate-50 dark:from-slate-900 dark:to-slate-950 border-border">
          <CardContent className="py-4 px-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center shadow-lg">
                  <Shield className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">No insurance card on file</p>
                  <p className="text-sm text-muted-foreground">Add coverage details to speed up booking, eligibility checks, and prescription routing.</p>
                </div>
              </div>
              <Link href="/patient/wallet">
                <Button className="bg-gradient-to-r from-slate-900 to-slate-700 hover:from-slate-800 hover:to-slate-600 text-white">Upload Coverage</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="border-2 border-purple-500/30 dark:border-purple-500/20">
          <CardHeader className="pb-3 bg-gradient-to-r from-purple-500/10 to-violet-500/10 dark:from-purple-500/5 dark:to-violet-500/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center">
                  <Pill className="w-5 h-5 text-white" />
                </div>
                <div>
                  <CardTitle className="text-lg">Current Medications</CardTitle>
                  <CardDescription>{activeMedications.length} active medication{activeMedications.length === 1 ? '' : 's'}</CardDescription>
                </div>
              </div>
              <Link href="/patient/prescriptions">
                <Button variant="ghost" size="sm">View All <ChevronRight className="w-4 h-4 ml-1" /></Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            {loading ? (
              <div className="space-y-3">{[1, 2, 3].map((item) => <div key={item} className="h-20 rounded-xl bg-muted animate-pulse" />)}</div>
            ) : activeMedications.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-center">
                <Pill className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                <p className="font-semibold text-foreground">No active medications on file.</p>
                <p className="mt-2 text-sm text-muted-foreground">After a provider documents medication changes, they will appear here instead of demo data.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {activeMedications.map((medication) => (
                  <div key={medication.id} className="p-3 rounded-xl border border-border hover:border-purple-300 dark:hover:border-purple-700 transition-all">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-foreground">{medication.medicationName || 'Medication'}</p>
                        <p className="text-sm text-muted-foreground">{medication.dosage || 'Dose not specified'} | {medication.frequency || 'Schedule not specified'}</p>
                        <p className="text-xs text-muted-foreground mt-1">{medication.route ? `Route: ${medication.route}` : 'Route pending'}{medication.prescriberName ? ` | Prescriber: ${medication.prescriberName}` : ''}</p>
                      </div>
                      <span className="px-2 py-1 text-xs rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">Active</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center"><MessageSquare className="w-5 h-5 text-white" /></div>
                <div>
                  <CardTitle className="text-lg">Recent Alerts</CardTitle>
                  <CardDescription>Live account notifications</CardDescription>
                </div>
              </div>
              <Link href="/patient/messages"><Button variant="ghost" size="sm">View All <ChevronRight className="w-4 h-4 ml-1" /></Button></Link>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">{[1, 2].map((item) => <div key={item} className="h-20 rounded-xl bg-muted animate-pulse" />)}</div>
            ) : recentNotifications.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-center">
                <MessageSquare className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                <p className="font-semibold text-foreground">No recent notifications.</p>
                <p className="mt-2 text-sm text-muted-foreground">Care-team and system alerts will appear here when they are generated.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentNotifications.map((notification) => (
                  <Link key={notification.id} href="/patient/messages">
                    <div className={cn('p-3 rounded-xl border transition-all cursor-pointer hover:shadow-md', !isNotificationRead(notification) ? 'border-blue-300 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-800' : 'border-border hover:border-blue-300 dark:hover:border-blue-700')}>
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-medium shadow-md flex-shrink-0">{(notification.title || 'NT').slice(0, 2).toUpperCase()}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-sm text-foreground">{notification.title || 'Notification'}</p>
                            {!isNotificationRead(notification) && <span className="w-2 h-2 rounded-full bg-blue-500" />}
                          </div>
                          <p className="text-sm text-muted-foreground truncate mt-1">{notification.message || notification.body || 'New account activity detected.'}</p>
                          <p className="text-xs text-muted-foreground/70 mt-1">{formatRelativeTime(notification.createdAt || notification.created_at || new Date())}</p>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center"><Calendar className="w-5 h-5 text-white" /></div>
              <div>
                <CardTitle className="text-lg">Upcoming Appointments</CardTitle>
                <CardDescription>Your scheduled visits</CardDescription>
              </div>
            </div>
            <Link href="/patient/appointments"><Button variant="ghost" size="sm">View all <ChevronRight className="w-4 h-4 ml-1" /></Button></Link>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-4">{[1, 2].map((item) => <div key={item} className="h-20 bg-muted rounded-xl animate-pulse" />)}</div>
            ) : appointments.length === 0 ? (
              <div className="text-center py-8 px-4">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-100 to-violet-100 dark:from-purple-900/50 dark:to-violet-900/50 flex items-center justify-center mx-auto mb-4"><Stethoscope className="w-8 h-8 text-purple-600 dark:text-purple-400" /></div>
                <div className="flex items-center justify-center gap-2 mb-2"><Sparkles className="w-4 h-4 text-amber-500" /><p className="font-semibold text-foreground">Health Reminder</p></div>
                <p className="text-muted-foreground mb-2">No upcoming visits are booked right now.</p>
                <p className="text-sm text-muted-foreground/70 mb-6">Regular check-ups help catch potential issues early. Book your next visit when you are ready.</p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <Link href="/patient/appointments/book"><Button className="bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700"><Calendar className="w-4 h-4 mr-2" /> Schedule Check-up</Button></Link>
                  <Link href="/patient/triage"><Button variant="outline" className="border-amber-500 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950"><Phone className="w-4 h-4 mr-2" /> Need Care Now?</Button></Link>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {appointments.map((appointment) => (
                  <Link key={appointment.id} href={`/patient/appointments/${appointment.id}`}>
                    <div className="p-4 rounded-xl border border-border hover:border-purple-300 dark:hover:border-purple-700 hover:bg-accent/50 transition-all cursor-pointer">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex gap-4">
                          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white font-medium shadow-lg shadow-purple-500/25">{appointment.providerFirstName?.[0]}{appointment.providerLastName?.[0]}</div>
                          <div>
                            <p className="font-medium text-foreground">Dr. {appointment.providerFirstName} {appointment.providerLastName}</p>
                            <p className="text-sm text-muted-foreground">{appointment.providerSpecialty || 'General Practice'}</p>
                            <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground"><Calendar className="w-4 h-4" /><span>{formatDateTime(appointment.scheduledAt)}</span></div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          {appointment.type === 'video' && <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 text-xs rounded-full"><Video className="w-3 h-3" /> Video</span>}
                          <span className="px-2 py-1 text-xs rounded-full font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">{(appointment.status || 'scheduled').charAt(0).toUpperCase() + (appointment.status || 'scheduled').slice(1)}</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center"><Heart className="w-5 h-5 text-white" /></div>
                <div>
                  <CardTitle className="text-lg">Latest Vitals</CardTitle>
                  <CardDescription>Your health metrics</CardDescription>
                </div>
              </div>
              <Link href="/patient/records"><Button variant="ghost" size="sm">View History <ChevronRight className="w-4 h-4 ml-1" /></Button></Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-center">
              <Heart className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
              <p className="font-semibold text-foreground">No live vitals snapshot is available.</p>
              <p className="mt-2 text-sm text-muted-foreground">Vitals will appear here after a clinician records them in your chart. Demo measurements are no longer shown in production.</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-pink-500/10 dark:from-indigo-500/5 dark:via-purple-500/5 dark:to-pink-500/5 border-purple-500/30">
        <CardContent className="py-6 px-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg"><Sparkles className="w-7 h-7 text-white" /></div>
              <div>
                <p className="font-semibold text-lg text-foreground">Stay on Top of Your Health</p>
                <p className="text-muted-foreground">Complete your annual wellness visit and keep your records, prescriptions, and coverage details current.</p>
              </div>
            </div>
            <Link href="/patient/appointments/book"><Button className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:from-indigo-600 hover:via-purple-600 hover:to-pink-600 text-white shadow-lg">Learn More <ArrowRight className="w-4 h-4 ml-2" /></Button></Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
