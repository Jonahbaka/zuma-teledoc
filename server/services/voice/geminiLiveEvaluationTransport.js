'use strict';

// Unmounted protocol seam only. No SDK import, key lookup, network fallback or
// application route. A reviewed gateway must provide authority and consent.
const { GEMINI_LIVE_MODEL: MODEL, GEMINI_LIVE_LANGUAGES: LANGUAGES } = require('../../../shared/voiceLanguageCatalog.cjs');
const VOICE = 'Zephyr'; // Riko is the separately approved TTS narration voice.
const LIMITS = Object.freeze({ lifetimeMs: 180000, setupMs: 10000, closeMs: 3000,
  inputChunkBytes: 16000, outputChunkBytes: 48000, inputBytes: 5760000,
  outputBytes: 8640000, transcriptChunkChars: 4096, transcriptChars: 32768 });
const fault = code => Object.assign(new Error('The language evaluation transport is unavailable.'), { code });
const fixturePrompt = language => `Fictional language demonstration only, not a patient conversation. Speak in ${LANGUAGES[language]}. Briefly greet a fictional adult visitor and ask whether they prefer to continue in ${LANGUAGES[language]}. No medical advice, personal data, or tools.`;
function configuration(language) {
  if (!Object.hasOwn(LANGUAGES, language)) throw fault('GEMINI_LANGUAGE_INVALID');
  return { model: MODEL, config: { responseModalities: ['AUDIO'],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
    inputAudioTranscription: {}, outputAudioTranscription: {},
    realtimeInputConfig: { automaticActivityDetection: { disabled: false }, activityHandling: 'START_OF_ACTIVITY_INTERRUPTS' },
    systemInstruction: `You are an AI conversation assistant for a fictional, nonclinical language evaluation. Speak naturally in ${LANGUAGES[language]}, permit interruptions and ask one short question at a time. Discuss only fictional greetings, language preferences and everyday objects. Do not collect personal information, conduct patient intake, diagnose, triage or provide medical advice. Do not claim that anything was saved or reviewed by a clinician. No external tools are available.`,
  } };
}
function pcmBase64(value, maximum) {
  if (typeof value !== 'string' || !value.length || value.length > Math.ceil(maximum / 3) * 4 ||
      value.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw fault('GEMINI_AUDIO_INVALID');
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.length > maximum || bytes.length % 2 || bytes.toString('base64') !== value) throw fault('GEMINI_AUDIO_INVALID');
  return bytes.length;
}
function createGeminiLiveEvaluationTransport({ connectLive, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (typeof connectLive !== 'function') throw fault('GEMINI_NOT_CONFIGURED');
  function open({ language, onEvent } = {}) {
    const request = configuration(language);
    if (typeof onEvent !== 'function') throw fault('GEMINI_EVENT_SINK_REQUIRED');
    let phase = 'connecting'; let session; let setupComplete = false; let closed = false; let creationState = 'not_started';
    let greetingSent = false; let inputBytes = 0; let outputBytes = 0; let transcriptChars = 0; let playbackEpoch = 0;
    let closeAttempted = false; let closeWait; let closeTimer; let closeResolve;
    let setupTimer; let lifetimeTimer; let resolveReady; let rejectReady; let readySettled = false;
    const expiresAt = now() + LIMITS.lifetimeMs;
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    // Avoid an unhandled rejection if a caller stops while still attaching its
    // await. The original promise still rejects for callers.
    ready.catch(() => {});
    const timer = (fn, ms) => { const id = setTimer(fn, ms); id?.unref?.(); return id; };
    function emit(event) {
      try { onEvent(Object.freeze(event)); } catch { stop('event_sink_failed'); }
    }
    function receipt() { return Object.freeze({ transportClosedConfirmed: closed,
      providerFinalUsageConfirmed: false, creationPending: creationState === 'pending', creationOutcomeUncertain: creationState === 'uncertain' }); }
    function settleReady(error) {
      if (readySettled) return;
      readySettled = true; clearTimer(setupTimer);
      if (error) rejectReady(error); else resolveReady(Object.freeze({ model: MODEL, voice: VOICE, language, expiresAt }));
    }
    function canRun() {
      if (now() >= expiresAt) stop('expired');
      return phase === 'ready';
    }
    function markReady() {
      if (phase !== 'connecting' || !session || !setupComplete) return;
      if (now() >= expiresAt) { stop('expired'); return; }
      phase = 'ready'; settleReady(); emit({ type: 'session.ready', model: MODEL, voice: VOICE, language, expiresAt });
    }
    function settleClose() {
      clearTimer(closeTimer);
      if (closeResolve) { const resolve = closeResolve; closeResolve = null; resolve(receipt()); }
    }
    function closeSession() {
      if (!session || typeof session.close !== 'function' || closeAttempted || closed) return;
      closeAttempted = true;
      try {
        // SDK close() requests socket closure. Only onclose confirms transport
        // closure; neither event proves final provider usage or retention.
        Promise.resolve(session.close()).catch(() => { closeAttempted = false; settleClose(); });
      } catch { closeAttempted = false; settleClose(); }
    }
    function stop(reason = 'stopped') {
      if (phase !== 'stopping' && phase !== 'closed') {
        phase = 'stopping'; clearTimer(setupTimer); clearTimer(lifetimeTimer);
        settleReady(fault('GEMINI_SESSION_STOPPED'));
        playbackEpoch++; emit({ type: 'playback.clear', playbackEpoch, reason });
      }
      if (closed) return Promise.resolve(receipt());
      if (!closeWait) {
        closeWait = new Promise(resolve => { closeResolve = resolve; });
        closeTimer = timer(settleClose, LIMITS.closeMs);
      }
      closeSession();
      return closeWait;
    }
    function fail(code) {
      if (phase === 'stopping' || phase === 'closed') return;
      settleReady(fault(code)); emit({ type: 'error', code }); stop(code);
    }
    function message(value) {
      if (phase === 'stopping' || phase === 'closed') return;
      if (now() >= expiresAt) { stop('expired'); return; }
      if (!value || typeof value !== 'object' || Array.isArray(value)) { fail('GEMINI_EVENT_INVALID'); return; }
      if (value.toolCall || value.toolCallCancellation) { fail('GEMINI_TOOLS_FORBIDDEN'); return; }
      if (value.goAway) { fail('GEMINI_PROVIDER_GOING_AWAY'); return; }
      if (value.setupComplete) { setupComplete = true; markReady(); }
      const content = value.serverContent;
      if (!content) return;
      // Never deliver content before both setup acknowledgement and the SDK
      // connection handle exist. No replay buffer is kept.
      if (phase !== 'ready') { fail('GEMINI_CONTENT_BEFORE_READY'); return; }
      try {
        const parts = content.modelTurn?.parts || [];
        if (!Array.isArray(parts) || parts.length > 16 || parts.some(part => !part || part.functionCall || part.executableCode || part.codeExecutionResult)) throw fault('GEMINI_EVENT_INVALID');
        const audio = [];
        for (const part of parts) {
          if (part.inlineData) {
            if (part.inlineData.mimeType !== 'audio/pcm;rate=24000') throw fault('GEMINI_AUDIO_INVALID');
            const bytes = pcmBase64(part.inlineData.data, LIMITS.outputChunkBytes);
            outputBytes += bytes;
            if (outputBytes > LIMITS.outputBytes) throw fault('GEMINI_OUTPUT_LIMIT');
            audio.push(part.inlineData.data);
          }
        }
        const transcripts = [];
        for (const [field, speaker, provisional] of [['inputTranscription', 'user', true], ['interimInputTranscription', 'user', true], ['outputTranscription', 'assistant', true]]) {
          if (!content[field]) continue;
          const text = content[field].text;
          if (typeof text !== 'string' || text.length > LIMITS.transcriptChunkChars) throw fault('GEMINI_TRANSCRIPT_INVALID');
          transcriptChars += text.length;
          if (transcriptChars > LIMITS.transcriptChars) throw fault('GEMINI_TRANSCRIPT_LIMIT');
          transcripts.push({ type: 'transcript', speaker, text, provisional, evidence: 'provider_unreviewed' });
        }
        if (content.interrupted) { playbackEpoch++; emit({ type: 'playback.clear', playbackEpoch, reason: 'interrupted' }); }
        // A combined interruption/audio message must not re-enqueue stale audio.
        else for (const data of audio) { if (!canRun()) break; emit({ type: 'audio.pcm', data, sampleRate: 24000, playbackEpoch }); }
        for (const transcript of transcripts) { if (!canRun()) break; emit(transcript); }
        if (canRun() && content.turnComplete) emit({ type: 'turn.complete', playbackEpoch, playbackConfirmed: false });
      } catch (error) { fail(error.code || 'GEMINI_EVENT_INVALID'); }
    }
    function send(payload) {
      if (!canRun()) throw fault('GEMINI_SESSION_NOT_READY');
      try { session.sendRealtimeInput(payload); } catch { fail('GEMINI_SEND_FAILED'); throw fault('GEMINI_SEND_FAILED'); }
    }
    setupTimer = timer(() => fail('GEMINI_SETUP_TIMEOUT'), LIMITS.setupMs);
    lifetimeTimer = timer(() => stop('expired'), LIMITS.lifetimeMs);
    // A single injected SDK seam. Late connections are retained only for close.
    Promise.resolve().then(() => {
      if (phase !== 'connecting') throw fault('GEMINI_SESSION_STOPPED');
      creationState = 'pending';
      return connectLive({ ...request, callbacks: { onopen() {}, onmessage: message,
        onerror() { fail('GEMINI_PROVIDER_ERROR'); },
        onclose() {
          if (closed) return;
          closed = true; phase = 'closed'; clearTimer(setupTimer); clearTimer(lifetimeTimer);
          settleReady(fault('GEMINI_TRANSPORT_CLOSED')); playbackEpoch++;
          emit({ type: 'playback.clear', playbackEpoch, reason: 'transport_closed' }); settleClose();
          emit({ type: 'session.closed', ...receipt() });
        } } }, { isActive: () => phase === 'connecting' && now() < expiresAt });
    }).then(value => {
      session = value;
      if (!session || typeof session.close !== 'function' || typeof session.sendRealtimeInput !== 'function') {
        creationState = 'uncertain'; fail('GEMINI_HANDLE_INVALID'); closeSession(); return;
      }
      creationState = 'resolved';
      if (phase === 'stopping' || phase === 'closed') closeSession(); else markReady();
    }).catch(() => { if (creationState === 'pending') creationState = 'uncertain'; fail('GEMINI_CREATION_UNCONFIRMED'); });
    return Object.freeze({ ready,
      sendPcm(data) {
        if (!canRun()) throw fault('GEMINI_SESSION_NOT_READY');
        const bytes = pcmBase64(data, LIMITS.inputChunkBytes);
        if (inputBytes + bytes > LIMITS.inputBytes) { fail('GEMINI_INPUT_LIMIT'); throw fault('GEMINI_INPUT_LIMIT'); }
        inputBytes += bytes; send({ audio: { data, mimeType: 'audio/pcm;rate=16000' } });
      },
      sendGreeting() {
        if (greetingSent) throw fault('GEMINI_GREETING_ALREADY_SENT');
        send({ text: fixturePrompt(language) }); greetingSent = true;
      },
      endAudio() { send({ audioStreamEnd: true }); }, stop,
      status: () => Object.freeze({ phase, expiresAt, playbackEpoch, ...receipt() }),
    });
  }
  return Object.freeze({ open });
}
module.exports = { createGeminiLiveEvaluationTransport, configuration, LANGUAGES, LIMITS, MODEL, VOICE };
