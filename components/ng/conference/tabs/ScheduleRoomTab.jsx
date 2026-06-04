'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, Calendar, CheckCircle2, PlayCircle, Radio, Users } from 'lucide-react';
import { conf, KIND_OPTIONS } from '../conferenceApi';

const DEFAULT_ROOM_TITLE = 'Provider clinical meeting';

const ROOM_PRESETS = [
  {
    id: 'one_to_one',
    label: '1:1 consult',
    kind: 'consultation',
    max_participants: 2,
    media_server: 'livekit',
  },
  {
    id: 'live_consultation',
    label: '3-way consultation',
    kind: 'consultation',
    max_participants: 3,
    media_server: 'livekit',
  },
  {
    id: 'case_review',
    label: 'Case review',
    kind: 'case_conference',
    max_participants: 5,
    media_server: 'livekit',
  },
  {
    id: 'hospital_board',
    label: 'Hospital board',
    kind: 'board_review',
    max_participants: 10,
    media_server: 'livekit',
  },
  {
    id: 'small_peer_mesh',
    label: 'Small peer room',
    kind: 'consultation',
    max_participants: 3,
    media_server: 'peer_mesh',
  },
];

export default function ScheduleRoomTab() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetId = searchParams.get('preset');
  const [form, setForm] = useState({
    title: DEFAULT_ROOM_TITLE,
    kind: 'board_review',
    max_participants: 10,
    media_server: 'livekit',
    start_now: true,
    require_media_ready: true,
    requires_waiting_room: true,
    allow_chat: true,
    allow_private_dm: true,
    recording_enabled: false,
    scheduled_start: '',
    patient_name_snapshot: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(null);

  useEffect(() => {
    const preset = ROOM_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;

    setForm((current) => ({
      ...current,
      title: !current.title || current.title === DEFAULT_ROOM_TITLE ? preset.label : current.title,
      kind: preset.kind,
      max_participants: preset.max_participants,
      media_server: preset.media_server,
      start_now: true,
      require_media_ready: true,
    }));
  }, [presetId]);

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function applyPreset(preset) {
    setForm((current) => ({
      ...current,
      title: !current.title || current.title === DEFAULT_ROOM_TITLE ? preset.label : current.title,
      kind: preset.kind,
      max_participants: preset.max_participants,
      media_server: preset.media_server,
    }));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setErr('');
    setOk(null);
    try {
      const maxParticipants = Number(form.max_participants);
      const body = {
        ...form,
        max_participants: maxParticipants,
        media_server: form.media_server,
        require_media_ready: Boolean(form.start_now || form.require_media_ready),
        scheduled_start: form.start_now
          ? null
          : (form.scheduled_start ? new Date(form.scheduled_start).toISOString() : null),
      };
      delete body.start_now;

      const created = await conf.createRoom(body);
      let activeRoom = created.room;
      let started = false;

      if (form.start_now) {
        try {
          const startedRoom = await conf.startRoom(created.room.id);
          activeRoom = startedRoom.room;
          started = true;
        } catch (startErr) {
          setOk({ room: created.room, started: false });
          throw new Error(`Room created but media start failed: ${startErr.message}`);
        }
      }

      setOk({ room: activeRoom, started });
      setTimeout(() => router.push(`/ng/conference/${activeRoom.id}`), 600);
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  }

  const submitLabel = form.start_now ? 'Start meeting' : 'Schedule room';

  return (
    <form onSubmit={submit} className="max-w-3xl space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Meeting launcher</h2>
            <p className="mt-1 text-xs text-slate-500">Create a provider-led clinical room without an appointment.</p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            <Radio className="h-3.5 w-3.5" />
            {form.media_server}
          </span>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {ROOM_PRESETS.map((preset) => {
            const active =
              form.kind === preset.kind &&
              Number(form.max_participants) === preset.max_participants &&
              form.media_server === preset.media_server;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset)}
                className={`rounded-xl border px-3 py-3 text-left text-sm transition ${
                  active
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-900'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                }`}
              >
                <span className="block font-semibold">{preset.label}</span>
                <span className="mt-1 flex items-center gap-1 text-xs opacity-80">
                  <Users className="h-3.5 w-3.5" />
                  {preset.max_participants}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">Title</label>
        <input
          required
          value={form.title}
          onChange={(event) => setField('title', event.target.value)}
          placeholder="e.g. ICU morning review"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">Kind</label>
          <select
            value={form.kind}
            onChange={(event) => setField('kind', event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">Max participants</label>
          <input
            type="number"
            min="2"
            max="50"
            value={form.max_participants}
            onChange={(event) => setField('max_participants', event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">Media backend</label>
          <select
            value={form.media_server}
            onChange={(event) => setField('media_server', event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="livekit">LiveKit SFU</option>
            <option value="peer_mesh">Peer mesh</option>
          </select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">Scheduled start</label>
          <input
            type="datetime-local"
            value={form.scheduled_start}
            disabled={form.start_now}
            onChange={(event) => setField('scheduled_start', event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-400"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">Patient name</label>
          <input
            value={form.patient_name_snapshot}
            onChange={(event) => setField('patient_name_snapshot', event.target.value)}
            placeholder="Optional"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <fieldset className="rounded-xl border border-slate-200 bg-white p-4">
        <legend className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Room policies</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <Toggle label="Start immediately" value={form.start_now} onChange={(value) => setField('start_now', value)} />
          <Toggle label="Require media readiness" value={form.require_media_ready} onChange={(value) => setField('require_media_ready', value)} />
          <Toggle label="Waiting room" value={form.requires_waiting_room} onChange={(value) => setField('requires_waiting_room', value)} />
          <Toggle label="Group chat" value={form.allow_chat} onChange={(value) => setField('allow_chat', value)} />
          <Toggle label="Private messages" value={form.allow_private_dm} onChange={(value) => setField('allow_private_dm', value)} />
          <Toggle label="Recording metadata" value={form.recording_enabled} onChange={(value) => setField('recording_enabled', value)} />
        </div>
      </fieldset>

      {err && (
        <p className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <AlertCircle className="h-4 w-4" />
          {err}
        </p>
      )}
      {ok && (
        <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          {ok.started ? 'Room is live' : 'Room created'}: <span className="font-mono">{ok.room.room_code}</span>
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
      >
        {form.start_now ? <PlayCircle className="h-4 w-4" /> : <Calendar className="h-4 w-4" />}
        {busy ? 'Working...' : submitLabel}
      </button>
    </form>
  );
}

function Toggle({ label, value, onChange }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4"
      />
      {label}
    </label>
  );
}
