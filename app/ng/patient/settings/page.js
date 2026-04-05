'use client';

import { useEffect, useState } from 'react';
import { Bell, CheckCircle2, KeyRound, Loader2, Mail, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { authAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function NigeriaPatientSettingsPage() {
  const { user, refreshUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [savingPassword, setSavingPassword] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [message, setMessage] = useState('');
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [preferences, setPreferences] = useState({
    appointmentReminders: true,
    prescriptionUpdates: true,
    orderAlerts: true,
    messageAlerts: true,
  });

  useEffect(() => {
    setLoading(false);
  }, []);

  const handlePasswordChange = async () => {
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setMessage('New passwords do not match.');
      return;
    }

    setSavingPassword(true);
    setMessage('');
    try {
      const response = await authAPI.changePassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });

      if (response.data?.success) {
        setMessage('Password updated successfully.');
        setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      }
    } catch (error) {
      setMessage(error.response?.data?.error || 'Failed to update password.');
    } finally {
      setSavingPassword(false);
    }
  };

  const resendVerification = async () => {
    setMessage('');
    try {
      const response = await authAPI.resendVerification();
      if (response.data?.success) {
        setMessage('Verification email sent.');
        await refreshUser?.();
      }
    } catch (error) {
      setMessage(error.response?.data?.error || 'Unable to resend verification email.');
    }
  };

  const savePreferences = async () => {
    setSavingPrefs(true);
    setMessage('');
    try {
      await new Promise((resolve) => setTimeout(resolve, 400));
      setMessage('Notification preferences saved for this session.');
    } finally {
      setSavingPrefs(false);
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
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Patient Settings</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Account security and alerts</h1>
        <p className="mt-2 text-sm text-muted-foreground">Manage your password, email verification, and how the portal updates you.</p>
      </section>

      {message ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>
      ) : null}

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-emerald-600" />
            Email verification
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl border border-border bg-card px-4 py-4">
            <p className="font-medium text-foreground">{user?.email}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {user?.isVerified ? 'Your account email is verified.' : 'Verify your email to secure messages and appointment updates.'}
            </p>
          </div>
          {!user?.isVerified ? (
            <Button variant="outline" onClick={resendVerification}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Resend Verification Email
            </Button>
          ) : null}
        </CardContent>
      </Card>

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
            <Input id="currentPassword" type="password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newPassword">New Password</Label>
            <Input id="newPassword" type="password" value={passwordForm.newPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="confirmPassword">Confirm New Password</Label>
            <Input id="confirmPassword" type="password" value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))} />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button onClick={handlePasswordChange} disabled={savingPassword} className="bg-emerald-600 text-white hover:bg-emerald-500">
              {savingPassword ? 'Updating...' : 'Update Password'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-emerald-600" />
            Alert preferences
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            ['appointmentReminders', 'Appointment reminders'],
            ['prescriptionUpdates', 'Prescription status updates'],
            ['orderAlerts', 'Pharmacy order and delivery alerts'],
            ['messageAlerts', 'Provider and support messages'],
          ].map(([key, label]) => (
            <div key={key} className="flex items-center justify-between rounded-2xl border border-border px-4 py-4">
              <div>
                <p className="font-medium text-foreground">{label}</p>
                <p className="text-sm text-muted-foreground">Keep this enabled for time-sensitive patient updates.</p>
              </div>
              <button
                type="button"
                onClick={() => setPreferences((current) => ({ ...current, [key]: !current[key] }))}
                className={`flex h-6 w-11 items-center rounded-full transition-colors ${preferences[key] ? 'bg-emerald-600' : 'bg-slate-300'}`}
              >
                <span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${preferences[key] ? 'translate-x-5' : 'translate-x-1'}`} />
              </button>
            </div>
          ))}
          <div className="flex justify-end">
            <Button onClick={savePreferences} disabled={savingPrefs} variant="outline">
              {savingPrefs ? 'Saving...' : 'Save Preferences'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            Security
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-6 text-muted-foreground">
          Your Nigeria patient portal continues to use encrypted sessions, role-based access control, and audited clinical messaging. If you suspect unauthorized access, change your password immediately and contact support from the Messages page.
        </CardContent>
      </Card>
    </div>
  );
}
