'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  BrainCircuit, AlertTriangle, CheckCircle, Clock, User, Sparkles, 
  Pill, Activity, Zap, ArrowRight, ChevronRight, Thermometer,
  TrendingUp, FileText, Eye
} from 'lucide-react';
import { appointmentsAPI, triageAPI } from '@/lib/api';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/components/providers/AuthProvider';

export default function ProviderTriageDashboard() {
  const auth = useAuth();
  const user = auth?.user || null;
  const router = useRouter();
  const [triageCases, setTriageCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCase, setSelectedCase] = useState(null);
  const [stats, setStats] = useState({
    total: 0,
    urgent: 0,
    routine: 0,
    avgSeverity: 0
  });

  useEffect(() => {
    // Safely fetch triage cases
    try {
      fetchTriageCases();
      // Refresh every 30 seconds
      const interval = setInterval(() => {
        try {
          fetchTriageCases();
        } catch (intervalError) {
          // Silently fail - don't break the interval
        }
      }, 30000);
      return () => {
        try {
          clearInterval(interval);
        } catch {
          // Silently fail
        }
      };
    } catch (effectError) {
      // Silently fail - set loading to false
      setLoading(false);
    }
  }, []);

  const fetchTriageCases = async () => {
    try {
      const response = await api.get('/triage/provider/appointments');
      if (response?.data?.success) {
        const cases = response.data.appointments || [];
        
        // Safely set triage cases
        try {
          setTriageCases(cases);
        } catch (setError) {
          // Silently fail - don't break UI
        }
        
        // Calculate stats safely
        try {
          const urgent = cases.filter(c => {
            try {
              return c?.triageData?.triageLevel === 'URGENT' || (c?.triageData?.severity >= 4);
            } catch {
              return false;
            }
          }).length;
          const routine = cases.length - urgent;
          const totalSeverity = cases.reduce((sum, c) => {
            try {
              return sum + (c?.triageData?.severity || 0);
            } catch {
              return sum;
            }
          }, 0);
          
          setStats({
            total: cases.length,
            urgent,
            routine,
            avgSeverity: cases.length > 0 ? (totalSeverity / cases.length).toFixed(1) : 0
          });
        } catch (statsError) {
          // Set default stats if calculation fails
          setStats({
            total: cases.length,
            urgent: 0,
            routine: 0,
            avgSeverity: 0
          });
        }
      } else {
        setTriageCases([]);
        setStats({ total: 0, urgent: 0, routine: 0, avgSeverity: 0 });
      }
    } catch (error) {
      // Production-safe error handling - don't log to console in production
      // Silently handle errors
      try {
        setTriageCases([]);
        setStats({ total: 0, urgent: 0, routine: 0, avgSeverity: 0 });
      } catch (setError) {
        // Silently fail - UI will show empty state
      }
    } finally {
      // Always reset loading state
      try {
        setLoading(false);
      } catch (loadingError) {
        // Silently fail
      }
    }
  };

  const getSeverityColor = (severity) => {
    if (severity >= 4) return 'red';
    if (severity >= 3) return 'yellow';
    return 'green';
  };

  const getSeverityBgColor = (severity) => {
    if (severity >= 4) return 'bg-red-50 border-red-200';
    if (severity >= 3) return 'bg-yellow-50 border-yellow-200';
    return 'bg-green-50 border-green-200';
  };

  const getSeverityTextColor = (severity) => {
    if (severity >= 4) return 'text-red-800';
    if (severity >= 3) return 'text-yellow-800';
    return 'text-green-800';
  };

  const handleOpenVisit = (appointmentId) => {
    router.push(`/provider/appointments/${appointmentId}/visit`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl">
              <BrainCircuit className="w-6 h-6 text-white" />
            </div>
            AI Triage Dashboard
          </h1>
          <p className="text-slate-500 mt-1">Review patient triage assessments and prioritize care</p>
        </div>
        <Button 
          onClick={fetchTriageCases}
          variant="outline"
          className="flex items-center gap-2"
        >
          <Activity className="w-4 h-4" />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 font-medium">Total Cases</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{stats.total}</p>
              </div>
              <div className="p-3 bg-purple-100 rounded-lg">
                <FileText className="w-5 h-5 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 font-medium">Urgent</p>
                <p className="text-2xl font-bold text-red-600 mt-1">{stats.urgent}</p>
              </div>
              <div className="p-3 bg-red-100 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 font-medium">Routine</p>
                <p className="text-2xl font-bold text-blue-600 mt-1">{stats.routine}</p>
              </div>
              <div className="p-3 bg-blue-100 rounded-lg">
                <CheckCircle className="w-5 h-5 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 font-medium">Avg Severity</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{stats.avgSeverity}/5</p>
              </div>
              <div className="p-3 bg-yellow-100 rounded-lg">
                <Thermometer className="w-5 h-5 text-yellow-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Triage Cases */}
      {triageCases.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <div className="max-w-md mx-auto">
              <div className="p-4 bg-purple-100 rounded-full w-20 h-20 mx-auto mb-4 flex items-center justify-center">
                <BrainCircuit className="w-10 h-10 text-purple-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">No Triage Cases</h3>
              <p className="text-gray-500 mb-4">
                Patients will appear here after completing AI symptom checker in their portal
              </p>
              <p className="text-sm text-gray-400">
                The AI triage system analyzes patient symptoms and provides clinical assessments to help prioritize care
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Triage Cases List */}
          <div className="lg:col-span-2 space-y-4">
            {triageCases.map((triageCase) => {
              const triage = triageCase.triageData || {};
              const severity = triage.severity || 0;
              
              return (
                <Card
                  key={triageCase.id}
                  className={`cursor-pointer hover:shadow-lg transition-all border-l-4 ${
                    selectedCase?.id === triageCase.id 
                      ? 'ring-2 ring-purple-500 border-l-purple-600' 
                      : severity >= 4 
                        ? 'border-l-red-500' 
                        : severity >= 3
                        ? 'border-l-yellow-500'
                        : 'border-l-green-500'
                  }`}
                  onClick={() => setSelectedCase(triageCase)}
                >
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-4 flex-1">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-400 to-indigo-500 flex items-center justify-center text-white text-lg font-bold shadow-md">
                          {triageCase.patientFirstName?.[0]}{triageCase.patientLastName?.[0]}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-bold text-lg text-gray-900">
                              {triageCase.patientFirstName} {triageCase.patientLastName}
                            </h3>
                            {triage.suggestedSpecialty && (
                              <Badge variant="outline" className="text-xs">
                                {triage.suggestedSpecialty}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 mb-1">
                            {triageCase.reasonForVisit || 'No reason provided'}
                          </p>
                          <div className="flex items-center gap-3 text-xs text-gray-400">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {new Date(triageCase.scheduledAt).toLocaleDateString()} at {new Date(triageCase.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        {triage.triageLevel === 'URGENT' ? (
                          <Badge className="bg-red-100 text-red-700 border-red-200 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            URGENT
                          </Badge>
                        ) : (
                          <Badge className="bg-blue-100 text-blue-700 border-blue-200">
                            ROUTINE
                          </Badge>
                        )}
                        <Badge className={`${getSeverityBgColor(severity)} ${getSeverityTextColor(severity)} border`}>
                          Severity: {severity}/5
                        </Badge>
                      </div>
                    </div>

                    {/* Clinical Flags */}
                    {triage.flags && triage.flags.length > 0 && (
                      <div className="mb-4 p-3 bg-red-50 rounded-lg border border-red-200">
                        <p className="text-xs text-red-900 font-bold mb-2 flex items-center gap-1">
                          <AlertTriangle className="w-4 h-4" />
                          Clinical Flags
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {triage.flags.map((flag, idx) => (
                            <Badge key={idx} variant="destructive" className="text-xs">
                              {flag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Suggested Medications */}
                    {triage.suggestedMeds && triage.suggestedMeds.length > 0 && (
                      <div className="mb-4">
                        <p className="text-xs text-gray-500 uppercase font-bold mb-2 flex items-center gap-1">
                          <Zap className="w-3 h-3 text-amber-500 fill-amber-500" />
                          AI Suggested Medications
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {triage.suggestedMeds.map((med, idx) => (
                            <Badge 
                              key={idx} 
                              className="bg-gradient-to-r from-indigo-100 to-purple-100 text-indigo-800 border border-indigo-200"
                            >
                              <Pill className="w-3 h-3 mr-1" />
                              {med}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Assessment Preview */}
                    {triage.soapDraft && (
                      <div className="mt-4 pt-4 border-t border-gray-100">
                        <p className="text-xs text-gray-500 uppercase font-bold mb-2">Assessment Preview</p>
                        <p className="text-sm text-gray-700 line-clamp-2">
                          {triage.soapDraft.split('\n\n')[1] || triage.soapDraft.substring(0, 150)}...
                        </p>
                      </div>
                    )}

                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenVisit(triageCase.id);
                        }}
                        className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700"
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        Open Visit Note
                        <ChevronRight className="w-4 h-4 ml-2" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Selected Case Details Sidebar */}
          <div className="lg:col-span-1">
            {selectedCase ? (
              <Card className="sticky top-20">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-purple-500" />
                    Triage Assessment
                  </CardTitle>
                  <CardDescription>
                    {selectedCase.patientFirstName} {selectedCase.patientLastName}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Severity & Urgency */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className={`p-3 rounded-lg border ${getSeverityBgColor(selectedCase.triageData?.severity || 0)}`}>
                      <p className="text-xs text-gray-600 uppercase font-bold mb-1">Severity</p>
                      <p className={`text-3xl font-bold ${getSeverityTextColor(selectedCase.triageData?.severity || 0)}`}>
                        {selectedCase.triageData?.severity || 0}/5
                      </p>
                    </div>
                    <div className="p-3 rounded-lg border bg-gray-50">
                      <p className="text-xs text-gray-600 uppercase font-bold mb-1">Urgency</p>
                      {selectedCase.triageData?.triageLevel === 'URGENT' ? (
                        <Badge className="bg-red-100 text-red-700 mt-2">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          URGENT
                        </Badge>
                      ) : (
                        <Badge className="bg-blue-100 text-blue-700 mt-2">
                          ROUTINE
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Specialty */}
                  {selectedCase.triageData?.suggestedSpecialty && (
                    <div>
                      <p className="text-xs text-gray-600 uppercase font-bold mb-2">Recommended Specialty</p>
                      <Badge className="text-sm" variant="outline">
                        {selectedCase.triageData.suggestedSpecialty}
                      </Badge>
                    </div>
                  )}

                  {/* SOAP Draft */}
                  {selectedCase.triageData?.soapDraft && (
                    <div>
                      <p className="text-xs text-gray-600 uppercase font-bold mb-2">Full Assessment</p>
                      <div className="p-4 bg-gradient-to-br from-purple-50 to-indigo-50 rounded-lg border border-purple-200">
                        <pre className="text-sm text-purple-900 whitespace-pre-wrap font-mono">
                          {selectedCase.triageData.soapDraft}
                        </pre>
                      </div>
                    </div>
                  )}

                  {/* Clinical Flags */}
                  {selectedCase.triageData?.flags && selectedCase.triageData.flags.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-600 uppercase font-bold mb-2">Clinical Flags</p>
                      <div className="flex flex-wrap gap-2">
                        {selectedCase.triageData.flags.map((flag, idx) => (
                          <Badge key={idx} variant="destructive">
                            {flag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Suggested Medications */}
                  {selectedCase.triageData?.suggestedMeds && selectedCase.triageData.suggestedMeds.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-600 uppercase font-bold mb-2 flex items-center gap-1">
                        <Zap className="w-3 h-3 text-amber-500 fill-amber-500" />
                        AI Suggested Medications
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {selectedCase.triageData.suggestedMeds.map((med, idx) => (
                          <Badge 
                            key={idx}
                            className="bg-gradient-to-r from-indigo-100 to-purple-100 text-indigo-800"
                          >
                            <Pill className="w-3 h-3 mr-1" />
                            {med}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="space-y-2 pt-4 border-t">
                    <Button
                      onClick={() => handleOpenVisit(selectedCase.id)}
                      className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700"
                    >
                      <Eye className="w-4 h-4 mr-2" />
                      Open Visit Note
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => router.push(`/provider/appointments/${selectedCase.id}`)}
                    >
                      <FileText className="w-4 h-4 mr-2" />
                      View Appointment
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <div className="p-3 bg-purple-100 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                    <Sparkles className="w-8 h-8 text-purple-600" />
                  </div>
                  <p className="text-sm font-medium text-gray-900 mb-1">Select a Case</p>
                  <p className="text-xs text-gray-500">Click on a triage case to view detailed assessment</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
