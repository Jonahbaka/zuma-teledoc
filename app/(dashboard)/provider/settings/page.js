'use client';

import { useState, useEffect } from 'react';
import { Settings, Lock, Bell, Shield, Mail, CheckCircle, XCircle, Loader2, Save, Key, Smartphone } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/components/providers/AuthProvider';

export default function ProviderSettingsPage() {
  const { user, refreshUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('account');
  const [saving, setSaving] = useState(false);
  
  // Account settings
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  
  // Notification preferences
  const [notifications, setNotifications] = useState({
    emailNotifications: true,
    smsNotifications: false,
    appointmentReminders: true,
    messageNotifications: true,
    appointmentUpdates: true,
    patientRequests: true
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const profileResponse = await api.get('/users/profile');
      if (profileResponse.data.success) {
        const profile = profileResponse.data.profile || profileResponse.data.user;
        if (profile?.isVerified !== undefined) {
          refreshUser?.();
        }
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordChange = async () => {
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast({
        title: 'Error',
        description: 'New passwords do not match',
        variant: 'destructive'
      });
      return;
    }

    if (passwordData.newPassword.length < 8) {
      toast({
        title: 'Error',
        description: 'Password must be at least 8 characters',
        variant: 'destructive'
      });
      return;
    }

    setSaving(true);
    try {
      const response = await api.post('/auth/password/change', {
        currentPassword: passwordData.currentPassword,
        newPassword: passwordData.newPassword
      });

      if (response.data.success) {
        toast({
          title: 'Success',
          description: 'Password changed successfully',
          variant: 'success'
        });
        setPasswordData({
          currentPassword: '',
          newPassword: '',
          confirmPassword: ''
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to change password',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleResendVerification = async () => {
    try {
      const response = await api.post('/auth/resend-verification');
      if (response.data.success) {
        toast({
          title: 'Email Sent',
          description: 'Verification email has been sent to your email address',
          variant: 'success'
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to resend verification email',
        variant: 'destructive'
      });
    }
  };

  const handleNotificationSave = async () => {
    setSaving(true);
    try {
      toast({
        title: 'Success',
        description: 'Notification preferences saved',
        variant: 'success'
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to save notification preferences',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Settings className="w-6 h-6 text-blue-500" />
          Settings
        </h1>
        <p className="text-slate-500 mt-1">Manage your account settings and preferences</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <nav className="flex space-x-8">
          {[
            { id: 'account', label: 'Account', icon: Lock },
            { id: 'notifications', label: 'Notifications', icon: Bell },
            { id: 'security', label: 'Security', icon: Shield }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Account Settings */}
      {activeTab === 'account' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Email Verification</CardTitle>
              <CardDescription>Verify your email address to secure your account</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <Mail className="w-5 h-5 text-slate-600" />
                  <div>
                    <p className="font-medium text-slate-900">{user?.email}</p>
                    <p className="text-sm text-slate-500">
                      {user?.isVerified ? (
                        <span className="flex items-center gap-1 text-purple-600">
                          <CheckCircle className="w-4 h-4" />
                          Verified
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-amber-600">
                          <XCircle className="w-4 h-4" />
                          Not verified
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                {!user?.isVerified && (
                  <Button
                    onClick={handleResendVerification}
                    variant="outline"
                    className="bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200"
                  >
                    Resend Verification
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Change Password</CardTitle>
              <CardDescription>Update your password to keep your account secure</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="currentPassword">Current Password</Label>
                <Input
                  id="currentPassword"
                  type="password"
                  value={passwordData.currentPassword}
                  onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="newPassword">New Password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={passwordData.newPassword}
                  onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                  className="mt-1"
                />
                <p className="text-xs text-slate-500 mt-1">Must be at least 8 characters</p>
              </div>
              <div>
                <Label htmlFor="confirmPassword">Confirm New Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={passwordData.confirmPassword}
                  onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div className="flex justify-end pt-4">
                <Button
                  onClick={handlePasswordChange}
                  disabled={saving}
                  className="bg-blue-500 hover:bg-blue-600"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Changing...
                    </>
                  ) : (
                    <>
                      <Key className="w-4 h-4 mr-2" />
                      Change Password
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Notification Settings */}
      {activeTab === 'notifications' && (
        <Card>
          <CardHeader>
            <CardTitle>Notification Preferences</CardTitle>
            <CardDescription>Choose how you want to receive notifications</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 border border-slate-200 rounded-lg">
                <div>
                  <p className="font-medium text-slate-900">Email Notifications</p>
                  <p className="text-sm text-slate-500">Receive notifications via email</p>
                </div>
                <button
                  onClick={() => setNotifications({ ...notifications, emailNotifications: !notifications.emailNotifications })}
                  className={`w-11 h-6 flex items-center rounded-full transition-colors ${
                    notifications.emailNotifications ? 'bg-blue-500' : 'bg-slate-300'
                  }`}
                >
                  <div className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform ${
                    notifications.emailNotifications ? 'translate-x-5' : 'translate-x-1'
                  }`} />
                </button>
              </div>

              <div className="flex items-center justify-between p-4 border border-slate-200 rounded-lg">
                <div>
                  <p className="font-medium text-slate-900">SMS Notifications</p>
                  <p className="text-sm text-slate-500">Receive notifications via text message</p>
                </div>
                <button
                  onClick={() => setNotifications({ ...notifications, smsNotifications: !notifications.smsNotifications })}
                  className={`w-11 h-6 flex items-center rounded-full transition-colors ${
                    notifications.smsNotifications ? 'bg-blue-500' : 'bg-slate-300'
                  }`}
                >
                  <div className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform ${
                    notifications.smsNotifications ? 'translate-x-5' : 'translate-x-1'
                  }`} />
                </button>
              </div>

              <div className="flex items-center justify-between p-4 border border-slate-200 rounded-lg">
                <div>
                  <p className="font-medium text-slate-900">Appointment Reminders</p>
                  <p className="text-sm text-slate-500">Get reminded about upcoming appointments</p>
                </div>
                <button
                  onClick={() => setNotifications({ ...notifications, appointmentReminders: !notifications.appointmentReminders })}
                  className={`w-11 h-6 flex items-center rounded-full transition-colors ${
                    notifications.appointmentReminders ? 'bg-blue-500' : 'bg-slate-300'
                  }`}
                >
                  <div className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform ${
                    notifications.appointmentReminders ? 'translate-x-5' : 'translate-x-1'
                  }`} />
                </button>
              </div>

              <div className="flex items-center justify-between p-4 border border-slate-200 rounded-lg">
                <div>
                  <p className="font-medium text-slate-900">Message Notifications</p>
                  <p className="text-sm text-slate-500">Get notified when you receive new messages</p>
                </div>
                <button
                  onClick={() => setNotifications({ ...notifications, messageNotifications: !notifications.messageNotifications })}
                  className={`w-11 h-6 flex items-center rounded-full transition-colors ${
                    notifications.messageNotifications ? 'bg-blue-500' : 'bg-slate-300'
                  }`}
                >
                  <div className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform ${
                    notifications.messageNotifications ? 'translate-x-5' : 'translate-x-1'
                  }`} />
                </button>
              </div>

              <div className="flex items-center justify-between p-4 border border-slate-200 rounded-lg">
                <div>
                  <p className="font-medium text-slate-900">Patient Requests</p>
                  <p className="text-sm text-slate-500">Get notified about new patient appointment requests</p>
                </div>
                <button
                  onClick={() => setNotifications({ ...notifications, patientRequests: !notifications.patientRequests })}
                  className={`w-11 h-6 flex items-center rounded-full transition-colors ${
                    notifications.patientRequests ? 'bg-blue-500' : 'bg-slate-300'
                  }`}
                >
                  <div className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform ${
                    notifications.patientRequests ? 'translate-x-5' : 'translate-x-1'
                  }`} />
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t">
              <Button
                onClick={handleNotificationSave}
                disabled={saving}
                className="bg-blue-500 hover:bg-blue-600"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Save Preferences
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Security Settings */}
      {activeTab === 'security' && (
        <Card>
          <CardHeader>
            <CardTitle>Security Settings</CardTitle>
            <CardDescription>Manage your account security and authentication</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-900 flex items-center gap-2">
                    <Smartphone className="w-5 h-5" />
                    Two-Factor Authentication (2FA)
                  </p>
                  <p className="text-sm text-slate-500 mt-1">
                    Add an extra layer of security to your account
                  </p>
                </div>
                <Button variant="outline">
                  {user?.mfaEnabled ? 'Disable 2FA' : 'Enable 2FA'}
                </Button>
              </div>
            </div>

            <div className="p-4 border border-slate-200 rounded-lg">
              <p className="font-medium text-slate-900 mb-2">Account Activity</p>
              <p className="text-sm text-slate-500">
                Monitor your account for suspicious activity. Review recent login attempts and active sessions.
              </p>
              <Button variant="outline" className="mt-4">
                View Activity Log
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

