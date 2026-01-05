'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Mic, MicOff, Video as VideoIcon, VideoOff,
  PhoneOff, Settings, ShieldCheck, User,
  MessageSquare, Sparkles, Image as ImageIcon,
  X, Calendar, Clock, ArrowLeft
} from 'lucide-react';
import api, { paymentsAPI } from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { formatDateTime, formatTime } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';
import { VIDEO_BG_PRESETS } from '@/lib/videoBackgrounds';

// --- Assets & Constants ---
const DOCTOR_VIDEO_URL = "https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

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
  const router = useRouter();
  const { user } = useAuth();
  const appointmentId = params.id;
  
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

  // App State
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    fetchAppointment();
    checkPaymentAccess();
  }, [appointmentId]);

  const checkPaymentAccess = async () => {
    try {
      const response = await paymentsAPI.getAppointmentPayment(appointmentId);
      if (response.data.success) {
        if (!response.data.paymentCompleted && response.data.paymentRequired) {
          toast({
            title: 'Payment Required',
            description: 'Please complete payment before joining the video call',
            variant: 'destructive'
          });
          router.push(`/patient/appointments/${appointmentId}`);
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
      router.push('/patient/appointments');
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
    router.push(`/patient/appointments/${appointmentId}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading appointment...</p>
        </div>
      </div>
    );
  }

  if (!appointment) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-600 mb-4">Appointment not found</p>
          <Button onClick={() => router.push('/patient/appointments')}>Back to Appointments</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-blue-100">
      {/* Header / Nav */}
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 fixed top-0 w-full z-50">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/patient/appointments/${appointmentId}`)}>
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
              Your appointment with <br/>
              <span className="text-blue-600">Dr. {appointment.providerFirstName} {appointment.providerLastName}</span>
            </h1>
            {appointment.providerSpecialty && (
              <p className="text-slate-600 text-lg">{appointment.providerSpecialty}</p>
            )}
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
            Please enter your name and check your devices before joining.
          </p>

          {/* Provider Status Indicator */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
            <p className="text-sm text-blue-700">
              <span className="font-semibold">Dr. {appointment.providerFirstName} {appointment.providerLastName}</span> can join the waiting room at any time
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Display Name</label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="e.g. John Doe"
                className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              />
            </div>

            <button
              onClick={onJoin}
              disabled={!userName.trim()}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-lg shadow-lg shadow-blue-600/20 transition-all flex items-center justify-center gap-2"
            >
              Join Appointment
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
  return (
    <div className="flex-1 flex bg-slate-900 relative overflow-hidden">
      {/* Main Stage (Remote Doctor) */}
      <div className="flex-1 relative flex items-center justify-center p-4">
        <div className="w-full h-full max-w-6xl relative bg-black rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10">
          {/* Simulated Doctor Video */}
          <video
            src={DOCTOR_VIDEO_URL}
            className="w-full h-full object-cover opacity-80"
            autoPlay loop muted playsInline
          />

          <div className="absolute top-4 left-4 bg-black/40 backdrop-blur px-4 py-2 rounded-lg text-white border border-white/10">
            <h3 className="font-semibold text-sm">Dr. {appointment.providerFirstName} {appointment.providerLastName}</h3>
            <p className="text-xs text-slate-300">{appointment.providerSpecialty || 'General Practice'}</p>
          </div>

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
              <span className="text-sm font-medium text-slate-600">Enable AI Processing</span>
              <button
                onClick={() => setProcessingEnabled(!processingEnabled)}
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
                     onClick={() => setActiveEffect(preset.value)}
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
                       <div className="w-7 h-7 rounded bg-slate-200" />
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
          active={isSidebarOpen}
          onClick={toggleSidebar}
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

      {/* Sidebar */}
      {isSidebarOpen && (
        <div className="w-80 bg-white h-full border-l border-slate-200 animate-in slide-in-from-right absolute right-0 top-0 z-30 flex flex-col">
          <div className="p-4 border-b border-slate-100 flex justify-between items-center">
            <h3 className="font-bold text-slate-800">Secure Chat</h3>
            <button onClick={toggleSidebar}><X size={18} className="text-slate-400" /></button>
          </div>
          <div className="flex-1 p-4 overflow-y-auto space-y-4">
            <div className="bg-blue-50 p-3 rounded-lg rounded-tl-none max-w-[85%]">
              <p className="text-sm text-blue-900">Hello! I'm reviewing your latest lab results. I'll be with you in a moment.</p>
              <span className="text-[10px] text-blue-700/60 block mt-1">Dr. {appointment.providerLastName} • {formatTime(new Date())}</span>
            </div>
          </div>
          <div className="p-4 border-t border-slate-100">
            <input type="text" placeholder="Type a secure message..." className="w-full px-3 py-2 bg-slate-100 rounded-lg text-sm outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
        </div>
      )}
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
                  if (processingEnabled && segmentationRef.current && modelLoaded) {
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
                  if (processingEnabled && segmentationRef.current && modelLoaded) {
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

