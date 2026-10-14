'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2, Pill, UploadCloud } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import PortalPageHeader from '@/components/branding/PortalPageHeader';

function formatDate(value) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return 'Date unavailable';
  }
}

export default function NigeriaPatientPrescriptionsPage() {
  const [prescriptions, setPrescriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadMode, setUploadMode] = useState('');
  const [prescriptionText, setPrescriptionText] = useState('');
  const [uploadResult, setUploadResult] = useState(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const textAttempt = useRef(null);
  const imageAttempts = useRef(new WeakMap());

  const loadPrescriptions = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const response = await api.get('/ng/patient/prescriptions');
      if (!Array.isArray(response.data)) throw new Error();
      setPrescriptions(response.data);
    } catch {
      setLoadError('Prescriptions could not be loaded. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPrescriptions();
  }, [loadPrescriptions]);

  const visiblePrescriptions = prescriptions;

  const handleImageUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(''); setUploadResult(null);
    if (!['image/jpeg','image/png'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError('Choose a JPEG or PNG image up to 5 MB.'); return;
    }

    setUploading(true);
    try {
      const form = new FormData(); form.append('image', file);
      if (!imageAttempts.current.has(file)) imageAttempts.current.set(file, crypto.randomUUID());
      const response = await api.post('/ng/patient/prescriptions/upload', form, { headers: { 'Content-Type': 'multipart/form-data', 'Idempotency-Key': imageAttempts.current.get(file) } });
      setUploadResult(response.data);
      setUploadMode('');
      await loadPrescriptions();
    } catch (failure) {
      setError(failure.response?.data?.error || 'Your prescription image could not be submitted. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleTextSubmit = async () => {
    if (!prescriptionText.trim()) return;
    setError(''); setUploadResult(null);

    setUploading(true);
    try {
      if (textAttempt.current?.text !== prescriptionText.trim()) textAttempt.current = { text: prescriptionText.trim(), key: crypto.randomUUID() };
      const response = await api.post('/ng/patient/prescriptions/text', {
        text: prescriptionText,
      }, { headers: { 'Idempotency-Key': textAttempt.current.key } });
      setUploadResult(response.data);
      setPrescriptionText('');
      textAttempt.current = null;
      setUploadMode('');
      await loadPrescriptions();
    } catch (failure) {
      setError(failure.response?.data?.error || 'Your prescription text could not be submitted. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PortalPageHeader title="Prescriptions" description="Review pharmacy updates and submit an existing prescription for professional review."><Link href="/ng/patient/search"><Button variant="outline">Medication search</Button></Link><Link href="/ng/patient/orders"><Button variant="outline">Pharmacy orders</Button></Link></PortalPageHeader>

      {error && <p role="alert" className="portal-error">{error}</p>}

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>Upload a prescription</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!uploadMode ? (
            <div className="grid gap-4 md:grid-cols-2">
              <button type="button" onClick={() => setUploadMode('image')} className="rounded-2xl border border-dashed border-border px-4 py-8 text-center transition-colors hover:border-blue-300 hover:bg-blue-50/60">
                <UploadCloud className="mx-auto h-8 w-8 text-blue-600" />
                <p className="mt-4 font-semibold text-foreground">Upload image</p>
                <p className="mt-2 text-sm text-muted-foreground">Take a photo or upload a scan.</p>
              </button>
              <button type="button" onClick={() => setUploadMode('text')} className="rounded-2xl border border-dashed border-border px-4 py-8 text-center transition-colors hover:border-blue-300 hover:bg-blue-50/60">
                <Pill className="mx-auto h-8 w-8 text-blue-600" />
                <p className="mt-4 font-semibold text-foreground">Type medication details</p>
                <p className="mt-2 text-sm text-muted-foreground">Enter drug names, dosage, and directions manually.</p>
              </button>
            </div>
          ) : null}

          {uploadMode === 'image' ? (
            <div className="space-y-3">
              <label htmlFor="prescription-image" className="block font-medium">Prescription photo (JPEG or PNG, up to 5 MB)</label>
              <input id="prescription-image" type="file" accept="image/jpeg,image/png" onChange={handleImageUpload} disabled={uploading} className="block w-full text-base" />
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setUploadMode('')}>Cancel</Button>
              </div>
            </div>
          ) : null}

          {uploadMode === 'text' ? (
            <div className="space-y-3">
              <textarea
                aria-label="Prescription text"
                maxLength={10000}
                value={prescriptionText}
                onChange={(event) => setPrescriptionText(event.target.value)}
                rows={6}
                className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm"
                placeholder="Enter medication instructions, dosage, and duration."
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setUploadMode('')}>Cancel</Button>
                <Button onClick={handleTextSubmit} disabled={uploading || !prescriptionText.trim()} className="bg-blue-600 text-white hover:bg-blue-500">
                  {uploading ? 'Submitting...' : 'Submit Prescription'}
                </Button>
              </div>
            </div>
          ) : null}

          {uploadResult ? (
            <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-4 text-sm text-blue-800">
              <p role="status" className="font-semibold">Prescription submitted for review.</p>
              <p className="mt-1">Your care team must review the prescription before it can be routed or dispensed.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/ng/patient/search">
                  <Button size="sm" className="bg-blue-600 text-white hover:bg-blue-500">Compare Pharmacies</Button>
                </Link>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {loadError && <div className="portal-error"><p role="alert">{loadError}</p><Button variant="outline" className="mt-3" onClick={loadPrescriptions}>Try again</Button></div>}

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>Prescription history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="py-8 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : loadError ? null : visiblePrescriptions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              No prescriptions uploaded yet.
            </div>
          ) : (
            visiblePrescriptions.map((prescription) => (
              <div key={prescription.id} className="rounded-2xl border border-border px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-foreground">{prescription.prescriber_name || 'Prescription'}</p>
                    {prescription.medication ? (
                      <p className="mt-1 text-sm text-slate-600">{prescription.medication}</p>
                    ) : null}
                    <p className="mt-1 text-sm text-muted-foreground">{formatDate(prescription.created_at)}</p>
                  </div>
                  <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
                    {String(prescription.status || '').replace(/_/g, ' ')}
                  </span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
