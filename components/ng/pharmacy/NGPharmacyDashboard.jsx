'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  LayoutDashboard, Package, ClipboardList, Truck,
  Loader, User, RefreshCw,
} from 'lucide-react';
import api from '@/lib/api';
import { formatNaira } from '@/lib/ngPharmacyPortal';
import { useAuth } from '@/components/providers/AuthProvider';

/* ---------- Dashboard view ---------- */
const DashboardView = ({ stats, wallet }) => (
  <div className="space-y-6">
    <div className="flex justify-between items-center">
      <h2 className="text-xl font-bold">Operational Overview</h2>
    </div>

    <p className="leading-7 text-slate-600">Counts reflect the pharmacy records loaded in this view.</p>

    <div className="grid gap-5 sm:grid-cols-3">
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <p className="text-slate-500 text-sm font-bold uppercase">Pending E-Dispense</p>
        <div className="text-3xl font-bold mt-2">{stats?.pendingCount ?? '—'}</div>
      </div>
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <p className="text-slate-500 text-sm font-bold uppercase">Inventory Alerts</p>
        <div className="text-3xl font-bold mt-2 text-rose-600">{stats?.alertCount ?? '—'}</div>
      </div>
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <p className="text-slate-500 text-sm font-bold uppercase">Wallet Balance</p>
        <div className="text-3xl font-bold mt-2">{wallet?.balance != null ? formatNaira(wallet.balance) : '—'}</div>
      </div>
    </div>

    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
      <h3 className="font-semibold">Dispensing activity</h3>
      <p className="mt-3 leading-7 text-slate-600">A validated dispensing trend is not available for this workspace. Review the recorded prescriptions and orders for current activity.</p>
    </div>
  </div>
);

