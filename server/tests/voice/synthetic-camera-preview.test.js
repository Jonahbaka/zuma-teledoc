'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFictionalCamera, createSyntheticCameraPreview, SCENES, MAX_SESSION_MS } = require('../../../lib/voice/syntheticCameraPreview.cjs');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
function setup(extra = {}) {
  const camera = extra.camera || createFictionalCamera(), states = [], timers = [];
  let now = 1000;
  const client = createSyntheticCameraPreview({ camera, userId: 'fictional-evaluator', role: 'provider', language: 'ha',
    now: () => now, setTimer: callback => { timers.push(callback); return timers.length; }, clearTimer() {}, onChange: value => states.push(value), ...extra });
  return { client, camera, states, timers, advance: ms => { now += ms; } };
}
async function start(value) { value.client.setConsent(true); const pending = value.client.start(); value.camera.answerPermission(true); assert.equal(await pending, true); }
function controllableCamera() {
  const requests = []; const resources = [];
  return { kind: 'fictional-camera', requests, resources,
    open() { const item = deferred(); requests.push(item); return item.promise; },
    resource() { let frame = SCENES[0].id; let ended = () => {}; const value = { kind: 'fictional-camera-resource', closed: false,
      currentFrame: () => frame, nextFrame: () => { frame = SCENES[1].id; return frame; }, selectFrame: async () => frame,
      onEnded: callback => { ended = callback; return () => {}; }, close: () => { value.closed = true; }, lateEnd: () => ended() }; resources.push(value); return value; },
  };
}

