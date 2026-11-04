export const CAREOPS_PROFILE = process.env.NEXT_PUBLIC_DOCTARX_PRODUCT_PROFILE === 'careops';
const WORKSPACES = new Set(['/careops', '/careops/government', '/careops/delivery', '/careops/insurance']);

export function isCareOpsSurface(pathname = '') {
  return CAREOPS_PROFILE || pathname === '/careops' || pathname.startsWith('/careops/');
}

export function careOpsReturnPath(value, fallback = '/careops') {
  if (typeof value !== 'string' || value.length > 2048 || /[\\\u0000-\u001f\u007f]/.test(value) || !value.startsWith('/careops')) return fallback;
  try {
    const parsed = new URL(value, 'https://careops.invalid');
    const path = decodeURIComponent(parsed.pathname).replace(/\/$/, '');
    if (parsed.origin !== 'https://careops.invalid' || !WORKSPACES.has(path)) return fallback;
    return path + parsed.search;
  } catch { return fallback; }
}

export function careOpsLoginPath(returnTo = '/careops', expired = false) {
  const query = new URLSearchParams({ returnTo: careOpsReturnPath(returnTo) });
  if (expired) query.set('session', 'expired');
  return '/careops/login?' + query;
}

export function careOpsPasswordPath(returnTo = '/careops') {
  return '/careops/create-password?' + new URLSearchParams({ returnTo: careOpsReturnPath(returnTo) });
}

export function careOpsNavigation(contexts, { government = false, reports = false } = {}) {
  const roles = new Set((Array.isArray(contexts) ? contexts : []).map(context => context.programme_role));
  const clinical = ['phc_nurse', 'remote_clinician', 'clinical_supervisor', 'on_call_clinician', 'referral_coordinator'].some(role => roles.has(role));
  return [
    ...(clinical ? [{ href: '/careops', label: 'Clinical care' }] : []),
    ...(government ? [{ href: '/careops/government', label: 'Public health' }] : []),
    ...(reports ? [{ href: '/careops/delivery', label: 'Reports' }] : []),
    ...(['programme_admin', 'facility_admin'].some(role => roles.has(role)) ? [{ href: '/careops/insurance', label: 'Insurance' }] : []),
  ];
}
