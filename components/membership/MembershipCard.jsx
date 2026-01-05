'use client';

import { Crown, Gem, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

function formatISODate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export default function MembershipCard({ user, card, subscription }) {
  const tier = card?.tier || subscription?.tier || user?.subscriptionTier || null;
  const status = card?.status || (subscription?.status === 'active' ? 'active' : subscription?.status) || 'inactive';

  if (!tier || tier === 'free' || tier === 'basic') return null;

  const isGold = tier === 'gold';
  const isPlatinum = tier === 'platinum';

  const Icon = isGold ? Crown : isPlatinum ? Gem : ShieldCheck;
  const title = isGold ? 'Docta Gold' : 'Docta Platinum';

  const gradient = isGold
    ? 'bg-[radial-gradient(circle_at_top_left,rgba(255,215,0,0.45),transparent_55%),radial-gradient(circle_at_bottom_right,rgba(251,191,36,0.55),transparent_60%),linear-gradient(135deg,#3b2f00,#b45309,#f59e0b)]'
    : 'bg-[radial-gradient(circle_at_top_left,rgba(148,163,184,0.55),transparent_55%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.25),transparent_60%),linear-gradient(135deg,#0b1220,#334155,#0ea5e9)]';

  const textTone = isGold ? 'text-amber-50' : 'text-slate-50';
  const borderTone = isGold ? 'border-amber-200/30' : 'border-slate-200/20';

  const memberName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Member';
  const cardNumber = card?.card_number || card?.cardNumber || '';
  const exp = subscription?.current_period_end || subscription?.currentPeriodEnd || card?.current_period_end || card?.currentPeriodEnd;

  return (
    <div className={cn('relative overflow-hidden rounded-2xl border shadow-xl', borderTone, gradient)}>
      <div className="absolute inset-0 opacity-30 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.25),transparent)] translate-x-[-60%] animate-[shimmer_3.5s_infinite]" />

      <div className="relative p-6">
        <div className="flex items-start justify-between gap-4">
          <div className={cn('flex items-center gap-2', textTone)}>
            <div className="h-10 w-10 rounded-xl bg-white/15 flex items-center justify-center border border-white/20">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest opacity-90">Membership</p>
              <p className="text-lg font-bold">{title}</p>
            </div>
          </div>

          <div className={cn('text-right', textTone)}>
            <p className="text-xs uppercase tracking-widest opacity-90">Status</p>
            <p className={cn('text-sm font-semibold', status === 'active' ? 'text-emerald-200' : 'text-rose-200')}>
              {String(status).replace(/_/g, ' ')}
            </p>
          </div>
        </div>

        <div className={cn('mt-6', textTone)}>
          <p className="text-xs uppercase tracking-widest opacity-90">Member</p>
          <p className="text-xl font-semibold">{memberName}</p>
        </div>

        <div className={cn('mt-4 flex items-end justify-between gap-4', textTone)}>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-widest opacity-90">Card</p>
            <p className="font-mono text-sm tracking-widest truncate">{cardNumber || '—'}</p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-widest opacity-90">Renews</p>
            <p className="text-sm font-semibold">{formatISODate(exp) || '—'}</p>
          </div>
        </div>

        <div className={cn('mt-6 flex items-center justify-between text-xs', textTone)}>
          <p className="opacity-90">HIPAA-ready access controls • DoctaRx</p>
          <div className="h-8 w-12 rounded-lg bg-white/15 border border-white/20" />
        </div>
      </div>

      <style jsx>{`
        @keyframes shimmer {
          0% { transform: translateX(-60%); }
          100% { transform: translateX(160%); }
        }
      `}</style>
    </div>
  );
}


