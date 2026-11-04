'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const vm = require('node:vm');

const MODULE_URL = pathToFileURL(
  path.join(__dirname, '..', '..', 'lib', 'ng', 'connectionResilience.js')
).href;

let resilience = null;

async function load() {
  if (!resilience) resilience = await import(MODULE_URL);
  return resilience;
}

test.before(async () => {
  await load();
});

// ---------------------------------------------------------------------------
// Connection state
// ---------------------------------------------------------------------------

test('a healthy call is connected and offers no fallback', async () => {
  const { deriveConnectionState, CONNECTION_STATES } = await load();
  const state = deriveConnectionState({ phase: CONNECTION_STATES.CONNECTED, downKbps: 1200, packetLossPct: 0, rttMs: 60 });
  assert.equal(state.state, 'connected');
  assert.equal(state.severity, 'info');
  assert.equal(state.offerAudioOnly, false);
  assert.equal(state.offerReschedule, false);
  assert.equal(state.canReconnect, true);
});

test('a middling connection degrades and offers audio-only, not reschedule', async () => {
  const { deriveConnectionState, CONNECTION_STATES } = await load();
  const state = deriveConnectionState({ phase: CONNECTION_STATES.CONNECTED, downKbps: 150, packetLossPct: 4, rttMs: 300 });
  assert.equal(state.state, 'degraded');
  assert.equal(state.severity, 'warning');
  assert.equal(state.offerAudioOnly, true);
  assert.equal(state.offerReschedule, false, 'degrade before dropping');
  assert.ok(state.guidance.length > 0);
});

test('unusable bandwidth demands a fallback and offers reschedule', async () => {
  const { deriveConnectionState, CONNECTION_STATES } = await load();
  const low = deriveConnectionState({ phase: CONNECTION_STATES.CONNECTED, downKbps: 35, packetLossPct: 2, rttMs: 200 });
  assert.equal(low.state, 'fallback_required');
  assert.equal(low.severity, 'critical');
  assert.equal(low.offerAudioOnly, true);
  assert.equal(low.offerReschedule, true);

  const lossy = deriveConnectionState({ phase: CONNECTION_STATES.CONNECTED, downKbps: 900, packetLossPct: 15, rttMs: 100 });
  assert.equal(lossy.state, 'fallback_required', 'packet loss alone can make a call unusable');

  const laggy = deriveConnectionState({ phase: CONNECTION_STATES.CONNECTED, downKbps: 900, packetLossPct: 1, rttMs: 1500 });
  assert.equal(laggy.state, 'fallback_required', 'high latency alone can make a call unusable');
});

test('going offline shows reconnecting with a backoff, and recovery is announced', async () => {
  const { deriveConnectionState, CONNECTION_STATES } = await load();
  const offlineFirst = deriveConnectionState({ phase: CONNECTION_STATES.CONNECTED, offline: true, reconnectAttempt: 0 });
  assert.equal(offlineFirst.state, 'degraded');
  assert.ok(offlineFirst.retryDelayMs > 0);

  const reconnecting = deriveConnectionState({ phase: CONNECTION_STATES.CONNECTED, offline: true, reconnectAttempt: 2 });
  assert.equal(reconnecting.state, 'reconnecting');
  assert.ok(reconnecting.retryDelayMs >= 1000, 'backoff grows with attempts');

  const recovered = deriveConnectionState({ phase: CONNECTION_STATES.RECONNECTING, downKbps: 800, packetLossPct: 0, rttMs: 50 });
  assert.equal(recovered.state, 'recovered');
  assert.equal(recovered.severity, 'info');
});

test('an ended call cannot be reconnected', async () => {
  const { deriveConnectionState, CONNECTION_STATES } = await load();
  const state = deriveConnectionState({ phase: CONNECTION_STATES.ENDED, downKbps: 900 });
  assert.equal(state.state, 'ended');
  assert.equal(state.canReconnect, false);
  assert.equal(state.retryDelayMs, 0);
});

test('a forced state is respected, so the UI can pin permission or expiry states', async () => {
  const { deriveConnectionState, CONNECTION_STATES } = await load();
  const state = deriveConnectionState({ phase: CONNECTION_STATES.CONNECTED, downKbps: 900, forcedState: CONNECTION_STATES.FAILED });
  assert.equal(state.state, 'failed');
  assert.equal(state.offerReschedule, true);
});

