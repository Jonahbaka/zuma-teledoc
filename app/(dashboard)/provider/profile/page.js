'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { User, Save, Loader2, Briefcase } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/components/providers/AuthProvider';
import PharmacyPreferencePicker from '@/components/pharmacy/PharmacyPreferencePicker';
import { resolveProviderMarket } from '@/lib/providerPortal';

export default function ProviderProfilePage() {
  const { user } = useAuth();
  const pathname = usePathname();
  const market = resolveProviderMarket({ pathname, user });
  const isNigeriaMarket = market === 'NG';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    specialty: '',
    credentials: '',
    bio: '',
    licenseNumber: '',
    licenseState: '',
    npiNumber: ''
  });

  const fetchProfile = useCallback(async () => {
    try {
      const response = await api.get('/users/profile');
      if (response.data.success) {
        const profile = response.data.user;
        setFormData({
          firstName: profile.firstName || '',
          lastName: profile.lastName || '',
          email: profile.email || '',
          phone: profile.phone || '',
          specialty: profile.specialty || '',
          credentials: profile.credentials || '',
          bio: profile.bio || '',
          licenseNumber: profile.licenseNumber || '',
          licenseState: profile.licenseState || '',
          npiNumber: profile.npiNumber || ''
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load profile',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await api.put('/users/profile', formData);
      if (response.data.success) {
        toast({
          title: 'Profile Updated',
          description: 'Your profile has been saved successfully'
        });
      }
    } catch (error) {
      toast({
        title: 'Update Failed',
        description: error.response?.data?.error || 'Failed to update profile',
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
          <User className="w-6 h-6 text-blue-500" />
          My Profile
        </h1>
        <p className="text-slate-500 mt-1">
          {isNigeriaMarket
            ? 'Manage your professional profile and Nigeria practice details'
            : 'Manage your professional profile'}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Personal Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                value={formData.firstName}
                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                value={formData.lastName}
                onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              disabled
              className="mt-1 bg-slate-50"
            />
          </div>

          <div>
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="mt-1"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Briefcase className="w-5 h-5" />
            Professional Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="specialty">Specialty</Label>
              <Input
                id="specialty"
                value={formData.specialty}
                onChange={(e) => setFormData({ ...formData, specialty: e.target.value })}
                className="mt-1"
                placeholder="e.g., Cardiology"
              />
            </div>
            <div>
              <Label htmlFor="credentials">Credentials</Label>
              <Input
                id="credentials"
                value={formData.credentials}
                onChange={(e) => setFormData({ ...formData, credentials: e.target.value })}
                className="mt-1"
                placeholder={isNigeriaMarket ? 'e.g., MBBS, FWACP, RN' : 'e.g., MD, DO'}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="bio">Professional Bio</Label>
            <textarea
              id="bio"
              value={formData.bio}
              onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
              className="mt-1 w-full min-h-[100px] p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Tell patients about your background and expertise..."
            />
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="licenseNumber">
                {isNigeriaMarket ? 'Practice License Number' : 'License Number'}
              </Label>
              <Input
                id="licenseNumber"
                value={formData.licenseNumber}
                onChange={(e) => setFormData({ ...formData, licenseNumber: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="licenseState">
                {isNigeriaMarket ? 'Practice State / Region' : 'License State'}
              </Label>
              <Input
                id="licenseState"
                value={formData.licenseState}
                onChange={(e) => setFormData({ ...formData, licenseState: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="npiNumber">
                {isNigeriaMarket ? 'Regulatory ID (Optional)' : 'NPI Number'}
              </Label>
              <Input
                id="npiNumber"
                value={formData.npiNumber}
                onChange={(e) => setFormData({ ...formData, npiNumber: e.target.value })}
                className="mt-1"
              />
            </div>
          </div>

          <div className="flex justify-end pt-4">
            <Button onClick={handleSave} disabled={saving} className="bg-blue-500 hover:bg-blue-600">
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <PharmacyPreferencePicker
        title={isNigeriaMarket ? 'Preferred Pharmacy (Nearest to You)' : 'Default Pharmacy (Nearest to You)'}
      />
    </div>
  );
}

