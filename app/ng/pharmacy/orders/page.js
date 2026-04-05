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
  const [notice, setNotice] = useState('');

  const loadOrders = async () => {
    const pharmacyWorkspace = await fetchNigeriaPharmacyWorkspace().catch(() => null);
    setWorkspace(pharmacyWorkspace);

    if (!pharmacyWorkspace?.id) {
      setOrders([]);
      setLoading(false);
      return;
    }

    const response = await api.get(`/api/ng/pharmacy/${pharmacyWorkspace.id}/orders`).catch(() => ({ data: [] }));
    setOrders(Array.isArray(response.data) ? response.data : []);
    setLoading(false);
  };

  useEffect(() => {
    loadOrders();
  }, []);

  const updateOrderStatus = async (orderId, action) => {
    if (!workspace?.id) return;
    setNotice('');
    try {
      await api.post(`/api/ng/pharmacy/${workspace.id}/orders/${orderId}/${action}`);
      setNotice(`Order ${action === 'confirm' ? 'confirmed' : 'marked ready'}.`);
      await loadOrders();
    } catch (error) {
      setNotice(error.response?.data?.error || 'Unable to update this order.');
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
      </div>
    </NigeriaPharmacyPortalShell>
  );
}
