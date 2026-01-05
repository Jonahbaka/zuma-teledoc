'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  LayoutDashboard, Calendar, Users, FileText, MessageSquare, 
  Clock, ClipboardList, Settings, User, Bell, Sparkles, Receipt, BrainCircuit, Video, Eye,
  Pill, ListOrdered
} from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import DashboardLayout from '@/components/layouts/DashboardLayout';

const navigation = [
  { name: 'Dashboard', href: '/provider/dashboard', icon: LayoutDashboard },
  { name: 'Triage Queue', href: '/provider/triage-queue', icon: ListOrdered },
  { name: 'E-Prescriptions', href: '/provider/prescriptions', icon: Pill },
  { name: 'Video Call (No Appointment)', href: '/provider/call', icon: Video },
  { name: 'Medical Imaging', href: '/provider/imaging', icon: Eye },
  { name: 'AI Triage Results', href: '/provider/triage', icon: BrainCircuit },
  { name: 'Schedule', href: '/provider/schedule', icon: Calendar },
  { name: 'Patients', href: '/provider/patients', icon: Users },
  { name: 'Visit Notes', href: '/provider/visits', icon: ClipboardList },
  { name: 'Claims', href: '/provider/claims', icon: Receipt },
  { name: 'Messages', href: '/provider/messages', icon: MessageSquare },
  { name: 'Notifications', href: '/provider/notifications', icon: Bell },
  { name: 'Profile', href: '/provider/profile', icon: User },
];

export default function ProviderLayout({ children }) {
  const { user, loading, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login');
    }
    
    if (!loading && isAuthenticated && user?.role !== 'provider') {
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

  if (!isAuthenticated || user?.role !== 'provider') {
    return null;
  }

  return (
    <DashboardLayout 
      navigation={navigation}
      portalName="Provider"
      portalColor="from-purple-600 to-purple-800"
    >
      {children}
    </DashboardLayout>
  );
}

