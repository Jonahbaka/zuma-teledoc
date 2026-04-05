'use client';

import { useState } from 'react';
import { KeyRound, Mail, ShieldCheck } from 'lucide-react';
import { authAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function NigeriaAdminSettingsPage() {
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const handlePasswordChange = async () => {
    if (form.newPassword !== form.confirmPassword) {
      setMessage('New passwords do not match.');
      return;
    }

    setSaving(true);
    setMessage('');
    try {
      const response = await authAPI.changePassword({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      if (response.data?.success) {
        setMessage('Admin password updated successfully.');
        setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      }
    } catch (error) {
      setMessage(error.response?.data?.error || 'Unable to update password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Admin Settings</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Security and operational settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">Manage account security for Nigeria operations users and review platform handling expectations.</p>
      </section>

      {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div> : null}

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-emerald-600" />
            Change password
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="currentPassword">Current Password</Label>
            <Input id="currentPassword" type="password" value={form.currentPassword} onChange={(event) => setForm((current) => ({ ...current, currentPassword: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newPassword">New Password</Label>
            <Input id="newPassword" type="password" value={form.newPassword} onChange={(event) => setForm((current) => ({ ...current, newPassword: event.target.value }))} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="confirmPassword">Confirm New Password</Label>
            <Input id="confirmPassword" type="password" value={form.confirmPassword} onChange={(event) => setForm((current) => ({ ...current, confirmPassword: event.target.value }))} />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button onClick={handlePasswordChange} disabled={saving} className="bg-emerald-600 text-white hover:bg-emerald-500">
              {saving ? 'Updating...' : 'Update Password'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-emerald-600" />
            Admin operations notes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Use Nigeria admin routes to review pharmacies, revenue, compliance, and notifications without crossing into US admin routing.</p>
          <p>Platform changes that affect approvals, audit logs, and wallet settlement should continue to respect environment-driven protection and audit logging.</p>
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            Security posture
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Nigeria admin access remains compliance-sensitive. Do not use this portal to bypass audit logging, access controls, or pharmacy verification safeguards.
        </CardContent>
      </Card>
    </div>
  );
}
