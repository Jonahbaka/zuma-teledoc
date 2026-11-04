'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { conf } from '@/components/ng/conference/conferenceApi';
import { Loader2, CheckCircle2, AlertCircle, LogIn } from 'lucide-react';

export default function JoinInvitePage({ params }) {
  const router = useRouter();
  const [state, setState] = useState({ phase: 'ready', error: null, participant: null });
  const busy = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    setState({ phase: 'ready', error: null, participant: null });
    return () => { generation.current += 1; };
  }, [params.token]);

  async function redeem() {
    if (busy.current) return;
    busy.current = true;
    const current = generation.current;
    setState({ phase: 'loading', error: null, participant: null });
    try {
      const body = await conf.redeemInvite(params.token);
      if (current !== generation.current) return;
      if (!body.ok || !body.participant?.room_id) {
        setState({ phase: 'error', error: body.error || 'The invitation could not be accepted.' });
      } else {
        setState({ phase: 'ok', participant: body.participant });
        router.replace(`/ng/conference/${body.participant.room_id}`);
      }
    } catch (error) {
      if (current === generation.current) setState(error.status === 401 ? { phase: 'signin', error: null, participant: null } : { phase: 'error', error: error.message });
    } finally { busy.current = false; }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-green-50/30 p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        {['ready', 'signin'].includes(state.phase) && (
          <>
            <h1 className="text-lg font-bold text-slate-900">Conference invitation</h1>
            <p className="mt-2 text-sm text-slate-600">Sign in to your DoctaRx account, then accept this invitation. It is not consumed until your membership is confirmed.</p>
            {state.phase === 'signin' && <p className="mt-2 text-sm text-slate-600">Open your usual patient or provider sign-in in another tab, then return here.</p>}
            <button onClick={redeem} className="mt-4 rounded-lg bg-green-700 px-4 py-2 text-white">Accept invitation</button>
          </>
        )}
        {state.phase === 'loading'  && (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-green-600" />
            <h1 className="mt-3 text-lg font-bold text-slate-900">Redeeming invite…</h1>
            <p className="mt-1 text-sm text-slate-500">One moment, verifying token and joining the room.</p>
          </>
        )}
        {state.phase === 'ok' && (
          <>
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
            <h1 className="mt-3 text-lg font-bold text-slate-900">You're in</h1>
            <p className="mt-1 text-sm text-slate-600">
              Joined as <strong>{state.participant.display_name}</strong> ({state.participant.role}).
              Status: {state.participant.status}.
            </p>
            <p className="mt-3 text-xs text-slate-400">Redirecting to the room…</p>
          </>
        )}
        {state.phase === 'error' && (
          <>
            <AlertCircle className="mx-auto h-8 w-8 text-rose-600" />
            <h1 className="mt-3 text-lg font-bold text-slate-900">Invite invalid</h1>
            <p className="mt-1 text-sm text-slate-600">{state.error}</p>
            <button
              onClick={() => router.push('/ng/conference')}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
            >
              <LogIn className="h-3.5 w-3.5" /> Go to conferencing
            </button>
          </>
        )}
      </div>
    </div>
  );
}
