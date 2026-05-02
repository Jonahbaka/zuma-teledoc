'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import NigeriaPharmacyPortalShell from '@/components/ng/NigeriaPharmacyPortalShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchNigeriaPharmacyWorkspace } from '@/lib/ngPharmacyPortal';
import api from '@/lib/api';

export default function NigeriaPharmacySettingsPage() {
  const [loading, setLoading] = useState(true);
  const [workspace, setWorkspace] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [settings, setSettings] = useState({
    whatsapp: '',
    whatsappBusinessNumber: '',
    preferredPrescriptionReceivingMethod: 'dashboard',
    acceptsBankTransfer: true,
    acceptsPos: true,
    acceptsCash: true,
  });

  useEffect(() => {
    const loadWorkspace = async () => {
      const pharmacyWorkspace = await fetchNigeriaPharmacyWorkspace().catch(() => null);
      setWorkspace(pharmacyWorkspace);
      if (pharmacyWorkspace) {
        setSettings({
          whatsapp: pharmacyWorkspace.whatsapp || '',
          whatsappBusinessNumber: pharmacyWorkspace.whatsapp_business_number || pharmacyWorkspace.whatsapp || '',
          preferredPrescriptionReceivingMethod: pharmacyWorkspace.preferred_prescription_receiving_method || 'dashboard',
          acceptsBankTransfer: pharmacyWorkspace.accepts_bank_transfer !== false,
          acceptsPos: pharmacyWorkspace.accepts_pos !== false,
          acceptsCash: pharmacyWorkspace.accepts_cash !== false,
        });
      }
      setLoading(false);
    };

    loadWorkspace();
  }, []);

  const updateSetting = (field, value) => {
    setSettings((current) => ({ ...current, [field]: value }));
    setNotice('');
  };

  const saveSettings = async () => {
    setSaving(true);
    setNotice('');
    try {
      const response = await api.patch('/ng/pharmacy/me', settings);
      setWorkspace(response.data?.pharmacy || workspace);
      setNotice('Pharmacy settings saved.');
    } catch (error) {
      setNotice(error.response?.data?.error || 'Unable to save pharmacy settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <NigeriaPharmacyPortalShell>
      <div className="space-y-6">
        <section>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Pharmacy Settings</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Workspace settings and operational readiness</h1>
          <p className="mt-2 text-sm text-muted-foreground">Review the pharmacy identity, fulfillment readiness, and onboarding links that support the Nigeria pharmacy portal.</p>
        </section>

        {notice ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div> : null}

        {loading ? (
          <Card className="border-border/70">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">Loading settings...</CardContent>
          </Card>
        ) : !workspace ? (
          <Card className="border-border/70">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">No pharmacy workspace exists for this account yet.</CardContent>
          </Card>
        ) : (
          <>
            <Card className="border-border/70">
              <CardHeader>
                <CardTitle>Pharmacy identity</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="rounded-2xl border border-border px-4 py-4">
                  <p className="font-semibold text-foreground">{workspace.name}</p>
                  <p className="mt-1 text-muted-foreground">{workspace.address_line1}, {workspace.city}, {workspace.state}</p>
                </div>
                <div className="rounded-2xl border border-border px-4 py-4">
                  <p className="font-semibold text-foreground">PCN License</p>
                  <p className="mt-1 text-muted-foreground">{workspace.pcn_license_number || 'Not configured yet'}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/70">
              <CardHeader>
                <CardTitle>Prescription receiving and payment readiness</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground">
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    value={settings.whatsapp}
                    onChange={(event) => updateSetting('whatsapp', event.target.value)}
                    placeholder="WhatsApp number"
                    className="h-11 rounded-2xl border border-slate-300 bg-white px-3 text-sm text-slate-950"
                  />
                  <input
                    value={settings.whatsappBusinessNumber}
                    onChange={(event) => updateSetting('whatsappBusinessNumber', event.target.value)}
                    placeholder="WhatsApp business number"
                    className="h-11 rounded-2xl border border-slate-300 bg-white px-3 text-sm text-slate-950"
                  />
                  <select
                    value={settings.preferredPrescriptionReceivingMethod}
                    onChange={(event) => updateSetting('preferredPrescriptionReceivingMethod', event.target.value)}
                    className="h-11 rounded-2xl border border-slate-300 bg-white px-3 text-sm text-slate-950 sm:col-span-2"
                  >
                    <option value="dashboard">Dashboard only</option>
                    <option value="whatsapp">WhatsApp only</option>
                    <option value="dashboard_whatsapp">Dashboard + WhatsApp</option>
                  </select>
                </div>

                <div className="grid gap-3 text-sm text-slate-700 sm:grid-cols-3">
                  {[
                    ['acceptsBankTransfer', 'Bank transfer ready'],
                    ['acceptsPos', 'POS ready'],
                    ['acceptsCash', 'Cash workflow ready'],
                  ].map(([field, label]) => (
                    <label key={field} className="flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-3">
                      <input
                        type="checkbox"
                        checked={settings[field]}
                        onChange={(event) => updateSetting(field, event.target.checked)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>

                <Button onClick={saveSettings} disabled={saving} className="bg-emerald-600 text-white hover:bg-emerald-500">
                  {saving ? 'Saving...' : 'Save Settings'}
                </Button>
              </CardContent>
            </Card>

            <Card className="border-border/70">
              <CardHeader>
                <CardTitle>Next operational actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>Use onboarding to complete banking, superintendent pharmacist details, and final registration review.</p>
                <p>Prescription, inventory, wallet, and settings routes are part of the integrated DoctaRx Nigeria Pharmacy Portal.</p>
                <div className="flex flex-wrap gap-3 pt-2">
                  <Link href="/ng/pharmacy/onboarding">
                    <Button className="bg-emerald-600 text-white hover:bg-emerald-500">Continue Onboarding</Button>
                  </Link>
                  <Link href="/ng/pharmacy/profile">
                    <Button variant="outline">Open Profile</Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </NigeriaPharmacyPortalShell>
  );
}
