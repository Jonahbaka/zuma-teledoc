'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, MessageSquare, Plus, Send } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatRelativeTime } from '@/lib/utils';

export default function NigeriaPatientMessagesPage() {
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [providers, setProviders] = useState([]);
  const [providerId, setProviderId] = useState('');
  const [showComposer, setShowComposer] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  const [conversationError, setConversationError] = useState('');
  const [conversationLoading, setConversationLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const selectedRecipient = useRef(null);
  const sendAttempt = useRef(null);
  selectedRecipient.current = selectedConversation?.recipientId || null;

  useEffect(() => {
    let cancelled = false;
    const loadPortalMessaging = async () => {
      setLoading(true); setLoadError('');
      try {
        const [conversationsResponse, appointmentsResponse] = await Promise.all([
          api.get('/messages/conversations'),
          api.get('/appointments'),
        ]);
        if (!conversationsResponse.data?.success || !appointmentsResponse.data?.success) throw new Error();
        if (cancelled) return;

        const nextConversations = conversationsResponse.data?.success ? conversationsResponse.data.conversations || [] : [];
        setConversations(nextConversations);

        if (nextConversations[0]) {
          const firstConversation = nextConversations[0];
          const recipientId = firstConversation.recipientId || firstConversation.otherUser?.id;
          const recipientName =
            firstConversation.recipientName ||
            (firstConversation.otherUser ? `${firstConversation.otherUser.firstName} ${firstConversation.otherUser.lastName}` : 'Care team');

          setSelectedConversation({
            recipientId,
            recipientName,
          });
        }

        const appointmentProviders = new Map();
        if (appointmentsResponse.data?.success) {
          (appointmentsResponse.data.appointments || []).forEach((appointment) => {
            if (appointment.providerId) {
              appointmentProviders.set(appointment.providerId, {
                id: appointment.providerId,
                name: `Dr. ${appointment.providerFirstName || ''} ${appointment.providerLastName || ''}`.trim(),
                specialty: appointment.providerSpecialty || 'Provider',
              });
            }
          });
        }
        setProviders(Array.from(appointmentProviders.values()));
      } catch {
        if (!cancelled) setLoadError('Messages could not be loaded. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadPortalMessaging();
    return () => { cancelled = true; };
  }, [revision]);

  useEffect(() => {
    let cancelled = false;
    setMessages([]); setDraft(''); setConversationError('');
    const loadConversation = async () => {
      if (!selectedConversation?.recipientId) {
        setMessages([]);
        return;
      }

      setConversationLoading(true);
      try {
        const response = await api.get(`/messages/conversation/${selectedConversation.recipientId}`);
        if (!response.data?.success) throw new Error();
        if (!cancelled) setMessages(response.data.messages || []);
      } catch { if (!cancelled) setConversationError('This conversation could not be loaded.'); }
      finally { if (!cancelled) setConversationLoading(false); }
    };

    loadConversation();
    return () => { cancelled = true; };
  }, [selectedConversation]);

  const refreshConversations = async () => {
    try {
      const response = await api.get('/messages/conversations');
      if (!response.data?.success) throw new Error();
      setConversations(response.data.conversations || []);
    } catch { setLoadError('Your inbox could not be refreshed. A successfully sent message remains saved.'); }
  };

  const sendMessage = async ({ recipientId, content, resetComposer = false }) => {
    if (!recipientId || !content.trim()) return;

    setSending(true);
    const openedRecipient = selectedRecipient.current;
    setNotice('');
    try {
      if (sendAttempt.current?.recipientId !== recipientId || sendAttempt.current?.content !== content.trim()) sendAttempt.current = { recipientId, content: content.trim(), id: crypto.randomUUID() };
      const response = await api.post('/messages', {
        recipientId,
        content: content.trim(),
        isUrgent: false,
        clientMessageId: sendAttempt.current.id,
      });

      if (response.data?.success) {
        await refreshConversations();
        if (selectedRecipient.current !== openedRecipient) return;
        sendAttempt.current = null;
        if (selectedRecipient.current === recipientId && response.data.message?.id) setMessages((current) => current.some((item) => item.id === response.data.message.id) ? current : [...current, { ...response.data.message, sentByMe: true }]);
        if (resetComposer) {
          setShowComposer(false);
          setProviderId('');
        }
        setDraft('');
        setNotice('Message sent.');
        setSelectedConversation((current) =>
          current?.recipientId === recipientId
            ? current
            : {
                recipientId,
                recipientName: providers.find((item) => item.id === recipientId)?.name || current?.recipientName || 'Care team',
              }
        );
      }
    } catch (error) {
      setNotice(error.response?.data?.error || 'Unable to send message.');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-medium text-blue-800">DoctaRx · Your care team</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Messages and support</h1>
          <p className="mt-2 text-sm text-muted-foreground">Stay connected with providers and care operations without leaving the patient portal.</p>
        </div>
        <Button onClick={() => setShowComposer((current) => !current)} className="bg-blue-600 text-white hover:bg-blue-500">
          <Plus className="mr-2 h-4 w-4" />
          New Message
        </Button>
      </section>

      {loadError && <div className="portal-error"><p role="alert">{loadError}</p><Button variant="outline" className="mt-3" onClick={() => setRevision((value) => value + 1)}>Try again</Button></div>}

      {notice ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{notice}</div>
      ) : null}

      {showComposer ? (
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle>Start a new conversation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <select
              aria-label="Care-team provider"
              value={providerId}
              onChange={(event) => setProviderId(event.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">Choose a provider from your appointments</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name} • {provider.specialty}
                </option>
              ))}
            </select>
            <textarea
              aria-label="New message"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={4}
              className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm"
              placeholder="Describe your follow-up question, prescription issue, or support need."
            />
            <div className="flex justify-end">
              <Button onClick={() => sendMessage({ recipientId: providerId, content: draft, resetComposer: true })} disabled={sending || !providerId || !draft.trim()} className="bg-blue-600 text-white hover:bg-blue-500">
                {sending ? 'Sending...' : 'Send Message'}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle>Conversations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loadError ? null : conversations.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center">
                <MessageSquare className="mx-auto h-10 w-10 text-blue-500/60" />
                <p className="mt-4 font-semibold text-foreground">No conversations yet.</p>
                <p className="mt-2 text-sm text-muted-foreground">Start a message from the button above once you have an appointment provider.</p>
              </div>
            ) : (
              conversations.map((conversation) => {
                const recipientId = conversation.recipientId || conversation.otherUser?.id;
                const recipientName =
                  conversation.recipientName ||
                  (conversation.otherUser ? `${conversation.otherUser.firstName} ${conversation.otherUser.lastName}` : 'Care team');
                const isActive = selectedConversation?.recipientId === recipientId;

                return (
                  <button
                    key={conversation.conversationId || recipientId}
                    type="button"
                    onClick={() => setSelectedConversation({ recipientId, recipientName })}
                    className={`w-full rounded-2xl border px-4 py-4 text-left transition-colors ${
                      isActive ? 'border-blue-300 bg-blue-50' : 'border-border hover:border-blue-200 hover:bg-blue-50/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground">{recipientName}</p>
                        <p className="mt-1 truncate text-sm text-muted-foreground">
                          {typeof conversation.lastMessage === 'string' ? conversation.lastMessage : conversation.lastMessage?.preview || 'Open conversation'}
                        </p>
                      </div>
                      {conversation.unreadCount ? (
                        <span className="rounded-full bg-blue-600 px-2 py-1 text-xs font-semibold text-white">{conversation.unreadCount}</span>
                      ) : null}
                    </div>
                  </button>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle>{selectedConversation?.recipientName || 'Care conversation'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedConversation ? (
              <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                Select a conversation to view messages.
              </div>
            ) : (
              <>
                <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
                  {conversationLoading ? <p role="status">Loading conversation…</p> : conversationError ? <p role="alert" className="portal-error">{conversationError}</p> : messages.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                      No messages in this conversation yet.
                    </div>
                  ) : (
                    messages.map((message) => (
                      <div key={message.id} className={`flex ${message.sentByMe ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${message.sentByMe ? 'bg-blue-600 text-white' : 'bg-muted text-foreground'}`}>
                          <p className="whitespace-pre-wrap">{message.content}</p>
                          <p className={`mt-2 text-xs ${message.sentByMe ? 'text-blue-100' : 'text-muted-foreground'}`}>
                            {formatRelativeTime(message.createdAt)}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="space-y-3 border-t border-border pt-4">
                  <textarea
                    aria-label="Message to care team"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    rows={4}
                    className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm"
                    placeholder="Type your message to the care team."
                  />
                  <div className="flex justify-end">
                    <Button onClick={() => sendMessage({ recipientId: selectedConversation.recipientId, content: draft })} disabled={sending || !draft.trim()} className="bg-blue-600 text-white hover:bg-blue-500">
                      <Send className="mr-2 h-4 w-4" />
                      {sending ? 'Sending...' : 'Send'}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