test('reconnect backoff is exponential, capped, and deterministic for a given jitter value', async () => {
  const { computeReconnectDelay } = await load();
  assert.equal(computeReconnectDelay(0, { random: 0.5 }), 1000);
  assert.equal(computeReconnectDelay(1, { random: 0.5 }), 2000);
  assert.equal(computeReconnectDelay(2, { random: 0.5 }), 4000);
  assert.equal(computeReconnectDelay(20, { random: 0.5 }), 15000, 'never exceeds the cap');
  assert.equal(computeReconnectDelay(3, { random: 0.5 }), 8000, 'mid jitter is neutral');
  assert.equal(computeReconnectDelay(-4, { random: 0.5 }), 1000, 'a negative attempt is treated as the first');
  assert.ok(computeReconnectDelay(2, { random: 0 }) < computeReconnectDelay(2, { random: 1 }));
  assert.ok(computeReconnectDelay(2, { random: 0 }) >= 0, 'jitter never produces a negative delay');
});

// ---------------------------------------------------------------------------
// Failure descriptions: every listed media failure mode has safe, actionable copy
// ---------------------------------------------------------------------------

test('permission denial is explained without blaming the user and is recoverable', async () => {
  const { describeFailure, deriveConnectionState, CONNECTION_STATES } = await load();
  const denial = describeFailure({ name: 'NotAllowedError' });
  assert.equal(denial.code, 'PERMISSION_DENIED');
  assert.equal(denial.severity, 'critical');
  assert.equal(denial.recoverable, true);

  const state = deriveConnectionState({ phase: CONNECTION_STATES.JOINING, lastError: { name: 'NotAllowedError' } });
  assert.equal(state.failureCode, 'PERMISSION_DENIED');
  assert.equal(state.label, denial.message);
  assert.ok(state.guidance.includes('browser settings'));
});

test('missing and busy devices are distinguished', async () => {
  const { describeFailure } = await load();
  assert.equal(describeFailure({ name: 'NotFoundError' }).code, 'DEVICE_NOT_FOUND');
  assert.equal(describeFailure({ name: 'NotReadableError', message: 'Track start error' }).code, 'DEVICE_BUSY');
  assert.equal(describeFailure({ message: 'Requested device not found' }).code, 'DEVICE_NOT_FOUND');
  assert.equal(describeFailure({ message: 'Device is in use by another application' }).code, 'DEVICE_BUSY');
});

test('a media relay failure is treated as a media failure, not a generic error', async () => {
  const { describeFailure, deriveConnectionState, CONNECTION_STATES } = await load();
  assert.equal(describeFailure(new Error('Failed to establish TURN relay candidate')).code, 'MEDIA_RELAY_UNAVAILABLE');

  const state = deriveConnectionState({
    phase: CONNECTION_STATES.JOINING, downKbps: 900, lastError: new Error('ICE connection failed'),
  });
  assert.equal(state.failureCode, 'MEDIA_RELAY_UNAVAILABLE');
  assert.equal(state.offerAudioOnly, true);
  assert.ok(state.guidance.toLowerCase().includes('reschedule'));
});

test('an expired session token is distinguished from a network drop', async () => {
  const { describeFailure } = await load();
  assert.equal(describeFailure(new Error('Access token expired')).code, 'SESSION_EXPIRED');
  assert.equal(describeFailure({ name: 'NetworkError' }).code, 'NETWORK_UNAVAILABLE');
  assert.equal(describeFailure({}).code, 'UNKNOWN_MEDIA_ERROR');
  assert.equal(describeFailure(null).code, 'UNKNOWN_MEDIA_ERROR');
});

// ---------------------------------------------------------------------------
// Fail-closed media capability
// ---------------------------------------------------------------------------

