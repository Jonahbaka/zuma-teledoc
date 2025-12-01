'use client';

import { useState, useEffect } from 'react';
import { Settings, Lock, Bell, Shield, Mail, CheckCircle, XCircle, Loader2, Save, Key, Smartphone, Database, Eye, EyeOff, AlertCircle, Copy, Download } from 'lucide-react';
import api from '@/lib/api';
import { authAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/components/providers/AuthProvider';

export default function AdminSettingsPage() {
  const { user, refreshUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('account');
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState({
    current: false,
    new: false,
    confirm: false
  });
  
  // Account settings
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  
  // Password strength
  const [passwordStrength, setPasswordStrength] = useState({
    score: 0,
    feedback: []
  });
  
  // MFA state
  const [mfaSetupDialog, setMfaSetupDialog] = useState(false);
  const [mfaVerifyDialog, setMfaVerifyDialog] = useState(false);
  const [mfaDisableDialog, setMfaDisableDialog] = useState(false);
  const [mfaData, setMfaData] = useState({
    password: '',
    code: '',
    qrCode: '',
    secret: '',
    backupCodes: []
  });
  
  // Notification preferences
  const [notifications, setNotifications] = useState({
    emailNotifications: true,
    smsNotifications: false,
    systemAlerts: true,
    userActivity: true
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

  // Calculate password strength
  const calculatePasswordStrength = (password) => {
    if (!password) {
      setPasswordStrength({ score: 0, feedback: [] });
      return;
    }
    
    let score = 0;
    const feedback = [];
    
    if (password.length >= 8) score += 1;
    else feedback.push('At least 8 characters');
    
    if (/[A-Z]/.test(password)) score += 1;
    else feedback.push('One uppercase letter');
    
    if (/[a-z]/.test(password)) score += 1;
    else feedback.push('One lowercase letter');
    
    if (/[0-9]/.test(password)) score += 1;
    else feedback.push('One number');
    
    if (/[^A-Za-z0-9]/.test(password)) score += 1;
    else feedback.push('One special character');
    
    if (password.length >= 12) score += 1;
    
    setPasswordStrength({ score, feedback });
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

    if (passwordStrength.score < 4) {
      toast({
        title: 'Error',
        description: 'Password does not meet security requirements',
        variant: 'destructive'
      });
      return;
    }

    setSaving(true);
    try {
      const response = await authAPI.changePassword({
        currentPassword: passwordData.currentPassword,
        newPassword: passwordData.newPassword,
        confirmNewPassword: passwordData.confirmPassword
      });

      if (response.data.success) {
        toast({
          title: 'Success',
          description: 'Password changed successfully. Please login again.',
          variant: 'success'
        });
        setPasswordData({
          currentPassword: '',
          newPassword: '',
          confirmPassword: ''
        });
        setPasswordStrength({ score: 0, feedback: [] });
        // Redirect to login after 2 seconds
        setTimeout(() => {
          window.location.href = '/login?session=expired';
        }, 2000);
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

  const handleMfaSetup = async () => {
    if (!mfaData.password) {
      toast({
        title: 'Error',
        description: 'Password is required',
        variant: 'destructive'
      });
      return;
    }

    setSaving(true);
    try {
      const response = await authAPI.setupMfa({ password: mfaData.password });

      if (response.data.success) {
        setMfaData({
          ...mfaData,
          qrCode: response.data.qrCode,
          secret: response.data.secret
        });
        setMfaSetupDialog(false);
        setMfaVerifyDialog(true);
        toast({
          title: 'Success',
          description: 'Scan the QR code with your authenticator app',
          variant: 'success'
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to setup MFA',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleMfaVerify = async () => {
    if (!mfaData.code || mfaData.code.length !== 6) {
      toast({
        title: 'Error',
        description: 'Please enter a valid 6-digit code',
        variant: 'destructive'
      });
      return;
    }

    setSaving(true);
    try {
      const response = await authAPI.verifyMfa({ code: mfaData.code });

      if (response.data.success) {
        setMfaData({
          ...mfaData,
          backupCodes: response.data.backupCodes
        });
        setMfaVerifyDialog(false);
        refreshUser?.();
        toast({
          title: 'Success',
          description: 'MFA enabled successfully. Save your backup codes!',
          variant: 'success'
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to verify MFA',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleMfaDisable = async () => {
    if (!mfaData.password || !mfaData.code) {
      toast({
        title: 'Error',
        description: 'Password and MFA code are required',
        variant: 'destructive'
      });
      return;
    }

    setSaving(true);
    try {
      const response = await authAPI.disableMfa({ 
        password: mfaData.password, 
        code: mfaData.code 
      });

      if (response.data.success) {
        setMfaDisableDialog(false);
        setMfaData({ password: '', code: '', qrCode: '', secret: '', backupCodes: [] });
        refreshUser?.();
        toast({
          title: 'Success',
          description: 'MFA disabled successfully',
          variant: 'success'
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to disable MFA',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const copyBackupCodes = () => {
    const codes = mfaData.backupCodes.join('\n');
    navigator.clipboard.writeText(codes);
    toast({
      title: 'Copied',
      description: 'Backup codes copied to clipboard',
      variant: 'success'
    });
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
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Settings className="w-6 h-6 text-purple-500" />
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
                  ? 'border-purple-500 text-purple-600'
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
                        <span className="flex items-center gap-1 text-emerald-600">
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
                    className="bg-purple-50 hover:bg-purple-100 text-purple-700 border-purple-200"
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
                <div className="relative mt-1">
                  <Input
                    id="currentPassword"
                    type={showPassword.current ? 'text' : 'password'}
                    value={passwordData.currentPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword({ ...showPassword, current: !showPassword.current })}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword.current ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <Label htmlFor="newPassword">New Password</Label>
                <div className="relative mt-1">
                  <Input
                    id="newPassword"
                    type={showPassword.new ? 'text' : 'password'}
                    value={passwordData.newPassword}
                    onChange={(e) => {
                      setPasswordData({ ...passwordData, newPassword: e.target.value });
                      calculatePasswordStrength(e.target.value);
                    }}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword({ ...showPassword, new: !showPassword.new })}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword.new ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {passwordData.newPassword && (
                  <div className="mt-2">
                    <div className="flex gap-1 mb-2">
                      {[1, 2, 3, 4, 5].map((level) => (
                        <div
                          key={level}
                          className={`h-2 flex-1 rounded ${
                            level <= passwordStrength.score
                              ? level <= 2
                                ? 'bg-red-500'
                                : level <= 3
                                ? 'bg-yellow-500'
                                : 'bg-green-500'
                              : 'bg-gray-200'
                          }`}
                        />
                      ))}
                    </div>
                    {passwordStrength.feedback.length > 0 && (
                      <div className="text-xs text-amber-600 space-y-1">
                        <p className="font-medium">Requirements missing:</p>
                        <ul className="list-disc list-inside">
                          {passwordStrength.feedback.map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {passwordStrength.score >= 4 && (
                      <p className="text-xs text-green-600 font-medium">✓ Strong password</p>
                    )}
                  </div>
                )}
              </div>
              <div>
                <Label htmlFor="confirmPassword">Confirm New Password</Label>
                <div className="relative mt-1">
                  <Input
                    id="confirmPassword"
                    type={showPassword.confirm ? 'text' : 'password'}
                    value={passwordData.confirmPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword({ ...showPassword, confirm: !showPassword.confirm })}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword.confirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {passwordData.confirmPassword && passwordData.newPassword !== passwordData.confirmPassword && (
                  <p className="text-xs text-red-600 mt-1">Passwords do not match</p>
                )}
              </div>
              <div className="flex justify-end pt-4">
                <Button
                  onClick={handlePasswordChange}
                  disabled={saving}
                  className="bg-purple-500 hover:bg-purple-600"
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
                    notifications.emailNotifications ? 'bg-purple-500' : 'bg-slate-300'
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
                    notifications.smsNotifications ? 'bg-purple-500' : 'bg-slate-300'
                  }`}
                >
                  <div className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform ${
                    notifications.smsNotifications ? 'translate-x-5' : 'translate-x-1'
                  }`} />
                </button>
              </div>

              <div className="flex items-center justify-between p-4 border border-slate-200 rounded-lg">
                <div>
                  <p className="font-medium text-slate-900">System Alerts</p>
                  <p className="text-sm text-slate-500">Get notified about system-wide alerts and issues</p>
                </div>
                <button
                  onClick={() => setNotifications({ ...notifications, systemAlerts: !notifications.systemAlerts })}
                  className={`w-11 h-6 flex items-center rounded-full transition-colors ${
                    notifications.systemAlerts ? 'bg-purple-500' : 'bg-slate-300'
                  }`}
                >
                  <div className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform ${
                    notifications.systemAlerts ? 'translate-x-5' : 'translate-x-1'
                  }`} />
                </button>
              </div>

              <div className="flex items-center justify-between p-4 border border-slate-200 rounded-lg">
                <div>
                  <p className="font-medium text-slate-900">User Activity</p>
                  <p className="text-sm text-slate-500">Get notified about important user activities</p>
                </div>
                <button
                  onClick={() => setNotifications({ ...notifications, userActivity: !notifications.userActivity })}
                  className={`w-11 h-6 flex items-center rounded-full transition-colors ${
                    notifications.userActivity ? 'bg-purple-500' : 'bg-slate-300'
                  }`}
                >
                  <div className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform ${
                    notifications.userActivity ? 'translate-x-5' : 'translate-x-1'
                  }`} />
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t">
              <Button
                onClick={handleNotificationSave}
                disabled={saving}
                className="bg-purple-500 hover:bg-purple-600"
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
                    {user?.mfaEnabled 
                      ? 'MFA is currently enabled on your account'
                      : 'Add an extra layer of security to your account'}
                  </p>
                  {user?.mfaEnabled && (
                    <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                      <CheckCircle className="w-4 h-4" />
                      Protected by two-factor authentication
                    </p>
                  )}
                </div>
                <Button 
                  variant={user?.mfaEnabled ? "outline" : "default"}
                  onClick={() => user?.mfaEnabled ? setMfaDisableDialog(true) : setMfaSetupDialog(true)}
                  className={user?.mfaEnabled ? "" : "bg-purple-600 hover:bg-purple-700"}
                >
                  {user?.mfaEnabled ? 'Disable 2FA' : 'Enable 2FA'}
                </Button>
              </div>
            </div>

            <div className="p-4 border border-slate-200 rounded-lg">
              <p className="font-medium text-slate-900 mb-2">Account Activity</p>
              <p className="text-sm text-slate-500 mb-4">
                Monitor your account for suspicious activity. Review recent login attempts and credential changes.
              </p>
              <Button 
                variant="outline" 
                onClick={() => window.location.href = '/admin/audit-logs?userId=' + user?.id}
              >
                View Activity Log
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* MFA Setup Dialog */}
      <Dialog open={mfaSetupDialog} onOpenChange={setMfaSetupDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Setup Two-Factor Authentication</DialogTitle>
            <DialogDescription>
              Enter your password to begin MFA setup
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="mfaPassword">Password</Label>
              <Input
                id="mfaPassword"
                type="password"
                value={mfaData.password}
                onChange={(e) => setMfaData({ ...mfaData, password: e.target.value })}
                placeholder="Enter your current password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMfaSetupDialog(false)}>Cancel</Button>
            <Button onClick={handleMfaSetup} disabled={saving} className="bg-purple-600 hover:bg-purple-700">
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MFA Verify Dialog */}
      <Dialog open={mfaVerifyDialog} onOpenChange={setMfaVerifyDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Verify and Enable MFA</DialogTitle>
            <DialogDescription>
              Scan the QR code with your authenticator app, then enter the verification code
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {mfaData.qrCode && (
              <div className="flex justify-center p-4 bg-white rounded-lg border">
                <img src={mfaData.qrCode} alt="MFA QR Code" className="w-48 h-48" />
              </div>
            )}
            <div>
              <Label htmlFor="mfaCode">Verification Code</Label>
              <Input
                id="mfaCode"
                type="text"
                maxLength={6}
                value={mfaData.code}
                onChange={(e) => setMfaData({ ...mfaData, code: e.target.value.replace(/\D/g, '') })}
                placeholder="000000"
                className="text-center text-2xl tracking-widest"
              />
              <p className="text-xs text-slate-500 mt-1">
                Enter the 6-digit code from your authenticator app
              </p>
            </div>
            {mfaData.backupCodes.length > 0 && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-medium text-amber-900">Backup Codes</p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyBackupCodes}
                      className="h-8"
                    >
                      <Copy className="w-3 h-3 mr-1" />
                      Copy
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-amber-700 mb-2">
                  Save these codes in a secure location. You can use them to access your account if you lose your device.
                </p>
                <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                  {mfaData.backupCodes.map((code, idx) => (
                    <div key={idx} className="p-2 bg-white rounded border text-center">
                      {code}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setMfaVerifyDialog(false);
              setMfaData({ ...mfaData, code: '', qrCode: '', secret: '' });
            }}>
              Cancel
            </Button>
            <Button 
              onClick={handleMfaVerify} 
              disabled={saving || mfaData.code.length !== 6}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Verify & Enable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MFA Disable Dialog */}
      <Dialog open={mfaDisableDialog} onOpenChange={setMfaDisableDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disable Two-Factor Authentication</DialogTitle>
            <DialogDescription>
              Enter your password and MFA code to disable 2FA
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="disablePassword">Password</Label>
              <Input
                id="disablePassword"
                type="password"
                value={mfaData.password}
                onChange={(e) => setMfaData({ ...mfaData, password: e.target.value })}
                placeholder="Enter your password"
              />
            </div>
            <div>
              <Label htmlFor="disableCode">MFA Code</Label>
              <Input
                id="disableCode"
                type="text"
                maxLength={6}
                value={mfaData.code}
                onChange={(e) => setMfaData({ ...mfaData, code: e.target.value.replace(/\D/g, '') })}
                placeholder="000000"
                className="text-center text-2xl tracking-widest"
              />
            </div>
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-sm text-amber-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Disabling 2FA will reduce your account security
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setMfaDisableDialog(false);
              setMfaData({ ...mfaData, password: '', code: '' });
            }}>
              Cancel
            </Button>
            <Button 
              onClick={handleMfaDisable} 
              disabled={saving || !mfaData.password || mfaData.code.length !== 6}
              variant="destructive"
            >
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Disable 2FA
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Settings page for admin users

