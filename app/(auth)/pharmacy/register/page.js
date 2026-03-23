'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pill, Mail, Lock, Loader2, Shield, Building2, Phone, MapPin, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';

export default function PharmacyRegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    pharmacyName: '', licenseNumber: '', ownerName: '',
    email: '', phone: '', password: '',
    address: '', city: '', state: '', acceptTerms: false
  });

  const update = (field, value) => setFormData(prev => ({ ...prev, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.acceptTerms) { toast({ title: 'Please accept terms', variant: 'destructive' }); return; }
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, role: 'pharmacy' })
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: 'Registration Successful', description: 'Your pharmacy has been registered. Please log in.' });
        router.push('/pharmacy/login');
      } else {
        toast({ title: 'Registration Failed', description: data.error || 'Please try again.', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Unable to connect. Please try again.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 via-white to-blue-50 dark:from-slate-950 dark:via-slate-900 dark:to-purple-950 px-4 py-12">
      <main className="w-full max-w-lg">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6">
            <span className="rounded-xl bg-slate-950/95 px-3 py-2 shadow-lg border border-slate-800">
              <DoctaRxLogo className="h-7 w-auto" />
            </span>
          </Link>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-300 text-xs font-semibold mb-4 border border-purple-500/20">
            <Pill size={14} /> Pharmacy Registration
          </div>
          <h1 className="text-3xl font-bold text-foreground">Join the DoctaRx Network</h1>
          <p className="text-muted-foreground mt-2">Register your pharmacy to receive digital prescriptions</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${step >= 1 ? 'bg-purple-600 text-white' : 'bg-muted text-muted-foreground'}`}>1</div>
          <div className={`w-12 h-0.5 ${step >= 2 ? 'bg-purple-600' : 'bg-muted'}`} />
          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${step >= 2 ? 'bg-purple-600 text-white' : 'bg-muted text-muted-foreground'}`}>2</div>
        </div>

        <div className="bg-card rounded-2xl shadow-xl border border-border p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {step === 1 && (
              <>
                <div className="space-y-2">
                  <Label>Pharmacy Name *</Label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input placeholder="e.g. HealthPlus Pharmacy" value={formData.pharmacyName} onChange={(e) => update('pharmacyName', e.target.value)} className="pl-9" required />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>PCN License Number *</Label>
                  <Input placeholder="Pharmacy Council of Nigeria license" value={formData.licenseNumber} onChange={(e) => update('licenseNumber', e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Owner / Superintendent Pharmacist *</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input placeholder="Full name" value={formData.ownerName} onChange={(e) => update('ownerName', e.target.value)} className="pl-9" required />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Email *</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input type="email" placeholder="Email" value={formData.email} onChange={(e) => update('email', e.target.value)} className="pl-9" required />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Phone *</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input placeholder="+234..." value={formData.phone} onChange={(e) => update('phone', e.target.value)} className="pl-9" required />
                    </div>
                  </div>
                </div>
                <Button type="button" onClick={() => setStep(2)} className="w-full bg-purple-600 hover:bg-purple-700 text-white">
                  Continue
                </Button>
              </>
            )}

            {step === 2 && (
              <>
                <div className="space-y-2">
                  <Label>Pharmacy Address *</Label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input placeholder="Street address" value={formData.address} onChange={(e) => update('address', e.target.value)} className="pl-9" required />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>City *</Label>
                    <Input placeholder="e.g. Lagos" value={formData.city} onChange={(e) => update('city', e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label>State *</Label>
                    <Input placeholder="e.g. Lagos" value={formData.state} onChange={(e) => update('state', e.target.value)} required />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Password *</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input type="password" placeholder="Create a secure password" value={formData.password} onChange={(e) => update('password', e.target.value)} className="pl-9" required />
                  </div>
                </div>

                <div className="flex items-start gap-2">
                  <input type="checkbox" id="terms" checked={formData.acceptTerms} onChange={(e) => update('acceptTerms', e.target.checked)} className="mt-1" required />
                  <Label htmlFor="terms" className="text-sm text-muted-foreground cursor-pointer">
                    I agree to the <Link href="/terms" className="text-purple-600 hover:underline">Terms</Link> and <Link href="/privacy" className="text-purple-600 hover:underline">Privacy Policy</Link>
                  </Label>
                </div>

                <div className="rounded-lg bg-muted/40 border border-border p-3 text-xs text-muted-foreground flex items-start gap-2">
                  <Shield className="w-4 h-4 mt-0.5" />
                  <span>Your pharmacy data is encrypted. AI-assisted workflows pass through privacy filters and audit logging.</span>
                </div>

                <div className="flex gap-3">
                  <Button type="button" variant="outline" onClick={() => setStep(1)} className="flex-1">Back</Button>
                  <Button type="submit" disabled={isLoading} className="flex-1 bg-purple-600 hover:bg-purple-700 text-white">
                    {isLoading ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Registering...</> : 'Register Pharmacy'}
                  </Button>
                </div>
              </>
            )}
          </form>

          <p className="text-center mt-6 text-muted-foreground">
            Already registered?{' '}
            <Link href="/pharmacy/login" className="text-purple-600 hover:text-purple-700 font-medium">Sign in</Link>
          </p>
        </div>

        <div className="flex items-center justify-center gap-2 mt-6 text-sm text-muted-foreground">
          <Shield className="w-4 h-4" />
          <span>Secure Platform | End-to-End Encrypted | Privacy Protected</span>
        </div>
      </main>
    </div>
  );
}
