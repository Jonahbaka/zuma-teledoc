/* global AudioWorkletProcessor, sampleRate, registerProcessor */
/* Own local AudioWorklet. Not mounted or loaded by the shipped application. */
class DoctaRxPcm16Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.epoch = 0; this.enabled = false; this.stopped = false; this.offset = 0;
    this.sequence = 0; this.totalFrames = 0; this.outstanding = new Map();
    this.samples = new Int16Array(1600); // 100 ms at the required context rate.
    this.port.onmessage = ({ data }) => {
      if (data?.type === 'stop') { this.stopped = true; this.enabled = false; this.samples.fill(0); this.offset = 0; }
      else if (data?.type === 'ack') { if (this.outstanding.get(data.sequence) === data.epoch) this.outstanding.delete(data.sequence); }
      else if (data?.type === 'capture' && Number.isSafeInteger(data.epoch) && data.epoch > this.epoch) { this.epoch = data.epoch; this.enabled = data.enabled === true && Number.isSafeInteger(data.epoch) && data.epoch >= 0 && !this.stopped; this.samples.fill(0); this.offset = 0; }
    };
    if (sampleRate !== 16000) { this.stopped = true; this.port.postMessage({ type: 'error', code: 'PCM_CAPTURE_RATE_UNSUPPORTED' }); }
  }
  fail(code) {
    this.stopped = true; this.enabled = false; this.samples.fill(0); this.offset = 0;
    this.port.postMessage({ type: 'error', code });
    return false;
  }
  process(inputs, outputs) {
    // Keep the node alive with a silent destination; never play local mic audio.
    for (const output of outputs) for (const channel of output) channel.fill(0);
    if (this.stopped) return false;
    const channels = inputs[0];
    if (!this.enabled || !channels?.length) return true;
    if (this.totalFrames >= 1800) return this.fail('PCM_CAPTURE_DURATION_LIMIT');
    if (this.outstanding.size >= 4) return this.fail('PCM_CAPTURE_CONSUMER_STALLED');
    const frames = channels[0]?.length || 0;
    for (let i = 0; i < frames; i++) {
      let value = 0;
      for (const channel of channels) value += Number.isFinite(channel[i]) ? channel[i] : 0;
      value = Math.max(-1, Math.min(1, value / channels.length));
      this.samples[this.offset++] = Math.round(value * (value < 0 ? 32768 : 32767));
      if (this.offset === this.samples.length) {
        if (this.totalFrames >= 1800) return this.fail('PCM_CAPTURE_DURATION_LIMIT');
        if (this.outstanding.size >= 4) return this.fail('PCM_CAPTURE_CONSUMER_STALLED');
        this.totalFrames++; this.sequence++; this.outstanding.set(this.sequence, this.epoch);
        // Explicit little-endian bytes, independent of host typed-array order.
        const bytes = new ArrayBuffer(this.samples.length * 2), view = new DataView(bytes);
        for (let j = 0; j < this.samples.length; j++) view.setInt16(j * 2, this.samples[j], true);
        this.port.postMessage({ type: 'pcm16', buffer: bytes, epoch: this.epoch, sequence: this.sequence }, [bytes]);
        this.samples.fill(0); this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('doctarx-pcm16-capture', DoctaRxPcm16Capture);
