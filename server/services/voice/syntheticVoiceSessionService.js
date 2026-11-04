'use strict';

// This adapter is deliberately incapable of accepting live audio, arbitrary
// transcripts, patient identifiers, provider credentials or clinical writes.
// It exercises the conversation/evidence contract without external processing.
const { randomUUID } = require('node:crypto');
const fixtures = require('../../../shared/voice/intakeFixtures.json');
const NOTICE_VERSION = 'voice-lab-synthetic-v1';
const ROLES = new Set(['provider', 'admin', 'super_admin']);
const INPUTS = Object.freeze({ complaint: 'chief_complaint', duration: 'onset', correction: 'onset', medicines: 'medications', help: null, advice: null });
const TTL_MS = 10 * 60 * 1000;
const MAX_SESSIONS = 100;
const MAX_TURNS = 60;
function fail(statusCode, code, message) { throw Object.assign(new Error(message), { statusCode, code }); }
function strict(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)))
    fail(400, 'VOICE_INPUT_INVALID', 'Only the documented synthetic fixture controls are accepted.');
}
function actorId(actor) {
  if (!actor?.id || !ROLES.has(actor.role)) fail(403, 'VOICE_ACCESS_DENIED', 'A signed-in clinician or administrator is required.');
  return actor.id;
}
function enabled(env) { return ['development', 'test'].includes(env.NODE_ENV) && env.DOCTARX_VOICE_SYNTHETIC_ENABLED === 'true'; }
function copy(value) { return JSON.parse(JSON.stringify(value)); }

