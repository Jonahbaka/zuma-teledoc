'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { 
  Eye, EyeOff, Loader2, Stethoscope, Mail, Lock, User, 
  Phone, CheckCircle2, Shield, AlertCircle 
} from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';

const registerSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  email: z.string().email('Please enter a valid email'),
  phone: z.string().optional(),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
  confirmPassword: z.string(),
  role: z.enum(['patient', 'provider']),
  // Provider fields
  licenseNumber: z.string().optional(),
  licenseState: z.string().optional(),
  specialty: z.string().optional(),
  npiNumber: z.string().optional(),
  credentials: z.string().optional(),
  // Consent
  hipaaConsent: z.boolean().refine(val => val === true, {
    message: 'You must accept the HIPAA consent'
  }),
  termsAccepted: z.boolean().refine(val => val === true, {
    message: 'You must accept the terms of service'
  })
}).refine(data => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword']
});

export default function RegisterPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { register: registerUser } = useAuth();
  const searchParams = useSearchParams();
  
  const defaultRole = searchParams.get('role') === 'provider' ? 'provider' : 'patient';

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch
  } = useForm({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      password: '',
      confirmPassword: '',
      role: defaultRole,
      licenseNumber: '',
      licenseState: '',
      specialty: '',
      npiNumber: '',
      credentials: '',
      hipaaConsent: false,
      termsAccepted: false
    }
  });

  const watchRole = watch('role');
  const watchPassword = watch('password');

  const passwordRequirements = [
    { test: (p) => p.length >= 8, label: 'At least 8 characters' },
    { test: (p) => /[A-Z]/.test(p), label: 'One uppercase letter' },
    { test: (p) => /[a-z]/.test(p), label: 'One lowercase letter' },
    { test: (p) => /[0-9]/.test(p), label: 'One number' },
    { test: (p) => /[^A-Za-z0-9]/.test(p), label: 'One special character' }
  ];

  const onSubmit = async (data) => {
    setIsLoading(true);
    
    try {
      const result = await registerUser(data);
      
      if (result.error) {
        toast({
          title: 'Registration Failed',
          description: result.error,
          variant: 'destructive'
        });
        
        if (result.errors) {
          result.errors.forEach(err => {
            toast({
              title: err.field,
              description: err.message,
              variant: 'destructive'
            });
          });
        }
      } else if (result.success) {
        toast({
          title: 'Welcome to Docta.!',
          description: result.message || 'Your account has been created successfully.',
          variant: 'success'
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'An unexpected error occurred',
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center gradient-bg p-4 py-12">
      <div className="absolute inset-0 pattern-dots opacity-50" />
      
      <div className="relative w-full max-w-2xl animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="h-20 w-20 bg-purple-900 rounded-full flex items-center justify-center shadow-xl text-white font-bold text-4xl relative">
              D
              <div className="absolute ml-8 mt-8 w-3 h-3 bg-amber-400 rounded-full border-2 border-purple-900"></div>
            </div>
            <span className="text-6xl font-extrabold text-purple-900">Docta<span className="text-amber-500">.</span></span>
          </Link>
        </div>

        <Card className="shadow-xl border-0">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-2xl font-serif">Create your account</CardTitle>
            <CardDescription>
              {watchRole === 'provider' 
                ? 'Join our network of healthcare providers'
                : 'Start your telehealth journey today'
              }
            </CardDescription>
          </CardHeader>
          
          <form onSubmit={handleSubmit(onSubmit)}>
            <CardContent className="space-y-6">
              {/* Role Selection */}
              <div className="grid grid-cols-2 gap-4">
                <label className={`
                  relative flex flex-col items-center p-4 border-2 rounded-xl cursor-pointer transition-all
                  ${watchRole === 'patient' 
                    ? 'border-purple-500 bg-purple-50' 
                    : 'border-gray-200 hover:border-gray-300'
                  }
                `}>
                  <input
                    type="radio"
                    value="patient"
                    className="sr-only"
                    {...register('role')}
                  />
                  <User className={`w-8 h-8 mb-2 ${watchRole === 'patient' ? 'text-purple-600' : 'text-gray-400'}`} />
                  <span className={`font-medium ${watchRole === 'patient' ? 'text-purple-700' : 'text-gray-600'}`}>
                    Patient
                  </span>
                  <span className="text-xs text-gray-500 mt-1">Access healthcare</span>
                </label>

                <label className={`
                  relative flex flex-col items-center p-4 border-2 rounded-xl cursor-pointer transition-all
                  ${watchRole === 'provider' 
                    ? 'border-purple-500 bg-purple-50' 
                    : 'border-gray-200 hover:border-gray-300'
                  }
                `}>
                  <input
                    type="radio"
                    value="provider"
                    className="sr-only"
                    {...register('role')}
                  />
                  <Stethoscope className={`w-8 h-8 mb-2 ${watchRole === 'provider' ? 'text-purple-600' : 'text-gray-400'}`} />
                  <span className={`font-medium ${watchRole === 'provider' ? 'text-purple-700' : 'text-gray-600'}`}>
                    Provider
                  </span>
                  <span className="text-xs text-gray-500 mt-1">Offer care services</span>
                </label>
              </div>

              {/* Name Fields */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    placeholder="John"
                    {...register('firstName')}
                  />
                  {errors.firstName && (
                    <p className="text-sm text-red-500">{errors.firstName.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    placeholder="Doe"
                    {...register('lastName')}
                  />
                  {errors.lastName && (
                    <p className="text-sm text-red-500">{errors.lastName.message}</p>
                  )}
                </div>
              </div>

              {/* Email */}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="name@example.com"
                    className="pl-10"
                    {...register('email')}
                  />
                </div>
                {errors.email && (
                  <p className="text-sm text-red-500">{errors.email.message}</p>
                )}
              </div>

              {/* Phone */}
              <div className="space-y-2">
                <Label htmlFor="phone">Phone (optional)</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="+1 (555) 000-0000"
                    className="pl-10"
                    {...register('phone')}
                  />
                </div>
              </div>

              {/* Provider-specific fields */}
              {watchRole === 'provider' && (
                <div className="space-y-4 p-4 bg-gray-50 rounded-xl animate-fade-in">
                  <h4 className="font-medium text-gray-900 flex items-center gap-2">
                    <Shield className="w-5 h-5 text-purple-600" />
                    Provider Information
                  </h4>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="licenseNumber">License Number</Label>
                      <Input
                        id="licenseNumber"
                        placeholder="ABC123456"
                        {...register('licenseNumber')}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="licenseState">License State</Label>
                      <Input
                        id="licenseState"
                        placeholder="CA"
                        {...register('licenseState')}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="specialty">Specialty</Label>
                      <Input
                        id="specialty"
                        placeholder="Family Medicine"
                        {...register('specialty')}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="credentials">Credentials</Label>
                      <Input
                        id="credentials"
                        placeholder="MD, FAAFP"
                        {...register('credentials')}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="npiNumber">NPI Number</Label>
                    <Input
                      id="npiNumber"
                      placeholder="1234567890"
                      {...register('npiNumber')}
                    />
                  </div>

                  <p className="text-sm text-amber-600 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    Provider accounts require verification. You'll be notified once approved.
                  </p>
                </div>
              )}

              {/* Password */}
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Create a strong password"
                    className="pl-10 pr-10"
                    {...register('password')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                
                {/* Password requirements */}
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {passwordRequirements.map((req, i) => (
                    <div 
                      key={i}
                      className={`flex items-center gap-2 text-xs ${
                        req.test(watchPassword || '') ? 'text-purple-600' : 'text-gray-400'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {req.label}
                    </div>
                  ))}
                </div>
              </div>

              {/* Confirm Password */}
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <Input
                    id="confirmPassword"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Confirm your password"
                    className="pl-10"
                    {...register('confirmPassword')}
                  />
                </div>
                {errors.confirmPassword && (
                  <p className="text-sm text-red-500">{errors.confirmPassword.message}</p>
                )}
              </div>

              {/* Consent Checkboxes */}
              <div className="space-y-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1 w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                    {...register('hipaaConsent')}
                  />
                  <span className="text-sm text-gray-600">
                    I acknowledge that I have read and understand the{' '}
                    <Link href="/hipaa" className="text-purple-600 hover:underline">
                      HIPAA Privacy Notice
                    </Link>
                    {' '}and consent to the collection and use of my health information.
                  </span>
                </label>
                {errors.hipaaConsent && (
                  <p className="text-sm text-red-500 ml-7">{errors.hipaaConsent.message}</p>
                )}

                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1 w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                    {...register('termsAccepted')}
                  />
                  <span className="text-sm text-gray-600">
                    I agree to the{' '}
                    <Link href="/terms" className="text-purple-600 hover:underline">
                      Terms of Service
                    </Link>
                    {' '}and{' '}
                    <Link href="/privacy" className="text-purple-600 hover:underline">
                      Privacy Policy
                    </Link>
                  </span>
                </label>
                {errors.termsAccepted && (
                  <p className="text-sm text-red-500 ml-7">{errors.termsAccepted.message}</p>
                )}
              </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-4">
              <Button 
                type="submit" 
                className="w-full bg-gradient-to-r from-purple-600 to-purple-800 hover:from-purple-700 hover:to-purple-900 text-white"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating account...
                  </>
                ) : (
                  'Create Account'
                )}
              </Button>

              <p className="text-sm text-center text-gray-600">
                Already have an account?{' '}
                <Link href="/login" className="text-purple-600 hover:underline font-medium">
                  Sign in
                </Link>
              </p>
            </CardFooter>
          </form>
        </Card>

        {/* Security badge */}
        <div className="mt-6 flex items-center justify-center gap-2 text-sm text-gray-500">
          <Shield className="w-4 h-4" />
          <span>HIPAA Compliant • 256-bit SSL • SOC 2 Certified</span>
        </div>
      </div>
    </div>
  );
}

