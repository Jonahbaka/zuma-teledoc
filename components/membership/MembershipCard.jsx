'use client';

import { Crown, Gem, BadgeCheck } from 'lucide-react';
import { membershipDate, verifiedMembership } from '@/lib/membershipWorkspace';

export default function MembershipCard({ user, subscription }) {
  if (!verifiedMembership(subscription, user) || !['gold', 'platinum'].includes(subscription.tier)) return null;
  const gold = subscription.tier === 'gold';
  const testPayment = subscription.paymentEnvironment === 'test';
  const Icon = gold ? Crown : Gem;
  const name = [user.firstName || user.first_name, user.lastName || user.last_name].filter(Boolean).join(' ');

  return <section aria-label={'DoctaRx ' + (gold ? 'Gold' : 'Platinum') + ' membership'} className="relative overflow-hidden rounded-3xl border border-slate-700 bg-slate-950 p-6 text-white shadow-lg sm:p-8">
    <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-blue-700/30 blur-3xl" aria-hidden="true" />
    <div className="relative">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="flex items-center gap-3"><div className={'flex h-12 w-12 items-center justify-center rounded-2xl border ' + (gold ? 'border-amber-200/40 bg-amber-200/10 text-amber-200' : 'border-blue-200/40 bg-blue-200/10 text-blue-200')}><Icon size={26} aria-hidden="true" /></div><div><p className="text-base text-slate-300">DoctaRx membership</p><h2 className="mt-1 text-2xl font-semibold">{gold ? 'DoctaRx Gold' : 'DoctaRx Platinum'}</h2></div></div>
        <p className="flex items-center gap-2 rounded-full border border-blue-200/40 bg-blue-200/10 px-4 py-2 text-base text-blue-100"><BadgeCheck size={20} aria-hidden="true" />{testPayment ? 'Test payment verified' : 'Payment verified'}</p>
      </div>
      {name && <div className="mt-8"><p className="text-base text-slate-300">Member</p><p className="mt-2 break-words text-xl font-medium">{name}</p></div>}
      <dl className="mt-7 grid gap-5 border-t border-white/20 pt-6 sm:grid-cols-2"><div><dt className="text-base text-slate-300">Current period ends</dt><dd className="mt-2 text-base font-medium">{membershipDate(subscription.current_period_end)}</dd></div><div><dt className="text-base text-slate-300">Renewal instruction</dt><dd className="mt-2 text-base font-medium">{subscription.cancel_at_period_end === true ? 'Cancels at period end' : subscription.cancel_at_period_end === false ? 'Continues unless canceled' : 'Not recorded'}</dd></div></dl>
      <p className="mt-6 border-t border-white/20 pt-5 text-base leading-7 text-slate-300">{testPayment ? 'This membership uses a Stripe test payment. It does not confirm a live charge.' : 'Membership status is separate from insurance eligibility and individual care arrangements.'}</p>
    </div>
  </section>;
}
