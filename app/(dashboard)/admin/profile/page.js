'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, User } from 'lucide-react';
import { usersAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function AdminProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
  });

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const response = await usersAPI.getProfile().catch(() => ({ data: { success: false } }));
        const profile = response.data?.profile || response.data?.user;
        if (profile) {
          setFormData({
            firstName: profile.firstName || '',
            lastName: profile.lastName || '',
            email: profile.email || '',
            phone: profile.phone || profile.phoneNumber || '',
          });
        }
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      const response = await usersAPI.updateProfile(formData);
      if (response.data?.success) {
        setMessage('Admin profile updated.');
      }
    } catch (error) {
      setMessage(error.response?.data?.error || 'Unable to update admin profile.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-purple-700">US Admin Profile</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Admin profile</h1>
      </section>

      {message ? <div className="rounded-2xl border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-800">{message}</div> : null}

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5 text-purple-600" />
            Account details
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="firstName">First Name</Label>
            <Input id="firstName" value={formData.firstName} onChange={(event) => setFormData((current) => ({ ...current, firstName: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName">Last Name</Label>
            <Input id="lastName" value={formData.lastName} onChange={(event) => setFormData((current) => ({ ...current, lastName: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={formData.email} disabled />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" value={formData.phone} onChange={(event) => setFormData((current) => ({ ...current, phone: event.target.value }))} />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button onClick={handleSave} disabled={saving} className="bg-purple-600 text-white hover:bg-purple-500">
              <Save className="mr-2 h-4 w-4" />
              {saving ? 'Saving...' : 'Save Profile'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
