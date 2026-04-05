'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { 
  Stethoscope, Menu, X, Bell, Settings, LogOut, User,
  ChevronDown, Search, Moon, Sun, Plus, FileText, LinkIcon,
  UserPlus, ChevronRight, Copy, Check
} from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { LanguageToggle } from '@/components/ui/language-toggle';
import { notificationsAPI } from '@/lib/api';
import { cn } from '@/lib/utils';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';
import {
  getProviderInvitePatientPath,
  toProviderPortalPath,
} from '@/lib/providerPortal';
import { getPortalPath } from '@/lib/portalPaths';

const MOBILE_NAV_PRIORITIES = {
  Provider: ['Dashboard', 'Triage Queue', 'Schedule', 'Patients'],
  Patient: ['Dashboard', 'Appointments', 'AI Triage', 'Messages'],
  Admin: ['Dashboard', 'Users', 'Notifications', 'Analytics'],
  Pharmacy: ['Dashboard', 'Prescriptions', 'Orders', 'Settings'],
  default: ['Dashboard'],
};

function isActivePath(pathname, href) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function getMobileLabel(name) {
  const compactLabels = {
    'AI Triage': 'Triage',
    'Triage Queue': 'Queue',
    'Prescription Activity': 'Rx',
    'Health Records': 'Records',
    'Hospital Network': 'Network',
    'Visit Notes': 'Notes',
  };

  return compactLabels[name] || name;
}

function pickMobileNavigation(portalName, items) {
  const priorities = MOBILE_NAV_PRIORITIES[portalName] || MOBILE_NAV_PRIORITIES.default;
  const selected = [];
  const seen = new Set();

  priorities.forEach((label) => {
    const match = items.find((item) => item.name === label);
    if (match && !seen.has(match.href)) {
      selected.push(match);
      seen.add(match.href);
    }
  });

  items.forEach((item) => {
    if (selected.length >= 4 || seen.has(item.href)) return;
    selected.push(item);
    seen.add(item.href);
  });

  return selected.slice(0, 4);
}

