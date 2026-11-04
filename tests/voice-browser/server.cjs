'use strict';
const express = require('express');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { createVoiceLiveRouter } = require('../../server/routes/voiceLive');
const { createLiveVoiceBroker } = require('../../server/services/voice/liveVoiceBroker');
const { createSyntheticEvaluationPolicy } = require('../../server/services/voice/syntheticEvaluationPolicy');
const { createOpenAiLiveAdapter } = require('../../server/services/voice/openAiLiveAdapter');
const { createOpenAiLiveSideband } = require('../../server/services/voice/openAiLiveSideband');
const { LANGUAGES } = require('../../shared/voice/liveProtocol.cjs');
const { buildFixture } = require('./build.cjs');
const TOKEN = 'Bearer fictional-browser-fixture';
const HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic voice browser QA</title><style>body{background:#0f172a;color:#f8fafc;font:16px system-ui;margin:0}main{max-width:900px;padding:24px;margin:auto}section{border:1px solid #64748b;border-radius:12px;padding:16px;margin:16px 0}button,select{font:inherit;min-height:44px;padding:8px;margin:6px;background:#e2e8f0;color:#0f172a;border:1px solid #94a3b8;border-radius:6px}button:disabled{opacity:.5}label{display:block;margin:8px 0}input{margin:8px}audio{display:none}p{overflow-wrap:anywhere}h1{font-size:26px}h2{font-size:20px}</style></head><body><div id="root"></div><script src="/fixture.js" defer></script></body></html>';
function createFixtureApp({ env = process.env } = {}) {
  if (env.NODE_ENV !== 'test' || env.DOCTARX_VOICE_BROWSER_FIXTURE !== 'true') throw new Error('Standalone synthetic browser fixture requires explicit test-only configuration.');
  const app = express(), sessions = new Map();
  const state = { role: 'provider', consent: true, processor: true, creates: 0, closes: 0, evidenceCount: 0 };
  const actorId = 'fictional-browser-evaluator';
  const providerBinding = { provider: 'openai', accountRef: 'fictional-account', projectRef: 'fictional-project', model: 'gpt-live-1', region: 'fictional-region', termsVersion: 'fictional-terms', retentionVersion: 'fictional-retention' };
  const authorize = createSyntheticEvaluationPolicy({ evaluationId: 'fictional-browser-evaluation', providerBinding,
    async readApprovalSnapshot({ actorId: requestedActor, evaluationId, language }) {
      if (requestedActor !== actorId) return null;
      const at = Date.now(), record = { status: 'approved', revision: 'r1', revokedAt: null, validFrom: at - 1, expiresAt: at + 180000,
        evaluationId, purpose: 'synthetic_voice_evaluation', dataClass: 'synthetic', ...providerBinding };
      return { observedAt: at, principal: { id: actorId, active: true, role: state.role },
        evaluatorGrant: { ...record, actorId, languages: Object.keys(LANGUAGES) },
        consent: { ...record, actorId, language, version: 'voice-live-synthetic-v1', audioScope: 'fictional_tester_audio', status: state.consent ? 'approved' : 'revoked' },
        processorApproval: { ...record, languages: Object.keys(LANGUAGES), status: state.processor ? 'approved' : 'revoked' },
        budgetApproval: { ...record, approvalId: 'fictional-budget', currency: 'USD', limitMinor: 100 },
      };
    } });
  const attachSideband = createOpenAiLiveSideband({ createSocket(url, options) {
    if (options.headers.Authorization !== 'Bearer fictional-provider-credential') throw new Error('Unexpected synthetic credential.');
    const id = url.match(/^wss:\/\/api\.openai\.com\/v1\/live\/sessions\/([A-Za-z0-9_-]+)\/attach$/)?.[1], session = sessions.get(id);
    if (!session) throw new Error('Unknown fake session.');
    const socket = new EventEmitter(); session.socket = socket;
    socket.close = () => { if (socket.closed) return; socket.closed = true; socket.emit('close'); };
    socket.send = text => {
      if (JSON.parse(text).type !== 'session.close') throw new Error('Unexpected fake provider command.');
      if (!session.closed) { state.closes++; session.closed = true; }
      queueMicrotask(() => socket.emit('message', Buffer.from(JSON.stringify({ type: 'session.closed' }))));
    };
    queueMicrotask(() => socket.emit('open')); return socket;
  } });
  const provider = createOpenAiLiveAdapter({ credentialProvider: async () => 'fictional-provider-credential', attachSideband,
    async fetchImpl(url, options) {
      // This is the entire provider transport: it NEVER calls global fetch.
      if (url !== 'https://api.openai.com/v1/live/sessions' || options.method !== 'POST') throw new Error('Unexpected fake provider request.');
      const body = JSON.parse(options.body);
      if (body.session.model !== 'gpt-live-1' || body.session.store !== false) throw new Error('Unexpected fake provider configuration.');
      const language = Object.keys(LANGUAGES).find(key => body.session.instructions.includes(`Speak naturally in ${LANGUAGES[key]}.`));
      if (!language) throw new Error('Unknown fake language.');
      const id = `live_fixture_${randomUUID()}`; state.creates++; sessions.set(id, { language, closed: false });
      return { ok: true, json: async () => ({ session: { id }, transport: { type: 'webrtc', sdp: 'v=0\r\nfictional-browser-answer' } }) };
    } });
  const broker = createLiveVoiceBroker({ env: { NODE_ENV: 'test', DOCTARX_VOICE_LIVE_PROTOTYPE_ENABLED: 'true' }, assertSession: async () => {}, authorize, provider, onEvidence: () => { state.evidenceCount++; } });
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'private, no-store', 'Permissions-Policy': 'microphone=(), camera=(), geolocation=()',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; media-src 'none'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" });
    const host = req.get('host') || '';
    if (!/^127\.0\.0\.1:\d+$/.test(host) || req.get('origin') && req.get('origin') !== `http://${host}` || req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ code: 'FIXTURE_ORIGIN_DENIED' });
    if (req.method !== 'GET' && req.get('origin') !== `http://${host}`) return res.status(403).json({ code: 'FIXTURE_ORIGIN_REQUIRED' });
    next();
  });
  app.use(express.json({ limit: '70kb' }));
  const authenticate = (req, res, next) => { if (req.get('authorization') !== TOKEN) return res.status(401).json({ code: 'FIXTURE_AUTH_REQUIRED' }); req.user = { id: actorId, role: state.role }; next(); };
  app.get('/__voice_fixture/health', (_req, res) => res.json({ fixture: 'voice-browser-synthetic-v1', realProvider: false, realMicrophone: false }));
  app.get('/', (_req, res) => res.type('html').send(HTML));
  app.get('/fixture.js', (_req, res) => res.sendFile(path.resolve(__dirname, '../../artifacts/voice-browser/bundle/fixture.js')));
  app.use('/api/voice-live', createVoiceLiveRouter({ authenticate, broker }));
  app.use('/__voice_fixture', authenticate);
  app.get('/__voice_fixture/state', (_req, res) => res.json({ creates: state.creates, closes: state.closes, evidenceCount: state.evidenceCount, fakeOnly: true }));
  app.post('/__voice_fixture/reset', async (req, res) => {
    if (!req.body || Object.keys(req.body).length) return res.status(400).json({ code: 'FIXTURE_INPUT_INVALID' });
    await broker.close(); sessions.clear(); Object.assign(state, { role: 'provider', consent: true, processor: true, creates: 0, closes: 0, evidenceCount: 0 }); res.json({ reset: true });
  });
  app.post('/__voice_fixture/revoke', (req, res) => {
    if (!req.body || Object.keys(req.body).some(key => key !== 'kind') || !['consent', 'processor', 'role'].includes(req.body.kind)) return res.status(400).json({ code: 'FIXTURE_INPUT_INVALID' });
    if (req.body.kind === 'role') state.role = 'patient'; else state[req.body.kind] = false;
    res.json({ revoked: true });
  });
  app.post('/__voice_fixture/caption', (req, res) => {
    if (!req.body || Object.keys(req.body).some(key => !['speaker', 'language'].includes(key)) || !['patient', 'assistant'].includes(req.body.speaker) || !Object.hasOwn(LANGUAGES, req.body.language)) return res.status(400).json({ code: 'FIXTURE_INPUT_INVALID' });
    const session = [...sessions.values()].find(item => !item.closed && item.language === req.body.language && item.socket);
    if (!session) return res.status(409).json({ code: 'FIXTURE_SESSION_REQUIRED' });
    const greeting = { ha: 'Sannu', ig: 'Ndewo', yo: 'Ẹ káàbọ̀' }[req.body.language];
    const event = { type: req.body.speaker === 'patient' ? 'session.input_transcript.delta' : 'session.output_transcript.delta',
      delta: `${greeting}: fictional ${req.body.speaker} fragment`, start_ms: 0, end_ms: 100 };
    session.socket.emit('message', Buffer.from(JSON.stringify(event))); res.json({ event });
  });
  return { app, close: () => broker.close() };
}
async function main() {
  const fixture = createFixtureApp(); await buildFixture();
  const port = Number(process.env.VOICE_BROWSER_PORT || 3219);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid fixture port.');
  const server = fixture.app.listen(port, '127.0.0.1', () => console.log(`Synthetic browser fixture listening at http://127.0.0.1:${port}`));
  const stop = async () => { clearTimeout(expiry); await fixture.close(); server.closeAllConnections(); server.close(); };
  const expiry = setTimeout(stop, 15 * 60 * 1000); expiry.unref();
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { createFixtureApp };
