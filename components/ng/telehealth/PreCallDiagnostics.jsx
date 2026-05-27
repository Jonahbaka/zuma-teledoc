'use client';

/**
 * components/ng/telehealth/PreCallDiagnostics.jsx
 * Run before joining a video consultation:
 *   1. browser capability
 *   2. microphone permission + level
 *   3. camera permission + preview
 *   4. downlink bandwidth probe
 *   5. recommended profile + "ready" gate
 *
 * Standalone — does not modify the existing useTelehealthSession flow.
 * Use the recommended profile when calling getUserMedia.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Mic, Video, Wifi, MonitorSmartphone, CheckCircle2, AlertTriangle,
  Loader2, RefreshCw,
} from 'lucide-react';

const STATES = { idle: 'idle', running: 'running', ok: 'ok', warn: 'warn', fail: 'fail' };

function StatusIcon({ state }) {
  if (state === STATES.ok)      return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (state === STATES.warn)    return <AlertTriangle className="h-4 w-4 text-amber-600" />;
  if (state === STATES.fail)    return <AlertTriangle className="h-4 w-4 text-rose-600" />;
  if (state === STATES.running) return <Loader2 className="h-4 w-4 animate-spin text-slate-400" />;
  return <span className="block h-4 w-4 rounded-full border-2 border-slate-300" />;
}

function Step({ icon: Icon, title, state, detail, children }) {
  const tone = {
    [STATES.ok]:      'border-emerald-200 bg-emerald-50',
    [STATES.warn]:    'border-amber-200 bg-amber-50',
    [STATES.fail]:    'border-rose-200 bg-rose-50',
    [STATES.running]: 'border-slate-200 bg-white',
    [STATES.idle]:    'border-slate-200 bg-white',
  }[state] || 'border-slate-200 bg-white';
  return (
    <div className={`rounded-xl border p-3 ${tone}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-slate-500" />
        <span className="text-sm font-bold text-slate-900">{title}</span>
        <span className="ml-auto"><StatusIcon state={state} /></span>
      </div>
      {detail && <p className="mt-1 text-xs text-slate-600">{detail}</p>}
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

export default function PreCallDiagnostics({ probeUrl = '/ng/net-probe-256k.bin', onReady }) {
  const [browser, setBrowser]   = useState({ state: STATES.idle, detail: '' });
  const [mic, setMic]           = useState({ state: STATES.idle, detail: '', level: 0 });
  const [cam, setCam]           = useState({ state: STATES.idle, detail: '' });
  const [net, setNet]           = useState({ state: STATES.idle, detail: '', kbps: null, label: 'unknown' });
  const [profile, setProfile]   = useState(null);
  const videoRef                = useRef(null);
  const audioCtxRef             = useRef(null);
  const animRef                 = useRef(null);

  useEffect(() => () => {
    // cleanup tracks
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
    if (animRef.current) cancelAnimationFrame(animRef.current);
    if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {});
  }, []);

  async function runAll() {
    await checkBrowser();
    await checkMic();
    await checkCam();
    await checkNet();
  }

  async function checkBrowser() {
    setBrowser({ state: STATES.running, detail: '' });
    const okWebRTC = typeof window !== 'undefined' && !!window.RTCPeerConnection;
    const okMedia  = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    const isMobile = /android|iphone|ipad/i.test(ua);
    if (okWebRTC && okMedia) {
      setBrowser({ state: STATES.ok, detail: `${isMobile ? 'Mobile' : 'Desktop'} browser supports WebRTC` });
    } else {
      setBrowser({ state: STATES.fail, detail: 'Browser missing WebRTC or getUserMedia — please update or switch browser.' });
    }
  }

  async function checkMic() {
    setMic({ state: STATES.running, detail: '', level: 0 });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const track = stream.getAudioTracks()[0];
      // hook up to AudioContext for live level
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        audioCtxRef.current = ctx;
        const buf = new Uint8Array(analyser.frequencyBinCount);
        const loop = () => {
          analyser.getByteFrequencyData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i];
          const avg = sum / buf.length / 255;
          setMic(m => ({ ...m, level: avg }));
          animRef.current = requestAnimationFrame(loop);
        };
        loop();
      } catch { /* analyser optional */ }
      setMic({ state: STATES.ok, detail: track?.label || 'Microphone OK', level: 0 });
      // stop tracks after 8s — just enough for the demo to show levels
      setTimeout(() => {
        track?.stop();
        if (animRef.current) cancelAnimationFrame(animRef.current);
      }, 8000);
    } catch (e) {
      setMic({ state: STATES.fail, detail: e.message || 'Microphone permission denied', level: 0 });
    }
  }

  async function checkCam() {
    setCam({ state: STATES.running, detail: '' });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings?.() || {};
      setCam({
        state: STATES.ok,
        detail: `${track?.label || 'Camera OK'} · ${settings.width || '?'}×${settings.height || '?'}`,
      });
      setTimeout(() => {
        stream.getTracks().forEach(t => t.stop());
        if (videoRef.current) videoRef.current.srcObject = null;
      }, 12000);
    } catch (e) {
      setCam({ state: STATES.fail, detail: e.message || 'Camera permission denied' });
    }
  }

  async function checkNet() {
    setNet({ state: STATES.running, detail: '', kbps: null, label: 'unknown' });
    try {
      // dynamically import to avoid SSR issues
      const mod = await import('@/lib/ng/networkQuality');
      const profiles = await import('@/lib/ng/videoProfiles');
      const { kbps, method, error } = await mod.estimateDownlinkKbps({ url: probeUrl });
      const { label, score } = mod.classify(kbps);
      const picked = profiles.pickProfile({
        kbps,
        userAgent: navigator.userAgent,
        isMobile: /android|iphone|ipad/i.test(navigator.userAgent),
      });
      setProfile(picked);
      if (kbps == null) {
        setNet({ state: STATES.warn, detail: `Bandwidth unknown (${error || 'no method'})`, kbps, label });
      } else if (score >= 3) {
        setNet({ state: STATES.ok, detail: `≈${kbps} kbps via ${method} · ${label}`, kbps, label });
      } else if (score === 2) {
        setNet({ state: STATES.warn, detail: `≈${kbps} kbps · poor — using ${picked.name} profile`, kbps, label });
      } else {
        setNet({ state: STATES.fail, detail: `≈${kbps} kbps · very poor — audio-only recommended`, kbps, label });
      }
    } catch (e) {
      setNet({ state: STATES.fail, detail: e.message, kbps: null, label: 'unknown' });
    }
  }

  const allGood = browser.state === STATES.ok && mic.state === STATES.ok && cam.state === STATES.ok && net.state !== STATES.fail;
  const audioOnlyRecommended = net.state === STATES.fail || net.label === 'very_poor';

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-black text-slate-900">Pre-call diagnostics</h1>
          <p className="text-xs text-slate-500">Check your device + connection before the consultation starts</p>
        </div>
        <button onClick={runAll}
          className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700">
          <RefreshCw className="h-4 w-4" />Run all checks
        </button>
      </header>

      <Step icon={MonitorSmartphone} title="Browser" state={browser.state} detail={browser.detail} />

      <Step icon={Mic} title="Microphone" state={mic.state} detail={mic.detail}>
        <div className="h-2 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full bg-emerald-500 transition-all"
               style={{ width: `${Math.min(100, Math.round(mic.level * 220))}%` }} />
        </div>
      </Step>

      <Step icon={Video} title="Camera" state={cam.state} detail={cam.detail}>
        <video ref={videoRef} muted playsInline
          className="aspect-video w-full rounded-lg bg-slate-900 object-cover" />
      </Step>

      <Step icon={Wifi} title="Bandwidth" state={net.state} detail={net.detail}>
        {profile && (
          <p className="text-xs text-slate-600">
            Recommended profile: <strong>{profile.name}</strong> ·
            {' '}{profile.width.ideal}×{profile.height.ideal} @ {profile.frameRate.ideal}fps ·
            {' '}target {profile.targetBitrateKbps} kbps
          </p>
        )}
      </Step>

      {(allGood || audioOnlyRecommended) && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
          <button
            disabled={!allGood && !audioOnlyRecommended}
            onClick={() => onReady?.({ profile, audioOnly: audioOnlyRecommended })}
            className="flex items-center gap-2 rounded-lg bg-green-600 px-5 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-50">
            <CheckCircle2 className="h-4 w-4" />
            {audioOnlyRecommended ? 'Join with audio only' : 'Join consultation'}
          </button>
          {audioOnlyRecommended && (
            <p className="text-xs text-amber-700">
              Network is too weak for video. You can still join by audio, or wait for a better connection.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
