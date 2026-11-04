'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSyntheticVoiceSessionService, NOTICE_VERSION } = require('../../services/voice/syntheticVoiceSessionService');
const actor = { id: 'clinician-a', role: 'provider' };
const env = () => ({ NODE_ENV: 'test', DOCTARX_VOICE_SYNTHETIC_ENABLED: 'true' });
const consent = () => ({ noticeVersion: NOTICE_VERSION, processing: true, syntheticOnly: true });
const create = (service, language = 'ha') => service.create(actor, { language, consent: consent() });
const command = (service, session, action, extra = {}) => service.execute(actor, session.id, { action, expectedRevision: session.revision, epoch: session.epoch, ...extra });
const code = expected => error => error.code === expected;

test('disabled by default and impossible to enable in production or unknown environments', () => {
  for (const config of [{}, { NODE_ENV: 'development' }, { NODE_ENV: 'production', DOCTARX_VOICE_SYNTHETIC_ENABLED: 'true' }, { NODE_ENV: 'staging', DOCTARX_VOICE_SYNTHETIC_ENABLED: 'true' }]) {
    const service = createSyntheticVoiceSessionService({ env: config });
    assert.equal(service.capabilities().enabled, false);
    assert.throws(() => create(service), code('VOICE_SYNTHETIC_DISABLED')); service.close();
  }
});

test('feature revocation, ownership and current role are checked on every session action', t => {
  const config = env(); const service = createSyntheticVoiceSessionService({ env: config }); t.after(service.close);
  const session = create(service);
  assert.throws(() => service.read({ id: 'clinician-b', role: 'provider' }, session.id), code('VOICE_SESSION_UNAVAILABLE'));
  assert.throws(() => service.read({ ...actor, role: 'patient' }, session.id), code('VOICE_ACCESS_DENIED'));
  assert.throws(() => service.execute({ id: 'clinician-b', role: 'admin' }, session.id, { action: 'end', expectedRevision: 1, epoch: 1 }), code('VOICE_SESSION_UNAVAILABLE'));
  config.DOCTARX_VOICE_SYNTHETIC_ENABLED = 'false';
  assert.throws(() => service.read(actor, session.id), code('VOICE_SYNTHETIC_DISABLED'));
  config.DOCTARX_VOICE_SYNTHETIC_ENABLED = 'true';
  assert.throws(() => service.read(actor, session.id), code('VOICE_SESSION_UNAVAILABLE'));
});

test('explicit current demo acknowledgment required; arbitrary text, patient scope and audio are rejected', t => {
  const service = createSyntheticVoiceSessionService({ env: env() }); t.after(service.close);
  for (const input of [
    { language: 'en', consent: consent() },
    { language: 'ha', consent: { ...consent(), noticeVersion: 'old' } },
    { language: 'ha', consent: { ...consent(), processing: false } },
    { language: 'ha', consent: { ...consent(), syntheticOnly: false } },
    { language: 'ha', consent: consent(), patientId: 'real-patient' },
    { language: 'ha', consent: consent(), audio: 'bytes' },
  ]) assert.throws(() => service.create(actor, input));
  const session = create(service);
  for (const extra of [{ text: 'private history' }, { audio: 'bytes' }, { providerKey: 'secret' }, { encounterId: 'real' }])
    assert.throws(() => command(service, session, 'fixture', { fixtureId: 'complaint', ...extra }), code('VOICE_INPUT_INVALID'));
  assert.throws(() => command(service, session, 'fixture', { fixtureId: 'external_text' }), code('VOICE_FIXTURE_INVALID'));
  assert.equal(service.read(actor, session.id).revision, session.revision);
});

for (const language of ['ha', 'ig', 'yo']) test(`${language}: fictional turn, correction, source-linked draft and demo review run end to end`, t => {
  const service = createSyntheticVoiceSessionService({ env: env() }); t.after(service.close);
  let session = create(service, language);
  assert.equal(session.scope, 'synthetic_fixture_no_encounter');
  assert.equal(session.capabilities.audioCapture, false);
  assert.equal(session.capabilities.liveProvider, false);
  assert.equal(session.capabilities.chartWrite, false);
  assert.ok(session.turns[0].sourceText);
  for (const fixtureId of ['complaint', 'duration', 'medicines']) session = command(service, session, 'fixture', { fixtureId });
  session = command(service, session, 'prepare_draft');
  assert.equal(session.draft.facts.length, 3);
  assert.equal(session.draft.clinicalReady, false);
  const oldDraft = session.draft.id;
  session = command(service, session, 'review_draft', { draftId: oldDraft, decision: 'reviewed_demo' });
  assert.equal(session.draft.status, 'reviewed_demo');
  session = command(service, session, 'fixture', { fixtureId: 'correction' });
  assert.equal(session.draft.status, 'stale');
  assert.equal(session.draft.review, null);
  assert.throws(() => command(service, session, 'review_draft', { draftId: oldDraft, decision: 'reviewed_demo' }), code('VOICE_DRAFT_STALE'));
  const oldOnset = session.turns.find(turn => turn.field === 'onset');
  assert.ok(oldOnset.supersededBy);
  session = command(service, session, 'prepare_draft');
  const onset = session.draft.facts.find(fact => fact.field === 'onset');
  assert.equal(onset.englishText, 'No, it started two days ago.');
  assert.equal(onset.sourceTurnId, oldOnset.supersededBy);
  for (const fact of session.draft.facts) assert.equal(session.turns.find(turn => turn.id === fact.sourceTurnId).speaker, 'patient');
  assert.equal(session.draft.semanticGroundingValidated, false);
  assert.throws(() => command(service, session, 'review_draft', { draftId: session.draft.id, decision: 'accepted' }), code('VOICE_REVIEW_INVALID'));
  assert.throws(() => command(service, session, 'import_chart'), code('VOICE_INPUT_INVALID'));
});

