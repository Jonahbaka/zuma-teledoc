'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import {
  Mic, MicOff, Video as VideoIcon, VideoOff,
  PhoneOff, ShieldCheck, User,
  MessageSquare, Sparkles,
  X, Calendar, Clock, ArrowLeft, FileText
} from 'lucide-react';
import api, { paymentsAPI } from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { formatDateTime, formatTime } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';
import { VIDEO_BG_PRESETS } from '@/lib/videoBackgrounds';
import LiveCaptionsOverlay from '@/components/video/LiveCaptionsOverlay';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';
import useTelehealthSession from '@/lib/useTelehealthSession';

// --- Assets & Constants ---
const DOCTOR_VIDEO_URL = "https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

const getProviderName = (appointment) =>
  `${appointment?.providerFirstName || ''} ${appointment?.providerLastName || ''}`.trim() || 'DoctaRx Care Team';

const getProviderLabel = (appointment) =>
  appointment?.isStandaloneTest ? 'DoctaRx Care Team' : `Dr. ${getProviderName(appointment)}`;

const getLobbyHeading = (appointment) =>
  appointment?.isStandaloneTest ? 'Your test call is ready' : 'Your appointment with';

const getJoinButtonLabel = (appointment) =>
  appointment?.isStandaloneTest ? 'Join Test Call' : 'Join Appointment';

const getWaitingRoomCopy = (appointment) =>
  appointment?.isStandaloneTest
    ? 'The care team can join this testing room at any time'
    : `${getProviderLabel(appointment)} can join the waiting room at any time`;

const getChatSenderLabel = (appointment) =>
  appointment?.isStandaloneTest ? 'Care Team' : `Dr. ${appointment?.providerLastName || appointment?.providerFirstName || 'Care Team'}`;

const getBgPreviewStyle = (preset) => {
  if (preset.type === 'gradient') {
    const name = (preset.value || '').split(':')[1];
    switch (name) {
      case 'studio':
        return { background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 45%, #334155 100%)' };
      case 'ocean':
        return { background: 'linear-gradient(135deg, #0ea5e9 0%, #22c55e 100%)' };
      case 'sunset':
        return { background: 'linear-gradient(135deg, #f97316 0%, #db2777 60%, #7c3aed 100%)' };
      case 'aurora':
        return { background: 'linear-gradient(135deg, #22c55e 0%, #06b6d4 50%, #a855f7 100%)' };
      default:
        return { background: 'linear-gradient(135deg, #0f172a 0%, #334155 100%)' };
    }
  }
  if (preset.type === 'color') {
    const color = (preset.value || '').split(':')[1] || '#0f172a';
    return { background: color };
  }
  return null;
};

export default function PatientVideoCallPage() {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const appointmentId = params.id;
  const isStandalone = appointmentId === 'standalone';
  const isNigeriaPortal = pathname.startsWith('/ng/patient');
  const appointmentReturnPath = isStandalone
    ? (isNigeriaPortal ? '/ng/patient' : '/patient/dashboard')
    : (isNigeriaPortal ? '/ng/patient/appointments' : `/patient/appointments/${appointmentId}`);
  const appointmentsHomePath = isNigeriaPortal ? '/ng/patient/appointments' : '/patient/appointments';
  const complianceLabel = isNigeriaPortal ? 'NDPA Secure' : 'HIPAA Secure';
  
  const [appointment, setAppointment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [paymentChecked, setPaymentChecked] = useState(false);
  const [isInCall, setIsInCall] = useState(false);
  const [userName, setUserName] = useState('');

  // Device State
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [processingEnabled, setProcessingEnabled] = useState(false);
  const [activeEffect, setActiveEffect] = useState(null);
  const [showCaptions, setShowCaptions] = useState(false);

  // App State
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
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

  useEffect(() => {
    if (isStandalone) {
      setAppointment({
        id: 'standalone',
        type: 'video',
        status: 'in_progress',
        providerFirstName: 'Care',
        providerLastName: 'Team',
        providerSpecialty: 'Standalone video test session',
        scheduledAt: new Date().toISOString(),
        durationMinutes: 30,
        reasonForVisit: 'Standalone patient video call for portal testing.',
        isStandaloneTest: true,
      });
      if (user?.firstName) {
        setUserName(`${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`);
      }
      setPaymentChecked(true);
      setLoading(false);
      return;
    }

    fetchAppointment();
    checkPaymentAccess();
  }, [appointmentId, isStandalone, user?.firstName, user?.lastName]);

  const checkPaymentAccess = async () => {
    if (isStandalone) {
      setPaymentChecked(true);
      return;
    }

    try {
      const response = await paymentsAPI.getAppointmentPayment(appointmentId);
      if (response.data.success) {
        if (!response.data.paymentCompleted && response.data.paymentRequired) {
          toast({
            title: 'Payment Required',
            description: 'Please complete payment before joining the video call',
            variant: 'destructive'
          });
          router.push(appointmentReturnPath);
          return;
        }
        setPaymentChecked(true);
      }
    } catch (error) {
      console.error('Failed to check payment:', error);
      // Allow access if check fails (graceful degradation)
      setPaymentChecked(true);
    }
  };

  const fetchAppointment = async () => {
    if (isStandalone) {
      return;
    }

    try {
      const response = await api.get(`/appointments/${appointmentId}`);
      if (response.data.success) {
        setAppointment(response.data.appointment);
        // Set default user name from patient name
        if (response.data.appointment.patientFirstName) {
          setUserName(`${response.data.appointment.patientFirstName} ${response.data.appointment.patientLastName}`);
        }
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load appointment details',
        variant: 'destructive'
      });
      router.push(appointmentsHomePath);
    } finally {
      setLoading(false);
    }
  };

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
    setActiveEffect(null);
    router.push(appointmentReturnPath);
  };

  useEffect(() => {
    if (!localStream) return;
    localStream.getVideoTracks().forEach((track) => {
      track.enabled = camOn;
    });
  }, [camOn, localStream]);

  useEffect(() => {
    if (!localStream) return;
    localStream.getAudioTracks().forEach((track) => {
      track.enabled = micOn;
    });
  }, [localStream, micOn]);

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

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-slate-600">{isStandalone ? 'Preparing test call...' : 'Loading appointment...'}</p>
        </div>
      </div>
    );
  }

  if (!appointment) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-600 mb-4">Appointment not found</p>
          <Button onClick={() => router.push(appointmentsHomePath)}>Back</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex contrast-dark min-h-[100dvh] flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_28%),radial-gradient(circle_at_85%_0%,rgba(15,23,42,0.42),transparent_34%),linear-gradient(180deg,#020617,#0f172a_52%,#111827)] text-slate-100 font-sans selection:bg-cyan-500/20">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/72 px-4 pb-3 pt-[calc(0.7rem+env(safe-area-inset-top,0px))] backdrop-blur-xl sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 rounded-2xl border border-white/10 bg-white/5 text-slate-100 hover:bg-white/10 hover:text-white"
              onClick={() => router.push(appointmentReturnPath)}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex min-w-0 items-center gap-3">
              <span className="rounded-2xl border border-white/10 bg-slate-950/95 px-3 py-2 shadow-[0_0_20px_rgba(34,211,238,0.14)]">
                <DoctaRxLogo className="h-7 w-auto" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-white">
                  {appointment?.isStandaloneTest ? 'Test Call' : `Appointment with ${getProviderLabel(appointment)}`}
                </div>
                <div className="text-xs text-slate-400">
                  {appointment?.providerSpecialty || 'Secure telehealth visit'}
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2 sm:gap-3">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200">
              <ShieldCheck size={12} />
              <span>{complianceLabel}</span>
            </div>
            <div className="hidden rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 sm:block">
              {new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 flex flex-col">
        {!isInCall ? (
          <Lobby
            appointment={appointment}
            userName={userName}
            setUserName={setUserName}
            onJoin={startCall}
            micOn={micOn}
            setMicOn={setMicOn}
            camOn={camOn}
            setCamOn={setCamOn}
            localStream={localStream}
            ensureLocalStream={ensureLocalStream}
            mediaError={mediaError}
          />
        ) : (
          <ActiveCallRoom
            appointment={appointment}
            micOn={micOn} toggleMic={() => setMicOn(!micOn)}
            camOn={camOn} toggleCam={() => setCamOn(!camOn)}
            activeEffect={activeEffect}
            setActiveEffect={setActiveEffect}
            onEndCall={endCall}
            isSidebarOpen={isSidebarOpen}
            toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
            showSettings={showSettings}
            setShowSettings={setShowSettings}
            processingEnabled={processingEnabled}
            setProcessingEnabled={setProcessingEnabled}
            showCaptions={showCaptions}
            setShowCaptions={setShowCaptions}
            localStream={localStream}
            ensureLocalStream={ensureLocalStream}
            mediaError={mediaError}
            remoteStream={remoteStream}
            remoteParticipant={remoteParticipant}
            connectionStatus={connectionStatus}
            callError={callError}
          />
        )}
      </main>
    </div>
  );
}

