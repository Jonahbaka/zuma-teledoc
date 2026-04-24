'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Menu, X, ChevronDown, Pill, Building2, Stethoscope,
  Users, Hospital, ShieldCheck, ArrowRight, LogIn,
  LayoutDashboard, Calendar, FileText, CreditCard,
  MessageSquare, User, Package, BarChart3, Settings,
  Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';

const DoctaRxNgLogo = () => (
  <Link href="/ng" className="flex items-center gap-2.5 shrink-0">
    <div className="w-9 h-9 bg-green-600 rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(22,163,74,0.35)]">
      <span className="text-white font-black text-sm tracking-tighter">Rx</span>
    </div>
    <div>
      <span className="text-xl font-bold text-foreground tracking-tight">DoctaRx</span>
      <span className="ml-1.5 text-[10px] bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-1.5 py-0.5 rounded-full font-bold tracking-wide uppercase border border-green-200 dark:border-green-800">NG</span>
    </div>
  </Link>
);

const PORTALS = [
  {
    key: 'patient',
    label: 'Patients',
    icon: Pill,
    color: 'text-green-600',
    bg: 'bg-green-500/10',
    desc: 'Consultations, prescriptions & records',
    links: [
      { label: 'Patient Dashboard', href: '/ng/patient/dashboard', icon: LayoutDashboard },
      { label: 'Book Appointment', href: '/ng/patient/appointments', icon: Calendar },
      { label: 'My Prescriptions', href: '/ng/patient/prescriptions', icon: FileText },
      { label: 'Search Medications', href: '/ng/patient/search', icon: Pill },
      { label: 'My Records', href: '/ng/patient/records', icon: FileText },
      { label: 'Messages', href: '/ng/patient/messages', icon: MessageSquare },
      { label: 'Billing & Payments', href: '/ng/patient/billing', icon: CreditCard },
      { label: 'Subscription Plan', href: '/ng/patient/subscription', icon: ShieldCheck },
    ],
    authLink: '/ng/auth/login?role=patient',
    registerLink: '/ng/auth/register?role=patient',
  },
  {
    key: 'provider',
    label: 'Providers',
    icon: Stethoscope,
    color: 'text-blue-600',
    bg: 'bg-blue-500/10',
    desc: 'Manage patients & consultations',
    links: [
      { label: 'Provider Dashboard', href: '/ng/provider/dashboard', icon: LayoutDashboard },
      { label: 'My Appointments', href: '/ng/provider/appointments', icon: Calendar },
      { label: 'My Patients', href: '/ng/provider/patients', icon: Users },
      { label: 'Prescriptions', href: '/ng/provider/prescriptions', icon: FileText },
      { label: 'My Earnings', href: '/ng/provider/earnings', icon: CreditCard },
    ],
    authLink: '/ng/auth/login?role=provider',
    registerLink: '/ng/provider/auth/register',
  },
  {
    key: 'organization',
    label: 'Organisations',
    icon: Users,
    color: 'text-indigo-600',
    bg: 'bg-indigo-500/10',
    desc: 'Corporate & group health plans',
    links: [
      { label: 'Org Dashboard', href: '/ng/organization/dashboard', icon: LayoutDashboard },
      { label: 'Manage Members', href: '/ng/organization/members', icon: Users },
      { label: 'Organisation Billing', href: '/ng/organization/billing', icon: CreditCard },
      { label: 'Register Organisation', href: '/ng/organization/register', icon: Building2 },
    ],
    authLink: '/ng/auth/login?role=organization',
    registerLink: '/ng/organization/register',
  },
  {
    key: 'hospital',
    label: 'Hospitals',
    icon: Hospital,
    color: 'text-rose-600',
    bg: 'bg-rose-500/10',
    desc: 'Facility & staff management',
    links: [
      { label: 'Hospital Dashboard', href: '/ng/hospital/dashboard', icon: LayoutDashboard },
      { label: 'Register Hospital', href: '/ng/hospital/register', icon: Hospital },
    ],
    authLink: '/ng/auth/login?role=hospital',
    registerLink: '/ng/hospital/register',
  },
  {
    key: 'pharmacy',
    label: 'Pharmacies',
    icon: Package,
    color: 'text-teal-600',
    bg: 'bg-teal-500/10',
    desc: 'Orders, inventory & dispensing',
    links: [
      { label: 'Pharmacy Dashboard', href: '/ng/pharmacy/dashboard', icon: LayoutDashboard },
      { label: 'Prescription Queue', href: '/ng/pharmacy/dashboard#orders', icon: FileText },
      { label: 'Inventory', href: '/ng/pharmacy/dashboard#inventory', icon: Package },
      { label: 'Analytics', href: '/ng/pharmacy/dashboard#analytics', icon: BarChart3 },
      { label: 'Register Pharmacy', href: '/ng/pharmacy/onboarding', icon: Building2 },
    ],
    authLink: '/ng/auth/login?role=pharmacy',
    registerLink: '/ng/pharmacy/onboarding',
  },
];

