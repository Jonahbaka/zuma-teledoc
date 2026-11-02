'use client';

/**
 * components/ng/referral-network/ReferralNetworkPortal.jsx
 * DoctaRx Referral Network (DRN) unified portal.
 * Tabs: Overview | Marketplace | Compose | Inbox | Outbox | Agents | Heatmap | Commissions
 * Data source: /api/ng/referral-network/*
 */

import { useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
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
  const { user, loading } = useAuth();
  const market = user?.marketScope || user?.market_scope;
  const id = user?.id || user?.userId;
  if (loading || !id || !user?.role || market !== 'NG') return <p role="status">{loading ? 'Loading referral access…' : 'Sign in with your Nigeria account to view referrals.'}</p>;
  return <ReferralNetworkWorkspace key={JSON.stringify([id, user.role, market])} initialTab={initialTab} role={user.role} />;
}

export function ReferralNetworkWorkspace({ initialTab = 'overview', role }) {
  const admin = ['admin', 'super_admin'].includes(role);
  const agent = ['agent', 'referral_agent', 'referral_coordinator'].includes(role);
  const clinical = role === 'provider' || role === 'patient';
  const visibleTabs = TABS.filter(item => {
    if (item.id === 'agents') return admin;
    if (['overview', 'commissions'].includes(item.id)) return admin || agent;
    if (item.id === 'compose') return clinical || agent;
    if (['inbox', 'outbox'].includes(item.id)) return clinical || admin || agent;
    return true;
  });
  const fallback = admin || agent ? 'overview' : role === 'provider' ? 'inbox' : role === 'patient' ? 'outbox' : 'marketplace';
  const [tab, setTab] = useState(visibleTabs.some(item => item.id === initialTab) ? initialTab : fallback);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-600/10 p-2 text-blue-700">
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
          {visibleTabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex shrink-0 items-center gap-2 rounded-t-lg border-b-2 px-3 py-2 text-sm font-semibold transition ${
                tab === id
                  ? 'border-blue-600 text-blue-700'
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
