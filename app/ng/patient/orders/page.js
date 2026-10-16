'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Package, RefreshCw, ShieldCheck, Truck } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import PortalPageHeader from '@/components/branding/PortalPageHeader';
import MedicationCheckout from '@/components/ng/delivery/MedicationCheckout';
import MedicationOrderStart from '@/components/ng/delivery/MedicationOrderStart';
import { DeliveryLoading, DeliveryNotice, DeliveryStatus, deliveryButtonClass, deliveryCardClass } from '@/components/ng/delivery/DeliveryPresentation';
import { deliveryError, getPatientMedicationOrders, orderItems } from '@/lib/ngDeliveryApi';

function PatientOrdersWorkspace() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [loadError, setLoadError] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const requestId = useRef(0);
  const abort = useRef(null);

  const loadOrders = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController(); abort.current = controller;
    const current = ++requestId.current;
    setLoading(true); setLoadError(''); setOrders([]);
    try {
      const result = await getPatientMedicationOrders(filter === 'all' ? undefined : { status: filter }, controller.signal);
      if (!controller.signal.aborted && current === requestId.current) setOrders(result);
    } catch (error) {
      if (!controller.signal.aborted && current === requestId.current) setLoadError(deliveryError(error, 'Your orders could not be loaded. Please try again.'));
    } finally {
      if (!controller.signal.aborted && current === requestId.current) setLoading(false);
    }
  }, [filter]);

  useEffect(() => { loadOrders(); return () => { abort.current?.abort(); }; }, [loadOrders]);

  return <div className="space-y-6 text-base">
    <PortalPageHeader title="Your pharmacy orders" description="Choose pharmacy collection or approved courier delivery. Review every charge before you pay.">
      <Link href="/ng/patient/prescriptions"><Button variant="outline" className={deliveryButtonClass}>Prescriptions</Button></Link>
      <Button variant="outline" className={deliveryButtonClass} onClick={loadOrders} disabled={loading}><RefreshCw className="mr-2 h-5 w-5" aria-hidden="true" />Refresh orders</Button>
    </PortalPageHeader>

    <div className="flex items-start gap-3 rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 to-cyan-50 p-5 text-base leading-7 text-blue-950"><ShieldCheck className="mt-1 h-6 w-6 shrink-0" aria-hidden="true" /><p>Your pharmacy confirms the medicines and final price. Delivery is paid separately after preparation, using a fresh approved courier quote.</p></div>
    <MedicationOrderStart onCreated={orderId => { setSelectedOrder(orderId); loadOrders(); }} />
    {selectedOrder && <MedicationCheckout key={selectedOrder} orderId={selectedOrder} onClose={() => setSelectedOrder(null)} onChanged={loadOrders} />}

    <nav aria-label="Filter pharmacy orders" className="flex flex-wrap gap-2">
      {[['all', 'All orders'], ['pending', 'Awaiting confirmation'], ['confirmed', 'Preparing'], ['ready_for_pickup', 'Ready'], ['dispatched', 'With courier'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']].map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`min-h-12 rounded-full border px-5 py-3 text-base font-medium transition-colors ${filter === value ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-400'}`}>{label}</button>)}
    </nav>

    {loadError && <><DeliveryNotice error>{loadError}</DeliveryNotice><Button variant="outline" className={deliveryButtonClass} onClick={loadOrders}>Try again</Button></>}
    {loading ? <DeliveryLoading>Loading your pharmacy orders…</DeliveryLoading> : !loadError && orders.length === 0 ? <div className={`${deliveryCardClass} py-12 text-center`}><Package className="mx-auto h-12 w-12 text-blue-700" aria-hidden="true" /><h2 className="mt-5 text-xl font-semibold text-slate-950">No orders in this view</h2><p className="mx-auto mt-3 max-w-lg leading-7 text-slate-600">Pharmacy orders linked to your prescriptions appear here. Your pharmacy must confirm availability before checkout.</p><Link href="/ng/patient/prescriptions" className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-xl px-4 text-base font-semibold text-blue-800">Review prescriptions<ArrowRight className="h-5 w-5" aria-hidden="true" /></Link></div> : <div className="grid gap-5 lg:grid-cols-2">{orders.map(order => {
      const items = orderItems(order.items);
      return <article key={order.id} className={`${deliveryCardClass} flex min-w-0 flex-col`}>
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="break-words text-xl font-semibold text-slate-950">{order.order_number || 'Pharmacy order'}</h2><DeliveryStatus status={order.status} deliveryType={order.delivery_type} /></div>
        <p className="mt-3 font-medium text-slate-700">{order.pharmacy_name || 'Assigned pharmacy'}</p>
        <ul className="mt-5 space-y-2 text-slate-700">{items.map((item, index) => <li key={item.drug_id || index} className="break-words">{item.drug_name || item.name || 'Medicine'} × {item.quantity}</li>)}</ul>
        <p className="mt-5 border-t border-slate-200 pt-4 leading-7 text-slate-600">{order.delivery_type === 'pickup' ? 'Collect from pharmacy · no courier charge' : order.delivery_type === 'delivery' ? 'Delivery · courier price confirmed separately' : 'Collection or delivery choice pending'}</p>
        <div className="mt-auto flex flex-wrap gap-3 pt-6"><Button onClick={() => setSelectedOrder(order.id)} className={`${deliveryButtonClass} bg-blue-700 text-white hover:bg-blue-800`}>Review order & checkout</Button>{order.delivery_tracking_id && <Link href={`/ng/patient/track/${encodeURIComponent(order.delivery_tracking_id)}`}><Button variant="outline" className={deliveryButtonClass}><Truck className="mr-2 h-5 w-5" aria-hidden="true" />Track delivery</Button></Link>}</div>
      </article>;
    })}</div>}
  </div>;
}

export default function NigeriaPatientOrdersPage() {
  const { user, loading, isAuthenticated } = useAuth();
  if (loading || !isAuthenticated || !user?.id || user.role !== 'patient') return <DeliveryLoading>Checking your secure pharmacy access…</DeliveryLoading>;
  return <PatientOrdersWorkspace key={`${user.id}:${user.role}:${user.marketScope || user.market_scope || ''}`} />;
}
