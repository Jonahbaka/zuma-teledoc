'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Calendar, Video, MessageSquare, FileText, Clock,
  ChevronRight, Activity, Bell, Plus, Pill,
  Shield, Heart, AlertCircle, Phone, Stethoscope,
  TrendingUp, Droplets, ArrowRight, Sparkles, CreditCard,
  CheckCircle2, Package, MapPin, Truck, X, User
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FeatureGate } from '../../components/FeatureGate';
import NgNav from '../../components/NgNav';
import { formatNaira } from '../../lib/ngUtils';

const QUICK_ACTIONS = [
  { label: 'Book Consultation', href: '/ng/patient/appointments', icon: Stethoscope, color: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
  { label: 'Search Medications', href: '/ng/patient/search', icon: Pill, color: 'bg-green-500/10 text-green-600 border-green-500/20' },
  { label: 'Upload Prescription', href: '/ng/patient/prescriptions', icon: FileText, color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
  { label: 'Track Order', href: '/ng/patient/orders', icon: Truck, color: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
  { label: 'My Records', href: '/ng/patient/records', icon: Shield, color: 'bg-purple-500/10 text-purple-600 border-purple-500/20' },
  { label: 'Messages', href: '/ng/patient/messages', icon: MessageSquare, color: 'bg-rose-500/10 text-rose-600 border-rose-500/20' },
];

export default function NgPatientDashboard() {
  const [greeting, setGreeting] = useState('Good day');
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) setGreeting('Good morning');
    else if (hour < 17) setGreeting('Good afternoon');
    else setGreeting('Good evening');

    // Fetch subscription status
    const token = localStorage.getItem('accessToken');
    if (token) {
      fetch('/api/ng/subscriptions/me', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(d => setSubscription(d.subscription))
        .catch(() => {})
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const planLabel = subscription?.plan_key
    ? subscription.plan_key.replace('patient_', '').charAt(0).toUpperCase() + subscription.plan_key.replace('patient_', '').slice(1)
    : null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <NgNav />

      <div className="pt-14">
        {/* Header */}
        <div className="bg-gradient-to-r from-green-900/40 via-slate-900 to-emerald-900/30 border-b border-border px-6 py-8">
          <div className="max-w-5xl mx-auto">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="text-muted-foreground text-sm">{greeting}</p>
                <h1 className="text-3xl font-bold text-foreground mt-1">Patient Dashboard</h1>
                <p className="text-muted-foreground text-sm mt-1">Your health, all in one place.</p>
              </div>
              <div className="flex gap-2">
                <Link href="/ng/patient/appointments">
                  <Button className="bg-green-600 hover:bg-green-500 text-white">
                    <Plus size={16} className="mr-1.5" /> Book Consultation
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">

          {/* Subscription banner */}
          {!loading && !subscription && (
            <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20 rounded-2xl p-5 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-500/20 rounded-xl flex items-center justify-center">
                  <Sparkles size={20} className="text-green-500" />
                </div>
                <div>
                  <div className="font-bold text-foreground">Upgrade your care plan</div>
                  <div className="text-sm text-muted-foreground">Get 1 free consultation/month from ₦2,500/mo</div>
                </div>
              </div>
              <Link href="/ng/pricing">
                <Button className="bg-green-600 hover:bg-green-500 text-white shrink-0">View Plans</Button>
              </Link>
            </div>
          )}

          {!loading && subscription && (
            <div className="bg-card border border-green-500/20 rounded-2xl p-5 flex items-center gap-4">
              <div className="w-10 h-10 bg-green-500/10 rounded-xl flex items-center justify-center">
                <Shield size={20} className="text-green-500" />
              </div>
              <div className="flex-1">
                <div className="font-bold text-foreground">{planLabel} Plan</div>
                <div className="text-sm text-muted-foreground capitalize">{subscription.status} · Renews {new Date(subscription.current_period_end).toLocaleDateString('en-NG')}</div>
              </div>
              <Link href="/ng/patient/subscription" className="text-sm text-green-600 font-medium hover:underline">Manage →</Link>
            </div>
          )}

          {/* Quick actions */}
          <div>
            <h2 className="text-lg font-bold text-foreground mb-4">Quick Actions</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {QUICK_ACTIONS.map((action) => {
                const Icon = action.icon;
                return (
                  <Link
                    key={action.href}
                    href={action.href}
                    className={`flex flex-col items-center gap-2 p-4 rounded-2xl border text-center hover:scale-105 transition-all ${action.color} bg-opacity-50`}
                  >
                    <Icon size={22} />
                    <span className="text-xs font-semibold leading-tight">{action.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Main grid */}
          <div className="grid lg:grid-cols-3 gap-6">

            {/* Upcoming consultations */}
            <div className="lg:col-span-2 space-y-5">
              <div className="bg-card border border-border rounded-2xl p-6">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="font-bold text-foreground flex items-center gap-2">
                    <Calendar size={18} className="text-green-500" /> Upcoming Consultations
                  </h3>
                  <Link href="/ng/patient/appointments" className="text-sm text-green-600 font-medium hover:underline">View all</Link>
                </div>
                <FeatureGate type="nigeria_pending" available={false}>
                  <div className="space-y-3">
                    {/* Placeholder — real data when appointments are booked */}
                    <div className="bg-accent rounded-xl p-4">Loading…</div>
                  </div>
                </FeatureGate>
              </div>

              {/* Recent orders */}
              <div className="bg-card border border-border rounded-2xl p-6">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="font-bold text-foreground flex items-center gap-2">
                    <Package size={18} className="text-green-500" /> Recent Orders
                  </h3>
                  <Link href="/ng/patient/orders" className="text-sm text-green-600 font-medium hover:underline">View all</Link>
                </div>
                <div className="text-center py-8 text-muted-foreground">
                  <Package size={32} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No orders yet.</p>
                  <Link href="/ng/patient/search" className="mt-3 inline-flex items-center gap-1 text-green-600 text-sm font-medium hover:underline">
                    Search medications <ArrowRight size={14} />
                  </Link>
                </div>
              </div>
            </div>

            {/* Right sidebar */}
            <div className="space-y-5">
              {/* Health vitals — gated */}
              <div className="bg-card border border-border rounded-2xl p-5">
                <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
                  <Activity size={16} className="text-green-500" /> Health Vitals
                </h3>
                <FeatureGate type="nigeria_pending" available={false} compact={false}>
                  <div />
                </FeatureGate>
              </div>

              {/* Messages */}
              <div className="bg-card border border-border rounded-2xl p-5">
                <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
                  <MessageSquare size={16} className="text-green-500" /> Messages
                </h3>
                <FeatureGate type="nigeria_pending" available={false} compact={false}>
                  <div />
                </FeatureGate>
              </div>

              {/* Prescriptions */}
              <div className="bg-card border border-border rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-foreground flex items-center gap-2">
                    <Pill size={16} className="text-green-500" /> Prescriptions
                  </h3>
                  <Link href="/ng/patient/prescriptions" className="text-xs text-green-600 font-medium">View all</Link>
                </div>
                <div className="text-center py-4 text-muted-foreground">
                  <Pill size={24} className="mx-auto mb-2 opacity-30" />
                  <p className="text-xs">No active prescriptions.</p>
                  <Link href="/ng/patient/prescriptions" className="mt-2 inline-flex items-center gap-1 text-green-600 text-xs font-medium">
                    Upload prescription <ArrowRight size={12} />
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* Navigation tiles */}
          <div>
            <h2 className="text-lg font-bold text-foreground mb-4">Your Health Portal</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { label: 'Appointments', desc: 'Book & manage consultations', href: '/ng/patient/appointments', icon: Calendar, available: true },
                { label: 'Prescriptions', desc: 'Digital & uploaded prescriptions', href: '/ng/patient/prescriptions', icon: FileText, available: true },
                { label: 'Health Records', desc: 'Your complete medical history', href: '/ng/patient/records', icon: Shield, available: false, gate: 'nigeria_pending' },
                { label: 'Billing', desc: 'Invoices & payment history', href: '/ng/patient/billing', icon: CreditCard, available: true },
                { label: 'Subscription', desc: 'Manage your care plan', href: '/ng/patient/subscription', icon: Sparkles, available: true },
                { label: 'Profile & Settings', desc: 'Update your health profile', href: '/ng/patient/profile', icon: User, available: true },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} className="group bg-card border border-border rounded-2xl p-5 hover:border-green-500/30 transition-all hover:shadow-md">
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-10 h-10 bg-green-500/10 rounded-xl flex items-center justify-center group-hover:bg-green-500/20 transition-colors">
                        <Icon size={18} className="text-green-500" />
                      </div>
                      {!item.available && (
                        <span className="text-[10px] bg-amber-500/10 text-amber-600 border border-amber-500/20 px-1.5 py-0.5 rounded-full font-bold">Soon</span>
                      )}
                    </div>
                    <h4 className="font-bold text-foreground text-sm">{item.label}</h4>
                    <p className="text-xs text-muted-foreground mt-1">{item.desc}</p>
                  </Link>
                );
              })}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
