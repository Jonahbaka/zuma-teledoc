'use client';

import { useEffect, useState } from 'react';
import { Loader2, MapPin, Phone, Save, User } from 'lucide-react';
import { usersAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function NigeriaPatientProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    zipCode: '',
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
            dateOfBirth: profile.dateOfBirth || '',
            addressLine1: profile.addressLine1 || '',
            addressLine2: profile.addressLine2 || '',
            city: profile.city || '',
            state: profile.state || '',
            zipCode: profile.zipCode || '',
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
        setMessage('Profile updated successfully.');
      }
    } catch (error) {
      setMessage(error.response?.data?.error || 'Failed to update profile.');
    } finally {
      setSaving(false);
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
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Patient Profile</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Personal details and delivery information</h1>
        <p className="mt-2 text-sm text-muted-foreground">Keep your patient identity and address current for prescriptions, appointments, and pharmacy fulfillment.</p>
      </section>

      {message ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>
      ) : null}

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5 text-emerald-600" />
            Basic patient details
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
            <Label htmlFor="phone">Phone Number</Label>
            <div className="relative">
              <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="phone" className="pl-10" value={formData.phone} onChange={(event) => setFormData((current) => ({ ...current, phone: event.target.value }))} />
            </div>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="dateOfBirth">Date of Birth</Label>
            <Input id="dateOfBirth" type="date" value={formData.dateOfBirth} onChange={(event) => setFormData((current) => ({ ...current, dateOfBirth: event.target.value }))} />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-emerald-600" />
            Address for care and delivery
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="addressLine1">Address Line 1</Label>
            <Input id="addressLine1" value={formData.addressLine1} onChange={(event) => setFormData((current) => ({ ...current, addressLine1: event.target.value }))} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="addressLine2">Address Line 2</Label>
            <Input id="addressLine2" value={formData.addressLine2} onChange={(event) => setFormData((current) => ({ ...current, addressLine2: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="city">City</Label>
            <Input id="city" value={formData.city} onChange={(event) => setFormData((current) => ({ ...current, city: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="state">State</Label>
            <Input id="state" value={formData.state} onChange={(event) => setFormData((current) => ({ ...current, state: event.target.value }))} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="zipCode">Postal Code</Label>
            <Input id="zipCode" value={formData.zipCode} onChange={(event) => setFormData((current) => ({ ...current, zipCode: event.target.value }))} />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button onClick={handleSave} disabled={saving} className="bg-emerald-600 text-white hover:bg-emerald-500">
              <Save className="mr-2 h-4 w-4" />
              {saving ? 'Saving...' : 'Save Profile'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
