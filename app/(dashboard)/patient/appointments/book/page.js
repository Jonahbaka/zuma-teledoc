'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { 
  Calendar, Clock, User, FileText, Upload, CreditCard, 
  CheckCircle2, ChevronRight, ChevronLeft, Loader2, 
  Stethoscope, Video, Phone, Building, Camera, X, AlertCircle,
  Shield, Heart, Plus, Brain, Activity, Eye, Bone, Baby,
  ThermometerSun, Pill, Ear, Smile, Sparkles, AlertTriangle
} from 'lucide-react';
import api from '@/lib/api';
import { DoctaService } from '@/lib/doctaService';
import { triageAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';

const STEPS = [
  { id: 1, title: 'Health Issue', icon: Heart },
  { id: 2, title: 'Symptoms', icon: FileText },
  { id: 3, title: 'AI Analysis', icon: Brain },
  { id: 4, title: 'Schedule', icon: Calendar },
  { id: 5, title: 'Insurance', icon: CreditCard },
  { id: 6, title: 'Confirm', icon: CheckCircle2 }
];

// Health categories with icons
const HEALTH_CATEGORIES = [
  { id: 'general', name: 'General Health', icon: Stethoscope, description: 'Routine checkups, general concerns', specialties: ['General Practice', 'Internal Medicine', 'Family Medicine'] },
  { id: 'mental', name: 'Mental Health', icon: Brain, description: 'Anxiety, depression, stress', specialties: ['Psychiatry', 'Psychology', 'Mental Health'] },
  { id: 'skin', name: 'Skin & Dermatology', icon: Smile, description: 'Rashes, acne, skin conditions', specialties: ['Dermatology'] },
  { id: 'heart', name: 'Heart & Cardiovascular', icon: Activity, description: 'Heart palpitations, blood pressure', specialties: ['Cardiology', 'Internal Medicine'] },
  { id: 'eyes', name: 'Eyes & Vision', icon: Eye, description: 'Eye problems, vision concerns', specialties: ['Ophthalmology', 'Optometry'] },
  { id: 'bones', name: 'Bones & Joints', icon: Bone, description: 'Joint pain, fractures, arthritis', specialties: ['Orthopedics', 'Rheumatology'] },
  { id: 'womens', name: "Women's Health", icon: Baby, description: 'Gynecology, pregnancy, hormones', specialties: ['Gynecology', 'Obstetrics', "Women's Health"] },
  { id: 'digestive', name: 'Digestive Health', icon: ThermometerSun, description: 'Stomach issues, digestion', specialties: ['Gastroenterology', 'Internal Medicine'] },
  { id: 'respiratory', name: 'Respiratory', icon: Activity, description: 'Breathing, cough, allergies', specialties: ['Pulmonology', 'Allergy', 'Internal Medicine'] },
  { id: 'ent', name: 'Ear, Nose & Throat', icon: Ear, description: 'Hearing, sinus, throat issues', specialties: ['ENT', 'Otolaryngology'] },
  { id: 'chronic', name: 'Chronic Conditions', icon: Pill, description: 'Diabetes, thyroid, ongoing care', specialties: ['Endocrinology', 'Internal Medicine'] },
  { id: 'urgent', name: 'Urgent Care', icon: AlertCircle, description: 'Non-emergency urgent issues', specialties: ['Urgent Care', 'Emergency Medicine', 'General Practice'] },
];

// Time slots
const TIME_SLOTS = [
  { time: '08:00', period: 'Morning' },
  { time: '08:30', period: 'Morning' },
  { time: '09:00', period: 'Morning' },
  { time: '09:30', period: 'Morning' },
  { time: '10:00', period: 'Morning' },
  { time: '10:30', period: 'Morning' },
  { time: '11:00', period: 'Morning' },
  { time: '11:30', period: 'Morning' },
  { time: '12:00', period: 'Afternoon' },
  { time: '12:30', period: 'Afternoon' },
  { time: '13:00', period: 'Afternoon' },
  { time: '13:30', period: 'Afternoon' },
  { time: '14:00', period: 'Afternoon' },
  { time: '14:30', period: 'Afternoon' },
  { time: '15:00', period: 'Afternoon' },
  { time: '15:30', period: 'Afternoon' },
  { time: '16:00', period: 'Evening' },
  { time: '16:30', period: 'Evening' },
  { time: '17:00', period: 'Evening' },
  { time: '17:30', period: 'Evening' },
  { time: '18:00', period: 'Evening' },
];

const SAME_MINUTE_BUFFER_MINUTES = 5;

const insuranceSchema = z.object({
  insuranceProvider: z.string().optional(),
  policyNumber: z.string().optional(),
  groupNumber: z.string().optional(),
  subscriberName: z.string().optional(),
  relationshipToSubscriber: z.enum(['self', 'spouse', 'child', 'other']).optional().default('self')
}).refine((data) => {
  // If any insurance field is provided, all required fields must be filled
  const hasAnyField = !!(data.insuranceProvider || data.policyNumber || data.subscriberName);
  if (hasAnyField) {
    const hasAllRequired = !!(data.insuranceProvider && data.policyNumber && data.subscriberName);
    return hasAllRequired;
  }
  return true; // All optional if nothing provided - can skip insurance
}, {
  message: 'Please provide all required insurance details (Provider, Policy Number, and Subscriber Name) or leave all fields empty to skip',
  path: ['insuranceProvider']
});

function formatLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildAvailableDates() {
  const dates = [];
  const today = new Date();

  dates.push(formatLocalDateKey(today));

  for (let i = 1; i <= 21; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);

    if (date.getDay() !== 0 && date.getDay() !== 6) {
      dates.push(formatLocalDateKey(date));
    }

    if (dates.length >= 14) {
      break;
    }
  }

  return dates;
}

