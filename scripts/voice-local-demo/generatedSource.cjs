'use strict';
// Real Web Audio source, but generated entirely in this page. No microphone.
function createGeneratedSource({ createContext, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const context = createContext({ sampleRate: 16000, latencyHint: 'interactive' });
  let oscillator, gain, stream, stopping;
  const stop = () => {
    if (stopping) return stopping;
    let resolve; stopping = new Promise(done => { resolve = done; });
    try { oscillator?.stop(); } catch {} try { oscillator?.disconnect(); } catch {} try { gain?.disconnect(); } catch {}
    let tracksStopped = true;
    for (const track of stream?.getTracks() || []) { try { track.enabled = false; track.stop(); } catch {} if (track.readyState !== 'ended') tracksStopped = false; }
    let deadline;
    Promise.race([Promise.resolve().then(() => context.close()).then(() => context.state === 'closed', () => false),
      new Promise(done => { deadline = setTimer(() => done(false), 1500); })]).then(contextsClosed => { clearTimer(deadline); resolve({ tracksStopped, contextsClosed }); });
    return stopping;
  };
  let ready;
  try {
    const destination = context.createMediaStreamDestination(); stream = destination.stream;
    oscillator = context.createOscillator(); gain = context.createGain(); oscillator.frequency.value = 220; gain.gain.value = 0.02;
    oscillator.connect(gain); gain.connect(destination); oscillator.start();
    ready = Promise.resolve(context.resume()).then(() => { if (stopping || context.state !== 'running') throw new Error('Generated input could not start.'); return stream; });
  } catch (error) { ready = Promise.reject(error); }
  ready = ready.catch(async () => { await stop(); throw new Error('Generated input could not start.'); }); ready.catch(() => {});
  return Object.freeze({ ready, stop, status: () => ({ context: context.state, stopped: !!stopping }) });
}
module.exports = { createGeneratedSource };
