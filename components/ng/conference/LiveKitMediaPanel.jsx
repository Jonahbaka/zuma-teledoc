'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Hand,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  Radio,
  RefreshCw,
  Users,
  Video,
  VideoOff,
  Wifi,
  WifiLow,
  WifiOff,
} from 'lucide-react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { conf } from './conferenceApi';
import { connectionQuality, createMediaSessionController } from '@/lib/ng/livekitMediaLifecycle.cjs';

const TRACK_SOURCES = Track?.Source || {};
const SCREEN_SOURCES = new Set([
  String(TRACK_SOURCES.ScreenShare || 'screen_share').toLowerCase(),
  String(TRACK_SOURCES.ScreenShareAudio || 'screen_share_audio').toLowerCase(),
]);

function initials(name) {
  return String(name || 'Participant')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || '?';
}

function compactUrl(value) {
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return value ? 'configured' : null;
  }
}

function getPublications(participant) {
  if (!participant?.trackPublications?.values) return [];
  return Array.from(participant.trackPublications.values());
}

function publicationKind(publication) {
  return String(
    publication?.kind ||
    publication?.track?.kind ||
    publication?.track?.mediaStreamTrack?.kind ||
    ''
  ).toLowerCase();
}

function publicationSource(publication) {
  return String(publication?.source || publication?.track?.source || '').toLowerCase();
}

function isAudioPublication(publication) {
  return publicationKind(publication) === 'audio';
}

function isVideoPublication(publication) {
  return publicationKind(publication) === 'video';
}

function isScreenPublication(publication) {
  const source = publicationSource(publication);
  return SCREEN_SOURCES.has(source) || source.includes('screen');
}

function isCameraPublication(publication) {
  const source = publicationSource(publication);
  return isVideoPublication(publication) && !source.includes('screen');
}

function participantName(participant, fallback) {
  return participant?.name || participant?.identity || fallback || 'Participant';
}

function networkTone(level) {
  const value = connectionQuality(level);
  if (value === 'excellent' || value === 'good') return { label: value, icon: <Wifi className="h-3.5 w-3.5 text-blue-400" /> };
  if (value === 'poor') return { label: 'poor', icon: <WifiLow className="h-3.5 w-3.5 text-amber-400" /> };
  if (value === 'lost') return { label: 'lost', icon: <WifiOff className="h-3.5 w-3.5 text-rose-400" /> };
  return { label: 'unknown', icon: <Wifi className="h-3.5 w-3.5 text-slate-500" /> };
}

function gridClass(count) {
  if (count <= 1) return 'grid-cols-1';
  if (count <= 4) return 'grid-cols-2';
  if (count <= 9) return 'grid-cols-3';
  return 'grid-cols-4';
}

function attachTrack(track, element) {
  if (!track || !element || typeof track.attach !== 'function') return () => {};
  track.attach(element);
  return () => {
    try { track.detach(element); } catch {}
    try { element.srcObject = null; } catch {}
  };
}

function VideoTrack({ track, muted, className }) {
  const ref = useRef(null);

  useEffect(() => attachTrack(track, ref.current), [track]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className={className}
      data-testid="livekit-video-track"
    />
  );
}

function AudioTrack({ track, muted }) {
  const ref = useRef(null);

  useEffect(() => attachTrack(track, ref.current), [track]);

  return <audio ref={ref} autoPlay muted={muted} data-testid="livekit-audio-track" />;
}

function ControlButton({ label, active, danger, disabled, badge, onClick, children }) {
  const tone = danger
    ? 'bg-rose-600/20 text-rose-300 hover:bg-rose-600/30'
    : active
    ? 'bg-slate-700 text-white hover:bg-slate-600'
    : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white';

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`relative flex h-11 w-11 items-center justify-center rounded-xl transition disabled:cursor-not-allowed disabled:opacity-45 ${tone}`}
    >
      {children}
      {badge > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[9px] font-bold text-white">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  );
}

