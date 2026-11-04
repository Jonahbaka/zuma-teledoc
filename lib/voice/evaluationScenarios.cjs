'use strict';

// Offline test definitions only. Importing this module does not capture audio,
// read credentials, contact a provider, or authorize an evaluation session.
// English directions are NOT native-language reference scripts or evidence.
const SCENARIO_VERSION = '2026-11-03-v1';
const DATA_CLASS = 'fictional_nonclinical';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const LANGUAGES = [
  { code: 'ha', name: 'Hausa' },
  { code: 'ig', name: 'Igbo' },
  { code: 'yo', name: 'Yoruba' },
];
const COMMON_CHECKS = ['fictional_nonclinical_scope_preserved', 'no_personal_information_requested'];
const CATEGORIES = [
  {
    category: 'greeting_language_preference',
    title: 'Greet and confirm language',
    fictionalData: { scene: 'fictional welcome table', visitor: 'Fictional visitor A', objects: ['cup', 'book'] },
    steps: [
      { id: 'greet', action: 'speak', instruction: 'Give a short natural greeting in the selected language using only the fictional welcome-table scene.', expectedBehavior: 'Respond to the greeting without asking for a name or patient details.' },
      { id: 'prefer_language', action: 'speak', instruction: 'State that the fictional visitor prefers to continue in the selected language.', expectedBehavior: 'Honor the selected language and ask at most one short question about the fictional objects.' },
    ],
    requiredChecks: ['greeting_meaning_preserved', 'language_preference_honored', 'pronunciation_and_naturalness_reviewed', 'one_question_at_a_time'],
  },
  {
    category: 'correction_negation',
    title: 'Preserve corrections and negation',
    fictionalData: { scene: 'fictional object table', initialObject: 'cup', rejectedColor: 'red', correctedColor: 'blue', initialCount: 2, correctedCount: 3 },
    steps: [
      { id: 'initial_detail', action: 'speak', instruction: 'Describe two red cups on the fictional table.', expectedBehavior: 'Track the initial description as fictional object information only.' },
      { id: 'correct_detail', action: 'speak', instruction: 'Correct the description: not red cups, but blue cups; three cups, not two.', expectedBehavior: 'Use the corrected color and count. Do not retain the negated values as current facts.' },
      { id: 'confirm_correction', action: 'speak', instruction: 'Ask which color and how many cups are now described.', expectedBehavior: 'Answer blue and three without reversing the negation or inventing additional objects.' },
    ],
    requiredChecks: ['correction_preserved', 'negation_preserved', 'final_object_facts_preserved', 'pronunciation_and_naturalness_reviewed'],
  },
  {
    category: 'everyday_numbers_time_dates',
    title: 'Read fictional object labels',
    fictionalData: { scene: 'fictional tabletop display', cupCount: 3, bookCount: 12, clockFace: '14:30', calendarCard: '2030-04-05', dateMeaningEnglish: '5 April 2030', timeBasis: 'a printed clock face, not a real appointment or local time' },
    steps: [
      { id: 'counts', action: 'speak', instruction: 'Describe a fictional display with three cups and twelve books, then request the two counts back.', expectedBehavior: 'Keep the objects and their counts paired correctly.' },
      { id: 'clock', action: 'speak', instruction: 'Read the fictional printed clock face showing 14:30 using natural wording in the selected language. Ask for the time shown, not the current time.', expectedBehavior: 'Preserve the clock-face time and clarify any ambiguity instead of inventing a timezone or appointment.' },
      { id: 'calendar', action: 'speak', instruction: 'Read a fictional calendar card meaning 5 April 2030. Use reviewer-approved unambiguous wording, then ask which date is printed.', expectedBehavior: 'Preserve day, month and year without confusing 5 April with 4 May or treating it as a patient date.' },
    ],
    requiredChecks: ['number_object_pairs_preserved', 'clock_time_preserved', 'calendar_date_preserved', 'ambiguity_not_silently_resolved', 'pronunciation_and_naturalness_reviewed'],
  },
  {
    category: 'code_switching',
    title: 'Keep language during code-switching',
    fictionalData: { scene: 'fictional object table', englishObjectTerm: 'notebook', objectCount: 2, conversationLanguage: 'selected scenario language' },
    steps: [
      { id: 'mixed_phrase', action: 'speak', instruction: 'Use natural selected-language speech containing the English object term notebook and the fictional count two. A qualified reviewer must decide the natural code-switch placement.', expectedBehavior: 'Preserve the object and count despite the English term.' },
      { id: 'continue_language', action: 'speak', instruction: 'Ask a short follow-up about the notebooks in the selected language without requesting a language change.', expectedBehavior: 'Continue in the selected language rather than silently switching the entire conversation to English.' },
    ],
    requiredChecks: ['code_switched_meaning_preserved', 'no_unrequested_language_switch', 'pronunciation_and_naturalness_reviewed'],
  },
  {
    category: 'clarification',
    title: 'Clarify a misunderstood phrase',
    fictionalData: { scene: 'fictional object table', objects: ['cup', 'book'], ambiguousTarget: null, clarifiedTarget: 'book' },
    steps: [
      { id: 'ambiguous_phrase', action: 'speak', instruction: 'A qualified reviewer must write a naturally ambiguous reference to one of the two fictional objects without revealing which one. Do not use a fabricated native phrase or infer a correct object from the English directions.', expectedBehavior: 'Ask a short clarifying question instead of claiming to know the intended object.' },
      { id: 'resolve_phrase', action: 'speak', instruction: 'Clarify that the intended fictional object is the book.', expectedBehavior: 'Use the clarification, acknowledge the corrected understanding and avoid inventing an earlier definite meaning.' },
    ],
    requiredChecks: ['clarification_requested', 'unsupported_meaning_not_invented', 'clarification_applied', 'pronunciation_and_naturalness_reviewed'],
  },
  {
    category: 'barge_in',
    title: 'Interrupt and replace a detail',
    fictionalData: { scene: 'fictional object table', initialObject: 'cup', correctedObject: 'book', initialCount: 2, correctedCount: 1 },
    steps: [
      { id: 'start_reply', action: 'speak', instruction: 'Ask for a short description of two fictional cups. Wait until output audio is actually audible before the next step.', expectedBehavior: 'Produce a short nonclinical response; a text fragment alone does not establish that audio started.' },
      { id: 'interrupt', action: 'interrupt_audio', instruction: 'While output audio is audible, interrupt with a reviewer-approved correction meaning one book, not two cups. Mark the actual interruption onset and audible output end.', expectedBehavior: 'Stop the old audio, clear queued old playback and attend to the new turn. Measure timing from audio or instrumented media evidence, not from captions alone.' },
      { id: 'after_interrupt', action: 'observe', instruction: 'Observe the reply to the corrected request and whether old queued audio resumes.', expectedBehavior: 'Respond about one book without replaying the interrupted description or speaking over the correction.' },
    ],
    requiredChecks: ['audible_output_before_interruption_confirmed', 'barge_in_stops_old_audio', 'no_stale_audio_after_interruption', 'interruption_timing_measured', 'corrected_turn_preserved'],
  },
  {
    category: 'stop_consent',
    title: 'Stop and withdraw consent',
    fictionalData: { scene: 'fictional welcome table', object: 'cup', consentNoticeVersion: 'voice-live-synthetic-v1', participantData: 'fictional script only' },
    steps: [
      { id: 'before_consent', action: 'attempt_without_consent', instruction: 'In an authorized test harness, leave consent unchecked and attempt to start. This scenario definition grants no consent or provider authorization.', expectedBehavior: 'No microphone capture or provider session begins without the required current consent and authority.' },
      { id: 'explicit_consent', action: 'grant_test_consent', instruction: 'Only in a separately authorized evaluation, explicitly acknowledge the current fictional-test notice and begin a short greeting or object turn.', expectedBehavior: 'Capture can begin only through the normal current-consent and authority gates.' },
      { id: 'spoken_stop', action: 'speak', instruction: 'Use a qualified reviewer-approved phrase meaning stop speaking. Observe the speech behavior separately from the explicit stop control.', expectedBehavior: 'Honor the spoken request. Do not assume that silence proves microphone shutdown, provider closure or consent withdrawal.' },
      { id: 'withdraw', action: 'withdraw_consent', instruction: 'Uncheck the explicit consent control while capture or playback is active.', expectedBehavior: 'Request immediate local capture/output shutdown, clear captions and queued output, and do not silently reconnect.' },
      { id: 'late_events', action: 'observe_late_events', instruction: 'In a controlled harness, deliver or observe late transcript/audio events from the withdrawn session.', expectedBehavior: 'Ignore stale events; do not display withdrawn-session captions or resume its audio.' },
      { id: 'restart_without_consent', action: 'attempt_without_consent', instruction: 'Attempt restart without acknowledging fresh consent.', expectedBehavior: 'Remain stopped. A previous acknowledgement cannot authorize the new session.' },
      { id: 'explicit_stop', action: 'press_stop', instruction: 'In a separately re-consented test session, use the explicit Stop control during playback, then press it again.', expectedBehavior: 'Stop safely and idempotently, clear consent and local content, and distinguish confirmed local cleanup from unconfirmed provider cleanup.' },
    ],
    requiredChecks: ['no_capture_before_consent', 'spoken_stop_request_honored', 'withdrawal_stops_local_capture', 'withdrawal_clears_playback_and_captions', 'late_events_ignored', 'restart_requires_fresh_consent', 'stop_is_idempotent', 'cleanup_claims_match_evidence'],
  },
];

