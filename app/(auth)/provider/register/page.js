'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, Mail, Lock, User, Stethoscope, Shield, Loader2, CheckCircle, Building2, BadgeCheck, Phone } from 'lucide-react';
import { authAPI } from '@/lib/api';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function ProviderRegisterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get('token');
  
  const [isLoading, setIsLoading] = useState(false);
  const [validatingToken, setValidatingToken] = useState(!!inviteToken);
  const [inviteData, setInviteData] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    specialty: '',
    npiNumber: '',
    medicalLicense: '',
    password: '',
    confirmPassword: '',
    acceptCompliance: false
  });

  // Validate invite token if provided (optional)
  useEffect(() => {
    const validateToken = async () => {
      if (!inviteToken) {
        setValidatingToken(false);
        return;
      }

      try {
        const response = await authAPI.validateInvite(inviteToken);
        if (response.data.success) {
          setInviteData(response.data.invite);
          setFormData(prev => ({
            ...prev,
            email: response.data.invite.email || '',
            firstName: response.data.invite.firstName || '',
            lastName: response.data.invite.lastName || ''
          }));
        }
      } catch (error) {
        // Token invalid, but allow registration anyway
        toast({
          title: 'Note',
          description: 'Invitation link expired, but you can still register.',
        });
      } finally {
        setValidatingToken(false);
      }
    };

    validateToken();
  }, [inviteToken]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (formData.password !== formData.confirmPassword) {
      toast({
        title: 'Password Mismatch',
        description: 'Passwords do not match',
        variant: 'destructive'
      });
      return;
    }

    if (formData.password.length < 8) {
      toast({
        title: 'Password Too Short',
        description: 'Password must be at least 8 characters',
        variant: 'destructive'
      });
      return;
    }

    setIsLoading(true);

    try {
      const response = await authAPI.registerProvider({
        ...formData,
        inviteToken: inviteToken || undefined,
        role: 'provider'
      });

      if (response.data.success) {
        toast({
          title: 'Registration Successful!',
          description: 'Application submitted. Next: sign in to complete credentialing and provider checkout.',
        });
        router.push('/provider/login?registered=true');
      }
    } catch (error) {
      const message = error.response?.data?.error || 'Registration failed. Please try again.';
      toast({
        title: 'Registration Failed',
        description: message,
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Show loading while validating token
  if (validatingToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-purple-400 mx-auto mb-4" />
          <p className="text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Header */}
      <header className="p-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl flex items-center justify-center">
            <span className="text-white font-bold text-xl">D</span>
          </div>
          <span className="text-2xl font-bold text-white">
            Docta<span className="text-purple-400">.</span>
          </span>
        </Link>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-lg">
          <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 rounded-2xl shadow-2xl p-8">
            {/* Icon & Title */}
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Stethoscope className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-white">Provider Registration</h1>
              <p className="text-slate-400 mt-2">Simple onboarding with compliant credential review and activation</p>
            </div>

            {/* Invite Info Banner (if from invite) */}
            {inviteData && (
              <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4 mb-6">
                <div className="flex items-center gap-3">
                  <BadgeCheck className="w-5 h-5 text-purple-400" />
                  <div>
                    <p className="text-sm text-purple-200">Invited by {inviteData.invitedByName || 'Administrator'}</p>
                    <p className="text-xs text-purple-300/70">{inviteData.organizationName || 'Docta Healthcare'}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Verification Notice */}
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-6">
              <div className="flex items-start gap-3">
                <Shield className="w-5 h-5 text-amber-400 mt-0.5" />
                <div>
                  <p className="text-sm text-amber-200 font-medium">Credential Verification Required</p>
                  <p className="text-xs text-amber-300/70 mt-1">
                    All provider accounts require verification of medical credentials before activation. 
                    This typically takes 1-2 business days.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-6">
              <p className="text-xs text-blue-200">
                After account creation, your next step is credentialing verification and provider plan checkout.
              </p>
            </div>

            {/* Registration Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName" className="text-slate-300">First Name *</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <Input
                      id="firstName"
                      placeholder="John"
                      value={formData.firstName}
                      onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
                      className="pl-9 bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500"
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName" className="text-slate-300">Last Name *</Label>
                  <Input
                    id="lastName"
                    placeholder="Smith"
                    value={formData.lastName}
                    onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
                    className="bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email" className="text-slate-300">Email Address *</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="doctor@example.com"
                    value={formData.email}
                    onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                    className="pl-9 bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500"
                    disabled={inviteData?.email}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone" className="text-slate-300">Phone Number</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="(555) 123-4567"
                    value={formData.phone}
                    onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                    className="pl-9 bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="specialty" className="text-slate-300">Specialty *</Label>
                  <select
                    id="specialty"
                    value={formData.specialty}
                    onChange={(e) => setFormData(prev => ({ ...prev, specialty: e.target.value }))}
                    className="w-full h-10 rounded-md bg-slate-900/50 border border-slate-600 text-white px-3 text-sm"
                    required
                  >
                    <option value="">Select specialty</option>
                    <option value="Primary Care">Primary Care</option>
                    <option value="Internal Medicine">Internal Medicine</option>
                    <option value="Family Medicine">Family Medicine</option>
                    <option value="Cardiology">Cardiology</option>
                    <option value="Dermatology">Dermatology</option>
                    <option value="Psychiatry">Psychiatry</option>
                    <option value="Psychology">Psychology</option>
                    <option value="Pediatrics">Pediatrics</option>
                    <option value="OB/GYN">OB/GYN</option>
                    <option value="Neurology">Neurology</option>
                    <option value="Orthopedics">Orthopedics</option>
                    <option value="Endocrinology">Endocrinology</option>
                    <option value="Gastroenterology">Gastroenterology</option>
                    <option value="Urgent Care">Urgent Care</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="npi" className="text-slate-300">NPI Number *</Label>
                  <Input
                    id="npi"
                    placeholder="1234567890"
                    value={formData.npiNumber}
                    onChange={(e) => setFormData(prev => ({ ...prev, npiNumber: e.target.value }))}
                    className="bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500"
                    maxLength={10}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="medicalLicense" className="text-slate-300">Medical License Number *</Label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <Input
                    id="medicalLicense"
                    placeholder="State license number"
                    value={formData.medicalLicense}
                    onChange={(e) => setFormData(prev => ({ ...prev, medicalLicense: e.target.value }))}
                    className="pl-9 bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-slate-300">Password *</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Min. 8 characters"
                    value={formData.password}
                    onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                    className="pl-9 pr-10 bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500"
                    required
                    minLength={8}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-slate-300">Confirm Password *</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <Input
                    id="confirmPassword"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Re-enter password"
                    value={formData.confirmPassword}
                    onChange={(e) => setFormData(prev => ({ ...prev, confirmPassword: e.target.value }))}
                    className="pl-9 bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500"
                    required
                  />
                </div>
              </div>

              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="acceptCompliance"
                  checked={formData.acceptCompliance}
                  onChange={(e) => setFormData(prev => ({ ...prev, acceptCompliance: e.target.checked }))}
                  className="mt-1"
                  required
                />
                <Label htmlFor="acceptCompliance" className="text-sm text-slate-400 cursor-pointer leading-relaxed">
                  I confirm that the information and credentials provided are accurate and understand they will be verified for compliance and licensure requirements.
                </Label>
              </div>

              <Button
                type="submit"
                disabled={isLoading || !formData.acceptCompliance}
                className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 h-12 text-base"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Creating Account...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Submit Application
                  </>
                )}
              </Button>

              {/* Already have account */}
              <p className="text-center text-sm text-slate-400">
                Already have an account?{' '}
                <Link href="/provider/login" className="text-purple-400 hover:text-purple-300 font-medium">
                  Sign in
                </Link>
              </p>
            </form>
          </div>

          {/* Security Badge */}
          <div className="flex items-center justify-center gap-2 mt-6 text-sm text-slate-400">
            <Shield className="w-4 h-4" />
            <span>HIPAA Compliant • Healthcare-Grade Security</span>
          </div>
        </div>
      </main>
    </div>
  );
}

function RegisterFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="flex items-center gap-2">
        <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
        <span className="text-slate-400">Loading...</span>
      </div>
    </div>
  );
}

export default function ProviderRegisterPage() {
  return (
    <Suspense fallback={<RegisterFallback />}>
      <ProviderRegisterContent />
    </Suspense>
  );
}
