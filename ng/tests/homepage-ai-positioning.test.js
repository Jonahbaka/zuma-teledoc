'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const homepage = read('components/marketing/MarketHomepage.jsx');
const css = read('components/marketing/MarketHomepage.module.css');
const us = read('app/page.js');
const ng = read('app/ng/page.js');
// Public copy must not advertise unfinished or unverified clinical AI functions.
test('homepage retains company identity without advertising unverified AI functionality', () => {
  assert.match(homepage, /DoctaRx · Telehealth AI company/);
  assert.match(homepage, /Connected care.<br \/>People first./);
  for (const source of [homepage, us, ng]) {
    assert.doesNotMatch(source, /in development|coming soon|planned workflow|beta|Clinical Copilot|clinical-copilot/i);
    assert.doesNotMatch(source, /autonomous diagnosis|AI diagnoses|AI prescribes|automated prescribing/i);
  }
});

test('US and Nigeria entrypoints, location privacy, and core care routes are retained', () => {
  assert.match(us, /<MarketHomepage market="US"/);
  assert.match(ng, /<MarketHomepage market="NG"/);
  assert.ok(homepage.includes("home=nigeria?'/ng':'/'"), 'home remains market-specific');
  assert.match(homepage, /patient=nigeria\?'\/ng\/patient':'\/patient'/);
  for (const route of ['/prescriptions', '/records', '/messages', '/login']) assert.ok(homepage.includes("patient+'" + route + "'"), route);
  assert.match(homepage, /nigeria\?'\/ng\/find-care'/);
  assert.match(homepage, /nigeria\?'\/ng\/pharmacies':'\/pharmacies'/);
  assert.match(homepage, /careLocation.location.mode==='manual'\?new URLSearchParams/);
  assert.match(homepage, /Services, availability, and costs are confirmed/);
});

test('both markets use company positioning and preserve canonicals', () => {
  for (const source of [us, ng]) {
    assert.match(source, /Telehealth AI/);
    assert.match(source, /'en-US': 'https:\/\/doctarx.com\/'/);
    assert.match(source, /'en-NG': 'https:\/\/doctarx.com\/ng'/);
  }
  assert.match(us, /canonical: 'https:\/\/doctarx.com\/'/);
  assert.match(ng, /canonical: 'https:\/\/doctarx.com\/ng'/);
});

test('existing keyboard and responsive protections remain intact', () => {
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /max-width: 767px/);
  assert.match(homepage, /event.key==='Escape'.*menuButton.current\?\.focus/);
  assert.match(homepage, /aria-expanded=\{menuOpen\}/);
});
