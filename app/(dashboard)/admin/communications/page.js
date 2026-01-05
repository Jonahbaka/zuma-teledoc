'use client';

import { useState, useEffect } from 'react';
import {
  MessageSquare, Send, Loader2, Search, Users, User,
  Mail, Bell, CheckCircle, AlertCircle, Clock, Filter
} from 'lucide-react';
import { adminAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';
import { formatRelativeTime } from '@/lib/utils';

export default function AdminCommunicationsPage() {
  const [activeTab, setActiveTab] = useState('compose'); // 'compose' | 'history' | 'broadcast'
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  
  // Compose state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [sendEmail, setSendEmail] = useState(false);
  
  // Broadcast state
  const [broadcastSubject, setBroadcastSubject] = useState('');
  const [broadcastContent, setBroadcastContent] = useState('');
  const [targetRole, setTargetRole] = useState('');
  const [broadcastSendEmail, setBroadcastSendEmail] = useState(false);
  
  // History state
  const [communications, setCommunications] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  
  // Search users
  useEffect(() => {
    const searchUsers = async () => {
      if (searchQuery.length < 2) {
        setSearchResults([]);
        return;
      }
      
      try {
        const response = await adminAPI.getUsers({ query: searchQuery, limit: 10 });
        if (response.data.success) {
          setSearchResults(response.data.users);
        }
      } catch (error) {
        console.error('Search error:', error);
      }
    };
    
    const debounce = setTimeout(searchUsers, 300);
    return () => clearTimeout(debounce);
  }, [searchQuery]);
  
  // Load history
  useEffect(() => {
    if (activeTab === 'history') {
      loadHistory();
    }
  }, [activeTab]);
  
  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const response = await adminAPI.getCommunications({ limit: 50 });
      if (response.data.success) {
        setCommunications(response.data.communications);
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load communication history',
        variant: 'destructive'
      });
    } finally {
      setHistoryLoading(false);
    }
  };
  
  const handleSendMessage = async () => {
    if (!selectedUser || !subject.trim() || !content.trim()) {
      toast({
        title: 'Missing Information',
        description: 'Please select a recipient and fill in all fields',
        variant: 'destructive'
      });
      return;
    }
    
    setSending(true);
    try {
      const response = await adminAPI.sendMessage({
        userId: selectedUser.id,
        subject: subject.trim(),
        content: content.trim(),
        sendEmail
      });
      
      if (response.data.success) {
        toast({
          title: 'Message Sent',
          description: `Message sent successfully to ${selectedUser.firstName} ${selectedUser.lastName}`,
          variant: 'success'
        });
        
        // Reset form
        setSelectedUser(null);
        setSubject('');
        setContent('');
        setSendEmail(false);
        setSearchQuery('');
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to send message',
        variant: 'destructive'
      });
    } finally {
      setSending(false);
    }
  };
  
  const handleBroadcast = async () => {
    if (!broadcastSubject.trim() || !broadcastContent.trim()) {
      toast({
        title: 'Missing Information',
        description: 'Please fill in subject and message content',
        variant: 'destructive'
      });
      return;
    }
    
    setSending(true);
    try {
      const response = await adminAPI.sendBulkMessage({
        targetRole: targetRole || undefined,
        subject: broadcastSubject.trim(),
        content: broadcastContent.trim(),
        sendEmail: broadcastSendEmail
      });
      
      if (response.data.success) {
        toast({
          title: 'Broadcast Sent',
          description: response.data.message,
          variant: 'success'
        });
        
        // Reset form
        setBroadcastSubject('');
        setBroadcastContent('');
        setTargetRole('');
        setBroadcastSendEmail(false);
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to send broadcast',
        variant: 'destructive'
      });
    } finally {
      setSending(false);
    }
  };
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold font-serif text-foreground">Communications</h1>
        <p className="text-muted-foreground mt-1">
          Send messages and notifications to users
        </p>
      </div>
      
      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-border pb-2">
        <Button
          variant={activeTab === 'compose' ? 'default' : 'ghost'}
          onClick={() => setActiveTab('compose')}
          className="gap-2"
        >
          <User className="w-4 h-4" />
          Compose Message
        </Button>
        <Button
          variant={activeTab === 'broadcast' ? 'default' : 'ghost'}
          onClick={() => setActiveTab('broadcast')}
          className="gap-2"
        >
          <Users className="w-4 h-4" />
          Broadcast
        </Button>
        <Button
          variant={activeTab === 'history' ? 'default' : 'ghost'}
          onClick={() => setActiveTab('history')}
          className="gap-2"
        >
          <Clock className="w-4 h-4" />
          History
        </Button>
      </div>
      
      {/* Compose Tab */}
      {activeTab === 'compose' && (
        <div className="grid md:grid-cols-2 gap-6">
          {/* Recipient Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5" />
                Select Recipient
              </CardTitle>
              <CardDescription>
                Search for a user to send a message
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              
              {/* Search Results */}
              {searchResults.length > 0 && !selectedUser && (
                <div className="border border-border rounded-lg max-h-64 overflow-y-auto">
                  {searchResults.map((user) => (
                    <button
                      key={user.id}
                      onClick={() => {
                        setSelectedUser(user);
                        setSearchQuery('');
                        setSearchResults([]);
                      }}
                      className="w-full p-3 text-left hover:bg-accent transition-colors border-b border-border last:border-0 flex items-center justify-between"
                    >
                      <div>
                        <p className="font-medium text-foreground">
                          {user.firstName} {user.lastName}
                        </p>
                        <p className="text-sm text-muted-foreground">{user.email}</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        user.role === 'provider' ? 'bg-purple-100 text-purple-700' :
                        user.role === 'patient' ? 'bg-blue-100 text-blue-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {user.role}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              
              {/* Selected User */}
              {selectedUser && (
                <div className="p-4 bg-accent rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">
                        {selectedUser.firstName} {selectedUser.lastName}
                      </p>
                      <p className="text-sm text-muted-foreground">{selectedUser.email}</p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedUser(null)}
                  >
                    Change
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          
          {/* Message Composition */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5" />
                Message
              </CardTitle>
              <CardDescription>
                Compose your message
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="subject">Subject</Label>
                <Input
                  id="subject"
                  placeholder="Enter subject..."
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>
              
              <div>
                <Label htmlFor="content">Message</Label>
                <textarea
                  id="content"
                  placeholder="Type your message here..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={6}
                  className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y"
                />
              </div>
              
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="sendEmail"
                  checked={sendEmail}
                  onChange={(e) => setSendEmail(e.target.checked)}
                  className="w-4 h-4 rounded border-border"
                />
                <Label htmlFor="sendEmail" className="text-sm cursor-pointer">
                  Also send as email notification
                </Label>
              </div>
              
              <Button
                onClick={handleSendMessage}
                disabled={sending || !selectedUser || !subject.trim() || !content.trim()}
                className="w-full"
              >
                {sending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    Send Message
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
      
      {/* Broadcast Tab */}
      {activeTab === 'broadcast' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Broadcast Message
            </CardTitle>
            <CardDescription>
              Send a message to multiple users at once
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <Label>Target Audience</Label>
                  <select
                    value={targetRole}
                    onChange={(e) => setTargetRole(e.target.value)}
                    className="flex w-full h-10 mt-1 rounded-lg border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <option value="">All Users</option>
                    <option value="patient">All Patients</option>
                    <option value="provider">All Providers</option>
                    <option value="admin">All Admins</option>
                  </select>
                </div>
                
                <div>
                  <Label htmlFor="broadcastSubject">Subject</Label>
                  <Input
                    id="broadcastSubject"
                    placeholder="Enter subject..."
                    value={broadcastSubject}
                    onChange={(e) => setBroadcastSubject(e.target.value)}
                  />
                </div>
                
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="broadcastSendEmail"
                    checked={broadcastSendEmail}
                    onChange={(e) => setBroadcastSendEmail(e.target.checked)}
                    className="w-4 h-4 rounded border-border"
                  />
                  <Label htmlFor="broadcastSendEmail" className="text-sm cursor-pointer">
                    Also send as email notification
                  </Label>
                </div>
              </div>
              
              <div>
                <Label htmlFor="broadcastContent">Message</Label>
                <textarea
                  id="broadcastContent"
                  placeholder="Type your broadcast message here..."
                  value={broadcastContent}
                  onChange={(e) => setBroadcastContent(e.target.value)}
                  rows={8}
                  className="flex w-full mt-1 rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y"
                />
              </div>
            </div>
            
            <div className="flex justify-end">
              <Button
                onClick={handleBroadcast}
                disabled={sending || !broadcastSubject.trim() || !broadcastContent.trim()}
                className="gap-2"
              >
                {sending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Send Broadcast
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* History Tab */}
      {activeTab === 'history' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Communication History
            </CardTitle>
            <CardDescription>
              View past messages sent to users
            </CardDescription>
          </CardHeader>
          <CardContent>
            {historyLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : communications.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No communications sent yet</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {communications.map((comm) => (
                  <div key={comm.id} className="py-4 flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      comm.isRead ? 'bg-muted' : 'bg-primary/10'
                    }`}>
                      {comm.isRead ? (
                        <CheckCircle className="w-5 h-5 text-muted-foreground" />
                      ) : (
                        <Bell className="w-5 h-5 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-foreground">{comm.title}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          comm.recipient.role === 'provider' ? 'bg-purple-100 text-purple-700' :
                          comm.recipient.role === 'patient' ? 'bg-blue-100 text-blue-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>
                          {comm.recipient.role}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">{comm.message}</p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <span>To: {comm.recipient.name}</span>
                        <span>•</span>
                        <span>{formatRelativeTime(comm.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

