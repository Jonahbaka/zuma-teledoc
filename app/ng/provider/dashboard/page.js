'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Calendar, Users, FileText, CreditCard, Video,
  Clock, CheckCircle, AlertCircle, TrendingUp,
  ChevronRight, Plus, Stethoscope, Activity,
  MessageSquare, ArrowRight, Pill, BarChart3,
  Shield, Settings, Star
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FeatureGate } from '../../components/FeatureGate';
import NgNav from '../../components/NgNav';
import { formatNaira } from '../../lib/ngUtils';

export default function NgProviderDashboard() {
  const [provider, setProvider] = useState(null);
  const [earnings, setEarnings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [greeting, setGreeting] = useState('Good day');

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) setGreeting('Good morning');
    else if (hour < 17) setGreeting('Good afternoon');
    else setGreeting('Good evening');

    const token = localStorage.getItem('accessToken');
    const providerId = localStorage.getItem('ng_provider_id');
    if (token && providerId) {
      Promise.all([
        fetch(`/api/ng/providers/profile/${providerId}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
        fetch(`/api/ng/providers/${providerId}/earnings`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      ]).then(([p, e]) => {
        setProvider(p.provider);
        setEarnings(e.summary);
      }).catch(() => {})
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const statusConfig = {
    pending: { label: 'Pending Review', color: 'text-amber-600', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
    verified: { label: 'Verified', color: 'text-green-600', bg: 'bg-green-500/10', border: 'border-green-500/20' },
    under_review: { label: 'Under Review', color: 'text-blue-600', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
    suspended: { label: 'Suspended', color: 'text-red-600', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  };
  const provStatus = statusConfig[provider?.status] || statusConfig.pending;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <NgNav />
      <div className="pt-14">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-900/40 via-slate-900 to-indigo-900/30 border-b border-border px-6 py-8">
          <div className="max-w-5xl mx-auto flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-muted-foreground text-sm">{greeting}</p>
              <h1 className="text-3xl font-bold text-foreground mt-1">
                {provider ? `Dr. ${provider.full_name}` : 'Provider Dashboard'}
              </h1>
              {provider && (
                <div className="flex items-center gap-3 mt-2">
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${provStatus.bg} ${provStatus.color} ${provStatus.border}`}>
                    {provStatus.label}
                  </span>
                  <span className="text-muted-foreground text-sm">{provider.specialty?.replace(/_/g, ' ')}</span>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Link href="/ng/provider/appointments">
                <Button className="bg-blue-600 hover:bg-blue-500 text-white">
                  <Plus size={16} className="mr-1.5" /> New Appointment
                </Button>
              </Link>
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">

          {/* Verification notice */}
          {provider?.status === 'pending' && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex items-start gap-3">
              <AlertCircle size={18} className="text-amber-500 shrink-0 mt-0.5" />
              <div className="text-sm">
                <strong className="text-foreground">Verification pending.</strong>{' '}
                <span className="text-muted-foreground">Your profile is under review. You'll receive an email notification once verified. Review typically takes 1–3 business days.</span>
              </div>
            </div>
          )}

          {/* Earnings summary */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Total Earned', value: formatNaira(earnings?.total_earned || 0), icon: TrendingUp, color: 'text-green-500', bg: 'bg-green-500/10' },
              { label: 'Pending Payout', value: formatNaira(earnings?.pending_payout || 0), icon: Clock, color: 'text-amber-500', bg: 'bg-amber-500/10' },
              { label: 'Total Paid Out', value: formatNaira(earnings?.total_paid_out || 0), icon: CreditCard, color: 'text-blue-500', bg: 'bg-blue-500/10' },
              { label: 'Consultations', value: (earnings?.total_consultations || 0).toString(), icon: Users, color: 'text-purple-500', bg: 'bg-purple-500/10' },
            ].map((stat) => {
              const Icon = stat.icon;
              return (
                <div key={stat.label} className="bg-card border border-border rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-muted-foreground">{stat.label}</span>
                    <div className={`w-9 h-9 rounded-xl ${stat.bg} flex items-center justify-center`}>
                      <Icon size={16} className={stat.color} />
                    </div>
                  </div>
                  <div className="text-2xl font-bold text-foreground">{stat.value}</div>
                </div>
              );
            })}
          </div>

          {/* Main grid */}
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-5">
              {/* Today's appointments */}
              <div className="bg-card border border-border rounded-2xl p-6">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="font-bold text-foreground flex items-center gap-2">
                    <Calendar size={18} className="text-blue-500" /> Today's Appointments
                  </h3>
                  <Link href="/ng/provider/appointments" className="text-sm text-blue-500 font-medium hover:underline">View all</Link>
                </div>
                <FeatureGate type="nigeria_pending" available={false}>
                  <div />
                </FeatureGate>
              </div>

              {/* Recent patients */}
              <div className="bg-card border border-border rounded-2xl p-6">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="font-bold text-foreground flex items-center gap-2">
                    <Users size={18} className="text-blue-500" /> Recent Patients
                  </h3>
                  <Link href="/ng/provider/patients" className="text-sm text-blue-500 font-medium hover:underline">View all</Link>
                </div>
                <div className="text-center py-8 text-muted-foreground">
                  <Users size={32} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No patients yet.</p>
                  <p className="text-xs mt-1">Patients will appear here after your first consultations.</p>
                </div>
              </div>
            </div>

            {/* Right sidebar */}
            <div className="space-y-5">
              {/* Availability toggle */}
              <div className="bg-card border border-border rounded-2xl p-5">
                <h3 className="font-bold text-foreground mb-4">Availability</h3>
                <FeatureGate type="nigeria_pending" available={false} compact={false}>
                  <div />
                </FeatureGate>
              </div>

              {/* Earnings shortcut */}
              <Link href="/ng/provider/earnings" className="block bg-gradient-to-br from-blue-900/30 to-indigo-900/20 border border-blue-500/20 rounded-2xl p-5 hover:border-blue-500/40 transition-all group">
                <div className="flex items-center justify-between mb-3">
                  <TrendingUp size={20} className="text-blue-400" />
                  <ArrowRight size={16} className="text-muted-foreground group-hover:text-blue-400 transition-colors" />
                </div>
                <div className="text-lg font-bold text-foreground">{formatNaira(earnings?.pending_payout || 0)}</div>
                <div className="text-sm text-muted-foreground">Pending payout</div>
                <div className="text-xs text-blue-400 mt-2 font-medium">View Earnings →</div>
              </Link>

              {/* Messages */}
              <div className="bg-card border border-border rounded-2xl p-5">
                <h3 className="font-bold text-foreground mb-3 flex items-center gap-2">
                  <MessageSquare size={16} className="text-blue-500" /> Messages
                </h3>
                <FeatureGate type="nigeria_pending" available={false} compact={false}>
                  <div />
                </FeatureGate>
              </div>
            </div>
          </div>

          {/* Navigation tiles */}
          <div>
            <h2 className="text-lg font-bold text-foreground mb-4">Provider Portal</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { label: 'Appointments', desc: 'View & manage patient appointments', href: '/ng/provider/appointments', icon: Calendar, available: false, gate: 'nigeria_pending' },
                { label: 'My Patients', desc: 'Patient roster & records', href: '/ng/provider/patients', icon: Users, available: false, gate: 'nigeria_pending' },
                { label: 'Prescriptions', desc: 'Write and manage digital prescriptions', href: '/ng/provider/prescriptions', icon: Pill, available: true },
                { label: 'My Earnings', desc: 'Track consultations & payouts', href: '/ng/provider/earnings', icon: CreditCard, available: true },
                { label: 'Analytics', desc: 'Performance & consultation trends', href: '/ng/provider/earnings#analytics', icon: BarChart3, available: false, gate: 'subscription_required' },
                { label: 'Settings', desc: 'Profile, availability & fees', href: '/ng/provider/profile', icon: Settings, available: true },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} className="group bg-card border border-border rounded-2xl p-5 hover:border-blue-500/20 transition-all hover:shadow-md">
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center group-hover:bg-blue-500/20 transition-colors">
                        <Icon size={18} className="text-blue-500" />
                      </div>
                      {!item.available && (
                        <span className="text-[10px] bg-amber-500/10 text-amber-600 border border-amber-500/20 px-1.5 py-0.5 rounded-full font-bold">
                          {item.gate === 'subscription_required' ? 'Pro' : 'Soon'}
                        </span>
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
