'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SCENARIO_CATALOG, SCENARIOS, SCENARIO_VERSION, getScenario, createEvaluationTemplate } = require('../../../lib/voice/evaluationScenarios.cjs');

const conversationCategories = [
  'greeting_language_preference', 'correction_negation', 'everyday_numbers_time_dates',
  'code_switching', 'clarification', 'barge_in', 'stop_consent',
];

function assertDeepFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true);
  Object.values(value).forEach(assertDeepFrozen);
}

test('versioned catalog covers every conversation category in each requested language', () => {
  assert.equal(SCENARIO_CATALOG.schemaVersion, 'voice-evaluation-catalog-v1');
  assert.equal(SCENARIO_CATALOG.scenarioVersion, SCENARIO_VERSION);
  assert.equal(SCENARIO_CATALOG.dataClass, 'fictional_nonclinical');
  assert.equal(SCENARIO_CATALOG.executionPolicy, 'offline_definitions_only');
  assert.equal(SCENARIO_CATALOG.languageQualityStatus, 'not_evaluated');
  assert.deepEqual(SCENARIO_CATALOG.languages.map(language => language.code), ['ha', 'ig', 'yo']);
  assert.equal(SCENARIOS, SCENARIO_CATALOG.scenarios);
  assert.equal(SCENARIOS.length, 22);
  assert.equal(new Set(SCENARIOS.map(scenario => scenario.id)).size, SCENARIOS.length);
  for (const language of ['ha', 'ig', 'yo']) {
    const selected = SCENARIOS.filter(scenario => scenario.language === language);
    assert.deepEqual(selected.map(scenario => scenario.category), conversationCategories);
    assert.equal(selected.every(scenario => scenario.mode === 'conversation' && scenario.voice === 'Zephyr'), true);
  }
});

test('all scenarios provide actionable ordered steps and complete blank human references', () => {
  for (const scenario of SCENARIOS) {
    assert.equal(scenario.scenarioVersion, SCENARIO_VERSION);
    assert.equal(scenario.dataClass, 'fictional_nonclinical');
    assert.equal(scenario.title.length > 0, true);
    assert.equal(scenario.fictionalData.scene.startsWith('fictional '), true);
    assert.equal(scenario.reviewerInstructions.length >= 3, true);
    assert.equal(scenario.steps.length >= 2, true);
    assert.equal(new Set(scenario.steps.map(step => step.id)).size, scenario.steps.length);
    for (const step of scenario.steps) {
      for (const key of ['id', 'action', 'instruction', 'expectedBehavior']) assert.equal(typeof step[key], 'string');
      assert.equal(step.instruction.length > 20, true);
      assert.equal(step.expectedBehavior.length > 20, true);
    }
    assert.equal(scenario.requiredChecks.length >= 4, true);
    assert.equal(new Set(scenario.requiredChecks).size, scenario.requiredChecks.length);
    assert.equal(scenario.requiredChecks.includes('fictional_nonclinical_scope_preserved'), true);
    assert.equal(scenario.requiredChecks.includes('no_personal_information_requested'), true);
    const reference = scenario.reference;
    assert.equal(reference.status, 'requires_human_reference');
    assert.equal(reference.scenarioId, scenario.id);
    assert.equal(reference.scenarioVersion, scenario.scenarioVersion);
    assert.equal(reference.language, scenario.language);
    assert.equal(reference.dataClass, scenario.dataClass);
    assert.deepEqual(reference.fictionalData, scenario.fictionalData);
    assert.notEqual(reference.fictionalData, scenario.fictionalData);
    for (const key of ['referenceVersion', 'sourceScript', 'expectedTranscript', 'expectedMeaningEnglish', 'languageVariety', 'reviewer', 'reviewedAt']) assert.equal(reference[key], null);
  }
});

