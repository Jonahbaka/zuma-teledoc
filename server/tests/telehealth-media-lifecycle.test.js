'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { transformSync } = require('next/dist/build/swc');

const source = fs.readFileSync(require.resolve('../../lib/useTelehealthSession.js'), 'utf8');
const code = transformSync(source, { jsc: { parser: { syntax: 'ecmascript' } }, module: { type: 'commonjs' } }).code;
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
function stream(kinds = ['audio', 'video']) {
  const tracks = kinds.map(kind => ({ kind, enabled: true, readyState: 'live', stops: 0, stop() { this.stops++; this.readyState = 'ended'; } }));
  return { getTracks: () => tracks, getAudioTracks: () => tracks.filter(t => t.kind === 'audio'), getVideoTracks: () => tracks.filter(t => t.kind === 'video') };
}
// Execute the shipped hook and, when requested, the shipped provider SelfView.
// This renderer preserves hook slots/dependencies and runs real component effects;
// only browser devices, socket transport, and RTCPeerConnection are controlled.
const providerSource = fs.readFileSync(require.resolve('../../app/(dashboard)/provider/appointments/[id]/call/page.js'), 'utf8');
const selfViewSource = providerSource.slice(providerSource.indexOf('const SelfView ='), providerSource.indexOf('const AIAgentSidebar ='));
const selfViewCode = transformSync(`const { useRef, useState, useEffect } = require('react'); const User = 'user', MicOff = 'mic-off'; ${selfViewSource} module.exports = SelfView;`, {
  jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' }
}).code;
function harness(options = {}) {
  const timers = new Map(), states = [], sockets = [], requests = [], peers = [], signals = [];
  const hookSlots = [], viewSlots = [];
  let timerId = 0, slots, cursor, dirty = false, effects = [], hook;
  const changed = (old, deps) => !old || !deps || deps.some((value, index) => value !== old.deps[index]);
  const react = {
    useState(initial) { const index = cursor++; if (!slots[index]) { slots[index] = { value: typeof initial === 'function' ? initial() : initial }; if (slots === hookSlots) states.push(slots[index]); } const state = slots[index]; return [state.value, update => { const value = typeof update === 'function' ? update(state.value) : update; if (!Object.is(value, state.value)) { state.value = value; dirty = true; } }]; },
    useRef(current) { const index = cursor++; slots[index] ||= { current }; return slots[index]; },
    useCallback(fn, deps) { const index = cursor++; if (changed(slots[index], deps)) slots[index] = { value: fn, deps }; return slots[index].value; },
    useEffect(fn, deps) { const index = cursor++, old = slots[index]; if (changed(old, deps)) { const next = { deps }; slots[index] = next; effects.push(() => { old?.cleanup?.(); next.cleanup = fn(); }); } },
  };
  const jsx = (type, props) => { if (type === 'video' && props.ref) props.ref.current = { srcObject: null, play: async () => {} }; return { type, props }; };
  class Peer {
    constructor() { this.signalingState = options.signalingState || 'stable'; this.connectionState = 'new'; this.iceConnectionState = 'new'; this.senders = []; this.closed = false; peers.push(this); }
    getSenders() { return this.senders; }
    addTrack(track) { const sender = { track, replaceTrack: async next => { if (options.replaceTrack) await options.replaceTrack(next, this); sender.track = next; } }; this.senders.push(sender); }
    async createOffer() { return options.createOffer ? options.createOffer(this) : { type: 'offer', sdp: 'synthetic-offer' }; }
    async createAnswer() { return options.createAnswer ? options.createAnswer(this) : { type: 'answer', sdp: 'synthetic-answer' }; }
    async setLocalDescription(value) { if (options.setLocalDescription) await options.setLocalDescription(value, this); this.localDescription = value; this.signalingState = value.type === 'offer' ? 'have-local-offer' : 'stable'; }
    async setRemoteDescription(value) { if (options.setRemoteDescription) await options.setRemoteDescription(value, this); this.remoteDescription = value; this.signalingState = value.type === 'offer' ? 'have-remote-offer' : 'stable'; }
    async addIceCandidate(value) { if (options.addIceCandidate) await options.addIceCandidate(value, this); }
    async getStats() { return options.getStats ? options.getStats(this) : new Map(); }
    close() { this.closed = true; this.connectionState = 'closed'; }
  }
  const context = {
    module: { exports: {} }, exports: {}, process: { env: {} }, console: { warn() {}, error() {} },
    setTimeout, clearTimeout, RTCPeerConnection: Peer, RTCSessionDescription: function(value) { return value; }, RTCIceCandidate: function(value) { return value; },
    navigator: { mediaDevices: { getUserMedia: constraints => { requests.push(constraints); return options.capture(constraints, requests.length); } } },
    window: { location: { hostname: '127.0.0.1', protocol: 'http:', origin: 'http://127.0.0.1:3000' }, isSecureContext: true,
      setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id), setInterval: () => 1, clearInterval() {} },
    MediaStream: function(tracks = []) { return { getTracks: () => tracks, getAudioTracks: () => tracks.filter(t => t.kind === 'audio'), getVideoTracks: () => tracks.filter(t => t.kind === 'video') }; },
  };
  context.exports = context.module.exports;
  const getToken = () => 'synthetic-token';
  context.require = name => ({
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'socket.io-client': { io: () => {
      const events = new Map();
      const socket = { id: 'synthetic-self', connected: false, on(name, fn) { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); }, off(name, fn) { events.set(name, (events.get(name) || []).filter(f => f !== fn)); }, removeAllListeners() { events.clear(); }, disconnect() { socket.connected = false; socket.fire('disconnect'); },
        fire(name, payload) { return Promise.all([...(events.get(name) || [])].map(fn => fn(payload))); },
        timeout() { return { emit(name, payload, ack) { if (name === 'telehealth:leave' && options.leaveAck) return options.leaveAck(ack); if (name === 'telehealth:signal') { signals.push(payload); if (options.signalAck) return options.signalAck(payload, ack); } ack(null, { ok: true, roomId: 'synthetic-room', participant: { socketId: socket.id }, participants: options.participants || [] }); } }; } };
      sockets.push(socket); queueMicrotask(() => { socket.connected = true; socket.fire('connect'); }); return socket;
    } },
    '@/lib/socketSession': { installSocketSessionRefresh() {} },
    '@/lib/rtcConnectionQuality.cjs': require('../../lib/rtcConnectionQuality.cjs'),
    '@/lib/api': { appointmentsAPI: { join: options.join || (async () => ({ data: { roomId: 'synthetic-room' } })) } },
    '@/components/providers/AuthProvider': { useAuth: () => ({ getToken }) },
  })[name];
  vm.runInNewContext(code, context);
  const viewModule = { exports: {} };
  vm.runInNewContext(selfViewCode, { module: viewModule, exports: viewModule.exports, require: context.require });
  const h = { get hook() { return hook; }, requests, sockets, states, timers, peers, signals,
    render() { let passes = 0; do { assert.ok(passes++ < 30, 'render must settle'); dirty = false; slots = hookSlots; cursor = 0; hook = context.module.exports.useTelehealthSession({ appointmentId: 'synthetic-appointment' }); if (options.selfView) { slots = viewSlots; cursor = 0; viewModule.exports({ stream: hook.localStream, ensureLocalStream: hook.ensureLocalStream, camOn: true, micOn: true, userName: 'Synthetic provider', cssFilter: 'none' }); } for (const effect of effects.splice(0)) effect(); } while (dirty); },
    async flush() { await turn(); h.render(); await turn(); h.render(); },
    unmount() { for (const slot of [...hookSlots, ...viewSlots]) slot?.cleanup?.(); },
    expireRequest() { const [id, fn] = timers.entries().next().value; timers.delete(id); fn(); },
  };
  h.render(); return h;
}

