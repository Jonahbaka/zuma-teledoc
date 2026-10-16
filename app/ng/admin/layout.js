'use client';

import { usePathname } from 'next/navigation';
import NigeriaPortalShell from '@/components/ng/NigeriaPortalShell';
import { nigeriaAdminNavigation } from '@/components/ng/portalNavigation';

const navigationLabels = {
  '/ng/admin': 'Overview',
  '/ng/admin/consultations': 'Consultation oversight',
  '/ng/admin/organizations': 'Organizations',
  '/ng/admin/public-health-programme': 'Public health programs',
  '/ng/government-data': 'Government reporting',
  '/ng/admin/features': 'Feature management',
};
const administrationNavigation = nigeriaAdminNavigation.map(item => ({
  ...item,
  name: navigationLabels[item.href] || item.name,
}));

export default function NigeriaAdminLayout({ children }) {
  const pathname = usePathname();

  if (pathname === '/ng/admin/login') {
    return children;
  }

  return (
    <NigeriaPortalShell
      navigation={administrationNavigation}
      allowedRoles={['admin', 'super_admin']}
      loginPath="/ng/admin/login"
      portalName="Administration"
      portalColor="from-blue-600 to-blue-700"
      portalHomeHref="/ng/admin"
    >
      {children}
    </NigeriaPortalShell>
  );
}
