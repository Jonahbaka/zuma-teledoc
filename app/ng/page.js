'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ShieldCheck, Search, Menu, X, Package, Truck,
  ChevronRight, Lock, Clock, MapPin, Star,
  ArrowRight, CheckCircle, Sparkles, Pill,
  CreditCard, Banknote, Building2, Phone,
  Upload, Activity, BarChart3, Wallet, QrCode
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { label: "For Patients", href: "#patients" },
  { label: "For Pharmacies", href: "#pharmacies" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Pricing", href: "#pricing" },
];

const ZumaRxLogo = () => (
  <div className="flex items-center gap-2.5">
    <div className="w-9 h-9 bg-green-600 rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(22,163,74,0.35)]">
      <span className="text-white font-black text-sm tracking-tighter">Rx</span>
    </div>
    <span className="text-xl font-bold text-foreground tracking-tight">ZumaRx</span>
  </div>
);

const SectionHeading = ({ badge, title, subtitle, align = "center" }) => (
  <div className={`flex flex-col gap-4 mb-12 ${align === "center" ? "items-center text-center" : "items-start text-left"}`}>
    {badge && (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 text-xs font-semibold tracking-wide uppercase border border-green-500/20">
        <Sparkles size={10} /> {badge}
      </span>
    )}
    <h2 className="text-3xl md:text-5xl font-bold text-foreground tracking-tight leading-tight">{title}</h2>
    {subtitle && <p className="text-lg text-muted-foreground max-w-2xl leading-relaxed">{subtitle}</p>}
  </div>
);

