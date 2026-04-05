'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import DashboardLayout from '@/components/layouts/DashboardLayout';
import {
  getProviderNavigation,
  getProviderPortalTheme,
} from '@/components/provider/providerNavigation';
import { getPortalBasePath } from '@/lib/portalPaths';

const LOGIN_PATHS = {
  US: '/provider/login',
  NG: '/ng/provider/login',
};

export default function ProviderPortalLayout({ children, market = 'US' }) {
  const { user, loading, isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const providerPrefix = market === 'NG' ? '/ng/provider' : '/provider';
  const theme = getProviderPortalTheme(market);

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push(LOGIN_PATHS[market] || LOGIN_PATHS.US);
      return;
    }

    if (!loading && isAuthenticated && user?.role !== 'provider') {
      router.push(getPortalBasePath({ pathname, user }));
    }
  }, [loading, isAuthenticated, user, router, market, pathname]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500" />
      </div>
    );
  }

  if (!isAuthenticated || user?.role !== 'provider') {
    return null;
  }

  return (
    <DashboardLayout
      navigation={getProviderNavigation(providerPrefix, market)}
      portalName="Provider"
      portalColor={theme.portalColor}
      portalHomeHref={providerPrefix}
    >
      {children}
    </DashboardLayout>
  );
}
