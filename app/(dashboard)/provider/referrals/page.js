'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Building2,
  Loader2,
  Search,
  Send,
  Share2,
  Users,
} from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/use-toast';

export default function SmartReferralsPage() {
  const [patients, setPatients] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [selectedOrganizationId, setSelectedOrganizationId] = useState('');
  const [reasonForReferral, setReasonForReferral] = useState('');
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [patientsRes, orgsRes] = await Promise.all([
          api.get('/providers/me/patients').catch(() => ({ data: { success: false, patients: [] } })),
          api.get('/interop/organizations').catch(() => ({ data: { success: false, organizations: [] } })),
        ]);

        if (patientsRes.data.success) {
          setPatients(patientsRes.data.patients || []);
        }

        if (orgsRes.data.success) {
          setOrganizations(orgsRes.data.organizations || []);
        }
      } catch (error) {
        console.error('Failed to load referrals data:', error);
        toast({
          title: 'Unable to load referrals workspace',
          description: 'Try again in a moment.',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const filteredPatients = useMemo(() => patients.filter((patient) => {
    if (!searchTerm) return true;
    const query = searchTerm.toLowerCase();
    return `${patient.firstName || ''} ${patient.lastName || ''}`.toLowerCase().includes(query)
      || (patient.email || '').toLowerCase().includes(query);
  }), [patients, searchTerm]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!selectedPatientId || !selectedOrganizationId || !reasonForReferral.trim()) {
      toast({
        title: 'Missing referral details',
        description: 'Select a patient, destination organization, and referral reason.',
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);

    try {
      const response = await api.post('/interop/referrals', {
        patientId: selectedPatientId,
        destinationOrganizationId: selectedOrganizationId,
        specialty: 'General Referral',
        urgency: 'routine',
        reasonForReferral,
        clinicalNotes,
        includeHistory: true,
        includeMedications: true,
        includeVitals: true,
      });

      if (response.data.success) {
        toast({
          title: 'Referral dispatched',
          description: 'The referral bundle was created successfully.',
        });
        setSelectedPatientId('');
        setSelectedOrganizationId('');
        setReasonForReferral('');
        setClinicalNotes('');
      }
    } catch (error) {
      toast({
        title: 'Referral failed',
        description: error.response?.data?.error || 'The referral could not be submitted.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-12 w-12 animate-spin text-purple-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Share2 className="h-7 w-7 text-purple-500" />
          Smart Referrals
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Dispatch referrals only through connected partner organizations. No demo organizations or fake patient records are shown here.
        </p>
      </div>

      <Card className="border-amber-200 bg-amber-50/60 dark:bg-amber-950/20">
        <CardContent className="p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
          <div>
            <p className="font-medium text-amber-900 dark:text-amber-100">Production note</p>
            <p className="text-sm text-amber-800 dark:text-amber-200 mt-1">
              Connected destination organizations must be provisioned by operations before providers can self-dispatch referrals from this workspace.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-500" />
              Provider Patients
            </CardTitle>
            <CardDescription>Select a real patient from your appointment history.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search patients..."
                className="pl-9"
              />
            </div>

            {filteredPatients.length === 0 ? (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                No patients available for referral yet.
              </div>
            ) : (
              <div className="space-y-3">
                {filteredPatients.map((patient) => (
                  <button
                    key={patient.id}
                    type="button"
                    onClick={() => setSelectedPatientId(patient.id)}
                    className={`w-full rounded-xl border p-4 text-left transition-colors ${
                      selectedPatientId === patient.id
                        ? 'border-purple-500 bg-purple-50 dark:bg-purple-950/20'
                        : 'hover:border-purple-300'
                    }`}
                  >
                    <p className="font-medium text-foreground">{patient.firstName} {patient.lastName}</p>
                    <p className="text-sm text-muted-foreground">{patient.email || 'No email on file'}</p>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-emerald-500" />
              Dispatch Referral
            </CardTitle>
            <CardDescription>Only live connected organizations can receive a referral bundle.</CardDescription>
          </CardHeader>
          <CardContent>
            {organizations.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                No connected organizations are currently available to this provider account.
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <select
                  value={selectedOrganizationId}
                  onChange={(e) => setSelectedOrganizationId(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 bg-background"
                >
                  <option value="">Select destination organization</option>
                  {organizations.map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {organization.name}
                    </option>
                  ))}
                </select>

                <Input
                  value={reasonForReferral}
                  onChange={(e) => setReasonForReferral(e.target.value)}
                  placeholder="Reason for referral"
                />

                <textarea
                  value={clinicalNotes}
                  onChange={(e) => setClinicalNotes(e.target.value)}
                  placeholder="Clinical notes"
                  rows={5}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                />

                <Button type="submit" disabled={submitting} className="w-full">
                  <Send className="w-4 h-4 mr-2" />
                  {submitting ? 'Submitting...' : 'Submit Referral'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
