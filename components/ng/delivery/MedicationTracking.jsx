'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { deliveryDate, deliveryError, readMedicationTracking, statusLabel } from '@/lib/ngDeliveryApi';
import { DeliveryLoading, DeliveryNotice, DeliveryStatus, DeliverySteps, deliveryButtonClass, deliveryCardClass } from './DeliveryPresentation';

export default function MedicationTracking({ trackingId }) {
  const [tracking, setTracking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(false);
  const request = useRef(0);
  const controller = useRef(null);
  const load = useCallback(async (initial = false) => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const current = ++request.current;
    if (initial) { setLoading(true); setTracking(null); } else setRefreshing(true);
    setError('');
    try {
      const response = await api.get(`/ng/patient/tracking/${encodeURIComponent(trackingId)}`, { signal: abort.signal });
      const data = readMedicationTracking(response.data, trackingId);
      if (active.current && !abort.signal.aborted && current === request.current) setTracking(data);
    } catch (failure) {
      if (active.current && !abort.signal.aborted && current === request.current) setError(deliveryError(failure, 'Private tracking is unavailable. Please try again.'));
    } finally {
      if (active.current && !abort.signal.aborted && current === request.current) { setLoading(false); setRefreshing(false); }
    }
  }, [trackingId]);
  useEffect(() => {
    active.current = true; load(true);
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 30000);
    return () => { active.current = false; request.current++; controller.current?.abort(); clearInterval(timer); };
  }, [load]);

  if (loading) return <DeliveryLoading>Loading your private delivery tracking…</DeliveryLoading>;
  return <div className="space-y-5 text-base">
    <DeliveryNotice error>{error}</DeliveryNotice>
    <section className={deliveryCardClass}><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="font-medium text-blue-800">DoctaRx private delivery tracking</p><h1 className="mt-3 break-words text-3xl font-semibold tracking-tight text-slate-950">{tracking?.orderNumber || 'Medication delivery'}</h1><p className="mt-3 leading-7 text-slate-600">Updates reflect recorded courier events. Arrival times are estimates.</p></div><Button variant="outline" className={deliveryButtonClass} disabled={refreshing} onClick={() => load()}><RefreshCw className={`mr-2 h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh tracking</Button></div></section>
    {!tracking ? <DeliveryNotice>Tracking is not available for this account. Check the order list or try again.</DeliveryNotice> : <>
      <section className={`${deliveryCardClass} space-y-5`}><div className="flex flex-wrap items-center justify-between gap-3"><DeliveryStatus status={tracking.status} /><p className="text-slate-700">{tracking.providerName || statusLabel(tracking.provider || tracking.partner)}</p></div><DeliverySteps status={tracking.status} /><div className="grid gap-4 sm:grid-cols-2"><p className="leading-7 text-slate-700"><span className="block font-semibold text-slate-950">{tracking.status === 'delivered' ? 'Delivery completed · Lagos time' : 'Estimated arrival · Lagos time'}</span>{deliveryDate(tracking.status === 'delivered' ? tracking.deliveryProof?.recordedAt : tracking.estimatedDeliveryAt || tracking.dropoffEta)}</p><p className="leading-7 text-slate-700"><span className="block font-semibold text-slate-950">Last recorded update</span>{deliveryDate(tracking.updatedAt)}</p></div>{['cancelled', 'failed', 'returned', 'returning', 'booking_unknown'].includes(tracking.status) && <DeliveryNotice>This delivery needs attention. Review your order for cancellation, return and verified refund status. DoctaRx will not treat an unresolved booking as a successful dispatch.</DeliveryNotice>}</section>
      <section className={`${deliveryCardClass} space-y-4`}><h2 className="text-xl font-semibold text-slate-950">Pickup & delivery evidence</h2><div className="grid gap-4 sm:grid-cols-2"><div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="font-medium text-slate-950">Proof of pharmacy pickup</p><p className="mt-2 leading-7 text-slate-700">{deliveryDate(tracking.pickupProof?.recordedAt)}</p></div><div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="font-medium text-slate-950">Proof of delivery</p><p className="mt-2 leading-7 text-slate-700">{deliveryDate(tracking.deliveryProof?.recordedAt)}</p></div></div><p className="flex items-start gap-3 leading-7 text-slate-600"><ShieldCheck className="mt-1 h-5 w-5 shrink-0 text-blue-700" aria-hidden="true" />Tracking is restricted to your signed-in account. Prescription details and medicine names are not included in courier tracking links.</p></section>
      <section className={`${deliveryCardClass} space-y-4`}><h2 className="text-xl font-semibold text-slate-950">Recorded delivery events</h2>{tracking.events.length ? <ol className="space-y-3">{tracking.events.map((event, index) => <li key={event.id || index} className="border-l-2 border-blue-200 pl-4"><p className="font-medium text-slate-950">{statusLabel(event.status || event.type || event.action)}</p><p className="mt-1 leading-7 text-slate-600">{deliveryDate(event.recordedAt || event.createdAt || event.created_at)}</p></li>)}</ol> : <p className="leading-7 text-slate-600">No courier events have been recorded yet.</p>}</section>
      <Link href={`/ng/patient/track?orderId=${encodeURIComponent(tracking.orderId)}`} className="inline-flex min-h-12 items-center rounded-xl bg-blue-700 px-5 py-3 font-semibold text-white">Review order, payments & refunds</Link>
    </>}
    <Link href="/ng/patient/orders" className="inline-flex min-h-12 items-center rounded-xl px-4 font-semibold text-blue-800">Back to pharmacy orders</Link>
  </div>;
}
