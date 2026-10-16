'use client';

import { useParams } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import MedicationTracking from '@/components/ng/delivery/MedicationTracking';
import { DeliveryLoading, DeliveryNotice } from '@/components/ng/delivery/DeliveryPresentation';

export default function DeliveryTracking() {
  const { trackingId } = useParams();
  const { user, loading, isAuthenticated } = useAuth();
  if (loading || !isAuthenticated || !user?.id || user.role !== 'patient') return <DeliveryLoading>Checking secure delivery access…</DeliveryLoading>;
  if (!trackingId || typeof trackingId !== 'string') return <DeliveryNotice error>Select a valid delivery from your pharmacy order list.</DeliveryNotice>;
  return <MedicationTracking key={`${user.id}:${user.role}:${user.marketScope || user.market_scope || ''}:${trackingId}`} trackingId={trackingId} />;
}
