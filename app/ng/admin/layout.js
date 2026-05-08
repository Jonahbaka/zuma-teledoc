'use client';

import { usePathname } from 'next/navigation';
import NigeriaPortalShell from '@/components/ng/NigeriaPortalShell';
import { nigeriaAdminNavigation } from '@/components/ng/portalNavigation';

export default function NigeriaAdminLayout({ children }) {
  const pathname = usePathname();

  if (pathname === '/ng/admin/login') {
    return children;
  }

  return (
    <NigeriaPortalShell
      navigation={nigeriaAdminNavigation}
      allowedRoles={['admin', 'super_admin']}
      loginPath="/ng/admin/login"
      portalName="Admin"
      portalColor="from-emerald-600 to-teal-700"
      portalHomeHref="/ng/admin"
    >
      {children}
    </NigeriaPortalShell>
  );
}
