'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, BadgeCheck, CreditCard, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import PortalPageHeader from '@/components/branding/PortalPageHeader';
import MembershipCard from '@/components/membership/MembershipCard';
import { Button } from '@/components/ui/button';
import { canStartMembershipCheckout, hostedMembershipUrl, membershipDate, membershipMarket, membershipPrice, readMembershipState } from '@/lib/membershipWorkspace';

const initial = { owner: null, generation: -1, loading: true, data: null, error: '' };
const unavailableReasons = {
  STRIPE_MEMBERSHIP_UNAVAILABLE: 'Online membership checkout is not available for this account right now. Your existing care arrangements are separate.',
  MEMBERSHIP_RECONCILIATION_REQUIRED: 'An existing subscription needs payment reconciliation before another checkout can begin. Contact your care team for help.',
  ALREADY_SUBSCRIBED: 'You already have a verified membership. Use billing settings to manage it.',
  US_PATIENT_CHECKOUT_REQUIRED: 'These Stripe membership plans are available to eligible US patient accounts. Your local care and billing arrangements are separate.',
};

export function SubscriptionContent() {
  const { user, loading: authLoading } = useAuth();
  const search = useSearchParams();
  const market = membershipMarket(user);
  const owner = user?.id ? JSON.stringify([user.id, user.role, market]) : null;
  const ready = Boolean(user?.id && user.role === 'patient' && !authLoading && ['US', 'NG'].includes(market));
  const [resource, setResource] = useState(initial);
  const [revision, setRevision] = useState(0);
  const [action, setAction] = useState({ owner: null, generation: -1, pending: null, error: '' });
  const mounted = useRef(false);
  const request = useRef(null);
  const sequence = useRef(0);
  const latestData = useRef(null);
  const context = useRef({ owner, ready, generation: 0 });
  if (context.current.owner !== owner || context.current.ready !== ready) {
    context.current = { owner, ready, generation: context.current.generation + 1 };
  }
  const generation = context.current.generation;
  const currentAccount = () => mounted.current && context.current.owner === owner && context.current.ready && context.current.generation === generation;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.controller.abort(); };
  }, []);
  useEffect(() => {
    request.current?.controller.abort(); request.current = null;
    setAction({ owner, generation, pending: null, error: '' });
    const controller = new AbortController(); const id = ++sequence.current;
    const current = () => !controller.signal.aborted && sequence.current === id && mounted.current
      && context.current.owner === owner && context.current.ready && context.current.generation === generation;
    setResource({ ...initial, owner, generation });
    if (ready) api.get('/subscriptions/me', { signal: controller.signal }).then(({ data }) => {
      const confirmed = readMembershipState(data, user);
      if (current()) setResource({ owner, generation, loading: false, data: confirmed, error: '' });
    }).catch(error => {
      if (current()) setResource({ owner, generation, loading: false, data: null, error: error.response?.status === 403
        ? 'Your account cannot access these membership records.' : error.message && !error.response ? error.message : 'Membership could not be loaded. Please try again.' });
    });
    return () => { controller.abort(); request.current?.controller.abort(); };
    // owner includes the account, role and market; generation rejects readiness changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, ready, authLoading, revision]);

  const scoped = ready && resource.owner === owner && resource.generation === generation;
  const loading = Boolean(authLoading || ready && (!scoped || resource.loading));
  const data = scoped && !resource.loading && !resource.error ? resource.data : null;
  latestData.current = data;
  const error = !ready && !authLoading ? user?.id && user.role === 'patient'
    ? 'Your account’s billing market could not be confirmed. Sign in again or contact your care team.'
    : 'Sign in to your patient account to review membership.' : scoped ? resource.error : '';
  const activeAction = ready && action.owner === owner && action.generation === generation ? action : { pending: null, error: '' };
  const patientBase = market === 'NG' ? '/ng/patient' : '/patient';
  const returned = search.get('checkout') === 'returned' || search.get('success') === 'true';
  const canceled = search.get('checkout') === 'cancelled' || search.get('cancelled') === 'true';
  const testPayment = data?.paymentEnvironment === 'test';

  async function openStripe(kind, planKey) {
    if (!currentAccount() || request.current || !data || latestData.current !== data || loading || error) return;
    if (kind === 'checkout' ? !canStartMembershipCheckout(data, user, planKey)
      : kind !== 'portal' || market !== 'US' || user.role !== 'patient' || data.capabilities.billingPortalAvailable !== true) return;
    const controller = new AbortController(); const active = { controller, owner, generation }; request.current = active;
    const current = () => !controller.signal.aborted && currentAccount() && request.current === active;
    let navigating = false;
    setAction({ owner, generation, pending: kind === 'checkout' ? planKey : 'portal', error: '' });
    try {
      const response = await api.post(kind === 'checkout' ? '/stripe/checkout/subscription' : '/stripe/billing-portal', kind === 'checkout' ? { planKey } : {}, { signal: controller.signal });
      const url = hostedMembershipUrl(response.data, kind);
      if (current()) { window.location.assign(url); navigating = true; }
    } catch (failure) {
      if (current()) setAction({ owner, generation, pending: null, error: failure.response?.data?.error || failure.message || 'Stripe could not be opened. Refresh membership before trying again.' });
    } finally {
      if (!navigating) {
        if (current()) setAction(previous => ({ ...previous, pending: null }));
        if (request.current === active) request.current = null;
      }
    }
  }

  function refresh() {
    if (request.current || !currentAccount()) return;
    latestData.current = null; sequence.current += 1;
    setResource({ ...initial, owner, generation }); setRevision(value => value + 1);
  }

  return <div className="clinical-readable space-y-6">
    <PortalPageHeader title="Membership & billing" description="Review your DoctaRx membership, explore available plans, and manage billing through Stripe when it is available.">
      <Link href={market === 'NG' ? patientBase : patientBase + '/dashboard'} className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 px-5 py-3 text-base font-semibold text-slate-900">Your care dashboard <ArrowRight size={20} aria-hidden="true" /></Link>
      <Button onClick={refresh} disabled={loading || Boolean(activeAction.pending) || !ready} variant="outline" className="min-h-12 gap-2 whitespace-normal text-base"><RefreshCw size={20} aria-hidden="true" /> Refresh membership</Button>
    </PortalPageHeader>

    {ready && (returned || canceled) && <div role="status" className="rounded-2xl border border-blue-200 bg-blue-50 p-5 leading-7 text-blue-950"><p className="font-semibold">{returned ? 'You returned from checkout' : 'Checkout was closed'}</p><p className="mt-2">{returned ? 'Returning from checkout does not confirm payment. Your recorded membership status appears below. If payment is still processing, refresh membership later.' : 'Closing checkout does not confirm whether a payment was completed. Review your membership below or check your Stripe billing history.'}</p></div>}
    {activeAction.error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 leading-7 text-red-900">{activeAction.error}</div>}
    {loading && <p role="status" className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-6 text-base text-blue-950"><Loader2 className="animate-spin" size={22} aria-hidden="true" /> Loading your membership…</p>}
    {error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 leading-7 text-red-900"><h2 className="text-xl font-semibold">Membership unavailable</h2><p className="mt-2">{error}</p>{ready && <Button onClick={refresh} variant="outline" className="mt-5 min-h-12 text-base">Try again</Button>}</div>}

    {data && <>
      <div className={'grid items-start gap-6 ' + (['gold', 'platinum'].includes(data.subscription?.tier) ? 'xl:grid-cols-2' : '')}>
        <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8"><div className="flex items-center gap-3"><BadgeCheck className="shrink-0 text-blue-700" size={26} aria-hidden="true" /><h2 className="text-2xl font-semibold text-slate-950">Your membership</h2></div>
          <p className="mt-5 text-xl font-semibold text-slate-950">{data.hasActiveSubscription ? testPayment ? 'Active · test payment verified' : 'Active · payment verified' : 'No verified paid membership'}</p>
          {data.hasActiveSubscription ? <dl className="mt-5 space-y-4"><div><dt className="text-slate-600">Recorded tier</dt><dd className="mt-1 text-base font-medium capitalize text-slate-950">DoctaRx {data.subscription.tier}</dd></div><div><dt className="text-slate-600">Current period ends</dt><dd className="mt-1 text-base font-medium text-slate-950">{membershipDate(data.subscription.current_period_end)}</dd></div><div><dt className="text-slate-600">Renewal instruction</dt><dd className="mt-1 text-base font-medium text-slate-950">{data.subscription.cancel_at_period_end === true ? 'Cancels at period end' : data.subscription.cancel_at_period_end === false ? 'Continues unless canceled' : 'Not recorded'}</dd></div></dl>
            : <p className="mt-3 leading-7 text-slate-600">A current paid membership has not been verified for this account. Individual visits, insurance, and sponsored care may have separate arrangements.</p>}
          {data.testingBypassActive && <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-blue-950"><p className="font-semibold">Authorized testing access</p><p className="mt-2 leading-7">Testing access expires {membershipDate(data.testingBypassExpiresAt)}. It is separate from a paid membership and does not prove payment.</p></div>}
          {data.hasActiveSubscription && testPayment && <p className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-5 leading-7 text-blue-950">This membership uses a verified Stripe test payment. It does not confirm a live charge.</p>}
          {data.capabilities.billingPortalAvailable && market === 'US' && <Button onClick={() => openStripe('portal')} disabled={Boolean(activeAction.pending)} variant="outline" className="mt-6 min-h-12 gap-2 whitespace-normal text-base"><CreditCard size={20} aria-hidden="true" />{activeAction.pending === 'portal' ? 'Opening Stripe…' : 'Manage Stripe billing'}</Button>}
        </section>
        <MembershipCard user={user} subscription={data.subscription} />
      </div>

      {!data.hasActiveSubscription && data.recordedSubscription && <section className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="text-xl font-semibold text-slate-950">Recorded subscription history</h2><p className="mt-3 leading-7 text-slate-600">A subscription record exists, but it does not establish a current verified paid membership.</p><dl className="mt-5 grid gap-5 sm:grid-cols-3"><div><dt className="text-slate-600">Recorded tier</dt><dd className="mt-1 break-words font-medium capitalize text-slate-950">{data.recordedSubscription.tier || 'Not recorded'}</dd></div><div><dt className="text-slate-600">Recorded status</dt><dd className="mt-1 break-words font-medium capitalize text-slate-950">{data.recordedSubscription.status?.replace(/_/g, ' ') || 'Not recorded'}</dd></div><div><dt className="text-slate-600">Recorded period end</dt><dd className="mt-1 font-medium text-slate-950">{membershipDate(data.recordedSubscription.current_period_end)}</dd></div></dl></section>}

      <section className="space-y-5" aria-labelledby="membership-plans"><div><h2 id="membership-plans" className="text-2xl font-semibold text-slate-950">Available membership plans</h2><p className="mt-3 max-w-3xl leading-7 text-slate-600">Review the available plans and billing intervals. Check the final total in Stripe before paying, and confirm service coverage with your care team.</p></div>
        {!data.capabilities.checkoutAvailable && <p className="rounded-2xl border border-slate-200 bg-slate-50 p-5 leading-7 text-slate-700">{unavailableReasons[data.capabilities.reason] || 'Online membership checkout is currently unavailable. Your care team can help with existing billing arrangements.'}</p>}
        {data.plans.length === 0 ? <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 leading-7 text-slate-600">No online membership plans are available for this account.</p> : <div className="grid items-stretch gap-5 md:grid-cols-2 2xl:grid-cols-4">{data.plans.map(plan => <article key={plan.id} className="flex min-w-0 flex-col rounded-3xl border border-slate-200 bg-white p-6"><CreditCard size={28} className="text-blue-700" aria-hidden="true" /><h3 className="mt-5 break-words text-xl font-semibold text-slate-950">{plan.name}</h3><p className="mt-5 text-3xl font-semibold tracking-tight text-slate-950">{membershipPrice(plan)}</p><p className="mt-2 text-base text-slate-600">USD · billed {plan.interval === 'year' ? 'annually' : 'monthly'}</p>{plan.features.length > 0 && <ul className="mt-5 list-disc space-y-3 pl-5 leading-7 text-slate-700">{plan.features.map(feature => <li key={feature}>{feature}</li>)}</ul>}<div className="mt-auto pt-7"><Button onClick={() => openStripe('checkout', plan.id)} disabled={Boolean(activeAction.pending) || !canStartMembershipCheckout(data, user, plan.id)} className="min-h-12 w-full whitespace-normal bg-blue-700 text-base hover:bg-blue-800">{activeAction.pending === plan.id ? 'Opening checkout…' : 'Continue to checkout'}</Button></div></article>)}</div>}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8"><div className="flex items-center gap-3"><ShieldCheck size={26} className="shrink-0 text-blue-700" aria-hidden="true" /><h2 className="text-2xl font-semibold text-slate-950">Insurance & care arrangements</h2></div><p className="mt-4 max-w-3xl leading-7 text-slate-600">Membership does not confirm insurance eligibility, visit coverage, or sponsored care. Keep your insurance details current and confirm specific services with your care team.</p><Link href={market === 'NG' ? '/ng/patient/consultation-billing' : '/patient/wallet'} className="mt-5 inline-flex min-h-12 items-center gap-2 text-base font-semibold text-blue-700">{market === 'NG' ? 'Consultation billing' : 'Insurance & payments'}<ArrowRight size={20} aria-hidden="true" /></Link></section>
    </>}
  </div>;
}

export default function MembershipWorkspace() {
  return <Suspense fallback={<p role="status" className="p-6 text-base text-slate-700">Loading membership…</p>}><SubscriptionContent /></Suspense>;
}
