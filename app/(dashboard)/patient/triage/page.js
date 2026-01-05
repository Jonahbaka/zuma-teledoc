'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { BrainCircuit, CheckCircle, AlertTriangle, Loader2, Send, Sparkles, Pill, Calendar, History, MapPin } from 'lucide-react';
import { appointmentsAPI, triageAPI } from '@/lib/api';
import { DoctaService } from '@/lib/doctaService';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/components/providers/AuthProvider';

export default function PatientTriagePage() {
  const { user } = useAuth();
  const [symptoms, setSymptoms] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [triageResult, setTriageResult] = useState(null);
  const [upcomingAppointment, setUpcomingAppointment] = useState(null);
  const [loadingAppointment, setLoadingAppointment] = useState(true);

  // Verify user is a patient before allowing triage submission
  useEffect(() => {
    if (user && user.role !== 'patient') {
      console.warn('[TRIAGE] User role mismatch:', {
        expected: 'patient',
        actual: user.role,
        userId: user.id
      });
    }
  }, [user]);

  // Fetch upcoming appointment on mount
  useEffect(() => {
    const fetchUpcomingAppointment = async () => {
      try {
        const res = await appointmentsAPI.getUpcoming(1);
        if (res.data.success && res.data.appointments.length > 0) {
          setUpcomingAppointment(res.data.appointments[0]);
        }
      } catch (error) {
        console.error('Error fetching upcoming appointment:', error);
      } finally {
        setLoadingAppointment(false);
      }
    };
    fetchUpcomingAppointment();
  }, []);

  const handleTriage = async () => {
    if (!symptoms.trim()) {
      toast({
        title: 'Error',
        description: 'Please describe your symptoms',
        variant: 'destructive'
      });
      return;
    }

    setIsProcessing(true);
    try {
      // 1. Run AI Analysis
      const result = await DoctaService.runAITriage(symptoms);
      
      if (!result) {
        throw new Error('AI triage returned no result');
      }
      
      // Add safe defaults if AI misses fields
      const safeResult = {
        severity: result.severity || 1,
        soapDraft: result.soapDraft || 'No assessment generated',
        triageLevel: result.triageLevel || 'ROUTINE',
        suggestedSpecialty: result.suggestedSpecialty || 'Primary Care',
        flags: result.flags || [],
        suggestedMeds: result.suggestedMeds || []
      };
      
      // Store result in state immediately
      setTriageResult(safeResult);
      
      // 2. CRITICAL: Save to Database
      if (upcomingAppointment?.id) {
        console.log('Transmitting to provider for appointment:', upcomingAppointment.id);
        
        try {
          const saveRes = await triageAPI.store(
            upcomingAppointment.id,
            symptoms,
            safeResult
          );
          
          if (!saveRes?.data?.success) {
            throw new Error(saveRes?.data?.error || 'Failed to save triage');
          }
          
          // Successfully saved
          const providerName = upcomingAppointment?.providerFirstName && upcomingAppointment?.providerLastName
            ? `Dr. ${upcomingAppointment.providerFirstName} ${upcomingAppointment.providerLastName}`
            : 'your provider';
          
          toast({
            title: 'AI Assessment Complete',
            description: `Results sent to ${providerName}`,
            variant: 'default'
          });
        } catch (saveError) {
          const errorStatus = saveError?.response?.status;
          const errorData = saveError?.response?.data;
          const errorMsg = errorData?.error || errorData?.message || saveError?.message || 'Unable to save';
          
          toast({
            title: 'Transmission Failed',
            description: `Analysis complete, but could not send to provider: ${errorMsg}`,
            variant: 'destructive'
          });
        }
      } else {
        // 3. Handle Missing Appointment Case
        console.warn('Analysis run, but no appointment ID found to attach data to.');
        toast({
          title: 'Analysis Complete',
          description: 'Analysis complete, but we could not send this to your provider (No upcoming appointment found).',
          variant: 'destructive'
        });
      }
      
    } catch (error) {
      console.error('Triage failed:', error);
      toast({
        title: 'Error',
        description: error?.message || 'Failed to process triage. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <BrainCircuit className="w-6 h-6 text-purple-500" />
            AI Symptom Checker
          </h1>
          <p className="text-muted-foreground mt-1">Powered by Med-Gemini</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/patient/pharmacy">
            <Button variant="outline" size="sm">
              <MapPin className="w-4 h-4 mr-2" />
              My Pharmacies
            </Button>
          </Link>
          <Link href="/patient/triage/history">
            <Button variant="outline" size="sm">
              <History className="w-4 h-4 mr-2" />
              View History
            </Button>
          </Link>
        </div>
      </div>

      {/* Appointment Info Banner */}
      {upcomingAppointment && (
        <Card className="border-l-4 border-l-purple-600 bg-purple-50/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Calendar className="w-5 h-5 text-purple-600" />
              <div className="flex-1">
                <p className="text-sm font-medium text-purple-900">
                  Triage will be sent to: <span className="font-bold">Dr. {upcomingAppointment.providerFirstName} {upcomingAppointment.providerLastName}</span>
                </p>
                <p className="text-xs text-purple-700 mt-1">
                  Appointment scheduled for {new Date(upcomingAppointment.scheduledAt).toLocaleString()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!upcomingAppointment && !loadingAppointment && (
        <Card className="border-l-4 border-l-yellow-500 bg-yellow-50/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-600" />
              <div className="flex-1">
                <p className="text-sm font-medium text-yellow-900">
                  No upcoming appointment found
                </p>
                <p className="text-xs text-yellow-700 mt-1">
                  Please schedule an appointment first to submit triage results to your provider
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Describe Your Symptoms</CardTitle>
            <CardDescription>Be as detailed as possible for better assessment</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <textarea
              className="w-full border border-gray-200 bg-gray-50 rounded-xl p-4 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 h-40 resize-none"
              placeholder="Describe symptoms (e.g. Swelling ankles, foamy urine, fatigue)..."
              value={symptoms}
              onChange={(e) => setSymptoms(e.target.value)}
            />
            <Button
              onClick={handleTriage}
              disabled={!symptoms.trim() || isProcessing}
              className="w-full bg-gradient-to-r from-purple-600 to-purple-800"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Analyzing...
                </>
              ) : (
                <>
                  <BrainCircuit className="w-4 h-4 mr-2" />
                  Run AI Analysis
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {triageResult ? (
          <Card className="border-l-4 border-l-purple-600">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-500" />
                Assessment Result
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                  triageResult.severity >= 4
                    ? 'bg-red-100 text-red-800'
                    : triageResult.severity >= 3
                    ? 'bg-yellow-100 text-yellow-800'
                    : 'bg-green-100 text-green-800'
                }`}>
                  Severity: {triageResult.severity}/5
                </span>
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-800">
                  {triageResult.triageLevel}
                </span>
              </div>

              <div className="p-4 bg-purple-50 rounded-xl">
                <pre className="text-sm text-purple-900 whitespace-pre-wrap font-mono">
                  {triageResult.soapDraft}
                </pre>
              </div>

              {triageResult.suggestedMeds?.length > 0 && (
                <div className="pt-4 border-t border-purple-100">
                  <p className="text-xs text-gray-500 uppercase font-bold mb-2 flex items-center">
                    <Pill className="w-3 h-3 mr-1" />
                    AI Suggested Treatments (For Provider)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {triageResult.suggestedMeds.map((med) => (
                      <span
                        key={med}
                        className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-sm font-medium"
                      >
                        {med}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {triageResult.flags?.length > 0 && (
                <div className="pt-4 border-t border-red-100">
                  <div className="flex items-start gap-2 p-3 bg-red-50 rounded-lg">
                    <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5" />
                    <div>
                      <p className="text-sm font-bold text-red-900">Clinical Flags</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {triageResult.flags.map((flag) => (
                          <span
                            key={flag}
                            className="px-2 py-1 bg-red-100 text-red-800 rounded text-xs font-bold"
                          >
                            {flag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <BrainCircuit className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">Analysis results will appear here</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

