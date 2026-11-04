'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { GEMINI_LIVE_MODEL, LANGUAGE_SOURCE, DOCUMENTED_GEMINI_LIVE_LANGUAGES, GEMINI_LIVE_LANGUAGE_CATALOG,
  GEMINI_LIVE_LANGUAGES, AFRICAN_GEMINI_LIVE_LANGUAGES } = require('../../../shared/voiceLanguageCatalog.cjs');
const { configuration, LANGUAGES, MODEL } = require('../../services/voice/geminiLiveEvaluationTransport');

test('versioned catalog distinguishes documented African choices from experimental Igbo', () => {
  assert.equal(MODEL, GEMINI_LIVE_MODEL); assert.equal(MODEL, 'gemini-3.8-live');
  assert.equal(LANGUAGE_SOURCE.checkedAt, '2026-11-04'); assert.match(LANGUAGE_SOURCE.url, /^https:\/\/aistudio.google.com\/docs\/live-api\/capabilities#supported-languages$/);
  assert.equal(DOCUMENTED_GEMINI_LIVE_LANGUAGES.length, 100); // 99 named rows, Norwegian no/nb codes.
  assert.deepEqual(AFRICAN_GEMINI_LIVE_LANGUAGES.map(item => item.code), ['af', 'ak', 'am', 'ar', 'ha', 'rw', 'om', 'so', 'st', 'sw', 'tn', 'wo', 'yo', 'zu']);
  assert.equal(GEMINI_LIVE_LANGUAGE_CATALOG.length, 101);
  assert.equal(new Set(GEMINI_LIVE_LANGUAGE_CATALOG.map(item => item.code)).size, 101);
  const igbo = GEMINI_LIVE_LANGUAGE_CATALOG.find(item => item.code === 'ig');
  assert.equal(igbo.support, 'experimental_observation'); assert.equal(DOCUMENTED_GEMINI_LIVE_LANGUAGES.some(item => item.code === 'ig'), false);
  assert.equal(GEMINI_LIVE_LANGUAGE_CATALOG.every(item => Object.isFrozen(item) && item.spokenQualityValidated === false && item.clinicalUseValidated === false), true);
  assert.equal(Object.isFrozen(GEMINI_LIVE_LANGUAGES), true);
});

test('every catalog language configures the same nonclinical model without language-code or tools overrides', () => {
  assert.equal(LANGUAGES, GEMINI_LIVE_LANGUAGES);
  for (const { code, name } of GEMINI_LIVE_LANGUAGE_CATALOG) {
    const value = configuration(code);
    assert.equal(value.model, MODEL); assert.ok(value.config.systemInstruction.includes(`Speak naturally in ${name},`), code);
    assert.match(value.config.systemInstruction, /Do not collect personal information/);
    assert.match(value.config.systemInstruction, /No external tools/);
    assert.equal(value.config.speechConfig.languageCode, undefined); assert.equal(value.config.tools, undefined);
    assert.equal(value.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Zephyr');
  }
  for (const code of ['zz', '__proto__', 'toString', 'en-US', 'ha-NG', 'ig-NG', '']) assert.throws(() => configuration(code), { code: 'GEMINI_LANGUAGE_INVALID' });
});

test('actual public language markup shows the documented range without exposing experimental claims', async () => {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const filename = require.resolve('../../../components/marketing/VoiceLanguageCoverage.jsx');
  const compiled = await require('next/dist/build/swc').transform(fs.readFileSync(filename, 'utf8'), { filename,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2020' }, module: { type: 'commonjs' } });
  const holder = { exports: {} };
  vm.runInNewContext(compiled.code, { module: holder, exports: holder.exports, require(name) {
    if (name.endsWith('.module.css')) return {};
    if (name.startsWith('@/')) return require('../../../' + name.slice(2));
    return require(name);
  } }, { filename });
  const html = renderToStaticMarkup(React.createElement(holder.exports.default));
  for (const { name } of DOCUMENTED_GEMINI_LIVE_LANGUAGES) assert.ok(html.includes(`<li>${name}</li>`), name);
  assert.match(html, /African language voice choices/); assert.match(html, /More language voice choices/);
  assert.match(html, /<details><summary>Explore more languages<\/summary>/);
  assert.doesNotMatch(html, /Igbo|Nigerian English|clinical.*validated|getUserMedia|microphone|voice-lab|in development|coming soon/i);
});
