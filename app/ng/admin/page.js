'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import api from '@/lib/api';

export default function NigeriaAdminDashboard() {
  const [dashboard, setDashboard] = useState(null);
  const [pendingPharmacies, setPendingPharmacies] = useState([]);
  const [topPharmacies, setTopPharmacies] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    try {
      const [dashRes, pendingRes, topRes] = await Promise.all([
        api.get('/api/ng/admin/analytics/dashboard').catch(() => ({ data: {} })),
        api.get('/api/ng/admin/pharmacies/pending?limit=5').catch(() => ({ data: { pharmacies: [] } })),
        api.get('/api/ng/admin/analytics/top-pharmacies').catch(() => ({ data: [] })),
      ]);
      setDashboard(dashRes.data);
      setPendingPharmacies(pendingRes.data.pharmacies || []);
      setTopPharmacies(topRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(pharmacyId, approved) {
    try {
      await api.post(`/api/ng/admin/pharmacies/${pharmacyId}/verify`, {
        approved,
        rejectionReason: approved ? null : 'Did not meet PCN requirements',
      });
      loadDashboard();
    } catch (err) {
      console.error(err);
    }
  }

  const formatNaira = (amount) => `₦${Number(amount || 0).toLocaleString()}`;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  const stats = dashboard || {};

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">Rx</span>
            </div>
            <h1 className="font-bold text-gray-900">Nigeria Admin</h1>
          </div>
          <nav className="flex gap-4 text-sm">
            <Link href="/ng/admin/pharmacies" className="text-gray-600 hover:text-green-600">Pharmacies</Link>
            <Link href="/ng/admin/analytics" className="text-gray-600 hover:text-green-600">Analytics</Link>
            <Link href="/ng/admin/compliance" className="text-gray-600 hover:text-green-600">Compliance</Link>
            <Link href="/ng/admin/revenue" className="text-gray-600 hover:text-green-600">Revenue</Link>
          </nav>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <p className="text-sm text-gray-500">Active Pharmacies</p>
            <p className="text-3xl font-bold text-gray-900">{stats.pharmacies?.active_pharmacies || 0}</p>
            <p className="text-xs text-yellow-600">{stats.pharmacies?.pending_pharmacies || 0} pending</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <p className="text-sm text-gray-500">Total Orders</p>
            <p className="text-3xl font-bold text-gray-900">{stats.orders?.total_orders || 0}</p>
            <p className="text-xs text-green-600">{stats.orders?.today_orders || 0} today</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <p className="text-sm text-gray-500">Platform GMV</p>
            <p className="text-3xl font-bold text-green-600">{formatNaira(stats.orders?.total_gmv)}</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <p className="text-sm text-gray-500">Platform Revenue</p>
            <p className="text-3xl font-bold text-green-600">{formatNaira(stats.revenue?.total_rx_fees)}</p>
            <p className="text-xs text-gray-500">RX fees + subscriptions</p>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Pending Pharmacies */}
          <div className="bg-white rounded-xl shadow-sm">
            <div className="px-4 py-3 border-b flex justify-between items-center">
              <h3 className="font-bold text-gray-900">Pending Approvals</h3>
              <Link href="/ng/admin/pharmacies" className="text-sm text-green-600">View All</Link>
            </div>
            {pendingPharmacies.length === 0 ? (
              <div className="p-6 text-center text-gray-500 text-sm">No pending pharmacies</div>
            ) : (
              <div className="divide-y">
                {pendingPharmacies.map(p => (
                  <div key={p.id} className="px-4 py-3">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{p.name}</p>
                        <p className="text-xs text-gray-500">{p.city}, {p.state} — PCN: {p.pcn_license_number}</p>
                        <p className="text-xs text-gray-400">
                          Superintendent: {p.superintendent_name} ({p.superintendent_pcn_number})
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        p.status === 'documents_submitted' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {p.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleVerify(p.id, true)}
                        className="text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700">
                        Approve
                      </button>
                      <button onClick={() => handleVerify(p.id, false)}
                        className="text-xs bg-red-100 text-red-700 px-3 py-1 rounded hover:bg-red-200">
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top Pharmacies */}
          <div className="bg-white rounded-xl shadow-sm">
            <div className="px-4 py-3 border-b">
              <h3 className="font-bold text-gray-900">Top Pharmacies by Revenue</h3>
            </div>
            {topPharmacies.length === 0 ? (
              <div className="p-6 text-center text-gray-500 text-sm">No data yet</div>
            ) : (
              <div className="divide-y">
                {topPharmacies.slice(0, 10).map((p, i) => (
                  <div key={p.id} className="px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-gray-400 w-6">{i + 1}</span>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{p.name}</p>
                        <p className="text-xs text-gray-500">{p.city}, {p.state} — {p.order_count} orders</p>
                      </div>
                    </div>
                    <span className="text-sm font-bold text-green-600">{formatNaira(p.revenue)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
