const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { PUBLIC_ROUTES, LANGUAGE_PATHS, GUIDE_SLUGS, shouldNoIndex, SITE_URL } = require('../../lib/seo/public-seo-config.cjs');
const { buildRobotsTxt, buildSitemapXml } = require('../../scripts/generate-public-seo');
const { serializeJsonLd, publicMetadata } = require('../../lib/seo/metadata.cjs');
test('sitemap contains canonical editorial URLs and reciprocal self-inclusive language clusters', () => {
  const routes = new Map(PUBLIC_ROUTES.map(route => [SITE_URL + route.path, route]));
  assert.equal(routes.size, PUBLIC_ROUTES.length);
  for (const [url, route] of routes) {
    assert.equal(shouldNoIndex(url), false);
    if (route.alternates) {
      assert.ok(Object.values(route.alternates).includes(url));
      for (const alternate of Object.values(route.alternates)) assert.deepEqual(routes.get(alternate)?.alternates, route.alternates);
    }
  }
  const xml = buildSitemapXml();
  assert.doesNotMatch(xml, /login|register|<lastmod>|<priority>|<changefreq>/);
  assert.match(xml, /hreflang="x-default"/);
  assert.doesNotMatch(buildRobotsTxt(), /Disallow:/);
  assert.equal(fs.readFileSync(path.join(__dirname, '../../public/sitemap.xml'), 'utf8'), xml);
  assert.equal(fs.readFileSync(path.join(__dirname, '../../public/robots.txt'), 'utf8'), buildRobotsTxt());
});
test('private, encoded, token and unreviewed routes cannot enter search indexing', () => {
  for (const route of ['/patient/login', '/patient/records', '/patient/records/', '/%70atient/records', '/ng/phc', '/ng/government-data', '/ng/pharmacy', '/api/patients', '/uploads/credential.pdf', '/careops', '/access/invite', '/international/de', '/blog/missing', '/?token=fictional', '/international?EMAIL=fictional', '/bad%encoding']) assert.equal(shouldNoIndex(route), true, route);
  assert.equal(shouldNoIndex('/international?utm_source=search'), false);
  assert.equal(shouldNoIndex('/_next/static/chunks/test.js'), false);
  assert.equal(shouldNoIndex('/opengraph-image'), false);
  for (const route of ['/company/opengraph-image', '/press/opengraph-image', '/press/doctarx-fact-sheet.txt', '/press/doctarx-homepage.png', '/launch-kit/social-launch-pack.md']) assert.equal(shouldNoIndex(route), false);
  for (const route of ['/press/private.pdf', '/launch-kit/prospects.csv', '/company?token=fictional', '/partners?email=fictional']) assert.equal(shouldNoIndex(route), true);
});
test('Express responses carry private noindex without altering access or response content', async () => {
  const app = express();
  app.use(require('../middleware/searchIndexPolicy'));
  app.get('*', (_req, res) => res.status(200).send('fictional fixture'));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    for (const route of ['/api/health', '/ng/patient/records', '/uploads/test.pdf']) {
      const response = await fetch(base + route);
      assert.match(response.headers.get('x-robots-tag'), /noindex/);
      assert.equal(await response.text(), 'fictional fixture');
    }
    assert.equal((await fetch(base + '/international')).headers.get('x-robots-tag'), null);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('structured data serialization cannot escape a script and preserves the value', () => {
  const value = { description: '</script><script>alert(1)</script>\u2028\u2029' };
  const serialized = serializeJsonLd(value);
  assert.ok(!serialized.includes('<'));
  assert.deepEqual(JSON.parse(serialized), value);
});
test('preview indexing can be disabled without changing production canonicals', () => {
  const previous = process.env.DOCTARX_SEO_NOINDEX;
  try {
    process.env.DOCTARX_SEO_NOINDEX = 'true';
    assert.equal(shouldNoIndex('/'), true);
    assert.equal(shouldNoIndex('/international'), true);
  } finally {
    if (previous === undefined) delete process.env.DOCTARX_SEO_NOINDEX;
    else process.env.DOCTARX_SEO_NOINDEX = previous;
  }
});
test('localized content and guides have real content for every published URL', () => {
  const content = require('../../lib/seo/international-content.cjs');
  const guides = require('../../lib/seo/guides.cjs');
  assert.deepEqual(Object.keys(content), Object.keys(LANGUAGE_PATHS));
  assert.deepEqual(guides.map(item => item.slug), GUIDE_SLUGS);
  for (const [language, copy] of Object.entries(content)) {
    assert.equal(copy.sections.length, 4);
    assert.ok(copy.availability && copy.emergency);
    const metadata = publicMetadata({ ...copy, path: LANGUAGE_PATHS[language], language });
    assert.equal(metadata.alternates.canonical, SITE_URL + LANGUAGE_PATHS[language]);
    assert.equal(metadata.openGraph.url, metadata.alternates.canonical);
  }
  for (const guide of guides) assert.ok(guide.sections.length >= 4);
});
