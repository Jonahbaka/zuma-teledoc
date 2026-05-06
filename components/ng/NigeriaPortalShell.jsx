'use client';

import { useEffect, useState } from 'react';
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
  const [authCheckElapsed, setAuthCheckElapsed] = useState(false);
  const role = normalizeRole(user?.role);
  const allowedRoleSet = new Set((allowedRoles || []).map(normalizeRole));
  const isAllowed = allowedRoleSet.has(role);

  useEffect(() => {
    setAuthCheckElapsed(false);
    if (!loading) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setAuthCheckElapsed(true);
      try {
        if (!window.localStorage.getItem('accessToken')) {
          router.replace(loginPath);
        }
      } catch {
        router.replace(loginPath);
      }
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [loading, loginPath, router]);

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
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-center">
        <div className="max-w-sm rounded-2xl border border-emerald-100 bg-white p-6 shadow-sm">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-b-2 border-emerald-500" />
          <p className="mt-4 text-base font-semibold text-slate-900">Checking secure access...</p>
          {authCheckElapsed ? (
            <>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                This is taking longer than expected. If you are not signed in, continue to the Nigeria {portalName?.toLowerCase()} login.
              </p>
              <button
                type="button"
                onClick={() => router.replace(loginPath)}
                className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-emerald-700 px-5 text-sm font-semibold text-white hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
              >
                Continue to login
              </button>
            </>
          ) : null}
        </div>
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
