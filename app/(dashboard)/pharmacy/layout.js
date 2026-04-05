'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Pill, Package, ClipboardList,
  Settings, LogOut, Menu, X, Bell
} from 'lucide-react';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';
import { cn } from '@/lib/utils';
import { useAuth } from '@/components/providers/AuthProvider';

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/pharmacy/dashboard', icon: LayoutDashboard },
  { label: 'Prescriptions', href: '/pharmacy/prescriptions', icon: ClipboardList },
  { label: 'Orders', href: '/pharmacy/orders', icon: Package },
  { label: 'Inventory', href: '/pharmacy/inventory', icon: Pill },
  { label: 'Settings', href: '/pharmacy/settings', icon: Settings },
];

export default function PharmacyLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, isAuthenticated } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const activeItem = NAV_ITEMS.find((item) => pathname === item.href || pathname?.startsWith(item.href + '/')) || NAV_ITEMS[0];

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/pharmacy/login');
      return;
    }

    if (!loading && isAuthenticated && user?.role !== 'pharmacy') {
      if (user?.role === 'admin' || user?.role === 'super_admin') {
        router.push('/admin/dashboard');
        return;
      }

      router.push(`/${user?.role || 'patient'}/dashboard`);
    }
  }, [isAuthenticated, loading, router, user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500" />
      </div>
    );
  }

  if (!isAuthenticated || user?.role !== 'pharmacy') {
    return null;
  }

  return (
    <div className="app-shell-root flex min-h-[100dvh] overflow-x-clip bg-background">
      {/* Sidebar — desktop */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 bg-card border-r border-border">
        <div className="p-6 border-b border-border">
          <Link href="/pharmacy/dashboard" className="flex items-center gap-2">
            <span className="rounded-xl bg-slate-950/95 px-3 py-2 shadow-sm border border-slate-800">
              <DoctaRxLogo className="h-6 w-auto" />
            </span>
          </Link>
          <div className="mt-3 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-300 text-[10px] font-semibold border border-purple-500/20">
            <Pill size={10} /> Pharmacy Portal
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {NAV_ITEMS.map(item => (
            <Link key={item.href} href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors",
                pathname === item.href || pathname?.startsWith(item.href + '/')
                  ? "bg-purple-500/10 text-purple-600 dark:text-purple-300"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}>
              <item.icon size={18} />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-border">
          <Link href="/" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors">
            <LogOut size={18} />
            Sign Out
          </Link>
        </div>
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <div className="app-safe-top absolute bottom-0 left-0 top-0 flex w-72 max-w-[86vw] flex-col border-r border-border bg-card/95 backdrop-blur-2xl animate-in slide-in-from-left">
            <div className="p-6 border-b border-border flex items-center justify-between">
              <Link href="/pharmacy/dashboard">
                <span className="rounded-xl bg-slate-950/95 px-3 py-2 shadow-sm border border-slate-800">
                  <DoctaRxLogo className="h-6 w-auto" />
                </span>
              </Link>
              <button onClick={() => setSidebarOpen(false)} className="p-2 hover:bg-accent rounded-lg"><X size={20} /></button>
            </div>
            <nav className="flex-1 p-4 space-y-1">
              {NAV_ITEMS.map(item => (
                <Link key={item.href} href={item.href} onClick={() => setSidebarOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-colors",
                    pathname === item.href ? "bg-purple-500/10 text-purple-600 dark:text-purple-300" : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}>
                  <item.icon size={18} />
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex min-h-[100dvh] flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-40 border-b border-border/70 bg-background/88 backdrop-blur-2xl">
          <div className="flex min-h-[4.5rem] items-center justify-between gap-3 px-4 py-3 sm:px-6 [padding-top:calc(0.75rem+env(safe-area-inset-top,0px))]">
            <div className="flex min-w-0 items-center gap-3">
              <button
                className="lg:hidden rounded-2xl border border-border/70 bg-card/80 p-2.5 hover:bg-accent"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open pharmacy navigation"
              >
                <Menu size={20} />
              </button>
              <div className="min-w-0 lg:hidden">
                <div className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Pharmacy Portal
                </div>
                <div className="truncate text-sm font-semibold text-foreground sm:text-base">
                  {activeItem?.label || 'Dashboard'}
                </div>
              </div>
              <h1 className="hidden text-lg font-bold text-foreground lg:block">Pharmacy Dashboard</h1>
            </div>
            <div className="flex items-center gap-3">
              <button className="relative rounded-xl p-2 hover:bg-accent">
                <Bell size={20} className="text-muted-foreground" />
                <span className="absolute top-1 right-1 w-2 h-2 bg-purple-500 rounded-full" />
              </button>
              <div className="flex items-center gap-2 rounded-2xl border border-border bg-accent px-3 py-1.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-500/10">
                  <Pill size={16} className="text-purple-500" />
                </div>
                <span className="hidden text-sm font-medium text-foreground sm:block">My Pharmacy</span>
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="app-mobile-content-pad flex-1 overflow-auto p-4 pt-5 md:p-6 lg:p-8 lg:pb-8">
          {children}
        </main>

        <nav className="app-mobile-dock lg:hidden" aria-label="Pharmacy quick navigation">
          {NAV_ITEMS.slice(0, 4).map((item) => {
            const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');

            return (
              <div key={item.href} className="app-mobile-dock__item">
                <Link href={item.href} className="app-mobile-dock__link" data-active={isActive}>
                  <span className="app-mobile-dock__icon">
                    <item.icon size={18} />
                  </span>
                  <span className="app-mobile-dock__label">{item.label}</span>
                </Link>
              </div>
            );
          })}
          <div className="app-mobile-dock__item">
            <button
              type="button"
              className="app-mobile-dock__link"
              data-active={sidebarOpen}
              onClick={() => setSidebarOpen(true)}
              aria-label="Open pharmacy menu"
            >
              <span className="app-mobile-dock__icon">
                <Menu size={18} />
              </span>
              <span className="app-mobile-dock__label">Menu</span>
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}
