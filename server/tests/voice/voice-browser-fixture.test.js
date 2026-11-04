'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFixtureApp } = require('../../../tests/voice-browser/server.cjs');
const env = { NODE_ENV: 'test', DOCTARX_VOICE_BROWSER_FIXTURE: 'true' };
async function fixture(t) {
  const value = createFixtureApp({ env });
  const server = await new Promise(resolve => { const active = value.app.listen(0, '127.0.0.1', () => resolve(active)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await value.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { origin, async request(route, body, extraHeaders = {}) {
    return fetch(origin + route, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, Authorization: 'Bearer fictional-browser-fixture', 'Content-Type': 'application/json', ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } };
}
test('browser harness cannot start without test-only opt-in and never mounts in the application', () => {
  for (const value of [{}, { NODE_ENV: 'test' }, { NODE_ENV: 'production', DOCTARX_VOICE_BROWSER_FIXTURE: 'true' }, { NODE_ENV: 'development', DOCTARX_VOICE_BROWSER_FIXTURE: 'true' }]) assert.throws(() => createFixtureApp({ env: value }), /test-only/);
  const root = path.resolve(__dirname, '../../..');
  for (const file of ['server/index.js', 'server/routes/voiceLive.js', 'app/voice-lab/page.js']) assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /voice-browser|VOICE_BROWSER_FIXTURE/);
});
test('standalone harness restricts origins, native capture, credentials and free text', async t => {
  const f = await fixture(t), page = await f.request('/'); assert.equal(page.status, 200);
  assert.match(page.headers.get('permissions-policy'), /microphone=\(\)/); assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.equal((await f.request('/__voice_fixture/state', undefined, { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await f.request('/__voice_fixture/reset', {}, { Origin: 'https://untrusted.invalid' })).status, 403);
  assert.equal((await f.request('/__voice_fixture/reset', {}, { Origin: '' })).status, 403);
  assert.equal((await f.request('/__voice_fixture/caption', { speaker: 'patient', language: 'ha', text: 'arbitrary' })).status, 400);
  assert.equal((await f.request('/__voice_fixture/revoke', { kind: 'other' })).status, 400);
});
test('real HTTP broker and trusted policy run against fake provider, then revocation ends authorization', async t => {
  const f = await fixture(t);
  const permit = await (await f.request('/api/voice-live/permits', { language: 'ig', consentVersion: 'voice-live-synthetic-v1' })).json();
  assert.equal(permit.success, true);
  const connection = await (await f.request(`/api/voice-live/permits/${permit.permitId}/connect`, { sdp: 'v=0\r\nfictional-offer' })).json();
  assert.equal(connection.transport.sdp, 'v=0\r\nfictional-browser-answer');
  const caption = await (await f.request('/__voice_fixture/caption', { speaker: 'patient', language: 'ig' })).json();
  assert.match(caption.event.delta, /Ndewo/);
  await f.request('/__voice_fixture/revoke', { kind: 'consent' });
  assert.equal((await f.request(`/api/voice-live/permits/${permit.permitId}/lease`, {})).status, 403);
  const state = await (await f.request('/__voice_fixture/state')).json();
  assert.deepEqual(state, { creates: 1, closes: 1, evidenceCount: 1, fakeOnly: true });
  assert.equal((await f.request('/api/voice-live/permits', { language: 'yo', consentVersion: 'voice-live-synthetic-v1' })).status, 403);
});
