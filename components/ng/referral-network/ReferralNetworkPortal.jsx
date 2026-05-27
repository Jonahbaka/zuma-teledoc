'use client';

/**
 * components/ng/referral-network/ReferralNetworkPortal.jsx
 * DoctaRx Referral Network (DRN) unified portal.
 * Tabs: Overview | Marketplace | Compose | Inbox | Outbox | Agents | Heatmap | Commissions
 * Data source: /api/ng/referral-network/*
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Network, Search, Send, Inbox as InboxIcon, Users, Map, Wallet,
  RefreshCw, AlertCircle, CheckCircle2, Clock, Activity, QrCode,
} from 'lucide-react';

import OverviewTab from './tabs/OverviewTab';
import MarketplaceTab from './tabs/MarketplaceTab';
import ComposeTab from './tabs/ComposeTab';
import InboxTab from './tabs/InboxTab';
import OutboxTab from './tabs/OutboxTab';
import AgentsTab from './tabs/AgentsTab';
import HeatmapTab from './tabs/HeatmapTab';
import CommissionsTab from './tabs/CommissionsTab';

const TABS = [
  { id: 'overview',    label: 'Overview',    icon: Activity   },
  { id: 'marketplace', label: 'Marketplace', icon: Search     },
  { id: 'compose',     label: 'Compose',     icon: Send       },
  { id: 'inbox',       label: 'Inbox',       icon: InboxIcon  },
  { id: 'outbox',      label: 'Outbox',      icon: Network    },
  { id: 'agents',      label: 'Agents',      icon: Users      },
  { id: 'heatmap',     label: 'Heatmap',     icon: Map        },
  { id: 'commissions', label: 'Commissions', icon: Wallet     },
];

export default function ReferralNetworkPortal({ initialTab = 'overview' }) {
  const [tab, setTab] = useState(initialTab);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-green-50/30">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-green-600/10 p-2 text-green-700">
              <Network className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-black text-slate-900">DoctaRx Referral Network</h1>
              <p className="text-xs text-slate-500">
                Nationwide coordination across hospitals, labs, pharmacies, specialists, and field agents
              </p>
            </div>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-6 pb-2">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex shrink-0 items-center gap-2 rounded-t-lg border-b-2 px-3 py-2 text-sm font-semibold transition ${
                tab === id
                  ? 'border-green-600 text-green-700'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        {tab === 'overview'    && <OverviewTab />}
        {tab === 'marketplace' && <MarketplaceTab />}
        {tab === 'compose'     && <ComposeTab />}
        {tab === 'inbox'       && <InboxTab />}
        {tab === 'outbox'      && <OutboxTab />}
        {tab === 'agents'      && <AgentsTab />}
        {tab === 'heatmap'     && <HeatmapTab />}
        {tab === 'commissions' && <CommissionsTab />}
      </main>
    </div>
  );
}