function createSyntheticVoiceSessionService({ env = process.env, now = Date.now, id = randomUUID } = {}) {
  const sessions = new Map();
  const expiryTimers = new Map();
  function remove(sessionId) {
    clearTimeout(expiryTimers.get(sessionId)); expiryTimers.delete(sessionId); sessions.delete(sessionId);
  }
  function close() { for (const key of sessions.keys()) remove(key); }
  function gate() {
    if (!enabled(env)) {
      close();
      fail(503, 'VOICE_SYNTHETIC_DISABLED', 'The synthetic voice lab is disabled. Live patient processing is unavailable.');
    }
    for (const [key, session] of sessions) if (session.expiresAt <= now()) remove(key);
  }
  function capabilities() {
    return { enabled: enabled(env), mode: 'synthetic_only', noticeVersion: NOTICE_VERSION,
      languages: Object.entries(fixtures.languages).map(([code, item]) => ({ code, name: item.name, clinicalApproved: false, spokenQualityVerified: false })),
      audioCapture: false, audioPlayback: false, liveProvider: false, chartWrite: false, retention: 'memory_only_10_minutes',
      fixtureVersion: fixtures.version, languageReview: fixtures.reviewStatus };
  }
  function snapshot(session) {
    const result = copy(session);
    delete result.ownerId;
    return { ...result, capabilities: capabilities(), remainingMs: Math.max(0, session.expiresAt - now()) };
  }
  function resolve(actor, sessionId) {
    gate(); const ownerId = actorId(actor);
    const session = sessions.get(sessionId);
    if (!session || session.ownerId !== ownerId) fail(404, 'VOICE_SESSION_UNAVAILABLE', 'This synthetic session is unavailable or expired.');
    return session;
  }
  function assistant(session, key) {
    const sourceText = fixtures.languages[session.language][key];
    const turn = { id: id(), speaker: 'assistant', language: session.language, sourceText,
      englishText: fixtures.english[key], emittedText: '', emittedCharacters: 0,
      playbackStatus: 'pending_simulation', heardAudio: null, translationStatus: 'fixture_unverified',
      provenance: fixtures.version, status: 'streaming', epoch: session.epoch };
    session.turns.push(turn); session.activeOutputId = turn.id;
  }
  function interrupt(session, reason) {
    const turn = session.turns.find(item => item.id === session.activeOutputId);
    if (turn) { turn.status = 'interrupted'; turn.playbackStatus = 'simulation_cancelled'; turn.interruptionReason = reason; }
    session.activeOutputId = null;
  }
  function invalidateDraft(session) { if (session.draft) { session.draft.status = 'stale'; session.draft.review = null; } }
  function create(actor, input) {
    gate(); const ownerId = actorId(actor);
    strict(input, ['language', 'consent']); strict(input.consent, ['noticeVersion', 'processing', 'syntheticOnly']);
    if (!Object.hasOwn(fixtures.languages, input.language)) fail(400, 'VOICE_LANGUAGE_INVALID', 'Choose Hausa, Igbo or Yoruba.');
    if (input.consent.noticeVersion !== NOTICE_VERSION || input.consent.processing !== true || input.consent.syntheticOnly !== true)
      fail(400, 'VOICE_CONSENT_REQUIRED', 'Acknowledge the current synthetic-only notice before starting.');
    if (sessions.size >= MAX_SESSIONS || [...sessions.values()].filter(session => session.ownerId === ownerId).length >= 3)
      fail(429, 'VOICE_CAPACITY_LIMIT', 'End an existing synthetic session before starting another.');
    const session = { id: id(), ownerId, scope: 'synthetic_fixture_no_encounter', language: input.language,
      createdAt: now(), expiresAt: now() + TTL_MS, status: 'active', epoch: 1, revision: 1, evidenceRevision: 0,
      consent: { ...input.consent, recordedAt: now(), kind: 'demo_acknowledgment_not_patient_consent' },
      activeOutputId: null, turns: [], draft: null, humanAssistanceRequested: false };
    assistant(session, 'greeting'); sessions.set(session.id, session);
    const timer = setTimeout(() => remove(session.id), TTL_MS); timer.unref?.(); expiryTimers.set(session.id, timer);
    return snapshot(session);
  }
  function read(actor, sessionId) { return snapshot(resolve(actor, sessionId)); }
  function execute(actor, sessionId, input) {
    const session = resolve(actor, sessionId);
    strict(input, ['action', 'expectedRevision', 'epoch', 'fixtureId', 'draftId', 'decision']);
    if (!Number.isInteger(input.expectedRevision) || !Number.isInteger(input.epoch)) fail(400, 'VOICE_INPUT_INVALID', 'A session revision and epoch are required.');
    const actionKeys = { advance_output: [], fixture: ['fixtureId'], interrupt: [], pause: [], resume: [], end: [], revoke_consent: [], prepare_draft: [], review_draft: ['draftId', 'decision'] };
    if (!Object.hasOwn(actionKeys, input.action) || Object.keys(input).some(key => !['action', 'expectedRevision', 'epoch', ...actionKeys[input.action]].includes(key)))
      fail(400, 'VOICE_INPUT_INVALID', 'Unsupported synthetic command or fields.');
    if (['end', 'revoke_consent'].includes(input.action)) {
      interrupt(session, input.action); session.epoch++; session.revision++;
      session.status = input.action === 'end' ? 'ended' : 'consent_revoked';
      session.consent.processing = false; session.turns = []; session.draft = null;
      const result = snapshot(session); remove(session.id); return result;
    }
    // Ending capture or revoking permission must never be blocked by a stale
    // client revision. Non-terminal commands still use optimistic concurrency.
    if (input.expectedRevision !== session.revision || input.epoch !== session.epoch)
      fail(409, 'VOICE_STALE_SESSION', 'The session changed. Refresh it before continuing.');
    if (input.action === 'pause') {
      if (session.status !== 'active') fail(409, 'VOICE_STATE_INVALID', 'Only an active conversation can be paused.');
      interrupt(session, 'paused'); session.status = 'paused'; session.epoch++; invalidateDraft(session);
    } else if (input.action === 'resume') {
      if (session.status !== 'paused') fail(409, 'VOICE_STATE_INVALID', 'Only a paused conversation can be resumed.');
      session.status = 'active'; session.epoch++; invalidateDraft(session);
      // Do not replay cancelled speech after a resume/reconnect.
    } else {
      if (session.status !== 'active') fail(409, 'VOICE_STATE_INVALID', 'Resume the conversation before continuing.');
      if (input.action === 'advance_output') {
        const turn = session.turns.find(item => item.id === session.activeOutputId);
        if (!turn) fail(409, 'VOICE_STATE_INVALID', 'No assistant output is pending.');
        const characters = Array.from(turn.sourceText);
        turn.emittedCharacters = Math.min(characters.length, turn.emittedCharacters + 12);
        turn.emittedText = characters.slice(0, turn.emittedCharacters).join('');
        turn.playbackStatus = 'text_simulation_only';
        if (turn.emittedCharacters === characters.length) { turn.status = 'completed'; session.activeOutputId = null; }
      } else if (input.action === 'interrupt') {
        interrupt(session, 'patient_barge_in'); session.epoch++; invalidateDraft(session);
      } else if (input.action === 'fixture') {
        if (!Object.hasOwn(INPUTS, input.fixtureId)) fail(400, 'VOICE_FIXTURE_INVALID', 'Choose a built-in fictional utterance.');
        if (session.turns.length >= MAX_TURNS) fail(409, 'VOICE_TURN_LIMIT', 'The synthetic session reached its turn limit. End it and start another.');
        interrupt(session, 'patient_barge_in'); session.epoch++; session.evidenceRevision++; invalidateDraft(session);
        const field = INPUTS[input.fixtureId];
        const turn = { id: id(), speaker: 'patient', language: session.language,
          sourceText: fixtures.languages[session.language][input.fixtureId], englishText: fixtures.english[input.fixtureId],
          status: 'completed', translationStatus: 'fixture_unverified', provenance: fixtures.version,
          field, epoch: session.epoch, synthetic: true, audioEvidence: false };
        if (field) for (const earlier of session.turns) if (earlier.speaker === 'patient' && earlier.field === field && !earlier.supersededBy) earlier.supersededBy = turn.id;
        session.turns.push(turn);
        if (input.fixtureId === 'help') session.humanAssistanceRequested = true;
        const response = input.fixtureId === 'help' ? 'helpReply' : input.fixtureId === 'advice' ? 'adviceReply'
          : !session.turns.some(item => item.field === 'onset') ? 'durationQuestion'
          : !session.turns.some(item => item.field === 'medications') ? 'medicineQuestion' : 'acknowledge';
        assistant(session, response);
      } else if (input.action === 'prepare_draft') {
        const evidence = session.turns.filter(turn => turn.speaker === 'patient' && turn.field && !turn.supersededBy);
        if (!evidence.length) fail(409, 'VOICE_EVIDENCE_REQUIRED', 'Add a fictional patient statement first.');
        session.draft = { id: id(), status: 'awaiting_demo_review', evidenceRevision: session.evidenceRevision, epoch: session.epoch,
          facts: evidence.map(turn => ({ field: turn.field, englishText: turn.englishText, sourceTurnId: turn.id, sourceLanguage: turn.language })),
          missingFields: Object.values(INPUTS).filter((field, index, fields) => field && fields.indexOf(field) === index && !evidence.some(turn => turn.field === field)),
          warnings: ['Synthetic fixture only.', 'Translations have not been checked by a qualified native-language reviewer.', 'Not a clinical note. Chart import and signing are unavailable.'],
          clinicalReady: false, semanticGroundingValidated: false, review: null };
      } else if (input.action === 'review_draft') {
        const draft = session.draft;
        if (!draft || draft.id !== input.draftId || draft.status !== 'awaiting_demo_review' || draft.evidenceRevision !== session.evidenceRevision || draft.epoch !== session.epoch)
          fail(409, 'VOICE_DRAFT_STALE', 'Prepare a fresh draft before reviewing it.');
        if (!['reviewed_demo', 'rejected'].includes(input.decision)) fail(400, 'VOICE_REVIEW_INVALID', 'Only a demonstration review or rejection is available.');
        draft.status = input.decision;
        draft.review = { decision: input.decision, recordedAt: now(), kind: 'workflow_demonstration_not_clinical_approval' };
      }
    }
    session.revision++; return snapshot(session);
  }
  return { capabilities, create, read, execute, close };
}
module.exports = { createSyntheticVoiceSessionService, NOTICE_VERSION };