test('interruption preserves only emitted text, rejects old epoch and never replays on resume', t => {
  const service = createSyntheticVoiceSessionService({ env: env() }); t.after(service.close);
  let session = create(service);
  session = command(service, session, 'advance_output');
  const old = session;
  session = command(service, session, 'fixture', { fixtureId: 'complaint' });
  const interrupted = session.turns[0];
  assert.equal(interrupted.status, 'interrupted');
  assert.equal(interrupted.emittedText, Array.from(interrupted.sourceText).slice(0, 12).join(''));
  assert.equal(interrupted.heardAudio, null);
  assert.throws(() => command(service, old, 'advance_output'), code('VOICE_STALE_SESSION'));
  session = command(service, session, 'pause');
  assert.equal(session.activeOutputId, null);
  assert.throws(() => command(service, session, 'fixture', { fixtureId: 'duration' }), code('VOICE_STATE_INVALID'));
  session = command(service, session, 'resume');
  assert.equal(session.activeOutputId, null);
  assert.throws(() => command(service, session, 'advance_output'), code('VOICE_STATE_INVALID'));
});

test('end and consent withdrawal bypass stale revision, clear evidence and reject all late work', t => {
  for (const action of ['end', 'revoke_consent']) {
    const service = createSyntheticVoiceSessionService({ env: env() }); t.after(service.close);
    const initial = create(service);
    const latest = command(service, initial, 'fixture', { fixtureId: 'complaint' });
    const ended = command(service, initial, action);
    assert.deepEqual(ended.turns, []);
    assert.equal(ended.draft, null);
    assert.equal(ended.consent.processing, false);
    assert.throws(() => command(service, latest, 'fixture', { fixtureId: 'duration' }), code('VOICE_SESSION_UNAVAILABLE'));
  }
});

test('expiry, capacity and bounded turn count limit memory retention and abuse', t => {
  let time = 1000;
  const service = createSyntheticVoiceSessionService({ env: env(), now: () => time }); t.after(service.close);
  const session = create(service); create(service); create(service);
  assert.throws(() => create(service), code('VOICE_CAPACITY_LIMIT'));
  time += 10 * 60 * 1000;
  assert.throws(() => service.read(actor, session.id), code('VOICE_SESSION_UNAVAILABLE'));
  let next = create(service);
  for (let count = 0; count < 30; count++) next = command(service, next, 'fixture', { fixtureId: 'complaint' });
  assert.throws(() => command(service, next, 'fixture', { fixtureId: 'complaint' }), code('VOICE_TURN_LIMIT'));
});

test('requesting help records a request, advice is declined, neither becomes a clinical fact', t => {
  const service = createSyntheticVoiceSessionService({ env: env() }); t.after(service.close);
  let session = create(service);
  session = command(service, session, 'fixture', { fixtureId: 'help' });
  assert.equal(session.humanAssistanceRequested, true);
  session = command(service, session, 'fixture', { fixtureId: 'advice' });
  assert.equal(session.turns.at(-1).englishText, 'I cannot choose a medicine. A clinician can help you.');
  assert.throws(() => command(service, session, 'prepare_draft'), code('VOICE_EVIDENCE_REQUIRED'));
});

test('voice implementation has no hidden audio, model, chart, analytics or browser storage path', () => {
  const root = path.resolve(__dirname, '../../..');
  for (const file of ['server/services/voice/syntheticVoiceSessionService.js', 'lib/voice/syntheticSessionController.cjs', 'components/voice/VoiceIntakeLab.jsx']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /getUserMedia|SpeechRecognition|speechSynthesis|MediaRecorder|localStorage|sessionStorage|indexedDB|clinicalEncounterService|clinicalAiService|api\.openai/);
  }
  const page = fs.readFileSync(path.join(root, 'app/voice-lab/page.js'), 'utf8');
  assert.match(page, /process\.env\.NODE_ENV !== 'development'/);
  assert.match(page, /notFound\(\)/);
  assert.match(fs.readFileSync(path.join(root, 'server/index.js'), 'utf8'), /loadRoute\('\/api\/voice-lab', '\.\/routes\/voiceLab'\)/);
});