test('multiparty is never advertised while media infrastructure is missing', async () => {
  const { evaluateMediaReadiness } = await load();

  const nothing = evaluateMediaReadiness({});
  assert.equal(nothing.multipartySupported, false);
  assert.equal(nothing.advertisedAsOperational, false);
  assert.deepEqual(nothing.blockers, ['SFU_NOT_CONFIGURED', 'TURN_NOT_CONFIGURED', 'ICE_SERVERS_MISSING']);

  const noTurn = evaluateMediaReadiness({
    sfuConfigured: true, iceServers: [{ urls: 'turn:relay' }], participantLimit: 10,
  });
  assert.equal(noTurn.multipartySupported, false);
  assert.ok(noTurn.blockers.includes('TURN_NOT_CONFIGURED'));
  assert.equal(noTurn.participantLimit, 2, 'a guarded integration is capped rather than advertised');
});

test('multiparty is only reported when SFU, TURN, ICE and a three-party limit all hold', async () => {
  const { evaluateMediaReadiness } = await load();
  const ready = evaluateMediaReadiness({
    sfuConfigured: true,
    turnConfigured: true,
    iceServers: [{ urls: 'stun:stun.example' }, { urls: 'turn:relay.example' }],
    participantLimit: 6,
  });
  assert.equal(ready.multipartySupported, true);
  assert.equal(ready.advertisedAsOperational, true);
  assert.equal(ready.participantLimit, 6);
  assert.deepEqual(ready.blockers, []);

  const twoPartyOnly = evaluateMediaReadiness({
    sfuConfigured: true, turnConfigured: true, iceServers: [{ urls: 'turn:relay' }], participantLimit: 2,
  });
  assert.equal(twoPartyOnly.multipartySupported, false, 'a two-party room is not a three-way consultation');
});

// ---------------------------------------------------------------------------
// Participants: departure, re-entry, rejection
// ---------------------------------------------------------------------------

test('participant join, departure, and re-entry are tracked', async () => {
  const { trackParticipants } = await load();
  const roster = trackParticipants([
    { type: 'join', participantId: 'nurse-1', role: 'phc_nurse', at: '2026-09-26T10:00:00Z' },
    { type: 'join', participantId: 'doctor-1', role: 'remote_clinician', at: '2026-09-26T10:00:05Z' },
  ]);
  assert.equal(roster.presentCount, 2);
  assert.deepEqual(roster.reentries, []);

  const afterDoctorLeaves = trackParticipants([{ type: 'leave', participantId: 'doctor-1' }], roster.participants);
  assert.equal(afterDoctorLeaves.presentCount, 1);
  assert.equal(afterDoctorLeaves.participants.find((p) => p.participantId === 'doctor-1').present, false);

  const afterDoctorReenters = trackParticipants([{ type: 'join', participantId: 'doctor-1' }], afterDoctorLeaves.participants);
  assert.equal(afterDoctorReenters.presentCount, 2);
  assert.deepEqual(afterDoctorReenters.reentries, ['doctor-1']);
  const rejoined = afterDoctorReenters.participants.find((p) => p.participantId === 'doctor-1');
  assert.equal(rejoined.joinCount, 2);
  assert.equal(rejoined.role, 'remote_clinician', 'a re-entry keeps the role it was authorised with');
});

test('a rejected participant is recorded instead of silently dropped', async () => {
  const { trackParticipants } = await load();
  const roster = trackParticipants([{ type: 'rejected', participantId: 'intruder-1', reason: 'not in programme' }]);
  assert.equal(roster.presentCount, 0);
  assert.equal(roster.rejected.length, 1);
  assert.equal(roster.rejected[0].reason, 'not in programme');
});

test('malformed participant events are ignored without breaking the roster', async () => {
  const { trackParticipants } = await load();
  const roster = trackParticipants([null, {}, { type: 'join' }, { type: 'leave', participantId: 'ghost' }]);
  assert.equal(roster.presentCount, 0);
  assert.deepEqual(roster.rejected, []);
});

// ---------------------------------------------------------------------------
// Duplicate tabs
// ---------------------------------------------------------------------------

