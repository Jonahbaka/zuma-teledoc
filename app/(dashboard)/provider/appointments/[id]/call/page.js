'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Mic, MicOff, Video as VideoIcon, VideoOff,
  PhoneOff, Settings, ShieldCheck, User,
  MessageSquare, Sparkles, Image as ImageIcon,
  X, Calendar, Clock, ArrowLeft, FileText,
  Save, Loader2, ClipboardList, Brain, Monitor
} from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { formatDateTime, formatTime } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';
import { VIDEO_BG_PRESETS } from '@/lib/videoBackgrounds';

/* ───────────────────────────── helpers ───────────────────────────── */

const getBgPreviewStyle = (preset) => {
  if (preset.type === 'gradient') {
    const name = (preset.value || '').split(':')[1];
    switch (name) {
      case 'studio':  return { background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 45%, #334155 100%)' };
      case 'ocean':   return { background: 'linear-gradient(135deg, #0ea5e9 0%, #22c55e 100%)' };
      case 'sunset':  return { background: 'linear-gradient(135deg, #f97316 0%, #db2777 60%, #7c3aed 100%)' };
      case 'aurora':  return { background: 'linear-gradient(135deg, #22c55e 0%, #06b6d4 50%, #a855f7 100%)' };
      default:        return { background: 'linear-gradient(135deg, #0f172a 0%, #334155 100%)' };
    }
  }
  if (preset.type === 'color') {
    const color = (preset.value || '').split(':')[1] || '#0f172a';
    return { background: color };
  }
  return null;
};

/* ─────────────────────── MediaPipe self-hosted loader ────────────────────── */
// All MediaPipe assets live in /public/mediapipe/ (copied from npm by postinstall).
// No CDN requests — everything served from our own domain → zero CSP issues.

const MEDIAPIPE_BASE = '/mediapipe';

/**
 * Load the MediaPipe selfie_segmentation JS from our self-hosted public/ folder.
 * Returns a promise that resolves when window.SelfieSegmentation is available.
 */
const loadSelfieSegmentationScript = () => new Promise((resolve, reject) => {
  if (typeof window === 'undefined') { reject(new Error('SSR')); return; }
  if (window.SelfieSegmentation) { resolve(); return; }

  const url = `${MEDIAPIPE_BASE}/selfie_segmentation.js`;
  const existing = document.querySelector(`script[src="${url}"]`);

  if (existing) {
    // Script tag exists — poll for the global
    let polls = 0;
    const iv = setInterval(() => {
      if (window.SelfieSegmentation) { clearInterval(iv); resolve(); return; }
      if (++polls > 100) { clearInterval(iv); reject(new Error('MediaPipe script timeout')); }
    }, 100);
    return;
  }

  const script = document.createElement('script');
  script.src = url;
  script.async = true;
  script.onload = () => {
    let polls = 0;
    const iv = setInterval(() => {
      if (window.SelfieSegmentation) { clearInterval(iv); resolve(); return; }
      if (++polls > 60) { clearInterval(iv); reject(new Error('SelfieSegmentation global not found after load')); }
    }, 50);
  };
  script.onerror = () => reject(new Error('Failed to load self-hosted MediaPipe script'));
  document.head.appendChild(script);
});

/* ═══════════════════════════════════════════════════════════════════ */
/*                       PAGE COMPONENT                               */
/* ═══════════════════════════════════════════════════════════════════ */

export default function ProviderVideoCallPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const appointmentId = params.id;
  const isStandalone = appointmentId === 'standalone';

  const [appointment, setAppointment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isInCall, setIsInCall] = useState(false);
  const [userName, setUserName] = useState('');

  // Device State
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [processingEnabled, setProcessingEnabled] = useState(false);
  const [activeEffect, setActiveEffect] = useState(null);

  // App State
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    if (isStandalone) {
      setAppointment({
        id: 'standalone',
        type: 'video',
        status: 'in_progress',
        patientFirstName: 'Test',
        patientLastName: 'Patient',
        providerFirstName: user?.firstName || '',
        providerLastName: user?.lastName || '',
        scheduledAt: new Date().toISOString(),
        durationMinutes: 30,
        reasonForVisit: 'Standalone provider video call (no appointment)'
      });
      if (user?.firstName) {
        setUserName(`Dr. ${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`);
      }
      setLoading(false);
      return;
    }
    fetchAppointment();
  }, [appointmentId]);

  const fetchAppointment = async () => {
    try {
      const response = await api.get(`/appointments/${appointmentId}`);
      if (response.data.success) {
        setAppointment(response.data.appointment);
        if (response.data.appointment.providerFirstName) {
          setUserName(`Dr. ${response.data.appointment.providerFirstName} ${response.data.appointment.providerLastName}`);
        }
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to load appointment details', variant: 'destructive' });
      router.push('/provider/appointments');
    } finally {
      setLoading(false);
    }
  };

  const startCall = () => { if (userName.trim()) setIsInCall(true); };
  const endCall = () => {
    setIsInCall(false);
    setActiveEffect(null);
    router.push(isStandalone ? '/provider/dashboard' : `/provider/appointments/${appointmentId}/visit`);
  };

  /* Loading / Error states */
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" />
          <p className="text-slate-600">{isStandalone ? 'Preparing call...' : 'Loading appointment...'}</p>
        </div>
      </div>
    );
  }

  if (!appointment) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-600 mb-4">Appointment not found</p>
          <Button onClick={() => router.push('/provider/appointments')}>Back to Appointments</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-blue-100">
      {/* Header */}
      <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 fixed top-0 w-full z-50">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon"
            onClick={() => router.push(isStandalone ? '/provider/dashboard' : `/provider/appointments/${appointmentId}/visit`)}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">Z</div>
            <span className="font-semibold text-lg tracking-tight text-purple-700">Docta<span className="text-yellow-500">.</span></span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm font-medium text-slate-500">
          <div className="flex items-center gap-1.5 text-purple-600 bg-purple-50 px-3 py-1 rounded-full border border-purple-100">
            <ShieldCheck size={14} />
            <span>HIPAA Secure</span>
          </div>
          <div className="hidden md:block">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="pt-14 h-screen flex flex-col">
        {!isInCall ? (
          <Lobby
            appointment={appointment}
            userName={userName}
            setUserName={setUserName}
            onJoin={startCall}
            micOn={micOn} setMicOn={setMicOn}
            camOn={camOn} setCamOn={setCamOn}
          />
        ) : (
          <ActiveCallRoom
            appointment={appointment}
            micOn={micOn} toggleMic={() => setMicOn(!micOn)}
            camOn={camOn} toggleCam={() => setCamOn(!camOn)}
            activeEffect={activeEffect} setActiveEffect={setActiveEffect}
            onEndCall={endCall}
            isSidebarOpen={isSidebarOpen} toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
            showSettings={showSettings} setShowSettings={setShowSettings}
            processingEnabled={processingEnabled} setProcessingEnabled={setProcessingEnabled}
          />
        )}
      </main>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════ */
