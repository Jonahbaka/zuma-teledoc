'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import DashboardLayout from '@/components/layouts/DashboardLayout';
import { toProviderPortalPath } from '@/lib/providerPortal';

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function getFallbackRouteForUser(user) {
  const role = normalizeRole(user?.role);

  if (role === 'provider') {
    return toProviderPortalPath('/dashboard', { pathname: '/ng/provider', user });
  }

  if (role === 'admin' || role === 'super_admin') {
    return '/ng/admin';
  }

  if (role === 'pharmacy') {
    return '/ng/pharmacy';
  }

  if (role === 'patient') {
    return '/ng/patient';
  }

  return '/ng';
}

export default function NigeriaPortalShell({
  children,
  navigation,
  allowedRoles,
  loginPath,
  portalName,
  portalColor,
  portalHomeHref,
}) {
  const { user, loading, isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const role = normalizeRole(user?.role);
  const allowedRoleSet = new Set((allowedRoles || []).map(normalizeRole));
  const isAllowed = allowedRoleSet.has(role);

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!isAuthenticated) {
      router.push(loginPath);
      return;
    }

    if (!isAllowed) {
      router.push(getFallbackRouteForUser(user, pathname));
    }
  }, [isAllowed, isAuthenticated, loading, loginPath, pathname, router, user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500" />
      </div>
    );
  }

  if (!isAuthenticated || !isAllowed) {
    return null;
  }

  return (
    <DashboardLayout
      navigation={navigation}
      portalName={portalName}
      portalColor={portalColor}
      portalHomeHref={portalHomeHref}
    >
      {children}
    </DashboardLayout>
  );
}
