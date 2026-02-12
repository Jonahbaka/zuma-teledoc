'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Mic, MicOff, Video as VideoIcon, VideoOff,
  PhoneOff, Settings, ShieldCheck, User,
  MessageSquare, Sparkles, Image as ImageIcon,
  X, Calendar, Clock, ArrowLeft, FileText,
  Save, Loader2, ClipboardList, Brain
} from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { formatDateTime, formatTime } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';
import { VIDEO_BG_PRESETS } from '@/lib/videoBackgrounds';

// --- Assets & Constants ---
const PATIENT_VIDEO_URL = "https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

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
    // Standalone provider test call (no appointment required)
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
        // Set default user name from provider name
        if (response.data.appointment.providerFirstName) {
          setUserName(`Dr. ${response.data.appointment.providerFirstName} ${response.data.appointment.providerLastName}`);
        }
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load appointment details',
        variant: 'destructive'
      });
      router.push('/provider/appointments');
    } finally {
      setLoading(false);
    }
  };

  const startCall = () => {
    if (userName.trim()) setIsInCall(true);
  };

  const endCall = () => {
    setIsInCall(false);
    setActiveEffect(null);
    router.push(isStandalone ? '/provider/dashboard' : `/provider/appointments/${appointmentId}/visit`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
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
      {/* Header / Nav */}
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 fixed top-0 w-full z-50">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push(isStandalone ? '/provider/dashboard' : `/provider/appointments/${appointmentId}/visit`)}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">
              Z
            </div>
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

      {/* Main Content Area */}
      <main className="pt-16 h-screen flex flex-col">
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
          />
        )}
      </main>
    </div>
  );
}

