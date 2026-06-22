'use client';

import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, FileText, Loader2, Package, Pill } from 'lucide-react';
import api, { appointmentsAPI, medicalRecordsAPI, visitsAPI } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/utils';
import {
  PRESENTATION_DEMO_LABEL,
  buildPatientPortalDemoData,
  shouldShowPresentationDemoData,
} from '@/lib/ngPresentationDemoData';

function EmptyState({ icon: Icon, title, description }) {
  return (
    <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center">
      <Icon className="mx-auto h-10 w-10 text-emerald-500/60" />
      <p className="mt-4 font-semibold text-foreground">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export default function NigeriaPatientRecordsPage() {
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [visits, setVisits] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [orders, setOrders] = useState([]);
  const presentationDemoData = useMemo(() => buildPatientPortalDemoData(), []);

  useEffect(() => {
    const loadRecords = async () => {
      try {
        const meResponse = await api.get('/auth/me').catch(() => ({ data: { success: false } }));
        const currentUser = meResponse.data?.user;
        setCurrentUser(currentUser || null);

        const [documentsResponse, visitsResponse, prescriptionsResponse, ordersResponse, appointmentsResponse] = await Promise.all([
          currentUser ? medicalRecordsAPI.getByPatient(currentUser.id).catch(() => ({ data: { success: false, records: [] } })) : Promise.resolve({ data: { success: false, records: [] } }),
          currentUser ? visitsAPI.getByPatient(currentUser.id).catch(() => ({ data: { success: false, visits: [] } })) : Promise.resolve({ data: { success: false, visits: [] } }),
          api.get('/ng/patient/prescriptions', { params: { limit: 6 } }).catch(() => ({ data: [] })),
          api.get('/ng/patient/orders', { params: { limit: 6 } }).catch(() => ({ data: [] })),
          appointmentsAPI.getAll({ status: 'completed' }).catch(() => ({ data: { success: false, appointments: [] } })),
        ]);

        setDocuments(documentsResponse.data?.success ? documentsResponse.data.records || [] : []);
        setVisits(
          visitsResponse.data?.success
            ? visitsResponse.data.visits || []
            : appointmentsResponse.data?.success
              ? appointmentsResponse.data.appointments || []
              : []
        );
        setPrescriptions(Array.isArray(prescriptionsResponse.data) ? prescriptionsResponse.data : []);
        setOrders(Array.isArray(ordersResponse.data) ? ordersResponse.data : []);
      } finally {
        setLoading(false);
      }
    };

    loadRecords();
  }, []);

  const showDemoData = shouldShowPresentationDemoData(currentUser);
  const visibleDocuments = showDemoData && documents.length === 0 ? presentationDemoData.documents : documents;
  const visibleVisits = showDemoData && visits.length === 0 ? presentationDemoData.visits : visits;
  const visiblePrescriptions = showDemoData && prescriptions.length === 0 ? presentationDemoData.prescriptions : prescriptions;
  const visibleOrders = showDemoData && orders.length === 0 ? presentationDemoData.orders : orders;
  const usingDemoData = showDemoData && (
    documents.length === 0 || visits.length === 0 || prescriptions.length === 0 || orders.length === 0
  );

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Patient Records</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Visit history, prescriptions, and documents</h1>
        <p className="mt-2 text-sm text-muted-foreground">Review medical records, completed consultations, prescription activity, and pharmacy orders from one place.</p>
      </section>

      {usingDemoData ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          {PRESENTATION_DEMO_LABEL}: synthetic visit, record, prescription, and pharmacy data are shown for the Abuja pilot walkthrough.
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-emerald-600" />
              Uploaded documents
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {visibleDocuments.length === 0 ? (
              <EmptyState icon={FileText} title="No stored medical documents yet." description="Documents uploaded by your care team will appear here when available." />
            ) : (
              visibleDocuments.slice(0, 6).map((record) => (
                <div key={record.id} className="rounded-2xl border border-border px-4 py-4">
                  <p className="font-semibold text-foreground">{record.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{record.recordType || 'Medical record'}</p>
                  <p className="mt-2 text-sm text-slate-600">{record.content}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-emerald-600" />
              Visit history
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {visibleVisits.length === 0 ? (
              <EmptyState icon={ClipboardList} title="No completed consultations yet." description="Completed appointments and provider notes will be listed here once your visits are closed out." />
            ) : (
              visibleVisits.slice(0, 6).map((visit) => (
                <div key={visit.id} className="rounded-2xl border border-border px-4 py-4">
                  <p className="font-semibold text-foreground">{visit.reasonForVisit || visit.noteType || visit.encounterType || 'Completed consultation'}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {visit.scheduledAt || visit.createdAt ? formatDateTime(visit.scheduledAt || visit.createdAt) : 'Timeline unavailable'}
                  </p>
                  {visit.providerFirstName ? (
                    <p className="mt-2 text-sm text-slate-600">Provider: Dr. {visit.providerFirstName} {visit.providerLastName}</p>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Pill className="h-5 w-5 text-emerald-600" />
              Prescription history
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {visiblePrescriptions.length === 0 ? (
              <EmptyState icon={Pill} title="No prescription history yet." description="Uploaded or provider-generated prescriptions will be visible here." />
            ) : (
              visiblePrescriptions.slice(0, 6).map((prescription) => (
                <div key={prescription.id} className="rounded-2xl border border-border px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-foreground">{prescription.prescriber_name || 'Prescription'}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{formatDateTime(prescription.created_at)}</p>
                    </div>
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                      {String(prescription.status || '').replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-emerald-600" />
              Pharmacy orders
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {visibleOrders.length === 0 ? (
              <EmptyState icon={Package} title="No routed pharmacy orders yet." description="Medication orders and delivery tracking appear here after a pharmacy order has been created." />
            ) : (
              visibleOrders.slice(0, 6).map((order) => (
                <div key={order.id} className="rounded-2xl border border-border px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-foreground">{order.order_number}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{order.pharmacy_name}</p>
                    </div>
                    <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-700">
                      {String(order.status || '').replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
