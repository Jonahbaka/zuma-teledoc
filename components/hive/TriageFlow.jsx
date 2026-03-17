'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity, Send, Loader2, AlertTriangle, CheckCircle2,
  Heart, Thermometer, Clock, Calendar, ArrowRight, Shield,
  Bot, ChevronRight
} from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { cn } from '@/lib/utils';

const URGENCY_CONFIG = {
  1: { label: 'Routine', color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/30', icon: CheckCircle2 },
  2: { label: 'Low',     color: 'text-blue-400',  bg: 'bg-blue-500/10',  border: 'border-blue-500/30',  icon: Clock },
  3: { label: 'Moderate', color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', icon: Activity },
  4: { label: 'Urgent',  color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30', icon: AlertTriangle },
  5: { label: 'Emergent', color: 'text-red-400',   bg: 'bg-red-500/10',   border: 'border-red-500/30',   icon: Heart },
};

const SYMPTOM_STARTERS = [
  { label: 'I feel sick', msg: 'I feel sick and need help.' },
  { label: 'I have pain', msg: 'I am experiencing pain.' },
  { label: 'Fever / chills', msg: 'I have a fever and chills.' },
  { label: 'Mental health', msg: 'I need to talk about my mental health.' },
  { label: 'Medication question', msg: 'I have a question about my medication.' },
  { label: 'Follow-up visit', msg: 'I need a follow-up visit with my doctor.' },
];

function getApiBase() {
  if (typeof window === 'undefined') return '';
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:8080';
  return window.location.origin;
}

export default function TriageFlow() {
  const { user } = useAuth();
  const router = useRouter();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [urgency, setUrgency] = useState(null);
  const [triageComplete, setTriageComplete] = useState(false);
  const [booking, setBooking] = useState(false);
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
    const data = await apiCall('/api/hive/session', { agentId: 'triage' });
    if (data.success) {
      setSessionId(data.data.sessionId);
      return data.data.sessionId;
    }
    return null;
  }, [apiCall]);

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || sending) return;
    setMessages(prev => [...prev, { role: 'user', content: text.trim(), ts: Date.now() }]);
    setInput('');
    setSending(true);

    try {
      let sid = sessionId;
      if (!sid) sid = await startSession();

      const data = await apiCall('/api/hive/message', { sessionId: sid, content: text.trim() });
      if (data.success) {
        setMessages(prev => [...prev, { role: 'agent', content: data.data.content, ts: Date.now() }]);

        const uMatch = data.data.content.match(/urgency[:\s]*(\d)/i);
        if (uMatch) {
          const u = parseInt(uMatch[1]);
          setUrgency(u);
          if (u >= 1 && u <= 5) setTriageComplete(true);
        }
      }
    } catch {
      setMessages(prev => [...prev, { role: 'agent', content: 'Connection issue. Please try again.', ts: Date.now() }]);
    }
    setSending(false);
  }, [sessionId, sending, apiCall, startSession]);

  const bookAppointment = useCallback(async () => {
    if (booking) return;
    setBooking(true);
    try {
      const symptoms = messages.filter(m => m.role === 'user').map(m => m.content).join('; ');
      const data = await apiCall('/api/hive/triage/book', {
        sessionId,
        urgency: urgency || 2,
        symptoms,
      });
      if (data.success) {
        setMessages(prev => [...prev, {
          role: 'system',
          content: `Your ${data.data.appointmentType} appointment has been booked. Redirecting you to your appointments...`,
          ts: Date.now(),
        }]);
        setTimeout(() => router.push('/patient/appointments'), 2000);
      }
    } catch {}
    setBooking(false);
  }, [booking, sessionId, urgency, messages, apiCall, router]);

  const handleSubmit = (e) => { e.preventDefault(); sendMessage(input); };
  const urgencyConfig = urgency ? URGENCY_CONFIG[urgency] : null;

  return (
    <div className="bg-gray-950 border border-gray-800 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 bg-gradient-to-r from-purple-900/40 to-blue-900/30 border-b border-gray-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">AI Health Triage</h3>
              <p className="text-xs text-gray-400">Tell me how you're feeling and I'll help you get the right care.</p>
            </div>
          </div>
          {urgencyConfig && (
            <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium', urgencyConfig.bg, urgencyConfig.border, urgencyConfig.color)}>
              <urgencyConfig.icon className="w-3.5 h-3.5" />
              Urgency: {urgencyConfig.label}
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="h-[350px] overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-4">
            <div className="bg-gray-900/70 border border-gray-800 rounded-xl p-4">
              <p className="text-sm text-gray-300">
                Welcome, {user?.firstName || 'there'}. I'm the DoctaRx triage assistant. 
                Describe your symptoms and I'll assess their urgency and help you book the right appointment.
              </p>
              <p className="text-xs text-red-400/80 mt-2 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> If this is an emergency, please call 911 immediately.
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {SYMPTOM_STARTERS.map((s) => (
                <button
                  key={s.label}
                  onClick={() => sendMessage(s.msg)}
                  className="text-left text-xs px-3 py-2.5 rounded-lg bg-gray-900 border border-gray-800 text-gray-300 hover:bg-gray-800 hover:border-purple-700/50 transition-all flex items-center justify-between gap-1"
                >
                  <span>{s.label}</span>
                  <ChevronRight className="w-3 h-3 text-purple-400 flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={cn(
              'max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed',
              m.role === 'user' ? 'bg-purple-600 text-white rounded-br-sm' :
              m.role === 'system' ? 'bg-green-900/40 border border-green-800 text-green-200 rounded-bl-sm' :
              'bg-gray-900 border border-gray-800 text-gray-200 rounded-bl-sm'
            )}>
              {m.content}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-2.5 flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
              <span className="text-xs text-gray-400">Assessing...</span>
            </div>
          </div>
        )}

        {triageComplete && !booking && (
          <div className={cn('p-4 rounded-xl border', urgencyConfig?.bg, urgencyConfig?.border)}>
            <p className="text-sm text-white font-medium mb-3">Triage assessment complete.</p>
            <div className="flex gap-2">
              <button
                onClick={bookAppointment}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 transition-colors"
              >
                <Calendar className="w-4 h-4" /> Book appointment
              </button>
              <button
                onClick={() => { setTriageComplete(false); setUrgency(null); }}
                className="px-4 py-2 rounded-lg bg-gray-800 text-gray-300 text-sm hover:bg-gray-700 transition-colors"
              >
                Continue chat
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="px-4 py-3 border-t border-gray-800 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe your symptoms..."
          className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-600 transition-colors"
          disabled={sending}
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          className="px-3 py-2 rounded-lg bg-purple-600 text-white disabled:opacity-40 hover:bg-purple-500 transition-colors"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>

      <div className="px-4 pb-2 flex items-center gap-2">
        <Shield className="w-3 h-3 text-green-500" />
        <p className="text-[10px] text-gray-600">HIPAA compliant. Encrypted and private. AI runs in NemoClaw OpenShell sandbox — your data never leaves the secure environment.</p>
      </div>
    </div>
  );
}