test('catalog and nested scenario, reference, step and language records cannot be changed', () => {
  assertDeepFrozen(SCENARIO_CATALOG);
  const first = SCENARIOS[0];
  for (const mutate of [
    () => { SCENARIO_CATALOG.scenarioVersion = 'changed'; },
    () => { SCENARIO_CATALOG.languages[0].code = 'en'; },
    () => { SCENARIOS.push({ id: 'unexpected' }); },
    () => { first.voice = 'Riko'; },
    () => { first.fictionalData.objects.push('unexpected'); },
    () => { first.steps[0].instruction = 'changed'; },
    () => { first.reference.status = 'verified'; },
    () => { first.reference.fictionalData.objects[0] = 'changed'; },
    () => { first.requiredChecks.splice(0, 1); },
  ]) assert.throws(mutate, TypeError);
  assert.equal(getScenario(first.id), first);
  assert.equal(first.voice, 'Zephyr');
  assert.equal(first.reference.status, 'requires_human_reference');
});

test('scenario lookup is exact and never silently substitutes a language or voice', () => {
  for (const scenario of SCENARIOS) assert.equal(getScenario(scenario.id), scenario);
  for (const id of ['ha', 'HA-greeting_language_preference', 'ha-riko_narration', 'en-NG-clarification', '', null, undefined, 0, {}, '__proto__']) assert.equal(getScenario(id), undefined);
});

test('template starts fully unreviewed and retains scenario, language and fictional-data bindings', () => {
  const template = createEvaluationTemplate();
  assert.equal(template.schemaVersion, 'voice-evaluation-template-v1');
  assert.equal(template.scenarioVersion, SCENARIO_VERSION);
  assert.equal(template.dataClass, 'fictional_nonclinical');
  assert.equal(template.resultStatus, 'not_run');
  assert.deepEqual(template.limitations, SCENARIO_CATALOG.limitations);
  assert.equal(template.scenarios.length, SCENARIOS.length);
  for (const entry of template.scenarios) {
    const scenario = getScenario(entry.scenarioId);
    for (const key of ['scenarioVersion', 'language', 'mode', 'voice', 'dataClass']) assert.equal(entry[key], scenario[key]);
    assert.deepEqual(entry.fictionalData, scenario.fictionalData);
    assert.deepEqual(entry.reference, scenario.reference);
    assert.deepEqual(entry.checks.map(check => check.id), scenario.requiredChecks);
    assert.equal(entry.checks.every(check => check.status === 'not_reviewed' && check.evidenceRef === null && check.notes === null), true);
    assert.deepEqual(entry.evidence, []);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(template)), template);
});

test('editing one blank checklist cannot mutate another checklist or the catalog', () => {
  const first = createEvaluationTemplate();
  const second = createEvaluationTemplate();
  const original = JSON.stringify(SCENARIO_CATALOG);
  first.scenarios[0].fictionalData.objects[0] = 'changed';
  first.scenarios[0].reference.fictionalData.objects[0] = 'reference-only change';
  first.scenarios[0].reference.sourceScript = 'an unverified test string';
  first.scenarios[0].checks[0].status = 'changed';
  first.scenarios[0].evidence.push({ type: 'test-only' });
  first.limitations.pop();
  assert.equal(JSON.stringify(SCENARIO_CATALOG), original);
  assert.deepEqual(second, createEvaluationTemplate());
  assert.notEqual(first.scenarios[0].fictionalData, first.scenarios[0].reference.fictionalData);
  assert.equal(first.scenarios[1].checks[0].status, 'not_reviewed');
  assert.equal(first.scenarios[1].reference.sourceScript, null);
});

test('subset templates preserve requested order without sharing selection arrays', () => {
  const scenarioIds = ['yo-barge_in', 'ha-correction_negation', 'en-NG-riko_narration'];
  const template = createEvaluationTemplate({ scenarioIds });
  assert.deepEqual(template.scenarios.map(scenario => scenario.scenarioId), scenarioIds);
  scenarioIds[0] = 'ig-stop_consent';
  assert.equal(template.scenarios[0].scenarioId, 'yo-barge_in');
  assert.equal(template.scenarios[2].voice, 'Riko');
});

