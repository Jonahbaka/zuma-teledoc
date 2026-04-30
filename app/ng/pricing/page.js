'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CheckCircle2,
  CreditCard,
  HeartPulse,
  Hospital,
  Mail,
  Menu,
  Package,
  Pill,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Users,
  X,
} from 'lucide-react';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';
import { cn } from '@/lib/utils';
import { SUBSCRIPTION_PLANS, formatNaira } from '../lib/ngUtils';

const AUDIENCES = [
  { id: 'patients', label: 'Patients', icon: HeartPulse },
  { id: 'organisations', label: 'Organisations', icon: Users },
  { id: 'providers', label: 'Providers', icon: Stethoscope },
  { id: 'hospitals', label: 'Hospitals', icon: Hospital },
  { id: 'pharmacies', label: 'Pharmacies', icon: Package },
];

const HEADER_LINKS = [
  { label: 'Home', href: '/ng' },
  { label: 'Medicines', href: '/ng/medicines' },
  { label: 'Pricing', href: '/ng/pricing' },
  { label: 'Providers', href: '/ng/provider/register' },
  { label: 'Pharmacies', href: '/ng/pharmacy/onboarding' },
];

const TONES = {
  green: {
    check: 'text-green-600',
    button: 'bg-green-600 text-white hover:bg-green-500',
    highlight: 'border-green-500/50 shadow-[0_22px_60px_rgba(22,163,74,0.14)]',
    badge: 'bg-green-600 text-white',
  },
  blue: {
    check: 'text-blue-600',
    button: 'bg-blue-600 text-white hover:bg-blue-500',
    highlight: 'border-blue-500/50 shadow-[0_22px_60px_rgba(37,99,235,0.14)]',
    badge: 'bg-blue-600 text-white',
  },
  rose: {
    check: 'text-rose-600',
    button: 'bg-rose-600 text-white hover:bg-rose-500',
    highlight: 'border-rose-500/50 shadow-[0_22px_60px_rgba(225,29,72,0.14)]',
    badge: 'bg-rose-600 text-white',
  },
  teal: {
    check: 'text-teal-600',
    button: 'bg-teal-600 text-white hover:bg-teal-500',
    highlight: 'border-teal-500/50 shadow-[0_22px_60px_rgba(13,148,136,0.14)]',
    badge: 'bg-teal-600 text-white',
  },
  indigo: {
    check: 'text-indigo-600',
    button: 'bg-indigo-600 text-white hover:bg-indigo-500',
    highlight: 'border-indigo-500/50 shadow-[0_22px_60px_rgba(79,70,229,0.14)]',
    badge: 'bg-indigo-600 text-white',
  },
};

const consultationExamples = [
  { label: 'General consultation', value: '₦2,000-₦5,000' },
  { label: 'Specialist consultation', value: '₦5,000-₦15,000' },
  { label: 'Follow-up review', value: '₦1,500-₦4,000' },
];

const organisationTiers = [
  { range: '1-50 members', price: '₦2,000', per: '/member/month' },
  { range: '51-200 members', price: '₦1,500', per: '/member/month' },
  { range: '200+ members', price: '₦1,000', per: '/member/month' },
];

const organisationAddOns = [
  { label: 'Priority doctor access', price: '+₦500/member/month' },
  { label: 'Chronic care support', price: '+₦1,000/member/month' },
  { label: 'Health analytics reporting', price: 'Quoted after needs review' },
  { label: 'On-site health campaign', price: '₦100,000-₦1,000,000/event' },
];

