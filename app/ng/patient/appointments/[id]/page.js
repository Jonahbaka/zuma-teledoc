'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  FileText,
  Loader2,
  MapPin,
  User,
  Video,
  X,
} from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';
import { formatDateTime } from '@/lib/utils';

const activeStatuses = ['scheduled', 'confirmed', 'pharmacy_reviewing', 'provider_reviewing'];

const getStatusTone = (status) => {
  const value = String(status || '').toLowerCase();
  if (value === 'confirmed') return 'bg-emerald-100 text-emerald-800';
  if (value === 'scheduled') return 'bg-blue-100 text-blue-800';
  if (value === 'completed') return 'bg-slate-100 text-slate-800';
  if (value === 'cancelled') return 'bg-red-100 text-red-800';
  return 'bg-amber-100 text-amber-800';
};

export default function NigeriaAppointmentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const appointmentId = params.id;

  const [loading, setLoading] = useState(true);
  const [appointment, setAppointment] = useState(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    const fetchAppointment = async () => {
      setLoading(true);
      try {
        const response = await api.get(`/appointments/${appointmentId}`);
        if (response.data?.success) {
          setAppointment(response.data.appointment);
        } else {
          setAppointment(null);
        }
      } catch (error) {
        toast({
          title: 'Unable to load consultation',
          description: error.response?.data?.error || 'Please try again or contact the care team.',
          variant: 'destructive',
        });
        setAppointment(null);
      } finally {
        setLoading(false);
      }
    };

    if (appointmentId) {
      fetchAppointment();
    }
  }, [appointmentId]);

  const handleCancel = async () => {
    if (!confirm('Are you sure you want to cancel this consultation?')) return;

    setCancelling(true);
    try {
      const response = await api.put(`/appointments/${appointmentId}`, {
        status: 'cancelled',
        cancellationReason: 'Cancelled by patient',
      });

      if (response.data?.success) {
        toast({ title: 'Consultation cancelled' });
        router.push('/ng/patient/appointments');
      }
    } catch (error) {
      toast({
        title: 'Cancel failed',
        description: error.response?.data?.error || 'Unable to cancel this consultation.',
        variant: 'destructive',
      });
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (!appointment) {
    return (
      <div className="mx-auto max-w-xl rounded-3xl border border-border bg-card p-8 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-amber-500" />
        <h1 className="mt-4 text-xl font-semibold text-foreground">Consultation not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We could not load this consultation. Open your appointments or contact the care team for help.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Link href="/ng/patient/appointments">
            <Button variant="outline">Back to Appointments</Button>
          </Link>
          <Link href="/ng/patient/messages">
            <Button className="bg-emerald-600 text-white hover:bg-emerald-500">Contact Care Team</Button>
          </Link>
        </div>
      </div>
    );
  }

  const status = String(appointment.status || 'scheduled').toLowerCase();
  const canJoinVideo = appointment.type === 'video' && activeStatuses.includes(status);
  const canCancel = !['cancelled', 'completed'].includes(status);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Link href="/ng/patient/appointments">
            <Button variant="ghost" size="icon" aria-label="Back to appointments">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Patient Portal</p>
            <h1 className="mt-2 text-2xl font-bold text-foreground">Consultation Details</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Review your visit, provider, video access, and care instructions.
            </p>
          </div>
        </div>
        <span className={`w-fit rounded-full px-3 py-1 text-sm font-semibold capitalize ${getStatusTone(status)}`}>
          {status.replace(/_/g, ' ')}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="border-border/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-emerald-600" />
                Consultation Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-sm text-muted-foreground">Date and time</p>
                  <p className="font-semibold text-foreground">{formatDateTime(appointment.scheduledAt)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Duration</p>
                  <p className="font-semibold text-foreground">{appointment.durationMinutes || 30} minutes</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Type</p>
                  <p className="inline-flex items-center gap-2 font-semibold capitalize text-foreground">
                    {appointment.type === 'video' ? <Video className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
                    {appointment.type === 'video' ? 'Video consultation' : appointment.type || 'Consultation'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <p className="font-semibold capitalize text-foreground">{status.replace(/_/g, ' ')}</p>
                </div>
              </div>

              {appointment.reasonForVisit ? (
                <div>
                  <p className="text-sm text-muted-foreground">Reason for visit</p>
                  <p className="mt-1 text-sm leading-6 text-foreground">{appointment.reasonForVisit}</p>
                </div>
              ) : null}

              {appointment.patientNotes ? (
                <div>
                  <p className="text-sm text-muted-foreground">Your notes</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground">{appointment.patientNotes}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5 text-emerald-600" />
                Provider
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-700 text-xl font-bold text-white">
                  {appointment.providerFirstName?.[0] || 'D'}{appointment.providerLastName?.[0] || 'R'}
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-foreground">
                    Dr. {appointment.providerFirstName} {appointment.providerLastName}
                  </h2>
                  <p className="text-sm text-muted-foreground">{appointment.providerSpecialty || 'Consultation provider'}</p>
                  {appointment.providerCredentials ? (
                    <p className="mt-1 text-xs text-muted-foreground">{appointment.providerCredentials}</p>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="border-border/70">
            <CardHeader>
              <CardTitle className="text-base">Video Visit</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {canJoinVideo ? (
                <>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Join when your provider is ready. Your browser will ask for camera and microphone permission.
                  </p>
                  <Link href={`/ng/patient/appointments/${appointmentId}/call`} className="block">
                    <Button className="w-full bg-emerald-600 text-white hover:bg-emerald-500">
                      <Video className="mr-2 h-4 w-4" />
                      Join Video Visit
                    </Button>
                  </Link>
                </>
              ) : (
                <p className="text-sm leading-6 text-muted-foreground">
                  Video access appears when this consultation is scheduled and active.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardHeader>
              <CardTitle className="text-base">Payment and Coverage</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm leading-6 text-muted-foreground">
                Nigeria consultation fee and any HMO or organisation coverage are handled through DoctaRx Nigeria confirmation flows.
              </p>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                <CheckCircle2 className="mr-2 inline h-4 w-4" />
                Nigeria-specific payment confirmation is used for this visit.
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardHeader>
              <CardTitle className="text-base">Need Help?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link href="/ng/patient/messages" className="block">
                <Button variant="outline" className="w-full">
                  <FileText className="mr-2 h-4 w-4" />
                  Contact Care Team
                </Button>
              </Link>
              {canCancel ? (
                <Button
                  variant="outline"
                  className="w-full border-red-200 text-red-700 hover:bg-red-50"
                  onClick={handleCancel}
                  disabled={cancelling}
                >
                  {cancelling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <X className="mr-2 h-4 w-4" />}
                  Cancel Consultation
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
