'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Calendar, Clock, User, Video, FileText,
  Loader2, AlertCircle, CheckCircle2, X, MapPin
} from 'lucide-react';
import api, { paymentsAPI } from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime, formatTime } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';

export default function AppointmentDetailPage() {
  const params = useParams();
  const { user, loading } = useAuth();
  const appointmentId = typeof params.id === 'string' ? params.id : null;
  const accountKey = !loading && user?.id && user.role === 'patient' && appointmentId
    ? JSON.stringify([user.id, user.role, user.marketScope || user.market_scope || '', appointmentId]) : null;
  const session = useRef(accountKey);
  // This render-time boundary invalidates old callbacks before effect cleanup.
  session.current = accountKey;
  if (!accountKey) return <p role="status">{loading ? 'Loading appointment access…' : 'Sign in as a patient to view this appointment.'}</p>;
  return <AppointmentDetailWorkspace key={accountKey} session={session} accountKey={accountKey} appointmentId={appointmentId} user={user} />;
}

export function AppointmentDetailWorkspace({ session, accountKey, appointmentId, user }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [appointment, setAppointment] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState(null);
  const [processingCancel, setProcessingCancel] = useState(false);
  const [paymentError, setPaymentError] = useState(false);
  const mounted = useRef(true);
  const readVersion = useRef(0);
  const action = useRef(null);
  const current = () => mounted.current && session.current === accountKey;

  async function loadDetails() {
    const version = ++readVersion.current;
    const result = await Promise.allSettled([
      api.get(`/appointments/${appointmentId}`),
      paymentsAPI.getAppointmentPayment(appointmentId),
    ]);
    if (!current() || version !== readVersion.current) return;
    const [details, payment] = result;
    if (details.status === 'fulfilled' && details.value.data?.success && details.value.data.appointment?.id === appointmentId) {
      setAppointment(details.value.data.appointment);
    } else {
      setAppointment(null);
      toast({ title: 'Error', description: 'Failed to load appointment details', variant: 'destructive' });
    }
    if (payment.status === 'fulfilled' && payment.value.data?.success) {
      setPaymentStatus(payment.value.data); setPaymentError(false);
    } else { setPaymentStatus(null); setPaymentError(true); }
    setLoading(false);
  }

  useEffect(() => {
    mounted.current = true;
    loadDetails();
    return () => { mounted.current = false; readVersion.current += 1; };
    // Workspace is keyed by account, role, market and appointment ID.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = async () => {
    if (!current() || action.current || !appointment || !['scheduled', 'confirmed'].includes(appointment.status)) return;
    const operation = {}; action.current = operation;
    if (!confirm('Are you sure you want to cancel this appointment?')) { action.current = null; return; }
    if (!current()) { action.current = null; return; }
    readVersion.current += 1; setProcessingCancel(true);
    try {
      const response = await api.put(`/appointments/${appointmentId}`, { status: 'cancelled', cancellationReason: 'Cancelled by patient' });
      if (!current()) return;
      if (!response.data?.success || response.data.appointment?.id !== appointmentId || response.data.appointment.status !== 'cancelled') throw new Error('Cancellation was not confirmed. Refresh the appointment before retrying.');
      setAppointment(response.data.appointment);
      toast({ title: 'Appointment cancelled successfully' });
      router.push('/patient/appointments');
    } catch (error) {
      if (current()) toast({ title: 'Cancel Failed', description: error.response?.data?.error || error.message || 'Failed to cancel appointment', variant: 'destructive' });
    } finally {
      if (action.current === operation) action.current = null;
      if (current()) setProcessingCancel(false);
    }
  };

  // Waiting room functionality removed - will be re-implemented

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!appointment) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-slate-900">Appointment Not Found</h2>
        <Link href="/patient/appointments">
          <Button variant="link" className="mt-4">Back to Appointments</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/patient/appointments">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Appointment Details</h1>
          <p className="text-slate-500">View and manage your appointment</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-blue-500" />
                Appointment Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-slate-500">Date & Time</p>
                  <p className="font-semibold text-slate-900">
                    {formatDateTime(appointment.scheduledAt)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-500">Duration</p>
                  <p className="font-semibold text-slate-900">
                    {appointment.durationMinutes || 30} minutes
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-500">Type</p>
                  <p className="font-semibold text-slate-900 capitalize">
                    {appointment.type === 'video' && (
                      <span className="flex items-center gap-1">
                        <Video className="w-4 h-4" />
                        Video Call
                      </span>
                    )}
                    {appointment.type === 'phone' && 'Phone Call'}
                    {appointment.type === 'in_person' && 'In Person'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-500">Status</p>
                  <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${appointment.status === 'scheduled' ? 'bg-blue-100 text-blue-700' :
                    appointment.status === 'confirmed' ? 'bg-blue-100 text-blue-700' :
                      appointment.status === 'completed' ? 'bg-slate-100 text-slate-700' :
                        appointment.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                          'bg-amber-100 text-amber-700'
                    }`}>
                    {appointment.status.charAt(0).toUpperCase() + appointment.status.slice(1).replace('_', ' ')}
                  </span>
                </div>
              </div>

              {appointment.reasonForVisit && (
                <div>
                  <p className="text-sm text-slate-500 mb-1">Reason for Visit</p>
                  <p className="text-slate-900">{appointment.reasonForVisit}</p>
                </div>
              )}

              {appointment.patientNotes && (
                <div>
                  <p className="text-sm text-slate-500 mb-1">Your Notes</p>
                  <p className="text-slate-900 whitespace-pre-wrap">{appointment.patientNotes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5 text-blue-500" />
                Provider Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-400 to-blue-500 flex items-center justify-center text-white text-xl font-bold">
                  {appointment.providerFirstName?.[0]}{appointment.providerLastName?.[0]}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    Dr. {appointment.providerFirstName} {appointment.providerLastName}
                  </h3>
                  <p className="text-slate-600">{appointment.providerSpecialty || 'General Practice'}</p>
                  {appointment.providerCredentials && (
                    <p className="text-sm text-slate-500">{appointment.providerCredentials}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {appointment.type === 'video' && appointment.status !== 'cancelled' && appointment.status !== 'completed' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Video Appointment</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(paymentStatus?.paymentCompleted || paymentStatus?.coverageApproved) ? (
                  <Link href={`/patient/appointments/${appointmentId}/call`}>
                    <Button className="w-full bg-gradient-to-r from-blue-600 to-blue-800 hover:from-blue-700 hover:to-blue-900 text-white">
                      <Video className="w-4 h-4 mr-2" />
                      Join Video Call
                    </Button>
                  </Link>
                ) : paymentStatus?.paymentRequired ? (
                  <div className="space-y-3">
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                      <p className="text-sm text-yellow-800 font-semibold mb-1">Payment Required</p>
                      <p className="text-xs text-yellow-700">
                        Complete payment to access your video appointment
                      </p>
                    </div>
                    <p role="status" className="text-sm text-slate-700">
                      Direct payment collection is unavailable on this page. No payment is collected here. Contact support to confirm the approved payment route.
                    </p>
                  </div>
                ) : (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <p className="text-sm text-blue-800">
                      {paymentError ? 'Payment status unavailable. Refresh this page to check again.' : 'Checking payment status...'}
                    </p>
                  </div>
                )}
                {(paymentStatus?.paymentCompleted || paymentStatus?.coverageApproved) && (
                  <p className="text-xs text-slate-500 text-center">
                    {paymentStatus.testingBypassActive && paymentStatus.coverageApproved
                      ? 'Authorized testing access. This is not a payment receipt.'
                      : paymentStatus.paymentCompleted
                        ? 'Payment completed. You can now access your video appointment.'
                        : 'Coverage approved for this appointment. This does not mean a visit payment was collected.'}
                  </p>
                )}
              </CardContent>
            </Card>
          )}


          {['scheduled', 'confirmed'].includes(appointment.status) && (
            <Card>
              <CardContent className="p-4">
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={handleCancel}
                  disabled={processingCancel}
                >
                  <X className="w-4 h-4 mr-2" />
                  Cancel Appointment
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div >
    </div >
  );
}

