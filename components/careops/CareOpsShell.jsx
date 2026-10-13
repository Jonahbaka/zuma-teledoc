'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';
import { Activity, BarChart3, Building2, ShieldCheck } from 'lucide-react';
import { phcAPI } from '@/lib/api';

const LINKS = [
  ['/careops', 'Clinical care', Activity],
  ['/careops/government', 'Public health', Building2],
  ['/careops/delivery', 'Reports', BarChart3],
];

export default function CareOpsShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { loading, isAuthenticated, user } = useAuth();
  const [insuranceAccess, setInsuranceAccess] = useState(false);
  const publicPage = pathname === '/careops/login';
  useEffect(() => {
    if (!loading && !isAuthenticated && !publicPage) router.replace('/careops/login');
  }, [loading, isAuthenticated, publicPage, router]);
  useEffect(() => {
    let cancelled = false;
    setInsuranceAccess(false);
    if (!isAuthenticated || publicPage) return undefined;
    phcAPI.getContexts().then(({ data }) => {
      if (!cancelled) setInsuranceAccess((data.contexts || []).some((context) => ['programme_admin', 'facility_admin'].includes(context.programme_role)));
    }).catch(() => { /* Hide administration until access can be established. */ });
    return () => { cancelled = true; };
  }, [isAuthenticated, publicPage, user?.id]);

  return <div className="careops min-h-screen bg-slate-50 text-base text-slate-950">
    <style jsx global>{`
      body:has(.careops) { margin: 0; }
      .careops { color-scheme: light; font-family: 'DM Sans', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --background: 216 45% 98%; --foreground: 222 47% 11%; --card: 0 0% 100%; --card-foreground: 222 47% 11%; --popover: 0 0% 100%; --popover-foreground: 222 47% 11%; --primary: 217 91% 52%; --primary-foreground: 0 0% 100%; --secondary: 214 60% 96%; --secondary-foreground: 222 47% 11%; --muted: 214 45% 96%; --muted-foreground: 215 20% 35%; --accent: 214 60% 96%; --accent-foreground: 222 47% 11%; --border: 214 32% 89%; --input: 214 32% 85%; --ring: 217 91% 52%; }
      .careops h1, .careops h2, .careops h3, .careops h4, .careops h5, .careops h6, .careops button, .careops input, .careops select, .careops textarea { font-family: inherit; }
      .careops .text-xs, .careops .text-sm, .careops [class*="text-[11px]"], .careops p, .careops label, .careops input:not([type=checkbox]), .careops select, .careops textarea { font-size: 1rem; line-height: 1.5; }
      .careops h1, .careops h2, .careops h3 { letter-spacing: -0.035em; }
      .careops button, .careops input:not([type=checkbox]), .careops select, .careops [role=tab] { min-height: 48px; }
      .careops a:focus-visible, .careops button:focus-visible, .careops input:focus-visible { outline: 3px solid #2563eb; outline-offset: 3px; }
      .careops .bg-emerald-700 { background-color: #2563eb; }
      .careops .text-emerald-700, .careops .text-emerald-600 { color: #1d4ed8; }
      .careops .bg-emerald-800 { background-color: #0f2346; }
    `}</style>
    <a href="#careops-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-white focus:p-3">Skip to workspace</a>
    <header className="border-b border-white/10 bg-[#101d36] text-white shadow-[0_6px_28px_rgba(15,35,70,0.12)]">
      <div className="mx-auto flex max-w-[1480px] flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <Link href="/careops" className="flex items-center gap-4" aria-label="DoctaRx CareOps home"><DoctaRxLogo glow={false} className="h-10" /><span className="border-l border-white/20 pl-4 text-base font-medium text-slate-200">CareOps</span></Link>
        {!publicPage && isAuthenticated && <nav aria-label="CareOps workspaces" className="flex flex-wrap gap-2">
          {[...LINKS, ...(insuranceAccess ? [['/careops/insurance', 'Insurance', ShieldCheck]] : [])].map(([href, label, Icon]) => <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined}
            className={`inline-flex min-h-12 items-center gap-2 rounded-xl px-3 text-base font-medium ${pathname === href ? 'bg-white/10 text-cyan-200 ring-1 ring-inset ring-white/15' : 'text-slate-200 hover:bg-white/5'}`}><Icon className="hidden h-5 w-5 sm:block" aria-hidden="true" />{label}</Link>)}
        </nav>}
      </div>
    </header>
    <div id="careops-content" tabIndex={-1}>
      {publicPage ? children : loading ? <p role="status" className="p-8">Loading your account…</p> : isAuthenticated ? children : null}
    </div>
  </div>;
}
