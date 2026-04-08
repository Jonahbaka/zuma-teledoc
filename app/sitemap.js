const SITE_URL = 'https://doctarx.com';
const LAST_MODIFIED = new Date('2026-04-08T00:00:00.000Z');

const PUBLIC_ROUTES = [
  { url: '/', changeFrequency: 'weekly', priority: 1.0 },
  { url: '/ng', changeFrequency: 'weekly', priority: 0.95 },
  { url: '/ng/provider/register', changeFrequency: 'monthly', priority: 0.72 },
  { url: '/contact', changeFrequency: 'monthly', priority: 0.8 },
  { url: '/faq', changeFrequency: 'monthly', priority: 0.8 },
  { url: '/blog', changeFrequency: 'weekly', priority: 0.7 },
  { url: '/help', changeFrequency: 'monthly', priority: 0.7 },
  { url: '/privacy', changeFrequency: 'yearly', priority: 0.5 },
  { url: '/terms', changeFrequency: 'yearly', priority: 0.5 },
  { url: '/hipaa', changeFrequency: 'yearly', priority: 0.5 },
  { url: '/accessibility', changeFrequency: 'yearly', priority: 0.4 },
  { url: '/patient/login', changeFrequency: 'monthly', priority: 0.6 },
  { url: '/patient/register', changeFrequency: 'monthly', priority: 0.6 },
  { url: '/provider/login', changeFrequency: 'monthly', priority: 0.6 },
  { url: '/provider/register', changeFrequency: 'monthly', priority: 0.6 },
];

export default function sitemap() {
  return PUBLIC_ROUTES.map((route) => ({
    url: `${SITE_URL}${route.url}`,
    lastModified: LAST_MODIFIED,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
