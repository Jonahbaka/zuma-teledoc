'use client';

import { useState, useEffect } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Save, Send, User, Calendar, Clock,
  FileText, Activity, Stethoscope, ClipboardList,   Brain,
  Loader2, CheckCircle2, AlertTriangle, AlertCircle,
  Video, Sparkles, ChevronDown, ChevronUp, Users, Server, Pill
} from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import AISoapAssist from '@/components/provider/AISoapAssist';
import EPrescribe from '@/components/provider/ePrescribe';
import { insuranceAPI, pharmacyAPI, rtbcAPI, triageAPI } from '@/lib/api';
import { toProviderPortalPath } from '@/lib/providerPortal';

export default function ProviderVisitPage() {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const appointmentId = params.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [appointment, setAppointment] = useState(null);
  const [visit, setVisit] = useState(null);
  const [patientInsurance, setPatientInsurance] = useState(null);
  const [preferredPharmacy, setPreferredPharmacy] = useState(null);

  // SOAP Notes state
  const [subjective, setSubjective] = useState('');
  const [objective, setObjective] = useState('');
  const [assessment, setAssessment] = useState('');
  const [plan, setPlan] = useState('');

  // Vitals
  const [vitals, setVitals] = useState({
    bloodPressureSystolic: '',
    bloodPressureDiastolic: '',
    heartRate: '',
    temperature: '',
    respiratoryRate: '',
    oxygenSaturation: '',
    weight: '',
    height: ''
  });

  // ICD/CPT codes
  const [icdCodes, setIcdCodes] = useState([]);
  const [cptCodes, setCptCodes] = useState([]);
  const [followUpRequired, setFollowUpRequired] = useState(false);
  const [followUpNotes, setFollowUpNotes] = useState('');
  const [triageUpdateTime, setTriageUpdateTime] = useState(null);

  useEffect(() => {
    fetchAppointmentAndVisit();
  }, [appointmentId]);

  // Auto-refresh triage data every 3 seconds to get instant updates
  useEffect(() => {
    if (!appointmentId) return;
    
    const fetchTriageData = async () => {
      try {
        const triageRes = await api.get(`/triage/appointment/${appointmentId}`).catch(() => ({ data: { triage: null } }));
        
        if (triageRes.data?.success && triageRes.data.triage) {
          // Only update if triage data has changed (check timestamp or symptoms)
          setAppointment(prev => {
            if (!prev) return prev;
            
            const newTriage = triageRes.data.triage;
            const currentTriage = prev.triageData;
            
            // Check if triage data is new or updated
            const isNew = !currentTriage;
            const isUpdated = currentTriage && (
              (newTriage.timestamp && currentTriage.timestamp !== newTriage.timestamp) ||
              (newTriage.symptoms && currentTriage.symptoms !== newTriage.symptoms)
            );
            
            if (isNew || isUpdated) {
              // Show notification for new triage data
              if (isUpdated) {
                setTriageUpdateTime(new Date());
                toast({
                  title: 'New Triage Data Received',
                  description: 'Patient has submitted updated symptom assessment',
                  variant: 'default'
                });
              }
              
              return {
                ...prev,
                triageData: newTriage
              };
            }
            
            return prev;
          });
        } else {
          // Also check appointment metadata for triage updates
          setAppointment(prev => {
            if (!prev?.metadata?.triage) return prev;
            
            const metadataTriage = prev.metadata.triage;
            const currentTriage = prev.triageData;
            
            if (!currentTriage || 
                (metadataTriage.timestamp && currentTriage.timestamp !== metadataTriage.timestamp)) {
              setTriageUpdateTime(new Date());
              return {
                ...prev,
                triageData: metadataTriage
              };
            }
            
            return prev;
          });
        }
      } catch (error) {
        // Silently handle polling errors
      }
    };
    
    // Poll every 3 seconds for new triage data
    const triagePollInterval = setInterval(fetchTriageData, 3000);
    
    // Also fetch immediately
    fetchTriageData();
    
    return () => clearInterval(triagePollInterval);
  }, [appointmentId, appointment?.triageData?.timestamp]);

  const fetchPatientInsuranceForPatient = async (patientId) => {
    try {
      if (!patientId) return;
      const walletRes = await insuranceAPI.getPatientWallet(patientId);
      if (walletRes?.data?.success && walletRes.data.wallet?.length > 0) {
        const primary = walletRes.data.wallet.find(i => i.is_primary) || walletRes.data.wallet[0];
        if (primary?.id) {
          const insuranceDetail = await insuranceAPI.getPatientInsuranceById(
            patientId,
            primary.id,
            'visit_preparation',
            false
          );
          if (insuranceDetail?.data?.success) {
            setPatientInsurance(insuranceDetail.data.insurance);
          }
        }
      }
    } catch (error) {
      console.warn('Could not fetch patient insurance wallet:', error);
    }
  };

  const fetchPreferredPharmacyForPatient = async (patientId) => {
    try {
      if (!patientId) return;
      const res = await pharmacyAPI.getPreferences(patientId);
      if (res.data?.success) {
        const prefs = res.data.pharmacies || [];
        const pref = prefs.find(p => p.isPreferred) || prefs.find(p => p.is_preferred) || null;
        setPreferredPharmacy(pref);
      }
    } catch (e) {
      // Optional
    }
  };

  const fetchAppointmentAndVisit = async () => {
    try {
      const [aptRes, visitRes, triageRes] = await Promise.all([
        api.get(`/appointments/${appointmentId}`),
        api.get(`/visits/appointment/${appointmentId}`).catch(() => ({ data: { visit: null } })),
        api.get(`/triage/appointment/${appointmentId}`).catch(() => ({ data: { triage: null } }))
      ]);

      if (aptRes.data.success) {
        const appointmentData = aptRes.data.appointment;
        // Add triage data if available
        if (triageRes.data?.success && triageRes.data.triage) {
          appointmentData.triageData = triageRes.data.triage;
        }
        // Also check metadata for triage
        if (appointmentData.metadata?.triage) {
          appointmentData.triageData = appointmentData.metadata.triage;
        }
        setAppointment(appointmentData);
        // Load patient-linked artifacts for provider: insurance + preferred pharmacy
        fetchPatientInsuranceForPatient(appointmentData.patientId || appointmentData.patient_id);
        fetchPreferredPharmacyForPatient(appointmentData.patientId || appointmentData.patient_id);
      }

      if (visitRes.data?.visit) {
        const v = visitRes.data.visit;
        setVisit(v);
        setSubjective(v.subjective || '');
        setObjective(v.objective || '');
        setAssessment(v.assessment || '');
        setPlan(v.plan || '');
        if (v.vitals) setVitals(v.vitals);
        if (v.icdCodes) setIcdCodes(v.icdCodes);
        if (v.cptCodes) setCptCodes(v.cptCodes);
        setFollowUpRequired(v.followUpRequired || false);
        setFollowUpNotes(v.followUpNotes || '');
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

  const handleSave = async (sign = false) => {
    setSaving(true);
    try {
      const visitData = {
        appointmentId,
        subjective,
        objective,
        assessment,
        plan,
        vitals,
        icdCodes,
        cptCodes,
        followUpRequired,
        followUpNotes
      };

      let response;
      if (visit?.id) {
        response = await api.put(`/visits/${visit.id}`, visitData);
      } else {
        response = await api.post('/visits', visitData);
      }

      if (response.data.success) {
        setVisit(response.data.visit);

        if (sign) {
          await api.post(`/visits/${response.data.visit.id}/sign`);
          toast({ title: 'Visit note signed and saved' });
          router.push(toProviderPortalPath('/dashboard', { pathname }));
        } else {
          toast({ title: 'Draft saved successfully' });
        }
      }
    } catch (error) {
      toast({
        title: 'Save Failed',
        description: error.response?.data?.error || 'Failed to save visit note',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleApplyAISuggestion = (field, value) => {
    switch (field) {
      case 'subjective':
        setSubjective(value);
        break;
      case 'objective':
        setObjective(value);
        break;
      case 'assessment':
        setAssessment(value);
        break;
      case 'plan':
        setPlan(value);
        break;
    }
  };

  const handleVitalChange = (field, value) => {
    setVitals(prev => ({ ...prev, [field]: value }));
  };

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
        <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-slate-900">Appointment Not Found</h2>
        <Link href={toProviderPortalPath('/dashboard', { pathname })}>
          <Button variant="link" className="mt-4">Return to Dashboard</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href={toProviderPortalPath('/dashboard', { pathname })}>
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-bold text-slate-900">Visit Documentation</h1>
                <p className="text-sm text-slate-500">
                  {appointment.patientFirstName} {appointment.patientLastName}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={() => handleSave(false)}
                disabled={saving}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                Save Draft
              </Button>
              <Button
                onClick={() => handleSave(true)}
                disabled={saving}
                className="bg-gradient-to-r from-blue-500 to-indigo-600"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                Sign & Complete
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-12 gap-6 h-[calc(100vh-80px)]">
          {/* Patient Sidebar */}
          <div className="col-span-3 bg-white rounded-3xl shadow-sm border border-gray-100 p-6 flex flex-col h-full">
            <div className="flex items-center space-x-4 border-b border-gray-100 pb-6 mb-6">
              <div className="h-12 w-12 bg-purple-100 rounded-full flex items-center justify-center text-purple-700 font-bold text-lg">
                {appointment.patientFirstName?.[0]}{appointment.patientLastName?.[0]}
              </div>
              <div>
                <h3 className="font-bold text-gray-900">
                  {appointment.patientFirstName} {appointment.patientLastName}
                </h3>
                <p className="text-xs text-gray-500">
                  {appointment.patientDob ? new Date(appointment.patientDob).toLocaleDateString() : appointment.scheduledAt ? new Date(appointment.scheduledAt).toLocaleDateString() : ''}
                </p>
              </div>
            </div>

            <div className="space-y-6 overflow-y-auto flex-1">
              {/* Contact Info */}
              <div>
                <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-2">Contact</p>
                <p className="text-sm text-gray-700">{appointment.patientEmail || 'N/A'}</p>
                <p className="text-sm text-gray-700">{appointment.patientPhone || 'N/A'}</p>
              </div>

              {/* Payer Status */}
              <div>
                <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-2">Payer Status</p>
                {patientInsurance ? (
                  <div className="bg-green-50 p-3 rounded-lg border border-green-100">
                    <div className="flex items-center text-green-800 text-sm font-bold mb-1">
                      <CheckCircle2 size={14} className="mr-1" />
                      {patientInsurance.insurance_provider}
                    </div>
                    <div className="text-xs text-green-600 flex items-center">
                      <Server size={10} className="mr-1" />
                      Verified: Change Healthcare RTE
                    </div>
                  </div>
                ) : (
                  <div className="bg-red-50 p-3 rounded-lg border border-red-100 text-red-700 text-sm flex items-center">
                    <AlertCircle size={14} className="mr-2" />
                    No active insurance
                  </div>
                )}
              </div>

              {/* Preferred Pharmacy */}
              <div>
                <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-2">Preferred Pharmacy</p>
                {preferredPharmacy ? (
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <div className="text-slate-900 text-sm font-bold mb-1">
                      {preferredPharmacy.pharmacyName || preferredPharmacy.pharmacy_name || preferredPharmacy.name || 'Pharmacy'}
                    </div>
                    <div className="text-xs text-slate-600">
                      {preferredPharmacy.pharmacyAddress || preferredPharmacy.pharmacy_address || preferredPharmacy.address || ''}
                    </div>
                  </div>
                ) : (
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-slate-700 text-sm flex items-center">
                    <AlertCircle size={14} className="mr-2" />
                    No preferred pharmacy selected
                  </div>
                )}
              </div>

              {/* AI Assessment (Triage) */}
              {appointment.triageData && (
                <div>
                  <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-2 flex items-center justify-between">
                    <span className="flex items-center">
                      <Sparkles size={12} className="mr-1 text-purple-500" />
                      AI Assessment
                    </span>
                    {triageUpdateTime && (
                      <span className="text-[10px] text-green-600 font-normal animate-pulse">
                        Just updated
                      </span>
                    )}
                  </p>
                  <div className={`p-3 rounded-lg border text-sm ${
                    appointment.triageData.severity >= 4 
                      ? 'bg-red-50 border-red-100 text-red-900' 
                      : 'bg-gray-50 border-gray-100'
                  }`}>
                    <p className="font-bold mb-1">{appointment.triageData.suggestedSpecialty}</p>
                    <p className="text-xs opacity-90 line-clamp-4">
                      {appointment.triageData.soapDraft?.split('ASSESSMENT:')[1]?.split('PLAN:')[0] || 
                       appointment.triageData.soapDraft?.split('\n\n')[1] || 
                       appointment.triageData.assessment || 'No assessment details'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Main Content Area */}
          <div className="col-span-9 space-y-6 overflow-y-auto">
            {/* Chief Complaint */}
            {appointment.reasonForVisit && (
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-slate-600">
                    <strong>Chief Complaint:</strong> {appointment.reasonForVisit}
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Vitals */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="w-5 h-5 text-red-500" />
                  Vital Signs
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-4 gap-4">
                <div>
                  <Label className="text-xs">BP Systolic</Label>
                  <Input
                    type="number"
                    placeholder="120"
                    value={vitals.bloodPressureSystolic}
                    onChange={(e) => handleVitalChange('bloodPressureSystolic', e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">BP Diastolic</Label>
                  <Input
                    type="number"
                    placeholder="80"
                    value={vitals.bloodPressureDiastolic}
                    onChange={(e) => handleVitalChange('bloodPressureDiastolic', e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Heart Rate</Label>
                  <Input
                    type="number"
                    placeholder="72"
                    value={vitals.heartRate}
                    onChange={(e) => handleVitalChange('heartRate', e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Temp (°F)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="98.6"
                    value={vitals.temperature}
                    onChange={(e) => handleVitalChange('temperature', e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Resp Rate</Label>
                  <Input
                    type="number"
                    placeholder="16"
                    value={vitals.respiratoryRate}
                    onChange={(e) => handleVitalChange('respiratoryRate', e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">O2 Sat (%)</Label>
                  <Input
                    type="number"
                    placeholder="98"
                    value={vitals.oxygenSaturation}
                    onChange={(e) => handleVitalChange('oxygenSaturation', e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Weight (lbs)</Label>
                  <Input
                    type="number"
                    placeholder="150"
                    value={vitals.weight}
                    onChange={(e) => handleVitalChange('weight', e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Height (in)</Label>
                  <Input
                    type="number"
                    placeholder="68"
                    value={vitals.height}
                    onChange={(e) => handleVitalChange('height', e.target.value)}
                    className="mt-1"
                  />
                </div>
              </CardContent>
            </Card>

            {/* SOAP Notes */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-500" />
                  SOAP Note
                </CardTitle>
                <CardDescription>
                  Document your clinical findings using the AI assist panel on the right
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Subjective */}
                <div>
                  <Label className="flex items-center gap-2 text-sm font-medium">
                    <span className="w-6 h-6 rounded bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">S</span>
                    Subjective
                  </Label>
                  <textarea
                    value={subjective}
                    onChange={(e) => setSubjective(e.target.value)}
                    placeholder="Patient's history, symptoms, and complaints..."
                    className="w-full mt-2 p-3 border border-slate-200 rounded-lg min-h-[100px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* Objective */}
                <div>
                  <Label className="flex items-center gap-2 text-sm font-medium">
                    <span className="w-6 h-6 rounded bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">O</span>
                    Objective
                  </Label>
                  <textarea
                    value={objective}
                    onChange={(e) => setObjective(e.target.value)}
                    placeholder="Physical examination findings, test results..."
                    className="w-full mt-2 p-3 border border-slate-200 rounded-lg min-h-[100px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* Assessment */}
                <div>
                  <Label className="flex items-center gap-2 text-sm font-medium">
                    <span className="w-6 h-6 rounded bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold">A</span>
                    Assessment
                  </Label>
                  <textarea
                    value={assessment}
                    onChange={(e) => setAssessment(e.target.value)}
                    placeholder="Clinical impression, diagnoses..."
                    className="w-full mt-2 p-3 border border-slate-200 rounded-lg min-h-[100px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* Plan */}
                <div>
                  <Label className="flex items-center gap-2 text-sm font-medium">
                    <span className="w-6 h-6 rounded bg-orange-100 text-orange-700 flex items-center justify-center text-xs font-bold">P</span>
                    Plan
                  </Label>
                  <textarea
                    value={plan}
                    onChange={(e) => setPlan(e.target.value)}
                    placeholder="Treatment plan, medications, follow-up..."
                    className="w-full mt-2 p-3 border border-slate-200 rounded-lg min-h-[100px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Insurance Verification */}
            {patientInsurance && (
              <Card className="border-l-4 border-l-green-500">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                    Insurance Verification
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="p-3 bg-green-50 rounded-lg border border-green-100">
                    <div className="flex items-center text-green-800 text-sm font-bold mb-1">
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      {patientInsurance.insurance_provider}
                    </div>
                    <div className="text-xs text-green-600 flex items-center mt-1">
                      <Server className="w-3 h-3 mr-1" />
                      Verified: Change Healthcare RTE
                    </div>
                    {patientInsurance.eligibility_response?.coverageDetails && (
                      <div className="mt-3 text-xs text-green-700">
                        <p>Copay: ${patientInsurance.eligibility_response.coverageDetails.copay?.primaryCare || 'N/A'}</p>
                        <p>Deductible: ${patientInsurance.eligibility_response.coverageDetails.deductibleMet || 0} / ${patientInsurance.eligibility_response.coverageDetails.deductibleTotal || 0}</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ePrescribe with AI Suggestions */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">ePrescribe</CardTitle>
                <CardDescription>Medication Search & Real-Time Benefit Check</CardDescription>
              </CardHeader>
              <CardContent>
                <EPrescribe
                  patientId={appointment?.patientId}
                  visitId={visit?.id}
                  appointmentId={appointmentId}
                  aiSuggestions={appointment?.triageData?.suggestedMeds || []}
                  hasGoldCard={false}
                />
              </CardContent>
            </Card>

            {/* Follow-up */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-amber-500" />
                  Follow-up
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3 mb-4">
                  <input
                    type="checkbox"
                    id="followUp"
                    checked={followUpRequired}
                    onChange={(e) => setFollowUpRequired(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <Label htmlFor="followUp">Follow-up required</Label>
                </div>
                {followUpRequired && (
                  <textarea
                    value={followUpNotes}
                    onChange={(e) => setFollowUpNotes(e.target.value)}
                    placeholder="Follow-up instructions and timeline..."
                    className="w-full p-3 border border-slate-200 rounded-lg min-h-[80px]"
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

