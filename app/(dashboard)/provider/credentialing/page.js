'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { 
  CheckCircle2, Circle, Clock, AlertCircle, FileText, Upload,
  User, Stethoscope, Award, Shield, GraduationCap, Briefcase,
  Users, CreditCard, ArrowRight, ArrowLeft, Loader2, X,
  Building, Phone, Mail, Calendar, Lock, FileCheck
} from 'lucide-react';
import { providerAPI } from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';
import { Progress } from '@/components/ui/progress';

// Step configuration with icons
const STEPS = [
  { number: 1, name: 'Application Fee', key: 'payment', icon: CreditCard },
  { number: 2, name: 'Personal Info', key: 'personal', icon: User },
  { number: 3, name: 'Professional Info', key: 'professional', icon: Stethoscope },
  { number: 4, name: 'Medical License', key: 'license', icon: Award },
  { number: 5, name: 'DEA Registration', key: 'dea', icon: Shield },
  { number: 6, name: 'NPI Verification', key: 'npi', icon: FileCheck },
  { number: 7, name: 'Education', key: 'education', icon: GraduationCap },
  { number: 8, name: 'Board Certification', key: 'board', icon: Award },
  { number: 9, name: 'Malpractice Insurance', key: 'malpractice', icon: Shield },
  { number: 10, name: 'Work History', key: 'work', icon: Briefcase },
  { number: 11, name: 'References', key: 'references', icon: Users },
  { number: 12, name: 'Background Check', key: 'background', icon: Lock },
  { number: 13, name: 'Documents', key: 'documents', icon: FileText },
  { number: 14, name: 'Review', key: 'review', icon: Clock },
  { number: 15, name: 'Approval', key: 'approval', icon: CheckCircle2 }
];

const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut',
  'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
  'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan',
  'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
  'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio',
  'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
  'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia',
  'Wisconsin', 'Wyoming'
];

const SPECIALTIES = [
  'Family Medicine', 'Internal Medicine', 'Pediatrics', 'Psychiatry', 'Dermatology',
  'Cardiology', 'Neurology', 'Orthopedics', 'OB/GYN', 'Emergency Medicine',
  'Anesthesiology', 'Radiology', 'Pathology', 'General Surgery', 'Urology',
  'Ophthalmology', 'ENT', 'Rheumatology', 'Endocrinology', 'Gastroenterology',
  'Pulmonology', 'Nephrology', 'Oncology', 'Infectious Disease', 'Other'
];

