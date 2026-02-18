'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, X, Send, Loader2, Bot, ArrowRight, Heart } from 'lucide-react';
import { cn } from '@/lib/utils';

const QUICK_ACTIONS = [
  { label: 'How does DoctaRx work?', msg: 'How does DoctaRx work?' },
  { label: 'Book an appointment', msg: 'I want to book a telehealth appointment.' },
  { label: 'Pricing', msg: 'What does DoctaRx cost?' },
  { label: 'For providers', msg: 'I am a doctor and want to join.' },
];

function getApiBase() {
  if (typeof window === 'undefined') return '';
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:8080';
  return window.location.origin;
}

export default function ConciergeWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const startSession = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/hive/session/public`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json();
      if (data.success) {
        setSessionId(data.data.sessionId);
        return data.data.sessionId;
      }
    } catch {}
    return null;
  }, []);

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || sending) return;
    const userMsg = { role: 'user', content: text.trim(), ts: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      let sid = sessionId;
      if (!sid) sid = await startSession();
      if (!sid) {
        setMessages(prev => [...prev, { role: 'agent', content: 'Having trouble connecting. Please try again in a moment.', ts: Date.now() }]);
        setSending(false);
        return;
      }

      const res = await fetch(`${getApiBase()}/api/hive/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, content: text.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setMessages(prev => [...prev, { role: 'agent', content: data.data.content, ts: Date.now() }]);
      } else {
        setMessages(prev => [...prev, { role: 'agent', content: 'Sorry, I couldn\'t process that. Let me try again.', ts: Date.now() }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'agent', content: 'Connection issue. Please refresh and try again.', ts: Date.now() }]);
    }
    setSending(false);
  }, [sessionId, sending, startSession]);

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 text-white shadow-lg shadow-blue-500/25 flex items-center justify-center hover:scale-110 transition-transform"
        aria-label="Chat with Nurse Nova"
      >
        <MessageCircle className="w-6 h-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[380px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[calc(100vh-4rem)] bg-gray-950 border border-gray-800 rounded-2xl shadow-2xl shadow-black/50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-900/60 to-cyan-900/40 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Nurse Nova</p>
            <p className="text-xs text-gray-400">DoctaRx Health Concierge</p>
          </div>
        </div>
        <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-sm text-gray-300">
                Hi there! I'm Nurse Nova, your DoctaRx health concierge. I can help you learn about our platform, book appointments, or answer health-related questions.
              </p>
              <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                <Heart className="w-3 h-3 text-red-400" /> Available 24/7
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {QUICK_ACTIONS.map((qa) => (
                <button
                  key={qa.label}
                  onClick={() => sendMessage(qa.msg)}
                  className="text-left text-xs px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-gray-300 hover:bg-gray-800 hover:border-blue-700/50 transition-all"
                >
                  {qa.label}
                  <ArrowRight className="w-3 h-3 inline ml-1 text-blue-400" />
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={cn(
              'max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed',
              m.role === 'user'
                ? 'bg-blue-600 text-white rounded-br-sm'
                : 'bg-gray-900 border border-gray-800 text-gray-200 rounded-bl-sm'
            )}>
              {m.content}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-2.5 flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
              <span className="text-xs text-gray-400">Nova is thinking...</span>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="px-3 py-3 border-t border-gray-800 flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Nurse Nova..."
          className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-600 transition-colors"
          disabled={sending}
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          className="px-3 py-2 rounded-lg bg-blue-600 text-white disabled:opacity-40 hover:bg-blue-500 transition-colors"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>

      <div className="px-3 pb-2 text-center">
        <p className="text-[10px] text-gray-600">
          AI assistant. Not a substitute for medical advice. Call 911 for emergencies.
        </p>
      </div>
    </div>
  );
}
