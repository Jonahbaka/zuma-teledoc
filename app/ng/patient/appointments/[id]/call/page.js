'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import PatientVideoCallPage from '@/app/(dashboard)/patient/appointments/[id]/call/page';

export default function NigeriaPatientVideoCallPage() {
  const { user, loading, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!isAuthenticated) {
      router.replace('/ng/auth/login');
      return;
    }

    if (user?.role !== 'patient') {
      if (user?.role === 'provider') {
        router.replace('/ng/provider/dashboard');
        return;
      }

      if (user?.role === 'admin' || user?.role === 'super_admin') {
        router.replace('/admin/dashboard');
        return;
      }

      router.replace('/ng/auth/login');
    }
  }, [isAuthenticated, loading, router, user]);

  if (loading || !isAuthenticated || user?.role !== 'patient') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-600">Loading call...</p>
        </div>
      </div>
    );
  }

  return <PatientVideoCallPage />;
}
