'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, ChevronDown, LogOut, Menu, Settings, User, X } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { notificationsAPI } from '@/lib/api';
import { getPortalPath } from '@/lib/portalPaths';
import { cn } from '@/lib/utils';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';

const PRIORITIES = {
  Patient: ['Home', 'Get care', 'Visits', 'Messages'],
  Provider: ['Today', 'Appointments', 'Patients', 'Messages'],
  Admin: ['Dashboard', 'Users', 'Analytics'],
  Administration: ['Overview', 'Accounts', 'Providers', 'Analytics'],
  Pharmacy: ['Dashboard', 'Prescriptions', 'Orders'],
};

function activePath(pathname, href, home) {
  return pathname === href || (href !== home && pathname.startsWith(href + '/'));
}

function videoRoute(pathname = '') {
  return /^\/(?:ng\/)?(?:patient|provider)(?:\/appointments\/[^/]+)?\/call\/?$/.test(pathname);
}

export default function DashboardLayout({ children, navigation = [], navigationGroups, portalName = 'Patient', portalHomeHref }) {
  const pathname = usePathname() || '';
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(null);
  const drawer = useRef(null);
  const menuButton = useRef(null);
  const accountMenu = useRef(null);
  const immersive = videoRoute(pathname);
  const filter = (items) => items.filter((item) => (!item.superAdminOnly || user?.role === 'super_admin') && !item.hideFromRole?.includes(user?.role));
  const groups = navigationGroups?.map((group) => ({ ...group, items: filter(group.items) })).filter((group) => group.items.length);
  const topLevel = filter(navigation);
  const items = groups ? [...topLevel, ...groups.flatMap((group) => group.items)] : topLevel;
  const home = portalHomeHref || items[0]?.href || '/';
  const current = [...items].sort((a, b) => b.href.length - a.href.length).find((item) => activePath(pathname, item.href, home));
  const mobile = (PRIORITIES[portalName] || []).map((name) => items.find((item) => item.name === name)).filter(Boolean).slice(0, 3);
  const quickItems = mobile.length ? mobile : items.slice(0, 3);
  const portalPath = (suffix) => getPortalPath(suffix, { pathname, user });

  useEffect(() => { setSidebarOpen(false); setAccountOpen(false); }, [pathname]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await notificationsAPI.getUnreadCount();
        if (!cancelled) setUnreadCount(data.success ? data.unreadCount : null);
      } catch { if (!cancelled) setUnreadCount(null); }
    };
    if (user?.id) load();
    const timer = setInterval(() => { if (user?.id) load(); }, 60000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [user?.id]);
  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    drawer.current?.querySelector('button, a')?.focus();
    const handleKey = (event) => {
      if (event.key === 'Escape') { setSidebarOpen(false); return; }
      if (event.key !== 'Tab' || !drawer.current) return;
      const focusable = [...drawer.current.querySelectorAll('a, button')].filter((element) => element.getClientRects().length);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', handleKey);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [sidebarOpen]);
  useEffect(() => {
    if (!accountOpen) return undefined;
    const close = (event) => { if (!accountMenu.current?.contains(event.target)) setAccountOpen(false); };
    const escape = (event) => { if (event.key === 'Escape') { setAccountOpen(false); accountMenu.current?.querySelector('button')?.focus(); } };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [accountOpen]);

  const renderLink = (item) => <Link key={item.href} href={item.href} onClick={() => setSidebarOpen(false)}
    aria-current={activePath(pathname, item.href, home) ? 'page' : undefined}
    className={cn('flex min-h-12 items-center gap-3 rounded-xl px-4 py-3 font-medium transition-colors',
      activePath(pathname, item.href, home) ? 'bg-blue-50 text-blue-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950')}>
    <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" /><span>{item.name}</span>
  </Link>;

  return <div className="doctarx-portal clinical-readable min-h-[100dvh] bg-slate-50 text-slate-950">
    <a href="#portal-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:p-4">Skip to main content</a>
    {!immersive && <>
      {sidebarOpen && <div className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden" onClick={() => setSidebarOpen(false)} aria-hidden="true" />}
      <aside ref={drawer} aria-label={portalName + ' navigation'} role={sidebarOpen ? 'dialog' : undefined} aria-modal={sidebarOpen ? true : undefined}
        className={cn('fixed inset-y-0 left-0 z-50 flex w-72 max-w-[88vw] flex-col border-r border-slate-200 bg-white transition-transform lg:translate-x-0', sidebarOpen ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex min-h-24 items-center justify-between bg-[#101d36] px-6">
          <Link href={home} aria-label="DoctaRx home"><DoctaRxLogo glow={false} className="h-9 w-auto" /></Link>
          <button className="rounded-lg p-2 text-white lg:hidden" aria-label={'Close ' + portalName.toLowerCase() + ' navigation'} onClick={() => setSidebarOpen(false)}><X className="h-6 w-6" /></button>
        </div>
        <nav className="flex-1 overflow-y-auto p-4" aria-label={portalName + ' main navigation'}>
          {groups ? <><div className="mb-5 space-y-1">{topLevel.map(renderLink)}</div>{groups.map((group) => <section key={group.name} className="mb-5"><p className="mb-2 px-4 font-semibold text-slate-500">{group.name}</p><div className="space-y-1">{group.items.map(renderLink)}</div></section>)}</> : <div className="space-y-1">{items.map(renderLink)}</div>}
        </nav>
        <div className="space-y-3 border-t border-slate-200 p-5">
          <p className="break-words font-medium text-slate-900">{user?.firstName} {user?.lastName}</p>
          <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-slate-600 hover:bg-slate-50" onClick={() => logout()}><LogOut className="h-5 w-5" aria-hidden="true" />Sign out</button>
        </div>
      </aside>
    </>}
    <div className={cn('min-h-[100dvh] min-w-0', !immersive && 'lg:pl-72')}>
      {!immersive && <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="flex min-h-24 items-center justify-between gap-3 px-4 py-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button ref={menuButton} className="shrink-0 rounded-xl border border-slate-200 p-3 lg:hidden" aria-label={'Open ' + portalName.toLowerCase() + ' navigation'} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}><Menu className="h-6 w-6" /></button>
            <div className="min-w-0"><p className="font-medium text-slate-500">DoctaRx · {portalName === 'Provider' ? 'Clinical workspace' : portalName === 'Patient' ? 'Your care' : portalName + ' workspace'}</p><p className="font-semibold text-slate-950">{current?.name || portalName}</p></div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link href={portalPath('/notifications')} aria-label="Notifications" className="relative flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 hover:bg-slate-50"><Bell className="h-5 w-5" aria-hidden="true" />{unreadCount > 0 && <span className="absolute -right-1 -top-1 flex min-h-6 min-w-6 items-center justify-center rounded-full bg-blue-700 px-1 text-white">{unreadCount > 9 ? '9+' : unreadCount}</span>}</Link>
            <div ref={accountMenu} className="relative">
              <button onClick={() => setAccountOpen(!accountOpen)} aria-expanded={accountOpen} aria-controls="portal-account-menu" aria-label="Account menu" className="flex h-12 items-center gap-2 rounded-xl border border-slate-200 px-3"><User className="h-5 w-5" aria-hidden="true" /><span className="hidden sm:inline">Account</span><ChevronDown className="hidden h-4 w-4 sm:block" aria-hidden="true" /></button>
              {accountOpen && <div id="portal-account-menu" className="absolute right-0 mt-3 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                <Link href={portalPath('/profile')} className="flex items-center gap-3 rounded-lg p-3 hover:bg-slate-50"><User className="h-5 w-5" />Profile</Link>
                <Link href={portalPath('/settings')} className="flex items-center gap-3 rounded-lg p-3 hover:bg-slate-50"><Settings className="h-5 w-5" />Settings</Link>
                <button onClick={() => logout()} className="flex w-full items-center gap-3 rounded-lg p-3 text-left hover:bg-slate-50"><LogOut className="h-5 w-5" />Sign out</button>
              </div>}
            </div>
          </div>
        </div>
      </header>}
      <main id="portal-content" tabIndex={-1} className={immersive ? 'h-[100dvh] overflow-hidden p-0' : 'mx-auto max-w-[1560px] p-4 pb-28 sm:p-8 sm:pb-28 lg:pb-8'}>{children}</main>
      {!immersive && <nav aria-label={portalName + ' quick navigation'} className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
        {quickItems.map((item) => <Link key={item.href} href={item.href} aria-current={activePath(pathname, item.href, home) ? 'page' : undefined} className={cn('flex min-h-20 min-w-0 flex-col items-center justify-center gap-1 px-1 text-center', activePath(pathname, item.href, home) ? 'text-blue-800' : 'text-slate-600')}><item.icon className="h-5 w-5" aria-hidden="true" /><span>{item.name === 'Appointments' ? 'Visits' : item.name}</span></Link>)}
        <button aria-label={'Open ' + portalName.toLowerCase() + ' menu'} onClick={() => setSidebarOpen(true)} className="flex min-h-20 flex-col items-center justify-center gap-1 text-slate-600"><Menu className="h-5 w-5" aria-hidden="true" />Menu</button>
      </nav>}
    </div>
  </div>;
}
