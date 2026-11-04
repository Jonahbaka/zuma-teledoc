'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { runVoiceEvaluationSmoke } = require('../../../scripts/voice-evaluation-smoke.cjs');
const { FakeSocket } = require('./helpers/pcmBrowser.cjs');

const IDS = [
  'consent_required', 'start_deduplicated', 'pending_start_stop_blocks_late_permit',
  'pending_permission_stop_disables_late_stream', 'owned_capture_stop_clears_captions',
  'consent_withdrawal_clears_captions', 'interruption_clears_queued_pcm', 'renewed_acknowledgment_required'
];

function assertEvidence(report) {
  assert.equal(report.evidenceType, 'synthetic_transport_fixture');
  assert.equal(report.languageAccuracy, 'not_evaluated');
  assert.equal(report.accentAcceptance, 'not_evaluated');
  assert.equal(report.realMicrophone, false);
  assert.equal(report.realProvider, false);
  assert.equal(report.activationApproved, false);
}

test('all three languages traverse the actual panel and PCM controllers with separately named structural results', async () => {
  const report = await runVoiceEvaluationSmoke();
  assert.deepEqual(report.languages, ['ha', 'ig', 'yo']);
  assert.equal(report.mode, 'local_pcm_structural_smoke');
  assert.equal(report.structuralStatus, 'passed');
  assert.deepEqual(report.summary, { structuralChecks: 24, passed: 24, failed: 0 });
  assertEvidence(report);
  for (const result of report.results) {
    assertEvidence(result); assert.equal(result.structuralStatus, 'passed');
    assert.deepEqual(result.structuralChecks.map(check => check.id), IDS);
    for (const check of result.structuralChecks) {
      assert.equal(check.status, 'passed'); assert.equal(check.teardown.status, 'passed');
      assert.equal(check.teardown.activeCaptureTracks, 0); assert.equal(check.teardown.pendingTimers, 0);
      assert.equal(check.teardown.captionCount, 0); assert.equal(check.teardown.consentRetained, false);
      assert.equal(check.teardown.queuedPlaybackSources, 0); assert.equal(check.failures, undefined);
    }
    const check = id => result.structuralChecks.find(item => item.id === id);
    assert.equal(check('start_deduplicated').observed.syntheticPcmFramesSent, 1);
    assert.equal(check('interruption_clears_queued_pcm').observed.stoppedPcmSourcesAfterInterruption, 2);
    assert.equal(check('owned_capture_stop_clears_captions').teardown.fictionalContextsClosed, 2);
    assert.equal(check('renewed_acknowledgment_required').teardown.fictionalTracksStopped, 2);
  }
});

test('cancellation cannot acquire new media or send PCM after stop, including late fictional permission completion', async () => {
  const report = await runVoiceEvaluationSmoke();
  for (const { structuralChecks } of report.results) {
    const check = id => structuralChecks.find(item => item.id === id);
    assert.equal(check('pending_start_stop_blocks_late_permit').observed.fictionalMicrophoneRequestsAfterCancel, 0);
    assert.equal(check('pending_start_stop_blocks_late_permit').teardown.fictionalTracksStopped, 0);
    const pending = check('pending_permission_stop_disables_late_stream');
    assert.equal(pending.observed.permissionPendingWasReported, true);
    assert.equal(pending.observed.immediateReleaseWasUnconfirmed, true);
    assert.equal(pending.observed.lateFictionalTrackStopped, true);
    assert.equal(pending.observed.syntheticPcmFramesSent, 0);
    assert.equal(pending.teardown.fictionalContextsClosed, 0);
    assert.equal(pending.teardown.fictionalTracksStopped, 1);
    assert.equal(check('owned_capture_stop_clears_captions').observed.syntheticFramesSentAfterStop, 0);
    assert.equal(check('consent_withdrawal_clears_captions').observed.syntheticFramesSentAfterWithdrawal, 0);
    assert.equal(check('renewed_acknowledgment_required').observed.restartWithoutAcknowledgmentAccepted, false);
  }
});

test('selected language order is preserved and repeated runs have deterministic reports and teardown', async () => {
  const languages = Object.freeze(['yo', 'ha']);
  const first = await runVoiceEvaluationSmoke({ languages });
  assert.deepEqual(first, await runVoiceEvaluationSmoke({ languages }));
  assert.deepEqual(first.languages, ['yo', 'ha']);
  assert.deepEqual(first.results.map(result => result.language), ['yo', 'ha']);
  assert.deepEqual(first.summary, { structuralChecks: 16, passed: 16, failed: 0 });
});

test('unsupported, duplicate, sparse or empty inputs cannot masquerade as covered language evaluation', async () => {
  for (const options of [
    null, [], 'ha', 1, { language: 'ha' }, { realProvider: true },
    { languages: [] }, { languages: 'ha' }, { languages: null }, { languages: ['en'] },
    { languages: ['HA'] }, { languages: ['ha', 'ha'] }, { languages: ['ha', 'ig', 'yo', 'ha'] },
    { languages: [undefined] }, { languages: new Array(1) }
  ]) await assert.rejects(runVoiceEvaluationSmoke(options), { code: 'VOICE_SMOKE_OPTIONS_INVALID' });
});

