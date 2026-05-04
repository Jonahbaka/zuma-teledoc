'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Link2, Copy, Plus, Trash2, RefreshCw, Clock, Users, Stethoscope, Heart, Building2,
  CheckCircle, XCircle, AlertTriangle, Eye, Loader2, Zap, UserPlus, KeyRound
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import api, { adminAPI } from '@/lib/api';
import { format, formatDistanceToNow } from 'date-fns';

const DEFAULT_TEST_ACCOUNT = {
  role: 'provider',
  firstName: '',
  lastName: '',
  email: '',
  temporaryPassword: '',
  specialty: '',
  pharmacyBusinessName: '',
  branchLocation: '',
  phone: '',
  whatsappBusinessNumber: '',
  pcnLicenseNumber: '',
  preferredPrescriptionReceivingMethod: 'dashboard',
  country: 'USA',
  forcePasswordChange: true,
  bypassCredentialing: true,
  activateTestingBypass: true,
  testingBypassTier: 'gold',
  testingBypassDays: 30
};

export default function TestingLinksPage() {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showCreateAccountDialog, setShowCreateAccountDialog] = useState(false);
  const [selectedLink, setSelectedLink] = useState(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [filterType, setFilterType] = useState('all');
  const [showActiveOnly, setShowActiveOnly] = useState(true);
  const [newAccount, setNewAccount] = useState(DEFAULT_TEST_ACCOUNT);
  const [testAccounts, setTestAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountPagination, setAccountPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [accountFilters, setAccountFilters] = useState({
    query: '',
    role: 'all',
    market: 'all',
  });

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

  const fetchLinks = useCallback(async () => {
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
  }, [filterType, showActiveOnly]);

  const fetchTestAccounts = useCallback(async () => {
    try {
      setAccountsLoading(true);
      const params = {
        page: accountPagination.page,
        limit: 12,
        isTestAccount: true,
        sortBy: 'created_at',
        sortOrder: 'desc',
      };
      if (accountFilters.query.trim()) params.query = accountFilters.query.trim();
      if (accountFilters.role !== 'all') params.role = accountFilters.role;
      if (accountFilters.market !== 'all') params.market = accountFilters.market;

      const res = await adminAPI.getUsers(params);
      if (res.data.success) {
        setTestAccounts(res.data.users || []);
        setAccountPagination((current) => ({
          ...current,
          total: res.data.pagination?.total || 0,
          totalPages: res.data.pagination?.totalPages || 1,
        }));
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to fetch test accounts',
        variant: 'destructive'
      });
    } finally {
      setAccountsLoading(false);
    }
  }, [accountFilters.market, accountFilters.query, accountFilters.role, accountPagination.page]);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  useEffect(() => {
    fetchTestAccounts();
  }, [fetchTestAccounts]);

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

  const createTestAccount = async () => {
    try {
      setCreatingAccount(true);
      const res = await adminAPI.createTestAccount(newAccount);

      if (res.data.success) {
        toast({
          title: `${newAccount.role.charAt(0).toUpperCase() + newAccount.role.slice(1)} Test Account Created`,
          description: `${res.data.user?.email || 'The account'} was saved and will require a new password on first login`,
        });
        setShowCreateAccountDialog(false);
        setNewAccount({ ...DEFAULT_TEST_ACCOUNT });
        setAccountPagination((current) => ({ ...current, page: 1 }));
        fetchTestAccounts();
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to create test account',
        variant: 'destructive'
      });
    } finally {
      setCreatingAccount(false);
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

  const refreshAll = () => {
    fetchLinks();
    fetchTestAccounts();
  };

  const updateAccountFilter = (key, value) => {
    setAccountFilters((current) => ({ ...current, [key]: value }));
    setAccountPagination((current) => ({ ...current, page: 1 }));
  };

  const marketLabel = (account) => {
    const scope = String(account.marketScope || account.market_scope || '').toUpperCase();
    const country = String(account.country || '').toLowerCase();
    if (scope === 'NG' || country === 'ng' || country === 'nigeria') return 'Nigeria';
    if (scope === 'US' || country === 'us' || country === 'usa') return 'US';
    return 'Unassigned';
  };

  const roleLabel = (role) => String(role || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

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
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl">
              <Zap className="w-6 h-6 text-white" />
            </div>
            Testing Access
          </h1>
          <p className="text-muted-foreground mt-1">
            Create controlled test access for patient, provider, and pharmacy QA workflows
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={refreshAll} disabled={loading || accountsLoading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Dialog
            open={showCreateAccountDialog}
            onOpenChange={(open) => {
              setShowCreateAccountDialog(open);
              if (!open) {
                setNewAccount({ ...DEFAULT_TEST_ACCOUNT });
              }
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline">
                <UserPlus className="w-4 h-4 mr-2" />
                Create Test Account
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create Test Account</DialogTitle>
                <DialogDescription>
                  Super-admin tool for QA accounts with first-login password creation.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Account Type</Label>
                    <Select
                      value={newAccount.role}
                      onValueChange={(role) => setNewAccount({
                        ...newAccount,
                        role,
                        specialty: role === 'provider' ? newAccount.specialty : '',
                        activateTestingBypass: role === 'pharmacy' ? false : newAccount.activateTestingBypass,
                      })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="patient">
                          <span className="inline-flex items-center gap-2"><Heart className="h-4 w-4" /> Patient</span>
                        </SelectItem>
                        <SelectItem value="provider">
                          <span className="inline-flex items-center gap-2"><Stethoscope className="h-4 w-4" /> Provider</span>
                        </SelectItem>
                        <SelectItem value="pharmacy">
                          <span className="inline-flex items-center gap-2"><Building2 className="h-4 w-4" /> Pharmacy</span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Operations Region</Label>
                    <Select
                      value={newAccount.country}
                      onValueChange={(country) => setNewAccount({ ...newAccount, country })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USA">United States</SelectItem>
                        <SelectItem value="Nigeria">Nigeria</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>First Name</Label>
                    <Input
                      autoComplete="off"
                      value={newAccount.firstName}
                      onChange={(e) => setNewAccount({ ...newAccount, firstName: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Last Name</Label>
                    <Input
                      autoComplete="off"
                      value={newAccount.lastName}
                      onChange={(e) => setNewAccount({ ...newAccount, lastName: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    autoComplete="off"
                    value={newAccount.email}
                    onChange={(e) => setNewAccount({ ...newAccount, email: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Temporary Password</Label>
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      type="password"
                      autoComplete="new-password"
                      value={newAccount.temporaryPassword}
                      onChange={(e) => setNewAccount({ ...newAccount, temporaryPassword: e.target.value })}
                    />
                  </div>
                </div>

                {newAccount.role === 'provider' && (
                  <div className="space-y-2">
                    <Label>Provider Specialty</Label>
                    <Input
                      placeholder="e.g., Family Medicine"
                      autoComplete="off"
                      value={newAccount.specialty}
                      onChange={(e) => setNewAccount({ ...newAccount, specialty: e.target.value })}
                    />
                  </div>
                )}

                {newAccount.role === 'pharmacy' && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Pharmacy Business Name</Label>
                      <Input
                        autoComplete="off"
                        value={newAccount.pharmacyBusinessName}
                        onChange={(e) => setNewAccount({ ...newAccount, pharmacyBusinessName: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Branch / Location</Label>
                      <Input
                        autoComplete="off"
                        placeholder="e.g., Wuse 2, Abuja"
                        value={newAccount.branchLocation}
                        onChange={(e) => setNewAccount({ ...newAccount, branchLocation: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>PCN License / Registration</Label>
                      <Input
                        autoComplete="off"
                        value={newAccount.pcnLicenseNumber}
                        onChange={(e) => setNewAccount({ ...newAccount, pcnLicenseNumber: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Phone Number</Label>
                      <Input
                        autoComplete="off"
                        value={newAccount.phone}
                        onChange={(e) => setNewAccount({ ...newAccount, phone: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>WhatsApp Business Number</Label>
                      <Input
                        autoComplete="off"
                        value={newAccount.whatsappBusinessNumber}
                        onChange={(e) => setNewAccount({ ...newAccount, whatsappBusinessNumber: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Prescription Receiving Method</Label>
                      <Select
                        value={newAccount.preferredPrescriptionReceivingMethod}
                        onValueChange={(preferredPrescriptionReceivingMethod) => setNewAccount({ ...newAccount, preferredPrescriptionReceivingMethod })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="dashboard">Dashboard only</SelectItem>
                          <SelectItem value="whatsapp">WhatsApp only</SelectItem>
                          <SelectItem value="dashboard_whatsapp">Dashboard + WhatsApp</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                <div className="rounded-lg border bg-muted/40 p-3 space-y-3">
                  {newAccount.role === 'provider' && (
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <Label htmlFor="bypass-credentialing" className="cursor-pointer">Bypass Provider Credentialing</Label>
                        <p className="text-xs text-muted-foreground">
                          {newAccount.bypassCredentialing ? 'Provider status will be approved on creation.' : 'Provider status will remain pending.'}
                        </p>
                      </div>
                      <Switch
                        id="bypass-credentialing"
                        checked={newAccount.bypassCredentialing}
                        onCheckedChange={(bypassCredentialing) => setNewAccount({ ...newAccount, bypassCredentialing })}
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <Label className="cursor-default">Require New Password</Label>
                      <p className="text-xs text-muted-foreground">Blocks protected portal access until changed.</p>
                    </div>
                    <Badge className="bg-green-100 text-green-700 hover:bg-green-100">On</Badge>
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <Label htmlFor="account-testing-bypass" className="cursor-pointer">Testing Access</Label>
                      <p className="text-xs text-muted-foreground">Grants temporary subscription/payment bypass.</p>
                    </div>
                    <Switch
                      id="account-testing-bypass"
                      checked={newAccount.activateTestingBypass}
                      onCheckedChange={(activateTestingBypass) => setNewAccount({ ...newAccount, activateTestingBypass })}
                    />
                  </div>
                </div>

                {newAccount.activateTestingBypass && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Testing Tier</Label>
                      <Select
                        value={newAccount.testingBypassTier}
                        onValueChange={(testingBypassTier) => setNewAccount({ ...newAccount, testingBypassTier })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="basic">Basic</SelectItem>
                          <SelectItem value="gold">Gold</SelectItem>
                          <SelectItem value="platinum">Platinum</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Testing Access Days</Label>
                      <Input
                        type="number"
                        min="1"
                        max="365"
                        value={newAccount.testingBypassDays}
                        onChange={(e) => setNewAccount({
                          ...newAccount,
                          testingBypassDays: parseInt(e.target.value, 10) || 1
                        })}
                      />
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreateAccountDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={createTestAccount} disabled={creatingAccount}>
                  {creatingAccount ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}
                  Create Account
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
              <h3 className="font-semibold text-amber-900 dark:text-amber-200">Testing Access Security</h3>
              <ul className="text-sm text-amber-800 dark:text-amber-300 mt-2 space-y-1">
                <li>- Testing links bypass payment and subscription requirements</li>
                <li>- Patient, provider, and pharmacy test accounts can be created for US or Nigeria</li>
                <li>- Temporary passwords must be changed on first login</li>
                <li>- Monitor and revoke testing access when it is no longer needed</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Created Test Accounts */}
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-emerald-600" />
                Created Test Accounts
              </CardTitle>
              <CardDescription>
                Real users saved with isTestAccount=true. Use filters to verify patient, provider, and pharmacy accounts across US and Nigeria.
              </CardDescription>
            </div>
            <Badge variant="outline" className="w-fit text-sm">
              {accountPagination.total || 0} visible test accounts
            </Badge>
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
            <Input
              value={accountFilters.query}
              onChange={(event) => updateAccountFilter('query', event.target.value)}
              placeholder="Search test accounts by name, email, or phone"
            />
            <Select value={accountFilters.role} onValueChange={(value) => updateAccountFilter('role', value)}>
              <SelectTrigger className="md:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                <SelectItem value="patient">Patients</SelectItem>
                <SelectItem value="provider">Providers</SelectItem>
                <SelectItem value="pharmacy">Pharmacies</SelectItem>
              </SelectContent>
            </Select>
            <Select value={accountFilters.market} onValueChange={(value) => updateAccountFilter('market', value)}>
              <SelectTrigger className="md:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All markets</SelectItem>
                <SelectItem value="US">US</SelectItem>
                <SelectItem value="NG">Nigeria</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={fetchTestAccounts} disabled={accountsLoading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${accountsLoading ? 'animate-spin' : ''}`} />
              Reload
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {accountsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((item) => (
                <div key={item} className="h-14 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          ) : testAccounts.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center">
              <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <h3 className="font-semibold">No test accounts match these filters</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Clear role, market, or search filters. Newly created accounts appear here after the backend confirms they were saved.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Market</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>First Login</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {testAccounts.map((account) => (
                    <TableRow key={account.id}>
                      <TableCell>
                        <div className="font-medium">{account.firstName} {account.lastName}</div>
                        <div className="text-xs text-muted-foreground">{account.email}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{roleLabel(account.role)}</Badge>
                        {account.providerStatus && (
                          <Badge className="ml-2 bg-blue-100 text-blue-700 hover:bg-blue-100">
                            {account.providerStatus}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{marketLabel(account)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge className={account.isActive ? 'bg-green-100 text-green-700 hover:bg-green-100' : 'bg-red-100 text-red-700 hover:bg-red-100'}>
                            {account.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                          <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Test</Badge>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {account.createdAt ? format(new Date(account.createdAt), 'MMM d, yyyy h:mm a') : 'Unknown'}
                      </TableCell>
                      <TableCell>
                        {account.mustChangePassword ? (
                          <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Password change required</Badge>
                        ) : (
                          <Badge variant="outline">Password already changed</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {accountPagination.totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Page {accountPagination.page} of {accountPagination.totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={accountPagination.page <= 1}
                      onClick={() => setAccountPagination((current) => ({ ...current, page: current.page - 1 }))}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={accountPagination.page >= accountPagination.totalPages}
                      onClick={() => setAccountPagination((current) => ({ ...current, page: current.page + 1 }))}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
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
