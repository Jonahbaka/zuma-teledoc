'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Brain, Send, Loader2, FileText, Pill, Activity,
  Stethoscope, AlertCircle, ClipboardList, ChevronDown,
  ChevronUp, Bot, Shield, Mic, MicOff, Sparkles
} from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { cn } from '@/lib/utils';

const QUICK_COMMANDS = [
  { label: 'Draft SOAP Note',      cmd: '@hive draft SOAP note from this consultation' },
  { label: 'Last Labs',            cmd: '@hive show last labs' },
  { label: 'Medication History',   cmd: '@hive show medication history' },
  { label: 'Drug Interactions',    cmd: '@hive check drug interactions' },
  { label: 'Differential Dx',      cmd: '@hive suggest differential diagnosis' },
  { label: 'Follow-up Plan',       cmd: '@hive draft follow-up plan' },
];

function getApiBase() {
  if (typeof window === 'undefined') return '';
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:8080';
  return window.location.origin;
}

export default function ClinicalCoPilot({ appointmentId, patientId, patientName, collapsed: initialCollapsed }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [collapsed, setCollapsed] = useState(!!initialCollapsed);
  const [listening, setListening] = useState(false);
  const [soapDraft, setSoapDraft] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const apiCall = useCallback(async (path, body) => {
    const token = localStorage.getItem('accessToken');
    const res = await fetch(`${getApiBase()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    return res.json();
  }, []);

  const startSession = useCallback(async () => {
    const data = await apiCall('/api/hive/session', { agentId: 'hippocrates' });
    if (data.success) { setSessionId(data.data.sessionId); return data.data.sessionId; }
    return null;
  }, [apiCall]);

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || sending) return;
    const fullText = patientId ? `[Patient: ${patientName || patientId}, Appointment: ${appointmentId || 'active'}] ${text.trim()}` : text.trim();
    setMessages(prev => [...prev, { role: 'user', content: text.trim(), ts: Date.now() }]);
    setInput('');
    setSending(true);

    try {
      let sid = sessionId;
      if (!sid) sid = await startSession();

      const data = await apiCall('/api/hive/message', { sessionId: sid, content: fullText });
      if (data.success) {
        const agentContent = data.data.content;
        setMessages(prev => [...prev, { role: 'agent', content: agentContent, toolCalls: data.data.toolCalls, ts: Date.now() }]);

        if (agentContent.toLowerCase().includes('soap') && (agentContent.includes('Subjective') || agentContent.includes('subjective'))) {
          setSoapDraft(agentContent);
        }
      }
    } catch {
      setMessages(prev => [...prev, { role: 'agent', content: 'Connection issue. Please try again.', ts: Date.now() }]);
    }
    setSending(false);
  }, [sessionId, sending, apiCall, startSession, patientId, patientName, appointmentId]);

  const handleSubmit = (e) => { e.preventDefault(); sendMessage(input); };

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-900/60 to-teal-900/40 border border-emerald-800/50 rounded-xl text-white text-sm hover:bg-emerald-900/80 transition-all"
      >
        <Brain className="w-4 h-4 text-emerald-400" />
        <span className="font-medium">Clinical Co-Pilot</span>
        <ChevronDown className="w-4 h-4 text-gray-400" />
      </button>
    );
  }

  return (
    <div className="bg-gray-950 border border-gray-800 rounded-2xl overflow-hidden flex flex-col h-full max-h-[600px]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-emerald-900/40 to-teal-900/30 border-b border-gray-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-400 flex items-center justify-center">
            <Stethoscope className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Hippocrates</p>
            <p className="text-[10px] text-gray-400">Clinical Co-Pilot</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setListening(!listening)}
            className={cn('p-1.5 rounded-lg transition-colors', listening ? 'bg-red-500/20 text-red-400' : 'bg-gray-800 text-gray-400 hover:text-white')}
            title={listening ? 'Stop listening' : 'Start live scribing'}
          >
            {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
          <button onClick={() => setCollapsed(true)} className="text-gray-400 hover:text-white transition-colors">
            <ChevronUp className="w-4 h-4" />
          </button>
        </div>
      </div>

      {listening && (
        <div className="px-4 py-2 bg-red-900/20 border-b border-red-800/30 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-xs text-red-300">Live scribing active — listening to consultation</span>
        </div>
      )}

      {/* Quick commands */}
      <div className="px-3 py-2 border-b border-gray-800/50 flex gap-1.5 overflow-x-auto scrollbar-none">
        {QUICK_COMMANDS.map((qc) => (
          <button
            key={qc.label}
            onClick={() => sendMessage(qc.cmd)}
            className="flex-shrink-0 text-[11px] px-2.5 py-1.5 rounded-md bg-gray-900 border border-gray-800 text-gray-400 hover:text-white hover:border-emerald-700/50 transition-all"
          >
            {qc.label}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {messages.length === 0 && (
          <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-3.5 text-xs text-gray-400">
            <p className="text-gray-300 font-medium mb-1">Ready to assist, Dr. {user?.lastName || 'Provider'}.</p>
            <p>Use the quick commands above or type a question. I can draft SOAP notes, fetch patient records, check interactions, and suggest differentials.</p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={cn(
              'max-w-[90%] rounded-xl px-3 py-2 text-xs leading-relaxed',
              m.role === 'user' ? 'bg-emerald-700/80 text-white rounded-br-sm' :
              'bg-gray-900 border border-gray-800 text-gray-200 rounded-bl-sm'
            )}>
              {m.toolCalls?.length > 0 && (
                <div className="mb-2 pb-2 border-b border-gray-700 flex flex-wrap gap-1">
                  {m.toolCalls.map((tc, j) => (
                    <span key={j} className="px-2 py-0.5 rounded-full bg-teal-900/40 text-teal-300 text-[10px] border border-teal-800/50">
                      {tc.tool || tc.name}
                    </span>
                  ))}
                </div>
              )}
              <div className="whitespace-pre-wrap">{m.content}</div>
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex gap-2 items-center">
            <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
            <span className="text-xs text-gray-400">Analyzing...</span>
          </div>
        )}
      </div>

      {/* SOAP Draft Panel */}
      {soapDraft && (
        <div className="px-3 py-2 border-t border-emerald-800/30 bg-emerald-950/30">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-emerald-300 font-medium flex items-center gap-1">
              <ClipboardList className="w-3 h-3" /> SOAP Draft Ready
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => {
                  if (typeof navigator !== 'undefined') navigator.clipboard.writeText(soapDraft);
                }}
                className="text-[10px] px-2 py-1 rounded bg-emerald-800/50 text-emerald-200 hover:bg-emerald-700/50"
              >
                Copy
              </button>
              <button onClick={() => setSoapDraft(null)} className="text-[10px] px-2 py-1 rounded bg-gray-800 text-gray-400 hover:bg-gray-700">
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="px-3 py-2 border-t border-gray-800 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Hippocrates..."
          className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-emerald-600 transition-colors"
          disabled={sending}
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          className="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-40 hover:bg-emerald-500 transition-colors"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>

      <div className="px-3 pb-1.5 flex items-center gap-1.5">
        <Shield className="w-2.5 h-2.5 text-green-500" />
        <p className="text-[9px] text-gray-600">Provider-only. HIPAA sandbox. NemoClaw OpenShell isolated. Not a substitute for clinical judgment.</p>
      </div>
    </div>
  );
}
