'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import api from '@/lib/api';

export default function PharmacyDashboard() {
  const [stats, setStats] = useState(null);
  const [orders, setOrders] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pharmacyId, setPharmacyId] = useState(null);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    try {
      await api.get('/api/auth/me').catch(() => ({ data: null }));

      const pharmaciesRes = await api.get('/api/ng/admin/pharmacies?status=approved&limit=1');
      const pharmacy = pharmaciesRes.data?.[0];
      if (!pharmacy) {
        setLoading(false);
        return;
      }
      setPharmacyId(pharmacy.id);

      const [statsRes, ordersRes, walletRes, alertsRes] = await Promise.all([
        api.get(`/api/ng/pharmacy/${pharmacy.id}/inventory/stats`).catch(() => ({ data: {} })),
        api.get(`/api/ng/pharmacy/${pharmacy.id}/orders?limit=10`).catch(() => ({ data: [] })),
        api.get(`/api/ng/pharmacy/${pharmacy.id}/wallet`).catch(() => ({ data: {} })),
        api.get(`/api/ng/pharmacy/${pharmacy.id}/inventory/alerts`).catch(() => ({ data: [] })),
      ]);

      setStats(statsRes.data);
      setOrders(ordersRes.data);
      setWallet(walletRes.data);
      setAlerts(alertsRes.data);
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
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

  if (!pharmacyId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center rounded-[1.8rem] border border-gray-200 bg-white p-8 shadow-sm">
          <h2 className="text-xl font-bold text-gray-900 mb-2">No Pharmacy Found</h2>
          <p className="text-gray-600 mb-4">Register your pharmacy to get started.</p>
          <Link href="/ng/pharmacy/onboarding" className="inline-flex rounded-lg bg-green-600 px-6 py-3 font-medium text-white">
            Register Pharmacy
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.12),transparent_30%),linear-gradient(180deg,#f8fafc,#ecfeff)]">
      <div className="flex">
        <aside className="hidden lg:block w-64 bg-white border-r min-h-screen p-4">
          <div className="flex items-center space-x-2 mb-8">
            <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">Rx</span>
            </div>
            <span className="font-bold text-gray-900">Pharmacy Portal</span>
          </div>
          <nav className="space-y-1">
            {[
              { name: 'Dashboard', href: '/ng/pharmacy/dashboard', active: true },
              { name: 'Orders', href: '/ng/pharmacy/orders' },
              { name: 'Inventory', href: '/ng/pharmacy/inventory' },
              { name: 'Wallet', href: '/ng/pharmacy/wallet' },
              { name: 'Settings', href: '/ng/pharmacy/settings' },
            ].map((item) => (
              <Link
                key={item.name}
                href={item.href}
                className={`block px-3 py-2 rounded-lg text-sm ${
                  item.active ? 'bg-green-50 text-green-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {item.name}
              </Link>
            ))}
          </nav>
        </aside>

        <main className="flex-1 p-4 sm:p-6">
          <section className="mb-6 rounded-[1.8rem] border border-emerald-200/70 bg-white/82 p-5 shadow-sm backdrop-blur-xl">
            <div className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-700">Pharmacy Operations</div>
            <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Dashboard</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
                  Inventory, routed orders, and settlement visibility now fit naturally on mobile and tablet without pushing key actions off-screen.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                {[
                  { name: 'Orders', href: '/ng/pharmacy/orders' },
                  { name: 'Inventory', href: '/ng/pharmacy/inventory' },
                  { name: 'Wallet', href: '/ng/pharmacy/wallet' },
                  { name: 'Settings', href: '/ng/pharmacy/settings' },
                ].map((item) => (
                  <Link
                    key={item.name}
                    href={item.href}
                    className="rounded-full border border-gray-200 bg-white px-4 py-2 text-center text-sm font-medium text-gray-700 transition-colors hover:border-green-200 hover:text-green-600"
                  >
                    {item.name}
                  </Link>
                ))}
              </div>
            </div>
          </section>

          <section className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <p className="text-sm text-gray-500">Wallet Balance</p>
              <p className="text-2xl font-bold text-green-600">{formatNaira(wallet?.balance)}</p>
              <p className="text-xs text-gray-400">Pending: {formatNaira(wallet?.pending_balance)}</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <p className="text-sm text-gray-500">Today&apos;s Earnings</p>
              <p className="text-2xl font-bold text-gray-900">{formatNaira(wallet?.todayEarnings)}</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <p className="text-sm text-gray-500">Total Products</p>
              <p className="text-2xl font-bold text-gray-900">{stats?.totalItems || 0}</p>
              {stats?.lowStockItems > 0 ? (
                <p className="text-xs text-red-500">{stats.lowStockItems} low stock</p>
              ) : null}
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <p className="text-sm text-gray-500">Stock Value</p>
              <p className="text-2xl font-bold text-gray-900">{formatNaira(stats?.totalStockValue)}</p>
            </div>
          </section>

          {alerts.length > 0 ? (
            <section className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
              <h3 className="font-medium text-red-800 mb-2">Low Stock Alerts ({alerts.length})</h3>
              <div className="space-y-1">
                {alerts.slice(0, 5).map((alert) => (
                  <p key={alert.id} className="text-sm text-red-700">
                    {alert.drug_name} | {alert.quantity_available} left (reorder at {alert.reorder_level})
                  </p>
                ))}
              </div>
            </section>
          ) : null}

          <section className="bg-white rounded-xl shadow-sm">
            <div className="px-4 py-3 border-b flex justify-between items-center gap-3">
              <h3 className="font-medium text-gray-900">Recent Orders</h3>
              <Link href="/ng/pharmacy/orders" className="text-sm text-green-600 hover:underline">View All</Link>
            </div>
            {orders.length === 0 ? (
              <div className="p-8 text-center text-gray-500">No orders yet</div>
            ) : (
              <div className="divide-y">
                {orders.map((order) => (
                  <div key={order.id} className="px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{order.order_number}</p>
                      <p className="text-xs text-gray-500">
                        {order.first_name} {order.last_name} | {new Date(order.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="sm:text-right">
                      <p className="text-sm font-medium">{formatNaira(order.total_amount)}</p>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                        order.status === 'delivered'
                          ? 'bg-green-100 text-green-700'
                          : order.status === 'confirmed'
                            ? 'bg-blue-100 text-blue-700'
                            : order.status === 'cancelled'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {order.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