test('a second tab on the same call is detected and explained', async () => {
  const { detectDuplicateSession } = await load();

  assert.equal(detectDuplicateSession({ activeSessionId: 's-1', incomingSessionId: 's-1', tabs: 1 }).duplicate, false);

  const reopened = detectDuplicateSession({ activeSessionId: 's-1', incomingSessionId: 's-1', tabs: 2 });
  assert.equal(reopened.duplicate, true);
  assert.equal(reopened.reason, 'SAME_SESSION_REOPENED');
  assert.ok(reopened.guidance.includes('two audio streams'));

  const otherDevice = detectDuplicateSession({ activeSessionId: 's-1', incomingSessionId: 's-2', tabs: 2 });
  assert.equal(otherDevice.duplicate, true);
  assert.equal(otherDevice.reason, 'CONCURRENT_SESSION');
  assert.ok(otherDevice.message.length > 0);
});

// Execute the shipped provider-room callback with controlled media and HTTP
// dependencies. This checks resource/state behavior; live SFU acceptance is a
// separate deployment test and is not implied by these mocked media sessions.
function providerRoomHarness(options = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'components/ng/conference/NGVideoCall.jsx'), 'utf8');
  const start = source.indexOf('  const handleJoin = useCallback(');
  const end = source.indexOf('  const retryConnect = useCallback(', start);
  assert.ok(start > 0 && end > start, 'provider connection callback is discoverable');
  const callback = source.slice(start, end).replace("await import('livekit-client')", 'await loadLiveKit()');
  const state = {};
  const captured = { camera: 0, microphone: 0 };
  const rooms = [];
  const tracks = [];
  const RoomEvent = Object.fromEntries(['TrackSubscribed', 'TrackUnsubscribed', 'ParticipantConnected', 'ParticipantDisconnected', 'TrackMuted', 'TrackUnmuted', 'LocalTrackPublished', 'LocalTrackUnpublished', 'AudioPlaybackStatusChanged', 'Reconnecting', 'Reconnected', 'Disconnected'].map(name => [name, name]));
  const Track = { Source: { Camera: 'camera', Microphone: 'microphone', ScreenShare: 'screen_share' } };
  const makeTrack = (kind) => {
    const track = { kind, stopped: 0, stop() { this.stopped += 1; } };
    tracks.push(track);
    return track;
  };
  class Room {
    constructor() {
      this.listeners = new Map(); this.disconnects = 0; this.removedListeners = 0;
      this.canPlaybackAudio = true;
      this.remoteParticipants = new Map(options.remotes || []);
      this.localParticipant = {
        videoTrackPublications: new Map(), audioTrackPublications: new Map(), isScreenShareEnabled: false,
        publishTrack: async track => {
          if (options.failVideoPublish && track.kind === 'video') throw new Error('Camera publication failed');
          const publications = track.kind === 'video' ? this.localParticipant.videoTrackPublications : this.localParticipant.audioTrackPublications;
          publications.set(track.kind, { source: track.kind === 'video' ? 'camera' : 'microphone', track, isMuted: false });
          this.listeners.get(RoomEvent.LocalTrackPublished)?.();
        },
      };
      rooms.push(this);
    }
    on(event, listener) { this.listeners.set(event, listener); return this; }
    removeAllListeners() { this.listeners.clear(); this.removedListeners += 1; }
    async connect() { if (options.connect) await options.connect(this); }
    async startAudio() {}
    async disconnect(stopTracks) {
      assert.equal(stopTracks, true, 'disconnect releases devices');
      this.disconnects += 1;
      this.listeners.get(RoomEvent.Disconnected)?.();
    }
  }
  const context = {
    state, rooms, tracks, captured, displayName: 'Doctor', useCallback: fn => fn,
    mountedRef: { current: true }, joinAttemptRef: { current: 0 }, mediaRoomRef: { current: null },
    lastDevices: { current: null }, lastRoomRef: { current: null },
    api: {
      getRoom: async () => ({ ok: true, room: { id: 'room-1', status: 'live' } }),
      startRoom: async () => { throw new Error('A live room must not be restarted'); },
      joinRoom: async () => ({ ok: true }),
      getToken: async () => ({ ok: true, token: 'test-token', livekitUrl: 'wss://media.example.test' }),
    },
    loadLiveKit: async () => ({ Room, RoomEvent, Track,
      createLocalVideoTrack: async () => { captured.camera += 1; return options.captureVideo ? options.captureVideo() : makeTrack('video'); },
      createLocalAudioTrack: async () => { captured.microphone += 1; return makeTrack('audio'); },
    }),
    console: { warn() {}, error() {} },
  };
  const setters = callback.match(/\bset[A-Z]\w*/g) || [];
  for (const name of new Set(setters)) context[name] = value => { state[name.slice(3)] = value; };
  vm.runInNewContext(`${callback}\nglobalThis.join = handleJoin;`, context);
  return context;
}

