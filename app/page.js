'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ShieldCheck, User, Stethoscope, Menu, X,
  ChevronRight, Lock, Clock, Calendar, Star,
  Smartphone, ArrowRight, Activity, CheckCircle,
  Heart, Sparkles, Video, Mic, VideoOff,
  Pill, MapPin, CreditCard, Banknote, Building2,
  Truck, Package, Phone, Search
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { cn } from '@/lib/utils';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';
import CountrySelector from '@/components/CountrySelector';

// Abstract / illustration-style healthcare imagery (no stock photos of people)
const HERO_IMAGE = "https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&q=80&w=2000"; // medical supplies flat-lay
const PATIENT_MOMENT_IMAGE = "https://images.unsplash.com/photo-1584982751601-97dcc096659c?auto=format&fit=crop&q=80&w=1200"; // stethoscope on blue
const DOCTOR_IMAGE = "https://images.unsplash.com/photo-1631815588090-d4bfec5b1ccb?auto=format&fit=crop&q=80&w=1200"; // abstract medical tech
const PHARMACY_IMAGE = "https://images.unsplash.com/photo-1585435557343-3b092031a831?auto=format&fit=crop&q=80&w=1200"; // colorful pills/capsules
const FAMILY_IMAGE = "https://images.unsplash.com/photo-1559757175-5700dde675bc?auto=format&fit=crop&q=80&w=1200"; // heart health abstract

const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "How it Works", href: "#how-it-works" },
  { label: "Pharmacies", href: "#pharmacy" },
  { label: "Pricing", href: "#pricing" },
];

const SectionHeading = ({ badge, title, subtitle, align = "center" }) => (
  <div className={`flex flex-col gap-4 mb-12 ${align === "center" ? "items-center text-center" : "items-start text-left"}`}>
    {badge && (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/10 text-blue-500 dark:text-blue-300 text-xs font-semibold tracking-wide uppercase border border-blue-500/20">
        <Sparkles size={10} /> {badge}
      </span>
    )}
    <h2 className="text-3xl md:text-5xl font-bold text-foreground tracking-tight leading-tight">{title}</h2>
    {subtitle && <p className="text-lg text-muted-foreground max-w-2xl leading-relaxed">{subtitle}</p>}
  </div>
);

