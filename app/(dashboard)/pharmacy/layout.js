'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Pill, Package, ClipboardList,
  Settings, LogOut, Menu, X, Bell, ChevronDown
} from 'lucide-react';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/pharmacy/dashboard', icon: LayoutDashboard },
  { label: 'Prescriptions', href: '/pharmacy/prescriptions', icon: ClipboardList },
  { label: 'Orders', href: '/pharmacy/orders', icon: Package },
  { label: 'Inventory', href: '/pharmacy/inventory', icon: Pill },
  { label: 'Settings', href: '/pharmacy/settings', icon: Settings },
];

export default function PharmacyLayout({ children }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background flex">
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
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-72 bg-card border-r border-border flex flex-col animate-in slide-in-from-left">
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
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Top bar */}
        <header className="h-16 border-b border-border bg-card/50 backdrop-blur-xl flex items-center justify-between px-6 sticky top-0 z-40">
          <div className="flex items-center gap-4">
            <button className="lg:hidden p-2 hover:bg-accent rounded-lg" onClick={() => setSidebarOpen(true)}>
              <Menu size={20} />
            </button>
            <h1 className="text-lg font-bold text-foreground hidden sm:block">Pharmacy Dashboard</h1>
          </div>
          <div className="flex items-center gap-3">
            <button className="relative p-2 hover:bg-accent rounded-lg">
              <Bell size={20} className="text-muted-foreground" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-purple-500 rounded-full" />
            </button>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent border border-border">
              <div className="w-8 h-8 bg-purple-500/10 rounded-full flex items-center justify-center">
                <Pill size={16} className="text-purple-500" />
              </div>
              <span className="text-sm font-medium text-foreground hidden sm:block">My Pharmacy</span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
