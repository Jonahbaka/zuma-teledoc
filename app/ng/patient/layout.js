'use client';

import { usePathname } from 'next/navigation';
import NigeriaPortalShell from '@/components/ng/NigeriaPortalShell';
import { nigeriaPatientNavigation } from '@/components/ng/portalNavigation';

export default function NigeriaPatientLayout({ children }) {
  const pathname = usePathname();

  if (pathname === '/ng/patient/login' || pathname === '/ng/patient/register') {
    return children;
  }

  return (
    <NigeriaPortalShell
      navigation={nigeriaPatientNavigation}
      allowedRoles={['patient']}
      loginPath="/ng/patient/login"
      portalName="Patient"
      portalColor="from-blue-600 to-blue-700"
      portalHomeHref="/ng/patient"
    >
      {children}
    </NigeriaPortalShell>
  );
}
