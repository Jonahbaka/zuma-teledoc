'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import {
  Mic, MicOff, Video as VideoIcon, VideoOff,
  PhoneOff, ShieldCheck, User,
  MessageSquare, Sparkles, X, Calendar, Clock,
  ArrowLeft, FileText, Save, Loader2, ClipboardList, Brain,
  Bot, HeartPulse
} from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { formatDateTime, formatTime } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';
import LiveCaptionsOverlay from '@/components/video/LiveCaptionsOverlay';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';
import ClinicalCoPilot from '@/components/hive/ClinicalCoPilot';
import { resolveProviderMarket, toProviderPortalPath } from '@/lib/providerPortal';
import useTelehealthSession from '@/lib/useTelehealthSession';

/* ─────────────────── constants ─────────────────── */

const CONSULTATION_CHECKLIST = [
  { type: 'insight', text: 'Confirm symptom duration, onset, and progression.' },
  { type: 'action', text: 'Review current medications, allergies, and recent changes.' },
  { type: 'alert', text: 'Document red flags or escalation triggers before closing the visit.' },
];

const getRawPatientName = (appointment) =>
  `${appointment?.patientFirstName || ''} ${appointment?.patientLastName || ''}`.trim();

const getPatientDisplayName = (appointment) =>
  getRawPatientName(appointment) || 'On-demand care session';

const getPatientInitials = (appointment) => {
  const firstInitial = appointment?.patientFirstName?.[0] || '';
  const lastInitial = appointment?.patientLastName?.[0] || '';
  const initials = `${firstInitial}${lastInitial}`.toUpperCase();
  return initials || 'VC';
};

const getWaitingRoomCopy = (appointment) =>
  getRawPatientName(appointment)
    ? `${getRawPatientName(appointment)} can join the waiting room at any time`
    : 'A patient can join the waiting room at any time';

const FILTER_OPTIONS = [
  { id: 'none', label: 'None', css: 'none' },
  { id: 'warm', label: 'Warm', css: 'saturate(110%) sepia(8%)' },
  { id: 'cool', label: 'Cool', css: 'saturate(105%) hue-rotate(8deg)' },
  { id: 'vivid', label: 'Vivid', css: 'saturate(130%) contrast(108%)' },
  { id: 'soft', label: 'Soft Focus', css: 'brightness(105%) contrast(95%) saturate(95%)' },
  { id: 'mono', label: 'Monochrome', css: 'grayscale(100%) contrast(105%)' },
];

/* ═══════════════════════════════════════════════════════════════════ */
/*                          PAGE                                      */
/* ═══════════════════════════════════════════════════════════════════ */

