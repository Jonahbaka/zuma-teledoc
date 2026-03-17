'use client';

import Link from 'next/link';
import { ShieldCheck, Lock, KeyRound, ArrowRight, Mail, Pill } from 'lucide-react';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';

const FooterLink = ({ href, children }) => (
  <Link
    href={href}
    className="text-sm text-slate-300/90 hover:text-purple-200 transition-colors duration-200"
  >
    {children}
  </Link>
);

export default function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="relative bg-slate-950 text-slate-200 overflow-hidden">
      {/* Elegant top border */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-purple-500/50 to-transparent" />
      <div className="absolute inset-0 pointer-events-none opacity-[0.08]">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle at 2px 2px, rgba(168, 85, 247, 0.35) 1px, transparent 0)',
            backgroundSize: '44px 44px'
          }}
        />
      </div>

      <div className="max-w-7xl mx-auto px-6 lg:px-8 pt-16 pb-10 relative">
        {/* Top section */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-12 lg:gap-10 mb-14">
          {/* Brand */}
          <div className="lg:col-span-4 space-y-6">
            <Link href="/" className="flex items-center space-x-3 group">
              <DoctaRxLogo className="h-9 w-auto" />
            </Link>

            <p className="text-sm leading-relaxed text-slate-400 max-w-sm">
              Nigeria&apos;s modern telehealth platform. Consult doctors online, get prescriptions, and receive medications from pharmacies near you.
            </p>

            {/* Contact Email */}
            <a
              href="mailto:hello@doctarx.ng"
              className="inline-flex items-center gap-2 text-sm text-purple-300 hover:text-purple-200 transition-colors"
            >
              <Mail className="w-4 h-4" />
              hello@doctarx.ng
            </a>

            <div className="flex flex-wrap gap-3 pt-1">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-white/5 border border-white/10 text-purple-100">
                <ShieldCheck className="w-4 h-4 text-purple-300" />
                Secure
              </div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-white/5 border border-white/10 text-emerald-100">
                <Lock className="w-4 h-4 text-emerald-300" />
                Encrypted
              </div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-white/5 border border-white/10 text-indigo-100">
                <Pill className="w-4 h-4 text-indigo-300" />
                Pharmacy Network
              </div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r from-green-900/30 to-emerald-900/30 border border-green-500/20 text-green-100">
                <ShieldCheck className="w-4 h-4 text-green-400" />
                NemoClaw Sandbox
              </div>
            </div>
          </div>

          <div className="hidden lg:block lg:col-span-1" />

          {/* Links */}
          <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-4 gap-8">
            <div>
              <h3 className="text-white text-sm font-semibold uppercase tracking-wider mb-4">
                Patients
              </h3>
              <ul className="space-y-3">
                <li><FooterLink href="/patient/register">Book Consultation</FooterLink></li>
                <li><FooterLink href="/#how-it-works">How it Works</FooterLink></li>
                <li><FooterLink href="/#pricing">Pricing</FooterLink></li>
                <li><FooterLink href="/patient/login">Patient Login</FooterLink></li>
              </ul>
            </div>

            <div>
              <h3 className="text-white text-sm font-semibold uppercase tracking-wider mb-4">
                Providers
              </h3>
              <ul className="space-y-3">
                <li><FooterLink href="/provider/register">Join as Provider</FooterLink></li>
                <li><FooterLink href="/provider/login">Provider Login</FooterLink></li>
                <li><FooterLink href="/#features">Features</FooterLink></li>
              </ul>
            </div>

            <div>
              <h3 className="text-white text-sm font-semibold uppercase tracking-wider mb-4">
                Pharmacies
              </h3>
              <ul className="space-y-3">
                <li><FooterLink href="/pharmacy/register">Register Pharmacy</FooterLink></li>
                <li><FooterLink href="/pharmacy/login">Pharmacy Login</FooterLink></li>
                <li><FooterLink href="/#pharmacy">Learn More</FooterLink></li>
              </ul>
            </div>

            <div>
              <h3 className="text-white text-sm font-semibold uppercase tracking-wider mb-4">
                Legal
              </h3>
              <ul className="space-y-3">
                <li><FooterLink href="/privacy">Privacy Policy</FooterLink></li>
                <li><FooterLink href="/terms">Terms of Service</FooterLink></li>
                <li><FooterLink href="/contact">Contact Us</FooterLink></li>
                <li><FooterLink href="/faq">FAQs</FooterLink></li>
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-8 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-xs text-slate-400 order-2 md:order-1">
            &copy; {year} DoctaRx Nigeria. All rights reserved.
          </p>

          <div className="order-1 md:order-2 flex items-center gap-3 bg-white/5 px-3 py-1.5 rounded-full border border-white/10">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-xs font-semibold text-emerald-100/90 tracking-wide">
              System Operational
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
