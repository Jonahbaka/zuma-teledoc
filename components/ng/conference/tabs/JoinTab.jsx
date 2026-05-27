'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, AlertCircle } from 'lucide-react';
import { conf } from '../conferenceApi';

export default function JoinTab() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const trimmed = code.trim().toUpperCase();
      const out = await conf.getByCode(trimmed);
      router.push(`/ng/conference/${out.room.id}`);
    } catch (e) { setErr(e.message || 'Room not found'); }
    finally { setBusy(false); }
  }

  return (
    <div className="max-w-md space-y-4">
      <p className="text-sm text-slate-600">
        Enter the room code printed on the invite (format <span className="font-mono">CONF-YYYY-XXXXXX</span>) or paste a public invite token to redeem.
      </p>

      <form onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">Room code</label>
        <input
          value={code}
          onChange={e => setCode(e.target.value)}
          placeholder="CONF-2026-AB12CD"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm uppercase"
          required
        />
        {err && (
          <p className="flex items-center gap-2 text-sm text-rose-700"><AlertCircle className="h-4 w-4" />{err}</p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          <LogIn className="h-4 w-4" />
          {busy ? 'Finding…' : 'Open room'}
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <p className="font-semibold text-slate-800">Have an invite link?</p>
        <p className="mt-1 text-slate-600">
          Open the link directly — it will redeem the invite and auto-join you at the configured role.
        </p>
      </div>
    </div>
  );
}
