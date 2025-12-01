'use client';

import { useState, useEffect } from 'react';
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
  const router = useRouter();
  const { user } = useAuth();
  const appointmentId = params.id;

  const [loading, setLoading] = useState(true);
  const [appointment, setAppointment] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState(null);
  const [processingPayment, setProcessingPayment] = useState(false);

  useEffect(() => {
    fetchAppointment();
    fetchPaymentStatus();
  }, [appointmentId]);

  const fetchPaymentStatus = async () => {
    try {
      const response = await paymentsAPI.getAppointmentPayment(appointmentId);
      if (response.data.success) {
        setPaymentStatus(response.data);
      }
    } catch (error) {
      console.error('Failed to fetch payment status:', error);
    }
  };

  const fetchAppointment = async () => {
    try {
      const response = await api.get(`/appointments/${appointmentId}`);
      if (response.data.success) {
        setAppointment(response.data.appointment);
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load appointment details',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePayment = async () => {
    if (!user) {
      toast({
        title: 'Authentication Required',
        description: 'Please log in to continue',
        variant: 'destructive'
      });
      return;
    }

    // Check if user has paid access level
    if (!['gold_monthly', 'gold_yearly', 'pay_per_visit', 'insurance'].includes(user.accessLevel)) {
      toast({
        title: 'Subscription Required',
        description: 'Please subscribe or select pay-per-visit to book consultations',
        variant: 'destructive'
      });
      router.push('/patient/subscription');
      return;
    }

    setProcessingPayment(true);
    try {
      const response = await paymentsAPI.payPerVisit({ appointmentId });
      if (response.data.success) {
        toast({
          title: 'Success',
          description: 'Payment processed successfully!',
          variant: 'success'
        });
        await fetchPaymentStatus();
        await fetchAppointment();
      }
    } catch (error) {
      toast({
        title: 'Payment Failed',
        description: error.response?.data?.error || 'Failed to process payment',
        variant: 'destructive'
      });
    } finally {
      setProcessingPayment(false);
    }
  };

  const handleCancel = async () => {
    if (!confirm('Are you sure you want to cancel this appointment?')) return;

    try {
      const response = await api.put(`/appointments/${appointmentId}`, {
        status: 'cancelled',
        cancellationReason: 'Cancelled by patient'
      });

      if (response.data.success) {
        toast({ title: 'Appointment cancelled successfully' });
        router.push('/patient/appointments');
      }
    } catch (error) {
      toast({
        title: 'Cancel Failed',
        description: error.response?.data?.error || 'Failed to cancel appointment',
        variant: 'destructive'
      });
    }
  };

  // Waiting room functionality removed - will be re-implemented

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
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
                <Calendar className="w-5 h-5 text-purple-500" />
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
                    appointment.status === 'confirmed' ? 'bg-purple-100 text-purple-700' :
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
                <User className="w-5 h-5 text-purple-500" />
                Provider Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-xl font-bold">
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
                {paymentStatus?.paymentCompleted ? (
                  <Link href={`/patient/appointments/${appointmentId}/call`}>
                    <Button className="w-full bg-gradient-to-r from-purple-600 to-purple-800 hover:from-purple-700 hover:to-purple-900 text-white">
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
                    <Button
                      className="w-full"
                      onClick={handlePayment}
                      disabled={processingPayment}
                    >
                      {processingPayment ? 'Processing...' : 'Pay $79 to Join'}
                    </Button>
                  </div>
                ) : (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <p className="text-sm text-blue-800">
                      Checking payment status...
                    </p>
                  </div>
                )}
                {paymentStatus?.paymentCompleted && (
                  <p className="text-xs text-slate-500 text-center">
                    Payment completed. You can now access your video appointment.
                  </p>
                )}
              </CardContent>
            </Card>
          )}


          {appointment.status !== 'cancelled' && appointment.status !== 'completed' && (
            <Card>
              <CardContent className="p-4">
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={handleCancel}
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

