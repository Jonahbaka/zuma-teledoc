'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const { createHash } = require('node:crypto');
const http = require('node:http');
const NodeWebSocket = require('ws');
const { createGeminiOwnedWebSocketClientFactory, ENDPOINT, REGION_SCOPE, SOCKET_LIMITS } = require('../../services/voice/geminiOwnedWebSocketClient');
const { createGeminiCredentialBinding } = require('../../services/voice/geminiCredentialBinding');
const { MODEL, LANGUAGES, configuration, createGeminiLiveEvaluationTransport } = require('../../services/voice/geminiLiveEvaluationTransport');
const key = 'fictional_noncredential_value';
const binding = { provider: 'google', model: MODEL, accountRef: 'fictional-account', projectRef: 'fictional-project',
  region: REGION_SCOPE, termsVersion: 'fictional-terms', retentionVersion: 'fictional-retention' };
const tick = () => new Promise(resolve => setImmediate(resolve));
const greeting = language => `Fictional language demonstration only, not a patient conversation. Speak in ${LANGUAGES[language]}. Briefly greet a fictional adult visitor and ask whether they prefer to continue in ${LANGUAGES[language]}. No medical advice, personal data, or tools.`;
function fixture(options = {}) {
  const sockets = [], events = [];
  class FictionalWebSocket extends EventEmitter {
    constructor(url, settings) {
      super(); if (options.throwCreate) throw new Error(key);
      this.url = url; this.settings = settings; this.readyState = 0; this.bufferedAmount = 0;
      this.sent = []; this.closes = 0; this.terminations = 0; sockets.push(this);
    }
    open() { this.readyState = 1; this.emit('open'); }
    receive(value) { this.emit('message', Buffer.from(JSON.stringify(value))); }
    send(raw, callback) {
      if (options.throwSend) throw new Error(key);
      this.sent.push(JSON.parse(raw));
      if (options.failSend) queueMicrotask(() => callback(new Error(key)));
      else callback?.();
    }
    close() { this.closes++; if (options.throwClose) throw new Error(key); this.readyState = 2; this.finish(); }
    terminate() { this.terminations++; if (options.throwTerminate) throw new Error(key); this.readyState = 2; this.finish(); }
    finish() {
      if (options.autoClose === false) return;
      const emit = () => { this.readyState = 3; this.emit('close', 1006, Buffer.from(key)); };
      if (options.syncClose) emit(); else queueMicrotask(emit);
    }
  }
  const callbacks = Object.fromEntries(['onopen', 'onmessage', 'onerror', 'onclose'].map(name => [name, value => events.push({ name, value })]));
  const factory = createGeminiOwnedWebSocketClientFactory({ WebSocket: FictionalWebSocket, env: { NODE_ENV: 'test' } });
  const create = () => factory({ apiKey: key, providerBinding: binding });
  const connect = (language = 'ha', overrides = {}) => create().live.connect({ ...configuration(language), callbacks, ...overrides });
  return { sockets, events, factory, create, connect, callbacks, FictionalWebSocket };
}
function boundTransport(factory, onEvent, extra = {}) {
  const credential = createGeminiCredentialBinding({ providerBinding: binding, credentialRef: 'fictional-reference',
    readCredentialSnapshot: async () => ({ ...binding, credentialRef: 'fictional-reference', status: 'verified', revision: 'r1',
      fingerprintSha256: createHash('sha256').update(key).digest('hex'), observedAt: Date.now(), validFrom: 0, expiresAt: Date.now() + 180000 }),
    readCredential: async () => key, createClient: factory });
  return createGeminiLiveEvaluationTransport({ connectLive: credential.connectLive, ...extra }).open({ language: 'ha', onEvent });
}
test('factory and client are inert; connect exposes an owned handle immediately before open/setup', async () => {
  const f = fixture(), client = f.create(); assert.equal(f.sockets.length, 0);
  const session = client.live.connect({ ...configuration('ha'), callbacks: f.callbacks });
  assert.equal(typeof session.then, 'undefined'); assert.deepEqual(Object.keys(session), ['close', 'sendRealtimeInput']);
  assert.equal(f.sockets.length, 1); assert.equal(f.sockets[0].sent.length, 0);
  assert.equal(f.sockets[0].url, `${ENDPOINT}?key=${encodeURIComponent(key)}`);
  assert.deepEqual(f.sockets[0].settings, { followRedirects: false, perMessageDeflate: false, maxPayload: SOCKET_LIMITS.inboundBytes, handshakeTimeout: 10000, rejectUnauthorized: true });
  assert.throws(() => session.sendRealtimeInput({ text: greeting('ha') }), { code: 'VOICE_DEVELOPER_SOCKET_NOT_READY' });
  session.close(); await tick(); assert.equal(f.sockets[0].terminations, 1);
  assert.equal(f.events.filter(event => event.name === 'onclose').length, 1);
});
test('production/missing dependency, endpoints, extra fields, wrong model or binding fail before creating a socket', () => {
  for (const env of [{}, { NODE_ENV: 'production' }, { NODE_ENV: 'preview' }]) assert.throws(() => createGeminiOwnedWebSocketClientFactory({ WebSocket: function () {}, env }));
  assert.throws(() => createGeminiOwnedWebSocketClientFactory({ env: { NODE_ENV: 'test' } }));
  assert.throws(() => createGeminiOwnedWebSocketClientFactory({ WebSocket: function () {}, env: { NODE_ENV: 'test' }, endpoint: 'wss://other.invalid' }));
  const f = fixture();
  for (const input of [{}, { apiKey: '', providerBinding: binding }, { apiKey: 'auth_tokens/fictional', providerBinding: binding },
    { apiKey: key + '?redirect=other', providerBinding: binding }, { apiKey: key, providerBinding: { ...binding, provider: 'other' } },
    { apiKey: key, providerBinding: { ...binding, region: 'assumed-regional' } }, { apiKey: key, providerBinding: { ...binding, model: 'other' } },
    { apiKey: key, providerBinding: { ...binding, endpoint: 'other' } }, { apiKey: key, providerBinding: binding, endpoint: 'wss://other.invalid' }]) {
    assert.throws(() => f.factory(input), { code: 'VOICE_DEVELOPER_SOCKET_REQUIRED' });
  }
  const accessor = { providerBinding: binding }; Object.defineProperty(accessor, 'apiKey', { enumerable: true, get() { throw new Error(key); } });
  assert.throws(() => f.factory(accessor), { code: 'VOICE_DEVELOPER_SOCKET_REQUIRED' });
  assert.equal(f.sockets.length, 0);
});
test('representative exact nonclinical configurations are accepted and serialized in SDK wire shape', async () => {
  const f = fixture();
  for (const language of ['ha', 'ig', 'yo']) {
    const session = f.connect(language), ws = f.sockets.at(-1), config = configuration(language).config;
    ws.open(); assert.deepEqual(ws.sent, [{ setup: { model: `models/${MODEL}`, generationConfig: {
      responseModalities: ['AUDIO'], speechConfig: config.speechConfig }, systemInstruction: { parts: [{ text: config.systemInstruction }], role: 'user' },
    inputAudioTranscription: {}, outputAudioTranscription: {}, realtimeInputConfig: config.realtimeInputConfig } }]);
    assert.throws(() => session.sendRealtimeInput({ text: greeting(language) }), { code: 'VOICE_DEVELOPER_SOCKET_NOT_READY' });
    ws.receive({ setupComplete: {} });
    const audio = { data: Buffer.alloc(3200).toString('base64'), mimeType: 'audio/pcm;rate=16000' };
    session.sendRealtimeInput({ audio }); session.sendRealtimeInput({ text: greeting(language) }); session.sendRealtimeInput({ audioStreamEnd: true });
    assert.deepEqual(ws.sent.slice(1), [{ realtimeInput: { audio } }, { realtimeInput: { text: greeting(language) } }, { realtimeInput: { audioStreamEnd: true } }]);
    session.close(); await tick();
  }
  for (const change of [{ model: 'other' }, { config: { ...configuration('ha').config, tools: [{ googleSearch: {} }] } },
    { config: { ...configuration('ha').config, sessionResumption: {} } }, { config: { ...configuration('ha').config, systemInstruction: 'Use real patient details' } },
    { config: { ...configuration('ha').config, httpOptions: { baseUrl: 'https://other.invalid' } } }, { endpoint: 'wss://other.invalid' }, { callbacks: { onmessage() {} } }]) {
    assert.throws(() => f.connect('ha', change), { code: 'VOICE_DEVELOPER_SOCKET_REQUIRED' });
  }
  assert.equal(f.sockets.length, 3);
});
test('Stop while CONNECTING terminates once and ignores late open/setup/error without sending', async () => {
  const f = fixture(), session = f.connect(), ws = f.sockets[0];
  session.close(); session.close(); ws.open(); ws.receive({ setupComplete: {} }); ws.emit('error', new Error(key)); await tick();
  assert.equal(ws.terminations, 1); assert.equal(ws.closes, 0); assert.equal(ws.sent.length, 0);
  assert.deepEqual(f.events, [{ name: 'onclose', value: undefined }]);
  ws.emit('close'); ws.emit('error', new Error(key)); ws.receive({ setupComplete: {} });
  assert.equal(f.events.length, 1);
});
test('Stop after open but before setup owns closure, never waits for or sends after late setup', async () => {
  const f = fixture(), events = [], session = boundTransport(f.factory, event => events.push(event));
  await tick(); const ws = f.sockets[0]; ws.open();
  const stopped = session.stop(); await assert.rejects(session.ready); ws.receive({ setupComplete: {} });
  const receipt = await stopped;
  assert.equal(receipt.creationPending, false); assert.equal(receipt.creationOutcomeUncertain, false);
  assert.equal(receipt.transportClosedConfirmed, true); assert.equal(receipt.providerFinalUsageConfirmed, false);
  assert.equal(ws.closes, 1); assert.equal(ws.sent.length, 1); assert.equal(events.some(event => event.type === 'session.ready'), false);
});
test('binding plus transport remains connecting until setup and handles PCM, interruption and confirmed close', async () => {
  const f = fixture(), events = [], session = boundTransport(f.factory, event => events.push(event));
  await tick(); const ws = f.sockets[0]; assert.equal(session.status().phase, 'connecting'); ws.open();
  assert.equal(session.status().phase, 'connecting'); ws.receive({ setupComplete: {} }); await session.ready;
  session.sendGreeting(); session.sendPcm(Buffer.alloc(3200).toString('base64')); session.endAudio();
  ws.receive({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.alloc(480).toString('base64') } }] }, outputTranscription: { text: 'Fictional greeting' } } });
  ws.receive({ serverContent: { interrupted: true } });
  assert.equal(events.filter(event => event.type === 'audio.pcm').length, 1); assert.equal(events.some(event => event.reason === 'interrupted'), true);
  const receipt = await session.stop(); assert.equal(receipt.transportClosedConfirmed, true); assert.equal(receipt.providerFinalUsageConfirmed, false);
  assert.throws(() => session.sendPcm(Buffer.alloc(2).toString('base64'))); assert.equal(JSON.stringify(events).includes(key), false);
});
test('requesting close, termination or a failed close never fabricates a close confirmation', async () => {
  for (const behavior of [{ autoClose: false }, { autoClose: false, throwClose: true, throwTerminate: true }]) {
    const f = fixture(behavior), session = boundTransport(f.factory, () => {}, {
      setTimer: (fn, ms) => setTimeout(fn, ms === 3000 ? 15 : ms) });
    await tick(); const ws = f.sockets[0]; ws.open();
    const receipt = await Promise.all([session.stop(), new Promise(resolve => setTimeout(resolve, 20))]).then(results => results[0]);
    assert.equal(receipt.transportClosedConfirmed, false); assert.equal(receipt.creationPending, false); assert.equal(receipt.providerFinalUsageConfirmed, false);
    ws.emit('close', 1006, key); assert.equal(session.status().transportClosedConfirmed, true);
  }
});
test('open sockets that ignore graceful close are forcibly terminated within the bounded grace', async () => {
  const f = fixture({ autoClose: false }), session = f.connect(), ws = f.sockets[0]; ws.open(); session.close();
  assert.equal(ws.closes, 1); assert.equal(ws.terminations, 0);
  await new Promise(resolve => setTimeout(resolve, SOCKET_LIMITS.closeGraceMs + 30));
  assert.equal(ws.terminations, 1); assert.equal(f.events.filter(event => event.name === 'onclose').length, 0);
  ws.emit('close'); assert.equal(f.events.filter(event => event.name === 'onclose').length, 1);
});
test('setup and lifetime deadlines bound the independently owned socket without replay', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = fixture(), waiting = pending.connect(), pendingSocket = pending.sockets[0]; pendingSocket.open();
  t.mock.timers.tick(10000); await tick();
  assert.equal(pending.events.filter(event => event.name === 'onerror').length, 1);
  assert.equal(pending.events.filter(event => event.name === 'onclose').length, 1);
  assert.throws(() => waiting.sendRealtimeInput({ audioStreamEnd: true }));
  const active = fixture(), session = active.connect(), ws = active.sockets[0]; ws.open(); ws.receive({ setupComplete: {} });
  t.mock.timers.tick(180000); await tick();
  assert.equal(ws.closes, 1); assert.equal(active.events.filter(event => event.name === 'onclose').length, 1);
  assert.equal(active.events.filter(event => event.name === 'onerror').length, 0);
  assert.throws(() => session.sendRealtimeInput({ audioStreamEnd: true })); assert.equal(active.sockets.length, 1);
});
test('lifecycle callbacks are once-only, sanitized and cannot reentrantly send after failure', async () => {
  const f = fixture(), session = f.connect(), ws = f.sockets[0]; ws.open(); ws.emit('open'); ws.receive({ setupComplete: {} });
  ws.emit('error', new Error(key)); ws.emit('error', new Error(key)); await tick(); ws.emit('close');
  assert.equal(f.events.filter(event => event.name === 'onopen').length, 1); assert.equal(f.events.filter(event => event.name === 'onerror').length, 1);
  assert.equal(f.events.filter(event => event.name === 'onclose').length, 1); assert.equal(ws.sent.length, 1);
  assert.equal(f.events.find(event => event.name === 'onerror').value.code, 'VOICE_DEVELOPER_SOCKET_FAILED');
  assert.equal(JSON.stringify(f.events).includes(key), false); assert.throws(() => session.sendRealtimeInput({ audioStreamEnd: true }));
});
test('synchronous error and close ordering blocks reentrant sends and emits each terminal callback once', () => {
  const f = fixture({ syncClose: true }); let session, reentrantError;
  session = f.connect('ha', { callbacks: { ...f.callbacks, onerror(error) {
    f.callbacks.onerror(error);
    try { session.sendRealtimeInput({ audioStreamEnd: true }); } catch (failure) { reentrantError = failure; }
    session.close();
  } } });
  const ws = f.sockets[0]; ws.open(); ws.receive({ setupComplete: {} }); ws.emit('error', new Error(key)); ws.emit('close'); ws.emit('error', new Error(key));
  assert.deepEqual(f.events.map(event => event.name), ['onopen', 'onmessage', 'onerror', 'onclose']);
  assert.equal(reentrantError?.code, 'VOICE_DEVELOPER_SOCKET_NOT_READY');
  assert.equal(ws.sent.length, 1); assert.equal(ws.closes, 1); assert.equal(JSON.stringify(f.events).includes(key), false);
});
test('Stop invoked from onopen prevents setup; a throwing callback closes without leaking its exception', async () => {
  for (const throws of [false, true]) {
    const f = fixture(); let session;
    session = f.connect('ha', { callbacks: { ...f.callbacks, onopen() { if (throws) throw new Error(key); session.close(); } } });
    f.sockets[0].open(); await tick(); assert.equal(f.sockets[0].sent.length, 0);
    assert.equal(f.events.filter(event => event.name === 'onclose').length, 1); assert.equal(JSON.stringify(f.events).includes(key), false);
  }
});
test('malformed, oversized, deep, dangerous and unsupported provider frames fail closed', async () => {
  let deep = {}; for (let depth = 0; depth < SOCKET_LIMITS.jsonDepth + 1; depth++) deep = { nested: deep };
  const malformed = [Buffer.from('{'), Buffer.from('null'), Buffer.from('[]'), Buffer.from([0xff]),
    Buffer.alloc(SOCKET_LIMITS.inboundBytes + 1, 32), Buffer.from(JSON.stringify({ setupComplete: deep })),
    Buffer.from(JSON.stringify({ setupComplete: { large: Array(SOCKET_LIMITS.jsonNodes + 1).fill(0) } })),
    Buffer.from('{"setupComplete":{"__proto__":{"polluted":true}}}'),
    Buffer.from(JSON.stringify({ error: { message: key } })), Buffer.from(JSON.stringify({ setupComplete: { echo: key } })),
    Buffer.from(JSON.stringify({ toolCall: { functionCalls: [{ name: 'forbidden' }] } })), Buffer.from(JSON.stringify({ sessionResumptionUpdate: { newHandle: 'forbidden' } })),
    Buffer.from(JSON.stringify({ serverContent: { turnComplete: true } })), Buffer.from(JSON.stringify({ setupComplete: true }))];
  for (const raw of malformed) {
    const f = fixture(), session = f.connect(), ws = f.sockets[0]; ws.open(); ws.emit('message', raw); await tick();
    assert.equal(f.events.filter(event => event.name === 'onerror').length, 1); assert.equal(f.events.filter(event => event.name === 'onmessage').length, 0);
    assert.equal(f.events.filter(event => event.name === 'onclose').length, 1); assert.equal(JSON.stringify(f.events).includes(key), false);
    assert.throws(() => session.sendRealtimeInput({ audioStreamEnd: true }));
  }
});
test('ArrayBuffer and bounded Buffer fragments decode; a duplicate setup closes instead of replaying', async () => {
  const f = fixture(), session = f.connect(), ws = f.sockets[0]; ws.open();
  ws.emit('message', new TextEncoder().encode('{"setupComplete":{}}').buffer);
  ws.emit('message', [Buffer.from('{"serverContent":'), Buffer.from('{"turnComplete":true}}')]);
  assert.equal(f.events.filter(event => event.name === 'onmessage').length, 2);
  ws.receive({ setupComplete: {} }); await tick(); assert.equal(f.events.filter(event => event.name === 'onmessage').length, 2);
  assert.equal(f.events.filter(event => event.name === 'onerror').length, 1); session.close();
});
test('arbitrary prompts, tools, alternate audio formats, unbounded chunks and merged fields cannot be sent', async () => {
  const f = fixture(), session = f.connect(), ws = f.sockets[0]; ws.open(); ws.receive({ setupComplete: {} });
  for (const payload of [{ text: 'Collect real patient information' }, { toolResponse: {} }, { video: {} },
    { audio: { data: 'AAAA', mimeType: 'audio/pcm;rate=16000' } }, { audio: { data: 'AA==', mimeType: 'audio/pcm;rate=16000' } },
    { audio: { data: 'AAA=', mimeType: 'audio/pcm;rate=24000' } }, { audio: { data: Buffer.alloc(16002).toString('base64'), mimeType: 'audio/pcm;rate=16000' } },
    { audioStreamEnd: false }, { text: greeting('ha'), audioStreamEnd: true }]) assert.throws(() => session.sendRealtimeInput(payload), { code: 'VOICE_DEVELOPER_SOCKET_INPUT_INVALID' });
  session.sendRealtimeInput({ text: greeting('ha') }); assert.throws(() => session.sendRealtimeInput({ text: greeting('ha') }));
  assert.equal(ws.sent.length, 2); session.close(); await tick();
});
test('backpressure, synchronous sends, asynchronous send errors and constructor exceptions are bounded and sanitized', async () => {
  assert.throws(() => fixture({ throwCreate: true }).connect(), error => error.code === 'VOICE_DEVELOPER_SOCKET_REQUIRED' && !String(error).includes(key));
  for (const behavior of [{ throwSend: true }, { failSend: true }, { blocked: true }]) {
    const f = fixture(behavior), session = f.connect(), ws = f.sockets[0];
    if (behavior.blocked) ws.bufferedAmount = SOCKET_LIMITS.bufferedBytes;
    ws.open(); await tick();
    assert.equal(f.events.filter(event => event.name === 'onerror').length, 1); assert.equal(f.events.filter(event => event.name === 'onclose').length, 1);
    assert.equal(JSON.stringify(f.events).includes(key), false); assert.throws(() => session.sendRealtimeInput({ audioStreamEnd: true }));
  }
});
test('real Node ws closes a pending loopback handshake on Stop without any provider network', { timeout: 5000 }, async t => {
  const server = http.createServer(); const accepted = new Set();
  server.on('connection', socket => { accepted.add(socket); socket.on('close', () => accepted.delete(socket)); });
  server.on('upgrade', () => { /* Intentionally leave the handshake pending. */ });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const socket of accepted) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  const sockets = [], requests = [];
  class LoopbackOnlyWebSocket {
    constructor(url, options) {
      requests.push(url);
      const socket = new NodeWebSocket(`ws://127.0.0.1:${server.address().port}`, options); sockets.push(socket); return socket;
    }
  }
  const factory = createGeminiOwnedWebSocketClientFactory({ WebSocket: LoopbackOnlyWebSocket, env: { NODE_ENV: 'test' } });
  const upgraded = once(server, 'upgrade'); const session = boundTransport(factory, () => {}); await upgraded;
  assert.equal(sockets[0].readyState, NodeWebSocket.CONNECTING);
  const receipt = await session.stop(); await assert.rejects(session.ready);
  assert.equal(receipt.transportClosedConfirmed, true); assert.equal(receipt.providerFinalUsageConfirmed, false);
  assert.equal(sockets[0].readyState, NodeWebSocket.CLOSED); assert.deepEqual(requests, [`${ENDPOINT}?key=${key}`]);
});
test('real Node ws closes an open loopback socket without waiting for provider setupComplete', { timeout: 5000 }, async t => {
  const server = new NodeWebSocket.WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  t.after(async () => { for (const socket of server.clients) socket.terminate(); await new Promise(resolve => server.close(resolve)); });
  const connected = once(server, 'connection'), sockets = [], wireFrames = [];
  class LoopbackOnlyWebSocket {
    constructor(url, options) {
      assert.equal(url, `${ENDPOINT}?key=${key}`);
      const socket = new NodeWebSocket(`ws://127.0.0.1:${server.address().port}`, options); sockets.push(socket); return socket;
    }
  }
  const factory = createGeminiOwnedWebSocketClientFactory({ WebSocket: LoopbackOnlyWebSocket, env: { NODE_ENV: 'test' } });
  const session = boundTransport(factory, () => {}); const [peer] = await connected;
  peer.on('message', data => wireFrames.push(JSON.parse(data.toString())));
  await once(peer, 'message'); assert.equal(wireFrames.length, 1); assert.equal(session.status().phase, 'connecting');
  const receipt = await session.stop(); await assert.rejects(session.ready);
  assert.equal(receipt.transportClosedConfirmed, true); assert.equal(receipt.creationPending, false);
  assert.equal(receipt.providerFinalUsageConfirmed, false); assert.equal(sockets[0].readyState, NodeWebSocket.CLOSED);
  assert.equal(wireFrames.length, 1); assert.equal(sockets.length, 1);
});
test('real Node ws terminates a pre-setup OPEN loopback peer that never acknowledges graceful close', { timeout: 5000 }, async t => {
  const server = http.createServer(), accepted = new Set(), clients = [];
  server.on('connection', socket => { accepted.add(socket); socket.on('close', () => accepted.delete(socket)); });
  server.on('upgrade', (request, socket) => {
    const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    socket.on('data', () => {}); // Deliberately never send setupComplete or acknowledge the close frame.
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const socket of accepted) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  let closes = 0, terminations = 0;
  class LoopbackOnlyWebSocket {
    constructor(url, options) {
      assert.equal(url, `${ENDPOINT}?key=${key}`);
      const socket = new NodeWebSocket(`ws://127.0.0.1:${server.address().port}`, options);
      const terminate = socket.terminate.bind(socket), close = socket.close.bind(socket);
      socket.terminate = () => { terminations++; terminate(); };
      socket.close = (...args) => { closes++; close(...args); };
      clients.push({ socket, opened: once(socket, 'open') }); return socket;
    }
  }
  const factory = createGeminiOwnedWebSocketClientFactory({ WebSocket: LoopbackOnlyWebSocket, env: { NODE_ENV: 'test' } });
  const session = boundTransport(factory, () => {}); await tick(); await clients[0].opened;
  assert.equal(clients[0].socket.readyState, NodeWebSocket.OPEN); assert.equal(session.status().phase, 'connecting');
  const receipt = await session.stop(); await assert.rejects(session.ready);
  assert.equal(closes, 1); assert.equal(terminations, 1); assert.equal(clients[0].socket.readyState, NodeWebSocket.CLOSED);
  assert.equal(receipt.transportClosedConfirmed, true); assert.equal(receipt.providerFinalUsageConfirmed, false);
  assert.equal(receipt.creationPending, false); assert.equal(clients.length, 1);
});
