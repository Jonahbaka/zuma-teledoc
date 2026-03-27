'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Eye,
  EyeOff,
  Mail,
  Lock,
  User,
  Stethoscope,
  Shield,
  Loader2,
  CheckCircle,
  Building2,
  BadgeCheck,
} from 'lucide-react';
import { authAPI } from '@/lib/api';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PhoneInputE164, isValidE164 } from '@/components/forms/PhoneInputE164';
import { GlobalAddressFields } from '@/components/forms/GlobalAddressFields';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';
import { setPreferredProviderMarket } from '@/lib/providerPortal';

const SPECIALTY_OPTIONS = [
  'Primary Care',
  'Internal Medicine',
  'Family Medicine',
  'Cardiology',
  'Dermatology',
  'Psychiatry',
  'Psychology',
  'Pediatrics',
  'OB/GYN',
  'Neurology',
  'Orthopedics',
  'Endocrinology',
  'Gastroenterology',
  'Urgent Care',
  'Other',
];

const MARKET_COPY = {
  US: {
    icon: 'from-purple-500 to-indigo-600',
    button: 'from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700',
    link: 'text-purple-400 hover:text-purple-300',
    title: 'Provider Registration',
    subtitle: 'Simple onboarding with compliant credential review and activation',
    complianceTitle: 'Credential Verification Required',
    complianceBody: 'All provider accounts require verification of medical credentials before activation. This typically takes 1-2 business days.',
    infoBanner: 'After account creation, your next step is credentialing verification and provider plan checkout.',
    regulatoryLabel: 'NPI Number *',
    regulatoryPlaceholder: '1234567890',
    regulatoryRequired: true,
    licenseLabel: 'Medical License Number *',
    licensePlaceholder: 'State license number',
    badge: 'Secure Platform • Healthcare-grade encryption • HIPAA-aligned workflows',
  },
  NG: {
    icon: 'from-emerald-500 to-teal-600',
    button: 'from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700',
    link: 'text-emerald-400 hover:text-emerald-300',
    title: 'Nigeria Provider Registration',
    subtitle: 'Launch a Nigeria care workspace for doctors, clinics, and hospital-affiliated provider teams',
    complianceTitle: 'Nigeria Credential Review',
    complianceBody: 'Provider accounts are reviewed against submitted licensure and operational details before full activation. This flow is aligned for Nigeria operations, facility onboarding, and NDPA-sensitive handling.',
    infoBanner: 'After account creation, sign in to continue licensure review, configure your practice profile, and start Nigeria provider operations.',
    regulatoryLabel: 'Regulatory ID (Optional)',
    regulatoryPlaceholder: 'MDCN, NMCN, PCN, or other regulator ID',
    regulatoryRequired: false,
    licenseLabel: 'Practice License Number *',
    licensePlaceholder: 'Issued practice license number',
    badge: 'Secure Platform • Healthcare-grade encryption • NDPA-aligned workflows',
  },
};

