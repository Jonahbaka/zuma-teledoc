'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { createEvaluationTrial } = require('../../services/voice/voiceEvaluationEvidence');
const script = require.resolve('../../../scripts/evaluate-voice.cjs');
const run = args => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 10000 });
function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-evaluation-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root;
}
test('CLI catalog and checklist include all unrun scenarios and preserve separate narration', () => {
  for (const [command, schema] of [['catalog', 'voice-evaluation-catalog-v1'], ['checklist', 'voice-evaluation-template-v1']]) {
    const result = run([command]); assert.equal(result.status, 0, result.stderr); const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.schemaVersion, schema); assert.equal(parsed.scenarios.length, 22);
    assert.equal(parsed.scenarios.at(-1).voice, 'Riko'); assert.equal(parsed.scenarios.at(-1).language, 'en-NG');
  }
});
test('CLI creates private new files and will not overwrite an existing file or symlink', t => {
  const root = workspace(t), target = path.join(root, 'trial.json'), existing = path.join(root, 'existing.json');
  const args = ['template', '--scenario', 'ha-correction_negation', '--out', target];
  const result = run(args); assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(fs.readFileSync(target)), createEvaluationTrial('ha-correction_negation'));
  assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  const before = fs.readFileSync(target); assert.equal(run(args).status, 1); assert.deepEqual(fs.readFileSync(target), before);
  fs.writeFileSync(existing, 'unchanged'); const link = path.join(root, 'link.json'); fs.symlinkSync(existing, link);
  assert.equal(run(['catalog', '--out', link]).status, 1); assert.equal(fs.readFileSync(existing, 'utf8'), 'unchanged');
});
test('CLI incomplete analysis exits 2 and emits a review-needed report, never a quality pass', t => {
  const root = workspace(t), trialPath = path.join(root, 'trial.json'); fs.writeFileSync(trialPath, JSON.stringify(createEvaluationTrial('yo-barge_in')));
  const result = run(['analyze', '--trial', trialPath, '--corpus-root', root]); assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(result.stdout); assert.equal(report.completeness, 'incomplete');
  assert.equal(report.languageAccuracyValidated, false); assert.equal(report.activationApproved, false);
  assert.ok(report.issues.includes('observed_transcript_missing')); assert.ok(report.issues.includes('required_audio_recording_missing'));
});
test('CLI full supplied-review flow binds actual local bytes and preserves needs-work, not quality acceptance', t => {
  // All identities and declarations here are fictional test data. This silent
  // file is intentionally not a narration or evidence of a human review.
  const root = workspace(t), trialPath = path.join(root, 'trial.json'), trial = createEvaluationTrial('en-NG-riko_narration');
  const bytes = Buffer.alloc(364); bytes.write('RIFF'); bytes.writeUInt32LE(356, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(320, 40); fs.writeFileSync(path.join(root, 'fictional.wav'), bytes);
  trial.trialId = 'fictional-cli-review'; Object.assign(trial.run, { mode: 'recorded_trial', applicationRevision: 'a'.repeat(40), providerModel: 'gemini-3.8-flash-tts' });
  Object.assign(trial.reference, { status: 'reviewer_supplied', referenceVersion: 'fictional-v1', sourceScript: 'Fictional cup',
    expectedTranscript: 'Fictional cup', expectedMeaningEnglish: 'Fictional object', languageVariety: 'fictional-fixture-variety',
    reviewer: { alias: 'fictional-reviewer', language: 'en-NG', declaredFluency: 'professional' }, reviewedAt: '2026-11-03T18:00:00Z' });
  trial.observedTranscript = ''; trial.recordings = [{ id: 'fictional-output', role: 'output', path: 'fictional.wav', sha256: createHash('sha256').update(bytes).digest('hex') }];
  const args = ['analyze', '--trial', trialPath, '--corpus-root', root]; fs.writeFileSync(trialPath, JSON.stringify(trial));
  const preliminary = run(args); assert.equal(preliminary.status, 2, preliminary.stderr);
  const report = JSON.parse(preliminary.stdout);
  Object.assign(trial.review, { status: 'completed', reviewerAlias: 'fictional-reviewer', language: 'en-NG', declaredFluency: 'professional',
    basis: 'listened_to_recordings', reviewedAt: '2026-11-03T18:01:00Z', trialFingerprint: report.trialFingerprint,
    recordingSha256: trial.recordings.map(item => item.sha256), checks: trial.review.checks.map(item => ({ id: item.id, status: 'needs_work' })) });
  fs.writeFileSync(trialPath, JSON.stringify(trial)); const result = run(args); assert.equal(result.status, 0, result.stderr);
  const complete = JSON.parse(result.stdout); assert.equal(complete.completeness, 'review_supplied');
  assert.equal(complete.humanReview.reportedChecks.every(item => item.status === 'needs_work'), true);
  assert.equal(complete.artifacts[0].status, 'header_and_hash_checked'); assert.equal(complete.artifacts[0].audioContentVerified, false);
  assert.equal(complete.languageAccuracyValidated, false); assert.equal(complete.accentValidated, false); assert.equal(complete.activationApproved, false);
  assert.equal(result.stdout.includes(root), false); assert.equal(result.stdout.includes(trial.reference.sourceScript), false);
});
test('CLI rejects unsupported live options, duplicate arguments and missing scenario or corpus', () => {
  for (const args of [[], ['live'], ['smoke', '--live', 'true'], ['catalog', '--scenario', 'ha'], ['template'],
    ['template', '--scenario', 'unknown'], ['template', '--scenario', 'ha-barge_in', '--scenario', 'yo-barge_in'],
    ['analyze', '--trial', 'missing.json'], ['catalog', '--out'], ['catalog', '--out', '--trial']]) {
    const result = run(args); assert.equal(result.status, 1, JSON.stringify(args)); assert.equal(result.stdout, '');
    assert.ok(JSON.parse(result.stderr).error.startsWith('VOICE_EVALUATION_'));
  }
});
test('CLI refuses symlink and oversized trial files and sanitizes JSON or filesystem errors', t => {
  const root = workspace(t), file = path.join(root, 'trial.json'), link = path.join(root, 'link.json');
  fs.writeFileSync(file, JSON.stringify(createEvaluationTrial('ig-clarification'))); fs.symlinkSync(file, link);
  const inspect = name => run(['analyze', '--trial', name, '--corpus-root', root]);
  assert.equal(inspect(link).status, 1); fs.writeFileSync(file, ' '.repeat(262145)); assert.equal(inspect(file).status, 1);
  fs.writeFileSync(file, '{"private-string-not-to-echo"'); const bad = inspect(file);
  assert.equal(bad.status, 1); assert.equal(bad.stderr.includes('private-string-not-to-echo'), false); assert.equal(bad.stderr.includes(root), false);
  assert.equal(inspect(path.join(root, 'missing.json')).stderr.includes(root), false);
});
test('CLI validates trial schema before trying to inspect any requested audio', t => {
  const root = workspace(t), file = path.join(root, 'trial.json'), trial = createEvaluationTrial('ha-barge_in');
  trial.language = 'yo'; trial.recordings = [{ id: 'outside', role: 'duplex', path: '../outside.wav', sha256: 'a'.repeat(64) }];
  fs.writeFileSync(file, JSON.stringify(trial));
  const result = run(['analyze', '--trial', file, '--corpus-root', root]); assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stderr), { error: 'VOICE_EVALUATION_INPUT_INVALID', field: 'scenario_binding' });
});
test('combined CLI smoke reports only the 24 synthetic transport checks', () => {
  const result = run(['smoke']); assert.equal(result.status, 0, result.stderr); const report = JSON.parse(result.stdout);
  assert.deepEqual(report.summary, { structuralChecks: 24, passed: 24, failed: 0 });
  assert.equal(report.realProvider, false); assert.equal(report.realMicrophone, false); assert.equal(report.languageAccuracy, 'not_evaluated');
});
