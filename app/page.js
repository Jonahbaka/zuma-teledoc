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

export default function HomePage() {
  return (
    <div className="min-h-screen gradient-bg">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 glass border-b">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <div className="bg-purple-900 h-10 w-10 rounded-full flex items-center justify-center mr-3 shadow-md relative">
                <span className="text-white font-bold italic">D</span>
                <div className="absolute bottom-1 right-1 w-2 h-2 bg-amber-400 rounded-full border border-purple-900"></div>
              </div>
              <span className="font-bold text-2xl text-purple-900 tracking-tight">Docta<span className="text-amber-500">.</span></span>
            </Link>
            
            <div className="hidden md:flex items-center gap-8">
              <Link href="#features" className="text-gray-600 hover:text-purple-600 transition-colors font-medium">
                Features
              </Link>
              <Link href="#how-it-works" className="text-gray-600 hover:text-purple-600 transition-colors font-medium">
                How it Works
              </Link>
              <Link href="#pricing" className="text-gray-600 hover:text-purple-600 transition-colors font-medium">
                Pricing
              </Link>
            </div>
            
            <div className="flex items-center gap-4">
              <Link href="/login">
                <Button variant="ghost" className="hidden sm:inline-flex">
                  Sign In
                </Button>
              </Link>
              <Link href="/register">
                <Button className="bg-gradient-to-r from-purple-600 to-purple-800 hover:from-purple-700 hover:to-purple-900 text-white shadow-md hover:shadow-lg">
                  Get Started
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-6">
        <div className="container mx-auto">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-yellow-100 text-purple-700 mb-8 animate-fade-in border border-yellow-200">
              <Shield className="w-4 h-4" />
              <span className="text-sm font-medium">HIPAA Compliant & Secure</span>
            </div>
            
            <h1 className="text-5xl md:text-7xl font-bold mb-6 animate-slide-up font-serif">
              Healthcare,{' '}
              <span className="gradient-text">Reimagined</span>
            </h1>
            
            <p className="text-xl text-gray-600 mb-10 max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: '0.1s' }}>
              Connect with board-certified physicians from the comfort of your home. 
              Secure video consultations, instant messaging, and comprehensive care—all in one platform.
            </p>
            
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <Link href="/register">
                <Button size="lg" className="bg-gradient-to-r from-purple-600 to-purple-800 hover:from-purple-700 hover:to-purple-900 text-white h-14 px-8 text-lg shadow-lg hover:shadow-xl">
                  Start Your Visit
                  <ArrowRight className="ml-2 w-5 h-5" />
                </Button>
              </Link>
              <Link href="/register?role=provider">
                <Button size="lg" variant="outline" className="h-14 px-8 text-lg border-2 border-purple-300 text-purple-700 hover:bg-purple-50">
                  Join as Provider
                </Button>
              </Link>
            </div>
            
            <div className="mt-12 flex items-center justify-center gap-8 text-sm text-gray-500 animate-fade-in" style={{ animationDelay: '0.3s' }}>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-purple-600" />
                <span>No appointment needed</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-purple-600" />
                <span>Available 24/7</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-purple-600" />
                <span>Most insurance accepted</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 px-6 bg-white">
        <div className="container mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4 font-serif">Everything You Need</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              A complete telehealth solution designed for modern healthcare delivery
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: Video,
                title: 'HD Video Consultations',
                description: 'Crystal-clear video visits with your healthcare provider, anytime, anywhere.',
                color: 'emerald'
              },
              {
                icon: Calendar,
                title: 'Easy Scheduling',
                description: 'Book appointments instantly with real-time availability and automated reminders.',
                color: 'teal'
              },
              {
                icon: MessageSquare,
                title: 'Secure Messaging',
                description: 'End-to-end encrypted messaging for confidential communication with your care team.',
                color: 'cyan'
              },
              {
                icon: Heart,
                title: 'Health Records',
                description: 'Access your complete medical history, lab results, and prescriptions in one place.',
                color: 'rose'
              },
              {
                icon: Shield,
                title: 'HIPAA Compliant',
                description: 'Bank-level security with full HIPAA compliance to protect your health information.',
                color: 'indigo'
              },
              {
                icon: Clock,
                title: '24/7 Availability',
                description: 'Access healthcare whenever you need it, day or night, weekday or weekend.',
                color: 'amber'
              }
            ].map((feature, index) => (
              <div 
                key={index}
                className="group p-8 rounded-2xl bg-gray-50 hover:bg-white hover:shadow-xl transition-all duration-300 border border-transparent hover:border-gray-100"
              >
                <div className={`w-14 h-14 rounded-xl bg-${feature.color}-100 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}>
                  <feature.icon className={`w-7 h-7 text-${feature.color}-600`} />
                </div>
                <h3 className="text-xl font-semibold mb-3">{feature.title}</h3>
                <p className="text-gray-600">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section id="how-it-works" className="py-24 px-6 bg-gradient-to-br from-yellow-50 via-purple-50 to-yellow-50">
        <div className="container mx-auto">
          <div className="text-center mb-20">
            <h2 className="text-5xl font-bold mb-6 font-serif text-purple-900">How It Works</h2>
            <p className="text-xl text-purple-700 max-w-2xl mx-auto font-medium">
              Get the care you need in three simple steps
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-12 max-w-6xl mx-auto">
            {[
              {
                step: '01',
                title: 'Create Your Account',
                description: 'Sign up in minutes with our secure registration. Your health information is always protected.',
                icon: '👤',
                bgColor: 'from-yellow-100 to-yellow-200',
                textColor: 'text-yellow-800',
                borderColor: 'border-yellow-300'
              },
              {
                step: '02',
                title: 'Book an Appointment',
                description: 'Choose your provider, select a convenient time, and describe your symptoms.',
                icon: '📅',
                bgColor: 'from-purple-100 to-purple-200',
                textColor: 'text-purple-800',
                borderColor: 'border-purple-300'
              },
              {
                step: '03',
                title: 'Start Your Visit',
                description: 'Connect via video call, receive your diagnosis, and get prescriptions if needed.',
                icon: '🎥',
                bgColor: 'from-yellow-100 to-purple-200',
                textColor: 'text-purple-800',
                borderColor: 'border-purple-300'
              }
            ].map((item, index) => (
              <div key={index} className="relative group">
                {/* Step Card */}
                <div className={`relative bg-white rounded-3xl p-8 shadow-lg hover:shadow-2xl transition-all duration-300 border-2 ${item.borderColor} transform hover:-translate-y-2`}>
                  {/* Step Number Background */}
                  <div className={`absolute -top-6 -left-6 w-20 h-20 rounded-2xl bg-gradient-to-br ${item.bgColor} flex items-center justify-center shadow-xl border-4 border-white`}>
                    <span className="text-3xl font-bold text-white">{item.step}</span>
                  </div>
                  
                  {/* Icon */}
                  <div className="text-6xl mb-6 text-center">{item.icon}</div>
                  
                  {/* Content */}
                  <div className="mt-4">
                    <h3 className={`text-2xl font-bold mb-4 ${item.textColor}`}>{item.title}</h3>
                    <p className="text-gray-600 leading-relaxed text-base">{item.description}</p>
                  </div>
                  
                  {/* Decorative Element */}
                  <div className={`absolute bottom-0 left-0 right-0 h-2 bg-gradient-to-r ${item.bgColor} rounded-b-3xl opacity-0 group-hover:opacity-100 transition-opacity`}></div>
                </div>
                
                {/* Connector Arrow (between steps) */}
                {index < 2 && (
                  <div className="hidden md:block absolute top-1/2 -right-6 transform -translate-y-1/2 z-10">
                    <div className="flex items-center">
                      <div className={`w-12 h-1 bg-gradient-to-r ${index === 0 ? 'from-yellow-300 to-purple-300' : 'from-purple-300 to-yellow-300'}`}></div>
                      <ArrowRight className={`w-6 h-6 ${index === 0 ? 'text-purple-400' : 'text-yellow-400'}`} />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          
          {/* Bottom CTA */}
          <div className="text-center mt-16">
            <Link href="/register">
              <Button size="lg" className="bg-gradient-to-r from-purple-600 to-purple-800 hover:from-purple-700 hover:to-purple-900 text-white h-14 px-10 text-lg shadow-lg hover:shadow-xl transition-all">
                Get Started Now
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 px-6 bg-white">
        <div className="container mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4 font-serif">Simple, Transparent Pricing</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Choose the plan that works best for you
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Free Plan */}
            <div className="p-8 rounded-2xl border-2 border-gray-200 hover:border-emerald-300 transition-colors">
              <h3 className="text-xl font-semibold mb-2">Basic</h3>
              <p className="text-gray-600 mb-6">Pay per visit</p>
              <div className="text-4xl font-bold mb-6">$49<span className="text-lg text-gray-500">/visit</span></div>
              <ul className="space-y-4 mb-8">
                {['Video consultations', 'Secure messaging', 'Health records access', 'E-prescriptions'].map((feature, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Link href="/register">
                <Button variant="outline" className="w-full">Get Started</Button>
              </Link>
            </div>
            
            {/* Gold Plan */}
            <div className="p-8 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white relative overflow-hidden">
              <div className="absolute top-4 right-4 px-3 py-1 bg-white/20 rounded-full text-xs font-medium">
                Most Popular
              </div>
              <h3 className="text-xl font-semibold mb-2">Docta Gold</h3>
              <p className="text-emerald-100 mb-6">Unlimited care</p>
              <div className="text-4xl font-bold mb-6">$29.99<span className="text-lg text-emerald-200">/month</span></div>
              <ul className="space-y-4 mb-8">
                {[
                  'Unlimited video visits',
                  'Priority scheduling',
                  '24/7 provider access',
                  'Family plan available',
                  'Mental health support',
                  'Specialist referrals'
                ].map((feature, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-200" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Link href="/register?plan=gold">
                <Button className="w-full bg-white text-emerald-600 hover:bg-emerald-50">
                  Subscribe Now
                </Button>
              </Link>
            </div>
            
            {/* Platinum Plan */}
            <div className="p-8 rounded-2xl border-2 border-gray-200 hover:border-emerald-300 transition-colors">
              <h3 className="text-xl font-semibold mb-2">Enterprise</h3>
              <p className="text-gray-600 mb-6">For organizations</p>
              <div className="text-4xl font-bold mb-6">Custom</div>
              <ul className="space-y-4 mb-8">
                {[
                  'Everything in Gold',
                  'Custom integrations',
                  'Dedicated support',
                  'Analytics dashboard',
                  'SAML SSO',
                  'White-label options'
                ].map((feature, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Button variant="outline" className="w-full">Contact Sales</Button>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-6 bg-gradient-to-r from-emerald-600 to-teal-600">
        <div className="container mx-auto text-center">
          <h2 className="text-4xl font-bold text-white mb-6 font-serif">
            Ready to Transform Your Healthcare?
          </h2>
          <p className="text-xl text-emerald-100 mb-10 max-w-2xl mx-auto">
            Join thousands of patients who've discovered a better way to access healthcare
          </p>
          <Link href="/register">
            <Button size="lg" className="bg-white text-emerald-600 hover:bg-emerald-50 h-14 px-10 text-lg">
              Start Your Free Account
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative py-20 px-6 bg-gradient-to-br from-slate-900 via-purple-900/30 to-slate-900 border-t border-purple-500/20 overflow-hidden">
        {/* Animated background pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: `radial-gradient(circle at 2px 2px, rgba(147, 51, 234, 0.3) 1px, transparent 0)`,
            backgroundSize: '40px 40px'
          }}></div>
        </div>
        
        <div className="container mx-auto relative z-10">
          <div className="grid md:grid-cols-4 gap-12 mb-16">
            {/* Brand Section */}
            <div className="md:col-span-1">
              <Link href="/" className="flex items-center gap-3 mb-6 group">
                <div className="bg-purple-900 h-14 w-14 rounded-full flex items-center justify-center shadow-lg shadow-purple-500/50 group-hover:shadow-purple-500/70 transition-all duration-300 group-hover:scale-105 relative">
                  <span className="text-white font-bold italic text-2xl">D</span>
                  <div className="absolute bottom-2 right-2 w-3 h-3 bg-amber-400 rounded-full border-2 border-purple-900"></div>
                </div>
                <span className="text-3xl font-bold text-white font-serif tracking-tight">
                  Docta<span className="text-yellow-400">.</span>
                </span>
              </Link>
              <p className="text-base text-gray-300 leading-relaxed mb-6 max-w-xs">
                Modern telehealth platform providing HIPAA-compliant virtual healthcare services with cutting-edge technology.
              </p>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-500/10 border border-purple-500/20">
                  <Lock className="w-4 h-4 text-purple-400" />
                  <span className="text-xs font-medium text-purple-300">HIPAA</span>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-500/10 border border-purple-500/20">
                  <Shield className="w-4 h-4 text-purple-400" />
                  <span className="text-xs font-medium text-purple-300">SSL</span>
                </div>
              </div>
            </div>
            
            {/* Platform Links */}
            <div>
              <h4 className="font-bold text-white mb-6 text-lg tracking-tight">Platform</h4>
              <ul className="space-y-4">
                <li>
                  <Link href="#features" className="text-gray-300 hover:text-purple-400 transition-all duration-200 flex items-center group text-base">
                    <span className="group-hover:translate-x-1 transition-transform inline-block">Features</span>
                  </Link>
                </li>
                <li>
                  <Link href="#pricing" className="text-gray-300 hover:text-purple-400 transition-all duration-200 flex items-center group text-base">
                    <span className="group-hover:translate-x-1 transition-transform inline-block">Pricing</span>
                  </Link>
                </li>
                <li>
                  <Link href="/register?role=provider" className="text-gray-300 hover:text-purple-400 transition-all duration-200 flex items-center group text-base">
                    <span className="group-hover:translate-x-1 transition-transform inline-block">For Providers</span>
                  </Link>
                </li>
                <li>
                  <Link href="/register" className="text-gray-300 hover:text-purple-400 transition-all duration-200 flex items-center group text-base">
                    <span className="group-hover:translate-x-1 transition-transform inline-block">Get Started</span>
                  </Link>
                </li>
              </ul>
            </div>
            
            {/* Resources Links */}
            <div>
              <h4 className="font-bold text-white mb-6 text-lg tracking-tight">Resources</h4>
              <ul className="space-y-4">
                <li>
                  <Link href="/help" className="text-gray-300 hover:text-purple-400 transition-all duration-200 flex items-center group text-base">
                    <span className="group-hover:translate-x-1 transition-transform inline-block">Help Center</span>
                  </Link>
                </li>
                <li>
                  <Link href="/blog" className="text-gray-300 hover:text-purple-400 transition-all duration-200 flex items-center group text-base">
                    <span className="group-hover:translate-x-1 transition-transform inline-block">Blog</span>
                  </Link>
                </li>
                <li>
                  <Link href="/faq" className="text-gray-300 hover:text-purple-400 transition-all duration-200 flex items-center group text-base">
                    <span className="group-hover:translate-x-1 transition-transform inline-block">FAQs</span>
                  </Link>
                </li>
                <li>
                  <Link href="/contact" className="text-gray-300 hover:text-purple-400 transition-all duration-200 flex items-center group text-base">
                    <span className="group-hover:translate-x-1 transition-transform inline-block">Contact Us</span>
                  </Link>
                </li>
              </ul>
            </div>
            
            {/* Legal Links */}
            <div>
              <h4 className="font-bold text-white mb-6 text-lg tracking-tight">Legal</h4>
              <ul className="space-y-4">
                <li>
                  <Link href="/privacy" className="text-gray-300 hover:text-purple-400 transition-all duration-200 flex items-center group text-base">
                    <span className="group-hover:translate-x-1 transition-transform inline-block">Privacy Policy</span>
                  </Link>
                </li>
                <li>
                  <Link href="/terms" className="text-gray-300 hover:text-purple-400 transition-all duration-200 flex items-center group text-base">
                    <span className="group-hover:translate-x-1 transition-transform inline-block">Terms of Service</span>
                  </Link>
                </li>
                <li>
                  <Link href="/hipaa" className="text-gray-300 hover:text-purple-400 transition-all duration-200 flex items-center group text-base">
                    <span className="group-hover:translate-x-1 transition-transform inline-block">HIPAA Notice</span>
                  </Link>
                </li>
                <li>
                  <Link href="/accessibility" className="text-gray-300 hover:text-purple-400 transition-all duration-200 flex items-center group text-base">
                    <span className="group-hover:translate-x-1 transition-transform inline-block">Accessibility</span>
                  </Link>
                </li>
              </ul>
            </div>
          </div>
          
          {/* Bottom Bar */}
          <div className="border-t border-purple-500/20 pt-8 flex flex-col md:flex-row justify-between items-center gap-6">
            <p className="text-sm text-gray-400 font-medium">
              © {new Date().getFullYear()} Docta. All rights reserved.
            </p>
            <div className="flex items-center gap-8">
              <div className="flex items-center gap-2 text-sm text-gray-300">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
                <span className="font-medium">System Operational</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-300">
                <Lock className="w-4 h-4 text-purple-400" />
                <span className="font-medium">End-to-End Encrypted</span>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

