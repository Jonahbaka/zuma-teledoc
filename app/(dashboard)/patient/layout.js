'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  LayoutDashboard, Calendar, FileText, MessageSquare, 
  CreditCard, User, Bell, Settings, Heart, Shield, BrainCircuit, MapPin, Pill, Video
} from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import DashboardLayout from '@/components/layouts/DashboardLayout';

const navigation = [
  { name: 'Dashboard', href: '/patient/dashboard', icon: LayoutDashboard },
  { name: 'Appointments', href: '/patient/appointments', icon: Calendar },
  { name: 'Instant Call', href: '/patient/call', icon: Video },
  { name: 'AI Triage', href: '/patient/triage', icon: BrainCircuit },
  { name: 'Prescription Activity', href: '/patient/prescriptions', icon: Pill },
  { name: 'Insurance Wallet', href: '/patient/wallet', icon: Shield },
  { name: 'My Pharmacies', href: '/patient/pharmacy', icon: MapPin },
  { name: 'Health Records', href: '/patient/records', icon: FileText },
  { name: 'Messages', href: '/patient/messages', icon: MessageSquare },
  { name: 'Notifications', href: '/patient/notifications', icon: Bell },
  { name: 'Billing', href: '/patient/billing', icon: CreditCard },
  { name: 'Profile', href: '/patient/profile', icon: User },
];

export default function PatientLayout({ children }) {
  const { user, loading, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/patient/login');
    }
    
    if (!loading && isAuthenticated && user?.role !== 'patient') {
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

  if (!isAuthenticated || user?.role !== 'patient') {
    return null;
  }

  return (
    <DashboardLayout 
      navigation={navigation}
      portalName="Patient"
      portalColor="from-purple-600 to-purple-800"
      portalHomeHref="/patient"
    >
      {children}
    </DashboardLayout>
  );
}

