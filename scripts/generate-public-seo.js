const fs = require('fs');
const path = require('path');

const { PUBLIC_ROUTES, ROBOTS, SITE_URL } = require('../lib/seo/public-seo-config.cjs');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ROBOTS_PATH = path.join(PUBLIC_DIR, 'robots.txt');
const SITEMAP_PATH = path.join(PUBLIC_DIR, 'sitemap.xml');

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildRobotsTxt() {
  const lines = ['User-agent: *'];

  for (const rule of ROBOTS.allow) {
    lines.push(`Allow: ${rule}`);
  }

  for (const rule of ROBOTS.disallow) {
    lines.push(`Disallow: ${rule}`);
  }

  lines.push(`Sitemap: ${SITE_URL}/sitemap.xml`);

  return `${lines.join('\n')}\n`;
}

function buildSitemapXml() {
  const urls = PUBLIC_ROUTES.map((route) => {
    const loc = `${SITE_URL}${route.path}`;
    const alternateLinks = Object.entries(route.alternates || {})
      .map(
        ([language, href]) =>
          `    <xhtml:link rel="alternate" hreflang="${escapeXml(language)}" href="${escapeXml(href)}" />`
      )
      .join('\n');

    return [
      '  <url>',
      `    <loc>${escapeXml(loc)}</loc>`,
      route.lastModified ? '<lastmod>' + escapeXml(route.lastModified) + '</lastmod>' : null,
      alternateLinks || null,
      '  </url>',
    ]
      .filter(Boolean)
      .join('\n');
  }).join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    urls,
    '</urlset>',
    '',
  ].join('\n');
}

if (require.main === module) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  fs.writeFileSync(ROBOTS_PATH, buildRobotsTxt(), 'utf8');
  fs.writeFileSync(SITEMAP_PATH, buildSitemapXml(), 'utf8');
  console.log('Generated public robots.txt and sitemap.xml');
}
module.exports = { buildRobotsTxt, buildSitemapXml };