function CredentialingContent() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [credentialing, setCredentialing] = useState(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState({});

  // Check for payment success/cancel from URL
  useEffect(() => {
    const payment = searchParams.get('payment');
    if (payment === 'success') {
      toast({
        title: 'Payment Successful',
        description: 'Your credentialing fee has been processed. You can now continue with the application.',
      });
    } else if (payment === 'cancelled') {
      toast({
        title: 'Payment Cancelled',
        description: 'Your payment was cancelled. Please complete payment to proceed.',
        variant: 'destructive'
      });
    }
  }, [searchParams]);

  useEffect(() => {
    fetchCredentialing();
  }, []);

  const fetchCredentialing = async () => {
    try {
      const response = await providerAPI.getCredentialing();
      if (response.data.success) {
        setCredentialing(response.data.credentialing);
        
        // Pre-fill form data from existing credentialing
        const cred = response.data.credentialing;
        setFormData({
          legalFirstName: cred.legalFirstName || '',
          legalMiddleName: cred.legalMiddleName || '',
          legalLastName: cred.legalLastName || '',
          dateOfBirth: cred.dateOfBirth ? cred.dateOfBirth.split('T')[0] : '',
          ssnLastFour: cred.ssnLastFour || '',
          gender: cred.gender || '',
          primaryAddress: cred.primaryAddress || '',
          city: cred.city || '',
          state: cred.state || '',
          zipCode: cred.zipCode || '',
          specialty: cred.specialty || '',
          subspecialties: cred.subspecialties || [],
          yearsInPractice: cred.yearsInPractice || 0,
          practiceType: cred.practiceType || '',
          medicalLicenseNumber: cred.medicalLicenseNumber || '',
          medicalLicenseState: cred.medicalLicenseState || '',
          medicalLicenseExpiry: cred.medicalLicenseExpiry ? cred.medicalLicenseExpiry.split('T')[0] : '',
          deaNumber: cred.deaNumber || '',
          deaExpiry: cred.deaExpiry ? cred.deaExpiry.split('T')[0] : '',
          npiNumber: cred.npiNumber || '',
          medicalSchool: cred.medicalSchool || '',
          graduationYear: cred.graduationYear || '',
          degreeType: cred.degreeType || '',
          residencyProgram: cred.residencyProgram || '',
          residencyCompletionYear: cred.residencyCompletionYear || '',
          fellowshipProgram: cred.fellowshipProgram || '',
          fellowshipCompletionYear: cred.fellowshipCompletionYear || '',
          boardCertified: cred.boardCertified || false,
          boardName: cred.boardName || '',
          boardCertificationNumber: cred.boardCertificationNumber || '',
          boardCertificationExpiry: cred.boardCertificationExpiry ? cred.boardCertificationExpiry.split('T')[0] : '',
          malpracticeCarrier: cred.malpracticeCarrier || '',
          malpracticePolicyNumber: cred.malpracticePolicyNumber || '',
          malpracticeCoverageAmount: cred.malpracticeCoverageAmount || '',
          malpracticeExpiry: cred.malpracticeExpiry ? cred.malpracticeExpiry.split('T')[0] : ''
        });
        
        // Set current step based on progress
        if (!cred.paymentCompleted) {
          setCurrentStep(1);
        } else {
          // Find first incomplete step
          const steps = response.data.credentialing.steps || [];
          const firstIncomplete = steps.find(s => s.status !== 'approved');
          if (firstIncomplete) {
            setCurrentStep(firstIncomplete.stepNumber);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching credentialing:', error);
      toast({
        title: 'Error',
        description: 'Failed to load credentialing data',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handlePayment = async () => {
    try {
      setSaving(true);
      const response = await fetch('/api/stripe/checkout/credentialing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
        },
        body: JSON.stringify({ packageType: 'fullCredentialing' })
      });
      
      const data = await response.json();
      
      if (data.success && data.checkout?.url) {
        window.location.href = data.checkout.url;
      } else {
        throw new Error(data.error || 'Failed to create checkout session');
      }
    } catch (error) {
      toast({
        title: 'Payment Error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const saveCurrentStep = async () => {
    setSaving(true);
    try {
      let endpoint = '';
      let data = {};

      switch (currentStep) {
        case 2: // Personal Info
          endpoint = '/api/credentialing/personal-info';
          data = {
            legalFirstName: formData.legalFirstName,
            legalMiddleName: formData.legalMiddleName,
            legalLastName: formData.legalLastName,
            dateOfBirth: formData.dateOfBirth,
            ssnLastFour: formData.ssnLastFour,
            gender: formData.gender,
            primaryAddress: formData.primaryAddress,
            city: formData.city,
            state: formData.state,
            zipCode: formData.zipCode
          };
          break;
        case 3: // Professional Info
          endpoint = '/api/credentialing/professional-info';
          data = {
            specialty: formData.specialty,
            subspecialties: formData.subspecialties || [],
            yearsInPractice: parseInt(formData.yearsInPractice) || 0,
            practiceType: formData.practiceType
          };
          break;
        case 4: // License
          endpoint = '/api/credentialing/license';
          data = {
            medicalLicenseNumber: formData.medicalLicenseNumber,
            medicalLicenseState: formData.medicalLicenseState,
            medicalLicenseExpiry: formData.medicalLicenseExpiry
          };
          break;
        case 5: // DEA
          endpoint = '/api/credentialing/dea';
          data = {
            deaNumber: formData.deaNumber,
            deaExpiry: formData.deaExpiry
          };
          break;
        case 6: // NPI
          endpoint = '/api/credentialing/npi';
          data = { npiNumber: formData.npiNumber };
          break;
        case 7: // Education
          endpoint = '/api/credentialing/education';
          data = {
            medicalSchool: formData.medicalSchool,
            graduationYear: parseInt(formData.graduationYear),
            degreeType: formData.degreeType,
            residencyProgram: formData.residencyProgram,
            residencyCompletionYear: formData.residencyCompletionYear ? parseInt(formData.residencyCompletionYear) : null,
            fellowshipProgram: formData.fellowshipProgram,
            fellowshipCompletionYear: formData.fellowshipCompletionYear ? parseInt(formData.fellowshipCompletionYear) : null
          };
          break;
        case 8: // Board Certification
          endpoint = '/api/credentialing/board-certification';
          data = {
            boardCertified: formData.boardCertified,
            boardName: formData.boardName,
            boardCertificationNumber: formData.boardCertificationNumber,
            boardCertificationExpiry: formData.boardCertificationExpiry
          };
          break;
        case 9: // Malpractice
          endpoint = '/api/credentialing/malpractice';
          data = {
            malpracticeCarrier: formData.malpracticeCarrier,
            malpracticePolicyNumber: formData.malpracticePolicyNumber,
            malpracticeCoverageAmount: parseFloat(formData.malpracticeCoverageAmount),
            malpracticeExpiry: formData.malpracticeExpiry
          };
          break;
        case 12: // Background Check Consent
          endpoint = '/api/credentialing/background-check/consent';
          break;
        default:
          // For steps that don't require saving (work history, references, documents)
          setCurrentStep(prev => Math.min(prev + 1, 15));
          return;
      }

      if (endpoint) {
        const response = await fetch(endpoint, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
          },
          body: JSON.stringify(data)
        });

        const result = await response.json();
        
        if (result.success) {
          toast({
            title: 'Saved',
            description: 'Your information has been saved'
          });
          await fetchCredentialing();
          setCurrentStep(prev => Math.min(prev + 1, 15));
        } else {
          throw new Error(result.error || 'Failed to save');
        }
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const getStepStatus = (stepNumber) => {
    if (!credentialing?.steps) return 'not_started';
    const step = credentialing.steps.find(s => s.stepNumber === stepNumber);
    return step?.status || 'not_started';
  };

  const getStepIcon = (stepNumber) => {
    const status = getStepStatus(stepNumber);
    const StepIcon = STEPS.find(s => s.number === stepNumber)?.icon || Circle;
    
    if (status === 'approved') {
      return <CheckCircle2 className="w-5 h-5 text-green-500" />;
    } else if (status === 'pending_review') {
      return <Clock className="w-5 h-5 text-amber-500" />;
    } else if (status === 'rejected' || status === 'requires_resubmission') {
      return <AlertCircle className="w-5 h-5 text-red-500" />;
    } else if (stepNumber === currentStep) {
      return <StepIcon className="w-5 h-5 text-purple-600" />;
    }
    return <Circle className="w-5 h-5 text-muted-foreground" />;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-serif text-foreground">Provider Credentialing</h1>
          <p className="text-muted-foreground mt-1">
            Complete your credentialing to start seeing patients
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Progress:</span>
          <span className="text-2xl font-bold text-purple-600">
            {credentialing?.progressPercentage || 0}%
          </span>
        </div>
      </div>

      {/* Progress Bar */}
      <Card>
        <CardContent className="pt-6">
          <Progress value={credentialing?.progressPercentage || 0} className="h-3" />
          <div className="flex justify-between mt-2 text-sm text-muted-foreground">
            <span>Started</span>
            <span>In Review</span>
            <span>Approved</span>
          </div>
        </CardContent>
      </Card>

      {/* Status Banner */}
      {credentialing?.status === 'approved' && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-green-500" />
            <div>
              <p className="font-medium text-green-700 dark:text-green-400">Credentialing Approved!</p>
              <p className="text-sm text-green-600 dark:text-green-300">
                Your credentials have been verified. You can now see patients.
              </p>
            </div>
          </div>
        </div>
      )}

      {credentialing?.status === 'rejected' && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-6 h-6 text-red-500" />
            <div>
              <p className="font-medium text-red-700 dark:text-red-400">Application Rejected</p>
              <p className="text-sm text-red-600 dark:text-red-300">
                {credentialing.rejectionReason || 'Please contact support for more information.'}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-4 gap-6">
        {/* Steps Sidebar */}
        <Card className="lg:col-span-1 h-fit">
          <CardHeader>
            <CardTitle className="text-lg">Credentialing Steps</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {STEPS.map((step) => (
              <button
                key={step.number}
                onClick={() => credentialing?.paymentCompleted && setCurrentStep(step.number)}
                disabled={!credentialing?.paymentCompleted && step.number !== 1}
                className={`w-full flex items-center gap-3 p-2 rounded-lg transition-colors text-left ${
                  currentStep === step.number
                    ? 'bg-purple-100 dark:bg-purple-900/30'
                    : 'hover:bg-muted'
                } ${!credentialing?.paymentCompleted && step.number !== 1 ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {getStepIcon(step.number)}
                <span className={`text-sm ${currentStep === step.number ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                  {step.name}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Main Content */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>{STEPS[currentStep - 1]?.name}</CardTitle>
            <CardDescription>
              Step {currentStep} of {STEPS.length}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Step 1: Payment */}
            {currentStep === 1 && (
              <div className="space-y-6">
                <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-6">
                  <h3 className="text-lg font-medium text-foreground mb-2">
                    Credentialing Application Fee
                  </h3>
                  <p className="text-muted-foreground mb-4">
                    A one-time fee of <span className="font-bold text-2xl text-purple-600">$199</span> is required to process your credentialing application.
                  </p>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                      Complete background verification
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                      License verification with state boards
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                      DEA & NPI verification
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                      Priority processing (5-7 business days)
                    </li>
                  </ul>
                </div>

                {credentialing?.paymentCompleted ? (
                  <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 flex items-center gap-3">
                    <CheckCircle2 className="w-6 h-6 text-green-500" />
                    <span className="text-green-700 dark:text-green-400 font-medium">
                      Payment completed on {new Date(credentialing.paymentDate).toLocaleDateString()}
                    </span>
                  </div>
                ) : (
                  <Button
                    onClick={handlePayment}
                    disabled={saving}
                    className="bg-purple-600 hover:bg-purple-700"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <CreditCard className="w-4 h-4 mr-2" />
                        Pay $199 to Start Application
                      </>
                    )}
                  </Button>
                )}
              </div>
            )}

            {/* Step 2: Personal Information */}
            {currentStep === 2 && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Legal First Name *</Label>
                    <Input
                      value={formData.legalFirstName}
                      onChange={(e) => handleInputChange('legalFirstName', e.target.value)}
                      placeholder="First name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Legal Middle Name</Label>
                    <Input
                      value={formData.legalMiddleName}
                      onChange={(e) => handleInputChange('legalMiddleName', e.target.value)}
                      placeholder="Middle name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Legal Last Name *</Label>
                    <Input
                      value={formData.legalLastName}
                      onChange={(e) => handleInputChange('legalLastName', e.target.value)}
                      placeholder="Last name"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Date of Birth *</Label>
                    <Input
                      type="date"
                      value={formData.dateOfBirth}
                      onChange={(e) => handleInputChange('dateOfBirth', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>SSN Last 4 Digits</Label>
                    <Input
                      maxLength={4}
                      value={formData.ssnLastFour}
                      onChange={(e) => handleInputChange('ssnLastFour', e.target.value.replace(/\D/g, ''))}
                      placeholder="XXXX"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Gender</Label>
                  <select
                    value={formData.gender}
                    onChange={(e) => handleInputChange('gender', e.target.value)}
                    className="w-full p-2 border rounded-md bg-background"
                  >
                    <option value="">Select...</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                    <option value="prefer_not_to_say">Prefer not to say</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label>Primary Address *</Label>
                  <Input
                    value={formData.primaryAddress}
                    onChange={(e) => handleInputChange('primaryAddress', e.target.value)}
                    placeholder="Street address"
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>City *</Label>
                    <Input
                      value={formData.city}
                      onChange={(e) => handleInputChange('city', e.target.value)}
                      placeholder="City"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>State *</Label>
                    <select
                      value={formData.state}
                      onChange={(e) => handleInputChange('state', e.target.value)}
                      className="w-full p-2 border rounded-md bg-background"
                    >
                      <option value="">Select state...</option>
                      {US_STATES.map(state => (
                        <option key={state} value={state}>{state}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>ZIP Code *</Label>
                    <Input
                      value={formData.zipCode}
                      onChange={(e) => handleInputChange('zipCode', e.target.value)}
                      placeholder="12345"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Professional Information */}
            {currentStep === 3 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Primary Specialty *</Label>
                  <select
                    value={formData.specialty}
                    onChange={(e) => handleInputChange('specialty', e.target.value)}
                    className="w-full p-2 border rounded-md bg-background"
                  >
                    <option value="">Select specialty...</option>
                    {SPECIALTIES.map(spec => (
                      <option key={spec} value={spec}>{spec}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Years in Practice *</Label>
                    <Input
                      type="number"
                      min="0"
                      value={formData.yearsInPractice}
                      onChange={(e) => handleInputChange('yearsInPractice', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Practice Type *</Label>
                    <select
                      value={formData.practiceType}
                      onChange={(e) => handleInputChange('practiceType', e.target.value)}
                      className="w-full p-2 border rounded-md bg-background"
                    >
                      <option value="">Select type...</option>
                      <option value="solo">Solo Practice</option>
                      <option value="group">Group Practice</option>
                      <option value="hospital">Hospital-Based</option>
                      <option value="academic">Academic</option>
                      <option value="telehealth_only">Telehealth Only</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Step 4: License */}
            {currentStep === 4 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Medical License Number *</Label>
                    <Input
                      value={formData.medicalLicenseNumber}
                      onChange={(e) => handleInputChange('medicalLicenseNumber', e.target.value)}
                      placeholder="License number"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>License State *</Label>
                    <select
                      value={formData.medicalLicenseState}
                      onChange={(e) => handleInputChange('medicalLicenseState', e.target.value)}
                      className="w-full p-2 border rounded-md bg-background"
                    >
                      <option value="">Select state...</option>
                      {US_STATES.map(state => (
                        <option key={state} value={state}>{state}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>License Expiry Date *</Label>
                  <Input
                    type="date"
                    value={formData.medicalLicenseExpiry}
                    onChange={(e) => handleInputChange('medicalLicenseExpiry', e.target.value)}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  Your license will be verified directly with the state medical board.
                </p>
              </div>
            )}

            {/* Step 5: DEA */}
            {currentStep === 5 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>DEA Registration Number *</Label>
                  <Input
                    value={formData.deaNumber}
                    onChange={(e) => handleInputChange('deaNumber', e.target.value)}
                    placeholder="DEA number"
                  />
                </div>
                <div className="space-y-2">
                  <Label>DEA Expiry Date *</Label>
                  <Input
                    type="date"
                    value={formData.deaExpiry}
                    onChange={(e) => handleInputChange('deaExpiry', e.target.value)}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  Required for prescribing controlled substances.
                </p>
              </div>
            )}

            {/* Step 6: NPI */}
            {currentStep === 6 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>NPI Number *</Label>
                  <Input
                    maxLength={10}
                    value={formData.npiNumber}
                    onChange={(e) => handleInputChange('npiNumber', e.target.value.replace(/\D/g, ''))}
                    placeholder="10-digit NPI number"
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  Your National Provider Identifier (NPI) is a unique 10-digit number used to identify healthcare providers.
                </p>
              </div>
            )}

            {/* Step 7: Education */}
            {currentStep === 7 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Medical School *</Label>
                  <Input
                    value={formData.medicalSchool}
                    onChange={(e) => handleInputChange('medicalSchool', e.target.value)}
                    placeholder="Medical school name"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Graduation Year *</Label>
                    <Input
                      type="number"
                      min="1950"
                      max={new Date().getFullYear()}
                      value={formData.graduationYear}
                      onChange={(e) => handleInputChange('graduationYear', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Degree Type *</Label>
                    <select
                      value={formData.degreeType}
                      onChange={(e) => handleInputChange('degreeType', e.target.value)}
                      className="w-full p-2 border rounded-md bg-background"
                    >
                      <option value="">Select...</option>
                      <option value="MD">MD (Doctor of Medicine)</option>
                      <option value="DO">DO (Doctor of Osteopathic Medicine)</option>
                      <option value="NP">NP (Nurse Practitioner)</option>
                      <option value="PA">PA (Physician Assistant)</option>
                      <option value="MBBS">MBBS</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Residency Program</Label>
                  <Input
                    value={formData.residencyProgram}
                    onChange={(e) => handleInputChange('residencyProgram', e.target.value)}
                    placeholder="Residency program name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Residency Completion Year</Label>
                  <Input
                    type="number"
                    min="1950"
                    max={new Date().getFullYear()}
                    value={formData.residencyCompletionYear}
                    onChange={(e) => handleInputChange('residencyCompletionYear', e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Step 8: Board Certification */}
            {currentStep === 8 && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={formData.boardCertified}
                    onChange={(e) => handleInputChange('boardCertified', e.target.checked)}
                    className="w-4 h-4"
                  />
                  <Label>I am board certified</Label>
                </div>

                {formData.boardCertified && (
                  <>
                    <div className="space-y-2">
                      <Label>Certifying Board *</Label>
                      <Input
                        value={formData.boardName}
                        onChange={(e) => handleInputChange('boardName', e.target.value)}
                        placeholder="e.g., American Board of Internal Medicine"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Certification Number</Label>
                        <Input
                          value={formData.boardCertificationNumber}
                          onChange={(e) => handleInputChange('boardCertificationNumber', e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Expiry Date</Label>
                        <Input
                          type="date"
                          value={formData.boardCertificationExpiry}
                          onChange={(e) => handleInputChange('boardCertificationExpiry', e.target.value)}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Step 9: Malpractice Insurance */}
            {currentStep === 9 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Insurance Carrier *</Label>
                  <Input
                    value={formData.malpracticeCarrier}
                    onChange={(e) => handleInputChange('malpracticeCarrier', e.target.value)}
                    placeholder="Insurance company name"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Policy Number *</Label>
                    <Input
                      value={formData.malpracticePolicyNumber}
                      onChange={(e) => handleInputChange('malpracticePolicyNumber', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Coverage Amount *</Label>
                    <Input
                      type="number"
                      value={formData.malpracticeCoverageAmount}
                      onChange={(e) => handleInputChange('malpracticeCoverageAmount', e.target.value)}
                      placeholder="1000000"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Policy Expiry Date *</Label>
                  <Input
                    type="date"
                    value={formData.malpracticeExpiry}
                    onChange={(e) => handleInputChange('malpracticeExpiry', e.target.value)}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  Minimum coverage of $1,000,000/$3,000,000 is required.
                </p>
              </div>
            )}

            {/* Step 10: Work History */}
            {currentStep === 10 && (
              <div className="space-y-4">
                <p className="text-muted-foreground">
                  Please provide your complete work history for the past 10 years. Any gaps must be explained.
                </p>
                {credentialing?.workHistory?.length > 0 ? (
                  <div className="space-y-3">
                    {credentialing.workHistory.map((work, index) => (
                      <div key={index} className="p-4 border rounded-lg">
                        <p className="font-medium">{work.employerName}</p>
                        <p className="text-sm text-muted-foreground">{work.positionTitle}</p>
                        <p className="text-sm text-muted-foreground">
                          {new Date(work.startDate).toLocaleDateString()} - {work.isCurrent ? 'Present' : new Date(work.endDate).toLocaleDateString()}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-amber-600 dark:text-amber-400">No work history added yet</p>
                )}
                <Button variant="outline" onClick={() => {/* TODO: Add work history modal */}}>
                  <Briefcase className="w-4 h-4 mr-2" />
                  Add Work History
                </Button>
              </div>
            )}

            {/* Step 11: References */}
            {currentStep === 11 && (
              <div className="space-y-4">
                <p className="text-muted-foreground">
                  Please provide at least 3 professional references (colleagues or supervisors).
                </p>
                {credentialing?.references?.length > 0 ? (
                  <div className="space-y-3">
                    {credentialing.references.map((ref, index) => (
                      <div key={index} className="p-4 border rounded-lg">
                        <p className="font-medium">{ref.referenceName}</p>
                        <p className="text-sm text-muted-foreground">{ref.referenceTitle} at {ref.referenceOrganization}</p>
                        <p className="text-sm text-muted-foreground">{ref.referenceEmail}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-amber-600 dark:text-amber-400">No references added yet</p>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-sm">
                    {credentialing?.referencesSubmitted || 0} of {credentialing?.referencesRequired || 3} references submitted
                  </span>
                </div>
                <Button variant="outline" onClick={() => {/* TODO: Add reference modal */}}>
                  <Users className="w-4 h-4 mr-2" />
                  Add Reference
                </Button>
              </div>
            )}

            {/* Step 12: Background Check */}
            {currentStep === 12 && (
              <div className="space-y-4">
                <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4">
                  <h4 className="font-medium text-amber-800 dark:text-amber-200">Background Check Required</h4>
                  <p className="text-sm text-amber-700 dark:text-amber-300 mt-2">
                    As part of the credentialing process, we conduct a comprehensive background check that includes:
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-amber-700 dark:text-amber-300">
                    <li>• Criminal history verification</li>
                    <li>• OIG/GSA exclusion list check</li>
                    <li>• NPDB query</li>
                    <li>• State license verification</li>
                  </ul>
                </div>

                {credentialing?.backgroundCheckConsent ? (
                  <div className="flex items-center gap-3 text-green-600">
                    <CheckCircle2 className="w-5 h-5" />
                    <span>Background check consent provided on {new Date(credentialing.backgroundCheckSubmittedAt).toLocaleDateString()}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <input type="checkbox" id="consent" className="w-4 h-4" />
                    <label htmlFor="consent" className="text-sm">
                      I consent to the background check and authorize Docta. to verify my credentials.
                    </label>
                  </div>
                )}
              </div>
            )}

            {/* Step 13: Documents */}
            {currentStep === 13 && (
              <div className="space-y-4">
                <p className="text-muted-foreground">
                  Upload copies of your credentials for verification.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { type: 'medical_license', label: 'Medical License' },
                    { type: 'dea_certificate', label: 'DEA Certificate' },
                    { type: 'board_certification', label: 'Board Certification' },
                    { type: 'malpractice_insurance', label: 'Malpractice Insurance' },
                    { type: 'photo_id', label: 'Government Photo ID' },
                    { type: 'cv_resume', label: 'CV/Resume' }
                  ].map(docType => {
                    const uploaded = credentialing?.documents?.find(d => d.documentType === docType.type);
                    return (
                      <div key={docType.type} className={`p-4 border rounded-lg ${uploaded ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : ''}`}>
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{docType.label}</span>
                          {uploaded ? (
                            <CheckCircle2 className="w-5 h-5 text-green-500" />
                          ) : (
                            <Upload className="w-5 h-5 text-muted-foreground" />
                          )}
                        </div>
                        {uploaded && (
                          <p className="text-xs text-muted-foreground mt-1">{uploaded.documentName}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
                <Button variant="outline">
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Document
                </Button>
              </div>
            )}

            {/* Step 14: Review */}
            {currentStep === 14 && (
              <div className="space-y-4">
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
                  <h4 className="font-medium text-blue-800 dark:text-blue-200">Committee Review</h4>
                  <p className="text-sm text-blue-700 dark:text-blue-300 mt-2">
                    Your application is being reviewed by our credentialing committee. This typically takes 5-7 business days.
                  </p>
                </div>
                <p className="text-muted-foreground">
                  Status: {credentialing?.status === 'committee_review' ? 'Under Review' : 'Pending'}
                </p>
              </div>
            )}

            {/* Step 15: Approval */}
            {currentStep === 15 && (
              <div className="space-y-4">
                {credentialing?.status === 'approved' ? (
                  <div className="text-center py-8">
                    <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
                    <h3 className="text-2xl font-bold text-green-600">Congratulations!</h3>
                    <p className="text-muted-foreground mt-2">
                      Your credentialing has been approved. You can now start seeing patients.
                    </p>
                    <p className="text-sm text-muted-foreground mt-4">
                      Valid until: {new Date(credentialing.approvalExpiry).toLocaleDateString()}
                    </p>
                    <Button className="mt-6" onClick={() => router.push('/provider/dashboard')}>
                      Go to Dashboard
                    </Button>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Clock className="w-16 h-16 text-amber-500 mx-auto mb-4" />
                    <h3 className="text-xl font-medium">Awaiting Approval</h3>
                    <p className="text-muted-foreground mt-2">
                      Complete all previous steps to proceed with final approval.
                    </p>
                  </div>
                )}
              </div>
            )}
          </CardContent>

          <CardFooter className="flex justify-between">
            <Button
              variant="outline"
              onClick={() => setCurrentStep(prev => Math.max(prev - 1, 1))}
              disabled={currentStep === 1}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Previous
            </Button>

            {currentStep < 14 && (
              <Button
                onClick={saveCurrentStep}
                disabled={saving || (currentStep === 1 && !credentialing?.paymentCompleted)}
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    Save & Continue
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

function CredentialingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="flex items-center gap-2">
        <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
        <span className="text-muted-foreground">Loading...</span>
      </div>
    </div>
  );
}

export default function ProviderCredentialingPage() {
  return (
    <Suspense fallback={<CredentialingFallback />}>
      <CredentialingContent />
    </Suspense>
  );
}
