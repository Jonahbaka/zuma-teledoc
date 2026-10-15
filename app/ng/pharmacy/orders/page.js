'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import PharmacyMedicationOrder from '@/components/ng/delivery/PharmacyMedicationOrder';
import { DeliveryLoading, DeliveryNotice, DeliveryStatus, deliveryButtonClass } from '@/components/ng/delivery/DeliveryPresentation';
import NigeriaPharmacyPortalShell from '@/components/ng/NigeriaPharmacyPortalShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { fetchNigeriaPharmacyWorkspace } from '@/lib/ngPharmacyPortal';
import api from '@/lib/api';

function PharmacyOrdersWorkspace() {
  const [loading, setLoading] = useState(true);
  const [workspace, setWorkspace] = useState(null);
  const [orders, setOrders] = useState([]);
  const [medicationRequests, setMedicationRequests] = useState([]);
  const [requestNotes, setRequestNotes] = useState({});
  const [requestPrices, setRequestPrices] = useState({});
  const [requestClarifications, setRequestClarifications] = useState({});
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const active = useRef(false);
  const readSequence = useRef(0);

  const loadOrders = async () => {
    const current = ++readSequence.current;
    setLoading(true); setLoadError('');
    try {
      const pharmacyWorkspace = await fetchNigeriaPharmacyWorkspace();
      if (!active.current || current !== readSequence.current) return;
      setWorkspace(pharmacyWorkspace);
      if (!pharmacyWorkspace?.id) { setOrders([]); setMedicationRequests([]); return; }
      const [ordersResponse, medicationResponse] = await Promise.all([
        api.get(`/ng/pharmacy/${pharmacyWorkspace.id}/orders`),
        api.get(`/ng/pharmacy/${pharmacyWorkspace.id}/medication-requests`),
      ]);
      if (!Array.isArray(ordersResponse.data) || !Array.isArray(medicationResponse.data)) throw new Error('Pharmacy records could not be confirmed.');
      if (!active.current || current !== readSequence.current) return;
      setOrders(ordersResponse.data); setMedicationRequests(medicationResponse.data);
    } catch (error) {
      if (active.current && current === readSequence.current) { setLoadError(error.response?.data?.error || 'Pharmacy orders could not be loaded. Please try again.'); setOrders([]); setMedicationRequests([]); }
    } finally { if (active.current && current === readSequence.current) setLoading(false); }
  };

  useEffect(() => { active.current = true; loadOrders(); return () => { active.current = false; }; }, []);

  const respondToMedicationRequest = async (requestId, status) => {
    if (!workspace?.id) return;
    setNotice('');
    try {
      await api.patch(`/ng/pharmacy/${workspace.id}/medication-requests/${requestId}`, {
        status,
        pharmacyResponseNotes: requestNotes[requestId] || null,
        pharmacyNotes: requestNotes[requestId] || null,
        confirmedPriceNgn: requestPrices[requestId] || null,
        clarificationRequest: requestClarifications[requestId] || null,
      });
      if (!active.current) return;
      setNotice(status === 'available'
        ? 'Medication request marked available for this patient request.'
        : status === 'unavailable'
          ? 'Medication request marked unavailable.'
          : status === 'clarification_requested'
            ? 'Clarification requested for this medication request.'
            : 'Medication request updated.');
      setRequestNotes((current) => ({ ...current, [requestId]: '' }));
      setRequestPrices((current) => ({ ...current, [requestId]: '' }));
      setRequestClarifications((current) => ({ ...current, [requestId]: '' }));
      await loadOrders();
    } catch (error) {
      if (active.current) setNotice(error.response?.data?.error || 'Unable to update this medication request.');
    }
  };

  return (
    <NigeriaPharmacyPortalShell>
      <div className="space-y-6 text-base">
        <section>
          <p className="font-medium text-blue-800">DoctaRx pharmacy operations</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Prescription fulfillment queue</h1>
          <p className="mt-2 text-base text-muted-foreground">Verify prescriptions and prices, prepare medicines, and manage secure collection or approved courier delivery.</p>
        </section>

        <DeliveryNotice>{notice}</DeliveryNotice>
        <DeliveryNotice error>{loadError}</DeliveryNotice>
        {loadError && <Button variant="outline" className={deliveryButtonClass} onClick={loadOrders}>Try again</Button>}

        {loading ? (
          <Card className="border-border/70">
            <CardContent className="p-8 text-center text-base text-muted-foreground">Loading orders...</CardContent>
          </Card>
        ) : loadError ? null : !workspace ? (
          <Card className="border-border/70">
            <CardContent className="p-8 text-center text-base text-muted-foreground">Complete pharmacy onboarding to receive routed orders.</CardContent>
          </Card>
        ) : orders.length === 0 ? (
          <Card className="border-border/70">
            <CardContent className="p-8 text-center text-base text-muted-foreground">No routed orders are waiting for this pharmacy.</CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <Card key={order.id} className="border-border/70">
                <CardContent className="p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-foreground">{order.order_number}</p>
                        <DeliveryStatus status={order.status} deliveryType={order.delivery_type} />
                      </div>
                      <p className="text-base text-muted-foreground">{order.first_name} {order.last_name}</p>
                      <p className="text-base text-muted-foreground">Phone: {order.phone_number || 'Unavailable'}</p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <Button className={`${deliveryButtonClass} bg-blue-700 hover:bg-blue-800`} onClick={() => setSelectedOrder(current => current === order.id ? null : order.id)} aria-expanded={selectedOrder === order.id}>
                        {selectedOrder === order.id ? 'Close fulfillment' : 'Review & fulfill order'}
                      </Button>
                    </div>
                  </div>
                  {selectedOrder === order.id && <PharmacyMedicationOrder key={order.id} orderId={order.id} pharmacyId={workspace.id} onChanged={loadOrders} />}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {!loading && workspace ? (
          <section className="space-y-3">
            <div>
              <p className="text-base font-semibold uppercase tracking-[0.22em] text-blue-800">Medication Availability Requests</p>
              <h2 className="mt-2 text-xl font-bold tracking-tight text-slate-950">Patient medication confirmation queue</h2>
              <p className="mt-1 text-base text-slate-700">
                Respond to requests routed to this pharmacy. This updates the patient request only; admin verification is still required before inventory appears as verified live availability.
              </p>
            </div>

            {medicationRequests.length === 0 ? (
              <Card className="border-border/70 bg-white text-slate-950">
                <CardContent className="p-8 text-center text-base text-slate-600">No medication availability requests are routed to this pharmacy.</CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {medicationRequests.map((request) => (
                  <Card key={request.id} className="border-border/70 bg-white text-slate-950">
                    <CardContent className="space-y-4 p-5">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <p className="text-lg font-semibold text-slate-950">{request.medicine_name}</p>
                          <p className="mt-1 text-base text-slate-700">
                            {[request.generic_name, request.city, request.state].filter(Boolean).join(' | ') || 'Manual medication request'}
                          </p>
                          <p className="mt-1 text-base text-slate-700">Fulfillment: {String(request.fulfillment_preference || 'pharmacy confirmation').replace(/_/g, ' ')}</p>
                          <p className="mt-1 text-base text-slate-600">Catalog source: {request.source_name || request.source_reference || 'Manual request, source pending admin review'}</p>
                        </div>
                        <DeliveryStatus status={request.status} />
                      </div>

                      <div className="grid gap-2 text-base text-slate-700 md:grid-cols-3">
                        <p>Contact: {request.contact_name || 'Name not provided'}</p>
                        <p>Phone: {request.phone || 'Not provided'}</p>
                        <p>Email: {request.email || 'Not provided'}</p>
                      </div>

                      {request.prescription_attached || request.prescription_attachment_url ? (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-base text-amber-900">
                          Prescription reference provided. Confirm medication availability only after pharmacist review.
                        </div>
                      ) : null}

                      <textarea
                        aria-label={`Pharmacy response note for ${request.medicine_name}`}
                        value={requestNotes[request.id] || ''}
                        onChange={(event) => setRequestNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                        placeholder="Optional response note for DoctaRx admin and care coordination"
                        className="min-h-[92px] w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 text-base text-slate-950 placeholder:text-slate-500"
                      />

                      <div className="grid gap-3 md:grid-cols-2">
                        <input
                          aria-label={`Confirmed medicine price for ${request.medicine_name}`}
                          value={requestPrices[request.id] || ''}
                          onChange={(event) => setRequestPrices((current) => ({ ...current, [request.id]: event.target.value }))}
                          placeholder="Confirmed price, if available"
                          inputMode="decimal"
                          className="min-h-12 rounded-2xl border border-slate-300 bg-white px-3 text-base text-slate-950 placeholder:text-slate-500"
                        />
                        <input
                          aria-label={`Clarification request for ${request.medicine_name}`}
                          value={requestClarifications[request.id] || ''}
                          onChange={(event) => setRequestClarifications((current) => ({ ...current, [request.id]: event.target.value }))}
                          placeholder="Clarification needed, if any"
                          className="min-h-12 rounded-2xl border border-slate-300 bg-white px-3 text-base text-slate-950 placeholder:text-slate-500"
                        />
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button className={deliveryButtonClass} variant="outline" onClick={() => respondToMedicationRequest(request.id, 'pharmacy_reviewing')}>
                          Review Request
                        </Button>
                        <Button className={`${deliveryButtonClass} bg-blue-700 text-white hover:bg-blue-800`} onClick={() => respondToMedicationRequest(request.id, 'available')}>
                          Confirm Available
                        </Button>
                        <Button variant="outline" className={`${deliveryButtonClass} text-rose-700`} onClick={() => respondToMedicationRequest(request.id, 'unavailable')}>
                          Mark Unavailable
                        </Button>
                        <Button className={deliveryButtonClass} variant="outline" onClick={() => respondToMedicationRequest(request.id, 'clarification_requested')}>
                          Request Clarification
                        </Button>
                        <Button className={deliveryButtonClass} variant="outline" onClick={() => respondToMedicationRequest(request.id, 'fulfilled')}>
                          Mark Fulfilled
                        </Button>
                        <Button className={deliveryButtonClass} variant="outline" onClick={() => respondToMedicationRequest(request.id, 'completed')}>
                          Complete
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>
        ) : null}
      </div>
    </NigeriaPharmacyPortalShell>
  );
}

export default function NigeriaPharmacyOrdersPage() {
  const { user, loading, isAuthenticated } = useAuth();
  if (loading || !isAuthenticated || !user?.id || user.role !== 'pharmacy') return <DeliveryLoading>Checking authorized pharmacy access…</DeliveryLoading>;
  return <PharmacyOrdersWorkspace key={`${user.id}:${user.role}:${user.marketScope || user.market_scope || ''}`} />;
}
