export const PROVIDER_MARKET_STORAGE_KEY = 'providerPortalMarket';

export function normalizeProviderMarket(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim().toUpperCase();

  if (normalizedValue === 'NG' || normalizedValue === 'NIGERIA') {
    return 'NG';
  }

  if (
    normalizedValue === 'US' ||
    normalizedValue === 'USA' ||
    normalizedValue === 'UNITED STATES' ||
    normalizedValue === 'UNITED STATES OF AMERICA'
  ) {
    return 'US';
  }

  return null;
}

export function setPreferredProviderMarket(market) {
  if (typeof window === 'undefined') {
    return;
  }

  const normalizedMarket = normalizeProviderMarket(market);

  if (!normalizedMarket) {
    localStorage.removeItem(PROVIDER_MARKET_STORAGE_KEY);
    return;
  }

  localStorage.setItem(PROVIDER_MARKET_STORAGE_KEY, normalizedMarket);
}

export function getPreferredProviderMarket() {
  if (typeof window === 'undefined') {
    return null;
  }

  return normalizeProviderMarket(localStorage.getItem(PROVIDER_MARKET_STORAGE_KEY));
}

export function resolveProviderMarket({ pathname = '', user, market } = {}) {
  if (pathname.startsWith('/ng/provider')) {
    return 'NG';
  }

  if (pathname === '/provider' || pathname.startsWith('/provider/')) {
    return 'US';
  }

  const explicitMarket = normalizeProviderMarket(market);
  if (explicitMarket) {
    return explicitMarket;
  }

  const userCountry = normalizeProviderMarket(user?.address?.country || user?.country);
  if (userCountry) {
    return userCountry;
  }

  const preferredMarket = getPreferredProviderMarket();
  if (preferredMarket) {
    return preferredMarket;
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