function MediaTile({ tile, pinned, onPin }) {
  const { publication, participant, isLocal, type } = tile;
  const track = publication?.track || null;
  const muted = Boolean(publication?.isMuted);
  const label = participantName(participant, isLocal ? 'You' : 'Participant');
  const quality = networkTone(participant?.connectionQuality);
  const hasVideo = Boolean(track && !muted);

  return (
    <div
      className={`group relative min-h-[140px] overflow-hidden rounded-xl bg-slate-900 ${
        pinned ? 'ring-2 ring-blue-500' : ''
      }`}
    >
      {hasVideo ? (
        <VideoTrack
          track={track}
          muted={isLocal}
          className={`h-full w-full ${type === 'screen' ? 'object-contain' : 'object-cover'}`}
        />
      ) : (
        <div className="flex h-full min-h-[140px] w-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-950">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-700 text-xl font-bold text-slate-100">
            {initials(label)}
          </div>
        </div>
      )}

      {type === 'screen' && (
        <span className="absolute left-2 top-2 rounded-md bg-blue-500/90 px-2 py-1 text-[10px] font-bold uppercase text-white">
          Screen
        </span>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs font-semibold text-white">
            {label}{isLocal ? ' (you)' : ''}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {muted ? <VideoOff className="h-3.5 w-3.5 text-rose-300" /> : null}
            {quality.icon}
          </span>
        </div>
      </div>

      {onPin && (
        <button
          type="button"
          title={pinned ? 'Unpin participant' : 'Pin participant'}
          aria-label={`${pinned ? 'Unpin' : 'Pin'} ${label}${type === 'screen' ? ' screen' : ''}`}
          aria-pressed={pinned}
          onClick={onPin}
          className="absolute right-2 top-2 rounded-md bg-black/60 px-2 py-2 text-xs font-semibold text-white hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
        >
          {pinned ? 'Unpin' : 'Pin'}
        </button>
      )}
    </div>
  );
}

function buildTiles(livekitRoom) {
  if (!livekitRoom?.localParticipant) return [];
  const local = livekitRoom.localParticipant;
  const remotes = Array.from(livekitRoom.remoteParticipants?.values?.() || []);
  const participants = [local, ...remotes];
  const tiles = [];

  for (const participant of participants) {
    const isLocal = participant === local;
    const publications = getPublications(participant);
    for (const publication of publications.filter((item) => isVideoPublication(item) && isScreenPublication(item))) {
      tiles.push({
        id: `${participant.identity || 'local'}:screen:${publication.trackSid || publication.sid || tiles.length}`,
        type: 'screen',
        participant,
        publication,
        isLocal,
      });
    }
    const camera = publications.find((item) => isCameraPublication(item));
    tiles.push({
      id: `${participant.identity || 'local'}:camera`,
      type: 'camera',
      participant,
      publication: camera || null,
      isLocal,
    });
  }

  return tiles;
}

function buildAudioTracks(livekitRoom) {
  if (!livekitRoom) return [];
  const remotes = Array.from(livekitRoom.remoteParticipants?.values?.() || []);
  const tracks = [];
  for (const participant of remotes) {
    for (const publication of getPublications(participant)) {
      if (isAudioPublication(publication) && publication.track && !publication.isMuted) {
        tracks.push({
          id: `${participant.identity}:${publication.trackSid || publication.sid || tracks.length}`,
          track: publication.track,
        });
      }
    }
  }
  return tracks;
}

function countTracks(participants, predicate) {
  return participants.reduce((total, participant) => (
    total + getPublications(participant).filter((publication) => publication.track && predicate(publication)).length
  ), 0);
}

function buildDebugSnapshot({ livekitRoom, appRoom, livekitUrl, status, error }) {
  const local = livekitRoom?.localParticipant ? [livekitRoom.localParticipant] : [];
  const remotes = Array.from(livekitRoom?.remoteParticipants?.values?.() || []);
  return {
    provider: 'livekit',
    sfu: true,
    appRoomId: appRoom?.id || null,
    appRoomCode: appRoom?.room_code || null,
    livekitUrl: compactUrl(livekitUrl),
    status,
    connectionState: livekitRoom?.state || null,
    error: error || null,
    participantCount: local.length + remotes.length,
    local: {
      audio: countTracks(local, isAudioPublication),
      video: countTracks(local, isCameraPublication),
      screen: countTracks(local, isScreenPublication),
    },
    remote: {
      audio: countTracks(remotes, isAudioPublication),
      video: countTracks(remotes, isCameraPublication),
      screen: countTracks(remotes, isScreenPublication),
    },
  };
}

export default function LiveKitMediaPanel({
  room,
  displayName,
  isHost,
  participantCount,
  waitingCount,
  sidebarTab,
  unreadChat,
  handRaised,
  onToggleHand,
  onOpenSidebar,
  onLeave,
  onEndRoom,
}) {
  const sessionRef = useRef(null);
  const connectAttemptRef = useRef(0);
  const controlBusyRef = useRef(false);
  if (!sessionRef.current) sessionRef.current = createMediaSessionController();
  const [livekitRoom, setLivekitRoom] = useState(null);
  const [livekitUrl, setLivekitUrl] = useState('');
  const [status, setStatus] = useState('idle');
  const [connectionState, setConnectionState] = useState('disconnected');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [micEnabled, setMicEnabled] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [screenEnabled, setScreenEnabled] = useState(false);
  const [busyControl, setBusyControl] = useState('');
  const [pinnedId, setPinnedId] = useState(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [devices, setDevices] = useState([]);
  const [selectedDevices, setSelectedDevices] = useState({});

  const bump = useCallback(() => setRevision((value) => value + 1), []);

  const disconnect = useCallback(async () => {
    connectAttemptRef.current += 1;
    const closing = sessionRef.current.close();
    setLivekitRoom(null);
    setMicEnabled(false);
    setCameraEnabled(false);
    setScreenEnabled(false);
    setConnectionState('disconnected');
    setStatus('disconnected');
    setBusyControl('');
    controlBusyRef.current = false;
    setAudioBlocked(false);
    bump();
    await closing;
  }, [bump]);

  const connect = useCallback(async () => {
    if (!room?.id || !displayName?.trim()) return;
    const attempt = ++connectAttemptRef.current;
    setStatus('connecting');
    setConnectionState('connecting');
    setError('');
    setNotice('');

    setMicEnabled(false);
    setCameraEnabled(false);
    setScreenEnabled(false);
    setBusyControl('');
    controlBusyRef.current = false;
    setAudioBlocked(false);
    setLivekitRoom(null);
    setSelectedDevices({});

    try {
      const nextRoom = await sessionRef.current.connect({
        getToken: () => conf.getLiveKitToken(room.id, displayName.trim()),
        createRoom: () => new Room({
          adaptiveStream: true,
          dynacast: true,
          publishDefaults: {
            simulcast: true,
            stopMicTrackOnMute: true,
          },
          videoCaptureDefaults: {
            resolution: { width: 1280, height: 720, frameRate: 24 },
          },
        }),
        onRoom: (mediaRoom, tokenResponse, isCurrent) => {
          const refresh = () => {
            if (!isCurrent()) return;
            setMicEnabled(Boolean(mediaRoom.localParticipant.isMicrophoneEnabled));
            setCameraEnabled(Boolean(mediaRoom.localParticipant.isCameraEnabled));
            setScreenEnabled(Boolean(mediaRoom.localParticipant.isScreenShareEnabled));
            bump();
          };
          mediaRoom
            .on(RoomEvent.ConnectionStateChanged, (state) => {
              if (!isCurrent()) return;
              setConnectionState(state);
              if (state === 'connected') setStatus('connected');
              if (state === 'reconnecting' || state === 'signalReconnecting') setStatus('reconnecting');
              bump();
            })
            .on(RoomEvent.ParticipantConnected, refresh)
            .on(RoomEvent.ParticipantDisconnected, refresh)
            .on(RoomEvent.ConnectionQualityChanged, refresh)
            .on(RoomEvent.AudioPlaybackStatusChanged, () => {
              if (isCurrent()) setAudioBlocked(!mediaRoom.canPlaybackAudio);
            })
            .on(RoomEvent.TrackSubscribed, refresh)
            .on(RoomEvent.TrackUnsubscribed, refresh)
            .on(RoomEvent.TrackMuted, refresh)
            .on(RoomEvent.TrackUnmuted, refresh)
            .on(RoomEvent.LocalTrackPublished, refresh)
            .on(RoomEvent.LocalTrackUnpublished, refresh)
            .on(RoomEvent.Disconnected, () => {
              if (!isCurrent()) return;
              void sessionRef.current.close();
              setLivekitRoom(null);
              setConnectionState('disconnected');
              setStatus('disconnected');
              setError('The media connection ended. Retry to rejoin; your microphone and camera will remain off.');
              setMicEnabled(false);
              setCameraEnabled(false);
              setScreenEnabled(false);
              setBusyControl('');
              controlBusyRef.current = false;
              bump();
            });

          setLivekitRoom(mediaRoom);
          setLivekitUrl(tokenResponse.livekitUrl || '');
        },
      });
      if (!nextRoom || attempt !== connectAttemptRef.current || sessionRef.current.room !== nextRoom) return;
      setAudioBlocked(!nextRoom.canPlaybackAudio);
      setNotice('You joined with your microphone and camera off. Turn them on when you are ready.');
      setStatus('connected');
      setConnectionState(nextRoom.state || 'connected');
      bump();
    } catch (err) {
      if (attempt !== connectAttemptRef.current) return;
      setStatus('error');
      setConnectionState('disconnected');
      setError(err?.message || 'Media room connection failed.');
      setLivekitRoom(null);
      bump();
    }
  }, [bump, displayName, room?.id]);

  useEffect(() => {
    connect();
    return () => {
      connectAttemptRef.current += 1;
      void sessionRef.current.close();
    };
  }, [connect]);

  const tiles = buildTiles(livekitRoom);
  const audioTracks = buildAudioTracks(livekitRoom);
  const visibleParticipantCount = Math.max(
    Number(participantCount || 0),
    livekitRoom?.localParticipant ? 1 + Array.from(livekitRoom.remoteParticipants?.values?.() || []).length : 0
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__doctarxLiveKitDebug = buildDebugSnapshot({
      livekitRoom,
      appRoom: room,
      livekitUrl,
      status,
      error,
    });
  }, [error, livekitRoom, livekitUrl, revision, room, status]);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      // Enumerating never opens a permission prompt or starts capture.
      const available = await navigator.mediaDevices.enumerateDevices();
      setDevices(available.filter((device) => device.deviceId && ['audioinput', 'videoinput'].includes(device.kind)));
    } catch { /* Device selection is optional when the browser hides devices. */ }
  }, []);

  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices);
  }, [refreshDevices]);

  const runControl = useCallback(async (name, action) => {
    const activeRoom = sessionRef.current.room;
    if (!activeRoom || controlBusyRef.current) return;
    controlBusyRef.current = true;
    setBusyControl(name);
    await sessionRef.current.act(action, (mediaRoom) => {
      setMicEnabled(Boolean(mediaRoom.localParticipant.isMicrophoneEnabled));
      setCameraEnabled(Boolean(mediaRoom.localParticipant.isCameraEnabled));
      setScreenEnabled(Boolean(mediaRoom.localParticipant.isScreenShareEnabled));
      setNotice('');
      bump();
      refreshDevices();
    }, (err) => {
      setNotice(err?.message || 'Device action failed. Check browser permissions and try again.');
    });
    if (sessionRef.current.room === activeRoom) {
      controlBusyRef.current = false;
      setBusyControl('');
    }
  }, [bump, refreshDevices]);

  const toggleMic = () => runControl('mic', (mediaRoom) => (
    mediaRoom.localParticipant.setMicrophoneEnabled(!mediaRoom.localParticipant.isMicrophoneEnabled)
  ));
  const toggleCamera = () => runControl('camera', (mediaRoom) => (
    mediaRoom.localParticipant.setCameraEnabled(!mediaRoom.localParticipant.isCameraEnabled)
  ));
  const toggleScreenShare = () => runControl('screen', (mediaRoom) => (
    mediaRoom.localParticipant.setScreenShareEnabled(!mediaRoom.localParticipant.isScreenShareEnabled)
  ));
  const enableAudio = () => runControl('audio', async (mediaRoom) => {
    await mediaRoom.startAudio();
    if (sessionRef.current.room === mediaRoom) setAudioBlocked(!mediaRoom.canPlaybackAudio);
  });
  const changeDevice = (kind, deviceId) => runControl('device', async (mediaRoom) => {
    const switched = await mediaRoom.switchActiveDevice(kind, deviceId, Boolean(deviceId));
    if (!switched) throw new Error('That device could not be selected. Try another device.');
    if (sessionRef.current.room === mediaRoom) setSelectedDevices((current) => ({ ...current, [kind]: deviceId }));
  });

  const leave = useCallback(async () => {
    await disconnect();
    onLeave?.();
  }, [disconnect, onLeave]);

  const endRoom = useCallback(async () => {
    onEndRoom?.();
  }, [onEndRoom]);

  const currentNetwork = networkTone(livekitRoom?.localParticipant?.connectionQuality);
  const connected = connectionState === 'connected';
  const orderedTiles = [...tiles].sort((a, b) => Number(b.id === pinnedId) - Number(a.id === pinnedId));

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl bg-slate-950" data-testid="livekit-media-panel">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2 text-xs text-slate-400">
        <span className="inline-flex items-center gap-1">
          <Radio className="h-3.5 w-3.5 text-blue-400" />
          Adaptive media
        </span>
        <span className="inline-flex items-center gap-1">
          {currentNetwork.icon}
          <span className="capitalize">{currentNetwork.label}</span>
        </span>
        <span>{visibleParticipantCount} in room</span>
        <span>Video consultation</span>
      </div>

      {(status === 'connecting' || status === 'reconnecting') && (
        <div role="status" className="flex shrink-0 items-center gap-2 bg-amber-950/70 px-3 py-2 text-sm text-amber-200">
          <Loader2 className="h-4 w-4 animate-spin" />
          {status === 'reconnecting' ? 'Reconnecting media session...' : 'Connecting to the media server...'}
        </div>
      )}

      {error && (
        <div role="alert" className="flex shrink-0 items-center justify-between gap-3 bg-rose-950/80 px-3 py-2 text-sm text-rose-200">
          <span className="flex min-w-0 items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="truncate">{error}</span>
          </span>
          <button
            type="button"
            onClick={connect}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-600"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </button>
        </div>
      )}

      {notice && (
        <div role="status" className="flex shrink-0 items-center gap-2 bg-slate-900 px-3 py-2 text-xs text-slate-300">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-300" />
          {notice}
        </div>
      )}

      {audioBlocked && connected && (
        <div role="status" className="flex shrink-0 flex-wrap items-center gap-3 bg-blue-950 px-3 py-2 text-sm text-blue-100">
          <span>Your browser needs permission to play the call audio.</span>
          <button type="button" onClick={enableAudio} disabled={Boolean(busyControl)} className="rounded-lg bg-blue-600 px-3 py-2 font-semibold disabled:opacity-50">Enable call audio</button>
        </div>
      )}

      {connected && ['poor', 'lost'].includes(currentNetwork.label) && (
        <div role="status" className="flex shrink-0 flex-wrap items-center gap-3 bg-amber-950 px-3 py-2 text-sm text-amber-100">
          <span>Connection quality is {currentNetwork.label}. Turning off your camera reduces upload bandwidth. You can also use chat.</span>
          {cameraEnabled && <button type="button" disabled={Boolean(busyControl)} onClick={() => runControl('camera', (mediaRoom) => mediaRoom.localParticipant.setCameraEnabled(false))} className="rounded-lg bg-amber-800 px-3 py-2 font-semibold disabled:opacity-50">Turn off my video</button>}
        </div>
      )}

      <details className="shrink-0 border-b border-slate-800 px-3 py-2 text-xs text-slate-300">
        <summary className="cursor-pointer py-1 font-semibold">Microphone and camera settings</summary>
        <p className="my-2">Choose a device, then use the microphone or camera button to turn it on. Your camera tile is your preview. Device names may appear after you grant permission.</p>
        <div className="flex flex-wrap gap-3 pb-2">
          {['audioinput', 'videoinput'].map((kind) => (
            <label key={kind} className="flex min-w-0 flex-1 flex-col gap-1">
              {kind === 'audioinput' ? 'Microphone' : 'Camera'}
              <select value={selectedDevices[kind] || ''} onChange={(event) => changeDevice(kind, event.target.value)} disabled={!connected || Boolean(busyControl)} className="min-w-0 rounded-lg border border-slate-600 bg-slate-900 p-2 text-white disabled:opacity-50">
                <option value="">Browser default</option>
                {devices.filter((device) => device.kind === kind).map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${kind === 'audioinput' ? 'Microphone' : 'Camera'} ${index + 1}`}</option>)}
              </select>
            </label>
          ))}
        </div>
      </details>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {connected || tiles.length ? (
          <div className={`grid ${gridClass(tiles.length)} h-full auto-rows-fr gap-2`}>
            {orderedTiles.map((tile) => (
              <MediaTile
                key={tile.id}
                tile={tile}
                pinned={pinnedId === tile.id}
                onPin={() => setPinnedId((current) => current === tile.id ? null : tile.id)}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl bg-slate-900 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
            <div>
              <p className="font-semibold text-white">Preparing media room</p>
              <p className="mt-1 text-sm text-slate-400">{error ? 'Use Retry to reconnect to the room.' : 'Connecting with your camera and microphone off.'}</p>
            </div>
          </div>
        )}
        <div className="hidden">
          {audioTracks.map((item) => (
            <AudioTrack key={item.id} track={item.track} muted={false} />
          ))}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-slate-950 px-3 py-3">
        <div className="hidden min-w-0 items-center gap-2 text-xs text-slate-400 sm:flex">
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-blue-400' : 'bg-amber-400'}`} />
          <span className="truncate capitalize">{connectionState || status}</span>
          {waitingCount > 0 && (
            <button
              type="button"
              onClick={() => onOpenSidebar?.('participants')}
              className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/30"
            >
              {waitingCount} waiting
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <ControlButton
            label={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
            active={micEnabled}
            danger={!micEnabled}
            disabled={!connected || Boolean(busyControl)}
            onClick={toggleMic}
          >
            {micEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
          </ControlButton>

          <ControlButton
            label={cameraEnabled ? 'Stop camera' : 'Start camera'}
            active={cameraEnabled}
            danger={!cameraEnabled}
            disabled={!connected || Boolean(busyControl)}
            onClick={toggleCamera}
          >
            {cameraEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
          </ControlButton>

          <ControlButton
            label={screenEnabled ? 'Stop screen share' : 'Share screen'}
            active={screenEnabled}
            disabled={!connected || Boolean(busyControl)}
            onClick={toggleScreenShare}
          >
            {screenEnabled ? <MonitorOff className="h-5 w-5" /> : <Monitor className="h-5 w-5" />}
          </ControlButton>

          <ControlButton
            label={handRaised ? 'Lower hand' : 'Raise hand'}
            active={handRaised}
            disabled={!connected}
            onClick={onToggleHand}
          >
            <Hand className="h-5 w-5" />
          </ControlButton>

          {isHost ? (
            <button
              type="button"
              aria-label="End room for everyone"
              onClick={endRoom}
              className="ml-2 inline-flex h-11 items-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-bold text-white hover:bg-rose-700"
            >
              <PhoneOff className="h-4 w-4" />
              <span className="hidden sm:inline">End room</span>
            </button>
          ) : (
            <button
              type="button"
              title="Leave call"
              aria-label="Leave call"
              onClick={leave}
              className="ml-2 flex h-11 w-11 items-center justify-center rounded-xl bg-rose-600 text-white hover:bg-rose-700"
            >
              <PhoneOff className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1">
          <ControlButton
            label="Open chat"
            active={sidebarTab === 'chat'}
            badge={sidebarTab !== 'chat' ? unreadChat : 0}
            onClick={() => onOpenSidebar?.('chat')}
          >
            <MessageSquare className="h-4 w-4" />
          </ControlButton>
          <ControlButton
            label="Open participants"
            active={sidebarTab === 'participants'}
            badge={sidebarTab !== 'participants' ? waitingCount : 0}
            onClick={() => onOpenSidebar?.('participants')}
          >
            <Users className="h-4 w-4" />
          </ControlButton>
        </div>
      </div>
    </div>
  );
}
