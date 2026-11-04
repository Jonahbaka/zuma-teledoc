'use client';

import { useEffect, useRef, useState } from 'react';
import { Send, MessageSquare, Lock } from 'lucide-react';
import { conf } from './conferenceApi';

export default function ChatPanel({ roomId, room, participants }) {
  const [msgs, setMsgs]     = useState([]);
  const [text, setText]     = useState('');
  const [dmTo, setDmTo]     = useState('');
  const [err, setErr]       = useState('');
  const [busy, setBusy]     = useState(false);
  const scrollRef = useRef(null);

  async function load() {
    try {
      const out = await conf.listChat(roomId, { limit: 200 });
      setMsgs(out?.messages || []);
    } catch (e) { setErr(e.message); }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, [roomId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs]);

  async function send(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setErr('');
    try {
      await conf.sendChat(roomId, {
        message: text.trim(),
        private_to_user_id: dmTo || null,
      });
      setText('');
      await load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const dmPeers = (participants || []).filter(p => p.status === 'admitted' && p.user_id);

  return (
    <div className="flex h-[420px] flex-col rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-800">
        <MessageSquare className="h-4 w-4 text-slate-500" />
        Conference chat
        {!room?.allow_chat && (
          <span className="ml-auto rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">disabled</span>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3">
        {msgs.length === 0 ? (
          <p className="text-center text-xs text-slate-400">No messages yet.</p>
        ) : msgs.map(m => (
          <div key={m.id} className="text-sm">
            <div className="flex items-baseline gap-2">
              <span className="font-semibold text-slate-800">{m.sender_display || 'Anon'}</span>
              {m.private_to_user_id && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800">
                  <Lock className="h-2.5 w-2.5" /> DM
                </span>
              )}
              <span className="text-[10px] text-slate-400">{new Date(m.created_at).toLocaleTimeString()}</span>
            </div>
            <p className="text-slate-700">{m.message}</p>
          </div>
        ))}
      </div>

      <form onSubmit={send} className="space-y-1 border-t border-slate-100 p-2">
        {room?.allow_private_dm && dmPeers.length > 0 && (
          <select
            value={dmTo}
            onChange={e => setDmTo(e.target.value)}
            className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
          >
            <option value="">Send to room (public)</option>
            {dmPeers.map(p => (
              <option key={p.id} value={p.user_id}>Private DM → {p.display_name} ({p.role})</option>
            ))}
          </select>
        )}
        <div className="flex gap-1">
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={room?.allow_chat ? 'Type a message…' : 'Chat disabled'}
            disabled={!room?.allow_chat || busy}
            className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-100"
          />
          <button
            type="submit"
            disabled={!room?.allow_chat || busy || !text.trim()}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-white disabled:opacity-40"
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        {err && <p className="text-xs text-rose-700">{err}</p>}
      </form>
    </div>
  );
}