function formatLocalTimeKey(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function getTimePeriod(hour) {
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  return 'Evening';
}

function buildSlotsForDate(selectedDate) {
  if (!selectedDate) {
    return [];
  }

  const today = new Date();
  const todayKey = formatLocalDateKey(today);
  const slots = TIME_SLOTS.map((slot) => ({ ...slot, isImmediate: false }));

  if (selectedDate !== todayKey) {
    return slots;
  }

  const cutoff = new Date(today);
  cutoff.setMinutes(cutoff.getMinutes() - SAME_MINUTE_BUFFER_MINUTES);

  const filteredSlots = slots.filter((slot) => {
    const [hours, minutes] = slot.time.split(':').map(Number);
    const slotDate = new Date(today);
    slotDate.setHours(hours, minutes, 0, 0);
    return slotDate >= cutoff;
  });

  const immediateTime = formatLocalTimeKey(today);
  const immediateSlot = {
    time: immediateTime,
    period: getTimePeriod(today.getHours()),
    isImmediate: true,
    label: 'Now'
  };

  if (filteredSlots.some((slot) => slot.time === immediateTime)) {
    return filteredSlots;
  }

  return [immediateSlot, ...filteredSlots];
}

function providerMatchesCategory(provider, category) {
  if (!provider || !category) {
    return false;
  }

  const providerText = `${provider.specialty || ''} ${provider.credentials || ''}`.toLowerCase();
  const categoryTerms = [
    category.name,
    category.id,
    ...(Array.isArray(category.specialties) ? category.specialties : [])
  ]
    .filter(Boolean)
    .map((value) => value.toLowerCase());

  return categoryTerms.some((term) => providerText.includes(term));
}

function getProviderLabel(provider) {
  if (!provider) {
    return 'Provider';
  }

  return `Dr. ${provider.firstName} ${provider.lastName}`;
}

export default function BookAppointmentPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  
  // Step 1: Health Issue
  const [selectedCategory, setSelectedCategory] = useState(null);
  
  // Step 2: Symptoms
  const [symptoms, setSymptoms] = useState('');
  const [severity, setSeverity] = useState('moderate');
  const [duration, setDuration] = useState('');
  const [medications, setMedications] = useState('');
  const [allergies, setAllergies] = useState('');
  const [visitType, setVisitType] = useState('video');
  
  // Step 3: AI Triage
  const [triageResult, setTriageResult] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  // Step 3: Schedule
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTime, setSelectedTime] = useState(null);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [availableDates, setAvailableDates] = useState([]);
  const [providers, setProviders] = useState([]);
  const [selectedProviderId, setSelectedProviderId] = useState(null);
  const [matchedProvider, setMatchedProvider] = useState(null);
  const [isLoadingProviders, setIsLoadingProviders] = useState(false);
  const [providersError, setProvidersError] = useState('');
  
  // Step 4: Insurance
  const [insuranceFront, setInsuranceFront] = useState(null);
  const [insuranceBack, setInsuranceBack] = useState(null);
  const [hasExistingInsurance, setHasExistingInsurance] = useState(false);
  
  const insuranceForm = useForm({
    resolver: zodResolver(insuranceSchema),
    defaultValues: {
      insuranceProvider: '',
      policyNumber: '',
      groupNumber: '',
      subscriberName: '',
      relationshipToSubscriber: 'self'
    }
  });

  const runAITriage = useCallback(async () => {
    if (!symptoms.trim()) return;
    
    setIsAnalyzing(true);
    try {
      const result = await DoctaService.runAITriage(symptoms);
      
      // Add safe defaults
      const safeResult = {
        severity: result.severity || 1,
        soapDraft: result.soapDraft || 'No assessment generated',
        triageLevel: result.triageLevel || 'ROUTINE',
        suggestedSpecialty: result.suggestedSpecialty || 'Primary Care',
        flags: result.flags || [],
        suggestedMeds: result.suggestedMeds || []
      };
      
      setTriageResult(safeResult);
    } catch (error) {
      // If AI triage fails, continue without it
      console.warn('AI triage failed, continuing:', error);
    } finally {
      setIsAnalyzing(false);
    }
  }, [symptoms]);

  const loadProviders = useCallback(async () => {
    setIsLoadingProviders(true);
    setProvidersError('');

    try {
      const response = await api.get('/providers', {
        params: {
          limit: 100
        }
      });

      if (response.data?.success) {
        setProviders(response.data.providers || []);
      } else {
        setProviders([]);
        setProvidersError('Unable to load providers right now.');
      }
    } catch (error) {
      setProviders([]);
      setProvidersError('Unable to load providers right now.');
    } finally {
      setIsLoadingProviders(false);
    }
  }, []);

  // Auto-run AI triage when symptoms are entered and user moves to step 3
  useEffect(() => {
    if (currentStep === 3 && symptoms.trim() && !triageResult && !isAnalyzing) {
      runAITriage();
    }
  }, [currentStep, symptoms, triageResult, isAnalyzing, runAITriage]);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    setAvailableSlots(buildSlotsForDate(selectedDate));
  }, [selectedDate]);

  useEffect(() => {
    if (selectedTime && !availableSlots.some((slot) => slot.time === selectedTime)) {
      setSelectedTime(null);
    }
  }, [availableSlots, selectedTime]);

  useEffect(() => {
    if (!selectedCategory || providers.length === 0) {
      setMatchedProvider(null);
      if (providers.length === 0) {
        setSelectedProviderId(null);
      }
      return;
    }

    const recommendedProvider =
      providers.find((provider) => providerMatchesCategory(provider, selectedCategory)) || providers[0];

    setMatchedProvider(recommendedProvider || null);
    setSelectedProviderId((currentProviderId) => {
      if (currentProviderId && providers.some((provider) => provider.id === currentProviderId)) {
        return currentProviderId;
      }

      return recommendedProvider?.id || null;
    });
  }, [providers, selectedCategory]);

  useEffect(() => {
    setAvailableDates(buildAvailableDates());
  }, []);

  // Fetch existing insurance
  useEffect(() => {
    const fetchInsurance = async () => {
      try {
        const response = await api.get('/users/me/insurance');
        if (response.data.success && response.data.insurance) {
          setHasExistingInsurance(true);
          insuranceForm.reset({
            insuranceProvider: response.data.insurance.insurance_provider || '',
            policyNumber: response.data.insurance.policy_number || '',
            groupNumber: response.data.insurance.group_number || '',
            subscriberName: response.data.insurance.subscriber_name || '',
            relationshipToSubscriber: response.data.insurance.relationship_to_subscriber || 'self'
          });
        }
      } catch (error) {
        // No existing insurance
      }
    };
    fetchInsurance();
  }, [insuranceForm]);

  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) || matchedProvider;
  const displayProviders = matchedProvider
    ? [
        matchedProvider,
        ...providers.filter((provider) => provider.id !== matchedProvider.id)
      ]
    : providers;

  const handleFileUpload = (e, type) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast({ title: 'File too large', description: 'Maximum file size is 10MB', variant: 'destructive' });
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        if (type === 'front') setInsuranceFront({ file, preview: reader.result });
        else setInsuranceBack({ file, preview: reader.result });
      };
      reader.readAsDataURL(file);
    }
  };

  const nextStep = async () => {
    if (currentStep === 1 && !selectedCategory) {
      toast({ title: 'Select a health category', description: 'Please select what health issue you need help with', variant: 'destructive' });
      return;
    }
    
    if (currentStep === 2 && !symptoms.trim()) {
      toast({ title: 'Describe your symptoms', description: 'Please describe your symptoms to help the provider', variant: 'destructive' });
      return;
    }
    
    if (currentStep === 3) {
      // AI Analysis step - if not analyzed yet, run it
      if (!triageResult && !isAnalyzing) {
        await runAITriage();
      }
      // Continue even if triage failed
    }
    
    if (currentStep === 4) {
      if (!selectedDate || !selectedTime) {
        toast({ title: 'Select date and time', description: 'Please select your preferred appointment slot', variant: 'destructive' });
        return;
      }

      if (providers.length > 0 && !selectedProviderId) {
        toast({ title: 'Choose a provider', description: 'Select the doctor you want to book with before continuing.', variant: 'destructive' });
        return;
      }
    }
    
    if (currentStep === 5) {
      // Insurance is optional - validate only if fields are filled
      const formValues = insuranceForm.getValues();
      const hasInsuranceData = formValues.insuranceProvider || formValues.policyNumber || formValues.subscriberName;
      if (hasInsuranceData) {
        const valid = await insuranceForm.trigger();
        if (!valid) return;
      }
      // If no insurance data, skip validation and continue
    }
    
    setCurrentStep(prev => Math.min(prev + 1, 6));
  };

  const prevStep = () => setCurrentStep(prev => Math.max(prev - 1, 1));

  const submitBooking = async () => {
    setIsLoading(true);
    
    try {
      // Validate required fields
      if (!selectedCategory) {
        toast({ title: 'Error', description: 'Please select a health category', variant: 'destructive' });
        setIsLoading(false);
        return;
      }
      
      if (!selectedDate || !selectedTime) {
        toast({ title: 'Error', description: 'Please select a date and time', variant: 'destructive' });
        setIsLoading(false);
        return;
      }

      if (providers.length > 0 && !selectedProviderId) {
        toast({ title: 'Error', description: 'Please choose a provider for this appointment', variant: 'destructive' });
        setIsLoading(false);
        return;
      }
      
      // Validate date and time are valid
      // Construct date in local timezone to avoid timezone shifts
      const [year, month, day] = selectedDate.split('-').map(Number);
      const [hours, minutes] = selectedTime.split(':').map(Number);
      
      // Validate parsed values
      if (!year || !month || !day || isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        toast({ title: 'Error', description: 'Invalid date or time format. Please select a valid date and time.', variant: 'destructive' });
        setIsLoading(false);
        return;
      }
      
      // Validate month and day ranges
      if (month < 1 || month > 12 || day < 1 || day > 31) {
        toast({ title: 'Error', description: 'Invalid date selected. Please select a valid date.', variant: 'destructive' });
        setIsLoading(false);
        return;
      }
      
      // Create date object in local timezone
      const scheduledDate = new Date(year, month - 1, day, hours, minutes, 0);
      
      // Validate the created date matches what we expect
      if (isNaN(scheduledDate.getTime()) || 
          scheduledDate.getFullYear() !== year || 
          scheduledDate.getMonth() !== month - 1 || 
          scheduledDate.getDate() !== day) {
        toast({ title: 'Error', description: 'Invalid date selected. Please select a valid date and time.', variant: 'destructive' });
        setIsLoading(false);
        return;
      }
      
      // Check if date is in the past (with 5 minute buffer)
      const now = new Date();
      now.setMinutes(now.getMinutes() - 5); // Allow booking up to 5 minutes in the past for edge cases
      if (scheduledDate < now) {
        toast({ title: 'Error', description: 'Please select a future date and time', variant: 'destructive' });
        setIsLoading(false);
        return;
      }
      
      const insuranceData = insuranceForm.getValues();
      
      // Check if insurance data is provided
      const hasInsuranceData = insuranceData.insuranceProvider && 
                                insuranceData.policyNumber && 
                                insuranceData.subscriberName;
      
      // Create appointment with auto-matched provider
      const appointmentData = {
        category: selectedCategory.id,
        specialties: selectedCategory.specialties,
        scheduledAt: scheduledDate.toISOString(), // Use ISO string for proper timezone handling
        providerId: selectedProviderId,
        type: visitType,
        reasonForVisit: `${selectedCategory.name}: ${symptoms}`,
        patientNotes: `Severity: ${severity}\nDuration: ${duration}\nMedications: ${medications || 'None'}\nAllergies: ${allergies || 'None'}`,
        durationMinutes: 30,
        autoMatch: !selectedProviderId,
        triageResult: triageResult || null // Include AI triage data
      };
      
      const appointmentResponse = await api.post('/appointments/smart-book', appointmentData);
      
      // Check response structure
      if (!appointmentResponse || !appointmentResponse.data) {
        throw new Error('Invalid response from server');
      }
      
      if (appointmentResponse.data.success && appointmentResponse.data.appointment) {
        const appointmentId = appointmentResponse.data.appointment.id;
        
        if (!appointmentId) {
          throw new Error('Appointment created but no ID returned');
        }
        
        // Save triage data to appointment if available
        if (triageResult && appointmentId) {
          try {
            await triageAPI.store(appointmentId, symptoms, triageResult);
          } catch (triageError) {
            // Don't fail booking if triage save fails
            console.warn('Failed to save triage data:', triageError);
          }
        }
        
        // Save insurance only if provided (optional - don't fail if this errors)
        if (hasInsuranceData) {
          try {
            if (!hasExistingInsurance || insuranceForm.formState.isDirty) {
              await api.post('/users/me/insurance', insuranceData);
            }
          } catch (insuranceError) {
            console.warn('Failed to save insurance, continuing:', insuranceError);
            // Don't fail the booking if insurance save fails
          }
        }
        
        // Upload documents only if insurance is provided (optional - don't fail if this errors)
        if (hasInsuranceData && (insuranceFront || insuranceBack)) {
          try {
            const formData = new FormData();
            formData.append('appointmentId', appointmentId);
            if (insuranceFront?.file) formData.append('insurance_front', insuranceFront.file);
            if (insuranceBack?.file) formData.append('insurance_back', insuranceBack.file);
            await api.post('/appointments/documents', formData, {
              headers: { 'Content-Type': 'multipart/form-data' }
            });
          } catch (docError) {
            console.warn('Failed to upload documents, continuing:', docError);
            // Don't fail the booking if document upload fails
          }
        }
        
        toast({ 
          title: 'Appointment Booked!', 
          description: `Your appointment has been scheduled with ${appointmentResponse.data.provider?.name || getProviderLabel(selectedProvider)}` 
        });
        
        // Small delay to ensure database is updated, then redirect
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Redirect to appointments list with refresh parameter to force reload
        router.push(`/patient/appointments?refresh=${Date.now()}`);
      } else {
        const errorMsg = appointmentResponse.data?.error || 'Failed to book appointment';
        throw new Error(errorMsg);
      }
    } catch (error) {
      // Log full error details for debugging
      try {
        console.error('Booking error:', {
          message: error?.message,
          response: error?.response?.data,
          status: error?.response?.status,
          stack: error?.stack
        });
      } catch (logError) {
        // Ignore logging errors
      }
      
      const errorMessage = error?.response?.data?.error || error?.message || 'Failed to book appointment. Please check all fields and try again.';
      toast({
        title: 'Booking Failed',
        description: errorMessage,
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Invalid Date';
    try {
      const date = new Date(dateStr + 'T00:00:00');
      if (isNaN(date.getTime())) return 'Invalid Date';
      return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    } catch (e) {
      return 'Invalid Date';
    }
  };

  const formatTime = (time) => {
    if (!time) return 'Invalid Time';
    try {
      const [hours, minutes] = time.split(':');
      const h = parseInt(hours, 10);
      const m = minutes || '00';
      if (isNaN(h) || h < 0 || h > 23) return 'Invalid Time';
      if (h === 0) return `12:${m} AM`;
      if (h === 12) return `12:${m} PM`;
      return `${h > 12 ? h - 12 : h}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
    } catch (e) {
      return 'Invalid Time';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-purple-50/30 to-background dark:from-slate-950 dark:via-purple-950/20 dark:to-slate-950">
      {/* Header */}
      <div className="bg-card border-b border-border sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-purple-700 dark:bg-purple-600 h-10 w-10 rounded-full flex items-center justify-center relative">
                <span className="text-white font-bold italic">D</span>
                <div className="absolute bottom-1 right-1 w-2 h-2 bg-amber-400 rounded-full border border-purple-700 dark:border-purple-600"></div>
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">Book Appointment</h1>
                <p className="text-sm text-muted-foreground">We'll match you with the right provider</p>
              </div>
            </div>
            <Button variant="ghost" onClick={() => router.push('/patient/appointments')}>Cancel</Button>
          </div>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-8">
          {STEPS.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all ${
                currentStep >= step.id ? 'bg-purple-500 border-purple-500 text-white' : 'border-muted-foreground/30 text-muted-foreground'
              }`}>
                {currentStep > step.id ? <CheckCircle2 className="w-5 h-5" /> : <step.icon className="w-5 h-5" />}
              </div>
              <span className={`hidden sm:block ml-2 text-sm font-medium ${
                currentStep >= step.id ? 'text-foreground' : 'text-muted-foreground'
              }`}>{step.title}</span>
              {index < STEPS.length - 1 && <ChevronRight className="w-5 h-5 text-muted-foreground/50 mx-2" />}
            </div>
          ))}
        </div>

        {/* Step Content */}
        <div className="bg-card rounded-2xl shadow-xl border border-border overflow-hidden">
          
          {/* Step 1: Health Issue Selection */}
          {currentStep === 1 && (
            <div className="p-6">
              <h2 className="text-2xl font-bold text-foreground mb-2">What brings you in today?</h2>
              <p className="text-muted-foreground mb-6">Select the category that best describes your health concern. We'll match you with the right specialist.</p>
              
              <div className="grid md:grid-cols-3 gap-3">
                {HEALTH_CATEGORIES.map((category) => (
                  <button
                    key={category.id}
                    onClick={() => setSelectedCategory(category)}
                    className={`p-4 rounded-xl border-2 text-left transition-all hover:shadow-md ${
                      selectedCategory?.id === category.id
                        ? 'border-purple-500 bg-purple-500/10 ring-2 ring-purple-500/30'
                        : 'border-border hover:border-purple-400 dark:hover:border-purple-500'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        selectedCategory?.id === category.id ? 'bg-purple-500 text-white' : 'bg-muted text-muted-foreground'
                      }`}>
                        <category.icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-foreground">{category.name}</h3>
                        <p className="text-xs text-muted-foreground mt-1">{category.description}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: AI Triage Analysis */}
          {currentStep === 3 && (
            <div className="p-6">
              <h2 className="text-2xl font-bold text-foreground mb-2 flex items-center gap-2">
                <Brain className="w-6 h-6 text-purple-500" />
                AI Symptom Analysis
              </h2>
              <p className="text-muted-foreground mb-6">Powered by Med-Gemini. Analyzing your symptoms to help match you with the right provider.</p>
              
              {isAnalyzing ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="w-12 h-12 animate-spin text-purple-500 mb-4" />
                  <p className="text-muted-foreground">Analyzing your symptoms...</p>
                </div>
              ) : triageResult ? (
                <div className="space-y-4">
                  <div className="p-4 bg-gradient-to-br from-purple-500/10 to-indigo-500/10 rounded-xl border border-purple-500/30">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-purple-500" />
                        <h3 className="font-semibold text-foreground">AI Assessment</h3>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                          triageResult.severity >= 4
                            ? 'bg-red-500/20 text-red-700 dark:text-red-400'
                            : triageResult.severity >= 3
                            ? 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400'
                            : 'bg-green-500/20 text-green-700 dark:text-green-400'
                        }`}>
                          Severity: {triageResult.severity}/5
                        </span>
                        <span className="px-3 py-1 rounded-full text-xs font-bold bg-purple-500/20 text-purple-700 dark:text-purple-400">
                          {triageResult.triageLevel}
                        </span>
                      </div>
                    </div>
                    
                    <div className="mb-4">
                      <p className="text-sm font-medium text-muted-foreground mb-2">Recommended Specialty:</p>
                      <p className="font-semibold text-purple-700 dark:text-purple-400">{triageResult.suggestedSpecialty}</p>
                    </div>
                    
                    {triageResult.flags && triageResult.flags.length > 0 && (
                      <div className="mb-4 p-3 bg-red-500/10 rounded-lg border border-red-500/30">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5" />
                          <div>
                            <p className="text-sm font-bold text-red-700 dark:text-red-400 mb-2">Clinical Flags</p>
                            <div className="flex flex-wrap gap-2">
                              {triageResult.flags.map((flag, idx) => (
                                <span key={idx} className="px-2 py-1 bg-red-500/20 text-red-700 dark:text-red-400 rounded text-xs font-bold">
                                  {flag}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {triageResult.suggestedMeds && triageResult.suggestedMeds.length > 0 && (
                      <div className="mb-4">
                        <p className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1">
                          <Pill className="w-4 h-4" />
                          AI Suggested Medications (For Provider Review)
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {triageResult.suggestedMeds.map((med, idx) => (
                            <span key={idx} className="px-3 py-1 bg-indigo-500/20 text-indigo-700 dark:text-indigo-400 rounded-full text-sm font-medium">
                              {med}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    <div className="mt-4 p-3 bg-muted rounded-lg">
                      <p className="text-xs text-muted-foreground uppercase font-bold mb-2">Assessment Preview</p>
                      <pre className="text-sm text-foreground whitespace-pre-wrap font-mono">
                        {triageResult.soapDraft}
                      </pre>
                    </div>
                  </div>
                  
                  <div className="p-4 bg-blue-500/10 rounded-xl border border-blue-500/30">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-blue-700 dark:text-blue-400">Analysis Complete</p>
                        <p className="text-xs text-blue-600 dark:text-blue-300 mt-1">This information will be shared with your provider to help prepare for your visit.</p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12">
                  <Brain className="w-16 h-16 text-muted-foreground/50 mx-auto mb-4" />
                  <p className="text-muted-foreground">No analysis available. Please go back and describe your symptoms.</p>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Symptoms & Details */}
          {currentStep === 2 && (
            <div className="p-6">
              <h2 className="text-2xl font-bold text-foreground mb-2">Tell us more about your symptoms</h2>
              <p className="text-muted-foreground mb-6">This helps us prepare for your visit and match you with the right provider.</p>
              
              <div className="space-y-6">
                {/* Visit Type */}
                <div>
                  <Label className="text-sm font-medium text-foreground mb-3 block">Visit Type</Label>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { value: 'video', label: 'Video Call', icon: Video, desc: 'Recommended' },
                      { value: 'phone', label: 'Phone', icon: Phone, desc: 'Audio only' },
                      { value: 'in_person', label: 'In Person', icon: Building, desc: 'Clinic visit' }
                    ].map((type) => (
                      <button
                        key={type.value}
                        onClick={() => setVisitType(type.value)}
                        className={`p-4 rounded-xl border-2 transition-all ${
                          visitType === type.value ? 'border-purple-500 bg-purple-500/10' : 'border-border hover:border-purple-400'
                        }`}
                      >
                        <type.icon className={`w-6 h-6 mb-2 ${visitType === type.value ? 'text-purple-600 dark:text-purple-400' : 'text-muted-foreground'}`} />
                        <div className="font-medium text-foreground">{type.label}</div>
                        <div className="text-xs text-muted-foreground">{type.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
                
                {/* Symptoms */}
                <div>
                  <Label htmlFor="symptoms" className="text-foreground">Describe your symptoms *</Label>
                  <textarea
                    id="symptoms"
                    value={symptoms}
                    onChange={(e) => setSymptoms(e.target.value)}
                    placeholder="Please describe what you're experiencing in detail..."
                    className="w-full mt-2 p-3 border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-purple-500 focus:border-purple-500 min-h-[120px]"
                  />
                </div>
                
                {/* Severity */}
                <div>
                  <Label className="text-foreground">How severe are your symptoms?</Label>
                  <div className="grid grid-cols-4 gap-2 mt-2">
                    {[
                      { value: 'mild', label: 'Mild', activeClasses: 'border-emerald-500 bg-emerald-500/20 text-emerald-700 dark:text-emerald-400' },
                      { value: 'moderate', label: 'Moderate', activeClasses: 'border-amber-500 bg-amber-500/20 text-amber-700 dark:text-amber-400' },
                      { value: 'severe', label: 'Severe', activeClasses: 'border-orange-500 bg-orange-500/20 text-orange-700 dark:text-orange-400' },
                      { value: 'urgent', label: 'Urgent', activeClasses: 'border-red-500 bg-red-500/20 text-red-700 dark:text-red-400' }
                    ].map((s) => (
                      <button
                        key={s.value}
                        onClick={() => setSeverity(s.value)}
                        className={`p-3 rounded-lg border-2 text-center transition-all font-medium ${
                          severity === s.value 
                            ? s.activeClasses
                            : 'border-border hover:border-muted-foreground text-foreground'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
                
                {/* Duration */}
                <div>
                  <Label htmlFor="duration" className="text-foreground">How long have you had these symptoms?</Label>
                  <Input
                    id="duration"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    placeholder="e.g., 3 days, 2 weeks, 1 month"
                    className="mt-2 bg-background"
                  />
                </div>
                
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="medications" className="text-foreground">Current Medications</Label>
                    <Input
                      id="medications"
                      value={medications}
                      onChange={(e) => setMedications(e.target.value)}
                      placeholder="List any medications you take"
                      className="mt-2 bg-background"
                    />
                  </div>
                  <div>
                    <Label htmlFor="allergies" className="text-foreground">Known Allergies</Label>
                    <Input
                      id="allergies"
                      value={allergies}
                      onChange={(e) => setAllergies(e.target.value)}
                      placeholder="List any allergies"
                      className="mt-2 bg-background"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Schedule */}
          {currentStep === 4 && (
            <div className="p-6">
              <h2 className="text-2xl font-bold text-foreground mb-2">Choose your appointment time</h2>
              <p className="text-muted-foreground mb-6">Choose your doctor, then pick a slot. For testing, you can also book the current minute on today&apos;s date.</p>

              <div className="mb-6 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-sm font-medium text-foreground">Choose Doctor</Label>
                  {matchedProvider && (
                    <p className="text-xs text-purple-700 dark:text-purple-300">
                      Recommended: {getProviderLabel(matchedProvider)}
                    </p>
                  )}
                </div>

                {isLoadingProviders ? (
                  <div className="flex h-28 items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted">
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading available providers...
                    </p>
                  </div>
                ) : displayProviders.length > 0 ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    {displayProviders.map((provider) => {
                      const isSelected = selectedProviderId === provider.id;
                      const isRecommended = matchedProvider?.id === provider.id;

                      return (
                        <button
                          key={provider.id}
                          type="button"
                          onClick={() => setSelectedProviderId(provider.id)}
                          className={`rounded-xl border-2 p-4 text-left transition-all ${
                            isSelected
                              ? 'border-purple-500 bg-purple-500/10 shadow-sm'
                              : 'border-border hover:border-purple-400 hover:bg-purple-500/5'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-purple-700 text-sm font-semibold text-white">
                              {provider.firstName?.[0]}{provider.lastName?.[0]}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-semibold text-foreground">{getProviderLabel(provider)}</p>
                                {isRecommended && (
                                  <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-[11px] font-medium text-purple-700 dark:text-purple-300">
                                    Recommended
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground">{provider.specialty || 'General Practice'}</p>
                              {(provider.city || provider.state) && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  {[provider.city, provider.state].filter(Boolean).join(', ')}
                                </p>
                              )}
                            </div>
                            {isSelected && <CheckCircle2 className="mt-1 h-5 w-5 text-purple-500" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-medium text-amber-700 dark:text-amber-300">We could not load the provider list.</p>
                        <p className="mt-1 text-sm text-amber-700/90 dark:text-amber-300/90">
                          {providersError || 'You can continue and we will assign the next available approved provider.'}
                        </p>
                      </div>
                      <Button type="button" variant="outline" onClick={loadProviders}>
                        Retry
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              
              <div className="grid md:grid-cols-2 gap-6">
                {/* Date Selection */}
                <div>
                  <Label className="text-sm font-medium text-foreground mb-3 block">Select Date</Label>
                  {availableDates.length === 0 ? (
                    <div className="flex h-48 items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted">
                      <p className="text-sm text-muted-foreground">Loading available dates...</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-2">
                      {availableDates.map((date) => (
                      <button
                        key={date}
                        onClick={() => { setSelectedDate(date); setSelectedTime(null); }}
                        className={`p-3 rounded-lg border-2 text-center transition-all ${
                          selectedDate === date
                            ? 'border-purple-500 bg-purple-500/10 text-purple-700 dark:text-purple-400'
                            : 'border-border hover:border-purple-400'
                        }`}
                      >
                        {(() => {
                          try {
                            const dateObj = new Date(date + 'T00:00:00');
                            if (isNaN(dateObj.getTime())) return <div>Invalid</div>;
                            return (
                              <>
                                <div className={`text-xs ${selectedDate === date ? 'text-purple-600 dark:text-purple-300' : 'text-muted-foreground'}`}>
                                  {dateObj.toLocaleDateString('en-US', { weekday: 'short' })}
                                </div>
                                <div className={`font-semibold text-lg ${selectedDate === date ? '' : 'text-foreground'}`}>
                                  {dateObj.getDate()}
                                </div>
                                <div className={`text-xs ${selectedDate === date ? 'text-purple-600 dark:text-purple-300' : 'text-muted-foreground'}`}>
                                  {dateObj.toLocaleDateString('en-US', { month: 'short' })}
                                </div>
                              </>
                            );
                          } catch (e) {
                            return <div className="text-xs text-red-500">Error</div>;
                          }
                        })()}
                      </button>
                      ))}
                    </div>
                  )}
                </div>
                
                {/* Time Slots */}
                <div>
                  <Label className="text-sm font-medium text-foreground mb-3 block">Select Time</Label>
                  {selectedDate ? (
                    <div className="space-y-4">
                      {['Morning', 'Afternoon', 'Evening'].map((period) => {
                        const periodSlots = availableSlots.filter(s => s.period === period);
                        if (periodSlots.length === 0) return null;
                        return (
                            <div key={period}>
                            <p className="text-xs font-medium text-muted-foreground mb-2">{period}</p>
                            <div className="grid grid-cols-3 gap-2">
                              {periodSlots.map((slot) => (
                                <button
                                  key={slot.time}
                                  type="button"
                                  onClick={() => setSelectedTime(slot.time)}
                                  className={`p-2 rounded-lg border-2 text-sm transition-all ${
                                    selectedTime === slot.time
                                      ? 'border-purple-500 bg-purple-500/10 text-purple-700 dark:text-purple-400 font-medium'
                                      : 'border-border hover:border-purple-400 text-foreground'
                                  }`}
                                >
                                  <span className="block">{formatTime(slot.time)}</span>
                                  {slot.isImmediate && (
                                    <span className="mt-1 block text-[11px] uppercase tracking-wide text-purple-700/80 dark:text-purple-300/80">
                                      Start now
                                    </span>
                                  )}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-48 bg-muted rounded-lg border-2 border-dashed border-border">
                      <p className="text-muted-foreground">Select a date first</p>
                    </div>
                  )}
                </div>
              </div>
              
              {selectedDate && selectedTime && (() => {
                try {
                  const formattedDate = formatDate(selectedDate);
                  const formattedTime = formatTime(selectedTime);
                  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
                  const dt = new Date(`${selectedDate}T${selectedTime}:00`);
                  const localHour = isNaN(dt.getTime()) ? null : dt.getHours();
                  const isOddHour = localHour !== null && (localHour <= 5 || localHour >= 23);
                  return (
                    <div className="mt-6 p-4 bg-purple-500/10 rounded-xl border border-purple-500/30">
                      <div className="flex items-center gap-3">
                        <Calendar className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                        <div>
                          <p className="font-medium text-purple-700 dark:text-purple-400">{formattedDate} at {formattedTime}</p>
                          <p className="text-sm text-purple-600 dark:text-purple-300">30 minute {visitType} consultation</p>
                          <p className="text-sm text-purple-700/90 dark:text-purple-300/90 mt-1">
                            Provider: {selectedProvider ? getProviderLabel(selectedProvider) : 'Next available approved provider'}
                          </p>
                          <p className="text-xs text-purple-700/70 dark:text-purple-300/70 mt-1">Timezone: {timeZone}</p>
                          {isOddHour && (
                            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1 flex items-center gap-1">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              This appointment is in an unusual local hour. Double-check you are booking the correct time.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                } catch (e) {
                  return null;
                }
              })()}
            </div>
          )}

          {/* Step 5: Insurance */}
          {currentStep === 5 && (
            <div className="p-6">
              <h2 className="text-2xl font-bold text-foreground mb-2">Insurance Information</h2>
              <p className="text-muted-foreground mb-6">Provide your insurance details for billing. <span className="font-medium text-foreground">This step is optional.</span></p>
              
              {hasExistingInsurance && (
                <div className="mb-6 p-4 bg-blue-500/10 rounded-xl border border-blue-500/30">
                  <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400">
                    <Shield className="w-5 h-5" />
                    <span className="font-medium">We have your insurance on file</span>
                  </div>
                </div>
              )}
              
              <div className="mb-6 p-4 bg-amber-500/10 rounded-xl border border-amber-500/30">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                      <strong>Note:</strong> You can skip insurance for now and provide it later, or pay out-of-pocket. You can always add or update insurance information in your profile.
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="space-y-6">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="insuranceProvider" className="text-foreground">Insurance Provider</Label>
                    <Input {...insuranceForm.register('insuranceProvider')} placeholder="e.g., Blue Cross" className="mt-2 bg-background" />
                  </div>
                  <div>
                    <Label htmlFor="policyNumber" className="text-foreground">Policy Number</Label>
                    <Input {...insuranceForm.register('policyNumber')} placeholder="e.g., ABC123456" className="mt-2 bg-background" />
                  </div>
                  <div>
                    <Label htmlFor="groupNumber" className="text-foreground">Group Number</Label>
                    <Input {...insuranceForm.register('groupNumber')} placeholder="e.g., GRP001" className="mt-2 bg-background" />
                  </div>
                  <div>
                    <Label htmlFor="subscriberName" className="text-foreground">Subscriber Name</Label>
                    <Input {...insuranceForm.register('subscriberName')} placeholder="Name on card" className="mt-2 bg-background" />
                  </div>
                </div>
                
                {/* Card Upload */}
                <div className="border-t border-border pt-6">
                  <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                    <Camera className="w-5 h-5" /> Upload Insurance Card
                  </h3>
                  <div className="grid md:grid-cols-2 gap-4">
                    {[{ type: 'front', label: 'Front', state: insuranceFront, setState: setInsuranceFront },
                      { type: 'back', label: 'Back', state: insuranceBack, setState: setInsuranceBack }].map(({ type, label, state, setState }) => (
                      <div key={type}>
                        <Label className="text-sm text-foreground">Card {label}</Label>
                        <div className="mt-2">
                          {state ? (
                            <div className="relative">
                              <img src={state.preview} alt={`Insurance ${label}`} className="w-full h-32 object-cover rounded-lg border border-border" />
                              <button onClick={() => setState(null)} className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center">
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-purple-400 hover:bg-purple-500/5">
                              <Upload className="w-8 h-8 text-muted-foreground" />
                              <span className="text-sm text-muted-foreground mt-2">Upload {label.toLowerCase()}</span>
                              <input type="file" accept="image/*" onChange={(e) => handleFileUpload(e, type)} className="hidden" />
                            </label>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 6: Confirm */}
          {currentStep === 6 && (
            <div className="p-6">
              <h2 className="text-2xl font-bold text-foreground mb-2">Review & Confirm</h2>
              <p className="text-muted-foreground mb-6">Please review your appointment details.</p>
              
              <div className="space-y-4">
                <div className="p-4 bg-muted rounded-xl">
                  <h3 className="font-semibold text-foreground mb-2 flex items-center gap-2"><Heart className="w-4 h-4" /> Health Concern</h3>
                  <p className="font-medium text-foreground">{selectedCategory?.name}</p>
                  <p className="text-sm text-muted-foreground mt-1">{symptoms}</p>
                </div>
                
                {triageResult && (
                  <div className="p-4 bg-gradient-to-br from-purple-500/10 to-indigo-500/10 rounded-xl border border-purple-500/30">
                    <h3 className="font-semibold text-foreground mb-2 flex items-center gap-2">
                      <Brain className="w-4 h-4 text-purple-500" /> AI Analysis
                    </h3>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${
                        triageResult.severity >= 4 ? 'bg-red-500/20 text-red-700 dark:text-red-400' :
                        triageResult.severity >= 3 ? 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400' :
                        'bg-green-500/20 text-green-700 dark:text-green-400'
                      }`}>
                        Severity: {triageResult.severity}/5
                      </span>
                      <span className="px-2 py-1 rounded text-xs font-bold bg-purple-500/20 text-purple-700 dark:text-purple-400">
                        {triageResult.triageLevel}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-purple-700 dark:text-purple-400">Recommended: {triageResult.suggestedSpecialty}</p>
                    {triageResult.flags && triageResult.flags.length > 0 && (
                      <p className="text-xs text-red-700 dark:text-red-400 mt-2">
                        ⚠️ {triageResult.flags.join(', ')}
                      </p>
                    )}
                  </div>
                )}
                
                <div className="p-4 bg-muted rounded-xl">
                  <h3 className="font-semibold text-foreground mb-2 flex items-center gap-2"><Calendar className="w-4 h-4" /> Appointment</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div><span className="text-muted-foreground">Date:</span><p className="font-medium text-foreground">{selectedDate ? formatDate(selectedDate) : 'Not selected'}</p></div>
                    <div><span className="text-muted-foreground">Time:</span><p className="font-medium text-foreground">{selectedTime ? formatTime(selectedTime) : 'Not selected'}</p></div>
                    <div><span className="text-muted-foreground">Type:</span><p className="font-medium text-foreground capitalize">{visitType || 'video'}</p></div>
                    <div><span className="text-muted-foreground">Duration:</span><p className="font-medium text-foreground">30 minutes</p></div>
                    <div className="col-span-2"><span className="text-muted-foreground">Doctor:</span><p className="font-medium text-foreground">{selectedProvider ? getProviderLabel(selectedProvider) : 'Next available approved provider'}</p></div>
                  </div>
                </div>
                
                <div className="p-4 bg-muted rounded-xl">
                  <h3 className="font-semibold text-foreground mb-2 flex items-center gap-2"><CreditCard className="w-4 h-4" /> Insurance</h3>
                  {(() => {
                    const insuranceData = insuranceForm.getValues();
                    const hasInsurance = insuranceData.insuranceProvider && 
                                        insuranceData.policyNumber && 
                                        insuranceData.subscriberName;
                    
                    if (hasInsurance || hasExistingInsurance) {
                      return (
                        <>
                          <p className="font-medium text-foreground">{insuranceData.insuranceProvider || 'On file'}</p>
                          {insuranceData.policyNumber && (
                            <p className="text-sm text-muted-foreground">Policy: {insuranceData.policyNumber}</p>
                          )}
                        </>
                      );
                    }
                    return (
                      <p className="text-muted-foreground italic">No insurance provided. You can add insurance later in your profile.</p>
                    );
                  })()}
                </div>
                
                <div className="p-4 bg-amber-500/10 rounded-xl border border-amber-500/30">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                      <strong>Note:</strong> {selectedProvider ? `${getProviderLabel(selectedProvider)} will receive this request immediately.` : 'If the provider list is unavailable, we will assign the next approved provider so your booking can still go through.'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="px-6 py-4 bg-muted border-t border-border flex items-center justify-between">
            <Button variant="ghost" onClick={prevStep} disabled={currentStep === 1} className="flex items-center gap-2">
              <ChevronLeft className="w-4 h-4" /> Back
            </Button>
            
            {currentStep < 6 ? (
              <div className="flex gap-2">
                {currentStep === 5 && (
                  <Button 
                    variant="outline" 
                    onClick={nextStep} 
                    className="flex items-center gap-2"
                  >
                    Skip Insurance <ChevronRight className="w-4 h-4" />
                  </Button>
                )}
                <Button onClick={nextStep} className="bg-gradient-to-r from-purple-600 to-indigo-700 hover:from-purple-700 hover:to-indigo-800 text-white flex items-center gap-2">
                  Continue <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <Button onClick={submitBooking} disabled={isLoading} className="bg-gradient-to-r from-purple-600 to-indigo-700 hover:from-purple-700 hover:to-indigo-800 text-white flex items-center gap-2">
                {isLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Booking...</> : <><CheckCircle2 className="w-4 h-4" /> Confirm Booking</>}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
