'use client';

import { useState } from 'react';
import {
  Package, Truck, CheckCircle, Clock, MapPin,
  Phone, Search, Filter, Banknote, User
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const ORDERS = [
  {
    id: 'ORD-001', patient: 'Blessing Eze', phone: '+234 905 xxx xxxx',
    items: 3, total: 6050, fulfillment: 'delivery',
    address: '14 Admiralty Way, Lekki Phase 1, Lagos',
    status: 'dispatched', rider: 'Kunle A.', eta: '25 min',
    createdAt: '2026-03-17T10:00:00'
  },
  {
    id: 'ORD-002', patient: 'Fatima Musa', phone: '+234 708 xxx xxxx',
    items: 1, total: 1500, fulfillment: 'pickup',
    address: null, status: 'ready', rider: null, eta: null,
    createdAt: '2026-03-17T09:45:00'
  },
  {
    id: 'ORD-003', patient: 'Tunde Balogun', phone: '+234 816 xxx xxxx',
    items: 1, total: 2200, fulfillment: 'delivery',
    address: '5 Allen Avenue, Ikeja, Lagos',
    status: 'delivered', rider: 'Emeka B.', eta: null,
    createdAt: '2026-03-17T08:30:00'
  },
  {
    id: 'ORD-004', patient: 'Ada Nwachukwu', phone: '+234 802 xxx xxxx',
    items: 2, total: 8400, fulfillment: 'pickup',
    address: null, status: 'ready', rider: null, eta: null,
    createdAt: '2026-03-17T08:00:00'
  },
  {
    id: 'ORD-005', patient: 'Yusuf Abdullahi', phone: '+234 703 xxx xxxx',
    items: 4, total: 12500, fulfillment: 'delivery',
    address: '22 Adeola Odeku, Victoria Island, Lagos',
    status: 'preparing', rider: null, eta: null,
    createdAt: '2026-03-17T07:15:00'
  },
];

const STATUS_MAP = {
  preparing: { label: 'Preparing', color: 'bg-yellow-500', text: 'text-yellow-600', bg: 'bg-yellow-500/10', icon: Clock },
  ready: { label: 'Ready for Pickup', color: 'bg-blue-500', text: 'text-blue-600', bg: 'bg-blue-500/10', icon: Package },
  dispatched: { label: 'Out for Delivery', color: 'bg-purple-500', text: 'text-purple-600', bg: 'bg-purple-500/10', icon: Truck },
  delivered: { label: 'Delivered', color: 'bg-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-500/10', icon: CheckCircle },
};

export default function PharmacyOrdersPage() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const filtered = ORDERS.filter(o => {
    const matchSearch = !search || o.patient.toLowerCase().includes(search.toLowerCase()) || o.id.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'all' || o.status === filter;
    return matchSearch && matchFilter;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Orders &amp; Fulfillment</h1>
        <p className="text-muted-foreground text-sm mt-1">Track pickups, deliveries, and order status</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Preparing', value: ORDERS.filter(o => o.status === 'preparing').length, color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
          { label: 'Ready', value: ORDERS.filter(o => o.status === 'ready').length, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'In Transit', value: ORDERS.filter(o => o.status === 'dispatched').length, color: 'text-purple-500', bg: 'bg-purple-500/10' },
          { label: 'Delivered', value: ORDERS.filter(o => o.status === 'delivered').length, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
        ].map((s, idx) => (
          <div key={idx} className={`${s.bg} rounded-xl p-4 border border-border`}>
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-muted-foreground font-medium">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search orders..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-2 flex-wrap">
          {['all', 'preparing', 'ready', 'dispatched', 'delivered'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors capitalize ${filter === f ? 'bg-purple-500/10 text-purple-600 border border-purple-500/20' : 'text-muted-foreground hover:bg-accent border border-border'}`}>
              {f === 'all' ? 'All' : STATUS_MAP[f]?.label || f}
            </button>
          ))}
        </div>
      </div>

      {/* Orders */}
      <div className="space-y-4">
        {filtered.map(order => {
          const st = STATUS_MAP[order.status];
          const StIcon = st.icon;
          return (
            <Card key={order.id} className="hover:border-purple-500/20 transition-colors">
              <CardContent className="p-5">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-start gap-4 flex-1">
                    <div className={`w-12 h-12 rounded-xl ${st.bg} flex items-center justify-center shrink-0`}>
                      <StIcon size={22} className={st.text} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-foreground">{order.patient}</span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${st.bg} ${st.text}`}>
                          <div className={`w-1.5 h-1.5 rounded-full ${st.color}`} />
                          {st.label}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {order.id} &bull; {order.items} item{order.items > 1 ? 's' : ''} &bull; ₦{order.total.toLocaleString()}
                      </div>
                      {order.fulfillment === 'delivery' && order.address && (
                        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                          <MapPin size={10} /> {order.address}
                        </div>
                      )}
                      {order.rider && (
                        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                          <Truck size={10} /> Rider: {order.rider} {order.eta && `• ETA: ${order.eta}`}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <div className={`px-3 py-1.5 rounded-lg text-xs font-medium ${order.fulfillment === 'delivery' ? 'bg-purple-500/10 text-purple-600' : 'bg-blue-500/10 text-blue-600'} flex items-center gap-1`}>
                      {order.fulfillment === 'delivery' ? <Truck size={12} /> : <Package size={12} />}
                      {order.fulfillment === 'delivery' ? 'Delivery' : 'Pickup'}
                    </div>
                    {order.status === 'preparing' && (
                      <Button size="sm" className="bg-blue-600 hover:bg-blue-500 text-white text-xs h-8">
                        <Package className="w-3 h-3 mr-1" /> Mark Ready
                      </Button>
                    )}
                    {order.status === 'ready' && order.fulfillment === 'delivery' && (
                      <Button size="sm" className="bg-purple-600 hover:bg-purple-500 text-white text-xs h-8">
                        <Truck className="w-3 h-3 mr-1" /> Dispatch
                      </Button>
                    )}
                    {order.status === 'ready' && order.fulfillment === 'pickup' && (
                      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs h-8">
                        <CheckCircle className="w-3 h-3 mr-1" /> Picked Up
                      </Button>
                    )}
                    {order.status === 'dispatched' && (
                      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs h-8">
                        <CheckCircle className="w-3 h-3 mr-1" /> Delivered
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="text-xs h-8">
                      <Phone className="w-3 h-3 mr-1" /> Call
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
