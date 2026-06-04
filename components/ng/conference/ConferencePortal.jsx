'use client';

/**
 * components/ng/conference/ConferencePortal.jsx
 * Multi-party clinical video portal.
 * Tabs: Rooms | Start Meeting | Join
 * Data source: /api/ng/conference/*
 */

import { useState } from 'react';
import { Calendar, LogIn, Radio, Video } from 'lucide-react';

import RoomsListTab from './tabs/RoomsListTab';
import ScheduleRoomTab from './tabs/ScheduleRoomTab';
import JoinTab from './tabs/JoinTab';

const TABS = [
  { id: 'rooms', label: 'Rooms', icon: Radio },
  { id: 'schedule', label: 'Start Meeting', icon: Calendar },
  { id: 'join', label: 'Join', icon: LogIn },
];

export default function ConferencePortal({ initialTab = 'rooms' }) {
  const [tab, setTab] = useState(initialTab);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-green-50/30">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-green-600/10 p-2 text-green-700">
              <Video className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-black text-slate-900">Clinical Video</h1>
              <p className="text-xs text-slate-500">
                Live clinical meetings for consultations, case reviews, teaching rounds, and board meetings.
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
        {tab === 'rooms' && <RoomsListTab />}
        {tab === 'schedule' && <ScheduleRoomTab />}
        {tab === 'join' && <JoinTab />}
      </main>
    </div>
  );
}
