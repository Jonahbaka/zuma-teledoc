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

// Flat navigation for Dashboard link (always visible at top)
const navigation = [
  { name: 'Dashboard', href: '/admin/dashboard', icon: LayoutDashboard },
];

// Grouped navigation with collapsible sections
const navigationGroups = [
  {
    name: 'User Management',
    icon: Users,
    items: [
      { name: 'Users', href: '/admin/users', icon: Users },
      { name: 'Role Management', href: '/admin/roles', icon: Shield, superAdminOnly: true },
      { name: 'Provider Approvals', href: '/admin/providers', icon: UserCheck },
      { name: 'Credentialing', href: '/admin/credentialing', icon: FileText },
      { name: 'Invitations', href: '/admin/invites', icon: UserPlus },
    ]
  },
  {
    name: 'Communications',
    icon: MessageSquare,
    items: [
      { name: 'Email Campaigns', href: '/admin/campaigns', icon: Megaphone },
      { name: 'Messaging', href: '/admin/communications', icon: MessageSquare },
      { name: 'Notifications', href: '/admin/notifications', icon: Bell },
    ]
  },
  {
    name: 'Platform Config',
    icon: FolderCog,
    items: [
      { name: 'Access URLs', href: '/admin/access-urls', icon: Link2 },
      { name: 'Testing Access', href: '/admin/testing-links', icon: Zap, superAdminOnly: true },
      { name: 'Settings', href: '/admin/settings', icon: Settings },
    ]
  },
  {
    name: 'Finance & Treasury',
    icon: Landmark,
    items: [
      { name: 'Corporate Treasury', href: '/admin/bank', icon: Landmark },
      { name: 'Revenue', href: '/admin/revenue', icon: DollarSign },
      { name: 'Analytics', href: '/admin/analytics', icon: BarChart3 },
      { name: 'Pitch Deck', href: '/admin/pitch-deck', icon: Briefcase },
      { name: 'Audit Logs', href: '/admin/audit-logs', icon: Shield },
    ]
  },
  {
    name: 'AI & Intelligence',
    icon: Brain,
    items: [
      { name: 'AI Agent Ops', href: '/admin/agent-ops', icon: Bot },
      { name: 'Agent Command Center', href: '/admin/agent-chat', icon: Radio },
      { name: 'AI CRM & Outreach', href: '/admin/crm', icon: Contact },
      { name: 'Predictive Engine', href: '/admin/predictive', icon: Brain },
      { name: 'Agent IDE', href: '/admin/agent-ide', icon: Code2 },
      { name: 'The Agora', href: '/admin/agent-social', icon: Globe },
    ]
  }
];

// Public routes that don't require authentication
const PUBLIC_ADMIN_ROUTES = ['/admin/pitch-deck'];

export default function AdminLayout({ children }) {
  const { user, loading, isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [inboxUnread, setInboxUnread] = useState(0);
  const [authCheckElapsed, setAuthCheckElapsed] = useState(false);
  const isPublicRoute = PUBLIC_ADMIN_ROUTES.includes(pathname);
  const normalizedRole = String(user?.role || '').trim().toLowerCase();
  const isAdminRole = ['admin', 'super_admin', 'administrator', 'superadmin', 'super-admin'].includes(normalizedRole);

  useEffect(() => {
    if (isPublicRoute) return;
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
    if (!isAuthenticated) return;
    const fetchUnread = async () => {
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
        if (!token) return;
        const res = await fetch('/api/inbox/unread-count', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success) setInboxUnread(data.data?.count || 0);
      } catch (e) { /* silent */ }
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 30000); // every 30s
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // Inject unread badge into navigation groups
  const dynamicGroups = useMemo(() => {
    return navigationGroups.map(group => ({
      ...group,
      items: group.items.map(item => {
        if (item.href === '/admin/crm' && inboxUnread > 0) {
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
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-purple-600" />
          <p className="text-base font-semibold">Checking administrator access...</p>
          {authCheckElapsed && (
            <div className="mt-4 space-y-3">
              <p className="text-sm leading-6 text-slate-600">
                If this screen stays here, continue to the secure admin login.
              </p>
              <button
                type="button"
                onClick={() => window.location.assign('/secure/admin')}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-purple-700 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-800"
              >
                Continue to Admin Login
              </button>
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
            className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-purple-700 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-800"
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
      portalName="Admin"
      portalColor="from-purple-600 to-purple-800"
      portalHomeHref="/admin"
    >
      {children}
    </DashboardLayout>
  );
}
