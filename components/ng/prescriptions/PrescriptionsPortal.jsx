'use client';

/**
 * components/ng/prescriptions/PrescriptionsPortal.jsx
 * Unified prescriptions workspace.
 * Tabs:
 *   Doctor view — Outbox + Compose
 *   Pharmacy view — Inbox (filterable by status)
 */

import { useState } from 'react';
import { Pill, FileSignature, Stethoscope, Store } from 'lucide-react';
import ComposeRx from './ComposeRx';
import RxList from './RxList';

const TABS = [
  { id: 'doctor-list',  label: "Doctor outbox",    icon: Stethoscope },
  { id: 'compose',      label: 'Compose',          icon: FileSignature },
  { id: 'pharmacy',     label: 'Pharmacy inbox',   icon: Store },
];

export default function PrescriptionsPortal({ initialTab = 'doctor-list' }) {
  const [tab, setTab] = useState(initialTab);
  const [providerId, setProviderId]   = useState('');
  const [pharmacyId, setPharmacyId]   = useState('');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-green-50/30">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-green-600/10 p-2 text-green-700">
              <Pill className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-black text-slate-900">Prescriptions</h1>
              <p className="text-xs text-slate-500">
                Lifecycle from draft → signed → sent → received → dispensed → completed
              </p>
            </div>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-6 pb-2">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex shrink-0 items-center gap-2 rounded-t-lg border-b-2 px-3 py-2 text-sm font-semibold transition ${
                tab === id ? 'border-green-600 text-green-700' : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}>
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-6 py-6">
        {tab === 'doctor-list' && (
          <>
            <ScopeBar
              label="Filter to provider"
              placeholder="provider_id (leave blank for all)"
              value={providerId}
              onChange={setProviderId}
            />
            <RxList scope="doctor" providerId={providerId} />
          </>
        )}
        {tab === 'compose' && <ComposeRx providerId={providerId} />}
        {tab === 'pharmacy' && (
          <>
            <ScopeBar
              label="Filter to pharmacy"
              placeholder="pharmacy_id (leave blank for all)"
              value={pharmacyId}
              onChange={setPharmacyId}
            />
            <RxList scope="pharmacy" pharmacyId={pharmacyId} />
          </>
        )}
      </main>
    </div>
  );
}

function ScopeBar({ label, placeholder, value, onChange }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
      <span className="text-xs font-semibold text-slate-600">{label}:</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
      />
    </div>
  );
}