export default function ProviderVideoCallPage() {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const appointmentId = params.id;
  const isStandalone = appointmentId === 'standalone';
  const isNigeriaPortal = resolveProviderMarket({ pathname, user }) === 'NG';
  const complianceLabel = isNigeriaPortal ? 'NDPA aligned' : 'HIPAA encrypted';

  const [appointment, setAppointment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isInCall, setIsInCall] = useState(false);
  const [userName, setUserName] = useState('');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const {
    callError,
    connectionStatus,
    ensureLocalStream,
    joinCall,
    leaveCall,
    localStream,
    mediaError,
    mediaWarning,
    remoteParticipant,
    remoteStream
  } = useTelehealthSession({ appointmentId: isStandalone ? null : appointmentId });

  /* ── Load appointment ── */
  useEffect(() => {
    if (isStandalone) {
      setAppointment({
        id: 'standalone', type: 'video', status: 'in_progress',
        patientFirstName: '', patientLastName: '',
        providerFirstName: user?.firstName || '', providerLastName: user?.lastName || '',
        scheduledAt: new Date().toISOString(), durationMinutes: 30,
        reasonForVisit: 'Direct care video session'
      });
      if (user?.firstName) setUserName(`Dr. ${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`);
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await api.get(`/appointments/${appointmentId}`);
        if (res.data.success) {
          setAppointment(res.data.appointment);
          if (res.data.appointment.providerFirstName)
            setUserName(`Dr. ${res.data.appointment.providerFirstName} ${res.data.appointment.providerLastName}`);
        }
      } catch {
        toast({ title: 'Error', description: 'Failed to load appointment', variant: 'destructive' });
        router.push(toProviderPortalPath('/schedule', { pathname, user }));
      } finally { setLoading(false); }
    })();
  }, [appointmentId, isStandalone, pathname, router, user]);

  const startCall = async () => {
    if (!userName.trim()) return;
    setIsInCall(true);

    try {
      if (isStandalone) {
        if (camOn || micOn) {
          await ensureLocalStream();
        }
      } else {
        await joinCall({ displayName: userName });
      }
    } catch (error) {
      setIsInCall(false);
      toast({
        title: 'Unable to start call',
        description: error.message || 'Please allow camera and microphone access, then try again.',
        variant: 'destructive'
      });
    }
  };
  const endCall = async () => {
    await leaveCall();
    setIsInCall(false);
    router.push(isStandalone
      ? toProviderPortalPath('/dashboard', { pathname, user })
      : toProviderPortalPath(`/appointments/${appointmentId}/visit`, { pathname, user }));
  };

  /* ── Track controls to stream ── */
  useEffect(() => { if (localStream) localStream.getVideoTracks().forEach(t => { t.enabled = camOn; }); }, [localStream, camOn]);
  useEffect(() => { if (localStream) localStream.getAudioTracks().forEach(t => { t.enabled = micOn; }); }, [localStream, micOn]);
  useEffect(() => {
    if (!mediaWarning) return;
    toast({ title: 'Device fallback', description: mediaWarning });
  }, [mediaWarning]);
  useEffect(() => {
    if (isStandalone || !appointment?.id || connectionStatus !== 'connected' || appointment.status === 'in_progress') {
      return;
    }

    api.put(`/appointments/${appointment.id}`, { status: 'in_progress' })
      .then(() => {
        setAppointment((current) => current ? { ...current, status: 'in_progress' } : current);
      })
      .catch(() => {});
  }, [appointment?.id, appointment?.status, connectionStatus, isStandalone]);

  /* ── Loading / Not found ── */
  if (loading) return (
    <div className="min-h-screen bg-[#121212] flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-400 mx-auto mb-4" />
        <p className="text-gray-400">{isStandalone ? 'Preparing...' : 'Loading appointment...'}</p>
      </div>
    </div>
  );

  if (!appointment) return (
    <div className="min-h-screen bg-[#121212] flex items-center justify-center">
      <p className="text-gray-400 mb-4">Appointment not found</p>
      <Button onClick={() => router.push(toProviderPortalPath('/schedule', { pathname, user }))}>Back</Button>
    </div>
  );

  const patientDisplayName = getPatientDisplayName(appointment);
  const patientInitials = getPatientInitials(appointment);

  return (
    <div className="flex min-h-[100dvh] flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.16),transparent_20%),radial-gradient(circle_at_85%_0%,rgba(15,23,42,0.42),transparent_34%),linear-gradient(180deg,#020617,#0f172a_52%,#111827)] text-white font-sans selection:bg-blue-500/20">
      {/* ── Top Bar ── */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/72 px-4 pb-3 pt-[calc(0.7rem+env(safe-area-inset-top,0px))] backdrop-blur-xl sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon" className="h-11 w-11 rounded-2xl border border-white/10 bg-white/5 text-slate-100 hover:bg-white/10 hover:text-white"
            onClick={() => router.push(isStandalone
              ? toProviderPortalPath('/dashboard', { pathname, user })
              : toProviderPortalPath(`/appointments/${appointmentId}/visit`, { pathname, user }))}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex min-w-0 items-center gap-3">
            <span className="rounded-2xl border border-white/10 bg-slate-950/95 px-3 py-2 shadow-[0_0_20px_rgba(34,211,238,0.14)]">
              <DoctaRxLogo className="h-7 w-auto" />
            </span>
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white">
              {isStandalone ? 'Direct Care Session' : `Consultation with ${patientDisplayName}`}
            </div>
            <div className="flex items-center gap-1 text-xs text-slate-400">
              <ShieldCheck size={10} className="text-emerald-400" /> {complianceLabel} | Secure visit
            </div>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-3">
          {isInCall && <CallTimer />}
          <div className="hidden items-center gap-2 sm:flex">
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xs font-semibold text-slate-200">
              {patientInitials}
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-500/20 text-xs font-semibold text-cyan-50">
              {(appointment.providerFirstName?.[0] || 'D').toUpperCase()}{(appointment.providerLastName?.[0] || 'R').toUpperCase()}
            </div>
          </div>
        </div>
        </div>
      </header>

      {/* ── Main ── */}
      <div className="flex-1 min-h-0 flex flex-col">
        {!isInCall ? (
          <Lobby appointment={appointment} userName={userName} setUserName={setUserName}
            onJoin={startCall} micOn={micOn} setMicOn={setMicOn}
            camOn={camOn} setCamOn={setCamOn}
            localStream={localStream} ensureLocalStream={ensureLocalStream}
            mediaError={mediaError} />
        ) : (
          <ActiveCall appointment={appointment}
            micOn={micOn} toggleMic={() => setMicOn(v => !v)}
            camOn={camOn} toggleCam={() => setCamOn(v => !v)}
            onEndCall={endCall}
            localStream={localStream} ensureLocalStream={ensureLocalStream}
            remoteStream={remoteStream} remoteParticipant={remoteParticipant}
            connectionStatus={connectionStatus} callError={callError} />
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════ */
/*                          CALL TIMER                                */
/* ═══════════════════════════════════════════════════════════════════ */

const CallTimer = () => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => { const t = setInterval(() => setElapsed(e => e + 1), 1000); return () => clearInterval(t); }, []);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return (
    <div className="bg-gray-800/50 px-3 py-1 rounded-full text-xs font-mono text-gray-400 border border-gray-700">
      {m}:{s.toString().padStart(2, '0')}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════ */
/*                          LOBBY                                     */
/* ═══════════════════════════════════════════════════════════════════ */

const Lobby = ({
  appointment, userName, setUserName, onJoin, micOn, setMicOn, camOn, setCamOn,
  localStream, ensureLocalStream, mediaError
}) => {
  const patientDisplayName = getPatientDisplayName(appointment);

  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-5 gap-8 items-center">
      {/* Camera preview */}
      <div className="lg:col-span-3 bg-[#1e1e1e] rounded-2xl overflow-hidden border border-gray-800">
        <div className="aspect-video relative flex items-center justify-center bg-gray-800">
          {camOn ? <CameraPreview stream={localStream} ensureLocalStream={ensureLocalStream} mediaError={mediaError} /> : (
            <div className="flex flex-col items-center text-gray-400">
              <div className="w-20 h-20 rounded-full bg-[#5f6368] flex items-center justify-center mb-3">
                <User size={36} />
              </div>
              <span className="text-sm">Camera is off</span>
            </div>
          )}
          <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full text-xs flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${micOn ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
            {micOn ? 'Mic on' : 'Muted'}
          </div>
        </div>
        <div className="flex justify-center gap-3 py-4 bg-[#1e1e1e]">
          <ControlBtn icon={micOn ? Mic : MicOff} active={micOn} onClick={() => setMicOn(!micOn)} label={micOn ? 'Mute' : 'Unmute'} />
          <ControlBtn icon={camOn ? VideoIcon : VideoOff} active={camOn} onClick={() => setCamOn(!camOn)} label={camOn ? 'Stop Video' : 'Start Video'} />
        </div>
      </div>

      {/* Right panel */}
      <div className="lg:col-span-2 space-y-5">
        <h1 className="text-2xl font-semibold leading-snug">Ready to join?</h1>
        <p className="text-gray-400">
          Appointment with <span className="text-white font-medium">{patientDisplayName}</span>
        </p>

        <div className="bg-[#1e1e1e] rounded-xl p-4 space-y-3 text-sm border border-gray-800">
          <div className="flex items-center gap-3 text-gray-300">
            <Calendar className="w-4 h-4 text-blue-400 shrink-0" />
            <span>{formatDateTime(appointment.scheduledAt)}</span>
          </div>
          <div className="flex items-center gap-3 text-gray-300">
            <Clock className="w-4 h-4 text-blue-400 shrink-0" />
            <span>{appointment.durationMinutes || 30} minutes</span>
          </div>
          {appointment.reasonForVisit && (
            <p className="text-gray-500 text-xs border-t border-white/5 pt-2">{appointment.reasonForVisit}</p>
          )}
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1.5">Your name</label>
          <input value={userName} onChange={e => setUserName(e.target.value)} placeholder="Dr. Smith"
            className="w-full px-4 py-2.5 rounded-lg bg-[#1e1e1e] border border-gray-700 text-white placeholder-gray-500 outline-none focus:border-blue-400 transition-colors" />
        </div>

        <button onClick={onJoin} disabled={!userName.trim()}
          className="w-full py-3 rounded-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 font-medium transition-colors shadow-lg shadow-blue-900/20">
          Join now
        </button>

        <div className="flex items-center gap-2 text-xs text-gray-500">
          <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          <span>{getWaitingRoomCopy(appointment)}</span>
        </div>
      </div>
    </div>
  </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════ */
/*              CAMERA PREVIEW (Lobby)                                */
/* ═══════════════════════════════════════════════════════════════════ */

const CameraPreview = ({ stream, ensureLocalStream, mediaError }) => {
  const videoRef = useRef(null);
  const [starting, setStarting] = useState(false);

  const start = async () => {
    setStarting(true);
    try { await ensureLocalStream(); } finally { setStarting(false); }
  };

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  if (!stream && !mediaError) return (
    <div className="w-full h-full flex items-center justify-center bg-gray-800">
      <button onClick={start} className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-full text-sm font-medium transition-colors shadow-lg shadow-blue-900/20">
        {starting ? 'Starting camera...' : 'Enable camera'}
      </button>
    </div>
  );

  if (!stream && mediaError) return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-gray-800 text-center p-4">
      <VideoOff size={24} className="mb-2 text-gray-400" />
      <p className="text-xs text-gray-400 mb-2">{mediaError}</p>
      <button onClick={start} className="text-xs text-blue-400 hover:underline">Try again</button>
    </div>
  );

  return <video ref={videoRef} className="w-full h-full object-cover scale-x-[-1]" playsInline muted autoPlay />;
};

/* ═══════════════════════════════════════════════════════════════════ */
/*                     ACTIVE CALL                                    */
/* ═══════════════════════════════════════════════════════════════════ */

const ActiveCall = ({
  appointment, micOn, toggleMic, camOn, toggleCam, onEndCall,
  localStream, ensureLocalStream, remoteStream, remoteParticipant, connectionStatus, callError
}) => {
  const [showAI, setShowAI] = useState(false);
  const [sidebarTab, setSidebarTab] = useState('notes');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [filterStyle, setFilterStyle] = useState('none');
  const [lightingBoost, setLightingBoost] = useState(0);
  const [showEffects, setShowEffects] = useState(false);
  const [showCaptions, setShowCaptions] = useState(false);

  // Build composite CSS filter string
  const getCssFilter = () => {
    const parts = [];
    if (lightingBoost !== 0) parts.push(`brightness(${100 + lightingBoost}%)`);
    const f = FILTER_OPTIONS.find(o => o.id === filterStyle);
    if (f && f.css !== 'none') parts.push(f.css);
    return parts.join(' ') || 'none';
  };

  const remoteLabel = remoteParticipant?.name || getPatientDisplayName(appointment);
  const providerLabel = appointment.providerFirstName ? `Dr. ${appointment.providerFirstName}` : 'You';
  const stageStatus = callError
    ? 'Action needed'
    : connectionStatus === 'connected'
      ? 'Live now'
      : connectionStatus === 'connecting' || connectionStatus === 'reconnecting'
        ? 'Connecting'
        : 'Waiting room';

  const closePanels = () => {
    setShowAI(false);
    setIsSidebarOpen(false);
    setShowEffects(false);
  };

  const toggleNotesPanel = () => {
    setShowAI(false);
    setShowEffects(false);
    setSidebarTab('notes');
    setIsSidebarOpen((current) => !(current && sidebarTab === 'notes'));
  };

  const toggleChatPanel = () => {
    setShowAI(false);
    setShowEffects(false);
    setSidebarTab('chat');
    setIsSidebarOpen((current) => !(current && sidebarTab === 'chat'));
  };

  const toggleAiPanel = () => {
    setIsSidebarOpen(false);
    setShowEffects(false);
    setShowAI((current) => !current);
  };

  const toggleEffectsPanel = () => {
    setShowAI(false);
    setIsSidebarOpen(false);
    setShowEffects((current) => !current);
  };

  return (
    <div className="relative flex-1 min-h-0 overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.16),transparent_20%),radial-gradient(circle_at_bottom_right,rgba(34,197,94,0.14),transparent_24%),linear-gradient(180deg,#020617,#0f172a_52%,#111827)]">
      {(showAI || isSidebarOpen || showEffects) && (
        <button
          type="button"
          aria-label="Close panel"
          onClick={closePanels}
          className="absolute inset-0 z-20 bg-slate-950/55 backdrop-blur-[2px] lg:hidden"
        />
      )}

      {/* ── Video Stage ── */}
      <div className={`flex h-full min-h-0 transition-all duration-300 ${(showAI || isSidebarOpen) ? 'lg:pr-[22rem]' : ''}`}>

        {/* Main Stage Grid */}
        <div className="relative flex-1 min-h-0 px-3 pb-[calc(8.2rem+env(safe-area-inset-bottom,0px))] pt-3 sm:px-4 sm:pt-4">

          {/* Patient Feed (main, large) */}
          <div className="relative h-full overflow-hidden rounded-[1.9rem] border border-white/10 bg-black shadow-[0_34px_90px_rgba(2,6,23,0.52)]">
            <PatientVideoArea
              appointment={appointment}
              stream={remoteStream}
              participant={remoteParticipant}
              connectionStatus={connectionStatus}
              callError={callError}
            />

            <div className="absolute inset-x-3 top-3 z-10 flex items-start justify-between gap-3 sm:inset-x-5 sm:top-5">
              <div className="max-w-[17rem] rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-white shadow-lg backdrop-blur-xl">
                <h3 className="text-sm font-semibold">{remoteLabel}</h3>
                <p className="mt-1 text-xs leading-5 text-slate-300">
                  {callError
                    ? callError
                    : appointment.reasonForVisit || 'Consultation in progress'}
                </p>
              </div>

              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/45 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-200 backdrop-blur-xl">
                <span className={`h-2 w-2 rounded-full ${connectionStatus === 'connected' ? 'bg-emerald-400' : callError ? 'bg-rose-400' : 'bg-amber-300 animate-pulse'}`} />
                {stageStatus}
              </div>
            </div>

            <div className="absolute right-3 top-3 z-10 w-[7.4rem] overflow-hidden rounded-[1.35rem] border border-white/10 bg-slate-900 shadow-[0_18px_50px_rgba(2,6,23,0.38)] sm:w-40 md:right-5 md:top-5 md:w-48 lg:bottom-6 lg:right-6 lg:top-auto">
              <div className="relative aspect-[4/5] sm:aspect-video">
                <SelfView
                  stream={localStream}
                  ensureLocalStream={ensureLocalStream}
                  camOn={camOn}
                  micOn={micOn}
                  userName={providerLabel}
                  cssFilter={getCssFilter()}
                />
              </div>
            </div>

            <LiveCaptionsOverlay
              enabled={showCaptions}
              speakerLabel={providerLabel}
              defaultTargetLang={(typeof navigator !== 'undefined' && navigator.language) ? navigator.language : 'en-US'}
            />
          </div>

        </div>
      </div>

      {/* ── AI Sidebar (Hive Clinical Co-Pilot) ── */}
      {showAI && (
        <div className="fixed inset-x-0 bottom-0 z-50 flex max-h-[78vh] flex-col overflow-hidden rounded-t-[1.8rem] border border-white/10 bg-slate-950/96 text-white shadow-[0_26px_60px_rgba(2,6,23,0.58)] backdrop-blur-2xl lg:absolute lg:inset-y-0 lg:right-0 lg:left-auto lg:max-h-none lg:w-[22rem] lg:rounded-none lg:border-y-0 lg:border-r-0 lg:border-l">
          <div className="mx-auto mt-3 h-1.5 w-14 rounded-full bg-white/15 lg:hidden" />
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Clinical Co-Pilot</h3>
              <p className="mt-1 text-xs text-slate-400">Decision support stays alongside the live visit.</p>
            </div>
            <button
              onClick={() => setShowAI(false)}
              className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <ClinicalCoPilot
              appointmentId={appointment?.id}
              patientId={appointment?.patientId}
              patientName={getPatientDisplayName(appointment)}
            />
          </div>
        </div>
      )}

      {/* ── Notes/Chat Sidebar ── */}
      {isSidebarOpen && (
        <div className="fixed inset-x-0 bottom-0 z-50 flex max-h-[78vh] flex-col overflow-hidden rounded-t-[1.8rem] border border-white/10 bg-slate-950/96 text-white shadow-[0_26px_60px_rgba(2,6,23,0.58)] backdrop-blur-2xl lg:absolute lg:inset-y-0 lg:right-0 lg:left-auto lg:max-h-none lg:w-[22rem] lg:rounded-none lg:border-y-0 lg:border-r-0 lg:border-l">
          <div className="mx-auto mt-3 h-1.5 w-14 rounded-full bg-white/15 lg:hidden" />
          <div className="flex border-b border-white/10">
            <SidebarTabBtn label="Notes" icon={FileText} active={sidebarTab === 'notes'} onClick={() => setSidebarTab('notes')} />
            <SidebarTabBtn label="Chat" icon={MessageSquare} active={sidebarTab === 'chat'} onClick={() => setSidebarTab('chat')} />
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="px-4 text-slate-400 transition-colors hover:text-white"
            >
              <X size={16} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {sidebarTab === 'notes' && <LiveNotesPanel appointment={appointment} />}
            {sidebarTab === 'chat' && <ChatPanel appointment={appointment} />}
          </div>
        </div>
      )}

      {/* ── Effects Panel ── */}
      {showEffects && (
        <EffectsPanel
          filterStyle={filterStyle} setFilterStyle={setFilterStyle}
          lightingBoost={lightingBoost} setLightingBoost={setLightingBoost}
          onClose={() => setShowEffects(false)}
        />
      )}

      {/* ── Bottom Control Bar ── */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 px-3 pb-[calc(0.9rem+env(safe-area-inset-bottom,0px))] pt-6 sm:px-4">
        <div className="pointer-events-auto mx-auto flex w-full max-w-[31rem] flex-wrap items-center justify-center gap-2 rounded-[1.9rem] border border-white/10 bg-slate-950/82 px-3 py-3 shadow-[0_26px_60px_rgba(2,6,23,0.54)] backdrop-blur-2xl sm:gap-3 sm:px-4">
          <ControlBtn icon={micOn ? Mic : MicOff} active={micOn} onClick={toggleMic} label={micOn ? 'Mute' : 'Unmute'} color={micOn ? 'primary' : 'danger'} />
          <ControlBtn icon={camOn ? VideoIcon : VideoOff} active={camOn} onClick={toggleCam} label={camOn ? 'Stop Video' : 'Start Video'} color={camOn ? 'primary' : 'danger'} />
          <ControlBtn icon={FileText} label="Captions" color={showCaptions ? 'primary' : 'glass'} onClick={() => setShowCaptions(!showCaptions)} />
          <ControlBtn icon={ClipboardList} label="Visit Notes" color={isSidebarOpen && sidebarTab === 'notes' ? 'primary' : 'glass'} onClick={toggleNotesPanel} />
          <ControlBtn icon={MessageSquare} label="Chat" color={isSidebarOpen && sidebarTab === 'chat' ? 'primary' : 'glass'} onClick={toggleChatPanel} />
          <ControlBtn icon={Bot} label="AI Assistant" color={showAI ? 'primary' : 'glass'} onClick={toggleAiPanel} />
          <ControlBtn icon={Sparkles} active={showEffects} onClick={toggleEffectsPanel} label="Effects" color={showEffects ? 'primary' : 'glass'} />
          <button
            onClick={onEndCall}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-500 text-white shadow-[0_18px_42px_rgba(244,63,94,0.42)] transition-all hover:bg-rose-400"
            title="Leave call"
          >
            <PhoneOff size={20} />
          </button>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════ */
/*                   PATIENT VIDEO AREA                               */
/* ═══════════════════════════════════════════════════════════════════ */

const PatientVideoArea = ({ appointment, stream, participant, connectionStatus, callError }) => {
  const patientDisplayName = getPatientDisplayName(appointment);
  const patientInitials = getPatientInitials(appointment);
  const videoRef = useRef(null);
  const remoteLabel = participant?.name || patientDisplayName;
  const statusCopy = callError
    ? callError
    : connectionStatus === 'connected'
      ? 'Connected'
      : connectionStatus === 'connecting' || connectionStatus === 'reconnecting'
        ? 'Connecting to patient...'
        : 'Waiting for patient to join...';

  useEffect(() => {
    if (!videoRef.current) {
      return;
    }

    videoRef.current.srcObject = stream || null;

    if (stream) {
      videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  return (
    <div className="relative w-full h-full bg-gray-800 rounded-2xl overflow-hidden shadow-2xl border border-gray-700 group">
    {/* Patient placeholder — when WebRTC connects, replace with real stream */}
    {stream ? (
      <video
        ref={videoRef}
        className="w-full h-full object-cover bg-black"
        autoPlay
        playsInline
      />
    ) : (
      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900">
        <div className="text-center px-6">
          <div className="w-28 h-28 mx-auto rounded-full bg-[#5f6368] flex items-center justify-center mb-5 shadow-xl">
            <span className="text-4xl font-medium text-white">{patientInitials}</span>
          </div>
          <h2 className="text-xl font-medium mb-2 text-white">
            {patientDisplayName}
          </h2>
          <div className="flex items-center justify-center gap-2 text-gray-400 text-sm">
            <div className={`w-2 h-2 rounded-full ${callError ? 'bg-red-400' : 'bg-amber-400 animate-pulse'}`} />
            {statusCopy}
          </div>
        </div>
      </div>
    )}

    {/* AI Vitals Overlay (for when patient joins — decorative for now) */}
    <div className="absolute top-4 left-4 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
      <div className="bg-black/40 backdrop-blur-md p-2 rounded-lg border border-white/10 flex items-center gap-2">
        <HeartPulse size={14} className="text-rose-500" />
        <span className="text-[10px] font-mono text-gray-400">Awaiting vitals...</span>
      </div>
    </div>

    {/* Name Tag */}
    <div className="absolute bottom-4 left-4 flex items-center gap-2">
      <div className="bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full flex items-center gap-2 border border-white/5">
        <span className="text-white text-sm font-medium">{remoteLabel}</span>
        <span className="text-xs text-blue-300 bg-blue-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider">Patient</span>
      </div>
    </div>

    {/* Encryption badge */}
    <div className="absolute top-4 right-4">
      <div className="bg-black/40 backdrop-blur-md px-2 py-1 rounded-full flex items-center gap-1 border border-white/10">
        <ShieldCheck size={10} className="text-emerald-500" />
        <span className="text-[10px] text-gray-400">{connectionStatus === 'connected' ? 'Live' : 'Secure'}</span>
      </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════ */
/*              SELF VIEW (Provider camera — real feed)                */
/* ═══════════════════════════════════════════════════════════════════ */

const SelfView = ({ stream, ensureLocalStream, camOn, micOn, userName, cssFilter }) => {
  const videoRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = stream || await ensureLocalStream();
        if (cancelled || !videoRef.current) return;
        videoRef.current.srcObject = s;
        videoRef.current.play().catch(() => {});
        setReady(true);
      } catch {
        if (!cancelled) setReady(false);
      }
    })();
    return () => { cancelled = true; };
  }, [stream, ensureLocalStream]);

  const isTalking = micOn; // simplified indicator

  return (
    <div className={`relative w-full h-full bg-gray-800 rounded-2xl overflow-hidden shadow-2xl border transition-all duration-300 ${isTalking ? 'border-blue-500/40 shadow-[inset_0_0_20px_rgba(59,130,246,0.15)]' : 'border-gray-700'}`}>
      {/* Always-mounted video element */}
      <video
        ref={videoRef}
        className={`w-full h-full object-cover scale-x-[-1] ${camOn && ready ? 'opacity-100' : 'opacity-0'}`}
        style={{ filter: cssFilter !== 'none' ? cssFilter : undefined }}
        playsInline muted autoPlay
      />

      {/* Camera off / loading overlay */}
      {(!camOn || !ready) && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
          {!camOn ? (
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-[#5f6368] flex items-center justify-center mx-auto mb-2">
                <User size={24} className="text-gray-300" />
              </div>
              <p className="text-xs text-gray-400">Camera off</p>
            </div>
          ) : (
            <div className="text-center">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-400 mx-auto mb-2" />
              <p className="text-[10px] text-gray-500">Starting camera...</p>
            </div>
          )}
        </div>
      )}

      {/* Speaking indicator ring */}
      <div className={`absolute inset-0 border-4 rounded-2xl pointer-events-none transition-all duration-300 ${isTalking ? 'border-blue-500/30' : 'border-transparent'}`} />

      {/* Name Tag */}
      <div className="absolute bottom-3 left-3 flex items-center gap-2">
        <div className="bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full flex items-center gap-2 border border-white/5">
          <span className="text-white text-sm font-medium">{userName}</span>
          <span className="text-xs text-blue-300 bg-blue-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider">Provider</span>
        </div>
        {!micOn && (
          <div className="bg-red-500/80 p-1.5 rounded-full text-white">
            <MicOff size={12} />
          </div>
        )}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════ */
/*                  AI AGENT SIDEBAR                                  */
/* ═══════════════════════════════════════════════════════════════════ */

const AIAgentSidebar = ({ appointment, transcript, isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState('insight');
  const [soapData, setSoapData] = useState(null);
  const [soapLoading, setSoapLoading] = useState(false);

  const generateSOAP = async () => {
    setSoapLoading(true);
    try {
      const res = await api.post('/ai-assist/soap', {
        appointmentId: appointment.id,
        chiefComplaint: appointment.reasonForVisit || 'General consultation',
        symptoms: appointment.reasonForVisit || '', existingConditions: '', medications: ''
      });
      if (res.data.success) {
        setSoapData(res.data.suggestion);
        toast({ title: 'AI Notes', description: 'SOAP notes generated' });
      }
    } catch {
      toast({ title: 'AI Failed', description: 'Could not generate notes', variant: 'destructive' });
    } finally { setSoapLoading(false); }
  };

  if (!isOpen) return null;

  return (
    <div className="w-80 h-full bg-[#1a1a1a] border-l border-gray-800 flex flex-col z-20 absolute right-0 top-0 shadow-2xl animate-slide-in-right">
      {/* Header */}
      <div className="p-4 border-b border-gray-800 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-gradient-to-tr from-blue-500 to-purple-600 rounded-lg">
            <Bot size={18} className="text-white" />
          </div>
          <div>
            <h3 className="text-white font-semibold text-sm">DoctaRx AI</h3>
            <span className="text-xs text-green-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" /> Available
            </span>
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white p-1 hover:bg-gray-800 rounded-full">
          <X size={18} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800">
        <button onClick={() => setActiveTab('insight')}
          className={`flex-1 py-3 text-xs font-medium transition-colors ${activeTab === 'insight' ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-500/5' : 'text-gray-400 hover:text-white'}`}>
          Visit Guide
        </button>
        <button onClick={() => setActiveTab('notes')}
          className={`flex-1 py-3 text-xs font-medium transition-colors ${activeTab === 'notes' ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-500/5' : 'text-gray-400 hover:text-white'}`}>
          SOAP Notes
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {activeTab === 'insight' && (
          <>
            {/* Session guide */}
            <div className="bg-gray-800/50 p-3 rounded-xl border border-gray-700 space-y-2">
              <div className="text-xs text-gray-400">Session setup</div>
              <p className="text-xs text-gray-300 leading-relaxed">
                Use this panel as a documentation checklist while you confirm identity, safety concerns,
                medications, and the reason for visit.
              </p>
            </div>

            {/* Suggestions */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Consultation checklist</h4>
              {CONSULTATION_CHECKLIST.map((item, idx) => (
                <div key={idx} className="bg-gray-800 p-3 rounded-xl border border-gray-700 hover:border-blue-500/50 transition-colors group cursor-pointer">
                  <div className="flex items-start gap-3">
                    {item.type === 'alert' ? <ShieldCheck size={16} className="text-red-400 mt-0.5" /> : <Sparkles size={16} className="text-blue-400 mt-0.5" />}
                    <div>
                      <p className="text-sm text-gray-200 leading-snug">{item.text}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Real-time context */}
            <div className="bg-blue-500/10 p-3 rounded-xl border border-blue-500/20 space-y-2">
              <div className="flex items-center gap-2 text-xs text-blue-300">
                <Brain size={14} /> Documentation note
              </div>
              <p className="text-xs text-blue-200/80 leading-relaxed">
                SOAP generation and Clinical Co-Pilot outputs depend on captured visit data.
                This guide is reference-only and should not be treated as live clinical analysis.
              </p>
            </div>
          </>
        )}

        {activeTab === 'notes' && (
          <div className="space-y-4">
            {soapData ? (
              <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                    <FileText size={14} className="text-purple-400" /> Auto-SOAP
                  </h4>
                  <button className="text-[10px] bg-purple-500/20 text-purple-300 px-2 py-1 rounded hover:bg-purple-500/30">
                    Export to EHR
                  </button>
                </div>
                <div className="space-y-3">
                  {[
                    { label: 'Subjective', text: soapData.subjective },
                    { label: 'Objective', text: soapData.objective },
                    { label: 'Assessment', text: soapData.assessment },
                    { label: 'Plan', text: soapData.plan }
                  ].map(s => (
                    <div key={s.label}>
                      <label className="text-[10px] text-gray-500 font-bold uppercase">{s.label}</label>
                      <p className="text-xs text-gray-300 mt-1 leading-relaxed">{s.text || '—'}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <Brain size={32} className="mx-auto text-gray-600 mb-3" />
                <p className="text-sm text-gray-400 mb-1">No AI notes yet</p>
                <p className="text-xs text-gray-600 mb-4">Generate SOAP notes from the consultation context</p>
              </div>
            )}

            <button onClick={generateSOAP} disabled={soapLoading}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors shadow-lg shadow-blue-900/20 disabled:opacity-50 flex items-center justify-center gap-2">
              {soapLoading ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />}
              {soapLoading ? 'Generating...' : soapData ? 'Regenerate Summary' : 'Generate SOAP Notes'}
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-gray-800 text-center">
        <span className="text-[10px] text-gray-600">DoctaRx AI &middot; Secure clinical workspace &middot; Not a diagnosis</span>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #374151; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #4B5563; }
        @keyframes slide-in-right {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in-right { animation: slide-in-right 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
      `}</style>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════ */
/*                   EFFECTS PANEL                                    */
/* ═══════════════════════════════════════════════════════════════════ */

const EffectsPanel = ({ filterStyle, setFilterStyle, lightingBoost, setLightingBoost, onClose }) => (
  <div className="fixed inset-x-4 bottom-[calc(6.4rem+env(safe-area-inset-bottom,0px))] z-50 max-h-[min(68vh,34rem)] overflow-y-auto rounded-[1.6rem] border border-white/10 bg-slate-950/96 p-5 text-white shadow-[0_30px_80px_rgba(2,6,23,0.6)] backdrop-blur-2xl lg:absolute lg:inset-x-auto lg:bottom-[calc(7.6rem+env(safe-area-inset-bottom,0px))] lg:left-1/2 lg:w-[24rem] lg:-translate-x-1/2">
    <div className="flex justify-between items-center mb-4">
      <h3 className="font-medium text-white text-sm">Visual Effects</h3>
      <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={16} /></button>
    </div>

    {/* Filter grid */}
    <div className="space-y-3 mb-4">
      <label className="text-xs text-gray-400 block">Color Filter</label>
      <div className="grid grid-cols-3 gap-2">
        {FILTER_OPTIONS.map(opt => (
          <button key={opt.id} onClick={() => setFilterStyle(opt.id)}
            className={`px-3 py-2 text-xs rounded-lg border transition-all ${
              filterStyle === opt.id
                ? 'border-blue-400 bg-blue-400/10 text-blue-300'
                : 'border-gray-700 bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
            }`}>
            {opt.label}
          </button>
        ))}
      </div>
    </div>

    {/* Lighting slider */}
    <div>
      <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
        <span>Lighting Boost</span>
        <span className="font-mono">{lightingBoost > 0 ? `+${lightingBoost}` : lightingBoost}%</span>
      </div>
      <input type="range" min="-20" max="40" step="5" value={lightingBoost}
        onChange={e => setLightingBoost(Number(e.target.value))}
        className="w-full accent-blue-500" />
    </div>

    <p className="text-[10px] text-gray-600 mt-4 text-center">
      Filters are applied in real-time to your camera feed
    </p>
  </div>
);

/* ═══════════════════════════════════════════════════════════════════ */
/*                   LIVE NOTES PANEL                                 */
/* ═══════════════════════════════════════════════════════════════════ */

const LiveNotesPanel = ({ appointment }) => {
  const [notes, setNotes] = useState({
    chiefComplaint: appointment.reasonForVisit || '',
    subjective: '', objective: '', assessment: '', plan: '', freeform: ''
  });
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [section, setSection] = useState('freeform');
  const notesRef = useRef(notes);
  notesRef.current = notes;

  useEffect(() => {
    const id = setInterval(() => {
      const n = notesRef.current;
      if (n.freeform || n.subjective || n.objective || n.assessment || n.plan) saveNotes(true);
    }, 30000);
    return () => clearInterval(id);
  }, []);

  const saveNotes = async (silent = false) => {
    setSaving(true);
    try {
      if (appointment.id && appointment.id !== 'standalone') {
        await api.post('/visits', {
          appointmentId: appointment.id, chiefComplaint: notes.chiefComplaint,
          subjective: notes.subjective || notes.freeform, objective: notes.objective,
          assessment: notes.assessment, plan: notes.plan, status: 'in_progress'
        }).catch(() => api.put(`/visits/appointment/${appointment.id}`, {
          chiefComplaint: notes.chiefComplaint, subjective: notes.subjective || notes.freeform,
          objective: notes.objective, assessment: notes.assessment, plan: notes.plan
        }));
      }
      setLastSaved(new Date());
      if (!silent) toast({ title: 'Saved', description: 'Visit notes saved' });
    } catch { if (!silent) toast({ title: 'Error', description: 'Could not save', variant: 'destructive' }); }
    finally { setSaving(false); }
  };

  const generateSOAP = async () => {
    setAiLoading(true);
    try {
      const res = await api.post('/ai-assist/soap', {
        appointmentId: appointment.id, chiefComplaint: notes.chiefComplaint,
        symptoms: notes.freeform || notes.chiefComplaint, existingConditions: '', medications: ''
      });
      if (res.data.success) {
        const s = res.data.suggestion;
        setNotes(p => ({ ...p, subjective: s.subjective || p.subjective, objective: s.objective || p.objective,
          assessment: s.assessment || p.assessment, plan: s.plan || p.plan }));
        setSection('soap');
        toast({ title: 'AI Notes', description: 'SOAP notes generated — review and edit' });
      }
    } catch { toast({ title: 'AI Failed', description: 'Could not generate notes', variant: 'destructive' }); }
    finally { setAiLoading(false); }
  };

  const upd = (k, v) => setNotes(p => ({ ...p, [k]: v }));
  const soaps = [
    { k: 'subjective', l: 'S — Subjective', ph: 'Patient reports...' },
    { k: 'objective', l: 'O — Objective', ph: 'Vitals, exam findings...' },
    { k: 'assessment', l: 'A — Assessment', ph: 'Diagnosis, impression...' },
    { k: 'plan', l: 'P — Plan', ph: 'Treatment, follow-up...' },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden text-white">
      <div className="px-4 py-3 bg-[#252525] border-b border-gray-800">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium flex items-center gap-1.5"><ClipboardList size={14} className="text-violet-400" /> Visit Notes</span>
          <div className="flex items-center gap-2">
            {lastSaved && <span className="text-[10px] text-gray-500">Saved {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
            <button onClick={() => saveNotes(false)} disabled={saving}
              className="px-2 py-1 bg-violet-500 hover:bg-violet-600 text-xs rounded flex items-center gap-1 disabled:opacity-50">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
            </button>
          </div>
        </div>
        <div className="flex gap-1">
          <TabPill label="Quick Notes" active={section === 'freeform'} onClick={() => setSection('freeform')} />
          <TabPill label="SOAP" active={section === 'soap'} onClick={() => setSection('soap')} />
          <button onClick={generateSOAP} disabled={aiLoading || (!notes.freeform && !notes.chiefComplaint)}
            className="ml-auto px-2 py-1 text-[10px] rounded bg-violet-500 hover:bg-violet-600 disabled:opacity-40 flex items-center gap-1">
            {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3" />} AI SOAP
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <NoteInput label="Chief Complaint" value={notes.chiefComplaint} onChange={v => upd('chiefComplaint', v)} ph="Reason for visit..." />
        {section === 'freeform' ? (
          <div>
            <label className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Notes</label>
            <textarea value={notes.freeform} onChange={e => upd('freeform', e.target.value)}
              placeholder="Type notes during the call..."
              className="w-full mt-1 px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg outline-none focus:border-violet-400 resize-none text-white placeholder-gray-500"
              style={{ minHeight: '240px' }} autoFocus />
          </div>
        ) : soaps.map(({ k, l, ph }) => (
          <div key={k}>
            <label className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">{l}</label>
            <textarea value={notes[k]} onChange={e => upd(k, e.target.value)} placeholder={ph} rows={3}
              className="w-full mt-1 px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg outline-none focus:border-violet-400 resize-none text-white placeholder-gray-500" />
          </div>
        ))}
      </div>
      <div className="px-4 py-2 border-t border-gray-800 text-[10px] text-gray-600 flex justify-between">
        <span>Auto-saves every 30s</span><span>HIPAA-compliant</span>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════ */
/*                        CHAT PANEL                                  */
/* ═══════════════════════════════════════════════════════════════════ */

const ChatPanel = ({ appointment }) => (
  <>
    <div className="flex-1 p-4 overflow-y-auto space-y-3">
      <div className="bg-blue-500/10 p-3 rounded-lg rounded-tl-none max-w-[85%]">
        <p className="text-sm text-blue-200">Hello! I&apos;m ready for our appointment.</p>
        <span className="text-[10px] text-blue-300/50 block mt-1">Dr. {appointment.providerLastName} &bull; {formatTime(new Date())}</span>
      </div>
    </div>
    <div className="p-3 border-t border-gray-800">
      <input type="text" placeholder="Type a message..."
        className="w-full px-3 py-2 bg-gray-800 rounded-lg text-sm outline-none text-white placeholder-gray-500 focus:ring-1 focus:ring-blue-400" />
    </div>
  </>
);

/* ═══════════════════════════════════════════════════════════════════ */
/*                       UI ATOMS                                     */
/* ═══════════════════════════════════════════════════════════════════ */

const ControlBtn = ({ icon: Icon, active, onClick, label, color = 'default' }) => {
  const base = 'flex h-12 w-12 items-center justify-center rounded-full border transition-all duration-200 backdrop-blur-md sm:h-[3.25rem] sm:w-[3.25rem]';
  const colors = {
    default: active !== false ? 'border-cyan-400/30 bg-cyan-500/20 text-cyan-100 shadow-[0_12px_28px_rgba(59,130,246,0.18)]' : 'border-white/10 bg-white/10 text-slate-100 hover:bg-white/15',
    primary: 'border-cyan-400/30 bg-cyan-500/20 text-cyan-100 shadow-[0_12px_28px_rgba(59,130,246,0.18)]',
    glass: 'border-white/10 bg-white/10 text-white hover:bg-white/15',
    danger: 'border-rose-500/20 bg-rose-500/15 text-rose-100',
    transparent: 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white',
  };

  return (
    <div className="relative group">
      <button onClick={onClick} className={`${base} ${colors[color]}`} title={label}>
        <Icon size={20} />
      </button>
      <span className="absolute -top-10 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-800 text-xs text-white rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
        {label}
      </span>
    </div>
  );
};

const SidebarTabBtn = ({ label, icon: Icon, active, onClick }) => (
  <button onClick={onClick}
    className={`flex-1 py-2.5 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
      active ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-500 hover:text-gray-300'
    }`}>
    <Icon size={14} /> {label}
  </button>
);

const TabPill = ({ label, active, onClick }) => (
  <button onClick={onClick}
    className={`px-2.5 py-1 text-[10px] font-medium rounded transition-colors ${
      active ? 'bg-violet-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
    }`}>{label}</button>
);

const NoteInput = ({ label, value, onChange, ph }) => (
  <div>
    <label className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">{label}</label>
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={ph}
      className="w-full mt-1 px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg outline-none focus:border-violet-400 text-white placeholder-gray-500" />
  </div>
);
