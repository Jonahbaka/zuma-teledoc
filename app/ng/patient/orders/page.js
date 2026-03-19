'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import api from '@/lib/api';

export default function PatientOrders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => { loadOrders(); }, [filter]);

  async function loadOrders() {
    try {
      const params = filter !== 'all' ? `?status=${filter}` : '';
      const res = await api.get(`/api/ng/patient/orders${params}`);
      setOrders(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function cancelOrder(orderId) {
    if (!confirm('Cancel this order?')) return;
    try {
      await api.post(`/api/ng/patient/orders/${orderId}/cancel`, { reason: 'Changed mind' });
      loadOrders();
    } catch (err) {
      alert(err.response?.data?.error || 'Cancel failed');
    }
  }

  const formatNaira = (amt) => `₦${Number(amt || 0).toLocaleString()}`;
  const statusColor = {
    pending: 'bg-yellow-100 text-yellow-700',
    confirmed: 'bg-blue-100 text-blue-700',
    preparing: 'bg-indigo-100 text-indigo-700',
    dispatched: 'bg-purple-100 text-purple-700',
    in_transit: 'bg-purple-100 text-purple-700',
    delivered: 'bg-green-100 text-green-700',
    cancelled: 'bg-red-100 text-red-700',
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/ng" className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">Rx</span>
            </Link>
            <h1 className="font-bold text-gray-900">My Orders</h1>
          </div>
          <Link href="/ng/patient/search" className="text-sm bg-green-600 text-white px-4 py-2 rounded-lg">
            New Order
          </Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Filter */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
          {['all', 'pending', 'confirmed', 'preparing', 'dispatched', 'delivered', 'cancelled'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-sm whitespace-nowrap ${
                filter === f ? 'bg-green-600 text-white' : 'bg-white text-gray-600 border'
              }`}>
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full" />
          </div>
        ) : orders.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center">
            <p className="text-gray-500 mb-4">No orders found</p>
            <Link href="/ng/patient/search" className="text-green-600 underline">Search for medications</Link>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map(order => {
              const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
              return (
                <div key={order.id} className="bg-white rounded-xl shadow-sm p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-medium text-gray-900">{order.order_number}</p>
                      <p className="text-xs text-gray-500">
                        {order.pharmacy_name} — {new Date(order.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor[order.status] || 'bg-gray-100'}`}>
                      {order.status?.replace(/_/g, ' ')}
                    </span>
                  </div>

                  <div className="text-sm text-gray-600 space-y-0.5 mb-2">
                    {items?.slice(0, 3).map((item, i) => (
                      <p key={i}>{item.drug_name} x{item.quantity} — {formatNaira(item.total_price)}</p>
                    ))}
                    {items?.length > 3 && <p className="text-gray-400">+{items.length - 3} more items</p>}
                  </div>

                  <div className="flex justify-between items-center pt-2 border-t">
                    <span className="font-bold text-gray-900">{formatNaira(order.total_amount)}</span>
                    <div className="flex gap-2">
                      {order.status === 'pending' && order.payment_status !== 'completed' && (
                        <Link href={`/ng/patient/orders/${order.id}/pay`}
                          className="text-xs bg-green-600 text-white px-3 py-1 rounded">
                          Pay Now
                        </Link>
                      )}
                      {order.delivery_tracking_id && (
                        <Link href={`/ng/patient/track/${order.delivery_tracking_id}`}
                          className="text-xs bg-purple-100 text-purple-700 px-3 py-1 rounded">
                          Track
                        </Link>
                      )}
                      {['pending', 'confirmed'].includes(order.status) && (
                        <button onClick={() => cancelOrder(order.id)}
                          className="text-xs bg-red-100 text-red-700 px-3 py-1 rounded">
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
