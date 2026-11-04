'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { 
  LayoutDashboard, Users, UserCheck, BarChart3, DollarSign, 
  Shield, FileText, Bell, Settings, Database, MessageSquare,
  Mail, Megaphone, Link2, UserPlus, Zap, FolderCog, Wallet,
  Bot, Brain, Radio, Contact, Target, Globe, Landmark, Briefcase,
  Code2
} from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import DashboardLayout from '@/components/layouts/DashboardLayout';
import api from '@/lib/api';

// Flat navigation for Dashboard link (always visible at top)
const navigation = [
  { name: 'Overview', href: '/admin/dashboard', icon: LayoutDashboard },
];

// Grouped navigation with collapsible sections
const navigationGroups = [
  {
    name: 'Accounts and access',
    icon: Users,
    items: [
      { name: 'Accounts', href: '/admin/users', icon: Users },
      { name: 'Access roles', href: '/admin/roles', icon: Shield, superAdminOnly: true },
      { name: 'Provider Approvals', href: '/admin/providers', icon: UserCheck },
      { name: 'Credentialing', href: '/admin/credentialing', icon: FileText },
      { name: 'Invitations', href: '/admin/invites', icon: UserPlus },
    ]
  },
  {
    name: 'Communications',
    icon: MessageSquare,
    items: [
      { name: 'Communications center', href: '/admin/command-center', icon: MessageSquare },
      { name: 'Inbox', href: '/admin/command-center/inbox', icon: Mail },
      { name: 'Email Campaigns', href: '/admin/campaigns', icon: Megaphone },
      { name: 'Messaging', href: '/admin/communications', icon: MessageSquare },
      { name: 'Notifications', href: '/admin/notifications', icon: Bell },
    ]
  },
  {
    name: 'Platform management',
    icon: FolderCog,
    items: [
      { name: 'Access links', href: '/admin/access-urls', icon: Link2 },
      { name: 'Test access', href: '/admin/testing-links', icon: Zap, superAdminOnly: true },
      { name: 'Settings', href: '/admin/settings', icon: Settings },
      { name: 'Audit logs', href: '/admin/audit-logs', icon: Shield },
    ]
  },
  {
    name: 'Finance and reporting',
    icon: Landmark,
    items: [
      { name: 'Treasury', href: '/admin/bank', icon: Landmark },
      { name: 'Revenue', href: '/admin/revenue', icon: DollarSign },
      { name: 'Analytics', href: '/admin/analytics', icon: BarChart3 },
      { name: 'Company overview', href: '/admin/pitch-deck', icon: Briefcase },
    ]
  },
  {
    name: 'Automation and operations',
    icon: Brain,
    items: [
      { name: 'Agent operations', href: '/admin/agent-ops', icon: Bot },
      { name: 'Agent communications', href: '/admin/agent-chat', icon: Radio },
      { name: 'Relationship management', href: '/admin/crm', icon: Contact },
      { name: 'Predictive analytics', href: '/admin/predictive', icon: Brain },
      { name: 'Automation workspace', href: '/admin/agent-ide', icon: Code2 },
      { name: 'Agent activity', href: '/admin/agent-social', icon: Globe },
    ]
  }
];

// Public routes that don't require authentication
const PUBLIC_ADMIN_ROUTES = ['/admin/pitch-deck'];

export default function AdminLayout({ children }) {
  const { user, loading, isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [inboxUnread, setInboxUnread] = useState(null);
  const [authCheckElapsed, setAuthCheckElapsed] = useState(false);
  const isPublicRoute = PUBLIC_ADMIN_ROUTES.includes(pathname);
  const normalizedRole = String(user?.role || '').trim().toLowerCase();
  const isAdminRole = ['admin', 'super_admin', 'administrator', 'superadmin', 'super-admin'].includes(normalizedRole);

  useEffect(() => {
    if (isPublicRoute) return;
    if (loading && typeof window !== 'undefined' && !window.localStorage.getItem('accessToken')) {
      window.location.replace('/secure/admin');
      return;
    }

    if (!loading && !isAuthenticated) {
      router.replace('/secure/admin');
    }

    if (!loading && isAuthenticated && !isAdminRole) {
      router.replace('/secure/admin');
    }
  }, [loading, isAuthenticated, isAdminRole, router, isPublicRoute]);

  useEffect(() => {
    if (isPublicRoute || !loading) {
      setAuthCheckElapsed(false);
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setAuthCheckElapsed(true);
      const token = window.localStorage.getItem('accessToken');
      if (!token) {
        window.location.replace('/secure/admin');
      }
    }, 4500);

    return () => window.clearTimeout(timeout);
  }, [isPublicRoute, loading]);

  // Fetch inbox unread count
  useEffect(() => {
    let active = true;
    setInboxUnread(null);
    if (!isAuthenticated || !isAdminRole || isPublicRoute) return;
    const fetchUnread = async () => {
      try {
        const { data } = await api.get('/inbox/unread-count');
        const raw = data?.data?.count;
        const count = Number(raw);
        if (!data?.success || (typeof raw !== 'number' && (typeof raw !== 'string' || !/^\d+$/.test(raw))) || !Number.isSafeInteger(count) || count < 0) throw new Error();
        if (active) setInboxUnread(count);
      } catch { if (active) setInboxUnread(null); }
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 30000); // every 30s
    return () => { active = false; clearInterval(interval); };
  }, [isAuthenticated, isAdminRole, isPublicRoute, user?.id]);

  // Inject unread badge into navigation groups
  const dynamicGroups = useMemo(() => {
    return navigationGroups.map(group => ({
      ...group,
      items: group.items.map(item => {
        if (item.href === '/admin/command-center/inbox' && inboxUnread > 0) {
          return { ...item, badge: inboxUnread > 99 ? '99+' : String(inboxUnread) };
        }
        return item;
      })
    }));
  }, [inboxUnread]);

  // Public routes render children directly — no auth, no dashboard shell
  if (isPublicRoute) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-900">
        <div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600" />
          <p className="text-base font-semibold">Checking administrator access...</p>
          <button
            type="button"
            onClick={() => window.location.assign('/secure/admin')}
            className="mt-5 inline-flex min-h-12 items-center justify-center rounded-lg bg-blue-700 px-4 py-2 text-base font-semibold text-white hover:bg-blue-800"
          >
            Continue to Admin Login
          </button>
          {authCheckElapsed && (
            <div className="mt-4 space-y-3">
              <p className="text-sm leading-6 text-slate-600">
                If this screen stays here, continue to the secure admin login.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !isAdminRole) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-900">
        <div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="text-lg font-semibold">Administrator sign-in required</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Sign in with an authorized admin account to access this page.
          </p>
          <button
            type="button"
            onClick={() => window.location.assign('/secure/admin')}
            className="mt-5 inline-flex min-h-12 items-center justify-center rounded-lg bg-blue-700 px-4 py-2 text-base font-semibold text-white hover:bg-blue-800"
          >
            Go to Admin Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <DashboardLayout
      navigation={navigation}
      navigationGroups={dynamicGroups}
      portalName="Administration"
      portalColor="from-blue-600 to-blue-800"
      portalHomeHref="/admin"
    >
      {children}
    </DashboardLayout>
  );
}
