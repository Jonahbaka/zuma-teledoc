'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMediaSessionController, connectionQuality } = require('../../lib/ng/livekitMediaLifecycle.cjs');
const { createLocalMediaPreview } = require('../../lib/ng/localMediaPreview.cjs');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fakeRoom(connect = async () => {}) {
  return {
    state: 'connected', disconnects: 0, listenersRemoved: 0, captureRequests: 0,
    localParticipant: { trackPublications: new Map() },
    connect,
    removeAllListeners() { this.listenersRemoved++; },
    async disconnect(stopTracks) { assert.equal(stopTracks, true); this.disconnects++; },
  };
}
const token = { livekitUrl: 'wss://fictional.invalid', token: 'fictional-test-token' };
const join = (controller, room, overrides = {}) => controller.connect({
  getToken: async () => token, createRoom: () => room, onRoom() {}, ...overrides,
});

test('join subscribes without starting microphone or camera capture', async () => {
  const controller = createMediaSessionController();
  const room = fakeRoom(async (url, receivedToken, options) => {
    assert.equal(url, token.livekitUrl); assert.equal(receivedToken, token.token);
    assert.deepEqual(options, { autoSubscribe: true });
  });
  room.localParticipant.setMicrophoneEnabled = () => assert.fail('unexpected capture');
  room.localParticipant.setCameraEnabled = () => assert.fail('unexpected capture');
  assert.equal(await join(controller, room), room);
});

test('leaving while token authorization is pending never creates a media room', async () => {
  const controller = createMediaSessionController(), authorization = deferred();
  const pending = join(controller, null, { getToken: () => authorization.promise, createRoom: () => assert.fail('stale room') });
  await Promise.resolve();
  await controller.close(); authorization.resolve(token);
  assert.equal(await pending, null);
  assert.equal(controller.room, null);
});

test('stale connect completion is disconnected without replacing the new room', async () => {
  const controller = createMediaSessionController(), connecting = deferred(), owned = deferred();
  const oldRoom = fakeRoom(() => connecting.promise), newRoom = fakeRoom();
  const pending = join(controller, oldRoom, { onRoom: () => owned.resolve() });
  await owned.promise;
  await join(controller, newRoom);
  connecting.resolve();
  assert.equal(await pending, null);
  assert.equal(controller.room, newRoom);
  assert.ok(oldRoom.disconnects >= 2);
  assert.equal(newRoom.disconnects, 0);
});

test('failed connection releases owned transport and propagates current error', async () => {
  const controller = createMediaSessionController();
  const room = fakeRoom(async () => { throw new Error('fictional connection failure'); });
  await assert.rejects(join(controller, room), /fictional connection failure/);
  assert.equal(controller.room, null); assert.equal(room.disconnects, 1);
  assert.equal(room.listenersRemoved, 1);
});

test('stale connection failure cannot clear or report an error for the replacement', async () => {
  const controller = createMediaSessionController(), connecting = deferred(), owned = deferred();
  const oldRoom = fakeRoom(() => connecting.promise), newRoom = fakeRoom();
  const pending = join(controller, oldRoom, { onRoom: () => owned.resolve() });
  await owned.promise; await join(controller, newRoom);
  connecting.reject(new Error('obsolete failure'));
  assert.equal(await pending, null); assert.equal(controller.room, newRoom);
});

test('late microphone, camera and screen capture after leave are stopped', async () => {
  for (const kind of ['microphone', 'camera', 'screen']) {
    const controller = createMediaSessionController(), permission = deferred();
    const room = fakeRoom(); let stopped = 0;
    await join(controller, room);
    const pending = controller.act(async () => {
      await permission.promise;
      room.localParticipant.trackPublications.set(kind, { track: { stop() { stopped++; } } });
    }, () => assert.fail('stale UI update'));
    await controller.close(); permission.resolve();
    assert.equal(await pending, false); assert.equal(stopped, 1);
    assert.equal(controller.room, null);
  }
});

