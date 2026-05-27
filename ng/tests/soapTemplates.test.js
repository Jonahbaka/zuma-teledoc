'use strict';

/**
 * ng/tests/soapTemplates.test.js
 * Tests for the SOAP template library — no DB, pure data.
 * Run: node --test ng/tests/soapTemplates.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { TEMPLATES, listTemplates, getTemplate, searchTemplates, applyTemplate } = require('../../lib/ng/soapTemplates');

describe('soap templates — coverage', () => {
  it('ships ≥8 templates covering core Nigerian presentations', () => {
    assert.ok(TEMPLATES.length >= 8, `expected ≥8, got ${TEMPLATES.length}`);
  });

  it('includes the must-have demo categories', () => {
    const keys = TEMPLATES.map(t => t.key);
    for (const k of [
      'malaria_adult_uncomplicated',
      'malaria_pediatric',
      'hypertension_followup',
      'antenatal_first_visit',
      'diabetes_followup',
      'urti_adult',
      'diarrhea_pediatric_ors',
      'mental_health_intake',
    ]) {
      assert.ok(keys.includes(k), `missing template ${k}`);
    }
  });

  it('each template has all SOAP sections populated', () => {
    for (const t of TEMPLATES) {
      assert.ok(t.subjective?.ask?.length > 0, `${t.key}: missing subjective.ask`);
      assert.ok(t.subjective?.narrative,        `${t.key}: missing subjective.narrative`);
      assert.ok(t.objective?.vitals?.length > 0, `${t.key}: missing objective.vitals`);
      assert.ok(t.objective?.exam?.length > 0,   `${t.key}: missing objective.exam`);
      assert.ok(t.assessment?.primary,           `${t.key}: missing assessment.primary`);
      assert.ok(t.assessment?.icd10,             `${t.key}: missing assessment.icd10`);
      assert.ok(Array.isArray(t.plan?.investigations), `${t.key}: missing plan.investigations`);
      assert.ok(t.plan?.medications?.length > 0,       `${t.key}: missing plan.medications`);
      assert.ok(t.plan?.follow_up,                     `${t.key}: missing plan.follow_up`);
    }
  });

  it('every medication carries generic + dose + frequency', () => {
    for (const t of TEMPLATES) {
      for (const m of t.plan.medications) {
        assert.ok(m.generic && m.dose && m.frequency,
          `${t.key}: med ${JSON.stringify(m)} missing required fields`);
      }
    }
  });

  it('pediatric templates carry weight in vitals', () => {
    for (const t of TEMPLATES.filter(x => x.age_group === 'pediatric')) {
      assert.ok(t.objective.vitals.includes('weight'),
        `${t.key}: pediatric template should record weight`);
    }
  });
});

describe('listTemplates / getTemplate', () => {
  it('listTemplates returns summary shape', () => {
    const list = listTemplates();
    assert.equal(list.length, TEMPLATES.length);
    for (const item of list) {
      assert.ok(item.key && item.label && item.chief_complaint && item.age_group);
      assert.equal(item.subjective, undefined, 'summary should not include heavy fields');
    }
  });

  it('getTemplate returns full record or null', () => {
    assert.equal(getTemplate('nope_nope'), null);
    const t = getTemplate('hypertension_followup');
    assert.ok(t && t.plan.medications.length > 0);
  });
});

describe('searchTemplates', () => {
  it('empty query returns everything', () => {
    assert.equal(searchTemplates('').length, TEMPLATES.length);
    assert.equal(searchTemplates(null).length, TEMPLATES.length);
  });
  it('matches on label / chief complaint / key / diagnosis', () => {
    assert.ok(searchTemplates('fever').some(t => t.key.startsWith('malaria_')));
    assert.ok(searchTemplates('hypertension').some(t => t.key === 'hypertension_followup'));
    assert.ok(searchTemplates('antenatal').some(t => t.key === 'antenatal_first_visit'));
    assert.ok(searchTemplates('diabetes').some(t => t.key === 'diabetes_followup'));
    assert.ok(searchTemplates('mental').some(t => t.key === 'mental_health_intake'));
  });
  it('no match → empty', () => {
    assert.equal(searchTemplates('quantum-dynamics').length, 0);
  });
});

describe('applyTemplate', () => {
  it('produces an editable scaffold with all SOAP keys', () => {
    const t = getTemplate('malaria_adult_uncomplicated');
    const applied = applyTemplate(t);
    assert.equal(applied.template_key, t.key);
    assert.equal(applied.chief_complaint, t.chief_complaint);
    assert.ok(applied.subjective.narrative && applied.subjective.questions.length > 0);
    assert.equal(typeof applied.objective.vitals, 'object');
    assert.equal(applied.objective.vitals.temp, '');
    assert.ok(applied.objective.exam_findings.length > 0);
    assert.equal(applied.assessment.primary_diagnosis, t.assessment.primary);
    assert.equal(applied.assessment.icd10, t.assessment.icd10);
    assert.ok(applied.plan.medications.length > 0);
  });
  it('returns null for nullish input', () => {
    assert.equal(applyTemplate(null), null);
    assert.equal(applyTemplate(undefined), null);
  });
  it('vitals are emptied (string "") so the doctor types real values', () => {
    const applied = applyTemplate(getTemplate('antenatal_first_visit'));
    for (const v of Object.values(applied.objective.vitals)) {
      assert.equal(v, '');
    }
  });
});

describe('all templates are JSON-serializable', () => {
  it('round-trips through JSON without loss', () => {
    for (const t of TEMPLATES) {
      const round = JSON.parse(JSON.stringify(t));
      assert.deepEqual(round, t);
    }
  });
});
