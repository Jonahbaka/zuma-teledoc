'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Calendar,
  ClipboardList,
  FileText,
  MessageSquare,
  Package,
  Pill,
  Search,
  ShieldCheck,
} from 'lucide-react';
import api, { appointmentsAPI, messagesAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import NigeriaDiscoverySpotlight from '@/components/ng/NigeriaDiscoverySpotlight';
import { formatDateTime } from '@/lib/utils';

const QUICK_ACTIONS = [
  {
    title: 'Book Consultation',
    description: 'Choose consultation type, provider, time, and care context.',
    href: '/ng/patient/appointments/book',
    icon: Calendar,
  },
  {
    title: 'Prescriptions',
    description: 'Upload, review, and route medication requests.',
    href: '/ng/patient/prescriptions',
    icon: Pill,
  },
  {
    title: 'Orders',
    description: 'Track routed pharmacy orders and payments.',
    href: '/ng/patient/orders',
    icon: Package,
  },
  {
    title: 'Messages',
    description: 'Stay connected with care coordination and providers.',
    href: '/ng/patient/messages',
    icon: MessageSquare,
  },
  {
    title: 'Continue Care Plan',
    description: 'Resume the latest provider, prescription, or pharmacy follow-through.',
    href: '/ng/patient/search',
    icon: ClipboardList,
  },
];

function formatNaira(amount) {
  return `NGN ${Number(amount || 0).toLocaleString()}`;
}

export default function NigeriaPatientPortalPage() {
  const [appointments, setAppointments] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPortalData = async () => {
      try {
        const [appointmentsRes, prescriptionsRes, ordersRes, conversationsRes] = await Promise.all([
          appointmentsAPI.getUpcoming(4).catch(() => ({ data: { success: false, appointments: [] } })),
          api.get('/api/ng/patient/prescriptions', { params: { limit: 4 } }).catch(() => ({ data: [] })),
          api.get('/api/ng/patient/orders', { params: { limit: 4 } }).catch(() => ({ data: [] })),
          messagesAPI.getConversations().catch(() => ({ data: { success: false, conversations: [] } })),
        ]);

        setAppointments(appointmentsRes.data?.success ? appointmentsRes.data.appointments || [] : []);
        setPrescriptions(Array.isArray(prescriptionsRes.data) ? prescriptionsRes.data : []);
        setOrders(Array.isArray(ordersRes.data) ? ordersRes.data : []);
        setConversations(conversationsRes.data?.success ? conversationsRes.data.conversations || [] : []);
      } finally {
        setLoading(false);
      }
    };

    fetchPortalData();
  }, []);

  const activeOrders = useMemo(
    () => orders.filter((order) => !['delivered', 'cancelled'].includes(String(order.status || '').toLowerCase())),
    [orders]
  );
  const unreadMessages = useMemo(
    () => conversations.reduce((count, conversation) => count + Number(conversation.unreadCount || 0), 0),
    [conversations]
  );

  const stats = [
    {
      label: 'Upcoming Consultations',
      value: appointments.length,
      detail: appointments[0]?.scheduledAt ? `Next: ${formatDateTime(appointments[0].scheduledAt)}` : 'No active booking yet',
      icon: Calendar,
    },
    {
      label: 'Prescription Queue',
      value: prescriptions.length,
      detail: prescriptions[0]?.status ? `Latest: ${String(prescriptions[0].status).replace(/_/g, ' ')}` : 'Nothing uploaded yet',
      icon: Pill,
    },
    {
      label: 'Orders In Motion',
      value: activeOrders.length,
      detail: activeOrders[0]?.total_amount ? `${formatNaira(activeOrders[0].total_amount)} in latest order` : 'No active fulfillment flow',
      icon: Package,
    },
    {
      label: 'Unread Messages',
      value: unreadMessages,
      detail: unreadMessages > 0 ? 'Care-team responses waiting' : 'Inbox is clear',
      icon: MessageSquare,
    },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-emerald-200/70 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.16),transparent_38%),linear-gradient(145deg,rgba(255,255,255,0.94),rgba(236,253,245,0.9))] px-5 py-6 shadow-sm sm:px-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
              <ShieldCheck className="h-4 w-4" />
              Nigeria Patient Portal
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
              Care coordination, consultations, prescriptions, and pharmacy fulfillment in one patient workspace.
            </h1>
            <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">
              This route is now the actual Nigeria patient portal. Pharmacy search remains available as one feature inside the experience, not the portal itself.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Link href="/ng/patient/appointments/book" className="inline-flex">
              <Button className="w-full bg-emerald-600 text-white hover:bg-emerald-500">
                <Calendar className="mr-2 h-4 w-4" />
                Book Consultation
              </Button>
            </Link>
            <Link href="/ng/patient/search" className="inline-flex">
              <Button variant="outline" className="w-full border-emerald-200 text-emerald-700 hover:bg-emerald-50">
                <Search className="mr-2 h-4 w-4" />
                Search Medication
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="border-border/70">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{stat.label}</p>
                  <p className="mt-3 text-3xl font-bold text-foreground">{loading ? '...' : stat.value}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{stat.detail}</p>
                </div>
                <div className="rounded-2xl bg-emerald-500/10 p-3 text-emerald-600">
                  <stat.icon className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <Card className="border-border/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl">Patient Journey</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {QUICK_ACTIONS.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="group rounded-2xl border border-border/70 bg-card p-4 transition-colors hover:border-emerald-300 hover:bg-emerald-50/70"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="inline-flex rounded-xl bg-emerald-500/10 p-2 text-emerald-600">
                      <action.icon className="h-5 w-5" />
                    </div>
                    <h2 className="mt-3 text-base font-semibold text-foreground">{action.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{action.description}</p>
                  </div>
                  <ArrowRight className="mt-1 h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-600" />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl">Portal Coverage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="font-semibold text-emerald-900">What this portal covers</p>
              <p className="mt-1 text-emerald-800">Login, consultations, prescriptions, pharmacy routing, order tracking, profile updates, messages, and records review.</p>
            </div>
            <div className="rounded-2xl border border-border px-4 py-3">
              <p className="font-semibold text-foreground">Medication search is still available</p>
              <p className="mt-1">Use it when you want to compare pharmacy availability and pricing after a prescription or self-pay medication request.</p>
            </div>
            <div className="rounded-2xl border border-border px-4 py-3">
              <p className="font-semibold text-foreground">Need live support?</p>
              <p className="mt-1">Open Messages to reach care coordination, or review the latest order and prescription steps directly from this workspace.</p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <Card className="border-border/70 xl:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl">Upcoming Consultations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {appointments.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                No upcoming consultations are on file yet.
              </div>
            ) : (
              appointments.map((appointment) => (
                <div key={appointment.id} className="rounded-2xl border border-border px-4 py-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-semibold text-foreground">
                        Dr. {appointment.providerFirstName} {appointment.providerLastName}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {appointment.providerSpecialty || 'Consultation'} • {formatDateTime(appointment.scheduledAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {appointment.type === 'video' ? (
                        <Link href={`/ng/patient/appointments/${appointment.id}/call`}>
                          <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-500">
                            Join Call
                          </Button>
                        </Link>
                      ) : null}
                      <Link href="/ng/patient/appointments">
                        <Button size="sm" variant="outline">View Schedule</Button>
                      </Link>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl">Latest Order Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {orders.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                No medication orders have been placed yet.
              </div>
            ) : (
              orders.slice(0, 3).map((order) => (
                <div key={order.id} className="rounded-2xl border border-border px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-foreground">{order.order_number}</p>
                      <p className="text-sm text-muted-foreground">{order.pharmacy_name}</p>
                    </div>
                    <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                      {String(order.status || '').replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Total</span>
                    <span className="font-semibold text-foreground">{formatNaira(order.total_amount)}</span>
                  </div>
                </div>
              ))
            )}
            <Link href="/ng/patient/orders">
              <Button variant="outline" className="w-full">Open Order Tracker</Button>
            </Link>
          </CardContent>
        </Card>
      </section>

      <NigeriaDiscoverySpotlight embeddedInPortal />
    </div>
  );
}