test('a media request resolving after its timeout stops every abandoned track', async () => {
  const late = deferred(), accepted = stream(), abandoned = stream();
  const h = harness({ capture: (_constraints, count) => count === 1 ? late.promise : Promise.resolve(accepted) });
  const acquiring = h.hook.ensureLocalStream(); h.expireRequest();
  assert.equal(await acquiring, accepted);
  late.resolve(abandoned); await turn();
  assert.ok(abandoned.getTracks().every(track => track.stops === 1), 'timed-out camera/microphone must be stopped');
  assert.ok(accepted.getTracks().every(track => track.stops === 0));
  h.unmount();
});

test('unmount cancels pending permission capture without publishing or starting fallback', async () => {
  const late = deferred(), abandoned = stream(); const h = harness({ capture: () => late.promise });
  const acquiring = h.hook.ensureLocalStream(); h.unmount(); late.resolve(abandoned);
  await assert.rejects(acquiring, /cancelled/i);
  assert.ok(abandoned.getTracks().every(track => track.stops === 1));
  assert.equal(h.requests.length, 1);
  assert.equal(h.states[0].value, null);
});

test('leave during capture preserves a newer retry and stops the older capture', async () => {
  const old = deferred(), next = deferred(), abandoned = stream(), accepted = stream();
  const h = harness({ capture: (_constraints, count) => count === 1 ? old.promise : next.promise });
  const first = h.hook.ensureLocalStream(); await h.hook.leaveCall();
  await assert.rejects(h.hook.ensureLocalStream(), /cancelled/i);
  const joining = h.hook.joinCall();
  const second = h.hook.ensureLocalStream(); old.resolve(abandoned);
  await assert.rejects(first, /cancelled/i);
  const third = h.hook.ensureLocalStream();
  assert.equal(h.requests.length, 2, 'stale cleanup must not clear a newer pending request');
  next.resolve(accepted); assert.equal(await second, accepted); assert.equal(await third, accepted); await joining;
  assert.ok(abandoned.getTracks().every(track => track.stops === 1)); h.unmount();
});

