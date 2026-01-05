'use client';

import { useState, useEffect } from 'react';
import {
  Mail, Search, Star, Paperclip, Reply, Forward, Trash2,
  MoreHorizontal, RefreshCw, Archive, Tag, AlertTriangle,
  Send, Clock, CheckCircle, Filter, Plus, ChevronRight,
  Bot, Sparkles, User
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

// Mock data for development
const MOCK_THREADS = [
  {
    id: '1',
    subject: 'Question about my prescription refill',
    lastMessageAt: new Date(Date.now() - 1000 * 60 * 30),
    messageCount: 3,
    unreadCount: 1,
    hasAttachments: false,
    isStarred: true,
    priority: 'normal',
    sentiment: 'neutral',
    preview: 'Hi, I wanted to ask about getting my blood pressure medication refilled...',
    sender: { name: 'John Smith', email: 'john.smith@email.com' }
  },
  {
    id: '2',
    subject: 'Urgent: Experiencing side effects',
    lastMessageAt: new Date(Date.now() - 1000 * 60 * 60 * 2),
    messageCount: 5,
    unreadCount: 2,
    hasAttachments: false,
    isStarred: false,
    priority: 'urgent',
    sentiment: 'distressed',
    preview: 'I started the new medication yesterday and I\'m having some concerning symptoms...',
    sender: { name: 'Sarah Johnson', email: 'sarah.j@email.com' }
  },
  {
    id: '3',
    subject: 'Thank you for the great care!',
    lastMessageAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
    messageCount: 2,
    unreadCount: 0,
    hasAttachments: true,
    isStarred: false,
    priority: 'low',
    sentiment: 'positive',
    preview: 'I just wanted to send a quick note to thank Dr. Martinez for the wonderful care...',
    sender: { name: 'Michael Chen', email: 'm.chen@email.com' }
  },
  {
    id: '4',
    subject: 'Insurance verification documents',
    lastMessageAt: new Date(Date.now() - 1000 * 60 * 60 * 48),
    messageCount: 4,
    unreadCount: 0,
    hasAttachments: true,
    isStarred: false,
    priority: 'normal',
    sentiment: 'neutral',
    preview: 'Please find attached the requested insurance verification documents...',
    sender: { name: 'Emily Davis', email: 'emily.d@email.com' }
  }
];

const MOCK_MESSAGES = [
  {
    id: 'm1',
    senderEmail: 'john.smith@email.com',
    senderName: 'John Smith',
    subject: 'Question about my prescription refill',
    bodyText: `Hi,

I wanted to ask about getting my blood pressure medication refilled. I'm running low and would like to get a refill before my next appointment.

Can you please let me know the process for requesting a refill?

Thank you,
John Smith`,
    direction: 'inbound',
    isRead: true,
    sentAt: new Date(Date.now() - 1000 * 60 * 60 * 24)
  },
  {
    id: 'm2',
    senderEmail: 'admin@doctarx.com',
    senderName: 'Docta Admin',
    subject: 'Re: Question about my prescription refill',
    bodyText: `Dear John,

Thank you for reaching out. I've forwarded your refill request to Dr. Martinez for review.

You should receive a notification once the prescription has been sent to your pharmacy.

Best regards,
Docta Care Team`,
    direction: 'outbound',
    isRead: true,
    sentAt: new Date(Date.now() - 1000 * 60 * 60 * 12)
  }
];

const sentimentColors = {
  positive: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  neutral: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
  negative: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  urgent: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  distressed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
};

const priorityColors = {
  low: 'text-gray-500',
  normal: 'text-blue-500',
  high: 'text-orange-500',
  urgent: 'text-red-500'
};

export default function InboxPage() {
  const [threads, setThreads] = useState(MOCK_THREADS);
  const [selectedThread, setSelectedThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showComposeDialog, setShowComposeDialog] = useState(false);
  const [showAISuggest, setShowAISuggest] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState('');
  const [replyContent, setReplyContent] = useState('');

  // Compose form state
  const [composeForm, setComposeForm] = useState({
    to: '',
    subject: '',
    body: ''
  });

  useEffect(() => {
    if (selectedThread) {
      setMessages(MOCK_MESSAGES);
    }
  }, [selectedThread]);

  const formatTime = (date) => {
    const now = new Date();
    const diff = now - new Date(date);
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(date).toLocaleDateString();
  };

  const handleStarThread = (threadId, e) => {
    e.stopPropagation();
    setThreads(threads.map(t =>
      t.id === threadId ? { ...t, isStarred: !t.isStarred } : t
    ));
  };

  const handleGetAISuggestion = async () => {
    setShowAISuggest(true);
    // Simulate AI suggestion
    setTimeout(() => {
      setAiSuggestion(`Dear John,

Thank you for your patience. Your prescription refill request has been approved by Dr. Martinez and sent to your pharmacy.

Please allow 24-48 hours for processing. You can pick up your medication at your preferred pharmacy location.

If you have any questions, please don't hesitate to reach out.

Best regards,
Docta Care Team`);
    }, 1500);
  };

  const handleSendReply = () => {
    if (!replyContent.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a message',
        variant: 'destructive'
      });
      return;
    }

    // Add reply to messages
    setMessages([...messages, {
      id: `m${messages.length + 1}`,
      senderEmail: 'admin@doctarx.com',
      senderName: 'Docta Admin',
      subject: `Re: ${selectedThread?.subject}`,
      bodyText: replyContent,
      direction: 'outbound',
      isRead: true,
      sentAt: new Date()
    }]);

    setReplyContent('');
    setShowAISuggest(false);
    setAiSuggestion('');

    toast({
      title: 'Reply Sent',
      description: 'Your message has been queued for delivery'
    });
  };

  const filteredThreads = threads.filter(thread =>
    thread.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
    thread.sender.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-full">
      {/* Thread List */}
      <div className={cn(
        'flex flex-col border-r border-border bg-card',
        selectedThread ? 'w-96' : 'w-full max-w-2xl'
      )}>
        {/* Toolbar */}
        <div className="flex items-center gap-2 p-4 border-b border-border">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search messages..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Button variant="outline" size="icon">
            <Filter className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="icon">
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button onClick={() => setShowComposeDialog(true)} className="bg-primary">
            <Plus className="w-4 h-4 mr-2" />
            Compose
          </Button>
        </div>

        {/* Thread List */}
        <div className="flex-1 overflow-auto">
          {filteredThreads.map((thread) => (
            <div
              key={thread.id}
              onClick={() => setSelectedThread(thread)}
              className={cn(
                'flex items-start gap-3 p-4 border-b border-border cursor-pointer transition-colors',
                'hover:bg-accent/50',
                selectedThread?.id === thread.id && 'bg-accent',
                thread.unreadCount > 0 && 'bg-primary/5'
              )}
            >
              {/* Star */}
              <button
                onClick={(e) => handleStarThread(thread.id, e)}
                className="mt-1"
              >
                <Star className={cn(
                  'w-4 h-4',
                  thread.isStarred ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'
                )} />
              </button>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    'font-medium truncate',
                    thread.unreadCount > 0 && 'font-semibold'
                  )}>
                    {thread.sender.name}
                  </span>
                  {thread.priority === 'urgent' && (
                    <AlertTriangle className="w-4 h-4 text-red-500" />
                  )}
                  {thread.hasAttachments && (
                    <Paperclip className="w-3 h-3 text-muted-foreground" />
                  )}
                </div>
                <p className={cn(
                  'text-sm truncate',
                  thread.unreadCount > 0 ? 'font-medium text-foreground' : 'text-muted-foreground'
                )}>
                  {thread.subject}
                </p>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {thread.preview}
                </p>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-xs text-muted-foreground">
                    {formatTime(thread.lastMessageAt)}
                  </span>
                  {thread.sentiment && (
                    <Badge variant="secondary" className={cn('text-xs', sentimentColors[thread.sentiment])}>
                      {thread.sentiment}
                    </Badge>
                  )}
                  {thread.unreadCount > 0 && (
                    <Badge className="bg-primary text-primary-foreground text-xs">
                      {thread.unreadCount}
                    </Badge>
                  )}
                </div>
              </div>

              <ChevronRight className="w-4 h-4 text-muted-foreground mt-1" />
            </div>
          ))}
        </div>
      </div>

      {/* Message Detail */}
      {selectedThread && (
        <div className="flex-1 flex flex-col bg-background">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div>
              <h2 className="font-semibold text-lg">{selectedThread.subject}</h2>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm text-muted-foreground">
                  {selectedThread.messageCount} messages
                </span>
                {selectedThread.sentiment && (
                  <Badge variant="secondary" className={sentimentColors[selectedThread.sentiment]}>
                    {selectedThread.sentiment}
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon">
                <Archive className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="icon">
                <Tag className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="icon">
                <Trash2 className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="icon">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {messages.map((message) => (
              <Card key={message.id} className={cn(
                message.direction === 'outbound' && 'ml-12 bg-primary/5'
              )}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      'w-10 h-10 rounded-full flex items-center justify-center',
                      message.direction === 'inbound' ? 'bg-blue-100' : 'bg-green-100'
                    )}>
                      <User className={cn(
                        'w-5 h-5',
                        message.direction === 'inbound' ? 'text-blue-600' : 'text-green-600'
                      )} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{message.senderName}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatTime(message.sentAt)}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">{message.senderEmail}</p>
                      <div className="mt-3 text-sm whitespace-pre-wrap">
                        {message.bodyText}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Reply Box */}
          <div className="border-t border-border p-4">
            {showAISuggest && aiSuggestion && (
              <Card className="mb-4 border-violet-200 bg-violet-50 dark:bg-violet-900/20">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Bot className="w-4 h-4 text-violet-600" />
                    <span className="text-sm font-medium text-violet-600">AI Suggested Reply</span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{aiSuggestion}</p>
                  <div className="flex gap-2 mt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setReplyContent(aiSuggestion)}
                    >
                      Use This
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowAISuggest(false)}
                    >
                      Dismiss
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
            
            <div className="flex items-start gap-2">
              <Textarea
                placeholder="Type your reply..."
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                rows={3}
                className="flex-1"
              />
            </div>
            <div className="flex items-center justify-between mt-3">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGetAISuggestion}
                  disabled={showAISuggest && !aiSuggestion}
                >
                  <Sparkles className="w-4 h-4 mr-2 text-violet-500" />
                  AI Suggest
                </Button>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm">
                  <Forward className="w-4 h-4 mr-2" />
                  Forward
                </Button>
                <Button size="sm" onClick={handleSendReply}>
                  <Send className="w-4 h-4 mr-2" />
                  Send Reply
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!selectedThread && filteredThreads.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Mail className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold">No messages found</h3>
            <p className="text-muted-foreground mt-1">
              {searchQuery ? 'Try a different search term' : 'Your inbox is empty'}
            </p>
          </div>
        </div>
      )}

      {/* Compose Dialog */}
      <Dialog open={showComposeDialog} onOpenChange={setShowComposeDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Compose New Email</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>To</Label>
              <Input
                placeholder="recipient@example.com"
                value={composeForm.to}
                onChange={(e) => setComposeForm({ ...composeForm, to: e.target.value })}
              />
            </div>
            <div>
              <Label>Subject</Label>
              <Input
                placeholder="Email subject"
                value={composeForm.subject}
                onChange={(e) => setComposeForm({ ...composeForm, subject: e.target.value })}
              />
            </div>
            <div>
              <Label>Message</Label>
              <Textarea
                placeholder="Write your message..."
                value={composeForm.body}
                onChange={(e) => setComposeForm({ ...composeForm, body: e.target.value })}
                rows={10}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowComposeDialog(false)}>
              Cancel
            </Button>
            <Button onClick={() => {
              toast({ title: 'Email Sent', description: 'Your message has been queued' });
              setShowComposeDialog(false);
              setComposeForm({ to: '', subject: '', body: '' });
            }}>
              <Send className="w-4 h-4 mr-2" />
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

