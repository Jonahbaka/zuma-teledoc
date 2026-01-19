'use client';

import { useState, useEffect } from 'react';
import {
  Link2, Copy, Plus, Trash2, RefreshCw, Clock, Users, Stethoscope, Heart,
  ExternalLink, CheckCircle, XCircle, AlertTriangle, Eye, EyeOff, Share2,
  Mail, Loader2, Calendar, Shield, Zap
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/use-toast';
import api from '@/lib/api';
import { format, formatDistanceToNow } from 'date-fns';

export default function TestingLinksPage() {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedLink, setSelectedLink] = useState(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [filterType, setFilterType] = useState('all');
  const [showActiveOnly, setShowActiveOnly] = useState(true);

  const [newLink, setNewLink] = useState({
    linkType: 'patient',
    label: '',
    description: '',
    maxUses: 10,
    expiresInHours: 72,
    bypassPayment: true,
    bypassSubscription: true,
    grantTier: 'gold'
  });

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  useEffect(() => {
    fetchLinks();
  }, [filterType, showActiveOnly]);

  const fetchLinks = async () => {
    try {
      setLoading(true);
      const params = {};
      if (filterType !== 'all') params.type = filterType;
      if (showActiveOnly) params.active_only = 'true';
      
      const res = await api.get('/testing-links', { params });
      if (res.data.success) {
        setLinks(res.data.links);
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to fetch testing links',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const createLink = async () => {
    try {
      setCreating(true);
      const res = await api.post('/testing-links', newLink);
      if (res.data.success) {
        toast({
          title: 'Link Created!',
          description: 'Testing access link has been generated',
        });
        setShowCreateDialog(false);
        setNewLink({
          linkType: 'patient',
          label: '',
          description: '',
          maxUses: 10,
          expiresInHours: 72,
          bypassPayment: true,
          bypassSubscription: true,
          grantTier: 'gold'
        });
        fetchLinks();
        
        // Auto-copy the link
        navigator.clipboard.writeText(res.data.link.fullUrl);
        toast({
          title: 'Link Copied!',
          description: 'The access link has been copied to clipboard',
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to create link',
        variant: 'destructive'
      });
    } finally {
      setCreating(false);
    }
  };

  const deleteLink = async (linkId) => {
    if (!confirm('Are you sure you want to delete this testing link?')) return;
    
    try {
      await api.delete(`/testing-links/${linkId}`);
      toast({ title: 'Link Deleted' });
      fetchLinks();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to delete link',
        variant: 'destructive'
      });
    }
  };

  const toggleLinkActive = async (link) => {
    try {
      await api.patch(`/testing-links/${link.id}`, { isActive: !link.is_active });
      toast({ title: link.is_active ? 'Link Deactivated' : 'Link Activated' });
      fetchLinks();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update link',
        variant: 'destructive'
      });
    }
  };

  const extendLink = async (link, hours) => {
    try {
      await api.patch(`/testing-links/${link.id}`, { extendHours: hours });
      toast({ title: `Link extended by ${hours} hours` });
      fetchLinks();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to extend link',
        variant: 'destructive'
      });
    }
  };

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied!', description: `${label} copied to clipboard` });
  };

  const viewDetails = async (link) => {
    try {
      const res = await api.get(`/testing-links/${link.id}`);
      if (res.data.success) {
        setSelectedLink(res.data);
        setShowDetailsDialog(true);
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to fetch link details',
        variant: 'destructive'
      });
    }
  };

  const getLinkStatus = (link) => {
    if (!link.is_active) return { label: 'Inactive', color: 'bg-slate-100 text-slate-600' };
    if (link.isExpired) return { label: 'Expired', color: 'bg-red-100 text-red-600' };
    if (link.isExhausted) return { label: 'Exhausted', color: 'bg-orange-100 text-orange-600' };
    return { label: 'Active', color: 'bg-green-100 text-green-600' };
  };

  const stats = {
    total: links.length,
    active: links.filter(l => l.is_active && !l.isExpired && !l.isExhausted).length,
    provider: links.filter(l => l.link_type === 'provider').length,
    patient: links.filter(l => l.link_type === 'patient').length,
    totalActivations: links.reduce((sum, l) => sum + (l.activation_count || 0), 0)
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl">
              <Zap className="w-6 h-6 text-white" />
            </div>
            Testing Access Links
          </h1>
          <p className="text-muted-foreground mt-1">
            Generate time-limited links for demos that bypass payment requirements
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={fetchLinks} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700">
                <Plus className="w-4 h-4 mr-2" />
                Create Testing Link
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Create Testing Access Link</DialogTitle>
                <DialogDescription>
                  Generate a link that allows users to bypass payment for testing
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Link Type</Label>
                  <Select value={newLink.linkType} onValueChange={(v) => setNewLink({ ...newLink, linkType: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="patient">
                        <div className="flex items-center gap-2">
                          <Heart className="w-4 h-4 text-pink-500" />
                          Patient
                        </div>
                      </SelectItem>
                      <SelectItem value="provider">
                        <div className="flex items-center gap-2">
                          <Stethoscope className="w-4 h-4 text-blue-500" />
                          Provider
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Label (for your reference)</Label>
                  <Input
                    placeholder="e.g., Demo for Client ABC"
                    value={newLink.label}
                    onChange={(e) => setNewLink({ ...newLink, label: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Description (optional)</Label>
                  <Textarea
                    placeholder="Notes about this testing link..."
                    value={newLink.description}
                    onChange={(e) => setNewLink({ ...newLink, description: e.target.value })}
                    rows={2}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Max Uses</Label>
                    <Input
                      type="number"
                      min="1"
                      value={newLink.maxUses}
                      onChange={(e) => setNewLink({ ...newLink, maxUses: parseInt(e.target.value) || 1 })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Expires In (hours)</Label>
                    <Select 
                      value={String(newLink.expiresInHours)} 
                      onValueChange={(v) => setNewLink({ ...newLink, expiresInHours: parseInt(v) })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="24">24 hours (1 day)</SelectItem>
                        <SelectItem value="72">72 hours (3 days)</SelectItem>
                        <SelectItem value="168">168 hours (1 week)</SelectItem>
                        <SelectItem value="336">336 hours (2 weeks)</SelectItem>
                        <SelectItem value="720">720 hours (30 days)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Grant Tier</Label>
                  <Select value={newLink.grantTier} onValueChange={(v) => setNewLink({ ...newLink, grantTier: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="basic">Basic</SelectItem>
                      <SelectItem value="gold">Gold (Recommended)</SelectItem>
                      <SelectItem value="platinum">Platinum</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-3 p-3 bg-muted rounded-lg">
                  <div className="flex items-center justify-between">
                    <Label className="cursor-pointer">Bypass Payment</Label>
                    <Switch
                      checked={newLink.bypassPayment}
                      onCheckedChange={(v) => setNewLink({ ...newLink, bypassPayment: v })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="cursor-pointer">Bypass Subscription Check</Label>
                    <Switch
                      checked={newLink.bypassSubscription}
                      onCheckedChange={(v) => setNewLink({ ...newLink, bypassSubscription: v })}
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={createLink} disabled={creating}>
                  {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                  Create Link
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Warning Banner */}
      <Card className="border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
            <div>
              <h3 className="font-semibold text-amber-900 dark:text-amber-200">Testing Links Security</h3>
              <ul className="text-sm text-amber-800 dark:text-amber-300 mt-2 space-y-1">
                <li>• These links bypass payment and subscription requirements</li>
                <li>• Only share with trusted parties for demo/testing purposes</li>
                <li>• Set appropriate expiration times and usage limits</li>
                <li>• Monitor link activations and revoke if misused</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Links</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
              <Link2 className="w-8 h-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active</p>
                <p className="text-2xl font-bold text-green-600">{stats.active}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Provider Links</p>
                <p className="text-2xl font-bold text-blue-600">{stats.provider}</p>
              </div>
              <Stethoscope className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Patient Links</p>
                <p className="text-2xl font-bold text-pink-600">{stats.patient}</p>
              </div>
              <Heart className="w-8 h-8 text-pink-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Activations</p>
                <p className="text-2xl font-bold text-purple-600">{stats.totalActivations}</p>
              </div>
              <Users className="w-8 h-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Label>Type:</Label>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="provider">Providers</SelectItem>
                  <SelectItem value="patient">Patients</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={showActiveOnly} onCheckedChange={setShowActiveOnly} id="active-only" />
              <Label htmlFor="active-only" className="cursor-pointer">Active only</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Links Table */}
      <Card>
        <CardHeader>
          <CardTitle>Testing Links</CardTitle>
          <CardDescription>
            Manage your testing access links
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : links.length === 0 ? (
            <div className="text-center py-12">
              <Link2 className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold">No Testing Links</h3>
              <p className="text-muted-foreground mt-1">Create your first testing link to get started</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Uses</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {links.map((link) => {
                  const status = getLinkStatus(link);
                  return (
                    <TableRow key={link.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {link.link_type === 'provider' ? (
                            <Stethoscope className="w-4 h-4 text-blue-500" />
                          ) : (
                            <Heart className="w-4 h-4 text-pink-500" />
                          )}
                          <span className="capitalize">{link.link_type}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{link.label || 'Unnamed'}</p>
                          {link.description && (
                            <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                              {link.description}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={status.color}>{status.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-sm">
                          {link.current_uses}/{link.max_uses || '∞'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">{link.grant_tier}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {link.isExpired ? (
                            <span className="text-red-600">Expired</span>
                          ) : (
                            <span title={format(new Date(link.expires_at), 'PPpp')}>
                              {formatDistanceToNow(new Date(link.expires_at), { addSuffix: true })}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => copyToClipboard(link.fullUrl, 'Link')}
                            title="Copy link"
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => viewDetails(link)}
                            title="View details"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => toggleLinkActive(link)}
                            title={link.is_active ? 'Deactivate' : 'Activate'}
                          >
                            {link.is_active ? <XCircle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteLink(link.id)}
                            className="text-red-600 hover:text-red-700"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Link Details Dialog */}
      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Testing Link Details</DialogTitle>
          </DialogHeader>
          {selectedLink && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Type</Label>
                  <p className="font-medium capitalize flex items-center gap-2 mt-1">
                    {selectedLink.link.link_type === 'provider' ? (
                      <Stethoscope className="w-4 h-4 text-blue-500" />
                    ) : (
                      <Heart className="w-4 h-4 text-pink-500" />
                    )}
                    {selectedLink.link.link_type}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Status</Label>
                  <p className="mt-1">
                    <Badge className={getLinkStatus(selectedLink.link).color}>
                      {getLinkStatus(selectedLink.link).label}
                    </Badge>
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Grant Tier</Label>
                  <p className="font-medium capitalize mt-1">{selectedLink.link.grant_tier}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Uses</Label>
                  <p className="font-mono mt-1">
                    {selectedLink.link.current_uses} / {selectedLink.link.max_uses || '∞'}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">Access URL</Label>
                <div className="flex items-center gap-2">
                  <Input value={selectedLink.link.fullUrl} readOnly className="font-mono text-sm" />
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => copyToClipboard(selectedLink.link.fullUrl, 'Access URL')}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Login URL</Label>
                  <div className="flex items-center gap-2">
                    <Input value={selectedLink.link.loginUrl} readOnly className="font-mono text-xs" />
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => copyToClipboard(selectedLink.link.loginUrl, 'Login URL')}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Register URL</Label>
                  <div className="flex items-center gap-2">
                    <Input value={selectedLink.link.registerUrl} readOnly className="font-mono text-xs" />
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => copyToClipboard(selectedLink.link.registerUrl, 'Register URL')}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => extendLink(selectedLink.link, 24)}
                  disabled={!selectedLink.link.is_active}
                >
                  <Clock className="w-4 h-4 mr-2" />
                  Extend 24h
                </Button>
                <Button
                  variant="outline"
                  onClick={() => extendLink(selectedLink.link, 72)}
                  disabled={!selectedLink.link.is_active}
                >
                  <Clock className="w-4 h-4 mr-2" />
                  Extend 3 days
                </Button>
              </div>

              {selectedLink.activations && selectedLink.activations.length > 0 && (
                <div>
                  <Label className="text-muted-foreground">Activations ({selectedLink.activations.length})</Label>
                  <div className="mt-2 space-y-2 max-h-[200px] overflow-y-auto">
                    {selectedLink.activations.map((activation) => (
                      <div key={activation.id} className="flex items-center justify-between p-2 bg-muted rounded-lg">
                        <div>
                          <p className="font-medium">{activation.email}</p>
                          <p className="text-xs text-muted-foreground">
                            {activation.first_name} {activation.last_name} ({activation.role})
                          </p>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(activation.activated_at), 'MMM d, yyyy h:mm a')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
