'use client';

import { useState } from 'react';
import { Building2, MapPin, Phone, Mail, Clock, Truck, Save, Shield } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function PharmacySettingsPage() {
  const [settings, setSettings] = useState({
    name: 'HealthPlus Pharmacy', license: 'PCN-2024-12345',
    owner: 'Pharm. Ngozi Eze', email: 'info@healthplus.ng',
    phone: '+234 803 456 7890', address: '24 Admiralty Way, Lekki Phase 1',
    city: 'Lagos', state: 'Lagos', operatingHours: '8:00 AM - 9:00 PM',
    deliveryEnabled: true, deliveryRadius: '15', deliveryFee: '1500',
    pickupEnabled: true, autoAccept: false
  });

  const update = (field, value) => setSettings(prev => ({ ...prev, [field]: value }));

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Pharmacy Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage your pharmacy profile and preferences</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Building2 size={18} /> Pharmacy Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Pharmacy Name</Label>
              <Input value={settings.name} onChange={(e) => update('name', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>PCN License Number</Label>
              <Input value={settings.license} onChange={(e) => update('license', e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Superintendent Pharmacist</Label>
            <Input value={settings.owner} onChange={(e) => update('owner', e.target.value)} />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input value={settings.email} onChange={(e) => update('email', e.target.value)} className="pl-9" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input value={settings.phone} onChange={(e) => update('phone', e.target.value)} className="pl-9" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><MapPin size={18} /> Location</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Address</Label>
            <Input value={settings.address} onChange={(e) => update('address', e.target.value)} />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>City</Label>
              <Input value={settings.city} onChange={(e) => update('city', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>State</Label>
              <Input value={settings.state} onChange={(e) => update('state', e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Operating Hours</Label>
            <div className="relative">
              <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input value={settings.operatingHours} onChange={(e) => update('operatingHours', e.target.value)} className="pl-9" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Truck size={18} /> Fulfillment</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-muted/50 rounded-xl border border-border">
            <div>
              <div className="text-sm font-medium text-foreground">Enable Delivery</div>
              <div className="text-xs text-muted-foreground">Allow patients to request medication delivery</div>
            </div>
            <button onClick={() => update('deliveryEnabled', !settings.deliveryEnabled)}
              className={`w-12 h-7 rounded-full transition-colors relative ${settings.deliveryEnabled ? 'bg-purple-600' : 'bg-muted'}`}>
              <div className={`w-5 h-5 bg-white rounded-full absolute top-1 transition-transform ${settings.deliveryEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
          {settings.deliveryEnabled && (
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Delivery Radius (km)</Label>
                <Input value={settings.deliveryRadius} onChange={(e) => update('deliveryRadius', e.target.value)} type="number" />
              </div>
              <div className="space-y-2">
                <Label>Delivery Fee (₦)</Label>
                <Input value={settings.deliveryFee} onChange={(e) => update('deliveryFee', e.target.value)} type="number" />
              </div>
            </div>
          )}
          <div className="flex items-center justify-between p-4 bg-muted/50 rounded-xl border border-border">
            <div>
              <div className="text-sm font-medium text-foreground">Enable Pickup</div>
              <div className="text-xs text-muted-foreground">Allow patients to pick up at your pharmacy</div>
            </div>
            <button onClick={() => update('pickupEnabled', !settings.pickupEnabled)}
              className={`w-12 h-7 rounded-full transition-colors relative ${settings.pickupEnabled ? 'bg-purple-600' : 'bg-muted'}`}>
              <div className={`w-5 h-5 bg-white rounded-full absolute top-1 transition-transform ${settings.pickupEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button variant="outline">Cancel</Button>
        <Button className="bg-purple-600 hover:bg-purple-500 text-white">
          <Save className="w-4 h-4 mr-2" /> Save Changes
        </Button>
      </div>

      <div className="rounded-lg bg-muted/40 border border-border p-3 text-xs text-muted-foreground flex items-start gap-2">
        <Shield className="w-4 h-4 mt-0.5 shrink-0" />
        <span>Your pharmacy data is encrypted and secured by NVIDIA NemoClaw OpenShell. All prescription data is audited for compliance.</span>
      </div>
    </div>
  );
}
