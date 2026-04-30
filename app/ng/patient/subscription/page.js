'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Sparkles, CheckCircle, Zap, Shield, ChevronRight,
  CreditCard, AlertCircle, Clock, ArrowRight, X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import NgNav from '../../components/NgNav';
import { SUBSCRIPTION_PLANS, formatNaira } from '../../lib/ngUtils';

const STATUS_STYLES = {
  active: 'bg-green-500/10 text-green-600 border-green-500/20',
  trial: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  past_due: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  canceled: 'bg-muted text-muted-foreground border-border',
  expired: 'bg-red-500/10 text-red-600 border-red-500/20',
};

export default function NgPatientSubscription() {
  const [subscription, setSubscription] = useState(null);
  const [billingHistory, setBillingHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [billingCycle, setBillingCycle] = useState('monthly');
  const [subscribing, setSubscribing] = useState(false);
  const [message, setMessage] = useState('');

  const plans = SUBSCRIPTION_PLANS.patient;

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) { setLoading(false); return; }
    Promise.all([
      fetch('/api/ng/subscriptions/me', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      fetch('/api/ng/subscriptions/billing-history', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
    ]).then(([sub, billing]) => {
      setSubscription(sub.subscription);
      setBillingHistory(billing.records || []);
    }).catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSubscribe = async (plan) => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      window.location.href = '/ng/auth/login?redirect=/ng/patient/subscription';
      return;
    }
    setSubscribing(true);
    setMessage('');
    try {
      const res = await fetch('/api/ng/subscriptions/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan_key: plan.id, billing_cycle: billingCycle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to subscribe');

      // Initiate payment
      const payRes = await fetch(`/api/ng/subscriptions/${data.subscription.id}/initiate-payment`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const payData = await payRes.json();

      // Open Paystack inline (when PAYSTACK_PUBLIC_KEY is available)
      const paystackKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY;
      if (paystackKey && typeof window !== 'undefined' && window.PaystackPop) {
        const handler = window.PaystackPop.setup({
          key: paystackKey,
          email: payData.email,
          amount: payData.amount_kobo,
          currency: 'NGN',
          ref: payData.reference,
          metadata: payData.metadata,
          callback: async (response) => {
            await fetch(`/api/ng/subscriptions/activate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ subscription_id: data.subscription.id, payment_reference: response.reference, payment_provider: 'paystack' }),
            });
            setMessage('Subscription activated! Your plan is now active.');
            setSubscription({ ...data.subscription, status: 'active' });
          },
          onClose: () => setMessage('Payment cancelled.'),
        });
        handler.openIframe();
      } else {
        setMessage('Subscription created. Complete payment to activate. Payment gateway will be available shortly.');
        setSubscription(data.subscription);
      }
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSubscribing(false);
    }
  };

  const handleCancel = async () => {
    if (!subscription || !confirm('Cancel your subscription? Access continues until the end of the billing period.')) return;
    const token = localStorage.getItem('accessToken');
    const res = await fetch(`/api/ng/subscriptions/${subscription.id}/cancel`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setSubscription(s => ({ ...s, status: 'canceled' }));
      setMessage('Subscription canceled. Access continues until period end.');
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <NgNav />
      <div className="pt-14">
        {/* Header */}
        <div className="border-b border-border bg-card/40 px-6 py-8">
          <div className="max-w-5xl mx-auto">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
              <Link href="/ng/patient/dashboard" className="hover:text-foreground">Dashboard</Link>
              <ChevronRight size={14} /> <span>Subscription</span>
            </div>
            <h1 className="text-3xl font-bold text-foreground">Your Care Plan</h1>
            <p className="text-muted-foreground mt-1">Manage your DoctaRx Nigeria subscription and billing.</p>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-6 py-8 space-y-10">

          {message && (
            <div className={`rounded-2xl p-4 border text-sm ${message.startsWith('Error') ? 'bg-red-500/10 border-red-500/20 text-red-600' : 'bg-green-500/10 border-green-500/20 text-green-700'}`}>
              {message}
            </div>
          )}

          {/* Current subscription */}
          {!loading && subscription && (
            <div className="bg-card border border-border rounded-2xl p-6">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-green-500/10 rounded-2xl flex items-center justify-center">
                    <Shield size={24} className="text-green-500" />
                  </div>
                  <div>
                    <div className="font-bold text-foreground text-lg capitalize">{subscription.plan_key?.replace('patient_', '')} Plan</div>
                    <div className="text-sm text-muted-foreground">{formatNaira(subscription.amount_per_period)} / {subscription.billing_cycle}</div>
                  </div>
                </div>
                <div className={`px-3 py-1 rounded-full text-sm font-bold border ${STATUS_STYLES[subscription.status] || STATUS_STYLES.canceled} capitalize`}>
                  {subscription.status}
                </div>
              </div>

              <div className="grid sm:grid-cols-3 gap-4 mt-6 pt-6 border-t border-border text-sm">
                <div>
                  <div className="text-muted-foreground">Period</div>
                  <div className="font-medium text-foreground mt-1">
                    {new Date(subscription.current_period_start).toLocaleDateString('en-NG')} →{' '}
                    {new Date(subscription.current_period_end).toLocaleDateString('en-NG')}
                  </div>
                </div>
                {subscription.trial_ends_at && (
                  <div>
                    <div className="text-muted-foreground">Trial ends</div>
                    <div className="font-medium text-foreground mt-1">{new Date(subscription.trial_ends_at).toLocaleDateString('en-NG')}</div>
                  </div>
                )}
                <div>
                  <div className="text-muted-foreground">Payment</div>
                  <div className="font-medium text-foreground mt-1 capitalize">{subscription.payment_provider || 'Pending'}</div>
                </div>
              </div>

              {subscription.status === 'active' && (
                <div className="mt-4 flex gap-3">
                  <button onClick={handleCancel} className="text-sm text-red-500 hover:underline">Cancel subscription</button>
                </div>
              )}
            </div>
          )}

          {/* Plans */}
          <div>
            <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
              <h2 className="text-2xl font-bold text-foreground">
                {subscription ? 'Upgrade or Change Plan' : 'Choose Your Plan'}
              </h2>
              <div className="flex items-center bg-card border border-border rounded-xl p-1 gap-1">
                {['monthly', 'annual'].map(cycle => (
                  <button
                    key={cycle}
                    onClick={() => setBillingCycle(cycle)}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all capitalize ${
                      billingCycle === cycle ? 'bg-green-600 text-white' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {cycle}
                    {cycle === 'annual' && <span className="ml-1.5 text-[10px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-full">Save 20%</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* Pay-as-you-go */}
            <div className="bg-card border border-border rounded-2xl p-5 mb-4 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="font-bold text-foreground">Pay-as-You-Go</div>
                <div className="text-sm text-muted-foreground mt-1">No subscription needed. Pay per consultation.</div>
                <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
                  <span>General: <strong className="text-foreground">₦2,000–₦5,000</strong></span>
                  <span>Specialist: <strong className="text-foreground">₦5,000–₦15,000</strong></span>
                </div>
              </div>
              <Link href="/ng/patient/appointments/book">
                <Button variant="outline" className="rounded-xl">Book Now</Button>
              </Link>
            </div>

            <div className="grid md:grid-cols-3 gap-5">
              {plans.map((plan) => {
                const isCurrentPlan = subscription?.plan_key === plan.id && subscription?.status === 'active';
                const annualPrice = billingCycle === 'annual' ? Math.round(plan.price * 0.8) : plan.price;
                return (
                  <div key={plan.id} className={`relative bg-background rounded-3xl p-7 border flex flex-col ${plan.highlight ? 'border-green-500/40 shadow-[0_0_30px_rgba(22,163,74,0.1)]' : 'border-border'}`}>
                    {plan.highlight && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-green-600 text-white text-[10px] font-bold px-4 py-1 rounded-full uppercase tracking-wider">
                        Most Popular
                      </div>
                    )}
                    <div className="font-bold text-muted-foreground mb-2">{plan.name}</div>
                    <div className="flex items-end gap-1 mb-1">
                      <span className="text-4xl font-bold text-foreground">{formatNaira(annualPrice)}</span>
                      <span className="text-muted-foreground mb-1">/mo</span>
                    </div>
                    {billingCycle === 'annual' && (
                      <div className="text-xs text-green-600 font-medium mb-1">Billed annually — save 20%</div>
                    )}
                    {plan.consultations > 0 && (
                      <div className="text-xs text-green-600 font-semibold mb-4">
                        {plan.consultations === -1 ? 'Unlimited consultations' : `${plan.consultations} consultation${plan.consultations > 1 ? 's' : ''}/month included`}
                      </div>
                    )}
                    <ul className="space-y-2.5 flex-1 mb-6">
                      {plan.features.map((f, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                          <CheckCircle size={14} className="text-green-500 mt-0.5 shrink-0" /> {f}
                        </li>
                      ))}
                    </ul>
                    {isCurrentPlan ? (
                      <div className="py-2.5 rounded-xl text-center text-sm font-bold text-green-600 bg-green-500/10 border border-green-500/20">
                        Current Plan
                      </div>
                    ) : (
                      <Button
                        onClick={() => handleSubscribe(plan)}
                        disabled={subscribing}
                        className={`w-full rounded-xl ${plan.highlight ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-card border border-border text-foreground hover:bg-accent'}`}
                      >
                        {subscribing ? 'Processing…' : plan.cta}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Billing history */}
          <div>
            <h2 className="text-xl font-bold text-foreground mb-4">Billing History</h2>
            {billingHistory.length === 0 ? (
              <div className="bg-card border border-border rounded-2xl p-8 text-center text-muted-foreground">
                <CreditCard size={32} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">No billing records yet.</p>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="text-left px-5 py-3 text-muted-foreground font-medium">Description</th>
                      <th className="text-left px-5 py-3 text-muted-foreground font-medium">Amount</th>
                      <th className="text-left px-5 py-3 text-muted-foreground font-medium">Status</th>
                      <th className="text-left px-5 py-3 text-muted-foreground font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billingHistory.map((record) => (
                      <tr key={record.id} className="border-b border-border last:border-0">
                        <td className="px-5 py-4 text-foreground">{record.description}</td>
                        <td className="px-5 py-4 font-semibold text-foreground">{formatNaira(record.amount)}</td>
                        <td className="px-5 py-4">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${
                            record.status === 'paid' ? 'bg-green-500/10 text-green-600 border-green-500/20' :
                            record.status === 'pending' ? 'bg-amber-500/10 text-amber-600 border-amber-500/20' :
                            'bg-red-500/10 text-red-600 border-red-500/20'
                          } capitalize`}>
                            {record.status}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-muted-foreground">{new Date(record.created_at).toLocaleDateString('en-NG')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
