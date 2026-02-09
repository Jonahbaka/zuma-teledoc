'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { stripeAPI, membershipAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, Crown, CreditCard, Shield, Zap, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import MembershipCard from '@/components/membership/MembershipCard';
import InsuranceCardUploader from '@/components/insurance/InsuranceCardUploader';

function SubscriptionContent() {
  const { user, refreshUser } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [membership, setMembership] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [accessLevel, setAccessLevel] = useState('read_only');
  const [paymentStatus, setPaymentStatus] = useState(null); // 'success' | 'cancelled' | null

  useEffect(() => {
    // Handle Stripe redirect
    const success = searchParams.get('success');
    const cancelled = searchParams.get('cancelled');
    if (success === 'true') {
      setPaymentStatus('success');
      toast({ title: 'Payment Successful!', description: 'Your subscription is now active. Welcome to Docta!' });
      // Refresh user data so access level updates
      if (refreshUser) refreshUser();
      // Clean the URL
      window.history.replaceState({}, '', '/patient/subscription');
    } else if (cancelled === 'true') {
      setPaymentStatus('cancelled');
      toast({ title: 'Payment Cancelled', description: 'No charges were made. You can try again anytime.', variant: 'destructive' });
      window.history.replaceState({}, '', '/patient/subscription');
    }
    fetchMembership();
  }, []);

  const fetchMembership = async () => {
    try {
      const response = await membershipAPI.getMe();
      if (response.data.success) {
        setMembership(response.data.card);
        setSubscription(response.data.subscription);
        setAccessLevel(response.data.accessLevel || user?.accessLevel || 'read_only');
      }
    } catch (error) {
      console.error('Failed to fetch membership:', error);
    }
  };

  const handleSubscribe = async (planKey) => {
    if (loading) return;

    setLoading(true);
    try {
      const response = await stripeAPI.createSubscriptionCheckout({ planKey });
      if (response.data?.success && response.data.checkout?.url) {
        window.location.href = response.data.checkout.url;
        return;
      }
      throw new Error(response.data?.error || 'Failed to create checkout');
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || error.message || 'Failed to start subscription checkout',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => {
    // User chooses read-only access
    toast({
      title: 'Read-only Access',
      description: 'You can browse content but cannot book consultations. Subscribe anytime to unlock full features.',
      variant: 'default'
    });
    router.push('/patient/dashboard');
  };

  const plans = [
    {
      id: 'basic',
      name: 'Docta Basic',
      price: '$19.99',
      period: 'per month',
      description: 'Essentials for ongoing care and messaging',
      features: [
        'Unlimited messaging with providers',
        '2 telehealth consultations per month',
        'Prescription access',
        'Health records access'
      ],
      popular: false
    },
    {
      id: 'gold',
      name: 'Docta Gold',
      price: '$39.99',
      period: 'per month',
      description: 'Unlimited consultations + priority access + Gold card',
      features: [
        'Unlimited video consultations',
        'Prescription access',
        'Priority support',
        '24/7 urgent care access',
        'Docta Gold membership card'
      ],
      popular: true
    },
    {
      id: 'goldYearly',
      name: 'Docta Gold (Annual)',
      price: '$299',
      period: 'per year',
      description: 'Gold membership billed annually (best value)',
      features: [
        'All Gold features',
        'Annual savings',
        'Docta Gold membership card'
      ],
      popular: false,
      savings: 'Save vs monthly'
    },
    {
      id: 'platinum',
      name: 'Docta Platinum',
      price: '$79.99',
      period: 'per month',
      description: 'Premium care coordination + Platinum card',
      features: [
        'All Gold features',
        'Dedicated care coordinator',
        'Family plan (up to 4 members)',
        'Docta Platinum membership card'
      ],
      popular: false
    }
  ];

  const isPaidUser = ['basic_monthly', 'gold_monthly', 'gold_yearly', 'platinum_monthly', 'pay_per_visit', 'insurance'].includes(accessLevel);
  const hasActiveSubscription = subscription && subscription.status === 'active';

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      {/* Payment Status Banners */}
      {paymentStatus === 'success' && (
        <div className="mb-6 p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 flex items-center gap-3">
          <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0" />
          <div>
            <p className="font-semibold text-green-800 dark:text-green-300">Payment Successful!</p>
            <p className="text-sm text-green-700 dark:text-green-400">Your subscription is active. You now have full access to Docta telehealth services.</p>
          </div>
          <Button variant="default" size="sm" className="ml-auto" onClick={() => router.push('/patient/dashboard')}>
            Go to Dashboard
          </Button>
        </div>
      )}

      {paymentStatus === 'cancelled' && (
        <div className="mb-6 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 flex items-center gap-3">
          <XCircle className="w-6 h-6 text-amber-600 flex-shrink-0" />
          <div>
            <p className="font-semibold text-amber-800 dark:text-amber-300">Payment Cancelled</p>
            <p className="text-sm text-amber-700 dark:text-amber-400">No charges were made. Choose a plan below when you are ready.</p>
          </div>
        </div>
      )}

      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold mb-2">Choose Your Plan</h1>
        <p className="text-muted-foreground">
          Select a subscription or continue with read-only access
        </p>
      </div>

      {hasActiveSubscription && (
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          <Card className="border-green-500/30 bg-green-50/60 dark:bg-green-500/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Check className="w-5 h-5 text-green-600" />
                Active Subscription
              </CardTitle>
              <CardDescription>
                Tier: {subscription.tier} • Status: {subscription.status}
              </CardDescription>
            </CardHeader>
          </Card>

          <MembershipCard user={user} card={membership} subscription={subscription} />
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-6 mb-6">
        {plans.map((plan) => (
          <Card
            key={plan.id}
            className={`relative ${plan.popular ? 'border-2 border-blue-500 shadow-lg' : ''}`}
          >
            {plan.popular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-500 text-white px-3 py-1 rounded-full text-xs font-semibold">
                BEST VALUE
              </div>
            )}
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Crown className="w-5 h-5 text-yellow-500" />
                {plan.name}
              </CardTitle>
              <CardDescription>{plan.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  <span className="text-muted-foreground">{plan.period}</span>
                </div>
                {plan.originalPrice && (
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-sm text-muted-foreground line-through">{plan.originalPrice}/year</span>
                    <span className="text-sm font-semibold text-green-600">{plan.savings}</span>
                  </div>
                )}
              </div>
              <ul className="space-y-2">
                {plan.features.map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span className="text-sm">{feature}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              <Button
                className="w-full"
                variant={plan.popular ? 'default' : 'outline'}
                onClick={() => handleSubscribe(plan.id)}
                disabled={loading}
              >
                {loading ? 'Processing...' : 'Subscribe'}
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      {hasActiveSubscription && (
        <div className="mb-6">
          <InsuranceCardUploader title="Validate your insurance card (optional)" />
        </div>
      )}

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Read-Only Access (Free)
          </CardTitle>
          <CardDescription>
            Browse educational content, wellness tips, and provider information
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 mb-4">
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
              <span className="text-sm">Browse educational health content</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
              <span className="text-sm">View wellness tips and promotions</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
              <span className="text-sm">Explore provider information</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0">✗</span>
              <span className="text-sm text-muted-foreground">Cannot book consultations</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0">✗</span>
              <span className="text-sm text-muted-foreground">Cannot join waiting rooms</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0">✗</span>
              <span className="text-sm text-muted-foreground">No prescription access</span>
            </li>
          </ul>
        </CardContent>
        <CardFooter>
          <Button
            variant="outline"
            className="w-full"
            onClick={handleSkip}
          >
            Continue with Read-Only Access
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

export default function SubscriptionPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[400px]"><Loader2 className="w-8 h-8 animate-spin text-purple-600" /></div>}>
      <SubscriptionContent />
    </Suspense>
  );
}

