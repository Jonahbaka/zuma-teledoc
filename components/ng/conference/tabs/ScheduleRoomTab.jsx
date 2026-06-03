'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, AlertCircle, Calendar } from 'lucide-react';
import { conf, KIND_OPTIONS } from '../conferenceApi';

export default function ScheduleRoomTab() {
  const router = useRouter();
  const [form, setForm] = useState({
    title: '',
    kind: 'consultation',
    max_participants: 3,
    requires_waiting_room: true,
    allow_chat: true,
    allow_private_dm: true,
    recording_enabled: false,
    scheduled_start: '',
    patient_name_snapshot: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const [ok, setOk]     = useState(null);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(''); setOk(null);
    try {
      const body = {
        ...form,
        max_participants: Number(form.max_participants),
        scheduled_start: form.scheduled_start ? new Date(form.scheduled_start).toISOString() : null,
      };
      const out = await conf.createRoom(body);
      setOk(out.room);
      setTimeout(() => router.push(`/ng/conference/${out.room.id}`), 800);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-4">
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">Title</label>
        <input
          required
          value={form.title}
          onChange={e => set('title', e.target.value)}
          placeholder="e.g. Tumour board — case 042"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">Kind</label>
          <select
            value={form.kind}
            onChange={e => set('kind', e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">Max participants</label>
          <input
            type="number" min="2" max="50"
            value={form.max_participants}
            onChange={e => set('max_participants', e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-[11px] text-slate-500">
            Up to 3 uses peer mesh. 4+ requires configured SFU and TURN before the room can go live.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">Scheduled start (optional)</label>
          <input
            type="datetime-local"
            value={form.scheduled_start}
            onChange={e => set('scheduled_start', e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">Patient name (optional)</label>
          <input
            value={form.patient_name_snapshot}
            onChange={e => set('patient_name_snapshot', e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <fieldset className="rounded-xl border border-slate-200 bg-white p-4">
        <legend className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Room policies</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <Toggle label="Waiting room (admit gate)"    value={form.requires_waiting_room} onChange={v => set('requires_waiting_room', v)} />
          <Toggle label="Allow group chat"             value={form.allow_chat}            onChange={v => set('allow_chat', v)} />
          <Toggle label="Allow private DMs"            value={form.allow_private_dm}      onChange={v => set('allow_private_dm', v)} />
          <Toggle label="Recording enabled (metadata)" value={form.recording_enabled}     onChange={v => set('recording_enabled', v)} />
        </div>
      </fieldset>

      {err && (
        <p className="flex items-center gap-2 text-sm text-rose-700"><AlertCircle className="h-4 w-4" />{err}</p>
      )}
      {ok && (
        <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />Room created: <span className="font-mono">{ok.room_code}</span>. Redirecting…</p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
      >
        <Calendar className="h-4 w-4" />
        {busy ? 'Creating…' : 'Schedule room'}
      </button>
    </form>
  );
}

function Toggle({ label, value, onChange }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} className="h-4 w-4" />
      {label}
    </label>
  );
}
