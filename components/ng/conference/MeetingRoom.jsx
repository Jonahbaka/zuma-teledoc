'use client';

/**
 * MeetingRoom.jsx
 *
 * Full Zoom/Meet-grade telehealth conference room.
 *
 * State machine:
 *   lobby      → user sees camera preview and name input
 *   joining    → POST /join in progress
 *   waiting    → participant submitted but not yet admitted (polls for admission)
 *   meeting    → admitted, WebRTC signaling active
 *   left       → user left voluntarily (can rejoin)
 *   denied     → host denied the participant
 *   media-needed → room requires the adaptive media service but none is configured
 *
 * UI:
 *   Header     – room name, live badge, participant count, network quality
 *   Reconnect banner – shown when WebRTC connection is lost
 *   Video grid  – auto-layout: 1→full, 2→50/50, 3–4→2×2, 5+→3-col
 *   Screen share tile – rendered alongside camera tiles when active
 *   Control bar – mic, camera, screen share, hand raise, sidebar, end/leave
 *   Sidebar     – Participants (with waiting-room admit/deny for hosts) | Chat
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Mic, MicOff, Video, VideoOff, Monitor, MonitorOff, Hand,
  PhoneOff, Users, MessageSquare, Wifi, WifiOff, WifiLow,
  AlertTriangle, RefreshCw, Crown, Pin, PinOff, Send,
  UserCheck, UserX, Loader2, Radio,
} from 'lucide-react';
import { conf } from './conferenceApi';
import { useConferenceSignaling } from './useConferenceSignaling';
import LiveKitMediaPanel from './LiveKitMediaPanel';

// ─── helpers ─────────────────────────────────────────────────────────────────

function initials(name) {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0] || '')
    .join('')
    .toUpperCase() || '?';
}

function gridCols(n) {
  if (n <= 1) return 'grid-cols-1';
  if (n <= 2) return 'grid-cols-2';
  if (n <= 4) return 'grid-cols-2';
  return 'grid-cols-3';
}

// ─── VideoTile ────────────────────────────────────────────────────────────────

function VideoTile({ stream, label, isSelf, audioMuted, handRaised, pinned, onPin, quality }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream || null;
  }, [stream]);

  const hasVideo = Boolean(
    stream && stream.getVideoTracks().some((t) => t.enabled && t.readyState === 'live')
  );

  const qualityIcon = {
    good: <Wifi   className="h-3 w-3 text-emerald-400" />,
    fair: <WifiLow className="h-3 w-3 text-amber-400" />,
    poor: <WifiOff className="h-3 w-3 text-rose-400" />,
  }[quality] || null;

  return (
    <div
      className={`group relative flex overflow-hidden rounded-xl bg-slate-900 ${
        pinned ? 'ring-2 ring-emerald-500' : ''
      }`}
      style={{ minHeight: '120px' }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isSelf}
        className={`h-full w-full object-cover ${hasVideo ? '' : 'hidden'}`}
      />

      {!hasVideo && (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-600 text-xl font-bold text-slate-100">
            {initials(label)}
          </div>
        </div>
      )}

      {/* Name / status bar */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2">
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-xs font-semibold text-white drop-shadow">
            {label}
            {isSelf ? ' (you)' : ''}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            {audioMuted && <MicOff className="h-3 w-3 text-rose-400" />}
            {handRaised && <Hand   className="h-3 w-3 text-amber-400" />}
            {qualityIcon}
          </div>
        </div>
      </div>

      {/* Pin button on hover */}
      {onPin && (
        <button
          onClick={onPin}
          title={pinned ? 'Unpin' : 'Pin'}
          className="absolute right-1.5 top-1.5 hidden rounded-md bg-black/60 p-1 text-white hover:bg-black/80 group-hover:block"
        >
          {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
  );
}

// ─── VideoGrid ────────────────────────────────────────────────────────────────

function VideoGrid({
  localStream, localName, audioMuted,
  remotePeers, streams,
  screenStream, isScreenSharing,
  pinnedId, onPin,
  connectionQuality,
}) {
  const tiles = [];

  if (isScreenSharing && screenStream) {
    tiles.push({ id: 'screen', stream: screenStream, label: 'Your screen', isSelf: true });
  }
  tiles.push({ id: 'self', stream: localStream, label: localName, isSelf: true, audioMuted });
  for (const p of remotePeers) {
    tiles.push({
      id:     p.socketId,
      stream: streams[p.socketId] || null,
      label:  p.name || p.role || 'Peer',
      isSelf: false,
      audioMuted: false,
      handRaised: !!p.hand_raised_at,
    });
  }

  const pinned = tiles.find((t) => t.id === pinnedId);
  const rest   = tiles.filter((t) => t.id !== pinnedId);

  if (pinned) {
    return (
      <div className="flex h-full gap-2">
        <div className="flex-1 overflow-hidden rounded-xl">
          <VideoTile
            {...pinned}
            pinned
            onPin={() => onPin(pinned.id)}
            quality={pinned.isSelf ? connectionQuality : null}
          />
        </div>
        {rest.length > 0 && (
          <div className="flex w-36 flex-col gap-2 overflow-y-auto">
            {rest.map((t) => (
              <VideoTile key={t.id} {...t} onPin={() => onPin(t.id)} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`grid ${gridCols(tiles.length)} h-full auto-rows-fr gap-2`}>
      {tiles.map((t) => (
        <VideoTile
          key={t.id}
          {...t}
          pinned={false}
          onPin={() => onPin(t.id)}
          quality={t.isSelf ? connectionQuality : null}
        />
      ))}
    </div>
  );
}

// ─── CtrlBtn ─────────────────────────────────────────────────────────────────

function CtrlBtn({ onClick, active, danger, label, badge, children, size = 'md', disabled }) {
  const dim    = size === 'sm' ? 'h-9 w-9' : 'h-11 w-11';
  const colour = danger
    ? 'bg-rose-600/20 text-rose-400 hover:bg-rose-600/30'
    : active
    ? 'bg-slate-700 text-white hover:bg-slate-600'
    : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`relative ${dim} flex items-center justify-center rounded-xl transition disabled:opacity-40 ${colour}`}
    >
      {children}
      {badge > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[9px] font-bold text-white">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  );
}

// ─── ControlBar ──────────────────────────────────────────────────────────────

function ControlBar({
  audioMuted, videoMuted, isScreenSharing, handRaised, sidebarTab,
  onToggleAudio, onToggleVideo, onToggleScreenShare, onToggleHand,
  onOpenSidebar, onLeave, onEndRoom,
  isHost, participantCount, waitingCount, connectionQuality, unreadChat,
}) {
  const qIcon = {
    good: <Wifi    className="h-3.5 w-3.5 text-emerald-400" />,
    fair: <WifiLow className="h-3.5 w-3.5 text-amber-400"   />,
    poor: <WifiOff className="h-3.5 w-3.5 text-rose-400"    />,
  }[connectionQuality] || <Wifi className="h-3.5 w-3.5 text-slate-500" />;

  return (
    <div className="flex items-center justify-between gap-2 border-t border-slate-800 bg-slate-950 px-4 py-3">
      {/* Left: status */}
      <div className="flex min-w-0 items-center gap-2 text-xs text-slate-400">
        <span className="hidden items-center gap-1 sm:flex">
          {qIcon}
          {connectionQuality && <span className="capitalize">{connectionQuality}</span>}
        </span>
        <span className="flex items-center gap-1">
          <Radio className="h-3.5 w-3.5 text-emerald-500" />
          {participantCount}
        </span>
        {waitingCount > 0 && (
          <button
            onClick={() => onOpenSidebar('participants')}
            className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-400 hover:bg-amber-500/30"
          >
            {waitingCount} waiting
          </button>
        )}
      </div>

      {/* Centre: media controls */}
      <div className="flex items-center gap-2">
        <CtrlBtn
          onClick={onToggleAudio}
          active={!audioMuted}
          danger={audioMuted}
          label={audioMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          {audioMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </CtrlBtn>

        <CtrlBtn
          onClick={onToggleVideo}
          active={!videoMuted}
          danger={videoMuted}
          label={videoMuted ? 'Start video' : 'Stop video'}
        >
          {videoMuted ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
        </CtrlBtn>

        <CtrlBtn
          onClick={onToggleScreenShare}
          active={isScreenSharing}
          label={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
        >
          {isScreenSharing ? <MonitorOff className="h-5 w-5" /> : <Monitor className="h-5 w-5" />}
        </CtrlBtn>

        <CtrlBtn
          onClick={onToggleHand}
          active={handRaised}
          label={handRaised ? 'Lower hand' : 'Raise hand'}
        >
          <Hand className="h-5 w-5" />
        </CtrlBtn>

        {/* Leave / End */}
        {isHost ? (
          <button
            onClick={onEndRoom}
            className="ml-2 flex h-11 items-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-bold text-white hover:bg-rose-700"
          >
            <PhoneOff className="h-4 w-4" />
            <span className="hidden sm:inline">End room</span>
          </button>
        ) : (
          <button
            onClick={onLeave}
            title="Leave call"
            className="ml-2 flex h-11 w-11 items-center justify-center rounded-xl bg-rose-600 text-white hover:bg-rose-700"
          >
            <PhoneOff className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Right: sidebar toggles */}
      <div className="flex items-center gap-1">
        <CtrlBtn
          onClick={() => onOpenSidebar('chat')}
          active={sidebarTab === 'chat'}
          label="Chat"
          size="sm"
          badge={sidebarTab !== 'chat' ? unreadChat : 0}
        >
          <MessageSquare className="h-4 w-4" />
        </CtrlBtn>
        <CtrlBtn
          onClick={() => onOpenSidebar('participants')}
          active={sidebarTab === 'participants'}
          label="Participants"
          size="sm"
          badge={sidebarTab !== 'participants' ? waitingCount : 0}
        >
          <Users className="h-4 w-4" />
        </CtrlBtn>
      </div>
    </div>
  );
}

// ─── DarkChatPanel ────────────────────────────────────────────────────────────

function DarkChatPanel({ roomId, room }) {
  const [messages,  setMessages]  = useState([]);
  const [text,      setText]      = useState('');
  const [sending,   setSending]   = useState(false);
  const scrollRef                 = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await conf.listChat(roomId, { limit: 100 });
        if (!cancelled) setMessages(r?.messages || []);
      } catch {}
    };
    load();
    const t = setInterval(load, 4000);
    return () => { cancelled = true; clearInterval(t); };
  }, [roomId]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send(e) {
    e?.preventDefault();
    const msg = text.trim();
    if (!msg) return;
    setSending(true);
    try {
      await conf.sendChat(roomId, { message: msg });
      setText('');
      const r = await conf.listChat(roomId, { limit: 100 });
      setMessages(r?.messages || []);
    } catch (err) {
      alert(err.message);
    } finally {
      setSending(false);
    }
  }

  const disabled = !room?.allow_chat;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="text-center text-xs text-slate-500">No messages yet.</p>
        )}
        {messages.map((m, i) => (
          <div key={m.id || i}>
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold text-slate-300">
                {m.sender_display || 'Participant'}
              </span>
              <span className="text-[10px] text-slate-500">
                {m.created_at ? new Date(m.created_at).toLocaleTimeString() : ''}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">{m.message}</p>
          </div>
        ))}
        <div ref={scrollRef} />
      </div>

      <form onSubmit={send} className="border-t border-slate-800 p-2">
        <div className="flex gap-1.5">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }}
            disabled={disabled || sending}
            placeholder={disabled ? 'Chat is disabled' : 'Message everyone…'}
            className="flex-1 rounded-lg bg-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={disabled || sending || !text.trim()}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── ParticipantsSidebar ──────────────────────────────────────────────────────

function ParticipantsSidebar({ roomId, participants, isHost }) {
  const [busy, setBusy] = useState(null);
  const [list, setList] = useState(participants);

  useEffect(() => { setList(participants); }, [participants]);

  async function doAction(key, fn) {
    setBusy(key);
    try {
      await fn();
      const r = await conf.listParticipants(roomId);
      setList(r.participants || []);
    } catch (e) { alert(e.message); }
    finally { setBusy(null); }
  }

  const waiting  = list.filter((p) => p.status === 'waiting');
  const admitted = list.filter((p) => p.status === 'admitted');

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3">
      {waiting.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-400">
            Waiting room ({waiting.length})
          </p>
          {waiting.map((p) => (
            <div key={p.id} className="mb-2 flex items-center justify-between rounded-lg bg-amber-900/20 px-3 py-2">
              <span className="truncate text-xs text-amber-100">{p.display_name || 'Guest'}</span>
              {isHost && (
                <div className="ml-2 flex shrink-0 gap-1">
                  <button
                    disabled={busy === `adm-${p.id}`}
                    onClick={() => doAction(`adm-${p.id}`, () => conf.admit(roomId, p.id))}
                    className="rounded-md bg-emerald-700 px-2 py-0.5 text-xs text-white hover:bg-emerald-600 disabled:opacity-50"
                    title="Admit"
                  >
                    <UserCheck className="h-3.5 w-3.5" />
                  </button>
                  <button
                    disabled={busy === `den-${p.id}`}
                    onClick={() => doAction(`den-${p.id}`, () => conf.deny(roomId, p.id))}
                    className="rounded-md bg-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-600 disabled:opacity-50"
                    title="Deny"
                  >
                    <UserX className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div>
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
          In room ({admitted.length})
        </p>
        {admitted.map((p) => (
          <div key={p.id} className="mb-1.5 flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-800/50">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-bold text-slate-200">
              {initials(p.display_name)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span className="truncate text-xs font-semibold text-slate-200">
                  {p.display_name || 'Guest'}
                </span>
                {p.role === 'host' && <Crown className="h-3 w-3 shrink-0 text-purple-400" />}
              </div>
              <span className="text-[10px] capitalize text-slate-500">{p.role}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {p.muted_audio  && <MicOff className="h-3 w-3 text-rose-400"   />}
              {p.muted_video  && <VideoOff className="h-3 w-3 text-rose-400" />}
              {p.hand_raised_at && <Hand  className="h-3 w-3 text-amber-400" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MeetingRoom (main) ───────────────────────────────────────────────────────

export default function MeetingRoom({ room, me: initialMe, onLeft, onEnded }) {
  const [phase,          setPhase]          = useState('lobby');
  const [displayName,    setDisplayName]    = useState(initialMe?.display_name || '');
  const [myParticipant,  setMyParticipant]  = useState(initialMe || null);
  const [participants,   setParticipants]   = useState([]);
  const [audioMuted,     setAudioMuted]     = useState(false);
  const [videoMuted,     setVideoMuted]     = useState(false);
  const [handRaised,     setHandRaised]     = useState(false);
  const [pinnedId,       setPinnedId]       = useState(null);
  const [sidebarTab,     setSidebarTab]     = useState(null);
  const [unreadChat,     setUnreadChat]     = useState(0);
  const [joinError,      setJoinError]      = useState('');

  const lobbyVideoRef = useRef(null);
  const [lobbyStream, setLobbyStream] = useState(null);
  const isLiveKitRoom = String(room?.media_server || '').toLowerCase() === 'livekit';

  // Direct signaling stays available for small rooms. Adaptive-media rooms use the managed media client.
  const signalingEnabled = phase === 'meeting' && !isLiveKitRoom;
  const {
    phase:             sigPhase,
    error:             sigError,
    self,
    peers,
    streams,
    localStream,
    screenStream,
    isScreenSharing,
    connectionQuality,
    setMute,
    startScreenShare,
    stopScreenShare,
    reconnect,
  } = useConferenceSignaling({
    roomId:      room?.id,
    enabled:     signalingEnabled,
    displayName: displayName || 'Participant',
  });

  const isHost = myParticipant?.role === 'host' || myParticipant?.role === 'consultant';

  // ── Lobby camera preview ───────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'lobby') return;
    let stream = null;
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: false })
      .then((s) => {
        stream = s;
        setLobbyStream(s);
        if (lobbyVideoRef.current) lobbyVideoRef.current.srcObject = s;
      })
      .catch(() => {});
    return () => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      setLobbyStream(null);
    };
  }, [phase]);

  // ── Poll participants while in meeting or waiting ──────────────────────────
  useEffect(() => {
    if (phase !== 'meeting' && phase !== 'waiting') return;
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await conf.listParticipants(room.id);
        if (cancelled) return;
        setParticipants(r.participants || []);

        if (phase === 'waiting' && myParticipant?.id) {
          const me = (r.participants || []).find((p) => p.id === myParticipant.id);
          if (me?.status === 'admitted') setPhase('meeting');
          if (me?.status === 'denied' || me?.status === 'removed') setPhase('denied');
        }
      } catch {}
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(t); };
  }, [phase, room?.id, myParticipant?.id]);

  // ── Chat unread counter ───────────────────────────────────────────────────
  const chatMsgCountRef = useRef(0);
  useEffect(() => {
    if (phase !== 'meeting' || sidebarTab === 'chat') return;
    let cancelled = false;
    const check = async () => {
      try {
        const r = await conf.listChat(room?.id, { limit: 1 });
        const total = r?.total || (r?.messages?.length ?? 0);
        if (!cancelled && total > chatMsgCountRef.current) {
          setUnreadChat((n) => n + (total - chatMsgCountRef.current));
          chatMsgCountRef.current = total;
        }
      } catch {}
    };
    const t = setInterval(check, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, [phase, room?.id, sidebarTab]);

  useEffect(() => {
    if (sidebarTab === 'chat') setUnreadChat(0);
  }, [sidebarTab]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const joinMeeting = useCallback(async () => {
    if (!displayName.trim()) return;
    setJoinError('');
    setPhase('joining');
    try {
      const r = await conf.join(room.id, {
        display_name: displayName.trim(),
        role: initialMe?.role || undefined,
      });
      setMyParticipant(r.participant);
      if (r.participant?.status === 'admitted') {
        setPhase('meeting');
      } else {
        setPhase('waiting');
      }
    } catch (e) {
      setJoinError(e.message || 'Failed to join. Please try again.');
      setPhase('lobby');
    }
  }, [displayName, room?.id, initialMe?.role]);

  const toggleAudio = useCallback(() => {
    const next = !audioMuted;
    setAudioMuted(next);
    setMute('audio', next);
  }, [audioMuted, setMute]);

  const toggleVideo = useCallback(() => {
    const next = !videoMuted;
    setVideoMuted(next);
    setMute('video', next);
  }, [videoMuted, setMute]);

  const toggleScreenShare = useCallback(() => {
    if (isScreenSharing) stopScreenShare(); else startScreenShare();
  }, [isScreenSharing, startScreenShare, stopScreenShare]);

  const toggleHand = useCallback(async () => {
    const raised = !handRaised;
    setHandRaised(raised);
    try {
      if (myParticipant?.id) await conf.hand(room.id, myParticipant.id, raised);
    } catch {}
  }, [handRaised, myParticipant?.id, room?.id]);

  const handleLeave = useCallback(() => {
    setPhase('left');
    onLeft?.();
  }, [onLeft]);

  const handleEndRoom = useCallback(async () => {
    if (!confirm('End this room for all participants?')) return;
    try {
      await conf.endRoom(room.id);
      setPhase('ended');
      onEnded?.();
    } catch (e) { alert(e.message); }
  }, [room?.id, onEnded]);

  const openSidebar = useCallback((tab) => {
    setSidebarTab((prev) => (prev === tab ? null : tab));
  }, []);

  const handlePin = useCallback((id) => {
    setPinnedId((prev) => (prev === id ? null : id));
  }, []);

  const remotePeers = peers.filter((p) => p.socketId !== self?.socketId);
  const waitingCount = participants.filter((p) => p.status === 'waiting').length;

  // ── Render: Lobby ──────────────────────────────────────────────────────────
  if (phase === 'lobby' || phase === 'joining') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-900/40">
              <Video className="h-6 w-6 text-emerald-400" />
            </div>
            <h2 className="text-xl font-black text-white">{room?.title || 'Conference Room'}</h2>
            <p className="mt-1 text-sm text-slate-400">
              {room?.kind?.replace(/_/g, ' ')} · up to {room?.max_participants} participants
            </p>
          </div>

          {/* Camera preview */}
          <div className="relative aspect-video overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-slate-700">
            <video ref={lobbyVideoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
            {!lobbyStream && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                <VideoOff className="h-10 w-10 text-slate-600" />
                <p className="text-xs text-slate-500">Camera unavailable</p>
              </div>
            )}
            <div className="absolute bottom-2 left-2 rounded-lg bg-black/60 px-2 py-1 text-xs font-semibold text-white">
              {displayName || 'You'}
            </div>
          </div>

          {/* Display name */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-300">
              Your display name
            </label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') joinMeeting(); }}
              placeholder="e.g. Dr. Amina Okafor"
              className="w-full rounded-xl bg-slate-800 px-4 py-3 text-sm text-white placeholder-slate-500 ring-1 ring-slate-700 focus:outline-none focus:ring-emerald-500"
            />
          </div>

          {joinError && (
            <p className="rounded-xl bg-rose-900/30 px-4 py-2.5 text-sm text-rose-300">{joinError}</p>
          )}

          {/* Managed media notice */}
          {isLiveKitRoom && (
            <div className="rounded-xl bg-emerald-900/20 px-4 py-3 text-xs text-emerald-300">
              <strong>Adaptive media:</strong> Joining connects through the managed clinical media service for multi-party audio, video, screen share, and connection recovery.
            </div>
          )}

          <button
            onClick={joinMeeting}
            disabled={!displayName.trim() || phase === 'joining'}
            className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            {phase === 'joining' ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Joining…
              </span>
            ) : 'Join Now'}
          </button>
        </div>
      </div>
    );
  }

  // ── Render: Waiting ────────────────────────────────────────────────────────
  if (phase === 'waiting') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-8">
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-900/30">
            <Users className="h-8 w-8 text-amber-400" />
          </div>
          <h2 className="text-lg font-bold text-white">Waiting for admission</h2>
          <p className="mt-2 text-sm text-slate-400">
            The host will admit you shortly. Please wait…
          </p>
          <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking every few seconds…
          </div>
          <button
            onClick={() => setPhase('lobby')}
            className="mt-6 rounded-xl bg-slate-800 px-5 py-2 text-sm text-slate-300 hover:bg-slate-700"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Render: Denied ─────────────────────────────────────────────────────────
  if (phase === 'denied') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-8">
        <div className="max-w-sm text-center">
          <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-rose-400" />
          <h2 className="text-lg font-bold text-white">Access denied</h2>
          <p className="mt-2 text-sm text-slate-400">The host did not admit you to this room.</p>
          <button onClick={() => setPhase('lobby')} className="mt-6 rounded-xl bg-slate-800 px-5 py-2 text-sm text-slate-300 hover:bg-slate-700">
            Go back
          </button>
        </div>
      </div>
    );
  }

  // ── Render: Left ───────────────────────────────────────────────────────────
  if (phase === 'left') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-8">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-800">
            <PhoneOff className="h-8 w-8 text-slate-400" />
          </div>
          <h2 className="text-xl font-bold text-white">You left the meeting</h2>
          <p className="mt-2 text-sm text-slate-400">The room may still be active.</p>
          <button
            onClick={() => setPhase('lobby')}
            className="mt-6 rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-emerald-500"
          >
            Rejoin
          </button>
        </div>
      </div>
    );
  }

  // ── Render: Ended ──────────────────────────────────────────────────────────
  if (phase === 'ended') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-8">
        <div className="text-center">
          <h2 className="text-xl font-bold text-white">Room ended</h2>
          <p className="mt-2 text-sm text-slate-400">The host ended this conference.</p>
        </div>
      </div>
    );
  }

  // ── Render: Active meeting ─────────────────────────────────────────────────
  const admittedParticipantCount = participants.filter((p) => p.status === 'admitted').length;
  const participantCount = isLiveKitRoom
    ? Math.max(admittedParticipantCount, 1)
    : remotePeers.length + 1;

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-white">
      {/* ─ Header ─ */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-bold text-white">{room?.title || 'Conference'}</span>
          <span className="shrink-0 rounded-full bg-emerald-900/60 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
            LIVE
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>{participantCount} in room</span>
          {!isLiveKitRoom && sigPhase === 'connecting' && (
            <span className="flex items-center gap-1 text-amber-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> connecting…
            </span>
          )}
        </div>
      </div>

      {/* ─ Reconnect banner ─ */}
      {!isLiveKitRoom && sigPhase === 'error' && (
        <div className="shrink-0 flex items-center justify-between bg-rose-950/80 px-4 py-2.5 text-sm">
          <span className="flex items-center gap-2 text-rose-300">
            <WifiOff className="h-4 w-4" />
            {sigError || 'Connection lost'}
          </span>
          <button
            onClick={reconnect}
            className="flex items-center gap-1.5 rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-600"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reconnect
          </button>
        </div>
      )}

      {/* ─ Body: video + optional sidebar ─ */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Video area */}
        <div className="flex flex-1 flex-col overflow-hidden p-2">
          {/* Waiting room banner for host (when sidebar is closed) */}
          {isHost && waitingCount > 0 && !sidebarTab && (
            <button
              onClick={() => openSidebar('participants')}
              className="mb-2 shrink-0 flex items-center justify-between rounded-xl bg-amber-900/30 px-4 py-2.5 text-sm text-amber-300 hover:bg-amber-900/50"
            >
              <span className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                {waitingCount} participant{waitingCount !== 1 ? 's' : ''} waiting to join
              </span>
              <span className="text-xs font-semibold">Manage →</span>
            </button>
          )}

          {/* Video grid */}
          <div className="min-h-0 flex-1">
            {isLiveKitRoom ? (
              <LiveKitMediaPanel
                room={room}
                displayName={displayName || myParticipant?.display_name || 'Participant'}
                isHost={isHost}
                participantCount={participantCount}
                waitingCount={waitingCount}
                sidebarTab={sidebarTab}
                unreadChat={unreadChat}
                handRaised={handRaised}
                onToggleHand={toggleHand}
                onOpenSidebar={openSidebar}
                onLeave={handleLeave}
                onEndRoom={handleEndRoom}
              />
            ) : (
              <VideoGrid
                localStream={localStream}
                localName={displayName || self?.name || 'You'}
                audioMuted={audioMuted}
                remotePeers={remotePeers}
                streams={streams}
                screenStream={screenStream}
                isScreenSharing={isScreenSharing}
                pinnedId={pinnedId}
                onPin={handlePin}
                connectionQuality={connectionQuality}
              />
            )}
          </div>
        </div>

        {/* Sidebar */}
        {sidebarTab && (
          <div className="flex w-72 shrink-0 flex-col border-l border-slate-800 bg-slate-900">
            <div className="flex shrink-0 items-center border-b border-slate-800 px-3 py-2">
              <div className="flex flex-1 gap-1">
                <button
                  onClick={() => setSidebarTab('participants')}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    sidebarTab === 'participants'
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Users className="h-3.5 w-3.5" />
                  People
                  {waitingCount > 0 && (
                    <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-400">
                      {waitingCount}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setSidebarTab('chat')}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    sidebarTab === 'chat'
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  Chat
                </button>
              </div>
              <button
                onClick={() => setSidebarTab(null)}
                className="ml-1 rounded-md p-1 text-slate-500 hover:text-slate-300"
                aria-label="Close sidebar"
              >
                ✕
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              {sidebarTab === 'participants' && (
                <ParticipantsSidebar
                  roomId={room?.id}
                  participants={participants}
                  isHost={isHost}
                />
              )}
              {sidebarTab === 'chat' && (
                <DarkChatPanel roomId={room?.id} room={room} />
              )}
            </div>
          </div>
        )}
      </div>

      {/* ─ Control bar ─ */}
      {!isLiveKitRoom && (
        <ControlBar
          audioMuted={audioMuted}
          videoMuted={videoMuted}
          isScreenSharing={isScreenSharing}
          handRaised={handRaised}
          sidebarTab={sidebarTab}
          onToggleAudio={toggleAudio}
          onToggleVideo={toggleVideo}
          onToggleScreenShare={toggleScreenShare}
          onToggleHand={toggleHand}
          onOpenSidebar={openSidebar}
          onLeave={handleLeave}
          onEndRoom={handleEndRoom}
          isHost={isHost}
          participantCount={participantCount}
          waitingCount={waitingCount}
          connectionQuality={connectionQuality}
          unreadChat={unreadChat}
        />
      )}
    </div>
  );
}