test('provider room honors camera-off preference and receives separate remote audio tracks', async () => {
  const remoteAudio = { kind: 'audio' };
  const remote = { identity: 'patient-1', videoTrackPublications: new Map(), audioTrackPublications: new Map([['mic', { trackSid: 'audio-1', track: remoteAudio }]]) };
  const h = providerRoomHarness({ remotes: [['patient-1', remote]] });
  await h.join({ id: 'room-1', status: 'live' }, { camera: false, microphone: true });
  assert.deepEqual(h.captured, { camera: 0, microphone: 1 });
  assert.equal(h.state.Phase, 'call');
  assert.equal(h.state.IsVideoOff, true);
  assert.equal(h.state.IsMuted, false);
  assert.equal(h.state.RemoteAudioTracks[0].track, remoteAudio);
});

test('a failed camera publication stops the captured track and leaves microphone available', async () => {
  const h = providerRoomHarness({ failVideoPublish: true });
  await h.join({ id: 'room-1', status: 'live' });
  assert.equal(h.tracks.find(track => track.kind === 'video').stopped, 1);
  assert.equal(h.state.IsVideoOff, true);
  assert.equal(h.state.IsMuted, false);
  assert.equal(h.state.LocalCameraTrack, null);
  assert.match(h.state.MediaError, /Camera publication failed/);
  assert.equal(h.state.Phase, 'call', 'the surviving audio connection stays available');
});

test('provider room retry disconnects its previous media session before connecting another', async () => {
  const h = providerRoomHarness();
  await h.join({ id: 'room-1', status: 'live' }, { camera: false, microphone: false });
  await h.join({ id: 'room-1', status: 'scheduled' }, { camera: false, microphone: false });
  assert.equal(h.rooms.length, 2);
  assert.equal(h.rooms[0].disconnects, 1);
  assert.equal(h.rooms[0].removedListeners, 1);
  assert.equal(h.mediaRoomRef.current, h.rooms[1]);
  assert.equal(h.state.Phase, 'call');
});

test('a connection completing after navigation is disconnected and never captures devices', async () => {
  let finish;
  const h = providerRoomHarness({ connect: () => new Promise(resolve => { finish = resolve; }) });
  const pending = h.join({ id: 'room-1', status: 'live' });
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  h.mountedRef.current = false;
  h.joinAttemptRef.current += 1;
  finish(); await pending;
  assert.equal(h.rooms[0].disconnects, 1);
  assert.deepEqual(h.captured, { camera: 0, microphone: 0 });
  assert.notEqual(h.state.Phase, 'call');
});

test('devices captured after navigation are stopped without publication', async () => {
  let finish;
  const video = { kind: 'video', stopped: 0, stop() { this.stopped += 1; } };
  const h = providerRoomHarness({ captureVideo: () => new Promise(resolve => { finish = resolve; }) });
  const pending = h.join({ id: 'room-1', status: 'live' });
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  h.mountedRef.current = false; h.joinAttemptRef.current += 1;
  finish(video); await pending;
  assert.equal(video.stopped, 1);
  assert.equal(h.tracks[0].stopped, 1);
  assert.equal(h.rooms[0].localParticipant.videoTrackPublications.size, 0);
  assert.equal(h.rooms[0].localParticipant.audioTrackPublications.size, 0);
  assert.notEqual(h.state.Phase, 'call');
});

test('initial SFU failure returns to preflight even when the SDK emits disconnection first', async () => {
  const h = providerRoomHarness({ connect: async room => { room.listeners.get('Disconnected')(); throw new Error('SFU unreachable'); } });
  await h.join({ id: 'room-1', status: 'live' });
  assert.equal(h.state.Phase, 'pre');
  assert.equal(h.state.ConnState, 'failed');
  assert.equal(h.state.SfuAvailable, false);
  assert.match(h.state.ConnectError, /SFU unreachable/);
});
