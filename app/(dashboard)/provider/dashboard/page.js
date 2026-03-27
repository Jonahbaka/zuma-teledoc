'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileText,
  Mail,
  Phone,
  Pill,
  Share2,
  ShieldCheck,
  UserPlus,
  Video,
  X,
} from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { appointmentsAPI, visitsAPI } from '@/lib/api';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';
import { resolveProviderMarket, toProviderPortalPath } from '@/lib/providerPortal';

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function ProviderDashboard() {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [upcomingAppointments, setUpcomingAppointments] = useState([]);
  const [recentVisits, setRecentVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [verifyBannerDismissed, setVerifyBannerDismissed] = useState(false);
  const [resendingVerify, setResendingVerify] = useState(false);

  const providerPath = useCallback(
    (target) => toProviderPortalPath(target, { pathname, user }),
    [pathname, user]
  );
  const market = useMemo(
    () => resolveProviderMarket({ pathname, user }),
    [pathname, user]
  );
  const isNigeriaMarket = market === 'NG';

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [appointmentsRes, visitsRes] = await Promise.all([
          appointmentsAPI.getUpcoming(8),
          visitsAPI.getRecent(8),
        ]);

        if (appointmentsRes.data.success) {
          setUpcomingAppointments(appointmentsRes.data.appointments || []);
        }

        if (visitsRes.data.success) {
          setRecentVisits(visitsRes.data.visits || []);
        }
      } catch (error) {
        console.error('Error fetching provider dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleResendVerification = useCallback(async () => {
    setResendingVerify(true);
    try {
      await api.post('/auth/resend-verification');
      toast({
        title: 'Verification email sent',
        description: 'Check your inbox and click the link to verify your account.',
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: 'Could not resend',
        description: err.response?.data?.error || 'Try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      setResendingVerify(false);
    }
  }, []);

  const todayAppointments = useMemo(() => {
    const today = new Date().toDateString();
    return upcomingAppointments.filter((appointment) =>
      new Date(appointment.scheduledAt).toDateString() === today
    );
  }, [upcomingAppointments]);

  const completedToday = useMemo(() => {
    const today = new Date().toDateString();
    return recentVisits.filter((visit) =>
      new Date(visit.createdAt).toDateString() === today
    );
  }, [recentVisits]);

  const nextVideoAppointments = useMemo(() => (
    upcomingAppointments
      .filter((appointment) => ['video', 'telemedicine'].includes(appointment.type))
      .slice(0, 4)
  ), [upcomingAppointments]);

  const unsignedNotes = useMemo(
    () => recentVisits.filter((visit) => !visit.isSigned),
    [recentVisits]
  );

  const operationalChecklist = useMemo(() => {
    const items = [];

    if (!user?.isVerified) {
      items.push({
        id: 'verify-email',
        title: 'Verify your email',
        description: 'Full provider access is unlocked after email verification.',
        actionLabel: 'Resend email',
        actionHref: null,
        action: handleResendVerification,
        tone: 'amber',
      });
    }

    if (user?.providerStatus && user.providerStatus !== 'approved') {
      items.push({
        id: 'credential-review',
        title: isNigeriaMarket ? 'Licensure review in progress' : 'Credential review in progress',
        description: isNigeriaMarket
          ? 'Your Nigeria provider profile is pending operational approval.'
          : 'Your provider profile is pending operational approval.',
        actionLabel: 'Open profile',
        actionHref: providerPath('/profile'),
        tone: 'blue',
      });
    }

    if (unsignedNotes.length > 0) {
      items.push({
        id: 'unsigned-notes',
        title: `${unsignedNotes.length} unsigned note${unsignedNotes.length === 1 ? '' : 's'}`,
        description: 'Complete documentation and signatures for recent visits.',
        actionLabel: 'Review notes',
        actionHref: providerPath('/visits'),
        tone: 'rose',
      });
    }

    if (todayAppointments.length > 0) {
      items.push({
        id: 'today-schedule',
        title: `${todayAppointments.length} appointment${todayAppointments.length === 1 ? '' : 's'} today`,
        description: 'Review your schedule and prep the next consultation.',
        actionLabel: 'View schedule',
        actionHref: providerPath('/schedule'),
        tone: 'emerald',
      });
    }

    if (items.length === 0) {
      items.push({
        id: 'all-clear',
        title: 'Operationally clear',
        description: isNigeriaMarket
          ? 'No Nigeria provider-side blockers are currently flagged.'
          : 'No provider-side blockers are currently flagged.',
        actionLabel: 'Open profile',
        actionHref: providerPath('/profile'),
        tone: 'emerald',
      });
    }

    return items.slice(0, 4);
  }, [handleResendVerification, isNigeriaMarket, providerPath, todayAppointments.length, unsignedNotes.length, user?.isVerified, user?.providerStatus]);

  const providerDisplayName = useMemo(() => {
    const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();

    if (isNigeriaMarket) {
      return fullName || user?.email || 'Provider';
    }

    return `Dr. ${user?.lastName || user?.firstName || 'Provider'}`;
  }, [isNigeriaMarket, user?.email, user?.firstName, user?.lastName]);

  const providerStatusLabel = user?.providerStatus
    ? user.providerStatus.charAt(0).toUpperCase() + user.providerStatus.slice(1)
    : 'Unspecified';

  return (
    <div className="space-y-6">
      {!user?.isVerified && !verifyBannerDismissed && (
        <div className="flex items-center gap-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 rounded-2xl px-5 py-4">
          <div className="bg-amber-100 dark:bg-amber-900/60 p-2 rounded-full flex-shrink-0">
            <Mail className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Verify your email to complete your provider account</p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">We sent a link to <strong>{user?.email}</strong>. Click it to activate full access.</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="border-amber-400 text-amber-700 hover:bg-amber-100 dark:border-amber-600 dark:text-amber-300 dark:hover:bg-amber-900/40 text-xs"
              onClick={handleResendVerification}
              disabled={resendingVerify}
            >
              {resendingVerify ? 'Sending...' : 'Resend email'}
            </Button>
            <button
              onClick={() => setVerifyBannerDismissed(true)}
              className="text-amber-500 hover:text-amber-700 dark:hover:text-amber-300 p-1 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-serif text-foreground">
            {getGreeting()}, {providerDisplayName}
          </h1>
          <p className="text-muted-foreground mt-1">
            {todayAppointments.length > 0
              ? `You have ${todayAppointments.length} appointment${todayAppointments.length === 1 ? '' : 's'} today`
              : isNigeriaMarket
                ? 'Your Nigeria clinical workspace is ready for consultations, referrals, and prescription routing.'
                : 'Your provider workspace is ready for the next consultation.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isNigeriaMarket ? (
            <>
              <Link href={providerPath('/call')}>
                <Button className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-lg shadow-emerald-500/25">
                  <Phone className="w-4 h-4 mr-2" />
                  Instant Call
                </Button>
              </Link>
              <Link href={providerPath('/prescriptions')}>
                <Button variant="outline" className="border-emerald-500 text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950">
                  <Pill className="w-4 h-4 mr-2" />
                  Prescription Activity
                </Button>
              </Link>
              <Link href={providerPath('/referrals')}>
                <Button variant="outline">
                  <Share2 className="w-4 h-4 mr-2" />
                  Care Referrals
                </Button>
              </Link>
            </>
          ) : (
            <>
              <Link href={providerPath('/call')}>
                <Button className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-lg shadow-emerald-500/25">
                  <Phone className="w-4 h-4 mr-2" />
                  Instant Call
                </Button>
              </Link>
              <Link href={providerPath('/schedule')}>
                <Button variant="outline" className="border-purple-500 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950">
                  <Calendar className="w-4 h-4 mr-2" />
                  View Schedule
                </Button>
              </Link>
              <Link href={providerPath('/patients?action=new')}>
                <Button variant="outline">
                  <UserPlus className="w-4 h-4 mr-2" />
                  Add Patient
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: "Today's Patients", value: todayAppointments.length, icon: Calendar, accent: 'text-blue-600 bg-blue-100 dark:bg-blue-950' },
          { label: 'Completed Today', value: completedToday.length, icon: CheckCircle2, accent: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-950' },
          { label: 'Video Queue', value: nextVideoAppointments.length, icon: Video, accent: 'text-violet-600 bg-violet-100 dark:bg-violet-950' },
          { label: 'Unsigned Notes', value: unsignedNotes.length, icon: ClipboardList, accent: 'text-rose-600 bg-rose-100 dark:bg-rose-950' },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className="text-3xl font-bold mt-1 text-foreground">{stat.value}</p>
                </div>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${stat.accent}`}>
                  <stat.icon className="w-6 h-6" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid xl:grid-cols-2 gap-6">
        <Card className="border-2 border-emerald-500/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Video className="w-5 h-5 text-emerald-500" />
              Video Visit Readiness
            </CardTitle>
            <CardDescription>Upcoming telemedicine sessions using the live provider call flow</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((item) => (
                  <div key={item} className="h-16 rounded-xl bg-muted animate-pulse" />
                ))}
              </div>
            ) : nextVideoAppointments.length === 0 ? (
              <div className="text-center py-10">
                <Video className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground">No video consultations queued</p>
                <p className="text-sm text-muted-foreground/70 mt-1">Instant call remains available from this portal when needed.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {nextVideoAppointments.map((appointment) => (
                  <div key={appointment.id} className="p-4 rounded-xl border hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div>
                        <p className="font-semibold text-foreground">
                          {appointment.patientFirstName} {appointment.patientLastName}
                        </p>
                        <p className="text-sm text-muted-foreground">{appointment.reasonForVisit || 'General consultation'}</p>
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDateTime(appointment.scheduledAt)}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Link href={providerPath(`/appointments/${appointment.id}/visit`)}>
                          <Button variant="outline" size="sm">Prep Visit</Button>
                        </Link>
                        <Link href={providerPath(`/appointments/${appointment.id}/call`)}>
                          <Button size="sm" className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700">
                            Join Call
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-2 border-amber-500/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-500" />
              Operational Checklist
            </CardTitle>
            <CardDescription>Live account and documentation follow-up items</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {operationalChecklist.map((item) => (
              <div key={item.id} className="p-4 rounded-xl border">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-foreground">{item.title}</p>
                    <p className="text-sm text-muted-foreground mt-1">{item.description}</p>
                  </div>
                  {item.actionHref ? (
                    <Link href={item.actionHref}>
                      <Button size="sm" variant="outline">{item.actionLabel}</Button>
                    </Link>
                  ) : (
                    <Button size="sm" variant="outline" onClick={item.action} disabled={resendingVerify}>
                      {resendingVerify ? 'Sending...' : item.actionLabel}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-500" />
              Recent Visit Notes
            </CardTitle>
            <CardDescription>Your latest clinical documentation</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((item) => (
                  <div key={item} className="h-16 rounded-xl bg-muted animate-pulse" />
                ))}
              </div>
            ) : recentVisits.length === 0 ? (
              <div className="text-center py-10">
                <FileText className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground">No recent visit notes</p>
                <Link href={providerPath('/visits')}>
                  <Button variant="outline" size="sm" className="mt-4">Open Visit Notes</Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {recentVisits.slice(0, 4).map((visit) => {
                  const visitHref = visit.appointmentId
                    ? providerPath(`/appointments/${visit.appointmentId}/visit`)
                    : providerPath('/visits');
                  return (
                    <Link key={visit.id} href={visitHref}>
                      <div className="p-4 rounded-xl border hover:border-blue-300 dark:hover:border-blue-700 hover:bg-accent/50 transition-all cursor-pointer">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="font-medium text-foreground">
                              {visit.patientFirstName} {visit.patientLastName}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">{formatDateTime(visit.createdAt)}</p>
                          </div>
                          <span className={`px-2 py-1 text-xs rounded-full ${visit.isSigned ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'}`}>
                            {visit.isSigned ? 'Signed' : 'Draft'}
                          </span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-violet-500" />
              Provider Status
            </CardTitle>
            <CardDescription>
              {isNigeriaMarket
                ? 'Account readiness for Nigeria clinical operations'
                : 'Production account readiness for clinical operations'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="p-4 rounded-xl border">
              <p className="text-sm text-muted-foreground">Approval status</p>
              <p className="text-lg font-semibold text-foreground mt-1">{providerStatusLabel}</p>
            </div>
            <div className="p-4 rounded-xl border">
              <p className="text-sm text-muted-foreground">Email verification</p>
              <p className="text-lg font-semibold text-foreground mt-1">{user?.isVerified ? 'Verified' : 'Pending'}</p>
            </div>
            <div className="p-4 rounded-xl border">
              <p className="text-sm text-muted-foreground">Primary specialty</p>
              <p className="text-lg font-semibold text-foreground mt-1">{user?.providerInfo?.specialty || 'Not set'}</p>
            </div>
            <Link href={providerPath('/profile')}>
              <Button variant="outline" className="w-full">Manage Profile</Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Calendar className="w-5 h-5 text-purple-500" />
            Upcoming Schedule
          </CardTitle>
          <CardDescription>Your next provider appointments</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-32 rounded-xl bg-muted animate-pulse" />
          ) : upcomingAppointments.length === 0 ? (
            <div className="text-center py-12 px-4">
              <Calendar className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">No upcoming appointments</p>
              <p className="text-sm text-muted-foreground/70 mt-1 mb-6">Set your availability or prepare for new patient intake.</p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Link href={providerPath('/schedule')}>
                  <Button>Open Availability</Button>
                </Link>
                <Link href={providerPath('/patients?action=new')}>
                  <Button variant="outline">Add Patient</Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {upcomingAppointments.map((appointment) => (
                <div
                  key={appointment.id}
                  onClick={() => router.push(providerPath(`/appointments/${appointment.id}/visit`))}
                  className="p-4 rounded-xl border hover:border-purple-300 dark:hover:border-purple-700 hover:bg-accent/50 transition-all cursor-pointer"
                >
                  <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                    <div className="flex-1">
                      <h3 className="font-semibold text-foreground">
                        {appointment.patientFirstName} {appointment.patientLastName}
                      </h3>
                      <p className="text-sm text-muted-foreground">{appointment.reasonForVisit || 'General consultation'}</p>
                    </div>
                    <div className="text-sm text-muted-foreground">{formatDateTime(appointment.scheduledAt)}</div>
                    <div className="flex gap-2" onClick={(event) => event.stopPropagation()}>
                      <Link href={providerPath(`/appointments/${appointment.id}/visit`)}>
                        <Button variant="outline" size="sm">Open Visit</Button>
                      </Link>
                      {['video', 'telemedicine'].includes(appointment.type) && (
                        <Link href={providerPath(`/appointments/${appointment.id}/call`)}>
                          <Button size="sm" className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700">
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
