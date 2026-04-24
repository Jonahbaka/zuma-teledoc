'use client';

import NigeriaPortalShell from '@/components/ng/NigeriaPortalShell';
import { nigeriaPharmacyNavigation } from '@/components/ng/portalNavigation';

export default function NigeriaPharmacyPortalShell({ children }) {
  return (
    <NigeriaPortalShell
      navigation={nigeriaPharmacyNavigation}
      allowedRoles={['pharmacy']}
      loginPath="/ng/pharmacy/login"
      portalName="Pharmacy"
      portalColor="from-emerald-600 to-teal-700"
      portalHomeHref="/ng/pharmacy/dashboard"
    >
      {children}
    </NigeriaPortalShell>
  );
}
