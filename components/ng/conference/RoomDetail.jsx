'use client';

/**
 * components/ng/conference/RoomDetail.jsx
 *
 * Entry point for a single conference room.
 *
 * When the room is live → renders the full-screen MeetingRoom (Zoom-grade UI).
 * When the room is scheduled / ended → renders the control-plane tab view
 * (participants, chat, invites, permissions).
 */

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Video, Play, StopCircle, XCircle, Hand, ArrowLeft, AlertCircle,
  Users, MessageSquare, Shield, Link as LinkIcon, RefreshCw, Copy, CheckCircle2,
} from 'lucide-react';
import { conf, statusBadge, fmtDateTime } from './conferenceApi';
import ParticipantsList from './ParticipantsList';
import ChatPanel       from './ChatPanel';
import PermissionsPanel from './PermissionsPanel';
import InvitePanel     from './InvitePanel';
import MeetingRoom     from './MeetingRoom';

const PANELS = [
  { id: 'participants', label: 'Participants', icon: Users        },
  { id: 'chat',         label: 'Chat',         icon: MessageSquare },
  { id: 'invites',      label: 'Invites',      icon: LinkIcon      },
  { id: 'permissions',  label: 'Permissions',  icon: Shield        },
];

export default function RoomDetail({ roomId }) {
  const router = useRouter();
  const [room,         setRoom]         = useState(null);
  const [participants, setParticipants] = useState([]);
  const [me,           setMe]           = useState(null);
  const [err,          setErr]          = useState('');
  const [loading,      setLoading]      = useState(true);
  const [panel,        setPanel]        = useState('participants');
  const [copied,       setCopied]       = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, ps] = await Promise.all([
        conf.getRoom(roomId),
        conf.listParticipants(roomId),
      ]);
      setRoom(r.room);
      setParticipants(ps.participants);
      const possibleMe =
        ps.participants.find((p) => p.user_id && p.user_id === r.room?.host_user_id) ||
        ps.participants.find((p) => p.role === 'host') ||
        null;
      setMe(possibleMe);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [roomId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  async function action(fn, label) {
    try { await fn(); await load(); }
    catch (e) { alert(`${label} failed: ${e.message}`); }
  }

  async function copyCode() {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.room_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  if (loading) return <p className="p-8 text-sm text-slate-500">Loading room…</p>;
  if (err)     return (
    <p className="flex items-center gap-2 p-8 text-sm text-rose-700">
      <AlertCircle className="h-4 w-4" /> {err}
    </p>
  );
  if (!room) return <p className="p-8 text-sm text-slate-500">Room not found.</p>;

  // ── Live room → full-screen meeting experience ─────────────────────────────
  if (room.status === 'live') {
    return (
      <MeetingRoom
        room={room}
        me={me}
        onLeft={() => router.push('/ng/conference')}
        onEnded={() => {
          load();          // refresh room state (will now show 'ended' tab view)
          router.push('/ng/conference');
        }}
        onChanged={load}
      />
    );
  }

  // ── Non-live: control-plane tab view ──────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-green-50/30">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <button
            onClick={() => router.push('/ng/conference')}
            className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to rooms
          </button>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="rounded-xl bg-green-600/10 p-2 text-green-700">
                  <Video className="h-5 w-5" />
                </div>
                <h1 className="truncate text-lg font-black text-slate-900">
                  {room.title || 'Untitled room'}
                </h1>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusBadge(room.status)}`}>
                  {room.status}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                <button
                  onClick={copyCode}
                  className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 font-mono hover:bg-slate-200"
                >
                  {room.room_code}
                  {copied
                    ? <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                    : <Copy className="h-3 w-3 text-slate-400" />}
                </button>
                <span>{room.kind}</span>
                <span>Up to {room.max_participants}</span>
                <span>media: adaptive</span>
                {room.scheduled_start && <span>start: {fmtDateTime(room.scheduled_start)}</span>}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={load}
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
                title="Refresh"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
              {!me && (
                <button
                  onClick={() => action(() => conf.join(roomId, { role: 'host', display_name: 'Host' }), 'Join')}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  Join as host
                </button>
              )}
              {me && (
                <button
                  onClick={() =>
                    action(() => conf.hand(roomId, me.id, !me.hand_raised_at), 'Hand')
                  }
                  className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    me.hand_raised_at
                      ? 'bg-amber-500 text-white'
                      : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                  }`}
                >
                  <Hand className="h-3.5 w-3.5" />
                  {me.hand_raised_at ? 'Lower hand' : 'Raise hand'}
                </button>
              )}
              {room.status === 'scheduled' && (
                <>
                  <button
                    onClick={() => action(() => conf.startRoom(room.id), 'Start')}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                  >
                    <Play className="h-3.5 w-3.5" /> Start meeting
                  </button>
                  <button
                    onClick={() =>
                      action(() => conf.cancelRoom(room.id, { reason: 'host cancelled' }), 'Cancel')
                    }
                    className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-300 hover:bg-rose-50"
                  >
                    <XCircle className="h-3.5 w-3.5" /> Cancel
                  </button>
                </>
              )}
              {room.status === 'ended' && (
                <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-500">
                  Room ended
                </span>
              )}
            </div>
          </div>
        </div>

        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-6 pb-2">
          {PANELS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setPanel(id)}
              className={`flex shrink-0 items-center gap-2 rounded-t-lg border-b-2 px-3 py-2 text-sm font-semibold transition ${
                panel === id
                  ? 'border-green-600 text-green-700'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>
      </header>

      {/* ── Info banner for scheduled rooms ─────────────────────────────────── */}
      {room.status === 'scheduled' && (
        <div className="mx-auto max-w-6xl px-6 pt-4">
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            <strong>Scheduled meeting</strong> - click <em>Start meeting</em> to open it for participants.
            Once started, the full meeting room UI will launch automatically.
          </div>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-6 py-6">
        {panel === 'participants' && (
          <ParticipantsList roomId={room.id} participants={participants} me={me} onChanged={load} />
        )}
        {panel === 'chat' && (
          <ChatPanel roomId={room.id} room={room} participants={participants} />
        )}
        {panel === 'invites' && (
          <InvitePanel roomId={room.id} />
        )}
        {panel === 'permissions' && (
          me
            ? <PermissionsPanel participant={me} />
            : <p className="text-sm text-slate-500">Join the room to see your effective permissions.</p>
        )}
      </main>

      <footer className="mx-auto max-w-6xl px-6 pb-8 text-[11px] text-slate-400">
        Clinical media mode and signaling are configured for this room.
      </footer>
    </div>
  );
}
