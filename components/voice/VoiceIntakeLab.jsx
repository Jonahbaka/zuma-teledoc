'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import LiveVoicePrototype from './LiveVoicePrototype';
import GeminiPcmPrototype from './GeminiPcmPrototype';
import CameraPreviewPrototype from './CameraPreviewPrototype';
import { useAuth } from '@/components/providers/AuthProvider';
import { voiceLabRequest } from '@/lib/voice/voiceLabApi';
import { DOCUMENTED_GEMINI_LIVE_LANGUAGES } from '@/shared/voiceLanguageCatalog.cjs';
import { createSyntheticSessionController } from '@/lib/voice/syntheticSessionController.cjs';

const INPUTS = [['complaint', 'Report a headache'], ['duration', 'Say “yesterday”'], ['correction', 'Correct to “two days ago”'], ['medicines', 'No medicine taken'], ['help', 'Request an interpreter'], ['advice', 'Ask for medicine advice']];
const buttonClass = 'min-h-12 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40';

export default function VoiceIntakeLab() {
  const { user, loading } = useAuth();
  const userId = user?.id; const role = user?.role;
  const [capabilities, setCapabilities] = useState(null);
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [language, setLanguage] = useState('ha');
  const [liveLanguage, setLiveLanguage] = useState('ha');
  const [consent, setConsent] = useState(false);
  const [autoStream, setAutoStream] = useState(true);
  const controller = useRef(null);

  useEffect(() => {
    if (!userId || !['provider', 'admin', 'super_admin'].includes(role)) return;
    let active = true;
    setCapabilities(null); setSession(null); setConsent(false); setError('');
    const client = createSyntheticSessionController({ request: voiceLabRequest,
      onChange: (next, pending) => { if (active) { setSession(next); setBusy(pending); } },
      onError: () => { if (active) setError('The request could not be confirmed. Current session state was refreshed where available. No chart was changed.'); } });
    controller.current = client;
    voiceLabRequest('/capabilities').then(result => { if (active) setCapabilities(result.capabilities); }).catch(() => { if (active) setError('The synthetic voice lab could not be opened.'); });
    const stop = () => { void client.end(); };
    const visibility = () => { if (document.visibilityState === 'hidden') stop(); };
    window.addEventListener('pagehide', stop); document.addEventListener('visibilitychange', visibility);
    return () => {
      active = false; controller.current = null; void client.dispose();
      window.removeEventListener('pagehide', stop); document.removeEventListener('visibilitychange', visibility);
    };
  }, [userId, role]);

  useEffect(() => {
    if (!session?.activeOutputId || session.status !== 'active' || !autoStream || busy) return;
    const timer = setTimeout(() => { void controller.current?.command('advance_output'); }, 180);
    return () => clearTimeout(timer);
  }, [session, autoStream, busy]);

  useEffect(() => {
    if (!session) return;
    const timeout = setTimeout(() => { void controller.current?.end(); }, Math.max(0, session.expiresAt - Date.now()));
    return () => clearTimeout(timeout);
  }, [session]);

  function command(action, extra) { setError(''); void controller.current?.command(action, extra); }
  const inactive = !session || session.status !== 'active' || busy;
  const activeTurn = session?.turns.find(turn => turn.id === session.activeOutputId);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-sm font-bold uppercase tracking-widest text-teal-300">DoctaRx · Voice access</p><h1 className="mt-2 text-3xl font-semibold sm:text-4xl">A conversation, in your language.</h1><p className="mt-3 max-w-2xl text-slate-300">Global voice evaluation and fictional intake workflow lab. Explore language choices, interruptions and source-linked drafts.</p></div>
          <span className="rounded-full border border-amber-400/50 bg-amber-400/10 px-4 py-2 text-sm font-bold text-amber-200">Synthetic prototype</span>
        </header>
        <section className="rounded-2xl border border-amber-400/40 bg-amber-950/30 p-5 text-sm text-amber-100" aria-label="Prototype limits">
          <strong>The text rehearsal below has no microphone, audio playback or live AI connection.</strong> Its fictional fixtures are separate from the explicitly approved audio evaluation panels. The local-language examples are not native-speaker validated. Do not use this with patients. The text rehearsal accepts only fixed fictional replies and cannot import anything into a chart.
        </section>
        {userId && ['provider', 'admin', 'super_admin'].includes(role) && <section aria-label="Live conversation language" className="space-y-3 rounded-2xl bg-slate-900 p-5">
          <label className="grid gap-2 text-sm">Gemini conversation language<select value={liveLanguage} onChange={event => setLiveLanguage(event.target.value)} className="min-h-12 rounded-xl border border-slate-600 bg-slate-800 px-4 text-white"><optgroup label="Provider-documented Live languages">{DOCUMENTED_GEMINI_LIVE_LANGUAGES.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</optgroup><optgroup label="Experimental observation"><option value="ig">Igbo · spoken validation pending</option></optgroup></select></label>
          <p className="text-sm text-slate-300">Changing the language ends the previous audio session and requires fresh consent. This selection is separate from the fixed text rehearsal below.</p>
        </section>}
        {userId && <GeminiPcmPrototype userId={userId} role={role} language={liveLanguage} />}
        {userId && <LiveVoicePrototype userId={userId} role={role} language={language} />}
        {error && <p role="alert" className="rounded-xl bg-red-950 p-4 text-red-100">{error}</p>}
        {loading ? <p role="status">Checking your session…</p> : !user ? <p>Sign in as a clinician or administrator to try the lab. <Link className="underline" href="/provider/login">Clinician sign-in</Link></p> : !['provider', 'admin', 'super_admin'].includes(user.role) ? <p role="alert">This lab requires clinician or administrator access.</p> : !capabilities ? <p role="status">Loading the synthetic lab…</p> : !capabilities.enabled ? <p role="alert">The synthetic lab is disabled on this server.</p> : (
          <>
            <CameraPreviewPrototype userId={userId} role={role} language={language} />
            <section className="flex flex-wrap items-end gap-4 rounded-2xl bg-slate-900 p-5" aria-label="Session controls">
              <label className="grid gap-2 text-sm">Text rehearsal language<select value={language} disabled={!!session || busy} onChange={event => setLanguage(event.target.value)} className="min-h-12 rounded-xl border border-slate-600 bg-slate-800 px-4 text-white">{capabilities.languages.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
              {!session ? <><label className="flex max-w-md items-start gap-3 text-sm text-slate-200"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} className="mt-1 h-5 w-5 shrink-0" />I understand this is a fictional test, not patient consent or a clinical voice service.</label><button className={buttonClass} disabled={!consent || busy} onClick={() => { setError(''); void controller.current?.start(language, capabilities.noticeVersion); }}>Start synthetic conversation</button></> : <><button className={buttonClass} disabled={busy} onClick={() => command(session.status === 'paused' ? 'resume' : 'pause')}>{session.status === 'paused' ? 'Resume' : 'Pause'}</button><button className={buttonClass} onClick={() => { setConsent(false); void controller.current?.end(); }}>End and clear</button><button className={buttonClass} onClick={() => { setConsent(false); void controller.current?.end('revoke_consent'); }}>Withdraw demo consent</button><p role="status" className="text-sm text-teal-200">{session.status === 'paused' ? 'Paused' : activeTurn ? 'Streaming simulated text' : 'Ready for a fictional reply'} · microphone off</p></>}
            </section>
            {session && <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
              <section className="space-y-4 rounded-2xl bg-slate-900 p-5" aria-label="Conversation">
                <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Conversation rehearsal</h2><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={autoStream} onChange={event => setAutoStream(event.target.checked)} />Animate text</label></div>
                <div className="max-h-[32rem] space-y-3 overflow-y-auto" aria-label="Transcript">
                  {session.turns.map(turn => <article key={turn.id} className={`rounded-xl border p-4 ${turn.speaker === 'patient' ? 'border-teal-800 bg-teal-950/50' : 'border-slate-700 bg-slate-800'}`}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">{turn.speaker === 'patient' ? 'Fictional patient' : 'Simulated assistant'} · {turn.status}{turn.supersededBy ? ' · corrected below' : ''}</p>
                    <p lang={turn.language} className="mt-2 text-lg">{turn.speaker === 'assistant' ? turn.emittedText || '(No output emitted)' : turn.sourceText}</p>
                    {turn.speaker === 'patient' || turn.status === 'completed' ? <p className="mt-2 text-sm text-slate-300">English fixture: {turn.englishText}</p> : <p className="mt-2 text-sm text-amber-200">Partial simulation only. Full translation is not presented as delivered speech.</p>}
                    <p className="mt-2 text-xs text-slate-400">Unverified fixture · no recorded audio</p>
                  </article>)}
                </div>
                <div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={inactive || !activeTurn} onClick={() => command('interrupt')}>Interrupt output</button><button className={buttonClass} disabled={inactive || !activeTurn || autoStream} onClick={() => command('advance_output')}>Advance text</button></div>
                <p className="text-sm text-slate-300">Choose a fixed fictional reply. Replying during output cancels the old response immediately at the next server action.</p>
                <div className="grid gap-2 sm:grid-cols-2">{INPUTS.map(([fixtureId, label]) => <button key={fixtureId} className={buttonClass} disabled={inactive} onClick={() => command('fixture', { fixtureId })}>{label}</button>)}</div>
                {session.humanAssistanceRequested && <p role="status" className="rounded-xl border border-amber-600 p-3 text-amber-100">Human assistance requested in the rehearsal. No interpreter has been contacted.</p>}
              </section>
              <section className="space-y-4 rounded-2xl bg-slate-900 p-5" aria-label="Evidence review">
                <h2 className="text-xl font-semibold">Evidence → review</h2><p className="text-sm text-slate-300">Only the latest fictional patient statements become draft facts. Each fact retains its source turn. No diagnosis, treatment, chart import or signature is generated.</p>
                <button className={buttonClass} disabled={inactive || !session.turns.some(turn => turn.field)} onClick={() => command('prepare_draft')}>Prepare synthetic intake draft</button>
                {session.draft ? <div className="space-y-4"><p role="status" className="font-semibold text-teal-200">Draft: {session.draft.status.replaceAll('_', ' ')}</p><ul className="space-y-3">{session.draft.facts.map(fact => <li key={fact.sourceTurnId} className="rounded-xl bg-slate-800 p-4"><p className="text-xs uppercase text-slate-400">{fact.field.replaceAll('_', ' ')}</p><p className="mt-1">{fact.englishText}</p><p className="mt-2 break-all text-xs text-slate-400">Source turn: {fact.sourceTurnId}</p></li>)}</ul><p className="text-sm text-slate-300">Unanswered: {session.draft.missingFields.join(', ') || 'none in this fixed scenario'}</p><ul className="list-disc space-y-2 pl-5 text-sm text-amber-200">{session.draft.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul><div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={inactive || session.draft.status !== 'awaiting_demo_review'} onClick={() => command('review_draft', { draftId: session.draft.id, decision: 'reviewed_demo' })}>Mark demo review complete</button><button className={buttonClass} disabled={inactive || session.draft.status !== 'awaiting_demo_review'} onClick={() => command('review_draft', { draftId: session.draft.id, decision: 'rejected' })}>Reject draft</button></div><p className="text-xs text-slate-400">A demo review is not language verification or clinical approval.</p></div> : <p className="rounded-xl border border-dashed border-slate-700 p-6 text-slate-400">Your source-linked draft will appear here.</p>}
              </section>
            </div>}
          </>
        )}
      </div>
    </main>
  );
}
