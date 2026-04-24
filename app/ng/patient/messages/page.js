'use client';

import { useEffect, useState } from 'react';
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

  useEffect(() => {
    const loadPortalMessaging = async () => {
      try {
        const [conversationsResponse, appointmentsResponse] = await Promise.all([
          api.get('/messages/conversations').catch(() => ({ data: { success: false, conversations: [] } })),
          api.get('/appointments').catch(() => ({ data: { success: false, appointments: [] } })),
        ]);

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
      } finally {
        setLoading(false);
      }
    };

    loadPortalMessaging();
  }, []);

  useEffect(() => {
    const loadConversation = async () => {
      if (!selectedConversation?.recipientId) {
        setMessages([]);
        return;
      }

      const response = await api.get(`/messages/conversation/${selectedConversation.recipientId}`).catch(() => ({ data: { success: false, messages: [] } }));
      setMessages(response.data?.success ? response.data.messages || [] : []);
    };

    loadConversation();
  }, [selectedConversation]);

  const refreshConversations = async () => {
    const response = await api.get('/messages/conversations').catch(() => ({ data: { success: false, conversations: [] } }));
    setConversations(response.data?.success ? response.data.conversations || [] : []);
  };

  const sendMessage = async ({ recipientId, content, resetComposer = false }) => {
    if (!recipientId || !content.trim()) return;

    setSending(true);
    setNotice('');
    try {
      const response = await api.post('/messages', {
        recipientId,
        content: content.trim(),
        isUrgent: false,
      });

      if (response.data?.success) {
        if (resetComposer) {
          setShowComposer(false);
          setProviderId('');
        }
        setDraft('');
        setNotice('Message sent.');
        await refreshConversations();
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
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Care Messaging</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Messages and support</h1>
          <p className="mt-2 text-sm text-muted-foreground">Stay connected with providers and care operations without leaving the patient portal.</p>
        </div>
        <Button onClick={() => setShowComposer((current) => !current)} className="bg-emerald-600 text-white hover:bg-emerald-500">
          <Plus className="mr-2 h-4 w-4" />
          New Message
        </Button>
      </section>

      {notice ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>
      ) : null}

      {showComposer ? (
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle>Start a new conversation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <select
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
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={4}
              className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm"
              placeholder="Describe your follow-up question, prescription issue, or support need."
            />
            <div className="flex justify-end">
              <Button onClick={() => sendMessage({ recipientId: providerId, content: draft, resetComposer: true })} disabled={sending || !providerId || !draft.trim()} className="bg-emerald-600 text-white hover:bg-emerald-500">
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
            {conversations.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center">
                <MessageSquare className="mx-auto h-10 w-10 text-emerald-500/60" />
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
                      isActive ? 'border-emerald-300 bg-emerald-50' : 'border-border hover:border-emerald-200 hover:bg-emerald-50/40'
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
                        <span className="rounded-full bg-emerald-600 px-2 py-1 text-xs font-semibold text-white">{conversation.unreadCount}</span>
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
                  {messages.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                      No messages in this conversation yet.
                    </div>
                  ) : (
                    messages.map((message) => (
                      <div key={message.id} className={`flex ${message.sentByMe ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${message.sentByMe ? 'bg-emerald-600 text-white' : 'bg-muted text-foreground'}`}>
                          <p className="whitespace-pre-wrap">{message.content}</p>
                          <p className={`mt-2 text-xs ${message.sentByMe ? 'text-emerald-100' : 'text-muted-foreground'}`}>
                            {formatRelativeTime(message.createdAt)}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="space-y-3 border-t border-border pt-4">
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    rows={4}
                    className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm"
                    placeholder="Type your message to the care team."
                  />
                  <div className="flex justify-end">
                    <Button onClick={() => sendMessage({ recipientId: selectedConversation.recipientId, content: draft })} disabled={sending || !draft.trim()} className="bg-emerald-600 text-white hover:bg-emerald-500">
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