export default function DashboardLayout({ 
  children, 
  navigation, 
  navigationGroups, // NEW: Support for grouped navigation
  portalName, 
  portalColor, 
  portalHomeHref,
  showQuickActions = false 
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [showSidebarEmail, setShowSidebarEmail] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState({});
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  // Initialize expanded groups based on current path
  useEffect(() => {
    if (navigationGroups) {
      const initialExpanded = {};
      navigationGroups.forEach(group => {
        const hasActiveItem = group.items.some(item => 
          pathname === item.href || pathname.startsWith(item.href + '/')
        );
        if (hasActiveItem) {
          initialExpanded[group.name] = true;
        }
      });
      setExpandedGroups(initialExpanded);
    }
  }, [navigationGroups, pathname]);

  useEffect(() => {
    const fetchUnreadCount = async () => {
      try {
        const response = await notificationsAPI.getUnreadCount();
        if (response.data.success) {
          setUnreadCount(response.data.unreadCount);
        }
      } catch (error) {
        // Silent fail
      }
    };

    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 60000);
    
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    await logout();
  };

  const handleCopyInviteLink = async () => {
    const baseUrl = window.location.origin;
    const invitePath = getProviderInvitePatientPath({ pathname, user });
    const inviteLink = `${baseUrl}${invitePath}${invitePath.includes('?') ? '&' : '?'}ref=${user?.id || 'provider'}`;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const toggleGroup = (groupName) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupName]: !prev[groupName]
    }));
  };

  const isProviderPortal = portalName === 'Provider';
  const isAdminPortal = portalName === 'Admin';
  const visibleNavigation = navigation
    ?.filter((item) => !item.superAdminOnly || user?.role === 'super_admin')
    ?.filter((item) => !item.hideFromRole || !item.hideFromRole.includes(user?.role)) || [];
  const groupedNavigation = navigationGroups
    ? navigationGroups.flatMap((group) =>
        group.items.filter((item) => {
          if (item.superAdminOnly && user?.role !== 'super_admin') return false;
          if (item.hideFromRole && item.hideFromRole.includes(user?.role)) return false;
          return true;
        })
      )
    : [];
  const allNavigationItems = [...visibleNavigation, ...groupedNavigation].filter(
    (item, index, items) => items.findIndex((candidate) => candidate.href === item.href) === index
  );
  const activeNavigationItem = allNavigationItems.find((item) => isActivePath(pathname, item.href)) || allNavigationItems[0];
  const mobileNavigation = pickMobileNavigation(portalName, allNavigationItems);
  const userInitials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}` || user?.email?.[0]?.toUpperCase() || 'U';
  const resolvedPortalHomeHref =
    portalHomeHref ||
    visibleNavigation[0]?.href ||
    allNavigationItems[0]?.href ||
    '/';

  useEffect(() => {
    setSidebarOpen(false);
    setUserMenuOpen(false);
    setQuickActionsOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return undefined;

    if (window.innerWidth >= 1024) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    if (sidebarOpen || userMenuOpen || quickActionsOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = previousOverflow;
    }

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [quickActionsOpen, sidebarOpen, userMenuOpen]);

  // Render navigation item
  const renderNavItem = (item, inGroup = false) => {
    // Check if item should be hidden based on role
    if (item.superAdminOnly && user?.role !== 'super_admin') {
      return null;
    }
    if (item.hideFromRole && item.hideFromRole.includes(user?.role)) {
      return null;
    }

    const isActive = isActivePath(pathname, item.href);
    
    return (
      <Link
        key={item.name}
        href={item.href}
        className={cn(
          'flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition-all active:scale-[0.98]',
          inGroup && 'ml-4 rounded-xl px-3 py-2.5',
          isActive 
            ? `bg-gradient-to-r ${portalColor} text-white shadow-lg` 
            : 'text-muted-foreground hover:bg-accent hover:text-foreground'
        )}
        onClick={() => setSidebarOpen(false)}
      >
        <item.icon className="w-5 h-5 flex-shrink-0" />
        <span className="truncate">{item.name}</span>
        {item.badge && (
          <span className="ml-auto bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">
            {item.badge}
          </span>
        )}
      </Link>
    );
  };

  // Render grouped navigation (for Admin)
  const renderGroupedNavigation = () => {
    if (!navigationGroups) return null;

    return (
      <div className="space-y-2">
        {navigationGroups.map((group) => {
          // Filter items based on role
          const visibleItems = group.items.filter(item => {
            if (item.superAdminOnly && user?.role !== 'super_admin') return false;
            if (item.hideFromRole && item.hideFromRole.includes(user?.role)) return false;
            return true;
          });

          if (visibleItems.length === 0) return null;

          const isExpanded = expandedGroups[group.name];
          const hasActiveItem = visibleItems.some(item => 
            pathname === item.href || pathname.startsWith(item.href + '/')
          );

          return (
            <div key={group.name} className="space-y-1">
              <button
                onClick={() => toggleGroup(group.name)}
                className={cn(
                  "w-full flex items-center justify-between rounded-xl px-4 py-3 text-sm font-semibold transition-all",
                  hasActiveItem 
                    ? "text-foreground bg-accent/50" 
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
                )}
              >
                <div className="flex items-center gap-2">
                  <group.icon className="w-4 h-4" />
                  <span>{group.name}</span>
                </div>
                <ChevronDown className={cn(
                  "w-4 h-4 transition-transform duration-200",
                  isExpanded && "rotate-180"
                )} />
              </button>
              
              <div className={cn(
                "overflow-hidden transition-all duration-200",
                isExpanded ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
              )}>
                <div className="space-y-1 py-1">
                  {visibleItems.map(item => renderNavItem(item, true))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const getPortalHref = (suffix) => {
    return getPortalPath(suffix, { pathname, user });
  };

  return (
    <div className="app-shell-root min-h-[100dvh] bg-background text-foreground">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 z-40 bg-slate-950/55 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        'app-safe-top fixed inset-y-0 left-0 z-50 flex h-full w-64 max-w-[86vw] flex-col border-r border-border/80 bg-card/92 shadow-2xl backdrop-blur-2xl transition-transform duration-300 lg:max-w-none lg:translate-x-0',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      )}>
        {/* Logo */}
        <div className="flex min-h-[4.75rem] items-center justify-between border-b border-border/70 px-4">
          <Link href={resolvedPortalHomeHref} className="flex items-center gap-2">
            <div>
              <span className="inline-flex rounded-xl bg-slate-950/95 px-3 py-2 shadow-[0_0_20px_rgba(34,211,238,0.18)] border border-slate-800">
                <DoctaRxLogo className="h-7 w-auto" />
              </span>
              <span className={cn(
                'block text-xs font-medium',
                'text-purple-600'
              )}>
                {portalName} Portal
              </span>
            </div>
          </Link>
          <button 
            className="lg:hidden text-muted-foreground hover:text-foreground"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-4 pb-6 pt-4" style={{ maxHeight: 'calc(100dvh - 220px)' }}>
          {/* Use grouped navigation if available, otherwise flat */}
          {navigationGroups ? (
            renderGroupedNavigation()
          ) : (
            visibleNavigation.map((item) => renderNavItem(item))
          )}
        </nav>

        {/* User info at bottom - Privacy Enhanced */}
        <div className="app-safe-bottom border-t border-border/70 bg-background/75 p-4 backdrop-blur-xl">
          <div 
            className="flex items-center gap-3 cursor-pointer group"
            onClick={() => setShowSidebarEmail(!showSidebarEmail)}
          >
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center border border-border shadow-md">
              <span className="text-white text-sm font-medium">
                {userInitials}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {user?.firstName} {user?.lastName}
              </p>
              {showSidebarEmail ? (
                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              ) : (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Settings className="w-3 h-3" />
                  <span>Tap to expand</span>
                </p>
              )}
            </div>
            <ChevronRight className={cn(
              "w-4 h-4 text-muted-foreground transition-transform",
              showSidebarEmail && "rotate-90"
            )} />
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="min-h-[100dvh] lg:pl-64">
        {/* Top header */}
        <header className="sticky top-0 z-30 border-b border-border/70 bg-background/88 backdrop-blur-2xl">
          <div className="flex min-h-[4.5rem] items-center justify-between gap-3 px-4 py-3 md:px-6 lg:min-h-20 lg:px-8 [padding-top:calc(0.75rem+env(safe-area-inset-top,0px))]">
            <div className="flex min-w-0 items-center gap-3">
            <button 
              className="rounded-2xl border border-border/70 bg-card/80 p-2.5 text-muted-foreground shadow-sm transition hover:text-foreground lg:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label={`Open ${portalName.toLowerCase()} navigation`}
            >
              <Menu className="w-6 h-6" />
            </button>

            <div className="min-w-0 lg:hidden">
              <div className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                {portalName} Portal
              </div>
              <div className="truncate text-sm font-semibold text-foreground sm:text-base">
                {activeNavigationItem?.name || portalName}
              </div>
            </div>
            
            {/* Search */}
            <div className="hidden md:flex items-center">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder={isAdminPortal ? "Search users, logs..." : "Search patients, notes, ICD-10..."}
                  className="w-[min(28rem,48vw)] rounded-2xl border border-border bg-muted/60 py-2.5 pl-10 pr-4 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>
          </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Quick Actions - Provider Only */}
            {isProviderPortal && (
              <div className="relative">
                <div className="hidden sm:flex items-center gap-2 mr-2">
                  <Link href={toProviderPortalPath('/patients?action=new', { pathname, user })}>
                    <Button 
                      size="sm" 
                      className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/25"
                    >
                      <UserPlus className="w-4 h-4 mr-1.5" />
                      New Patient
                    </Button>
                  </Link>
                  <Link href={toProviderPortalPath('/visits?action=new', { pathname, user })}>
                    <Button 
                      size="sm" 
                      variant="outline"
                      className="border-purple-500 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950"
                    >
                      <FileText className="w-4 h-4 mr-1.5" />
                      Quick Note
                    </Button>
                  </Link>
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={handleCopyInviteLink}
                    className="border-amber-500 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4 mr-1.5" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <LinkIcon className="w-4 h-4 mr-1.5" />
                        Invite Link
                      </>
                    )}
                  </Button>
                </div>

                {/* Mobile Quick Actions Dropdown */}
                <div className="sm:hidden">
                  <Button 
                    variant="outline" 
                    size="icon"
                    onClick={() => setQuickActionsOpen(!quickActionsOpen)}
                    className="border-purple-500 text-purple-600"
                  >
                    <Plus className="w-5 h-5" />
                  </Button>
                  
                  {quickActionsOpen && (
                    <>
                      <div 
                        className="fixed inset-0 z-40"
                        onClick={() => setQuickActionsOpen(false)}
                      />
                      <div className="absolute right-0 mt-2 w-48 bg-popover rounded-xl shadow-lg border border-border py-2 z-50">
                        <Link
                          href={toProviderPortalPath('/patients?action=new', { pathname, user })}
                          className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent"
                          onClick={() => setQuickActionsOpen(false)}
                        >
                          <UserPlus className="w-4 h-4 text-emerald-500" />
                          New Patient
                        </Link>
                        <Link
                          href={toProviderPortalPath('/visits?action=new', { pathname, user })}
                          className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent"
                          onClick={() => setQuickActionsOpen(false)}
                        >
                          <FileText className="w-4 h-4 text-purple-500" />
                          Quick Note
                        </Link>
                        <button
                          onClick={() => {
                            handleCopyInviteLink();
                            setQuickActionsOpen(false);
                          }}
                          className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent w-full"
                        >
                          <LinkIcon className="w-4 h-4 text-amber-500" />
                          Copy Invite Link
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            <LanguageToggle className="hidden xl:flex" />
            <ThemeToggle className="hidden sm:inline-flex" />
            
            {/* Notifications */}
            <Link href={getPortalHref('/notifications')}>
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center animate-pulse">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Button>
            </Link>

            {/* Settings */}
            <Link href={getPortalHref('/settings')} className="hidden sm:block">
              <Button variant="ghost" size="icon">
                <Settings className="w-5 h-5" />
              </Button>
            </Link>

            {/* User menu */}
            <div className="relative hidden sm:block">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-accent transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center">
                  <span className="text-white text-sm font-medium">
                    {userInitials}
                  </span>
                </div>
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              </button>

              {userMenuOpen && (
                <>
                  <div 
                    className="fixed inset-0 z-40"
                    onClick={() => setUserMenuOpen(false)}
                  />
                  <div className="absolute right-0 mt-2 w-56 bg-popover rounded-xl shadow-lg border border-border py-2 z-50">
                    <div className="px-4 py-2 border-b border-border">
                      <p className="font-medium text-foreground">
                        {user?.firstName} {user?.lastName}
                      </p>
                      <p className="text-sm text-muted-foreground">{user?.email}</p>
                    </div>
                    <Link
                      href={getPortalHref('/profile')}
                      className="flex items-center gap-3 px-4 py-2 text-sm text-foreground/90 hover:bg-accent"
                      onClick={() => setUserMenuOpen(false)}
                    >
                      <User className="w-4 h-4" />
                      Profile
                    </Link>
                    <Link
                      href={getPortalHref('/settings')}
                      className="flex items-center gap-3 px-4 py-2 text-sm text-foreground/90 hover:bg-accent"
                      onClick={() => setUserMenuOpen(false)}
                    >
                      <Settings className="w-4 h-4" />
                      Settings
                    </Link>
                    <div className="border-t border-border mt-2 pt-2">
                      <button
                        onClick={handleLogout}
                        className="flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/50 w-full"
                      >
                        <LogOut className="w-4 h-4" />
                        Sign out
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
          </div>
        </header>

        {/* Page content */}
        <main className="app-mobile-content-pad p-4 pt-5 lg:p-8 lg:pb-8">
          {children}
        </main>

        {mobileNavigation.length > 0 ? (
          <nav className="app-mobile-dock lg:hidden" aria-label={`${portalName} quick navigation`}>
            {mobileNavigation.map((item) => (
              <div key={item.href} className="app-mobile-dock__item">
                <Link
                  href={item.href}
                  className="app-mobile-dock__link"
                  data-active={isActivePath(pathname, item.href)}
                >
                  <span className="app-mobile-dock__icon">
                    <item.icon className="h-5 w-5" />
                  </span>
                  <span className="app-mobile-dock__label">{getMobileLabel(item.name)}</span>
                </Link>
              </div>
            ))}
            <div className="app-mobile-dock__item">
              <button
                type="button"
                className="app-mobile-dock__link"
                data-active={sidebarOpen}
                onClick={() => setSidebarOpen(true)}
                aria-label={`Open ${portalName.toLowerCase()} menu`}
              >
                <span className="app-mobile-dock__icon">
                  <Menu className="h-5 w-5" />
                </span>
                <span className="app-mobile-dock__label">Menu</span>
              </button>
            </div>
          </nav>
        ) : null}
      </div>
    </div>
  );
}