export default function NigeriaLanding() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [getStartedOpen, setGetStartedOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-green-500/30">

      {/* ═══════════════════════ NAVIGATION ═══════════════════════ */}
      <nav className={cn(
        "fixed top-0 left-0 right-0 z-50 border-b transition-all duration-300",
        isScrolled ? "bg-background/90 backdrop-blur-xl border-border py-3" : "bg-background/70 border-transparent py-4"
      )}>
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center justify-between">
            <Link href="/ng" className="flex items-center gap-3">
              <ZumaRxLogo />
              <span className="text-[10px] bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full font-bold tracking-wide uppercase border border-green-200 dark:border-green-800">
                Nigeria
              </span>
            </Link>

            {/* Desktop Nav */}
            <div className="hidden md:flex items-center gap-8">
              {NAV_LINKS.map((link) => (
                <a key={link.label} href={link.href} className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                  {link.label}
                </a>
              ))}
            </div>

            <div className="hidden md:flex items-center gap-3">
              {/* Login dropdown */}
              <div className="relative" onMouseEnter={() => setLoginOpen(true)} onMouseLeave={() => setLoginOpen(false)}>
                <button className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground px-3 py-2 rounded-lg hover:bg-accent transition-colors">
                  Login
                  <ChevronRight className={cn("w-4 h-4 transition-transform", loginOpen && "rotate-90")} />
                </button>
                <div className={`absolute top-full right-0 w-64 pt-2 transition-all duration-200 ${loginOpen ? "opacity-100 translate-y-0 visible" : "opacity-0 translate-y-2 invisible"}`}>
                  <div className="bg-popover rounded-xl shadow-2xl border border-border overflow-hidden p-2 backdrop-blur-xl">
                    <div className="px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Select Portal</div>
                    <Link href="/ng/auth/login" className="flex items-center gap-3 px-3 py-3 hover:bg-accent rounded-lg group transition-colors">
                      <div className="bg-green-500/10 text-green-600 p-2 rounded-lg group-hover:bg-green-500/20 transition-colors"><Pill size={16} /></div>
                      <div>
                        <div className="text-sm font-medium text-foreground">Patient Login</div>
                        <div className="text-xs text-muted-foreground">Find &amp; order medications</div>
                      </div>
                    </Link>
                    <Link href="/ng/pharmacy/dashboard" className="flex items-center gap-3 px-3 py-3 hover:bg-accent rounded-lg group transition-colors mt-1">
                      <div className="bg-emerald-500/10 text-emerald-600 p-2 rounded-lg group-hover:bg-emerald-500/20 transition-colors"><Building2 size={16} /></div>
                      <div>
                        <div className="text-sm font-medium text-foreground">Pharmacy Portal</div>
                        <div className="text-xs text-muted-foreground">Manage your pharmacy</div>
                      </div>
                    </Link>
                  </div>
                </div>
              </div>

              {/* Get Started dropdown */}
              <div className="relative" onMouseEnter={() => setGetStartedOpen(true)} onMouseLeave={() => setGetStartedOpen(false)}>
                <Button className="bg-green-600 hover:bg-green-500 text-white shadow-[0_0_20px_rgba(22,163,74,0.3)]">
                  Get Started
                  <ChevronRight className={cn("ml-2 w-4 h-4 transition-transform", getStartedOpen && "rotate-90")} />
                </Button>
                <div className={`absolute top-full right-0 w-72 pt-2 transition-all duration-200 ${getStartedOpen ? "opacity-100 translate-y-0 visible" : "opacity-0 translate-y-2 invisible"}`}>
                  <div className="bg-popover rounded-xl shadow-2xl border border-border overflow-hidden p-2 backdrop-blur-xl">
                    <div className="px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">I want to...</div>
                    <Link href="/ng/patient/search" className="flex items-center gap-3 px-3 py-3 hover:bg-accent rounded-lg group transition-colors">
                      <div className="bg-green-500/10 text-green-600 p-2 rounded-lg group-hover:bg-green-500/20 transition-colors"><Search size={16} /></div>
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-foreground">Search Medications</div>
                        <div className="text-xs text-muted-foreground">Find &amp; compare prices near you</div>
                      </div>
                      <ArrowRight size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Link>
                    <Link href="/ng/patient/prescriptions" className="flex items-center gap-3 px-3 py-3 hover:bg-accent rounded-lg group transition-colors mt-1">
                      <div className="bg-emerald-500/10 text-emerald-600 p-2 rounded-lg group-hover:bg-emerald-500/20 transition-colors"><Upload size={16} /></div>
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-foreground">Upload Prescription</div>
                        <div className="text-xs text-muted-foreground">Photo or text — quick &amp; easy</div>
                      </div>
                      <ArrowRight size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Link>
                    <Link href="/ng/pharmacy/onboarding" className="flex items-center gap-3 px-3 py-3 hover:bg-accent rounded-lg group transition-colors mt-1">
                      <div className="bg-teal-500/10 text-teal-600 p-2 rounded-lg group-hover:bg-teal-500/20 transition-colors"><Building2 size={16} /></div>
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-foreground">Register Pharmacy</div>
                        <div className="text-xs text-muted-foreground">Join Nigeria&apos;s pharmacy network</div>
                      </div>
                      <ArrowRight size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            {/* Mobile toggle */}
            <div className="flex md:hidden items-center gap-2">
              <button
                className="text-muted-foreground p-2 hover:bg-accent rounded-lg"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label="Toggle mobile menu"
              >
                {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden absolute top-full left-0 right-0 bg-background border-b border-border p-4 flex flex-col gap-2 animate-in slide-in-from-top-2">
            <div className="px-1 pb-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Get Started</div>
            <Link href="/ng/patient/search" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-3 bg-green-600 text-white px-4 py-3 rounded-xl font-bold">
              <Search size={18} /> Search Medications
            </Link>
            <Link href="/ng/patient/prescriptions" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-3 bg-emerald-700 text-white px-4 py-3 rounded-xl font-bold">
              <Upload size={18} /> Upload Prescription
            </Link>
            <Link href="/ng/pharmacy/onboarding" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-3 bg-teal-700 text-white px-4 py-3 rounded-xl font-bold">
              <Building2 size={18} /> Register Pharmacy
            </Link>
            <div className="h-px bg-border my-2" />
            <Link href="/ng/auth/login" onClick={() => setMobileMenuOpen(false)} className="bg-accent text-foreground text-center py-3 rounded-xl font-medium border border-border">Patient Login</Link>
            <Link href="/ng/pharmacy/dashboard" onClick={() => setMobileMenuOpen(false)} className="bg-accent text-foreground text-center py-3 rounded-xl font-medium border border-border">Pharmacy Login</Link>
            <div className="h-px bg-border my-2" />
            {NAV_LINKS.map(link => (
              <a key={link.href} href={link.href} onClick={() => setMobileMenuOpen(false)} className="px-4 py-3 text-muted-foreground font-medium hover:bg-accent rounded-lg hover:text-foreground">{link.label}</a>
            ))}
          </div>
        )}
      </nav>

      {/* ═══════════════════════ HERO ═══════════════════════ */}
      <section className="relative pt-32 pb-20 md:pt-36 md:pb-28 overflow-hidden px-6 bg-gradient-to-b from-background via-green-50/20 to-background dark:via-green-950/10">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-green-600/8 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-emerald-600/8 rounded-full blur-[120px] pointer-events-none" />

        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 lg:gap-20 items-center relative z-10">
          {/* Hero Copy */}
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 bg-green-500/10 border border-green-500/20 px-3 py-1 rounded-full backdrop-blur-sm">
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              <span className="text-xs font-semibold text-green-600 dark:text-green-400 tracking-wide uppercase">Nigeria&apos;s Pharmacy Network</span>
            </div>

            <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold text-foreground tracking-tight leading-[1.1]">
              Your medications,<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-green-500 to-emerald-400">
                delivered fast.
              </span>
            </h1>

            <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-lg">
              Search medications, compare pharmacy prices, upload prescriptions, and get your drugs delivered anywhere in Nigeria. Pay by card, transfer, or USSD.
            </p>

            {/* Search Bar */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (searchQuery.trim()) window.location.href = `/ng/patient/search?q=${encodeURIComponent(searchQuery)}`;
              }}
              className="flex gap-3 max-w-lg"
            >
              <div className="flex-1 flex items-center gap-3 bg-card border border-border rounded-2xl px-4 py-3 focus-within:border-green-500/50 focus-within:ring-1 focus-within:ring-green-500/30 transition-all shadow-sm">
                <Search size={18} className="text-muted-foreground shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search medications, e.g. Amoxicillin..."
                  className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground text-sm outline-none"
                />
              </div>
              <Button type="submit" className="bg-green-600 hover:bg-green-500 text-white px-6 rounded-2xl shadow-[0_0_20px_rgba(22,163,74,0.3)] shrink-0">
                Search
              </Button>
            </form>

            <p className="text-sm text-muted-foreground -mt-4">
              Or{' '}
              <Link href="/ng/patient/prescriptions" className="text-green-600 dark:text-green-400 underline underline-offset-2 font-medium">
                upload a prescription
              </Link>
              {' '}and we&apos;ll find it for you.
            </p>

            <div className="flex flex-wrap items-center gap-4 sm:gap-6 pt-2 text-sm text-muted-foreground font-medium">
              <div className="flex items-center gap-2"><ShieldCheck size={18} className="text-green-500" /> PCN Registered</div>
              <div className="flex items-center gap-2"><Pill size={18} className="text-green-500" /> NAFDAC Approved</div>
              <div className="flex items-center gap-2"><Star size={18} className="text-yellow-500 fill-yellow-500" /> 4.9/5 Rating</div>
            </div>
          </div>

          {/* Hero Visual — Pharmacy Search Mockup */}
          <div className="relative">
            <div className="relative rounded-[2rem] overflow-hidden shadow-2xl border border-border bg-card aspect-[4/3] group">
              {/* Dark pharmacy app mockup */}
              <div className="w-full h-full bg-gradient-to-br from-green-950 via-slate-900 to-emerald-950 p-6 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="text-white font-bold text-sm">ZumaRx</div>
                  <div className="flex items-center gap-2">
                    <div className="bg-green-500/20 px-2 py-0.5 rounded-full text-green-400 text-[10px] font-mono border border-green-500/30">LIVE</div>
                    <MapPin size={14} className="text-white/50" />
                    <span className="text-white/50 text-[10px]">Lagos, NG</span>
                  </div>
                </div>

                {/* Search bar */}
                <div className="bg-white/10 backdrop-blur-md rounded-xl p-3 border border-white/10 flex items-center gap-2">
                  <Search size={14} className="text-white/60" />
                  <span className="text-white/60 text-xs">Amoxicillin 500mg · 10 capsules</span>
                </div>

                {/* Results */}
                <div className="text-white/40 text-[10px] uppercase tracking-widest font-semibold">3 pharmacies nearby</div>
                {[
                  { pharmacy: "MedPlus Pharmacy", distance: "0.4 km", price: "₦1,800", stock: true, delivery: "45 min" },
                  { pharmacy: "HealthPlus VI", distance: "1.2 km", price: "₦2,100", stock: true, delivery: "1.5 hrs" },
                  { pharmacy: "Alpha Pharmacy", distance: "2.1 km", price: "₦1,950", stock: false, delivery: null },
                ].map((item, i) => (
                  <div key={i} className="bg-white/10 backdrop-blur-md rounded-xl p-3 border border-white/10 flex items-center justify-between">
                    <div>
                      <div className="text-white font-semibold text-xs">{item.pharmacy}</div>
                      <div className="text-white/50 text-[10px] flex items-center gap-1 mt-0.5">
                        <MapPin size={8} /> {item.distance}
                        {item.delivery && <><span className="mx-1">·</span><Truck size={8} />{item.delivery}</>}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-green-400 font-bold text-sm">{item.price}</div>
                      <div className={`text-[10px] font-medium ${item.stock ? 'text-green-400' : 'text-red-400'}`}>
                        {item.stock ? '✓ In Stock' : '✗ Out of Stock'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="absolute -top-10 -right-10 w-32 h-32 bg-green-500/20 rounded-full blur-3xl -z-10 animate-pulse"></div>
            </div>

            {/* Floating stat cards */}
            <div className="absolute -bottom-4 -left-4 bg-card border border-border rounded-2xl p-3 shadow-2xl backdrop-blur-xl">
              <div className="text-xs text-muted-foreground mb-0.5">Avg. Delivery</div>
              <div className="text-lg font-bold text-foreground">2–4 hrs</div>
            </div>
            <div className="absolute -top-4 -right-4 bg-card border border-border rounded-2xl p-3 shadow-2xl backdrop-blur-xl hidden sm:block">
              <div className="text-xs text-muted-foreground mb-0.5">Partner Pharmacies</div>
              <div className="text-lg font-bold text-green-600">500+</div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ FEATURES ═══════════════════════ */}
      <section id="features" className="py-24 bg-card/40 border-y border-border">
        <div className="max-w-7xl mx-auto px-6">
          <SectionHeading
            badge="Why ZumaRx"
            title="Pharmacy access, reimagined"
            subtitle="We built the fastest way to find, afford, and receive medications across Nigeria — connecting patients directly to verified pharmacies."
          />
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: Search,
                title: "Search & Compare",
                desc: "Find any medication and compare real-time prices from pharmacies near you. Make smart, informed choices every time.",
                colorClass: "text-green-500 dark:text-green-300",
                bgClass: "bg-green-500/10"
              },
              {
                icon: Upload,
                title: "Upload Prescriptions",
                desc: "Photo or text — upload your prescription digitally and let pharmacies fulfill it without leaving your home.",
                colorClass: "text-emerald-500 dark:text-emerald-300",
                bgClass: "bg-emerald-500/10"
              },
              {
                icon: Truck,
                title: "Fast Delivery",
                desc: "Get medications delivered within hours from verified pharmacies. Real-time tracking from pharmacy to doorstep.",
                colorClass: "text-teal-500 dark:text-teal-300",
                bgClass: "bg-teal-500/10"
              },
              {
                icon: ShieldCheck,
                title: "Verified & Safe",
                desc: "Every pharmacy on our network is PCN-registered. Only NAFDAC-approved medications listed and dispensed.",
                colorClass: "text-cyan-500 dark:text-cyan-300",
                bgClass: "bg-cyan-500/10"
              }
            ].map((feat, idx) => (
              <div key={idx} className="group relative bg-card rounded-3xl overflow-hidden border border-border hover:border-green-500/30 transition-all duration-300 hover:shadow-2xl hover:shadow-green-900/10 flex flex-col p-8">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-6 ${feat.bgClass} border border-border backdrop-blur-md`}>
                  <feat.icon size={26} className={feat.colorClass} />
                </div>
                <h3 className="text-xl font-bold text-foreground mb-3">{feat.title}</h3>
                <p className="text-muted-foreground leading-relaxed text-sm flex-1">{feat.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════ HOW IT WORKS ═══════════════════════ */}
      <section id="how-it-works" className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <SectionHeading
            title="From search to doorstep"
            subtitle="Four simple steps to get the medications you need, safely and quickly."
          />
          <div className="relative grid md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12 mt-16">
            <div className="hidden lg:block absolute top-12 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent z-0"></div>
            {[
              { icon: Search, title: "1. Search Medications", desc: "Search by drug name or generic. See real-time prices from nearby pharmacies." },
              { icon: Upload, title: "2. Upload Prescription", desc: "Upload your doctor's prescription by photo or text. Verified by our pharmacist team." },
              { icon: Wallet, title: "3. Pay Securely", desc: "Pay with card, bank transfer, or USSD. All transactions are secured and encrypted." },
              { icon: Truck, title: "4. Receive Delivery", desc: "Track your order from pharmacy to doorstep. Get SMS and in-app updates in real-time." }
            ].map((step, idx) => (
              <div key={idx} className="relative z-10 flex flex-col items-center text-center group">
                <div className="w-24 h-24 bg-card rounded-full border border-border shadow-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:border-green-500/50 transition-all duration-300">
                  <step.icon size={32} className="text-muted-foreground group-hover:text-green-500 transition-colors" />
                </div>
                <h3 className="text-lg font-bold text-foreground mb-2">{step.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed max-w-xs">{step.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-16 text-center">
            <Link href="/ng/patient/search" className="inline-flex items-center gap-2 text-green-600 dark:text-green-400 font-bold hover:opacity-90 transition-colors border-b border-green-500/30 pb-0.5">
              Start searching now <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ FOR PATIENTS ═══════════════════════ */}
      <section id="patients" className="py-24 bg-card/40 border-y border-border">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="space-y-8">
              <SectionHeading
                badge="For Patients"
                title="Healthcare access without the wait"
                subtitle="No more pharmacy runs to find out a drug is out of stock. Search, compare, upload, and get delivered — all from your phone."
                align="left"
              />
              <ul className="space-y-5">
                {[
                  { icon: Search, text: "Search thousands of medications and compare prices across verified pharmacies" },
                  { icon: MapPin, text: "Find pharmacies near your location with real-time stock availability" },
                  { icon: Upload, text: "Upload prescriptions by photo — no need to visit a pharmacy first" },
                  { icon: Truck, text: "Get medications delivered to your door within hours" },
                  { icon: Banknote, text: "Pay with cash, bank transfer, card, or USSD — flexible options" },
                  { icon: ShieldCheck, text: "Only NAFDAC-approved medications from PCN-registered pharmacies" }
                ].map((item, idx) => (
                  <li key={idx} className="flex items-start gap-4 group">
                    <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center shrink-0 group-hover:bg-green-500/20 transition-colors">
                      <item.icon size={20} className="text-green-500" />
                    </div>
                    <span className="text-foreground font-medium pt-2">{item.text}</span>
                  </li>
                ))}
              </ul>
              <Link href="/ng/patient/search">
                <Button className="bg-green-600 hover:bg-green-500 text-white shadow-lg mt-4">
                  Search Medications <ArrowRight className="ml-2 w-4 h-4" />
                </Button>
              </Link>
            </div>

            {/* Order tracking mockup */}
            <div className="relative rounded-3xl overflow-hidden shadow-2xl border border-border bg-gradient-to-br from-green-950 via-slate-900 to-emerald-950 aspect-[4/5] p-6 flex flex-col gap-4">
              <div className="text-white/40 text-[10px] uppercase tracking-widest font-semibold">Order Tracking</div>

              <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/10">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-white font-bold text-sm">Order #NG-2847</div>
                  <div className="bg-green-500/20 text-green-400 text-[10px] px-2 py-0.5 rounded-full font-mono border border-green-500/30">OUT FOR DELIVERY</div>
                </div>
                <div className="text-white/60 text-xs mb-4">Amoxicillin 500mg × 10</div>
                <div className="space-y-3">
                  {[
                    { label: "Order Placed", done: true, active: false },
                    { label: "Pharmacy Confirmed", done: true, active: false },
                    { label: "Out for Delivery", done: true, active: true },
                    { label: "Delivered", done: false, active: false }
                  ].map((st, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${st.active ? 'bg-green-500' : st.done ? 'bg-green-500/50' : 'bg-white/10'}`}>
                        {st.done && <CheckCircle size={12} className="text-white" />}
                      </div>
                      <span className={`text-xs ${st.active ? 'text-white font-bold' : st.done ? 'text-white/60' : 'text-white/30'}`}>{st.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/10 flex items-center gap-3">
                <div className="w-9 h-9 bg-green-500 rounded-xl flex items-center justify-center shrink-0">
                  <Truck size={16} className="text-white" />
                </div>
                <div>
                  <div className="text-white font-bold text-xs">Estimated Arrival</div>
                  <div className="text-green-400 text-sm font-mono font-bold">~35 minutes</div>
                </div>
              </div>

              <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/10">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-white/60 text-xs">Total Paid</div>
                    <div className="text-white font-bold text-xl">&#8358;3,600</div>
                  </div>
                  <div className="text-right">
                    <div className="text-white/60 text-xs">Payment Method</div>
                    <div className="text-green-400 text-xs font-semibold">Bank Transfer ✓</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ FOR PHARMACIES ═══════════════════════ */}
      <section id="pharmacies" className="py-24 bg-gradient-to-b from-green-50/50 to-background dark:from-green-950/20 dark:to-background border-y border-border">
        <div className="max-w-7xl mx-auto px-6">
          <SectionHeading
            badge="For Pharmacies"
            title="More patients. More revenue."
            subtitle="Join ZumaRx and start receiving digital prescriptions, managing your inventory, and growing your pharmacy business — all from one dashboard."
          />

          <div className="grid md:grid-cols-3 gap-6 mb-16">
            {[
              {
                icon: Package,
                title: "Receive Prescriptions",
                desc: "Get digital prescriptions directly from patients. No more illegible handwriting or missed orders — fully digital workflow.",
                color: "text-green-500", bg: "bg-green-500/10"
              },
              {
                icon: BarChart3,
                title: "Inventory & Analytics",
                desc: "Track stock levels, view demand trends, and manage pricing with a real-time analytics dashboard built for Nigerian pharmacies.",
                color: "text-emerald-500", bg: "bg-emerald-500/10"
              },
              {
                icon: Truck,
                title: "Delivery Management",
                desc: "Coordinate pickups and deliveries seamlessly. Automatic bank settlements (T+3) with full financial reconciliation.",
                color: "text-teal-500", bg: "bg-teal-500/10"
              }
            ].map((item, idx) => (
              <div key={idx} className="bg-card rounded-2xl p-8 border border-border hover:border-green-500/30 transition-all hover:shadow-xl group">
                <div className={`w-14 h-14 rounded-2xl ${item.bg} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}>
                  <item.icon size={28} className={item.color} />
                </div>
                <h3 className="text-xl font-bold text-foreground mb-3">{item.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>

          <div className="bg-card rounded-3xl border border-border p-8 md:p-12">
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <div className="space-y-6">
                <h3 className="text-2xl md:text-3xl font-bold text-foreground">Pharmacy Dashboard</h3>
                <p className="text-muted-foreground leading-relaxed">
                  A complete workspace to manage incoming prescriptions, confirm medication availability, handle substitutions, set pricing, and track fulfillment — all in one place.
                </p>
                <ul className="space-y-3">
                  {[
                    "Real-time prescription queue management",
                    "Stock availability & substitution tools",
                    "Automated bank settlements (T+3)",
                    "Delivery coordination & tracking",
                    "Patient communication channel",
                    "Analytics & revenue reporting"
                  ].map((text, idx) => (
                    <li key={idx} className="flex items-center gap-3 text-sm">
                      <CheckCircle size={16} className="text-green-500 shrink-0" />
                      <span className="text-foreground">{text}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/ng/pharmacy/onboarding">
                  <Button className="bg-green-600 hover:bg-green-500 text-white shadow-lg mt-2">
                    Register Your Pharmacy <ArrowRight className="ml-2 w-4 h-4" />
                  </Button>
                </Link>
              </div>

              {/* Dashboard Preview */}
              <div className="bg-muted/50 rounded-2xl border border-border p-6 space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-bold text-foreground">Incoming Prescriptions</div>
                  <div className="text-xs bg-green-500/10 text-green-600 px-2 py-0.5 rounded-full font-semibold">3 New</div>
                </div>
                {[
                  { name: "Amoxicillin 500mg", patient: "J. Adeyemi", status: "Pending", statusColor: "bg-yellow-500" },
                  { name: "Metformin 850mg", patient: "R. Okafor", status: "Confirmed", statusColor: "bg-green-500" },
                  { name: "Amlodipine 5mg", patient: "T. Musa", status: "Ready", statusColor: "bg-blue-500" }
                ].map((rx, idx) => (
                  <div key={idx} className="bg-background rounded-xl p-4 border border-border flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-green-500/10 rounded-lg flex items-center justify-center">
                        <Pill size={18} className="text-green-500" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-foreground">{rx.name}</div>
                        <div className="text-xs text-muted-foreground">{rx.patient}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${rx.statusColor}`} />
                      <span className="text-xs font-medium text-muted-foreground">{rx.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ SECURITY / TRUST ═══════════════════════ */}
      <section className="py-16 bg-gradient-to-r from-slate-900 via-green-950 to-slate-900 border-y border-green-800/30">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-semibold mb-6">
            <ShieldCheck size={14} /> Compliant &amp; Secure
          </div>
          <h3 className="text-2xl md:text-3xl font-bold text-white mb-4">Your health data is protected</h3>
          <p className="text-slate-400 max-w-2xl mx-auto mb-8">
            ZumaRx uses end-to-end encryption to keep your prescriptions, orders, and personal information completely secure — fully compliant with Nigerian data protection regulations.
          </p>
          <div className="flex flex-wrap justify-center gap-6 text-sm text-slate-300">
            <div className="flex items-center gap-2"><Lock size={16} className="text-green-400" /> End-to-End Encryption</div>
            <div className="flex items-center gap-2"><ShieldCheck size={16} className="text-green-400" /> PCN Registered</div>
            <div className="flex items-center gap-2"><ShieldCheck size={16} className="text-green-400" /> NAFDAC Compliant</div>
            <div className="flex items-center gap-2"><Lock size={16} className="text-green-400" /> NDPA Compliant</div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ PRICING ═══════════════════════ */}
      <section id="pricing" className="py-24 bg-card/30 border-y border-border">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">Simple, Transparent Pricing</h2>
            <p className="text-muted-foreground">No hidden fees. Pay only for what you order.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">

            {/* Patient Free */}
            <div className="bg-background rounded-3xl p-8 border border-border flex flex-col hover:border-green-500/30 transition-colors">
              <div className="text-lg font-medium text-muted-foreground mb-2">For Patients</div>
              <div className="text-4xl font-bold text-foreground mb-1">Free</div>
              <div className="text-sm text-muted-foreground mb-6">to search &amp; order</div>
              <ul className="space-y-4 mb-8 flex-1">
                {[
                  "Search all medications & compare prices",
                  "Upload prescriptions for free",
                  "Order from any partner pharmacy",
                  "Real-time delivery tracking"
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-muted-foreground text-sm">
                    <CheckCircle size={16} className="text-green-500 mt-0.5 shrink-0" /> {item}
                  </li>
                ))}
              </ul>
              <Link href="/ng/patient/search" className="w-full block text-center py-3 rounded-xl border border-border hover:bg-accent text-foreground transition-colors font-medium">
                Start Searching
              </Link>
            </div>

            {/* Premium Patient */}
            <div className="bg-gradient-to-b from-green-900/20 to-background rounded-3xl p-8 border border-green-500/30 flex flex-col relative overflow-hidden shadow-[0_0_40px_rgba(22,163,74,0.1)]">
              <div className="absolute top-0 right-0 bg-green-600 text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl uppercase tracking-wider">Most Popular</div>
              <div className="text-lg font-medium text-green-400 mb-2">Premium Patient</div>
              <div className="text-4xl font-bold text-foreground mb-1">&#8358;2,500<span className="text-lg text-muted-foreground">/mo</span></div>
              <div className="text-sm text-muted-foreground mb-6">per month</div>
              <ul className="space-y-4 mb-8 flex-1">
                {[
                  "Priority delivery (2–4 hours)",
                  "Save 15% on all orders",
                  "Dedicated pharmacist chat support",
                  "Health record management",
                  "Family plan (up to 4 members)"
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-muted-foreground text-sm">
                    <CheckCircle size={16} className="text-green-500 mt-0.5 shrink-0" /> {item}
                  </li>
                ))}
              </ul>
              <Link href="/ng/auth/login" className="w-full block text-center py-3 rounded-xl bg-green-600 hover:bg-green-500 transition-colors text-white font-bold shadow-lg shadow-green-900/30">
                Get Premium
              </Link>
            </div>

            {/* Pharmacy Partner */}
            <div className="bg-gradient-to-b from-emerald-900/20 to-background rounded-3xl p-8 border border-emerald-500/30 flex flex-col relative overflow-hidden">
              <div className="text-lg font-medium text-emerald-400 mb-2">Pharmacy Partner</div>
              <div className="text-4xl font-bold text-foreground mb-1">&#8358;20,000<span className="text-lg text-muted-foreground">/mo</span></div>
              <div className="text-sm text-muted-foreground mb-6">to join the network</div>
              <ul className="space-y-4 mb-8 flex-1">
                {[
                  "Receive unlimited digital prescriptions",
                  "Full pharmacy dashboard access",
                  "Inventory & stock management",
                  "Automatic bank settlements (T+3)",
                  "Delivery coordination tools"
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-muted-foreground text-sm">
                    <CheckCircle size={16} className="text-emerald-500 mt-0.5 shrink-0" /> {item}
                  </li>
                ))}
              </ul>
              <Link href="/ng/pharmacy/onboarding" className="w-full block text-center py-3 rounded-xl border border-emerald-500/30 hover:bg-emerald-500/10 text-foreground transition-colors font-medium">
                Register Pharmacy
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ PAYMENT METHODS ═══════════════════════ */}
      <section className="py-16 bg-card/40 border-b border-border">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h3 className="text-2xl font-bold text-foreground mb-3">Pay however you prefer</h3>
          <p className="text-muted-foreground mb-10">We accept the payment methods Nigerians use every day.</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { icon: Banknote, label: "Cash Payment", desc: "Pay at the pharmacy", color: "text-green-500", bg: "bg-green-500/10" },
              { icon: Building2, label: "Bank Transfer", desc: "Direct bank transfer", color: "text-blue-500", bg: "bg-blue-500/10" },
              { icon: CreditCard, label: "Card Payment", desc: "Debit or credit card", color: "text-purple-500", bg: "bg-purple-500/10" },
              { icon: Phone, label: "USSD & Mobile", desc: "Any USSD code or wallet", color: "text-amber-500", bg: "bg-amber-500/10" }
            ].map((method, idx) => (
              <div key={idx} className="bg-background rounded-2xl p-6 border border-border hover:border-green-500/20 transition-colors text-center group">
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
          <h2 className="text-4xl font-bold text-white mb-6">Ready to simplify your healthcare?</h2>
          <p className="text-xl text-green-100/90 mb-10 max-w-2xl mx-auto">
            Join thousands of patients and pharmacies across Nigeria who have discovered a smarter way to manage medications.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/ng/patient/search">
              <Button size="lg" className="bg-white text-green-700 hover:bg-green-50 h-14 px-10 text-lg shadow-lg">
                Search Medications <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Link>
            <Link href="/ng/pharmacy/onboarding">
              <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10 h-14 px-10 text-lg">
                <Building2 className="mr-2 w-5 h-5" /> Register Your Pharmacy
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ FOOTER ═══════════════════════ */}
      <footer className="py-16 px-6 bg-slate-950 border-t border-slate-800">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-12 mb-12">
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-9 h-9 bg-green-600 rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(22,163,74,0.3)]">
                  <span className="text-white font-black text-sm">Rx</span>
                </div>
                <span className="text-white font-bold text-lg">ZumaRx</span>
              </div>
              <p className="text-slate-400 text-sm leading-relaxed max-w-xs">
                Nigeria&apos;s leading pharmacy delivery and medication management platform. Connecting patients to verified pharmacies nationwide.
              </p>
            </div>

            <div>
              <div className="text-white font-bold mb-4">Patients</div>
              <div className="space-y-3">
                {[
                  { label: "Search Medications", href: "/ng/patient/search" },
                  { label: "Upload Prescription", href: "/ng/patient/prescriptions" },
                  { label: "Track Orders", href: "/ng/patient/orders" },
                  { label: "My Account", href: "/ng/auth/login" }
                ].map(link => (
                  <Link key={link.href} href={link.href} className="block text-slate-400 hover:text-white text-sm transition-colors">
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>

            <div>
              <div className="text-white font-bold mb-4">Pharmacies</div>
              <div className="space-y-3">
                {[
                  { label: "Register Pharmacy", href: "/ng/pharmacy/onboarding" },
                  { label: "Pharmacy Dashboard", href: "/ng/pharmacy/dashboard" },
                  { label: "Partner Network", href: "/ng/pharmacy/onboarding" }
                ].map(link => (
                  <Link key={link.href} href={link.href} className="block text-slate-400 hover:text-white text-sm transition-colors">
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>

            <div>
              <div className="text-white font-bold mb-4">Legal &amp; Compliance</div>
              <div className="space-y-3">
                {[
                  { label: "Privacy Policy", href: "/privacy" },
                  { label: "Terms of Service", href: "/terms" },
                  { label: "Contact Us", href: "/contact" }
                ].map(link => (
                  <Link key={link.href} href={link.href} className="block text-slate-400 hover:text-white text-sm transition-colors">
                    {link.label}
                  </Link>
                ))}
                <div className="pt-3 space-y-1.5">
                  <div className="text-slate-500 text-xs flex items-center gap-1.5"><CheckCircle size={10} className="text-green-600" /> PCN Registered</div>
                  <div className="text-slate-500 text-xs flex items-center gap-1.5"><CheckCircle size={10} className="text-green-600" /> NDPA Compliant</div>
                  <div className="text-slate-500 text-xs flex items-center gap-1.5"><CheckCircle size={10} className="text-green-600" /> NAFDAC Approved</div>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-800 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-slate-500 text-sm">&copy; {new Date().getFullYear()} ZumaRx (DoctaRx Nigeria). All rights reserved.</p>
            <a href="mailto:hello@zumarx.ng" className="text-slate-400 hover:text-white text-sm transition-colors">
              hello@zumarx.ng
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