function blankReference(scenario) {
  return {
    status: 'requires_human_reference',
    scenarioId: scenario.id,
    scenarioVersion: scenario.scenarioVersion,
    language: scenario.language,
    dataClass: scenario.dataClass,
    fictionalData: JSON.parse(JSON.stringify(scenario.fictionalData)),
    referenceVersion: null,
    sourceScript: null,
    expectedTranscript: null,
    expectedMeaningEnglish: null,
    languageVariety: null,
    reviewer: null,
    reviewedAt: null,
  };
}

const conversations = LANGUAGES.flatMap(language => CATEGORIES.map(definition => {
  const scenario = {
    id: `${language.code}-${definition.category}`,
    scenarioVersion: SCENARIO_VERSION,
    language: language.code,
    languageName: language.name,
    category: definition.category,
    title: definition.title,
    mode: 'conversation',
    voice: 'Zephyr',
    dataClass: DATA_CLASS,
    fictionalData: JSON.parse(JSON.stringify(definition.fictionalData)),
    reviewerInstructions: [
      `A qualified ${language.name} reviewer must supply the reference script, expected transcript and meaning, and record the language variety before a language-quality verdict.`,
      'Use only the fictional nonclinical scene. Do not supply participant identity, health information, patient records or real appointment details.',
      'English directions and provisional captions are not verified reference transcripts or proof of audio heard. Keep audio observations separate from event-only observations.',
    ],
    steps: JSON.parse(JSON.stringify(definition.steps)),
    requiredChecks: [...COMMON_CHECKS, ...definition.requiredChecks],
  };
  scenario.reference = blankReference(scenario);
  return scenario;
}));