export default function NgNav({ role, userName }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activePortal, setActivePortal] = useState(null);
  const pathname = usePathname();

  const isScrolled = true;

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/90 backdrop-blur-xl border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
        <DoctaRxNgLogo />

        {/* Desktop portal links */}
        <div className="hidden lg:flex items-center gap-1">
          {PORTALS.map((portal) => {
            const Icon = portal.icon;
            const isActive = pathname?.startsWith(`/ng/${portal.key}`);
            return (
              <div
                key={portal.key}
                className="relative"
                onMouseEnter={() => setActivePortal(portal.key)}
                onMouseLeave={() => setActivePortal(null)}
              >
                <button className={cn(
                  "flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-green-500/10 text-green-700 dark:text-green-400"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}>
                  <Icon size={14} />
                  {portal.label}
                  <ChevronDown size={12} className={cn("transition-transform", activePortal === portal.key && "rotate-180")} />
                </button>

                {activePortal === portal.key && (
                  <div className="absolute top-full left-0 pt-1 w-60 z-50">
                    <div className="bg-popover rounded-2xl shadow-2xl border border-border overflow-hidden p-2">
                      <div className="px-3 py-2 flex items-center gap-2 mb-1">
                        <div className={`w-7 h-7 rounded-lg ${portal.bg} flex items-center justify-center`}>
                          <Icon size={14} className={portal.color} />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-foreground">{portal.label}</div>
                          <div className="text-[10px] text-muted-foreground">{portal.desc}</div>
                        </div>
                      </div>
                      <div className="h-px bg-border mx-2 mb-2" />
                      {portal.links.map((link) => {
                        const LinkIcon = link.icon;
                        return (
                          <Link
                            key={link.href}
                            href={link.href}
                            className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-accent transition-colors group"
                          >
                            <LinkIcon size={13} className="text-muted-foreground group-hover:text-foreground" />
                            <span className="text-sm text-foreground">{link.label}</span>
                          </Link>
                        );
                      })}
                      <div className="h-px bg-border mx-2 my-2" />
                      <Link href={portal.authLink} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-accent transition-colors text-sm font-medium text-muted-foreground">
                        <LogIn size={13} /> Login
                      </Link>
                      <Link href={portal.registerLink} className={`flex items-center gap-2 px-3 py-2 rounded-lg ${portal.bg} transition-colors text-sm font-semibold ${portal.color} mt-1`}>
                        <ArrowRight size={13} /> Get Started
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <Link href="/ng/pricing" className={cn(
            "px-3 py-2 rounded-lg text-sm font-medium transition-colors",
            pathname === '/ng/pricing'
              ? "bg-green-500/10 text-green-700"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          )}>
            Pricing
          </Link>
        </div>

        {/* Right actions */}
        <div className="hidden lg:flex items-center gap-2">
          <Link href="/ng/auth/login" className="text-sm font-medium text-muted-foreground hover:text-foreground px-3 py-2 rounded-lg hover:bg-accent transition-colors">
            Sign In
          </Link>
          <Link href="/ng/auth/register" className="text-sm font-semibold bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-xl shadow transition-colors">
            Get Started
          </Link>
        </div>

        {/* Mobile menu toggle */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="lg:hidden p-2 rounded-lg text-muted-foreground hover:bg-accent"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="lg:hidden border-t border-border bg-background px-4 py-4 space-y-2 max-h-[80vh] overflow-y-auto">
          {PORTALS.map((portal) => {
            const Icon = portal.icon;
            return (
              <details key={portal.key} className="group">
                <summary className="flex items-center gap-2 px-3 py-3 rounded-xl hover:bg-accent cursor-pointer list-none">
                  <div className={`w-8 h-8 rounded-lg ${portal.bg} flex items-center justify-center shrink-0`}>
                    <Icon size={16} className={portal.color} />
                  </div>
                  <span className="font-semibold text-foreground flex-1">{portal.label}</span>
                  <ChevronDown size={14} className="text-muted-foreground group-open:rotate-180 transition-transform" />
                </summary>
                <div className="ml-10 mt-1 space-y-1">
                  {portal.links.map((link) => (
                    <Link key={link.href} href={link.href} onClick={() => setMobileOpen(false)} className="block px-3 py-2 text-sm text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent">
                      {link.label}
                    </Link>
                  ))}
                  <Link href={portal.authLink} onClick={() => setMobileOpen(false)} className="block px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent">
                    Login →
                  </Link>
                </div>
              </details>
            );
          })}
          <div className="pt-3 space-y-2">
            <Link href="/ng/pricing" onClick={() => setMobileOpen(false)} className="block text-center py-3 rounded-xl border border-border text-sm font-medium">Pricing</Link>
            <Link href="/ng/auth/register" onClick={() => setMobileOpen(false)} className="block text-center py-3 rounded-xl bg-green-600 text-white text-sm font-bold">Get Started Free</Link>
          </div>
        </div>
      )}
    </nav>
  );
}