test('invalid or misspelled template selections fail rather than silently dropping coverage', () => {
  for (const options of [null, [], 'ha', 1, { unexpected: true }, { scenarioIds: undefined }, { scenarioIds: null }, { scenarioIds: [] }, { scenarioIds: Array(1) }, { scenarioIds: 'ha-clarification' }, { scenarioIds: [0] }, { scenarioIds: ['ha-clarification', 'ha-clarification'] }, { scenarioIds: Array(23).fill('ha-clarification') }]) {
    assert.throws(() => createEvaluationTemplate(options), TypeError);
  }
  for (const id of ['unknown', 'ha-Clarification', '__proto__']) assert.throws(() => createEvaluationTemplate({ scenarioIds: [id] }), RangeError);
});

test('numbers and dates stay attached to fictional everyday props, not medical scenarios', () => {
  for (const language of ['ha', 'ig', 'yo']) {
    const scenario = getScenario(`${language}-everyday_numbers_time_dates`);
    assert.deepEqual(scenario.fictionalData, {
      scene: 'fictional tabletop display', cupCount: 3, bookCount: 12, clockFace: '14:30',
      calendarCard: '2030-04-05', dateMeaningEnglish: '5 April 2030',
      timeBasis: 'a printed clock face, not a real appointment or local time',
    });
    assert.equal(scenario.requiredChecks.includes('number_object_pairs_preserved'), true);
    assert.equal(scenario.requiredChecks.includes('calendar_date_preserved'), true);
    const correction = getScenario(`${language}-correction_negation`);
    assert.equal(correction.requiredChecks.includes('negation_preserved'), true);
    const clarification = getScenario(`${language}-clarification`);
    assert.equal(clarification.fictionalData.ambiguousTarget, null);
    assert.equal(clarification.requiredChecks.includes('unsupported_meaning_not_invented'), true);
  }
});

test('interruption and consent scenarios require observable cleanup instead of assumed success', () => {
  for (const language of ['ha', 'ig', 'yo']) {
    const interruption = getScenario(`${language}-barge_in`);
    for (const check of ['audible_output_before_interruption_confirmed', 'barge_in_stops_old_audio', 'no_stale_audio_after_interruption', 'interruption_timing_measured']) assert.equal(interruption.requiredChecks.includes(check), true);
    const consent = getScenario(`${language}-stop_consent`);
    assert.deepEqual(consent.steps.map(step => step.action), ['attempt_without_consent', 'grant_test_consent', 'speak', 'withdraw_consent', 'observe_late_events', 'attempt_without_consent', 'press_stop']);
    for (const check of ['no_capture_before_consent', 'withdrawal_stops_local_capture', 'late_events_ignored', 'restart_requires_fresh_consent', 'cleanup_claims_match_evidence']) assert.equal(consent.requiredChecks.includes(check), true);
    assert.match(consent.steps.find(step => step.id === 'spoken_stop').expectedBehavior, /Do not assume that silence proves microphone shutdown/);
  }
});

test('Riko is a separate Nigerian-English narration review without conversation-quality claims', () => {
  const narration = SCENARIOS.filter(scenario => scenario.mode === 'narration');
  assert.equal(narration.length, 1);
  assert.equal(narration[0].id, 'en-NG-riko_narration');
  assert.equal(narration[0].voice, 'Riko');
  assert.equal(narration[0].language, 'en-NG');
  assert.equal(narration[0].reference.status, 'requires_human_reference');
  assert.equal(narration[0].reference.sourceScript, null);
  assert.equal(narration[0].requiredChecks.includes('riko_kept_separate_from_live_conversation'), true);
  assert.equal(SCENARIOS.filter(scenario => scenario.voice === 'Riko').length, 1);
  assert.match(narration[0].steps[1].expectedBehavior, /does not test conversational understanding or interruption/);
  assert.match(SCENARIO_CATALOG.limitations.join(' '), /not evidence of spoken-language accuracy/);
});
