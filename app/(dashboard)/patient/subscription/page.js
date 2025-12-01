'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { subscriptionsAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, Crown, CreditCard, Shield, Zap } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';

export default function SubscriptionPage() {
  const { user, refreshUser } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [subscription, setSubscription] = useState(null);
  const [accessLevel, setAccessLevel] = useState('read_only');

  useEffect(() => {
    fetchSubscription();
  }, []);

  const fetchSubscription = async () => {
    try {
      const response = await subscriptionsAPI.getMySubscription();
      if (response.data.success) {
        setSubscription(response.data.subscription);
        setAccessLevel(response.data.accessLevel || 'read_only');
      }
    } catch (error) {
      console.error('Failed to fetch subscription:', error);
    }
  };

  const handleSubscribe = async (type) => {
    if (loading) return;

    setLoading(true);
    try {
      const response = await subscriptionsAPI.createSubscription({ type });
      if (response.data.success) {
        toast({
          title: 'Success',
          description: 'Subscription created successfully!',
          variant: 'success'
        });
        await refreshUser();
        await fetchSubscription();
        router.push('/patient/dashboard');
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to create subscription',
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
      id: 'gold_monthly',
      name: 'Monthly Gold',
      price: '$39',
      period: 'per month',
      description: 'Unlimited consultations, prescriptions, and full access',
      features: [
        'Unlimited video consultations',
        'Prescription access',
        'Priority support',
        'Cancel anytime'
      ],
      popular: false
    },
    {
      id: 'gold_yearly',
      name: 'Yearly Gold',
      price: '$299',
      period: 'per year',
      originalPrice: '$468',
      savings: 'Save $169',
      description: 'Best value - Save 36% with annual billing',
      features: [
        'Unlimited video consultations',
        'Prescription access',
        'Priority support',
        'Cancel anytime',
        '36% savings vs monthly'
      ],
      popular: true
    },
    {
      id: 'pay_per_visit',
      name: 'Pay Per Visit',
      price: '$79',
      period: 'per consultation',
      description: 'Pay only when you need a consultation',
      features: [
        'Single consultation access',
        'Prescription access included',
        'No subscription commitment',
        'Pay as you go'
      ],
      popular: false
    }
  ];

  const isPaidUser = ['gold_monthly', 'gold_yearly', 'pay_per_visit', 'insurance'].includes(accessLevel);
  const hasActiveSubscription = subscription && subscription.status === 'active';

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold mb-2">Choose Your Plan</h1>
        <p className="text-muted-foreground">
          Select a subscription or continue with read-only access
        </p>
      </div>

      {hasActiveSubscription && (
        <Card className="mb-6 border-green-500 bg-green-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Check className="w-5 h-5 text-green-600" />
              Active Subscription
            </CardTitle>
            <CardDescription>
              {subscription.subscriptionType === 'monthly' ? 'Monthly Gold' : 'Yearly Gold'} - 
              Renews on {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
            </CardDescription>
          </CardHeader>
        </Card>
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
                disabled={loading || (plan.id === 'pay_per_visit' && hasActiveSubscription)}
              >
                {loading ? 'Processing...' : plan.id === 'pay_per_visit' ? 'Select' : 'Subscribe'}
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>

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