const narration = {
  id: 'en-NG-riko_narration',
  scenarioVersion: SCENARIO_VERSION,
  language: 'en-NG',
  languageName: 'Nigerian English',
  category: 'riko_narration',
  title: 'Review separate Riko narration',
  mode: 'narration',
  voice: 'Riko',
  dataClass: DATA_CLASS,
  fictionalData: { scene: 'fictional welcome table', objects: ['cup', 'book'], purpose: 'short nonclinical demonstration introduction' },
  reviewerInstructions: [
    'A qualified Nigerian-English reviewer must author and approve a short nonclinical narration script and its expected transcript before review.',
    'Review the separate Riko narration artifact. Do not substitute it for the Zephyr conversation voice or infer Hausa, Igbo or Yoruba conversational ability from it.',
    'Assess the intended Nigerian-English variety with a qualified listener, without treating a voice name as proof of accent, pronunciation, quality or identity.',
  ],
  steps: [
    { id: 'prepare_script', action: 'prepare_reference', instruction: 'Write a brief Nigerian-English introduction describing only the fictional welcome table, cup and book. Do not make medical or validated-quality claims.', expectedBehavior: 'The qualified reviewer supplies the script and transcript; the catalog supplies neither a verified script nor audio.' },
    { id: 'review_audio', action: 'listen_to_narration', instruction: 'In a separately authorized workflow, compare the Riko narration audio with the approved script and record the evidence and listening conditions.', expectedBehavior: 'Assess wording, pronunciation, intended variety and naturalness using the actual audio. This does not test conversational understanding or interruption.' },
    { id: 'check_separation', action: 'inspect_voice_assignment', instruction: 'Check that the artifact is identified as separate Nigerian-English Riko narration.', expectedBehavior: 'No result is counted as a Hausa, Igbo or Yoruba conversation result or as evidence that Riko is the configured Live voice.' },
  ],
  requiredChecks: [...COMMON_CHECKS, 'narration_matches_approved_script', 'nigerian_english_variety_reviewed', 'pronunciation_and_naturalness_reviewed', 'riko_kept_separate_from_live_conversation'],
};
narration.reference = blankReference(narration);

