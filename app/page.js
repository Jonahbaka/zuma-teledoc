'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ShieldCheck, User, Stethoscope, Menu, X,
  ChevronRight, Lock, Clock, Calendar, Star,
  Smartphone, ArrowRight, Activity, CheckCircle,
  Heart, Sparkles, Video, Mic, VideoOff
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { toast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';

const HERO_IMAGE = "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&q=80&w=2000";
const PATIENT_MOMENT_IMAGE = "https://images.unsplash.com/photo-1530497610245-94d3c16cda28?auto=format&fit=crop&q=80&w=1200";
const DOCTOR_IMAGE = "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&q=80&w=1200";

const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "How it Works", href: "#how-it-works" },
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
  const [emergencyBannerVisible, setEmergencyBannerVisible] = useState(true);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleJoinAsProvider = () => {
    toast({
      title: "Provider Registration",
      description: "Provider sign-ups require board certification. If you have an invitation, please use the link provided in your email.",
      variant: "default",
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-blue-500/30">
      {emergencyBannerVisible && (
        <div className="fixed top-0 left-0 right-0 z-[60] bg-red-900/80 border-b border-red-500/20 backdrop-blur-md text-white">
          <div className="max-w-7xl mx-auto px-4 py-2.5">
            <div className="flex items-center justify-center gap-2 text-xs sm:text-sm">
              <div className="bg-red-500/20 p-1 rounded-full animate-pulse"><Activity size={14} className="text-red-400" /></div>
              <span className="text-center leading-tight">
                If you are experiencing a life-threatening medical emergency, dial <strong>911</strong> immediately.
              </span>
              <button
                onClick={() => setEmergencyBannerVisible(false)}
                className="ml-2 p-1 hover:bg-white/20 rounded transition-colors flex-shrink-0"
                aria-label="Dismiss banner"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

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
              <div className="relative" onMouseEnter={() => setLoginOpen(true)} onMouseLeave={() => setLoginOpen(false)}>
                <button className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground px-3 py-2 rounded-lg hover:bg-accent transition-colors">
                  Portal Login
                  <ChevronRight className={cn("w-4 h-4 transition-transform", loginOpen && "rotate-90")} />
                </button>
                <div className={`absolute top-full right-0 w-64 pt-2 transition-all duration-200 ${loginOpen ? "opacity-100 translate-y-0 visible" : "opacity-0 translate-y-2 invisible"}`}>
                  <div className="bg-popover rounded-xl shadow-2xl border border-border overflow-hidden p-2 backdrop-blur-xl">
                    <div className="px-3 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Select Portal</div>
                    <Link href="/patient/login" className="flex items-center gap-3 px-3 py-3 hover:bg-accent rounded-lg group transition-colors">
                      <div className="bg-blue-500/10 text-blue-500 dark:text-blue-300 p-2 rounded-lg group-hover:bg-blue-500/20 transition-colors">
                        <User size={16} />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-foreground">Patient Portal</div>
                        <div className="text-xs text-muted-foreground">Access your care</div>
                      </div>
                    </Link>
                    <Link href="/provider/login" onClick={handleJoinAsProvider} className="flex items-center gap-3 px-3 py-3 hover:bg-accent rounded-lg group transition-colors mt-1">
                      <div className="bg-emerald-500/10 text-emerald-500 dark:text-emerald-300 p-2 rounded-lg group-hover:bg-emerald-500/20 transition-colors">
                        <Stethoscope size={16} />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-foreground">Provider Portal</div>
                        <div className="text-xs text-muted-foreground">Board certified only</div>
                      </div>
                    </Link>
                  </div>
                </div>
              </div>

              <Link href="/patient/register">
                <Button className="bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_20px_rgba(37,99,235,0.3)]">
                  Get Started
                  <ArrowRight className="ml-2 w-4 h-4" />
                </Button>
              </Link>
            </div>

            <div className="flex md:hidden items-center gap-2">
              <ThemeToggle />
              <button className="text-muted-foreground p-2 hover:bg-accent rounded-lg" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label="Toggle mobile menu">
                {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
              </button>
            </div>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden absolute top-full left-0 right-0 bg-background border-b border-border p-4 flex flex-col gap-2 animate-in slide-in-from-top-2">
            <Link href="/patient/register" className="bg-blue-600 text-white text-center py-3 rounded-xl font-bold">Start Patient Registration</Link>
            <Link href="/patient/login" className="bg-accent text-foreground text-center py-3 rounded-xl font-medium border border-border">Patient Login</Link>
            <div className="h-px bg-border my-2" />
            {NAV_LINKS.map(link => (
              <a key={link.href} href={link.href} className="px-4 py-3 text-muted-foreground font-medium hover:bg-accent rounded-lg hover:text-foreground">{link.label}</a>
            ))}
            <Link href="/provider/login" onClick={handleJoinAsProvider} className="px-4 py-3 text-muted-foreground font-medium hover:bg-accent rounded-lg flex items-center gap-2 hover:text-foreground">
              Provider Access <ShieldCheck size={16} className="text-blue-500" />
            </Link>
          </div>
        )}
      </nav>

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
              <span className="text-xs font-semibold text-blue-500 dark:text-blue-300 tracking-wide uppercase">Accepting New Patients</span>
            </div>

            <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold text-foreground tracking-tight leading-[1.1]">
              Expert care,<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-emerald-400">
                right where you are.
              </span>
            </h1>

            <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-lg">
              Connect with board-certified physicians via secure HD video. No waiting rooms, no hassle. Just quality healthcare on your device.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 pt-2">
              <Link href="/patient/register" className="inline-flex items-center justify-center bg-foreground text-background hover:opacity-90 text-base font-semibold px-8 py-4 rounded-full transition-all duration-200 shadow-xl">
                Book Appointment
              </Link>
              <a href="#how-it-works" className="inline-flex items-center justify-center bg-transparent border border-border hover:bg-accent text-foreground text-base font-semibold px-8 py-4 rounded-full transition-all duration-200">
                How it Works
              </a>
            </div>

            <div className="flex items-center gap-6 pt-2 text-sm text-muted-foreground font-medium">
              <div className="flex items-center gap-2"><ShieldCheck size={18} className="text-emerald-500" /> HIPAA Compliant</div>
              <div className="flex items-center gap-2"><Star size={18} className="text-yellow-500 fill-yellow-500" /> 4.9/5 Rating</div>
            </div>
          </div>

          <div className="relative">
            <div className="relative rounded-[2rem] overflow-hidden shadow-2xl border border-border bg-card aspect-[4/3] group">
              <img src={HERO_IMAGE} alt="Doctor conducting a video consultation" className="w-full h-full object-cover opacity-80 group-hover:opacity-90 transition-opacity duration-700" />

              <div className="absolute top-4 left-4 right-4 flex justify-between items-start">
                <div className="bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                  <span className="text-xs text-white font-mono">REC 00:12:44</span>
                </div>
                <div className="bg-black/40 backdrop-blur-md p-2 rounded-lg border border-white/10"><SignalIndicator /></div>
              </div>

              <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between">
                <div className="bg-black/60 backdrop-blur-md p-4 rounded-2xl border border-white/10 flex items-center gap-4 max-w-xs">
                  <div className="bg-blue-600/20 p-2.5 rounded-full"><Video size={20} className="text-blue-300" /></div>
                  <div>
                    <div className="text-sm font-bold text-white">Dr. Sarah Chen, MD</div>
                    <div className="text-xs text-blue-300 font-medium">Internal Medicine</div>
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

      <section id="features" className="py-24 bg-card/40 border-y border-border">
        <div className="max-w-7xl mx-auto px-6">
          <SectionHeading
            badge="Why DoctaRx"
            title="Healthcare designed for modern life"
            subtitle="We've rebuilt the primary care experience to focus on what matters most: your health and your time."
          />
          <div className="grid md:grid-cols-3 gap-6">
            <FeatureCard
              icon={Clock}
              title="Available 24/7"
              desc="Care does not stop at 5 PM. Speak with a provider anytime, day or night, weekends included."
              colorClass="text-blue-500 dark:text-blue-300"
              bgClass="bg-blue-500/10"
              image={PATIENT_MOMENT_IMAGE}
            />
            <FeatureCard
              icon={ShieldCheck}
              title="Board-Certified"
              desc="Every provider in our network is vetted, board-certified, and located in the US. Quality you can trust."
              colorClass="text-emerald-500 dark:text-emerald-300"
              bgClass="bg-emerald-500/10"
              image={DOCTOR_IMAGE}
            />
            <FeatureCard
              icon={Smartphone}
              title="Seamless Technology"
              desc="From booking to prescriptions, manage your healthcare journey in one clean and secure experience."
              colorClass="text-purple-500 dark:text-purple-300"
              bgClass="bg-purple-500/10"
              image={null}
            />
          </div>
        </div>
      </section>

      <section id="how-it-works" className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <SectionHeading title="Your path to feeling better" subtitle="Simple steps to get the care you need, when you need it." />
          <div className="relative grid md:grid-cols-3 gap-12 mt-16">
            <div className="hidden md:block absolute top-12 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent z-0"></div>
            {[
              { icon: User, title: "1. Create Account", desc: "Register in minutes. We'll ask a few simple questions about your medical history." },
              { icon: Calendar, title: "2. Choose Provider", desc: "Browse profiles and select a doctor that fits your needs and schedule." },
              { icon: Heart, title: "3. Get Care", desc: "Connect via secure video. Get a diagnosis and prescriptions sent to your local pharmacy." }
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

      <section id="pricing" className="py-24 bg-card/30 border-y border-border">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">Transparent Pricing</h2>
            <p className="text-muted-foreground">No hidden fees. Insurance accepted but not required.</p>
          </div>
          <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            <div className="bg-background rounded-3xl p-8 border border-border flex flex-col hover:border-primary/30 transition-colors">
              <div className="text-lg font-medium text-muted-foreground mb-2">Single Visit</div>
              <div className="text-4xl font-bold text-foreground mb-6">$79</div>
              <ul className="space-y-4 mb-8 flex-1">
                <li className="flex items-start gap-3 text-muted-foreground text-sm">
                  <CheckCircle size={16} className="text-blue-500 mt-0.5 shrink-0" /> One-time urgent care consult
                </li>
                <li className="flex items-start gap-3 text-muted-foreground text-sm">
                  <CheckCircle size={16} className="text-blue-500 mt-0.5 shrink-0" /> Prescription sent to pharmacy
                </li>
              </ul>
              <Link href="/patient/register" className="w-full block text-center py-3 rounded-xl border border-border hover:bg-accent text-foreground transition-colors font-medium">
                Book One-Time
              </Link>
            </div>

            <div className="bg-gradient-to-b from-blue-900/20 to-background rounded-3xl p-8 border border-blue-500/30 flex flex-col relative overflow-hidden shadow-[0_0_40px_rgba(37,99,235,0.1)]">
              <div className="absolute top-0 right-0 bg-blue-600 text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl uppercase tracking-wider">Most Popular</div>
              <div className="text-lg font-medium text-blue-300 mb-2">Membership</div>
              <div className="text-4xl font-bold text-foreground mb-6">$19<span className="text-lg text-muted-foreground">/mo</span></div>
              <ul className="space-y-4 mb-8 flex-1">
                <li className="flex items-start gap-3 text-muted-foreground text-sm">
                  <CheckCircle size={16} className="text-blue-500 mt-0.5 shrink-0" /> $49 per visit (save $30)
                </li>
                <li className="flex items-start gap-3 text-muted-foreground text-sm">
                  <CheckCircle size={16} className="text-blue-500 mt-0.5 shrink-0" /> 24/7 messaging with care team
                </li>
                <li className="flex items-start gap-3 text-muted-foreground text-sm">
                  <CheckCircle size={16} className="text-blue-500 mt-0.5 shrink-0" /> Annual preventative check-in
                </li>
              </ul>
              <Link href="/patient/register?plan=gold" className="w-full block text-center py-3 rounded-xl bg-blue-600 hover:bg-blue-500 transition-colors text-white font-bold shadow-lg shadow-blue-900/30">
                Start Membership
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 px-6 bg-gradient-to-r from-blue-600 to-indigo-700">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-4xl font-bold text-white mb-6">Ready to transform your healthcare?</h2>
          <p className="text-xl text-blue-100/90 mb-10 max-w-2xl mx-auto">
            Join thousands of patients who have discovered a better way to access care.
          </p>
          <Link href="/patient/register">
            <Button size="lg" className="bg-white text-blue-700 hover:bg-blue-50 h-14 px-10 text-lg shadow-lg">
              Start Your Free Account
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
          </Link>
        </div>
      </section>

      <footer className="py-10 px-6 bg-card border-t border-border">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="rounded-xl bg-slate-950/95 px-3 py-2 shadow-[0_0_20px_rgba(34,211,238,0.18)] border border-slate-800">
                <DoctaRxLogo className="h-7 w-auto" />
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-6 text-sm text-muted-foreground justify-center">
              <a href="mailto:info@doctarx.com" className="hover:text-foreground transition-colors">info@doctarx.com</a>
              <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
              <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
              <Link href="/hipaa" className="hover:text-foreground transition-colors">HIPAA</Link>
              <Link href="/contact" className="hover:text-foreground transition-colors">Contact</Link>
            </div>

            <p className="text-sm text-muted-foreground">© 2026 DoctaRx. All rights reserved.</p>
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
