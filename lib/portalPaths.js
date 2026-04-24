import { toProviderPortalPath } from '@/lib/providerPortal';

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function isNigeriaPath(pathname = '') {
  return pathname.startsWith('/ng');
}

export function getPortalBasePath({ pathname = '', user } = {}) {
  const role = normalizeRole(user?.role);

  if (role === 'provider') {
    return toProviderPortalPath('', { pathname, user });
  }

  if (role === 'admin' || role === 'super_admin') {
    return isNigeriaPath(pathname) ? '/ng/admin' : '/admin';
  }

  if (role === 'pharmacy') {
    return isNigeriaPath(pathname) ? '/ng/pharmacy' : '/pharmacy';
  }

  if (role === 'patient') {
    return isNigeriaPath(pathname) ? '/ng/patient' : '/patient';
  }

  return isNigeriaPath(pathname) ? '/ng' : '/';
}

export function getPortalPath(suffix = '', options = {}) {
  const basePath = getPortalBasePath(options);

  if (!suffix || suffix === '/') {
    return basePath;
  }

  const normalizedSuffix = suffix.startsWith('/') ? suffix : `/${suffix}`;
  return `${basePath}${normalizedSuffix}`;
}
