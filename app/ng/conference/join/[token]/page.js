'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, CheckCircle2, AlertCircle, LogIn } from 'lucide-react';

export default function JoinInvitePage({ params }) {
  const router = useRouter();
  const [state, setState] = useState({ phase: 'loading', error: null, participant: null });

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/ng/conference/public/redeem-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ token: decodeURIComponent(params.token) }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.ok) {
          setState({ phase: 'error', error: body.error || `${res.status} ${res.statusText}` });
          return;
        }
        setState({ phase: 'ok', participant: body.participant });
        setTimeout(() => router.push(`/ng/conference/${body.participant.room_id}`), 1200);
      } catch (e) {
        setState({ phase: 'error', error: e.message });
      }
    })();
  }, [params.token, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-green-50/30 p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        {state.phase === 'loading' && (
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
