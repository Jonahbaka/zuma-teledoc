'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, Mail, Lock, User, Stethoscope, Shield, Loader2, CheckCircle, AlertTriangle, Building2, BadgeCheck } from 'lucide-react';
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
  const [validatingToken, setValidatingToken] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
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
    confirmPassword: ''
  });

  // Validate invite token on mount
  useEffect(() => {
    const validateToken = async () => {
      if (!inviteToken) {
        setValidatingToken(false);
        return;
      }

      try {
        const response = await authAPI.validateInvite(inviteToken);
        if (response.data.success) {
          setTokenValid(true);
          setInviteData(response.data.invite);
          setFormData(prev => ({
            ...prev,
            email: response.data.invite.email || '',
            firstName: response.data.invite.firstName || '',
            lastName: response.data.invite.lastName || ''
          }));
        }
      } catch (error) {
        setTokenValid(false);
        toast({
          title: 'Invalid Invitation',
          description: 'This invitation link is invalid or has expired.',
          variant: 'destructive'
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

    setIsLoading(true);

    try {
      const response = await authAPI.registerProvider({
        ...formData,
        inviteToken,
        role: 'provider'
      });

      if (response.data.success) {
        toast({
          title: 'Registration Successful!',
          description: 'Your account has been created. You can now sign in.',
        });
        router.push('/provider/login?from=invite');
      }
    } catch (error) {
      const message = error.response?.data?.error || 'Registration failed';
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
          <p className="text-slate-400">Validating invitation...</p>
        </div>
      </div>
    );
  }

  // Show error if no token or invalid token
  if (!inviteToken || !tokenValid) {
    return (
      <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
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

        <main className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-md">
            <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 rounded-2xl shadow-2xl p-8 text-center">
              <div className="w-16 h-16 bg-red-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-8 h-8 text-red-400" />
              </div>
              <h1 className="text-2xl font-bold text-white mb-2">Invitation Required</h1>
              <p className="text-slate-400 mb-6">
                Provider registration is by invitation only. Please use the link provided in your invitation email.
              </p>
              <Link href="/provider/login">
                <Button variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-700">
                  Back to Login
                </Button>
              </Link>
            </div>
          </div>
        </main>
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
              <h1 className="text-2xl font-bold text-white">Complete Provider Registration</h1>
              <p className="text-slate-400 mt-2">You've been invited to join Docta as a healthcare provider</p>
            </div>

            {/* Invite Info Banner */}
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

            {/* Registration Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName" className="text-slate-300">First Name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <Input
                      id="firstName"
                      placeholder="John"
                      value={formData.firstName}
                      onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
                      className="pl-9 bg-slate-900/50 border-slate-600 text-white"
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName" className="text-slate-300">Last Name</Label>
                  <Input
                    id="lastName"
                    placeholder="Smith"
                    value={formData.lastName}
                    onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
                    className="bg-slate-900/50 border-slate-600 text-white"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email" className="text-slate-300">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                    className="pl-9 bg-slate-900/50 border-slate-600 text-white"
                    disabled={inviteData?.email}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="specialty" className="text-slate-300">Specialty</Label>
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
                    <option value="Cardiology">Cardiology</option>
                    <option value="Dermatology">Dermatology</option>
                    <option value="Psychiatry">Psychiatry</option>
                    <option value="Pediatrics">Pediatrics</option>
                    <option value="OB/GYN">OB/GYN</option>
                    <option value="Neurology">Neurology</option>
                    <option value="Orthopedics">Orthopedics</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="npi" className="text-slate-300">NPI Number</Label>
                  <Input
                    id="npi"
                    placeholder="1234567890"
                    value={formData.npiNumber}
                    onChange={(e) => setFormData(prev => ({ ...prev, npiNumber: e.target.value }))}
                    className="bg-slate-900/50 border-slate-600 text-white"
                    maxLength={10}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="medicalLicense" className="text-slate-300">Medical License Number</Label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <Input
                    id="medicalLicense"
                    placeholder="License number"
                    value={formData.medicalLicense}
                    onChange={(e) => setFormData(prev => ({ ...prev, medicalLicense: e.target.value }))}
                    className="pl-9 bg-slate-900/50 border-slate-600 text-white"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-slate-300">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={formData.password}
                    onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                    className="pl-9 pr-10 bg-slate-900/50 border-slate-600 text-white"
                    required
                    minLength={8}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-slate-300">Confirm Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <Input
                    id="confirmPassword"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={formData.confirmPassword}
                    onChange={(e) => setFormData(prev => ({ ...prev, confirmPassword: e.target.value }))}
                    className="pl-9 bg-slate-900/50 border-slate-600 text-white"
                    required
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={isLoading}
                className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Creating Account...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Complete Registration
                  </>
                )}
              </Button>
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
