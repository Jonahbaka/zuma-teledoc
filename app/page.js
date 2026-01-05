'use client';

import Link from 'next/link';
import { 
  Video, 
  Shield, 
  Calendar, 
  MessageSquare, 
  Heart, 
  CheckCircle2,
  ArrowRight,
  Stethoscope,
  Clock,
  Lock,
  Users
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';

export default function HomePage() {
  const featureColors = {
    purple: { bg: 'bg-purple-500/10 dark:bg-purple-500/20', icon: 'text-purple-600 dark:text-purple-400' },
    indigo: { bg: 'bg-indigo-500/10 dark:bg-indigo-500/20', icon: 'text-indigo-600 dark:text-indigo-400' },
    sky: { bg: 'bg-sky-500/10 dark:bg-sky-500/20', icon: 'text-sky-600 dark:text-sky-400' },
    rose: { bg: 'bg-rose-500/10 dark:bg-rose-500/20', icon: 'text-rose-600 dark:text-rose-400' },
    amber: { bg: 'bg-amber-500/10 dark:bg-amber-500/20', icon: 'text-amber-600 dark:text-amber-400' }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 dark:bg-slate-950/80 backdrop-blur-xl border-b border-border">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <div className="bg-gradient-to-br from-purple-600 to-indigo-700 h-10 w-10 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/20">
                <span className="text-white font-bold text-lg">D</span>
              </div>
              <span className="font-bold text-2xl tracking-tight">
                <span className="text-foreground">Docta</span>
                <span className="text-amber-500">.</span>
              </span>
            </Link>
            
            <div className="hidden md:flex items-center gap-8">
              <Link href="#features" className="text-muted-foreground hover:text-primary transition-colors font-medium">
                Features
              </Link>
              <Link href="#how-it-works" className="text-muted-foreground hover:text-primary transition-colors font-medium">
                How it Works
              </Link>
              <Link href="#pricing" className="text-muted-foreground hover:text-primary transition-colors font-medium">
                Pricing
              </Link>
            </div>
            
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <Link href="/login">
                <Button variant="ghost" className="hidden sm:inline-flex">
                  Sign In
                </Button>
              </Link>
              <Link href="/register">
                <Button className="bg-gradient-to-r from-purple-600 to-indigo-700 hover:from-purple-700 hover:to-indigo-800 text-white shadow-lg shadow-purple-500/20">
                  Get Started
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-6 bg-gradient-to-b from-background via-purple-50/30 to-background dark:from-slate-950 dark:via-purple-950/20 dark:to-slate-950">
        <div className="container mx-auto">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-card dark:bg-white/5 border border-border mb-8 animate-fade-in">
              <Shield className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-foreground">HIPAA Compliant & Secure</span>
            </div>
            
            <h1 className="text-5xl md:text-7xl font-bold mb-6 animate-slide-up font-serif text-foreground">
              Healthcare,{' '}
              <span className="bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">Reimagined</span>
            </h1>
            
            <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: '0.1s' }}>
              Connect with board-certified physicians from the comfort of your home. 
              Secure video consultations, instant messaging, and comprehensive care—all in one platform.
            </p>
            
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <Link href="/register">
                <Button size="lg" className="bg-gradient-to-r from-purple-600 to-indigo-700 hover:from-purple-700 hover:to-indigo-800 text-white h-14 px-8 text-lg shadow-lg shadow-purple-500/25">
                  Start Your Visit
                  <ArrowRight className="ml-2 w-5 h-5" />
                </Button>
              </Link>
              <Link href="/register?role=provider">
                <Button size="lg" variant="outline" className="h-14 px-8 text-lg border-2">
                  Join as Provider
                </Button>
              </Link>
            </div>
            
            <div className="mt-12 flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground animate-fade-in" style={{ animationDelay: '0.3s' }}>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-primary" />
                <span>No appointment needed</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-primary" />
                <span>Available 24/7</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-primary" />
                <span>Most insurance accepted</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 px-6 bg-card dark:bg-slate-900/50">
        <div className="container mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4 font-serif text-foreground">Everything You Need</h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              A complete telehealth solution designed for modern healthcare delivery
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              { icon: Video, title: 'HD Video Consultations', description: 'Crystal-clear video visits with your healthcare provider, anytime, anywhere.', color: 'purple' },
              { icon: Calendar, title: 'Easy Scheduling', description: 'Book appointments instantly with real-time availability and automated reminders.', color: 'indigo' },
              { icon: MessageSquare, title: 'Secure Messaging', description: 'End-to-end encrypted messaging for confidential communication with your care team.', color: 'sky' },
              { icon: Heart, title: 'Health Records', description: 'Access your complete medical history, lab results, and prescriptions in one place.', color: 'rose' },
              { icon: Shield, title: 'HIPAA Compliant', description: 'Bank-level security with full HIPAA compliance to protect your health information.', color: 'purple' },
              { icon: Clock, title: '24/7 Availability', description: 'Access healthcare whenever you need it, day or night, weekday or weekend.', color: 'amber' }
            ].map((feature, index) => (
              <div 
                key={index}
                className="group p-8 rounded-2xl bg-background dark:bg-slate-900 hover:bg-accent dark:hover:bg-slate-800 transition-all duration-300 border border-border hover:border-primary/30 hover:shadow-xl hover:shadow-purple-500/5"
              >
                <div className={`w-14 h-14 rounded-xl ${featureColors[feature.color]?.bg} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}>
                  <feature.icon className={`w-7 h-7 ${featureColors[feature.color]?.icon}`} />
                </div>
                <h3 className="text-xl font-semibold mb-3 text-foreground">{feature.title}</h3>
                <p className="text-muted-foreground">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section id="how-it-works" className="py-24 px-6 bg-gradient-to-br from-purple-50 via-indigo-50 to-purple-50 dark:from-slate-950 dark:via-purple-950/30 dark:to-slate-950">
        <div className="container mx-auto">
          <div className="text-center mb-20">
            <h2 className="text-5xl font-bold mb-6 font-serif text-foreground">How It Works</h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto font-medium">
              Get the care you need in three simple steps
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-12 max-w-6xl mx-auto">
            {[
              { step: '01', title: 'Create Your Account', description: 'Sign up in minutes with our secure registration. Your health information is always protected.', icon: '👤', gradient: 'from-purple-500 to-purple-600' },
              { step: '02', title: 'Book an Appointment', description: 'Choose your provider, select a convenient time, and describe your symptoms.', icon: '📅', gradient: 'from-indigo-500 to-indigo-600' },
              { step: '03', title: 'Start Your Visit', description: 'Connect via video call, receive your diagnosis, and get prescriptions if needed.', icon: '🎥', gradient: 'from-purple-500 to-indigo-600' }
            ].map((item, index) => (
              <div key={index} className="relative group">
                <div className="relative bg-card dark:bg-slate-900 rounded-3xl p-8 shadow-lg hover:shadow-2xl transition-all duration-300 border border-border hover:border-primary/30 transform hover:-translate-y-2">
                  <div className={`absolute -top-6 -left-6 w-20 h-20 rounded-2xl bg-gradient-to-br ${item.gradient} flex items-center justify-center shadow-xl border-4 border-background`}>
                    <span className="text-3xl font-bold text-white">{item.step}</span>
                  </div>
                  
                  <div className="text-6xl mb-6 text-center">{item.icon}</div>
                  
                  <div className="mt-4">
                    <h3 className="text-2xl font-bold mb-4 text-foreground">{item.title}</h3>
                    <p className="text-muted-foreground leading-relaxed text-base">{item.description}</p>
                  </div>
                  
                  <div className={`absolute bottom-0 left-0 right-0 h-2 bg-gradient-to-r ${item.gradient} rounded-b-3xl opacity-0 group-hover:opacity-100 transition-opacity`}></div>
                </div>
                
                {index < 2 && (
                  <div className="hidden md:block absolute top-1/2 -right-6 transform -translate-y-1/2 z-10">
                    <div className="flex items-center">
                      <div className="w-12 h-1 bg-gradient-to-r from-purple-400 to-indigo-400"></div>
                      <ArrowRight className="w-6 h-6 text-primary" />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          
          <div className="text-center mt-16">
            <Link href="/register">
              <Button size="lg" className="bg-gradient-to-r from-purple-600 to-indigo-700 hover:from-purple-700 hover:to-indigo-800 text-white h-14 px-10 text-lg shadow-lg shadow-purple-500/25 transition-all">
                Get Started Now
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 px-6 bg-card dark:bg-slate-900/50">
        <div className="container mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4 font-serif text-foreground">Simple, Transparent Pricing</h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Choose the plan that works best for you
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Basic Plan */}
            <div className="p-8 rounded-2xl border-2 border-border hover:border-primary/30 transition-colors bg-background dark:bg-slate-900">
              <h3 className="text-xl font-semibold mb-2 text-foreground">Basic</h3>
              <p className="text-muted-foreground mb-6">Pay per visit</p>
              <div className="text-4xl font-bold mb-6 text-foreground">$49<span className="text-lg text-muted-foreground">/visit</span></div>
              <ul className="space-y-4 mb-8">
                {['Video consultations', 'Secure messaging', 'Health records access', 'E-prescriptions'].map((feature, i) => (
                  <li key={i} className="flex items-center gap-3 text-foreground">
                    <CheckCircle2 className="w-5 h-5 text-primary" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Link href="/register">
                <Button variant="outline" className="w-full">Get Started</Button>
              </Link>
            </div>
            
            {/* Gold Plan */}
            <div className="p-8 rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-700 text-white relative overflow-hidden shadow-xl shadow-purple-500/20">
              <div className="absolute top-4 right-4 px-3 py-1 bg-white/20 rounded-full text-xs font-medium backdrop-blur">
                Most Popular
              </div>
              <h3 className="text-xl font-semibold mb-2">Docta Gold</h3>
              <p className="text-purple-100/90 mb-6">Unlimited care</p>
              <div className="text-4xl font-bold mb-6">$29.99<span className="text-lg text-purple-200">/month</span></div>
              <ul className="space-y-4 mb-8">
                {['Unlimited video visits', 'Priority scheduling', '24/7 provider access', 'Family plan available', 'Mental health support', 'Specialist referrals'].map((feature, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-purple-200" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Link href="/register?plan=gold">
                <Button className="w-full bg-white text-purple-700 hover:bg-purple-50">
                  Subscribe Now
                </Button>
              </Link>
            </div>
            
            {/* Enterprise Plan */}
            <div className="p-8 rounded-2xl border-2 border-border hover:border-primary/30 transition-colors bg-background dark:bg-slate-900">
              <h3 className="text-xl font-semibold mb-2 text-foreground">Enterprise</h3>
              <p className="text-muted-foreground mb-6">For organizations</p>
              <div className="text-4xl font-bold mb-6 text-foreground">Custom</div>
              <ul className="space-y-4 mb-8">
                {['Everything in Gold', 'Custom integrations', 'Dedicated support', 'Analytics dashboard', 'SAML SSO', 'White-label options'].map((feature, i) => (
                  <li key={i} className="flex items-center gap-3 text-foreground">
                    <CheckCircle2 className="w-5 h-5 text-primary" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Link href="/contact?type=enterprise">
                <Button variant="outline" className="w-full">Contact Sales</Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-6 bg-gradient-to-r from-purple-600 to-indigo-700">
        <div className="container mx-auto text-center">
          <h2 className="text-4xl font-bold text-white mb-6 font-serif">
            Ready to Transform Your Healthcare?
          </h2>
          <p className="text-xl text-purple-100/90 mb-10 max-w-2xl mx-auto">
            Join thousands of patients who've discovered a better way to access healthcare
          </p>
          <Link href="/register">
            <Button size="lg" className="bg-white text-purple-700 hover:bg-purple-50 h-14 px-10 text-lg shadow-lg">
              Start Your Free Account
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
