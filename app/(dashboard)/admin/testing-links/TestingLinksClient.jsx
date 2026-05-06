'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Link2, Copy, Plus, Trash2, RefreshCw, Clock, Users, Stethoscope, Heart,
  CheckCircle, XCircle, AlertTriangle, Eye, Loader2, Zap, UserPlus, KeyRound,
  Building2, ExternalLink
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
import api from '@/lib/api';
import { format, formatDistanceToNow } from 'date-fns';

const MARKET_CONFIG = {
  US: {
    scope: 'US',
    country: 'USA',
    title: 'Testing Access',
    description: 'Create controlled test access for US patient, provider, and pharmacy QA workflows',
    accountTitle: 'Create Test Account',
    accountDescription: 'Super-admin tool for US-scoped QA accounts with first-login password creation.',
    linkDescription: 'Generate a US access link that allows users to bypass payment for testing',
    stateLabel: 'State',
    cityLabel: 'City',
    phonePlaceholder: '+12025550123',
    specialtyPlaceholder: 'e.g., Family Medicine',
    warningTitle: 'Testing Access Security',
    createButtonClass: 'bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700',
  },
  NG: {
    scope: 'NG',
    country: 'Nigeria',
    title: 'Nigeria Testing Access',
    description: 'Create Nigeria-scoped test accounts and access links for providers, patients, and pharmacy workflows',
    accountTitle: 'Create Nigeria Test Account',
    accountDescription: 'Super-admin tool for NG-scoped QA accounts. Accounts route into the Nigeria portal by default.',
    linkDescription: 'Generate a Nigeria access link that routes users through /ng login and onboarding paths',
    stateLabel: 'State / FCT',
    cityLabel: 'LGA',
    phonePlaceholder: '+2348012345678',
    specialtyPlaceholder: 'e.g., Family Medicine, General Practice',
    warningTitle: 'Nigeria Testing Access Security',
    createButtonClass: 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700',
  },
};

function getDefaultTestAccount(market = 'US') {
  const config = MARKET_CONFIG[market] || MARKET_CONFIG.US;

  return {
    role: 'provider',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    temporaryPassword: '',
    specialty: '',
    businessName: '',
    contactPerson: '',
    whatsappNumber: '',
    branchLocation: '',
    licenseNumber: '',
    preferredPrescriptionReceivingMethod: 'dashboard_plus_whatsapp',
    state: market === 'NG' ? 'FCT' : '',
    lga: '',
    facilityType: market === 'NG' ? 'clinic' : '',
    country: config.country,
    marketScope: config.scope,
    forcePasswordChange: true,
    bypassCredentialing: true,
    activateTestingBypass: true,
    testingBypassTier: 'gold',
    testingBypassDays: 30
  };
}

function getDefaultTestingLink(market = 'US') {
  return {
    linkType: 'patient',
    label: '',
    description: '',
    maxUses: 10,
    expiresInHours: 72,
    bypassPayment: true,
    bypassSubscription: true,
    grantTier: 'gold',
    marketScope: market
  };
}

