const SITE_URL = 'https://doctarx.com';
const MARKET_ALTERNATES = {
  'en-US': SITE_URL + '/', 'en-NG': SITE_URL + '/ng', 'x-default': SITE_URL + '/',
};
const LANGUAGE_PATHS = { en: '/international', es: '/international/es', fr: '/international/fr', pt: '/international/pt', ar: '/international/ar' };
const INTERNATIONAL_ALTERNATES = Object.fromEntries([
  ...Object.entries(LANGUAGE_PATHS).map(([language, pathname]) => [language, SITE_URL + pathname]),
  ['x-default', SITE_URL + '/international'],
]);
const GUIDE_SLUGS = ['prepare-for-a-video-visit', 'prescriptions-and-pharmacy-coordination', 'protect-your-health-information'];

// Only public editorial pages belong here. Account and transaction pages are
// deliberately absent. Lastmod is optional: never invent freshness.
const PUBLIC_ROUTES = [
  { path: '/', alternates: MARKET_ALTERNATES },
  { path: '/ng', alternates: MARKET_ALTERNATES },
  ...['/pharmacies', '/ng/pharmacies', '/ng/find-care'].map(path => ({ path })),
  ...['/contact', '/faq', '/blog', '/help', '/privacy', '/terms', '/hipaa', '/accessibility'].map(path => ({ path })),
  ...Object.values(LANGUAGE_PATHS).map(path => ({ path, alternates: INTERNATIONAL_ALTERNATES })),
  ...GUIDE_SLUGS.map(slug => ({ path: '/blog/' + slug })),
];
// Crawlers need access to rendering assets and noindex responses. Authentication
// remains the privacy boundary; robots.txt is not access control.
const ROBOTS = { allow: ['/'], disallow: [] };
const PUBLIC_PATHS = new Set(PUBLIC_ROUTES.map(route => route.path));

function shouldNoIndex(input) {
  if (process.env.DOCTARX_SEO_NOINDEX === 'true') return true;
  let url;
  try { url = new URL(input, SITE_URL); } catch { return true; }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname).replace(/\/+$/, '') || '/'; } catch { return true; }
  if ([...url.searchParams.keys()].some(key => !/^(utm_source|utm_medium|utm_campaign|utm_term|utm_content|gclid|fbclid)$/i.test(key))) return true;
  if (PUBLIC_PATHS.has(pathname)) return false;
  if (pathname === '/marketing/doctarx/medical-live-voice-hero-v6.webp') return false;
  // Keep public brand images eligible without admitting user-uploaded documents.
  if (pathname.startsWith('/_next/static/') || /^\/(?:ng\/)?opengraph-image(?:\/|$)/.test(pathname)) return false;
  if (/^\/(?:favicon\.ico|icon\.svg|icon-192\.png|icon-512\.png|apple-touch-icon\.png)$/.test(pathname)) return false;
  return true;
}
module.exports = { SITE_URL, MARKET_ALTERNATES, LANGUAGE_PATHS, INTERNATIONAL_ALTERNATES, GUIDE_SLUGS, PUBLIC_ROUTES, ROBOTS, shouldNoIndex };