const hospitalPlans = [
  {
    id: 'hospital-revenue-share',
    name: 'Revenue Share Partnership',
    price: 'No monthly platform fee',
    description: 'For facilities that want to start receiving DoctaRx Nigeria referrals before committing to a monthly plan.',
    features: [
      'Facility profile and service routing',
      'Patient referral and booking queue',
      'Agreed revenue share on completed consultations or services',
      'Provider and pharmacy handoff workflow',
      'Basic activity reporting',
    ],
    cta: 'Register Hospital',
    href: '/ng/hospital/register',
  },
  {
    id: 'hospital-platform',
    name: 'Platform Partnership',
    price: '₦750,000/month',
    description: 'For hospitals and clinics that want an operating workspace for digital care, bookings, and partner workflows.',
    features: [
      'Hospital workspace for admin and care teams',
      'Provider onboarding and scheduling support',
      'Appointment, consultation, prescription, and referral workflows',
      'Patient intake and follow-up coordination',
      'Pharmacy request and dispensing handoff',
      'Monthly operational reporting and launch support',
    ],
    cta: 'Start Partnership',
    href: '/ng/hospital/register',
    highlight: true,
  },
  {
    id: 'hospital-enterprise',
    name: 'Enterprise Network',
    price: 'Custom',
    description: 'For hospital groups, HMOs, government programs, and multi-location healthcare networks.',
    features: [
      'Multi-location account structure',
      'Custom service-level agreement',
      'Dedicated onboarding plan',
      'Reporting for leadership and operations teams',
      'Commercial terms agreed before launch',
    ],
    cta: 'Discuss Partnership',
    href: '/ng/hospital/register',
  },
];

const partnershipCoverage = [
  'A branded DoctaRx Nigeria facility workspace for care operations',
  'Provider, admin, appointment, prescription, and referral workflows',
  'Patient request routing for virtual and facility-based care',
  'Pharmacy coordination for prescriptions and medication availability requests',
  'Operational reporting, launch support, and staff enablement',
  'Nigeria-focused payment and patient communication flow visibility',
];

const pharmacyRevenueItems = [
  { label: 'Dispensing fee', value: '₦200-₦500/order' },
  { label: 'Featured placement', value: '₦20,000-₦200,000/month' },
  { label: 'Settlement window', value: 'T+1 to T+5' },
  { label: 'Inventory status', value: 'Pharmacy confirmed only' },
];

const FAQs = [
  {
    q: 'Is there a free tier for patients?',
    a: 'Patients can search medicines, upload prescriptions, and request pharmacy confirmation without a paid plan. Subscriptions add included consultations and care benefits.',
  },
  {
    q: 'How is organisation billing calculated?',
    a: 'Organisations can use bundle pricing or per-member pricing. Larger groups can agree custom terms before activation.',
  },
  {
    q: 'Can providers work without a monthly subscription?',
    a: 'Yes. Providers can start with a revenue share model. Monthly plans are available for enhanced visibility, analytics, and reduced commission terms.',
  },
  {
    q: 'What does the ₦750,000/month platform partnership cover?',
    a: 'It covers the operating workspace, onboarding support, core digital care workflows, reporting, and partner coordination needed for a hospital or clinic partnership.',
  },
  {
    q: 'Are prices final?',
    a: 'Public prices are standard models and examples. Organisation, provider, hospital, and pharmacy contracts are confirmed with the Nigeria partnerships team before activation.',
  },
  {
    q: 'Are pharmacy prices or medicine stock included here?',
    a: 'No. Pharmacy stock and medicine prices are confirmed by partner pharmacies during the medication request flow.',
  },
];

function priceForCycle(price, billingCycle) {
  if (price == null) return null;
  return billingCycle === 'annual' ? Math.round(price * 0.8) : price;
}

function NigeriaPricingHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border bg-background/95 backdrop-blur-xl shadow-[0_10px_40px_rgba(15,23,42,0.06)]">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/ng" className="flex min-w-0 items-center gap-3" aria-label="DoctaRx Nigeria home">
          <span className="shrink-0 rounded-2xl border border-slate-800 bg-slate-950/95 px-3 py-2 shadow-[0_0_28px_rgba(34,211,238,0.16)]">
            <DoctaRxLogo className="h-7 w-auto" />
          </span>
          <span className="hidden min-w-0 sm:block">
            <span className="block truncate text-sm font-semibold text-foreground">DoctaRx Nigeria</span>
            <span className="block truncate text-xs text-muted-foreground">Premium healthcare experience</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-6 lg:flex" aria-label="Nigeria site navigation">
          {HEADER_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <Link
            href="/ng/auth/login"
            className="rounded-full border border-border bg-background/80 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Sign In
          </Link>
          <Link
            href="/ng/auth/register"
            className="rounded-full bg-green-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-green-500"
          >
            Get Started
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setMobileOpen((value) => !value)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-accent lg:hidden"
          aria-expanded={mobileOpen}
          aria-label="Toggle navigation"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {mobileOpen ? (
        <div className="border-t border-border bg-background px-4 py-4 shadow-lg lg:hidden">
          <div className="grid gap-2">
            {HEADER_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="rounded-xl px-3 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                {link.label}
              </Link>
            ))}
            <div className="grid gap-2 pt-2 sm:grid-cols-2">
              <Link
                href="/ng/auth/login"
                onClick={() => setMobileOpen(false)}
                className="rounded-xl border border-border px-4 py-3 text-center text-sm font-semibold text-foreground"
              >
                Sign In
              </Link>
              <Link
                href="/ng/auth/register"
                onClick={() => setMobileOpen(false)}
                className="rounded-xl bg-green-600 px-4 py-3 text-center text-sm font-semibold text-white"
              >
                Get Started
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function BillingToggle({ billingCycle, setBillingCycle }) {
  return (
    <div className="mx-auto grid w-full max-w-sm grid-cols-2 rounded-2xl border border-border bg-card p-1 shadow-sm">
      {['monthly', 'annual'].map((cycle) => (
        <button
          key={cycle}
          type="button"
          onClick={() => setBillingCycle(cycle)}
          className={cn(
            'rounded-xl px-4 py-2.5 text-sm font-semibold capitalize transition-colors',
            billingCycle === cycle
              ? 'bg-green-600 text-white shadow-sm'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
        >
          {cycle}
          {cycle === 'annual' ? (
            <span className={cn('ml-2 rounded-full px-2 py-0.5 text-[10px]', billingCycle === cycle ? 'bg-white/20 text-white' : 'bg-green-50 text-green-700')}>
              Save 20%
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function SectionHeader({ eyebrow, title, description }) {
  return (
    <div className="mx-auto mb-8 max-w-3xl text-center sm:mb-10">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-green-700 dark:text-green-300">{eyebrow}</p>
      <h2 className="mt-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl md:text-4xl">{title}</h2>
      <p className="mt-3 text-base leading-7 text-muted-foreground sm:text-lg">{description}</p>
    </div>
  );
}

function FeatureList({ features, tone = 'green' }) {
  const color = TONES[tone]?.check || TONES.green.check;

  return (
    <ul className="space-y-3">
      {features.map((feature) => (
        <li key={feature} className="flex items-start gap-3 text-sm leading-6 text-muted-foreground">
          <CheckCircle2 className={cn('mt-0.5 h-4 w-4 shrink-0', color)} />
          <span>{feature}</span>
        </li>
      ))}
    </ul>
  );
}

function PlanCard({ plan, billingCycle, tone = 'green', href, cta }) {
  const theme = TONES[tone] || TONES.green;
  const price = priceForCycle(plan.price, billingCycle);
  const highlighted = Boolean(plan.highlight);

  return (
    <article className={cn(
      'relative flex min-w-0 flex-col rounded-3xl border bg-background p-6 shadow-sm sm:p-7',
      highlighted ? theme.highlight : 'border-border'
    )}>
      {highlighted ? (
        <div className={cn('absolute -top-3 left-6 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide', theme.badge)}>
          Recommended
        </div>
      ) : null}
      <div className="text-sm font-semibold text-muted-foreground">{plan.name}</div>
      <div className="mt-3 flex flex-wrap items-end gap-x-2 gap-y-1">
        <span className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {price == null ? 'Custom' : formatNaira(price)}
        </span>
        {price == null ? null : <span className="pb-1 text-sm font-medium text-muted-foreground">/month</span>}
      </div>
      {price != null && billingCycle === 'annual' ? (
        <p className="mt-1 text-xs font-semibold text-green-700 dark:text-green-300">Billed annually after 20% discount</p>
      ) : null}
      {plan.consultations > 0 ? (
        <p className="mt-3 rounded-xl bg-green-50 px-3 py-2 text-xs font-semibold text-green-800 dark:bg-green-950/40 dark:text-green-200">
          {plan.consultations === -1 ? 'Unlimited general consultations with fair-use review' : `${plan.consultations} consultation/month included`}
        </p>
      ) : null}
      <div className="mt-6 flex-1">
        <FeatureList features={plan.features} tone={tone} />
      </div>
      <Link
        href={href}
        className={cn(
          'mt-7 inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-3 text-center text-sm font-bold transition-colors',
          highlighted ? theme.button : 'border border-border bg-background text-foreground hover:bg-accent'
        )}
      >
        {cta}
      </Link>
    </article>
  );
}

function InfoTile({ label, value, icon: Icon }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-background p-4">
      {Icon ? <Icon className="mb-3 h-5 w-5 text-green-600" /> : null}
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-bold text-foreground">{value}</div>
    </div>
  );
}

function AudienceSection({ id, eyebrow, title, description, children }) {
  return (
    <section id={id} className="scroll-mt-32">
      <SectionHeader eyebrow={eyebrow} title={title} description={description} />
      {children}
    </section>
  );
}

export default function NgPricingPage() {
  const [billingCycle, setBillingCycle] = useState('monthly');

  return (
    <div className="min-h-screen bg-background text-foreground">
      <NigeriaPricingHeader />

      <main className="pt-16">
        <section className="relative overflow-hidden border-b border-border bg-gradient-to-b from-emerald-50 via-background to-background px-4 py-16 dark:from-emerald-950/20 sm:px-6 sm:py-20 lg:py-24">
          <div className="mx-auto max-w-5xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-green-200 bg-white px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-green-700 shadow-sm dark:border-green-800 dark:bg-green-950/40 dark:text-green-200">
              <Sparkles className="h-3.5 w-3.5" />
              DoctaRx Nigeria pricing
            </span>
            <h1 className="mx-auto mt-6 max-w-4xl text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              Simple pricing for patients and healthcare partners
            </h1>
            <p className="mx-auto mt-5 max-w-3xl text-base leading-8 text-muted-foreground sm:text-xl">
              Compare patient subscriptions, organisation coverage, provider participation, hospital partnerships, and pharmacy network plans inside the existing DoctaRx Nigeria experience.
            </p>
            <div className="mt-8">
              <BillingToggle billingCycle={billingCycle} setBillingCycle={setBillingCycle} />
            </div>
            <div className="mt-7 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <Link
                href="/ng/auth/register"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-green-600 px-6 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-green-500"
              >
                Get Started <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/ng/provider/register"
                className="inline-flex min-h-12 items-center justify-center rounded-full border border-border bg-background px-6 py-3 text-sm font-bold text-foreground transition-colors hover:bg-accent"
              >
                Partner as a Provider
              </Link>
            </div>
          </div>
        </section>

        <nav className="sticky top-16 z-40 border-b border-border bg-background/95 px-4 py-3 backdrop-blur-xl sm:px-6" aria-label="Pricing sections">
          <div className="mx-auto flex max-w-7xl flex-wrap gap-2 sm:justify-center">
            {AUDIENCES.map((audience) => {
              const Icon = audience.icon;
              return (
                <a
                  key={audience.id}
                  href={`#${audience.id}`}
                  className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:border-green-300 hover:bg-green-50 dark:hover:bg-green-950/30"
                >
                  <Icon className="h-4 w-4 text-green-600" />
                  {audience.label}
                </a>
              );
            })}
          </div>
        </nav>

        <div className="mx-auto max-w-7xl space-y-16 px-4 py-12 sm:px-6 sm:py-16 lg:space-y-24">
          <AudienceSection
            id="patients"
            eyebrow="Patients"
            title="Patient plans"
            description="Free to start, with optional subscriptions for included consultations and care benefits."
          >
            <div className="mb-6 rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6 lg:p-8">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <Pill className="h-6 w-6 text-green-600" />
                    <h3 className="text-xl font-bold text-foreground">Pay as you go</h3>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    No subscription required. Patients can use DoctaRx Nigeria and pay only for booked consultations or confirmed services.
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <InfoTile label="General consult" value="₦2,000-₦5,000" />
                    <InfoTile label="Specialist consult" value="₦5,000-₦15,000" />
                    <InfoTile label="Medicine search" value="Free" />
                    <InfoTile label="Prescription upload" value="Free" />
                  </div>
                </div>
                <Link
                  href="/ng/patient/appointments/book"
                  className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-border bg-background px-5 py-3 text-sm font-bold text-foreground transition-colors hover:bg-accent"
                >
                  Book a Consultation
                </Link>
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-3">
              {SUBSCRIPTION_PLANS.patient.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  billingCycle={billingCycle}
                  tone="green"
                  href="/ng/patient/subscription"
                  cta={plan.cta || `Choose ${plan.name}`}
                />
              ))}
            </div>
          </AudienceSection>

          <AudienceSection
            id="organisations"
            eyebrow="Organisations"
            title="Organisation plans"
            description="For companies, schools, NGOs, churches, mosques, government teams, associations, and staff health programs."
          >
            <div className="mb-6 rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6 lg:p-8">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-xl font-bold text-foreground">Per-member pricing</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">Use bundle pricing below or choose per-member billing for larger groups.</p>
                </div>
                <Link href="/ng/organization/register" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-indigo-500">
                  Register Organisation
                </Link>
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-3">
                {organisationTiers.map((tier) => (
                  <InfoTile key={tier.range} label={tier.range} value={`${tier.price}${tier.per}`} icon={Users} />
                ))}
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-3">
              {SUBSCRIPTION_PLANS.organization.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  billingCycle={billingCycle}
                  tone="indigo"
                  href="/ng/organization/register"
                  cta={plan.price == null ? 'Discuss Organisation Plan' : `Choose ${plan.name}`}
                />
              ))}
            </div>

            <div className="mt-6 rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6 lg:p-8">
              <h3 className="text-xl font-bold text-foreground">Organisation add-ons</h3>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {organisationAddOns.map((addon) => (
                  <InfoTile key={addon.label} label={addon.label} value={addon.price} icon={BadgeCheck} />
                ))}
              </div>
            </div>
          </AudienceSection>

          <AudienceSection
            id="providers"
            eyebrow="Providers"
            title="Provider participation"
            description="Doctors and healthcare providers can start with revenue share or use monthly plans for a stronger DoctaRx Nigeria operating presence."
          >
            <div className="mb-6 grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6 lg:p-8">
                <div className="flex items-center gap-3">
                  <CreditCard className="h-6 w-6 text-blue-600" />
                  <h3 className="text-xl font-bold text-foreground">Revenue share option</h3>
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  Providers can join without a monthly subscription and pay an agreed platform share on completed DoctaRx Nigeria consultations.
                </p>
                <div className="mt-5 grid gap-4 sm:grid-cols-3">
                  <InfoTile label="General consult share" value="15% example" />
                  <InfoTile label="Specialist consult share" value="10% example" />
                  <InfoTile label="Payout schedule" value="T+1 to T+3" />
                </div>
              </div>

              <div className="rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6 lg:p-8">
                <div className="flex items-center gap-3">
                  <Stethoscope className="h-6 w-6 text-blue-600" />
                  <h3 className="text-xl font-bold text-foreground">Consultation fee examples</h3>
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  Final fees are confirmed before patients book. These examples help providers and patients understand typical ranges.
                </p>
                <div className="mt-5 space-y-3">
                  {consultationExamples.map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-background px-4 py-3">
                      <span className="text-sm text-muted-foreground">{item.label}</span>
                      <span className="text-sm font-bold text-foreground">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              {SUBSCRIPTION_PLANS.provider.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  billingCycle={billingCycle}
                  tone="blue"
                  href="/ng/provider/register"
                  cta="Register as Provider"
                />
              ))}
            </div>
          </AudienceSection>

          <AudienceSection
            id="hospitals"
            eyebrow="Hospitals"
            title="Hospital and clinic partnerships"
            description="Clear options for facilities that want referral flow, digital care operations, and a DoctaRx Nigeria partnership without creating a separate product identity."
          >
            <div className="grid gap-5 lg:grid-cols-3">
              {hospitalPlans.map((plan) => (
                <article
                  key={plan.id}
                  className={cn(
                    'flex min-w-0 flex-col rounded-3xl border bg-background p-6 shadow-sm sm:p-7',
                    plan.highlight ? TONES.rose.highlight : 'border-border'
                  )}
                >
                  {plan.highlight ? (
                    <div className="mb-4 w-fit rounded-full bg-rose-600 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
                      Platform option
                    </div>
                  ) : null}
                  <h3 className="text-lg font-bold text-foreground">{plan.name}</h3>
                  <div className="mt-3 text-3xl font-bold tracking-tight text-foreground">{plan.price}</div>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{plan.description}</p>
                  <div className="mt-6 flex-1">
                    <FeatureList features={plan.features} tone="rose" />
                  </div>
                  <Link
                    href={plan.href}
                    className={cn(
                      'mt-7 inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-3 text-center text-sm font-bold transition-colors',
                      plan.highlight ? TONES.rose.button : 'border border-border bg-background text-foreground hover:bg-accent'
                    )}
                  >
                    {plan.cta}
                  </Link>
                </article>
              ))}
            </div>

            <div className="mt-6 rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6 lg:p-8">
              <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
                <div>
                  <h3 className="text-xl font-bold text-foreground">What ₦750,000/month covers</h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    This is a monthly platform partnership for hospitals or clinics. It is not a promise of patient volume, medicine stock, or clinical revenue.
                  </p>
                </div>
                <FeatureList features={partnershipCoverage} tone="rose" />
              </div>
            </div>
          </AudienceSection>

          <AudienceSection
            id="pharmacies"
            eyebrow="Pharmacies"
            title="Pharmacy network plans"
            description="For pharmacies that want prescription queues, medication request handling, pharmacy confirmation workflows, and dispensing operations."
          >
            <div className="grid gap-5 md:grid-cols-3">
              {SUBSCRIPTION_PLANS.pharmacy.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  billingCycle={billingCycle}
                  tone="teal"
                  href="/ng/pharmacy/onboarding"
                  cta="Register Pharmacy"
                />
              ))}
            </div>

            <div className="mt-6 rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6 lg:p-8">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-xl font-bold text-foreground">Pharmacy operating model</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Medicine stock and price are never shown as confirmed until a partner pharmacy confirms them.
                  </p>
                </div>
                <Link href="/ng/medicines" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-background px-5 py-3 text-sm font-bold text-foreground transition-colors hover:bg-accent">
                  View Medicine Search
                </Link>
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {pharmacyRevenueItems.map((item) => (
                  <InfoTile key={item.label} label={item.label} value={item.value} icon={ShieldCheck} />
                ))}
              </div>
            </div>
          </AudienceSection>

          <section className="rounded-[2rem] bg-slate-950 px-5 py-10 text-center text-white shadow-[0_24px_80px_rgba(15,23,42,0.22)] sm:px-8 lg:px-12">
            <div className="mx-auto max-w-3xl">
              <Building2 className="mx-auto h-10 w-10 text-green-300" />
              <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Need a Nigeria partnership quote?</h2>
              <p className="mt-4 text-sm leading-7 text-slate-300 sm:text-base">
                HMOs, government bodies, hospital groups, schools, churches, mosques, and large organisations can agree custom Nigeria contracts before rollout.
              </p>
              <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
                <Link href="/ng/organization/register" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-slate-950 transition-colors hover:bg-green-50">
                  Start Nigeria Partnership <ArrowRight className="h-4 w-4" />
                </Link>
                <a href="mailto:ng@doctarx.com" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/20 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-white/10">
                  <Mail className="h-4 w-4" />
                  Email Nigeria Team
                </a>
              </div>
            </div>
          </section>

          <section className="scroll-mt-32">
            <SectionHeader
              eyebrow="Questions"
              title="Frequently asked questions"
              description="Plain answers for patients, organisations, providers, hospitals, and pharmacies."
            />
            <div className="grid gap-5 md:grid-cols-2">
              {FAQs.map((faq) => (
                <article key={faq.q} className="rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6">
                  <h3 className="text-base font-bold text-foreground">{faq.q}</h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{faq.a}</p>
                </article>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
