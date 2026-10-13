'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';

const LINKS = [
  ['/careops', 'Care workspace'],
  ['/careops/government', 'Government data'],
  ['/careops/delivery', 'Reports and delivery'],
  ['/careops/partners', 'Funding and partners'],
];

export default function CareOpsShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { loading, isAuthenticated } = useAuth();
  const publicPage = pathname === '/careops/login';
  useEffect(() => {
    if (!loading && !isAuthenticated && !publicPage) router.replace('/careops/login');
  }, [loading, isAuthenticated, publicPage, router]);

  return <div className="careops min-h-screen bg-slate-50 text-base text-slate-950">
    <style jsx global>{`
      body:has(.careops) { margin: 0; }
      .careops { color-scheme: light; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --background: 210 40% 98%; --foreground: 222 47% 11%; --card: 0 0% 100%; --card-foreground: 222 47% 11%; --popover: 0 0% 100%; --popover-foreground: 222 47% 11%; --primary: 158 64% 24%; --primary-foreground: 0 0% 100%; --secondary: 210 40% 96%; --secondary-foreground: 222 47% 11%; --muted: 210 40% 96%; --muted-foreground: 215 16% 40%; --accent: 210 40% 96%; --accent-foreground: 222 47% 11%; --border: 214 32% 91%; --input: 214 32% 91%; --ring: 158 64% 24%; }
      .careops h1, .careops h2, .careops h3, .careops h4, .careops h5, .careops h6, .careops button, .careops input, .careops select, .careops textarea { font-family: inherit; }
      .careops .text-xs, .careops [class*="text-[11px]"] { font-size: 0.875rem; line-height: 1.4; }
      .careops p, .careops input:not([type=checkbox]), .careops select, .careops textarea { font-size: 1rem; }
      .careops button, .careops [role=tab] { min-height: 44px; }
      .careops a:focus-visible, .careops button:focus-visible, .careops input:focus-visible { outline: 3px solid #047857; outline-offset: 3px; }
    `}</style>
    <a href="#careops-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-white focus:p-3">Skip to workspace</a>
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1480px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <Link href="/careops" className="text-xl font-semibold tracking-tight">DoctaRx <span className="text-emerald-700">CareOps</span></Link>
        {!publicPage && isAuthenticated && <nav aria-label="CareOps workspaces" className="flex flex-wrap gap-2">
          {LINKS.map(([href, label]) => <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium ${pathname === href ? 'bg-emerald-50 text-emerald-800' : 'text-slate-600 hover:bg-slate-50'}`}>{label}</Link>)}
        </nav>}
      </div>
    </header>
    <div id="careops-content" tabIndex={-1}>
      {publicPage ? children : loading ? <p role="status" className="p-8">Loading your account…</p> : isAuthenticated ? children : null}
    </div>
  </div>;
}
