'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  LayoutDashboard, Users, UserCheck, BarChart3, DollarSign, 
  Shield, FileText, Bell, Settings, Database, MessageSquare,
  Mail, Megaphone, Link2, UserPlus, Zap, FolderCog, Wallet
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
      { name: 'System Diagnostics', href: '/admin/testing-links', icon: Zap, superAdminOnly: true },
      { name: 'Settings', href: '/admin/settings', icon: Settings },
    ]
  },
  {
    name: 'Finance & Analytics',
    icon: Wallet,
    items: [
      { name: 'Revenue', href: '/admin/revenue', icon: DollarSign },
      { name: 'Analytics', href: '/admin/analytics', icon: BarChart3 },
      { name: 'Audit Logs', href: '/admin/audit-logs', icon: Shield },
    ]
  }
];

export default function AdminLayout({ children }) {
  const { user, loading, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login');
    }
    
    if (!loading && isAuthenticated && user?.role !== 'admin' && user?.role !== 'super_admin') {
      router.push(`/${user?.role}/dashboard`);
    }
  }, [loading, isAuthenticated, user, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  if (!isAuthenticated || (user?.role !== 'admin' && user?.role !== 'super_admin')) {
    return null;
  }

  return (
    <DashboardLayout 
      navigation={navigation}
      navigationGroups={navigationGroups}
      portalName="Admin"
      portalColor="from-purple-600 to-purple-800"
    >
      {children}
    </DashboardLayout>
  );
}