test('a denied permission settling after navigation never requests a fallback device', async () => {
  const late = deferred(); const h = harness({ capture: () => late.promise });
  const acquiring = h.hook.ensureLocalStream(); h.unmount(); late.reject(new Error('Permission denied'));
  await assert.rejects(acquiring, /cancelled/i); assert.equal(h.requests.length, 1);
});

test('camera switching after unmount stops the newly captured camera', async () => {
  const late = deferred(), abandoned = stream(['video']); const h = harness({ capture: () => late.promise });
  const switching = h.hook.switchCamera(); h.unmount(); late.resolve(abandoned);
  await assert.rejects(switching, /cancelled/i); assert.equal(abandoned.getTracks()[0].stops, 1);
  assert.equal(h.states[0].value, null);
});

test('leaving releases active devices before waiting for the signaling acknowledgement', async () => {
  const active = stream(); let ack;
  const h = harness({ capture: async () => active, leaveAck: callback => { ack = callback; } });
  await h.hook.joinCall(); const leaving = h.hook.leaveCall();
  assert.ok(active.getTracks().every(track => track.stops === 1), 'network delay must not postpone device release');
  h.sockets[0].fire('telehealth:signal', { fromSocketId: 'remote', signalType: 'offer', signal: {} });
  await turn(); assert.equal(h.requests.length, 1, 'a late remote offer must not recapture devices while leaving');
  ack(null, { ok: true }); await leaving; h.unmount();
});

test('replacement by another tab closes media and disables automatic rejoining', async () => {
  const active = stream(); const h = harness({ capture: async () => active });
  await h.hook.joinCall(); h.sockets[0].fire('telehealth:replaced');
  assert.ok(active.getTracks().every(track => track.stops === 1));
  await assert.rejects(h.hook.reconnectCall(), /Join the appointment/); h.unmount();
});

test('a join response arriving after leave cannot recreate signaling or recapture media', async () => {
  const response = deferred(), active = stream();
  const h = harness({ capture: async () => active, join: () => response.promise });
  const joining = h.hook.joinCall(); await turn(); await h.hook.leaveCall();
  response.resolve({ data: { roomId: 'synthetic-room' } });
  await assert.rejects(joining, /cancelled/i);
  assert.equal(h.sockets.length, 0); assert.equal(h.requests.length, 1); h.unmount();
});

test('camera retries share a single picker and keep camera-off choice', async () => {
  const active = stream(), replacement = stream(['video']), late = deferred();
  active.getVideoTracks()[0].enabled = false;
  const h = harness({ capture: (_constraints, count) => count === 1 ? Promise.resolve(active) : late.promise });
  await h.hook.ensureLocalStream(); const a = h.hook.switchCamera(), b = h.hook.switchCamera();
  assert.equal(h.requests.length, 2); late.resolve(replacement);
  const next = await a; assert.equal(await b, next);
  assert.equal(next.getVideoTracks()[0].enabled, false);
  assert.equal(active.getVideoTracks()[0].stops, 1);
  assert.equal(active.getAudioTracks()[0].stops, 0); h.unmount();
});

test('ordinary capture clears its timeout and successful leave releases all tracks', async () => {
  const active = stream(); const h = harness({ capture: async () => active });
  assert.equal(await h.hook.ensureLocalStream(), active); assert.equal(h.timers.size, 0);
  await h.hook.leaveCall(); assert.ok(active.getTracks().every(track => track.stops === 1)); h.unmount();
});

