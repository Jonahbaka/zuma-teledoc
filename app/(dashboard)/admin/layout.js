'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  LayoutDashboard, Users, UserCheck, BarChart3, DollarSign, 
  Shield, FileText, Bell, Settings, Database, MessageSquare,
  Mail, Megaphone, Link2, UserPlus, Zap
} from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import DashboardLayout from '@/components/layouts/DashboardLayout';

const navigation = [
  { name: 'Dashboard', href: '/admin/dashboard', icon: LayoutDashboard },
  { name: 'Role Management', href: '/admin/roles', icon: Shield, superAdminOnly: true },
  { name: 'Users', href: '/admin/users', icon: Users },
  { name: 'Provider Approvals', href: '/admin/providers', icon: UserCheck },
  { name: 'Credentialing', href: '/admin/credentialing', icon: FileText },
  { name: 'Invitations', href: '/admin/invites', icon: UserPlus },
  { name: 'Access URLs', href: '/admin/access-urls', icon: Link2 },
  { name: 'Testing Links', href: '/admin/testing-links', icon: Zap },
  { name: 'Email Campaigns', href: '/admin/campaigns', icon: Megaphone },
  { name: 'Communications', href: '/admin/communications', icon: MessageSquare },
  { name: 'Analytics', href: '/admin/analytics', icon: BarChart3 },
  { name: 'Revenue', href: '/admin/revenue', icon: DollarSign },
  { name: 'Audit Logs', href: '/admin/audit-logs', icon: Shield },
  { name: 'Notifications', href: '/admin/notifications', icon: Bell },
  { name: 'Settings', href: '/admin/settings', icon: Settings },
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
      portalName="Admin"
      portalColor="from-purple-600 to-purple-800"
    >
      {children}
    </DashboardLayout>
  );
}