// --- PRE-CALL LOBBY COMPONENT ---
const Lobby = ({ appointment, userName, setUserName, onJoin, micOn, setMicOn, camOn, setCamOn }) => {
  return (
    <div className="flex-1 flex items-center justify-center p-4 bg-slate-50">
      <div className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
        {/* Left: Introduction */}
        <div className="space-y-6">
          <div>
            <h1 className="text-4xl font-bold text-slate-900 leading-tight mb-2">
              Appointment with <br/>
              <span className="text-blue-600">{appointment.patientFirstName} {appointment.patientLastName}</span>
            </h1>
          </div>

          {/* Appointment Details */}
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

          <p className="text-slate-600 text-lg">
            Please check your devices before starting the appointment.
          </p>

          {/* Patient Status Indicator */}
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse"></div>
            <p className="text-sm text-purple-700">
              <span className="font-semibold">{appointment.patientFirstName} {appointment.patientLastName}</span> can join the waiting room at any time
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Display Name</label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="e.g. Dr. Smith"
                className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              />
            </div>

            <button
              onClick={onJoin}
              disabled={!userName.trim()}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-lg shadow-lg shadow-blue-600/20 transition-all flex items-center justify-center gap-2"
            >
              Start Appointment
            </button>
          </div>
        </div>

        {/* Right: Device Preview */}
        <div className="bg-white p-4 rounded-2xl shadow-xl border border-slate-100">
          <div className="aspect-video bg-slate-900 rounded-xl overflow-hidden relative mb-4 flex items-center justify-center">
            {camOn ? (
              <CameraPreview />
            ) : (
              <div className="text-slate-400 flex flex-col items-center">
                <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mb-2">
                  <VideoOff size={32} />
                </div>
                <span>Camera Off</span>
              </div>
            )}

            <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full text-white text-xs font-medium flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${micOn ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
              {micOn ? 'Mic Active' : 'Mic Muted'}
            </div>
          </div>
          <div className="flex justify-center gap-4">
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
  processingEnabled, setProcessingEnabled
}) => {
  const [sidebarTab, setSidebarTab] = useState('notes'); // 'chat' | 'notes'

  return (
    <div className="flex-1 flex bg-slate-900 relative overflow-hidden">
      {/* Main Stage (Remote Patient) */}
      <div className="flex-1 relative flex items-center justify-center p-4">
        <div className="w-full h-full max-w-6xl relative bg-black rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10">
          {/* Simulated Patient Video */}
          <video
            src={PATIENT_VIDEO_URL}
            className="w-full h-full object-cover opacity-80"
            autoPlay loop muted playsInline
          />

          <div className="absolute top-4 left-4 bg-black/40 backdrop-blur px-4 py-2 rounded-lg text-white border border-white/10">
            <h3 className="font-semibold text-sm">{appointment.patientFirstName} {appointment.patientLastName}</h3>
            <p className="text-xs text-slate-300">Patient</p>
          </div>

          {/* Call Timer */}
          <CallTimer />

          {/* Self View (PiP) */}
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
            <div className="absolute bottom-2 left-2 text-[10px] font-bold text-white bg-black/50 px-2 py-0.5 rounded">
              YOU
            </div>
          </div>
        </div>
      </div>

      {/* Settings Modal / Popover */}
      {showSettings && (
        <div className="absolute bottom-24 right-6 w-80 bg-white rounded-2xl shadow-2xl p-4 z-50 animate-in fade-in slide-in-from-bottom-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-slate-800">Video Effects</h3>
            <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-600">
              <X size={18} />
            </button>
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
                       if (preset.value === null) {
                         // "None" preset — disable processing
                         setActiveEffect(null);
                         setProcessingEnabled(false);
                       } else {
                         setActiveEffect(preset.value);
                       }
                     }}
                     className={`p-2 rounded-lg border text-[11px] flex flex-col items-center gap-2 transition-colors ${
                       activeEffect === preset.value
                         ? 'border-blue-500 bg-blue-50 text-blue-700'
                         : 'border-slate-200 hover:bg-slate-50'
                     }`}
                   >
                     {preset.type === 'blur' ? (
                       <div className="w-7 h-7 rounded bg-slate-300 blur-sm" />
                     ) : preset.type === 'image' ? (
                       <img src={preset.value} className="w-7 h-7 rounded object-cover" alt="" />
                     ) : preset.type === 'gradient' || preset.type === 'color' ? (
                       <div className="w-7 h-7 rounded" style={getBgPreviewStyle(preset)} />
                     ) : (
                       <div className="w-7 h-7 rounded bg-slate-200 flex items-center justify-center text-slate-500">
                         <VideoOff size={12} />
                       </div>
                     )}
                     {preset.name}
                   </button>
                 ))}
               </div>
             )}
          </div>
        </div>
      )}

      {/* Control Bar */}
      <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 flex items-center gap-3 bg-slate-800/90 backdrop-blur-md px-6 py-3 rounded-full shadow-2xl border border-white/10 z-40">
        <ControlBtn
          active={micOn}
          onClick={toggleMic}
          onIcon={Mic}
          offIcon={MicOff}
        />
        <ControlBtn
          active={camOn}
          onClick={toggleCam}
          onIcon={VideoIcon}
          offIcon={VideoOff}
        />
        <div className="w-px h-8 bg-slate-600 mx-2" />

        <ControlBtn
          active={showSettings}
          onClick={() => setShowSettings(!showSettings)}
          onIcon={Sparkles}
          offIcon={Sparkles}
          tooltip="Effects"
        />

        <ControlBtn
          active={isSidebarOpen && sidebarTab === 'notes'}
          onClick={() => {
            if (isSidebarOpen && sidebarTab === 'notes') { toggleSidebar(); }
            else { setSidebarTab('notes'); if (!isSidebarOpen) toggleSidebar(); }
          }}
          onIcon={FileText}
          offIcon={FileText}
          tooltip="Notes"
        />

        <ControlBtn
          active={isSidebarOpen && sidebarTab === 'chat'}
          onClick={() => {
            if (isSidebarOpen && sidebarTab === 'chat') { toggleSidebar(); }
            else { setSidebarTab('chat'); if (!isSidebarOpen) toggleSidebar(); }
          }}
          onIcon={MessageSquare}
          offIcon={MessageSquare}
          tooltip="Chat"
        />

        <button
          onClick={onEndCall}
          className="ml-4 bg-red-500 hover:bg-red-600 text-white p-4 rounded-full transition-all shadow-lg shadow-red-500/30"
        >
          <PhoneOff size={20} fill="currentColor" />
        </button>
      </div>

      {/* Sidebar — Notes & Chat */}
      {isSidebarOpen && (
        <div className="w-96 bg-white h-full border-l border-slate-200 animate-in slide-in-from-right absolute right-0 top-0 z-30 flex flex-col">
          {/* Sidebar Tabs */}
          <div className="flex border-b border-slate-200">
            <button
              onClick={() => setSidebarTab('notes')}
              className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                sidebarTab === 'notes' ? 'text-violet-600 border-b-2 border-violet-500 bg-violet-50/50' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <FileText size={16} /> Notes
            </button>
            <button
              onClick={() => setSidebarTab('chat')}
              className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                sidebarTab === 'chat' ? 'text-blue-600 border-b-2 border-blue-500 bg-blue-50/50' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <MessageSquare size={16} /> Chat
            </button>
            <button onClick={toggleSidebar} className="px-3 text-slate-400 hover:text-slate-600">
              <X size={18} />
            </button>
          </div>

          {/* Notes Tab */}
          {sidebarTab === 'notes' && (
            <LiveNotesPanel appointment={appointment} />
          )}

          {/* Chat Tab */}
          {sidebarTab === 'chat' && (
            <>
              <div className="flex-1 p-4 overflow-y-auto space-y-4">
                <div className="bg-blue-50 p-3 rounded-lg rounded-tl-none max-w-[85%]">
                  <p className="text-sm text-blue-900">Hello! I'm ready for our appointment. How are you feeling today?</p>
                  <span className="text-[10px] text-blue-700/60 block mt-1">Dr. {appointment.providerLastName} • {formatTime(new Date())}</span>
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

// --- CALL TIMER ---
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

// --- LIVE NOTES PANEL (During Video Call) ---
const LiveNotesPanel = ({ appointment }) => {
  const [notes, setNotes] = useState({
    chiefComplaint: appointment.reasonForVisit || '',
    subjective: '',
    objective: '',
    assessment: '',
    plan: '',
    freeform: ''
  });
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [activeSection, setActiveSection] = useState('freeform'); // freeform | soap
  const autoSaveTimer = useRef(null);

  // Auto-save every 30 seconds if notes changed
  const notesRef = useRef(notes);
  notesRef.current = notes;

  useEffect(() => {
    autoSaveTimer.current = setInterval(() => {
      const n = notesRef.current;
      const hasContent = n.freeform || n.subjective || n.objective || n.assessment || n.plan;
      if (hasContent) saveNotes(true);
    }, 30000);
    return () => clearInterval(autoSaveTimer.current);
  }, []);

  const saveNotes = async (silent = false) => {
    setSaving(true);
    try {
      // Save to visit endpoint if appointment exists
      if (appointment.id && appointment.id !== 'standalone') {
        await api.post('/visits', {
          appointmentId: appointment.id,
          chiefComplaint: notes.chiefComplaint,
          subjective: notes.subjective || notes.freeform,
          objective: notes.objective,
          assessment: notes.assessment,
          plan: notes.plan,
          status: 'in_progress'
        }).catch(() => {
          // If create fails (already exists), try update
          return api.put(`/visits/appointment/${appointment.id}`, {
            chiefComplaint: notes.chiefComplaint,
            subjective: notes.subjective || notes.freeform,
            objective: notes.objective,
            assessment: notes.assessment,
            plan: notes.plan
          });
        });
      }
      setLastSaved(new Date());
      if (!silent) toast({ title: 'Notes saved', description: 'Visit notes saved successfully' });
    } catch (err) {
      if (!silent) toast({ title: 'Save failed', description: 'Could not save notes', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const generateSOAP = async () => {
    setAiLoading(true);
    try {
      const response = await api.post('/ai-assist/soap', {
        appointmentId: appointment.id,
        chiefComplaint: notes.chiefComplaint,
        symptoms: notes.freeform || notes.chiefComplaint,
        existingConditions: '',
        medications: ''
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
    } catch (err) {
      toast({ title: 'AI Generation Failed', description: 'Could not generate SOAP notes', variant: 'destructive' });
    } finally {
      setAiLoading(false);
    }
  };

  const updateNote = (field, value) => {
    setNotes(prev => ({ ...prev, [field]: value }));
  };

  const soapSections = [
    { key: 'subjective', label: 'S — Subjective', icon: '🗣️', placeholder: 'Patient reports...' },
    { key: 'objective', label: 'O — Objective', icon: '🔍', placeholder: 'Vitals, exam findings...' },
    { key: 'assessment', label: 'A — Assessment', icon: '🧠', placeholder: 'Diagnosis, clinical impression...' },
    { key: 'plan', label: 'P — Plan', icon: '📋', placeholder: 'Treatment plan, follow-up, referrals...' },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Notes Header */}
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
            <button
              onClick={() => saveNotes(false)}
              disabled={saving}
              className="px-2.5 py-1 bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium rounded-lg flex items-center gap-1 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Save
            </button>
          </div>
        </div>

        {/* Section Toggle */}
        <div className="flex gap-1">
          <button
            onClick={() => setActiveSection('freeform')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              activeSection === 'freeform' ? 'bg-violet-600 text-white' : 'bg-white text-slate-600 hover:bg-violet-100'
            }`}
          >
            Quick Notes
          </button>
          <button
            onClick={() => setActiveSection('soap')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              activeSection === 'soap' ? 'bg-violet-600 text-white' : 'bg-white text-slate-600 hover:bg-violet-100'
            }`}
          >
            SOAP Format
          </button>
          <button
            onClick={generateSOAP}
            disabled={aiLoading || (!notes.freeform && !notes.chiefComplaint)}
            className="ml-auto px-3 py-1 text-xs font-medium rounded-md bg-gradient-to-r from-purple-500 to-violet-600 text-white hover:from-purple-600 hover:to-violet-700 disabled:opacity-40 flex items-center gap-1"
          >
            {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3" />}
            AI SOAP
          </button>
        </div>
      </div>

      {/* Notes Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Chief Complaint — always visible */}
        <div>
          <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Chief Complaint</label>
          <input
            value={notes.chiefComplaint}
            onChange={(e) => updateNote('chiefComplaint', e.target.value)}
            placeholder="Reason for visit..."
            className="w-full mt-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
          />
        </div>

        {activeSection === 'freeform' ? (
          /* Quick Notes — free-form text area for rapid note-taking during call */
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Notes (type during the call)</label>
            <textarea
              value={notes.freeform}
              onChange={(e) => updateNote('freeform', e.target.value)}
              placeholder="Type notes as the patient talks...&#10;&#10;- Symptoms, history, observations&#10;- Click 'AI SOAP' when ready to structure into SOAP format"
              className="w-full mt-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none resize-none"
              style={{ minHeight: '280px' }}
              autoFocus
            />
            <p className="text-[10px] text-slate-400 mt-1">Tip: Jot down notes freely, then tap "AI SOAP" to auto-structure them</p>
          </div>
        ) : (
          /* SOAP Format — structured sections */
          soapSections.map(({ key, label, icon, placeholder }) => (
            <div key={key}>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1">
                <span>{icon}</span> {label}
              </label>
              <textarea
                value={notes[key]}
                onChange={(e) => updateNote(key, e.target.value)}
                placeholder={placeholder}
                className="w-full mt-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none resize-none"
                rows={3}
              />
            </div>
          ))
        )}
      </div>

      {/* Notes Footer */}
      <div className="px-4 py-2 border-t border-slate-100 bg-slate-50 text-[10px] text-slate-400 flex items-center justify-between">
        <span>Auto-saves every 30s</span>
        <span>HIPAA-compliant</span>
      </div>
    </div>
  );
};

// --- CORE CAMERA LOGIC (MediaPipe Integration) ---
const SelfieCamera = ({ micOn, activeEffect, processingEnabled, setProcessingEnabled }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const bgImageRef = useRef(null);
  const bgImageLoadedRef = useRef(false);
  const personCanvasRef = useRef(null);
  const segmentationRef = useRef(null);
  const requestRef = useRef(null);
  const streamRef = useRef(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [cameraLoading, setCameraLoading] = useState(true);
  const errorShownRef = useRef(false);
  const errorHandlerRef = useRef(null);
  const activeEffectRef = useRef(activeEffect);

  useEffect(() => {
    activeEffectRef.current = activeEffect;
  }, [activeEffect]);

  // Load MediaPipe Script — robust loader with retries
  const initAttemptRef = useRef(0);

  useEffect(() => {
    if (!processingEnabled) {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = null;
      }
      // Don't close segmentation on disable — reuse it when re-enabled
      setModelLoaded(false);
      return;
    }

    // If already initialized, just mark as loaded and start processing
    if (segmentationRef.current) {
      setModelLoaded(true);
      return;
    }

    let cancelled = false;
    const SCRIPT_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/selfie_segmentation.js";

    const loadScript = () => new Promise((resolve, reject) => {
      // If global is already available, resolve immediately
      if (window.SelfieSegmentation) { resolve(); return; }

      const existing = document.querySelector(`script[src="${SCRIPT_URL}"]`);
      if (existing) {
        // Script tag exists but may still be loading
        const check = setInterval(() => {
          if (window.SelfieSegmentation) { clearInterval(check); resolve(); }
        }, 100);
        setTimeout(() => { clearInterval(check); reject(new Error('MediaPipe script timeout')); }, 10000);
        return;
      }

      const script = document.createElement('script');
      script.src = SCRIPT_URL;
      script.async = true;
      script.onload = () => {
        // Script loaded but global may need a tick to register
        const check = setInterval(() => {
          if (window.SelfieSegmentation) { clearInterval(check); resolve(); }
        }, 50);
        setTimeout(() => { clearInterval(check); reject(new Error('SelfieSegmentation not found after load')); }, 5000);
      };
      script.onerror = () => reject(new Error('Failed to load MediaPipe CDN script'));
      document.head.appendChild(script);
    });

    const initMediaPipe = async () => {
      try {
        await loadScript();
        if (cancelled) return;

        if (segmentationRef.current) { setModelLoaded(true); return; }

        const seg = new window.SelfieSegmentation({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/${file}`,
        });

        seg.setOptions({ modelSelection: 1, selfieMode: true });
        seg.onResults(onResults);

        // Warm up the model with a blank send if video is ready
        if (videoRef.current && videoRef.current.readyState >= 2) {
          try { await seg.send({ image: videoRef.current }); } catch(e) { /* warm-up may fail, ok */ }
        }

        if (cancelled) { try { seg.close(); } catch(e) {} return; }

        segmentationRef.current = seg;
        setModelLoaded(true);
        initAttemptRef.current = 0;
      } catch (error) {
        if (cancelled) return;
        initAttemptRef.current++;
        console.warn(`MediaPipe init attempt ${initAttemptRef.current} failed:`, error.message);

        if (initAttemptRef.current < 3) {
          // Retry after a delay
          setTimeout(() => { if (!cancelled) initMediaPipe(); }, 1000 * initAttemptRef.current);
        } else {
          // Give up after 3 attempts
          toast({
            title: 'Virtual Background Unavailable',
            description: 'Could not load AI background model. Your camera still works normally.',
            variant: 'destructive',
            duration: 5000
          });
          if (setProcessingEnabled) setProcessingEnabled(false);
        }
      }
    };

    initMediaPipe();

    return () => {
      cancelled = true;
      if (requestRef.current) { cancelAnimationFrame(requestRef.current); requestRef.current = null; }
    };
  }, [processingEnabled]);

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
    let mounted = true;
    
    const startCamera = async () => {
      // Wrap in Promise to ensure all errors are caught
      return new Promise(async (resolve, reject) => {
        try {
          if (!mounted) return;
          
          setCameraLoading(true);
          setCameraError(null);
          errorShownRef.current = false;
          
          // Check if mediaDevices is available
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            const err = new Error('Camera access is not supported in this browser');
            if (mounted) {
              setCameraLoading(false);
              setCameraError(err.message);
            }
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

            if (!mounted) {
              stream.getTracks().forEach(track => track.stop());
              return;
            }

            streamRef.current = stream;
            setCameraLoading(false);
            setCameraError(null);
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
                  if (processingEnabled && segmentationRef.current) {
                    startProcessing();
                  }
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
            
            if (!mounted) return;
            
            setCameraLoading(false);
            
            let errorMessage = 'Camera access denied';
            let toastTitle = 'Camera Permission Denied';
            
            if (errorObj.name === 'NotAllowedError' || errorObj.name === 'PermissionDeniedError') {
              errorMessage = 'Camera permission denied';
              toastTitle = 'Camera Permission Denied';
            } else if (errorObj.name === 'NotFoundError' || errorObj.name === 'DevicesNotFoundError') {
              errorMessage = 'No camera found';
              toastTitle = 'No Camera Found';
            } else if (errorObj.name === 'NotReadableError' || errorObj.name === 'TrackStartError') {
              errorMessage = 'Camera is in use';
              toastTitle = 'Camera In Use';
            }
            
            setCameraError(errorMessage);
            
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
          if (!mounted) return;
          
          const errorObj = err instanceof Error ? err : new Error(String(err));
          setCameraLoading(false);
          setCameraError(errorObj.message);
          reject(errorObj);
        }
      }).catch(() => {
        // Silently handle - errors already displayed
      });
    };

    // Start camera
    startCamera();

    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, []); // Camera stream should not depend on processingEnabled - keep it running

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
            if (processingEnabled && segmentationRef.current) {
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
    if (!segmentationRef.current || !videoRef.current || !modelLoaded) return;

    // Cancel any existing processing loop
    if (requestRef.current) { cancelAnimationFrame(requestRef.current); requestRef.current = null; }

    let alive = true;
    let errorCount = 0;
    let lastSendTime = 0;
    const FPS_CAP = 24; // Lower FPS cap = more stable, less CPU
    const MIN_INTERVAL = 1000 / FPS_CAP;
    const MAX_ERRORS = 15;

    // Match canvas to actual video dimensions
    const vw = videoRef.current.videoWidth || 1280;
    const vh = videoRef.current.videoHeight || 720;
    if (canvasRef.current) {
      canvasRef.current.width = vw;
      canvasRef.current.height = vh;
    }

    const loop = async (timestamp) => {
      if (!alive || !processingEnabled) return;

      const now = performance.now();
      if (now - lastSendTime < MIN_INTERVAL) {
        requestRef.current = requestAnimationFrame(loop);
        return;
      }

      try {
        const vid = videoRef.current;
        const seg = segmentationRef.current;
        if (vid && vid.readyState >= 2 && seg && typeof seg.send === 'function') {
          await seg.send({ image: vid });
          lastSendTime = now;
          errorCount = 0;
        }
      } catch (err) {
        const msg = (err.message || '').toLowerCase();
        // Timestamp/abort errors are benign — just skip that frame
        if (msg.includes('timestamp') || msg.includes('aborted') || msg.includes('invalid_argument')) {
          // skip, don't count
        } else {
          errorCount++;
          if (errorCount >= MAX_ERRORS) {
            alive = false;
            console.warn('Virtual background stopped after repeated errors');
            if (setProcessingEnabled) setProcessingEnabled(false);
            return;
          }
        }
      }

      if (alive && processingEnabled) {
        requestRef.current = requestAnimationFrame(loop);
      }
    };

    requestRef.current = requestAnimationFrame(loop);
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
              const stream = await navigator.mediaDevices.getUserMedia({
                video: { 
                  width: { ideal: 1280 },
                  height: { ideal: 720 },
                  facingMode: 'user'
                },
                audio: false
              });
              streamRef.current = stream;
              setCameraLoading(false);
              if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.onloadedmetadata = () => {
                  videoRef.current.play();
                  if (processingEnabled && segmentationRef.current) {
                    startProcessing();
                  }
                };
              }
            } catch (err) {
              setCameraLoading(false);
              let errorMessage = 'Failed to access camera.';
              if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                errorMessage = 'Camera permission denied. Please allow camera access in your browser settings.';
              } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                errorMessage = 'No camera found. Please connect a camera device.';
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
const CameraPreview = () => {
  const videoRef = useRef(null);
  const [error, setError] = useState(null);
  const [hasPermission, setHasPermission] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const streamRef = useRef(null);
  const errorShownRef = useRef(false);

  const startCamera = async () => {
    // Wrap in Promise to ensure all errors are caught
    return new Promise(async (resolve, reject) => {
      try {
        setIsLoading(true);
        setError(null);
        errorShownRef.current = false;
        
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
          
          let errorMessage = 'Camera access denied';
          let toastTitle = 'Camera Permission Denied';
          
          if (errorObj.name === 'NotAllowedError' || errorObj.name === 'PermissionDeniedError') {
            errorMessage = 'Camera permission denied';
            toastTitle = 'Camera Permission Denied';
          } else if (errorObj.name === 'NotFoundError' || errorObj.name === 'DevicesNotFoundError') {
            errorMessage = 'No camera found';
            toastTitle = 'No Camera Found';
          } else if (errorObj.name === 'NotReadableError' || errorObj.name === 'TrackStartError') {
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
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
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
    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
      active
        ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
        : 'bg-red-50 text-red-600 hover:bg-red-100'
    }`}
  >
    {active ? <IconOn size={18} /> : <IconOff size={18} />}
    {label}
  </button>
);

const ControlBtn = ({ active, onClick, onIcon: OnIcon, offIcon: OffIcon, tooltip }) => (
  <button
    onClick={onClick}
    title={tooltip}
    className={`p-3.5 rounded-full transition-all duration-200 ${
      active
        ? 'bg-slate-700 text-white hover:bg-slate-600'
        : 'bg-white text-slate-900 hover:bg-slate-200'
    }`}
  >
    {active ? <OnIcon size={20} /> : <OffIcon size={20} />}
  </button>
);