test('repeated control clicks start only one capture and the lock clears on failure', async () => {
  const controller = createMediaSessionController(), permission = deferred();
  await join(controller, fakeRoom()); let calls = 0, errors = 0;
  const action = () => { calls++; return permission.promise; };
  const pending = controller.act(action, null, () => errors++);
  assert.equal(await controller.act(action), false); assert.equal(calls, 1);
  permission.reject(new Error('denied')); assert.equal(await pending, false);
  assert.equal(errors, 1);
  assert.equal(await controller.act(async () => { calls++; }), true);
  assert.equal(calls, 2);
});

test('a late old capture does not unlock a pending device action in a new room', async () => {
  const controller = createMediaSessionController(), oldCapture = deferred(), newCapture = deferred();
  await join(controller, fakeRoom());
  const oldAction = controller.act(() => oldCapture.promise);
  await join(controller, fakeRoom());
  const newAction = controller.act(() => newCapture.promise);
  oldCapture.resolve(); await oldAction;
  assert.equal(await controller.act(() => assert.fail('new lock lost')), false);
  newCapture.resolve(); assert.equal(await newAction, true);
});

test('reconnecting room rejects new capture requests until connected', async () => {
  const controller = createMediaSessionController(), room = fakeRoom();
  await join(controller, room); room.state = 'reconnecting';
  assert.equal(await controller.act(() => assert.fail('capture while reconnecting')), false);
  room.state = 'connected'; assert.equal(await controller.act(async () => {}), true);
});

test('SDK string connection quality is preserved; unknown values do not become good', () => {
  for (const value of ['excellent', 'good', 'poor', 'lost', 'unknown']) assert.equal(connectionQuality(value), value);
  for (const value of [undefined, null, 5, '5', '']) assert.equal(connectionQuality(value), 'unknown');
});

test('preflight captures only the explicitly selected device and closes both previews', async () => {
  const preview = createLocalMediaPreview(); let stops = 0;
  const constraints = [];
  const capture = async (options) => { constraints.push(options); return { getTracks: () => [{ stop() { stops++; } }] }; };
  await preview.start('camera', capture); await preview.start('microphone', capture);
  assert.deepEqual(constraints, [{ video: true, audio: false }, { video: false, audio: true }]);
  preview.close(); assert.equal(stops, 2);
});

test('preflight double click opens one permission request; cancellation stops late capture', async () => {
  const preview = createLocalMediaPreview(), permission = deferred(); let requests = 0, stops = 0;
  const capture = () => { requests++; return permission.promise; };
  const pending = preview.start('camera', capture);
  assert.equal(await preview.start('camera', capture), null); assert.equal(requests, 1);
  preview.stop('camera'); permission.resolve({ getTracks: () => [{ stop() { stops++; } }] });
  assert.equal(await pending, null); assert.equal(stops, 1);
});

test('preflight joining or unmount cancels a pending microphone permission prompt', async () => {
  const preview = createLocalMediaPreview(), permission = deferred(); let stops = 0;
  const pending = preview.start('microphone', () => permission.promise);
  preview.close(); permission.resolve({ getTracks: () => [{ stop() { stops++; } }] });
  assert.equal(await pending, null); assert.equal(stops, 1);
});

test('preflight stale denial is silent and cannot unlock a newer request', async () => {
  const preview = createLocalMediaPreview(), oldPermission = deferred(), newPermission = deferred();
  const old = preview.start('camera', () => oldPermission.promise);
  preview.stop('camera');
  const current = preview.start('camera', () => newPermission.promise);
  oldPermission.reject(new Error('old denial')); assert.equal(await old, null);
  assert.equal(await preview.start('camera', () => assert.fail('new request lost its lock')), null);
  newPermission.resolve({ getTracks: () => [] }); assert.ok(await current);
});

test('preflight permission failure can be retried without enabling the other device', async () => {
  const preview = createLocalMediaPreview();
  await assert.rejects(preview.start('camera', async () => { throw new Error('camera denied'); }), /camera denied/);
  assert.ok(await preview.start('camera', async (options) => {
    assert.deepEqual(options, { video: true, audio: false }); return { getTracks: () => [] };
  }));
});
