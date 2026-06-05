'use client';

import { useState, useEffect } from 'react';
import {
  LayoutDashboard, Package, ClipboardList, Truck, Bell,
  X, Loader, Sparkles, User,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  fetchNigeriaPharmacyDashboard,
  fetchNigeriaPharmacyWorkspace,
  formatNaira,
} from '@/lib/ngPharmacyPortal';

/* ---------- AI insight helper — calls server-side route (key never exposed to browser) ---------- */
const callGemini = async (prompt) => {
  try {
    const res = await fetch('/ng/ai-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    return data.text || 'No insights generated.';
  } catch (err) {
    return `AI Insight service unavailable: ${err.message}`;
  }
};

/* ---------- AI modal ---------- */
const AIModal = ({ isOpen, onClose, content, loading }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg p-6 shadow-2xl border border-slate-200">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-lg text-indigo-900 flex items-center">
            <Sparkles size={20} className="mr-2 text-indigo-600" /> AI Pharmacy Insight
          </h3>
          <button onClick={onClose}><X size={20} className="text-slate-400" /></button>
        </div>
        {loading ? (
          <div className="h-64 flex flex-col items-center justify-center text-slate-500">
            <Loader size={32} className="animate-spin text-indigo-600 mb-4" />
            Analyzing system data...
          </div>
        ) : (
          <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto">
            {content}
          </div>
        )}
      </div>
    </div>
  );
};

/* ---------- Volume chart data (fallback until real analytics endpoint is available) ---------- */
const fallbackVolumeData = [
  { name: 'Mon', vol: 40 }, { name: 'Tue', vol: 30 }, { name: 'Wed', vol: 55 },
  { name: 'Thu', vol: 45 }, { name: 'Fri', vol: 70 }, { name: 'Sat', vol: 30 },
];

