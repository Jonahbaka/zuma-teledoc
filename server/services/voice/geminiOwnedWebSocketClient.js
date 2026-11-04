'use strict';

const { isDeepStrictEqual } = require('node:util');
const { MODEL, LANGUAGES, LIMITS, configuration } = require('./geminiLiveEvaluationTransport');
const ENDPOINT = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const REGION_SCOPE = 'provider_global'; // This does not promise regional processing.
const SOCKET_LIMITS = Object.freeze({ inboundBytes: 1048576, jsonDepth: 16, jsonNodes: 4096,
  bufferedBytes: 65536, closeGraceMs: 250 });
const BINDING_KEYS = ['provider', 'accountRef', 'projectRef', 'model', 'region', 'termsVersion', 'retentionVersion'];
const CALLBACK_KEYS = ['onopen', 'onmessage', 'onerror', 'onclose'];
const ref = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const fault = (code = 'VOICE_DEVELOPER_SOCKET_REQUIRED') => Object.assign(new Error('The development voice socket is unavailable.'), { code, statusCode: 503 });
function record(value, keys) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => keys.includes(key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}
function greeting(language) {
  return `Fictional language demonstration only, not a patient conversation. Speak in ${LANGUAGES[language]}. Briefly greet a fictional adult visitor and ask whether they prefer to continue in ${LANGUAGES[language]}. No medical advice, personal data, or tools.`;
}
function setupFrame(language) {
  const { config } = configuration(language);
  // Exact limited wire conversion inspected in @google/genai 2.32.0:
  // liveConnectParametersToMldev, liveConnectConfigToMldev, tContent, tModel.
  // No arbitrary configuration, tools, resumption, endpoint or SDK internals.
  return { setup: { model: `models/${MODEL}`, generationConfig: {
    responseModalities: config.responseModalities, speechConfig: config.speechConfig,
  }, systemInstruction: { parts: [{ text: config.systemInstruction }], role: 'user' },
  inputAudioTranscription: {}, outputAudioTranscription: {}, realtimeInputConfig: config.realtimeInputConfig } };
}
function decodeFrame(data) {
  let bytes;
  if (typeof data === 'string') {
    if (data.length > SOCKET_LIMITS.inboundBytes || Buffer.byteLength(data) > SOCKET_LIMITS.inboundBytes) throw fault();
    bytes = Buffer.from(data);
  } else if (Buffer.isBuffer(data) || data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    if (data.byteLength > SOCKET_LIMITS.inboundBytes) throw fault();
    bytes = Buffer.isBuffer(data) ? data : data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  } else if (Array.isArray(data) && data.length <= 64 && data.every(Buffer.isBuffer)) {
    const size = data.reduce((sum, part) => sum + part.length, 0);
    if (size > SOCKET_LIMITS.inboundBytes) throw fault();
    bytes = Buffer.concat(data, size);
  } else throw fault();
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value = JSON.parse(decoded);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fault();
  const pending = [[value, 0]]; let nodes = 0;
  while (pending.length) {
    const [node, depth] = pending.pop();
    if (++nodes > SOCKET_LIMITS.jsonNodes || depth > SOCKET_LIMITS.jsonDepth) throw fault();
    if (!node || typeof node !== 'object') continue;
    for (const key of Object.keys(node)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw fault();
      if (pending.length >= SOCKET_LIMITS.jsonNodes) throw fault();
      pending.push([node[key], depth + 1]);
    }
  }
  return value;
}
// UNMOUNTED development/test-only seam. The injected, reviewed Node ws
// constructor is not imported or discovered. An approved credential-binding
// layer must provide the credential. No credential lookup, ownership assertion,
// quota claim, route, clinical activation, replay or reconnect occurs here.
function createGeminiOwnedWebSocketClientFactory(options = {}) {
  if (!record(options, ['WebSocket', 'env']) || typeof options.WebSocket !== 'function'
    || !['development', 'test'].includes(options.env?.NODE_ENV)) throw fault();
  const { WebSocket } = options;
  return function createClient(input = {}) {
    try {
      if (!record(input, ['apiKey', 'providerBinding']) || typeof input.apiKey !== 'string'
        || !/^[A-Za-z0-9_-]{8,1024}$/.test(input.apiKey) || !record(input.providerBinding, BINDING_KEYS)
        || BINDING_KEYS.some(key => !ref(input.providerBinding[key])) || input.providerBinding.provider !== 'google'
        || input.providerBinding.model !== MODEL || input.providerBinding.region !== REGION_SCOPE) throw fault();
    } catch { throw fault(); }
    const apiKey = input.apiKey;
    return Object.freeze({ live: Object.freeze({ connect(request) {
      let language, callbacks;
      try {
        if (!record(request, ['model', 'config', 'callbacks']) || !record(request.callbacks, CALLBACK_KEYS)
          || CALLBACK_KEYS.some(key => typeof request.callbacks[key] !== 'function')) throw fault();
        language = Object.keys(LANGUAGES).find(name => isDeepStrictEqual({ model: request.model, config: request.config }, configuration(name)));
        if (!language) throw fault();
        callbacks = { ...request.callbacks };
      } catch { throw fault(); }
      let socket;
      let opened = false, setupSent = false, ready = false, stopping = false, closed = false, errorNotified = false;
      let closeRequested = false, terminateRequested = false, greetingSent = false, inputBytes = 0;
      let setupTimer, lifetimeTimer, closeTimer;
      const timer = (fn, ms) => { const id = setTimeout(fn, ms); id.unref?.(); return id; };
      function clearRunningTimers() { clearTimeout(setupTimer); clearTimeout(lifetimeTimer); }
      function terminate() {
        if (closed || terminateRequested) return;
        terminateRequested = true;
        // A request to terminate is NOT evidence of closure. Only the actual
        // close event below may notify the transport that the socket is gone.
        try { socket.terminate(); } catch { /* The transport reports unconfirmed closure. */ }
      }
      function requestClosure() {
        if (closed || closeRequested || terminateRequested) return;
        if (socket.readyState === 0) { terminate(); return; }
        closeTimer = timer(terminate, SOCKET_LIMITS.closeGraceMs);
        if (socket.readyState === 1 && !closeRequested) {
          closeRequested = true;
          try { socket.close(1000, 'Evaluation stopped'); } catch { terminate(); }
        } else terminate();
      }
      function close() {
        if (closed || stopping) return;
        stopping = true; ready = false; clearRunningTimers(); requestClosure();
      }
      function fail() {
        if (closed || stopping) return;
        // Block reentrant sends before invoking any caller callback.
        stopping = true; ready = false; clearRunningTimers();
        if (!errorNotified) {
          errorNotified = true;
          try { callbacks.onerror(fault('VOICE_DEVELOPER_SOCKET_FAILED')); } catch { /* Never expose callback errors. */ }
        }
        // Notify failure before requesting closure, including when an injected
        // socket emits close synchronously. Neither callback implies usage.
        requestClosure();
      }
      function notify(name, value) {
        try { callbacks[name](value); } catch { fail(); }
      }
      function sendFrame(frame) {
        if (stopping || closed || socket.readyState !== 1) throw fault('VOICE_DEVELOPER_SOCKET_NOT_READY');
        const raw = JSON.stringify(frame);
        if (!Number.isFinite(socket.bufferedAmount) || socket.bufferedAmount < 0
          || socket.bufferedAmount + Buffer.byteLength(raw) > SOCKET_LIMITS.bufferedBytes) { fail(); throw fault('VOICE_DEVELOPER_SOCKET_FAILED'); }
        try {
          socket.send(raw, error => { if (error) fail(); });
        } catch { fail(); throw fault('VOICE_DEVELOPER_SOCKET_FAILED'); }
      }
      const session = Object.freeze({ close, sendRealtimeInput(payload) {
        if (!ready || stopping || closed) throw fault('VOICE_DEVELOPER_SOCKET_NOT_READY');
        let converted, bytes = 0;
        try {
          if (record(payload, ['text']) && payload.text === greeting(language) && !greetingSent) converted = { text: payload.text };
          else if (record(payload, ['audioStreamEnd']) && payload.audioStreamEnd === true) converted = { audioStreamEnd: true };
          else if (record(payload, ['audio']) && record(payload.audio, ['data', 'mimeType']) && payload.audio.mimeType === 'audio/pcm;rate=16000') {
            const data = payload.audio.data;
            if (typeof data !== 'string' || !data.length || data.length > Math.ceil(LIMITS.inputChunkBytes / 3) * 4
              || data.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw fault();
            const buffer = Buffer.from(data, 'base64'); bytes = buffer.length;
            if (!bytes || bytes % 2 || bytes > LIMITS.inputChunkBytes || buffer.toString('base64') !== data || inputBytes + bytes > LIMITS.inputBytes) throw fault();
            converted = { audio: { data, mimeType: 'audio/pcm;rate=16000' } };
          } else throw fault();
        } catch { throw fault('VOICE_DEVELOPER_SOCKET_INPUT_INVALID'); }
        inputBytes += bytes; if (converted.text) greetingSent = true;
        // The three allowed payloads are already the exact SDK's limited
        // liveSendRealtimeInputParametersToMldev conversion.
        sendFrame({ realtimeInput: converted });
      } });
      try {
        socket = new WebSocket(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
          followRedirects: false, perMessageDeflate: false, maxPayload: SOCKET_LIMITS.inboundBytes,
          handshakeTimeout: LIMITS.setupMs, rejectUnauthorized: true,
        });
        if (['on', 'send', 'close', 'terminate'].some(name => typeof socket[name] !== 'function')) throw fault();
        socket.on('error', () => { fail(); }); // Keep this guard attached even after close; never surface raw ws errors.
        socket.on('close', () => {
          if (closed) return;
          closed = true; stopping = true; ready = false; clearRunningTimers(); clearTimeout(closeTimer);
          // Do not forward close reasons, HTTP details, URLs or provider errors.
          try { callbacks.onclose(); } catch { /* Closure remains confirmed. */ }
        });
        socket.on('open', () => {
          if (stopping || closed) { terminate(); return; }
          if (opened) return;
          opened = true; notify('onopen');
          if (stopping || closed) return;
          setupSent = true;
          try { sendFrame(setupFrame(language)); } catch { fail(); }
        });
        socket.on('message', data => {
          if (stopping || closed) return;
          try {
            const message = decodeFrame(data);
            if (!opened || !setupSent || Object.keys(message).some(key => !['setupComplete', 'serverContent', 'usageMetadata'].includes(key))
              || JSON.stringify(message).includes(apiKey)) throw fault();
            if (Object.hasOwn(message, 'setupComplete')) {
              if (ready || !message.setupComplete || typeof message.setupComplete !== 'object' || Array.isArray(message.setupComplete)) throw fault();
              ready = true; clearTimeout(setupTimer);
            }
            if (!ready) throw fault();
            notify('onmessage', message);
          } catch { fail(); }
        });
        setupTimer = timer(fail, LIMITS.setupMs);
        lifetimeTimer = timer(close, LIMITS.lifetimeMs);
      } catch {
        stopping = true; clearRunningTimers(); clearTimeout(closeTimer);
        try { socket?.terminate?.(); } catch { /* Constructor/registration failures remain sanitized. */ }
        throw fault();
      }
      // Crucially synchronous: unlike SDK 2.32.0, ownership reaches the caller
      // before open/setupComplete. The evaluation transport still waits for the
      // real setup acknowledgment before marking ready or sending any audio.
      return session;
    } }) });
  };
}
module.exports = { createGeminiOwnedWebSocketClientFactory, ENDPOINT, REGION_SCOPE, SOCKET_LIMITS };
