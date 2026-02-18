'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  MessageSquare, Send, Loader2, User, Search, 
  Clock, Paperclip, Image as ImageIcon, AlertCircle, FileText, Plus, X,
  Circle, CheckCheck, Wifi, WifiOff
} from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatRelativeTime, formatDateTime } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';
import { useSocket } from '@/lib/useSocket';

export default function ProviderMessagesPage() {
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);
  const [hasDraft, setHasDraft] = useState(false);
  const [showNewMessageModal, setShowNewMessageModal] = useState(false);
  const [patients, setPatients] = useState([]);
  const [loadingPatients, setLoadingPatients] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [newMessageContent, setNewMessageContent] = useState('');
  const [sendingNewMessage, setSendingNewMessage] = useState(false);

  // Real-time socket connection
  const {
    isConnected,
    onlineUsers,
    joinConversation,
    leaveConversation,
    sendTypingStart,
    sendTypingStop,
    sendReadReceipt,
    onNewMessage,
    isUserOnline,
    getTypingUser
  } = useSocket();
  
  const [typingIndicator, setTypingIndicator] = useState(null);

  // Load draft from localStorage when conversation changes
  useEffect(() => {
    if (selectedConversation) {
      const draftKey = `message_draft_${selectedConversation.recipientId}`;
      const draft = localStorage.getItem(draftKey);
      if (draft) {
        setNewMessage(draft);
        setHasDraft(true);
      } else {
        setHasDraft(false);
      }
    } else {
      setHasDraft(false);
    }
  }, [selectedConversation]);

  // Save draft to localStorage
  useEffect(() => {
    if (selectedConversation && newMessage.trim()) {
      const draftKey = `message_draft_${selectedConversation.recipientId}`;
      localStorage.setItem(draftKey, newMessage);
      setHasDraft(true);
    } else if (selectedConversation && !newMessage.trim()) {
      const draftKey = `message_draft_${selectedConversation.recipientId}`;
      localStorage.removeItem(draftKey);
      setHasDraft(false);
    }
  }, [newMessage, selectedConversation]);

  useEffect(() => {
    fetchConversations();
  }, []);

  // Handle real-time incoming messages
  useEffect(() => {
    const cleanup = onNewMessage((message) => {
      console.log('📨 New message received:', message);
      
      // Add message to current conversation if it matches
      if (selectedConversation?.conversationId === message.conversationId ||
          selectedConversation?.recipientId === message.senderId) {
        setMessages(prev => {
          // Avoid duplicates
          if (prev.find(m => m.id === message.id)) return prev;
          return [...prev, {
            ...message,
            sentByMe: false
          }];
        });
        
        // Send read receipt
        if (message.senderId && selectedConversation?.conversationId) {
          sendReadReceipt(message.id, selectedConversation.conversationId, message.senderId);
        }
        
        scrollToBottom();
      }
      
      // Update conversation list
      fetchConversations();
      
      // Show notification toast if not in the same conversation
      if (!selectedConversation || selectedConversation.recipientId !== message.senderId) {
        toast({
          title: `New message from ${message.senderName}`,
          description: message.content?.substring(0, 50) || 'New message',
        });
      }
    });
    
    return cleanup;
  }, [onNewMessage, selectedConversation, sendReadReceipt]);

  // Join/leave conversation room when selected conversation changes
  useEffect(() => {
    if (selectedConversation?.conversationId && isConnected) {
      joinConversation(selectedConversation.conversationId);
      
      return () => {
        leaveConversation(selectedConversation.conversationId);
      };
    }
  }, [selectedConversation?.conversationId, isConnected, joinConversation, leaveConversation]);

  // Update typing indicator
  useEffect(() => {
    if (selectedConversation?.conversationId) {
      const typingUser = getTypingUser(selectedConversation.conversationId);
      setTypingIndicator(typingUser);
    } else {
      setTypingIndicator(null);
    }
  }, [selectedConversation?.conversationId, getTypingUser]);

  const fetchPatients = async () => {
    setLoadingPatients(true);
    try {
      const response = await api.get('/providers/me/patients');
      if (response.data.success) {
        setPatients(response.data.patients || []);
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load patients',
        variant: 'destructive'
      });
    } finally {
      setLoadingPatients(false);
    }
  };

  useEffect(() => {
    if (showNewMessageModal) {
      fetchPatients();
    }
  }, [showNewMessageModal]);

  useEffect(() => {
    if (selectedConversation) {
      fetchMessages(selectedConversation.recipientId);
    }
  }, [selectedConversation]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchConversations = async () => {
    try {
      const response = await api.get('/messages/conversations');
      if (response.data.success) {
        setConversations(response.data.conversations || []);
        if (response.data.conversations?.length > 0 && !selectedConversation) {
          // Transform to the structure expected by sendMessage
          const conv = response.data.conversations[0];
          const recipientId = conv.recipientId || conv.otherUser?.id;
          const recipientName = conv.recipientName || (conv.otherUser ? `${conv.otherUser.firstName} ${conv.otherUser.lastName}` : 'Patient');
          setSelectedConversation({
            recipientId,
            recipientName,
            conversationId: conv.conversationId
          });
        }
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load conversations',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (recipientId) => {
    try {
      const response = await api.get(`/messages/conversation/${recipientId}`);
      if (response.data.success) {
        setMessages(response.data.messages || []);
        // Mark as read - filter for unread messages not sent by me
        const unread = response.data.messages?.filter(m => !m.readAt && !m.sentByMe);
        for (const msg of unread || []) {
          try {
            await api.put(`/messages/${msg.id}/read`);
          } catch (readErr) {
            // Silently handle read marking errors
            console.warn('Failed to mark message as read:', msg.id);
          }
        }
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load messages',
        variant: 'destructive'
      });
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedConversation) return;

    // Stop typing indicator
    if (selectedConversation.conversationId && selectedConversation.recipientId) {
      sendTypingStop(selectedConversation.conversationId, selectedConversation.recipientId);
    }

    setSending(true);
    const messageContent = newMessage;
    
    // Optimistically add message to UI
    const tempId = `temp-${Date.now()}`;
    const optimisticMessage = {
      id: tempId,
      content: messageContent,
      sentByMe: true,
      createdAt: new Date().toISOString(),
      status: 'sending'
    };
    setMessages(prev => [...prev, optimisticMessage]);
    setNewMessage('');
    scrollToBottom();

    try {
      const response = await api.post('/messages', {
        recipientId: selectedConversation.recipientId,
        content: messageContent,
        isUrgent: false
      });

      if (response.data.success) {
        // Clear draft from localStorage
        if (selectedConversation) {
          const draftKey = `message_draft_${selectedConversation.recipientId}`;
          localStorage.removeItem(draftKey);
        }
        setHasDraft(false);
        
        // Replace optimistic message with real one
        setMessages(prev => prev.map(msg => 
          msg.id === tempId 
            ? { ...msg, id: response.data.data.id, status: 'sent' }
            : msg
        ));
        
        fetchConversations();
      }
    } catch (error) {
      // Remove optimistic message on error
      setMessages(prev => prev.filter(msg => msg.id !== tempId));
      setNewMessage(messageContent); // Restore message
      
      toast({
        title: 'Send Failed',
        description: error.response?.data?.error || 'Failed to send message',
        variant: 'destructive'
      });
    } finally {
      setSending(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Handle typing indicator
  const handleTyping = (e) => {
    setNewMessage(e.target.value);
    
    // Emit typing event
    if (selectedConversation?.conversationId && selectedConversation?.recipientId && isConnected) {
      if (e.target.value.trim()) {
        sendTypingStart(selectedConversation.conversationId, selectedConversation.recipientId);
      } else {
        sendTypingStop(selectedConversation.conversationId, selectedConversation.recipientId);
      }
    }
  };

  const handleCreateNewMessage = async () => {
    if (!selectedPatientId || !newMessageContent.trim()) return;

    setSendingNewMessage(true);
    try {
      const response = await api.post('/messages', {
        recipientId: selectedPatientId,
        content: newMessageContent,
        isUrgent: false
      });

      if (response.data.success) {
        toast({
          title: 'Success',
          description: 'Message sent successfully',
          variant: 'success'
        });
        setShowNewMessageModal(false);
        setSelectedPatientId('');
        setNewMessageContent('');
        fetchConversations();
        // Select the new conversation
        const selectedPatient = patients.find(p => p.id === selectedPatientId);
        if (selectedPatient) {
          setSelectedConversation({
            recipientId: selectedPatientId,
            recipientName: `${selectedPatient.firstName} ${selectedPatient.lastName}`
          });
        }
      }
    } catch (error) {
      toast({
        title: 'Send Failed',
        description: error.response?.data?.error || 'Failed to send message',
        variant: 'destructive'
      });
    } finally {
      setSendingNewMessage(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-200px)] flex flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <MessageSquare className="w-6 h-6 text-blue-500" />
            Messages
            {/* Real-time connection indicator */}
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
              isConnected 
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' 
                : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
            }`}>
              {isConnected ? (
                <>
                  <Wifi className="w-3 h-3" />
                  Live
                </>
              ) : (
                <>
                  <WifiOff className="w-3 h-3" />
                  Offline
                </>
              )}
            </span>
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Communicate with your patients in real-time</p>
        </div>
        <Button
          onClick={() => setShowNewMessageModal(true)}
          className="bg-blue-500 hover:bg-blue-600"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Message
        </Button>
      </div>

      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* Conversations List */}
        <Card className="w-80 flex flex-col">
          <CardHeader className="border-b">
            <CardTitle className="text-base">Conversations</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto p-0">
            {conversations.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                <MessageSquare className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-sm">No conversations yet</p>
              </div>
            ) : (
              <div className="divide-y">
                {conversations.map((conv) => {
                  const recipientId = conv.recipientId || conv.otherUser?.id;
                  const recipientName = conv.recipientName || (conv.otherUser ? `${conv.otherUser.firstName} ${conv.otherUser.lastName}` : 'Patient');
                  const lastMessageText = typeof conv.lastMessage === 'string' 
                    ? conv.lastMessage 
                    : conv.lastMessage?.preview || 'No messages yet';
                  
                  return (
                    <button
                      key={recipientId || conv.conversationId}
                      onClick={() => setSelectedConversation({
                        recipientId,
                        recipientName,
                        conversationId: conv.conversationId
                      })}
                      className={`w-full p-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors ${
                        selectedConversation?.recipientId === recipientId ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center text-white font-bold">
                            {recipientName?.[0] || 'P'}
                          </div>
                          {/* Online indicator */}
                          {isUserOnline(recipientId) && (
                            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 border-2 border-white dark:border-slate-800 rounded-full" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-900 dark:text-white truncate">
                            {recipientName}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-1">
                            {lastMessageText}
                          </p>
                        </div>
                        {(conv.unreadCount || 0) > 0 && (
                          <span className="bg-blue-500 text-white text-xs px-2 py-1 rounded-full">
                            {conv.unreadCount}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Messages Area */}
        <Card className="flex-1 flex flex-col">
          {selectedConversation ? (
            <>
              <CardHeader className="border-b">
                <CardTitle className="text-base flex items-center gap-2">
                  <div className="relative">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center text-white text-sm font-bold">
                      {selectedConversation.recipientName?.[0] || 'P'}
                    </div>
                    {/* Online status indicator */}
                    {isUserOnline(selectedConversation.recipientId) && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 border-2 border-white dark:border-slate-800 rounded-full" />
                    )}
                  </div>
                  <div className="flex flex-col">
                    <span>{selectedConversation.recipientName || 'Patient'}</span>
                    <span className={`text-xs font-normal ${
                      isUserOnline(selectedConversation.recipientId) 
                        ? 'text-emerald-600 dark:text-emerald-400' 
                        : 'text-slate-400'
                    }`}>
                      {isUserOnline(selectedConversation.recipientId) ? 'Online' : 'Offline'}
                    </span>
                  </div>
                </CardTitle>
              </CardHeader>
              
              <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 ? (
                  <div className="text-center py-12 text-slate-500">
                    <MessageSquare className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                    <p>No messages yet. Start the conversation!</p>
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.sentByMe ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[70%] rounded-lg p-3 ${
                        msg.sentByMe 
                          ? 'bg-blue-500 text-white' 
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white'
                      }`}>
                        {msg.isUrgent && !msg.sentByMe && (
                          <div className="flex items-center gap-1 text-red-600 mb-1">
                            <AlertCircle className="w-3 h-3" />
                            <span className="text-xs font-medium">Urgent</span>
                          </div>
                        )}
                        <p className="text-sm whitespace-pre-wrap">{msg.content || 'Message could not be loaded'}</p>
                        <div className={`flex items-center gap-1 text-xs mt-1 ${
                          msg.sentByMe ? 'text-blue-50' : 'text-slate-500 dark:text-slate-400'
                        }`}>
                          <span>{formatRelativeTime(msg.createdAt)}</span>
                          {msg.sentByMe && msg.status === 'sent' && (
                            <CheckCheck className="w-3 h-3" />
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </CardContent>

              <div className="border-t p-4">
                {/* Typing indicator */}
                {typingIndicator && (
                  <div className="mb-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <div className="flex items-center gap-1">
                      <span className="flex gap-1">
                        <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </span>
                    </div>
                    <span>{typingIndicator.userName} is typing...</span>
                  </div>
                )}
                
                {/* Draft indicator */}
                {hasDraft && newMessage && !typingIndicator && (
                  <div className="mb-2 flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-1 rounded border border-blue-200 dark:border-blue-800">
                    <FileText className="w-3 h-3" />
                    <span>Draft saved automatically</span>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <textarea
                    value={newMessage}
                    onChange={handleTyping}
                    onKeyPress={handleKeyPress}
                    placeholder="Type your message..."
                    className="flex-1 min-h-[60px] max-h-[120px] p-3 border border-slate-300 dark:border-slate-600 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                  <Button
                    onClick={sendMessage}
                    disabled={!newMessage.trim() || sending}
                    className="bg-blue-500 hover:bg-blue-600"
                  >
                    {sending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500">
              <div className="text-center">
                <MessageSquare className="w-16 h-16 text-slate-300 mx-auto mb-3" />
                <p>Select a conversation to view messages</p>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* New Message Modal */}
      {showNewMessageModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="border-b flex flex-row items-center justify-between">
              <CardTitle>New Message</CardTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setShowNewMessageModal(false);
                  setSelectedPatientId('');
                  setNewMessageContent('');
                }}
              >
                <X className="w-4 h-4" />
              </Button>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Select Patient</label>
                {loadingPatients ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                  </div>
                ) : (
                  <select
                    value={selectedPatientId}
                    onChange={(e) => setSelectedPatientId(e.target.value)}
                    className="w-full p-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-slate-800"
                  >
                    <option value="">Choose a patient...</option>
                    {patients.map((patient) => (
                      <option key={patient.id} value={patient.id}>
                        {patient.firstName} {patient.lastName}
                      </option>
                    ))}
                  </select>
                )}
                {patients.length === 0 && !loadingPatients && (
                  <p className="text-sm text-slate-500">
                    No patients available. You need to have appointments with patients to message them.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Message</label>
                <textarea
                  value={newMessageContent}
                  onChange={(e) => setNewMessageContent(e.target.value)}
                  placeholder="Type your message..."
                  className="w-full min-h-[100px] p-3 border border-slate-300 dark:border-slate-600 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-slate-800"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowNewMessageModal(false);
                    setSelectedPatientId('');
                    setNewMessageContent('');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateNewMessage}
                  disabled={!selectedPatientId || !newMessageContent.trim() || sendingNewMessage}
                  className="bg-blue-500 hover:bg-blue-600"
                >
                  {sendingNewMessage ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Send
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
