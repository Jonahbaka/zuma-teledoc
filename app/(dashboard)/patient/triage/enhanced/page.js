'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  BrainCircuit, AlertTriangle, Loader2, Sparkles, Pill, MapPin,
  ChevronRight, Heart, Thermometer, Activity, Clock, CheckCircle,
  Navigation, Search, Star, Phone, Building, AlertCircle, ArrowRight,
  Stethoscope, FileText
} from 'lucide-react';
import { triageQueueAPI, pharmacyAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/components/providers/AuthProvider';

// Triage level colors
const TRIAGE_COLORS = {
  EMERGENT: 'bg-red-100 text-red-800 border-red-300',
  URGENT: 'bg-orange-100 text-orange-800 border-orange-300',
  SEMI_URGENT: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  ROUTINE: 'bg-green-100 text-green-800 border-green-300',
  NON_URGENT: 'bg-blue-100 text-blue-800 border-blue-300'
};

export default function EnhancedTriagePage() {
  const { user } = useAuth();
  const router = useRouter();
  
  // Multi-step form state
  const [step, setStep] = useState(1);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Step 1: Symptoms
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [symptoms, setSymptoms] = useState('');
  const [symptomDuration, setSymptomDuration] = useState('');
  const [symptomSeverity, setSymptomSeverity] = useState(5);
  
  // Step 2: Vitals (optional)
  const [vitals, setVitals] = useState({
    temperature: '',
    heartRate: '',
    systolic: '',
    diastolic: '',
    respiratoryRate: '',
    oxygenSaturation: '',
    painLevel: ''
  });
  
  // Step 3: Results
  const [analysis, setAnalysis] = useState(null);
  
  // Step 4: Pharmacy
  const [pharmacies, setPharmacies] = useState([]);
  const [selectedPharmacy, setSelectedPharmacy] = useState(null);
  const [loadingPharmacies, setLoadingPharmacies] = useState(false);
  const [pharmacySearch, setPharmacySearch] = useState('');
  const [userLocation, setUserLocation] = useState(null);
  
  // Triage history
  const [triageHistory, setTriageHistory] = useState([]);
  
  // Load triage history and saved pharmacy
  useEffect(() => {
    loadTriageHistory();
    loadSavedPharmacy();
  }, []);
  
  const loadTriageHistory = async () => {
    try {
      const response = await triageQueueAPI.getHistory({ limit: 5 });
      if (response.data.success) {
        setTriageHistory(response.data.history);
      }
    } catch (error) {
      console.error('Failed to load triage history:', error);
    }
  };
  
  const loadSavedPharmacy = async () => {
    try {
      const response = await pharmacyAPI.getPreferences();
      if (response.data.success && response.data.pharmacies.length > 0) {
        const preferred = response.data.pharmacies.find(p => p.isPreferred);
        if (preferred) {
          setSelectedPharmacy(preferred);
        }
      }
    } catch (error) {
      console.error('Failed to load saved pharmacy:', error);
    }
  };
  
  const findNearbyPharmacies = async () => {
    setLoadingPharmacies(true);
    
    try {
      // Get user location
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          async (position) => {
            const { latitude, longitude } = position.coords;
            setUserLocation({ latitude, longitude });
            
            const response = await pharmacyAPI.findNearby(latitude, longitude, 8000);
            if (response.data.success) {
              setPharmacies(response.data.pharmacies);
            }
            setLoadingPharmacies(false);
          },
          async () => {
            // Geolocation denied, search by text
            toast({
              title: 'Location Access Denied',
              description: 'Please search for pharmacies by name or address',
              variant: 'warning'
            });
            setLoadingPharmacies(false);
          }
        );
      } else {
        toast({
          title: 'Geolocation Not Supported',
          description: 'Please search for pharmacies by name or address',
          variant: 'warning'
        });
        setLoadingPharmacies(false);
      }
    } catch (error) {
      console.error('Error finding pharmacies:', error);
      setLoadingPharmacies(false);
    }
  };
  
  const searchPharmacies = async () => {
    if (!pharmacySearch.trim()) return;
    
    setLoadingPharmacies(true);
    try {
      const response = await pharmacyAPI.search(pharmacySearch, {
        latitude: userLocation?.latitude,
        longitude: userLocation?.longitude
      });
      if (response.data.success) {
        setPharmacies(response.data.pharmacies);
      }
    } catch (error) {
      console.error('Error searching pharmacies:', error);
    } finally {
      setLoadingPharmacies(false);
    }
  };
  
  const handleAnalyze = async () => {
    if (!chiefComplaint.trim() || !symptoms.trim()) {
      toast({
        title: 'Missing Information',
        description: 'Please describe your main concern and symptoms',
        variant: 'destructive'
      });
      return;
    }
    
    setIsProcessing(true);
    
    try {
      // Format vitals (only include non-empty values)
      const formattedVitals = {};
      if (vitals.temperature) formattedVitals.temperature = parseFloat(vitals.temperature);
      if (vitals.heartRate) formattedVitals.heartRate = parseInt(vitals.heartRate);
      if (vitals.systolic) formattedVitals.systolic = parseInt(vitals.systolic);
      if (vitals.diastolic) formattedVitals.diastolic = parseInt(vitals.diastolic);
      if (vitals.respiratoryRate) formattedVitals.respiratoryRate = parseInt(vitals.respiratoryRate);
      if (vitals.oxygenSaturation) formattedVitals.oxygenSaturation = parseFloat(vitals.oxygenSaturation);
      if (vitals.painLevel) formattedVitals.painLevel = parseInt(vitals.painLevel);
      
      const response = await triageQueueAPI.createSession({
        chiefComplaint,
        symptoms,
        symptomDuration,
        symptomSeverity,
        vitals: Object.keys(formattedVitals).length > 0 ? formattedVitals : undefined
      });
      
      if (response.data.success) {
        setAnalysis(response.data.analysis);
        setStep(3);
        
        // If emergency, show alert
        if (response.data.analysis.isEmergency) {
          toast({
            title: '🚨 Emergency Detected',
            description: 'Based on your symptoms, you may need immediate medical attention. Please call 911 if you are experiencing a life-threatening emergency.',
            variant: 'destructive'
          });
        } else {
          toast({
            title: 'Analysis Complete',
            description: `Triage Level: ${response.data.analysis.triageLevel}`,
            variant: 'default'
          });
        }
      }
    } catch (error) {
      console.error('Triage analysis error:', error);
      toast({
        title: 'Analysis Failed',
        description: error.response?.data?.error || 'Failed to analyze symptoms',
        variant: 'destructive'
      });
    } finally {
      setIsProcessing(false);
    }
  };
  
  const savePharmacyPreference = async () => {
    if (!selectedPharmacy) return;
    
    try {
      await pharmacyAPI.addPreference({
        pharmacyName: selectedPharmacy.name,
        pharmacyAddress: selectedPharmacy.address,
        pharmacyPhone: selectedPharmacy.phone,
        pharmacyNpi: selectedPharmacy.npi,
        latitude: selectedPharmacy.latitude,
        longitude: selectedPharmacy.longitude,
        distanceMiles: selectedPharmacy.distanceMiles,
        isPreferred: true,
        source: 'patient_selected'
      });
      
      toast({
        title: 'Pharmacy Saved',
        description: `${selectedPharmacy.name} has been saved as your preferred pharmacy`,
        variant: 'success'
      });
      
      router.push('/patient/dashboard');
    } catch (error) {
      console.error('Error saving pharmacy:', error);
      toast({
        title: 'Save Failed',
        description: 'Failed to save pharmacy preference',
        variant: 'destructive'
      });
    }
  };
  
  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl">
              <BrainCircuit className="w-6 h-6 text-white" />
            </div>
            AI Symptom Checker
          </h1>
          <p className="text-muted-foreground mt-1">Powered by Advanced Medical AI</p>
        </div>
        
        {/* Progress indicator */}
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4].map((s) => (
            <div
              key={s}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                step === s
                  ? 'bg-purple-600 text-white'
                  : step > s
                  ? 'bg-green-500 text-white'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {step > s ? <CheckCircle className="w-4 h-4" /> : s}
            </div>
          ))}
        </div>
      </div>
      
      {/* Step 1: Symptoms */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-purple-500" />
              Describe Your Symptoms
            </CardTitle>
            <CardDescription>
              Tell us what's bothering you. Be as specific as possible.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <Label htmlFor="chiefComplaint" className="text-base font-medium">
                What is your main concern today? *
              </Label>
              <Input
                id="chiefComplaint"
                placeholder="e.g., Chest pain, headache, difficulty breathing..."
                value={chiefComplaint}
                onChange={(e) => setChiefComplaint(e.target.value)}
                className="mt-2"
              />
            </div>
            
            <div>
              <Label htmlFor="symptoms" className="text-base font-medium">
                Describe your symptoms in detail *
              </Label>
              <textarea
                id="symptoms"
                className="w-full mt-2 min-h-[120px] rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-y"
                placeholder="Include details like: when it started, how it feels, what makes it better or worse, other symptoms you're experiencing..."
                value={symptoms}
                onChange={(e) => setSymptoms(e.target.value)}
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="duration" className="text-base font-medium">
                  How long have you had these symptoms?
                </Label>
                <Input
                  id="duration"
                  placeholder="e.g., 2 days, 1 week..."
                  value={symptomDuration}
                  onChange={(e) => setSymptomDuration(e.target.value)}
                  className="mt-2"
                />
              </div>
              
              <div>
                <Label className="text-base font-medium">
                  Severity (1-10): {symptomSeverity}
                </Label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={symptomSeverity}
                  onChange={(e) => setSymptomSeverity(parseInt(e.target.value))}
                  className="w-full mt-4 accent-purple-600"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Mild</span>
                  <span>Severe</span>
                </div>
              </div>
            </div>
            
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setStep(2)}
              >
                Add Vital Signs (Optional)
              </Button>
              <Button
                onClick={handleAnalyze}
                disabled={!chiefComplaint.trim() || !symptoms.trim() || isProcessing}
                className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <BrainCircuit className="w-4 h-4 mr-2" />
                    Analyze Symptoms
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Step 2: Vitals */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-red-500" />
              Vital Signs (Optional)
            </CardTitle>
            <CardDescription>
              If you have access to these measurements, they help improve assessment accuracy.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <Label className="flex items-center gap-2">
                  <Thermometer className="w-4 h-4 text-red-500" />
                  Temperature (°F)
                </Label>
                <Input
                  type="number"
                  step="0.1"
                  placeholder="98.6"
                  value={vitals.temperature}
                  onChange={(e) => setVitals({ ...vitals, temperature: e.target.value })}
                  className="mt-2"
                />
              </div>
              
              <div>
                <Label className="flex items-center gap-2">
                  <Heart className="w-4 h-4 text-red-500" />
                  Heart Rate (bpm)
                </Label>
                <Input
                  type="number"
                  placeholder="72"
                  value={vitals.heartRate}
                  onChange={(e) => setVitals({ ...vitals, heartRate: e.target.value })}
                  className="mt-2"
                />
              </div>
              
              <div>
                <Label className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-blue-500" />
                  Blood Pressure
                </Label>
                <div className="flex gap-2 mt-2">
                  <Input
                    type="number"
                    placeholder="120"
                    value={vitals.systolic}
                    onChange={(e) => setVitals({ ...vitals, systolic: e.target.value })}
                  />
                  <span className="self-center">/</span>
                  <Input
                    type="number"
                    placeholder="80"
                    value={vitals.diastolic}
                    onChange={(e) => setVitals({ ...vitals, diastolic: e.target.value })}
                  />
                </div>
              </div>
              
              <div>
                <Label>Respiratory Rate (per min)</Label>
                <Input
                  type="number"
                  placeholder="16"
                  value={vitals.respiratoryRate}
                  onChange={(e) => setVitals({ ...vitals, respiratoryRate: e.target.value })}
                  className="mt-2"
                />
              </div>
              
              <div>
                <Label>Oxygen Saturation (%)</Label>
                <Input
                  type="number"
                  step="0.1"
                  placeholder="98"
                  value={vitals.oxygenSaturation}
                  onChange={(e) => setVitals({ ...vitals, oxygenSaturation: e.target.value })}
                  className="mt-2"
                />
              </div>
              
              <div>
                <Label>Pain Level (0-10)</Label>
                <Input
                  type="number"
                  min="0"
                  max="10"
                  placeholder="5"
                  value={vitals.painLevel}
                  onChange={(e) => setVitals({ ...vitals, painLevel: e.target.value })}
                  className="mt-2"
                />
              </div>
            </div>
            
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button
                onClick={handleAnalyze}
                disabled={isProcessing}
                className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <BrainCircuit className="w-4 h-4 mr-2" />
                    Analyze Symptoms
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Step 3: Results */}
      {step === 3 && analysis && (
        <div className="space-y-6">
          {/* Emergency Banner */}
          {analysis.isEmergency && (
            <Card className="border-red-500 bg-red-50 dark:bg-red-950">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-red-500 rounded-full">
                    <AlertTriangle className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-red-900 dark:text-red-100">
                      Emergency Detected
                    </h3>
                    <p className="text-red-700 dark:text-red-200">
                      {analysis.emergencyFlags?.join(', ')}
                    </p>
                    <p className="text-sm text-red-600 dark:text-red-300 mt-1">
                      If this is a life-threatening emergency, please call 911 immediately.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          
          {/* Triage Level Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-500" />
                AI Assessment Results
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-xs text-muted-foreground uppercase font-bold">Triage Level</p>
                  <Badge className={`mt-2 ${TRIAGE_COLORS[analysis.triageLevel]}`}>
                    {analysis.triageLevel}
                  </Badge>
                </div>
                
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-xs text-muted-foreground uppercase font-bold">Severity</p>
                  <p className="text-2xl font-bold mt-1">{analysis.severity}/5</p>
                </div>
                
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-xs text-muted-foreground uppercase font-bold">Est. Wait</p>
                  <p className="text-lg font-semibold mt-1">{analysis.estimatedWaitMinutes} min</p>
                </div>
                
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-xs text-muted-foreground uppercase font-bold">Specialty</p>
                  <p className="text-sm font-semibold mt-1">{analysis.suggestedSpecialty}</p>
                </div>
              </div>
              
              {/* Clinical Flags */}
              {analysis.clinicalFlags?.length > 0 && (
                <div>
                  <p className="text-sm font-bold text-muted-foreground uppercase mb-2">Clinical Flags</p>
                  <div className="flex flex-wrap gap-2">
                    {analysis.clinicalFlags.map((flag, idx) => (
                      <Badge key={idx} variant="destructive" className="text-xs">
                        {flag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Differential Diagnosis */}
              {analysis.differentialDiagnosis?.length > 0 && (
                <div>
                  <p className="text-sm font-bold text-muted-foreground uppercase mb-2">
                    Possible Conditions
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {analysis.differentialDiagnosis.map((dx, idx) => (
                      <Badge key={idx} variant="outline" className="text-xs">
                        {dx.condition} ({dx.likelihood})
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Suggested Medications */}
              {analysis.suggestedMedications?.length > 0 && (
                <div>
                  <p className="text-sm font-bold text-muted-foreground uppercase mb-2 flex items-center gap-2">
                    <Pill className="w-4 h-4" />
                    AI Suggested Treatments
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {analysis.suggestedMedications.map((med, idx) => (
                      <Badge key={idx} className="bg-gradient-to-r from-indigo-100 to-purple-100 text-indigo-800 border-indigo-200">
                        {med}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Recommended Tests */}
              {analysis.recommendedTests?.length > 0 && (
                <div>
                  <p className="text-sm font-bold text-muted-foreground uppercase mb-2">
                    Recommended Tests
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {analysis.recommendedTests.map((test, idx) => (
                      <Badge key={idx} variant="secondary" className="text-xs">
                        {test}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              
              {/* SOAP Draft */}
              {analysis.soapDraft && (
                <div>
                  <p className="text-sm font-bold text-muted-foreground uppercase mb-2">
                    Assessment Summary
                  </p>
                  <div className="p-4 bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-950 dark:to-indigo-950 rounded-lg">
                    <pre className="text-sm whitespace-pre-wrap font-mono">
                      {analysis.soapDraft}
                    </pre>
                  </div>
                </div>
              )}
              
              <div className="flex justify-end">
                <Button
                  onClick={() => setStep(4)}
                  className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700"
                >
                  Continue to Pharmacy Selection
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      
      {/* Step 4: Pharmacy Selection */}
      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-green-500" />
              Select Your Pharmacy
            </CardTitle>
            <CardDescription>
              Choose your preferred pharmacy for any prescriptions your provider may send.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Search and Find */}
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or address..."
                  value={pharmacySearch}
                  onChange={(e) => setPharmacySearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && searchPharmacies()}
                  className="pl-9"
                />
              </div>
              <Button variant="outline" onClick={searchPharmacies}>
                <Search className="w-4 h-4" />
              </Button>
              <Button variant="outline" onClick={findNearbyPharmacies}>
                <Navigation className="w-4 h-4 mr-2" />
                Find Nearby
              </Button>
            </div>
            
            {/* Selected Pharmacy */}
            {selectedPharmacy && (
              <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg border-2 border-green-500">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <div className="flex-1">
                    <p className="font-semibold">{selectedPharmacy.name || selectedPharmacy.pharmacyName}</p>
                    <p className="text-sm text-muted-foreground">
                      {selectedPharmacy.address || selectedPharmacy.pharmacyAddress}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedPharmacy(null)}
                  >
                    Change
                  </Button>
                </div>
              </div>
            )}
            
            {/* Pharmacy List */}
            {loadingPharmacies ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
              </div>
            ) : pharmacies.length > 0 ? (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {pharmacies.map((pharmacy) => (
                  <button
                    key={pharmacy.id}
                    onClick={() => setSelectedPharmacy(pharmacy)}
                    className={`w-full p-4 rounded-lg border text-left transition-colors ${
                      selectedPharmacy?.id === pharmacy.id
                        ? 'border-green-500 bg-green-50 dark:bg-green-950'
                        : 'border-border hover:border-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div className="p-2 bg-muted rounded-lg">
                          <Building className="w-5 h-5 text-purple-600" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-semibold">{pharmacy.name}</p>
                            {pharmacy.isPreferred && (
                              <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">{pharmacy.address}</p>
                          {pharmacy.phone && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                              <Phone className="w-3 h-3" />
                              {pharmacy.phone}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        {pharmacy.distanceMiles && (
                          <p className="text-sm font-medium">{pharmacy.distanceMiles} mi</p>
                        )}
                        {pharmacy.isOpen !== false && (
                          <Badge variant="outline" className="text-xs text-green-600 border-green-300">
                            Open
                          </Badge>
                        )}
                      </div>
                    </div>
                    {pharmacy.capabilities && (
                      <div className="flex gap-2 mt-2 flex-wrap">
                        {pharmacy.capabilities.acceptsEprescriptions && (
                          <Badge variant="secondary" className="text-xs">E-Rx</Badge>
                        )}
                        {pharmacy.capabilities.hasDriveThru && (
                          <Badge variant="secondary" className="text-xs">Drive-Thru</Badge>
                        )}
                        {pharmacy.capabilities.has24Hour && (
                          <Badge variant="secondary" className="text-xs">24 Hour</Badge>
                        )}
                        {pharmacy.capabilities.hasDelivery && (
                          <Badge variant="secondary" className="text-xs">Delivery</Badge>
                        )}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <MapPin className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">
                  Click "Find Nearby" to locate pharmacies near you
                </p>
              </div>
            )}
            
            <div className="flex justify-between pt-4 border-t">
              <Button variant="outline" onClick={() => setStep(3)}>
                Back
              </Button>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => router.push('/patient/dashboard')}
                >
                  Skip for Now
                </Button>
                <Button
                  onClick={savePharmacyPreference}
                  disabled={!selectedPharmacy}
                  className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Save & Continue
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Triage History */}
      {triageHistory.length > 0 && step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Triage Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {triageHistory.slice(0, 3).map((session) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between p-3 bg-muted rounded-lg"
                >
                  <div>
                    <p className="font-medium">{session.chiefComplaint}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(session.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge className={TRIAGE_COLORS[session.aiTriageLevel]}>
                    {session.aiTriageLevel}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

