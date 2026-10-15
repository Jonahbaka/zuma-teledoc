'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/providers/AuthProvider';
import MedicationCheckout from '@/components/ng/delivery/MedicationCheckout';
import { DeliveryLoading, DeliveryNotice } from '@/components/ng/delivery/DeliveryPresentation';

function OrderTrackingContent() {
  const search = useSearchParams();
  const { user, loading, isAuthenticated } = useAuth();
  const orderId = search.get('orderId');
  if (loading || !isAuthenticated || !user?.id || user.role !== 'patient') return <DeliveryLoading>Checking secure pharmacy access…</DeliveryLoading>;
  return <div className="space-y-5 text-base"><Link href="/ng/patient/orders" className="inline-flex min-h-12 items-center rounded-xl px-4 font-semibold text-blue-800">Back to pharmacy orders</Link>{orderId ? <MedicationCheckout key={`${user.id}:${user.role}:${user.marketScope || user.market_scope || ''}:${orderId}`} orderId={orderId} /> : <DeliveryNotice>Select an order from your pharmacy order list to review its payment and delivery status.</DeliveryNotice>}</div>;
}

export default function TrackOrder() {
  return <Suspense fallback={<DeliveryLoading>Loading your order…</DeliveryLoading>}><OrderTrackingContent /></Suspense>;
}
