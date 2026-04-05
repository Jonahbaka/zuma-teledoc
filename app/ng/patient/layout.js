'use client';

import NigeriaPortalShell from '@/components/ng/NigeriaPortalShell';
import { nigeriaPatientNavigation } from '@/components/ng/portalNavigation';

export default function NigeriaPatientLayout({ children }) {
  return (
    <NigeriaPortalShell
      navigation={nigeriaPatientNavigation}
      allowedRoles={['patient']}
      loginPath="/ng/auth/login"
      portalName="Patient"
      portalColor="from-emerald-600 to-teal-700"
      portalHomeHref="/ng/patient"
    >
      {children}
    </NigeriaPortalShell>
  );
}
