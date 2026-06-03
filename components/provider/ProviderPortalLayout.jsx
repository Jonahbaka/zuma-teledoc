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
import { normalizeProviderMarket } from '@/lib/providerPortal';

const LOGIN_PATHS = {
  US: '/provider/login',
  NG: '/ng/provider/login',
};

export default function ProviderPortalLayout({ children, market = 'US' }) {
  const { user, loading, isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const normalizedPathname = pathname?.replace(/\/$/, '') || '';
  const providerPrefix = market === 'NG' ? '/ng/provider' : '/provider';
  const passwordChangePath = `${providerPrefix}/create-password`;
  const theme = getProviderPortalTheme(market);
  const userMarket = normalizeProviderMarket(
    user?.marketScope ||
      user?.market_scope ||
      user?.region ||
      user?.country ||
      user?.address?.country
  );
  const isProviderMarketMismatch =
    Boolean(isAuthenticated && user?.role === 'provider') &&
    ((userMarket && userMarket !== market) || (!userMarket && market === 'NG'));
  const providerMarketDashboard = userMarket === 'NG'
    ? '/ng/provider/dashboard'
    : '/provider/dashboard';
  const isPublicProviderPath =
    normalizedPathname === LOGIN_PATHS[market] ||
    normalizedPathname === `${providerPrefix}/register`;
  const isPasswordChangePath = normalizedPathname === passwordChangePath;

  useEffect(() => {
    if (isPublicProviderPath) {
      return;
    }

    if (!loading && !isAuthenticated) {
      router.push(LOGIN_PATHS[market] || LOGIN_PATHS.US);
      return;
    }

    if (!loading && isAuthenticated && user?.role !== 'provider') {
      router.push(getPortalBasePath({ pathname, user }));
      return;
    }

    if (!loading && isProviderMarketMismatch) {
      router.replace(providerMarketDashboard);
      return;
    }

    if (!loading && isAuthenticated && user?.role === 'provider') {
      if (user.mustChangePassword && !isPasswordChangePath) {
        router.replace(passwordChangePath);
        return;
      }

      if (!user.mustChangePassword && isPasswordChangePath) {
        router.replace(`${providerPrefix}/dashboard`);
      }
    }
  }, [
    loading,
    isAuthenticated,
    user,
    router,
    market,
    pathname,
    isPublicProviderPath,
    isPasswordChangePath,
    isProviderMarketMismatch,
    providerMarketDashboard,
    passwordChangePath,
    providerPrefix,
  ]);

  if (isPublicProviderPath) {
    return children;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500" />
      </div>
    );
  }

  if (!isAuthenticated || user?.role !== 'provider' || isProviderMarketMismatch) {
    return null;
  }

  if (isPasswordChangePath) {
    return children;
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
