'use client';
import { useEffect, useRef, useState } from 'react';
import { voiceLiveApi } from '@/lib/voice/voiceLiveApi';
import { createLiveWebRtcSession, mergeLiveCleanupConcerns, liveCleanupWarning } from '@/lib/voice/liveWebRtcSession.cjs';

export default function LiveVoicePrototype({ userId, role, language }) {
  const mounted = useRef(false);
  const cleanupConcernRef = useRef({});
  const [cleanupConcerns, setCleanupConcerns] = useState({});
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const audio = useRef(null); const transport = useRef(null); const generation = useRef(0);
  const [capability, setCapability] = useState(null); const [status, setStatus] = useState('idle');
  const [consent, setConsent] = useState(false); const [error, setError] = useState(''); const [captions, setCaptions] = useState([]);
  useEffect(() => {
    if (!userId || !['provider', 'admin', 'super_admin'].includes(role)) return;
    let active = true; const generationRef = generation; generationRef.current++; setCapability(null); setConsent(false); setCaptions([]); setStatus('idle');
    voiceLiveApi.capabilities().then(result => { if (active) setCapability(result.capabilities); }).catch(() => { if (active) setError('Live provider configuration is unavailable.'); });
    return () => { active = false; generationRef.current++; void transport.current?.stop(); transport.current = null; };
  }, [userId, role, language]);
  useEffect(() => {
    const stop = () => { void transport.current?.stop(); setConsent(false); setCaptions([]); };
    const hide = () => { if (document.visibilityState === 'hidden') stop(); };
    window.addEventListener('pagehide', stop); document.addEventListener('visibilitychange', hide);
    return () => { window.removeEventListener('pagehide', stop); document.removeEventListener('visibilitychange', hide); };
  }, []);
  async function start() {
    if (!capability?.enabled || !consent || cleanupConcernRef.current.permission || document.visibilityState === 'hidden' || transport.current && !['idle', 'stopped', 'failed'].includes(transport.current.getState())) return;
    const captured = ++generation.current;
    const current = () => captured === generation.current;
    setCaptions([]); setError('');
    const client = createLiveWebRtcSession({ broker: voiceLiveApi, mediaDevices: navigator.mediaDevices,
      PeerConnection: window.RTCPeerConnection, MediaStreamClass: window.MediaStream, audioElement: audio.current,
      onState: next => { if (current()) setStatus(next); }, onError: message => { if (current()) setError(message); },
      onCleanup: receipt => {
        cleanupConcernRef.current = mergeLiveCleanupConcerns(cleanupConcernRef.current, receipt, captured);
        if (mounted.current) setCleanupConcerns(cleanupConcernRef.current);
      }, onTranscript: fragment => { if (current()) setCaptions(items => [...items.slice(-99), fragment]); } });
    transport.current = client;
    await client.start({ language, consentVersion: capability.consentVersion, consentAcknowledged: consent });
  }
  const running = !['idle', 'stopped', 'failed'].includes(status);
  return <section className="space-y-3 rounded-2xl border border-teal-800 bg-slate-900 p-5" aria-label="Live audio prototype">
    <h2 className="text-xl font-semibold">Live audio integration</h2>
    <p className="text-sm text-slate-300">The microphone, WebRTC speaker stream and server session broker are implemented separately from the rehearsal. This build has no approved live provider connection, so live audio remains unavailable. No clinical use is permitted.</p>
    <p role="status" className="text-sm text-teal-200">{capability?.enabled ? `Synthetic evaluation connection: ${status}` : 'Live speech not connected or language-tested'}</p>
    {capability?.enabled && <><label className="flex gap-3 text-sm"><input type="checkbox" checked={consent} disabled={running} onChange={event => setConsent(event.target.checked)} />I consent to sending my microphone audio to OpenAI for this fictional language test. I will not share patient information.</label><div className="flex flex-wrap gap-3"><button className="min-h-12 rounded-lg bg-teal-700 p-3 disabled:opacity-40" disabled={running || !consent || cleanupConcerns.permission} onClick={start}>Start live synthetic test</button><button className="min-h-12 rounded-lg border p-3" disabled={!running} onClick={() => { void transport.current?.pause(); setConsent(false); setCaptions([]); }}>Stop microphone and end</button><button className="min-h-12 rounded-lg border p-3" disabled={!['listening', 'playback_paused', 'playback_blocked'].includes(status)} onClick={() => ['playback_paused', 'playback_blocked'].includes(status) ? void transport.current?.resumePlayback() : transport.current?.interruptPlayback()}>{['playback_paused', 'playback_blocked'].includes(status) ? 'Resume speaker' : 'Mute speaker now'}</button></div></>}
    <audio ref={audio} className="hidden" aria-hidden="true" />
    {liveCleanupWarning(cleanupConcerns) && <p role="alert" className="text-amber-200">{liveCleanupWarning(cleanupConcerns)}</p>}
    {error && <p role="alert" className="text-amber-200">{error}</p>}
    {captions.length > 0 && <div aria-label="Unverified live captions" className="max-h-40 overflow-auto text-sm">{captions.map((item, index) => <p key={index}>{item.speaker}: {item.text}</p>)}<p>Unverified fragments, not final turns or proof of what was heard.</p></div>}
  </section>;
}
