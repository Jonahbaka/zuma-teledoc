'use strict';
// Installed by this standalone fixture entry BEFORE the application component.
// These objects never call a native microphone, media peer, speaker or network.
function installFakeMedia() {
  const state = { permission: 'prompt', requests: 0, pending: [], tracks: [], peers: [], playing: false, plays: 0, pauses: 0 };
  class Track extends EventTarget {
    constructor(capture = true) { super(); this.enabled = true; this.stopped = false; if (capture) state.tracks.push(this); }
    stop() { this.stopped = true; this.enabled = false; }
  }
  class Stream { constructor(tracks = []) { this.tracks = tracks; } getTracks() { return this.tracks; } getAudioTracks() { return this.tracks; } }
  function grant(request) { request.resolve(new Stream([new Track()])); }
  function deny(request) { request.reject(new DOMException('Fictional permission denial', 'NotAllowedError')); }
  const mediaDevices = { getUserMedia() {
    state.requests++;
    return new Promise((resolve, reject) => {
      const request = { resolve, reject };
      if (state.permission === 'allow') grant(request);
      else if (state.permission === 'deny') deny(request);
      else state.pending.push(request);
    });
  } };
  class Channel extends EventTarget {
    constructor() { super(); this.readyState = 'open'; }
    close() { this.readyState = 'closed'; this.dispatchEvent(new Event('close')); }
    emit(event) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) })); }
  }
  class Peer extends EventTarget {
    constructor() { super(); this.iceGatheringState = 'complete'; this.connectionState = 'connected'; state.peers.push(this); }
    createDataChannel() { this.channel = new Channel(); return this.channel; }
    addTrack() {}
    async createOffer() { return { type: 'offer', sdp: 'v=0\r\nfictional-browser-offer' }; }
    async setLocalDescription(value) { this.localDescription = value; }
    async setRemoteDescription(value) {
      if (value.sdp !== 'v=0\r\nfictional-browser-answer') throw new Error('Unexpected fake SDP.');
      const event = new Event('track'); Object.defineProperty(event, 'track', { value: new Track(false) }); this.dispatchEvent(event);
      this.channel.emit({ type: 'session.started' });
    }
    close() { this.connectionState = 'closed'; }
  }
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
  window.RTCPeerConnection = Peer; window.MediaStream = Stream;
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, get() { return this.fixtureStream || null; }, set(value) { this.fixtureStream = value; } });
  HTMLMediaElement.prototype.play = async function play() { state.plays++; state.playing = true; };
  HTMLMediaElement.prototype.pause = function pause() { state.pauses++; state.playing = false; };
  return {
    setPermission(value) { state.permission = value; },
    allowPending() { for (const request of state.pending.splice(0)) grant(request); },
    denyPending() { for (const request of state.pending.splice(0)) deny(request); },
    disconnect() { const track = state.tracks.find(item => !item.stopped && item.enabled); if (track) track.dispatchEvent(new Event('ended')); },
    emit(event) { const peer = state.peers.at(-1); if (peer && peer.channel.readyState === 'open') peer.channel.emit(event); },
    snapshot() { return { requests: state.requests, pending: state.pending.length, activeTracks: state.tracks.filter(track => !track.stopped && track.enabled).length,
      playing: state.playing, plays: state.plays, pauses: state.pauses, openPeers: state.peers.filter(peer => peer.connectionState !== 'closed').length }; },
  };
}
module.exports = { installFakeMedia };