export default function TestingLinksPage({ market = 'US' }) {
  const normalizedMarket = market === 'NG' ? 'NG' : 'US';
  const marketConfig = MARKET_CONFIG[normalizedMarket];
  const [links, setLinks] = useState([]);
  const [testAccounts, setTestAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showCreateAccountDialog, setShowCreateAccountDialog] = useState(false);
  const [selectedLink, setSelectedLink] = useState(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [filterType, setFilterType] = useState('all');
  const [linkStatusFilter, setLinkStatusFilter] = useState('all');
  const [showActiveOnly, setShowActiveOnly] = useState(false);
  const [showDeletedLinks, setShowDeletedLinks] = useState(false);
  const [linkSearch, setLinkSearch] = useState('');
  const [linkCreatedBy, setLinkCreatedBy] = useState('');
  const [linkCreatedFrom, setLinkCreatedFrom] = useState('');
  const [linkCreatedTo, setLinkCreatedTo] = useState('');
  const [accountRoleFilter, setAccountRoleFilter] = useState('all');
  const [accountStatusFilter, setAccountStatusFilter] = useState('all');
  const [accountSearch, setAccountSearch] = useState('');
  const [accountCreatedBy, setAccountCreatedBy] = useState('');
  const [accountCreatedFrom, setAccountCreatedFrom] = useState('');
  const [accountCreatedTo, setAccountCreatedTo] = useState('');
  const [showDeletedAccounts, setShowDeletedAccounts] = useState(false);
  const [newAccount, setNewAccount] = useState(() => getDefaultTestAccount(normalizedMarket));

  const [newLink, setNewLink] = useState(() => getDefaultTestingLink(normalizedMarket));

  const fetchLinks = useCallback(async () => {
    try {
      setLoading(true);
      const params = { marketScope: normalizedMarket, limit: 100 };
      if (filterType !== 'all') params.type = filterType;
      if (linkStatusFilter !== 'all') params.status = linkStatusFilter;
      if (showActiveOnly) params.active_only = 'true';
      if (showDeletedLinks) params.includeDeleted = 'true';
      if (linkSearch.trim()) params.query = linkSearch.trim();
      if (linkCreatedBy.trim()) params.createdBy = linkCreatedBy.trim();
      if (linkCreatedFrom) params.createdFrom = linkCreatedFrom;
      if (linkCreatedTo) params.createdTo = linkCreatedTo;
      
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
  }, [filterType, linkCreatedBy, linkCreatedFrom, linkCreatedTo, linkSearch, linkStatusFilter, normalizedMarket, showActiveOnly, showDeletedLinks]);

  const fetchTestAccounts = useCallback(async () => {
    try {
      setAccountsLoading(true);
      const endpoint = normalizedMarket === 'NG' ? '/ng/admin/test-accounts' : '/admin/test-accounts';
      const params = { limit: 100 };
      if (accountRoleFilter !== 'all') params.role = accountRoleFilter;
      if (accountStatusFilter !== 'all') params.status = accountStatusFilter;
      if (accountSearch.trim()) params.query = accountSearch.trim();
      if (accountCreatedBy.trim()) params.createdBy = accountCreatedBy.trim();
      if (accountCreatedFrom) params.createdFrom = accountCreatedFrom;
      if (accountCreatedTo) params.createdTo = accountCreatedTo;
      if (showDeletedAccounts) params.includeDeleted = 'true';

      const res = await api.get(endpoint, { params });
      if (res.data.success) {
        setTestAccounts(res.data.accounts || []);
      } else {
        throw new Error(res.data.error || 'Failed to fetch test accounts');
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || error.message || 'Failed to fetch test accounts',
        variant: 'destructive'
      });
    } finally {
      setAccountsLoading(false);
    }
  }, [accountCreatedBy, accountCreatedFrom, accountCreatedTo, accountRoleFilter, accountSearch, accountStatusFilter, normalizedMarket, showDeletedAccounts]);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  useEffect(() => {
    fetchTestAccounts();
  }, [fetchTestAccounts]);

  useEffect(() => {
    setNewAccount(getDefaultTestAccount(normalizedMarket));
    setNewLink(getDefaultTestingLink(normalizedMarket));
  }, [normalizedMarket]);

  const refreshAll = () => {
    fetchLinks();
    fetchTestAccounts();
  };

  const createLink = async () => {
    try {
      setCreating(true);
      const res = await api.post('/testing-links', { ...newLink, marketScope: normalizedMarket });
      if (res.data.success) {
        toast({
          title: 'Link Created!',
          description: 'Testing access link has been generated',
        });
        setShowCreateDialog(false);
        setNewLink(getDefaultTestingLink(normalizedMarket));
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
      const endpoint = normalizedMarket === 'NG' ? '/ng/admin/test-accounts' : '/admin/test-accounts';
      const res = await api.post(endpoint, { ...newAccount, marketScope: normalizedMarket, country: marketConfig.country });

      if (!res.data.success) {
        throw new Error(res.data.error || 'Failed to create test account');
      }

      toast({
        title: `${marketConfig.country} Test Account Created`,
        description: `${res.data.user?.role || 'Account'} will route to ${normalizedMarket === 'NG' ? 'the Nigeria' : 'the US'} portal.`,
      });
      await fetchTestAccounts();
      setShowCreateAccountDialog(false);
      setNewAccount(getDefaultTestAccount(normalizedMarket));
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
    if (!confirm('Delete this testing link? This is a soft delete: the record is retained for audit but hidden from the default list and the link will no longer work.')) return;
    
    try {
      await api.delete(`/testing-links/${linkId}`, { params: { marketScope: normalizedMarket } });
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

  const revokeLink = async (link) => {
    if (!confirm('Revoke this testing link? The access URL will stop working immediately.')) return;

    try {
      await api.patch(`/testing-links/${link.id}`, { action: 'revoke', marketScope: normalizedMarket });
      toast({ title: 'Access Revoked', description: 'The test access link can no longer be used.' });
      fetchLinks();
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to revoke link',
        variant: 'destructive'
      });
    }
  };

  const revokeTestAccount = async (account) => {
    if (!confirm('Revoke this test account? The account will be deactivated and testing bypass will be removed.')) return;

    try {
      const endpoint = normalizedMarket === 'NG' ? `/ng/admin/test-accounts/${account.id}` : `/admin/test-accounts/${account.id}`;
      await api.patch(endpoint, { action: 'revoke' });
      toast({ title: 'Test Account Revoked', description: `${account.email} can no longer access testing tools.` });
      fetchTestAccounts();
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to revoke test account',
        variant: 'destructive'
      });
    }
  };

  const deleteTestAccount = async (account) => {
    if (!confirm('Delete this test account record? This is a soft delete for audit history and removes it from the default list.')) return;

    try {
      const endpoint = normalizedMarket === 'NG' ? `/ng/admin/test-accounts/${account.id}` : `/admin/test-accounts/${account.id}`;
      await api.delete(endpoint);
      toast({ title: 'Test Account Deleted', description: 'The record is hidden from the default list.' });
      fetchTestAccounts();
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to delete test account',
        variant: 'destructive'
      });
    }
  };

  const extendLink = async (link, hours) => {
    try {
      await api.patch(`/testing-links/${link.id}`, { extendHours: hours, marketScope: normalizedMarket });
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

  const openAccessUrl = (url) => {
    if (!url) {
      toast({ title: 'Error', description: 'No access URL is available for this record', variant: 'destructive' });
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const viewDetails = async (link) => {
    try {
      const res = await api.get(`/testing-links/${link.id}`, { params: { marketScope: normalizedMarket } });
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
    if (link.status === 'deleted' || link.deleted_at || link.isDeleted) return { label: 'Deleted', color: 'bg-slate-100 text-slate-600 hover:bg-slate-100' };
    if (link.status === 'revoked' || link.revoked_at || link.isRevoked || !link.is_active) return { label: 'Revoked', color: 'bg-red-100 text-red-700 hover:bg-red-100' };
    if (link.isExpired) return { label: 'Expired', color: 'bg-red-100 text-red-600' };
    if (link.isExhausted || link.status === 'used') return { label: 'Used', color: 'bg-orange-100 text-orange-600' };
    return { label: 'Active', color: 'bg-green-100 text-green-600' };
  };

  const getRoleIcon = (role) => {
    if (role === 'provider') return <Stethoscope className="w-4 h-4 text-blue-500" />;
    if (role === 'patient') return <Heart className="w-4 h-4 text-pink-500" />;
    return <Building2 className="w-4 h-4 text-emerald-600" />;
  };

  const getAccountStatus = (account) => {
    if (account.status === 'deleted' || account.deletedAt) return { label: 'Deleted', color: 'bg-slate-100 text-slate-600 hover:bg-slate-100' };
    if (account.status === 'revoked' || account.revokedAt || !account.isActive) return { label: 'Revoked', color: 'bg-red-100 text-red-700 hover:bg-red-100' };
    if (account.mustChangePassword) return { label: 'Password change required', color: 'bg-amber-100 text-amber-800 hover:bg-amber-100' };
    if (account.providerStatus === 'pending') return { label: 'Pending', color: 'bg-orange-100 text-orange-700 hover:bg-orange-100' };
    return { label: 'Active', color: 'bg-green-100 text-green-700 hover:bg-green-100' };
  };

  const stats = {
    total: links.length,
    active: links.filter(l => l.is_active && !l.isExpired && !l.isExhausted).length,
    provider: links.filter(l => l.link_type === 'provider').length,
    patient: links.filter(l => l.link_type === 'patient').length,
    totalActivations: links.reduce((sum, l) => sum + (l.activation_count || 0), 0)
  };

  const accountStats = {
    total: testAccounts.length,
    active: testAccounts.filter((account) => account.isActive).length,
    providers: testAccounts.filter((account) => account.role === 'provider').length,
    patients: testAccounts.filter((account) => account.role === 'patient').length,
    pharmacies: testAccounts.filter((account) => account.role === 'pharmacy').length,
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
            {marketConfig.title}
          </h1>
          <p className="text-muted-foreground mt-1">
            {marketConfig.description}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={refreshAll} disabled={loading || accountsLoading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading || accountsLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Dialog
            open={showCreateAccountDialog}
            onOpenChange={(open) => {
              setShowCreateAccountDialog(open);
              if (!open) {
                setNewAccount(getDefaultTestAccount(normalizedMarket));
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
                <DialogTitle>{marketConfig.accountTitle}</DialogTitle>
                <DialogDescription>
                  {marketConfig.accountDescription}
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
                        facilityType: role === 'pharmacy' ? 'pharmacy' : newAccount.facilityType
                      })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="provider">
                          <div className="flex items-center gap-2">
                            <Stethoscope className="w-4 h-4 text-blue-500" />
                            Provider
                          </div>
                        </SelectItem>
                        <SelectItem value="patient">
                          <div className="flex items-center gap-2">
                            <Heart className="w-4 h-4 text-pink-500" />
                            Patient
                          </div>
                        </SelectItem>
                        <SelectItem value="pharmacy">
                          <div className="flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-emerald-600" />
                            Pharmacy
                          </div>
                        </SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Operations Region</Label>
                    <div className="flex h-10 items-center rounded-md border bg-muted/30 px-3 text-sm font-medium">
                      {marketConfig.country}
                    </div>
                  </div>
                </div>

                {newAccount.role === 'pharmacy' ? (
                  <div className="space-y-4 rounded-lg border bg-emerald-50/50 p-4 dark:bg-emerald-950/10">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Pharmacy Business Name</Label>
                        <Input
                          autoComplete="off"
                          placeholder="e.g., Abuja Care Pharmacy"
                          value={newAccount.businessName}
                          onChange={(e) => setNewAccount({
                            ...newAccount,
                            businessName: e.target.value,
                            firstName: e.target.value
                          })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Contact Person</Label>
                        <Input
                          autoComplete="off"
                          placeholder="e.g., Operations Lead"
                          value={newAccount.contactPerson}
                          onChange={(e) => setNewAccount({
                            ...newAccount,
                            contactPerson: e.target.value,
                            lastName: e.target.value
                          })}
                        />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>WhatsApp Business Number</Label>
                        <Input
                          autoComplete="off"
                          placeholder={marketConfig.phonePlaceholder}
                          value={newAccount.whatsappNumber}
                          onChange={(e) => setNewAccount({ ...newAccount, whatsappNumber: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Branch / Location</Label>
                        <Input
                          autoComplete="off"
                          placeholder={normalizedMarket === 'NG' ? 'Wuse 2, Abuja' : 'Downtown branch'}
                          value={newAccount.branchLocation}
                          onChange={(e) => setNewAccount({ ...newAccount, branchLocation: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>License / Registration Number (optional for test)</Label>
                        <Input
                          autoComplete="off"
                          placeholder="Optional for QA test accounts"
                          value={newAccount.licenseNumber}
                          onChange={(e) => setNewAccount({ ...newAccount, licenseNumber: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Prescription Receiving Method</Label>
                        <Select
                          value={newAccount.preferredPrescriptionReceivingMethod}
                          onValueChange={(preferredPrescriptionReceivingMethod) => setNewAccount({
                            ...newAccount,
                            preferredPrescriptionReceivingMethod
                          })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="dashboard_only">Dashboard only</SelectItem>
                            <SelectItem value="whatsapp_only">WhatsApp only</SelectItem>
                            <SelectItem value="dashboard_plus_whatsapp">Dashboard + WhatsApp</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                ) : (
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
                )}

                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    autoComplete="off"
                    value={newAccount.email}
                    onChange={(e) => setNewAccount({ ...newAccount, email: e.target.value })}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Phone</Label>
                    <Input
                      autoComplete="off"
                      placeholder={marketConfig.phonePlaceholder}
                      value={newAccount.phone}
                      onChange={(e) => setNewAccount({ ...newAccount, phone: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{marketConfig.stateLabel}</Label>
                    <Input
                      autoComplete="off"
                      placeholder={normalizedMarket === 'NG' ? 'FCT' : 'CA'}
                      value={newAccount.state}
                      onChange={(e) => setNewAccount({ ...newAccount, state: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>{marketConfig.cityLabel}</Label>
                    <Input
                      autoComplete="off"
                      placeholder={normalizedMarket === 'NG' ? 'Abuja Municipal' : 'San Francisco'}
                      value={newAccount.lga}
                      onChange={(e) => setNewAccount({ ...newAccount, lga: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Facility Type</Label>
                    <Select
                      value={newAccount.facilityType || 'clinic'}
                      onValueChange={(facilityType) => setNewAccount({ ...newAccount, facilityType })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="clinic">Clinic</SelectItem>
                        <SelectItem value="hospital">Hospital</SelectItem>
                        <SelectItem value="pharmacy">Pharmacy</SelectItem>
                        <SelectItem value="solo_practice">Solo Practice</SelectItem>
                        <SelectItem value="cash_pay_virtual_care">Cash-pay Virtual Care</SelectItem>
                        <SelectItem value="nhia_hmo_ready">NHIA/HMO Compatible</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
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
                      placeholder={marketConfig.specialtyPlaceholder}
                      autoComplete="off"
                      value={newAccount.specialty}
                      onChange={(e) => setNewAccount({ ...newAccount, specialty: e.target.value })}
                    />
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
                      <p className="text-xs text-muted-foreground">Blocks protected provider access until changed.</p>
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
              <Button className={marketConfig.createButtonClass}>
                <Plus className="w-4 h-4 mr-2" />
                Create {normalizedMarket === 'NG' ? 'NG ' : ''}Testing Link
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Create {normalizedMarket === 'NG' ? 'Nigeria ' : ''}Testing Access Link</DialogTitle>
                <DialogDescription>
                  {marketConfig.linkDescription}
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
                        <SelectItem value="pharmacy">
                          <div className="flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-emerald-600" />
                            Pharmacy
                          </div>
                        </SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
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
              <h3 className="font-semibold text-amber-900 dark:text-amber-200">{marketConfig.warningTitle}</h3>
              <ul className="text-sm text-amber-800 dark:text-amber-300 mt-2 space-y-1">
                <li>- Testing links bypass payment and subscription requirements</li>
                <li>- Test accounts created here are scoped to {marketConfig.country}</li>
                <li>- Provider credentialing can be approved or left pending per account</li>
                <li>- Temporary passwords must be changed on first login</li>
                <li>- Monitor and revoke testing access when it is no longer needed</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Test Accounts */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle>Created Test Accounts</CardTitle>
              <CardDescription>
                Real patient, provider, and pharmacy test accounts created through the admin portal
              </CardDescription>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[680px] xl:grid-cols-4">
              <Input
                placeholder="Search email, name, pharmacy..."
                value={accountSearch}
                onChange={(e) => setAccountSearch(e.target.value)}
              />
              <Select value={accountRoleFilter} onValueChange={setAccountRoleFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  <SelectItem value="patient">Patients</SelectItem>
                  <SelectItem value="provider">Providers</SelectItem>
                  <SelectItem value="pharmacy">Pharmacies</SelectItem>
                  <SelectItem value="admin">Admins</SelectItem>
                </SelectContent>
              </Select>
              <Select value={accountStatusFilter} onValueChange={setAccountStatusFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="password_change_required">Password change required</SelectItem>
                  <SelectItem value="testing_access_active">Testing access active</SelectItem>
                  <SelectItem value="testing_access_expired">Testing access expired</SelectItem>
                  <SelectItem value="revoked">Revoked</SelectItem>
                  <SelectItem value="deleted">Deleted</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="Created by admin ID"
                value={accountCreatedBy}
                onChange={(e) => setAccountCreatedBy(e.target.value)}
              />
              <Input
                type="date"
                value={accountCreatedFrom}
                onChange={(e) => setAccountCreatedFrom(e.target.value)}
              />
              <Input
                type="date"
                value={accountCreatedTo}
                onChange={(e) => setAccountCreatedTo(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex items-center gap-2">
            <Switch checked={showDeletedAccounts} onCheckedChange={setShowDeletedAccounts} id="show-deleted-accounts" />
            <Label htmlFor="show-deleted-accounts" className="cursor-pointer">Show deleted account records</Label>
          </div>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Total accounts</p>
              <p className="text-xl font-semibold">{accountStats.total}</p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Active</p>
              <p className="text-xl font-semibold text-green-700">{accountStats.active}</p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Providers</p>
              <p className="text-xl font-semibold text-blue-700">{accountStats.providers}</p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Patients</p>
              <p className="text-xl font-semibold text-pink-700">{accountStats.patients}</p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Pharmacies</p>
              <p className="text-xl font-semibold text-emerald-700">{accountStats.pharmacies}</p>
            </div>
          </div>

          {accountsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : testAccounts.length === 0 ? (
            <div className="text-center py-12">
              <UserPlus className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold">No Test Accounts Found</h3>
              <p className="text-muted-foreground mt-1">
                Create patient, provider, or pharmacy test accounts and they will appear here after the backend confirms persistence.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name / Business</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Market</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created By</TableHead>
                    <TableHead>Testing Access</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Last Accessed</TableHead>
                    <TableHead>Access Link</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {testAccounts.map((account) => {
                    const accountStatus = getAccountStatus(account);
                    return (
                      <TableRow key={account.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{account.displayName || account.email}</p>
                            {account.role === 'pharmacy' && (
                              <p className="text-xs text-muted-foreground">
                                {account.branchLocation || 'Branch not set'}
                                {account.whatsappNumber ? ` - WhatsApp ${account.whatsappNumber}` : ''}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{account.email}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getRoleIcon(account.role)}
                            <span className="capitalize">{account.role}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{account.marketScope || normalizedMarket}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={accountStatus.color}>{accountStatus.label}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {account.createdByAdminId || 'Unknown'}
                        </TableCell>
                        <TableCell>
                          {account.testingBypassActive ? (
                            <div className="text-sm">
                              <Badge variant="outline" className="capitalize">
                                {account.testingBypassTier || 'enabled'}
                              </Badge>
                              {account.testingBypassExpiresAt && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Expires {formatDistanceToNow(new Date(account.testingBypassExpiresAt), { addSuffix: true })}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">Not enabled</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {account.createdAt ? format(new Date(account.createdAt), 'MMM d, yyyy') : 'Unknown'}
                        </TableCell>
                        <TableCell className="text-sm">
                          {account.lastLoginAt ? format(new Date(account.lastLoginAt), 'MMM d, yyyy') : 'Not used'}
                        </TableCell>
                        <TableCell>
                          <code className="block max-w-[180px] truncate rounded bg-muted px-2 py-1 text-xs">
                            {account.loginUrl}
                          </code>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => copyToClipboard(account.loginUrl, 'Login URL')}
                              title="Copy login URL"
                            >
                              <Copy className="mr-1 h-4 w-4" />
                              Copy Link
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openAccessUrl(account.loginUrl)}
                              title="Open login link"
                            >
                              <ExternalLink className="mr-1 h-4 w-4" />
                              Open Link
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => copyToClipboard(account.id, 'Account ID')}
                              title="Copy account ID"
                            >
                              <KeyRound className="mr-1 h-4 w-4" />
                              Copy ID
                            </Button>
                            {account.status !== 'revoked' && account.status !== 'deleted' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => revokeTestAccount(account)}
                                className="text-red-600 hover:text-red-700"
                                title="Revoke access"
                              >
                                <XCircle className="mr-1 h-4 w-4" />
                                Revoke Access
                              </Button>
                            )}
                            {account.status !== 'deleted' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => deleteTestAccount(account)}
                                className="text-red-600 hover:text-red-700"
                                title="Delete account record"
                              >
                                <Trash2 className="mr-1 h-4 w-4" />
                                Delete
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
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
          <div className="grid gap-4 lg:grid-cols-[1fr_auto_auto]">
            <Input
              placeholder="Search links by label, token, creator..."
              value={linkSearch}
              onChange={(e) => setLinkSearch(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-3">
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
                  <SelectItem value="pharmacy">Pharmacies</SelectItem>
                  <SelectItem value="admin">Admins</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label>Status:</Label>
              <Select value={linkStatusFilter} onValueChange={setLinkStatusFilter}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="used">Used</SelectItem>
                  <SelectItem value="revoked">Revoked</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="deleted">Deleted</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={showActiveOnly} onCheckedChange={setShowActiveOnly} id="active-only" />
              <Label htmlFor="active-only" className="cursor-pointer">Active only</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={showDeletedLinks} onCheckedChange={setShowDeletedLinks} id="show-deleted-links" />
              <Label htmlFor="show-deleted-links" className="cursor-pointer">Show deleted</Label>
            </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3 lg:col-span-3">
              <Input
                placeholder="Created by admin ID or email"
                value={linkCreatedBy}
                onChange={(e) => setLinkCreatedBy(e.target.value)}
              />
              <Input
                type="date"
                value={linkCreatedFrom}
                onChange={(e) => setLinkCreatedFrom(e.target.value)}
              />
              <Input
                type="date"
                value={linkCreatedTo}
                onChange={(e) => setLinkCreatedTo(e.target.value)}
              />
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
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Uses</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Created By</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead>Access Link</TableHead>
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
                          {getRoleIcon(link.link_type)}
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
                          {link.deleted_at || link.isDeleted ? (
                            <span className="text-slate-600">Deleted</span>
                          ) : link.revoked_at || link.isRevoked ? (
                            <span className="text-red-600">Revoked</span>
                          ) : link.isExpired ? (
                            <span className="text-red-600">Expired</span>
                          ) : (
                            <span title={format(new Date(link.expires_at), 'PPpp')}>
                              {formatDistanceToNow(new Date(link.expires_at), { addSuffix: true })}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div>
                          <p>{link.createdByName || link.created_by_email || 'Unknown'}</p>
                          {link.created_by && (
                            <p className="text-xs text-muted-foreground">{link.created_by}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {link.last_used_at ? (
                          <div>
                            <p>{format(new Date(link.last_used_at), 'MMM d, yyyy')}</p>
                            {link.lastUsedByName && (
                              <p className="text-xs text-muted-foreground">{link.lastUsedByName}</p>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Not used</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <code className="block max-w-[180px] truncate rounded bg-muted px-2 py-1 text-xs">
                          {link.fullUrl}
                        </code>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => copyToClipboard(link.fullUrl, 'Link')}
                            title="Copy link"
                          >
                            <Copy className="mr-1 h-4 w-4" />
                            Copy Link
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openAccessUrl(link.fullUrl)}
                            title="Open access link"
                          >
                            <ExternalLink className="mr-1 h-4 w-4" />
                            Open Link
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => viewDetails(link)}
                            title="View details"
                          >
                            <Eye className="mr-1 h-4 w-4" />
                            View Details
                          </Button>
                          {!link.isRevoked && !link.isDeleted && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => revokeLink(link)}
                              className="text-red-600 hover:text-red-700"
                              title="Revoke access"
                            >
                              <XCircle className="mr-1 h-4 w-4" />
                              Revoke Access
                            </Button>
                          )}
                          {!link.isDeleted && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => deleteLink(link.id)}
                              className="text-red-600 hover:text-red-700"
                              title="Delete"
                            >
                              <Trash2 className="mr-1 h-4 w-4" />
                              Delete
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>
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
                    {getRoleIcon(selectedLink.link.link_type)}
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
