'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { SCENARIOS } = require('../../../lib/voice/evaluationScenarios.cjs');
const { createEvaluationTrace } = require('../../../lib/voice/evaluationTrace.cjs');
const { createEvaluationTrial, analyzeEvaluationTrial, analyzeTrace, compareTranscripts, referenceFingerprint } = require('../../services/voice/voiceEvaluationEvidence');
const trace = (offset = 0, sessionRef) => [
  ['consent.granted', 0], ['start.requested', 1], ['provider.ready', 2], ['microphone.requested', 3], ['microphone.started', 4],
  ['audio.input.sent', 10], ['input.speech.ended', 50], ['audio.output.queued', 100], ['audio.output.started', 110],
  ['interrupt.detected', 200], ['playback.cleared', 215], ['audio.output.stopped', 216], ['consent.withdrawn', 300],
  ['stop.requested', 301], ['microphone.stopped', 302], ['socket.closed', 303], ['provider.closed', 304], ['captions.cleared', 305],
].map(([type, atMs]) => ({ type, atMs: atMs + offset, ...(sessionRef ? { sessionRef } : {}) }));
// English placeholder strings and reviewer identities below are fictional test
// metadata, NOT native-language reference text or real human reviews/audio.
function fixture(id = 'ha-correction_negation') {
  const trial = createEvaluationTrial(id);
  trial.trialId = 'fictional-trial'; trial.run.mode = 'recorded_trial'; trial.run.applicationRevision = 'a'.repeat(40);
  trial.run.providerModel = trial.mode === 'narration' ? 'gemini-3.8-flash-tts' : 'gemini-3.8-live';
  Object.assign(trial.reference, { status: 'reviewer_supplied', referenceVersion: 'fictional-reference-v1', sourceScript: 'Fictional fixture script only',
    expectedTranscript: 'not red, three', expectedMeaningEnglish: 'Fictional corrected object description', languageVariety: 'fictional-test-label',
    reviewer: { alias: 'fictional-reviewer', language: trial.language, declaredFluency: 'native' }, reviewedAt: '2026-11-03T18:00:00Z' });
  trial.observedTranscript = trial.reference.expectedTranscript; trial.trace = trial.mode === 'conversation' ? trace() : [];
  trial.recordings = [{ id: 'fictional-output', role: trial.mode === 'conversation' ? 'duplex' : 'output', path: 'fictional.wav', sha256: 'b'.repeat(64) }];
  const artifacts = [{ id: 'fictional-output', sha256: 'b'.repeat(64), bytes: 1000, format: 'wav_pcm16', status: 'header_and_hash_checked' }];
  function review() {
    Object.assign(trial.review, { status: 'completed', reviewerAlias: 'fictional-reviewer', language: trial.language, declaredFluency: 'native', basis: 'listened_to_recordings',
      reviewedAt: '2026-11-03T18:01:00Z', trialFingerprint: analyzeEvaluationTrial(trial, { artifacts }).trialFingerprint,
      recordingSha256: trial.recordings.map(item => item.sha256), checks: trial.review.checks.map(item => ({ id: item.id, status: 'acceptable' })) });
  }
  return { trial, artifacts, review, analyze: () => analyzeEvaluationTrial(trial, { artifacts }) };
}
test('every blank catalog trial stays incomplete with no audio, reference or human acceptance claim', () => {
  for (const scenario of SCENARIOS) {
    const result = analyzeEvaluationTrial(createEvaluationTrial(scenario.id));
    assert.equal(result.completeness, 'incomplete'); assert.equal(result.referenceStatus, 'requires_human_reference');
    assert.equal(result.humanReview.status, 'not_evaluated'); assert.equal(result.languageAccuracyValidated, false); assert.equal(result.accentValidated, false); assert.equal(result.activationApproved, false);
  }
});
test('complete supplied observations expose reviewer declarations, never validated language or activation', () => {
  const f = fixture(); f.review(); const result = f.analyze();
  assert.equal(result.completeness, 'review_supplied'); assert.equal(result.humanReview.status, 'review_supplied_not_independently_verified');
  assert.equal(result.transcriptComparison.whitespaceTokenError.errors, 0);
  for (const name of ['languageAccuracyValidated', 'accentValidated', 'contentScopeVerified', 'clinicalUseValidated', 'activationApproved']) assert.equal(result[name], false);
  assert.equal(result.humanReview.reviewerIdentityOrFluencyVerified, false); assert.equal(result.artifacts[0].audioContentVerified, false);
  assert.equal(JSON.stringify(result).includes(f.trial.observedTranscript), false);
});
test('reference, transcript, recording, trace and revision changes invalidate a previous human review', () => {
  for (const mutate of [t => { t.reference.expectedTranscript += ' changed'; }, t => { t.observedTranscript += ' changed'; }, t => { t.recordings[0].sha256 = 'c'.repeat(64); },
    t => { t.trace.at(-1).atMs++; }, t => { t.run.applicationRevision = 'd'.repeat(40); }, t => { t.reference.languageVariety = 'different'; }]) {
    const f = fixture(); f.review(); mutate(f.trial); const result = f.analyze(); assert.equal(result.humanReview.status, 'not_evaluated'); assert.ok(result.issues.includes('human_review_stale_or_incomplete'));
  }
});
test('review cannot substitute captions, unqualified/mismatched declarations, N/A or missing mandatory checks for listening', () => {
  for (const mutate of [t => { t.review.basis = 'read_transcript'; }, t => { t.review.language = 'yo'; }, t => { t.review.declaredFluency = 'not_stated'; },
    t => { t.review.checks.pop(); }, t => { t.review.checks[0].status = 'not_applicable'; }, t => { t.review.recordingSha256 = []; }, t => { t.review.reviewerAlias = null; }]) {
    const f = fixture(); f.review(); mutate(f.trial); assert.equal(f.analyze().humanReview.status, 'not_evaluated');
  }
});
test('fixture-only run cannot become a recorded human evaluation by adding a reviewer', () => {
  const f = fixture(); f.trial.run.mode = 'synthetic_fixture'; f.review(); const result = f.analyze();
  assert.equal(result.evidenceClass, 'synthetic_fixture'); assert.equal(result.humanReview.status, 'not_evaluated'); assert.ok(result.issues.includes('no_recorded_trial'));
});
test('stale/cross-language/scenario/model/voice/clinical binding is rejected rather than merged', () => {
  for (const mutate of [t => { t.language = 'yo'; }, t => { t.scenarioVersion = 'old'; }, t => { t.voice = 'Riko'; }, t => { t.dataClass = 'patient'; },
    t => { t.reference.language = 'ig'; }, t => { t.reference.fictionalData.correctedCount = 4; }, t => { t.run.providerModel = 'other'; }, t => { t.run.environment = 'production'; }]) {
    const f = fixture(); mutate(f.trial); assert.throws(f.analyze, { code: 'VOICE_EVALUATION_INPUT_INVALID' });
  }
});
test('Riko narration remains a separate en-NG review, with no invented live microphone requirement', () => {
  const f = fixture('en-NG-riko_narration'); f.review(); const result = f.analyze();
  assert.equal(result.completeness, 'review_supplied'); assert.equal(result.language, 'en-NG'); assert.equal(result.voice, 'Riko');
  assert.equal(result.lifecycle.status, 'not_evaluated'); assert.equal(result.accentValidated, false);
});
test('missing, unmatched or wrong-role recordings do not establish a listening review', () => {
  for (const mutate of [f => { f.artifacts.length = 0; }, f => { f.artifacts[0].sha256 = 'd'.repeat(64); }, f => { f.trial.recordings[0].role = 'input'; },
    f => { f.trial.recordings.length = 0; }, f => { f.artifacts[0].status = 'not_checked'; }]) {
    const f = fixture(); f.review(); mutate(f); assert.equal(f.analyze().humanReview.status, 'not_evaluated');
  }
});
test('reviewer needs-work findings remain visible and are not converted to an automated quality pass', () => {
  const f = fixture(); f.review(); f.trial.review.checks[0].status = 'needs_work'; const result = f.analyze();
  assert.equal(result.completeness, 'review_supplied'); assert.equal(result.humanReview.reportedChecks[0].status, 'needs_work'); assert.equal(result.languageAccuracyValidated, false);
});
test('a missing transcript cannot produce complete evidence, while an explicitly empty observation records omissions', () => {
  const absent = fixture(); absent.trial.observedTranscript = null; absent.review();
  assert.equal(absent.analyze().completeness, 'incomplete');
  assert.equal(absent.analyze().humanReview.status, 'not_evaluated');
  assert.ok(absent.analyze().issues.includes('observed_transcript_missing'));
  absent.trial.observedTranscript = '';
  assert.equal(absent.analyze().humanReview.status, 'not_evaluated');
  assert.ok(absent.analyze().issues.includes('human_review_stale_or_incomplete'));
  const empty = fixture(); empty.trial.observedTranscript = ''; empty.review();
  assert.equal(empty.analyze().completeness, 'review_supplied');
  assert.equal(empty.analyze().transcriptComparison.whitespaceTokenError.deletions, 3);
});
test('queued audio after playback ends still needs explicit queue cleanup evidence', () => {
  const events = trace().filter(event => !['interrupt.detected', 'playback.cleared'].includes(event.type));
  events.splice(events.findIndex(event => event.type === 'consent.withdrawn'), 0, { type: 'audio.output.queued', atMs: 250 });
  const result = analyzeTrace(events);
  assert.equal(result.status, 'incomplete_reported_trace');
  assert.ok(result.missing.includes('playback_queue_clear_not_observed'));
  events.push({ type: 'playback.cleared', atMs: 306 });
  assert.equal(analyzeTrace(events).status, 'reported_trace_consistent');
});
test('fingerprints are stable across JSON object-key order and change when reference content changes', () => {
  const f = fixture(), reversed = Object.fromEntries(Object.entries(f.trial.reference).reverse());
  assert.equal(referenceFingerprint(f.trial.reference), referenceFingerprint(reversed)); reversed.expectedTranscript += '!';
  assert.notEqual(referenceFingerprint(f.trial.reference), referenceFingerprint(reversed));
});
test('Unicode NFC/whitespace comparison preserves Yoruba/Igbo tone marks, case and punctuation', () => {
  assert.equal(compareTranscripts('Ẹ\u0301  ká', 'E\u0323\u0301\tká').unicodeCodePointError.errors, 0);
  assert.equal(compareTranscripts('ọ́', 'ọ').unicodeCodePointError.errors, 1);
  assert.equal(compareTranscripts('A.', 'a').whitespaceTokenError.errors, 1);
  assert.equal(compareTranscripts('ọ́', 'ọ́').meaningOrAccentVerified, false);
});
test('edit counts are descriptive, include omissions/insertions, and never treat empty reference as perfect', () => {
  const compared = compareTranscripts('not red, three', 'red, two').whitespaceTokenError;
  assert.equal(compared.deletions, 1); assert.equal(compared.substitutions, 1); assert.equal(compared.errorRate, 2 / 3);
  assert.equal(compareTranscripts('cup', '').whitespaceTokenError.deletions, 1);
  assert.equal(compareTranscripts('cup', 'cup book book').whitespaceTokenError.errorRate, 2);
  assert.throws(() => compareTranscripts(' ', ''), { code: 'VOICE_EVALUATION_INPUT_INVALID' });
  assert.equal(compareTranscripts('a '.repeat(2000), 'b '.repeat(2000)).whitespaceTokenError.status, 'comparison_too_large');
});
test('trace checks distinguish consent, startup, interruption and actual closure observations', () => {
  const result = analyzeTrace(trace()); assert.equal(result.status, 'reported_trace_consistent');
  assert.equal(result.measurements.find(item => item.name === 'interruption_clear').elapsedMs, 15);
  assert.equal(result.measurements.find(item => item.name === 'microphone_stop').elapsedMs, 2);
  assert.equal(result.finalProviderUsageVerified, false);
  for (const mutate of [events => { events.shift(); }, events => { events.splice(2, 1); }, events => { events.push({ type: 'audio.input.sent', atMs: 306 }); }]) {
    const events = trace(); mutate(events); assert.equal(analyzeTrace(events).status, 'reported_trace_violations');
  }
  const missing = trace().filter(event => event.type !== 'provider.closed'); assert.equal(analyzeTrace(missing).status, 'incomplete_reported_trace');
  assert.equal(analyzeTrace([]).status, 'not_evaluated');
});
test('cleanup latency starts at withdrawal, not a later Stop event that could hide a delay', () => {
  const events = trace().map(event => ['stop.requested', 'microphone.stopped', 'socket.closed', 'provider.closed', 'captions.cleared'].includes(event.type) ? { ...event, atMs: event.atMs + 1000 } : event);
  const measurement = analyzeTrace(events).measurements.find(item => item.name === 'microphone_stop');
  assert.equal(measurement.elapsedMs, 1002); assert.equal(measurement.targetStatus, 'over_provisional_target');
});
test('equal-time earlier cleanup cannot resolve a later uncertainty observation', () => {
  for (const [resolved, uncertain, missing] of [
    ['provider.closed', 'provider.close_unconfirmed', 'provider_closure_unconfirmed'],
    ['socket.closed', 'socket.close_unconfirmed', 'socket_closure_unconfirmed'],
    ['microphone.stopped', 'microphone.stop_unconfirmed', 'microphone_release_unconfirmed'],
    ['playback.cleared', 'playback.clear_unconfirmed', 'playback_clear_unconfirmed'],
    ['audio.contexts.closed', 'audio.contexts.close_unconfirmed', 'audio_context_closure_unconfirmed'],
  ]) {
    const events = [...trace(), { type: resolved, atMs: 400 }, { type: uncertain, atMs: 400 }];
    const result = analyzeTrace(events);
    assert.equal(result.status, 'incomplete_reported_trace', uncertain);
    assert.ok(result.missing.includes(missing), uncertain);
    events.push({ type: resolved, atMs: 400 });
    assert.equal(analyzeTrace(events).missing.includes(missing), false, resolved);
  }
});
test('interruption cleanup must follow each trigger even when timestamps are equal', () => {
  const events = trace().filter(event => event.type !== 'playback.cleared').map(event => ({ ...event, atMs: 0 }));
  const interruptIndex = events.findIndex(event => event.type === 'interrupt.detected');
  events.splice(interruptIndex, 0, { type: 'playback.cleared', atMs: 0 });
  assert.ok(analyzeTrace(events).missing.includes('interruption_clear_not_observed'));
  events.splice(interruptIndex + 2, 0, { type: 'playback.cleared', atMs: 0 });
  assert.equal(analyzeTrace(events).missing.includes('interruption_clear_not_observed'), false);
  events.splice(interruptIndex + 3, 0, { type: 'interrupt.detected', atMs: 0 });
  assert.ok(analyzeTrace(events).missing.includes('interruption_clear_not_observed'));
});
test('a caption clear before equal-time Stop does not satisfy clear-after-Stop evidence', () => {
  const events = trace().filter(event => event.type !== 'captions.cleared').map(event => ({ ...event, atMs: 0 }));
  events.splice(events.findIndex(event => event.type === 'consent.withdrawn'), 0, { type: 'captions.cleared', atMs: 0 });
  assert.ok(analyzeTrace(events).missing.includes('caption_clear_after_stop_not_observed'));
  events.push({ type: 'captions.cleared', atMs: 0 });
  assert.equal(analyzeTrace(events).missing.includes('caption_clear_after_stop_not_observed'), false);
});
test('equal-time cleanup before Stop is labeled as already completed rather than triggered cleanup', () => {
  for (const [type, name] of [['microphone.stopped', 'microphone_stop'], ['socket.closed', 'socket_close'], ['provider.closed', 'provider_close']]) {
    const events = trace().filter(event => event.type !== type).map(event => ({ ...event, atMs: 0 }));
    events.splice(events.findIndex(event => event.type === 'consent.withdrawn'), 0, { type, atMs: 0 });
    const measurement = analyzeTrace(events).measurements.find(item => item.name === name);
    assert.equal(measurement.elapsedMs, 0, type);
    assert.equal(measurement.completedBeforeTrigger, true, type);
  }
});
test('equal-time cleanup in another session cannot resolve earlier-session uncertainty', () => {
  const events = [...trace(0, 'first'), { type: 'provider.close_unconfirmed', atMs: 306, sessionRef: 'first' }, ...trace(400, 'second')]
    .map(event => ({ ...event, atMs: 0 }));
  const result = analyzeTrace(events);
  assert.ok(result.sessions.find(item => item.sessionRef === 'first').missing.includes('provider_closure_unconfirmed'));
  assert.equal(result.sessions.find(item => item.sessionRef === 'second').status, 'reported_trace_consistent');
});
test('re-consented sessions must have separate identity and cannot revive withdrawn session state', () => {
  const separate = [...trace(0, 'first'), ...trace(400, 'second')]; assert.equal(analyzeTrace(separate).status, 'reported_trace_consistent');
  assert.equal(analyzeTrace([...trace(), ...trace(400)]).status, 'reported_trace_violations');
  assert.throws(() => analyzeTrace([...trace(), ...trace(400, 'second')]), { field: 'trace_session_binding' });
  assert.equal(analyzeTrace([{ type: 'start.attempted', atMs: 0 }, { type: 'start.denied', atMs: 1 }]).status, 'reported_trace_consistent');
});
test('a barge-in or consent scenario cannot omit its named observation and still be complete', () => {
  for (const [id, event] of [['ha-barge_in', 'interrupt.detected'], ['ig-stop_consent', 'consent.withdrawn']]) {
    const f = fixture(id); f.trial.trace = f.trial.trace.filter(item => item.type !== event); f.review(); assert.equal(f.analyze().completeness, 'incomplete');
  }
});
test('traces reject backward/nonfinite times, unknown events and extra payloads rather than logging them', () => {
  for (const events of [[{ type: 'audio.raw', atMs: 0 }], [{ type: 'consent.granted', atMs: NaN }], [{ type: 'consent.granted', atMs: 2 }, { type: 'stop.requested', atMs: 1 }], [{ type: 'stop.requested', atMs: 0, text: 'not allowed' }]]) assert.throws(() => analyzeTrace(events));
});
test('local collector has monotonic bounded timestamps and immutable detached snapshots, without audio text', () => {
  let time = 100; const collector = createEvaluationTrace({ now: () => time, maxEvents: 2, sessionRef: 'fictional' });
  const event = collector.record('consent.granted'); assert.deepEqual(event, { type: 'consent.granted', atMs: 0, sessionRef: 'fictional' });
  assert.equal(Object.isFrozen(event), true); time = 101; collector.record('stop.requested');
  assert.throws(() => collector.record('socket.closed')); const snapshot = collector.snapshot(); snapshot.pop(); assert.equal(collector.snapshot().length, 2);
  collector.finish(); assert.throws(() => collector.record('stop.requested'));
  let backwards = 5; const other = createEvaluationTrace({ now: () => backwards }); backwards--; assert.throws(() => other.record('consent.granted'));
});
test('bounded JSON rejects accessors, huge evidence, prototypes and cyclic structures without evaluating getters', () => {
  const f = fixture(); let accessed = false; Object.defineProperty(f.trial, 'credential', { enumerable: true, get() { accessed = true; throw new Error('must not run'); } });
  assert.throws(f.analyze); assert.equal(accessed, false);
  const huge = fixture(); huge.trial.observedTranscript = 'x'.repeat(262145); assert.throws(huge.analyze);
  const cyclic = fixture(); cyclic.trial.review.loop = cyclic.trial; assert.throws(cyclic.analyze);
  const polluted = fixture(); polluted.trial.review = JSON.parse('{"__proto__":{}}'); assert.throws(polluted.analyze);
});