for (const action of ['leave', 'replacement']) test(`actual provider SelfView cannot recapture after ${action} while still mounted`, async () => {
  const captures = []; let leaveAck;
  const h = harness({ selfView: true, capture: async () => { const value = stream(); captures.push(value); return value; }, leaveAck: ack => { leaveAck = ack; } });
  await h.flush(); await h.hook.joinCall(); await h.flush();
  assert.equal(captures.length, 1, 'the real preview effect acquires the initial stream');
  let leaving;
  if (action === 'leave') leaving = h.hook.leaveCall();
  else await h.sockets[0].fire('telehealth:replaced');
  await h.flush();
  assert.equal(captures.length, 1, 'the null-stream rerender must not reopen devices');
  assert.ok(captures[0].getTracks().every(track => track.readyState === 'ended'));
  await assert.rejects(h.hook.ensureLocalStream(), /cancelled/i);
  await assert.rejects(h.hook.switchCamera(), /cancelled/i);
  if (leaving) { leaveAck(null, { ok: true }); await leaving; }
  await h.flush(); assert.equal(captures.length, 1, 'completed hangup remains terminal to preview effects');
  h.unmount();
});

for (const outcome of ['success', 'failure']) test(`late outgoing offer ${outcome} cannot overwrite the ended call`, async () => {
  let finish;
  const active = stream();
  const h = harness({ capture: async () => active, participants: [{ socketId: 'z-remote', role: 'patient' }], signalAck: (_payload, ack) => { finish = ack; } });
  const joining = h.hook.joinCall(); const rejected = assert.rejects(joining, /cancelled/i);
  await turn(); assert.equal(typeof finish, 'function');
  await h.hook.leaveCall(); h.render();
  assert.equal(h.hook.callPhase, 'ended');
  finish(outcome === 'failure' ? new Error('Synthetic delayed failure') : null, { ok: true });
  await rejected; await h.flush();
  assert.equal(h.hook.connectionStatus, 'idle'); assert.equal(h.hook.callPhase, 'ended');
  assert.ok(h.peers.every(peer => peer.closed)); h.unmount();
});

test('captured replacement camera is released immediately while replaceTrack is pending', async () => {
  const replacement = stream(['video']), active = stream(), blocked = deferred(); let entered = false;
  const h = harness({ capture: async (_constraints, count) => count === 1 ? active : replacement,
    participants: [{ socketId: 'z-remote', role: 'patient' }], replaceTrack: () => { entered = true; return blocked.promise; } });
  await h.hook.joinCall(); const switching = h.hook.switchCamera(); const rejected = assert.rejects(switching, /cancelled/i);
  await turn(); assert.equal(entered, true); assert.equal(replacement.getTracks()[0].readyState, 'live');
  h.unmount();
  assert.equal(replacement.getTracks()[0].readyState, 'ended', 'release cannot wait for browser sender completion');
  assert.ok(active.getTracks().every(track => track.readyState === 'ended'));
  blocked.resolve(); await rejected; assert.equal(replacement.getTracks()[0].stops, 1);
});

test('late incoming rollback rejection cannot recreate a peer after unmount', async () => {
  const rollback = deferred(); let entered = false;
  const h = harness({ capture: async () => stream(), participants: [{ socketId: 'z-remote', role: 'patient' }],
    setLocalDescription: value => { if (value.type === 'rollback') { entered = true; return rollback.promise; } } });
  await h.hook.joinCall();
  const incoming = h.sockets[0].fire('telehealth:signal', { fromSocketId: 'z-remote', signalType: 'offer', signal: { type: 'offer' } });
  await turn(); assert.equal(entered, true); h.unmount(); rollback.reject(new Error('Synthetic unsupported rollback')); await incoming;
  assert.equal(h.peers.length, 1); assert.ok(h.peers.every(peer => peer.closed));
  assert.equal(h.signals.filter(value => value.signalType === 'answer').length, 0);
});

