const MARKET_CONFIGS = {
  US: {
    scope: 'US',
    country: 'USA',
    countryIso2: 'US',
    region: 'US',
    label: 'United States',
    accessPrefix: '',
  },
  NG: {
    scope: 'NG',
    country: 'Nigeria',
    countryIso2: 'NG',
    region: 'NG',
    label: 'Nigeria',
    accessPrefix: '/ng',
  },
};

function normalizeMarketScope(value, fallback = 'US') {
  const normalized = String(value || '').trim().toUpperCase();

  if (['NG', 'NIGERIA'].includes(normalized)) {
    return 'NG';
  }

  if (['US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA'].includes(normalized)) {
    return 'US';
  }

  return MARKET_CONFIGS[fallback] ? fallback : 'US';
}

function getMarketConfig(value, fallback = 'US') {
  return MARKET_CONFIGS[normalizeMarketScope(value, fallback)];
}

function getMarketScopeFromRequest(req, fallback = 'US') {
  return normalizeMarketScope(
    req?.body?.marketScope ||
      req?.body?.market ||
      req?.body?.siteScope ||
      req?.body?.country ||
      req?.query?.marketScope ||
      req?.query?.market ||
      req?.headers?.['x-doctarx-market'],
    fallback
  );
}

function getScopedPortalPath(role, marketScope, target = 'login') {
  const scope = normalizeMarketScope(marketScope);
  const prefix = scope === 'NG' ? '/ng' : '';
  const normalizedRole = String(role || '').trim().toLowerCase();

  if (target === 'register') {
    if (normalizedRole === 'provider') return `${prefix}/provider/register`;
    if (normalizedRole === 'pharmacy') return `${prefix}/pharmacy/register`;
    if (normalizedRole === 'admin' || normalizedRole === 'super_admin') return '/secure/admin';
    if (scope === 'NG') return '/ng/auth/register';
    return '/patient/register';
  }

  if (target === 'dashboard') {
    if (normalizedRole === 'provider') return `${prefix}/provider/dashboard`;
    if (normalizedRole === 'pharmacy') return `${prefix}/pharmacy/dashboard`;
    if (normalizedRole === 'admin' || normalizedRole === 'super_admin') return scope === 'NG' ? '/ng/admin' : '/admin/dashboard';
    return scope === 'NG' ? '/ng/patient' : '/patient/dashboard';
  }

  if (normalizedRole === 'provider') return `${prefix}/provider/login`;
  if (normalizedRole === 'pharmacy') return `${prefix}/pharmacy/login`;
  if (normalizedRole === 'admin' || normalizedRole === 'super_admin') return '/secure/admin';
  if (scope === 'NG') return '/ng/auth/login';
  return '/patient/login';
}

function appendToken(path, token) {
  if (!token) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}test_token=${encodeURIComponent(token)}`;
}

function buildAbsoluteUrl(baseUrl, path) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

module.exports = {
  MARKET_CONFIGS,
  normalizeMarketScope,
  getMarketConfig,
  getMarketScopeFromRequest,
  getScopedPortalPath,
  appendToken,
  buildAbsoluteUrl,
};
