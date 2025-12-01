'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  User, Calendar, FileText, ArrowLeft, Loader2, 
  Phone, Mail, Calendar as CalendarIcon, Heart
} from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';

export default function PatientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const patientId = params.id;

  const [loading, setLoading] = useState(true);
  const [patient, setPatient] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [visits, setVisits] = useState([]);

  useEffect(() => {
    fetchPatientData();
  }, [patientId]);

  const fetchPatientData = async () => {
    try {
      const [patientRes, appointmentsRes, visitsRes] = await Promise.all([
        api.get(`/users/${patientId}`).catch(() => ({ data: { success: false } })),
        api.get('/appointments', { params: { patientId } }).catch(() => ({ data: { success: false } })),
        api.get(`/visits/patient/${patientId}`).catch(() => ({ data: { success: false } }))
      ]);

      if (patientRes.data.success) {
        setPatient(patientRes.data.user);
      }
      if (appointmentsRes.data.success) {
        setAppointments(appointmentsRes.data.appointments || []);
      }
      if (visitsRes.data.success) {
        setVisits(visitsRes.data.visits || []);
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load patient data',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-500">Patient not found</p>
        <Link href="/provider/patients">
          <Button variant="link" className="mt-4">Back to Patients</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/provider/patients">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {patient.firstName} {patient.lastName}
          </h1>
          <p className="text-slate-500">Patient Profile</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <Card>
            <CardContent className="p-6">
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center text-white text-2xl font-bold mx-auto mb-4">
                  {patient.firstName?.[0]}{patient.lastName?.[0]}
                </div>
                <h3 className="text-lg font-semibold text-slate-900">
                  {patient.firstName} {patient.lastName}
                </h3>
                <p className="text-sm text-slate-500">{patient.email}</p>
                {patient.phone && (
                  <p className="text-sm text-slate-500 mt-1">{patient.phone}</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5" />
                Recent Appointments
              </CardTitle>
            </CardHeader>
            <CardContent>
              {appointments.length === 0 ? (
                <p className="text-slate-500">No appointments yet</p>
              ) : (
                <div className="space-y-3">
                  {appointments.slice(0, 5).map((apt) => (
                    <Link key={apt.id} href={`/provider/appointments/${apt.id}/visit`}>
                      <div className="p-3 border rounded-lg hover:bg-slate-50 cursor-pointer">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{formatDateTime(apt.scheduledAt)}</p>
                            <p className="text-sm text-slate-500">{apt.reasonForVisit || 'No reason specified'}</p>
                          </div>
                          <span className="text-xs px-2 py-1 bg-slate-100 rounded-full capitalize">
                            {apt.status}
                          </span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Visit History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {visits.length === 0 ? (
                <p className="text-slate-500">No visits yet</p>
              ) : (
                <div className="space-y-3">
                  {visits.slice(0, 5).map((visit) => (
                    <div key={visit.id} className="p-3 border rounded-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{formatDateTime(visit.createdAt)}</p>
                          {visit.isSigned && (
                            <span className="text-xs text-emerald-600">Signed</span>
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
      </div>
    </div>
  );
}



