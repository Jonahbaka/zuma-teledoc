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
// Launch copy is held locally until the separate voice release gates are met.
test('homepage leads with AI-first identity and clinician-led care', () => {
  assert.match(homepage, /DOCTARX · AI-FIRST TELEHEALTH/);
  assert.match(homepage, /AI-first telehealth\.<br \/><span>Human care\.<\/span>/);
  assert.match(homepage, /Clinician-led care/);
  assert.match(homepage, /care team for review, clinical decisions/);
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
  assert.match(homepage, /Review services, coverage, and payment choices for your account/);
});

test('both markets use company positioning and preserve canonicals', () => {
  for (const source of [us, ng]) {
    assert.match(source, /AI-First Telehealth/);
    assert.match(source, /Language Voice/);
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

// Keep the actual desktop/mobile browser gate aligned with approved public copy.
test('browser gate checks the approved headline and both exact metadata titles', () => {
  const browser = read('scripts/e2e-public-platform.cjs');
  assert.ok(browser.includes('/AI-first telehealth\\.\\s*Human care\\./'));
  for (const [route, source] of [['/', us], ['/ng', ng]]) {
    const title = source.match(/export const metadata = \{[\s\S]*?title: (?:\{ absolute: )?'([^']+)'/)[1];
    assert.ok(browser.includes(`'${route}': '${title}'`));
  }
});

test('voice design has truthful clinician boundaries and no pretend live controls', () => {
  assert.match(homepage, /id="language-voice"/);
  assert.match(homepage, /href="#language-voice"/);
  assert.match(homepage, /<VoiceLanguageCoverage \/>/);
  const coverage = read('components/marketing/VoiceLanguageCoverage.jsx');
  assert.match(coverage, /AFRICAN_GEMINI_LIVE_LANGUAGES\.map/);
  assert.match(coverage, /DOCUMENTED_GEMINI_LIVE_LANGUAGES\.filter/);
  assert.match(coverage, /Across Africa and beyond/);
  assert.match(homepage, /global platform connecting patients and providers/);
  assert.match(homepage, /href="\/provider\/register"/);
  assert.doesNotMatch(coverage, /experimental|pending|in development|coming soon|clinical.*validated|Igbo/i);
  assert.doesNotMatch(homepage, /getUserMedia|SpeechRecognition|\/api\/voice|href="\/voice-lab"|Start recording|Start voice session/);
  assert.doesNotMatch(homepage, /all languages|every language|clinically validated|100%|instant diagnosis/i);
});

test('generated medical voice hero is local, dimensioned and optimized', () => {
  assert.match(homepage, /AI-generated medical voice concept showing a patient speaking with a doctor through a luminous voice orb and sound waves in a primary healthcare centre/);
  assert.match(homepage, /medical-live-voice-hero-v6\.webp/);
  assert.doesNotMatch(homepage, /ai-language-voice-hero-v1\.webp|patient-doctor-hero-v2\.webp|multilingual-patient-doctor-hero-v3\.webp|3D concept illustration/);
  assert.match(homepage, /width=\{1672\} height=\{941\} priority/);
  const image = fs.readFileSync(path.join(root, 'public/marketing/doctarx/medical-live-voice-hero-v6.webp'));
  assert.equal(image.toString('ascii', 0, 4), 'RIFF');
  assert.equal(image.toString('ascii', 8, 12), 'WEBP');
  assert.ok(image.length < 250000, 'hero remains suitable for mobile delivery');
});

test('voice artwork replaces the previous hero without inventing a product logo or controls', () => {
  assert.doesNotMatch(homepage, /phc-maternity-doctor-hero-v5/);
  assert.equal((homepage.match(/medical-live-voice-hero-v6/g) || []).length, 1);
  assert.match(homepage, /className=\{styles.heroVoiceBrand\} aria-hidden="true"><DoctaRxLogo tone="light" glow=\{false\}/);
  assert.match(css, /\.heroVoiceVisual \{ position: relative; \}/);
  assert.match(css, /\.heroImage \{[^}]*width: 100%;[^}]*height: auto;[^}]*aspect-ratio: 1672 \/ 941;[^}]*object-fit: contain/);
  assert.match(css, /\.heroVoiceBrand \{[^}]*pointer-events: none/);
  assert.match(css, /\.heroVoiceBrand > svg \{[^}]*width: 100%;[^}]*height: auto/);
  assert.doesNotMatch(homepage, /aria-label="(?:Start|Stop|Mute).*voice|recording now|listening now/i);
});

test('both browser gates check the current medical voice hero', () => {
  const heroAlt = homepage.match(/<Image src="\/marketing\/doctarx\/medical-live-voice-hero-v6\.webp" alt="([^"]+)"/)[1];
  for (const file of ['scripts/e2e-homepage-launch.cjs', 'scripts/e2e-public-platform.cjs']) {
    const browser = read(file);
    assert.ok(browser.includes(heroAlt), `${file} checks the current hero`);
    assert.ok(browser.includes('Illustrative conversation from Hausa to English'), `${file} checks the language context`);
    assert.ok(browser.includes("getByRole('group', { name: 'Illustrative conversation from Hausa to English'"), `${file} checks the accessible group semantics`);
    assert.doesNotMatch(browser, /3D concept illustration/);
  }
});

test('the language difference is explicit in the caption, not inferred from appearance', () => {
  assert.match(homepage, /<figure className=\{styles.heroArt\}>/);
  assert.match(homepage, /<figcaption className=\{styles.heroArtCaption\}>/);
  assert.match(homepage, /role="group" aria-label="Illustrative conversation from Hausa to English"/);
  assert.match(homepage, /<span>Hausa<\/span><ArrowRight aria-hidden="true" \/><span>English<\/span>/);
  assert.match(css, /\.heroLanguagePair \{[^}]*flex-wrap: wrap/);
});

test('launch claims have a separate explicit release gate', () => {
  const gate = read('docs/HOMEPAGE_VOICE_LAUNCH_GATE.md');
  assert.match(gate, /Not approved for deployment/);
  assert.match(gate, /Hausa, Igbo and Yoruba/);
  assert.match(gate, /actual DoctaRx/);
  assert.match(gate, /clinical and privacy/);
});