test('reports never invent linguistic, accent or human-interruption acceptance from fixture transport checks', async () => {
  const report = await runVoiceEvaluationSmoke({ languages: ['ig'] });
  assertEvidence(report); assertEvidence(report.results[0]);
  const interruption = report.results[0].structuralChecks.find(check => check.id === 'interruption_clears_queued_pcm');
  assert.equal(interruption.observed.humanBargeInDetection, 'not_evaluated');
  assert.equal(interruption.observed.interruptionOrigin, 'injected_playback_clear_event');
  assert.ok(report.limitations.some(item => item.includes('not as spoken language')));
  assert.ok(report.limitations.some(item => item.includes('not native-speaker gold samples')));
  assert.ok(report.limitations.some(item => item.includes('No conversation accuracy')));
  assert.doesNotMatch(JSON.stringify(report), /"(?:languageAccuracy|accentAcceptance|humanBargeInDetection)":"passed"/);
});
test('smoke attaches session-scoped software observations without fake acoustic timing or provider completion', async () => {
  const report = await runVoiceEvaluationSmoke();
  for (const result of report.results) for (const check of result.structuralChecks) {
    for (const observed of check.localObservations) {
      assert.equal(observed.status, 'local_observations_only');
      assert.equal(observed.evidenceType, 'synthetic_transport_fixture');
      assert.equal(observed.timingBasis, 'deterministic_counter_not_elapsed_time');
      assert.equal(observed.realMicrophone, false); assert.equal(observed.realProvider, false);
      assert.equal(observed.audiblePlaybackVerified, false); assert.equal(observed.providerClosureVerified, false);
      assert.ok(observed.trace.every(event => event.sessionRef.startsWith(`fictional-${result.language}-session-`)));
      assert.equal(observed.trace.some(event => ['audio.output.started', 'provider.closed', 'interrupt.detected'].includes(event.type)), false);
    }
  }
  for (const result of report.results) {
    const restart = result.structuralChecks.find(check => check.id === 'renewed_acknowledgment_required');
    assert.equal(restart.localObservations.length, 2);
    assert.notEqual(restart.localObservations[0].trace[0].sessionRef, restart.localObservations[1].trace[0].sessionRef);
  }
});

test('a broken fictional transport is reported as failure rather than a false structural pass', async t => {
  t.mock.method(FakeSocket.prototype, 'send', () => { throw new Error('Injected local transport failure'); });
  const report = await runVoiceEvaluationSmoke({ languages: ['ha'] });
  assert.equal(report.structuralStatus, 'failed'); assert.ok(report.summary.failed > 0);
  const failed = report.results[0].structuralChecks.filter(check => check.status === 'failed');
  assert.equal(failed.length, report.summary.failed);
  assert.ok(failed.every(check => check.failures.length > 0));
  assert.ok(failed.every(check => check.teardown.status === 'passed'));
  assertEvidence(report);
});

test('failed fictional socket cleanup is exposed separately and cannot report verified teardown', async t => {
  t.mock.method(FakeSocket.prototype, 'close', () => { throw new Error('Injected local close failure'); });
  const report = await runVoiceEvaluationSmoke({ languages: ['yo'] });
  assert.equal(report.structuralStatus, 'failed');
  const failedCleanup = report.results[0].structuralChecks.filter(check => check.teardown.status === 'failed');
  assert.ok(failedCleanup.length > 0);
  assert.ok(failedCleanup.every(check => check.status === 'failed'));
  assert.ok(failedCleanup.every(check => check.failures.some(failure => failure.stage === 'teardown')));
  assert.ok(failedCleanup.every(check => check.teardown.fictionalSocketsClosed === undefined));
  assertEvidence(report);
});

test('local CLI emits truthful JSON and rejects options that might imply live execution', () => {
  const script = require.resolve('../../../scripts/voice-evaluation-smoke.cjs');
  const run = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout); assertEvidence(report); assert.equal(report.summary.passed, 24);
  const invalid = spawnSync(process.execPath, [script, '--live'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(invalid.status, 1); assert.equal(invalid.stdout, ''); assert.match(invalid.stderr, /takes no arguments/);
});

test('runner succeeds with real device and network entry points disabled', () => {
  const script = require.resolve('../../../scripts/voice-evaluation-smoke.cjs');
  const code = `
    const Module = require('node:module');
    const originalLoad = Module._load;
    const blocked = /^(?:node:)?(?:https?|net|tls|dns|dgram)$|^ws$/;
    Module._load = function(name, ...args) {
      if (blocked.test(name) || name.startsWith('@google/')) throw new Error('Real transport import forbidden: ' + name);
      return originalLoad.call(this, name, ...args);
    };
    for (const name of ['fetch', 'WebSocket', 'AudioContext', 'AudioWorkletNode', 'navigator']) {
      Object.defineProperty(globalThis, name, { configurable: true, get() { throw new Error('Real browser access forbidden: ' + name); } });
    }
    require(${JSON.stringify(script)}).runVoiceEvaluationSmoke().then(report => {
      if (report.structuralStatus !== 'passed') throw new Error(JSON.stringify(report));
      process.stdout.write(JSON.stringify(report.summary));
    }).catch(error => { process.stderr.write(error.stack); process.exitCode = 1; });
  `;
  const run = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), { structuralChecks: 24, passed: 24, failed: 0 });
});