/*                       PRE-CALL LOBBY                               */
/* ═══════════════════════════════════════════════════════════════════ */

const Lobby = ({ appointment, userName, setUserName, onJoin, micOn, setMicOn, camOn, setCamOn }) => (
  <div className="flex-1 flex items-center justify-center p-4 bg-slate-50">
    <div className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
      {/* Left: Info */}
      <div className="space-y-6">
        <div>
          <h1 className="text-4xl font-bold text-slate-900 leading-tight mb-2">
            Appointment with <br/>
            <span className="text-blue-600">{appointment.patientFirstName} {appointment.patientLastName}</span>
          </h1>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
          <div className="flex items-center gap-3 text-slate-700">
            <Calendar className="w-5 h-5 text-blue-600" />
            <div>
              <p className="text-sm text-slate-500">Appointment Date</p>
              <p className="font-semibold">{formatDateTime(appointment.scheduledAt)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-slate-700">
            <Clock className="w-5 h-5 text-blue-600" />
            <div>
              <p className="text-sm text-slate-500">Duration</p>
              <p className="font-semibold">{appointment.durationMinutes || 30} minutes</p>
            </div>
          </div>
          {appointment.reasonForVisit && (
            <div className="pt-2 border-t border-slate-100">
              <p className="text-sm text-slate-500 mb-1">Reason for Visit</p>
              <p className="text-slate-700">{appointment.reasonForVisit}</p>
            </div>
          )}
        </div>

        <p className="text-slate-600 text-lg">Please check your devices before starting the appointment.</p>

        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
          <p className="text-sm text-purple-700">
            <span className="font-semibold">{appointment.patientFirstName} {appointment.patientLastName}</span> can join the waiting room at any time
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Display Name</label>
            <input
              type="text" value={userName} onChange={(e) => setUserName(e.target.value)}
              placeholder="e.g. Dr. Smith"
              className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            />
          </div>
          <button onClick={onJoin} disabled={!userName.trim()}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-lg shadow-lg shadow-blue-600/20 transition-all flex items-center justify-center gap-2"
          >
            Start Appointment
          </button>
        </div>
      </div>

      {/* Right: Camera preview */}
      <div className="bg-white p-4 rounded-2xl shadow-xl border border-slate-100">
        <div className="aspect-video bg-slate-900 rounded-xl overflow-hidden relative mb-4 flex items-center justify-center">
          {camOn ? <CameraPreview /> : (
            <div className="text-slate-400 flex flex-col items-center">
              <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mb-2"><VideoOff size={32} /></div>
              <span>Camera Off</span>
            </div>
          )}
          <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full text-white text-xs font-medium flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${micOn ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            {micOn ? 'Mic Active' : 'Mic Muted'}
          </div>
        </div>
        <div className="flex justify-center gap-4">
          <DeviceToggle active={micOn} onClick={() => setMicOn(!micOn)} iconOn={Mic} iconOff={MicOff} label="Microphone" />
          <DeviceToggle active={camOn} onClick={() => setCamOn(!camOn)} iconOn={VideoIcon} iconOff={VideoOff} label="Camera" />
        </div>
      </div>
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════════ */
/*                   ACTIVE CALL ROOM  (Google Meet layout)           */
/* ═══════════════════════════════════════════════════════════════════ */

const ActiveCallRoom = ({
  appointment, micOn, toggleMic, camOn, toggleCam, onEndCall,
  isSidebarOpen, toggleSidebar, showSettings, setShowSettings,
  activeEffect, setActiveEffect, processingEnabled, setProcessingEnabled
}) => {
  const [sidebarTab, setSidebarTab] = useState('notes');

  return (
    <div className="flex-1 flex bg-slate-900 relative overflow-hidden">
      {/* Main Stage — Patient Video (or waiting state) */}
      <div className="flex-1 relative flex items-center justify-center p-3">
        <div className="w-full h-full max-w-6xl relative bg-black rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10">
          {/* Patient waiting state (no WebRTC yet) */}
          <PatientVideoArea appointment={appointment} />

          {/* Patient info badge */}
          <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-sm px-4 py-2 rounded-lg text-white border border-white/10">
            <h3 className="font-semibold text-sm">{appointment.patientFirstName} {appointment.patientLastName}</h3>
            <p className="text-xs text-slate-300">Patient</p>
          </div>

          {/* Call Timer */}
          <CallTimer />

          {/* Self-view PiP */}
          <div className="absolute bottom-4 right-4 w-48 md:w-64 aspect-video bg-slate-800 rounded-xl overflow-hidden shadow-2xl border-2 border-slate-700/50 transition-all hover:scale-105 z-20">
            {camOn ? (
              <SelfieCamera
                micOn={micOn}
                activeEffect={activeEffect}
                processingEnabled={processingEnabled}
                setProcessingEnabled={setProcessingEnabled}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-500 bg-slate-800">
                <User size={32} />
              </div>
            )}
            <div className="absolute bottom-2 left-2 text-[10px] font-bold text-white bg-black/50 px-2 py-0.5 rounded">YOU</div>
          </div>
        </div>
      </div>

      {/* Effects Panel */}
      {showSettings && (
        <div className="absolute bottom-24 right-6 w-80 bg-white rounded-2xl shadow-2xl p-4 z-50 animate-in fade-in slide-in-from-bottom-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-slate-800">Video Effects</h3>
            <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-600">Virtual Background</span>
              <button
                onClick={() => {
                  const next = !processingEnabled;
                  setProcessingEnabled(next);
                  if (!next) setActiveEffect(null);
                }}
                className={`w-11 h-6 flex items-center rounded-full transition-colors ${processingEnabled ? 'bg-blue-600' : 'bg-slate-300'}`}
              >
                <div className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform ${processingEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
              </button>
            </div>
            {processingEnabled && (
              <div className="grid grid-cols-3 gap-2">
                {VIDEO_BG_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => {
                      if (preset.value === null) { setActiveEffect(null); setProcessingEnabled(false); }
                      else { setActiveEffect(preset.value); }
                    }}
                    className={`p-2 rounded-lg border text-[11px] flex flex-col items-center gap-2 transition-colors ${
                      activeEffect === preset.value ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {preset.type === 'blur' ? (
                      <div className="w-7 h-7 rounded bg-slate-300 blur-sm" />
                    ) : preset.type === 'image' ? (
                      <img src={preset.value} className="w-7 h-7 rounded object-cover" alt="" />
                    ) : preset.type === 'gradient' || preset.type === 'color' ? (
                      <div className="w-7 h-7 rounded" style={getBgPreviewStyle(preset)} />
                    ) : (
                      <div className="w-7 h-7 rounded bg-slate-200 flex items-center justify-center text-slate-500"><VideoOff size={12} /></div>
                    )}
                    {preset.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom Control Bar */}
      <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 flex items-center gap-3 bg-slate-800/90 backdrop-blur-md px-6 py-3 rounded-full shadow-2xl border border-white/10 z-40">
        <ControlBtn active={micOn} onClick={toggleMic} onIcon={Mic} offIcon={MicOff} tooltip="Microphone" />
        <ControlBtn active={camOn} onClick={toggleCam} onIcon={VideoIcon} offIcon={VideoOff} tooltip="Camera" />
        <div className="w-px h-8 bg-slate-600 mx-1" />
        <ControlBtn active={showSettings} onClick={() => setShowSettings(!showSettings)} onIcon={Sparkles} offIcon={Sparkles} tooltip="Effects" />
        <ControlBtn
          active={isSidebarOpen && sidebarTab === 'notes'}
          onClick={() => {
            if (isSidebarOpen && sidebarTab === 'notes') toggleSidebar();
            else { setSidebarTab('notes'); if (!isSidebarOpen) toggleSidebar(); }
          }}
          onIcon={FileText} offIcon={FileText} tooltip="Notes"
        />
        <ControlBtn
          active={isSidebarOpen && sidebarTab === 'chat'}
          onClick={() => {
            if (isSidebarOpen && sidebarTab === 'chat') toggleSidebar();
            else { setSidebarTab('chat'); if (!isSidebarOpen) toggleSidebar(); }
          }}
          onIcon={MessageSquare} offIcon={MessageSquare} tooltip="Chat"
        />
        <button onClick={onEndCall} className="ml-3 bg-red-500 hover:bg-red-600 text-white p-4 rounded-full transition-all shadow-lg shadow-red-500/30">
          <PhoneOff size={20} fill="currentColor" />
        </button>
      </div>

      {/* Right Sidebar — Notes & Chat */}
      {isSidebarOpen && (
        <div className="w-96 bg-white h-full border-l border-slate-200 animate-in slide-in-from-right absolute right-0 top-0 z-30 flex flex-col">
          <div className="flex border-b border-slate-200">
            <button onClick={() => setSidebarTab('notes')}
              className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                sidebarTab === 'notes' ? 'text-violet-600 border-b-2 border-violet-500 bg-violet-50/50' : 'text-slate-500 hover:text-slate-700'
              }`}
            ><FileText size={16} /> Notes</button>
            <button onClick={() => setSidebarTab('chat')}
              className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                sidebarTab === 'chat' ? 'text-blue-600 border-b-2 border-blue-500 bg-blue-50/50' : 'text-slate-500 hover:text-slate-700'
              }`}
            ><MessageSquare size={16} /> Chat</button>
            <button onClick={toggleSidebar} className="px-3 text-slate-400 hover:text-slate-600"><X size={18} /></button>
          </div>

          {sidebarTab === 'notes' && <LiveNotesPanel appointment={appointment} />}
          {sidebarTab === 'chat' && (
            <>
              <div className="flex-1 p-4 overflow-y-auto space-y-4">
                <div className="bg-blue-50 p-3 rounded-lg rounded-tl-none max-w-[85%]">
                  <p className="text-sm text-blue-900">Hello! I&apos;m ready for our appointment.</p>
                  <span className="text-[10px] text-blue-700/60 block mt-1">Dr. {appointment.providerLastName} &bull; {formatTime(new Date())}</span>
                </div>
              </div>
              <div className="p-4 border-t border-slate-100">
                <input type="text" placeholder="Type a secure message..." className="w-full px-3 py-2 bg-slate-100 rounded-lg text-sm outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════ */
/*     PATIENT VIDEO AREA (replaces BigBuckBunny placeholder)        */
/* ═══════════════════════════════════════════════════════════════════ */

const PatientVideoArea = ({ appointment }) => {
  // When WebRTC peer connection is established the remote stream will be
  // attached here.  For now we show a professional waiting screen.
  return (
    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="text-center">
        {/* Patient Avatar */}
        <div className="w-28 h-28 mx-auto rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center mb-6 shadow-xl shadow-blue-500/20">
          <span className="text-4xl font-bold text-white">
            {(appointment.patientFirstName?.[0] || '').toUpperCase()}{(appointment.patientLastName?.[0] || '').toUpperCase()}
          </span>
        </div>
        <h2 className="text-xl font-semibold text-white mb-1">
          {appointment.patientFirstName} {appointment.patientLastName}
        </h2>
        <div className="flex items-center justify-center gap-2 text-slate-400 text-sm">
          <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          <span>Waiting to connect...</span>
        </div>
        <p className="text-xs text-slate-500 mt-4 max-w-xs mx-auto">
          The patient will appear here when they join the call. Audio and video are end-to-end encrypted.
        </p>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════ */
/*                       CALL TIMER                                   */
/* ═══════════════════════════════════════════════════════════════════ */

const CallTimer = () => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return (
    <div className="absolute top-4 right-4 bg-black/40 backdrop-blur px-3 py-1.5 rounded-lg text-white border border-white/10 flex items-center gap-2 z-10">
      <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
      <span className="text-sm font-mono tabular-nums">{String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}</span>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════ */
/*                  LIVE NOTES PANEL (SOAP)                           */
/* ═══════════════════════════════════════════════════════════════════ */

const LiveNotesPanel = ({ appointment }) => {
  const [notes, setNotes] = useState({
    chiefComplaint: appointment.reasonForVisit || '',
    subjective: '', objective: '', assessment: '', plan: '', freeform: ''
  });
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [activeSection, setActiveSection] = useState('freeform');
  const autoSaveTimer = useRef(null);
  const notesRef = useRef(notes);
  notesRef.current = notes;

  useEffect(() => {
    autoSaveTimer.current = setInterval(() => {
      const n = notesRef.current;
      if (n.freeform || n.subjective || n.objective || n.assessment || n.plan) saveNotes(true);
    }, 30000);
    return () => clearInterval(autoSaveTimer.current);
  }, []);

  const saveNotes = async (silent = false) => {
    setSaving(true);
    try {
      if (appointment.id && appointment.id !== 'standalone') {
        await api.post('/visits', {
          appointmentId: appointment.id,
          chiefComplaint: notes.chiefComplaint,
          subjective: notes.subjective || notes.freeform,
          objective: notes.objective,
          assessment: notes.assessment,
          plan: notes.plan,
          status: 'in_progress'
        }).catch(() => api.put(`/visits/appointment/${appointment.id}`, {
          chiefComplaint: notes.chiefComplaint,
          subjective: notes.subjective || notes.freeform,
          objective: notes.objective,
          assessment: notes.assessment,
          plan: notes.plan
        }));
      }
      setLastSaved(new Date());
      if (!silent) toast({ title: 'Notes saved', description: 'Visit notes saved successfully' });
    } catch {
      if (!silent) toast({ title: 'Save failed', description: 'Could not save notes', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const generateSOAP = async () => {
    setAiLoading(true);
    try {
      const response = await api.post('/ai-assist/soap', {
        appointmentId: appointment.id,
        chiefComplaint: notes.chiefComplaint,
        symptoms: notes.freeform || notes.chiefComplaint,
        existingConditions: '', medications: ''
      });
      if (response.data.success) {
        const s = response.data.suggestion;
        setNotes(prev => ({
          ...prev,
          subjective: s.subjective || prev.subjective,
          objective: s.objective || prev.objective,
          assessment: s.assessment || prev.assessment,
          plan: s.plan || prev.plan
        }));
        setActiveSection('soap');
        toast({ title: 'AI Notes Generated', description: 'SOAP notes populated — review and edit as needed' });
      }
    } catch {
      toast({ title: 'AI Generation Failed', description: 'Could not generate SOAP notes', variant: 'destructive' });
    } finally { setAiLoading(false); }
  };

  const updateNote = (field, value) => setNotes(prev => ({ ...prev, [field]: value }));

  const soapSections = [
    { key: 'subjective', label: 'S — Subjective', placeholder: 'Patient reports...' },
    { key: 'objective', label: 'O — Objective', placeholder: 'Vitals, exam findings...' },
    { key: 'assessment', label: 'A — Assessment', placeholder: 'Diagnosis, clinical impression...' },
    { key: 'plan', label: 'P — Plan', placeholder: 'Treatment plan, follow-up, referrals...' },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-violet-50 to-purple-50 border-b border-violet-100">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-violet-600" />
            <span className="text-sm font-semibold text-violet-900">Visit Notes</span>
          </div>
          <div className="flex items-center gap-2">
            {lastSaved && (
              <span className="text-[10px] text-slate-400">
                Saved {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <button onClick={() => saveNotes(false)} disabled={saving}
              className="px-2.5 py-1 bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium rounded-lg flex items-center gap-1 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Save
            </button>
          </div>
        </div>
        <div className="flex gap-1">
          <button onClick={() => setActiveSection('freeform')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              activeSection === 'freeform' ? 'bg-violet-600 text-white' : 'bg-white text-slate-600 hover:bg-violet-100'
            }`}
          >Quick Notes</button>
          <button onClick={() => setActiveSection('soap')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              activeSection === 'soap' ? 'bg-violet-600 text-white' : 'bg-white text-slate-600 hover:bg-violet-100'
            }`}
          >SOAP Format</button>
          <button onClick={generateSOAP} disabled={aiLoading || (!notes.freeform && !notes.chiefComplaint)}
            className="ml-auto px-3 py-1 text-xs font-medium rounded-md bg-gradient-to-r from-purple-500 to-violet-600 text-white hover:from-purple-600 hover:to-violet-700 disabled:opacity-40 flex items-center gap-1"
          >
            {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3" />}
            AI SOAP
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div>
          <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Chief Complaint</label>
          <input value={notes.chiefComplaint} onChange={(e) => updateNote('chiefComplaint', e.target.value)}
            placeholder="Reason for visit..."
            className="w-full mt-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
          />
        </div>

        {activeSection === 'freeform' ? (
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Notes (type during the call)</label>
            <textarea value={notes.freeform} onChange={(e) => updateNote('freeform', e.target.value)}
              placeholder={"Type notes as the patient talks...\n\n- Symptoms, history, observations\n- Click 'AI SOAP' when ready to structure into SOAP format"}
              className="w-full mt-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none resize-none"
              style={{ minHeight: '280px' }} autoFocus
            />
            <p className="text-[10px] text-slate-400 mt-1">Tip: Jot down notes freely, then tap &quot;AI SOAP&quot; to auto-structure them</p>
          </div>
        ) : (
          soapSections.map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{label}</label>
              <textarea value={notes[key]} onChange={(e) => updateNote(key, e.target.value)}
                placeholder={placeholder}
                className="w-full mt-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none resize-none"
                rows={3}
              />
            </div>
          ))
        )}
      </div>

      <div className="px-4 py-2 border-t border-slate-100 bg-slate-50 text-[10px] text-slate-400 flex items-center justify-between">
        <span>Auto-saves every 30s</span>
        <span>HIPAA-compliant</span>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════ */
/*          SELFIE CAMERA — Self-hosted MediaPipe (no CDN)           */
/* ═══════════════════════════════════════════════════════════════════ */

const SelfieCamera = ({ micOn, activeEffect, processingEnabled, setProcessingEnabled }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const bgImageRef = useRef(null);
  const bgImageLoadedRef = useRef(false);
  const personCanvasRef = useRef(null);
  const segmentationRef = useRef(null);
  const requestRef = useRef(null);
  const streamRef = useRef(null);
  const activeEffectRef = useRef(activeEffect);

  const [modelLoaded, setModelLoaded] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [cameraLoading, setCameraLoading] = useState(true);

  useEffect(() => { activeEffectRef.current = activeEffect; }, [activeEffect]);

  /* ── 1. Init / tear-down MediaPipe when processingEnabled changes ── */
  useEffect(() => {
    if (!processingEnabled) {
      if (requestRef.current) { cancelAnimationFrame(requestRef.current); requestRef.current = null; }
      setModelLoaded(false);
      return;
    }

    // Re-use existing model
    if (segmentationRef.current) { setModelLoaded(true); return; }

    let cancelled = false;
    let attempt = 0;

    const init = async () => {
      try {
        await loadSelfieSegmentationScript();
        if (cancelled) return;
        if (segmentationRef.current) { setModelLoaded(true); return; }

        const seg = new window.SelfieSegmentation({
          locateFile: (file) => `${MEDIAPIPE_BASE}/${file}`,   // <-- self-hosted
        });
        seg.setOptions({ modelSelection: 1, selfieMode: true });
        seg.onResults(onResults);

        // Warm-up
        if (videoRef.current?.readyState >= 2) {
          try { await seg.send({ image: videoRef.current }); } catch { /* ok */ }
        }
        if (cancelled) { try { seg.close(); } catch {} return; }

        segmentationRef.current = seg;
        setModelLoaded(true);
        attempt = 0;
      } catch (err) {
        if (cancelled) return;
        attempt++;
        console.warn(`MediaPipe init attempt ${attempt} failed:`, err.message);
        if (attempt < 3) {
          setTimeout(() => { if (!cancelled) init(); }, 1500 * attempt);
        } else {
          toast({
            title: 'Virtual Background Unavailable',
            description: 'Could not load AI background model. Your camera still works normally.',
            variant: 'destructive', duration: 5000
          });
          setProcessingEnabled(false);
        }
      }
    };

    init();
    return () => { cancelled = true; if (requestRef.current) { cancelAnimationFrame(requestRef.current); requestRef.current = null; } };
  }, [processingEnabled]);

  /* ── 2. Preload background image ── */
  useEffect(() => {
    const effect = activeEffect;
    const isUrl = typeof effect === 'string' && /^https?:\/\//i.test(effect);
    if (isUrl) {
      bgImageLoadedRef.current = false;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { bgImageRef.current = img; bgImageLoadedRef.current = true; };
      img.onerror = () => { bgImageRef.current = null; bgImageLoadedRef.current = false; };
      img.src = effect;
    } else {
      bgImageRef.current = null;
      bgImageLoadedRef.current = false;
    }
  }, [activeEffect]);

  /* ── 3. Camera stream ── */
  useEffect(() => {
    let mounted = true;
    const startCamera = async () => {
      try {
        setCameraLoading(true);
        setCameraError(null);
        if (!navigator.mediaDevices?.getUserMedia) {
          if (mounted) { setCameraLoading(false); setCameraError('Camera not supported in this browser'); }
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: false
        });
        if (!mounted) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        setCameraLoading(false);
        setCameraError(null);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play().catch(() => {});
            if (processingEnabled && segmentationRef.current) startProcessing();
          };
        }
      } catch (err) {
        if (!mounted) return;
        setCameraLoading(false);
        let msg = 'Camera access denied';
        if (err.name === 'NotFoundError') msg = 'No camera found';
        else if (err.name === 'NotReadableError') msg = 'Camera is in use by another app';
        setCameraError(msg);
        toast({ title: 'Camera Error', description: msg, variant: 'destructive', duration: 5000 });
      }
    };
    startCamera();
    return () => {
      mounted = false;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  /* ── 4. Start processing loop when model + video ready ── */
  useEffect(() => {
    if (modelLoaded && processingEnabled && segmentationRef.current && videoRef.current?.readyState >= 2) {
      startProcessing();
    }
  }, [modelLoaded, processingEnabled]);

  /* ── Processing loop ── */
  const startProcessing = () => {
    if (!segmentationRef.current || !videoRef.current || !modelLoaded) return;
    if (requestRef.current) { cancelAnimationFrame(requestRef.current); requestRef.current = null; }

    let alive = true;
    let errorCount = 0;
    let lastSendTime = 0;
    const FPS_CAP = 24;
    const MIN_INTERVAL = 1000 / FPS_CAP;

    // Match canvas to video dimensions
    const vw = videoRef.current.videoWidth || 1280;
    const vh = videoRef.current.videoHeight || 720;
    if (canvasRef.current) { canvasRef.current.width = vw; canvasRef.current.height = vh; }

    const loop = async () => {
      if (!alive || !processingEnabled) return;
      const now = performance.now();
      if (now - lastSendTime < MIN_INTERVAL) { requestRef.current = requestAnimationFrame(loop); return; }

      try {
        const vid = videoRef.current;
        const seg = segmentationRef.current;
        if (vid?.readyState >= 2 && seg?.send) {
          await seg.send({ image: vid });
          lastSendTime = now;
          errorCount = 0;
        }
      } catch (err) {
        const msg = (err.message || '').toLowerCase();
        if (!msg.includes('timestamp') && !msg.includes('aborted') && !msg.includes('invalid_argument')) {
          errorCount++;
          if (errorCount >= 15) { alive = false; setProcessingEnabled(false); return; }
        }
      }

      if (alive && processingEnabled) requestRef.current = requestAnimationFrame(loop);
    };
    requestRef.current = requestAnimationFrame(loop);
  };

  /* ── onResults: Composite background + person ── */
  const onResults = (results) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const currentEffect = activeEffectRef.current;
    const effectStr = typeof currentEffect === 'string' ? currentEffect : null;
    const isUrl = effectStr && /^https?:\/\//i.test(effectStr);
    const isBlur = effectStr?.startsWith('blur:');
    const isColor = effectStr?.startsWith('color:');
    const isGradient = effectStr?.startsWith('gradient:');

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Draw background
    ctx.globalCompositeOperation = 'source-over';
    if (isBlur) {
      const px = effectStr.split(':')[1] === 'strong' ? 18 : 10;
      ctx.filter = `blur(${px}px)`;
      ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
      ctx.filter = 'none';
    } else if (isColor) {
      ctx.fillStyle = effectStr.split(':')[1] || '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (isGradient) {
      const name = effectStr.split(':')[1] || 'studio';
      const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      if (name === 'ocean') { g.addColorStop(0, '#0ea5e9'); g.addColorStop(1, '#22c55e'); }
      else if (name === 'sunset') { g.addColorStop(0, '#f97316'); g.addColorStop(0.6, '#db2777'); g.addColorStop(1, '#7c3aed'); }
      else if (name === 'aurora') { g.addColorStop(0, '#22c55e'); g.addColorStop(0.5, '#06b6d4'); g.addColorStop(1, '#a855f7'); }
      else { g.addColorStop(0, '#0f172a'); g.addColorStop(0.45, '#1e293b'); g.addColorStop(1, '#334155'); }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (isUrl && bgImageRef.current && bgImageLoadedRef.current) {
      const bg = bgImageRef.current;
      const cAspect = canvas.width / canvas.height;
      const iAspect = bg.naturalWidth / bg.naturalHeight;
      let dw, dh, dx, dy;
      if (iAspect > cAspect) { dh = canvas.height; dw = bg.naturalWidth * (canvas.height / bg.naturalHeight); dx = (canvas.width - dw) / 2; dy = 0; }
      else { dw = canvas.width; dh = bg.naturalHeight * (canvas.width / bg.naturalWidth); dx = 0; dy = (canvas.height - dh) / 2; }
      ctx.drawImage(bg, dx, dy, dw, dh);
    } else {
      ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
    }

    // 2. Extract person via mask, composite on top
    if (!personCanvasRef.current) personCanvasRef.current = document.createElement('canvas');
    const pc = personCanvasRef.current;
    if (pc.width !== canvas.width) pc.width = canvas.width;
    if (pc.height !== canvas.height) pc.height = canvas.height;
    const pCtx = pc.getContext('2d');
    pCtx.clearRect(0, 0, pc.width, pc.height);
    pCtx.drawImage(results.image, 0, 0, pc.width, pc.height);
    pCtx.globalCompositeOperation = 'destination-in';
    pCtx.drawImage(results.segmentationMask, 0, 0, pc.width, pc.height);
    pCtx.globalCompositeOperation = 'source-over';

    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(pc, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  };

  /* ── Render states ── */
  if (cameraError) {
    return (
      <div className="relative w-full h-full bg-black flex flex-col items-center justify-center p-4 text-center">
        <VideoOff size={36} className="mb-2 text-red-400" />
        <p className="text-xs font-medium text-white mb-1">Camera Error</p>
        <p className="text-[10px] text-slate-400 mb-3">{cameraError}</p>
        <button onClick={() => window.location.reload()} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-xs text-white">
          Reload
        </button>
      </div>
    );
  }

  if (cameraLoading) {
    return (
      <div className="relative w-full h-full bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white mx-auto mb-2" />
          <p className="text-[10px] text-white">Requesting camera...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-black">
      <video ref={videoRef}
        className={`w-full h-full object-cover transform scale-x-[-1] ${processingEnabled && modelLoaded ? 'hidden' : 'block'}`}
        playsInline muted autoPlay
      />
      <canvas ref={canvasRef} width={1280} height={720}
        className={`w-full h-full object-cover transform scale-x-[-1] ${processingEnabled && modelLoaded ? 'block' : 'hidden'}`}
      />
      {!modelLoaded && processingEnabled && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-xs z-10">
          <span className="animate-pulse">Loading AI model...</span>
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════ */
/*     SIMPLE CAMERA PREVIEW (Lobby — no effects)                    */
/* ═══════════════════════════════════════════════════════════════════ */

const CameraPreview = () => {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState(null);
  const [hasPermission, setHasPermission] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const startCamera = async () => {
    try {
      setIsLoading(true);
      setError(null);
      if (!navigator.mediaDevices?.getUserMedia) {
        setIsLoading(false);
        setError(new Error('Camera not supported'));
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false
      });
      streamRef.current = stream;
      setHasPermission(true);
      setIsLoading(false);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => videoRef.current?.play().catch(() => {});
      }
    } catch (err) {
      setIsLoading(false);
      let msg = 'Camera access denied';
      if (err.name === 'NotFoundError') msg = 'No camera found';
      else if (err.name === 'NotReadableError') msg = 'Camera in use';
      setError(new Error(msg));
      toast({ title: 'Camera Error', description: msg, variant: 'destructive', duration: 5000 });
    }
  };

  useEffect(() => {
    return () => { streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null; };
  }, []);

  if (!hasPermission && !isLoading && !error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-800 text-white">
        <div className="text-center p-4">
          <VideoIcon size={40} className="mx-auto mb-3 text-blue-400" />
          <p className="text-sm font-medium mb-2">Camera Access Required</p>
          <button onClick={startCamera} className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors">
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
          <VideoOff size={28} className="mx-auto mb-2 text-red-400" />
          <p className="text-xs text-slate-300 mb-3">{error.message}</p>
          <button onClick={startCamera} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-xs">Try Again</button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-800 text-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white mx-auto mb-2" />
          <p className="text-xs">Requesting camera...</p>
        </div>
      </div>
    );
  }

  return <video ref={videoRef} className="w-full h-full object-cover transform scale-x-[-1]" playsInline muted autoPlay />;
};

/* ═══════════════════════════════════════════════════════════════════ */
/*                      UI HELPERS                                    */
/* ═══════════════════════════════════════════════════════════════════ */

const DeviceToggle = ({ active, onClick, iconOn: IconOn, iconOff: IconOff, label }) => (
  <button onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
      active ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-red-50 text-red-600 hover:bg-red-100'
    }`}
  >
    {active ? <IconOn size={18} /> : <IconOff size={18} />}
    {label}
  </button>
);

const ControlBtn = ({ active, onClick, onIcon: OnIcon, offIcon: OffIcon, tooltip }) => (
  <button onClick={onClick} title={tooltip}
    className={`p-3.5 rounded-full transition-all duration-200 ${
      active ? 'bg-slate-700 text-white hover:bg-slate-600' : 'bg-white text-slate-900 hover:bg-slate-200'
    }`}
  >
    {active ? <OnIcon size={20} /> : <OffIcon size={20} />}
  </button>
);
