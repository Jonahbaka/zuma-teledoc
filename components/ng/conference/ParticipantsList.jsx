'use client';

import { useState } from 'react';
import {
  Hand, Mic, MicOff, Video, VideoOff, UserCheck, UserX, UserMinus,
  Shield, Crown,
} from 'lucide-react';
import { conf, roleBadge, statusBadge, ROLE_OPTIONS } from './conferenceApi';
import { can, canActOn } from '../../../lib/ng/conferencePermissions';

export default function ParticipantsList({ roomId, participants, me, onChanged }) {
  const [busy, setBusy] = useState(null);

  async function withBusy(key, fn) {
    setBusy(key);
    try { await fn(); await onChanged?.(); }
    catch (e) { alert(e.message); }
    finally { setBusy(null); }
  }

  const groups = {
    waiting: participants.filter(p => p.status === 'waiting'),
    admitted: participants.filter(p => p.status === 'admitted'),
    other: participants.filter(p => !['waiting', 'admitted'].includes(p.status)),
  };

  return (
    <div className="space-y-4">
      {groups.waiting.length > 0 && (
        <Section title={`Waiting (${groups.waiting.length})`} accent="amber">
          {groups.waiting.map(p => (
            <Row key={p.id} p={p} me={me} roomId={roomId} busy={busy} withBusy={withBusy} variant="waiting" />
          ))}
        </Section>
      )}

      <Section title={`In room (${groups.admitted.length})`}>
        {groups.admitted.length === 0
          ? <p className="px-3 py-2 text-xs text-slate-400">Nobody admitted yet.</p>
          : groups.admitted.map(p => (
              <Row key={p.id} p={p} me={me} roomId={roomId} busy={busy} withBusy={withBusy} variant="admitted" />
            ))
        }
      </Section>

      {groups.other.length > 0 && (
        <Section title={`Past / removed (${groups.other.length})`} muted>
          {groups.other.map(p => (
            <Row key={p.id} p={p} me={me} roomId={roomId} busy={busy} withBusy={withBusy} variant="other" />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, accent, muted, children }) {
  const tone = accent === 'amber' ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200 bg-white';
  return (
    <div className={`rounded-xl border ${tone}`}>
      <div className={`border-b px-3 py-2 text-[11px] font-semibold uppercase tracking-wide ${muted ? 'text-slate-400' : 'text-slate-600'}`}>
        {title}
      </div>
      <div className="divide-y divide-slate-100">{children}</div>
    </div>
  );
}

function Row({ p, me, roomId, busy, withBusy, variant }) {
  const canAdmit = me && can(me.role, me.permissions_json, 'admit_others');
  const canKick  = me && can(me.role, me.permissions_json, 'kick_others') && canActOn(me.role, p.role);
  const canMute  = me && can(me.role, me.permissions_json, 'mute_others');
  const canPromote = me?.role === 'host' || me?.role === 'consultant';
  const isSelf = me?.id === p.id;

  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">
        {initials(p.display_name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-slate-800">{p.display_name || 'Guest'}</span>
          {p.role === 'host' && <Crown className="h-3 w-3 text-purple-600" />}
          {isSelf && <span className="text-[10px] font-semibold text-emerald-600">you</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`rounded-full px-1.5 text-[10px] font-semibold ${roleBadge(p.role)}`}>{p.role}</span>
          <span className={`rounded-full px-1.5 text-[10px] font-semibold ${statusBadge(p.status)}`}>{p.status}</span>
          {p.hand_raised_at && <Hand className="h-3 w-3 text-amber-600" />}
          {p.muted_audio   && <MicOff   className="h-3 w-3 text-rose-500" />}
          {p.muted_video   && <VideoOff className="h-3 w-3 text-rose-500" />}
        </div>
      </div>

      <div className="flex items-center gap-1">
        {variant === 'waiting' && canAdmit && (
          <>
            <IconBtn label="Admit"  onClick={() => withBusy(`adm-${p.id}`, () => conf.admit(roomId, p.id))} busy={busy === `adm-${p.id}`}>
              <UserCheck className="h-4 w-4 text-emerald-600" />
            </IconBtn>
            <IconBtn label="Deny" onClick={() => withBusy(`den-${p.id}`, () => conf.deny(roomId, p.id))} busy={busy === `den-${p.id}`}>
              <UserX className="h-4 w-4 text-rose-600" />
            </IconBtn>
          </>
        )}

        {variant === 'admitted' && (
          <>
            {(canMute || isSelf) && (
              <IconBtn
                label={p.muted_audio ? 'Unmute audio' : 'Mute audio'}
                onClick={() => withBusy(`a-${p.id}`, () => conf.mute(roomId, p.id, { audio: !p.muted_audio }))}
                busy={busy === `a-${p.id}`}
              >
                {p.muted_audio ? <MicOff className="h-4 w-4 text-rose-500" /> : <Mic className="h-4 w-4 text-slate-600" />}
              </IconBtn>
            )}
            {(canMute || isSelf) && (
              <IconBtn
                label={p.muted_video ? 'Unmute video' : 'Mute video'}
                onClick={() => withBusy(`v-${p.id}`, () => conf.mute(roomId, p.id, { video: !p.muted_video }))}
                busy={busy === `v-${p.id}`}
              >
                {p.muted_video ? <VideoOff className="h-4 w-4 text-rose-500" /> : <Video className="h-4 w-4 text-slate-600" />}
              </IconBtn>
            )}
            {canPromote && !isSelf && (
              <select
                value={p.role}
                disabled={busy === `pro-${p.id}`}
                onChange={(e) => withBusy(`pro-${p.id}`, () => conf.promote(roomId, p.id, { role: e.target.value }))}
                className="rounded-md border border-slate-200 px-1 py-0.5 text-[10px]"
                title="Change role"
              >
                {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
            {canKick && !isSelf && (
              <IconBtn label="Remove" onClick={() => {
                if (confirm(`Remove ${p.display_name}?`)) withBusy(`rm-${p.id}`, () => conf.remove(roomId, p.id, { reason: 'moderator' }));
              }} busy={busy === `rm-${p.id}`}>
                <UserMinus className="h-4 w-4 text-rose-600" />
              </IconBtn>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function IconBtn({ label, onClick, busy, children }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={label}
      aria-label={label}
      className="rounded-md p-1.5 hover:bg-slate-100 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function initials(name) {
  if (!name) return '?';
  return name.split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase();
}
