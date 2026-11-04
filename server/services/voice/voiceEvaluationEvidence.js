'use strict';
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { getScenario } = require('../../../lib/voice/evaluationScenarios.cjs');
const { TRACE_EVENTS } = require('../../../lib/voice/evaluationTrace.cjs');
const SCHEMA = 'voice-evaluation-trial-v1', REPORT = 'voice-evaluation-report-v1';
const DATA_CLASS = 'fictional_nonclinical';
const TARGETS = Object.freeze({ interruptionClearMs: 250, microphoneStopMs: 500, socketCloseMs: 3000, providerCloseMs: 3500 });
const hash = value => createHash('sha256').update(value).digest('hex');
const ref = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const invalid = field => Object.assign(new Error('Evaluation evidence is invalid.'), { code: 'VOICE_EVALUATION_INPUT_INVALID', field });
function boundedJSON(value) {
  const pending = [[value, 0]], visited = new Set(); let nodes = 0, bytes = 0;
  while (pending.length) {
    const [item, depth] = pending.pop();
    if (++nodes > 25000 || depth > 20) throw invalid('evidence_size');
    if (typeof item === 'string') { bytes += Buffer.byteLength(item); if (bytes > 262144) throw invalid('evidence_size'); continue; }
    if (item == null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) continue;
    if (typeof item !== 'object' || visited.has(item) || (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item)))) throw invalid('evidence_shape');
    visited.add(item);
    for (const key of Reflect.ownKeys(item)) {
      if (key === 'length' && Array.isArray(item)) continue;
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)) throw invalid('evidence_shape');
      const descriptor = Object.getOwnPropertyDescriptor(item, key); if (!Object.hasOwn(descriptor, 'value')) throw invalid('evidence_shape');
      pending.push([descriptor.value, depth + 1]);
    }
  }
}
function only(value, keys, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw invalid(field);
}
function scenarioFor(trial) {
  const scenario = getScenario(trial?.scenarioId);
  if (!scenario || trial.scenarioVersion !== scenario.scenarioVersion || trial.language !== scenario.language
    || trial.mode !== scenario.mode || trial.voice !== scenario.voice || trial.dataClass !== DATA_CLASS) throw invalid('scenario_binding');
  return scenario;
}
function createEvaluationTrial(scenarioId) {
  const scenario = getScenario(scenarioId); if (!scenario) throw invalid('scenario_id');
  return {
    schemaVersion: SCHEMA, trialId: null, scenarioId: scenario.id, scenarioVersion: scenario.scenarioVersion,
    language: scenario.language, mode: scenario.mode, voice: scenario.voice, dataClass: DATA_CLASS,
    run: { mode: 'not_run', environment: 'development', inputMode: scenario.mode === 'narration' ? 'tts_text' : 'spoken', applicationRevision: null, providerModel: null },
    reference: structuredClone(scenario.reference), observedTranscript: null, recordings: [], trace: [],
    review: { status: 'not_reviewed', reviewerAlias: null, language: scenario.language, declaredFluency: 'not_stated',
      basis: 'not_supplied', reviewedAt: null, trialFingerprint: null, recordingSha256: [],
      checks: scenario.requiredChecks.map(id => ({ id, status: 'not_reviewed' })) },
  };
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function referenceFingerprint(reference) { boundedJSON(reference); return hash(JSON.stringify(canonical(reference))); }
function normalizeTranscript(value) { return value.normalize('NFC').trim().replace(/\s+/gu, ' '); }
function distance(reference, observed, maximumCells) {
  if (reference.length * observed.length > maximumCells) return { status: 'comparison_too_large' };
  let previous = Array.from({ length: observed.length + 1 }, (_, insertions) => ({ errors: insertions, substitutions: 0, deletions: 0, insertions }));
  for (let r = 1; r <= reference.length; r++) {
    const current = [{ errors: r, substitutions: 0, deletions: r, insertions: 0 }];
    for (let h = 1; h <= observed.length; h++) {
      const changed = reference[r - 1] !== observed[h - 1], diagonal = previous[h - 1];
      let best = { ...diagonal, errors: diagonal.errors + Number(changed), substitutions: diagonal.substitutions + Number(changed) };
      if (previous[h].errors + 1 < best.errors) best = { ...previous[h], errors: previous[h].errors + 1, deletions: previous[h].deletions + 1 };
      if (current[h - 1].errors + 1 < best.errors) best = { ...current[h - 1], errors: current[h - 1].errors + 1, insertions: current[h - 1].insertions + 1 };
      current.push(best);
    }
    previous = current;
  }
  return { status: 'computed', ...previous.at(-1), referenceUnits: reference.length, observedUnits: observed.length,
    errorRate: previous.at(-1).errors / reference.length };
}
function compareTranscripts(reference, observed) {
  if (!text(reference) || typeof observed !== 'string' || reference.length > 16384 || observed.length > 16384) throw invalid('transcript');
  const expected = normalizeTranscript(reference), actual = normalizeTranscript(observed);
  return { normalization: 'NFC and collapsed whitespace; case, punctuation and tone marks preserved',
    meaningOrAccentVerified: false,
    whitespaceTokenError: distance(expected.split(' '), actual ? actual.split(' ') : [], 1000000),
    unicodeCodePointError: distance([...expected], [...actual], 4000000) };
}
function analyzeSessionTrace(trace) {
  if (!Array.isArray(trace) || trace.length > 5000) throw invalid('trace');
  let last = -1, consent = false, stopped = false, ready = false, micRequested = false, micStarted = false, microphonePaused = false;
  let startRequested = false, captureEnded = false, socketClosed = false, providerClosed = false, outputPlaying = false, outputQueued = false, pendingAttempts = 0;
  const violations = [], measurements = [], missing = [];
  const first = type => trace.find(event => event.type === type);
  for (const event of trace) {
    only(event, ['type', 'atMs', 'sessionRef'], 'trace_event');
    if (!TRACE_EVENTS.includes(event.type) || !Number.isSafeInteger(event.atMs) || event.atMs < 0 || event.atMs < last || event.atMs > 600000) throw invalid('trace_event');
    last = event.atMs;
    if (event.type === 'consent.granted') consent = true;
    if (event.type === 'consent.withdrawn') { consent = false; stopped = true; }
    if (event.type === 'stop.requested' || event.type === 'visibility.hidden' || event.type === 'language.changed' || event.type === 'session.expired') stopped = true;
    if (event.type === 'start.attempted') pendingAttempts++;
    if (event.type === 'start.denied') { if (!pendingAttempts) violations.push('denial_without_reported_attempt'); else pendingAttempts--; }
    if (event.type === 'start.requested') { if (startRequested) violations.push('duplicate_session_start'); startRequested = true; if (pendingAttempts) pendingAttempts--; }
    const activeEvent = ['start.requested', 'provider.ready', 'microphone.requested', 'microphone.started', 'microphone.resumed', 'audio.input.sent', 'audio.output.queued', 'audio.output.scheduled', 'audio.output.started'].includes(event.type);
    if (activeEvent && !consent) violations.push('capture_or_start_without_reported_consent');
    if (activeEvent && stopped) violations.push('activity_after_stop_or_withdrawal');
    if (activeEvent && (socketClosed || providerClosed)) violations.push('activity_after_reported_connection_closed');
    if (event.type === 'provider.ready') { if (ready) violations.push('duplicate_provider_ready'); if (!startRequested) violations.push('provider_ready_without_start'); ready = true; }
    if (['microphone.requested', 'microphone.started', 'microphone.resumed', 'audio.input.sent', 'audio.output.queued', 'audio.output.scheduled', 'audio.output.started'].includes(event.type) && !ready) violations.push('capture_or_output_before_reported_provider_ready');
    if (event.type === 'microphone.requested') { if (micRequested) violations.push('duplicate_microphone_request'); micRequested = true; }
    if (event.type === 'microphone.started') {
      if (!micRequested) violations.push('capture_without_microphone_request'); if (micStarted) violations.push('duplicate_microphone_start');
      if (captureEnded) violations.push('capture_restarted_in_ended_session'); micStarted = true;
    }
    if (event.type === 'microphone.stopped') { if (!micRequested) violations.push('microphone_release_without_request'); micStarted = false; captureEnded = true; }
    if (event.type === 'microphone.paused') { if (!micStarted) violations.push('pause_without_reported_capture'); microphonePaused = true; }
    if (event.type === 'microphone.resumed') { if (!micStarted) violations.push('resume_without_reported_capture'); microphonePaused = false; }
    if (event.type === 'audio.input.sent' && (!micStarted || microphonePaused)) violations.push('audio_sent_without_reported_capture');
    if (['audio.output.queued', 'audio.output.scheduled'].includes(event.type)) outputQueued = true;
    if (['playback.cleared', 'playback.queue_drained'].includes(event.type)) outputQueued = false;
    if (event.type === 'audio.output.started') outputPlaying = true;
    if (event.type === 'interrupt.detected' && !outputPlaying) missing.push('interruption_without_reported_playback');
    if (event.type === 'audio.output.stopped') outputPlaying = false;
    if (event.type === 'socket.closed') { socketClosed = true; ready = false; }
    if (event.type === 'provider.closed') { providerClosed = true; ready = false; }
  }
  const blockedAttemptOnly = trace.length > 0 && trace.every(event => ['start.attempted', 'start.denied'].includes(event.type));
  if (blockedAttemptOnly) {
    if (!first('start.attempted') || pendingAttempts) missing.push('denied_attempt_outcome_not_observed');
  } else if (trace.length) {
    if (!first('consent.granted')) missing.push('consent_not_observed');
    if (!first('stop.requested')) missing.push('stop_not_observed');
    if (micRequested && !first('microphone.stopped')) missing.push('microphone_release_not_observed');
    if (!first('socket.closed')) missing.push('socket_closure_not_observed');
    if (first('provider.ready') && !first('provider.closed')) missing.push('provider_closure_not_observed');
    if (!first('captions.cleared')) missing.push('caption_clear_not_observed');
    if (pendingAttempts) missing.push('attempt_outcome_not_observed');
  }
  // Equal millisecond values do not make earlier events later observations.
  // Preserve the supplied sequence when resolving uncertainty and measuring
  // trigger-dependent cleanup, including traces from a coarse local clock.
  for (const [unconfirmedType, resolvedType, label] of [
    ['provider.close_unconfirmed', 'provider.closed', 'provider_closure_unconfirmed'],
    ['socket.close_unconfirmed', 'socket.closed', 'socket_closure_unconfirmed'],
    ['microphone.stop_unconfirmed', 'microphone.stopped', 'microphone_release_unconfirmed'],
    ['playback.clear_unconfirmed', 'playback.cleared', 'playback_clear_unconfirmed'],
    ['audio.contexts.close_unconfirmed', 'audio.contexts.closed', 'audio_context_closure_unconfirmed'],
  ]) {
    const pendingIndex = trace.findLastIndex(event => event.type === unconfirmedType);
    if (pendingIndex !== -1 && !trace.some((event, index) => index > pendingIndex && event.type === resolvedType)) missing.push(label);
  }
  function measure(start, finishType, label, target, allowPrior = false) {
    const startIndex = trace.indexOf(start);
    const finishIndex = trace.findIndex((event, index) => index > startIndex && event.type === finishType);
    const priorIndex = allowPrior ? trace.findIndex(event => event.type === finishType) : -1;
    const selectedIndex = finishIndex !== -1 ? finishIndex : priorIndex;
    const finish = trace[selectedIndex];
    if (!finish) { missing.push(label + '_not_observed'); return; }
    const elapsedMs = Math.max(0, finish.atMs - start.atMs);
    measurements.push({ name: label, elapsedMs, ...(selectedIndex < startIndex ? { completedBeforeTrigger: true } : {}), provisionalEngineeringTargetMs: target, targetStatus: elapsedMs <= target ? 'within_provisional_target' : 'over_provisional_target', acousticLatencyVerified: false });
  }
  for (const interrupted of trace.filter(event => event.type === 'interrupt.detected')) measure(interrupted, 'playback.cleared', 'interruption_clear', TARGETS.interruptionClearMs);
  const stop = trace.find(event => ['stop.requested', 'consent.withdrawn', 'visibility.hidden', 'language.changed', 'session.expired'].includes(event.type));
  if (stop) {
    if (micRequested) measure(stop, 'microphone.stopped', 'microphone_stop', TARGETS.microphoneStopMs, true);
    measure(stop, 'socket.closed', 'socket_close', TARGETS.socketCloseMs, true);
    if (first('provider.ready')) measure(stop, 'provider.closed', 'provider_close', TARGETS.providerCloseMs, true);
    if (!trace.some((event, index) => event.type === 'captions.cleared' && index > trace.indexOf(stop))) missing.push('caption_clear_after_stop_not_observed');
    if (outputPlaying) missing.push('output_stop_not_observed');
    if (outputQueued) missing.push('playback_queue_clear_not_observed');
  }
  return { status: !trace.length ? 'not_evaluated' : violations.length ? 'reported_trace_violations' : missing.length ? 'incomplete_reported_trace' : 'reported_trace_consistent',
    provenance: 'supplied_observations_not_independently_attested', eventCount: trace.length,
    violations: [...new Set(violations)], missing: [...new Set(missing)], measurements, finalProviderUsageVerified: false };
}
function analyzeTrace(trace) {
  if (!Array.isArray(trace) || trace.length > 5000) throw invalid('trace');
  const groups = new Map(); let last = -1;
  for (const event of trace) {
    only(event, ['type', 'atMs', 'sessionRef'], 'trace_event');
    if (!TRACE_EVENTS.includes(event.type) || !Number.isSafeInteger(event.atMs) || event.atMs < 0 || event.atMs < last || event.atMs > 600000
      || (event.sessionRef !== undefined && !ref(event.sessionRef))) throw invalid('trace_event');
    last = event.atMs; const sessionRef = event.sessionRef || 'session-1';
    if (!groups.has(sessionRef)) groups.set(sessionRef, []); groups.get(sessionRef).push(event);
  }
  if (groups.size > 1 && trace.some(event => event.sessionRef === undefined)) throw invalid('trace_session_binding');
  const sessions = [...groups].map(([sessionRef, events]) => ({ sessionRef, ...analyzeSessionTrace(events) }));
  return { status: !trace.length ? 'not_evaluated' : sessions.some(item => item.violations.length) ? 'reported_trace_violations'
    : sessions.some(item => item.missing.length) ? 'incomplete_reported_trace' : 'reported_trace_consistent',
    provenance: 'supplied_observations_not_independently_attested', eventCount: trace.length, sessions,
    violations: [...new Set(sessions.flatMap(item => item.violations))], missing: [...new Set(sessions.flatMap(item => item.missing))],
    measurements: sessions.flatMap(item => item.measurements.map(measurement => ({ sessionRef: item.sessionRef, ...measurement }))), finalProviderUsageVerified: false };
}
function analyzeEvaluationTrial(trial, { artifacts = [] } = {}) {
  boundedJSON(trial); boundedJSON(artifacts);
  only(trial, ['schemaVersion', 'trialId', 'scenarioId', 'scenarioVersion', 'language', 'mode', 'voice', 'dataClass', 'run', 'reference', 'observedTranscript', 'recordings', 'trace', 'review'], 'trial');
  if (trial.schemaVersion !== SCHEMA || (trial.trialId !== null && !ref(trial.trialId))) throw invalid('trial_id');
  const scenario = scenarioFor(trial), issues = [];
  only(trial.run, ['mode', 'environment', 'inputMode', 'applicationRevision', 'providerModel'], 'run');
  if (!['not_run', 'synthetic_fixture', 'recorded_trial'].includes(trial.run.mode) || trial.run.environment !== 'development'
    || trial.run.inputMode !== (scenario.mode === 'narration' ? 'tts_text' : 'spoken')) throw invalid('run');
  if (trial.run.applicationRevision !== null && !/^[a-f0-9]{40}$/.test(trial.run.applicationRevision)) throw invalid('application_revision');
  if (trial.run.providerModel !== null && trial.run.providerModel !== (scenario.mode === 'narration' ? 'gemini-3.8-flash-tts' : 'gemini-3.8-live')) throw invalid('model');
  if (!trial.trialId) issues.push('trial_id_missing');
  if (trial.run.mode !== 'recorded_trial') issues.push('no_recorded_trial');
  if (!trial.run.applicationRevision || !trial.run.providerModel) issues.push('run_provenance_incomplete');
  const reference = trial.reference;
  only(reference, Object.keys(scenario.reference), 'reference');
  if (reference.scenarioId !== scenario.id || reference.scenarioVersion !== scenario.scenarioVersion || reference.language !== scenario.language
    || reference.dataClass !== DATA_CLASS || !isDeepStrictEqual(reference.fictionalData, scenario.fictionalData)
    || !['requires_human_reference', 'reviewer_supplied'].includes(reference.status)) throw invalid('reference_binding');
  if (reference.reviewer !== null) only(reference.reviewer, ['alias', 'language', 'declaredFluency'], 'reference_reviewer');
  const hasReference = reference.status === 'reviewer_supplied' && text(reference.sourceScript) && text(reference.expectedTranscript)
    && text(reference.expectedMeaningEnglish) && ref(reference.referenceVersion) && text(reference.languageVariety)
    && ref(reference.reviewer?.alias) && reference.reviewer?.language === scenario.language
    && ['native', 'professional'].includes(reference.reviewer?.declaredFluency) && Number.isFinite(Date.parse(reference.reviewedAt));
  if (!hasReference) issues.push('human_reference_missing_or_incomplete');
  if (trial.observedTranscript !== null && typeof trial.observedTranscript !== 'string') throw invalid('observed_transcript');
  // Null means no observation was supplied. An explicitly empty string is a
  // real (possibly total) omission and must remain available for error counts.
  if (trial.observedTranscript === null) issues.push('observed_transcript_missing');
  if (!Array.isArray(trial.recordings) || trial.recordings.length > 8 || !Array.isArray(artifacts)) throw invalid('recordings');
  const identifiers = new Set();
  for (const recording of trial.recordings) {
    only(recording, ['id', 'role', 'path', 'sha256'], 'recording');
    if (!ref(recording.id) || identifiers.has(recording.id) || !['input', 'output', 'duplex'].includes(recording.role)
      || !text(recording.path) || !/^[a-f0-9]{64}$/.test(recording.sha256)) throw invalid('recording');
    identifiers.add(recording.id);
  }
  const matchingArtifacts = trial.recordings.filter(recording => artifacts.some(item => item.id === recording.id && item.sha256 === recording.sha256 && item.status === 'header_and_hash_checked'));
  if (matchingArtifacts.length !== trial.recordings.length) issues.push('recording_hash_or_header_not_checked');
  const hasOutput = matchingArtifacts.some(item => ['output', 'duplex'].includes(item.role));
  const hasInput = matchingArtifacts.some(item => ['input', 'duplex'].includes(item.role));
  if (!hasOutput || (scenario.mode === 'conversation' && !hasInput)) issues.push('required_audio_recording_missing');
  const lifecycle = analyzeTrace(trial.trace);
  if (scenario.mode === 'conversation' && lifecycle.status !== 'reported_trace_consistent') issues.push('lifecycle_evidence_incomplete_or_violated');
  if (scenario.mode === 'conversation' && !['microphone.started', 'audio.input.sent', 'audio.output.started'].every(type => trial.trace.some(event => event.type === type))) issues.push('spoken_turn_events_not_observed');
  if (scenario.category === 'barge_in' && !trial.trace.some(event => event.type === 'interrupt.detected')) issues.push('barge_in_not_observed');
  if (scenario.category === 'stop_consent' && !trial.trace.some(event => event.type === 'consent.withdrawn')) issues.push('consent_withdrawal_not_observed');
  const refHash = referenceFingerprint(reference), transcriptHash = hash(JSON.stringify(trial.observedTranscript));
  const fingerprint = hash(JSON.stringify(canonical({ schemaVersion: SCHEMA, trialId: trial.trialId, scenarioId: scenario.id, scenarioVersion: scenario.scenarioVersion,
    language: scenario.language, mode: scenario.mode, voice: scenario.voice, referenceFingerprint: refHash, transcriptSha256: transcriptHash,
    run: trial.run, recordings: trial.recordings, trace: trial.trace })));
  const review = trial.review;
  only(review, ['status', 'reviewerAlias', 'language', 'declaredFluency', 'basis', 'reviewedAt', 'trialFingerprint', 'recordingSha256', 'checks'], 'review');
  if (!['not_reviewed', 'completed'].includes(review.status) || !Array.isArray(review.checks) || !Array.isArray(review.recordingSha256)) throw invalid('review');
  const seen = new Set();
  for (const check of review.checks) {
    only(check, ['id', 'status'], 'review_check');
    if (!scenario.requiredChecks.includes(check.id) || seen.has(check.id) || !['not_reviewed', 'acceptable', 'needs_work', 'not_applicable'].includes(check.status)) throw invalid('review_check');
    seen.add(check.id);
  }
  const reviewComplete = review.status === 'completed' && ref(review.reviewerAlias) && review.language === scenario.language
    && ['native', 'professional'].includes(review.declaredFluency) && review.basis === 'listened_to_recordings'
    && Number.isFinite(Date.parse(review.reviewedAt)) && review.trialFingerprint === fingerprint
    && review.checks.length === scenario.requiredChecks.length && review.checks.every(check => ['acceptable', 'needs_work'].includes(check.status))
    && isDeepStrictEqual([...new Set(review.recordingSha256)].sort(), [...new Set(trial.recordings.map(item => item.sha256))].sort())
    && hasReference && hasOutput && (scenario.mode !== 'conversation' || hasInput) && matchingArtifacts.length === trial.recordings.length
    && trial.run.mode === 'recorded_trial' && typeof trial.observedTranscript === 'string';
  if (!reviewComplete) issues.push(review.status === 'completed' ? 'human_review_stale_or_incomplete' : 'human_listening_review_missing');
  return { schemaVersion: REPORT, trialId: trial.trialId, scenarioId: scenario.id, scenarioVersion: scenario.scenarioVersion,
    language: scenario.language, voice: scenario.voice, evidenceClass: trial.run.mode,
    completeness: issues.length ? 'incomplete' : 'review_supplied', issues,
    trialFingerprint: fingerprint, referenceFingerprint: refHash,
    referenceStatus: hasReference ? 'reviewer_supplied_not_independently_verified' : 'requires_human_reference',
    transcriptComparison: hasReference && typeof trial.observedTranscript === 'string' ? compareTranscripts(reference.expectedTranscript, trial.observedTranscript) : { status: 'not_evaluated', meaningOrAccentVerified: false },
    lifecycle, artifacts: artifacts.map(item => ({ id: item.id, sha256: item.sha256, status: item.status, format: item.format, bytes: item.bytes, audioContentVerified: false })),
    humanReview: { status: reviewComplete ? 'review_supplied_not_independently_verified' : 'not_evaluated',
      reportedChecks: reviewComplete ? review.checks.map(check => ({ ...check })) : [], reviewerIdentityOrFluencyVerified: false },
    languageAccuracyValidated: false, accentValidated: false, contentScopeVerified: false, clinicalUseValidated: false, activationApproved: false,
    limitations: ['Text similarity is not comprehension, pronunciation, tonal accuracy or accent quality.',
      'Recording hashes/headers and supplied traces do not prove spoken content or human listening.',
      'Timing targets are provisional engineering checks, not validated product or clinical standards.',
      'This report cannot approve production, credentials, spending, clinical use or provider retention.'] };
}
module.exports = { SCHEMA, TARGETS, createEvaluationTrial, analyzeEvaluationTrial, analyzeTrace, compareTranscripts, referenceFingerprint };
