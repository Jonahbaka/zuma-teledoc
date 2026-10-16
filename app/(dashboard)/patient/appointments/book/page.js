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
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';

const STEPS = [
  { id: 1, title: 'Care needs', icon: Heart },
  { id: 2, title: 'Health history', icon: FileText },
  { id: 3, title: 'Optional guidance', icon: Brain },
  { id: 4, title: 'Appointment', icon: Calendar },
  { id: 5, title: 'Coverage', icon: CreditCard },
  { id: 6, title: 'Review', icon: CheckCircle2 }
];

const MARKET_CONFIG = {
  US: {
    isNigeria: false,
    appointmentHomePath: '/patient/appointments',
    dateLocale: 'en-US',
    title: 'Book Appointment',
    subtitle: "We'll match you with the right provider",
    healthPrompt: "What brings you in today?",
    healthHelp: "Select the category that best describes your health concern. We'll match you with the right specialist.",
    symptomPrompt: 'Tell us more about your symptoms',
    symptomHelp: 'This helps us prepare for your visit and match you with the right provider.',
    schedulePrompt: 'Choose your appointment time',
    scheduleHelp: "Choose your doctor, then pick a slot. For testing, you can also book the current minute on today's date.",
    coverageTitle: 'Insurance Information',
    coverageHelp: 'Provide your insurance details for billing.',
    coverageOptional: 'This step is optional.',
    coverageNotice: 'You can skip insurance for now and provide it later, or pay out-of-pocket. You can always add or update insurance information in your profile.',
    providerLabel: 'Choose Doctor',
    providerLoading: 'Loading available providers...',
    noProviderTitle: 'We could not load the provider list.',
    noProviderHelp: 'You can continue and we will assign the next available approved provider.',
    confirmTitle: 'Review & Confirm',
    confirmHelp: 'Please review your appointment details.',
    toastTitle: 'Appointment Booked!',
    bookingLabel: 'Appointment',
    stepFiveTitle: 'Insurance',
    pricing: null,
  },
  NG: {
    isNigeria: true,
    appointmentHomePath: '/ng/patient/appointments',
    dateLocale: 'en-NG',
    title: 'Book Consultation',
    subtitle: 'Choose a Nigeria consultation type, provider, time, and care context',
    healthPrompt: 'What do you need help with today?',
    healthHelp: 'Select the health concern that best matches your symptoms. DoctaRx Nigeria will route you to an appropriate provider.',
    symptomPrompt: 'Tell us about the illness or symptom',
    symptomHelp: 'Use plain language. This helps the provider prepare for your consultation.',
    schedulePrompt: 'Choose your consultation time',
    scheduleHelp: 'Choose a provider where available, then pick a convenient Nigeria consultation slot.',
    coverageTitle: 'Payment and Coverage',
    coverageHelp: 'Your consultation fee and any insurance or organisation coverage must be confirmed before payment.',
    coverageOptional: 'This step is optional.',
    coverageNotice: 'You can continue without entering coverage details. DoctaRx Nigeria will show the consultation request and partner/provider confirmation flow; do not upload private documents unless needed for this visit.',
    providerLabel: 'Choose Provider',
    providerLoading: 'Loading Nigeria providers...',
    noProviderTitle: 'We could not load providers right now.',
    noProviderHelp: 'You can continue and the care team will assign the next available approved provider.',
    confirmTitle: 'Review & Request Consultation',
    confirmHelp: 'Review your consultation request. Availability, fee, and any coverage will be confirmed by DoctaRx Nigeria.',
    toastTitle: 'Consultation Requested!',
    bookingLabel: 'Consultation',
    stepFiveTitle: 'Payment',
    pricing: null,
  },
};

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

