'use client';

import { useEffect, useState } from 'react';
import NigeriaPharmacyPortalShell from '@/components/ng/NigeriaPharmacyPortalShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchNigeriaPharmacyWorkspace, formatNaira, getNigeriaStatusTone } from '@/lib/ngPharmacyPortal';
import api from '@/lib/api';

export default function NigeriaPharmacyOrdersPage() {
  const [loading, setLoading] = useState(true);
  const [workspace, setWorkspace] = useState(null);
  const [orders, setOrders] = useState([]);
  const [medicationRequests, setMedicationRequests] = useState([]);
  const [requestNotes, setRequestNotes] = useState({});
  const [requestPrices, setRequestPrices] = useState({});
  const [requestClarifications, setRequestClarifications] = useState({});
  const [notice, setNotice] = useState('');

  const loadOrders = async () => {
    const pharmacyWorkspace = await fetchNigeriaPharmacyWorkspace().catch(() => null);
    setWorkspace(pharmacyWorkspace);

    if (!pharmacyWorkspace?.id) {
      setOrders([]);
      setMedicationRequests([]);
      setLoading(false);
      return;
    }

    const [ordersResponse, medicationRequestsResponse] = await Promise.all([
      api.get(`/ng/pharmacy/${pharmacyWorkspace.id}/orders`).catch(() => ({ data: [] })),
      api.get(`/ng/pharmacy/${pharmacyWorkspace.id}/medication-requests`).catch((error) => {
        setNotice(error.response?.data?.error || '');
        return { data: [] };
      }),
    ]);

    setOrders(Array.isArray(ordersResponse.data) ? ordersResponse.data : []);
    setMedicationRequests(Array.isArray(medicationRequestsResponse.data) ? medicationRequestsResponse.data : []);
    setLoading(false);
  };

  useEffect(() => {
    loadOrders();
  }, []);

  const updateOrderStatus = async (orderId, action) => {
    if (!workspace?.id) return;
    setNotice('');
    try {
      await api.post(`/ng/pharmacy/${workspace.id}/orders/${orderId}/${action}`);
      setNotice(`Order ${action === 'confirm' ? 'confirmed' : 'marked ready'}.`);
      await loadOrders();
    } catch (error) {
      setNotice(error.response?.data?.error || 'Unable to update this order.');
    }
  };

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
      setNotice(error.response?.data?.error || 'Unable to update this medication request.');
    }
  };

  return (
    <NigeriaPharmacyPortalShell>
      <div className="space-y-6">
        <section>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Pharmacy Orders</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Prescription fulfillment queue</h1>
          <p className="mt-2 text-sm text-muted-foreground">Confirm, prepare, and complete pharmacy orders from the actual Nigeria pharmacy operations portal.</p>
        </section>

        {notice ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div> : null}

        {loading ? (
          <Card className="border-border/70">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">Loading orders...</CardContent>
          </Card>
        ) : !workspace ? (
          <Card className="border-border/70">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">Complete pharmacy onboarding to receive routed orders.</CardContent>
          </Card>
        ) : orders.length === 0 ? (
          <Card className="border-border/70">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">No routed orders are waiting for this pharmacy.</CardContent>
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
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getNigeriaStatusTone(order.status)}`}>
                          {String(order.status || '').replace(/_/g, ' ')}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">{order.first_name} {order.last_name}</p>
                      <p className="text-sm text-muted-foreground">Phone: {order.phone_number || 'Unavailable'}</p>
                    </div>
                    <div className="space-y-3 text-right">
                      <p className="text-xl font-bold text-foreground">{formatNaira(order.total_amount)}</p>
                      <div className="flex flex-wrap justify-end gap-2">
                        {String(order.status || '').toLowerCase() === 'confirmed' ? (
                          <Button onClick={() => updateOrderStatus(order.id, 'ready')} className="bg-emerald-600 text-white hover:bg-emerald-500">
                            Mark Ready
                          </Button>
                        ) : null}
                        {String(order.status || '').toLowerCase() === 'pending' ? (
                          <Button onClick={() => updateOrderStatus(order.id, 'confirm')} className="bg-emerald-600 text-white hover:bg-emerald-500">
                            Confirm Order
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {!loading && workspace ? (
          <section className="space-y-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Medication Availability Requests</p>
              <h2 className="mt-2 text-xl font-bold tracking-tight text-slate-950">Patient medication confirmation queue</h2>
              <p className="mt-1 text-sm text-slate-700">
                Respond to requests routed to this pharmacy. This updates the patient request only; admin verification is still required before inventory appears as verified live availability.
              </p>
            </div>

            {medicationRequests.length === 0 ? (
              <Card className="border-border/70 bg-white text-slate-950">
                <CardContent className="p-8 text-center text-sm text-slate-600">No medication availability requests are routed to this pharmacy.</CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {medicationRequests.map((request) => (
                  <Card key={request.id} className="border-border/70 bg-white text-slate-950">
                    <CardContent className="space-y-4 p-5">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <p className="text-lg font-semibold text-slate-950">{request.medicine_name}</p>
                          <p className="mt-1 text-sm text-slate-700">
                            {[request.generic_name, request.city, request.state].filter(Boolean).join(' | ') || 'Manual medication request'}
                          </p>
                          <p className="mt-1 text-sm text-slate-700">Fulfillment: {String(request.fulfillment_preference || 'pharmacy confirmation').replace(/_/g, ' ')}</p>
                          <p className="mt-1 text-xs text-slate-600">Catalog source: {request.source_name || request.source_reference || 'Manual request, source pending admin review'}</p>
                        </div>
                        <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${getNigeriaStatusTone(request.status)}`}>
                          {String(request.status || '').replace(/_/g, ' ')}
                        </span>
                      </div>

                      <div className="grid gap-2 text-sm text-slate-700 md:grid-cols-3">
                        <p>Contact: {request.contact_name || 'Name not provided'}</p>
                        <p>Phone: {request.phone || 'Not provided'}</p>
                        <p>Email: {request.email || 'Not provided'}</p>
                      </div>

                      {request.prescription_attached || request.prescription_attachment_url ? (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                          Prescription reference provided. Confirm medication availability only after pharmacist review.
                        </div>
                      ) : null}

                      <textarea
                        value={requestNotes[request.id] || ''}
                        onChange={(event) => setRequestNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                        placeholder="Optional response note for DoctaRx admin and care coordination"
                        className="min-h-[92px] w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-950 placeholder:text-slate-500"
                      />

                      <div className="grid gap-3 md:grid-cols-2">
                        <input
                          value={requestPrices[request.id] || ''}
                          onChange={(event) => setRequestPrices((current) => ({ ...current, [request.id]: event.target.value }))}
                          placeholder="Confirmed price, if available"
                          inputMode="decimal"
                          className="h-11 rounded-2xl border border-slate-300 bg-white px-3 text-sm text-slate-950 placeholder:text-slate-500"
                        />
                        <input
                          value={requestClarifications[request.id] || ''}
                          onChange={(event) => setRequestClarifications((current) => ({ ...current, [request.id]: event.target.value }))}
                          placeholder="Clarification needed, if any"
                          className="h-11 rounded-2xl border border-slate-300 bg-white px-3 text-sm text-slate-950 placeholder:text-slate-500"
                        />
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => respondToMedicationRequest(request.id, 'pharmacy_reviewing')}>
                          Review Request
                        </Button>
                        <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-500" onClick={() => respondToMedicationRequest(request.id, 'available')}>
                          Confirm Available
                        </Button>
                        <Button size="sm" variant="outline" className="text-rose-700" onClick={() => respondToMedicationRequest(request.id, 'unavailable')}>
                          Mark Unavailable
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => respondToMedicationRequest(request.id, 'clarification_requested')}>
                          Request Clarification
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => respondToMedicationRequest(request.id, 'fulfilled')}>
                          Mark Fulfilled
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => respondToMedicationRequest(request.id, 'completed')}>
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
