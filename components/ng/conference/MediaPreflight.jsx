'use client';

import { useEffect, useRef, useState } from 'react';
import { createLocalMediaPreview } from '@/lib/ng/localMediaPreview.cjs';

export default function MediaPreflight({ enabled = true }) {
  const controller = useRef(null);
  if (!controller.current) controller.current = createLocalMediaPreview();
  const lifecycle = useRef(0);
  const requests = useRef({ camera: 0, microphone: 0 });
  const pendingRequests = useRef({ camera: false, microphone: false });
  const meterContext = useRef(null);
  const video = useRef(null);
  const [streams, setStreams] = useState({});
  const [pending, setPending] = useState({});
  const [error, setError] = useState('');
  const [level, setLevel] = useState(0);
  const [meterPaused, setMeterPaused] = useState(false);

  useEffect(() => {
    const preview = controller.current;
    lifecycle.current += 1;
    if (!enabled) {
      preview.close();
      setStreams({});
      setPending({});
      pendingRequests.current = { camera: false, microphone: false };
    }
    return () => { lifecycle.current += 1; preview.close(); };
  }, [enabled]);

  useEffect(() => {
    if (video.current) video.current.srcObject = streams.camera || null;
  }, [streams.camera]);

  useEffect(() => {
    if (!streams.microphone) { setLevel(0); return; }
    let context, source, frame;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error('Audio level measurement is unavailable in this browser.');
      context = new AudioContext();
      meterContext.current = context;
      context.onstatechange = () => setMeterPaused(context.state !== 'running');
      setMeterPaused(context.state !== 'running');
      source = context.createMediaStreamSource(streams.microphone);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser); // No speaker connection: never feed microphone audio back.
      const samples = new Uint8Array(analyser.fftSize);
      const update = () => {
        analyser.getByteTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length);
        setLevel(Math.min(100, Math.round(rms * 400)));
        frame = requestAnimationFrame(update);
      };
      void context.resume().catch(() => setError('Your browser paused the microphone meter. Stop the test and start it again.'));
      update();
    } catch (cause) {
      setError(cause.message || 'The microphone level could not be measured.');
    }
    // Bound the local microphone test even if the user leaves this screen idle.
    const timeout = setTimeout(() => {
      controller.current.stop('microphone');
      setStreams((current) => ({ ...current, microphone: null }));
    }, 15000);
    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(frame);
      source?.disconnect();
      if (context) context.onstatechange = null;
      meterContext.current = null;
      if (context) void context.close().catch(() => {});
    };
  }, [streams.microphone]);

  const toggle = async (kind) => {
    if (!enabled) return;
    if (streams[kind] || pendingRequests.current[kind]) {
      requests.current[kind] += 1;
      pendingRequests.current[kind] = false;
      controller.current.stop(kind);
      setStreams((current) => ({ ...current, [kind]: null }));
      setPending((current) => ({ ...current, [kind]: false }));
      return;
    }
    const ticket = lifecycle.current;
    const request = ++requests.current[kind];
    const isCurrent = () => ticket === lifecycle.current && request === requests.current[kind];
    pendingRequests.current[kind] = true;
    setError('');
    setPending((current) => ({ ...current, [kind]: true }));
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Device access requires a supported browser and a secure connection.');
      const stream = await controller.current.start(kind, (constraints) => navigator.mediaDevices.getUserMedia(constraints));
      if (stream && isCurrent()) setStreams((current) => ({ ...current, [kind]: stream }));
    } catch (cause) {
      if (isCurrent()) setError(cause.name === 'NotAllowedError' ? 'Device permission was denied. You can join, then enable devices when ready.' : cause.message || 'Device check failed. Check your browser settings and try again.');
    } finally {
      if (isCurrent()) {
        pendingRequests.current[kind] = false;
        setPending((current) => ({ ...current, [kind]: false }));
      }
    }
  };

  return (
    <section aria-label="Private device check" className="space-y-3 rounded-2xl bg-slate-900 p-3 ring-1 ring-slate-700">
      <div className="relative aspect-video overflow-hidden rounded-xl bg-slate-950">
        <video ref={video} autoPlay playsInline muted aria-label="Your private camera preview" className={`h-full w-full object-cover ${streams.camera ? '' : 'hidden'}`} />
        {!streams.camera && <div className="flex h-full items-center justify-center p-4 text-center text-sm text-slate-300">{pending.camera ? 'Waiting for camera permission…' : 'Camera preview is off'}</div>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!enabled} aria-pressed={Boolean(streams.camera)} onClick={() => toggle('camera')} className="rounded-lg bg-slate-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending.camera ? 'Cancel camera check' : streams.camera ? 'Stop camera preview' : 'Check camera'}</button>
        <button type="button" disabled={!enabled} aria-pressed={Boolean(streams.microphone)} onClick={() => toggle('microphone')} className="rounded-lg bg-slate-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending.microphone ? 'Cancel microphone check' : streams.microphone ? 'Stop microphone check' : 'Check microphone'}</button>
      </div>
      {streams.microphone && <div className="space-y-1 text-xs text-slate-200"><label htmlFor="conference-microphone-level">Speak to check your microphone. This check stops after 15 seconds.</label><meter id="conference-microphone-level" min="0" max="100" value={level} className="block h-3 w-full">{level}%</meter></div>}
      {streams.microphone && meterPaused && <button type="button" onClick={() => meterContext.current?.resume().catch(() => setError('The microphone meter could not resume. Stop the check and try again.'))} className="rounded-lg bg-blue-700 px-3 py-2 text-sm text-white">Resume microphone meter</button>}
      <p className="text-xs leading-relaxed text-slate-300">Optional device checks stay on this device and stop when you join. No audio is recorded or sent by this check.</p>
      {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
    </section>
  );
}
