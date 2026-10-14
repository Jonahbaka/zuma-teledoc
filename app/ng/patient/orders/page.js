'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2, Package, RefreshCw, Truck } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import PortalPageHeader from '@/components/branding/PortalPageHeader';

function formatNaira(amount) {
  return `NGN ${Number(amount || 0).toLocaleString()}`;
}

function getStatusTone(status) {
  const normalized = String(status || '').toLowerCase();

  if (['delivered'].includes(normalized)) return 'bg-blue-100 text-blue-700';
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
  const [loadError, setLoadError] = useState('');
  const requestId = useRef(0);

  const loadOrders = useCallback(async () => {
    const current = ++requestId.current;
    setLoading(true); setLoadError(''); setOrders([]);
    try {
      const params = filter === 'all' ? undefined : { status: filter };
      const response = await api.get('/ng/patient/orders', { params });
      if (!Array.isArray(response.data)) throw new Error();
      if (current === requestId.current) setOrders(response.data);
    } catch {
      if (current === requestId.current) setLoadError('Orders could not be loaded. Please try again.');
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const visibleOrders = orders;

  const payForOrder = async (orderId) => {
    setNotice('');
    try {
      const response = await api.post(`/ng/patient/orders/${orderId}/pay`);
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
      await api.post(`/ng/patient/orders/${orderId}/cancel`, { reason: 'Patient cancelled from portal' });
      setNotice('Order cancelled.');
      await loadOrders();
    } catch (error) {
      setNotice(error.response?.data?.error || 'Unable to cancel this order.');
    }
  };

  return (
    <div className="space-y-6">
      <PortalPageHeader title="Pharmacy orders" description="Check your order status, delivery progress, and payment details."><Link href="/ng/patient/prescriptions"><Button variant="outline">Prescriptions</Button></Link></PortalPageHeader>

      {notice ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{notice}</div>
      ) : null}

      {loadError && <div className="portal-error"><p role="alert">{loadError}</p><Button variant="outline" className="mt-3" onClick={loadOrders}>Try again</Button></div>}

      <section className="flex flex-wrap gap-2">
        {['all', 'pending', 'confirmed', 'preparing', 'dispatched', 'delivered', 'cancelled'].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              filter === value ? 'bg-blue-600 text-white' : 'border border-border bg-card text-muted-foreground hover:text-foreground'
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
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : visibleOrders.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center">
              <Package className="mx-auto h-10 w-10 text-blue-500/60" />
              <p className="mt-4 font-semibold text-foreground">No orders found.</p>
              <p className="mt-2 text-sm text-muted-foreground">Once a pharmacy order has been created, it will appear here with payment and tracking status.</p>
            </div>
          ) : (
            visibleOrders.map((order) => {
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
                          <Button onClick={() => payForOrder(order.id)} className="bg-blue-600 text-white hover:bg-blue-500">
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
