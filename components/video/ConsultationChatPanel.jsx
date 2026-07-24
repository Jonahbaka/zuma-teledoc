'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { messagesAPI } from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import useSocket from '@/lib/useSocket';

const getDisplayName = (user) =>
  `${user?.firstName || user?.first_name || ''} ${user?.lastName || user?.last_name || ''}`.trim()
  || user?.email
  || 'You';

const formatMessageTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const normalizeMessage = (message, userId, fallbackContent = '') => ({
  ...message,
  content: message?.content ?? fallbackContent,
  sentByMe: message?.sentByMe ?? message?.senderId === userId,
});

const appendMessage = (messages, nextMessage) => {
  if (!nextMessage?.id) return messages;
  const existingIndex = messages.findIndex((message) => message.id === nextMessage.id);
  if (existingIndex >= 0) {
    const copy = [...messages];
    copy[existingIndex] = { ...copy[existingIndex], ...nextMessage };
    return copy;
  }
  return [...messages, nextMessage];
};

export default function ConsultationChatPanel({ appointment }) {
  const { user } = useAuth();
  const {
    isConnected,
    joinConversation,
    leaveConversation,
    sendTypingStart,
    sendTypingStop,
    sendReadReceipt,
    onNewMessage,
    onMessageRead,
    getTypingUser,
  } = useSocket();
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);

  const recipient = useMemo(() => {
    if (!appointment || appointment.isStandaloneTest) return null;
    if (user?.role === 'patient' && appointment.providerId) {
      return {
        id: appointment.providerId,
        label: `Dr. ${appointment.providerFirstName || ''} ${appointment.providerLastName || ''}`.trim(),
      };
    }
    if (user?.role === 'provider' && appointment.patientId) {
      return {
        id: appointment.patientId,
        label: `${appointment.patientFirstName || ''} ${appointment.patientLastName || ''}`.trim() || 'Patient',
      };
    }
    return null;
  }, [appointment, user?.role]);

  useEffect(() => {
    if (!recipient?.id || !user?.id) {
      setConversationId(null);
      setMessages([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError('');

    messagesAPI.getConversation(recipient.id, { limit: 50 })
      .then((response) => {
        if (cancelled) return;
        const loadedMessages = response.data?.messages || [];
        setConversationId(response.data?.conversationId || loadedMessages[0]?.conversationId || null);
        setMessages(loadedMessages.map((message) => normalizeMessage(message, user.id)));
      })
      .catch(() => {
        if (!cancelled) {
          setError('We could not load chat messages right now. You can still continue the video visit.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [recipient?.id, user?.id]);

  useEffect(() => {
    if (!conversationId || !isConnected) return undefined;
    joinConversation(conversationId, recipient.id);
    return () => leaveConversation(conversationId);
  }, [conversationId, isConnected, joinConversation, leaveConversation, recipient?.id]);

  useEffect(() => {
    if (!conversationId || !user?.id || !isConnected) return undefined;

    const unsubscribeMessage = onNewMessage((message) => {
      if (message?.conversationId !== conversationId) return;
      const normalized = normalizeMessage(message, user.id);
      setMessages((current) => appendMessage(current, normalized));

      if (!normalized.sentByMe && normalized.id) {
        messagesAPI.markRead(normalized.id).catch(() => {});
        sendReadReceipt(normalized.id, conversationId, normalized.senderId);
      }
    });

    const unsubscribeRead = onMessageRead((receipt) => {
      if (receipt?.conversationId !== conversationId || !receipt?.messageId) return;
      setMessages((current) => current.map((message) => (
        message.id === receipt.messageId
          ? { ...message, status: 'read', readAt: receipt.readAt || new Date().toISOString() }
          : message
      )));
    });

    return () => {
      unsubscribeMessage?.();
      unsubscribeRead?.();
    };
  }, [conversationId, isConnected, onMessageRead, onNewMessage, sendReadReceipt, user?.id]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages.length, loading]);

  const handleDraftChange = useCallback((event) => {
    const value = event.target.value;
    setDraft(value);
    if (!conversationId || !recipient?.id) return;
    if (value.trim()) {
      sendTypingStart(conversationId, recipient.id);
    } else {
      sendTypingStop(conversationId, recipient.id);
    }
  }, [conversationId, recipient?.id, sendTypingStart, sendTypingStop]);

  const sendMessage = useCallback(async () => {
    const content = draft.trim();
    if (!content || !recipient?.id || sending) return;

    setSending(true);
    setError('');
    if (conversationId) {
      sendTypingStop(conversationId, recipient.id);
    }

    try {
      const response = await messagesAPI.send({
        recipientId: recipient.id,
        content,
        isUrgent: false,
      });

      const saved = response.data?.data || {};
      const nextConversationId = saved.conversationId || conversationId;
      if (nextConversationId && !conversationId) {
        setConversationId(nextConversationId);
      }

      setMessages((current) => appendMessage(current, normalizeMessage({
        ...saved,
        conversationId: nextConversationId,
        senderId: user?.id,
        senderName: getDisplayName(user),
        content,
        sentByMe: true,
        status: saved.status || 'sent',
        createdAt: saved.createdAt || new Date().toISOString(),
      }, user?.id, content)));
      setDraft('');
    } catch {
      setError('Message was not sent. Please try again.');
    } finally {
      setSending(false);
    }
  }, [conversationId, draft, recipient?.id, sendTypingStop, sending, user]);

  const typingUser = conversationId ? getTypingUser(conversationId) : null;

  if (!recipient?.id) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center px-5 text-center text-sm text-slate-300">
        <p className="font-medium text-white">Chat is available for booked consultations.</p>
        <p className="mt-2 leading-6 text-slate-400">
          Start a patient-provider appointment to exchange secure messages during the video visit.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="consultation-chat-panel">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading chat
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm leading-6 text-slate-300">
            No messages yet. Send a note to {recipient.label || 'the other participant'} during this visit.
          </div>
        )}

        {messages.map((message) => {
          const sentByMe = message.sentByMe || message.senderId === user?.id;
          return (
            <div key={message.id} className={`flex ${sentByMe ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[88%] rounded-2xl px-3 py-2.5 text-sm leading-6 shadow-sm ${
                  sentByMe
                    ? 'rounded-br-sm bg-cyan-500 text-slate-950'
                    : 'rounded-bl-sm border border-white/10 bg-white/[0.06] text-slate-100'
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
                <div className={`mt-1 flex items-center gap-2 text-[10px] ${sentByMe ? 'text-slate-800/70' : 'text-slate-400'}`}>
                  <span>{sentByMe ? 'You' : message.senderName || recipient.label}</span>
                  {formatMessageTime(message.createdAt) && <span>{formatMessageTime(message.createdAt)}</span>}
                  {sentByMe && <span>{message.readAt || message.status === 'read' ? 'Read' : 'Sent'}</span>}
                </div>
              </div>
            </div>
          );
        })}

        {typingUser?.userId && typingUser.userId !== user?.id && (
          <p className="px-1 text-xs text-slate-400">{typingUser.userName || recipient.label} is typing...</p>
        )}
      </div>

      {error && (
        <div className="border-t border-rose-400/20 bg-rose-500/10 px-4 py-2 text-xs leading-5 text-rose-100">
          {error}
        </div>
      )}

      <div className="border-t border-white/10 px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-4">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={handleDraftChange}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
              }
            }}
            rows={1}
            maxLength={10000}
            placeholder="Type a secure message..."
            aria-label="Type a secure consultation message"
            data-testid="consultation-chat-input"
            className="max-h-32 min-h-[3rem] flex-1 resize-none rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-cyan-400/60 focus:bg-white/10"
          />
          <button
            type="button"
            onClick={sendMessage}
            disabled={sending || !draft.trim()}
            aria-label="Send message"
            data-testid="consultation-chat-send"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-cyan-400 text-slate-950 transition-colors hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