export default function BookAppointmentPage({ market = 'US' }) {
  const router = useRouter();
  const config = MARKET_CONFIG[market] || MARKET_CONFIG.US;
  const steps = config.isNigeria
    ? STEPS.map((step) => step.id === 5 ? { ...step, title: config.stepFiveTitle } : step)
    : STEPS;
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
  const [guidanceUnavailable, setGuidanceUnavailable] = useState('');
  const [historyReviewed, setHistoryReviewed] = useState(false);
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
      setTriageResult(null);
      setGuidanceUnavailable('');
      await DoctaService.runAITriage(symptoms);
      setGuidanceUnavailable('Automated guidance could not be validated. Continue booking and share your symptoms with the clinician.');
    } catch (error) {
      setTriageResult(null);
      setGuidanceUnavailable(error.message || 'Optional automated guidance is unavailable. You can continue booking.');
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

  useEffect(() => {
    setHistoryReviewed(false);
    setTriageResult(null);
  }, [symptoms, medications, allergies]);

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
      if (!historyReviewed) {
        toast({ title: 'Review your history', description: 'Confirm that you have reviewed your medication and allergy information.', variant: 'destructive' });
        setIsLoading(false);
        return;
      }
      
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
        patientNotes: `Patient-reported severity: ${severity}\nDuration: ${duration}\nMedications: ${medications.trim() || 'Unknown / not supplied'}\nAllergies: ${allergies.trim() || 'Unknown / not supplied'}`,
        intake: {
          historyReviewed,
          medicationStatus: medications.trim() ? 'reported' : 'unknown',
          allergyStatus: allergies.trim() ? 'reported' : 'unknown',
        },
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
        
        // Optional client guidance is not stored as a verified clinical assessment.
        
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
          title: config.toastTitle,
          description: `${config.bookingLabel} scheduled with ${appointmentResponse.data.provider?.name || getProviderLabel(selectedProvider)}`
        });
        
        // Small delay to ensure database is updated, then redirect
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Redirect to appointments list with refresh parameter to force reload
        router.push(`${config.appointmentHomePath}?refresh=${Date.now()}`);
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
      return date.toLocaleDateString(config.dateLocale, { weekday: 'short', month: 'short', day: 'numeric' });
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
    <div className="clinical-readable min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="hidden rounded-xl bg-[#101d36] p-3 sm:block"><DoctaRxLogo glow={false} className="h-8" /></span>
              <div>
                <h1 className="text-xl font-bold text-foreground">{config.title}</h1>
                <p className="text-sm text-muted-foreground">{config.subtitle}</p>
              </div>
            </div>
            <Button variant="ghost" onClick={() => router.push(config.appointmentHomePath)}>Cancel</Button>
          </div>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="max-w-5xl mx-auto px-4 py-6">
        <ol aria-label="Booking steps" className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
          {steps.map((step, index) => (
            <li key={step.id} aria-current={currentStep === step.id ? 'step' : undefined} className="flex min-w-0 flex-col items-start gap-2">
              <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all ${
                currentStep >= step.id
                  ? config.isNigeria ? 'bg-blue-600 border-blue-600 text-white' : 'bg-blue-500 border-blue-500 text-white'
                  : 'border-muted-foreground/30 text-muted-foreground'
              }`}>
                {currentStep > step.id ? <CheckCircle2 className="w-5 h-5" /> : <step.icon className="w-5 h-5" />}
              </div>
              <span className={`text-base font-medium ${
                currentStep >= step.id ? 'text-foreground' : 'text-muted-foreground'
              }`}>{step.title}</span>
            </li>
          ))}
        </ol>

        {config.pricing ? (
          <div className="mb-6 rounded-2xl border border-blue-200 bg-white/90 p-4 shadow-sm dark:border-blue-900/50 dark:bg-slate-950/70">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-semibold text-blue-800 dark:text-blue-200">{config.pricing.title}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{config.pricing.note}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {config.pricing.items.map((item) => (
                  <div key={item.label} className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 dark:border-blue-900/50 dark:bg-blue-950/30">
                    <p className="text-[11px] text-blue-800/80 dark:text-blue-200/80">{item.label}</p>
                    <p className="text-sm font-bold text-blue-950 dark:text-blue-100">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {/* Step Content */}
        <div className="bg-card rounded-2xl shadow-xl border border-border overflow-hidden">
          
          {/* Step 1: Health Issue Selection */}
          {currentStep === 1 && (
            <div className="p-6">
              <h2 className="text-2xl font-bold text-foreground mb-2">{config.healthPrompt}</h2>
              <p className="text-muted-foreground mb-6">{config.healthHelp}</p>
              
              <div className="grid md:grid-cols-3 gap-3">
                {HEALTH_CATEGORIES.map((category) => (
                  <button
                    key={category.id}
                    onClick={() => setSelectedCategory(category)}
                    className={`p-4 rounded-xl border-2 text-left transition-all hover:shadow-md ${
                      selectedCategory?.id === category.id
                        ? config.isNigeria ? 'border-blue-500 bg-blue-500/10 ring-2 ring-blue-500/30' : 'border-blue-500 bg-blue-500/10 ring-2 ring-blue-500/30'
                        : config.isNigeria ? 'border-border hover:border-blue-400 dark:hover:border-blue-500' : 'border-border hover:border-blue-400 dark:hover:border-blue-500'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        selectedCategory?.id === category.id
                          ? config.isNigeria ? 'bg-blue-600 text-white' : 'bg-blue-500 text-white'
                          : 'bg-muted text-muted-foreground'
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
                <Brain className={`w-6 h-6 ${config.isNigeria ? 'text-blue-600' : 'text-blue-500'}`} />
                AI Symptom Analysis
              </h2>
              <p className="text-muted-foreground mb-6">
                Analyzing your symptoms to help match you with the right provider. This does not replace clinical advice.
              </p>
              
              {isAnalyzing ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className={`w-12 h-12 animate-spin mb-4 ${config.isNigeria ? 'text-blue-600' : 'text-blue-500'}`} />
                  <p className="text-muted-foreground">Analyzing your symptoms...</p>
                </div>
              ) : triageResult ? (
                <div className="space-y-4">
                  <div className={`p-4 rounded-xl border ${
                    config.isNigeria
                      ? 'bg-gradient-to-br from-blue-500/10 to-blue-500/10 border-blue-500/30'
                      : 'bg-gradient-to-br from-blue-500/10 to-blue-500/10 border-blue-500/30'
                  }`}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Sparkles className={`w-5 h-5 ${config.isNigeria ? 'text-blue-600' : 'text-blue-500'}`} />
                        <h3 className="font-semibold text-foreground">AI Assessment</h3>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                          triageResult.severity >= 4
                            ? 'bg-red-500/20 text-red-700 dark:text-red-400'
                            : triageResult.severity >= 3
                            ? 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400'
                            : 'bg-blue-500/20 text-blue-700 dark:text-blue-400'
                        }`}>
                          Severity: {triageResult.severity}/5
                        </span>
                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                          config.isNigeria
                            ? 'bg-blue-500/20 text-blue-700 dark:text-blue-300'
                            : 'bg-blue-500/20 text-blue-700 dark:text-blue-400'
                        }`}>
                          {triageResult.triageLevel}
                        </span>
                      </div>
                    </div>
                    
                    <div className="mb-4">
                      <p className="text-sm font-medium text-muted-foreground mb-2">Recommended Specialty:</p>
                      <p className={`font-semibold ${config.isNigeria ? 'text-blue-700 dark:text-blue-300' : 'text-blue-700 dark:text-blue-400'}`}>{triageResult.suggestedSpecialty}</p>
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
                            <span key={idx} className="px-3 py-1 bg-blue-500/20 text-blue-700 dark:text-blue-400 rounded-full text-sm font-medium">
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
                  <p className="text-base text-muted-foreground">You can book without AI guidance. Your clinician will review your symptoms and history.</p>
                  <Button className="mt-4" variant="outline" onClick={runAITriage} disabled={isAnalyzing}>Request optional guidance</Button>
                  {guidanceUnavailable && <p role="status" className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-base leading-7 text-blue-950">{guidanceUnavailable}</p>}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Symptoms & Details */}
          {currentStep === 2 && (
            <div className="p-6">
              <h2 className="text-2xl font-bold text-foreground mb-2">{config.symptomPrompt}</h2>
              <p className="text-muted-foreground mb-6">{config.symptomHelp}</p>
              
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
                          visitType === type.value
                            ? config.isNigeria ? 'border-blue-500 bg-blue-500/10' : 'border-blue-500 bg-blue-500/10'
                            : config.isNigeria ? 'border-border hover:border-blue-400' : 'border-border hover:border-blue-400'
                        }`}
                      >
                        <type.icon className={`w-6 h-6 mb-2 ${visitType === type.value ? config.isNigeria ? 'text-blue-600 dark:text-blue-400' : 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`} />
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
                    placeholder={config.isNigeria ? 'Example: fever and body pains for 2 days, cough, headache, stomach pain...' : "Please describe what you're experiencing in detail..."}
                    className={`w-full mt-2 p-3 border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:ring-2 min-h-[120px] ${config.isNigeria ? 'focus:ring-blue-500 focus:border-blue-500' : 'focus:ring-blue-500 focus:border-blue-500'}`}
                  />
                </div>
                
                {/* Severity */}
                <div>
                  <Label className="text-foreground">How severe are your symptoms?</Label>
                  <div className="grid grid-cols-4 gap-2 mt-2">
                    {[
                      { value: 'mild', label: 'Mild', activeClasses: 'border-blue-500 bg-blue-500/20 text-blue-700 dark:text-blue-400' },
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
              <h2 className="text-2xl font-bold text-foreground mb-2">{config.schedulePrompt}</h2>
              <p className="text-muted-foreground mb-6">{config.scheduleHelp}</p>

              <div className="mb-6 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-sm font-medium text-foreground">{config.providerLabel}</Label>
                  {matchedProvider && (
                    <p className={`text-xs ${config.isNigeria ? 'text-blue-700 dark:text-blue-300' : 'text-blue-700 dark:text-blue-300'}`}>
                      Recommended: {getProviderLabel(matchedProvider)}
                    </p>
                  )}
                </div>

                {isLoadingProviders ? (
                  <div className="flex h-28 items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted">
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {config.providerLoading}
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
                              ? config.isNigeria ? 'border-blue-500 bg-blue-500/10 shadow-sm' : 'border-blue-500 bg-blue-500/10 shadow-sm'
                              : config.isNigeria ? 'border-border hover:border-blue-400 hover:bg-blue-500/5' : 'border-border hover:border-blue-400 hover:bg-blue-500/5'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`flex h-11 w-11 items-center justify-center rounded-full text-sm font-semibold text-white ${config.isNigeria ? 'bg-gradient-to-br from-blue-500 to-blue-700' : 'bg-gradient-to-br from-blue-500 to-blue-700'}`}>
                              {provider.firstName?.[0]}{provider.lastName?.[0]}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-semibold text-foreground">{getProviderLabel(provider)}</p>
                                {isRecommended && (
                                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${config.isNigeria ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300' : 'bg-blue-500/15 text-blue-700 dark:text-blue-300'}`}>
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
                            {isSelected && <CheckCircle2 className={`mt-1 h-5 w-5 ${config.isNigeria ? 'text-blue-500' : 'text-blue-500'}`} />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-medium text-amber-700 dark:text-amber-300">{config.noProviderTitle}</p>
                        <p className="mt-1 text-sm text-amber-700/90 dark:text-amber-300/90">
                          {providersError || config.noProviderHelp}
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
                            ? config.isNigeria
                              ? 'border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300'
                              : 'border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-400'
                            : config.isNigeria
                              ? 'border-border hover:border-blue-400'
                              : 'border-border hover:border-blue-400'
                        }`}
                      >
                        {(() => {
                          try {
                            const dateObj = new Date(date + 'T00:00:00');
                            if (isNaN(dateObj.getTime())) return <div>Invalid</div>;
                            return (
                              <>
                                <div className={`text-xs ${selectedDate === date ? config.isNigeria ? 'text-blue-700 dark:text-blue-300' : 'text-blue-600 dark:text-blue-300' : 'text-muted-foreground'}`}>
                                  {dateObj.toLocaleDateString(config.dateLocale, { weekday: 'short' })}
                                </div>
                                <div className={`font-semibold text-lg ${selectedDate === date ? '' : 'text-foreground'}`}>
                                  {dateObj.getDate()}
                                </div>
                                <div className={`text-xs ${selectedDate === date ? config.isNigeria ? 'text-blue-700 dark:text-blue-300' : 'text-blue-600 dark:text-blue-300' : 'text-muted-foreground'}`}>
                                  {dateObj.toLocaleDateString(config.dateLocale, { month: 'short' })}
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
                                      ? config.isNigeria ? 'border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-400 font-medium' : 'border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-400 font-medium'
                                      : config.isNigeria ? 'border-border hover:border-blue-400 text-foreground' : 'border-border hover:border-blue-400 text-foreground'
                                  }`}
                                >
                                  <span className="block">{formatTime(slot.time)}</span>
                                  {slot.isImmediate && (
                                    <span className={`mt-1 block text-[11px] uppercase tracking-wide ${config.isNigeria ? 'text-blue-700/80 dark:text-blue-300/80' : 'text-blue-700/80 dark:text-blue-300/80'}`}>
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
                    <div className={`mt-6 p-4 rounded-xl border ${config.isNigeria ? 'border-blue-500/30 bg-blue-500/10' : 'border-blue-500/30 bg-blue-500/10'}`}>
                      <div className="flex items-center gap-3">
                        <Calendar className={`w-5 h-5 ${config.isNigeria ? 'text-blue-600 dark:text-blue-400' : 'text-blue-600 dark:text-blue-400'}`} />
                        <div>
                          <p className={`font-medium ${config.isNigeria ? 'text-blue-700 dark:text-blue-400' : 'text-blue-700 dark:text-blue-400'}`}>{formattedDate} at {formattedTime}</p>
                          <p className={`text-sm ${config.isNigeria ? 'text-blue-600 dark:text-blue-300' : 'text-blue-600 dark:text-blue-300'}`}>30 minute {visitType} consultation</p>
                          <p className={`text-sm mt-1 ${config.isNigeria ? 'text-blue-700/90 dark:text-blue-300/90' : 'text-blue-700/90 dark:text-blue-300/90'}`}>
                            Provider: {selectedProvider ? getProviderLabel(selectedProvider) : 'Next available approved provider'}
                          </p>
                          <p className={`text-xs mt-1 ${config.isNigeria ? 'text-blue-700/70 dark:text-blue-300/70' : 'text-blue-700/70 dark:text-blue-300/70'}`}>Timezone: {timeZone}</p>
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
              <h2 className="text-2xl font-bold text-foreground mb-2">{config.coverageTitle}</h2>
              <p className="text-muted-foreground mb-6">{config.coverageHelp} <span className="font-medium text-foreground">{config.coverageOptional}</span></p>
              
              {hasExistingInsurance && (
                <div className="mb-6 p-4 bg-blue-500/10 rounded-xl border border-blue-500/30">
                  <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400">
                    <Shield className="w-5 h-5" />
                    <span className="font-medium">{config.isNigeria ? 'We have your coverage details on file' : 'We have your insurance on file'}</span>
                  </div>
                </div>
              )}
              
              <div className="mb-6 p-4 bg-amber-500/10 rounded-xl border border-amber-500/30">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                      <strong>Note:</strong> {config.coverageNotice}
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="space-y-6">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="insuranceProvider" className="text-foreground">{config.isNigeria ? 'HMO, NHIS, or Insurer' : 'Insurance Provider'}</Label>
                    <Input {...insuranceForm.register('insuranceProvider')} placeholder={config.isNigeria ? 'e.g., NHIS, Reliance HMO, Leadway Health' : 'e.g., Blue Cross'} className="mt-2 bg-background" />
                  </div>
                  <div>
                    <Label htmlFor="policyNumber" className="text-foreground">{config.isNigeria ? 'Coverage or ID Number' : 'Policy Number'}</Label>
                    <Input {...insuranceForm.register('policyNumber')} placeholder={config.isNigeria ? 'If known' : 'e.g., ABC123456'} className="mt-2 bg-background" />
                  </div>
                  <div>
                    <Label htmlFor="groupNumber" className="text-foreground">{config.isNigeria ? 'Organisation or Group' : 'Group Number'}</Label>
                    <Input {...insuranceForm.register('groupNumber')} placeholder={config.isNigeria ? 'If this is through an employer or group' : 'e.g., GRP001'} className="mt-2 bg-background" />
                  </div>
                  <div>
                    <Label htmlFor="subscriberName" className="text-foreground">{config.isNigeria ? 'Covered Person Name' : 'Subscriber Name'}</Label>
                    <Input {...insuranceForm.register('subscriberName')} placeholder={config.isNigeria ? 'Name on coverage record, if applicable' : 'Name on card'} className="mt-2 bg-background" />
                  </div>
                </div>
                
                {/* Card Upload */}
                <div className="border-t border-border pt-6">
                  <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                    <Camera className="w-5 h-5" /> {config.isNigeria ? 'Upload Coverage Card or Note' : 'Upload Insurance Card'}
                  </h3>
                  <div className="grid md:grid-cols-2 gap-4">
                    {[{ type: 'front', label: 'Front', state: insuranceFront, setState: setInsuranceFront },
                      { type: 'back', label: 'Back', state: insuranceBack, setState: setInsuranceBack }].map(({ type, label, state, setState }) => (
                      <div key={type}>
                        <Label className="text-sm text-foreground">{config.isNigeria ? `Coverage document ${label.toLowerCase()}` : `Card ${label}`}</Label>
                        <div className="mt-2">
                          {state ? (
                            <div className="relative">
                              <img src={state.preview} alt={config.isNigeria ? `Coverage document ${label.toLowerCase()}` : `Insurance ${label}`} className="w-full h-32 object-cover rounded-lg border border-border" />
                              <button onClick={() => setState(null)} className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center">
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <label className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-border rounded-lg cursor-pointer ${
                              config.isNigeria ? 'hover:border-blue-400 hover:bg-blue-500/5' : 'hover:border-blue-400 hover:bg-blue-500/5'
                            }`}>
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
              <h2 className="text-2xl font-bold text-foreground mb-2">{config.confirmTitle}</h2>
              <p className="text-muted-foreground mb-6">{config.confirmHelp}</p>
              <div className="mb-4 rounded-xl border border-slate-200 p-4 text-base">
                <p className="mb-2 font-semibold">Medication and allergy review</p>
                <p>Medications: {medications.trim() || 'Unknown / not supplied'}</p>
                <p>Allergies: {allergies.trim() || 'Unknown / not supplied'}</p>
                <label className="mt-4 flex min-h-11 items-start gap-3">
                  <input type="checkbox" className="mt-1 h-5 w-5" checked={historyReviewed} onChange={(event) => setHistoryReviewed(event.target.checked)} />
                  <span>I have reviewed this information. Unknown information will be reviewed with my clinician.</span>
                </label>
              </div>
              
              <div className="space-y-4">
                <div className="p-4 bg-muted rounded-xl">
                  <h3 className="font-semibold text-foreground mb-2 flex items-center gap-2"><Heart className="w-4 h-4" /> Health Concern</h3>
                  <p className="font-medium text-foreground">{selectedCategory?.name}</p>
                  <p className="text-sm text-muted-foreground mt-1">{symptoms}</p>
                </div>
                
                {triageResult && (
                  <div className={`p-4 rounded-xl border ${
                    config.isNigeria
                      ? 'bg-gradient-to-br from-blue-500/10 to-blue-500/10 border-blue-500/30'
                      : 'bg-gradient-to-br from-blue-500/10 to-blue-500/10 border-blue-500/30'
                  }`}>
                    <h3 className="font-semibold text-foreground mb-2 flex items-center gap-2">
                      <Brain className={`w-4 h-4 ${config.isNigeria ? 'text-blue-600' : 'text-blue-500'}`} /> AI Analysis
                    </h3>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${
                        triageResult.severity >= 4 ? 'bg-red-500/20 text-red-700 dark:text-red-400' :
                        triageResult.severity >= 3 ? 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400' :
                        'bg-blue-500/20 text-blue-700 dark:text-blue-400'
                      }`}>
                        Severity: {triageResult.severity}/5
                      </span>
                      <span className={`px-2 py-1 rounded text-xs font-bold ${
                        config.isNigeria
                          ? 'bg-blue-500/20 text-blue-700 dark:text-blue-300'
                          : 'bg-blue-500/20 text-blue-700 dark:text-blue-400'
                      }`}>
                        {triageResult.triageLevel}
                      </span>
                    </div>
                    <p className={`text-sm font-medium ${config.isNigeria ? 'text-blue-700 dark:text-blue-300' : 'text-blue-700 dark:text-blue-400'}`}>Recommended: {triageResult.suggestedSpecialty}</p>
                    {triageResult.flags && triageResult.flags.length > 0 && (
                      <p className="text-xs text-red-700 dark:text-red-400 mt-2">
                        Warning: {triageResult.flags.join(', ')}
                      </p>
                    )}
                  </div>
                )}
                
                <div className="p-4 bg-muted rounded-xl">
                  <h3 className="font-semibold text-foreground mb-2 flex items-center gap-2"><Calendar className="w-4 h-4" /> {config.bookingLabel}</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div><span className="text-muted-foreground">Date:</span><p className="font-medium text-foreground">{selectedDate ? formatDate(selectedDate) : 'Not selected'}</p></div>
                    <div><span className="text-muted-foreground">Time:</span><p className="font-medium text-foreground">{selectedTime ? formatTime(selectedTime) : 'Not selected'}</p></div>
                    <div><span className="text-muted-foreground">Type:</span><p className="font-medium text-foreground capitalize">{visitType || 'video'}</p></div>
                    <div><span className="text-muted-foreground">Duration:</span><p className="font-medium text-foreground">30 minutes</p></div>
                    <div className="col-span-2"><span className="text-muted-foreground">Doctor:</span><p className="font-medium text-foreground">{selectedProvider ? getProviderLabel(selectedProvider) : 'Next available approved provider'}</p></div>
                  </div>
                </div>
                
                <div className="p-4 bg-muted rounded-xl">
                  <h3 className="font-semibold text-foreground mb-2 flex items-center gap-2"><CreditCard className="w-4 h-4" /> {config.coverageTitle}</h3>
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
                            <p className="text-sm text-muted-foreground">{config.isNigeria ? 'Coverage ID' : 'Policy'}: {insuranceData.policyNumber}</p>
                          )}
                        </>
                      );
                    }
                    return (
                      <p className="text-muted-foreground italic">
                        {config.isNigeria
                          ? 'No coverage details provided. The consultation fee or coverage will be confirmed by DoctaRx Nigeria.'
                          : 'No insurance provided. You can add insurance later in your profile.'}
                      </p>
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
                    {config.isNigeria ? 'Skip Coverage' : 'Skip Insurance'} <ChevronRight className="w-4 h-4" />
                  </Button>
                )}
                <Button onClick={nextStep} className={`${config.isNigeria ? 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800' : 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800'} text-white flex items-center gap-2`}>
                  Continue <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <Button onClick={submitBooking} disabled={isLoading} className={`${config.isNigeria ? 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800' : 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800'} text-white flex items-center gap-2`}>
                {isLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> {config.isNigeria ? 'Requesting...' : 'Booking...'}</> : <><CheckCircle2 className="w-4 h-4" /> {config.isNigeria ? 'Request Consultation' : 'Confirm Booking'}</>}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
