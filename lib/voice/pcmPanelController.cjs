'use strict';
const NOTICE = 'voice-live-synthetic-v1';
const { GEMINI_LIVE_LANGUAGES } = require('../../shared/voiceLanguageCatalog.cjs');
const LANGUAGES = Object.keys(GEMINI_LIVE_LANGUAGES);
const ROLES = ['provider', 'admin', 'super_admin'];
const terminal = phase => ['idle', 'stopped', 'failed'].includes(phase);
function cleanupWarning(receipt) {
  const warnings = [];
  if (receipt?.tracksStopped !== true) warnings.push('Microphone release could not be confirmed. Check your browser microphone indicator.');
  if (receipt?.contextsClosed !== true) warnings.push('Audio context cleanup could not be confirmed. Close this tab if audio remains active.');
  if (receipt?.permissionPending === true) warnings.push('A microphone permission request is still pending. Dismiss the browser prompt; any later stream will receive a stop request.');
  return warnings.join(' ');
}
const failureMessage = 'The fictional audio test could not continue. Local stop was requested. Provider cleanup and final usage may still need confirmation.';

// Owns only panel state and injected transport lifetime, never authority records.
function createPcmPanelController({ userId, role, language, loadCapabilities, createSession, browserSupported = false, onChange = () => {} } = {}) {
  let disposed = false, generation = 0, current = null, speakerAction = 0, loadGeneration = 0, lastCleanup = null;
  let state = { capability: null, loading: true, phase: 'idle', consent: false, microphonePaused: false, speakerPaused: false, captions: [], error: '', cleanupWarning: '' };
  // Constant-size evidence across this panel's session replacements. A clean
  // replacement receipt says nothing about an older device or pending prompt.
  const cleanupConcerns = { microphone: false, contexts: false, permission: false };
  const allowed = !!userId && ROLES.includes(role) && LANGUAGES.includes(language);
  const snapshot = () => Object.freeze({ ...state, captions: state.captions.map(item => ({ ...item })), browserSupported, allowed });
  function publish(change = {}) { state = { ...state, ...change }; if (!disposed) { try { onChange(snapshot()); } catch { void dispose(); } } }
  const owned = record => !!record && !disposed && current === record && record.generation === generation;
  async function reportCleanup(cleanup) {
    let receipt;
    try { receipt = await cleanup; } catch { /* Report uncertainty without raw transport errors. */ }
    const warning = cleanupWarning(receipt);
    if (warning && !disposed) {
      cleanupConcerns.microphone ||= receipt?.tracksStopped !== true;
      cleanupConcerns.contexts ||= receipt?.contextsClosed !== true;
      cleanupConcerns.permission ||= receipt?.permissionPending === true;
      publish({ cleanupWarning: cleanupWarning({ tracksStopped: !cleanupConcerns.microphone, contextsClosed: !cleanupConcerns.contexts, permissionPending: cleanupConcerns.permission }) });
    }
    return receipt;
  }
  function beginCleanup(record) {
    const ending = {}; generation++; speakerAction++; current = null;
    // Own the promise before calling the transport: duplicate lifecycle events
    // and synchronous callbacks must retain the same pending/result receipt.
    let resolveCleanup; ending.promise = new Promise(resolve => { resolveCleanup = resolve; }); lastCleanup = ending;
    try { Promise.resolve(record.client?.stop()).then(resolveCleanup, () => resolveCleanup(undefined)); }
    catch { resolveCleanup(undefined); }
    return ending;
  }
  async function stop() {
    const ending = current ? beginCleanup(current) : lastCleanup;
    if (!ending) { generation++; speakerAction++; }
    publish({ phase: 'stopped', consent: false, captions: [], microphonePaused: false, speakerPaused: false });
    return ending ? await reportCleanup(ending.promise) : undefined;
  }
  async function dispose() { if (disposed) return; disposed = true; await stop(); }
  async function load() {
    if (disposed || !allowed) { publish({ loading: false }); return; }
    if (current) return;
    const requestGeneration = ++loadGeneration;
    publish({ loading: true, capability: null, consent: false, error: '' });
    try {
      const response = await loadCapabilities(); if (disposed || requestGeneration !== loadGeneration) return;
      const c = response?.capabilities, identity = response?.identity;
      const valid = response?.success === true && identity?.actorId === userId && /^[a-f0-9]{64}$/.test(identity?.sessionBinding || '') && c?.provider === 'google' && c.model === 'gemini-3.8-live' && c.voice === 'Zephyr'
        && c.clinicalUse === false && c.consentVersion === NOTICE && typeof c.enabled === 'boolean'
        && Array.isArray(c.languages) && c.languages.some(item => item?.code === language)
        && c.languages.every(item => LANGUAGES.includes(item?.code));
      publish({ loading: false, capability: valid ? Object.freeze({ enabled: c.enabled, consentVersion: NOTICE, actorId: identity.actorId, sessionBinding: identity.sessionBinding }) : null,
        error: valid ? '' : 'The audio evaluation configuration could not be verified.' });
    } catch { if (!disposed && requestGeneration === loadGeneration) publish({ loading: false, error: 'The audio evaluation configuration is unavailable.' }); }
  }
  function setConsent(value) {
    if (disposed) return;
    if (value !== true) { void stop(); return; }
    if (!current && allowed && browserSupported && state.capability?.enabled) publish({ consent: true, error: '' });
  }
  async function start() {
    if (disposed || current || !allowed || !browserSupported || !state.capability?.enabled || !state.consent) return false;
    const record = { generation: ++generation, client: null }; current = record;
    publish({ phase: 'authorizing', error: '', captions: [], microphonePaused: false, speakerPaused: false });
    if (!owned(record)) return false;
    try {
      record.client = createSession({
        onState(phase) {
          if (!owned(record)) return;
          if (terminal(phase)) {
            const ending = beginCleanup(record);
            publish({ phase, consent: false, captions: [], microphonePaused: false, speakerPaused: false, error: phase === 'failed' ? failureMessage : state.error });
            void reportCleanup(ending.promise);
          } else publish({ phase, speakerPaused: phase === 'speaker_paused' ? true : phase === 'listening' ? false : state.speakerPaused });
        },
        onError() { if (owned(record)) publish({ error: failureMessage }); },
        onTranscript(fragment) {
          if (!owned(record)) return;
          if (!fragment || fragment.language !== language || fragment.provisional !== true || fragment.clinicalReviewed !== false
            || !['user', 'assistant'].includes(fragment.speaker) || typeof fragment.text !== 'string' || fragment.text.length > 4096) { void stop(); return; }
          publish({ captions: [...state.captions.slice(-99), { speaker: fragment.speaker, text: fragment.text, language }] });
        }
      });
      if (!owned(record)) { await record.client.stop(); return false; }
      await record.client.start({ language, consentAcknowledged: true, consentVersion: NOTICE, expectedActorId: state.capability.actorId, expectedSessionBinding: state.capability.sessionBinding });
      return owned(record);
    } catch {
      if (owned(record)) { const expectedGeneration = generation + 1; await stop(); if (!disposed && !current && generation === expectedGeneration) publish({ phase: 'failed', error: state.error || failureMessage }); }
      return false;
    }
  }
  function setMicrophonePaused(value) {
    const record = current; if (!owned(record) || !['listening', 'speaker_paused'].includes(state.phase)) return;
    try { record.client.setMicrophonePaused(value === true); if (owned(record)) publish({ microphonePaused: value === true }); }
    catch { void stop(); }
  }
  function pauseSpeaker() {
    const record = current; if (!owned(record) || !['listening', 'speaker_paused'].includes(state.phase)) return;
    speakerAction++; try { record.client.pauseSpeaker(); if (owned(record)) publish({ speakerPaused: true }); } catch { void stop(); }
  }
  async function resumeSpeaker() {
    const record = current; if (!owned(record) || !['listening', 'speaker_paused'].includes(state.phase)) return false;
    const action = ++speakerAction;
    try { const resumed = await record.client.resumeSpeaker(); if (!owned(record) || action !== speakerAction || !resumed) return false; publish({ speakerPaused: false }); return true; }
    catch { if (owned(record)) await stop(); return false; }
  }
  return Object.freeze({ load, setConsent, start, stop, dispose, setMicrophonePaused, pauseSpeaker, resumeSpeaker, snapshot });
}
module.exports = { createPcmPanelController };
