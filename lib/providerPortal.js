export const PROVIDER_MARKET_STORAGE_KEY = 'providerPortalMarket';

export function setPreferredProviderMarket(market) {
  if (typeof window === 'undefined') {
    return;
  }

  if (!market) {
    localStorage.removeItem(PROVIDER_MARKET_STORAGE_KEY);
    return;
  }

  localStorage.setItem(PROVIDER_MARKET_STORAGE_KEY, market.toUpperCase());
}

export function getPreferredProviderMarket() {
  if (typeof window === 'undefined') {
    return null;
  }

  return localStorage.getItem(PROVIDER_MARKET_STORAGE_KEY);
}

export function resolveProviderMarket({ pathname = '', user } = {}) {
  if (pathname.startsWith('/ng/provider')) {
    return 'NG';
  }

  const userCountry = user?.address?.country || user?.country;
  if (typeof userCountry === 'string' && userCountry.toUpperCase() === 'NG') {
    return 'NG';
  }

  if (getPreferredProviderMarket() === 'NG') {
    return 'NG';
  }

  return 'US';
}

export function getProviderPortalPrefix(options = {}) {
  return resolveProviderMarket(options) === 'NG' ? '/ng/provider' : '/provider';
}

export function toProviderPortalPath(target = '', options = {}) {
  const prefix = getProviderPortalPrefix(options);

  if (!target || target === '/') {
    return prefix;
  }

  if (target.startsWith('/ng/provider')) {
    return `${prefix}${target.slice('/ng/provider'.length)}` || prefix;
  }

  if (target === '/provider') {
    return prefix;
  }

  if (target.startsWith('/provider/')) {
    return `${prefix}${target.slice('/provider'.length)}`;
  }

  const normalizedTarget = target.startsWith('/') ? target : `/${target}`;
  return `${prefix}${normalizedTarget}`;
}

export function rewriteProviderPortalHref(href, options = {}) {
  if (typeof href !== 'string') {
    return href;
  }

  if (href === '/provider' || href.startsWith('/provider/')) {
    return toProviderPortalPath(href, options);
  }

  return href;
}

export function getProviderLoginPath(options = {}) {
  return resolveProviderMarket(options) === 'NG'
    ? '/ng/provider/login'
    : '/provider/login';
}

export function getProviderHomePath(options = {}) {
  return resolveProviderMarket(options) === 'NG' ? '/ng' : '/';
}

export function getProviderInvitePatientPath(options = {}) {
  return resolveProviderMarket(options) === 'NG'
    ? '/ng/patient/search'
    : '/patient/register';
}
