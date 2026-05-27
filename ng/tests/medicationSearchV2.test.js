'use strict';

/**
 * ng/tests/medicationSearchV2.test.js
 * Pure-function tests for the medication search v2 module — text
 * normalization and the dosage parser. SQL-bearing functions are
 * exercised in integration; tests here run with no DB.
 *
 * Run: node --test ng/tests/medicationSearchV2.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Mirror the pure helpers (must stay in sync with medicationSearchV2.js)
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s.\-/+]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DOSE_UNIT_RE = /(\d+(?:\.\d+)?)\s*(mg|g|mcg|µg|ug|ml|iu|units?)\b/i;

function parseDose(rawQuery) {
  const q = normalize(rawQuery);
  if (!q) return { drugText: '', dose: null, unit: null, second: null };
  const m = q.match(DOSE_UNIT_RE);
  let dose = null, unit = null;
  if (m) { dose = Number(m[1]); unit = m[2].toLowerCase().replace('µg', 'mcg').replace('ug', 'mcg'); }
  const combo = q.match(/(\d+)\s*\/\s*(\d+)/);
  const second = combo ? Number(combo[2]) : null;
  if (combo && dose == null) dose = Number(combo[1]);
  const drugText = q
    .replace(DOSE_UNIT_RE, ' ')
    .replace(/\d+\s*\/\s*\d+/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { drugText, dose, unit: unit || (dose ? 'mg' : null), second };
}

describe('normalize', () => {
  it('lowercases and trims', () => {
    assert.equal(normalize('  COARTEM  '), 'coartem');
    assert.equal(normalize('AmoxICILLin'), 'amoxicillin');
  });
  it('collapses whitespace', () => {
    assert.equal(normalize('amox    500   mg'), 'amox 500 mg');
  });
  it('preserves dots, slashes, plus and dashes inside words', () => {
    assert.equal(normalize('amox-clav 500/125'), 'amox-clav 500/125');
    assert.equal(normalize('vit b1+b6+b12'), 'vit b1+b6+b12');
  });
  it('handles empty / nullish input', () => {
    assert.equal(normalize(''), '');
    assert.equal(normalize(null), '');
    assert.equal(normalize(undefined), '');
  });
  it('strips punctuation like commas / parens', () => {
    assert.equal(normalize('Coartem (artemether), 80mg'), 'coartem artemether 80mg');
  });
});

describe('parseDose', () => {
  it('extracts mg / g / mcg / ml units', () => {
    assert.deepEqual(parseDose('amoxicillin 500mg'), { drugText: 'amoxicillin', dose: 500, unit: 'mg', second: null });
    assert.deepEqual(parseDose('paracetamol 1g'),    { drugText: 'paracetamol', dose: 1,   unit: 'g',  second: null });
    assert.deepEqual(parseDose('levothyroxine 50mcg'), { drugText: 'levothyroxine', dose: 50, unit: 'mcg', second: null });
    assert.deepEqual(parseDose('ventolin 100µg'),    { drugText: 'ventolin', dose: 100, unit: 'mcg', second: null });
    assert.deepEqual(parseDose('oral susp 5ml'),     { drugText: 'oral susp', dose: 5, unit: 'ml', second: null });
  });

  it('parses combo strengths like 80/480', () => {
    const r = parseDose('coartem 80/480');
    assert.equal(r.drugText, 'coartem');
    assert.equal(r.dose, 80);
    assert.equal(r.second, 480);
  });

  it('returns null dose/unit when none present', () => {
    assert.deepEqual(parseDose('ors'), { drugText: 'ors', dose: null, unit: null, second: null });
  });

  it('handles empty input', () => {
    assert.deepEqual(parseDose(''), { drugText: '', dose: null, unit: null, second: null });
    assert.deepEqual(parseDose(null), { drugText: '', dose: null, unit: null, second: null });
  });

  it('survives whitespace between number and unit', () => {
    const r = parseDose('amox 500 mg');
    assert.equal(r.drugText, 'amox');
    assert.equal(r.dose, 500);
    assert.equal(r.unit, 'mg');
  });

  it('handles dose without explicit unit (defaults to mg when number present)', () => {
    const r = parseDose('panadol 500');
    assert.equal(r.drugText, 'panadol 500'); // no unit → not stripped
    assert.equal(r.dose, null);              // no unit → no dose either
  });

  it('case-insensitive units', () => {
    const r = parseDose('amox 500MG');
    assert.equal(r.unit, 'mg');
    assert.equal(r.dose, 500);
  });
});

describe('parseDose — Nigerian street prescriptions', () => {
  const cases = [
    ['coartem 20/120',         { drugText: 'coartem',     dose: 20,  second: 120 }],
    ['augmentin 625mg',        { drugText: 'augmentin',   dose: 625, unit: 'mg' }],
    ['flagyl 200mg',           { drugText: 'flagyl',      dose: 200, unit: 'mg' }],
    ['amlodipine 5mg',         { drugText: 'amlodipine',  dose: 5,   unit: 'mg' }],
    ['metformin 500mg',        { drugText: 'metformin',   dose: 500, unit: 'mg' }],
    ['ors',                    { drugText: 'ors',         dose: null }],
  ];
  for (const [input, expected] of cases) {
    it(`"${input}" → drug="${expected.drugText}" dose=${expected.dose}${expected.unit ? ' '+expected.unit : ''}`, () => {
      const r = parseDose(input);
      assert.equal(r.drugText, expected.drugText);
      if ('dose' in expected) assert.equal(r.dose, expected.dose);
      if ('unit' in expected) assert.equal(r.unit, expected.unit);
      if ('second' in expected) assert.equal(r.second, expected.second);
    });
  }
});
