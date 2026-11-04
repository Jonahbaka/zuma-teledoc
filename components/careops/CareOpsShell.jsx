'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';
import api, { phcAPI } from '@/lib/api';
import { careOpsLoginPath, careOpsPasswordPath, careOpsNavigation } from '@/lib/careopsProfile';

export default function CareOpsShell({ children }) {
  const pathname = usePathname() || '/careops';
  const router = useRouter();
  const { loading, isAuthenticated, user, logout } = useAuth();
  const [access, setAccess] = useState({ loading: true, links: [], error: '' });
  const publicPage = pathname === '/careops/login';
  const passwordPage = pathname === '/careops/create-password';
  useEffect(() => {
    if (loading || publicPage) return;
    if (!isAuthenticated) router.replace(careOpsLoginPath(pathname));
    else if (user?.mustChangePassword && !passwordPage) router.replace(careOpsPasswordPath(pathname));
  }, [loading, isAuthenticated, publicPage, passwordPage, pathname, router, user?.mustChangePassword]);
  useEffect(() => {
    const controller = new AbortController(); let cancelled = false;
    setAccess({ loading: true, links: [], error: '' });
    if (loading || !isAuthenticated || publicPage || passwordPage || user?.mustChangePassword) return () => controller.abort();
    const config = { signal: controller.signal };
    Promise.allSettled([
      phcAPI.getContexts(config),
      api.get('/ng/government-data/sources', config),
      api.get('/ng/public-health/reports', { ...config, params: { limit: 1 } }),
    ]).then(([contexts, government, reports]) => {
      if (cancelled) return;
      const links = careOpsNavigation(contexts.status === 'fulfilled' ? contexts.value.data.contexts : [], {
        government: government.status === 'fulfilled', reports: reports.status === 'fulfilled',
      });
      const unavailable = [contexts, government, reports].some(result => result.status === 'rejected' && ![401,403].includes(result.reason.response?.status));
      setAccess({ loading: false, links, error: unavailable ? 'Some workspace access could not be checked. Reload or contact your access administrator.' : '' });
      if (pathname === '/careops' && !links.some(link => link.href === pathname) && links.length) router.replace(links[0].href);
    });
    return () => { cancelled = true; controller.abort(); };
  }, [loading, isAuthenticated, publicPage, passwordPage, user?.id, user?.role, user?.marketScope, user?.mustChangePassword, pathname, router]);
  const allowed = publicPage || passwordPage || pathname !== '/careops' || access.links.some(link => link.href === pathname);
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
        {!publicPage && isAuthenticated && <div className="flex flex-wrap items-center gap-4">
          {!passwordPage && !user?.mustChangePassword && <nav aria-label="CareOps workspaces" className="flex flex-wrap gap-2">
            {access.links.map(({href,label})=><Link key={href} href={href} aria-current={pathname===href?'page':undefined} className={`inline-flex min-h-12 items-center rounded-xl px-4 text-base font-medium ${pathname===href?'bg-white/10 text-cyan-200 ring-1 ring-inset ring-white/15':'text-slate-200 hover:bg-white/5'}`}>{label}</Link>)}
          </nav>}
          <button onClick={logout} className="min-h-12 rounded-xl border border-white/30 px-4 font-medium hover:bg-white/10">Sign out</button>
        </div>}
      </div>
    </header>
    <div id="careops-content" tabIndex={-1}>
      {publicPage ? children : loading || !passwordPage && access.loading ? <p role="status" className="p-8">Checking your assigned workspace…</p> : !isAuthenticated ? null : user?.mustChangePassword && !passwordPage ? null : allowed ? children : <main className="mx-auto max-w-3xl px-5 py-10"><h1 className="text-3xl font-semibold">Workspace access</h1><p role={access.error?'alert':undefined} className="mt-5 leading-7">{access.error || 'Your account has no current assignment for this workspace. Choose an available workspace or contact your institution’s access administrator.'}</p><button className="mt-6 min-h-12 rounded-xl border border-slate-300 bg-white px-5 font-semibold" onClick={()=>window.location.reload()}>Check access again</button></main>}
    </div>
  </div>;
}
