'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import apiClient from '@/lib/api';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';
import {
  Mic, MicOff, Video, VideoOff, MonitorUp, MessageSquare,
  Activity, PhoneOff, Send,
  Stethoscope, ChevronRight, Loader, Users,
  Wifi, WifiOff, AlertCircle, FileText,
} from 'lucide-react';

/* ---------- API helpers ---------- */
const api = {
  getRoom: (id) => apiClient.get(`/ng/conference/rooms/${id}`).then(({ data }) => data),
  createRoom: (body) => apiClient.post('/ng/conference/rooms', body).then(({ data }) => data),
  startRoom: (id) => apiClient.post(`/ng/conference/rooms/${id}/start`).then(({ data }) => data),
  getToken: (id, displayName) => apiClient.post(`/ng/conference/rooms/${id}/token`, { display_name: displayName, role: 'doctor' }).then(({ data }) => data),
  joinRoom: (id, displayName) => apiClient.post(`/ng/conference/rooms/${id}/join`, { display_name: displayName, role: 'doctor' }).then(({ data }) => data),
  endRoom: (id) => apiClient.post(`/ng/conference/rooms/${id}/end`).then(({ data }) => data),
  leaveRoom: (id, participantId) => apiClient.post(`/ng/conference/rooms/${id}/participants/${participantId}/leave`).then(({ data }) => data),
  sendChat: (id, text) => apiClient.post(`/ng/conference/rooms/${id}/chat`, { message: text }).then(({ data }) => data),
  getChat: (id) => apiClient.get(`/ng/conference/rooms/${id}/chat`).then(({ data }) => data),
};

