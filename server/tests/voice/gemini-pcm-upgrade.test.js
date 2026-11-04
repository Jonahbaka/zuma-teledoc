'use strict';
// Real JWT verification, authenticate middleware, current-session policy,
// real loopback WebSocket upgrade/client wiring. Database/membership/provider I/O and the
// synthetic approval-source reader are doubles. The PostgreSQL session
// snapshot adapter itself is real; its query execution remains fictional.
// Install doubles BEFORE loading auth so no real DB module or dotenv is loaded.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const jwt = require('jsonwebtoken');
const signingKey = crypto.randomBytes(48).toString('hex');
let currentDb = null;
const overriddenModules = [];
function installDouble(relative, value) {
  const file = require.resolve(relative); const previous = require.cache[file];
  const replacement = new Module(file); replacement.filename = file; replacement.loaded = true; replacement.exports = value;
  require.cache[file] = replacement; overriddenModules.push({ file, previous });
}
installDouble('../../db', { query: (...args) => { if (!currentDb) throw new Error('No fictional database fixture is active.'); return currentDb.query(...args); } });
installDouble('../../services/consumerMembershipService', { readAuthority: async () => ({ accessLevel: 'read_only', financialAccessAvailable: false, paymentVerified: false }) });
installDouble('../../middleware/logger', { error() {}, warn() {}, info() {} });
// This ephemeral test key is never written, printed or sent to a provider.
const previousKey = process.env.JWT_ACCESS_SECRET;
process.env.JWT_ACCESS_SECRET = signingKey;
const { authenticate } = require('../../middleware/auth');
if (previousKey === undefined) delete process.env.JWT_ACCESS_SECRET; else process.env.JWT_ACCESS_SECRET = previousKey;
const http = require('node:http'), WebSocket = require('ws');
const { createGeminiPcmUpgrade, PATH } = require('../../services/voice/geminiPcmUpgrade');
const { createGeminiLiveEvaluationTransport, MODEL } = require('../../services/voice/geminiLiveEvaluationTransport');
const { createGeminiEvaluationPolicy } = require('../../services/voice/geminiEvaluationPolicy');
const { createVoiceSessionAuthority } = require('../../services/voice/voiceSessionAuthority');
const { createPostgresVoiceSessionReader, SNAPSHOT_SQL } = require('../../services/voice/postgresVoiceSessionReader');
const { createGeminiPcmSession } = require('../../../lib/voice/geminiPcmSession.cjs');
const { GEMINI_LIVE_LANGUAGE_CATALOG } = require('../../../shared/voiceLanguageCatalog.cjs');
const { browser } = require('./helpers/pcmBrowser.cjs');
const { publicVoiceSessionIdentity } = require('../../services/voice/voiceSessionBinding');
const origin = 'https://fictional.example', query = '?language=ig&consentVersion=voice-live-synthetic-v1';
const flush = () => new Promise(resolve => setImmediate(resolve));
async function eventually(condition) {
  const deadline = Date.now() + 3000;
  while (!condition() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(condition(), 'Expected asynchronous socket/provider outcome');
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
test.after(() => { for (const { file, previous } of overriddenModules) { if (previous) require.cache[file] = previous; else delete require.cache[file]; } });
async function fixture(t, extra = {}) {
  const user = { id: crypto.randomUUID(), email: 'fictional@example.invalid', role: 'provider', is_active: true, account_status: 'active', provider_status: 'approved', credential_version: 1, must_change_password: false };
  const readStarted = deferred(), disconnected = deferred(), providerStarted = deferred(); const familyId = crypto.randomUUID(); let familyActive = true, creates = 0, closes = 0, callbacks, reads = 0, keyReads = 0; const sdkInput = [], clients = [];
  currentDb = { async query(sql) {
    reads++; readStarted.resolve(); if (extra.dbWait) await extra.dbWait.promise;
    if (typeof sql === 'object' && sql.text === SNAPSHOT_SQL) return { rows: [{ ...user, family_id: familyActive ? familyId : null, family_user_id: familyActive ? user.id : null, family_expires_at_ms: familyActive ? String(Date.now() + 3600000) : null, observed_at_ms: String(Date.now()) }] };
    if (typeof sql === 'string' && sql.includes('FROM users WHERE id = $1')) return { rows: [{ ...user }] };
    if (typeof sql === 'string' && sql.includes('FROM refresh_tokens')) return { rows: familyActive ? [{ id: 'fictional-family-row' }] : [] };
    throw new Error('Unexpected fictional query');
  } };
  const assertSession = createVoiceSessionAuthority({ readSessionSnapshot: createPostgresVoiceSessionReader({ pool: currentDb }) });
  const binding = { provider: 'google', model: MODEL, accountRef: 'fictional-account', projectRef: 'fictional-project', region: extra.ownedSocket ? 'provider_global' : 'fictional-region', termsVersion: 'fictional-terms', retentionVersion: 'fictional-retention' };
  const billingState = { usageTier: 'free', billingEnabled: false, freeTierEligible: true, modelFreeTierAvailable: true, ...extra.billingState };
  const budgetState = extra.runtime ? { billingMode: 'free_tier_only', limitMinor: 0, ...extra.budgetState } : { limitMinor: 1 };
  const readApprovalSnapshot = async ({ language }) => {
    const record = { ...binding, evaluationId: 'fictional-eval', purpose: 'synthetic_voice_evaluation', dataClass: 'synthetic', status: 'approved', revision: 'r1', validFrom: 0, expiresAt: Date.now() + 180000 };
    return { observedAt: Date.now(), principal: { id: user.id, active: true, role: user.role }, evaluatorGrant: { ...record, actorId: user.id, languages: extra.approvedLanguages || ['ha', 'ig', 'yo'] },
      consent: { ...record, actorId: user.id, language, version: 'voice-live-synthetic-v1', audioScope: 'fictional_tester_audio' },
      processorApproval: { ...record, languages: extra.approvedLanguages || ['ha', 'ig', 'yo'] }, budgetApproval: { ...record, approvalId: 'fictional-budget', currency: 'USD', ...budgetState },
      providerBilling: { ...binding, status: 'verified', revision: 'billing-r1', evidenceRef: 'fictional-billing-evidence', evidenceSource: 'google_project_billing', observedAt: Date.now(), validFrom: 0, expiresAt: Date.now() + 180000, ...billingState } };
  };
  const authorize = createGeminiEvaluationPolicy({ evaluationId: 'fictional-eval', providerBinding: binding, readApprovalSnapshot });
  async function connectLive(config) { creates++; const ownedCallbacks = config.callbacks; callbacks = ownedCallbacks; queueMicrotask(() => ownedCallbacks.onmessage({ setupComplete: {} })); return {
    sendRealtimeInput: value => sdkInput.push(value), close() { closes++; queueMicrotask(() => ownedCallbacks.onclose()); } }; }
  const provider = createGeminiLiveEvaluationTransport({ connectLive });
  const app = require('express')(); app.use(require('cookie-parser')());
  const server = http.createServer(app);
  const socketIo = extra.socketIo ? new (require('socket.io').Server)(server, extra.socketIo) : null;
  if (extra.boundedRouting) require('../../services/boundedUpgradeRouting').installBoundedUpgradeCleanup(server);
  const other = new WebSocket.WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => { socket.once('end', disconnected.resolve); socket.once('close', disconnected.resolve); if (req.url === '/other') other.handleUpgrade(req, socket, head, peer => peer.send('other-ready')); });
  const fictionalCredential = 'noncredential-fictional-runtime-fixture'; let credentialRevision = 'r1';
  class FictionalOwnedSocket extends require('node:events').EventEmitter {
    constructor(url) {
      super(); assert.equal(url, require('../../services/voice/geminiOwnedWebSocketClient').ENDPOINT + '?key=' + fictionalCredential);
      this.readyState = 0; this.bufferedAmount = 0; creates++; callbacks = { onmessage: value => this.emit('message', JSON.stringify(value)) }; providerStarted.resolve();
      queueMicrotask(() => { if (this.readyState !== 0) return; this.readyState = 1; this.emit('open'); });
    }
    send(raw, callback) {
      const value = JSON.parse(raw);
      if (value.setup && extra.ownedSetup !== false) queueMicrotask(() => this.emit('message', '{"setupComplete":{}}'));
      if (value.realtimeInput) sdkInput.push(value.realtimeInput); callback?.();
    }
    close() { if (this.readyState === 3) return; this.readyState = 3; closes++; queueMicrotask(() => this.emit('close')); }
    terminate() { this.close(); }
  }
  const ownedFactory = extra.ownedSocket ? require('../../services/voice/geminiOwnedWebSocketClient').createGeminiOwnedWebSocketClientFactory({ WebSocket: FictionalOwnedSocket, env: { NODE_ENV: 'test' } }) : null;
  const runtimeComposition = { evaluationId: 'fictional-eval', providerBinding: binding, sessionPool: currentDb, readApprovalSnapshot,
    credential: { credentialRef: 'fictional-key-ref',
      readCredentialSnapshot: async () => ({ ...binding, credentialRef: 'fictional-key-ref', revision: credentialRevision, status: 'verified', fingerprintSha256: crypto.createHash('sha256').update(fictionalCredential).digest('hex'), observedAt: Date.now(), validFrom: 0, expiresAt: Date.now() + 180000 }),
      readCredential: async () => { keyReads++; return fictionalCredential; }, createClient: ownedFactory || (({ apiKey }) => { assert.equal(apiKey, fictionalCredential); return { live: { connect: connectLive } }; }) } };
  const runtimeFactory = require('../../services/voice/voicePcmRuntime').createVoicePcmRuntime;
  const installed = (extra.runtime ? runtimeFactory : createGeminiPcmUpgrade)({ httpServer: server, authenticate, expectedOrigin: origin, assertSession, authorize, provider,
    ...(extra.runtime && !extra.unconfigured ? { composition: runtimeComposition } : {}),
    env: { NODE_ENV: 'test', DOCTARX_VOICE_GEMINI_PCM_ENABLED: 'true' },
    // Explicit fixture transport double: plain loopback only, not forwarded headers.
    verifyTransport: req => req.socket.remoteAddress === '127.0.0.1', ...extra.options });
  if (extra.runtime) app.use('/api/voice-pcm-evaluation', installed.router);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `ws://127.0.0.1:${server.address().port}`;
  const expiry = Math.floor(Date.now() / 1000) + 180;
  const token = claims => jwt.sign({ userId: user.id, sessionId: familyId, sessionVersion: 1, exp: expiry, ...claims }, signingKey);
  const identity = publicVoiceSessionIdentity({ id: user.id, voiceAuth: { userId: user.id, familyId, credentialVersion: 1, expiresAt: expiry * 1000 } });
  function socket(path = PATH + query, headers = {}) {
    const protocol = Object.hasOwn(headers, 'Sec-WebSocket-Protocol') ? headers['Sec-WebSocket-Protocol'] : `doctarx-pcm-v1.${identity.sessionBinding}`;
    const ordinaryHeaders = { ...headers }; delete ordinaryHeaders['Sec-WebSocket-Protocol'];
    const ws = new WebSocket(base + path, protocol || [], { headers: { Origin: origin, Cookie: `accessToken=${token()}`, ...ordinaryHeaders }, handshakeTimeout: 3000 }); clients.push(ws); ws.on('error', () => {}); return ws;
  }
  async function connect(path, headers) { const ws = socket(path, headers); const first = await new Promise((resolve, reject) => { ws.once('message', value => resolve(value.toString())); ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`))); ws.once('error', reject); }); return { ws, first }; }
  async function denied(path, headers) { const ws = socket(path, headers); return new Promise(resolve => { ws.once('unexpected-response', (_req, res) => { res.resume(); resolve(res.statusCode); }); ws.once('error', () => resolve('socket-rejected')); }); }
  t.after(async () => { for (const ws of clients) ws.terminate(); await installed.close(); for (const ws of other.clients) ws.terminate(); await new Promise(resolve => other.close(resolve)); if (socketIo) await new Promise(resolve => socketIo.close(resolve)); server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve)); currentDb = null; });
  async function capabilities(headers = {}) { const response = await fetch(base.replace('ws:', 'http:') + '/api/voice-pcm-evaluation/capabilities', { headers: { Cookie: `accessToken=${token()}`, ...headers } }); return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() }; }
  return { user, token, identity, socket, connect, denied, capabilities, installed, sdkInput, base, socketIo, billingState, providerStarted: providerStarted.promise, readStarted: readStarted.promise, disconnected: disconnected.promise, event: value => callbacks.onmessage(value), creates: () => creates, closes: () => closes, reads: () => reads, keyReads: () => keyReads, revokeFamily: () => { familyActive = false; }, rotateCredential: () => { credentialRevision = 'r2'; } };
}
test('real loopback upgrade uses actual JWT cookie authentication and sends fictional PCM to injected SDK', async t => {
  const f = await fixture(t), { ws, first } = await f.connect(); const ready = JSON.parse(first);
  assert.equal(ready.type, 'session.ready'); assert.equal(ready.language, 'ig'); assert.equal(f.creates(), 1);
  ws.send(JSON.stringify({ type: 'audio.pcm', sequence: 1, data: Buffer.alloc(3200).toString('base64') }));
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(f.sdkInput[0].audio.mimeType, 'audio/pcm;rate=16000');
  ws.close(); await new Promise(resolve => ws.once('close', resolve)); await eventually(() => f.closes() === 1);
});
test('missing forged and expired JWTs never create providers', async t => {
  const f = await fixture(t);
  for (const value of ['', jwt.sign({ userId: f.user.id }, 'fictional-wrong-key'), f.token({ exp: Math.floor(Date.now() / 1000) - 1 })]) {
    await f.denied(undefined, { Cookie: value ? `accessToken=${value}` : '' }); assert.equal(f.creates(), 0);
  }
});
test('exact origin/path/query policy rejects ambiguous or credential-bearing upgrades', async t => {
  const f = await fixture(t);
  for (const path of [PATH + '/?language=ig&consentVersion=voice-live-synthetic-v1', PATH + query + '&token=forbidden', PATH + query + '&language=ha', PATH + '?language=zz&consentVersion=voice-live-synthetic-v1']) await f.denied(path);
  await f.denied(undefined, { Origin: 'https://evil.invalid' }); await f.denied(undefined, { Origin: '' }); assert.equal(f.creates(), 0); assert.equal(f.reads(), 0);
});
test('unrelated registered WebSocket upgrade handler continues working', async t => {
  const f = await fixture(t), result = await f.connect('/other'); assert.equal(result.first, 'other-ready'); assert.equal(f.creates(), 0);
});
test('plain transport cannot be promoted by forwarded headers', async t => {
  const f = await fixture(t, { options: { verifyTransport: req => req.socket.encrypted === true } });
  await f.denied(undefined, { 'X-Forwarded-Proto': 'https', Forwarded: 'proto=https' }); assert.equal(f.creates(), 0); assert.equal(f.reads(), 0);
});
test('auth timeout and late completion after client disconnect cannot create a provider', async t => {
  const wait = deferred(), f = await fixture(t, { dbWait: wait, options: { authTimeoutMs: 40 } });
  await f.denied(); wait.resolve(); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(f.creates(), 0);
});

test('production remains disabled even with configured provider, authentication and flag', async t => {
  const f = await fixture(t, { options: { env: { NODE_ENV: 'production', DOCTARX_VOICE_GEMINI_PCM_ENABLED: 'true' } } });
  await f.denied(); assert.equal(f.creates(), 0); assert.equal(f.reads(), 0);
});
test('late authentication after an observed disconnected half-open client cannot start a provider', { timeout: 2000 }, async t => {
  const wait = deferred(), f = await fixture(t, { dbWait: wait }); const ws = f.socket();
  await f.readStarted; ws.terminate(); await new Promise(resolve => ws.once('close', resolve)); await f.disconnected; wait.resolve();
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(f.creates(), 0);
});

test('timed-out noncancelable authentication retains bounded work slots until it settles', { timeout: 5000 }, async t => {
  const wait = deferred(), f = await fixture(t, { dbWait: wait, options: { authTimeoutMs: 20 } });
  for (let i = 0; i < 51; i++) await f.denied();
  assert.equal(f.reads(), 50); assert.equal(f.creates(), 0); wait.resolve(); await flush();
  await f.connect(); assert.equal(f.creates(), 1);
});

test('actual browser controller traverses authenticated loopback upgrade, policy, gateway and provider adapter for all languages', async t => {
  const languages = GEMINI_LIVE_LANGUAGE_CATALOG.map(item => item.code);
  const f = await fixture(t, { approvedLanguages: languages });
  for (const language of languages) {
    const media = browser(), transcripts = [], client = createGeminiPcmSession({ origin, ...media,
      createSocket(url, protocol) { const parsed = new URL(url); return f.socket(parsed.pathname + parsed.search, { 'Sec-WebSocket-Protocol': protocol }); }, onTranscript: value => transcripts.push(value) });
    await client.start({ language, consentAcknowledged: true, consentVersion: 'voice-live-synthetic-v1', expectedActorId: f.identity.actorId, expectedSessionBinding: f.identity.sessionBinding });
    media.frame(); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(f.sdkInput.at(-1).audio.mimeType, 'audio/pcm;rate=16000');
    f.event({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.alloc(480).toString('base64') } }] }, outputTranscription: { text: 'Fictional fixture' } } });
    await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(media.nodes.length, 1); assert.equal(transcripts[0].language, language); assert.equal(transcripts[0].clinicalReviewed, false);
    f.event({ serverContent: { interrupted: true } }); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(media.nodes[0].stops, 1);
    await client.stop(); await eventually(() => f.closes() === f.creates()); assert.equal(media.streams[0].track.readyState, 'ended');
  }
  assert.equal(f.creates(), languages.length); assert.equal(f.closes(), languages.length);
});

test('actual default Socket.IO rejects a slow competing upgrade before provider creation', { timeout: 4000 }, async t => {
  const wait = deferred(), f = await fixture(t, { dbWait: wait, socketIo: {} }); const result = f.denied();
  await f.readStarted; const timer = setTimeout(() => wait.resolve(), 1200); t.after(() => clearTimeout(timer));
  assert.equal(await result, 'socket-rejected'); await new Promise(resolve => setTimeout(resolve, 250)); assert.equal(f.creates(), 0);
});

test('bounded shared routing permits slow voice admission alongside actual Socket.IO and closes unknown paths', { timeout: 6000 }, async t => {
  const wait = deferred(), f = await fixture(t, { dbWait: wait, socketIo: { destroyUpgrade: false }, boundedRouting: true });
  f.socketIo.on('connection', socket => socket.emit('fixture:ready', true));
  const io = require('socket.io-client').io(f.base.replace('ws:', 'http:'), { transports: ['websocket'], reconnection: false, timeout: 2000 }); t.after(() => io.disconnect());
  assert.equal(await new Promise((resolve, reject) => { io.once('fixture:ready', resolve); io.once('connect_error', reject); }), true);
  const connecting = f.connect(); await f.readStarted; const timer = setTimeout(() => wait.resolve(), 1200); t.after(() => clearTimeout(timer));
  const { first } = await connecting; assert.equal(JSON.parse(first).type, 'session.ready'); assert.equal(f.creates(), 1);
  assert.equal(await f.denied('/unowned-upgrade'), 'socket-rejected');
});

test('active actual socket and browser capture close after family or credential revocation', async t => {
  for (const reason of ['family', 'credential']) {
    await t.test(reason, async t => {
      const f = await fixture(t, { options: { setTimer: (fn, ms) => setTimeout(fn, ms === 4000 ? 20 : ms) } }), media = browser();
      const client = createGeminiPcmSession({ origin, ...media, createSocket(url, protocol) { const parsed = new URL(url); return f.socket(parsed.pathname + parsed.search, { 'Sec-WebSocket-Protocol': protocol }); } });
      await client.start({ language: 'ha', consentAcknowledged: true, consentVersion: 'voice-live-synthetic-v1', expectedActorId: f.identity.actorId, expectedSessionBinding: f.identity.sessionBinding });
      if (reason === 'family') f.revokeFamily(); else f.user.credential_version++;
      await eventually(() => media.streams[0].track.readyState === 'ended' && f.closes() === 1); await client.stop();
    });
  }
});

test('pre-handshake data is rejected both in upgrade head and during delayed authentication', { timeout: 3000 }, async t => {
  for (const phase of ['head', 'authentication']) await t.test(phase, async t => {
    const wait = deferred(), f = await fixture(t, { dbWait: wait }), address = new URL(f.base);
    const socket = require('node:net').connect({ host: address.hostname, port: Number(address.port) }); t.after(() => socket.destroy());
    socket.on('error', () => {}); socket.on('data', () => {}); const closed = new Promise(resolve => socket.once('close', resolve));
    await new Promise(resolve => socket.once('connect', resolve));
    socket.write(`GET ${PATH + query} HTTP/1.1\r\nHost: ${address.host}\r\nOrigin: ${origin}\r\nCookie: accessToken=${f.token()}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: doctarx-pcm-v1.${f.identity.sessionBinding}\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\n\r\n${phase === 'head' ? 'unexpected' : ''}`);
    if (phase === 'authentication') { await f.readStarted; socket.write('unexpected'); }
    await closed; wait.resolve(); await flush(); assert.equal(f.creates(), 0); if (phase === 'head') assert.equal(f.reads(), 0);
  });
});

test('default application runtime remains disabled despite flags and returns authenticated identity without reading credentials', async t => {
  const f = await fixture(t, { runtime: true, unconfigured: true }), result = await f.capabilities();
  assert.equal(result.status, 200); assert.equal(result.cache, 'private, no-store'); assert.equal(result.body.capabilities.enabled, false);
  assert.deepEqual(result.body.identity, f.identity); await f.denied(); assert.equal(f.creates(), 0);
  assert.equal((await f.capabilities({ Cookie: '' })).status, 401);
});

test('configured runtime capability identity and approved credential compose actual JWT/socket/controller through all languages', async t => {
  const f = await fixture(t, { runtime: true, socketIo: { destroyUpgrade: false }, boundedRouting: true });
  const result = await f.capabilities(); assert.equal(result.status, 200); assert.equal(result.body.capabilities.enabled, true);
  for (const language of ['ha', 'ig', 'yo']) {
    const media = browser(), client = createGeminiPcmSession({ origin, ...media, createSocket(url, protocol) { const parsed = new URL(url); return f.socket(parsed.pathname + parsed.search, { 'Sec-WebSocket-Protocol': protocol }); } });
    await client.start({ language, consentAcknowledged: true, consentVersion: result.body.capabilities.consentVersion, expectedActorId: result.body.identity.actorId, expectedSessionBinding: result.body.identity.sessionBinding });
    assert.equal(media.streams[0].track.enabled, true); assert.equal((await client.stop()).tracksStopped, true); await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(f.creates(), 3); assert.equal(f.closes(), 3);
});

test('HTTP and cookie WebSocket identity mismatch is denied before microphone permission', async t => {
  const f = await fixture(t, { runtime: true }), media = browser(); const result = await f.capabilities({ Authorization: `Bearer ${f.token({ exp: Math.floor(Date.now() / 1000) + 60 })}` });
  assert.notEqual(result.body.identity.sessionBinding, f.identity.sessionBinding);
  const client = createGeminiPcmSession({ origin, ...media, createSocket(url, protocol) { const parsed = new URL(url); return f.socket(parsed.pathname + parsed.search, { 'Sec-WebSocket-Protocol': protocol }); } });
  await assert.rejects(client.start({ language: 'ha', consentAcknowledged: true, consentVersion: 'voice-live-synthetic-v1', expectedActorId: result.body.identity.actorId, expectedSessionBinding: result.body.identity.sessionBinding }));
  assert.equal(media.requests(), 0); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(f.creates(), 0); assert.equal(f.closes(), 0);
});

test('missing or forged session-correlation subprotocol cannot create a provider or replace authentication', async t => {
  const f = await fixture(t, { runtime: true });
  await f.denied(undefined, { 'Sec-WebSocket-Protocol': '' });
  await f.denied(undefined, { 'Sec-WebSocket-Protocol': `doctarx-pcm-v1.${'a'.repeat(64)}` });
  await f.denied(undefined, { Cookie: '' }); assert.equal(f.creates(), 0);
});

test('credential enrollment revision change terminates the active runtime session rather than silently accepting rotation', async t => {
  const f = await fixture(t, { runtime: true, options: { setTimer: (fn, ms) => setTimeout(fn, ms === 4000 ? 20 : ms) } }), media = browser();
  const client = createGeminiPcmSession({ origin, ...media, createSocket(url, protocol) { const parsed = new URL(url); return f.socket(parsed.pathname + parsed.search, { 'Sec-WebSocket-Protocol': protocol }); } });
  await client.start({ language: 'ha', consentAcknowledged: true, consentVersion: 'voice-live-synthetic-v1', expectedActorId: f.identity.actorId, expectedSessionBinding: f.identity.sessionBinding });
  f.rotateCredential(); await new Promise(resolve => setTimeout(resolve, 80)); assert.equal(media.streams[0].track.readyState, 'ended'); assert.equal(f.closes(), 1); await client.stop();
});

test('production runtime never composes supplied credential or SDK dependencies', async t => {
  const f = await fixture(t, { runtime: true, options: { env: { NODE_ENV: 'production', DOCTARX_VOICE_GEMINI_PCM_ENABLED: 'true' } } });
  assert.equal((await f.capabilities()).body.capabilities.enabled, false); await f.denied(); assert.equal(f.creates(), 0);
});

test('application rejects paid or ineligible billing before reading a key or creating provider', async t => {
  for (const extra of [{ billingState: { billingEnabled: true } }, { billingState: { freeTierEligible: false } },
    { billingState: { projectRef: 'other-project' } }, { billingState: { evidenceSource: 'studio_browser' } },
    { budgetState: { billingMode: undefined, limitMinor: 1 } }, { budgetState: { limitMinor: 1 } }]) {
    await t.test(JSON.stringify(extra), async t => {
      const f = await fixture(t, { runtime: true, ...extra });
      assert.equal((await f.capabilities()).body.capabilities.billingMode, 'free_tier_only');
      // Admission may upgrade before the policy denies; client failure remains
      // authoritative and the server must not read even the fictional key.
      const media = browser(), client = createGeminiPcmSession({ origin, ...media, createSocket(url, protocol) { const parsed = new URL(url); return f.socket(parsed.pathname + parsed.search, { 'Sec-WebSocket-Protocol': protocol }); } });
      await assert.rejects(client.start({ language: 'ha', consentAcknowledged: true, consentVersion: 'voice-live-synthetic-v1', expectedActorId: f.identity.actorId, expectedSessionBinding: f.identity.sessionBinding }));
      assert.equal(media.requests(), 0); assert.equal(f.keyReads(), 0); assert.equal(f.creates(), 0); await client.stop();
    });
  }
});

test('billing eligibility loss closes active fictional PCM and provider on lease revalidation', async t => {
  const f = await fixture(t, { runtime: true, options: { setTimer: (fn, ms) => setTimeout(fn, ms === 4000 ? 20 : ms) } }), media = browser();
  const client = createGeminiPcmSession({ origin, ...media, createSocket(url, protocol) { const parsed = new URL(url); return f.socket(parsed.pathname + parsed.search, { 'Sec-WebSocket-Protocol': protocol }); } });
  await client.start({ language: 'ha', consentAcknowledged: true, consentVersion: 'voice-live-synthetic-v1', expectedActorId: f.identity.actorId, expectedSessionBinding: f.identity.sessionBinding });
  f.billingState.billingEnabled = true; await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(media.streams[0].track.readyState, 'ended'); assert.equal(f.closes(), 1); await client.stop();
});

test('actual application composes free-tier policy, credential binding and owned connector through all languages', async t => {
  const f = await fixture(t, { runtime: true, ownedSocket: true });
  for (const language of ['ha', 'ig', 'yo']) {
    const media = browser(), transcripts = [], client = createGeminiPcmSession({ origin, ...media, onTranscript: value => transcripts.push(value),
      createSocket(url, protocol) { const parsed = new URL(url); return f.socket(parsed.pathname + parsed.search, { 'Sec-WebSocket-Protocol': protocol }); } });
    await client.start({ language, consentAcknowledged: true, consentVersion: 'voice-live-synthetic-v1', expectedActorId: f.identity.actorId, expectedSessionBinding: f.identity.sessionBinding });
    media.frame(); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(f.sdkInput.at(-1).audio.mimeType, 'audio/pcm;rate=16000');
    f.event({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.alloc(480).toString('base64') } }] }, outputTranscription: { text: 'Fictional fixture' } } });
    await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(transcripts[0].language, language); assert.equal(media.nodes.length, 1);
    assert.equal((await client.stop()).tracksStopped, true); await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(f.creates(), 3); assert.equal(f.closes(), 3); assert.equal(f.keyReads(), 3);
});

test('application Stop before owned-provider setup closes the pending provider without microphone access', async t => {
  const f = await fixture(t, { runtime: true, ownedSocket: true, ownedSetup: false }), media = browser();
  const client = createGeminiPcmSession({ origin, ...media, createSocket(url, protocol) { const parsed = new URL(url); return f.socket(parsed.pathname + parsed.search, { 'Sec-WebSocket-Protocol': protocol }); } });
  const starting = client.start({ language: 'ha', consentAcknowledged: true, consentVersion: 'voice-live-synthetic-v1', expectedActorId: f.identity.actorId, expectedSessionBinding: f.identity.sessionBinding });
  const rejected = assert.rejects(starting); await f.providerStarted; await client.stop(); await rejected;
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(media.requests(), 0); assert.equal(f.creates(), 1); assert.equal(f.closes(), 1);
});