// --- PRE-CALL LOBBY COMPONENT ---
const Lobby = ({
  appointment,
  userName,
  setUserName,
  onJoin,
  micOn,
  setMicOn,
  camOn,
  setCamOn,
  localStream,
  ensureLocalStream,
  mediaError
}) => {
  return (
    <div className="flex-1 overflow-y-auto px-4 pb-[calc(2rem+env(safe-area-inset-bottom,0px))] pt-4 sm:px-6 sm:pt-6">
      <div className="mx-auto grid max-w-6xl gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(22rem,0.9fr)] xl:items-center">
        <div className="order-2 space-y-5 xl:order-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
            <Sparkles className="h-4 w-4" />
            Visit check-in
          </div>
          <div>
            <h1 className="text-3xl font-semibold leading-tight text-white sm:text-4xl">
              {getLobbyHeading(appointment)} <br />
              <span className="text-cyan-300">{getProviderLabel(appointment)}</span>
            </h1>
            {appointment.providerSpecialty && (
              <p className="mt-3 text-base text-slate-300">{appointment.providerSpecialty}</p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[1.35rem] border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
              <div className="flex items-center gap-3 text-slate-200">
                <Calendar className="h-5 w-5 text-cyan-300" />
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Appointment Date</p>
                  <p className="mt-1 font-semibold text-white">{formatDateTime(appointment.scheduledAt)}</p>
                </div>
              </div>
            </div>
            <div className="rounded-[1.35rem] border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
              <div className="flex items-center gap-3 text-slate-200">
                <Clock className="h-5 w-5 text-cyan-300" />
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Duration</p>
                  <p className="mt-1 font-semibold text-white">{appointment.durationMinutes || 30} minutes</p>
                </div>
              </div>
            </div>
          </div>

          {appointment.reasonForVisit ? (
            <div className="rounded-[1.45rem] border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Reason for Visit</p>
              <p className="mt-2 text-sm leading-6 text-slate-200">{appointment.reasonForVisit}</p>
            </div>
          ) : null}

          <p className="max-w-2xl text-base leading-7 text-slate-300">
            Check your camera and microphone, confirm the name that should appear in the call, and join when you are ready.
          </p>

          <div className="rounded-[1.25rem] border border-cyan-400/20 bg-cyan-400/10 p-3 text-sm text-cyan-100">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-cyan-300 animate-pulse" />
              <span>{getWaitingRoomCopy(appointment)}</span>
            </div>
          </div>

          <div className="rounded-[1.6rem] border border-white/10 bg-slate-950/40 p-4 shadow-[0_18px_44px_rgba(2,6,23,0.22)] backdrop-blur-xl">
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-200">Display Name</label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition-all placeholder:text-slate-500 focus:border-cyan-400/70 focus:bg-white/10"
                />
              </div>

              <button
                onClick={onJoin}
                disabled={!userName.trim()}
                className="w-full rounded-2xl bg-cyan-500 px-5 py-3.5 text-base font-semibold text-slate-950 shadow-[0_16px_40px_rgba(34,211,238,0.24)] transition-all hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {getJoinButtonLabel(appointment)}
              </button>
            </div>
          </div>
        </div>

        <div className="order-1 rounded-[1.8rem] border border-white/10 bg-slate-950/45 p-4 shadow-[0_28px_70px_rgba(2,6,23,0.26)] backdrop-blur-2xl xl:order-2">
          <div className="relative mb-4 aspect-[4/3] overflow-hidden rounded-[1.45rem] bg-slate-950 ring-1 ring-white/10">
            {camOn ? (
              <CameraPreview
                stream={localStream}
                ensureLocalStream={ensureLocalStream}
                mediaError={mediaError}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-slate-400">
                <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-slate-800">
                  <VideoOff size={28} />
                </div>
                <span className="text-sm font-medium">Camera Off</span>
              </div>
            )}

            <div className="absolute bottom-3 left-3 rounded-full border border-white/10 bg-black/45 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-md">
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${micOn ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
                {micOn ? 'Mic Active' : 'Mic Muted'}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap justify-center gap-3">
            <DeviceToggle
              active={micOn}
              onClick={() => setMicOn(!micOn)}
              iconOn={Mic}
              iconOff={MicOff}
              label="Microphone"
            />
            <DeviceToggle
              active={camOn}
              onClick={() => setCamOn(!camOn)}
              iconOn={VideoIcon}
              iconOff={VideoOff}
              label="Camera"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

// --- ACTIVE CALL ROOM COMPONENT ---
const ActiveCallRoom = ({
  appointment,
  micOn, toggleMic,
  camOn, toggleCam,
  onEndCall,
  isSidebarOpen, toggleSidebar,
  showSettings, setShowSettings,
  activeEffect, setActiveEffect,
  processingEnabled, setProcessingEnabled,
  showCaptions, setShowCaptions,
  localStream, ensureLocalStream, mediaError,
  remoteStream, remoteParticipant, connectionStatus, callError
}) => {
  const waitingCopy = callError
    ? 'Action needed'
    : connectionStatus === 'connected'
      ? 'Live now'
      : connectionStatus === 'connecting' || connectionStatus === 'reconnecting'
        ? 'Connecting'
        : 'Waiting room';

  return (
    <div className="relative flex-1 min-h-0 overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_20%),radial-gradient(circle_at_bottom_right,rgba(14,116,144,0.22),transparent_28%),linear-gradient(180deg,#020617,#0f172a_52%,#111827)]">
      {(showSettings || isSidebarOpen) && (
        <button
          type="button"
          aria-label="Close panel"
          onClick={() => {
            if (showSettings) {
              setShowSettings(false);
            }
            if (isSidebarOpen) {
              toggleSidebar();
            }
          }}
          className="absolute inset-0 z-20 bg-slate-950/55 backdrop-blur-[2px] lg:hidden"
        />
      )}

      <div className={`flex h-full min-h-0 transition-all duration-300 ${isSidebarOpen ? 'lg:pr-[22rem]' : ''}`}>
        <div className="relative flex-1 min-h-0 px-3 pb-[calc(7.8rem+env(safe-area-inset-bottom,0px))] pt-3 sm:px-4 sm:pt-4">
          <div className="relative h-full overflow-hidden rounded-[1.9rem] border border-white/10 bg-black shadow-[0_34px_90px_rgba(2,6,23,0.5)]">
          <RemoteProviderStage
            appointment={appointment}
            stream={appointment.isStandaloneTest ? null : remoteStream}
            participant={remoteParticipant}
            connectionStatus={connectionStatus}
            callError={callError}
          />

            <div className="absolute inset-x-3 top-3 z-10 flex items-start justify-between gap-3 sm:inset-x-5 sm:top-5">
              <div className="max-w-[16rem] rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-white shadow-lg backdrop-blur-xl">
                <h3 className="text-sm font-semibold">{remoteParticipant?.name || getProviderLabel(appointment)}</h3>
                <p className="mt-1 text-xs leading-5 text-slate-300">
                  {callError
                    ? callError
                    : appointment.providerSpecialty || 'General Practice'}
                </p>
              </div>

              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/45 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-200 backdrop-blur-xl">
                <span className={`h-2 w-2 rounded-full ${connectionStatus === 'connected' ? 'bg-emerald-400' : callError ? 'bg-rose-400' : 'bg-amber-300 animate-pulse'}`} />
                {waitingCopy}
              </div>
            </div>

            <div className="absolute right-3 top-3 z-10 w-[7.4rem] overflow-hidden rounded-[1.35rem] border border-white/10 bg-slate-900 shadow-[0_18px_50px_rgba(2,6,23,0.38)] sm:w-40 md:right-5 md:top-5 md:w-48 lg:bottom-6 lg:right-6 lg:top-auto">
              <div className="relative aspect-[4/5] sm:aspect-video">
                {camOn ? (
                  <SelfieCamera
                    micOn={micOn}
                    activeEffect={activeEffect}
                    processingEnabled={processingEnabled}
                    setProcessingEnabled={setProcessingEnabled}
                    stream={localStream}
                    ensureLocalStream={ensureLocalStream}
                    mediaError={mediaError}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-slate-800 text-slate-500">
                    <User size={30} />
                  </div>
                )}

                <div className="absolute inset-x-2 bottom-2 flex items-center justify-between rounded-full border border-white/10 bg-black/55 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white backdrop-blur-md">
                  <span>You</span>
                  <span className={`h-2 w-2 rounded-full ${micOn ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                </div>
              </div>
            </div>

            <LiveCaptionsOverlay
              enabled={showCaptions}
              speakerLabel="You"
              defaultTargetLang={(typeof navigator !== 'undefined' && navigator.language) ? navigator.language : 'en-US'}
            />
          </div>
        </div>
      </div>

      {showSettings && (
        <div className="fixed inset-x-4 bottom-[calc(6.4rem+env(safe-area-inset-bottom,0px))] z-50 max-h-[min(68vh,34rem)] overflow-y-auto rounded-[1.6rem] border border-white/10 bg-slate-950/96 p-4 text-white shadow-[0_30px_80px_rgba(2,6,23,0.6)] backdrop-blur-2xl lg:absolute lg:inset-x-auto lg:bottom-[calc(7.6rem+env(safe-area-inset-bottom,0px))] lg:right-6 lg:w-[22rem]">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">Video Effects</h3>
              <p className="mt-1 text-xs text-slate-400">Adjust how your camera feed looks before or during the call.</p>
            </div>
            <button
              onClick={() => setShowSettings(false)}
              className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-white">AI camera cleanup</p>
                  <p className="mt-1 text-xs text-slate-400">Enable background processing and choose a cleaner backdrop.</p>
                </div>
                <button
                  onClick={() => setProcessingEnabled(!processingEnabled)}
                  className={`flex h-7 w-12 items-center rounded-full border transition-colors ${processingEnabled ? 'border-cyan-400/40 bg-cyan-500/30' : 'border-white/10 bg-white/10'}`}
                >
                  <div className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${processingEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>

            {processingEnabled && (
              <div className="grid grid-cols-3 gap-2">
                {VIDEO_BG_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => setActiveEffect(preset.value)}
                    className={`rounded-2xl border p-2 text-[11px] transition-all ${
                      activeEffect === preset.value
                        ? 'border-cyan-400/50 bg-cyan-500/12 text-cyan-100 shadow-[0_14px_30px_rgba(34,211,238,0.12)]'
                        : 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
                    }`}
                  >
                    <div className="mb-2 flex justify-center">
                      {preset.type === 'blur' ? (
                        <div className="h-8 w-8 rounded-2xl bg-slate-300 blur-sm" />
                      ) : preset.type === 'image' ? (
                        <img src={preset.value} className="h-8 w-8 rounded-2xl object-cover" alt="" />
                      ) : preset.type === 'gradient' || preset.type === 'color' ? (
                        <div className="h-8 w-8 rounded-2xl" style={getBgPreviewStyle(preset)} />
                      ) : (
                        <div className="h-8 w-8 rounded-2xl bg-slate-200" />
                      )}
                    </div>
                    <span className="block truncate text-center">{preset.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Control Bar */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 px-3 pb-[calc(0.9rem+env(safe-area-inset-bottom,0px))] pt-6 sm:px-4">
        <div className="pointer-events-auto mx-auto flex w-full max-w-[30rem] items-center justify-center gap-2 rounded-[1.9rem] border border-white/10 bg-slate-950/82 px-3 py-3 shadow-[0_26px_60px_rgba(2,6,23,0.54)] backdrop-blur-2xl sm:gap-3 sm:px-4">
          <ControlBtn
            active={micOn}
            onClick={toggleMic}
            onIcon={Mic}
            offIcon={MicOff}
            tooltip="Microphone"
            destructiveWhenInactive
          />
          <ControlBtn
            active={camOn}
            onClick={toggleCam}
            onIcon={VideoIcon}
            offIcon={VideoOff}
            tooltip="Camera"
            destructiveWhenInactive
          />
          <div className="h-10 w-px bg-white/10" />
          <ControlBtn
            active={showCaptions}
            onClick={() => setShowCaptions((v) => !v)}
            onIcon={FileText}
            offIcon={FileText}
            tooltip="Captions"
          />
          <ControlBtn
            active={showSettings}
            onClick={() => setShowSettings(!showSettings)}
            onIcon={Sparkles}
            offIcon={Sparkles}
            tooltip="Effects"
          />
          <ControlBtn
            active={isSidebarOpen}
            onClick={toggleSidebar}
            onIcon={MessageSquare}
            offIcon={MessageSquare}
            tooltip="Chat"
          />
          <button
            onClick={onEndCall}
            className="ml-1 flex h-14 w-14 items-center justify-center rounded-full bg-rose-500 text-white shadow-[0_18px_42px_rgba(244,63,94,0.42)] transition-all hover:bg-rose-400"
            title="Leave call"
          >
            <PhoneOff size={20} fill="currentColor" />
          </button>
        </div>
      </div>

      {/* Sidebar */}
      {isSidebarOpen && (
        <div className="fixed inset-x-0 bottom-0 z-50 flex max-h-[74vh] flex-col overflow-hidden rounded-t-[1.8rem] border border-white/10 bg-slate-950/96 text-white shadow-[0_26px_60px_rgba(2,6,23,0.58)] backdrop-blur-2xl lg:absolute lg:inset-y-0 lg:right-0 lg:left-auto lg:max-h-none lg:w-[22rem] lg:rounded-none lg:border-y-0 lg:border-r-0 lg:border-l">
          <div className="mx-auto mt-3 h-1.5 w-14 rounded-full bg-white/15 lg:hidden" />
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Secure Chat</h3>
              <p className="mt-1 text-xs text-slate-400">Messages stay linked to this consultation.</p>
            </div>
            <button
              onClick={toggleSidebar}
              className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            <div className="max-w-[88%] rounded-2xl rounded-tl-sm border border-cyan-400/15 bg-cyan-500/10 p-3">
              <p className="text-sm leading-6 text-cyan-50">Hello! I&apos;m reviewing your latest lab results. I&apos;ll be with you in a moment.</p>
              <span className="text-[10px] text-blue-700/60 block mt-1">{getChatSenderLabel(appointment)} • {formatTime(new Date())}</span>
            </div>
          </div>
          <div className="border-t border-white/10 px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-4">
            <input type="text" placeholder="Type a secure message..." className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-cyan-400/60 focus:bg-white/10" />
          </div>
        </div>
      )}
    </div>
  );
};

const RemoteProviderStage = ({ appointment, stream, participant, connectionStatus, callError }) => {
  const videoRef = useRef(null);
  const providerLabel = participant?.name || getProviderLabel(appointment);
  const waitingCopy = callError
    ? callError
    : connectionStatus === 'connected'
      ? 'Connected'
      : connectionStatus === 'connecting' || connectionStatus === 'reconnecting'
        ? 'Connecting to provider...'
        : getWaitingRoomCopy(appointment);

  useEffect(() => {
    if (!videoRef.current) {
      return;
    }

    if (stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
      return;
    }

    videoRef.current.srcObject = null;
  }, [stream]);

  if (stream) {
    return (
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        autoPlay
        playsInline
      />
    );
  }

  if (appointment.isStandaloneTest) {
    return (
      <video
        src={DOCTOR_VIDEO_URL}
        className="w-full h-full object-cover opacity-80"
        autoPlay
        loop
        muted
        playsInline
      />
    );
  }

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 px-6 text-center">
      <div className="mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-white/10 text-2xl font-semibold text-white">
        {providerLabel
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part[0])
          .join('')
          .toUpperCase() || 'DR'}
      </div>
      <p className="text-xl font-semibold text-white">{providerLabel}</p>
      <p className="mt-2 max-w-md text-sm text-slate-300">{waitingCopy}</p>
    </div>
  );
};

// --- CORE CAMERA LOGIC (MediaPipe Integration) ---
const SelfieCamera = ({
  micOn,
  activeEffect,
  processingEnabled,
  setProcessingEnabled,
  stream,
  ensureLocalStream,
  mediaError
}) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const bgImageRef = useRef(null);
  const bgImageLoadedRef = useRef(false);
  const personCanvasRef = useRef(null);
  const segmentationRef = useRef(null);
  const requestRef = useRef(null);
  const streamRef = useRef(null);
  const ownsStreamRef = useRef(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [cameraLoading, setCameraLoading] = useState(true);
  const errorHandlerRef = useRef(null);
  const activeEffectRef = useRef(activeEffect);

  useEffect(() => {
    activeEffectRef.current = activeEffect;
  }, [activeEffect]);

  // Load MediaPipe Script
  useEffect(() => {
    if (!processingEnabled) return;

    const scriptUrl = "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js";

    if (document.querySelector(`script[src="${scriptUrl}"]`)) {
      initMediaPipe();
      return;
    }

    const script = document.createElement("script");
    script.src = scriptUrl;
    script.async = true;
    script.onload = () => initMediaPipe();
    document.body.appendChild(script);

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [processingEnabled]);

  const initMediaPipe = async () => {
    try {
      if (!window.SelfieSegmentation) {
        // Wait a bit and try again if SelfieSegmentation isn't available yet
        setTimeout(() => {
          if (window.SelfieSegmentation) {
            initMediaPipe();
          }
        }, 100);
        return;
      }

      // Check if already initialized
      if (segmentationRef.current) {
        setModelLoaded(true);
        return;
      }

      // Create MediaPipe instance with comprehensive error handling
      let selfieSegmentation;
      try {
        // Wrap in try-catch to catch WASM initialization errors
        selfieSegmentation = new window.SelfieSegmentation({
          locateFile: (file) => {
            // Return full CDN URL for WASM files
            return `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`;
          },
        });
      } catch (initError) {
        console.warn('MediaPipe constructor error:', initError);
        // Don't disable immediately - let user try again
        // Only disable if this is a persistent issue
        return;
      }

      // Set options with error handling
      try {
        if (selfieSegmentation && typeof selfieSegmentation.setOptions === 'function') {
          await selfieSegmentation.setOptions({
            modelSelection: 1,
          });
        } else {
          console.warn('MediaPipe setOptions not available');
          return;
        }
      } catch (optionsError) {
        console.warn('MediaPipe setOptions error:', optionsError);
        // Don't disable - might be temporary
        return;
      }

      // Set results handler with error handling
      try {
        if (selfieSegmentation && typeof selfieSegmentation.onResults === 'function') {
          selfieSegmentation.onResults(onResults);
        } else {
          console.warn('MediaPipe onResults not available');
          return;
        }
      } catch (resultsError) {
        console.warn('MediaPipe onResults error:', resultsError);
        return;
      }
      
      segmentationRef.current = selfieSegmentation;
      setModelLoaded(true);
    } catch (error) {
      // Catch any other errors but don't disable immediately
      console.warn('MediaPipe initialization error:', error);
      // Let the error handler deal with persistent failures
    }
  };

  // Preload background image when activeEffect changes
  useEffect(() => {
    const effect = activeEffect;
    const isUrl = typeof effect === 'string' && /^https?:\/\//i.test(effect);
    if (isUrl) {
      bgImageLoadedRef.current = false;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        bgImageRef.current = img;
        bgImageLoadedRef.current = true;
      };
      img.onerror = (error) => {
        console.error('Failed to load background image:', effect, error);
        bgImageRef.current = null;
        bgImageLoadedRef.current = false;
      };
      img.src = effect;
    } else {
      bgImageRef.current = null;
      bgImageLoadedRef.current = false;
    }
  }, [activeEffect]);

  // Setup global error handler for WASM errors - only catch actual runtime errors, not initialization
  useEffect(() => {
    let errorCount = 0;
    const MAX_ERRORS = 3; // Only disable after multiple errors
    
    // Create error handler for MediaPipe WASM errors
    errorHandlerRef.current = (event) => {
      // Check if error is from MediaPipe WASM and only if processing is actually enabled
      if (processingEnabled && event.message && (
        event.message.includes('Module.arguments') ||
        event.message.includes('Aborted') ||
        event.message.includes('selfie_segmentation')
      )) {
        errorCount++;
        // Only disable after multiple errors to prevent false positives
        if (errorCount >= MAX_ERRORS) {
          // Prevent default error handling
          event.preventDefault();
          // Stop processing silently
          if (requestRef.current) {
            cancelAnimationFrame(requestRef.current);
            requestRef.current = null;
          }
          if (segmentationRef.current) {
            try {
              segmentationRef.current.close();
            } catch (e) {
              // Ignore cleanup errors
            }
            segmentationRef.current = null;
          }
          if (setProcessingEnabled) {
            setProcessingEnabled(false);
          }
          setModelLoaded(false);
          errorCount = 0; // Reset counter
          // Return true to prevent error from propagating
          return true;
        }
        // Don't prevent error on first few occurrences, just log
        return false;
      }
      return false;
    };

    // Add error event listener
    window.addEventListener('error', errorHandlerRef.current, true);
    
    // Also handle unhandled promise rejections
    const unhandledRejectionHandler = (event) => {
      if (processingEnabled && event.reason && (
        event.reason.message?.includes('Module.arguments') ||
        event.reason.message?.includes('Aborted') ||
        event.reason.message?.includes('selfie_segmentation')
      )) {
        errorCount++;
        if (errorCount >= MAX_ERRORS) {
          event.preventDefault();
          // Stop processing
          if (requestRef.current) {
            cancelAnimationFrame(requestRef.current);
            requestRef.current = null;
          }
          if (setProcessingEnabled) {
            setProcessingEnabled(false);
          }
          setModelLoaded(false);
          errorCount = 0;
        }
      }
    };
    
    window.addEventListener('unhandledrejection', unhandledRejectionHandler);

    return () => {
      if (errorHandlerRef.current) {
        window.removeEventListener('error', errorHandlerRef.current, true);
      }
      window.removeEventListener('unhandledrejection', unhandledRejectionHandler);
    };
  }, [processingEnabled, setProcessingEnabled]);

  // Setup Camera Stream
  useEffect(() => {
    const errorShownRef = { current: false };
    let mounted = true;

    const attachResolvedStream = (nextStream, owned = false) => {
      if (!mounted) {
        if (owned) {
          nextStream?.getTracks().forEach((track) => track.stop());
        }
        return;
      }

      if (ownsStreamRef.current && streamRef.current && streamRef.current !== nextStream) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      ownsStreamRef.current = owned;
      streamRef.current = nextStream;
      setCameraLoading(false);
      setCameraError(null);
      errorShownRef.current = false;
    };

    const handleCameraFailure = (errorObj) => {
      if (!mounted) return;

      const nextError = mediaError || errorObj?.message || 'Camera access denied';
      setCameraLoading(false);
      setCameraError(nextError);

      if (!errorShownRef.current) {
        errorShownRef.current = true;
        setTimeout(() => {
          try {
            toast({
              title: 'Camera unavailable',
              description: nextError,
              variant: 'destructive',
              duration: 5000
            });
          } catch {
            // Ignore toast errors
          }
        }, 100);
      }
    };

    const startCamera = async () => {
      try {
        setCameraLoading(true);
        setCameraError(null);
        errorShownRef.current = false;

        if (stream) {
          attachResolvedStream(stream, false);
          return;
        }

        if (ensureLocalStream) {
          const sharedStream = await ensureLocalStream();
          attachResolvedStream(sharedStream, false);
          return;
        }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Camera access is not supported in this browser');
        }

        const ownedStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user'
          },
          audio: false
        });

        attachResolvedStream(ownedStream, true);
      } catch (error) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        handleCameraFailure(errorObj);
      }
    };

    startCamera();

    return () => {
      mounted = false;
      if (ownsStreamRef.current && streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      streamRef.current = null;
      ownsStreamRef.current = false;
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [ensureLocalStream, mediaError, stream]);

  // Effect to ensure video plays when stream is available
  useEffect(() => {
    if (streamRef.current && videoRef.current && !cameraError && !cameraLoading) {
      if (videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
      }
      
      const playVideo = async () => {
        if (videoRef.current && videoRef.current.readyState >= 2) {
          try {
            await videoRef.current.play();
            if (processingEnabled && segmentationRef.current && modelLoaded) {
              startProcessing();
            }
          } catch (err) {
            // Silently handle play errors
          }
        }
      };

      const handleCanPlay = () => {
        playVideo();
      };

      const handleLoadedMetadata = () => {
        playVideo();
      };

      if (videoRef.current.readyState >= 2) {
        playVideo();
      } else {
        videoRef.current.addEventListener('canplay', handleCanPlay);
        videoRef.current.addEventListener('loadedmetadata', handleLoadedMetadata);
      }

      return () => {
        if (videoRef.current) {
          videoRef.current.removeEventListener('canplay', handleCanPlay);
          videoRef.current.removeEventListener('loadedmetadata', handleLoadedMetadata);
        }
      };
    }
  }, [cameraLoading, cameraError, processingEnabled]);

  // Start processing when MediaPipe is loaded and processing is enabled
  useEffect(() => {
    if (modelLoaded && processingEnabled && segmentationRef.current && videoRef.current && videoRef.current.readyState >= 2) {
      startProcessing();
    }
  }, [modelLoaded, processingEnabled]);

  const startProcessing = () => {
    if (!segmentationRef.current || !videoRef.current || !modelLoaded) {
      // Don't start if not ready - will be called again when ready
      return;
    }

    let isProcessing = true;
    let errorCount = 0;
    let lastFrameTime = 0;
    const MAX_ERRORS = 10; // Allow more errors before disabling
    const MIN_FRAME_INTERVAL = 33; // ~30fps max to prevent timestamp issues (33ms = 30fps)

    const process = async () => {
      if (!isProcessing || !processingEnabled) return;
      
      const currentTime = Date.now();
      const timeSinceLastFrame = currentTime - lastFrameTime;
      
      // Skip frame if sent too recently to prevent timestamp mismatches
      if (timeSinceLastFrame < MIN_FRAME_INTERVAL) {
        requestRef.current = requestAnimationFrame(process);
        return;
      }
      
      try {
        if (videoRef.current && videoRef.current.readyState === 4 && segmentationRef.current) {
          // Check if segmentation is still valid before sending
          if (segmentationRef.current && typeof segmentationRef.current.send === 'function') {
            await segmentationRef.current.send({ image: videoRef.current });
            lastFrameTime = currentTime;
            errorCount = 0; // Reset error count on success
          } else {
            // MediaPipe instance is invalid, but don't disable immediately
            errorCount++;
            if (errorCount >= MAX_ERRORS) {
              isProcessing = false;
              if (requestRef.current) {
                cancelAnimationFrame(requestRef.current);
                requestRef.current = null;
              }
              // Only disable after many failures
              if (setProcessingEnabled) {
                setProcessingEnabled(false);
              }
              return;
            }
            // Continue trying
          }
        }
        if (isProcessing && processingEnabled) {
          requestRef.current = requestAnimationFrame(process);
        }
      } catch (error) {
        // Check if error is a timestamp mismatch (common MediaPipe issue)
        const errorMessage = error.message || error.toString() || '';
        const isTimestampError = errorMessage.includes('timestamp') || 
                                 errorMessage.includes('Aborted') ||
                                 errorMessage.includes('INVALID_ARGUMENT');
        
        if (isTimestampError) {
          // Ignore timestamp errors - they're not real failures, just frame timing issues
          // Reset error count on timestamp errors since they're expected
          errorCount = Math.max(0, errorCount - 1);
          // Continue processing
          if (isProcessing && processingEnabled) {
            requestRef.current = requestAnimationFrame(process);
          }
          return;
        }
        
        // For other errors, count them
        errorCount++;
        // Only disable after multiple consecutive non-timestamp errors
        if (errorCount >= MAX_ERRORS) {
          isProcessing = false;
          if (requestRef.current) {
            cancelAnimationFrame(requestRef.current);
            requestRef.current = null;
          }
          // Only disable after many failures
          if (setProcessingEnabled) {
            setProcessingEnabled(false);
          }
          console.warn('MediaPipe processing stopped after multiple errors:', error.message || error);
        } else {
          // Continue trying on first few errors
          if (isProcessing && processingEnabled) {
            requestRef.current = requestAnimationFrame(process);
          }
        }
      }
    };
    
    // Wrap in try-catch to prevent any initialization errors
    try {
      process();
    } catch (error) {
      console.warn('Failed to start MediaPipe processing:', error.message || error);
      // Don't disable on first error - let it retry
    }
  };

  const onResults = (results) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    // Stable value (MediaPipe onResults is registered once; do not use closed-over state)
    const currentEffect = activeEffectRef.current;
    const effectStr = typeof currentEffect === 'string' ? currentEffect : null;
    const isUrl = typeof effectStr === 'string' && /^https?:\/\//i.test(effectStr);
    const isBlur = typeof effectStr === 'string' && effectStr.startsWith('blur:');
    const isColor = typeof effectStr === 'string' && effectStr.startsWith('color:');
    const isGradient = typeof effectStr === 'string' && effectStr.startsWith('gradient:');
    const blurStrength = isBlur ? (effectStr.split(':')[1] || 'soft') : null;

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // STEP 1: Draw background FIRST (before the person)
    ctx.globalCompositeOperation = 'source-over';
    if (isBlur) {
      const px = blurStrength === 'strong' ? 16 : 10;
      ctx.filter = `blur(${px}px)`;
      ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
      ctx.filter = 'none';
    } else if (isColor) {
      const color = effectStr.split(':')[1] || '#0f172a';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (isGradient) {
      const name = effectStr.split(':')[1] || 'studio';
      const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      if (name === 'ocean') {
        grad.addColorStop(0, '#0ea5e9');
        grad.addColorStop(1, '#22c55e');
      } else if (name === 'sunset') {
        grad.addColorStop(0, '#f97316');
        grad.addColorStop(0.6, '#db2777');
        grad.addColorStop(1, '#7c3aed');
      } else if (name === 'aurora') {
        grad.addColorStop(0, '#22c55e');
        grad.addColorStop(0.5, '#06b6d4');
        grad.addColorStop(1, '#a855f7');
      } else {
        // studio (default)
        grad.addColorStop(0, '#0f172a');
        grad.addColorStop(0.45, '#1e293b');
        grad.addColorStop(1, '#334155');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (isUrl) {
      if (bgImageRef.current && bgImageLoadedRef.current && bgImageRef.current.complete && bgImageRef.current.naturalWidth > 0) {
        const bgImg = bgImageRef.current;

        const canvasAspect = canvas.width / canvas.height;
        const imgAspect = bgImg.naturalWidth / bgImg.naturalHeight;

        let drawWidth, drawHeight, drawX, drawY;
        if (imgAspect > canvasAspect) {
          drawHeight = canvas.height;
          drawWidth = bgImg.naturalWidth * (canvas.height / bgImg.naturalHeight);
          drawX = (canvas.width - drawWidth) / 2;
          drawY = 0;
        } else {
          drawWidth = canvas.width;
          drawHeight = bgImg.naturalHeight * (canvas.width / bgImg.naturalWidth);
          drawX = 0;
          drawY = (canvas.height - drawHeight) / 2;
        }

        ctx.drawImage(bgImg, drawX, drawY, drawWidth, drawHeight);
      } else {
        ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
      }
    } else {
      ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
    }
    
    // STEP 2: Draw the person (foreground) using segmentation mask
    // The segmentation mask is white where the person is, black where background is
    // We need to composite the person on top of the background using the mask
    
    // Reuse a canvas to extract just the person (avoid per-frame allocations)
    if (!personCanvasRef.current) {
      personCanvasRef.current = document.createElement('canvas');
    }
    const personCanvas = personCanvasRef.current;
    if (personCanvas.width !== canvas.width) personCanvas.width = canvas.width;
    if (personCanvas.height !== canvas.height) personCanvas.height = canvas.height;
    const personCtx = personCanvas.getContext('2d');
    
    // Draw the person image on temp canvas
    personCtx.drawImage(results.image, 0, 0, personCanvas.width, personCanvas.height);
    
    // Apply mask to keep only person (where mask is white)
    personCtx.globalCompositeOperation = 'destination-in';
    personCtx.drawImage(results.segmentationMask, 0, 0, personCanvas.width, personCanvas.height);
    personCtx.globalCompositeOperation = 'source-over';
    
    // Now composite the masked person on top of the background
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(personCanvas, 0, 0, canvas.width, canvas.height);
    
    // Reset composite operation
    ctx.globalCompositeOperation = 'source-over';

    ctx.restore();
  };

  // Show error state
  if (cameraError) {
    return (
      <div className="relative w-full h-full bg-black flex flex-col items-center justify-center p-4 text-center">
        <VideoOff size={48} className="mb-3 text-red-400" />
        <p className="text-sm font-medium text-white mb-2">Camera Access Required</p>
        <p className="text-xs text-slate-400 mb-4 px-2">{cameraError}</p>
        <button
          onClick={async () => {
            setCameraError(null);
            setCameraLoading(true);
            try {
              const nextStream = ensureLocalStream
                ? await ensureLocalStream()
                : await navigator.mediaDevices.getUserMedia({
                    video: {
                      width: { ideal: 1280 },
                      height: { ideal: 720 },
                      facingMode: 'user'
                    },
                    audio: false
                  });
              streamRef.current = nextStream;
              setCameraLoading(false);
              if (videoRef.current) {
                videoRef.current.srcObject = nextStream;
                videoRef.current.onloadedmetadata = () => {
                  videoRef.current.play();
                  if (processingEnabled && segmentationRef.current && modelLoaded) {
                    startProcessing();
                  }
                };
              }
            } catch (err) {
              setCameraLoading(false);
              let errorMessage = mediaError || 'Failed to access camera.';
              if (!ensureLocalStream) {
                if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                  errorMessage = 'Camera permission denied. Please allow camera access in your browser settings.';
                } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                  errorMessage = 'No camera found. Please connect a camera device.';
                }
              }
              setCameraError(errorMessage);
            }
          }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm text-white mb-2"
        >
          Try Again
        </button>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-slate-600 hover:bg-slate-700 rounded-lg text-sm text-white"
        >
          Reload Page
        </button>
      </div>
    );
  }

  // Show loading state
  if (cameraLoading) {
    return (
      <div className="relative w-full h-full bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2"></div>
          <p className="text-xs text-white">Requesting camera access...</p>
          <p className="text-xs text-slate-400 mt-2">Please allow camera access when prompted</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-black">
      {/* Raw Video - visible when processing is disabled OR when processing is enabled but model not loaded yet */}
      <video
        ref={videoRef}
        className={`w-full h-full object-cover transform scale-x-[-1] ${processingEnabled && modelLoaded ? 'hidden' : 'block'}`}
        playsInline 
        muted 
        autoPlay
      />

      {/* Processed Canvas - only visible when processing is enabled AND model is loaded */}
      <canvas
        ref={canvasRef}
        width={1280}
        height={720}
        className={`w-full h-full object-cover transform scale-x-[-1] ${processingEnabled && modelLoaded ? 'block' : 'hidden'}`}
      />

      {/* Loading indicator - only show when processing is enabled but model not loaded */}
      {!modelLoaded && processingEnabled && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-xs z-10">
          <span className="animate-pulse">Loading AI...</span>
        </div>
      )}
    </div>
  );
};

// Simple Camera Preview for Lobby (No Effects)
const CameraPreview = ({ stream, ensureLocalStream, mediaError }) => {
  const videoRef = useRef(null);
  const [error, setError] = useState(null);
  const [hasPermission, setHasPermission] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const streamRef = useRef(null);
  const ownsStreamRef = useRef(false);
  const errorShownRef = useRef(false);

  const startCamera = async () => {
    // Wrap in Promise to ensure all errors are caught
    return new Promise(async (resolve, reject) => {
      try {
        setIsLoading(true);
        setError(null);
        errorShownRef.current = false;

        if (stream) {
          ownsStreamRef.current = false;
          streamRef.current = stream;
          setHasPermission(true);
          setIsLoading(false);
          resolve(stream);
          return;
        }

        if (ensureLocalStream) {
          const sharedStream = await ensureLocalStream();
          ownsStreamRef.current = false;
          streamRef.current = sharedStream;
          setHasPermission(true);
          setIsLoading(false);
          resolve(sharedStream);
          return;
        }
        
        // Check if mediaDevices is available
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          const err = new Error('Camera access is not supported in this browser');
          setIsLoading(false);
          setHasPermission(false);
          setError(err);
          reject(err);
          return;
        }

        try {
          const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
              width: { ideal: 1280 },
              height: { ideal: 720 },
              facingMode: 'user'
            },
            audio: false 
          });

          ownsStreamRef.current = true;
          streamRef.current = stream;
          setHasPermission(true);
          setError(null);
          setIsLoading(false);
          errorShownRef.current = false;

          // Set video stream and ensure it plays
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            // Ensure video plays
            const playVideo = () => {
              if (videoRef.current && videoRef.current.readyState >= 2) {
                videoRef.current.play().catch(() => {
                  // Silently handle play errors
                });
              }
            };
            
            if (videoRef.current.readyState >= 2) {
              playVideo();
            } else {
              videoRef.current.onloadedmetadata = playVideo;
              videoRef.current.oncanplay = playVideo;
            }
          }
          resolve(stream);
        } catch (mediaError) {
          // Handle getUserMedia errors
          const errorObj = mediaError instanceof Error ? mediaError : new Error(String(mediaError));
          setIsLoading(false);
          setHasPermission(false);
          
          let errorMessage = mediaError || 'Camera access denied';
          let toastTitle = 'Camera Permission Denied';
          
          if (!ensureLocalStream && (errorObj.name === 'NotAllowedError' || errorObj.name === 'PermissionDeniedError')) {
            errorMessage = 'Camera permission denied';
            toastTitle = 'Camera Permission Denied';
          } else if (!ensureLocalStream && (errorObj.name === 'NotFoundError' || errorObj.name === 'DevicesNotFoundError')) {
            errorMessage = 'No camera found';
            toastTitle = 'No Camera Found';
          } else if (!ensureLocalStream && (errorObj.name === 'NotReadableError' || errorObj.name === 'TrackStartError')) {
            errorMessage = 'Camera is in use';
            toastTitle = 'Camera In Use';
          }
          
          setError(new Error(errorMessage));
          
          // Show toast notification only once
          if (!errorShownRef.current) {
            errorShownRef.current = true;
            setTimeout(() => {
              try {
                toast({
                  title: toastTitle,
                  description: errorMessage,
                  variant: 'destructive',
                  duration: 5000
                });
              } catch (toastError) {
                // Silently handle toast errors
              }
            }, 100);
          }
          
          reject(errorObj);
        }
      } catch (err) {
        // Catch any other errors
        const errorObj = err instanceof Error ? err : new Error(String(err));
        setIsLoading(false);
        setHasPermission(false);
        setError(errorObj);
        reject(errorObj);
      }
    }).catch(() => {
      // Silently handle - errors already displayed
    });
  };

  useEffect(() => {
    if (!stream) {
      return;
    }

    ownsStreamRef.current = false;
    streamRef.current = stream;
    setHasPermission(true);
    setError(null);
    setIsLoading(false);
  }, [stream]);

  // Effect to ensure video plays when stream is available
  useEffect(() => {
    if (hasPermission && streamRef.current && videoRef.current) {
      if (videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
      }
      
      const playVideo = async () => {
        if (videoRef.current && videoRef.current.readyState >= 2) {
          try {
            await videoRef.current.play();
          } catch (err) {
            // Silently handle play errors
          }
        }
      };

      const handleCanPlay = () => {
        playVideo();
      };

      const handleLoadedMetadata = () => {
        playVideo();
      };

      if (videoRef.current.readyState >= 2) {
        playVideo();
      } else {
        videoRef.current.addEventListener('canplay', handleCanPlay);
        videoRef.current.addEventListener('loadedmetadata', handleLoadedMetadata);
      }

      return () => {
        if (videoRef.current) {
          videoRef.current.removeEventListener('canplay', handleCanPlay);
          videoRef.current.removeEventListener('loadedmetadata', handleLoadedMetadata);
        }
      };
    }
  }, [hasPermission]);

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      if (ownsStreamRef.current && streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      streamRef.current = null;
      ownsStreamRef.current = false;
    };
  }, []);

  const handleRequestCamera = async () => {
    await startCamera();
  };

  // Show button to request camera access if not yet requested
  if (!hasPermission && !isLoading && !error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-800 text-white">
        <div className="text-center p-4">
          <VideoIcon size={48} className="mx-auto mb-4 text-blue-400" />
          <p className="text-sm font-medium mb-2">Camera Access Required</p>
          <p className="text-xs text-slate-400 mb-4">Click the button below to enable your camera</p>
          <button
            onClick={handleRequestCamera}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors"
          >
            Enable Camera
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-800 text-white">
        <div className="text-center p-4">
          <VideoOff size={32} className="mx-auto mb-2 text-red-400" />
          <p className="text-xs text-slate-300 mb-4">{error.message}</p>
          <button
            onClick={handleRequestCamera}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-xs"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-800 text-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2"></div>
          <p className="text-xs">Requesting camera access...</p>
          <p className="text-xs text-slate-400 mt-2">Please allow camera access when prompted</p>
        </div>
      </div>
    );
  }

  return (
    <video 
      ref={videoRef} 
      className="w-full h-full object-cover transform scale-x-[-1]" 
      playsInline 
      muted 
      autoPlay
    />
  );
}

// --- UI HELPERS ---
const DeviceToggle = ({ active, onClick, iconOn: IconOn, iconOff: IconOff, label }) => (
  <button
    onClick={onClick}
    className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-medium transition-all ${
      active
        ? 'border-white/10 bg-white/10 text-white hover:bg-white/15'
        : 'border-rose-500/20 bg-rose-500/12 text-rose-200 hover:bg-rose-500/16'
    }`}
  >
    {active ? <IconOn size={18} /> : <IconOff size={18} />}
    {label}
  </button>
);

const ControlBtn = ({ active, onClick, onIcon: OnIcon, offIcon: OffIcon, tooltip, destructiveWhenInactive = false }) => {
  const Icon = active ? OnIcon : OffIcon;
  const stateClasses = active
    ? 'border-cyan-400/30 bg-cyan-500/20 text-cyan-100 shadow-[0_12px_28px_rgba(34,211,238,0.16)]'
    : destructiveWhenInactive
      ? 'border-rose-500/20 bg-rose-500/15 text-rose-100'
      : 'border-white/10 bg-white/10 text-slate-100 hover:bg-white/15';

  return (
    <button
      onClick={onClick}
      title={tooltip}
      className={`flex h-12 w-12 items-center justify-center rounded-full border transition-all duration-200 sm:h-[3.25rem] sm:w-[3.25rem] ${stateClasses}`}
    >
      <Icon size={19} />
    </button>
  );
};

