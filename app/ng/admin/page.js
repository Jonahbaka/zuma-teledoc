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

  const formatNaira = (amount) => `N${Number(amount || 0).toLocaleString()}`;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  const stats = dashboard || {};

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.12),transparent_28%),linear-gradient(180deg,#f8fafc,#f0fdf4)]">
      <header className="sticky top-0 z-20 border-b bg-white/88 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-green-600 flex items-center justify-center shadow-sm">
              <span className="text-white font-bold text-sm">Rx</span>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-green-700">Nigeria Admin</p>
              <h1 className="font-semibold text-gray-900">Operations workspace</h1>
            </div>
          </div>
          <nav className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <Link href="/ng/admin/pharmacies" className="rounded-full border border-gray-200 bg-white px-4 py-2 text-center text-sm text-gray-600 transition-colors hover:border-green-200 hover:text-green-600">Pharmacies</Link>
            <Link href="/ng/admin/analytics" className="rounded-full border border-gray-200 bg-white px-4 py-2 text-center text-sm text-gray-600 transition-colors hover:border-green-200 hover:text-green-600">Analytics</Link>
            <Link href="/ng/admin/compliance" className="rounded-full border border-gray-200 bg-white px-4 py-2 text-center text-sm text-gray-600 transition-colors hover:border-green-200 hover:text-green-600">Compliance</Link>
            <Link href="/ng/admin/revenue" className="rounded-full border border-gray-200 bg-white px-4 py-2 text-center text-sm text-gray-600 transition-colors hover:border-green-200 hover:text-green-600">Revenue</Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 space-y-6">
        <section className="rounded-[1.8rem] border border-emerald-200/70 bg-white/82 px-5 py-5 shadow-sm backdrop-blur-xl">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-700">Operations Pulse</p>
          <h2 className="mt-2 text-2xl font-bold text-gray-900 sm:text-3xl">
            Pharmacy approvals, revenue, and compliance in one compact view.
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
            This dashboard now stays readable on phone and tablet so you can review approvals and revenue without horizontal overflow.
          </p>
        </section>

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
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
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="bg-white rounded-xl shadow-sm">
            <div className="px-4 py-3 border-b flex items-center justify-between gap-3">
              <h3 className="font-bold text-gray-900">Pending Approvals</h3>
              <Link href="/ng/admin/pharmacies" className="text-sm text-green-600">View All</Link>
            </div>
            {pendingPharmacies.length === 0 ? (
              <div className="p-6 text-center text-gray-500 text-sm">No pending pharmacies</div>
            ) : (
              <div className="divide-y">
                {pendingPharmacies.map((pharmacy) => (
                  <div key={pharmacy.id} className="px-4 py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 text-sm">{pharmacy.name}</p>
                        <p className="text-xs text-gray-500">
                          {pharmacy.city}, {pharmacy.state} | PCN: {pharmacy.pcn_license_number}
                        </p>
                        <p className="text-xs text-gray-400">
                          Superintendent: {pharmacy.superintendent_name} ({pharmacy.superintendent_pcn_number})
                        </p>
                      </div>
                      <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs ${
                        pharmacy.status === 'documents_submitted' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {String(pharmacy.status || '').replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <button
                        onClick={() => handleVerify(pharmacy.id, true)}
                        className="rounded-lg bg-green-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-green-700"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleVerify(pharmacy.id, false)}
                        className="rounded-lg bg-red-100 px-3 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-200"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm">
            <div className="px-4 py-3 border-b">
              <h3 className="font-bold text-gray-900">Top Pharmacies by Revenue</h3>
            </div>
            {topPharmacies.length === 0 ? (
              <div className="p-6 text-center text-gray-500 text-sm">No data yet</div>
            ) : (
              <div className="divide-y">
                {topPharmacies.slice(0, 10).map((pharmacy, index) => (
                  <div key={pharmacy.id} className="px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <span className="w-6 text-sm font-medium text-gray-400">{index + 1}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900">{pharmacy.name}</p>
                        <p className="text-xs text-gray-500">{pharmacy.city}, {pharmacy.state} | {pharmacy.order_count} orders</p>
                      </div>
                    </div>
                    <span className="text-sm font-bold text-green-600 sm:text-right">{formatNaira(pharmacy.revenue)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
