'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createVoiceLabRouter } = require('../../routes/voiceLab');
const { createSyntheticVoiceSessionService, NOTICE_VERSION } = require('../../services/voice/syntheticVoiceSessionService');

test('HTTP boundary enforces authenticated role, owner, strict inputs, concurrency and no-store', async t => {
  const service = createSyntheticVoiceSessionService({ env: { NODE_ENV: 'test', DOCTARX_VOICE_SYNTHETIC_ENABLED: 'true' } });
  const app = express(); app.use(express.json({ limit: '8kb' }));
  // Only this test injects an identity. The actual server mount always uses
  // the application middleware and checks current persisted auth sessions.
  const actors = { provider: { id: 'owner', role: 'provider' }, other: { id: 'other', role: 'provider' }, patient: { id: 'patient', role: 'patient' } };
  app.use('/api/voice-lab', createVoiceLabRouter({ service, authenticate(req, res, next) {
    req.user = actors[req.headers.authorization];
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED' });
    next();
  } }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => { service.close(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}/api/voice-lab`;
  async function call(path, body, who = 'provider') {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Authorization: who, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json(); return { response, data };
  }
  assert.equal((await call('/capabilities', null, 'none')).response.status, 401);
  assert.equal((await call('/capabilities', null, 'patient')).response.status, 403);
  const created = await call('/sessions', { language: 'yo', consent: { noticeVersion: NOTICE_VERSION, processing: true, syntheticOnly: true } });
  assert.equal(created.response.status, 200);
  assert.equal(created.response.headers.get('cache-control'), 'private, no-store');
  const session = created.data.session;
  assert.equal(session.ownerId, undefined);
  assert.equal((await call(`/sessions/${session.id}`, null, 'other')).response.status, 404);
  const command = { action: 'fixture', fixtureId: 'complaint', expectedRevision: session.revision, epoch: session.epoch };
  const results = await Promise.all([call(`/sessions/${session.id}/commands`, command), call(`/sessions/${session.id}/commands`, command)]);
  assert.deepEqual(results.map(result => result.response.status).sort(), [200, 409]);
  const fresh = (await call(`/sessions/${session.id}`)).data.session;
  assert.equal(fresh.turns.filter(turn => turn.speaker === 'patient').length, 1);
  const arbitrary = await call(`/sessions/${session.id}/commands`, { ...command, expectedRevision: fresh.revision, epoch: fresh.epoch, text: 'Do not persist this' });
  assert.equal(arbitrary.response.status, 400);
  assert.equal(JSON.stringify(arbitrary.data).includes('Do not persist this'), false);
  const ended = await call(`/sessions/${session.id}/commands`, { action: 'end', expectedRevision: session.revision, epoch: session.epoch });
  assert.equal(ended.response.status, 200);
  assert.equal((await call(`/sessions/${session.id}`)).response.status, 404);
});

test('live HTTP mount remains unavailable and cleanup-only route permits a demoted owner', async t => {
  const { createVoiceLiveRouter } = require('../../routes/voiceLive');
  const calls = [];
  const app = express(); app.use(express.json());
  const auth = (req, _res, next) => { req.user = { id: 'owner', role: req.headers['x-test-role'] || 'provider' }; next(); };
  app.use('/default', createVoiceLiveRouter({ authenticate: auth }));
  app.use('/cleanup', createVoiceLiveRouter({ authenticate: auth, broker: {
    async stop(actor, permitId) { calls.push({ actor, permitId }); return { stopped: true, providerCleanupConfirmed: true }; },
    async reserve() { throw new Error('Must not reserve as a patient'); },
  } }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const capabilities = await (await fetch(`${base}/default/capabilities`)).json();
  assert.equal(capabilities.capabilities.enabled, false);
  const reserve = await fetch(`${base}/default/permits`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'ha', consentVersion: 'voice-live-synthetic-v1' }) });
  assert.equal(reserve.status, 503);
  const stop = await fetch(`${base}/cleanup/permits/owned/stop`, { method: 'POST', headers: { 'x-test-role': 'patient', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(stop.status, 200); assert.equal(calls.length, 1); assert.equal(calls[0].actor.role, 'patient');
  const denied = await fetch(`${base}/cleanup/permits`, { method: 'POST', headers: { 'x-test-role': 'patient', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(denied.status, 403);
});
