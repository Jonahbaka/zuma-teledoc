'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, Loader2, ArrowLeft, CheckCircle2, Shield, Stethoscope, User } from 'lucide-react';
import { authAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import { ThemeToggle } from '@/components/ui/theme-toggle';

const forgotPasswordSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  role: z.enum(['patient', 'provider', 'admin']).default('patient')
});

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors }
  } = useForm({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: '',
      role: 'patient'
    }
  });
  
  const watchRole = watch('role');

  const onSubmit = async (data) => {
    setLoading(true);
    try {
      const response = await authAPI.requestPasswordReset({
        email: data.email,
        role: data.role
      });

      if (response.data.success) {
        setSubmitted(true);
        toast({
          title: 'Email Sent',
          description: 'If an account with that email exists, a password reset link has been sent.',
          variant: 'success'
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to send reset email',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-purple-50/30 to-background dark:from-slate-950 dark:via-purple-950/20 dark:to-slate-950 px-4 relative">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>
        <div className="max-w-md w-full bg-card rounded-2xl shadow-xl p-8 border border-border">
          <div className="text-center">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-2">Check Your Email</h1>
            <p className="text-muted-foreground mb-6">
              If an account with that email exists, we've sent a password reset link. 
              Please check your inbox and follow the instructions.
            </p>
            <div className="space-y-3">
              <Link href="/login">
                <Button className="w-full bg-gradient-to-r from-purple-600 to-indigo-700 hover:from-purple-700 hover:to-indigo-800 text-white">
                  Back to Login
                </Button>
              </Link>
              <Button
                variant="outline"
                onClick={() => setSubmitted(false)}
                className="w-full"
              >
                Send Another Email
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-purple-50/30 to-background dark:from-slate-950 dark:via-purple-950/20 dark:to-slate-950 px-4 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="max-w-md w-full bg-card rounded-2xl shadow-xl p-8 border border-border">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Forgot Password?</h1>
          <p className="text-muted-foreground">
            Enter your email address and we'll send you a link to reset your password.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Account type (role) */}
          <div className="space-y-2">
            <Label className="text-foreground">Account Type</Label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { value: 'patient', label: 'Patient', icon: User },
                { value: 'provider', label: 'Provider', icon: Stethoscope },
                { value: 'admin', label: 'Admin', icon: Shield }
              ].map((role) => (
                <label 
                  key={role.value}
                  className={`
                    relative flex flex-col items-center p-3 border-2 rounded-xl cursor-pointer transition-all text-center
                    ${watchRole === role.value 
                      ? 'border-primary bg-primary/10 dark:bg-primary/20' 
                      : 'border-border hover:border-primary/50 bg-background dark:bg-slate-900'
                    }
                  `}
                >
                  <input
                    type="radio"
                    value={role.value}
                    className="sr-only"
                    {...register('role')}
                  />
                  <role.icon className={`w-6 h-6 mb-1 ${watchRole === role.value ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className={`text-sm font-medium ${watchRole === role.value ? 'text-primary' : 'text-muted-foreground'}`}>
                    {role.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email" className="text-foreground">Email Address</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                placeholder="Enter your email"
                className="pl-10 bg-background"
                {...register('email')}
              />
            </div>
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email.message}</p>
            )}
          </div>

          <Button
            type="submit"
            className="w-full bg-gradient-to-r from-purple-600 to-indigo-700 hover:from-purple-700 hover:to-indigo-800 text-white shadow-lg shadow-purple-500/25"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Sending...
              </>
            ) : (
              'Send Reset Link'
            )}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <Link
            href="/login"
            className="text-sm text-primary hover:text-primary/80 flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
}