test('no permission request occurs before separate local consent; native adapters rejected', async () => {
  const camera = controllableCamera(), { client } = setup({ camera });
  assert.equal(await client.start(), false); assert.equal(camera.requests.length, 0);
  assert.throws(() => setup({ camera: { kind: 'native-camera' } }), /fictional camera/);
  client.dispose();
});
for (const language of ['ha', 'ig', 'yo']) test(`${language}: explicit simulated permission, bounded frame selection and local removal`, async () => {
  const value = setup({ language }); value.client.setConsent(true); const pending = value.client.start();
  assert.equal(value.client.getSnapshot().status, 'requesting_permission'); assert.equal(value.camera.activeCount(), 0);
  value.camera.answerPermission(true); assert.equal(await pending, true);
  assert.equal(value.camera.activeCount(), 1);
  await value.client.selectFrame(); await value.client.selectFrame(); assert.equal(value.client.getSnapshot().selected.length, 1);
  value.client.nextFrame(); await value.client.selectFrame(); value.client.nextFrame(); await value.client.selectFrame();
  const selection = value.client.getSnapshot().selected;
  assert.equal(selection.length, 3); assert.ok(selection.every(frame => frame.language === language && frame.source === 'fictional_local_selection'));
  assert.equal(await value.client.selectFrame(), false);
  value.client.removeFrame(selection[0].id); assert.equal(value.client.getSnapshot().selected.length, 2);
  value.client.stop(); assert.equal(value.camera.activeCount(), 0); assert.deepEqual(value.client.getSnapshot().selected, []);
});
test('declined permission never opens a preview or retains consent', async () => {
  const value = setup(); value.client.setConsent(true); const pending = value.client.start(); value.camera.answerPermission(false);
  assert.equal(await pending, false); assert.equal(value.camera.activeCount(), 0); assert.equal(value.client.getSnapshot().status, 'failed'); assert.equal(value.client.getSnapshot().consent, false);
});
test('consent withdrawal stops the owned preview and clears all selected frames', async () => {
  const value = setup(); await start(value); await value.client.selectFrame(); value.client.setConsent(false);
  assert.equal(value.camera.activeCount(), 0); assert.equal(value.client.getSnapshot().consent, false); assert.deepEqual(value.client.getSnapshot().selected, []);
  assert.equal(await value.client.selectFrame(), false);
});
test('cancelled fake permission and disposed component cannot resurrect preview', async () => {
  const camera = controllableCamera(), value = setup({ camera }); value.client.setConsent(true); const pending = value.client.start(); value.client.dispose();
  const length = value.states.length, late = camera.resource(); camera.requests[0].resolve(late);
  assert.equal(await pending, false); assert.equal(late.closed, true); assert.equal(value.states.length, length); assert.equal(await value.client.start(), false);
});
test('old permission completion and old device-ended event cannot stop newer preview', async () => {
  const camera = controllableCamera(), value = setup({ camera }); value.client.setConsent(true); const oldPending = value.client.start(); value.client.stop();
  value.client.setConsent(true); const newPending = value.client.start(), current = camera.resource(); camera.requests[1].resolve(current); assert.equal(await newPending, true);
  const stale = camera.resource(); camera.requests[0].resolve(stale); assert.equal(await oldPending, false);
  stale.lateEnd(); assert.equal(stale.closed, true); assert.equal(current.closed, false); assert.equal(value.client.getSnapshot().status, 'previewing');
  value.client.stop();
});
test('late device-ended callback from formerly active preview is ignored', async () => {
  const camera = controllableCamera(), value = setup({ camera }); value.client.setConsent(true); const a = value.client.start(), old = camera.resource(); camera.requests[0].resolve(old); await a; value.client.stop();
  value.client.setConsent(true); const b = value.client.start(), current = camera.resource(); camera.requests[1].resolve(current); await b; old.lateEnd();
  assert.equal(current.closed, false); assert.equal(value.client.getSnapshot().status, 'previewing'); value.client.dispose();
});
test('device loss clears consent, preview and selected frames', async () => {
  const value = setup(); await start(value); await value.client.selectFrame(); value.camera.disconnect();
  assert.equal(value.client.getSnapshot().reason, 'device_lost'); assert.equal(value.client.getSnapshot().previewFrameId, null); assert.deepEqual(value.client.getSnapshot().selected, []);
});
test('pending selected frame is discarded after withdrawal or replacement', async () => {
  const camera = controllableCamera(), value = setup({ camera }); value.client.setConsent(true); const a = value.client.start(), old = camera.resource(); camera.requests[0].resolve(old); await a;
  const frame = deferred(); old.selectFrame = () => frame.promise; const pending = value.client.selectFrame(); value.client.stop();
  value.client.setConsent(true); const b = value.client.start(), current = camera.resource(); camera.requests[1].resolve(current); await b;
  frame.resolve(SCENES[0].id); assert.equal(await pending, false); assert.deepEqual(value.client.getSnapshot().selected, []); assert.equal(current.closed, false); value.client.dispose();
});
test('removing a frame wins over an older pending reselection', async () => {
  const camera = controllableCamera(), value = setup({ camera }); value.client.setConsent(true); const begin = value.client.start(), resource = camera.resource(); camera.requests[0].resolve(resource); await begin; await value.client.selectFrame();
  const frame = deferred(); resource.selectFrame = () => frame.promise; const pending = value.client.selectFrame(); value.client.removeFrame(SCENES[0].id); frame.resolve(SCENES[0].id);
  assert.equal(await pending, false); assert.deepEqual(value.client.getSnapshot().selected, []); value.client.dispose();
});
test('expired permission response closes its resource even before delayed timeout executes', async () => {
  const camera = controllableCamera(), value = setup({ camera }); value.client.setConsent(true); const pending = value.client.start(); value.advance(MAX_SESSION_MS);
  const late = camera.resource(); camera.requests[0].resolve(late); assert.equal(await pending, false); assert.equal(late.closed, true); assert.equal(value.client.getSnapshot().reason, 'expired');
});
test('expiry clears selection and stale expiry callback cannot stop a new preview', async () => {
  const value = setup(); await start(value); const oldTimer = value.timers[0]; await value.client.selectFrame(); value.advance(MAX_SESSION_MS); value.client.nextFrame();
  assert.equal(value.camera.activeCount(), 0); assert.deepEqual(value.client.getSnapshot().selected, []);
  await start(value); oldTimer(); assert.equal(value.camera.activeCount(), 1); value.client.dispose();
});
test('unknown frame values cannot become source metadata or clinical output', async () => {
  const camera = controllableCamera(), value = setup({ camera }); value.client.setConsent(true); const pending = value.client.start(), resource = camera.resource(); camera.requests[0].resolve(resource); await pending;
  resource.selectFrame = async () => 'arbitrary-patient-or-image-content'; assert.equal(await value.client.selectFrame(), false); assert.equal(resource.closed, true); assert.deepEqual(value.client.getSnapshot().selected, []);
});
test('invalid identity, current role and language cannot request fictional camera access', async () => {
  for (const extra of [{ userId: null }, { role: 'patient' }, { language: 'en' }]) { const camera = controllableCamera(), value = setup({ camera, ...extra }); assert.equal(value.client.setConsent(true), false); assert.equal(await value.client.start(), false); assert.equal(camera.requests.length, 0); }
});
test('source contract: development gate, authenticated panel scope, no native capture or outbound path', () => {
  const root = path.resolve(__dirname, '../../..'), page = fs.readFileSync(path.join(root, 'app/voice-lab/page.js'), 'utf8'), panel = fs.readFileSync(path.join(root, 'components/voice/CameraPreviewPrototype.jsx'), 'utf8');
  const controller = fs.readFileSync(path.join(root, 'lib/voice/syntheticCameraPreview.cjs'), 'utf8'), lab = fs.readFileSync(path.join(root, 'components/voice/VoiceIntakeLab.jsx'), 'utf8');
  assert.match(page, /NODE_ENV !== 'development'/); assert.match(page, /DOCTARX_VOICE_SYNTHETIC_ENABLED !== 'true'/);
  assert.ok(lab.indexOf('<CameraPreviewPrototype') > lab.indexOf('!capabilities.enabled'));
  assert.match(panel, /visibilitychange/); assert.match(panel, /pagehide/); assert.match(panel, /\[userId, role, language\]/);
  for (const forbidden of [/getUserMedia/, /MediaRecorder/, /fetch\(/, /XMLHttpRequest/, /WebSocket/, /localStorage/, /toDataURL/, /toBlob/, /visionApi/, /chartApi/]) assert.doesNotMatch(panel + controller, forbidden);
  assert.doesNotMatch(panel, /avatar/i); assert.match(panel, /AI pre-consultation assistant/);
});
