'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import {
  Mic, MicOff, Video, VideoOff, MonitorUp, MessageSquare,
  Activity, PhoneOff, MoreVertical, Sparkles, Send,
  Stethoscope, ChevronRight, Loader,
} from 'lucide-react';

/* ---------- AI notes helper — calls server-side route (key never exposed to browser) ---------- */
const callGemini = async (prompt) => {
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

/* ---------- Control buttons ---------- */
const ControlButton = ({ active, inactiveBg = 'bg-[#3c4043]', activeBg = 'bg-red-500', onClick, icon: Icon, activeIcon: ActiveIcon }) => (
  <button
    onClick={onClick}
    className={`w-12 h-12 flex items-center justify-center rounded-full transition-all ${active ? activeBg : `${inactiveBg} hover:bg-[#4d5154]`}`}
  >
    {active ? <ActiveIcon size={20} className="text-white" /> : <Icon size={20} className="text-white" />}
  </button>
);

const SidebarToggleButton = ({ panelName, currentPanel, onClick, icon: Icon }) => {
  const isActive = currentPanel === panelName;
  return (
    <button
      onClick={() => onClick(panelName)}
      className={`w-12 h-12 flex items-center justify-center rounded-full transition-all ${isActive ? 'bg-blue-100 text-blue-700' : 'bg-transparent text-gray-300 hover:bg-[#3c4043]'}`}
    >
      <Icon size={22} />
    </button>
  );
};

/* ---------- Remote video (patient side placeholder) ---------- */
const RemoteVideo = ({ hr, patientName }) => (
  <div className="relative w-full h-full bg-[#3c4043] rounded-2xl overflow-hidden shadow-2xl border border-gray-700/50">
    <div className="w-full h-full flex items-center justify-center bg-[#2d2f33]">
      <div className="w-32 h-32 rounded-full bg-slate-600 flex items-center justify-center text-4xl font-bold text-white">
        {patientName ? patientName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : 'PT'}
      </div>
    </div>
    <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg text-sm font-medium text-white">
      {patientName || 'Patient'}
    </div>
    <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-md px-3 py-2 rounded-xl flex flex-col items-end text-white shadow-lg border border-white/10">
      <div className="flex items-center space-x-2">
        <Activity size={16} className="text-green-400 animate-pulse" />
        <span className="font-mono font-bold text-lg">{hr} <span className="text-xs font-normal text-gray-300">BPM</span></span>
      </div>
      <div className="text-xs font-mono text-gray-300 mt-0.5">SpO2: 98%</div>
    </div>
  </div>
);

/* ---------- Local video (provider webcam) ---------- */
const LocalVideo = ({ isVideoOff, isMuted, displayName, initials }) => {
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    const startVideo = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (err) {
        console.warn('[NGVideoCall] Camera access denied or unavailable:', err.message);
      }
    };

    if (!isVideoOff) {
      startVideo();
    } else {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    }

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, [isVideoOff]);

  return (
    <div className="relative w-full h-full bg-[#3c4043] rounded-2xl overflow-hidden shadow-2xl border border-gray-700/50">
      {isVideoOff ? (
        <div className="w-full h-full flex items-center justify-center bg-[#202124]">
          <div className="w-28 h-28 rounded-full bg-blue-600 flex items-center justify-center text-4xl font-medium text-white shadow-xl">
            {initials || 'DR'}
          </div>
        </div>
      ) : (
        <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover scale-x-[-1]" />
      )}
      <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg text-sm font-medium text-white">
        {displayName || 'Dr. Provider'} (You)
      </div>
      {isMuted && (
        <div className="absolute top-4 right-4 bg-red-500 p-2 rounded-full shadow-lg">
          <MicOff size={16} className="text-white" />
        </div>
      )}
    </div>
  );
};

/* ---------- Vitals panel ---------- */
const VitalsPanel = ({ hr }) => (
  <div className="flex flex-col h-full bg-slate-50/50 overflow-y-auto">
    <div className="p-6 border-b border-gray-200 bg-white">
      <div className="flex items-center space-x-4 mb-4">
        <div className="w-16 h-16 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-2xl font-bold shadow-sm ring-2 ring-blue-100">
          PT
        </div>
        <div>
          <h3 className="text-xl font-bold text-gray-900">Active Patient</h3>
          <p className="text-sm text-gray-500 font-medium">Consultation in progress</p>
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
              <div className="text-4xl font-extrabold text-gray-900 tracking-tight">
                {v.value} <span className="text-sm font-medium text-gray-400">{v.unit}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

/* ---------- Notes panel ---------- */
const NotesPanel = ({ messages, hr }) => {
  const [noteContent, setNoteContent] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const generate = async (type) => {
    setIsGenerating(true);
    setNoteContent('');
    const transcript = messages.map(m => `[${m.time}] ${m.sender}: ${m.text}`).join('\n');
    let prompt = '';
    if (type === 'soap') {
      prompt = `You are an expert AI clinical scribe. Based on the following consultation transcript and live vitals, generate a professional SOAP note. Use plain text.\n\nTranscript:\n${transcript}\n\nVitals:\nHeart Rate: ${hr} BPM, BP: 120/80, SpO2: 98%, Temp: 98.6°F`;
    } else {
      prompt = `You are a clinical assistant. Based on the following consultation transcript, generate clear take-home instructions for the patient. Use plain text.\n\nTranscript:\n${transcript}`;
    }
    const result = await callGemini(prompt);
    setNoteContent(result);
    setIsGenerating(false);
  };

  return (
    <div className="flex flex-col h-full bg-slate-50/50">
      <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-purple-50 to-white">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-purple-900 flex items-center text-lg">
            <Sparkles size={20} className="mr-2 text-purple-600" /> AI Assistant
          </h3>
          {isGenerating && (
            <span className="flex items-center text-xs font-bold bg-purple-100 text-purple-700 px-3 py-1.5 rounded-full shadow-sm">
              <Loader size={14} className="mr-2 animate-spin" /> Thinking
            </span>
          )}
        </div>
        <p className="text-sm text-purple-600/80 mt-2 font-medium">Analyze conversation and vitals in real-time</p>
        <div className="flex space-x-2 mt-4">
          <button onClick={() => generate('soap')} disabled={isGenerating} className="flex-1 bg-purple-600 text-white rounded-lg py-2.5 text-xs font-bold hover:bg-purple-700 disabled:opacity-50">
            ✨ Generate SOAP Note
          </button>
          <button onClick={() => generate('instructions')} disabled={isGenerating} className="flex-1 bg-white border border-purple-200 text-purple-700 rounded-lg py-2.5 text-xs font-bold hover:bg-purple-50 disabled:opacity-50">
            ✨ Patient Instructions
          </button>
        </div>
      </div>
      <div className="flex-1 p-6 flex flex-col">
        <textarea
          className="flex-1 w-full bg-white border border-gray-200 shadow-inner rounded-2xl p-5 resize-none text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-500 leading-relaxed"
          value={noteContent}
          onChange={e => setNoteContent(e.target.value)}
          placeholder={isGenerating ? 'Analyzing transcript...' : 'AI generated notes will appear here.\n\nSend a message in Chat, then click a generate button above.'}
        />
        <div className="mt-6 flex space-x-4">
          <button className="flex-1 bg-white border border-gray-300 text-gray-700 rounded-xl py-3 text-sm font-bold hover:bg-gray-50 shadow-sm">Edit</button>
          <button className="flex-1 bg-purple-600 text-white rounded-xl py-3 text-sm font-bold hover:bg-purple-700 shadow-sm">Export to EHR</button>
        </div>
      </div>
    </div>
  );
};

/* ---------- Chat panel ---------- */
const ChatPanel = ({ messages, setMessages, chatInput, setChatInput }) => {
  const handleSend = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    setMessages(prev => [...prev, {
      sender: 'Provider',
      text: chatInput,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }]);
    setChatInput('');
  };

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="p-6 border-b border-gray-200">
        <h3 className="font-bold text-gray-900 text-lg">In-call messages</h3>
        <p className="text-sm text-gray-500 mt-1">Messages are only visible during the call</p>
      </div>
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.map((msg, i) => (
          <div key={i} className={`flex flex-col ${msg.sender === 'Provider' ? 'items-end' : 'items-start'}`}>
            <div className="flex items-baseline space-x-2 mb-1.5">
              <span className="text-sm font-bold text-gray-900">{msg.sender}</span>
              <span className="text-xs text-gray-400 font-medium">{msg.time}</span>
            </div>
            <div className={`px-4 py-2.5 text-sm rounded-2xl max-w-[85%] leading-relaxed shadow-sm ${msg.sender === 'Provider' ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-gray-100 text-gray-900 rounded-bl-sm'}`}>
              {msg.text}
            </div>
          </div>
        ))}
      </div>
      <div className="p-5 border-t border-gray-200 bg-slate-50">
        <form onSubmit={handleSend} className="relative">
          <input
            type="text"
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            placeholder="Send a message..."
            className="w-full bg-white border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-full py-3 pl-5 pr-14 text-sm outline-none shadow-sm"
          />
          <button type="submit" className="absolute right-1.5 top-1.5 p-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 shadow-sm">
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
};

