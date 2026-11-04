'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createOpenAiLiveSideband } = require('../../services/voice/openAiLiveSideband');
function setup() {
  const socket = new EventEmitter(); socket.sent = []; socket.send = data => socket.sent.push(JSON.parse(data)); socket.close = () => { socket.closed = true; };
  const events = [];
  const attach = createOpenAiLiveSideband({ createSocket: () => socket });
  return { socket, events, attach: () => attach({ url: 'wss://api.openai.com/v1/live/sessions/live_test/attach', credentialProvider: async () => 'fake', onEvent: event => events.push(event) }) };
}
test('WebRTC sideband terminates through session.close and waits for session.closed once', async () => {
  const f = setup(); const connecting = f.attach(); await new Promise(resolve => setImmediate(resolve)); f.socket.emit('open'); const sideband = await connecting;
  const one = sideband.finish(); const two = sideband.finish(); assert.equal(f.socket.sent.length, 1); assert.equal(f.socket.sent[0].type, 'session.close');
  f.socket.emit('message', Buffer.from(JSON.stringify({ type: 'session.closed', usage: { seconds: 12 } })));
  assert.equal((await one).closed, true); assert.equal((await two).closed, true); sideband.close(); assert.equal(f.socket.closed, true);
});
test('sideband disconnect before final event never claims confirmed shutdown', async () => {
  const f = setup(); const connecting = f.attach(); await new Promise(resolve => setImmediate(resolve)); f.socket.emit('open'); const sideband = await connecting;
  const pending = sideband.finish(); f.socket.emit('error', new Error('offline'));
  await assert.rejects(pending); assert.equal(f.events.at(-1).type, 'error'); assert.equal(sideband.isClosed(), true);
});
test('untrusted sideband destinations rejected before requesting credentials', async () => {
  let reads = 0;
  const attach = createOpenAiLiveSideband({ createSocket: () => { throw new Error('must not connect'); } });
  await assert.rejects(attach({ url: 'wss://evil.example/attach', credentialProvider: async () => { reads++; return 'fake'; }, onEvent() {} }));
  assert.equal(reads, 0);
});
