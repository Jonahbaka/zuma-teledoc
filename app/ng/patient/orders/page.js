'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Package, RefreshCw, Truck } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function formatNaira(amount) {
  return `NGN ${Number(amount || 0).toLocaleString()}`;
}

function getStatusTone(status) {
  const normalized = String(status || '').toLowerCase();

  if (['delivered'].includes(normalized)) return 'bg-emerald-100 text-emerald-700';
  if (['confirmed', 'preparing', 'ready_for_pickup'].includes(normalized)) return 'bg-sky-100 text-sky-700';
  if (['pending'].includes(normalized)) return 'bg-amber-100 text-amber-700';
  if (['cancelled'].includes(normalized)) return 'bg-rose-100 text-rose-700';
  return 'bg-slate-100 text-slate-700';
}

export default function NigeriaPatientOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [notice, setNotice] = useState('');

  const loadOrders = async () => {
    try {
      const params = filter === 'all' ? undefined : { status: filter };
      const response = await api.get('/api/ng/patient/orders', { params });
      setOrders(Array.isArray(response.data) ? response.data : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, [filter]);

  const payForOrder = async (orderId) => {
    setNotice('');
    try {
      const response = await api.post(`/api/ng/patient/orders/${orderId}/pay`);
      const authorizationUrl = response.data?.authorizationUrl || response.data?.checkoutUrl || response.data?.paymentUrl;

      if (authorizationUrl && typeof window !== 'undefined') {
        window.location.href = authorizationUrl;
        return;
      }

      setNotice('Payment was initiated, but no redirect URL was returned.');
    } catch (error) {
      setNotice(error.response?.data?.error || 'Unable to start payment for this order.');
    }
  };

  const cancelOrder = async (orderId) => {
    setNotice('');
    try {
      await api.post(`/api/ng/patient/orders/${orderId}/cancel`, { reason: 'Patient cancelled from portal' });
      setNotice('Order cancelled.');
      await loadOrders();
    } catch (error) {
      setNotice(error.response?.data?.error || 'Unable to cancel this order.');
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-emerald-200/70 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.14),transparent_35%),linear-gradient(145deg,rgba(255,255,255,0.96),rgba(236,253,245,0.92))] px-5 py-6 shadow-sm sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Pharmacy Orders</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Track medication fulfillment and payment</h1>
            <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">
              Review routed pharmacy orders, open delivery tracking, and complete payment using the actual Nigeria order APIs already connected in the platform.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/ng/patient/search">
              <Button className="bg-emerald-600 text-white hover:bg-emerald-500">Search Medication</Button>
            </Link>
            <Link href="/ng/patient/prescriptions">
              <Button variant="outline">Open Prescriptions</Button>
            </Link>
          </div>
        </div>
      </section>

      {notice ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>
      ) : null}

      <section className="flex flex-wrap gap-2">
        {['all', 'pending', 'confirmed', 'preparing', 'dispatched', 'delivered', 'cancelled'].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              filter === value ? 'bg-emerald-600 text-white' : 'border border-border bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            {value === 'all' ? 'All' : value.replace(/_/g, ' ')}
          </button>
        ))}
      </section>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>Order tracker</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="py-8 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-emerald-600" />
            </div>
          ) : orders.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center">
              <Package className="mx-auto h-10 w-10 text-emerald-500/60" />
              <p className="mt-4 font-semibold text-foreground">No orders found.</p>
              <p className="mt-2 text-sm text-muted-foreground">Once a pharmacy order has been created, it will appear here with payment and tracking status.</p>
            </div>
          ) : (
            orders.map((order) => {
              const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items || [];

              return (
                <div key={order.id} className="rounded-2xl border border-border px-4 py-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-foreground">{order.order_number}</p>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusTone(order.status)}`}>
                          {String(order.status || '').replace(/_/g, ' ')}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">{order.pharmacy_name}</p>
                      <div className="space-y-1 text-sm text-slate-600">
                        {items.slice(0, 3).map((item, index) => (
                          <p key={`${item.drug_name || 'item'}-${index}`}>
                            {item.drug_name} × {item.quantity} • {formatNaira(item.total_price)}
                          </p>
                        ))}
                        {items.length > 3 ? <p className="text-muted-foreground">+{items.length - 3} more item(s)</p> : null}
                      </div>
                    </div>

                    <div className="flex min-w-[220px] flex-col gap-3">
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">Total</p>
                        <p className="text-xl font-bold text-foreground">{formatNaira(order.total_amount)}</p>
                      </div>
                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        {order.payment_status !== 'completed' && order.status === 'pending' ? (
                          <Button onClick={() => payForOrder(order.id)} className="bg-emerald-600 text-white hover:bg-emerald-500">
                            Pay Now
                          </Button>
                        ) : null}
                        {order.delivery_tracking_id ? (
                          <Link href={`/ng/patient/track/${order.delivery_tracking_id}`}>
                            <Button variant="outline">
                              <Truck className="mr-2 h-4 w-4" />
                              Track
                            </Button>
                          </Link>
                        ) : null}
                        {['pending', 'confirmed'].includes(String(order.status || '').toLowerCase()) ? (
                          <Button variant="outline" onClick={() => cancelOrder(order.id)}>
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Cancel
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
