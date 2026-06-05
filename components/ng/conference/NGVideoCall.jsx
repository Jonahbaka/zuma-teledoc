'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import {
  Mic, MicOff, Video, VideoOff, MonitorUp, MessageSquare,
  Activity, PhoneOff, MoreVertical, Sparkles, Send,
  Stethoscope, ChevronRight, Loader, Plus, LogIn, Users,
  Wifi, WifiOff, AlertCircle,
} from 'lucide-react';

/* ---------- server-side AI helper ---------- */
const callAI = async (prompt) => {
  try {
    const res = await fetch('/ng/ai-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    return data.text || 'No response generated.';
  } catch (err) {
    return `AI service unavailable: ${err.message}`;
  }
};

/* ---------- API helpers ---------- */
const api = {
  getRooms: () => fetch('/api/ng/conference/rooms?limit=10').then(r => r.json()),
  createRoom: (body) => fetch('/api/ng/conference/rooms', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(r => r.json()),
  startRoom: (id) => fetch(`/api/ng/conference/rooms/${id}/start`, { method: 'POST' }).then(r => r.json()),
  getToken: (id, displayName) => fetch(`/api/ng/conference/rooms/${id}/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name: displayName }),
  }).then(r => r.json()),
  joinRoom: (id, displayName) => fetch(`/api/ng/conference/rooms/${id}/join`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name: displayName, role: 'provider' }),
  }).then(r => r.json()),
  endRoom: (id) => fetch(`/api/ng/conference/rooms/${id}/end`, { method: 'POST' }).then(r => r.json()),
  sendChat: (id, text) => fetch(`/api/ng/conference/rooms/${id}/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: text }),
  }).then(r => r.json()),
  getChat: (id) => fetch(`/api/ng/conference/rooms/${id}/chat`).then(r => r.json()),
};

/* ---------- UI buttons ---------- */
const CtrlBtn = ({ active, activeBg = 'bg-red-500', inactiveBg = 'bg-[#3c4043]', onClick, icon: Icon, activeIcon: AI }) => (
  <button onClick={onClick}
    className={`w-12 h-12 flex items-center justify-center rounded-full transition-all ${active ? activeBg : `${inactiveBg} hover:bg-[#4d5154]`}`}>
    {active ? <AI size={20} className="text-white" /> : <Icon size={20} className="text-white" />}
  </button>
);

const SideBtn = ({ panelName, currentPanel, onClick, icon: Icon }) => (
  <button onClick={() => onClick(panelName)}
    className={`w-12 h-12 flex items-center justify-center rounded-full transition-all ${currentPanel === panelName ? 'bg-blue-100 text-blue-700' : 'bg-transparent text-gray-300 hover:bg-[#3c4043]'}`}>
    <Icon size={22} />
  </button>
);

/* ---------- Remote video element (attaches LiveKit track or shows avatar) ---------- */
function RemoteVideoTile({ participant, track, hr }) {
  const videoRef = useRef(null);
  const name = participant?.identity || 'Patient';

  useEffect(() => {
    if (track && videoRef.current) {
      track.attach(videoRef.current);
      return () => { track.detach(videoRef.current); };
    }
  }, [track]);

  return (
    <div className="relative w-full h-full bg-[#3c4043] rounded-2xl overflow-hidden shadow-2xl border border-gray-700/50">
      {track ? (
        <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-[#2d2f33]">
          <div className="w-32 h-32 rounded-full bg-slate-600 flex items-center justify-center text-4xl font-bold text-white">
            {name.slice(0, 2).toUpperCase()}
          </div>
        </div>
      )}
      <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg text-sm font-medium text-white">{name}</div>
      <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-md px-3 py-2 rounded-xl flex flex-col items-end text-white border border-white/10">
        <div className="flex items-center space-x-2">
          <Activity size={16} className="text-green-400 animate-pulse" />
          <span className="font-mono font-bold text-lg">{hr} <span className="text-xs text-gray-300">BPM</span></span>
        </div>
        <div className="text-xs font-mono text-gray-300 mt-0.5">SpO2: 98%</div>
      </div>
    </div>
  );
}

/* ---------- Local video (provider camera) ---------- */
function LocalVideoTile({ isVideoOff, isMuted, displayName, initials, livekitRoom }) {
  const videoRef = useRef(null);
  const localStreamRef = useRef(null);

  useEffect(() => {
    // If LiveKit room is connected it manages tracks; otherwise use raw getUserMedia
    if (livekitRoom) return;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        localStreamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (e) {
        console.warn('[NGVideoCall] getUserMedia failed:', e.message);
      }
    };

    if (!isVideoOff) { start(); }
    else if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }

    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
        localStreamRef.current = null;
      }
    };
  }, [isVideoOff, livekitRoom]);

  // If LiveKit, attach local participant's video track
  useEffect(() => {
    if (!livekitRoom || !videoRef.current) return;
    const lp = livekitRoom.localParticipant;
    const pub = Array.from(lp.videoTrackPublications.values())[0];
    if (pub?.track) {
      pub.track.attach(videoRef.current);
      return () => pub.track?.detach(videoRef.current);
    }
  }, [livekitRoom]);

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

