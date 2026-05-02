'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Eye,
  EyeOff,
  Mail,
  Lock,
  User,
  Heart,
  Shield,
  Loader2,
  Calendar,
  Sparkles,
  CreditCard
} from 'lucide-react';
import { authAPI } from '@/lib/api';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PhoneInputE164, isValidE164 } from '@/components/forms/PhoneInputE164';
import { GlobalAddressFields } from '@/components/forms/GlobalAddressFields';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';

export default function PatientRegisterPage({
  defaultCountry = 'US',
  homeHref = '/',
  loginHref = '/patient/login',
  successDescription = 'Choose a plan to get started.',
  successRedirectPath = '/patient/subscription',
  submitLabel = 'Continue to Checkout',
  activationNotice = 'After account creation, you will proceed to checkout to activate consultations.',
}) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    password: '',
    confirmPassword: '',
    acceptTerms: false,
    address: {
      country: defaultCountry,
      addressLine1: '',
      addressLine2: '',
      city: '',
      region: '',
      postalCode: ''
    }
  });

  const passwordChecks = {
    minLength: formData.password.length >= 8,
    hasUppercase: /[A-Z]/.test(formData.password),
    hasLowercase: /[a-z]/.test(formData.password),
    hasNumber: /\d/.test(formData.password),
    hasSymbol: /[^A-Za-z0-9]/.test(formData.password),
  };
  const passwordPolicySatisfied = Object.values(passwordChecks).every(Boolean);

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

    if (!passwordPolicySatisfied) {
      toast({
        title: 'Password Requirements',
        description: 'Password must include uppercase, lowercase, number, and symbol.',
        variant: 'destructive'
      });
      return;
    }

    setIsLoading(true);

    try {
      const response = await authAPI.register({
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        phone: formData.phone,
        ...formData.address,
        dateOfBirth: formData.dateOfBirth,
        password: formData.password,
        confirmPassword: formData.confirmPassword,
        hipaaConsent: formData.acceptTerms === true,
        termsAccepted: formData.acceptTerms === true,
        role: 'patient'
      });

      if (response.data.success) {
        if (response.data.accessToken) {
          localStorage.setItem('accessToken', response.data.accessToken);
        }
        if (response.data.refreshToken) {
          localStorage.setItem('refreshToken', response.data.refreshToken);
        }

        toast({
          title: 'Account Created!',
          description: successDescription,
        });
        router.push(successRedirectPath);
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

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-purple-50 via-white to-blue-50 dark:from-slate-950 dark:via-slate-900 dark:to-purple-950">
      <header className="px-4 py-5 sm:p-6">
        <Link href={homeHref} className="flex items-center gap-2">
          <span className="rounded-xl bg-slate-950/95 px-3 py-2 shadow-[0_0_20px_rgba(34,211,238,0.18)] border border-slate-800">
            <DoctaRxLogo className="h-8 w-auto" />
          </span>
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-6 sm:p-6">
        <div className="w-full max-w-md">
          <div className="bg-card border border-border rounded-2xl shadow-xl p-5 sm:p-8">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Heart className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-foreground">Create Patient Account</h1>
              <p className="text-muted-foreground mt-2">Warm, secure onboarding in two quick steps</p>
            </div>

            <div className="mb-6 rounded-xl border border-purple-500/20 bg-purple-500/5 p-3">
              <p className="text-xs text-muted-foreground flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-500" />
                {activationNotice}
              </p>
            </div>

            <div className="flex items-center justify-center gap-2 mb-8">
              <div className={`w-3 h-3 rounded-full ${step >= 1 ? 'bg-purple-600' : 'bg-muted'}`} />
              <div className={`w-8 h-0.5 ${step >= 2 ? 'bg-purple-600' : 'bg-muted'}`} />
              <div className={`w-3 h-3 rounded-full ${step >= 2 ? 'bg-purple-600' : 'bg-muted'}`} />
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {step === 1 && (
                <>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">First Name</Label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          id="firstName"
                          placeholder="John"
                          value={formData.firstName}
                          onChange={(e) => setFormData((prev) => ({ ...prev, firstName: e.target.value }))}
                          className="pl-9"
                          required
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Last Name</Label>
                      <Input
                        id="lastName"
                        placeholder="Doe"
                        value={formData.lastName}
                        onChange={(e) => setFormData((prev) => ({ ...prev, lastName: e.target.value }))}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="email"
                        type="email"
                        placeholder="your@email.com"
                        value={formData.email}
                        onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                        className="pl-9"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone Number</Label>
                    <PhoneInputE164
                      value={formData.phone}
                      onChange={(v) => setFormData((prev) => ({ ...prev, phone: v }))}
                      defaultCountryIso2={formData.address.country}
                    />
                    {formData.phone && !isValidE164(formData.phone) && (
                      <p className="text-xs text-red-500">Use international E.164 format (example: +2348012345678).</p>
                    )}
                  </div>

                  <GlobalAddressFields
                    value={formData.address}
                    onChange={(addr) => setFormData((prev) => ({ ...prev, address: addr }))}
                  />

                  <div className="space-y-2">
                    <Label htmlFor="dob">Date of Birth</Label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="dob"
                        type="date"
                        value={formData.dateOfBirth}
                        onChange={(e) => setFormData((prev) => ({ ...prev, dateOfBirth: e.target.value }))}
                        className="pl-9"
                        required
                      />
                    </div>
                  </div>

                  <Button
                    type="button"
                    onClick={() => setStep(2)}
                    className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                    disabled={!formData.firstName || !formData.lastName || !formData.email}
                  >
                    Continue
                  </Button>
                </>
              )}

              {step === 2 && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        value={formData.password}
                        onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
                        className="pl-9 pr-10"
                        required
                        minLength={8}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <div className="space-y-1 text-xs">
                      <p className={passwordChecks.minLength ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}>• At least 8 characters</p>
                      <p className={passwordChecks.hasUppercase ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}>• Includes one uppercase letter</p>
                      <p className={passwordChecks.hasLowercase ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}>• Includes one lowercase letter</p>
                      <p className={passwordChecks.hasNumber ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}>• Includes at least one number</p>
                      <p className={passwordChecks.hasSymbol ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}>• Includes at least one symbol</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">Confirm Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="confirmPassword"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        value={formData.confirmPassword}
                        onChange={(e) => setFormData((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                        className="pl-9"
                        required
                      />
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      id="terms"
                      checked={formData.acceptTerms}
                      onChange={(e) => setFormData((prev) => ({ ...prev, acceptTerms: e.target.checked }))}
                      className="mt-1"
                      required
                    />
                    <Label htmlFor="terms" className="text-sm text-muted-foreground cursor-pointer">
                      I agree to the{' '}
                      <Link href="/terms" className="text-purple-600 hover:underline">Terms of Service</Link>
                      {' '}and{' '}
                      <Link href="/privacy" className="text-purple-600 hover:underline">Privacy Policy</Link>
                    </Label>
                  </div>

                  <div className="rounded-lg bg-muted/40 border border-border p-3 text-xs text-muted-foreground flex items-start gap-2">
                    <Shield className="w-4 h-4 mt-0.5" />
                    <span>HIPAA-compliant onboarding. Your account data is encrypted in transit and at rest. AI-assisted workflows pass through privacy filters and audit logging.</span>
                  </div>

                  <div className="flex flex-col-reverse gap-3 sm:flex-row">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setStep(1)}
                      className="flex-1"
                    >
                      Back
                    </Button>
                    <Button
                      type="submit"
                      disabled={isLoading || !formData.acceptTerms || !passwordPolicySatisfied}
                      className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          Creating...
                        </>
                      ) : (
                        <>
                          <CreditCard className="w-4 h-4 mr-2" />
                          {submitLabel}
                        </>
                      )}
                    </Button>
                  </div>
                </>
              )}
            </form>

            <p className="text-center mt-6 text-muted-foreground">
              Already have an account?{' '}
              <Link href={loginHref} className="text-purple-600 hover:text-purple-700 font-medium">
                Sign in
              </Link>
            </p>
          </div>

          <div className="flex items-center justify-center gap-2 mt-6 text-sm text-muted-foreground">
            <Shield className="w-4 h-4" />
            <span>Secure Platform | End-to-End Encrypted | Privacy Protected</span>
          </div>
        </div>
      </main>
    </div>
  );
}
