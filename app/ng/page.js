'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ShieldCheck, Search, Package, Truck,
  Lock, ArrowRight, CheckCircle, Sparkles, Pill,
  CreditCard, Banknote, Building2, Phone,
  Upload, BarChart3, Wallet, Calendar,
  Stethoscope, Users, Hospital, Video,
  MessageSquare, FileText, Heart, Globe,
  Award, TrendingUp
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import NgNav from './components/NgNav';

const SectionHeading = ({ badge, title, subtitle, align = 'center' }) => (
  <div className={`flex flex-col gap-4 mb-12 ${align === 'center' ? 'items-center text-center' : 'items-start text-left'}`}>
    {badge && (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 text-xs font-semibold tracking-wide uppercase border border-green-500/20">
        <Sparkles size={10} /> {badge}
      </span>
    )}
    <h2 className="text-3xl md:text-5xl font-bold text-foreground tracking-tight leading-tight">{title}</h2>
    {subtitle && <p className="text-lg text-muted-foreground max-w-2xl leading-relaxed">{subtitle}</p>}
  </div>
);

const PORTALS = [
  {
    key: 'patient',
    icon: Pill,
    label: 'For Patients',
    color: 'text-green-600 dark:text-green-400',
    bg: 'bg-green-500/10',
    border: 'border-green-500/20',
    desc: 'Book consultations, manage prescriptions, track deliveries, and view your complete health record — all from your phone.',
    features: [
      'Book video consultations with verified doctors',
      'Upload & manage digital prescriptions',
      'Search medications and compare pharmacy prices',
      'View complete health records & history',
      'Secure messaging with your care team',
    ],
    cta: { label: 'Get Started as Patient', href: '/ng/auth/register?role=patient' },
    dash: { label: 'Patient Dashboard', href: '/ng/patient/dashboard' },
  },
  {
    key: 'provider',
    icon: Stethoscope,
    label: 'For Doctors',
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    desc: 'Manage your patients, conduct video consultations, write digital prescriptions, and track your earnings — all in one place.',
    features: [
      'Video consultation queue & scheduling',
      'Digital e-prescription writing',
      'Patient records & encounter notes',
      'Lab referral management',
      'Earnings tracking & payout management',
    ],
    cta: { label: 'Register as Provider', href: '/ng/provider/auth/register' },
    dash: { label: 'Provider Dashboard', href: '/ng/provider/dashboard' },
  },
  {
    key: 'organization',
    icon: Users,
    label: 'For Organisations',
    color: 'text-indigo-600 dark:text-indigo-400',
    bg: 'bg-indigo-500/10',
    border: 'border-indigo-500/20',
    desc: 'Provide healthcare access to your employees, members, students, or congregation. Flexible corporate plans for organisations of all sizes.',
    features: [
      'Corporate health subscription plans',
      'Member management & bulk upload',
      'Assign healthcare credits to members',
      'Usage dashboards & analytics',
      'Flexible billing — monthly or annual',
    ],
    cta: { label: 'Register Organisation', href: '/ng/organization/register' },
    dash: { label: 'Org Dashboard', href: '/ng/organization/dashboard' },
  },
  {
    key: 'hospital',
    icon: Hospital,
    label: 'For Hospitals & Clinics',
    color: 'text-rose-600 dark:text-rose-400',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/20',
    desc: 'Onboard your facility, manage staff, handle digital referrals, and prepare for FHIR-based health record interoperability.',
    features: [
      'Facility registration & verification',
      'Staff & department management',
      'Digital referral management',
      'Future FHIR R4 interoperability',
      'Featured listing in network directory',
    ],
    cta: { label: 'Register Hospital/Clinic', href: '/ng/hospital/register' },
    dash: { label: 'Hospital Dashboard', href: '/ng/hospital/dashboard' },
  },
  {
    key: 'pharmacy',
    icon: Package,
    label: 'For Pharmacies',
    color: 'text-teal-600 dark:text-teal-400',
    bg: 'bg-teal-500/10',
    border: 'border-teal-500/20',
    desc: 'Receive digital prescriptions, manage inventory, handle fulfillment, and grow your pharmacy business with automated bank settlements.',
    features: [
      'Real-time prescription queue',
      'Inventory & stock management',
      'Automated bank settlements (T+3)',
      'WhatsApp dispense flow (coming soon)',
      'Delivery partner integration',
    ],
    cta: { label: 'Register Pharmacy', href: '/ng/pharmacy/onboarding' },
    dash: { label: 'Pharmacy Dashboard', href: '/ng/pharmacy/dashboard' },
  },
];

