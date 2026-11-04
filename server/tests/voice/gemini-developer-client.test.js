'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { createHash } = require('node:crypto');
const { createGeminiDeveloperClientFactory, ENDPOINT, REGION_SCOPE } = require('../../services/voice/geminiDeveloperClient');
const { createGeminiCredentialBinding } = require('../../services/voice/geminiCredentialBinding');
const { createGeminiLiveEvaluationTransport, MODEL, configuration } = require('../../services/voice/geminiLiveEvaluationTransport');
const binding = { provider: 'google', model: MODEL, accountRef: 'fictional-account', projectRef: 'fictional-project', region: REGION_SCOPE, termsVersion: 'fictional-terms', retentionVersion: 'fictional-retention' };
const key = 'fictional_noncredential_value';
function fixture(extra = {}) {
  const constructions = [], connections = [], sends = []; let closes = 0;
  class FictionalGenAI {
    constructor(options) {
      constructions.push(options);
      if (extra.throwCreate) throw new Error(key);
      this.authTokens = { create() { throw new Error('Must never be exposed.'); } };
      this.live = { connect: async request => {
        if (extra.throwConnect) throw new Error(key);
        connections.push(request); queueMicrotask(() => request.callbacks.onmessage({ setupComplete: {} }));
        return { sendRealtimeInput(value) { sends.push(value); }, close() { closes++; queueMicrotask(() => request.callbacks.onclose()); } };
      } };
    }
  }
  return { constructions, connections, sends, closes: () => closes,
    factory: createGeminiDeveloperClientFactory({ GoogleGenAI: FictionalGenAI, env: { NODE_ENV: 'test' } }) };
}
const callbacks = { onopen() {}, onmessage() {}, onerror() {}, onclose() {} };
test('factory is inert and only explicit approved inputs construct a pinned Developer API client', () => {
  const f = fixture(); assert.equal(f.constructions.length, 0);
  const client = f.factory({ apiKey: key, providerBinding: binding });
  assert.deepEqual(f.constructions, [{ apiKey: key, vertexai: false, enterprise: false, apiVersion: 'v1beta', httpOptions: { baseUrl: ENDPOINT } }]);
  assert.deepEqual(Object.keys(client), ['live']); assert.deepEqual(Object.keys(client.live), ['connect']); assert.equal(f.connections.length, 0);
});
test('production, missing constructor, wrong scope and extra key/endpoint options fail closed', () => {
  for (const env of [{}, { NODE_ENV: 'production' }, { NODE_ENV: 'preview' }, { NODE_ENV: 'development' }]) assert.throws(() => createGeminiDeveloperClientFactory({ GoogleGenAI: function () {}, env }));
  assert.throws(() => createGeminiDeveloperClientFactory({ env: { NODE_ENV: 'test' } }));
  const f = fixture();
  for (const input of [{}, { apiKey: '', providerBinding: binding }, { apiKey: 'auth_tokens/fictional', providerBinding: binding },
    { apiKey: key + '?redirect=other', providerBinding: binding }, { apiKey: key, providerBinding: { ...binding, provider: 'other' } },
    { apiKey: key, providerBinding: { ...binding, region: 'assumed-regional' } }, { apiKey: key, providerBinding: { ...binding, model: 'other' } },
    { apiKey: key, providerBinding: binding, httpOptions: { baseUrl: 'https://other.invalid' } }]) assert.throws(() => f.factory(input), { code: 'VOICE_DEVELOPER_SDK_REQUIRED' });
  assert.equal(f.constructions.length, 0);
});
test('only fixed nonclinical Hausa, Igbo and Yoruba configurations reach the injected constructor', async () => {
  const f = fixture(), client = f.factory({ apiKey: key, providerBinding: binding });
  for (const language of ['ha', 'ig', 'yo']) await client.live.connect({ ...configuration(language), callbacks });
  assert.equal(f.connections.length, 3);
  for (const change of [{ model: 'another' }, { config: { ...configuration('ha').config, tools: [{ googleSearch: {} }] } },
    { config: { ...configuration('ha').config, httpOptions: { baseUrl: 'https://other.invalid' } } },
    { config: { ...configuration('ha').config, systemInstruction: 'Use real patient details' } }, { apiKey: 'other' }, { callbacks: { onmessage: 'source text' } }]) {
    assert.throws(() => client.live.connect({ ...configuration('ha'), callbacks, ...change }), { code: 'VOICE_DEVELOPER_SDK_REQUIRED' });
  }
  assert.equal(f.connections.length, 3);
});
test('credential binding and real transport traverse the fixed factory with fictional SDK only', async () => {
  for (const language of ['ha', 'ig', 'yo']) {
    const f = fixture(), events = [];
    const credential = createGeminiCredentialBinding({ providerBinding: binding, credentialRef: 'fictional-reference',
      readCredentialSnapshot: async () => ({ ...binding, credentialRef: 'fictional-reference', status: 'verified', revision: 'r1', fingerprintSha256: createHash('sha256').update(key).digest('hex'), observedAt: Date.now(), validFrom: 0, expiresAt: Date.now() + 180000 }),
      readCredential: async () => key, createClient: f.factory });
    const transport = createGeminiLiveEvaluationTransport({ connectLive: credential.connectLive }), session = transport.open({ language, onEvent: event => events.push(event) });
    await session.ready; session.sendPcm(Buffer.alloc(3200).toString('base64')); session.sendGreeting();
    assert.equal(f.sends[0].audio.mimeType, 'audio/pcm;rate=16000'); assert.match(f.sends[1].text, /Fictional language demonstration only/);
    const closed = await session.stop(); assert.equal(closed.transportClosedConfirmed, true); assert.equal(closed.providerFinalUsageConfirmed, false); assert.equal(f.closes(), 1);
    assert.equal(JSON.stringify(events).includes(key), false);
  }
});
test('constructor errors are sanitized without exposing the fictional credential', () => {
  const f = fixture({ throwCreate: true }); assert.throws(() => f.factory({ apiKey: key, providerBinding: binding }), error => error.code === 'VOICE_DEVELOPER_SDK_REQUIRED' && !String(error).includes(key));
});
test('asynchronous connection errors are sanitized without exposing the fictional credential', async () => {
  const f = fixture({ throwConnect: true }), client = f.factory({ apiKey: key, providerBinding: binding });
  await assert.rejects(client.live.connect({ ...configuration('ha'), callbacks }), error => error.code === 'VOICE_DEVELOPER_SDK_REQUIRED' && !String(error).includes(key));
});
