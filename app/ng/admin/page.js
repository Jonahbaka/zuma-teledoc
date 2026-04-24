'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Users, Building2, Stethoscope, ShoppingBag, CreditCard,
  TrendingUp, CheckCircle, AlertCircle, Clock, Shield,
  BarChart3, Flag, Star, FileText, ChevronRight,
  Activity, DollarSign, Package, Settings
} from 'lucide-react';
import { formatNaira } from '../lib/ngUtils';

export default function NigeriaAdminDashboard() {
  const [stats, setStats] = useState(null);
  const [pending, setPending] = useState({ providers: 0, hospitals: 0, pharmacies: 0, organizations: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    Promise.all([
      fetch('/api/ng/admin/dashboard-stats', { headers }).then(r => r.json()).catch(() => ({})),
      fetch('/api/ng/providers?status=pending&limit=1', { headers }).then(r => r.json()).catch(() => ({})),
      fetch('/api/ng/hospitals?status=pending&limit=1', { headers }).then(r => r.json()).catch(() => ({})),
    ]).then(([s, prov, hosp]) => {
      setStats(s);
      setPending({
        providers: prov.total || 0,
        hospitals: hosp.total || 0,
        pharmacies: s.pending_pharmacies || 0,
        organizations: s.pending_organizations || 0,
      });
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="animate-spin w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full" />
    </div>
  );

  const kpis = [
    { label: 'Providers', value: stats?.providers || 0, sub: `${pending.providers} pending`, icon: Stethoscope, color: 'text-blue-500', bg: 'bg-blue-500/10', href: '/ng/admin/providers' },
    { label: 'Hospitals', value: stats?.hospitals || 0, sub: `${pending.hospitals} pending`, icon: Building2, color: 'text-purple-500', bg: 'bg-purple-500/10', href: '/ng/admin/hospitals' },
    { label: 'Pharmacies', value: stats?.pharmacies || 0, sub: `${pending.pharmacies} pending`, icon: ShoppingBag, color: 'text-green-500', bg: 'bg-green-500/10', href: '/ng/admin/pharmacies' },
    { label: 'Organisations', value: stats?.organizations || 0, sub: `${pending.organizations} pending`, icon: Users, color: 'text-amber-500', bg: 'bg-amber-500/10', href: '/ng/admin/organizations' },
    { label: 'Active Subscriptions', value: stats?.active_subscriptions || 0, sub: 'patients + orgs', icon: CreditCard, color: 'text-indigo-500', bg: 'bg-indigo-500/10', href: '/ng/admin/subscriptions' },
    { label: 'Monthly Revenue', value: formatNaira(stats?.monthly_revenue || 0), sub: 'platform revenue', icon: TrendingUp, color: 'text-emerald-500', bg: 'bg-emerald-500/10', href: '/ng/admin/revenue' },
  ];

  const sections = [
    {
      title: 'Verifications',
      icon: Shield,
      items: [
        { label: 'Provider Verifications', desc: 'Review MDCN credentials & approve providers', href: '/ng/admin/providers', badge: pending.providers, badgeColor: 'bg-red-500' },
        { label: 'Hospital Registrations', desc: 'Verify hospitals & clinics', href: '/ng/admin/hospitals', badge: pending.hospitals, badgeColor: 'bg-red-500' },
        { label: 'Pharmacy Approvals', desc: 'PCN license verification', href: '/ng/admin/pharmacies', badge: pending.pharmacies, badgeColor: 'bg-amber-500' },
        { label: 'Organisation Accounts', desc: 'Verify corporate & NGO registrations', href: '/ng/admin/organizations', badge: pending.organizations, badgeColor: 'bg-amber-500' },
      ],
    },
    {
      title: 'Revenue & Billing',
      icon: DollarSign,
      items: [
        { label: 'Subscriptions', desc: 'Patient & organisation plan management', href: '/ng/admin/subscriptions', badge: 0 },
        { label: 'Revenue Analytics', desc: 'Platform income, GMV, commissions', href: '/ng/admin/revenue', badge: 0 },
        { label: 'Payouts', desc: 'Provider & pharmacy payout queue', href: '/ng/admin/revenue#payouts', badge: 0 },
        { label: 'Billing Disputes', desc: 'Handle refunds and billing issues', href: '/ng/admin/revenue#disputes', badge: 0 },
      ],
    },
    {
      title: 'Platform Management',
      icon: Settings,
      items: [
        { label: 'Feature Flags', desc: 'Toggle Nigeria features on/off', href: '/ng/admin/features', badge: 0 },
        { label: 'Sponsored Listings', desc: 'Pharmacy & provider spotlight campaigns', href: '/ng/admin/sponsorships', badge: 0 },
        { label: 'Compliance Audit', desc: 'NDPA, PCN & MDCN audit log', href: '/ng/admin/compliance', badge: 0 },
        { label: 'Platform Analytics', desc: 'Usage, retention, and growth metrics', href: '/ng/admin/analytics', badge: 0 },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-50 bg-card border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-black text-xs">Rx</span>
          </div>
          <span className="font-bold text-foreground">DoctaRx</span>
          <span className="text-xs bg-red-600 text-white px-2 py-0.5 rounded-full font-bold">NG ADMIN</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/ng" className="text-muted-foreground hover:text-foreground transition-colors">Nigeria</Link>
          <Link href="/admin" className="text-muted-foreground hover:text-foreground transition-colors">US Admin</Link>
          <div className="w-7 h-7 bg-indigo-500/20 rounded-full flex items-center justify-center">
            <Shield size={14} className="text-indigo-400" />
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">

        <div>
          <h1 className="text-2xl font-bold text-foreground">Nigeria Admin Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-0.5">DoctaRx Nigeria — Operations & Revenue Control</p>
        </div>

        {/* Pending alerts */}
        {(pending.providers + pending.hospitals + pending.pharmacies + pending.organizations) > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex items-start gap-3">
            <AlertCircle size={18} className="text-amber-500 shrink-0 mt-0.5" />
            <div className="text-sm">
              <strong className="text-foreground">Action required:</strong>{' '}
              <span className="text-muted-foreground">
                {[
                  pending.providers > 0 && `${pending.providers} provider(s) awaiting verification`,
                  pending.hospitals > 0 && `${pending.hospitals} hospital(s) pending approval`,
                  pending.pharmacies > 0 && `${pending.pharmacies} pharmacy approvals`,
                  pending.organizations > 0 && `${pending.organizations} organisation(s) to review`,
                ].filter(Boolean).join(', ')}.
              </span>
            </div>
          </div>
        )}

        {/* KPI grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {kpis.map((k) => {
            const Icon = k.icon;
            return (
              <Link key={k.label} href={k.href} className="bg-card border border-border rounded-2xl p-5 hover:border-border/80 hover:shadow-md transition-all group">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-muted-foreground">{k.label}</span>
                  <div className={`w-9 h-9 rounded-xl ${k.bg} flex items-center justify-center`}>
                    <Icon size={16} className={k.color} />
                  </div>
                </div>
                <div className="text-2xl font-bold text-foreground">{k.value}</div>
                <div className="text-xs text-muted-foreground mt-1">{k.sub}</div>
              </Link>
            );
          })}
        </div>

        {/* Admin sections */}
        <div className="grid lg:grid-cols-3 gap-6">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <div key={section.title} className="bg-card border border-border rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-border flex items-center gap-2">
                  <Icon size={16} className="text-muted-foreground" />
                  <h3 className="font-bold text-foreground text-sm">{section.title}</h3>
                </div>
                <div className="divide-y divide-border">
                  {section.items.map((item) => (
                    <Link key={item.href} href={item.href} className="flex items-center justify-between px-5 py-3.5 hover:bg-accent/50 transition-colors group">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{item.label}</span>
                          {item.badge > 0 && (
                            <span className={`text-[10px] ${item.badgeColor} text-white px-1.5 py-0.5 rounded-full font-bold min-w-[18px] text-center`}>
                              {item.badge}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.desc}</p>
                      </div>
                      <ChevronRight size={14} className="text-muted-foreground group-hover:text-foreground transition-colors shrink-0 ml-2" />
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Quick links */}
        <div className="bg-card border border-border rounded-2xl p-5">
          <h3 className="font-bold text-foreground text-sm mb-4">Quick Access</h3>
          <div className="flex flex-wrap gap-2">
            {[
              { label: 'Drug Catalog', href: '/ng/admin/drugs' },
              { label: 'Orders', href: '/ng/admin/orders' },
              { label: 'FHIR Integrations', href: '/ng/admin/fhir' },
              { label: 'WhatsApp Dispense Log', href: '/ng/admin/whatsapp-log' },
              { label: 'Campaign Manager', href: '/ng/admin/campaigns' },
              { label: 'Enterprise Contracts', href: '/ng/admin/enterprise' },
              { label: 'Support Tickets', href: '/ng/admin/support' },
              { label: 'System Health', href: '/ng/admin/system' },
            ].map(l => (
              <Link key={l.href} href={l.href} className="text-xs bg-accent text-foreground px-3 py-1.5 rounded-lg hover:bg-accent/80 transition-colors">
                {l.label}
              </Link>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
