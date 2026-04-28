const CACHE_VERSION = '2026-04-28-pwa-v7';
const CACHE_NAME = `doctarx-app-shell-${CACHE_VERSION}`;
const NAVIGATION_CACHE = `${CACHE_NAME}-pages`;
const ASSET_CACHE = `${CACHE_NAME}-assets`;
const ICON_CACHE = `${CACHE_NAME}-icons`;
const OFFLINE_FALLBACK = '/offline.html';
const TRACKING_PARAMS = ['source', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
const MANIFEST_PATHS = new Set(['/manifest.webmanifest', '/ng/manifest.webmanifest']);
const ICON_PATHS = new Set([
  '/apple-touch-icon.png',
  '/favicon.ico',
  '/icon-192.png',
  '/icon-512.png',
  '/icon.svg'
]);
const INSTALL_ASSETS = [OFFLINE_FALLBACK, ...MANIFEST_PATHS, ...ICON_PATHS];
const PUBLIC_NAVIGATION_PATHS = new Set([
  '/',
  '/accessibility',
  '/blog',
  '/contact',
  '/faq',
  '/forgot-password',
  '/help',
  '/hipaa',
  '/login',
  '/ng',
  '/ng/auth/login',
  '/ng/auth/register',
  '/ng/patient/login',
  '/ng/pharmacy/login',
  '/ng/pharmacy/onboarding',
  '/ng/pharmacy/register',
  '/ng/pricing',
  '/ng/provider',
  '/ng/provider/login',
  '/ng/provider/register',
  '/patient/login',
  '/patient/register',
  '/pharmacy/login',
  '/pharmacy/register',
  '/privacy',
  '/provider/login',
  '/provider/register',
  '/register',
  '/terms'
]);
const LEGACY_CACHE_PREFIXES = ['doctarx-app-shell-', 'doctarx-shell-'];
const SENSITIVE_PATH_PREFIXES = [
  '/api/',
  '/socket.io',
  '/admin/',
  '/patient/',
  '/provider/',
  '/pharmacy/',
  '/ng/admin/',
  '/ng/patient/',
  '/ng/provider/',
  '/ng/pharmacy/',
  '/appointments/',
  '/claims/',
  '/encounters/',
  '/medical-records/',
  '/messages/',
  '/prescriptions/',
  '/uploads/',
  '/visits/'
];

function normalizePathname(pathname) {
  if (!pathname) return '/';
  if (pathname === '/') return pathname;
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

function buildCacheKey(url) {
  const cacheUrl = new URL(url.toString());
  for (const param of TRACKING_PARAMS) {
    cacheUrl.searchParams.delete(param);
  }
  return `${cacheUrl.pathname}${cacheUrl.search}`;
}

function hasMeaningfulSearch(url) {
  const cacheUrl = new URL(url.toString());
  for (const param of TRACKING_PARAMS) {
    cacheUrl.searchParams.delete(param);
  }
  return cacheUrl.searchParams.size > 0;
}

function isNavigationRequest(request) {
  return request.mode === 'navigate' || request.destination === 'document';
}

function isNextDataRequest(request, url) {
  return (
    url.pathname.startsWith('/_next/') ||
    url.searchParams.has('_rsc') ||
    request.headers.has('RSC') ||
    request.headers.has('Next-Router-Prefetch') ||
    request.headers.get('accept')?.includes('text/x-component') ||
    request.headers.has('x-nextjs-data')
  );
}

function shouldBypassRequest(request, url) {
  const sensitiveNonNavigation =
    !isNavigationRequest(request) &&
    SENSITIVE_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));

  return (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io') ||
    sensitiveNonNavigation ||
    url.pathname.includes('hot-update') ||
    isNextDataRequest(request, url)
  );
}

function isIconRequest(url) {
  return ICON_PATHS.has(normalizePathname(url.pathname));
}

function isStaticAssetRequest(request, url) {
  if (isIconRequest(url)) return false;
  if (MANIFEST_PATHS.has(url.pathname)) return true;

  return (
    ['font', 'image', 'style', 'audio', 'video'].includes(request.destination) ||
    /\.(?:avif|css|gif|ico|jpe?g|json|mp4|otf|png|svg|ttf|webm|webp|woff2?)$/i.test(url.pathname)
  );
}

