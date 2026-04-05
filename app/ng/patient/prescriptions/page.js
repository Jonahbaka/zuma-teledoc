'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Pill, UploadCloud } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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

  const loadPrescriptions = async () => {
    try {
      const response = await api.get('/api/ng/patient/prescriptions');
      setPrescriptions(Array.isArray(response.data) ? response.data : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPrescriptions();
  }, []);

  const handleImageUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const response = await api.post('/api/ng/patient/prescriptions/upload', {
        imageUrl: URL.createObjectURL(file),
      });
      setUploadResult(response.data);
      await loadPrescriptions();
    } finally {
      setUploading(false);
    }
  };

  const handleTextSubmit = async () => {
    if (!prescriptionText.trim()) return;

    setUploading(true);
    try {
      const response = await api.post('/api/ng/patient/prescriptions/text', {
        text: prescriptionText,
      });
      setUploadResult(response.data);
      setPrescriptionText('');
      setUploadMode('');
      await loadPrescriptions();
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-emerald-200/70 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.14),transparent_35%),linear-gradient(145deg,rgba(255,255,255,0.96),rgba(236,253,245,0.92))] px-5 py-6 shadow-sm sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Prescription Workflow</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Upload, review, and route prescriptions</h1>
            <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">
              Add prescription images or typed medication instructions, then continue to medication search and pharmacy routing from the patient portal.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/ng/patient/search">
              <Button className="bg-emerald-600 text-white hover:bg-emerald-500">Open Medication Search</Button>
            </Link>
            <Link href="/ng/patient/orders">
              <Button variant="outline">Review Orders</Button>
            </Link>
          </div>
        </div>
      </section>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>Upload a prescription</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!uploadMode ? (
            <div className="grid gap-4 md:grid-cols-2">
              <button type="button" onClick={() => setUploadMode('image')} className="rounded-2xl border border-dashed border-border px-4 py-8 text-center transition-colors hover:border-emerald-300 hover:bg-emerald-50/60">
                <UploadCloud className="mx-auto h-8 w-8 text-emerald-600" />
                <p className="mt-4 font-semibold text-foreground">Upload image</p>
                <p className="mt-2 text-sm text-muted-foreground">Take a photo or upload a scan.</p>
              </button>
              <button type="button" onClick={() => setUploadMode('text')} className="rounded-2xl border border-dashed border-border px-4 py-8 text-center transition-colors hover:border-emerald-300 hover:bg-emerald-50/60">
                <Pill className="mx-auto h-8 w-8 text-emerald-600" />
                <p className="mt-4 font-semibold text-foreground">Type medication details</p>
                <p className="mt-2 text-sm text-muted-foreground">Enter drug names, dosage, and directions manually.</p>
              </button>
            </div>
          ) : null}

          {uploadMode === 'image' ? (
            <div className="space-y-3">
              <input type="file" accept="image/*" onChange={handleImageUpload} className="block w-full text-sm" />
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setUploadMode('')}>Cancel</Button>
              </div>
            </div>
          ) : null}

          {uploadMode === 'text' ? (
            <div className="space-y-3">
              <textarea
                value={prescriptionText}
                onChange={(event) => setPrescriptionText(event.target.value)}
                rows={6}
                className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm"
                placeholder="Enter medication instructions, dosage, and duration."
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setUploadMode('')}>Cancel</Button>
                <Button onClick={handleTextSubmit} disabled={uploading || !prescriptionText.trim()} className="bg-emerald-600 text-white hover:bg-emerald-500">
                  {uploading ? 'Submitting...' : 'Submit Prescription'}
                </Button>
              </div>
            </div>
          ) : null}

          {uploadResult ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
              <p className="font-semibold">Prescription parsed successfully.</p>
              <p className="mt-1">Confidence: {Math.round(Number(uploadResult.confidence || 0) * 100)}%</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/ng/patient/search">
                  <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-500">Compare Pharmacies</Button>
                </Link>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>Prescription history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="py-8 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-emerald-600" />
            </div>
          ) : prescriptions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              No prescriptions uploaded yet.
            </div>
          ) : (
            prescriptions.map((prescription) => (
              <div key={prescription.id} className="rounded-2xl border border-border px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-foreground">{prescription.prescriber_name || 'Prescription'}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{formatDate(prescription.created_at)}</p>
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
    </div>
  );
}
