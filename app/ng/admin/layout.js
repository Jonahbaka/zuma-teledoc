'use client';

import NigeriaPortalShell from '@/components/ng/NigeriaPortalShell';
import { nigeriaAdminNavigation } from '@/components/ng/portalNavigation';

export default function NigeriaAdminLayout({ children }) {
  return (
    <NigeriaPortalShell
      navigation={nigeriaAdminNavigation}
      allowedRoles={['admin', 'super_admin']}
      loginPath="/secure/admin"
      portalName="Admin"
      portalColor="from-emerald-600 to-teal-700"
      portalHomeHref="/ng/admin"
    >
      {children}
    </NigeriaPortalShell>
  );
}
