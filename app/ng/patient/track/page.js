'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import api from '@/lib/api';

const STATUS_STEPS = [
  { key: 'confirmed', label: 'Order Confirmed' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready_for_pickup', label: 'Ready' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'in_transit', label: 'In Transit' },
  { key: 'delivered', label: 'Delivered' },
];

function TrackOrderContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get('orderId');
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (orderId) loadOrder();
  }, [orderId]);

  async function loadOrder() {
    try {
      const res = await api.get(`/api/ng/patient/orders/${orderId}`);
      setOrder(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const formatNaira = (amount) => `₦${Number(amount || 0).toLocaleString()}`;

  const getStepIndex = (status) => {
    const idx = STATUS_STEPS.findIndex(s => s.key === status);
    return idx >= 0 ? idx : -1;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-gray-600 mb-4">Order not found</p>
          <Link href="/ng/patient/orders" className="text-green-600">View all orders</Link>
        </div>
      </div>
    );
  }

  const currentStep = getStepIndex(order.status);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/ng/patient/orders" className="text-gray-500 hover:text-gray-700">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="font-bold text-gray-900">Track Order</h1>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Order Info */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-6">
          <div className="flex justify-between items-start mb-3">
            <div>
              <p className="font-bold text-gray-900">{order.order_number}</p>
              <p className="text-sm text-gray-500">{order.pharmacy_name}</p>
            </div>
            <span className={`text-sm px-3 py-1 rounded-full font-medium ${
              order.status === 'delivered' ? 'bg-green-100 text-green-700' :
              order.status === 'cancelled' ? 'bg-red-100 text-red-700' :
              'bg-blue-100 text-blue-700'
            }`}>
              {order.status?.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="text-lg font-bold text-green-600">{formatNaira(order.total_amount)}</p>
        </div>

        {/* Progress Tracker */}
        {order.status !== 'cancelled' && (
          <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
            <h3 className="font-medium text-gray-900 mb-6">Delivery Progress</h3>
            <div className="space-y-4">
              {STATUS_STEPS.map((step, i) => {
                const isComplete = i <= currentStep;
                const isCurrent = i === currentStep;
                return (
                  <div key={step.key} className="flex items-start gap-3">
                    <div className="flex flex-col items-center">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center
                        ${isComplete ? 'bg-green-600' : 'bg-gray-200'}
                        ${isCurrent ? 'ring-4 ring-green-200' : ''}`}>
                        {isComplete ? (
                          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <span className="w-3 h-3 bg-gray-400 rounded-full" />
                        )}
                      </div>
                      {i < STATUS_STEPS.length - 1 && (
                        <div className={`w-0.5 h-8 ${isComplete ? 'bg-green-600' : 'bg-gray-200'}`} />
                      )}
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${isComplete ? 'text-gray-900' : 'text-gray-400'}`}>
                        {step.label}
                      </p>
                      {isCurrent && order.delivery_eta && (
                        <p className="text-xs text-green-600">
                          ETA: {new Date(order.delivery_eta).toLocaleTimeString()}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Rider Info */}
        {order.rider_name && (
          <div className="bg-white rounded-xl shadow-sm p-4 mb-6">
            <h3 className="font-medium text-gray-900 mb-3">Delivery Rider</h3>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <div>
                <p className="font-medium text-gray-900">{order.rider_name}</p>
                {order.rider_phone && (
                  <a href={`tel:${order.rider_phone}`} className="text-sm text-green-600">{order.rider_phone}</a>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Order Items */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h3 className="font-medium text-gray-900 mb-3">Order Items</h3>
          <div className="space-y-2">
            {(typeof order.items === 'string' ? JSON.parse(order.items) : order.items || []).map((item, i) => (
              <div key={i} className="flex justify-between text-sm py-1">
                <span className="text-gray-700">{item.drug_name} x{item.quantity}</span>
                <span className="text-gray-900 font-medium">{formatNaira(item.total_price)}</span>
              </div>
            ))}
            <div className="border-t pt-2 mt-2 space-y-1">
              <div className="flex justify-between text-sm text-gray-500">
                <span>Subtotal</span>
                <span>{formatNaira(order.subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm text-gray-500">
                <span>Delivery</span>
                <span>{formatNaira(order.delivery_fee)}</span>
              </div>
              <div className="flex justify-between text-sm text-gray-500">
                <span>VAT</span>
                <span>{formatNaira(order.vat_amount)}</span>
              </div>
              <div className="flex justify-between font-bold text-gray-900 pt-1 border-t">
                <span>Total</span>
                <span>{formatNaira(order.total_amount)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TrackOrder() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full" />
      </div>
    }>
      <TrackOrderContent />
    </Suspense>
  );
}