/* ---------- UI buttons ---------- */
const CtrlBtn = ({ label, active, activeBg = 'bg-red-500', inactiveBg = 'bg-[#3c4043]', onClick, icon: Icon, activeIcon: AI }) => (
  <button onClick={onClick} aria-label={label} aria-pressed={active}
    className={`w-12 h-12 flex items-center justify-center rounded-full transition-all ${active ? activeBg : `${inactiveBg} hover:bg-[#4d5154]`}`}>
    {active ? <AI size={20} className="text-white" /> : <Icon size={20} className="text-white" />}
  </button>
);

const SideBtn = ({ panelName, currentPanel, onClick, icon: Icon }) => (
  <button onClick={() => onClick(panelName)} aria-label={{ participants:'Participants',vitals:'Clinical observations',notes:'Clinical documentation',chat:'In-call messages' }[panelName]} aria-pressed={currentPanel === panelName}
    className={`w-12 h-12 flex items-center justify-center rounded-full transition-all ${currentPanel === panelName ? 'bg-blue-100 text-blue-700' : 'bg-transparent text-gray-300 hover:bg-[#3c4043]'}`}>
    <Icon size={22} />
  </button>
);

/* ---------- Remote video element (attaches LiveKit track or shows avatar) ---------- */
function RemoteVideoTile({ participant, track, screenShare = false }) {
  const videoRef = useRef(null);
  const name = participant?.name || participant?.identity || 'Participant';

  useEffect(() => {
    if (track && videoRef.current) {
      const videoElement = videoRef.current;
      track.attach(videoElement);
      return () => { track.detach(videoElement); };
    }
  }, [track]);

  return (
    <div className="relative w-full h-full bg-[#3c4043] rounded-2xl overflow-hidden shadow-2xl border border-gray-700/50">
      {track ? (
        <video ref={videoRef} autoPlay playsInline className={`w-full h-full ${screenShare ? 'object-contain' : 'object-cover'}`} />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-[#2d2f33]">
          <div className="w-32 h-32 rounded-full bg-slate-600 flex items-center justify-center text-4xl font-bold text-white">
            {name.slice(0, 2).toUpperCase()}
          </div>
        </div>
      )}
      <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg text-sm font-medium text-white">{name}</div>
    </div>
  );
}

/* ---------- Local video (provider camera) ---------- */
function LocalVideoTile({ isVideoOff, isMuted, displayName, initials, track }) {
  const videoRef = useRef(null);
  useEffect(() => {
    if (!track || isVideoOff || !videoRef.current) return;
    const videoElement = videoRef.current;
    track.attach(videoElement);
    return () => { track.detach(videoElement); videoElement.srcObject = null; };
  }, [track, isVideoOff]);

  return (
    <div className="relative w-full h-full bg-[#3c4043] rounded-2xl overflow-hidden shadow-2xl border border-gray-700/50">
      {isVideoOff ? (
        <div className="w-full h-full flex items-center justify-center bg-[#202124]">
          <div className="w-28 h-28 rounded-full bg-blue-600 flex items-center justify-center text-4xl font-medium text-white shadow-xl">{initials}</div>
        </div>
      ) : (
        <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover scale-x-[-1]" />
      )}
      <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg text-sm font-medium text-white">{displayName} (You)</div>
      {isMuted && <div className="absolute top-4 right-4 bg-red-500 p-2 rounded-full"><MicOff size={16} className="text-white" /></div>}
    </div>
  );
}

function RemoteAudioTrack({ track }) {
  const audioRef = useRef(null);
  useEffect(() => {
    if (!track || !audioRef.current) return;
    const element = audioRef.current;
    track.attach(element);
    return () => { track.detach(element); element.srcObject = null; };
  }, [track]);
  return <audio ref={audioRef} autoPlay />;
}

/* ---------- Participants sidebar ---------- */
const ParticipantsPanel = ({ localName, remoteParticipants, sfuAvailable, isHost }) => {
  const everyone = [
    { identity: `${localName} (You)`, isLocal: true },
    ...remoteParticipants.map(p => ({ identity: p.name || p.identity, isLocal: false })),
  ];
  return (
    <div className="flex flex-col h-full bg-white">
      <div className="p-6 border-b border-gray-200">
        <h3 className="font-bold text-gray-900 text-lg">In this consultation</h3>
        <p className="text-sm text-gray-500 mt-1">
          {everyone.length} participant{everyone.length !== 1 ? 's' : ''} · {sfuAvailable === true ? 'Connected' : 'Not connected'}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {everyone.map((p, i) => (
          <div key={i} className="flex items-center px-4 py-3 rounded-xl bg-slate-50 border border-slate-100">
            <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold mr-3">
              {String(p.identity).slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{p.identity}</p>
              <p className="text-xs text-gray-500">{p.isLocal ? isHost ? 'Host · Clinician' : 'Clinician' : 'Connected'}</p>
            </div>
            <div className="w-2 h-2 rounded-full bg-blue-500" />
          </div>
        ))}
      </div>
    </div>
  );
};

/* ---------- Vitals sidebar ---------- */
const VitalsPanel = ({ remoteParticipants }) => (
  <div className="h-full overflow-y-auto bg-white p-6 text-slate-900">
    <h3 className="text-xl font-semibold">Clinical observations</h3>
    <p className="mt-3 text-slate-600">{remoteParticipants.length} remote participant{remoteParticipants.length === 1 ? '' : 's'} connected.</p>
    <p className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 leading-7">No verified observations are available in this room. Review and record measurements in the patient chart with their source, units, and time.</p>
  </div>
);

/* ---------- Notes sidebar ---------- */
const NotesPanel = ({ appointmentId, patientId, onOpenSoap, onCreateRx }) => (
  <div className="h-full overflow-y-auto bg-white p-6 text-slate-900">
    <h3 className="text-xl font-semibold">Clinical documentation</h3>
    <p className="mt-3 leading-7 text-slate-600">Open the patient chart to record observations, document care, and review prescriptions. Documentation opens alongside the consultation.</p>
    <div className="mt-6 space-y-3">
      <button onClick={onOpenSoap} disabled={!appointmentId && !patientId} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 font-medium disabled:opacity-50"><FileText size={20} aria-hidden="true" />Open SOAP / EMR</button>
      <button onClick={onCreateRx} disabled={!patientId && !appointmentId} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-medium text-white disabled:opacity-50"><Stethoscope size={20} aria-hidden="true" />Create Prescription</button>
    </div>
    {!appointmentId && !patientId && <p className="mt-4 text-slate-600">Open this consultation from the appointment or patient record to maintain care context.</p>}
  </div>
);

/* ---------- Chat sidebar ---------- */
const ChatPanel = ({ messages, onSend }) => {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setError('');
    try {
      await onSend(text);
      setInput('');
    } catch (sendError) {
      setError(sendError.message || 'Message not sent. Try again.');
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="flex flex-col h-full bg-white">
      <div className="p-6 border-b border-gray-200">
        <h3 className="font-bold text-gray-900 text-lg">In-call messages</h3>
        <p className="text-sm text-gray-500 mt-1">Messages are visible to all participants</p>
      </div>
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex flex-col ${msg.sender === 'You' ? 'items-end' : 'items-start'}`}>
            <div className="flex items-baseline space-x-2 mb-1">
              <span className="text-sm font-bold text-gray-900">{msg.sender}</span>
              <span className="text-xs text-gray-400">{msg.time}</span>
            </div>
            <div className={`px-4 py-2.5 text-sm rounded-2xl max-w-[85%] ${msg.sender === 'You' ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-gray-100 text-gray-900 rounded-bl-sm'}`}>{msg.text}</div>
          </div>
        ))}
      </div>
      <div className="p-5 border-t border-gray-200 bg-slate-50">
        <form onSubmit={submit} className="relative">
          <input type="text" value={input} onChange={e => setInput(e.target.value)} placeholder="Send a message..."
            aria-label="Conference message"
            maxLength={2000}
            className="w-full bg-white border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-full py-3 pl-5 pr-14 text-sm outline-none" />
          <button type="submit" disabled={sending || !input.trim()} aria-label="Send conference message" className="absolute right-1.5 top-1.5 p-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"><Send size={16} /></button>
        </form>
        {error ? <p className="mt-2 text-xs text-red-600" role="alert">{error}</p> : null}
      </div>
    </div>
  );
};

/* ---------- Pre-call: Google Meet-style camera preview lobby ---------- */
function PreCallScreen({ onJoin, onExit, displayName, appointmentId, patientId, patientName, connectionError, existingRoom, resolvingRoom }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const mountedRef = useRef(false);
  const [camOn, setCamOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [camReady, setCamReady] = useState(false);

  // Start local camera preview
  useEffect(() => {
    let active = true;
    mountedRef.current = true;
    navigator.mediaDevices?.getUserMedia({ video: true, audio: false })
      .then(stream => {
        if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCamReady(true);
      })
      .catch(() => { if (active) setCamReady(false); });
    return () => {
      active = false;
      mountedRef.current = false;
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  const toggleCam = () => {
    const enabled = !camOn;
    setCamOn(enabled);
    streamRef.current?.getVideoTracks().forEach(t => { t.enabled = enabled; });
  };

  const toggleMic = () => setMicOn(m => !m);

  const startCall = async () => {
    setCreating(true); setError('');
    // Release preview stream before the call engine claims the devices
    streamRef.current?.getTracks().forEach(t => t.stop());
    try {
      const title = patientName
        ? `Consultation with ${patientName}`
        : `Consultation — ${new Date().toLocaleDateString()}`;
      const res = existingRoom ? { ok:true,room:existingRoom } : await api.createRoom({
        title,
        kind: 'consultation',
        max_participants: 4,
        ...(appointmentId ? { appointment_id: appointmentId } : {}),
        ...(patientId ? { patient_user_id: patientId } : {}),
        ...(patientName ? { patient_name_snapshot: patientName } : {}),
      });
      if (!mountedRef.current) return;
      if (!res.ok) throw new Error(res.error || 'Failed to create room');
      await onJoin(res.room, { microphone:micOn,camera:camOn });
      if (mountedRef.current) setCreating(false);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e.message);
      setCreating(false);
      // Re-open preview on error
      navigator.mediaDevices?.getUserMedia({ video: camOn, audio: false })
        .then(s => { if (!mountedRef.current) { s.getTracks().forEach(track => track.stop()); return; } streamRef.current = s; if (videoRef.current) videoRef.current.srcObject = s; })
        .catch(() => {});
    }
  };

  const initials = displayName.replace(/^Dr\.\s*/i, '').trim().split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-[#101d36] text-white lg:flex-row">
      {/* Left: camera preview */}
      <div className="relative flex min-h-[400px] min-w-0 flex-none flex-col items-center justify-center px-5 pb-6 pt-24 lg:min-h-max lg:flex-1 lg:p-8">
        {/* DoctaRx wordmark */}
        <div className="absolute left-6 top-6"><DoctaRxLogo glow={false} className="h-10" /></div>

        {/* Video preview */}
        <div className="w-full max-w-2xl shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-[#28292d] shadow-2xl">
          <div className="break-words border-b border-white/10 px-5 py-3 text-base font-semibold">
            {displayName} <span className="ml-2 text-blue-300">(You)</span>
          </div>
          <div className="relative aspect-video w-full">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className={`w-full h-full object-cover ${!camOn ? 'opacity-0' : ''}`}
            style={{ transform: 'scaleX(-1)' }}
          />
          {(!camOn || !camReady) && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#28292d]">
              <div className="flex flex-col items-center gap-3">
                <div className="w-20 h-20 rounded-full bg-slate-700 border-2 border-slate-600 flex items-center justify-center text-2xl font-extrabold text-slate-300">
                  {initials}
                </div>
                <p className="text-sm text-slate-400">{camOn ? 'Camera unavailable' : 'Camera is off'}</p>
              </div>
            </div>
          )}

          </div>

          {/* Device controls row */}
          <div className="flex items-center justify-center gap-3 border-t border-white/10 bg-[#202938] px-5 py-4">
            <button
              onClick={toggleMic}
              title={micOn ? 'Mute' : 'Unmute'}
              aria-label={micOn ? 'Mute microphone on join' : 'Enable microphone on join'} aria-pressed={!micOn}
              className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all ${micOn ? 'bg-[#3c4043] hover:bg-[#4d5154]' : 'bg-red-600 hover:bg-red-700'}`}
            >
              {micOn ? <Mic size={18} className="text-white" /> : <MicOff size={18} className="text-white" />}
            </button>
            <button
              onClick={toggleCam}
              title={camOn ? 'Turn off camera' : 'Turn on camera'}
              aria-label={camOn ? 'Turn camera off' : 'Turn camera on'} aria-pressed={!camOn}
              className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all ${camOn ? 'bg-[#3c4043] hover:bg-[#4d5154]' : 'bg-red-600 hover:bg-red-700'}`}
            >
              {camOn ? <Video size={18} className="text-white" /> : <VideoOff size={18} className="text-white" />}
            </button>
          </div>
        </div>
      </div>

      {/* Right: join panel */}
      <div className="flex w-full shrink-0 flex-col items-center justify-center border-t border-white/10 bg-[#101d36] p-6 lg:w-[380px] lg:border-l lg:border-t-0 lg:p-8">
        <div className="w-full space-y-6">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight">
              {patientName ? `Consult with ${patientName}` : 'New Consultation'}
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              Check your devices before requesting consultation access.
            </p>
          </div>

          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-3 text-slate-300">
              <div className={`w-2 h-2 rounded-full ${micOn ? 'bg-blue-400' : 'bg-red-500'}`} />
              Microphone {micOn ? 'enabled on join' : 'muted on join'}
            </div>
            <div className="flex items-center gap-3 text-slate-300">
              <div className={`w-2 h-2 rounded-full ${camOn && camReady ? 'bg-blue-400' : 'bg-red-500'}`} />
              Camera {camOn && camReady ? 'on' : camOn ? 'unavailable' : 'off'}
            </div>
          </div>

          {(error || connectionError) && (
            <div className="flex items-start gap-2 bg-red-900/40 border border-red-500/40 rounded-xl px-4 py-3 text-red-300 text-sm">
              <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error || connectionError}
            </div>
          )}

          <button
            onClick={startCall}
            disabled={creating || resolvingRoom}
            className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-xl font-bold text-base flex items-center justify-center gap-2.5 shadow-lg shadow-blue-900/30 transition-all"
          >
            {creating
              ? <><Loader size={18} className="animate-spin" /> Starting…</>
              : <><Video size={18} />{resolvingRoom ? 'Checking consultation access…' : existingRoom ? 'Join consultation' : 'Start New Consultation'}</>
            }
          </button>

          <button onClick={onExit} disabled={creating} className="min-h-12 w-full rounded-xl border border-slate-500 px-4 py-3 font-medium text-slate-200 disabled:opacity-50">Return to Dashboard</button>

          <p className="text-base text-slate-300 text-center leading-relaxed">
            Access is restricted to authorised participants. Your camera preview is visible only to you before joining.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------- Main export ---------- */
export default function NGVideoCall() {
  const router = useRouter();
  const pathname = usePathname();
  const providerBase = pathname?.startsWith('/ng/') ? '/ng/provider' : '/provider';
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const [phase, setPhase] = useState('pre'); // 'pre' | 'connecting' | 'call' | 'ended'
  const [room, setRoom] = useState(null);          // conference room record
  const [joinedParticipant, setJoinedParticipant] = useState(null);
  const [livekitRoom, setLivekitRoom] = useState(null);  // livekit-client Room instance
  const [sfuAvailable, setSfuAvailable] = useState(null); // null=unknown, true, false
  const [connectError, setConnectError] = useState('');

  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [activePanel, setActivePanel] = useState(null);

  const [remoteParticipants, setRemoteParticipants] = useState([]);
  const [remoteShares, setRemoteShares] = useState([]);
  const [remoteTracks, setRemoteTracks] = useState({}); // participantId -> videoTrack
  const [remoteAudioTracks, setRemoteAudioTracks] = useState([]);
  const [localCameraTrack, setLocalCameraTrack] = useState(null);
  const [audioBlocked, setAudioBlocked] = useState(false);

  const [timeString, setTimeString] = useState('');
  const [messages, setMessages] = useState([]);
  const [roomId, setRoomId] = useState(null);
  const [existingRoom, setExistingRoom] = useState(null);
  const [resolvingRoom, setResolvingRoom] = useState(Boolean(searchParams?.get('room')));
  const lastDevices = useRef({ microphone:true,camera:true });

  const [callStartedAt, setCallStartedAt] = useState(null);
  const [elapsed, setElapsed] = useState('00:00');
  const [endConfirmed, setEndConfirmed] = useState(false);
  const [ending, setEnding] = useState(false);
  const canEndRoom = Boolean(room?.host_user_id && String(room.host_user_id) === String(user?.id)) || joinedParticipant?.role === 'host' || joinedParticipant?.permissions_json?.end_room === true;
  const [mediaError, setMediaError] = useState('');     // camera/mic permission problems
  const [connState, setConnState] = useState('idle');   // idle|connecting|connected|reconnecting|failed
  const lastRoomRef = useRef(null);                     // for retry
  const mountedRef = useRef(false);
  const joinAttemptRef = useRef(0);
  const mediaRoomRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      joinAttemptRef.current += 1;
      const activeRoom = mediaRoomRef.current;
      mediaRoomRef.current = null;
      if (activeRoom) { activeRoom.removeAllListeners(); void activeRoom.disconnect(true).catch(() => {}); }
    };
  }, []);

  const displayName = user ? `Dr. ${user.last_name || user.lastName || user.name || 'Provider'}` : 'Dr. Provider';
  const initials = user
    ? `${(user.first_name || user.firstName || 'D')[0]}${(user.last_name || user.lastName || 'R')[0]}`.toUpperCase()
    : 'DR';

  // Appointment / patient context from query params (set when launched from a
  // specific appointment row rather than the generic Telehealth Center nav).
  const appointmentId = searchParams?.get('appointmentId') || null;
  const patientId = searchParams?.get('patientId') || null;
  const patientName = searchParams?.get('patientName') || null;

  // Clock
  useEffect(() => {
    const u = () => setTimeString(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    u(); const t = setInterval(u, 10000); return () => clearInterval(t);
  }, []);


  // Elapsed call timer (counts up from the moment media connects)
  useEffect(() => {
    if (!callStartedAt) { setElapsed('00:00'); return; }
    if (phase !== 'call') return;
    const fmt = () => {
      const s = Math.max(0, Math.floor((Date.now() - callStartedAt) / 1000));
      const hh = Math.floor(s / 3600);
      const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      setElapsed(hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`);
    };
    fmt();
    const t = setInterval(fmt, 1000);
    return () => clearInterval(t);
  }, [callStartedAt, phase]);

  // Conference messages are persisted server-side; polling provides a
  // reconnect-safe view without leaking events across socket rooms.
  useEffect(() => {
    if (!roomId || phase !== 'call') return;
    let cancelled = false;
    const load = () => {
      api.getChat(roomId).then(d => {
        if (!cancelled && d.messages) {
          setMessages(d.messages.map(m => ({
            id: m.id,
            sender: m.sender_display || m.sender_user_id || 'Participant',
            text: m.message,
            time: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          })));
        }
      }).catch(() => {});
    };
    load();
    const poll = setInterval(load, 2500);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [roomId, phase]);

  const handleJoin = useCallback(async (conferenceRoom, devices = { microphone:true,camera:true }) => {
    if (!mountedRef.current) return;
    const attempt = ++joinAttemptRef.current;
    const isCurrentAttempt = () => mountedRef.current && joinAttemptRef.current === attempt;
    lastDevices.current = devices;
    const previousRoom = mediaRoomRef.current;
    mediaRoomRef.current = null;
    if (previousRoom) { previousRoom.removeAllListeners(); await previousRoom.disconnect(true).catch(() => {}); }
    if (!isCurrentAttempt()) return;
    setLivekitRoom(null); setLocalCameraTrack(null); setRemoteAudioTracks([]);
    setRemoteParticipants([]); setRemoteTracks({}); setRemoteShares([]); setIsSharing(false);
    setRoom(conferenceRoom);
    setRoomId(conferenceRoom.id);
    lastRoomRef.current = conferenceRoom;
    setPhase('connecting');
    setConnectError('');
    setEndConfirmed(false); setAudioBlocked(false);
    setMediaError('');
    setConnState('connecting');

    let connectingRoom;
    try {
      const current = await api.getRoom(conferenceRoom.id);
      if (!isCurrentAttempt()) return;
      if (!current?.ok || !current.room) throw new Error(current?.error || 'The consultation is unavailable.');
      conferenceRoom = current.room;
      setRoom(conferenceRoom); lastRoomRef.current = conferenceRoom; setExistingRoom(conferenceRoom);
      // Ensure room is live
      if (conferenceRoom.status === 'scheduled') {
        const started = await api.startRoom(conferenceRoom.id);
        if (!isCurrentAttempt()) return;
        if (!started?.ok || !started.room) throw new Error(started?.error || 'The consultation could not be started.');
        conferenceRoom = started.room;
        setRoom(conferenceRoom); lastRoomRef.current = conferenceRoom; setExistingRoom(conferenceRoom);
      }

      // Register participation
      const joined = await api.joinRoom(conferenceRoom.id, displayName);
      if (!isCurrentAttempt()) return;
      if (!joined?.ok) throw new Error(joined?.error || 'The consultation could not be joined.');
      setJoinedParticipant(joined.participant || null);

      // Try to get LiveKit token
      const tokenRes = await api.getToken(conferenceRoom.id, displayName);
      if (!isCurrentAttempt()) return;

      if (!tokenRes.ok || !tokenRes.livekitUrl || !tokenRes.token) {
        throw new Error('Video service is unavailable. Rejoin when the service is ready or contact your care team.');
      }

      // Dynamically import livekit-client (avoids SSR issues)
      const { Room: LKRoom, RoomEvent, Track, createLocalVideoTrack, createLocalAudioTrack } = await import('livekit-client');
      if (!isCurrentAttempt()) return;

      const lkRoom = new LKRoom({
        adaptiveStream: true,
        dynacast: true,
      });

      connectingRoom = lkRoom;
      mediaRoomRef.current = lkRoom;
      let hasConnected = false;
      const isCurrentRoom = () => isCurrentAttempt() && mediaRoomRef.current === lkRoom;
      // Remote participant handlers
      const updateParticipants = () => {
        if (!isCurrentRoom()) return;
        const parts = Array.from(lkRoom.remoteParticipants.values());
        setRemoteParticipants(parts);
        const tracks = {};
        const shares = [];
        const audio = [];
        parts.forEach(p => {
          const vPub = Array.from(p.videoTrackPublications.values()).find(pub => pub.track && pub.source === Track.Source.Camera);
          if (vPub?.track) tracks[p.identity] = vPub.track;
          const share = Array.from(p.videoTrackPublications.values()).find(pub => pub.track && pub.source === Track.Source.ScreenShare);
          if (share?.track) shares.push({ participant: p, track: share.track });
          Array.from(p.audioTrackPublications.values()).forEach(pub => {
            if (pub.track) audio.push({ id: `${p.identity}:${pub.trackSid || pub.source}`, track: pub.track });
          });
        });
        setRemoteTracks(tracks);
        setRemoteShares(shares);
        setRemoteAudioTracks(audio);
        const local = lkRoom.localParticipant;
        const camera = Array.from(local.videoTrackPublications.values()).find(pub => pub.source === Track.Source.Camera);
        const microphone = Array.from(local.audioTrackPublications.values()).find(pub => pub.source === Track.Source.Microphone);
        setLocalCameraTrack(camera?.track || null);
        setIsVideoOff(!camera?.track || camera.isMuted === true);
        setIsMuted(!microphone?.track || microphone.isMuted === true);
        setIsSharing(local.isScreenShareEnabled === true);
      };

      lkRoom
        .on(RoomEvent.TrackSubscribed, updateParticipants)
        .on(RoomEvent.TrackUnsubscribed, updateParticipants)
        .on(RoomEvent.ParticipantConnected, updateParticipants)
        .on(RoomEvent.ParticipantDisconnected, updateParticipants)
        .on(RoomEvent.TrackMuted, updateParticipants)
        .on(RoomEvent.TrackUnmuted, updateParticipants)
        .on(RoomEvent.LocalTrackPublished, updateParticipants)
        .on(RoomEvent.LocalTrackUnpublished, updateParticipants)
        .on(RoomEvent.AudioPlaybackStatusChanged, () => { if (isCurrentRoom()) setAudioBlocked(!lkRoom.canPlaybackAudio); })
        .on(RoomEvent.Reconnecting, () => { if (isCurrentRoom()) setConnState('reconnecting'); })
        .on(RoomEvent.Reconnected, () => { if (isCurrentRoom()) setConnState('connected'); })
        .on(RoomEvent.Disconnected, () => {
          if (!isCurrentRoom() || !hasConnected) return;
          joinAttemptRef.current += 1; mediaRoomRef.current = null;
          setLivekitRoom(null); setLocalCameraTrack(null); setRemoteAudioTracks([]);
          setConnState('idle'); setSfuAvailable(false); setPhase('ended');
        });

      await lkRoom.connect(tokenRes.livekitUrl, tokenRes.token);
      if (!isCurrentRoom()) { await lkRoom.disconnect(true).catch(() => {}); return; }
      hasConnected = true;
      updateParticipants();
      try { await lkRoom.startAudio(); }
      catch { if (isCurrentRoom()) setAudioBlocked(true); }
      if (!isCurrentRoom()) { await lkRoom.disconnect(true).catch(() => {}); return; }

      // Publish camera + mic — surface a clear, production-grade error if the
      // browser denies media or no device is present, rather than failing silently.
      try {
        const captured = await Promise.allSettled([
          devices.camera ? createLocalVideoTrack() : Promise.resolve(null),
          devices.microphone ? createLocalAudioTrack() : Promise.resolve(null),
        ]);
        if (!isCurrentRoom()) {
          captured.forEach(item => { if (item.status === 'fulfilled') item.value?.stop(); });
          await lkRoom.disconnect(true).catch(() => {}); return;
        }
        const failures = [];
        for (const item of captured) {
          if (item.status === 'rejected') { failures.push(item.reason); continue; }
          if (!item.value) continue;
          if (!isCurrentRoom()) { item.value.stop(); continue; }
          try { await lkRoom.localParticipant.publishTrack(item.value); }
          catch (error) { item.value.stop(); failures.push(error); }
        }
        if (!isCurrentRoom()) {
          captured.forEach(item => { if (item.status === 'fulfilled') item.value?.stop(); });
          await lkRoom.disconnect(true).catch(() => {}); return;
        }
        updateParticipants();
        if (failures.length) throw failures[0];
      } catch (mediaErr) {
        if (!isCurrentRoom()) return;
        console.warn('[NGVideoCall] media publish error:', mediaErr.message);
        const denied = /permission|denied|notallowed/i.test(mediaErr.name + mediaErr.message);
        const missing = /notfound|devicesnotfound|overconstrained/i.test(mediaErr.name + mediaErr.message);
        setMediaError(
          denied
            ? 'Camera/microphone access was blocked. Enable permissions in your browser and rejoin.'
            : missing
              ? 'No camera or microphone was detected. Connect a device and rejoin.'
              : `Media error: ${mediaErr.message}. You are connected but others may not see/hear you.`
        );
      }

      if (!isCurrentRoom()) { await lkRoom.disconnect(true).catch(() => {}); return; }
      setLivekitRoom(lkRoom);
      setSfuAvailable(true);
      setConnState('connected');
      setCallStartedAt(Date.now());
      setPhase('call');
    } catch (err) {
      if (connectingRoom) {
        connectingRoom.removeAllListeners();
        if (mediaRoomRef.current === connectingRoom) mediaRoomRef.current = null;
        await connectingRoom.disconnect(true).catch(() => {});
      }
      if (!isCurrentAttempt()) return;
      console.error('[NGVideoCall] connect error:', err);
      setConnectError(err.response?.data?.error || err.message || 'Video service is unavailable.');
      setSfuAvailable(false); setLivekitRoom(null);
      setConnState('failed'); setCallStartedAt(null);
      setRemoteParticipants([]); setRemoteTracks({}); setRemoteShares([]);
      setRemoteAudioTracks([]); setLocalCameraTrack(null);
      setPhase('pre');
    }
  }, [displayName]);

  const retryConnect = useCallback(() => {
    const r = lastRoomRef.current;
    if (r) handleJoin(r,lastDevices.current);
    else setPhase('pre');
  }, [handleJoin]);

  // Mute / video toggle via LiveKit
  const toggleMute = async () => {
    if (livekitRoom) {
      try { await livekitRoom.localParticipant.setMicrophoneEnabled(isMuted); }
      catch { setMediaError('Microphone access could not be changed. Check your device permissions.'); return; }
      setIsMuted(!livekitRoom.localParticipant.isMicrophoneEnabled);
    }
  };

  const toggleVideo = async () => {
    if (livekitRoom) {
      try { await livekitRoom.localParticipant.setCameraEnabled(isVideoOff); }
      catch { setMediaError('Camera access could not be changed. Check your device permissions.'); return; }
      const camera = Array.from(livekitRoom.localParticipant.videoTrackPublications.values()).find(pub => pub.source === 'camera');
      setLocalCameraTrack(camera?.track || null);
      setIsVideoOff(!livekitRoom.localParticipant.isCameraEnabled);
    }
  };

  const toggleScreenShare = async () => {
    if (livekitRoom) {
      try {
        await livekitRoom.localParticipant.setScreenShareEnabled(!isSharing);
        setIsSharing(livekitRoom.localParticipant.isScreenShareEnabled === true);
      } catch (e) {
        setMediaError('Screen sharing could not be started. Choose a screen and allow access to share it.');
      }
    } else {
      setMediaError('Connect to the consultation before sharing your screen.');
    }
  };

  const endCall = async () => {
    setEnding(true); setEndConfirmed(false);
    joinAttemptRef.current += 1;
    const activeRoom = mediaRoomRef.current;
    mediaRoomRef.current = null;
    if (activeRoom) { activeRoom.removeAllListeners(); await activeRoom.disconnect(true).catch(() => {}); }
    if (!mountedRef.current) return;
    setLivekitRoom(null); setLocalCameraTrack(null); setRemoteAudioTracks([]); setConnState('idle');
    try {
      if (roomId) {
        const response = canEndRoom ? await api.endRoom(roomId) : await api.leaveRoom(roomId, joinedParticipant.id);
        if (!response?.ok) throw new Error();
        if (mountedRef.current && canEndRoom) setEndConfirmed(true);
      }
    } catch { if (mountedRef.current) setConnectError(canEndRoom ? 'You left the consultation, but the room closure could not be confirmed. Contact your care team before retrying.' : 'You disconnected, but your departure could not be confirmed. Contact your care team.'); }
    if (mountedRef.current) { setPhase('ended'); setEnding(false); }
  };

  const sendMessage = async (text) => {
    const optimisticId = `pending-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: optimisticId,
      sender: 'You',
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }]);
    try {
      const response = await api.sendChat(roomId, text);
      if (!response?.ok) throw new Error(response?.error || 'Message not sent');
    } catch (error) {
      setMessages((current) => current.filter((message) => message.id !== optimisticId));
      throw error;
    }
  };

  const togglePanel = (panel) => setActivePanel(p => p === panel ? null : panel);

  // Open the appointment-linked EMR/SOAP page (preserves clinical context).
  const openClinicalRecord = () => {
    const path = appointmentId ? `${providerBase}/appointments/${appointmentId}/visit` : patientId ? `${providerBase}/patients/${patientId}/ehr` : `${providerBase}/visits`;
    window.open(path, '_blank', 'noopener,noreferrer');
  };

  // Create a prescription from the same consultation context.
  const createPrescription = () => {
    const q = new URLSearchParams();
    if (appointmentId) q.set('appointmentId', appointmentId);
    if (patientId) q.set('patientId', patientId);
    const qs = q.toString();
    window.open(`${providerBase}/prescriptions${qs ? `?${qs}` : ''}`, '_blank', 'noopener,noreferrer');
  };

  // Resolve a specific authorized room; joining remains an explicit action.
  useEffect(() => {
    let cancelled = false;
    const qRoom = searchParams?.get('room');
    if (qRoom && phase === 'pre') {
      setResolvingRoom(true);
      api.getRoom(qRoom).then(d => {
        if (cancelled) return;
        if (!d?.ok || !d.room) throw new Error('The consultation is unavailable.');
        setExistingRoom(d.room);
      }).catch(error => { if (!cancelled) setConnectError(error.response?.data?.error || 'The consultation could not be opened.'); })
        .finally(() => { if (!cancelled) setResolvingRoom(false); });
    }
    return () => { cancelled = true; };
  }, [searchParams, phase]);

  /* ---- RENDER ---- */

  if (phase === 'pre') {
    return (
      <PreCallScreen
        onJoin={handleJoin}
        onExit={() => router.push(`${providerBase}/dashboard`)}
        displayName={displayName}
        appointmentId={appointmentId}
        patientId={patientId}
        patientName={patientName}
        connectionError={connectError}
        existingRoom={existingRoom}
        resolvingRoom={resolvingRoom || Boolean(searchParams?.get('room') && !existingRoom)}
      />
    );
  }

  if (phase === 'connecting') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#202124] text-white">
        <div className="flex items-center mb-8">
          <DoctaRxLogo glow={false} className="h-10" />
        </div>
        <Loader size={48} className="animate-spin text-blue-400 mb-6" />
        <p className="text-xl font-semibold">Connecting to room…</p>
        <p className="text-gray-400 mt-2 text-sm">{room?.title || 'Consultation'} </p>
        <button onClick={() => router.push(`${providerBase}/dashboard`)} className="mt-6 min-h-12 rounded-xl border border-slate-500 px-5 py-3 text-slate-200">Cancel and return to Dashboard</button>
      </div>
    );
  }

  if (phase === 'ended') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#202124] text-white">
        <div className="flex items-center mb-6">
          <DoctaRxLogo glow={false} className="h-10" />
        </div>
        <h1 className="text-4xl font-light mb-2 text-gray-200">{endConfirmed ? 'Consultation ended' : 'You left the consultation'}</h1>
        {connectError && <p role="alert" className="mb-4 max-w-xl rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-200">{connectError}</p>}
        {patientName && <p className="text-sm text-blue-400 mb-2 font-semibold">{patientName}</p>}
        <p className="text-sm text-gray-400 mb-8 text-center max-w-xs">
          Elapsed: {elapsed}.{appointmentId ? ' Document visit notes to complete the clinical record.' : ''}
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          {/* When launched from an appointment, go directly to the visit/EMR page */}
          {appointmentId && (
            <button
              onClick={() => router.push(`${providerBase}/appointments/${appointmentId}/visit`)}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-lg flex items-center"
            >
              <FileText size={16} className="mr-2" /> Open Visit Notes
            </button>
          )}
          <button onClick={() => { setPhase('pre'); setLivekitRoom(null); setRoom(null); setRoomId(null); setExistingRoom(null); lastRoomRef.current = null; setRemoteParticipants([]); setRemoteTracks({}); setRemoteShares([]); setMessages([]); setCallStartedAt(null); setMediaError(''); setConnectError(''); setConnState('idle'); if (searchParams?.get('room')) router.replace(`${providerBase}/call`); }}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-lg">
            New Call
          </button>
          <button onClick={() => router.push(`${providerBase}/dashboard`)}
            className="px-6 py-2.5 bg-[#3c4043] hover:bg-[#4d5154] text-white font-medium rounded-lg">
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // phase === 'call': every admitted participant is represented.

  return (
    <div className="fixed inset-0 z-50 flex h-screen w-screen bg-[#202124] overflow-hidden text-white">
      <div className="flex flex-col flex-1 min-w-0">

        {/* Header badges */}
        <div className="absolute top-6 left-6 z-10 flex flex-wrap gap-3 items-center">
          <div className="bg-black/50 backdrop-blur-md border border-white/10 px-4 py-2 rounded-xl flex items-center shadow-lg">
            <DoctaRxLogo glow={false} className="h-8" />
          </div>
          <div className="bg-black/50 backdrop-blur-md border border-white/10 px-3 py-2 rounded-xl flex items-center text-xs font-semibold text-gray-200">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse mr-2" /> DoctaRx
          </div>
          {/* Live elapsed call timer */}
          <div className="bg-black/50 backdrop-blur-md border border-white/10 px-3 py-2 rounded-xl flex items-center text-xs font-mono font-bold text-gray-100">
            {elapsed}
          </div>
          {/* Connection status */}
          {connState === 'reconnecting' ? (
            <div className="bg-black/50 backdrop-blur-md border border-amber-500/40 px-3 py-2 rounded-xl flex items-center text-amber-400 text-xs font-bold">
              <Loader size={13} className="mr-2 animate-spin" /> Reconnecting…
            </div>
          ) : sfuAvailable === true ? (
            <div className="bg-black/50 backdrop-blur-md border border-blue-500/30 px-3 py-2 rounded-xl flex items-center text-blue-400 text-xs font-bold">
              <Wifi size={14} className="mr-2" /> Connected
            </div>
          ) : (
            <div className="bg-black/50 backdrop-blur-md border border-amber-500/30 px-3 py-2 rounded-xl flex items-center text-amber-400 text-xs font-bold">
              <WifiOff size={14} className="mr-2" /> Not connected
            </div>
          )}
        </div>

        {/* Media-permission / connection error banner */}
        {(mediaError || connectError) && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 max-w-md w-[90%]">
            <div className="bg-red-950/90 backdrop-blur-md border border-red-500/50 rounded-xl px-4 py-3 flex items-start text-sm text-red-200 shadow-2xl">
              <AlertCircle size={18} className="mr-2 shrink-0 mt-0.5 text-red-400" />
              <div className="flex-1">
                <p>{mediaError || `Connection issue: ${connectError}`}</p>
                <button onClick={retryConnect} className="mt-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded-lg">
                  Retry connection
                </button>
              </div>
            </div>
          </div>
        )}

        {audioBlocked && <button onClick={async () => { try { await livekitRoom?.startAudio(); setAudioBlocked(!livekitRoom?.canPlaybackAudio); } catch { setAudioBlocked(true); } }} className="absolute right-6 top-6 z-20 min-h-12 rounded-xl bg-blue-600 px-4 py-3 font-semibold">Enable consultation audio</button>}
        {remoteAudioTracks.map(({ id, track }) => <RemoteAudioTrack key={id} track={track} />)}
        <div className="flex items-center justify-center gap-2 bg-[#202124] py-2 pt-20 md:hidden">
          <SideBtn panelName="participants" currentPanel={activePanel} onClick={togglePanel} icon={Users} />
          <SideBtn panelName="vitals" currentPanel={activePanel} onClick={togglePanel} icon={Activity} />
          <SideBtn panelName="notes" currentPanel={activePanel} onClick={togglePanel} icon={FileText} />
          <SideBtn panelName="chat" currentPanel={activePanel} onClick={togglePanel} icon={MessageSquare} />
        </div>
        {/* Video grid */}
        <div className="flex-1 p-4 md:p-6 flex items-center justify-center min-h-0 overflow-hidden">
          <div className="w-full h-full max-w-7xl grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 auto-rows-fr">
            {remoteParticipants.map((participant) => <RemoteVideoTile key={participant.sid || participant.identity} participant={participant} track={remoteTracks[participant.identity]} />)}
            {remoteShares.map(({ participant, track }) => <RemoteVideoTile key={participant.identity + '-screen'} participant={{ name: (participant.name || participant.identity) + ' · shared screen' }} track={track} screenShare />)}
            {remoteParticipants.length === 0 && <div className="flex items-center justify-center rounded-2xl border border-slate-600 p-6 text-slate-200">Waiting for other participants to join.</div>}
            <LocalVideoTile isVideoOff={isVideoOff} isMuted={isMuted} displayName={displayName} initials={initials} track={localCameraTrack} />
          </div>
        </div>

        {/* Controls */}
        <div className="h-24 w-full flex items-center justify-between px-6 md:px-8 bg-[#202124]">
          <div className="hidden md:flex items-center text-sm font-medium text-gray-300">
            <button
              onClick={() => router.push(`${providerBase}/dashboard`)}
              className="flex items-center mr-3 px-3 py-1.5 rounded-lg bg-[#3c4043] hover:bg-[#4d5154] text-gray-200 text-xs font-bold"
            >
              <ChevronRight size={14} className="mr-1 rotate-180" /> Dashboard
            </button>
            {timeString} <span className="mx-3 text-gray-600">|</span>
            {room?.title || 'DoctaRx consultation'}
          </div>

          <div className="flex items-center space-x-3 md:space-x-4 mx-auto md:mx-0">
            <CtrlBtn label={isMuted ? 'Unmute microphone' : 'Mute microphone'} active={isMuted} onClick={toggleMute} icon={Mic} activeIcon={MicOff} />
            <CtrlBtn label={isVideoOff ? 'Turn camera on' : 'Turn camera off'} active={isVideoOff} onClick={toggleVideo} icon={Video} activeIcon={VideoOff} />
            <CtrlBtn label={isSharing ? 'Stop sharing screen' : 'Share screen'} active={isSharing} activeBg="bg-blue-600" onClick={toggleScreenShare} icon={MonitorUp} activeIcon={MonitorUp} />
            <button onClick={endCall} aria-label={canEndRoom ? 'End consultation' : 'Leave consultation'} disabled={ending}
              className="w-16 md:w-20 h-12 ml-2 bg-[#ea4335] hover:bg-[#d93025] flex items-center justify-center rounded-full shadow-lg">
              <PhoneOff size={22} className="text-white" />
            </button>
          </div>

          <div className="hidden md:flex items-center space-x-2">
            <SideBtn panelName="participants" currentPanel={activePanel} onClick={togglePanel} icon={Users} />
            <SideBtn panelName="vitals" currentPanel={activePanel} onClick={togglePanel} icon={Activity} />
            <SideBtn panelName="notes" currentPanel={activePanel} onClick={togglePanel} icon={FileText} />
            <SideBtn panelName="chat" currentPanel={activePanel} onClick={togglePanel} icon={MessageSquare} />
          </div>
        </div>
      </div>

      {/* Sidebar */}
      {activePanel && (
        <div className="absolute inset-y-0 right-0 z-20 flex w-full max-w-[420px] shrink-0 flex-col border-l border-gray-200 bg-white shadow-2xl lg:static">
          <div className="h-20 flex items-center justify-between px-6 border-b border-gray-200 bg-white text-gray-900">
            <h2 className="font-bold text-lg">
              {activePanel === 'participants' ? 'Participants' : activePanel === 'vitals' ? 'Clinical observations' : activePanel === 'notes' ? 'Clinical documentation' : 'Chat'}
            </h2>
            <button onClick={() => setActivePanel(null)} aria-label="Close consultation panel" className="p-2 text-gray-500 hover:bg-gray-100 rounded-full">
              <ChevronRight size={20} />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            {activePanel === 'participants' && <ParticipantsPanel localName={displayName} remoteParticipants={remoteParticipants} sfuAvailable={sfuAvailable} isHost={String(room?.host_user_id) === String(user?.id)} />}
            {activePanel === 'vitals' && <VitalsPanel remoteParticipants={remoteParticipants} />}
            {activePanel === 'notes' && <NotesPanel appointmentId={appointmentId} patientId={patientId} onOpenSoap={openClinicalRecord} onCreateRx={createPrescription} />}
            {activePanel === 'chat' && <ChatPanel messages={messages} onSend={sendMessage} />}
          </div>
        </div>
      )}
    </div>
  );
}
