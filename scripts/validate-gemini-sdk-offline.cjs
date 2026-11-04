'use strict';
// Pinned official SDK interoperability check. Never uses an account/key or
// network. Run in a clean environment with a separately installed SDK root:
// env -i PATH="$PATH" node scripts/validate-gemini-sdk-offline.cjs /path/to/sdk-root
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const { createHash } = require('node:crypto');
const { createGeminiDeveloperClientFactory, REGION_SCOPE } = require('../server/services/voice/geminiDeveloperClient');
const { createGeminiCredentialBinding } = require('../server/services/voice/geminiCredentialBinding');
const { createGeminiLiveEvaluationTransport, MODEL } = require('../server/services/voice/geminiLiveEvaluationTransport');
const { createGeminiOwnedWebSocketClientFactory } = require('../server/services/voice/geminiOwnedWebSocketClient');
const VERSION = '2.32.0', INTEGRITY = 'sha512-60c79uXpR0a47bmGqDxbXEBuQUalNmwo5mx5kqb91jIW4FoqpsLSt86DeVhRhtH5+s/16Wqxt3sXzFQn2U1OHQ==';
const root = process.argv[2];
if (!root || !path.isAbsolute(root)) throw new Error('Supply the absolute isolated SDK installation root.');
for (const name of ['GOOGLE_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS']) {
  if (Object.hasOwn(process.env, name)) throw new Error('Run this offline test in a clean environment.');
}
const sdkPath = path.join(root, 'node_modules/@google/genai'), manifest = JSON.parse(fs.readFileSync(path.join(sdkPath, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
assert.equal(manifest.version, VERSION); assert.equal(lock.packages['node_modules/@google/genai'].integrity, INTEGRITY);
let networkAttempts = 0;
const blocked = () => { networkAttempts++; throw new Error('Offline SDK test forbids all real network access.'); };
require('node:net').Socket.prototype.connect = blocked;
require('node:net').connect = blocked; require('node:net').createConnection = blocked;
require('node:tls').connect = blocked; require('node:http').request = blocked; require('node:https').request = blocked;
globalThis.fetch = blocked;
const sockets = []; let autoSetup = true, autoOpen = true;
class OfflineWebSocket extends require('node:events').EventEmitter {
  constructor(url) {
    super(); this.url = url; this.sent = []; this.closes = 0; this.terminates = 0; this.readyState = 0; this.bufferedAmount = 0; this.autoSetup = autoSetup; sockets.push(this);
    if (autoOpen) queueMicrotask(() => { if (this.readyState !== 0) return; this.readyState = 1; this.onopen?.({}); this.emit('open'); });
  }
  send(raw, callback) {
    assert.equal(this.readyState, 1); const value = JSON.parse(raw); this.sent.push(value);
    if (value.setup && this.autoSetup) queueMicrotask(() => this.receive({ setupComplete: {} }));
    callback?.();
  }
  receive(value) { const raw = JSON.stringify(value); this.onmessage?.({ data: raw }); this.emit('message', raw, false); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.closes++; queueMicrotask(() => { this.onclose?.({ code: 1000, reason: 'offline fixture' }); this.emit('close', 1000, Buffer.alloc(0)); }); }
  terminate() { this.terminates++; this.close(); }
}
const wsPath = require.resolve('ws', { paths: [sdkPath] }), replacement = new Module(wsPath);
replacement.loaded = true; replacement.exports = { WebSocket: OfflineWebSocket }; require.cache[wsPath] = replacement;
// Deliberately conflicting NONSECRET defaults must not select another backend.
process.env.GOOGLE_GENAI_USE_VERTEXAI = 'true'; process.env.GOOGLE_GENAI_USE_ENTERPRISE = 'true';
process.env.GOOGLE_GEMINI_BASE_URL = 'https://offline-invalid.invalid/';
const { GoogleGenAI } = require(path.join(sdkPath, 'dist/node/index.cjs'));
const factory = createGeminiDeveloperClientFactory({ GoogleGenAI, env: { NODE_ENV: 'test' } });
const key = 'fictional_offline_noncredential', binding = { provider: 'google', model: MODEL, accountRef: 'fictional-account', projectRef: 'fictional-project', region: REGION_SCOPE, termsVersion: 'fictional-terms', retentionVersion: 'fictional-retention' };
const credentialFor = createClient => createGeminiCredentialBinding({ providerBinding: binding, credentialRef: 'fictional-reference',
  readCredentialSnapshot: async () => ({ ...binding, credentialRef: 'fictional-reference', revision: 'r1', status: 'verified', fingerprintSha256: createHash('sha256').update(key).digest('hex'), observedAt: Date.now(), validFrom: 0, expiresAt: Date.now() + 180000 }),
  readCredential: async () => key, createClient });
const credential = credentialFor(factory);
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
async function main() {
  const cases = [], sdkFrames = {};
  for (const language of ['ha', 'ig', 'yo']) {
    const events = [], transport = createGeminiLiveEvaluationTransport({ connectLive: credential.connectLive });
    const session = transport.open({ language, onEvent: event => events.push(event) }); await session.ready;
    const ws = sockets.at(-1), address = new URL(ws.url), setup = ws.sent[0].setup;
    assert.equal(address.origin, 'wss://generativelanguage.googleapis.com');
    // This pinned SDK appends /ws to a URL serialization already ending in /.
    // Record its exact double-slash path; remote acceptance is not established.
    assert.equal(address.pathname, '//ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent');
    assert.equal(address.searchParams.get('key'), key); assert.equal(setup.model, 'models/' + MODEL);
    assert.deepEqual(setup.generationConfig.responseModalities, ['AUDIO']); assert.equal(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Zephyr');
    assert.equal(setup.tools, undefined); assert.match(JSON.stringify(setup.systemInstruction), /fictional, nonclinical/);
    session.sendPcm(Buffer.alloc(3200).toString('base64')); session.sendGreeting(); session.endAudio();
    assert.equal(ws.sent[1].realtimeInput.audio.mimeType, 'audio/pcm;rate=16000');
    assert.match(ws.sent[2].realtimeInput.text, /Fictional language demonstration only/); assert.equal(ws.sent[3].realtimeInput.audioStreamEnd, true);
    sdkFrames[language] = structuredClone(ws.sent);
    ws.receive({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.alloc(480).toString('base64') } }] }, outputTranscription: { text: 'Fictional fixture' } } });
    ws.receive({ serverContent: { interrupted: true } }); await flush();
    assert.equal(events.filter(event => event.type === 'audio.pcm').length, 1); assert.equal(events.some(event => event.reason === 'interrupted'), true);
    const receipt = await session.stop(); assert.equal(receipt.transportClosedConfirmed, true); assert.equal(receipt.providerFinalUsageConfirmed, false); assert.equal(ws.closes, 1);
    cases.push({ language, sdkSerialization: 'passed', wirePath: address.pathname, remotePathAcceptanceVerified: false, syntheticPcmAndInterrupt: 'passed', postSetupClose: 'confirmed_by_fake_socket' });
  }
  autoSetup = false;
  const transport = createGeminiLiveEvaluationTransport({ connectLive: credential.connectLive, setTimer: (fn, ms) => setTimeout(fn, ms === 3000 ? 20 : ms) });
  const pending = transport.open({ language: 'ha', onEvent() {} }); await flush(); const ws = sockets.at(-1);
  assert.equal(ws.sent.length, 1); const stopped = pending.stop(); await assert.rejects(pending.ready);
  // The SDK has a private open socket but has not returned a public Session.
  // Our adapter cannot close that socket until setup resolves. Record the gap,
  // never report the local Stop request as confirmed provider cleanup.
  const receipt = await Promise.all([stopped, new Promise(resolve => setTimeout(resolve, 30))]).then(values => values[0]);
  assert.equal(receipt.creationPending, true); assert.equal(receipt.transportClosedConfirmed, false); assert.equal(ws.closes, 0);
  ws.receive({ setupComplete: {} }); await flush(); assert.equal(ws.closes, 1); assert.equal(pending.status().transportClosedConfirmed, true);
  assert.equal(ws.sent.length, 1);
  const ownedCredential = credentialFor(createGeminiOwnedWebSocketClientFactory({ WebSocket: OfflineWebSocket, env: { NODE_ENV: 'test' } }));
  const ownedCases = []; autoSetup = true;
  for (const language of ['ha', 'ig', 'yo']) {
    const transport = createGeminiLiveEvaluationTransport({ connectLive: ownedCredential.connectLive });
    const session = transport.open({ language, onEvent() {} }); await session.ready; const owned = sockets.at(-1);
    assert.equal(new URL(owned.url).pathname, '/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent');
    session.sendPcm(Buffer.alloc(3200).toString('base64')); session.sendGreeting(); session.endAudio();
    assert.deepEqual(owned.sent, sdkFrames[language]); assert.equal((await session.stop()).transportClosedConfirmed, true);
    ownedCases.push({ language, setupAndRealtimeFrames: 'exact_match_with_pinned_sdk', canonicalSingleSlashPath: true });
  }
  const ownedPendingCases = []; autoSetup = false;
  for (const opens of [false, true]) {
    autoOpen = opens;
    const transport = createGeminiLiveEvaluationTransport({ connectLive: ownedCredential.connectLive });
    const session = transport.open({ language: 'ha', onEvent() {} }); await flush(); const owned = sockets.at(-1);
    const stopping = session.stop(); await assert.rejects(session.ready); const outcome = await stopping;
    assert.equal(outcome.transportClosedConfirmed, true); assert.equal(outcome.providerFinalUsageConfirmed, false); assert.equal(outcome.creationPending, false);
    assert.equal(owned.sent.length, opens ? 1 : 0); assert.equal(owned.closes, 1);
    ownedPendingCases.push({ phase: opens ? 'open_before_setup' : 'connecting', socketCloseEventObserved: true, providerFinalUsageConfirmed: false });
  }
  assert.equal(networkAttempts, 0);
  process.stdout.write(JSON.stringify({ sdk: '@google/genai', version: VERSION, integrity: INTEGRITY, realNetworkCalls: networkAttempts, credential: 'fictional_noncredential_only', cases,
    preSetupStop: { immediateProviderClosureSupported: false, pendingStateAccuratelyReported: true, lateSetupClosed: true, activationBlocker: 'Pinned SDK does not expose the pending WebSocket before setup completion. A hung setup has no tested immediate cleanup path.' },
    ownedConnector: { cases: ownedCases, pendingStop: ownedPendingCases, sdkPendingOwnershipGapAvoided: true },
    realProviderConnected: false, audioQualityOrLanguageAcceptanceVerified: false }, null, 2) + '\n');
}
main().catch(error => { process.stderr.write('Offline SDK interoperability check failed. No secret details are logged.\n' + String(error?.stack || '').split('\n').filter(line => /^\s+at /.test(line)).join('\n') + '\n'); process.exitCode = 1; });
