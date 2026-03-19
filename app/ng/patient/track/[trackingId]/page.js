'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import api from '@/lib/api';

export default function DeliveryTracking() {
  const { trackingId } = useParams();
  const [tracking, setTracking] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTracking();
    const interval = setInterval(loadTracking, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, [trackingId]);

  async function loadTracking() {
    try {
      const res = await api.get(`/api/ng/patient/tracking/${trackingId}`);
      setTracking(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const statusSteps = [
    { key: 'pending', label: 'Order Placed' },
    { key: 'assigned', label: 'Rider Assigned' },
    { key: 'picked_up', label: 'Picked Up' },
    { key: 'in_transit', label: 'In Transit' },
    { key: 'delivered', label: 'Delivered' },
  ];

  const currentIndex = tracking ? statusSteps.findIndex(s => s.key === tracking.status) : 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!tracking) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-gray-600">Tracking information not found</p>
          <Link href="/ng/patient/orders" className="text-green-600 underline mt-2 block">Back to Orders</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/ng/patient/orders" className="text-gray-500">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="font-bold text-gray-900">Delivery Tracking</h1>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6">
        {/* Order Info */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
          <p className="font-medium text-gray-900">{tracking.order_number}</p>
          <p className="text-sm text-gray-500">From {tracking.pharmacy_name}</p>
        </div>

        {/* Progress Steps */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-4">
          <div className="space-y-4">
            {statusSteps.map((step, i) => {
              const isActive = i <= currentIndex;
              const isCurrent = i === currentIndex;
              return (
                <div key={step.key} className="flex items-start gap-4">
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      isActive ? 'bg-green-600' : 'bg-gray-200'
                    } ${isCurrent ? 'ring-4 ring-green-100' : ''}`}>
                      {isActive ? (
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <div className="w-2 h-2 bg-gray-400 rounded-full" />
                      )}
                    </div>
                    {i < statusSteps.length - 1 && (
                      <div className={`w-0.5 h-8 ${i < currentIndex ? 'bg-green-600' : 'bg-gray-200'}`} />
                    )}
                  </div>
                  <div className="pt-1">
                    <p className={`text-sm font-medium ${isActive ? 'text-gray-900' : 'text-gray-400'}`}>
                      {step.label}
                    </p>
                    {step.key === 'assigned' && tracking.rider_name && isActive && (
                      <p className="text-xs text-gray-500">{tracking.rider_name}</p>
                    )}
                    {step.key === 'picked_up' && tracking.actual_pickup_at && (
                      <p className="text-xs text-gray-500">{new Date(tracking.actual_pickup_at).toLocaleTimeString()}</p>
                    )}
                    {step.key === 'delivered' && tracking.actual_delivery_at && (
                      <p className="text-xs text-gray-500">{new Date(tracking.actual_delivery_at).toLocaleTimeString()}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Rider Info */}
        {tracking.rider_name && tracking.status !== 'delivered' && (
          <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
            <h3 className="font-medium text-gray-900 mb-2">Your Rider</h3>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-900">{tracking.rider_name}</p>
                <p className="text-xs text-gray-500">{tracking.partner?.toUpperCase()}</p>
              </div>
              {tracking.rider_phone && (
                <a href={`tel:${tracking.rider_phone}`}
                  className="bg-green-100 text-green-700 px-4 py-2 rounded-lg text-sm font-medium">
                  Call Rider
                </a>
              )}
            </div>
          </div>
        )}

        {/* ETA */}
        {tracking.estimated_delivery_at && tracking.status !== 'delivered' && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
            <p className="text-sm text-green-700">Estimated Delivery</p>
            <p className="text-lg font-bold text-green-800">
              {new Date(tracking.estimated_delivery_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
            <p className="text-xs text-green-600">{tracking.distance_km}km away</p>
          </div>
        )}

        {tracking.status === 'delivered' && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-lg font-bold text-green-800">Delivered!</p>
            <p className="text-sm text-green-600">
              {tracking.actual_delivery_at && new Date(tracking.actual_delivery_at).toLocaleString()}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