/* ---------- Vitals sidebar ---------- */
const VitalsPanel = ({ hr, remoteParticipants }) => (
  <div className="flex flex-col h-full bg-slate-50/50 overflow-y-auto">
    <div className="p-6 border-b border-gray-200 bg-white">
      <div className="flex items-center space-x-4 mb-4">
        <div className="w-16 h-16 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-2xl font-bold ring-2 ring-blue-100">
          {remoteParticipants.length > 0 ? remoteParticipants[0].identity?.slice(0, 2).toUpperCase() : 'PT'}
        </div>
        <div>
          <h3 className="text-xl font-bold text-gray-900">{remoteParticipants.length > 0 ? remoteParticipants[0].identity : 'Waiting for patient'}</h3>
          <p className="text-sm text-gray-500">{remoteParticipants.length} participant{remoteParticipants.length !== 1 ? 's' : ''} connected</p>
        </div>
      </div>
      <div className="inline-flex items-center px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-bold uppercase tracking-wide border border-blue-100">
        <Stethoscope size={14} className="mr-2" /> Telehealth Consultation
      </div>
    </div>
    <div className="p-6 space-y-8">
      <div>
        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Live Telemetry</h4>
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: 'Heart Rate', value: `${hr}`, unit: 'BPM', color: 'red' },
            { label: 'Blood Pressure', value: '120', unit: '/80', color: 'blue' },
            { label: 'SpO2', value: '98', unit: '%', color: 'emerald' },
            { label: 'Temp', value: '98.6', unit: '°F', color: 'orange' },
          ].map(v => (
            <div key={v.label} className={`bg-white p-4 rounded-2xl border border-${v.color}-100 shadow-sm`}>
              <div className={`flex items-center text-${v.color}-500 mb-2`}>
                <Activity size={16} className="mr-1.5" />
                <span className="text-xs font-bold uppercase">{v.label}</span>
              </div>
              <div className="text-3xl font-extrabold text-gray-900">{v.value} <span className="text-sm font-medium text-gray-400">{v.unit}</span></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

/* ---------- Notes sidebar ---------- */
const NotesPanel = ({ messages, hr }) => {
  const [note, setNote] = useState('');
  const [generating, setGenerating] = useState(false);

  const generate = async (type) => {
    setGenerating(true);
    setNote('');
    const transcript = messages.map(m => `[${m.time}] ${m.sender}: ${m.text}`).join('\n') || '(No conversation yet)';
    const prompt = type === 'soap'
      ? `You are an expert AI clinical scribe. Generate a professional SOAP note from this consultation transcript and vitals. Plain text only.\n\nTranscript:\n${transcript}\n\nVitals: HR ${hr} BPM, BP 120/80, SpO2 98%, Temp 98.6°F`
      : `Generate clear patient take-home instructions from this consultation transcript. Plain text.\n\nTranscript:\n${transcript}`;
    setNote(await callAI(prompt));
    setGenerating(false);
  };

  return (
    <div className="flex flex-col h-full bg-slate-50/50">
      <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-purple-50 to-white">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-purple-900 flex items-center text-lg"><Sparkles size={20} className="mr-2 text-purple-600" /> AI Assistant</h3>
          {generating && <span className="flex items-center text-xs font-bold bg-purple-100 text-purple-700 px-3 py-1.5 rounded-full"><Loader size={14} className="mr-2 animate-spin" />Thinking</span>}
        </div>
        <div className="flex space-x-2 mt-4">
          <button onClick={() => generate('soap')} disabled={generating} className="flex-1 bg-purple-600 text-white rounded-lg py-2.5 text-xs font-bold hover:bg-purple-700 disabled:opacity-50">✨ SOAP Note</button>
          <button onClick={() => generate('instructions')} disabled={generating} className="flex-1 bg-white border border-purple-200 text-purple-700 rounded-lg py-2.5 text-xs font-bold hover:bg-purple-50 disabled:opacity-50">✨ Patient Instructions</button>
        </div>
      </div>
      <div className="flex-1 p-6 flex flex-col">
        <textarea
          className="flex-1 w-full bg-white border border-gray-200 rounded-2xl p-5 resize-none text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-500 leading-relaxed"
          value={note} onChange={e => setNote(e.target.value)}
          placeholder="AI notes appear here. Use Chat to simulate a conversation, then click a generate button." />
        <div className="mt-4 flex space-x-4">
          <button className="flex-1 bg-white border border-gray-300 text-gray-700 rounded-xl py-3 text-sm font-bold hover:bg-gray-50">Edit</button>
          <button className="flex-1 bg-purple-600 text-white rounded-xl py-3 text-sm font-bold hover:bg-purple-700">Export to EHR</button>
        </div>
      </div>
    </div>
  );
};

/* ---------- Chat sidebar ---------- */
const ChatPanel = ({ messages, onSend, roomId }) => {
  const [input, setInput] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    onSend(input);
    if (roomId) { api.sendChat(roomId, input).catch(() => {}); }
    setInput('');
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
            className="w-full bg-white border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-full py-3 pl-5 pr-14 text-sm outline-none" />
          <button type="submit" className="absolute right-1.5 top-1.5 p-2 bg-blue-600 text-white rounded-full hover:bg-blue-700"><Send size={16} /></button>
        </form>
      </div>
    </div>
  );
};

/* ---------- Pre-call: room selection ---------- */
function PreCallScreen({ onJoin, displayName }) {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.getRooms().then(d => { setRooms(d.rooms || []); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const createAndJoin = async () => {
    setCreating(true); setError('');
    try {
      const res = await api.createRoom({
        title: `Consultation — ${new Date().toLocaleString()}`,
        kind: 'consultation',
        max_participants: 4,
      });
      if (!res.ok) throw new Error(res.error || 'Failed to create room');
      onJoin(res.room);
    } catch (e) { setError(e.message); setCreating(false); }
  };

  const joinExisting = (room) => onJoin(room);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#202124] text-white p-6">
      <div className="w-full max-w-lg">
        <div className="flex items-center justify-center mb-8">
          <div className="w-16 h-16 rounded-full bg-blue-600 flex items-center justify-center mr-4">
            <Video size={28} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">DoctaRx Telehealth</h1>
            <p className="text-gray-400 text-sm">Nigeria · Provider Session</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-center bg-red-900/40 border border-red-500/40 rounded-xl px-4 py-3 text-red-300 text-sm">
            <AlertCircle size={16} className="mr-2 shrink-0" /> {error}
          </div>
        )}

        <button onClick={createAndJoin} disabled={creating}
          className="w-full flex items-center justify-center py-4 bg-blue-600 hover:bg-blue-700 rounded-2xl font-bold text-lg mb-6 disabled:opacity-60">
          {creating ? <><Loader size={20} className="mr-3 animate-spin" />Creating room…</> : <><Plus size={20} className="mr-3" />Start New Consultation</>}
        </button>

        {!loading && rooms.filter(r => r.status !== 'ended' && r.status !== 'cancelled').length > 0 && (
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Active & Scheduled Rooms</p>
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {rooms.filter(r => r.status !== 'ended' && r.status !== 'cancelled').map(room => (
                <button key={room.id} onClick={() => joinExisting(room)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-[#3c4043] hover:bg-[#4d5154] rounded-xl text-left transition-colors">
                  <div>
                    <p className="font-semibold text-sm">{room.title || 'Consultation Room'}</p>
                    <p className="text-xs text-gray-400 mt-0.5 capitalize">{room.status} · {room.kind || 'consultation'}</p>
                  </div>
                  <div className="flex items-center text-xs text-gray-400">
                    <Users size={14} className="mr-1" /> {room.participant_count || 0}
                    <LogIn size={14} className="ml-3 text-blue-400" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {loading && <div className="flex justify-center mt-4"><Loader size={24} className="animate-spin text-gray-400" /></div>}
      </div>
    </div>
  );
}

/* ---------- Main export ---------- */
export default function NGVideoCall() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const [phase, setPhase] = useState('pre'); // 'pre' | 'connecting' | 'call' | 'ended'
  const [room, setRoom] = useState(null);          // conference room record
  const [livekitRoom, setLivekitRoom] = useState(null);  // livekit-client Room instance
  const [sfuAvailable, setSfuAvailable] = useState(null); // null=unknown, true, false
  const [connectError, setConnectError] = useState('');

  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [activePanel, setActivePanel] = useState('vitals');

  const [remoteParticipants, setRemoteParticipants] = useState([]);
  const [remoteTracks, setRemoteTracks] = useState({}); // participantId -> videoTrack

  const [hr, setHr] = useState(72);
  const [timeString, setTimeString] = useState('');
  const [messages, setMessages] = useState([]);
  const [roomId, setRoomId] = useState(null);

  const displayName = user ? `Dr. ${user.last_name || user.lastName || user.name || 'Provider'}` : 'Dr. Provider';
  const initials = user
    ? `${(user.first_name || user.firstName || 'D')[0]}${(user.last_name || user.lastName || 'R')[0]}`.toUpperCase()
    : 'DR';

  // Clock
  useEffect(() => {
    const u = () => setTimeString(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    u(); const t = setInterval(u, 10000); return () => clearInterval(t);
  }, []);

  // HR simulation
  useEffect(() => {
    const t = setInterval(() => setHr(p => Math.min(78, Math.max(68, p + Math.floor(Math.random() * 5) - 2))), 2000);
    return () => clearInterval(t);
  }, []);

  // Poll chat messages once in a room
  useEffect(() => {
    if (!roomId) return;
    const poll = setInterval(() => {
      api.getChat(roomId).then(d => {
        if (d.messages?.length) {
          setMessages(d.messages.map(m => ({
            sender: m.participant_display_name || m.user_id || 'Participant',
            text: m.body,
            time: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          })));
        }
      }).catch(() => {});
    }, 5000);
    return () => clearInterval(poll);
  }, [roomId]);

  const handleJoin = useCallback(async (conferenceRoom) => {
    setRoom(conferenceRoom);
    setRoomId(conferenceRoom.id);
    setPhase('connecting');
    setConnectError('');

    try {
      // Ensure room is live
      if (conferenceRoom.status === 'scheduled') {
        await api.startRoom(conferenceRoom.id);
      }

      // Register participation
      await api.joinRoom(conferenceRoom.id, displayName).catch(() => {});

      // Try to get LiveKit token
      const tokenRes = await api.getToken(conferenceRoom.id, displayName);

      if (!tokenRes.ok || tokenRes.code === 'SFU_NOT_CONFIGURED') {
        // LiveKit not configured — fall back to getUserMedia-only preview
        setSfuAvailable(false);
        setPhase('call');
        return;
      }

      setSfuAvailable(true);

      // Dynamically import livekit-client (avoids SSR issues)
      const { Room: LKRoom, RoomEvent, Track, createLocalVideoTrack, createLocalAudioTrack } = await import('livekit-client');

      const lkRoom = new LKRoom({
        adaptiveStream: true,
        dynacast: true,
      });

      // Remote participant handlers
      const updateParticipants = () => {
        const parts = Array.from(lkRoom.remoteParticipants.values());
        setRemoteParticipants(parts);
        const tracks = {};
        parts.forEach(p => {
          const vPub = Array.from(p.videoTrackPublications.values()).find(pub => pub.track && pub.source === Track.Source.Camera);
          if (vPub?.track) tracks[p.identity] = vPub.track;
        });
        setRemoteTracks(tracks);
      };

      lkRoom
        .on(RoomEvent.TrackSubscribed, updateParticipants)
        .on(RoomEvent.TrackUnsubscribed, updateParticipants)
        .on(RoomEvent.ParticipantConnected, updateParticipants)
        .on(RoomEvent.ParticipantDisconnected, updateParticipants)
        .on(RoomEvent.Disconnected, () => { setPhase('ended'); });

      await lkRoom.connect(tokenRes.livekitUrl, tokenRes.token);

      // Publish camera + mic
      try {
        const [videoTrack, audioTrack] = await Promise.all([
          createLocalVideoTrack(),
          createLocalAudioTrack(),
        ]);
        await lkRoom.localParticipant.publishTrack(videoTrack);
        await lkRoom.localParticipant.publishTrack(audioTrack);
      } catch (mediaErr) {
        console.warn('[NGVideoCall] media publish error:', mediaErr.message);
      }

      setLivekitRoom(lkRoom);
      setPhase('call');
    } catch (err) {
      console.error('[NGVideoCall] connect error:', err);
      setConnectError(err.message);
      setSfuAvailable(false);
      setPhase('call'); // still show camera-only UI
    }
  }, [displayName]);

  // Mute / video toggle via LiveKit
  const toggleMute = async () => {
    if (livekitRoom) {
      await livekitRoom.localParticipant.setMicrophoneEnabled(isMuted);
    }
    setIsMuted(!isMuted);
  };

  const toggleVideo = async () => {
    if (livekitRoom) {
      await livekitRoom.localParticipant.setCameraEnabled(isVideoOff);
    }
    setIsVideoOff(!isVideoOff);
  };

  const endCall = async () => {
    if (livekitRoom) { livekitRoom.disconnect(); }
    if (roomId) { api.endRoom(roomId).catch(() => {}); }
    setPhase('ended');
  };

  const sendMessage = (text) => {
    setMessages(prev => [...prev, {
      sender: 'You',
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }]);
  };

  const togglePanel = (panel) => setActivePanel(p => p === panel ? null : panel);

  // Auto-join if roomId in query param
  useEffect(() => {
    const qRoom = searchParams?.get('room');
    if (qRoom && phase === 'pre') {
      api.getRooms().then(d => {
        const found = (d.rooms || []).find(r => r.id === qRoom);
        if (found) handleJoin(found);
      }).catch(() => {});
    }
  }, [searchParams, phase, handleJoin]);

  /* ---- RENDER ---- */

  if (phase === 'pre') {
    return <PreCallScreen onJoin={handleJoin} displayName={displayName} />;
  }

  if (phase === 'connecting') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#202124] text-white">
        <Loader size={48} className="animate-spin text-blue-400 mb-6" />
        <p className="text-xl font-semibold">Connecting to room…</p>
        <p className="text-gray-400 mt-2 text-sm">{room?.title || 'Consultation'}</p>
      </div>
    );
  }

  if (phase === 'ended') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#202124] text-white">
        <h1 className="text-4xl font-light mb-4 text-gray-200">Consultation Ended</h1>
        {sfuAvailable === false && (
          <p className="text-sm text-amber-400 mb-6 text-center max-w-sm">
            LiveKit SFU was not configured — session ran in local-preview mode.
          </p>
        )}
        <div className="flex space-x-4">
          <button onClick={() => { setPhase('pre'); setLivekitRoom(null); setRoom(null); setRemoteParticipants([]); setRemoteTracks({}); }}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-lg">
            New Call
          </button>
          <button onClick={() => router.push('/ng/provider/dashboard')}
            className="px-6 py-2.5 bg-[#3c4043] hover:bg-[#4d5154] text-white font-medium rounded-lg">
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // phase === 'call'
  const firstRemote = remoteParticipants[0];
  const firstRemoteTrack = firstRemote ? remoteTracks[firstRemote.identity] : null;

  return (
    <div className="fixed inset-0 z-50 flex h-screen w-screen bg-[#202124] overflow-hidden text-white">
      <div className="flex flex-col flex-1 min-w-0">

        {/* Header badges */}
        <div className="absolute top-6 left-6 z-10 flex space-x-3">
          <div className="bg-black/50 backdrop-blur-md border border-white/10 px-4 py-2 rounded-xl flex items-center shadow-lg">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse mr-3" />
            <span className="text-sm font-semibold tracking-wide">SECURE · DOCTARX NG</span>
          </div>
          {sfuAvailable === true && (
            <div className="bg-black/50 backdrop-blur-md border border-green-500/30 px-3 py-2 rounded-xl flex items-center text-green-400 text-xs font-bold">
              <Wifi size={14} className="mr-2" /> LiveKit SFU
            </div>
          )}
          {sfuAvailable === false && (
            <div className="bg-black/50 backdrop-blur-md border border-amber-500/30 px-3 py-2 rounded-xl flex items-center text-amber-400 text-xs font-bold">
              <WifiOff size={14} className="mr-2" /> Local Preview
            </div>
          )}
        </div>

        {/* Video grid */}
        <div className="flex-1 p-4 md:p-6 flex items-center justify-center min-h-0 overflow-hidden">
          <div className="w-full h-full max-w-7xl grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 auto-rows-fr">
            <RemoteVideoTile participant={firstRemote} track={firstRemoteTrack} hr={hr} />
            <LocalVideoTile isVideoOff={isVideoOff} isMuted={isMuted} displayName={displayName} initials={initials} livekitRoom={livekitRoom} />
          </div>
        </div>

        {/* Controls */}
        <div className="h-24 w-full flex items-center justify-between px-6 md:px-8 bg-[#202124]">
          <div className="hidden md:flex items-center text-sm font-medium text-gray-300">
            {timeString} <span className="mx-3 text-gray-600">|</span>
            {room?.title || 'DoctaRx Nigeria'}
          </div>

          <div className="flex items-center space-x-3 md:space-x-4 mx-auto md:mx-0">
            <CtrlBtn active={isMuted} onClick={toggleMute} icon={Mic} activeIcon={MicOff} />
            <CtrlBtn active={isVideoOff} onClick={toggleVideo} icon={Video} activeIcon={VideoOff} />
            <CtrlBtn active={false} icon={MonitorUp} activeIcon={MonitorUp} />
            <CtrlBtn active={false} icon={MoreVertical} activeIcon={MoreVertical} />
            <button onClick={endCall}
              className="w-16 md:w-20 h-12 ml-2 bg-[#ea4335] hover:bg-[#d93025] flex items-center justify-center rounded-full shadow-lg">
              <PhoneOff size={22} className="text-white" />
            </button>
          </div>

          <div className="hidden md:flex items-center space-x-2">
            <SideBtn panelName="vitals" currentPanel={activePanel} onClick={togglePanel} icon={Activity} />
            <SideBtn panelName="notes" currentPanel={activePanel} onClick={togglePanel} icon={Sparkles} />
            <SideBtn panelName="chat" currentPanel={activePanel} onClick={togglePanel} icon={MessageSquare} />
          </div>
        </div>
      </div>

      {/* Sidebar */}
      {activePanel && (
        <div className="w-[420px] h-screen bg-white shadow-2xl flex flex-col z-20 border-l border-gray-200 shrink-0">
          <div className="h-20 flex items-center justify-between px-6 border-b border-gray-200 bg-white text-gray-900">
            <h2 className="font-bold text-lg">
              {activePanel === 'vitals' ? 'Clinical Dashboard' : activePanel === 'notes' ? 'AI Notes' : 'Chat'}
            </h2>
            <button onClick={() => setActivePanel(null)} className="p-2 text-gray-500 hover:bg-gray-100 rounded-full">
              <ChevronRight size={20} />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            {activePanel === 'vitals' && <VitalsPanel hr={hr} remoteParticipants={remoteParticipants} />}
            {activePanel === 'notes' && <NotesPanel messages={messages} hr={hr} />}
            {activePanel === 'chat' && <ChatPanel messages={messages} onSend={sendMessage} roomId={roomId} />}
          </div>
        </div>
      )}
    </div>
  );
}