const FeatureCard = ({ icon: Icon, title, desc, colorClass, bgClass, image }) => (
  <div className="group relative bg-card rounded-3xl overflow-hidden border border-border hover:border-primary/30 transition-all duration-300 hover:shadow-2xl hover:shadow-purple-900/10 flex flex-col">
    {image ? (
      <div className="h-48 overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-t from-card to-transparent z-10" />
        <img src={image} alt={title} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 opacity-80 group-hover:opacity-100" />
      </div>
    ) : (
      <div className="h-48 bg-gradient-to-br from-muted/60 to-muted flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(120,119,198,0.1),rgba(255,255,255,0))]" />
        <div className="w-3/4 h-3/4 bg-background rounded-xl border border-border shadow-2xl flex flex-col p-4 gap-3 transform rotate-6 group-hover:rotate-3 transition-transform duration-500">
          <div className="flex gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500/50" />
            <div className="w-2 h-2 rounded-full bg-yellow-500/50" />
            <div className="w-2 h-2 rounded-full bg-green-500/50" />
          </div>
          <div className="h-2 w-1/2 bg-muted rounded-full animate-pulse" />
          <div className="h-20 bg-muted/50 rounded-lg border border-border mt-2" />
        </div>
      </div>
    )}
    <div className="p-6 md:p-8 flex-1 flex flex-col relative z-20 -mt-6">
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 ${bgClass} border border-border backdrop-blur-md`}>
        <Icon size={24} className={colorClass} />
      </div>
      <h3 className="text-xl font-bold text-foreground mb-2">{title}</h3>
      <p className="text-muted-foreground leading-relaxed text-sm flex-1">{desc}</p>
    </div>
  </div>
);

export default function HomePage() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [getStartedOpen, setGetStartedOpen] = useState(false);
  const [emergencyBannerVisible, setEmergencyBannerVisible] = useState(true);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-blue-500/30">
      {/* Country Selector Modal */}
      <CountrySelector />

      {/* Emergency Banner */}
      {emergencyBannerVisible && (
        <div className="fixed top-0 left-0 right-0 z-[60] bg-red-900/80 border-b border-red-500/20 backdrop-blur-md text-white">
          <div className="max-w-7xl mx-auto px-4 py-2.5">
            <div className="flex items-center justify-center gap-2 text-xs sm:text-sm">
              <div className="bg-red-500/20 p-1 rounded-full animate-pulse"><Activity size={14} className="text-red-400" /></div>
              <span className="text-center leading-tight">
                Medical emergency? Call <strong>112</strong> or go to the nearest hospital immediately.
              </span>
              <button onClick={() => setEmergencyBannerVisible(false)} className="ml-2 p-1 hover:bg-white/20 rounded transition-colors flex-shrink-0" aria-label="Dismiss banner">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className={cn(
        "fixed left-0 right-0 z-50 border-b transition-all duration-300",
        emergencyBannerVisible ? "top-[40px]" : "top-0",
        isScrolled ? "bg-background/90 backdrop-blur-xl border-border py-3" : "bg-background/70 border-transparent py-4"
      )}>
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 group">
              <span className="rounded-xl bg-slate-950/95 px-3 py-2 shadow-[0_0_20px_rgba(34,211,238,0.18)] border border-slate-800">
                <DoctaRxLogo className="h-7 w-auto" />
              </span>
            </Link>

            <div className="hidden md:flex items-center gap-8">
              {NAV_LINKS.map((link) => (
                <a key={link.label} href={link.href} className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                  {link.label}
                </a>
              ))}
            </div>

            <div className="hidden md:flex items-center gap-3">
              <ThemeToggle />
              {/* Portal Login */}
              <div className="relative" onMouseEnter={() => setLoginOpen(true)} onMouseLeave={() => setLoginOpen(false)}>
                <button className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground px-3 py-2 rounded-lg hover:bg-accent transition-colors">
                  Portal Login
                  <ChevronRight className={cn("w-4 h-4 transition-transform", loginOpen && "rotate-90")} />
                </button>
                <div className={`absolute top-full right-0 w-64 pt-2 transition-all duration-200 ${loginOpen ? "opacity-100 translate-y-0 visible" : "opacity-0 translate-y-2 invisible"}`}>
                  <div className="bg-popover rounded-xl shadow-2xl border border-border overflow-hidden p-2 backdrop-blur-xl">
                    <div className="px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Select Portal</div>
                    <Link href="/patient/login" className="flex items-center gap-3 px-3 py-3 hover:bg-accent rounded-lg group transition-colors">
                      <div className="bg-blue-500/10 text-blue-500 dark:text-blue-300 p-2 rounded-lg group-hover:bg-blue-500/20 transition-colors"><User size={16} /></div>
                      <div>
                        <div className="text-sm font-medium text-foreground">Patient Portal</div>
                        <div className="text-xs text-muted-foreground">Access your care</div>
                      </div>
                    </Link>
                    <Link href="/provider/login" className="flex items-center gap-3 px-3 py-3 hover:bg-accent rounded-lg group transition-colors mt-1">
                      <div className="bg-emerald-500/10 text-emerald-500 dark:text-emerald-300 p-2 rounded-lg group-hover:bg-emerald-500/20 transition-colors"><Stethoscope size={16} /></div>
                      <div>
                        <div className="text-sm font-medium text-foreground">Provider Portal</div>
                        <div className="text-xs text-muted-foreground">Manage your practice</div>
                      </div>
                    </Link>
                    <Link href="/pharmacy/login" className="flex items-center gap-3 px-3 py-3 hover:bg-accent rounded-lg group transition-colors mt-1">
                      <div className="bg-purple-500/10 text-purple-500 dark:text-purple-300 p-2 rounded-lg group-hover:bg-purple-500/20 transition-colors"><Pill size={16} /></div>
                      <div>
                        <div className="text-sm font-medium text-foreground">Pharmacy Portal</div>
                        <div className="text-xs text-muted-foreground">Manage prescriptions</div>
                      </div>
                    </Link>
                  </div>
                </div>
              </div>

              {/* Get Started */}
              <div className="relative" onMouseEnter={() => setGetStartedOpen(true)} onMouseLeave={() => setGetStartedOpen(false)}>
                <Button className="bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_20px_rgba(37,99,235,0.3)]">
                  Get Started
                  <ChevronRight className={cn("ml-2 w-4 h-4 transition-transform", getStartedOpen && "rotate-90")} />
                </Button>
                <div className={`absolute top-full right-0 w-72 pt-2 transition-all duration-200 ${getStartedOpen ? "opacity-100 translate-y-0 visible" : "opacity-0 translate-y-2 invisible"}`}>
                  <div className="bg-popover rounded-xl shadow-2xl border border-border overflow-hidden p-2 backdrop-blur-xl">
                    <div className="px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">I am a...</div>
                    <Link href="/patient/register" className="flex items-center gap-3 px-3 py-3 hover:bg-accent rounded-lg group transition-colors">
                      <div className="bg-blue-500/10 text-blue-500 dark:text-blue-300 p-2 rounded-lg group-hover:bg-blue-500/20 transition-colors"><User size={16} /></div>
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-foreground">Patient</div>
                        <div className="text-xs text-muted-foreground">Book a consultation</div>
                      </div>
                      <ArrowRight size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Link>
                    <Link href="/provider/register" className="flex items-center gap-3 px-3 py-3 hover:bg-accent rounded-lg group transition-colors mt-1">
                      <div className="bg-emerald-500/10 text-emerald-500 dark:text-emerald-300 p-2 rounded-lg group-hover:bg-emerald-500/20 transition-colors"><Stethoscope size={16} /></div>
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-foreground">Provider</div>
                        <div className="text-xs text-muted-foreground">Join as a healthcare provider</div>
                      </div>
                      <ArrowRight size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Link>
                    <Link href="/pharmacy/register" className="flex items-center gap-3 px-3 py-3 hover:bg-accent rounded-lg group transition-colors mt-1">
                      <div className="bg-purple-500/10 text-purple-500 dark:text-purple-300 p-2 rounded-lg group-hover:bg-purple-500/20 transition-colors"><Pill size={16} /></div>
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-foreground">Pharmacy</div>
                        <div className="text-xs text-muted-foreground">Register your pharmacy</div>
                      </div>
                      <ArrowRight size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            {/* Mobile toggle */}
            <div className="flex md:hidden items-center gap-2">
              <ThemeToggle />
              <button className="text-muted-foreground p-2 hover:bg-accent rounded-lg" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label="Toggle mobile menu">
                {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden absolute top-full left-0 right-0 bg-background border-b border-border p-4 flex flex-col gap-2 animate-in slide-in-from-top-2">
            <div className="px-1 pb-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Get Started as...</div>
            <Link href="/patient/register" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-3 bg-blue-600 text-white px-4 py-3 rounded-xl font-bold">
              <User size={18} /> Patient
            </Link>
            <Link href="/provider/register" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-3 bg-emerald-700 text-white px-4 py-3 rounded-xl font-bold">
              <Stethoscope size={18} /> Provider
            </Link>
            <Link href="/pharmacy/register" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-3 bg-purple-700 text-white px-4 py-3 rounded-xl font-bold">
              <Pill size={18} /> Pharmacy
            </Link>
            <div className="h-px bg-border my-2" />
            <Link href="/patient/login" onClick={() => setMobileMenuOpen(false)} className="bg-accent text-foreground text-center py-3 rounded-xl font-medium border border-border">Patient Login</Link>
            <Link href="/provider/login" onClick={() => setMobileMenuOpen(false)} className="bg-accent text-foreground text-center py-3 rounded-xl font-medium border border-border">Provider Login</Link>
            <Link href="/pharmacy/login" onClick={() => setMobileMenuOpen(false)} className="bg-accent text-foreground text-center py-3 rounded-xl font-medium border border-border">Pharmacy Login</Link>
            <div className="h-px bg-border my-2" />
            {NAV_LINKS.map(link => (
              <a key={link.href} href={link.href} onClick={() => setMobileMenuOpen(false)} className="px-4 py-3 text-muted-foreground font-medium hover:bg-accent rounded-lg hover:text-foreground">{link.label}</a>
            ))}
          </div>
        )}
      </nav>

      {/* ═══════════════════════ HERO ═══════════════════════ */}
      <section className={cn(
        "relative pt-12 pb-20 md:pt-20 md:pb-28 overflow-hidden px-6 bg-gradient-to-b from-background via-purple-50/20 to-background dark:via-purple-950/10",
        emergencyBannerVisible ? "mt-[96px]" : "mt-[56px]"
      )}>
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-emerald-600/10 rounded-full blur-[120px] pointer-events-none" />

        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 lg:gap-20 items-center relative z-10">
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 px-3 py-1 rounded-full backdrop-blur-sm">
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
              </span>
              <span className="text-xs font-semibold text-blue-500 dark:text-blue-300 tracking-wide uppercase">Now Available Across Nigeria</span>
            </div>

            <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold text-foreground tracking-tight leading-[1.1]">
              Quality care,<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-emerald-400">
                delivered to you.
              </span>
            </h1>

            <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-lg">
              See a doctor online, get your prescription, and have medications delivered from a pharmacy near you. No long queues. Pay with cash, transfer, or card.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 pt-2">
              <Link href="/patient/register" className="inline-flex items-center justify-center bg-foreground text-background hover:opacity-90 text-base font-semibold px-8 py-4 rounded-full transition-all duration-200 shadow-xl">
                Book Consultation
              </Link>
              <a href="#how-it-works" className="inline-flex items-center justify-center bg-transparent border border-border hover:bg-accent text-foreground text-base font-semibold px-8 py-4 rounded-full transition-all duration-200">
                How it Works
              </a>
            </div>

            <div className="flex flex-wrap items-center gap-4 sm:gap-6 pt-2 text-sm text-muted-foreground font-medium">
              <div className="flex items-center gap-2"><ShieldCheck size={18} className="text-emerald-500" /> Secure Platform</div>
              <div className="flex items-center gap-2"><Pill size={18} className="text-purple-500" /> Pharmacy Network</div>
              <div className="flex items-center gap-2"><Star size={18} className="text-yellow-500 fill-yellow-500" /> 4.9/5 Rating</div>
            </div>
          </div>

          {/* Hero Image — Video consultation mockup */}
          <div className="relative">
            <div className="relative rounded-[2rem] overflow-hidden shadow-2xl border border-border bg-card aspect-[4/3] group">
              <img src={HERO_IMAGE} alt="Doctor conducting a video consultation" className="w-full h-full object-cover opacity-80 group-hover:opacity-90 transition-opacity duration-700" />

              <div className="absolute top-4 left-4 right-4 flex justify-between items-start">
                <div className="bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                  <span className="text-xs text-white font-mono">LIVE 00:12:44</span>
                </div>
                <div className="bg-black/40 backdrop-blur-md p-2 rounded-lg border border-white/10"><SignalIndicator /></div>
              </div>

              <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between">
                <div className="bg-black/60 backdrop-blur-md p-4 rounded-2xl border border-white/10 flex items-center gap-4 max-w-xs">
                  <div className="bg-blue-600/20 p-2.5 rounded-full"><Video size={20} className="text-blue-300" /></div>
                  <div>
                    <div className="text-sm font-bold text-white">Dr. Adaeze Okafor, MD</div>
                    <div className="text-xs text-blue-300 font-medium">General Practice</div>
                  </div>
                </div>
                <div className="w-24 h-32 bg-gray-800 rounded-xl border border-white/10 shadow-lg overflow-hidden hidden sm:block">
                  <img src={PATIENT_MOMENT_IMAGE} className="w-full h-full object-cover opacity-70" alt="Self view" />
                </div>
              </div>

              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-3">
                <div className="p-3 rounded-full bg-gray-900/80 text-white backdrop-blur border border-white/10"><Mic size={18} /></div>
                <div className="p-3 rounded-full bg-red-500/80 text-white backdrop-blur border border-red-500/20 shadow-lg shadow-red-900/50"><VideoOff size={18} /></div>
              </div>
            </div>
            <div className="absolute -top-10 -right-10 w-32 h-32 bg-purple-500/20 rounded-full blur-3xl -z-10 animate-pulse"></div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ FEATURES ═══════════════════════ */}
      <section id="features" className="py-24 bg-card/40 border-y border-border">
        <div className="max-w-7xl mx-auto px-6">
          <SectionHeading
            badge="Why DoctaRx"
            title="Healthcare designed for Nigeria"
            subtitle="We built a healthcare experience that works the way Nigerians live — simple, affordable, and connected to your local pharmacy."
          />
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            <FeatureCard
              icon={Clock}
              title="Available 24/7"
              desc="See a doctor anytime — early morning, late night, weekends. No waiting in crowded clinics."
              colorClass="text-blue-500 dark:text-blue-300"
              bgClass="bg-blue-500/10"
              image={PATIENT_MOMENT_IMAGE}
            />
            <FeatureCard
              icon={Stethoscope}
              title="Licensed Doctors"
              desc="Every provider on our platform is a verified, licensed medical professional registered in Nigeria."
              colorClass="text-emerald-500 dark:text-emerald-300"
              bgClass="bg-emerald-500/10"
              image={DOCTOR_IMAGE}
            />
            <FeatureCard
              icon={Pill}
              title="Pharmacy Network"
              desc="Prescriptions sent directly to your chosen pharmacy. Pick up or get delivery to your doorstep."
              colorClass="text-purple-500 dark:text-purple-300"
              bgClass="bg-purple-500/10"
              image={PHARMACY_IMAGE}
            />
            <FeatureCard
              icon={Banknote}
              title="Pay Your Way"
              desc="Cash, bank transfer, or card — pay however is easiest for you. No insurance needed."
              colorClass="text-amber-500 dark:text-amber-300"
              bgClass="bg-amber-500/10"
              image={null}
            />
          </div>
        </div>
      </section>

      {/* ═══════════════════════ HOW IT WORKS ═══════════════════════ */}
      <section id="how-it-works" className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <SectionHeading title="Your path to feeling better" subtitle="From consultation to medication — simple steps to get the care you need." />
          <div className="relative grid md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12 mt-16">
            <div className="hidden lg:block absolute top-12 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent z-0"></div>
            {[
              { icon: User, title: "1. Create Account", desc: "Register in minutes with your phone number or email. Quick and easy." },
              { icon: Calendar, title: "2. Book Consultation", desc: "Choose a doctor and time that works. Video call or chat — your choice." },
              { icon: Pill, title: "3. Get Prescription", desc: "After consultation, your doctor sends a prescription to your chosen pharmacy." },
              { icon: Package, title: "4. Receive Medication", desc: "Pick up from the pharmacy or request delivery. Track your order in real-time." }
            ].map((step, idx) => (
              <div key={idx} className="relative z-10 flex flex-col items-center text-center group">
                <div className="w-24 h-24 bg-card rounded-full border border-border shadow-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:border-blue-500/50 transition-all duration-300">
                  <step.icon size={32} className="text-muted-foreground group-hover:text-blue-500 transition-colors" />
                </div>
                <h3 className="text-lg font-bold text-foreground mb-2">{step.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed max-w-xs">{step.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-16 text-center">
            <Link href="/patient/register" className="inline-flex items-center gap-2 text-blue-500 dark:text-blue-300 font-bold hover:opacity-90 transition-colors border-b border-blue-500/30 pb-0.5">
              Start your registration <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ FOR PATIENTS ═══════════════════════ */}
      <section className="py-24 bg-card/40 border-y border-border">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="space-y-8">
              <SectionHeading
                badge="For Patients"
                title="Healthcare that comes to you"
                subtitle="No more long hospital queues. See a doctor from your phone, get your prescription, and choose any pharmacy near you."
                align="left"
              />
              <ul className="space-y-5">
                {[
                  { icon: Video, text: "Consult with a doctor via secure video call or chat" },
                  { icon: Pill, text: "Prescriptions sent directly to your preferred pharmacy" },
                  { icon: MapPin, text: "Find and choose pharmacies near your location" },
                  { icon: Truck, text: "Pickup or delivery — track your medication in real-time" },
                  { icon: Banknote, text: "Pay with cash, bank transfer, or card — no wahala" },
                  { icon: ShieldCheck, text: "Your health data is encrypted and secure" }
                ].map((item, idx) => (
                  <li key={idx} className="flex items-start gap-4 group">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0 group-hover:bg-blue-500/20 transition-colors">
                      <item.icon size={20} className="text-blue-500" />
                    </div>
                    <span className="text-foreground font-medium pt-2">{item.text}</span>
                  </li>
                ))}
              </ul>
              <Link href="/patient/register">
                <Button className="bg-blue-600 hover:bg-blue-500 text-white shadow-lg mt-4">
                  Book a Consultation <ArrowRight className="ml-2 w-4 h-4" />
                </Button>
              </Link>
            </div>
            <div className="relative rounded-3xl overflow-hidden shadow-2xl border border-border aspect-[4/5]">
              <img src={FAMILY_IMAGE} alt="Nigerian family receiving healthcare" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
              <div className="absolute bottom-6 left-6 right-6">
                <div className="bg-white/10 backdrop-blur-xl p-4 rounded-2xl border border-white/20">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 bg-emerald-500 rounded-full flex items-center justify-center"><CheckCircle size={20} className="text-white" /></div>
                    <div>
                      <div className="text-white font-bold text-sm">Prescription Ready</div>
                      <div className="text-white/70 text-xs">HealthPlus Pharmacy, Lekki</div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1 bg-white/10 rounded-lg py-2 text-center text-white text-xs font-medium">Pick Up</div>
                    <div className="flex-1 bg-emerald-500 rounded-lg py-2 text-center text-white text-xs font-bold">Request Delivery</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ FOR PROVIDERS ═══════════════════════ */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="order-2 lg:order-1 relative rounded-3xl overflow-hidden shadow-2xl border border-border aspect-[4/5]">
              <img src={DOCTOR_IMAGE} alt="Nigerian doctor using telehealth platform" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
              <div className="absolute bottom-6 left-6 right-6 space-y-3">
                <div className="bg-white/10 backdrop-blur-xl p-3 rounded-xl border border-white/20 flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center"><Calendar size={16} className="text-white" /></div>
                  <div className="flex-1">
                    <div className="text-white font-medium text-xs">Next: Consultation with Chinedu O.</div>
                    <div className="text-white/60 text-[10px]">2:30 PM Today</div>
                  </div>
                </div>
                <div className="bg-white/10 backdrop-blur-xl p-3 rounded-xl border border-white/20 flex items-center gap-3">
                  <div className="w-8 h-8 bg-purple-500 rounded-lg flex items-center justify-center"><Pill size={16} className="text-white" /></div>
                  <div className="flex-1">
                    <div className="text-white font-medium text-xs">Prescription sent to MedPlus Pharmacy</div>
                    <div className="text-white/60 text-[10px]">Confirmed &amp; Ready</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="order-1 lg:order-2 space-y-8">
              <SectionHeading
                badge="For Providers"
                title="Grow your practice digitally"
                subtitle="See more patients, write prescriptions digitally, and route them to pharmacies — all from one dashboard."
                align="left"
              />
              <ul className="space-y-5">
                {[
                  { icon: Video, text: "Conduct secure video consultations from anywhere" },
                  { icon: Pill, text: "Write and send e-prescriptions directly to pharmacies" },
                  { icon: Activity, text: "AI-assisted clinical decision support and SOAP notes" },
                  { icon: CreditCard, text: "Get paid per consultation — transparent earnings" },
                  { icon: Calendar, text: "Manage your schedule and patient follow-ups" }
                ].map((item, idx) => (
                  <li key={idx} className="flex items-start gap-4 group">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0 group-hover:bg-emerald-500/20 transition-colors">
                      <item.icon size={20} className="text-emerald-500" />
                    </div>
                    <span className="text-foreground font-medium pt-2">{item.text}</span>
                  </li>
                ))}
              </ul>
              <Link href="/provider/register">
                <Button className="bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg mt-4">
                  Join as Provider <ArrowRight className="ml-2 w-4 h-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ FOR PHARMACIES ═══════════════════════ */}
      <section id="pharmacy" className="py-24 bg-gradient-to-b from-purple-50/50 to-background dark:from-purple-950/20 dark:to-background border-y border-border">
        <div className="max-w-7xl mx-auto px-6">
          <SectionHeading
            badge="For Pharmacies"
            title="More prescriptions. More customers."
            subtitle="Join the DoctaRx pharmacy network and receive digital prescriptions from verified doctors across Nigeria."
          />

          <div className="grid md:grid-cols-3 gap-6 mb-16">
            {[
              {
                icon: Package, title: "Receive Prescriptions",
                desc: "Get digital prescriptions directly from consulting doctors. No more illegible handwriting.",
                color: "text-purple-500", bg: "bg-purple-500/10"
              },
              {
                icon: Search, title: "Confirm & Price",
                desc: "Check stock availability, confirm pricing, and suggest alternatives if a medication is unavailable.",
                color: "text-blue-500", bg: "bg-blue-500/10"
              },
              {
                icon: Truck, title: "Fulfill & Deliver",
                desc: "Prepare orders for pickup or arrange delivery. Real-time status updates for patients.",
                color: "text-emerald-500", bg: "bg-emerald-500/10"
              }
            ].map((item, idx) => (
              <div key={idx} className="bg-card rounded-2xl p-8 border border-border hover:border-purple-500/30 transition-all hover:shadow-xl group">
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
                    "Real-time prescription queue",
                    "Stock availability confirmation",
                    "Drug substitution suggestions",
                    "Pricing and payment confirmation",
                    "Pickup and delivery tracking",
                    "Patient communication channel"
                  ].map((text, idx) => (
                    <li key={idx} className="flex items-center gap-3 text-sm">
                      <CheckCircle size={16} className="text-purple-500 shrink-0" />
                      <span className="text-foreground">{text}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/pharmacy/register">
                  <Button className="bg-purple-600 hover:bg-purple-500 text-white shadow-lg mt-2">
                    Register Your Pharmacy <ArrowRight className="ml-2 w-4 h-4" />
                  </Button>
                </Link>
              </div>
              <div className="bg-muted/50 rounded-2xl border border-border p-6 space-y-4">
                {/* Pharmacy Dashboard Preview */}
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-bold text-foreground">Incoming Prescriptions</div>
                  <div className="text-xs bg-purple-500/10 text-purple-500 px-2 py-0.5 rounded-full font-semibold">3 New</div>
                </div>
                {[
                  { name: "Amoxicillin 500mg", patient: "Chioma A.", status: "Pending", statusColor: "bg-yellow-500" },
                  { name: "Metformin 850mg", patient: "Emeka O.", status: "Confirmed", statusColor: "bg-emerald-500" },
                  { name: "Amlodipine 5mg", patient: "Fatima M.", status: "Ready", statusColor: "bg-blue-500" }
                ].map((rx, idx) => (
                  <div key={idx} className="bg-background rounded-xl p-4 border border-border flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center">
                        <Pill size={18} className="text-purple-500" />
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

      {/* ═══════════════════════ SECURITY ═══════════════════════ */}
      <section className="py-16 bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-900 border-y border-emerald-800/30">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold mb-6">
            <ShieldCheck size={14} /> Enterprise-Grade Security
          </div>
          <h3 className="text-2xl md:text-3xl font-bold text-white mb-4">Your health data is protected</h3>
          <p className="text-slate-400 max-w-2xl mx-auto mb-8">
            DoctaRx uses NVIDIA NemoClaw OpenShell sandboxed AI and end-to-end encryption to keep your medical records, prescriptions, and personal information completely secure.
          </p>
          <div className="flex flex-wrap justify-center gap-6 text-sm text-slate-300">
            <div className="flex items-center gap-2"><Lock size={16} className="text-emerald-400" /> End-to-End Encryption</div>
            <div className="flex items-center gap-2"><ShieldCheck size={16} className="text-emerald-400" /> Sandboxed AI Agents</div>
            <div className="flex items-center gap-2"><Lock size={16} className="text-emerald-400" /> PII Auto-Scrubbing</div>
            <div className="flex items-center gap-2"><ShieldCheck size={16} className="text-emerald-400" /> Audit Trail</div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ PRICING ═══════════════════════ */}
      <section id="pricing" className="py-24 bg-card/30 border-y border-border">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">Simple, Transparent Pricing</h2>
            <p className="text-muted-foreground">No insurance needed. Pay with cash, bank transfer, or card.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {/* Single Visit */}
            <div className="bg-background rounded-3xl p-8 border border-border flex flex-col hover:border-primary/30 transition-colors">
              <div className="text-lg font-medium text-muted-foreground mb-2">Single Consultation</div>
              <div className="text-4xl font-bold text-foreground mb-1">&#8358;5,000</div>
              <div className="text-sm text-muted-foreground mb-6">per consultation</div>
              <ul className="space-y-4 mb-8 flex-1">
                <li className="flex items-start gap-3 text-muted-foreground text-sm">
                  <CheckCircle size={16} className="text-blue-500 mt-0.5 shrink-0" /> Video or chat consultation
                </li>
                <li className="flex items-start gap-3 text-muted-foreground text-sm">
                  <CheckCircle size={16} className="text-blue-500 mt-0.5 shrink-0" /> Prescription to any pharmacy
                </li>
                <li className="flex items-start gap-3 text-muted-foreground text-sm">
                  <CheckCircle size={16} className="text-blue-500 mt-0.5 shrink-0" /> Pay cash, transfer, or card
                </li>
              </ul>
              <Link href="/patient/register" className="w-full block text-center py-3 rounded-xl border border-border hover:bg-accent text-foreground transition-colors font-medium">
                Book Now
              </Link>
            </div>

            {/* Membership */}
            <div className="bg-gradient-to-b from-blue-900/20 to-background rounded-3xl p-8 border border-blue-500/30 flex flex-col relative overflow-hidden shadow-[0_0_40px_rgba(37,99,235,0.1)]">
              <div className="absolute top-0 right-0 bg-blue-600 text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl uppercase tracking-wider">Most Popular</div>
              <div className="text-lg font-medium text-blue-300 mb-2">Family Plan</div>
              <div className="text-4xl font-bold text-foreground mb-1">&#8358;3,000<span className="text-lg text-muted-foreground">/mo</span></div>
              <div className="text-sm text-muted-foreground mb-6">per family member</div>
              <ul className="space-y-4 mb-8 flex-1">
                <li className="flex items-start gap-3 text-muted-foreground text-sm">
                  <CheckCircle size={16} className="text-blue-500 mt-0.5 shrink-0" /> &#8358;3,500 per visit (save &#8358;1,500)
                </li>
                <li className="flex items-start gap-3 text-muted-foreground text-sm">
                  <CheckCircle size={16} className="text-blue-500 mt-0.5 shrink-0" /> Unlimited messaging with care team
                </li>
                <li className="flex items-start gap-3 text-muted-foreground text-sm">
                  <CheckCircle size={16} className="text-blue-500 mt-0.5 shrink-0" /> Priority pharmacy delivery
                </li>
                <li className="flex items-start gap-3 text-muted-foreground text-sm">
                  <CheckCircle size={16} className="text-blue-500 mt-0.5 shrink-0" /> Annual health check-up
                </li>
              </ul>
              <Link href="/patient/register?plan=family" className="w-full block text-center py-3 rounded-xl bg-blue-600 hover:bg-blue-500 transition-colors text-white font-bold shadow-lg shadow-blue-900/30">
                Start Family Plan
              </Link>
            </div>

            {/* Pharmacy */}
            <div className="bg-gradient-to-b from-purple-900/20 to-background rounded-3xl p-8 border border-purple-500/30 flex flex-col relative overflow-hidden">
              <div className="text-lg font-medium text-purple-300 mb-2">Pharmacy Partner</div>
              <div className="text-4xl font-bold text-foreground mb-1">Free</div>
              <div className="text-sm text-muted-foreground mb-6">to join the network</div>
              <ul className="space-y-4 mb-8 flex-1">
                <li className="flex items-start gap-3 text-muted-foreground text-sm">
                  <CheckCircle size={16} className="text-purple-500 mt-0.5 shrink-0" /> Receive digital prescriptions
                </li>
                <li className="flex items-start gap-3 text-muted-foreground text-sm">
                  <CheckCircle size={16} className="text-purple-500 mt-0.5 shrink-0" /> Full pharmacy dashboard
                </li>
                <li className="flex items-start gap-3 text-muted-foreground text-sm">
                  <CheckCircle size={16} className="text-purple-500 mt-0.5 shrink-0" /> Stock & pricing management
                </li>
                <li className="flex items-start gap-3 text-muted-foreground text-sm">
                  <CheckCircle size={16} className="text-purple-500 mt-0.5 shrink-0" /> Delivery coordination tools
                </li>
              </ul>
              <Link href="/pharmacy/register" className="w-full block text-center py-3 rounded-xl border border-purple-500/30 hover:bg-purple-500/10 text-foreground transition-colors font-medium">
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
              { icon: Banknote, label: "Cash Payment", desc: "Pay at the pharmacy", color: "text-emerald-500", bg: "bg-emerald-500/10" },
              { icon: Building2, label: "Bank Transfer", desc: "Direct transfer", color: "text-blue-500", bg: "bg-blue-500/10" },
              { icon: CreditCard, label: "Card Payment", desc: "Debit or credit card", color: "text-purple-500", bg: "bg-purple-500/10" },
              { icon: Phone, label: "Mobile Money", desc: "USSD or mobile wallet", color: "text-amber-500", bg: "bg-amber-500/10" }
            ].map((method, idx) => (
              <div key={idx} className="bg-background rounded-2xl p-6 border border-border hover:border-primary/20 transition-colors text-center group">
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
      <section className="py-20 px-6 bg-gradient-to-r from-blue-600 to-indigo-700">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-4xl font-bold text-white mb-6">Ready to get better healthcare?</h2>
          <p className="text-xl text-blue-100/90 mb-10 max-w-2xl mx-auto">
            Join thousands of Nigerians who have discovered a better way to access doctors, prescriptions, and medications.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/patient/register">
              <Button size="lg" className="bg-white text-blue-700 hover:bg-blue-50 h-14 px-10 text-lg shadow-lg">
                Book a Consultation <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Link>
            <Link href="/pharmacy/register">
              <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10 h-14 px-10 text-lg">
                <Pill className="mr-2 w-5 h-5" /> Register Your Pharmacy
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ INLINE FOOTER ═══════════════════════ */}
      <footer className="py-10 px-6 bg-card border-t border-border">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="rounded-xl bg-slate-950/95 px-3 py-2 shadow-[0_0_20px_rgba(34,211,238,0.18)] border border-slate-800">
                <DoctaRxLogo className="h-7 w-auto" />
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-6 text-sm text-muted-foreground justify-center">
              <a href="mailto:hello@doctarx.ng" className="hover:text-foreground transition-colors">hello@doctarx.ng</a>
              <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
              <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
              <Link href="/contact" className="hover:text-foreground transition-colors">Contact</Link>
            </div>

            <p className="text-sm text-muted-foreground">&copy; {new Date().getFullYear()} DoctaRx Nigeria. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

const SignalIndicator = () => (
  <div className="flex gap-0.5 items-end h-3">
    <div className="w-1 bg-green-500 h-1 rounded-sm" />
    <div className="w-1 bg-green-500 h-2 rounded-sm" />
    <div className="w-1 bg-green-500 h-3 rounded-sm" />
    <div className="w-1 bg-gray-600 h-3 rounded-sm" />
  </div>
);
