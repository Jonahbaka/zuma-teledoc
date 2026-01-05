'use client';

import { useState, useEffect } from 'react';
import {
  Mail, Plus, Send, Copy, Trash2, Clock, CheckCircle, XCircle,
  Loader2, Search, RefreshCw, Users, Stethoscope, Shield, Link2,
  ExternalLink, FileText
} from 'lucide-react';
import { adminAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';

const INVITE_TYPE_CONFIG = {
  provider: {
    label: 'Provider',
    icon: Stethoscope,
    color: 'bg-blue-100 text-blue-800',
    description: 'Invite healthcare providers to join the platform'
  },
  admin: {
    label: 'Admin',
    icon: Shield,
    color: 'bg-purple-100 text-purple-800',
    description: 'Invite administrators'
  }
};

const STATUS_CONFIG = {
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-800', icon: Clock },
  accepted: { label: 'Accepted', color: 'bg-green-100 text-green-800', icon: CheckCircle },
  expired: { label: 'Expired', color: 'bg-red-100 text-red-800', icon: XCircle },
  revoked: { label: 'Revoked', color: 'bg-gray-100 text-gray-800', icon: XCircle }
};

export default function AdminInvitesPage() {
  const [loading, setLoading] = useState(true);
  const [invites, setInvites] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  
  // Create invite form
  const [inviteForm, setInviteForm] = useState({
    type: 'provider',
    email: '',
    firstName: '',
    lastName: '',
    specialty: '',
    personalMessage: '',
    expiresInDays: 7
  });

  // Stats
  const [stats, setStats] = useState({
    totalPending: 0,
    totalAccepted: 0,
    totalExpired: 0
  });

  // Load invites
  useEffect(() => {
    loadInvites();
  }, [statusFilter, typeFilter]);

  const loadInvites = async () => {
    setLoading(true);
    try {
      const response = await adminAPI.getInvites({
        status: statusFilter !== 'all' ? statusFilter : undefined,
        type: typeFilter !== 'all' ? typeFilter : undefined
      });
      
      if (response.data.success) {
        setInvites(response.data.invites);
        calculateStats(response.data.invites);
      }
    } catch (error) {
      console.error('Load invites error:', error);
      // Set empty array on error
      setInvites([]);
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (inviteList) => {
    setStats({
      totalPending: inviteList.filter(i => i.status === 'pending').length,
      totalAccepted: inviteList.filter(i => i.status === 'accepted').length,
      totalExpired: inviteList.filter(i => i.status === 'expired').length
    });
  };

  const handleCreateInvite = async () => {
    if (!inviteForm.email) {
      toast({
        title: 'Email Required',
        description: 'Please enter an email address',
        variant: 'destructive'
      });
      return;
    }

    setSubmitting(true);
    try {
      const response = await adminAPI.createInvite(inviteForm);
      
      if (response.data.success) {
        toast({
          title: 'Invitation Sent',
          description: `Invitation sent to ${inviteForm.email}`,
        });
        setShowCreateModal(false);
        resetForm();
        loadInvites();
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to send invitation',
        variant: 'destructive'
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendInvite = async (inviteId) => {
    try {
      const response = await adminAPI.resendInvite(inviteId);
      
      if (response.data.success) {
        toast({
          title: 'Invitation Resent',
          description: 'The invitation has been resent',
        });
        loadInvites();
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to resend invitation',
        variant: 'destructive'
      });
    }
  };

  const handleRevokeInvite = async (inviteId) => {
    if (!confirm('Are you sure you want to revoke this invitation?')) return;
    
    try {
      const response = await adminAPI.revokeInvite(inviteId);
      
      if (response.data.success) {
        toast({
          title: 'Invitation Revoked',
          description: 'The invitation has been revoked',
        });
        loadInvites();
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to revoke invitation',
        variant: 'destructive'
      });
    }
  };

  const copyInviteLink = (invite) => {
    const baseUrl = window.location.origin;
    const link = `${baseUrl}/${invite.type}/register?token=${invite.token}`;
    navigator.clipboard.writeText(link);
    toast({
      title: 'Link Copied',
      description: 'Invitation link copied to clipboard',
    });
  };

  const resetForm = () => {
    setInviteForm({
      type: 'provider',
      email: '',
      firstName: '',
      lastName: '',
      specialty: '',
      personalMessage: '',
      expiresInDays: 7
    });
  };

  // Filter invites
  const filteredInvites = invites.filter(i =>
    i.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    i.firstName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    i.lastName?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl">
              <Mail className="w-6 h-6 text-white" />
            </div>
            Invitations
          </h1>
          <p className="text-muted-foreground mt-1">Manage provider and admin invitations</p>
        </div>
        
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={loadInvites} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={() => setShowCreateModal(true)} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="w-4 h-4 mr-2" />
            Send Invitation
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending</p>
                <p className="text-2xl font-bold text-yellow-600">{stats.totalPending}</p>
              </div>
              <Clock className="w-8 h-8 text-yellow-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Accepted</p>
                <p className="text-2xl font-bold text-green-600">{stats.totalAccepted}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Expired</p>
                <p className="text-2xl font-bold text-red-600">{stats.totalExpired}</p>
              </div>
              <XCircle className="w-8 h-8 text-red-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground">Status:</Label>
          {['all', 'pending', 'accepted', 'expired', 'revoked'].map((status) => (
            <Button
              key={status}
              variant={statusFilter === status ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(status)}
              className={statusFilter === status ? 'bg-blue-600' : ''}
            >
              {status === 'all' ? 'All' : STATUS_CONFIG[status]?.label || status}
            </Button>
          ))}
        </div>
        
        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground">Type:</Label>
          {['all', 'provider', 'admin'].map((type) => (
            <Button
              key={type}
              variant={typeFilter === type ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTypeFilter(type)}
              className={typeFilter === type ? 'bg-blue-600' : ''}
            >
              {type === 'all' ? 'All' : INVITE_TYPE_CONFIG[type]?.label || type}
            </Button>
          ))}
        </div>
        
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search invites..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Invites List */}
      <Card>
        <CardContent className="p-0">
          {filteredInvites.length === 0 ? (
            <div className="py-12 text-center">
              <Mail className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold">No Invitations</h3>
              <p className="text-muted-foreground mt-1">
                {statusFilter === 'all' 
                  ? 'Send your first invitation to get started'
                  : `No ${statusFilter} invitations found`}
              </p>
              <Button onClick={() => setShowCreateModal(true)} className="mt-4">
                <Plus className="w-4 h-4 mr-2" />
                Send Invitation
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filteredInvites.map((invite) => {
                const typeConfig = INVITE_TYPE_CONFIG[invite.type] || INVITE_TYPE_CONFIG.provider;
                const statusConfig = STATUS_CONFIG[invite.status] || STATUS_CONFIG.pending;
                const TypeIcon = typeConfig.icon;
                const StatusIcon = statusConfig.icon;
                
                return (
                  <div key={invite.id} className="p-4 hover:bg-muted/30">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${typeConfig.color.split(' ')[0]}`}>
                          <TypeIcon className={`w-5 h-5 ${typeConfig.color.split(' ')[1]}`} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium">
                              {invite.firstName} {invite.lastName}
                            </p>
                            <Badge className={typeConfig.color}>
                              {typeConfig.label}
                            </Badge>
                            <Badge className={statusConfig.color}>
                              <StatusIcon className="w-3 h-3 mr-1" />
                              {statusConfig.label}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{invite.email}</p>
                          {invite.specialty && (
                            <p className="text-xs text-muted-foreground mt-1">{invite.specialty}</p>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          Expires: {new Date(invite.expiresAt).toLocaleDateString()}
                        </span>
                        
                        {invite.status === 'pending' && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => copyInviteLink(invite)}
                            >
                              <Copy className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleResendInvite(invite.id)}
                            >
                              <Send className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleRevokeInvite(invite.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Invite Modal */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Send Invitation</DialogTitle>
            <DialogDescription>
              Invite a provider or administrator to join the platform
            </DialogDescription>
          </DialogHeader>
          
          <Tabs value={inviteForm.type} onValueChange={(v) => setInviteForm(prev => ({ ...prev, type: v }))}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="provider">
                <Stethoscope className="w-4 h-4 mr-2" />
                Provider
              </TabsTrigger>
              <TabsTrigger value="admin">
                <Shield className="w-4 h-4 mr-2" />
                Admin
              </TabsTrigger>
            </TabsList>
            
            <div className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>First Name</Label>
                  <Input
                    value={inviteForm.firstName}
                    onChange={(e) => setInviteForm(prev => ({ ...prev, firstName: e.target.value }))}
                    placeholder="John"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Last Name</Label>
                  <Input
                    value={inviteForm.lastName}
                    onChange={(e) => setInviteForm(prev => ({ ...prev, lastName: e.target.value }))}
                    placeholder="Smith"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>Email Address *</Label>
                <Input
                  type="email"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="doctor@hospital.com"
                  required
                />
              </div>
              
              {inviteForm.type === 'provider' && (
                <div className="space-y-2">
                  <Label>Specialty</Label>
                  <select
                    value={inviteForm.specialty}
                    onChange={(e) => setInviteForm(prev => ({ ...prev, specialty: e.target.value }))}
                    className="w-full h-10 rounded-md border border-input bg-background px-3"
                  >
                    <option value="">Select specialty</option>
                    <option value="Primary Care">Primary Care</option>
                    <option value="Internal Medicine">Internal Medicine</option>
                    <option value="Cardiology">Cardiology</option>
                    <option value="Dermatology">Dermatology</option>
                    <option value="Psychiatry">Psychiatry</option>
                    <option value="Pediatrics">Pediatrics</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              )}
              
              <div className="space-y-2">
                <Label>Personal Message (Optional)</Label>
                <Textarea
                  value={inviteForm.personalMessage}
                  onChange={(e) => setInviteForm(prev => ({ ...prev, personalMessage: e.target.value }))}
                  placeholder="Add a personal message to the invitation..."
                  rows={3}
                />
              </div>
              
              <div className="space-y-2">
                <Label>Expires In</Label>
                <select
                  value={inviteForm.expiresInDays}
                  onChange={(e) => setInviteForm(prev => ({ ...prev, expiresInDays: parseInt(e.target.value) }))}
                  className="w-full h-10 rounded-md border border-input bg-background px-3"
                >
                  <option value={3}>3 days</option>
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                </select>
              </div>
            </div>
          </Tabs>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreateModal(false); resetForm(); }}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateInvite}
              disabled={submitting || !inviteForm.email}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              Send Invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