/* ---------- Dashboard view ---------- */
const DashboardView = ({ onAiClick, stats, orders, wallet }) => (
  <div className="space-y-6">
    <div className="flex justify-between items-center">
      <h2 className="text-xl font-bold">Operational Overview</h2>
      <button onClick={onAiClick} className="flex items-center space-x-2 px-4 py-2 bg-indigo-50 text-indigo-700 rounded-lg text-sm font-bold hover:bg-indigo-100">
        <Sparkles size={16} /> <span>Get Executive Summary</span>
      </button>
    </div>

    <div className="grid grid-cols-3 gap-6">
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

    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm h-80">
      <h3 className="font-bold mb-4">Dispensing Volume (E-Dispense)</h3>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={fallbackVolumeData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip />
          <Area type="monotone" dataKey="vol" stroke="#4f46e5" fill="#e0e7ff" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  </div>
);

/* ---------- Inventory view ---------- */
const InventoryView = ({ onAiClick, alerts, inventory }) => {
  const items = inventory?.length
    ? inventory
    : alerts?.map(a => ({ name: a.drug_name, stock: a.quantity_available, status: 'Low' })) || [];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">Stock Management</h2>
        <button onClick={onAiClick} className="flex items-center space-x-2 px-4 py-2 bg-rose-50 text-rose-700 rounded-lg text-sm font-bold hover:bg-rose-100">
          <Sparkles size={16} /> <span>AI Inventory Strategy</span>
        </button>
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
                    <span className={`px-2 py-1 rounded text-xs ${item.status === 'Low' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {item.status || 'Healthy'}
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
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table className="w-full text-left">
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
                <td className="p-4 font-mono text-blue-600 text-sm">{rx.id || rx.prescription_id || `RX-${i}`}</td>
                <td className="p-4">{rx.patient_name || rx.first_name || '—'}</td>
                <td className="p-4 text-sm">{rx.drug_name || rx.medication_name || '—'}</td>
                <td className="p-4">
                  <span className="px-2 py-1 rounded text-xs bg-amber-100 text-amber-700">
                    {String(rx.pharmacy_response_status || rx.status || 'pending').replace(/_/g, ' ')}
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
const DeliveryView = ({ onAiClick, orders }) => (
  <div className="space-y-4">
    <div className="flex justify-between items-center">
      <h2 className="text-xl font-bold">Orders &amp; Delivery</h2>
      <button onClick={onAiClick} className="flex items-center space-x-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm font-bold hover:bg-blue-100">
        <Sparkles size={16} /> <span>Order Insights</span>
      </button>
    </div>
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table className="w-full text-left">
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
                    String(o.status).includes('fulfilled') || String(o.status).includes('delivered') ? 'bg-emerald-100 text-emerald-700' :
                    'bg-rose-100 text-rose-700'
                  }`}>
                    {String(o.status || 'pending').replace(/_/g, ' ')}
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
  const [activeView, setActiveView] = useState('Dashboard');
  const [loading, setLoading] = useState(true);
  const [workspace, setWorkspace] = useState(null);
  const [dashboardData, setDashboardData] = useState({
    stats: {},
    orders: [],
    wallet: {},
    alerts: [],
    inventory: [],
    prescriptions: [],
  });
  const [aiModal, setAiModal] = useState({ open: false, content: '', loading: false });

  useEffect(() => {
    const load = async () => {
      try {
        const ws = await fetchNigeriaPharmacyWorkspace().catch(() => null);
        setWorkspace(ws);
        if (ws?.id) {
          const snap = await fetchNigeriaPharmacyDashboard(ws.id);
          const prescriptions = snap.prescriptions || [];
          const alerts = snap.alerts || [];
          setDashboardData({
            stats: {
              pendingCount: prescriptions.filter(p =>
                ['pending_pharmacy_confirmation', 'pharmacy_reviewing', 'clarification_requested'].includes(String(p.pharmacy_response_status || p.status))
              ).length,
              alertCount: alerts.length,
            },
            orders: snap.orders || [],
            wallet: snap.wallet || {},
            alerts,
            inventory: snap.inventory || [],
            prescriptions,
          });
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleAiInsight = async (type) => {
    setAiModal({ open: true, content: '', loading: true });
    const result = await callGemini(`Summarize pharmacy ${type} operations for DoctaRx Nigeria.`);
    setAiModal({ open: true, content: result, loading: false });
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-64 text-slate-500">
          <Loader size={32} className="animate-spin mr-3" /> Loading pharmacy data...
        </div>
      );
    }
    switch (activeView) {
      case 'Dashboard':
        return <DashboardView onAiClick={() => handleAiInsight('dashboard')} stats={dashboardData.stats} orders={dashboardData.orders} wallet={dashboardData.wallet} />;
      case 'Inventory':
        return <InventoryView onAiClick={() => handleAiInsight('inventory')} alerts={dashboardData.alerts} inventory={dashboardData.inventory} />;
      case 'Rx Queue':
        return <RxQueueView prescriptions={dashboardData.prescriptions} />;
      case 'Delivery':
        return <DeliveryView onAiClick={() => handleAiInsight('deliveries')} orders={dashboardData.orders} />;
      default:
        return <div className="p-8 text-center text-slate-400">Module under development</div>;
    }
  };

  return (
    /* fixed overlay so this full-screen UI renders on top of NigeriaPharmacyPortalShell */
    <div className="fixed inset-0 z-50 flex h-screen w-screen bg-[#F8FAFC] font-sans text-slate-900">
      <AIModal isOpen={aiModal.open} onClose={() => setAiModal(p => ({ ...p, open: false }))} content={aiModal.content} loading={aiModal.loading} />

      {/* Sidebar */}
      <aside className="w-[240px] bg-slate-900 text-slate-300 flex flex-col shrink-0">
        <div className="h-20 flex items-center px-6 border-b border-slate-800">
          <div>
            <span className="font-bold text-lg text-white block">DoctaRx Pharmacy</span>
            <span className="text-xs text-slate-400">Nigeria · RxOS</span>
          </div>
        </div>
        <nav className="p-4 space-y-2 flex-1">
          {[
            { name: 'Dashboard', icon: LayoutDashboard },
            { name: 'Rx Queue', icon: ClipboardList },
            { name: 'Inventory', icon: Package },
            { name: 'Delivery', icon: Truck },
          ].map((item) => (
            <button
              key={item.name}
              onClick={() => setActiveView(item.name)}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg ${activeView === item.name ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800'}`}
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
      <main className="flex-1 overflow-y-auto p-8">
        {renderContent()}
      </main>
    </div>
  );
}
