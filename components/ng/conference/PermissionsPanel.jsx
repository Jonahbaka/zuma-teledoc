'use client';

import { Shield, Check, X } from 'lucide-react';
import { effectivePermissions, PERMISSION_KEYS } from '../../../lib/ng/conferencePermissions';

const GROUPS = [
  { title: 'Communication', keys: ['speak', 'see_video', 'share_screen', 'send_chat', 'send_private_dm', 'raise_hand'] },
  { title: 'Moderation',    keys: ['mute_others', 'kick_others', 'admit_others', 'end_room', 'manage_breakouts'] },
  { title: 'Clinical',      keys: ['prescribe', 'finalize_diagnosis', 'approve_referrals', 'update_vitals', 'upload_observations', 'review_prescriptions', 'confirm_dispense'] },
  { title: 'Recording',     keys: ['start_recording'] },
];

export default function PermissionsPanel({ participant }) {
  if (!participant) return null;
  const perms = effectivePermissions(participant.role, participant.permissions_json || {});

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <Shield className="h-4 w-4 text-slate-500" />
        Effective permissions for {participant.display_name || 'you'}
      </div>
      {GROUPS.map(g => (
        <section key={g.title}>
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{g.title}</h4>
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {g.keys.map(k => (
              <li key={k} className="flex items-center gap-2 text-xs text-slate-700">
                {perms[k]
                  ? <Check className="h-3.5 w-3.5 text-emerald-600" />
                  : <X     className="h-3.5 w-3.5 text-slate-300" />}
                <span className={perms[k] ? '' : 'text-slate-400 line-through'}>{labelFor(k)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="text-[10px] text-slate-400">
        {PERMISSION_KEYS.length} permission keys total — role defaults + per-participant overrides.
      </p>
    </div>
  );
}

function labelFor(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
