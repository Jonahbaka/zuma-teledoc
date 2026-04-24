'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Mail } from 'lucide-react';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';
import { MARKET_HOME_DATA } from '@/components/marketing/marketHomeData';

const FOOTER_THEMES = {
  US: {
    border: 'via-cyan-500/50',
    badgeBorder: 'border-cyan-500/20',
  },
  NG: {
    border: 'via-emerald-500/50',
    badgeBorder: 'border-emerald-500/20',
  },
};

const FooterLink = ({ href, children }) => (
  <Link href={href} className="text-sm text-slate-300/90 transition-colors duration-200 hover:text-white">
    {children}
  </Link>
);

export default function SiteFooter() {
  const pathname = usePathname() || '/';
  const marketKey = pathname.startsWith('/ng') ? 'NG' : 'US';
  const footer = MARKET_HOME_DATA[marketKey].footer;
  const theme = FOOTER_THEMES[marketKey];
  const year = new Date().getFullYear();

  return (
    <footer className="relative overflow-hidden bg-slate-950 text-slate-200">
      <div className={`h-px w-full bg-gradient-to-r from-transparent ${theme.border} to-transparent`} />
      <div className="absolute inset-0 pointer-events-none opacity-[0.08]">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              marketKey === 'US'
                ? 'radial-gradient(circle at 2px 2px, rgba(34,211,238,0.35) 1px, transparent 0)'
                : 'radial-gradient(circle at 2px 2px, rgba(16,185,129,0.35) 1px, transparent 0)',
            backgroundSize: '44px 44px',
          }}
        />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 pb-10 pt-16 lg:px-8">
        <div className="mb-12 grid grid-cols-1 gap-10 md:grid-cols-2 lg:grid-cols-12 lg:gap-10">
          <div className="space-y-5 lg:col-span-4">
            <Link href={footer.homeHref} className="flex items-center space-x-3 group">
              <DoctaRxLogo className="h-9 w-auto" />
            </Link>

            <p className="max-w-sm text-sm leading-relaxed text-slate-400">{footer.description}</p>

            <a href={`mailto:${footer.email}`} className="inline-flex items-center gap-2 text-sm text-slate-200 transition-colors hover:text-white">
              <Mail className="h-4 w-4" />
              {footer.email}
            </a>

            <div className="flex gap-3 overflow-x-auto pb-1 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible sm:pb-0">
              {footer.badges.map((badge) => {
                const Icon = badge.icon;
                return (
                  <div
                    key={badge.label}
                    className={`inline-flex items-center gap-2 rounded-full border bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-100 ${theme.badgeBorder}`}
                  >
                    <Icon className="h-4 w-4" />
                    {badge.label}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="hidden lg:block lg:col-span-1" />

          <div className="grid gap-3 sm:grid-cols-2 lg:hidden">
            {footer.columns.map((column) => (
              <details key={column.title} className="group rounded-[1.25rem] border border-white/10 bg-white/[0.04] p-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-white">
                  {column.title}
                  <ChevronRight className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-90" />
                </summary>
                <ul className="mt-4 space-y-3">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <FooterLink href={link.href}>{link.label}</FooterLink>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>

          <div className="hidden grid-cols-2 gap-8 sm:grid-cols-4 lg:col-span-7 lg:grid">
            {footer.columns.map((column) => (
              <div key={column.title}>
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-white">{column.title}</h3>
                <ul className="space-y-3">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <FooterLink href={link.href}>{link.label}</FooterLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-8 md:flex-row">
          <p className="order-2 text-xs text-slate-400 md:order-1">
            &copy; {year} {footer.copyright}. All rights reserved.
          </p>

          <p className="order-1 text-center text-xs text-slate-400 md:order-2 md:text-right">
            Secure access across patient, provider, and pharmacy workflows.
          </p>
        </div>
      </div>
    </footer>
  );
}
