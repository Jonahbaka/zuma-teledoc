'use client';

import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const REQUEST_STATUSES = [
  { value: '', label: 'All request statuses' },
  { value: 'pending_pharmacy_confirmation', label: 'Pending pharmacy confirmation' },
  { value: 'pharmacy_reviewing', label: 'Pharmacy reviewing' },
  { value: 'available', label: 'Available after pharmacy confirmation' },
  { value: 'unavailable', label: 'Unavailable' },
  { value: 'clarification_requested', label: 'Clarification requested' },
  { value: 'fulfilled', label: 'Fulfilled' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const SOURCE_STATUSES = [
  { value: '', label: 'All source statuses' },
  { value: 'reference_only', label: 'Reference only' },
  { value: 'approved', label: 'Approved' },
  { value: 'needs_admin_review', label: 'Needs admin review' },
  { value: 'unsupported', label: 'Unsupported' },
  { value: 'disabled', label: 'Disabled' },
];

const INVENTORY_STATUSES = [
  { value: '', label: 'All inventory verification' },
  { value: 'verified', label: 'Verified availability' },
  { value: 'unverified', label: 'Unverified availability' },
];

function formatNaira(amount) {
  if (amount === null || amount === undefined || amount === '') {
    return 'Price pending confirmation';
  }
  return `NGN ${Number(amount).toLocaleString()}`;
}

function statusLabel(value) {
  return String(value || 'unknown').replace(/_/g, ' ');
}

export default function NigeriaAdminMedicationOpsPage() {
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [activeView, setActiveView] = useState('requests');
  const [requestStatus, setRequestStatus] = useState('pending_pharmacy_confirmation');
  const [sourceStatus, setSourceStatus] = useState('');
  const [inventoryStatus, setInventoryStatus] = useState('');
  const [query, setQuery] = useState('');
  const [requests, setRequests] = useState([]);
  const [requestEdits, setRequestEdits] = useState({});
  const [medicines, setMedicines] = useState([]);
  const [inventory, setInventory] = useState([]);

  const loadMedicationOps = useCallback(async () => {
    setLoading(true);
    setNotice('');

    try {
      const [requestsResponse, medicinesResponse, inventoryResponse] = await Promise.all([
        api.get('/ng/admin/medication-requests', {
          params: {
            status: requestStatus || undefined,
            query: query || undefined,
          },
        }),
        api.get('/ng/admin/medicines', {
          params: {
            sourceQualityStatus: sourceStatus || undefined,
            query: query || undefined,
          },
        }),
        api.get('/ng/admin/pharmacy-inventory', {
          params: {
            verificationStatus: inventoryStatus || undefined,
            query: query || undefined,
          },
        }),
      ]);

      setRequests(requestsResponse.data?.requests || []);
      setMedicines(medicinesResponse.data?.medicines || []);
      setInventory(inventoryResponse.data?.inventory || []);
    } catch (error) {
      setNotice(error.response?.data?.error || 'Unable to load Nigeria medication operations.');
    } finally {
      setLoading(false);
    }
  }, [inventoryStatus, query, requestStatus, sourceStatus]);

  useEffect(() => {
    loadMedicationOps();
  }, [loadMedicationOps]);

  const updateRequestStatus = async (requestId, status) => {
    setNotice('');
    try {
      await api.patch(`/ng/admin/medication-requests/${requestId}`, {
        status,
        adminNotes: `Status updated to ${statusLabel(status)} from Nigeria medication operations.`,
      });
      setNotice('Medication request updated.');
      await loadMedicationOps();
    } catch (error) {
      setNotice(error.response?.data?.error || 'Unable to update medication request.');
    }
  };

  const updateRequestEdit = (requestId, field, value) => {
    setRequestEdits((current) => ({
      ...current,
      [requestId]: {
        ...(current[requestId] || {}),
        [field]: value,
      },
    }));
  };

  const saveRequestDetails = async (requestId) => {
    const edits = requestEdits[requestId] || {};
    setNotice('');
    try {
      await api.patch(`/ng/admin/medication-requests/${requestId}`, {
        confirmedPriceNgn: edits.confirmedPriceNgn ?? null,
        pharmacyNotes: edits.pharmacyNotes ?? null,
        clarificationRequest: edits.clarificationRequest ?? null,
        adminNotes: edits.adminNotes ?? 'Updated from Nigeria medication operations.',
      });
      setNotice('Medication request details updated.');
      await loadMedicationOps();
    } catch (error) {
      setNotice(error.response?.data?.error || 'Unable to update medication request details.');
    }
  };

  const updateMedicineSource = async (medicineId, update) => {
    setNotice('');
    try {
      await api.patch(`/ng/admin/medicines/${medicineId}`, update);
      setNotice('Medicine source quality updated.');
      await loadMedicationOps();
    } catch (error) {
      setNotice(error.response?.data?.error || 'Unable to update medicine source quality.');
    }
  };

  const updateInventoryVerification = async (inventoryId, verified) => {
    setNotice('');
    try {
      await api.patch(`/ng/admin/pharmacy-inventory/${inventoryId}/availability-verification`, {
        verified,
        availabilitySource: verified ? 'admin_partner_confirmation' : 'admin_review_removed',
        availabilityNotes: verified
          ? 'Availability confirmed by admin from partner pharmacy operations.'
          : 'Availability verification removed pending partner reconfirmation.',
      });
      setNotice(verified ? 'Inventory availability marked verified.' : 'Inventory verification removed.');
      await loadMedicationOps();
    } catch (error) {
      setNotice(error.response?.data?.error || 'Unable to update pharmacy availability verification.');
    }
  };

  return (
    <div className="space-y-6 text-slate-950">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Medication Operations</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Medication requests, source quality, and verified pharmacy availability</h1>
        <p className="mt-2 max-w-4xl text-sm leading-7 text-slate-700">
          Review patient medication requests, audit catalog source quality, disable unsupported medication records, and mark pharmacy inventory as verified only after partner confirmation.
        </p>
      </section>

      {notice ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {notice}
        </div>
      ) : null}

      <Card className="border-border/70 bg-white text-slate-950">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'requests', label: 'Requests' },
              { id: 'catalog', label: 'Catalog Sources' },
              { id: 'inventory', label: 'Pharmacy Availability' },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveView(item.id)}
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  activeView === item.id
                    ? 'bg-emerald-600 text-white'
                    : 'border border-slate-200 bg-white text-slate-800 hover:bg-emerald-50'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto_auto]">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search medicine, pharmacy, source, phone, or email"
              className="h-10 rounded-md border border-input bg-white px-3 text-sm text-slate-950 placeholder:text-slate-500"
            />
            <select
              value={requestStatus}
              onChange={(event) => setRequestStatus(event.target.value)}
              className="h-10 rounded-md border border-input bg-white px-3 text-sm text-slate-950"
            >
              {REQUEST_STATUSES.map((item) => (
                <option key={item.value || 'all'} value={item.value}>{item.label}</option>
              ))}
            </select>
            <select
              value={sourceStatus}
              onChange={(event) => setSourceStatus(event.target.value)}
              className="h-10 rounded-md border border-input bg-white px-3 text-sm text-slate-950"
            >
              {SOURCE_STATUSES.map((item) => (
                <option key={item.value || 'all'} value={item.value}>{item.label}</option>
              ))}
            </select>
            <select
              value={inventoryStatus}
              onChange={(event) => setInventoryStatus(event.target.value)}
              className="h-10 rounded-md border border-input bg-white px-3 text-sm text-slate-950"
            >
              {INVENTORY_STATUSES.map((item) => (
                <option key={item.value || 'all'} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <Card className="border-border/70 bg-white text-slate-950">
          <CardContent className="p-8 text-center text-sm text-slate-600">Loading medication operations...</CardContent>
        </Card>
      ) : activeView === 'requests' ? (
        <section className="space-y-3">
          {requests.length === 0 ? (
            <Card className="border-border/70 bg-white text-slate-950">
              <CardContent className="p-8 text-center text-sm text-slate-600">No medication requests match the current filters.</CardContent>
            </Card>
          ) : requests.map((request) => (
            <Card key={request.id} className="border-border/70 bg-white text-slate-950">
              <CardContent className="space-y-4 p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">{request.medicine_name}</h2>
                    <p className="mt-1 text-sm text-slate-700">{[request.generic_name, request.city, request.state].filter(Boolean).join(' | ') || 'Manual medication request'}</p>
                    <p className="mt-1 text-sm text-slate-700">Preferred fulfillment: {statusLabel(request.fulfillment_preference)}</p>
                    <p className="mt-1 text-sm text-slate-700">Preferred pharmacy: {request.preferred_pharmacy_name || 'Not selected yet'}</p>
                  </div>
                  <Badge className="w-fit bg-amber-100 text-amber-800 hover:bg-amber-100">{statusLabel(request.status)}</Badge>
                </div>
                <div className="grid gap-2 text-sm text-slate-700 md:grid-cols-3">
                  <p>Contact: {request.contact_name || 'Name not provided'}</p>
                  <p>Phone: {request.phone || 'Not provided'}</p>
                  <p>Email: {request.email || 'Not provided'}</p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <input
                    value={requestEdits[request.id]?.confirmedPriceNgn ?? request.confirmed_price_ngn ?? ''}
                    onChange={(event) => updateRequestEdit(request.id, 'confirmedPriceNgn', event.target.value)}
                    placeholder="Confirmed price"
                    inputMode="decimal"
                    className="h-10 rounded-md border border-input bg-white px-3 text-sm text-slate-950 placeholder:text-slate-500"
                  />
                  <input
                    value={requestEdits[request.id]?.pharmacyNotes ?? request.pharmacy_notes ?? ''}
                    onChange={(event) => updateRequestEdit(request.id, 'pharmacyNotes', event.target.value)}
                    placeholder="Pharmacy notes"
                    className="h-10 rounded-md border border-input bg-white px-3 text-sm text-slate-950 placeholder:text-slate-500"
                  />
                  <input
                    value={requestEdits[request.id]?.clarificationRequest ?? request.clarification_request ?? ''}
                    onChange={(event) => updateRequestEdit(request.id, 'clarificationRequest', event.target.value)}
                    placeholder="Clarification request"
                    className="h-10 rounded-md border border-input bg-white px-3 text-sm text-slate-950 placeholder:text-slate-500"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-500" onClick={() => updateRequestStatus(request.id, 'available')}>
                    Mark Available
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => updateRequestStatus(request.id, 'pharmacy_reviewing')}>
                    Mark Reviewing
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => updateRequestStatus(request.id, 'unavailable')}>
                    Mark Unavailable
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => updateRequestStatus(request.id, 'clarification_requested')}>
                    Request Clarification
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => updateRequestStatus(request.id, 'fulfilled')}>
                    Mark Fulfilled
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => updateRequestStatus(request.id, 'completed')}>
                    Complete
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => saveRequestDetails(request.id)}>
                    Save Price/Notes
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : activeView === 'catalog' ? (
        <section className="space-y-3">
          {medicines.length === 0 ? (
            <Card className="border-border/70 bg-white text-slate-950">
              <CardContent className="p-8 text-center text-sm text-slate-600">No catalog records match the current filters.</CardContent>
            </Card>
          ) : medicines.map((medicine) => (
            <Card key={medicine.id} className="border-border/70 bg-white text-slate-950">
              <CardContent className="space-y-4 p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">{medicine.name}</h2>
                    <p className="mt-1 text-sm text-slate-700">{[medicine.generic_name, medicine.dosage_form, medicine.strength].filter(Boolean).join(' | ') || 'Catalog medication reference'}</p>
                    <p className="mt-1 text-sm text-slate-700">Source: {medicine.source_name || medicine.source || 'Unlabeled source'}</p>
                    <p className="mt-1 text-xs text-slate-600">Reference: {medicine.source_reference || 'Reference missing'}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={medicine.is_supported && !medicine.disabled_at ? 'default' : 'outline'} className={medicine.is_supported && !medicine.disabled_at ? 'bg-emerald-600 text-white hover:bg-emerald-600' : ''}>
                      {medicine.is_supported && !medicine.disabled_at ? 'Supported reference' : 'Unsupported/disabled'}
                    </Badge>
                    <Badge variant="outline">{statusLabel(medicine.source_quality_status)}</Badge>
                  </div>
                </div>
                <div className="grid gap-2 text-sm text-slate-700 md:grid-cols-3">
                  <p>Verified inventory: {medicine.verified_inventory_count || 0}</p>
                  <p>Patient requests: {medicine.request_count || 0}</p>
                  <p>Review notes: {medicine.admin_review_notes || 'No notes'}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-500" onClick={() => updateMedicineSource(medicine.id, { sourceQualityStatus: 'approved', isSupported: true, disabled: false, adminReviewNotes: 'Approved from Nigeria medication source review.' })}>
                    Approve Source
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => updateMedicineSource(medicine.id, { sourceQualityStatus: 'reference_only', isSupported: true, disabled: false, adminReviewNotes: 'Kept as catalog reference only. Pharmacy availability must be confirmed separately.' })}>
                    Reference Only
                  </Button>
                  <Button size="sm" variant="outline" className="text-rose-700" onClick={() => updateMedicineSource(medicine.id, { disabled: true, sourceQualityStatus: 'disabled', disabledReason: 'Disabled from Nigeria medication source review.', adminReviewNotes: 'Disabled pending source correction.' })}>
                    Disable
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : (
        <section className="space-y-3">
          {inventory.length === 0 ? (
            <Card className="border-border/70 bg-white text-slate-950">
              <CardContent className="p-8 text-center text-sm text-slate-600">No pharmacy inventory records match the current filters.</CardContent>
            </Card>
          ) : inventory.map((item) => (
            <Card key={item.id} className="border-border/70 bg-white text-slate-950">
              <CardContent className="space-y-4 p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">{item.drug_name}</h2>
                    <p className="mt-1 text-sm text-slate-700">{item.generic_name || 'Generic not recorded'}</p>
                    <p className="mt-1 text-sm text-slate-700">{item.pharmacy_name} | {[item.city, item.state].filter(Boolean).join(', ')}</p>
                  </div>
                  <Badge className={item.availability_verification_status === 'verified' ? 'bg-emerald-600 text-white hover:bg-emerald-600' : 'bg-amber-100 text-amber-800 hover:bg-amber-100'}>
                    {statusLabel(item.availability_verification_status)}
                  </Badge>
                </div>
                <div className="grid gap-2 text-sm text-slate-700 md:grid-cols-4">
                  <p>Quantity: {item.quantity_available || 0}</p>
                  <p>Price: {formatNaira(item.selling_price)}</p>
                  <p>Pharmacy status: {statusLabel(item.pharmacy_status)}</p>
                  <p>Catalog source: {statusLabel(item.source_quality_status)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-500" onClick={() => updateInventoryVerification(item.id, true)}>
                    Verify Availability
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => updateInventoryVerification(item.id, false)}>
                    Remove Verification
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
