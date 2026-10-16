'use strict';

function profileError(message) { return Object.assign(new Error(message), { code: 'DEPLOYMENT_PROFILE_INVALID' }); }
function origin(value, label, production) {
  let url;
  try { url = new URL(value); } catch { throw profileError(`${label} must be an explicit absolute origin.`); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !(url.protocol === 'https:' || url.protocol === 'http:' && (!production || loopback)) ||
      production && /(?:^|\.)invalid$/.test(url.hostname)) throw profileError(`${label} must be an approved HTTPS origin (HTTP loopback is allowed).`);
  return url.origin;
}

function resolveDeploymentProfile(env = process.env, { production = env.NODE_ENV === 'production' } = {}) {
  const profile = env.DOCTARX_PRODUCT_PROFILE || env.NEXT_PUBLIC_DOCTARX_PRODUCT_PROFILE || 'main';
  if (!['main', 'careops'].includes(profile) || env.DOCTARX_PRODUCT_PROFILE && env.NEXT_PUBLIC_DOCTARX_PRODUCT_PROFILE && env.DOCTARX_PRODUCT_PROFILE !== env.NEXT_PUBLIC_DOCTARX_PRODUCT_PROFILE)
    throw profileError('The server and public product profiles must agree on main or careops.');
  const careops = profile === 'careops';
  const deploymentId = env.DOCTARX_DEPLOYMENT_ID || (careops ? 'doctarx-careops' : 'doctarx-main');
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(deploymentId)) throw profileError('DOCTARX_DEPLOYMENT_ID must be a short lowercase release identifier.');
  const appOrigin = careops ? origin(env.NEXT_PUBLIC_APP_URL || (!production ? 'http://localhost:3000' : ''), 'NEXT_PUBLIC_APP_URL', production) : null;
  // CareOps uses a same-origin proxy to the existing API. Cross-site cookies,
  // MFA and new CORS permissions are not silently enabled by a frontend build.
  if (careops && env.NEXT_PUBLIC_API_URL && env.NEXT_PUBLIC_API_URL !== '/api') throw profileError('CareOps NEXT_PUBLIC_API_URL must be /api; configure the existing backend through DOCTARX_API_PROXY_TARGET.');
  let apiProxyTarget = null;
  if (careops && env.DOCTARX_API_PROXY_TARGET) {
    const url = new URL(env.DOCTARX_API_PROXY_TARGET);
    const base = origin(url.origin, 'DOCTARX_API_PROXY_TARGET', production);
    if (url.username || url.password || url.search || url.hash || !['', '/', '/api', '/api/'].includes(url.pathname)) throw profileError('DOCTARX_API_PROXY_TARGET must name the existing backend origin or its /api path.');
    if (base === appOrigin) throw profileError('The CareOps API proxy cannot point back to its own frontend origin.');
    apiProxyTarget = `${base}/api`;
  }
  if (careops && production && !apiProxyTarget) throw profileError('CareOps production requires an explicit existing shared API target.');
  const distDir = env.NEXT_DIST_DIR || (careops ? '.next-careops' : '.next');
  if (careops && (!/^\.next-careops(?:-[a-z0-9-]+)?$/.test(distDir))) throw profileError('CareOps requires an isolated .next-careops build directory.');
  const mediaOrigins = careops ? String(env.CAREOPS_MEDIA_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean).map(value => {
    let url; try { url = new URL(value); } catch { throw profileError('CAREOPS_MEDIA_ORIGINS must contain explicit approved HTTPS or WSS origins.'); }
    if (!['https:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.hostname.includes('*')) throw profileError('CAREOPS_MEDIA_ORIGINS must contain explicit approved HTTPS or WSS origins.');
    return url.origin;
  }) : [];
  return { profile, careops, deploymentId, applicationName: careops ? 'DoctaRx CareOps' : 'DoctaRx', appOrigin, apiBaseUrl: careops ? '/api' : env.NEXT_PUBLIC_API_URL || null, apiProxyTarget, mediaOrigins, distDir };
}

module.exports = { resolveDeploymentProfile };
