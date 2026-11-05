'use strict';
// Crawl the real production Next build. No database, clinical data or provider
// connections are used. Always bind the temporary server to loopback.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('cheerio');
const { PUBLIC_ROUTES, SITE_URL, LANGUAGE_PATHS } = require('../lib/seo/public-seo-config.cjs');
const root = path.resolve(__dirname, '..');
const port = 58481;
const base = 'http://127.0.0.1:' + port;
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(port)],
  { cwd: root, env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let output = '';
child.stdout.on('data', data => { output = (output + data).slice(-10000); });
child.stderr.on('data', data => { output = (output + data).slice(-10000); });
async function request(route) {
  return fetch(base + route, { headers: { 'User-Agent': 'Googlebot' }, signal: AbortSignal.timeout(60000), redirect: 'manual' });
}
(async () => {
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null) throw new Error('Next exited before readiness: ' + output);
      try { if ((await request('/international')).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(ready, 'production server readiness');
    const results = [];
    const titles = new Set();
    for (const route of PUBLIC_ROUTES) {
      const response = await request(route.path);
      assert.equal(response.status, 200, route.path);
      assert.doesNotMatch(response.headers.get('x-robots-tag') || '', /noindex/, route.path);
      const $ = load(await response.text());
      assert.equal($('link[rel="canonical"]').length, 1, route.path + ' one canonical');
      assert.equal(new URL($('link[rel="canonical"]').attr('href')).href, new URL(SITE_URL + route.path).href, route.path);
      const title = $('title').text();
      assert.ok(title && !titles.has(title), route.path + ' unique title'); titles.add(title);
      assert.ok($('meta[name="description"]').attr('content'), route.path + ' description');
      assert.ok($('h1').length, route.path + ' server rendered heading');
      assert.doesNotMatch($('meta[name="robots"]').attr('content') || '', /noindex/, route.path);
      for (const [language, url] of Object.entries(route.alternates || {})) assert.equal(new URL($('link[hreflang="' + language + '"]').attr('href')).href, new URL(url).href, route.path + ' ' + language);
      $('script[type="application/ld+json"]').each((_, element) => JSON.parse($(element).text()));
      const language = Object.keys(LANGUAGE_PATHS).find(key => LANGUAGE_PATHS[key] === route.path);
      if (language) {
        assert.equal($('main').attr('lang'), language);
        assert.equal($('main').attr('dir'), language === 'ar' ? 'rtl' : 'ltr');
        assert.ok($('main p').text().length > 600, 'translated content in initial HTML');
      }
      results.push({ path: route.path, status: response.status, canonical: $('link[rel="canonical"]').attr('href') });
    }
    for (const route of ['/patient/login', '/provider/login', '/ng/patient/records', '/api/unknown', '/international?token=fictional']) {
      assert.match((await request(route)).headers.get('x-robots-tag') || '', /noindex/, route);
    }
    for (const route of ['/international/de', '/blog/does-not-exist']) assert.equal((await request(route)).status, 404, route);
    const sitemap = await request('/sitemap.xml');
    assert.equal(sitemap.status, 200);
    assert.equal(await sitemap.text(), fs.readFileSync(path.join(root, 'public/sitemap.xml'), 'utf8'));
    const robots = await request('/robots.txt');
    assert.equal(robots.status, 200); assert.doesNotMatch(await robots.text(), /Disallow: \/_next/);
    const { chromium } = require('@playwright/test');
    const AxeBuilder = require('@axe-core/playwright').default;
    const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const accessibility = [];
    try {
      for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
        const context = await browser.newContext({ viewport });
        // Offline external providers are not needed for public editorial pages.
        await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
        const page = await context.newPage();
        for (const pathname of [...Object.values(LANGUAGE_PATHS), '/blog', ...PUBLIC_ROUTES.filter(item => item.path.startsWith('/blog/')).map(item => item.path)]) {
          await page.goto(base + pathname, { waitUntil: 'load' });
          await page.locator('main h1').waitFor({ state: 'visible' });
          await page.waitForFunction(() => document.styleSheets.length > 0 && document.fonts.status === 'loaded');
          assert.equal(await page.locator('main h1').count(), 1, pathname);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), pathname + ' no horizontal overflow');
          const scan = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
          assert.deepEqual(scan.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })), [], pathname + ' accessibility');
          accessibility.push({ path: pathname, width: viewport.width, violations: 0 });
        }
        await context.close();
      }
    } finally { await browser.close(); }
    const directory = path.join(root, 'artifacts', 'seo'); fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'crawl.json'), JSON.stringify({ sourceSha: process.env.GITHUB_SHA || null, passed: true, results, accessibility }, null, 2));
    console.log('SEO production crawl passed: ' + results.length + ' public pages, private headers, unknown-route 404s, robots and sitemap.');
  } finally {
    child.kill();
    await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
