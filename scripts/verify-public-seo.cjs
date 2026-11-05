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
const growthRoutes = ['/for-providers', '/partners', '/company', '/press'];
const downloadPaths = [
  '/press/doctarx-fact-sheet.txt', '/press/doctarx-homepage.png',
  '/launch-kit/doctarx-overview.md', '/launch-kit/founder-demo-storyboard.md', '/launch-kit/social-launch-pack.md',
];
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
    const assets = [];
    for (const pathname of downloadPaths) {
      const response = await request(pathname);
      assert.equal(response.status, 200, pathname + ' downloadable');
      const body = Buffer.from(await response.arrayBuffer());
      assert.deepEqual(body, fs.readFileSync(path.join(root, 'public', pathname)), pathname + ' exact file bytes');
      assert.ok(body.length > 0, pathname + ' nonempty');
      if (pathname.endsWith('.png')) assert.match(response.headers.get('content-type') || '', /^image\/png/i, pathname);
      assets.push({ path: pathname, bytes: body.length, exactFileMatch: true });
    }
    for (const pathname of ['/company/opengraph-image', '/press/opengraph-image']) {
      const response = await request(pathname);
      assert.equal(response.status, 200, pathname);
      assert.match(response.headers.get('content-type') || '', /^image\/png/i, pathname);
      assert.doesNotMatch(response.headers.get('x-robots-tag') || '', /noindex/, pathname);
      const body = Buffer.from(await response.arrayBuffer());
      assert.equal(body.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', pathname + ' PNG signature');
      assert.equal(body.readUInt32BE(16), 1200, pathname + ' width');
      assert.equal(body.readUInt32BE(20), 630, pathname + ' height');
      assets.push({ path: pathname, bytes: body.length, width: 1200, height: 630 });
    }
    const { chromium, expect } = require('@playwright/test');
    const AxeBuilder = require('@axe-core/playwright').default;
    const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const accessibility = [];
    const interactions = [];
    try {
      for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
        const context = await browser.newContext({ viewport });
        // Deterministic clipboard success/failure: no real system clipboard or
        // social network receives data during the browser verification.
        await context.addInitScript(() => {
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
            writeText: async text => {
              if (window.__rejectPublicClipboard) throw new Error('Fictional denied clipboard');
              window.__copiedPublicText = text;
            },
          } });
        });
        // Offline external providers are not needed for public editorial pages.
        await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
        const page = await context.newPage();
        for (const pathname of [...Object.values(LANGUAGE_PATHS), '/blog', ...PUBLIC_ROUTES.filter(item => item.path.startsWith('/blog/')).map(item => item.path), ...growthRoutes]) {
          await page.goto(base + pathname, { waitUntil: 'load' });
          await page.locator('main h1').waitFor({ state: 'visible' });
          await page.waitForFunction(() => document.styleSheets.length > 0 && document.fonts.status === 'loaded');
          assert.equal(await page.locator('main h1').count(), 1, pathname);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), pathname + ' no horizontal overflow');
          const scan = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
          assert.deepEqual(scan.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })), [], pathname + ' accessibility');
          accessibility.push({ path: pathname, width: viewport.width, violations: 0 });
        }
        for (const pathname of growthRoutes) {
          // Public sharing must never forward a current-page token, account ID,
          // tracking query or fragment, even when the page was opened with one.
          await page.goto(base + pathname + '?token=fictional-private-token&patient=fictional-record&utm_source=browser-check#private-fragment', { waitUntil: 'load' });
          const expectedPublicUrl = SITE_URL + pathname;
          const publicLink = page.getByLabel('Public link', { exact: true });
          await expect(publicLink).toHaveValue(expectedPublicUrl);
          const sharing = publicLink.locator('..');
          const linkedIn = new URL(await sharing.getByRole('link', { name: /^LinkedIn/ }).getAttribute('href'));
          assert.equal(linkedIn.origin, 'https://www.linkedin.com');
          assert.equal(linkedIn.searchParams.get('url'), expectedPublicUrl);
          const whatsApp = new URL(await sharing.getByRole('link', { name: /^WhatsApp/ }).getAttribute('href'));
          assert.equal(whatsApp.origin, 'https://wa.me');
          assert.ok(whatsApp.searchParams.get('text').endsWith(' ' + expectedPublicUrl));
          for (const url of [linkedIn, whatsApp]) assert.doesNotMatch(url.href, /fictional|private-fragment|browser-check|patient|token=/);
          await sharing.getByRole('button', { name: 'Copy link', exact: true }).click();
          await expect(sharing.getByRole('status')).toHaveText('Public link copied. Paste it wherever you want to share.');
          assert.equal(await page.evaluate(() => window.__copiedPublicText), expectedPublicUrl);
          await page.evaluate(() => { window.__rejectPublicClipboard = true; window.__copiedPublicText = null; });
          await sharing.getByRole('button', { name: 'Copy link', exact: true }).click();
          await expect(sharing.getByRole('status')).toContainText('Copy the selected public link');
          await expect(publicLink).toBeFocused();
          assert.equal(await publicLink.evaluate(input => input.value.slice(input.selectionStart, input.selectionEnd)), expectedPublicUrl);
          assert.equal(await page.evaluate(() => window.__copiedPublicText), null);
          interactions.push({ path: pathname, width: viewport.width, fixedPublicUrl: true, clipboardSuccess: true, clipboardFallback: true });
          if (pathname === '/for-providers') {
            const enquiries = page.getByLabel('Administrative enquiries per week', { exact: true });
            const minutes = page.getByLabel('Average staff minutes per enquiry', { exact: true });
            const target = page.getByLabel('Your target reduction (%)', { exact: true });
            const calculator = page.getByRole('region', { name: 'What would a better workflow be worth?' });
            await enquiries.fill('200'); await minutes.fill('3'); await target.fill('25');
            await expect(calculator.getByRole('status')).toContainText('10.0 hours / week');
            await expect(calculator.getByRole('status')).toContainText('2.5 hours per week');
            await minutes.fill('');
            await expect(calculator.getByRole('status')).toContainText('Enter a whole enquiry count');
            await minutes.fill('3'); await enquiries.fill('10001');
            await expect(calculator.getByRole('status')).toContainText('Enter a whole enquiry count');
            await enquiries.fill('0');
            await expect(calculator.getByRole('status')).toContainText('0.0 hours / week');
            interactions.push({ path: pathname, width: viewport.width, calculatorValidInput: true, emptyAndOutOfRangeRejected: true, zeroAccepted: true });
          }
          if (pathname === '/press') {
            const description = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Short description', exact: true }) });
            await page.evaluate(() => { window.__rejectPublicClipboard = false; });
            await description.getByRole('button', { name: 'Copy short description', exact: true }).click();
            await expect(description.getByRole('status')).toHaveText('Copied. Ready to paste.');
            assert.match(await page.evaluate(() => window.__copiedPublicText), /^DoctaRx is a connected virtual care and clinical operations platform/);
            await page.evaluate(() => { window.__rejectPublicClipboard = true; });
            await description.getByRole('button', { name: 'Copy short description', exact: true }).click();
            await expect(description.getByRole('status')).toContainText('copy it manually');
            interactions.push({ path: pathname, width: viewport.width, descriptionCopySuccess: true, descriptionCopyFallback: true });
          }
        }
        await context.close();
      }
    } finally { await browser.close(); }
    const directory = path.join(root, 'artifacts', 'seo'); fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'crawl.json'), JSON.stringify({ sourceSha: process.env.GITHUB_SHA || null, passed: true, results, accessibility, assets, interactions }, null, 2));
    console.log('SEO production crawl passed: ' + results.length + ' public pages, ' + accessibility.length + ' accessibility scenarios, ' + assets.length + ' assets, ' + interactions.length + ' interaction scenarios, private headers, unknown-route 404s, robots and sitemap.');
  } finally {
    child.kill();
    await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
