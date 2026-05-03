'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Building2, FileText, MessageCircle, Package, Wallet } from 'lucide-react';
import NigeriaPharmacyPortalShell from '@/components/ng/NigeriaPharmacyPortalShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchNigeriaPharmacyDashboard, fetchNigeriaPharmacyWorkspace, formatNaira, getNigeriaStatusTone } from '@/lib/ngPharmacyPortal';

function EmptyWorkspaceState() {
  return (
    <Card className="border-border/70">
      <CardContent className="p-8 text-center">
        <Building2 className="mx-auto h-10 w-10 text-emerald-500/60" />
        <p className="mt-4 font-semibold text-foreground">No pharmacy workspace is connected to this account yet.</p>
        <p className="mt-2 text-sm text-muted-foreground">Complete the onboarding flow to activate Nigeria pharmacy operations.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/ng/pharmacy/onboarding">
            <Button className="bg-emerald-600 text-white hover:bg-emerald-500">Start Onboarding</Button>
          </Link>
          <Link href="/ng/pharmacy/register">
            <Button variant="outline">Register Pharmacy Account</Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function countByStatus(records, statuses) {
  const allowed = new Set(statuses);
  return records.filter((record) => allowed.has(String(record.pharmacy_response_status || record.status || '').toLowerCase())).length;
}

function formatReceivingMethod(value) {
  return String(value || 'dashboard').replace(/_/g, ' ');
}

export default function NigeriaPharmacyDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [workspace, setWorkspace] = useState(null);
  const [dashboard, setDashboard] = useState({
    stats: {},
    orders: [],
    wallet: {},
    alerts: [],
    compliance: {},
    prescriptions: [],
    whatsappNotifications: [],
  });

  const prescriptions = dashboard.prescriptions || [];
  const whatsappNotifications = dashboard.whatsappNotifications || [];
  const pendingPrescriptions = countByStatus(prescriptions, ['pending_pharmacy_confirmation', 'pharmacy_reviewing', 'clarification_requested']);
  const activeFulfillment = countByStatus(prescriptions, ['accepted', 'ready_for_pickup', 'out_for_delivery']);
  const fulfilledPrescriptions = countByStatus(prescriptions, ['fulfilled']);
  const manualWhatsappFallbacks = countByStatus(whatsappNotifications, ['manual_fallback_pending']);
  const latestWhatsappNotification = whatsappNotifications[0];

  useEffect(() => {
    const loadWorkspace = async () => {
      try {
        const pharmacyWorkspace = await fetchNigeriaPharmacyWorkspace().catch(() => null);
        setWorkspace(pharmacyWorkspace);

        if (pharmacyWorkspace?.id) {
          const snapshot = await fetchNigeriaPharmacyDashboard(pharmacyWorkspace.id);
          setDashboard(snapshot);
        }
      } finally {
        setLoading(false);
      }
    };

    loadWorkspace();
  }, []);

  return (
    <NigeriaPharmacyPortalShell>
      <div className="space-y-6">
        <section className="rounded-[2rem] border border-emerald-200/70 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.14),transparent_35%),linear-gradient(145deg,rgba(255,255,255,0.96),rgba(236,253,245,0.92))] px-5 py-6 shadow-sm sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Pharmacy Portal</p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Operational dashboard for prescriptions, orders, and settlement</h1>
              <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">
                This route is tied to the authenticated pharmacy workspace, routed prescriptions, WhatsApp/manual notification logs, fulfillment orders, and compliance status.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/ng/pharmacy/prescriptions">
                <Button className="bg-emerald-600 text-white hover:bg-emerald-500">Review Prescriptions</Button>
              </Link>
              <Link href="/ng/pharmacy/orders">
                <Button variant="outline">Review Orders</Button>
              </Link>
              <Link href="/ng/pharmacy/wallet">
                <Button variant="outline">Open Wallet</Button>
              </Link>
            </div>
          </div>
        </section>

        {loading ? (
          <Card className="border-border/70">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">Loading pharmacy workspace...</CardContent>
          </Card>
        ) : !workspace ? (
          <EmptyWorkspaceState />
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[
                {
                  label: 'Pending Prescriptions',
                  value: pendingPrescriptions,
                  detail: `${prescriptions.length} routed to this pharmacy`,
                  icon: FileText,
                },
                {
                  label: 'Active Fulfillment',
                  value: activeFulfillment,
                  detail: `${fulfilledPrescriptions} fulfilled`,
                  icon: Package,
                },
                {
                  label: 'WhatsApp Workflow',
                  value: formatReceivingMethod(workspace.preferred_prescription_receiving_method),
                  detail: `${manualWhatsappFallbacks} manual fallback pending`,
                  icon: MessageCircle,
                },
                {
                  label: 'Recent Orders',
                  value: dashboard.orders.length,
                  detail: workspace.name,
                  icon: Building2,
                },
                {
                  label: 'Wallet Balance',
                  value: formatNaira(dashboard.wallet.balance),
                  detail: `Pending ${formatNaira(dashboard.wallet.pending_balance)}`,
                  icon: Wallet,
                },
                {
                  label: 'Compliance Status',
                  value: String(dashboard.compliance.status || workspace.status || 'pending').replace(/_/g, ' '),
                  detail: workspace.pcn_license_number || 'PCN details required',
                  icon: AlertTriangle,
                },
              ].map((item) => (
                <Card key={item.label} className="border-border/70">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
                        <p className="mt-3 text-2xl font-bold text-foreground">{item.value}</p>
                        <p className="mt-2 text-sm text-muted-foreground">{item.detail}</p>
                      </div>
                      <div className="rounded-2xl bg-emerald-500/10 p-3 text-emerald-600">
                        <item.icon className="h-6 w-6" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </section>

            <Card className="border-border/70">
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>Prescription receiving workflow</CardTitle>
                <Link href="/ng/pharmacy/prescriptions">
                  <Button variant="outline" size="sm">Open prescription queue</Button>
                </Link>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-3">
                {[
                  ['Needs review', pendingPrescriptions, 'New, reviewing, or clarification requests'],
                  ['In fulfillment', activeFulfillment, 'Accepted, ready for pickup, or out for delivery'],
                  ['WhatsApp/manual logs', whatsappNotifications.length, latestWhatsappNotification ? String(latestWhatsappNotification.status || '').replace(/_/g, ' ') : 'No notifications logged yet'],
                ].map(([label, value, detail]) => (
                  <div key={label} className="rounded-2xl border border-border px-4 py-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
                    <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
                    <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
              <Card className="border-border/70">
                <CardHeader>
                  <CardTitle>Recent fulfillment queue</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {dashboard.orders.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                      No pharmacy orders are currently assigned to this workspace.
                    </div>
                  ) : (
                    dashboard.orders.slice(0, 6).map((order) => (
                      <div key={order.id} className="rounded-2xl border border-border px-4 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-foreground">{order.order_number}</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {order.first_name} {order.last_name}
                            </p>
                          </div>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getNigeriaStatusTone(order.status)}`}>
                            {String(order.status || '').replace(/_/g, ' ')}
                          </span>
                        </div>
                        <div className="mt-3 flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Order total</span>
                          <span className="font-semibold text-foreground">{formatNaira(order.total_amount)}</span>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <div className="space-y-4">
                <Card className="border-border/70">
                  <CardHeader>
                    <CardTitle>Workspace identity</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="rounded-2xl border border-border px-4 py-4">
                      <p className="font-semibold text-foreground">{workspace.name}</p>
                      <p className="mt-1 text-muted-foreground">{workspace.city}, {workspace.state}</p>
                      <p className="mt-2 text-muted-foreground">Owner email: {workspace.owner_email || 'Unavailable'}</p>
                      <p className="mt-2 text-muted-foreground">WhatsApp: {workspace.whatsapp_business_number || workspace.whatsapp || 'Not configured'}</p>
                      <p className="mt-2 text-muted-foreground">Receiving: {formatReceivingMethod(workspace.preferred_prescription_receiving_method)}</p>
                    </div>
                    <div className="rounded-2xl border border-border px-4 py-4">
                      <p className="font-semibold text-foreground">PCN License</p>
                      <p className="mt-1 text-muted-foreground">{workspace.pcn_license_number || 'Not provided yet'}</p>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/70">
                  <CardHeader>
                    <CardTitle>Low stock alerts</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {dashboard.alerts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No low-stock alerts are active right now.</p>
                    ) : (
                      dashboard.alerts.slice(0, 5).map((alert) => (
                        <div key={alert.id} className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                          <p className="font-semibold">{alert.drug_name}</p>
                          <p className="mt-1">Available: {alert.quantity_available} - Reorder level: {alert.reorder_level}</p>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>
            </section>
          </>
        )}
      </div>
    </NigeriaPharmacyPortalShell>
  );
}