for (const boundary of ['remote-description', 'answer', 'local-description', 'answer-ack']) {
  for (const outcome of ['success', 'failure']) test(`incoming ${boundary} ${outcome} after leave cannot resume negotiation`, async () => {
    const blocked = deferred(); let entered = false, ack;
    const wait = () => { entered = true; return blocked.promise; };
    const h = harness({ capture: async () => stream(),
      setRemoteDescription: boundary === 'remote-description' ? wait : undefined,
      createAnswer: boundary === 'answer' ? wait : undefined,
      setLocalDescription: boundary === 'local-description' ? wait : undefined,
      signalAck: boundary === 'answer-ack' ? (_payload, callback) => { entered = true; ack = callback; } : undefined,
    });
    await h.hook.joinCall();
    const incoming = h.sockets[0].fire('telehealth:signal', { fromSocketId: 'z-remote', signalType: 'offer', signal: { type: 'offer' } });
    await turn(); assert.equal(entered, true); await h.hook.leaveCall();
    if (ack) ack(outcome === 'failure' ? new Error('Synthetic delayed failure') : null, { ok: true });
    else if (outcome === 'failure') blocked.reject(new Error('Synthetic delayed failure'));
    else blocked.resolve({ type: 'answer', sdp: 'synthetic' });
    await incoming; await h.flush();
    assert.equal(h.hook.connectionStatus, 'idle'); assert.equal(h.hook.callPhase, 'ended');
    assert.ok(h.peers.every(peer => peer.closed)); assert.equal(h.requests.length, 1);
    assert.equal(h.signals.filter(value => value.signalType === 'answer').length, boundary === 'answer-ack' ? 1 : 0); h.unmount();
  });
}

test('repeated leave shares one request and only a subsequent explicit join reopens capture', async () => {
  const captures = []; let ack, leaves = 0;
  const h = harness({ selfView: true, capture: async () => { const value = stream(); captures.push(value); return value; },
    leaveAck: callback => { leaves++; ack = callback; } });
  await h.flush(); await h.hook.joinCall();
  const first = h.hook.leaveCall(), second = h.hook.leaveCall();
  await assert.rejects(h.hook.joinCall(), /cancelled/i);
  await h.flush(); assert.equal(leaves, 1); assert.equal(captures.length, 1);
  ack(null, { ok: true }); await Promise.all([first, second]);
  await h.hook.joinCall(); await h.flush();
  assert.equal(captures.length, 2); assert.equal(h.hook.connectionStatus, 'waiting');
  assert.ok(captures[0].getTracks().every(track => track.readyState === 'ended'));
  assert.ok(captures[1].getTracks().every(track => track.readyState === 'live')); h.unmount();
});

for (const getStats of [async () => new Map(), async () => { throw new Error('Synthetic unavailable RTC stats'); }]) test('the shipped call hook does not present missing/failed stats as good quality', async () => {
  const h = harness({ capture: async () => stream(), participants: [{ socketId: 'z-remote' }], getStats });
  await h.hook.joinCall(); const peer = h.peers[0]; peer.connectionState = 'connected'; peer.onconnectionstatechange(); await h.flush();
  assert.equal(h.hook.connectionQuality.level, 'unknown'); assert.equal(h.hook.connectionQuality.label, 'Not measured'); h.unmount();
});

test('a late healthy RTC sample after leave cannot restore good quality or polling', async () => {
  const pending = deferred(); let reads = 0;
  const h = harness({ capture: async () => stream(), participants: [{ socketId: 'z-remote' }], getStats: () => { reads++; return pending.promise; } });
  await h.hook.joinCall(); const peer = h.peers[0]; peer.connectionState = 'connected'; peer.onconnectionstatechange(); await h.flush();
  assert.equal(reads, 1); await h.hook.leaveCall(); await h.flush();
  pending.resolve(new Map([['remote', { id: 'remote', type: 'remote-inbound-rtp', kind: 'audio', timestamp: 1000, fractionLost: 0, roundTripTime: 0.1 }]])); await h.flush();
  assert.equal(h.hook.connectionQuality.level, 'idle'); assert.equal(h.timers.size, 0); h.unmount();
});

test('stats started before disconnect cannot overwrite a newer measurement after the same peer reconnects', async () => {
  const pending = deferred(); let reads = 0;
  const h = harness({ capture: async () => stream(), participants: [{ socketId: 'z-remote' }], getStats: () => ++reads === 1 ? pending.promise : Promise.resolve(new Map()) });
  await h.hook.joinCall(); const peer = h.peers[0]; peer.connectionState = 'connected'; peer.onconnectionstatechange(); await h.flush();
  peer.connectionState = 'disconnected'; peer.onconnectionstatechange(); await h.flush();
  peer.connectionState = 'connected'; peer.onconnectionstatechange(); await h.flush();
  assert.equal(reads, 2); assert.equal(h.hook.connectionQuality.level, 'unknown');
  pending.resolve(new Map([['remote', { id: 'remote', type: 'remote-inbound-rtp', kind: 'audio', timestamp: 1000, fractionLost: 0, roundTripTime: 0.1 }]])); await h.flush();
  assert.equal(h.hook.connectionQuality.level, 'unknown'); h.unmount();
});