/* ---------- Main export ---------- */
export default function NGVideoCall() {
  const router = useRouter();
  const { user } = useAuth();
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [activePanel, setActivePanel] = useState('vitals');
  const [callEnded, setCallEnded] = useState(false);
  const [hr, setHr] = useState(72);
  const [timeString, setTimeString] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState([
    { sender: 'Patient', text: 'Hello, I have been experiencing some symptoms recently.', time: '10:41 AM' },
  ]);

  const displayName = user ? `Dr. ${user.last_name || user.lastName || user.name || 'Provider'}` : 'Dr. Provider';
  const initials = user
    ? `${(user.first_name || user.firstName || 'D')[0]}${(user.last_name || user.lastName || 'R')[0]}`.toUpperCase()
    : 'DR';

  useEffect(() => {
    const update = () => setTimeString(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    update();
    const t = setInterval(update, 10000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setHr(prev => {
        const v = Math.floor(Math.random() * 5) - 2;
        return Math.min(78, Math.max(68, prev + v));
      });
    }, 2000);
    return () => clearInterval(t);
  }, []);

  const togglePanel = (panel) => setActivePanel(prev => prev === panel ? null : panel);

  if (callEnded) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#202124] text-white">
        <h1 className="text-4xl font-light mb-8 text-gray-200">Consultation Ended</h1>
        <div className="flex space-x-4">
          <button onClick={() => setCallEnded(false)} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-lg">
            Rejoin Call
          </button>
          <button onClick={() => router.push('/ng/provider/dashboard')} className="px-6 py-2.5 bg-[#3c4043] hover:bg-[#4d5154] text-white font-medium rounded-lg">
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    /* fixed overlay — full-screen video call on top of any parent layout */
    <div className="fixed inset-0 z-50 flex h-screen w-screen bg-[#202124] overflow-hidden text-white">
      <div className="flex flex-col flex-1 transition-all duration-300 min-w-0">

        {/* Header badge */}
        <div className="absolute top-6 left-6 z-10 flex space-x-4">
          <div className="bg-black/50 backdrop-blur-md border border-white/10 px-4 py-2 rounded-xl flex items-center shadow-lg">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse mr-3" />
            <span className="text-sm font-semibold tracking-wide">SECURE · DOCTARX NG</span>
          </div>
        </div>

        {/* Video grid */}
        <div className="flex-1 p-4 md:p-6 flex items-center justify-center min-h-0 overflow-hidden">
          <div className="w-full h-full max-w-7xl grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 auto-rows-fr">
            <RemoteVideo hr={hr} patientName="Patient" />
            <LocalVideo isVideoOff={isVideoOff} isMuted={isMuted} displayName={displayName} initials={initials} />
          </div>
        </div>

        {/* Control bar */}
        <div className="h-24 w-full flex items-center justify-between px-6 md:px-8 bg-[#202124]">
          <div className="hidden md:flex items-center text-sm font-medium text-gray-300">
            {timeString} <span className="mx-3 text-gray-600">|</span> DoctaRx Nigeria
          </div>

          <div className="flex items-center space-x-3 md:space-x-4 mx-auto md:mx-0">
            <ControlButton active={isMuted} onClick={() => setIsMuted(!isMuted)} icon={Mic} activeIcon={MicOff} />
            <ControlButton active={isVideoOff} onClick={() => setIsVideoOff(!isVideoOff)} icon={Video} activeIcon={VideoOff} />
            <ControlButton active={false} icon={MonitorUp} activeIcon={MonitorUp} />
            <ControlButton active={false} icon={MoreVertical} activeIcon={MoreVertical} />
            <button
              onClick={() => setCallEnded(true)}
              className="w-16 md:w-20 h-12 ml-2 bg-[#ea4335] hover:bg-[#d93025] flex items-center justify-center rounded-full shadow-lg"
            >
              <PhoneOff size={22} className="text-white" />
            </button>
          </div>

          <div className="hidden md:flex items-center space-x-2">
            <SidebarToggleButton panelName="vitals" currentPanel={activePanel} onClick={togglePanel} icon={Activity} />
            <SidebarToggleButton panelName="notes" currentPanel={activePanel} onClick={togglePanel} icon={Sparkles} />
            <SidebarToggleButton panelName="chat" currentPanel={activePanel} onClick={togglePanel} icon={MessageSquare} />
          </div>
        </div>
      </div>

      {/* Right sidebar */}
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
            {activePanel === 'vitals' && <VitalsPanel hr={hr} />}
            {activePanel === 'notes' && <NotesPanel messages={messages} hr={hr} />}
            {activePanel === 'chat' && (
              <ChatPanel messages={messages} setMessages={setMessages} chatInput={chatInput} setChatInput={setChatInput} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