/* ---------- Inventory view ---------- */
const InventoryView = ({ inventory }) => {
  const items = inventory || [];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">Stock Management</h2>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 text-slate-500 text-xs font-bold uppercase">
            <tr>
              <th className="p-4">Drug Name</th>
              <th className="p-4">Stock</th>
              <th className="p-4">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={3} className="p-4 text-center text-slate-400 text-sm">No inventory data available.</td></tr>
            ) : (
              items.map((item, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="p-4 font-bold">{item.name || item.drug_name}</td>
                  <td className="p-4">{item.stock ?? item.quantity_available ?? '—'}</td>
                  <td className="p-4">
                    <span className={`px-2 py-1 rounded text-xs ${item.status === 'Low' ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700'}`}>
                      {item.status || 'Status not recorded'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* ---------- RX Queue view ---------- */
const RxQueueView = ({ prescriptions }) => (
  <div className="space-y-4">
    <h2 className="text-xl font-bold">Prescription Queue</h2>
    <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
      <table className="w-full min-w-[560px] text-left">
        <thead className="bg-slate-50 text-slate-500 text-xs font-bold uppercase">
          <tr>
            <th className="p-4">Rx ID</th>
            <th className="p-4">Patient</th>
            <th className="p-4">Drug</th>
            <th className="p-4">Status</th>
          </tr>
        </thead>
        <tbody>
          {prescriptions.length === 0 ? (
            <tr><td colSpan={4} className="p-4 text-center text-slate-400 text-sm">No prescriptions in queue.</td></tr>
          ) : (
            prescriptions.slice(0, 20).map((rx, i) => (
              <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="p-4 font-mono text-blue-600 text-sm">{rx.prescription_number || rx.id || rx.prescription_id || 'Not recorded'}</td>
                <td className="p-4">{[rx.patient_first_name, rx.patient_last_name].filter(Boolean).join(' ') || rx.patient_name || 'Not recorded'}</td>
                <td className="p-4 text-sm">{Array.isArray(rx.items) ? rx.items.map((item) => item.drug_name || item.medicationName || item.name).filter(Boolean).join(', ') || 'Not recorded' : rx.drug_name || rx.medication_name || 'Not recorded'}</td>
                <td className="p-4">
                  <span className="px-2 py-1 rounded text-xs bg-amber-100 text-amber-700">
                    {String(rx.pharmacy_response_status || rx.status || 'Status not recorded').replace(/_/g, ' ')}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  </div>
);

/* ---------- Delivery view ---------- */
const DeliveryView = ({ orders }) => (
  <div className="space-y-4">
    <div className="flex justify-between items-center">
      <h2 className="text-xl font-bold">Orders &amp; Delivery</h2>
    </div>
    <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
      <table className="w-full min-w-[560px] text-left">
        <thead className="bg-slate-50 text-slate-500 text-xs font-bold uppercase">
          <tr>
            <th className="p-4">Order #</th>
            <th className="p-4">Patient</th>
            <th className="p-4">Total</th>
            <th className="p-4">Status</th>
          </tr>
        </thead>
        <tbody>
          {orders.length === 0 ? (
            <tr><td colSpan={4} className="p-4 text-center text-slate-400 text-sm">No orders found.</td></tr>
          ) : (
            orders.slice(0, 20).map((o, i) => (
              <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="p-4 font-mono font-bold text-blue-600 text-sm">{o.order_number || o.id}</td>
                <td className="p-4 flex items-center space-x-2">
                  <User size={16} className="text-slate-400" />
                  <span>{o.first_name || ''} {o.last_name || ''}</span>
                </td>
                <td className="p-4">{o.total_amount != null ? formatNaira(o.total_amount) : '—'}</td>
                <td className="p-4">
                  <span className={`px-2 py-1 rounded text-xs font-bold ${
                    String(o.status).includes('transit') ? 'bg-amber-100 text-amber-700' :
                    String(o.status).includes('fulfilled') || String(o.status).includes('delivered') ? 'bg-blue-100 text-blue-700' :
                    'bg-rose-100 text-rose-700'
                  }`}>
                    {String(o.status || 'Status not recorded').replace(/_/g, ' ')}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  </div>
);

/* ---------- Main export ---------- */
export default function NGPharmacyDashboard() {
  const { user } = useAuth();
  const [activeView, setActiveView] = useState('Dashboard');
  const [loading, setLoading] = useState(true);
  const [workspace, setWorkspace] = useState(null);
  const [errors, setErrors] = useState({});
  const request = useRef(null);
  const [dashboardData, setDashboardData] = useState({
    stats: {},
    orders: [],
    wallet: {},
    alerts: [],
    inventory: [],
    prescriptions: [],
  });
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setErrors({}); setWorkspace(null);
    setDashboardData({ stats: {}, orders: [], wallet: {}, alerts: [], inventory: [], prescriptions: [] });
    try {
      const { data: ws } = await api.get('/ng/pharmacy/me', { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!ws?.id) { setErrors({ workspace: 'No pharmacy workspace is assigned to this account. Contact your administrator.' }); return; }
      setWorkspace(ws);
      const sections = ['prescriptions', 'orders', 'wallet', 'alerts', 'inventory'];
      const paths = ['prescriptions', 'orders', 'wallet', 'inventory/alerts', 'inventory'];
      const result = await Promise.allSettled(paths.map((path) => api.get('/ng/pharmacy/' + ws.id + '/' + path, { params: { limit: 100 }, signal: controller.signal })));
      if (controller.signal.aborted) return;
      const next = { stats: {}, orders: [], wallet: {}, alerts: [], inventory: [], prescriptions: [] };
      const failed = {};
      result.forEach((outcome, index) => {
        const section = sections[index];
        const data = outcome.status === 'fulfilled' ? outcome.value.data : null;
        const valid = section === 'wallet' ? data && typeof data === 'object' && !Array.isArray(data) && data.balance != null : section === 'inventory' ? Array.isArray(data?.items) : Array.isArray(data);
        if (!valid) { failed[section] = 'Pharmacy ' + section + ' could not be loaded. Refresh to try again.'; return; }
        next[section] = section === 'inventory' ? data.items.map((item) => ({ ...item, name: item.drug_name, stock: item.quantity_available, status: Number.isFinite(Number(item.quantity_available)) && item.quantity_available != null && item.reorder_level != null ? Number(item.quantity_available) <= Number(item.reorder_level) ? 'Low' : 'Above reorder level' : 'Status not recorded' })) : data;
      });
      if (!failed.prescriptions) next.stats.pendingCount = next.prescriptions.filter((item) => ['pending_pharmacy_confirmation', 'pharmacy_reviewing', 'clarification_requested'].includes(String(item.pharmacy_response_status || item.status))).length;
      if (!failed.alerts) next.stats.alertCount = next.alerts.length;
      setErrors(failed); setDashboardData(next);
    } catch (failure) {
      if (!controller.signal.aborted) setErrors({ workspace: [401, 403].includes(failure.response?.status) ? 'Your account is not authorized to open this pharmacy workspace.' : 'The pharmacy workspace could not be loaded. Refresh to try again.' });
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);

  useEffect(() => { load(); return () => request.current?.abort(); }, [load, user?.id]);

  const renderContent = () => {
    if (loading) {
      return (
        <div role="status" className="flex items-center justify-center h-64 text-slate-600">
          <Loader size={32} className="animate-spin mr-3" /> Loading pharmacy data...
        </div>
      );
    }
    if (errors.workspace) return null;
    switch (activeView) {
      case 'Dashboard':
        return <DashboardView stats={dashboardData.stats} wallet={dashboardData.wallet} />;
      case 'Inventory':
        return errors.inventory ? null : <InventoryView inventory={dashboardData.inventory} />;
      case 'Prescriptions':
        return errors.prescriptions ? null : <RxQueueView prescriptions={dashboardData.prescriptions} />;
      case 'Delivery':
        return errors.orders ? null : <DeliveryView orders={dashboardData.orders} />;
      default:
        return <div className="p-8 text-center text-slate-400">Module under development</div>;
    }
  };

  return (
    /* fixed overlay so this full-screen UI renders on top of NigeriaPharmacyPortalShell */
    <div className="doctarx-portal clinical-readable fixed inset-0 z-50 flex min-h-screen w-full flex-col bg-[#F8FAFC] font-sans text-slate-900 md:h-screen md:flex-row">

      {/* Sidebar */}
      <aside className="w-full bg-slate-900 text-slate-300 flex flex-col shrink-0 md:w-[240px]">
        <div className="h-20 flex items-center px-6 border-b border-slate-800">
          <div>
            <span className="font-bold text-lg text-white block">DoctaRx Pharmacy</span>
            <span className="text-base text-slate-300">Clinical workspace</span>
          </div>
        </div>
        <nav aria-label="Pharmacy navigation" className="flex flex-wrap gap-2 p-4 md:block md:flex-1 md:space-y-2">
          {[
            { name: 'Dashboard', icon: LayoutDashboard },
            { name: 'Prescriptions', icon: ClipboardList },
            { name: 'Inventory', icon: Package },
            { name: 'Delivery', icon: Truck },
          ].map((item) => (
            <button
              key={item.name}
              aria-pressed={activeView === item.name}
              onClick={() => setActiveView(item.name)}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg ${activeView === item.name ? 'bg-blue-600 text-white' : 'hover:bg-slate-800'}`}
            >
              <item.icon size={20} />
              <span className="font-medium text-sm">{item.name}</span>
            </button>
          ))}
        </nav>

        {/* Workspace info footer */}
        {workspace && (
          <div className="p-4 border-t border-slate-800 m-4 bg-slate-800 rounded-xl text-xs text-slate-300">
            <p className="font-bold text-white truncate">{workspace.name}</p>
            <p className="mt-1 truncate">{workspace.city}, {workspace.state}</p>
          </div>
        )}
      </aside>

      {/* Main content */}
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-5 sm:p-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4"><h1 className="text-3xl font-semibold">Pharmacy workspace</h1><button onClick={load} disabled={loading} className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 font-medium text-slate-700 disabled:opacity-50"><RefreshCw size={20} aria-hidden="true" />Refresh</button></div>
        {Object.values(errors).map((message) => <p key={message} role="alert" className="portal-error mb-5">{message}</p>)}
        {renderContent()}
      </main>
    </div>
  );
}
