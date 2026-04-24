'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronLeft, Flag, ToggleLeft, ToggleRight, AlertTriangle, RefreshCw, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';

const BUILTIN_FLAGS = [
  {
    key: 'ng_whatsapp_dispense',
    label: 'WhatsApp Prescription Dispensing',
    description: 'Allow pharmacies to receive and fulfill prescriptions via WhatsApp Business API.',
    category: 'Pharmacy',
    status: 'pending',
    note: 'Awaiting WhatsApp Business API approval.',
  },
  {
    key: 'ng_fhir_r4_pilot',
    label: 'FHIR R4 Health Data Exchange',
    description: 'Enable FHIR R4 data exchange for enrolled pilot hospitals. Sandbox only.',
    category: 'Hospital',
    status: 'sandbox',
    note: 'Sandbox pilot — 3 hospitals enrolled.',
  },
  {
    key: 'ng_nhia_billing',
    label: 'NHIA / NHIS Insurance Billing',
    description: 'Automated NHIA claim submission and HMO billing for verified facilities.',
    category: 'Hospital',
    status: 'pending',
    note: 'Integration contract under review.',
  },
  {
    key: 'ng_lab_orders',
    label: 'Lab Order & Results Integration',
    description: 'Providers can send lab orders to connected diagnostic labs and receive results.',
    category: 'Provider',
    status: 'unavailable',
    note: 'Planned for Q3 2026.',
  },
  {
    key: 'ng_telemedicine_video',
    label: 'Video Telemedicine Consultations',
    description: 'Live video appointments between patients and verified providers.',
    category: 'Provider',
    status: 'active',
    note: null,
  },
  {
    key: 'ng_org_hmo_plans',
    label: 'Corporate HMO Plan Management',
    description: 'Organisations can configure employee health benefit plans and track utilisation.',
    category: 'Organisation',
    status: 'active',
    note: null,
  },
  {
    key: 'ng_digital_prescriptions',
    label: 'Digital Prescription (Rx) System',
    description: 'Providers issue cryptographically signed digital prescriptions redeemable at partner pharmacies.',
    category: 'Provider',
    status: 'active',
    note: null,
  },
  {
    key: 'ng_paystack_checkout',
    label: 'Paystack Inline Checkout',
    description: 'Paystack payment modal for subscriptions and consultation fees.',
    category: 'Payments',
    status: 'active',
    note: null,
  },
  {
    key: 'ng_flutterwave_fallback',
    label: 'Flutterwave Payment Fallback',
    description: 'Fall back to Flutterwave when Paystack is unavailable.',
    category: 'Payments',
    status: 'active',
    note: null,
  },
  {
    key: 'ng_emr_integration',
    label: 'External EMR Integration',
    description: 'Bidirectional sync with hospital EMR systems (LifeSign, eHospital, etc.).',
    category: 'Hospital',
    status: 'pending',
    note: 'Pending vendor agreements.',
  },
];

const STATUS_STYLES = {
  active:      { label: 'Active',      dot: 'bg-green-500', badge: 'bg-green-500/10 text-green-600 border-green-500/20' },
  sandbox:     { label: 'Sandbox',     dot: 'bg-blue-500',  badge: 'bg-blue-500/10 text-blue-600 border-blue-500/20'   },
  pending:     { label: 'Pending',     dot: 'bg-amber-500', badge: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
  unavailable: { label: 'Coming Soon', dot: 'bg-muted-foreground', badge: 'bg-accent text-muted-foreground border-border' },
};

const CATEGORIES = ['All', 'Pharmacy', 'Hospital', 'Provider', 'Organisation', 'Payments'];

export default function AdminFeatureFlags() {
  const [flags, setFlags] = useState([]);
  const [overrides, setOverrides] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [category, setCategory] = useState('All');
  const [toast, setToast] = useState(null);

  useEffect(() => {
    fetch('/api/ng/features')
      .then((r) => r.json())
      .then((data) => {
        const map = {};
        (data.flags || []).forEach((f) => { map[f.key] = f.enabled; });
        setOverrides(map);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const merged = BUILTIN_FLAGS.map((f) => ({
    ...f,
    enabled: overrides[f.key] ?? f.status === 'active',
  }));

  const visible = category === 'All' ? merged : merged.filter((f) => f.category === category);

  async function toggle(key, current) {
    setSaving(key);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`/api/ng/features/${key}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled: !current }),
      });
      if (!res.ok) throw new Error('Failed');
      setOverrides((prev) => ({ ...prev, [key]: !current }));
      showToast(`${key} ${!current ? 'enabled' : 'disabled'}`);
    } catch {
      showToast('Could not update flag — check admin permissions', true);
    } finally {
      setSaving(null);
    }
  }

  function showToast(msg, error = false) {
    setToast({ msg, error });
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/ng/admin" className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
            <ChevronLeft size={16} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Feature Flags</h1>
            <p className="text-muted-foreground text-sm">Control platform feature availability across all portals</p>
          </div>
        </div>

        {/* Warning Banner */}
        <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
          <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-700">
            Changes take effect immediately for all users. Disabling an active feature will interrupt users currently using it.
            Use with caution in production.
          </p>
        </div>

        {/* Category Tabs */}
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                category === c
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-accent text-muted-foreground border-border hover:text-foreground'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Flag List */}
        {loading ? (
          <div className="text-center py-16 text-muted-foreground">
            <RefreshCw size={24} className="mx-auto mb-2 animate-spin" />
            Loading flags…
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map((flag) => {
              const style = STATUS_STYLES[flag.status] || STATUS_STYLES.unavailable;
              const isSaving = saving === flag.key;
              const canToggle = flag.status !== 'unavailable';

              return (
                <div
                  key={flag.key}
                  className="bg-card border border-border rounded-xl p-4 flex items-start gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-medium text-sm">{flag.label}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${style.badge}`}>
                        {style.label}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-accent text-muted-foreground border border-border">
                        {flag.category}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{flag.description}</p>
                    {flag.note && (
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <Info size={12} className="text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">{flag.note}</span>
                      </div>
                    )}
                    <code className="text-xs text-muted-foreground font-mono mt-1 block">{flag.key}</code>
                  </div>

                  <button
                    onClick={() => canToggle && toggle(flag.key, flag.enabled)}
                    disabled={!canToggle || isSaving}
                    className={`shrink-0 transition-opacity ${!canToggle ? 'opacity-30 cursor-not-allowed' : 'hover:opacity-80'}`}
                    title={canToggle ? (flag.enabled ? 'Disable' : 'Enable') : 'Cannot toggle — coming soon'}
                  >
                    {isSaving ? (
                      <RefreshCw size={28} className="text-muted-foreground animate-spin" />
                    ) : flag.enabled ? (
                      <ToggleRight size={32} className="text-green-600" />
                    ) : (
                      <ToggleLeft size={32} className="text-muted-foreground" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Object.entries(STATUS_STYLES).map(([status, s]) => {
            const count = merged.filter((f) => f.status === status).length;
            return (
              <div key={status} className="bg-card border border-border rounded-xl p-3 text-center">
                <div className={`w-2 h-2 rounded-full ${s.dot} mx-auto mb-1`} />
                <div className="text-lg font-bold">{count}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl text-sm font-medium shadow-lg z-50 ${
          toast.error ? 'bg-red-600 text-white' : 'bg-foreground text-background'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