function isSafeNavigationToCache(url) {
  const pathname = normalizePathname(url.pathname);

  if (hasMeaningfulSearch(url)) {
    return false;
  }

  if (PUBLIC_NAVIGATION_PATHS.has(pathname)) {
    return true;
  }

  return /^\/(patient|provider|pharmacy)\/(login|register)$/.test(pathname);
}

function isCacheableResponse(response) {
  const cacheControl = response?.headers?.get('cache-control') || '';
  return (
    response?.ok &&
    response.type === 'basic' &&
    !response.headers.has('set-cookie') &&
    !/(?:^|,)\s*(?:no-store|private)\b/i.test(cacheControl)
  );
}

async function warmInstallCaches() {
  const assetCache = await caches.open(ASSET_CACHE);
  const iconCache = await caches.open(ICON_CACHE);

  await Promise.allSettled(
    INSTALL_ASSETS.map(async (asset) => {
      const targetCache = ICON_PATHS.has(asset) ? iconCache : assetCache;
      await targetCache.add(asset);
    })
  );
}

async function deleteLegacyCaches() {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter(
        (key) =>
          LEGACY_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)) &&
          ![NAVIGATION_CACHE, ASSET_CACHE, ICON_CACHE].includes(key)
      )
      .map((key) => caches.delete(key))
  );
}

async function notifyClientsActivated() {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const client of clients) {
    client.postMessage({ type: 'APP_SHELL_ACTIVATED', version: CACHE_NAME });
  }
}

async function enableNavigationPreload() {
  if (!self.registration.navigationPreload) {
    return;
  }

  try {
    await self.registration.navigationPreload.enable();
  } catch {
    // Navigation preload is optional.
  }
}

async function networkFirst(request, cacheName, options = {}) {
  const { cacheKey = request.url, fallbackUrl, preloadResponse, shouldCache } = options;
  const cache = await caches.open(cacheName);

  try {
    const preload = await preloadResponse;
    if (isCacheableResponse(preload)) {
      if (shouldCache?.(preload) !== false) {
        await cache.put(cacheKey, preload.clone());
      }
      return preload;
    }

    const response = await fetch(request);
    if (isCacheableResponse(response) && shouldCache?.(response) !== false) {
      await cache.put(cacheKey, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(cacheKey);
    if (cached) {
      return cached;
    }

    if (fallbackUrl) {
      return (await caches.match(fallbackUrl)) || Response.error();
    }

    return Response.error();
  }
}

async function staleWhileRevalidate(request, cacheName, cacheKey = request.url) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(cacheKey);

  const networkPromise = fetch(request)
    .then(async (response) => {
      if (isCacheableResponse(response)) {
        await cache.put(cacheKey, response.clone());
      }
      return response;
    })
    .catch(() => cached || Response.error());

  return cached || networkPromise;
}

async function cacheFirst(request, cacheName, cacheKey = request.url) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      await cache.put(cacheKey, response.clone());
    }
    return response;
  } catch {
    return Response.error();
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(warmInstallCaches().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    deleteLegacyCaches()
      .then(() => enableNavigationPreload())
      .then(() => self.clients.claim())
      .then(() => notifyClientsActivated())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (shouldBypassRequest(request, url)) {
    return;
  }

  if (isNavigationRequest(request)) {
    const cacheKey = buildCacheKey(url);

    event.respondWith(
      networkFirst(request, NAVIGATION_CACHE, {
        cacheKey,
        fallbackUrl: OFFLINE_FALLBACK,
        preloadResponse: event.preloadResponse,
        shouldCache: (response) =>
          isCacheableResponse(response) &&
          response.headers.get('content-type')?.includes('text/html') &&
          isSafeNavigationToCache(url)
      })
    );
    return;
  }

  if (isIconRequest(url)) {
    event.respondWith(cacheFirst(request, ICON_CACHE, url.pathname));
    return;
  }

  if (MANIFEST_PATHS.has(url.pathname)) {
    event.respondWith(networkFirst(request, ASSET_CACHE, { cacheKey: url.pathname }));
    return;
  }

  if (isStaticAssetRequest(request, url)) {
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE, buildCacheKey(url)));
  }
});
