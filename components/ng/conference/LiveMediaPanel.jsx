'use client';

/**
 * components/ng/conference/LiveMediaPanel.jsx
 *
 * The media plane for multi-party conferencing. Mounts useConferenceSignaling
 * (which was previously implemented but never rendered by any component, so no
 * participant ever exchanged media) and renders local + remote video tiles with
 * mic/camera controls and a leave action.
 *
 * Mesh topology: each participant holds one RTCPeerConnection per peer. The hook
 * already relays offer/answer/ICE through the socket.io conference namespace and
 * surfaces remote MediaStreams keyed by socketId. Audio-only clients (low
 * bandwidth / no camera — common on Nigerian mobile networks) render as an
 * avatar tile and still exchange audio.
 */

import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Loader2, AlertCircle, Users, ServerCrash } from 'lucide-react';
import { useConferenceSignaling } from './useConferenceSignaling';

function VideoTile({ stream, label, muted = false, isSelf = false }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && stream) ref.current.srcObject = stream;
  }, [stream]);

  const hasVideo = stream && stream.getVideoTracks().some(t => t.enabled && t.readyState === 'live');

  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-slate-900 ring-1 ring-slate-700">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted || isSelf}
        className={`h-full w-full object-cover ${hasVideo ? '' : 'hidden'}`}
      />
      {!hasVideo && (
        <div className="flex h-full w-full items-center justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-700 text-lg font-bold text-slate-200">
            {(label || '?').slice(0, 1).toUpperCase()}
          </div>
        </div>
      )}
      <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
        {label}{isSelf ? ' (you)' : ''}
      </span>
    </div>
  );
}

export default function LiveMediaPanel({ roomId, displayName = 'Participant', active = true }) {
  const { phase, error, self, peers, streams, localStream, setMute } =
    useConferenceSignaling({ roomId, enabled: active, displayName });

  const [audioMuted, setAudioMuted] = useState(false);
  const [videoMuted, setVideoMuted] = useState(false);
  const [left, setLeft] = useState(false);

  const toggleAudio = () => { const n = !audioMuted; setAudioMuted(n); setMute('audio', n); };
  const toggleVideo = () => { const n = !videoMuted; setVideoMuted(n); setMute('video', n); };

  // Leaving unmounts the hook (enabled=false triggers cleanup: closes peer
  // connections, stops local tracks, emits conference:leave).
  if (left) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-sm font-semibold text-slate-700">You left the media session.</p>
        <button onClick={() => setLeft(false)} className="mt-3 rounded-lg bg-green-600 px-4 py-2 text-xs font-semibold text-white hover:bg-green-700">
          Rejoin media
        </button>
      </div>
    );
  }

  const remotePeers = peers.filter(p => p.socketId && p.socketId !== self?.socketId);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Users className="h-4 w-4 text-green-600" />
          Live media · {remotePeers.length + (self ? 1 : 0)} participant{remotePeers.length === 0 ? '' : 's'}
        </div>
        <div className="flex items-center gap-2 text-xs">
          {phase === 'connecting' && <span className="inline-flex items-center gap-1 text-amber-600"><Loader2 className="h-3.5 w-3.5 animate-spin" /> connecting…</span>}
          {phase === 'joined' && <span className="inline-flex items-center gap-1 text-emerald-600">● connected</span>}
          {phase === 'error' && <span className="inline-flex items-center gap-1 text-rose-600"><AlertCircle className="h-3.5 w-3.5" /> {error}</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <VideoTile stream={localStream} label={self?.name || displayName} isSelf />
        {remotePeers.map(p => (
          <VideoTile key={p.socketId} stream={streams[p.socketId]} label={p.name || p.role || 'Peer'} />
        ))}
      </div>

      {remotePeers.length === 0 && phase === 'joined' && (
        <p className="mt-3 text-center text-xs text-slate-400">Waiting for other participants to join the media session…</p>
      )}

      <div className="mt-4 flex items-center justify-center gap-3">
        <button onClick={toggleAudio} title={audioMuted ? 'Unmute' : 'Mute'}
          className={`flex h-11 w-11 items-center justify-center rounded-full ${audioMuted ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
          {audioMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </button>
        <button onClick={toggleVideo} title={videoMuted ? 'Start video' : 'Stop video'}
          className={`flex h-11 w-11 items-center justify-center rounded-full ${videoMuted ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
          {videoMuted ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
        </button>
        <button onClick={() => setLeft(true)} title="Leave media"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-600 text-white hover:bg-rose-700">
          <PhoneOff className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

export function UnsupportedSfuPanel({ room }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-amber-100 p-2 text-amber-700">
          <ServerCrash className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-amber-900">SFU media client not available</p>
          <p className="mt-1 text-sm text-amber-800">
            This room is configured for <code>{room?.media_server}</code> with up to {room?.max_participants} participants.
            The browser panel only supports peer mesh rooms of 3 participants or fewer.
          </p>
        </div>
      </div>
    </div>
  );
}
