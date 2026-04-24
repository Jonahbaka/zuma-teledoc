'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import PatientVideoCallPage from '@/app/(dashboard)/patient/appointments/[id]/call/page';
import { getPortalBasePath } from '@/lib/portalPaths';

export default function NigeriaPatientVideoCallPage() {
  const { user, loading, isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!isAuthenticated) {
      router.replace('/ng/auth/login');
      return;
    }

    if (user?.role !== 'patient') {
      router.replace(getPortalBasePath({ pathname, user }));
    }
  }, [isAuthenticated, loading, pathname, router, user]);

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
