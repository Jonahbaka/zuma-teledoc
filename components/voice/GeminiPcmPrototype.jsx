'use client';
import { useEffect, useRef, useState } from 'react';
import { voicePcmApi } from '@/lib/voice/voicePcmApi';
import { subscribeAuthSession } from '@/lib/authSession';
import { GEMINI_LIVE_LANGUAGES, GEMINI_LIVE_LANGUAGE_CATALOG } from '@/shared/voiceLanguageCatalog.cjs';
import { createGeminiPcmSession } from '@/lib/voice/geminiPcmSession.cjs';
import { createPcmPanelController } from '@/lib/voice/pcmPanelController.cjs';

const buttonClass = 'min-h-12 rounded-xl border border-teal-700 px-4 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40';
const labels = { idle: 'Not started', authorizing: 'Checking current authorization', requesting_microphone: 'Waiting for microphone permission', listening: 'Audio test connected', speaker_paused: 'Speaker muted', stopped: 'Local stop requested', failed: 'Audio test unavailable' };
function Panel({ userId, role, language }) {
  const controller = useRef(null);
  const [state, setState] = useState(null);
  useEffect(() => {
    const browserSupported = window.location.protocol === 'https:' && window.isSecureContext === true
      && typeof window.WebSocket === 'function' && typeof window.AudioContext === 'function'
      && typeof window.AudioWorkletNode === 'function' && typeof navigator.mediaDevices?.getUserMedia === 'function';
    const panel = createPcmPanelController({ userId, role, language, browserSupported, loadCapabilities: voicePcmApi.capabilities,
      createSession: callbacks => createGeminiPcmSession({ ...callbacks, origin: window.location.origin,
        createSocket: (url, protocol) => new window.WebSocket(url, protocol), mediaDevices: navigator.mediaDevices,
        createContext: options => new window.AudioContext(options), createWorkletNode: (context, name, options) => new window.AudioWorkletNode(context, name, options),
        pageTarget: window, documentTarget: document }), onChange: setState });
    controller.current = panel; setState(panel.snapshot()); void panel.load();
    const stop = () => { void panel.stop(); };
    const hide = () => { if (document.visibilityState === 'hidden') stop(); };
    window.addEventListener('pagehide', stop); document.addEventListener('visibilitychange', hide);
    const unsubscribeAuth = subscribeAuthSession(() => {
      void panel.dispose();
      setState({ ...panel.snapshot(), capability: null, error: 'Your sign-in changed. Reopen the audio panel after the current account is confirmed.' });
    });
    return () => { unsubscribeAuth(); if (controller.current === panel) controller.current = null; void panel.dispose(); window.removeEventListener('pagehide', stop); document.removeEventListener('visibilitychange', hide); };
  }, [userId, role, language]);
  const phase = state?.phase || 'idle', running = !['idle', 'stopped', 'failed'].includes(phase);
  const ready = state?.capability?.enabled === true && state.browserSupported && state.allowed;
  const mediaReady = ['listening', 'speaker_paused'].includes(phase);
  const alert = [state?.error, state?.cleanupWarning].filter(Boolean).join(' ');
  return <section aria-label="Gemini fictional audio evaluation" className="space-y-4 rounded-2xl border border-teal-700 bg-slate-900 p-5">
    <h2 className="text-xl font-semibold">Two-way speech evaluation</h2>
    <p className="text-sm text-slate-300">Nonclinical, fictional audio only. This panel connects the microphone and speaker to Google Gemini Live when current server approvals permit it. Language choices follow the Gemini Live catalog and remain unvalidated for spoken quality or clinical use. Do not share patient information or seek medical advice.</p>
    <p className="text-sm text-amber-200">{GEMINI_LIVE_LANGUAGE_CATALOG.find(item => item.code === language)?.support === 'experimental_observation' ? 'Igbo is an experimental option from a typed-input playground observation, not a documented Live language or validated spoken result.' : 'Provider-documented language option. Native-speaker listening and device testing are still required.'}</p>
    <p className="text-sm text-slate-300">Live voice: Zephyr. Riko is a separate Nigerian-English narration reference and is not substituted into this conversation.</p>
    <p role="status" aria-label="Gemini audio status" className="text-sm text-teal-200">{state?.loading !== false ? 'Checking audio evaluation availability…' : !state?.capability?.enabled ? 'Audio evaluation disabled or not configured. No microphone or provider connection is started.' : !state.browserSupported ? 'This evaluation requires a supported browser on HTTPS. No microphone or provider connection is started.' : labels[phase] || 'Audio test in progress'}</p>
    {!running && <button className={buttonClass} disabled={state?.loading !== false} onClick={() => { void controller.current?.load(); }}>Check audio availability again</button>}
    {ready && <>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={state.consent} onChange={event => controller.current?.setConsent(event.target.checked)} className="mt-1 h-5 w-5 shrink-0" />I consent to sending my microphone audio to Google for this fictional language test. This is not patient consent. Unchecking ends the test and clears local captions.</label>
      <div className="flex flex-wrap gap-3">
        <button className={buttonClass} disabled={running || !state.consent} onClick={() => { void controller.current?.start(); }}>Start fictional audio test</button>
        <button className={buttonClass} disabled={!running && !state.consent} onClick={() => { void controller.current?.stop(); }}>Stop microphone and clear captions</button>
        <button className={buttonClass} disabled={!mediaReady} aria-pressed={state.microphonePaused} onClick={() => controller.current?.setMicrophonePaused(!state.microphonePaused)}>{state.microphonePaused ? 'Resume microphone' : 'Mute microphone'}</button>
        <button className={buttonClass} disabled={!mediaReady} aria-pressed={state.speakerPaused} onClick={() => { if (state.speakerPaused) void controller.current?.resumeSpeaker(); else controller.current?.pauseSpeaker(); }}>{state.speakerPaused ? 'Resume speaker' : 'Mute speaker'}</button>
      </div>
      <p className="text-xs text-slate-400">Permission is requested only after server authorization. Stop shuts down local audio first; it does not confirm provider retention, final usage or deletion. Audio quality, interruption and accent still require human testing.</p>
    </>}
    {alert && <p role="alert" className="text-sm text-amber-200">{alert}</p>}
    {state?.captions.length > 0 && <section aria-label="Provisional Gemini captions" className="max-h-56 space-y-2 overflow-y-auto rounded-xl bg-slate-950 p-4 text-sm"><h3 className="font-semibold">Unverified source-language fragments</h3>{state.captions.map((item, index) => <p key={index} lang={item.language}><span className="font-semibold">{item.speaker === 'user' ? 'Tester' : 'Assistant'}: </span>{item.text}</p>)}<p className="text-xs text-amber-200">Not final turns, translations, clinical evidence or proof of audio heard. Nothing is imported into a chart.</p></section>}
  </section>;
}
export default function GeminiPcmPrototype(props) {
  if (!props.userId || !['provider', 'admin', 'super_admin'].includes(props.role) || !Object.hasOwn(GEMINI_LIVE_LANGUAGES, props.language)) return null;
  // Replace the entire panel on authority/language change, never show another
  // account's captions while effect cleanup and the new capability read run.
  return <Panel key={JSON.stringify([props.userId, props.role, props.language])} {...props} />;
}