const STATS = [
  { value: '500+', label: 'Partner Pharmacies' },
  { value: '2–4 hrs', label: 'Avg. Medication Delivery' },
  { value: '₦1,000', label: 'Starting Monthly Plans' },
  { value: '36+', label: 'States Covered' },
];

const TRUST_MARKS = [
  { icon: ShieldCheck, label: 'PCN Registered' },
  { icon: ShieldCheck, label: 'NAFDAC Compliant' },
  { icon: Lock, label: 'NDPA Compliant' },
  { icon: Award, label: 'MDCN Verified Doctors' },
];

export default function NigeriaHome() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('patient');

  const activePortal = PORTALS.find(p => p.key === activeTab);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-green-500/30">
      <NgNav />

      {/* ═══════════════════════ HERO ═══════════════════════ */}
      <section className="relative pt-28 pb-20 md:pt-32 md:pb-28 overflow-hidden px-6 bg-gradient-to-b from-background via-green-50/20 to-background dark:via-green-950/10">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-green-600/8 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-emerald-600/8 rounded-full blur-[120px] pointer-events-none" />

        <div className="max-w-7xl mx-auto relative z-10">
          <div className="text-center mb-12 space-y-6">
            <div className="inline-flex items-center gap-2 bg-green-500/10 border border-green-500/20 px-3 py-1 rounded-full backdrop-blur-sm">
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              <span className="text-xs font-semibold text-green-600 dark:text-green-400 tracking-wide uppercase">Nigeria's Complete Telehealth Platform</span>
            </div>

            <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold text-foreground tracking-tight leading-[1.1]">
              Healthcare for every<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-green-500 to-emerald-400">
                Nigerian.
              </span>
            </h1>

            <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              Book doctors, manage prescriptions, access corporate health plans, onboard hospitals and pharmacies — DoctaRx Nigeria is the complete health OS for patients, providers, organisations, and facilities.
            </p>

            {/* Quick search */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (searchQuery.trim()) window.location.href = `/ng/patient/search?q=${encodeURIComponent(searchQuery)}`;
              }}
              className="flex gap-3 max-w-xl mx-auto"
            >
              <div className="flex-1 flex items-center gap-3 bg-card border border-border rounded-2xl px-4 py-3 focus-within:border-green-500/50 focus-within:ring-1 focus-within:ring-green-500/30 transition-all shadow-sm">
                <Search size={18} className="text-muted-foreground shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search medications, doctors, pharmacies…"
                  className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground text-sm outline-none"
                />
              </div>
              <Button type="submit" className="bg-green-600 hover:bg-green-500 text-white px-6 rounded-2xl shadow-[0_0_20px_rgba(22,163,74,0.3)] shrink-0">
                Search
              </Button>
            </form>

            {/* Quick actions */}
            <div className="flex flex-wrap justify-center gap-3">
              {[
                { label: 'Book a Doctor', href: '/ng/patient/appointments', icon: Stethoscope, color: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
                { label: 'Search Medications', href: '/ng/patient/search', icon: Pill, color: 'bg-green-500/10 text-green-600 border-green-500/20' },
                { label: 'Upload Prescription', href: '/ng/patient/prescriptions', icon: Upload, color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
                { label: 'Corporate Plans', href: '/ng/organization/register', icon: Users, color: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20' },
                { label: 'Register Hospital', href: '/ng/hospital/register', icon: Hospital, color: 'bg-rose-500/10 text-rose-600 border-rose-500/20' },
              ].map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-all hover:scale-105 ${action.color}`}
                >
                  <action.icon size={15} />
                  {action.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto">
            {STATS.map((stat) => (
              <div key={stat.label} className="bg-card border border-border rounded-2xl p-4 text-center">
                <div className="text-2xl font-bold text-green-600">{stat.value}</div>
                <div className="text-xs text-muted-foreground mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════ PORTAL TABS ═══════════════════════ */}
      <section className="py-24 px-6">
        <div className="max-w-7xl mx-auto">
          <SectionHeading
            badge="Multi-Portal Platform"
            title="Built for everyone in healthcare"
            subtitle="DoctaRx Nigeria supports every participant in the healthcare system — from individual patients to large hospitals and corporations."
          />

          {/* Tab selector */}
          <div className="flex flex-wrap justify-center gap-2 mb-12">
            {PORTALS.map((portal) => {
              const Icon = portal.icon;
              return (
                <button
                  key={portal.key}
                  onClick={() => setActiveTab(portal.key)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border transition-all',
                    activeTab === portal.key
                      ? `${portal.bg} ${portal.color} ${portal.border}`
                      : 'bg-card text-muted-foreground border-border hover:bg-accent hover:text-foreground'
                  )}
                >
                  <Icon size={15} />
                  {portal.label}
                </button>
              );
            })}
          </div>

          {/* Active portal detail */}
          {activePortal && (
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div className="space-y-6">
                <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl ${activePortal.bg} ${activePortal.color} ${activePortal.border} border text-sm font-semibold`}>
                  <activePortal.icon size={16} />
                  {activePortal.label}
                </div>
                <h3 className="text-3xl font-bold text-foreground leading-tight">
                  {activePortal.desc}
                </h3>
                <ul className="space-y-3">
                  {activePortal.features.map((feat, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <CheckCircle size={18} className="text-green-500 mt-0.5 shrink-0" />
                      <span className="text-foreground">{feat}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-3 flex-wrap">
                  <Link href={activePortal.cta.href}>
                    <Button className="bg-green-600 hover:bg-green-500 text-white shadow-lg">
                      {activePortal.cta.label} <ArrowRight className="ml-2 w-4 h-4" />
                    </Button>
                  </Link>
                  <Link href={activePortal.dash.href}>
                    <Button variant="outline">
                      {activePortal.dash.label}
                    </Button>
                  </Link>
                </div>
              </div>

              {/* Visual mockup */}
              <div className="relative rounded-3xl overflow-hidden shadow-2xl border border-border bg-gradient-to-br from-slate-900 via-green-950/40 to-slate-900 aspect-[4/3] p-6 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className={`flex items-center gap-2 ${activePortal.color}`}>
                    <activePortal.icon size={16} />
                    <span className="font-bold text-sm">{activePortal.label}</span>
                  </div>
                  <div className="text-[10px] text-white/40 font-mono">DoctaRx NG</div>
                </div>

                <div className="space-y-2 flex-1">
                  {activePortal.features.slice(0, 4).map((feat, i) => (
                    <div key={i} className="bg-white/10 backdrop-blur-sm rounded-xl p-3 border border-white/10 flex items-center gap-3">
                      <div className={`w-7 h-7 rounded-lg ${activePortal.bg} flex items-center justify-center shrink-0`}>
                        <CheckCircle size={14} className="text-green-400" />
                      </div>
                      <span className="text-white/80 text-xs">{feat}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-auto">
                  <div className={`w-full py-2.5 rounded-xl ${activePortal.bg} border ${activePortal.border} text-center ${activePortal.color} text-sm font-bold`}>
                    {activePortal.dash.label} →
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ═══════════════════════ ORGANISATION PLANS ═══════════════════════ */}
      <section className="py-24 px-6 bg-card/40 border-y border-border">
        <div className="max-w-7xl mx-auto">
          <SectionHeading
            badge="For Organisations"
            title="Corporate health plans for every organisation"
            subtitle="From 25-person churches to 5,000-person companies — DoctaRx Nigeria has a healthcare plan for your organisation."
          />

          <div className="grid md:grid-cols-3 gap-6 mb-12">
            {[
              {
                name: 'Starter',
                price: '₦40,000',
                period: '/month',
                members: 'Up to 25 members',
                perMember: '₦1,600/member',
                features: ['Admin dashboard', 'Member management', 'Usage summaries', 'Basic health access', 'Email & SMS invitations'],
                color: 'border-border',
                highlight: false,
              },
              {
                name: 'Growth',
                price: '₦120,000',
                period: '/month',
                members: 'Up to 100 members',
                perMember: '₦1,200/member',
                features: ['Everything in Starter', 'Bulk CSV member upload', 'Role management (HR/Billing)', 'Care access groups', 'Priority doctor access', 'Invoice generation'],
                color: 'border-green-500/40',
                highlight: true,
              },
              {
                name: 'Enterprise',
                price: 'Custom',
                period: '',
                members: 'Unlimited members',
                perMember: 'Flexible pricing',
                features: ['Everything in Growth', 'Custom contracts & SLA', 'Dedicated account manager', 'AI health analytics', 'On-site health campaigns', 'NHIA/HMO compatibility'],
                color: 'border-indigo-500/30',
                highlight: false,
              },
            ].map((plan) => (
              <div key={plan.name} className={`relative bg-background rounded-3xl p-8 border ${plan.color} flex flex-col ${plan.highlight ? 'shadow-[0_0_40px_rgba(22,163,74,0.12)]' : ''}`}>
                {plan.highlight && (
                  <div className="absolute top-0 right-6 bg-green-600 text-white text-[10px] font-bold px-3 py-1 rounded-b-xl uppercase tracking-wider">
                    Most Popular
                  </div>
                )}
                <div className="text-sm font-semibold text-muted-foreground mb-2">{plan.name}</div>
                <div className="flex items-end gap-1 mb-1">
                  <span className="text-4xl font-bold text-foreground">{plan.price}</span>
                  <span className="text-muted-foreground mb-1">{plan.period}</span>
                </div>
                <div className="text-sm text-green-600 font-medium mb-1">{plan.members}</div>
                <div className="text-xs text-muted-foreground mb-6">{plan.perMember}</div>
                <ul className="space-y-3 flex-1 mb-8">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <CheckCircle size={15} className="text-green-500 mt-0.5 shrink-0" /> {f}
                    </li>
                  ))}
                </ul>
                <Link href={plan.name === 'Enterprise' ? '/ng/pricing#enterprise' : '/ng/organization/register'} className={`block text-center py-3 rounded-xl font-bold transition-colors ${plan.highlight ? 'bg-green-600 hover:bg-green-500 text-white' : 'border border-border hover:bg-accent text-foreground'}`}>
                  {plan.name === 'Enterprise' ? 'Contact Sales' : `Get ${plan.name}`}
                </Link>
              </div>
            ))}
          </div>

          <div className="text-center">
            <p className="text-muted-foreground text-sm mb-4">
              Per-member pricing also available: <strong>₦1,000–₦2,000/member/month</strong> depending on organisation size
            </p>
            <Link href="/ng/pricing" className="inline-flex items-center gap-2 text-green-600 font-semibold hover:opacity-80 transition-opacity">
              View full pricing details <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ HOW IT WORKS ═══════════════════════ */}
      <section className="py-24 px-6">
        <div className="max-w-7xl mx-auto">
          <SectionHeading
            title="Healthcare made simple"
            subtitle="Three steps to access quality healthcare anywhere in Nigeria."
          />

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: '01',
                icon: Users,
                title: 'Register your account',
                desc: 'Create a patient, provider, organisation, hospital, or pharmacy account. Verification takes minutes.',
                color: 'text-green-500',
                bg: 'bg-green-500/10',
              },
              {
                step: '02',
                icon: Calendar,
                title: 'Access services',
                desc: 'Book consultations, search medications, manage staff, issue prescriptions, or onboard your facility.',
                color: 'text-blue-500',
                bg: 'bg-blue-500/10',
              },
              {
                step: '03',
                icon: Heart,
                title: 'Pay securely',
                desc: 'Pay by card, bank transfer, or USSD. Corporate plans with monthly invoicing available.',
                color: 'text-rose-500',
                bg: 'bg-rose-500/10',
              },
            ].map((item) => (
              <div key={item.step} className="bg-card rounded-3xl p-8 border border-border hover:border-green-500/30 transition-all hover:shadow-xl group">
                <div className="flex items-start justify-between mb-6">
                  <div className={`w-14 h-14 rounded-2xl ${item.bg} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                    <item.icon size={26} className={item.color} />
                  </div>
                  <span className="text-5xl font-black text-muted-foreground/20">{item.step}</span>
                </div>
                <h3 className="text-xl font-bold text-foreground mb-3">{item.title}</h3>
                <p className="text-muted-foreground leading-relaxed text-sm">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════ FEATURES GRID ═══════════════════════ */}
      <section className="py-24 px-6 bg-card/40 border-y border-border">
        <div className="max-w-7xl mx-auto">
          <SectionHeading
            badge="Platform Features"
            title="Everything you need. Nothing you don't."
          />

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { icon: Video, title: 'Video Consultations', desc: 'Consult with verified Nigerian doctors from anywhere via secure video call.', status: 'coming_soon' },
              { icon: Pill, title: 'Digital Prescriptions', desc: 'Providers issue digital prescriptions routed directly to your chosen pharmacy.', status: 'available' },
              { icon: Search, title: 'Medication Search', desc: 'Search thousands of NAFDAC-approved drugs and compare prices from nearby pharmacies.', status: 'available' },
              { icon: Truck, title: 'Medication Delivery', desc: 'Get medications delivered within hours via Gokada, Kwik, or MaxNG.', status: 'available' },
              { icon: MessageSquare, title: 'Secure Messaging', desc: 'Message your doctor, care team, or pharmacy securely within the platform.', status: 'coming_soon' },
              { icon: FileText, title: 'Health Records', desc: 'Maintain a complete digital health record accessible anywhere, anytime.', status: 'coming_soon' },
              { icon: Users, title: 'Corporate Health Plans', desc: 'Organisations provide healthcare access to employees, students, or members.', status: 'available' },
              { icon: Hospital, title: 'Hospital Network', desc: 'Hospitals and clinics onboard, manage staff, and receive digital referrals.', status: 'available' },
              { icon: BarChart3, title: 'AI Health Analytics', desc: 'Premium organisations access anonymised health trend dashboards.', status: 'coming_soon' },
              { icon: Globe, title: 'NHIA/HMO Integration', desc: 'Future integration with NHIA and registered HMOs for cashless care.', status: 'coming_soon' },
              { icon: Phone, title: 'WhatsApp Dispense', desc: 'Pharmacies confirm and track prescription dispensing via WhatsApp Business.', status: 'coming_soon' },
              { icon: TrendingUp, title: 'Provider Earnings', desc: 'Doctors track consultations, commissions, and payouts in real time.', status: 'available' },
            ].map((feat) => (
              <div key={feat.title} className="group bg-card rounded-2xl p-6 border border-border hover:border-green-500/20 transition-all">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 bg-green-500/10 rounded-xl flex items-center justify-center">
                    <feat.icon size={20} className="text-green-500" />
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    feat.status === 'available'
                      ? 'bg-green-500/10 text-green-600 border-green-500/20'
                      : 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                  }`}>
                    {feat.status === 'available' ? 'Available' : 'Coming Soon'}
                  </span>
                </div>
                <h4 className="font-bold text-foreground mb-2">{feat.title}</h4>
                <p className="text-sm text-muted-foreground leading-relaxed">{feat.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════ TRUST & COMPLIANCE ═══════════════════════ */}
      <section className="py-16 px-6 bg-gradient-to-r from-slate-900 via-green-950 to-slate-900 border-y border-green-800/30">
        <div className="max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-semibold mb-6">
            <ShieldCheck size={14} /> Compliant &amp; Secure
          </div>
          <h3 className="text-2xl md:text-3xl font-bold text-white mb-4">
            Built to Nigerian healthcare standards
          </h3>
          <p className="text-slate-400 max-w-2xl mx-auto mb-10">
            DoctaRx Nigeria operates in compliance with the Nigeria Data Protection Act (NDPA), Pharmacy Council of Nigeria (PCN) regulations, NAFDAC guidelines, and MDCN provider verification standards.
          </p>
          <div className="flex flex-wrap justify-center gap-8">
            {TRUST_MARKS.map((mark) => (
              <div key={mark.label} className="flex items-center gap-2 text-slate-300 text-sm">
                <mark.icon size={16} className="text-green-400" />
                {mark.label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════ PAYMENT METHODS ═══════════════════════ */}
      <section className="py-16 px-6 bg-card/40 border-b border-border">
        <div className="max-w-4xl mx-auto text-center">
          <h3 className="text-2xl font-bold text-foreground mb-3">Pay however you prefer</h3>
          <p className="text-muted-foreground mb-10">All payment methods Nigerians trust, every day.</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { icon: Banknote, label: 'Cash / USSD', desc: 'Any USSD code or cash', color: 'text-green-500', bg: 'bg-green-500/10' },
              { icon: Building2, label: 'Bank Transfer', desc: 'Direct bank transfer', color: 'text-blue-500', bg: 'bg-blue-500/10' },
              { icon: CreditCard, label: 'Debit Card', desc: 'Visa, Mastercard, Verve', color: 'text-purple-500', bg: 'bg-purple-500/10' },
              { icon: Wallet, label: 'Digital Wallet', desc: 'Paystack, Flutterwave', color: 'text-amber-500', bg: 'bg-amber-500/10' },
            ].map((method) => (
              <div key={method.label} className="bg-background rounded-2xl p-6 border border-border text-center group hover:border-green-500/20 transition-colors">
                <div className={`w-14 h-14 ${method.bg} rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform`}>
                  <method.icon size={26} className={method.color} />
                </div>
                <div className="text-sm font-bold text-foreground">{method.label}</div>
                <div className="text-xs text-muted-foreground mt-1">{method.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════ CTA ═══════════════════════ */}
      <section className="py-20 px-6 bg-gradient-to-r from-green-700 to-emerald-600">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-4xl font-bold text-white mb-6">
            Nigeria's complete health OS — starting today
          </h2>
          <p className="text-xl text-green-100/90 mb-10 max-w-2xl mx-auto">
            Whether you're a patient, doctor, hospital, pharmacy, or organisation — DoctaRx Nigeria has everything you need to operate in the modern healthcare economy.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
            <Link href="/ng/auth/register">
              <Button size="lg" className="bg-white text-green-700 hover:bg-green-50 h-14 px-10 text-lg shadow-lg">
                Get Started Free <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Link>
            <Link href="/ng/pricing">
              <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10 h-14 px-10 text-lg">
                View Pricing
              </Button>
            </Link>
            <Link href="/ng/organization/register">
              <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10 h-14 px-10 text-lg">
                <Users className="mr-2 w-5 h-5" /> Register Organisation
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ FOOTER ═══════════════════════ */}
      <footer className="py-16 px-6 bg-slate-950 border-t border-slate-800">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-10 mb-12">
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-9 h-9 bg-green-600 rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(22,163,74,0.3)]">
                  <span className="text-white font-black text-sm">Rx</span>
                </div>
                <span className="text-white font-bold text-lg">DoctaRx <span className="text-green-400">NG</span></span>
              </div>
              <p className="text-slate-400 text-sm leading-relaxed max-w-xs">
                Nigeria's complete telehealth operating system — connecting patients, providers, pharmacies, hospitals, and organisations.
              </p>
            </div>

            {[
              {
                title: 'Patients',
                links: [
                  { label: 'Book Appointment', href: '/ng/patient/appointments' },
                  { label: 'Search Medications', href: '/ng/patient/search' },
                  { label: 'Upload Prescription', href: '/ng/patient/prescriptions' },
                  { label: 'Patient Dashboard', href: '/ng/patient/dashboard' },
                  { label: 'Subscription Plans', href: '/ng/pricing' },
                ],
              },
              {
                title: 'Providers & Facilities',
                links: [
                  { label: 'Register as Doctor', href: '/ng/provider/auth/register' },
                  { label: 'Provider Dashboard', href: '/ng/provider/dashboard' },
                  { label: 'Register Hospital', href: '/ng/hospital/register' },
                  { label: 'Register Pharmacy', href: '/ng/pharmacy/onboarding' },
                ],
              },
              {
                title: 'Organisations',
                links: [
                  { label: 'Register Organisation', href: '/ng/organization/register' },
                  { label: 'Organisation Dashboard', href: '/ng/organization/dashboard' },
                  { label: 'Corporate Pricing', href: '/ng/pricing#organisations' },
                  { label: 'Enterprise Plans', href: '/ng/pricing#enterprise' },
                ],
              },
              {
                title: 'Legal & Support',
                links: [
                  { label: 'Privacy Policy', href: '/privacy' },
                  { label: 'Terms of Service', href: '/terms' },
                  { label: 'Contact Us', href: '/contact' },
                  { label: 'FAQ', href: '/faq' },
                ],
              },
            ].map((col) => (
              <div key={col.title}>
                <div className="text-white font-bold mb-4">{col.title}</div>
                <div className="space-y-3">
                  {col.links.map((link) => (
                    <Link key={link.href} href={link.href} className="block text-slate-400 hover:text-white text-sm transition-colors">
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-slate-800 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex flex-wrap gap-4">
              <span className="text-slate-500 text-xs flex items-center gap-1.5"><CheckCircle size={10} className="text-green-600" /> PCN Registered</span>
              <span className="text-slate-500 text-xs flex items-center gap-1.5"><CheckCircle size={10} className="text-green-600" /> NDPA Compliant</span>
              <span className="text-slate-500 text-xs flex items-center gap-1.5"><CheckCircle size={10} className="text-green-600" /> NAFDAC Approved</span>
              <span className="text-slate-500 text-xs flex items-center gap-1.5"><CheckCircle size={10} className="text-green-600" /> MDCN Verified</span>
            </div>
            <div className="flex items-center gap-4">
              <p className="text-slate-500 text-sm">&copy; {new Date().getFullYear()} DoctaRx Nigeria.</p>
              <a href="mailto:ng@doctarx.com" className="text-slate-400 hover:text-white text-sm transition-colors">ng@doctarx.com</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