function ProviderRegisterContent({ market = 'US' }) {
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
    acceptCompliance: false,
    address: {
      country: market === 'NG' ? 'NG' : 'US',
      addressLine1: '',
      addressLine2: '',
      city: '',
      region: '',
      postalCode: '',
    },
  });

  const copy = MARKET_COPY[market] || MARKET_COPY.US;
  const homeHref = market === 'NG' ? '/ng' : '/';
  const loginHref = market === 'NG' ? '/ng/provider/login' : '/provider/login';

  useEffect(() => {
    setPreferredProviderMarket(market);
  }, [market]);

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
          setFormData((prev) => ({
            ...prev,
            email: response.data.invite.email || '',
            firstName: response.data.invite.firstName || '',
            lastName: response.data.invite.lastName || '',
          }));
        }
      } catch (error) {
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

  const submitLabel = useMemo(
    () => (market === 'NG' ? 'Submit Provider Application' : 'Submit Application'),
    [market]
  );

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (formData.password !== formData.confirmPassword) {
      toast({
        title: 'Password Mismatch',
        description: 'Passwords do not match',
        variant: 'destructive',
      });
      return;
    }

    if (formData.password.length < 8) {
      toast({
        title: 'Password Too Short',
        description: 'Password must be at least 8 characters',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    setPreferredProviderMarket(market);

    try {
      const payload = {
        ...formData,
        ...formData.address,
        role: 'provider',
      };

      const response = inviteToken
        ? await authAPI.registerProvider({
          token: inviteToken,
          firstName: payload.firstName,
          lastName: payload.lastName,
          password: payload.password,
          phone: payload.phone,
          specialty: payload.specialty,
          npiNumber: payload.npiNumber || null,
          medicalLicense: payload.medicalLicense,
        })
        : await authAPI.register({
          firstName: payload.firstName,
          lastName: payload.lastName,
          email: payload.email,
          phone: payload.phone,
          password: payload.password,
          confirmPassword: payload.confirmPassword,
          hipaaConsent: payload.acceptCompliance === true,
          termsAccepted: payload.acceptCompliance === true,
          role: 'provider',
          specialty: payload.specialty,
          npiNumber: payload.npiNumber || undefined,
          licenseNumber: payload.medicalLicense,
          ...payload.address,
        });

      if (response.data.success) {
        toast({
          title: 'Registration Successful',
          description: market === 'NG'
            ? 'Application submitted. Sign in to continue Nigeria credential review and portal setup.'
            : 'Application submitted. Next: sign in to complete credentialing and provider checkout.',
        });
        router.push(`${loginHref}?registered=true`);
      }
    } catch (error) {
      const message = error.response?.data?.error || 'Registration failed. Please try again.';
      toast({
        title: 'Registration Failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

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
      <header className="p-6">
        <Link href={homeHref} className="flex items-center gap-2">
          <DoctaRxLogo className="h-9 w-auto" />
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-lg">
          <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 rounded-2xl shadow-2xl p-8">
            <div className="text-center mb-8">
              <div className={`w-16 h-16 bg-gradient-to-br ${copy.icon} rounded-2xl flex items-center justify-center mx-auto mb-4`}>
                <Stethoscope className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-white">{copy.title}</h1>
              <p className="text-slate-400 mt-2">{copy.subtitle}</p>
            </div>

            {inviteData && (
              <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4 mb-6">
                <div className="flex items-center gap-3">
                  <BadgeCheck className="w-5 h-5 text-purple-400" />
                  <div>
                    <p className="text-sm text-purple-200">Invited by {inviteData.invitedByName || 'Administrator'}</p>
                    <p className="text-xs text-purple-300/70">{inviteData.organizationName || 'DoctaRx'}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-6">
              <div className="flex items-start gap-3">
                <Shield className="w-5 h-5 text-amber-400 mt-0.5" />
                <div>
                  <p className="text-sm text-amber-200 font-medium">{copy.complianceTitle}</p>
                  <p className="text-xs text-amber-300/70 mt-1">{copy.complianceBody}</p>
                </div>
              </div>
            </div>

            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-6">
              <p className="text-xs text-blue-200">{copy.infoBanner}</p>
            </div>

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
                      onChange={(e) => setFormData((prev) => ({ ...prev, firstName: e.target.value }))}
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
                    onChange={(e) => setFormData((prev) => ({ ...prev, lastName: e.target.value }))}
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
                    onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                    className="pl-9 bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500"
                    disabled={inviteData?.email}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone" className="text-slate-300">Phone Number</Label>
                <PhoneInputE164
                  value={formData.phone}
                  onChange={(v) => setFormData((prev) => ({ ...prev, phone: v }))}
                  defaultCountryIso2={formData.address.country}
                  className="text-slate-900"
                />
                {formData.phone && !isValidE164(formData.phone) && (
                  <p className="text-xs text-red-300">Use international E.164 format (example: +2348012345678).</p>
                )}
              </div>

              <div className="bg-slate-900/30 border border-slate-700 rounded-xl p-4">
                <GlobalAddressFields
                  value={formData.address}
                  onChange={(addr) => setFormData((prev) => ({ ...prev, address: addr }))}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="specialty" className="text-slate-300">Specialty *</Label>
                  <select
                    id="specialty"
                    value={formData.specialty}
                    onChange={(e) => setFormData((prev) => ({ ...prev, specialty: e.target.value }))}
                    className="w-full h-10 rounded-md bg-slate-900/50 border border-slate-600 text-white px-3 text-sm"
                    required
                  >
                    <option value="">Select specialty</option>
                    {SPECIALTY_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="regulatoryId" className="text-slate-300">{copy.regulatoryLabel}</Label>
                  <Input
                    id="regulatoryId"
                    placeholder={copy.regulatoryPlaceholder}
                    value={formData.npiNumber}
                    onChange={(e) => setFormData((prev) => ({ ...prev, npiNumber: e.target.value }))}
                    className="bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500"
                    maxLength={20}
                    required={copy.regulatoryRequired}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="medicalLicense" className="text-slate-300">{copy.licenseLabel}</Label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <Input
                    id="medicalLicense"
                    placeholder={copy.licensePlaceholder}
                    value={formData.medicalLicense}
                    onChange={(e) => setFormData((prev) => ({ ...prev, medicalLicense: e.target.value }))}
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
                    onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
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
                    onChange={(e) => setFormData((prev) => ({ ...prev, confirmPassword: e.target.value }))}
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
                  onChange={(e) => setFormData((prev) => ({ ...prev, acceptCompliance: e.target.checked }))}
                  className="mt-1"
                  required
                />
                <Label htmlFor="acceptCompliance" className="text-sm text-slate-400 cursor-pointer leading-relaxed">
                  I confirm that the information and credentials provided are accurate and understand they will be reviewed for licensure, compliance, and platform activation requirements.
                </Label>
              </div>

              <Button
                type="submit"
                disabled={isLoading || !formData.acceptCompliance}
                className={`w-full bg-gradient-to-r ${copy.button} h-12 text-base`}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Creating Account...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    {submitLabel}
                  </>
                )}
              </Button>

              <p className="text-center text-sm text-slate-400">
                Already have an account?{' '}
                <Link href={loginHref} className={`${copy.link} font-medium`}>
                  Sign in
                </Link>
              </p>
            </form>
          </div>

          <div className="flex items-center justify-center gap-2 mt-6 text-sm text-slate-400">
            <Shield className="w-4 h-4" />
            <span>{copy.badge}</span>
          </div>
        </div>
      </main>
    </div>
  );
}

function ProviderRegisterFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="flex items-center gap-2">
        <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
        <span className="text-slate-400">Loading...</span>
      </div>
    </div>
  );
}

export default function ProviderRegisterPage(props) {
  return (
    <Suspense fallback={<ProviderRegisterFallback />}>
      <ProviderRegisterContent {...props} />
    </Suspense>
  );
}
