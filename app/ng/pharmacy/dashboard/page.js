'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ShoppingBag, Package, CreditCard, TrendingUp, AlertCircle,
  CheckCircle, Clock, Star, ChevronRight, Plus,
  Pill, BarChart3, Settings, Truck, Zap
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import NgNav from '../../components/NgNav';
import { FeatureGate } from '../../components/FeatureGate';
import { formatNaira } from '../../lib/ngUtils';

export default function PharmacyDashboard() {
  const [stats, setStats] = useState(null);
  const [orders, setOrders] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pharmacyId, setPharmacyId] = useState(null);
  const [pharmacy, setPharmacy] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    const pid = localStorage.getItem('ng_pharmacy_id');
    if (!token || !pid) { setLoading(false); return; }
    setPharmacyId(pid);

    Promise.all([
      fetch(`/api/ng/pharmacy/${pid}/inventory/stats`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).catch(() => ({})),
      fetch(`/api/ng/pharmacy/${pid}/orders?limit=10`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).catch(() => []),
      fetch(`/api/ng/pharmacy/${pid}/wallet`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).catch(() => ({})),
      fetch(`/api/ng/pharmacy/${pid}/inventory/alerts`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).catch(() => []),
    ]).then(([s, o, w, a]) => {
      setStats(s);
      setOrders(Array.isArray(o) ? o : o.orders || []);
      setWallet(w);
      setAlerts(Array.isArray(a) ? a : a.alerts || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="animate-spin w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full" />
    </div>
  );

  if (!pharmacyId) return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="text-center space-y-4">
        <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto">
          <Pill size={28} className="text-green-500" />
        </div>
        <h2 className="text-xl font-bold text-foreground">No Pharmacy Found</h2>
        <p className="text-muted-foreground text-sm">Register your pharmacy to access the portal.</p>
        <Link href="/ng/pharmacy/onboarding">
          <Button className="bg-green-600 hover:bg-green-500 text-white">Register Pharmacy</Button>
        </Link>
      </div>
    </div>
  );

  const orderStatusColor = (s) => ({
    delivered: 'bg-green-500/10 text-green-600 border-green-500/20',
    confirmed: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    cancelled: 'bg-red-500/10 text-red-600 border-red-500/20',
    processing: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
    dispatched: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20',
  }[s] || 'bg-amber-500/10 text-amber-600 border-amber-500/20');

  return (
    <div className="min-h-screen bg-background text-foreground">
      <NgNav />
      <div className="pt-14">
        {/* Header */}
        <div className="bg-gradient-to-r from-green-900/40 via-slate-900 to-emerald-900/30 border-b border-border px-6 py-8">
          <div className="max-w-5xl mx-auto flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-muted-foreground text-sm">Pharmacy Portal</p>
              <h1 className="text-3xl font-bold text-foreground mt-1">Dashboard</h1>
            </div>
            <div className="flex gap-2">
              <Link href="/ng/pharmacy/inventory">
                <Button className="bg-green-600 hover:bg-green-500 text-white">
                  <Plus size={16} className="mr-1.5" /> Add Stock
                </Button>
              </Link>
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">

          {/* Low-stock alerts */}
          {alerts.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 flex items-start gap-3">
              <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
              <div className="text-sm">
                <strong className="text-foreground">{alerts.length} low stock alert{alerts.length > 1 ? 's' : ''}:</strong>{' '}
                <span className="text-muted-foreground">{alerts.slice(0, 3).map(a => a.drug_name).join(', ')}{alerts.length > 3 ? ` +${alerts.length - 3} more` : ''}.</span>{' '}
                <Link href="/ng/pharmacy/inventory" className="text-red-500 hover:underline font-medium">View inventory →</Link>
              </div>
            </div>
          )}

          {/* KPI row */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Wallet Balance', value: formatNaira(wallet?.balance || 0), sub: `${formatNaira(wallet?.pending_balance || 0)} pending`, icon: CreditCard, color: 'text-green-500', bg: 'bg-green-500/10' },
              { label: "Today's Earnings", value: formatNaira(wallet?.todayEarnings || 0), sub: 'from orders today', icon: TrendingUp, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
              { label: 'Total Products', value: stats?.totalItems || 0, sub: `${stats?.lowStockItems || 0} low stock`, icon: Package, color: 'text-blue-500', bg: 'bg-blue-500/10' },
              { label: 'Stock Value', value: formatNaira(stats?.totalStockValue || 0), sub: 'inventory valuation', icon: BarChart3, color: 'text-purple-500', bg: 'bg-purple-500/10' },
            ].map((stat) => {
              const Icon = stat.icon;
              return (
                <div key={stat.label} className="bg-card border border-border rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-muted-foreground">{stat.label}</span>
                    <div className={`w-9 h-9 rounded-xl ${stat.bg} flex items-center justify-center`}>
                      <Icon size={16} className={stat.color} />
                    </div>
                  </div>
                  <div className="text-2xl font-bold text-foreground">{stat.value}</div>
                  <div className="text-xs text-muted-foreground mt-1">{stat.sub}</div>
                </div>
              );
            })}
          </div>

          {/* Main grid */}
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-5">
              {/* Recent orders */}
              <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                  <h3 className="font-bold text-foreground flex items-center gap-2">
                    <ShoppingBag size={16} className="text-green-500" /> Recent Orders
                  </h3>
                  <Link href="/ng/pharmacy/orders" className="text-sm text-green-500 hover:underline font-medium">View all</Link>
                </div>
                {orders.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground">
                    <ShoppingBag size={28} className="mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No orders yet. Orders will appear here once patients purchase.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {orders.map(order => (
                      <div key={order.id} className="px-6 py-3.5 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-foreground">{order.order_number}</p>
                          <p className="text-xs text-muted-foreground">
                            {order.first_name} {order.last_name} — {new Date(order.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-foreground">{formatNaira(order.total_amount)}</p>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${orderStatusColor(order.status)}`}>
                            {order.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* WhatsApp dispense */}
              <div className="bg-card border border-border rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-foreground flex items-center gap-2">
                    <Zap size={16} className="text-green-500" /> WhatsApp Dispense
                  </h3>
                  <span className="text-[10px] bg-amber-500/10 text-amber-600 border border-amber-500/20 px-1.5 py-0.5 rounded-full font-bold">Soon</span>
                </div>
                <p className="text-sm text-muted-foreground">Patients will be able to send prescriptions via WhatsApp for instant pharmacy fulfillment. The dispense queue will appear here.</p>
              </div>
            </div>

            {/* Right sidebar */}
            <div className="space-y-5">
              {/* Sponsored listing */}
              <div className="bg-gradient-to-br from-amber-900/20 to-orange-900/10 border border-amber-500/20 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Star size={16} className="text-amber-400" />
                  <h3 className="font-bold text-foreground text-sm">Featured Listing</h3>
                </div>
                <p className="text-xs text-muted-foreground mb-3">Appear at the top of patient pharmacy searches in your area.</p>
                <div className="text-xs text-muted-foreground space-y-1 mb-4">
                  <div className="flex justify-between"><span>Local spotlight</span><span className="font-medium text-foreground">₦20,000/mo</span></div>
                  <div className="flex justify-between"><span>State featured</span><span className="font-medium text-foreground">₦50,000/mo</span></div>
                  <div className="flex justify-between"><span>National featured</span><span className="font-medium text-foreground">₦100,000/mo</span></div>
                </div>
                <FeatureGate type="nigeria_pending" available={false} compact>
                  <button className="w-full text-xs bg-amber-500 text-white font-bold py-2 rounded-lg">Get Featured</button>
                </FeatureGate>
              </div>

              {/* Quick links */}
              <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-border">
                  <h3 className="font-bold text-foreground text-sm">Pharmacy Portal</h3>
                </div>
                <div className="divide-y divide-border">
                  {[
                    { label: 'Orders', href: '/ng/pharmacy/orders', icon: ShoppingBag },
                    { label: 'Inventory', href: '/ng/pharmacy/inventory', icon: Package },
                    { label: 'Wallet & Payouts', href: '/ng/pharmacy/wallet', icon: CreditCard },
                    { label: 'Delivery Tracking', href: '/ng/pharmacy/orders', icon: Truck },
                    { label: 'Settings', href: '/ng/pharmacy/settings', icon: Settings },
                  ].map(item => {
                    const Icon = item.icon;
                    return (
                      <Link key={item.href} href={item.href} className="flex items-center justify-between px-5 py-3 hover:bg-accent/50 transition-colors group">
                        <div className="flex items-center gap-2.5">
                          <Icon size={14} className="text-muted-foreground" />
                          <span className="text-sm text-foreground">{item.label}</span>
                        </div>
                        <ChevronRight size={14} className="text-muted-foreground group-hover:text-foreground transition-colors" />
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Revenue model info */}
          <div className="bg-green-500/5 border border-green-500/20 rounded-2xl p-5 text-sm">
            <h3 className="font-bold text-foreground mb-3 flex items-center gap-2">
              <TrendingUp size={16} className="text-green-500" /> Your Revenue Model
            </h3>
            <div className="grid sm:grid-cols-3 gap-4 text-muted-foreground">
              <div>
                <p className="font-medium text-foreground text-xs mb-1">Drug Margin</p>
                <p>You keep <strong className="text-foreground">80–95%</strong> of the drug sale price. DoctaRx takes a <strong className="text-foreground">5–20%</strong> platform margin.</p>
              </div>
              <div>
                <p className="font-medium text-foreground text-xs mb-1">Dispense Fee</p>
                <p>Earn an additional <strong className="text-foreground">₦200–₦500</strong> dispense fee on each prescription fulfillment.</p>
              </div>
              <div>
                <p className="font-medium text-foreground text-xs mb-1">Delivery Commission</p>
                <p>Earn on delivery orders fulfilled through our Gokada / Kwik / MaxNG partner network.</p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
