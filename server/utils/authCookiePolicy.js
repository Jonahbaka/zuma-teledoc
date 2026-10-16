'use strict';

function authCookieDomain(env = process.env) {
  const mode = env.AUTH_COOKIE_DOMAIN_MODE || 'existing';
  if (!['existing', 'host-only'].includes(mode)) throw new Error('AUTH_COOKIE_DOMAIN_MODE must be existing or host-only.');
  if (mode === 'host-only') return undefined;
  return env.COOKIE_DOMAIN || (env.NODE_ENV === 'production' ? '.doctarx.com' : undefined);
}

function legacyAuthCookieDomain(env = process.env) {
  return env.AUTH_COOKIE_DOMAIN_MODE === 'host-only' ? env.COOKIE_DOMAIN || (env.NODE_ENV === 'production' ? '.doctarx.com' : undefined) : undefined;
}

module.exports = { authCookieDomain, legacyAuthCookieDomain };
