'use client';

import { AlertCircle, CheckCircle2, Loader2, PackageCheck, ShieldCheck, Truck } from 'lucide-react';
import { deliveryDate, formatKobo, statusLabel } from '@/lib/ngDeliveryApi';

export const deliveryInputClass = 'min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-950 placeholder:text-slate-500 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100';
export const deliveryButtonClass = 'min-h-12 h-auto whitespace-normal rounded-xl px-5 py-3 text-base';
export const deliveryCardClass = 'rounded-3xl border border-white/80 bg-white/90 p-5 shadow-[0_12px_40px_-24px_rgba(15,23,42,0.3)] backdrop-blur-xl sm:p-6';

export function DeliveryNotice({ children, error = false }) {
  if (!children) return null;
  return <div role={error ? 'alert' : 'status'} className={`flex items-start gap-3 rounded-2xl border p-4 text-base leading-7 ${error ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-blue-200 bg-blue-50 text-blue-950'}`}>
    <AlertCircle className="mt-1 h-5 w-5 shrink-0" aria-hidden="true" /><div>{children}</div>
  </div>;
}

export function DeliveryLoading({ children = 'Loading your pharmacy order…' }) {
  return <div role="status" className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-6 text-base text-slate-700"><Loader2 className="h-6 w-6 animate-spin text-blue-700" aria-hidden="true" />{children}</div>;
}

export function DeliveryStatus({ status, deliveryType }) {
  const danger = ['cancelled', 'failed', 'returned', 'returning', 'booking_unknown', 'refund_pending', 'ledger_requires_review', 'reconciliation_required'].includes(status);
  return <span className={`inline-flex items-center rounded-full px-3 py-1.5 text-base font-medium ${danger ? 'bg-amber-50 text-amber-950' : 'bg-blue-50 text-blue-900'}`}>{status === 'ready_for_pickup' && deliveryType === 'delivery' ? 'Medicines ready' : statusLabel(status)}</span>;
}

export function DeliveryPriceLine({ label, kobo, emphasis = false, children }) {
  return <div className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-base ${emphasis ? 'border-t border-slate-200 pt-4 font-semibold text-slate-950' : 'text-slate-700'}`}><dt>{label}{children}</dt><dd className="tabular-nums">{formatKobo(kobo)}</dd></div>;
}

export function DeliveryReturnSummary({ returns }) {
  if (!returns?.receivedAt && !returns?.refundApprovalReference) return null;
  return <section className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-5"><h3 className="text-lg font-semibold text-slate-950">Returned medicine handling</h3><p className="leading-7 text-slate-700">Pharmacy receipt: {deliveryDate(returns.receivedAt)}. {returns.disposition === 'quarantined' ? 'The returned package is quarantined for pharmacist review.' : ''}</p>{returns.refundApprovalReference && <p className="leading-7 text-slate-700">A refund approval has been recorded. Payment-provider verification determines the actual refund status shown in the order’s payment records.</p>}</section>;
}

export function DeliverySteps({ status, pickup = false }) {
  const steps = pickup
    ? [{ key: 'confirmed', label: 'Pharmacy confirmed' }, { key: 'ready_for_pickup', label: 'Ready to collect' }, { key: 'collected', label: 'Collected' }]
    : [{ key: 'booked', label: 'Courier booked' }, { key: 'picked_up', label: 'Pharmacy pickup' }, { key: 'in_transit', label: 'On the way' }, { key: 'delivered', label: 'Delivered' }];
  const aliases = { pending: -1, courier_assigned: 0, assigned: 0, dispatched: 0, pickup: 0, pickup_complete: 1, dropoff: 2, dropoff_complete: 3, completed: pickup ? 2 : 3, fulfilled: pickup ? 2 : 3, preparing: 0 };
  const index = aliases[status] ?? steps.findIndex(step => step.key === status);
  return <ol aria-label={pickup ? 'Collection progress' : 'Courier progress'} className="grid gap-4 sm:grid-cols-2">
    {steps.map((step, position) => <li key={step.key} aria-current={index === position ? 'step' : undefined} className={`flex items-center gap-3 rounded-2xl border p-4 text-base ${position <= index ? 'border-blue-200 bg-blue-50/80 text-blue-950' : 'border-slate-200 bg-white text-slate-600'}`}>
      {position <= index ? <CheckCircle2 className="h-6 w-6 shrink-0 text-blue-700" aria-hidden="true" /> : position === 0 ? <Truck className="h-6 w-6 shrink-0" aria-hidden="true" /> : position === steps.length - 1 ? <PackageCheck className="h-6 w-6 shrink-0" aria-hidden="true" /> : <ShieldCheck className="h-6 w-6 shrink-0" aria-hidden="true" />}<span>{step.label}</span>
    </li>)}
  </ol>;
}
