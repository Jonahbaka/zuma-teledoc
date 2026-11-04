'use strict';
// Fictional browser objects only. No actual device, AudioContext or permission.
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, callback) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(callback); }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  emit(name, data = {}) { for (const callback of [...this.listeners.get(name) || []]) callback({ currentTarget: this, ...data }); }
}
class FakeSocket extends Target {
  constructor(url) { super(); this.url = url; this.readyState = 0; this.bufferedAmount = 0; this.sent = []; this.closes = 0; }
  open() { this.readyState = 1; this.emit('open'); }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  message(value) { this.emit('message', { data: JSON.stringify(value) }); }
  close() { this.closes++; this.readyState = 3; this.emit('close'); }
}
function browser(extra = {}) {
  const streams = [], contexts = [], nodes = [], worklets = [];
  const pageTarget = new Target(), documentTarget = new Target(); documentTarget.visibilityState = 'visible';
  function stream() {
    const track = new Target(); Object.assign(track, { kind: 'audio', enabled: true, readyState: 'live', stops: 0, stop() { this.enabled = false; this.stops++; this.readyState = 'ended'; } });
    const value = { track, getTracks: () => [track], getAudioTracks: () => [track] }; streams.push(value); return value;
  }
  let requests = 0;
  const mediaDevices = { async getUserMedia(constraints) { requests++; if (extra.getUserMedia) return extra.getUserMedia(constraints); return stream(); } };
  function createContext(options) {
    const context = { sampleRate: options.sampleRate, state: 'suspended', destination: {}, currentTime: 0,
      audioWorklet: { async addModule() { if (extra.moduleWait) await extra.moduleWait.promise; } },
      async resume() { if (this.waitResume) await this.waitResume.promise; if (this.state !== 'closed') this.state = 'running'; },
      async close() { this.state = 'closed'; },
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; },
      createBuffer(_channels, frames) { const samples = new Float32Array(frames); return { getChannelData: () => samples }; },
      createBufferSource() { const node = { stops: 0, connect() {}, disconnect() {}, start() {}, stop() { this.stops++; } }; nodes.push(node); return node; }
    }; contexts.push(context); return context;
  }
  function createWorkletNode() {
    const worklet = { connect() {}, disconnect() {}, port: { sent: [], postMessage(value) { this.sent.push(value); } } }; worklets.push(worklet); return worklet;
  }
  let sequence = 0;
  function frame(worklet = worklets.at(-1)) {
    const capture = worklet.port.sent.filter(value => value.type === 'capture').at(-1);
    worklet.port.onmessage?.({ data: { type: 'pcm16', sequence: ++sequence, epoch: capture.epoch, buffer: new ArrayBuffer(3200) } });
  }
  return { mediaDevices, createContext, createWorkletNode, pageTarget, documentTarget, streams, contexts, nodes, worklets, frame, stream, requests: () => requests };
}
module.exports = { browser, deferred, FakeSocket };
