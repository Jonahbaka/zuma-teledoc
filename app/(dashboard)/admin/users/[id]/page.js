'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Mail,
  Phone,
  Shield,
  User,
  UserCheck,
  UserX,
} from 'lucide-react';
import { adminAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';
import { formatDateTime } from '@/lib/utils';

function getRoleLabel(role) {
  const normalized = String(role || '').replace(/_/g, ' ');
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : 'Unknown';
}

function getProviderStatusTone(status) {
  const normalized = String(status || '').toLowerCase();

  if (normalized === 'approved') return 'bg-emerald-100 text-emerald-700';
  if (normalized === 'pending') return 'bg-amber-100 text-amber-700';
  if (normalized === 'rejected' || normalized === 'suspended') return 'bg-rose-100 text-rose-700';
  return 'bg-slate-100 text-slate-700';
}

function getFullName(user) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || 'Unnamed user';
}

export default function AdminUserDetailPage() {
  const params = useParams();
  const userId = params.id;
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchUser = useCallback(async () => {
    try {
      setLoading(true);
      const response = await adminAPI.getUserById(userId);

      if (response.data?.success) {
        setUser(response.data.user || null);
      } else {
        setUser(null);
      }
    } catch (error) {
      setUser(null);
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to load user details',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const handleStatusUpdate = useCallback(async (updates, successMessage) => {
    try {
      setSaving(true);
      const response = await adminAPI.updateUserStatus(userId, updates);

      if (response.data?.success) {
        toast({
          title: 'Updated',
          description: successMessage,
          variant: 'success',
        });
        await fetchUser();
      }
    } catch (error) {
      toast({
        title: 'Update failed',
        description: error.response?.data?.error || 'Failed to update user status',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }, [fetchUser, userId]);

  const handleUnlock = useCallback(async () => {
    try {
      setSaving(true);
      const response = await adminAPI.unlockUser(userId);

      if (response.data?.success) {
        toast({
          title: 'Account unlocked',
          description: 'Failed login counters were cleared successfully.',
          variant: 'success',
        });
        await fetchUser();
      }
    } catch (error) {
      toast({
        title: 'Unlock failed',
        description: error.response?.data?.error || 'Failed to unlock account',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }, [fetchUser, userId]);

  const isProvider = user?.role === 'provider';
  const isLocked = useMemo(() => {
    if (!user) return false;

    const hasFailures = Number(user.failedLoginAttempts || 0) > 0;
    const lockExpiry = user.lockedUntil ? new Date(user.lockedUntil).getTime() : null;
    return hasFailures || (lockExpiry ? lockExpiry > Date.now() : false);
  }, [user]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="space-y-6">
        <Link href="/admin/users">
          <Button variant="ghost">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Users
          </Button>
        </Link>
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-lg font-semibold text-foreground">User not found</p>
            <p className="mt-2 text-sm text-muted-foreground">This account may have been removed or the link is invalid.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <Link href="/admin/users">
            <Button variant="ghost">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Users
            </Button>
          </Link>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Admin User Detail</p>
            <h1 className="mt-2 text-3xl font-bold font-serif text-foreground">{getFullName(user)}</h1>
            <p className="mt-2 text-sm text-muted-foreground">Review account state, provider approval, and access controls without leaving the admin portal.</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant={user.isActive ? 'outline' : 'default'}
            onClick={() => handleStatusUpdate({ isActive: !user.isActive }, `User ${user.isActive ? 'deactivated' : 'activated'} successfully.`)}
            disabled={saving}
          >
            {user.isActive ? <UserX className="mr-2 h-4 w-4" /> : <UserCheck className="mr-2 h-4 w-4" />}
            {user.isActive ? 'Deactivate' : 'Activate'}
          </Button>
          {isProvider ? (
            <>
              <Button
                variant="outline"
                onClick={() => handleStatusUpdate({ isActive: true, providerStatus: 'approved' }, 'Provider approved successfully.')}
                disabled={saving || user.providerStatus === 'approved'}
              >
                Approve Provider
              </Button>
              <Button
                variant="outline"
                onClick={() => handleStatusUpdate({ providerStatus: 'suspended' }, 'Provider suspended successfully.')}
                disabled={saving || user.providerStatus === 'suspended'}
              >
                Suspend Provider
              </Button>
            </>
          ) : null}
          <Button variant="outline" onClick={handleUnlock} disabled={saving || !isLocked}>
            <Shield className="mr-2 h-4 w-4" />
            Unlock Account
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr,0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>Account Overview</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Role</p>
              <p className="mt-2 text-lg font-semibold text-foreground">{getRoleLabel(user.role)}</p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Account Status</p>
              <p className="mt-2 text-lg font-semibold text-foreground">{user.isActive ? 'Active' : 'Inactive'}</p>
            </div>
            {isProvider ? (
              <div className="rounded-xl border p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Provider Status</p>
                <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-sm font-medium ${getProviderStatusTone(user.providerStatus)}`}>
                  {getRoleLabel(user.providerStatus || 'pending')}
                </span>
              </div>
            ) : null}
            <div className="rounded-xl border p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Verification</p>
              <p className="mt-2 text-lg font-semibold text-foreground">{user.isVerified ? 'Verified' : 'Pending'}</p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Created</p>
              <p className="mt-2 text-sm font-medium text-foreground">{formatDateTime(user.createdAt)}</p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Last Login</p>
              <p className="mt-2 text-sm font-medium text-foreground">{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Never'}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Access & Security</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Failed Login Attempts</p>
              <p className="mt-2 text-2xl font-bold text-foreground">{user.failedLoginAttempts || 0}</p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Locked Until</p>
              <p className="mt-2 text-sm font-medium text-foreground">{user.lockedUntil ? formatDateTime(user.lockedUntil) : 'Not locked'}</p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">MFA</p>
              <p className="mt-2 text-sm font-medium text-foreground">{user.mfaEnabled ? 'Enabled' : 'Not enabled'}</p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Subscription</p>
              <p className="mt-2 text-sm font-medium text-foreground">
                {user.subscriptionTier ? getRoleLabel(user.subscriptionTier) : 'None'}
                {user.subscriptionStatus ? ` • ${getRoleLabel(user.subscriptionStatus)}` : ''}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-xl border p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="h-4 w-4" />
              <span className="text-xs font-semibold uppercase tracking-[0.18em]">Email</span>
            </div>
            <p className="mt-3 text-sm font-medium text-foreground">{user.email || 'Not provided'}</p>
          </div>
          <div className="rounded-xl border p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Phone className="h-4 w-4" />
              <span className="text-xs font-semibold uppercase tracking-[0.18em]">Phone</span>
            </div>
            <p className="mt-3 text-sm font-medium text-foreground">{user.phone || 'Not provided'}</p>
          </div>
          <div className="rounded-xl border p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <User className="h-4 w-4" />
              <span className="text-xs font-semibold uppercase tracking-[0.18em]">Specialty</span>
            </div>
            <p className="mt-3 text-sm font-medium text-foreground">{user.specialty || 'Not provided'}</p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Credentials</p>
            <p className="mt-3 text-sm font-medium text-foreground">{user.credentials || 'Not provided'}</p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">License / NPI</p>
            <p className="mt-3 text-sm font-medium text-foreground">
              {[user.licenseNumber, user.npiNumber].filter(Boolean).join(' • ') || 'Not provided'}
            </p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Address</p>
            <p className="mt-3 text-sm font-medium text-foreground">
              {[user.addressLine1, user.city, user.state, user.zipCode, user.country].filter(Boolean).join(', ') || 'Not provided'}
            </p>
          </div>
          <div className="rounded-xl border p-4 md:col-span-2 xl:col-span-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Bio</p>
            <p className="mt-3 text-sm leading-6 text-foreground">{user.bio || 'No bio on file.'}</p>
          </div>
        </CardContent>
      </Card>

      {isLocked ? (
        <Card className="border-amber-300 bg-amber-50/80">
          <CardContent className="flex items-start gap-3 p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 text-amber-600" />
            <div>
              <p className="font-semibold text-amber-900">This account is flagged for login lockout handling.</p>
              <p className="mt-1 text-sm text-amber-800">Use the unlock action above after confirming the user should regain access.</p>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