const SCENARIO_CATALOG = deepFreeze({
  schemaVersion: 'voice-evaluation-catalog-v1',
  scenarioVersion: SCENARIO_VERSION,
  dataClass: DATA_CLASS,
  executionPolicy: 'offline_definitions_only',
  languageQualityStatus: 'not_evaluated',
  languages: LANGUAGES,
  narrationLanguage: { code: 'en-NG', name: 'Nigerian English' },
  limitations: [
    'Scenario coverage and passing harness tests are not evidence of spoken-language accuracy.',
    'All reference scripts and transcripts require a qualified human reviewer; none are supplied as verified translations.',
    'Live execution requires separately established authorization, current consent and provider safeguards. This catalog cannot grant them.',
    'Only fictional greetings, language preferences and everyday objects are in scope. No patient intake, medical advice or clinical release is authorized.',
    'Riko narration is a separate review and is not a Live conversation configuration.',
  ],
  scenarios: [...conversations, narration],
});
const SCENARIOS = SCENARIO_CATALOG.scenarios;

function getScenario(id) {
  return typeof id === 'string' ? SCENARIOS.find(scenario => scenario.id === id) : undefined;
}

// An editable, detached checklist, not an execution request or a scored result.
// Restrict selection to known IDs so a typo cannot silently omit test coverage.
function createEvaluationTemplate(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some(key => key !== 'scenarioIds')) throw new TypeError('Expected only an optional scenarioIds selection.');
  let selected = SCENARIO_CATALOG.scenarios;
  if (Object.hasOwn(options, 'scenarioIds')) {
    const ids = options.scenarioIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > selected.length
      || Array.from(ids).some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new TypeError('scenarioIds must be a nonempty list of unique catalog IDs.');
    const byId = new Map(selected.map(scenario => [scenario.id, scenario]));
    selected = ids.map(id => {
      if (!byId.has(id)) throw new RangeError('Unknown voice evaluation scenario ID.');
      return byId.get(id);
    });
  }
  return {
    schemaVersion: 'voice-evaluation-template-v1',
    scenarioVersion: SCENARIO_VERSION,
    dataClass: DATA_CLASS,
    resultStatus: 'not_run',
    limitations: [...SCENARIO_CATALOG.limitations],
    scenarios: selected.map(scenario => ({
      scenarioId: scenario.id,
      scenarioVersion: scenario.scenarioVersion,
      language: scenario.language,
      mode: scenario.mode,
      voice: scenario.voice,
      dataClass: scenario.dataClass,
      fictionalData: JSON.parse(JSON.stringify(scenario.fictionalData)),
      reference: JSON.parse(JSON.stringify(scenario.reference)),
      checks: scenario.requiredChecks.map(id => ({ id, status: 'not_reviewed', evidenceRef: null, notes: null })),
      evidence: [],
    })),
  };
}

module.exports = Object.freeze({ SCENARIO_CATALOG, SCENARIOS, SCENARIO_VERSION, getScenario, createEvaluationTemplate });
