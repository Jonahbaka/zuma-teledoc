'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2, Pill, UploadCloud } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
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
  const { user, loading } = useAuth();
  const accountId = user?.id || user?.userId;
  const market = user?.marketScope || user?.market_scope;
  const ready = !loading && accountId && user?.role === 'patient' && market === 'NG';
  const accountKey = ready ? JSON.stringify([accountId, user.role, market]) : null;
  const session = useRef(accountKey);
  session.current = accountKey;
  if (!ready) return <p role="status">{loading ? 'Loading prescriptions…' : 'Sign in with your Nigeria patient account to view prescriptions.'}</p>;
  return <NigeriaPatientPrescriptionsWorkspace key={accountKey} session={session} accountKey={accountKey} />;
}

export function NigeriaPatientPrescriptionsWorkspace({ session, accountKey } = {}) {
  const [prescriptions, setPrescriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadMode, setUploadMode] = useState('');
  const [retryImage, setRetryImage] = useState(null);
  const [prescriptionText, setPrescriptionText] = useState('');
  const [uploadResult, setUploadResult] = useState(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [recovery, setRecovery] = useState(true);
  const [checking, setChecking] = useState(false);
  const pendingRequest = useRef(null);
  const sentCounts = useRef(new Map());
  const freshKeys = useRef(new Set());
  const storageKey = `doctarx:prescription-unresolved:${accountKey}`;
  const mounted = useRef(true);
  const saving = useRef(false);
  const loadVersion = useRef(0);
  const draftVersion = useRef(0);
  const isCurrent = useCallback(() => mounted.current && (!session || session.current === accountKey), [session, accountKey]);
  const textAttempt = useRef(null);
  const imageAttempts = useRef(new WeakMap());

  const loadPrescriptions = useCallback(async () => {
    if (!isCurrent()) return;
    const version = ++loadVersion.current;
    setLoading(true); setLoadError('');
    try {
      const response = await api.get('/ng/patient/prescriptions');
      if (!Array.isArray(response.data)) throw new Error();
      if (isCurrent() && version === loadVersion.current) setPrescriptions(response.data);
    } catch {
      if (isCurrent() && version === loadVersion.current) setLoadError('Prescriptions could not be loaded. Please try again.');
    } finally {
      if (isCurrent() && version === loadVersion.current) setLoading(false);
    }
  }, [isCurrent]);

  const checkSavedSubmission = useCallback(async () => {
    if (!isCurrent()) return;
    let marker;
    try {
      marker = sessionStorage.getItem(storageKey);
      if (!marker) { if (!pendingRequest.current) setRecovery(false); return; }
      const parsed = JSON.parse(marker);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.requestId || '')) throw new Error();
      pendingRequest.current = parsed.requestId;
      setRecovery(true); setChecking(true);
      const response = await api.get(`/ng/patient/prescriptions/requests/${encodeURIComponent(parsed.requestId)}`);
      if (!isCurrent() || sessionStorage.getItem(storageKey) !== marker) return;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(response.data?.prescriptionId || '')) throw new Error();
      setUploadResult(response.data);
      sessionStorage.removeItem(storageKey);
      pendingRequest.current = null; setRecovery(false); setError('');
      textAttempt.current = null; imageAttempts.current = new WeakMap(); setRetryImage(null);
    } catch {
      if (isCurrent()) { setRecovery(true); setError('A previous submission is unresolved. Check its saved status before starting another; no prescription content is stored in this browser.'); }
    } finally { if (isCurrent()) setChecking(false); }
  }, [isCurrent, storageKey]);

  // Write the opaque marker before any network mutation. Storage failure and
  // unresolved older attempts fail closed rather than minting a replacement key.
  const reserveSubmission = (key) => {
    try {
      const marker = sessionStorage.getItem(storageKey);
      if (marker && JSON.parse(marker).requestId !== key) throw new Error();
      if (pendingRequest.current && pendingRequest.current !== key) throw new Error();
      if (!marker && !sentCounts.current.has(key)) freshKeys.current.add(key);
      sessionStorage.setItem(storageKey, JSON.stringify({ requestId: key }));
      pendingRequest.current = key; setRecovery(true);
      return true;
    } catch { setRecovery(true); setError('Submission recovery is unavailable. Check history before submitting again.'); return false; }
  };
  const confirmSubmission = (key) => {
    try {
      const marker = sessionStorage.getItem(storageKey);
      if (!marker || JSON.parse(marker).requestId !== key) return;
      sessionStorage.removeItem(storageKey);
      pendingRequest.current = null; setRecovery(false);
    } catch { setRecovery(true); }
  };

  const rejectUnstartedSubmission = (failure, key) => {
    // Only a certified pre-write rejection of this freshly minted first attempt
    // can remove a marker. A prior ambiguous attempt may still have committed.
    if (failure.response?.status !== 400 || failure.response?.data?.submissionNotStarted !== true
      || !freshKeys.current.has(key) || sentCounts.current.get(key) !== 1) return;
    confirmSubmission(key);
    textAttempt.current = null; imageAttempts.current = new WeakMap(); setRetryImage(null);
  };

  useEffect(() => {
    mounted.current = true;
    loadPrescriptions();
    checkSavedSubmission();
    return () => { mounted.current = false; loadVersion.current += 1; };
  }, [loadPrescriptions, checkSavedSubmission]);

  const visiblePrescriptions = prescriptions;

  const handleImageUpload = (event) => submitImage(event.target.files?.[0]);

  const submitImage = async (file) => {
    if (!file || !isCurrent() || saving.current) return;
    if (recovery && !imageAttempts.current.has(file)) return;
    setError(''); setUploadResult(null);
    if (!['image/jpeg','image/png'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError('Choose a JPEG or PNG image up to 5 MB.'); return;
    }

    setRetryImage(file);
    saving.current = true;
    setUploading(true);
    try {
      const form = new FormData(); form.append('image', file);
      if (!imageAttempts.current.has(file)) imageAttempts.current.set(file, crypto.randomUUID());
      const key = imageAttempts.current.get(file);
      if (!reserveSubmission(key)) return;
      sentCounts.current.set(key, (sentCounts.current.get(key) || 0) + 1);
      const response = await api.post('/ng/patient/prescriptions/upload', form, { headers: { 'Content-Type': 'multipart/form-data', 'Idempotency-Key': imageAttempts.current.get(file) } });
      if (!isCurrent()) return;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(response.data?.prescriptionId || '')) throw new Error('Unconfirmed submission');
      setUploadResult(response.data);
      confirmSubmission(key);
      setRetryImage(null);
      setUploadMode('');
      await loadPrescriptions();
    } catch (failure) {
      if (isCurrent()) rejectUnstartedSubmission(failure, imageAttempts.current.get(file));
      if (isCurrent()) setError(failure.response?.data?.error || 'The submission could not be confirmed. Check prescription history or retry the selected image using the same submission reference.');
    } finally {
      saving.current = false;
      if (isCurrent()) setUploading(false);
    }
  };

  const handleTextSubmit = async () => {
    if (!prescriptionText.trim() || !isCurrent() || saving.current) return;
    if (recovery && textAttempt.current?.text !== prescriptionText.trim()) return;
    const submittedVersion = draftVersion.current;
    const submittedText = prescriptionText.trim();
    setError(''); setUploadResult(null);

    saving.current = true;
    setUploading(true);
    try {
      if (textAttempt.current?.text !== submittedText) textAttempt.current = { text: submittedText, key: crypto.randomUUID() };
      const key = textAttempt.current.key;
      if (!reserveSubmission(key)) return;
      sentCounts.current.set(key, (sentCounts.current.get(key) || 0) + 1);
      const response = await api.post('/ng/patient/prescriptions/text', {
        text: submittedText,
      }, { headers: { 'Idempotency-Key': textAttempt.current.key } });
      if (!isCurrent()) return;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(response.data?.prescriptionId || '')) throw new Error('Unconfirmed submission');
      setUploadResult(response.data);
      confirmSubmission(key);
      textAttempt.current = null;
      if (draftVersion.current === submittedVersion) { setPrescriptionText(''); setUploadMode(''); }
      await loadPrescriptions();
    } catch (failure) {
      if (isCurrent()) rejectUnstartedSubmission(failure, textAttempt.current?.key);
      if (isCurrent()) setError(failure.response?.data?.error || 'The submission could not be confirmed. Your text is preserved; check prescription history before trying again.');
    } finally {
      saving.current = false;
      if (isCurrent()) setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PortalPageHeader title="Prescriptions" description="Review pharmacy updates and submit an existing prescription for professional review."><Link href="/ng/patient/search"><Button variant="outline">Medication search</Button></Link><Link href="/ng/patient/orders"><Button variant="outline">Pharmacy orders</Button></Link></PortalPageHeader>

      {recovery && <div className="portal-error"><p role="status">An earlier submission may still be processing. Reconcile it before starting another submission.</p><Button disabled={checking || uploading} onClick={checkSavedSubmission}>{checking ? 'Checking saved status…' : 'Check saved submission'}</Button></div>}
      {error && <p role="alert" className="portal-error">{error}</p>}

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>Upload a prescription</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!uploadMode ? (
            <div className="grid gap-4 md:grid-cols-2">
              <button type="button" disabled={recovery} onClick={() => setUploadMode('image')} className="rounded-2xl border border-dashed border-border px-4 py-8 text-center transition-colors hover:border-blue-300 hover:bg-blue-50/60">
                <UploadCloud className="mx-auto h-8 w-8 text-blue-600" />
                <p className="mt-4 font-semibold text-foreground">Upload image</p>
                <p className="mt-2 text-sm text-muted-foreground">Take a photo or upload a scan.</p>
              </button>
              <button type="button" disabled={recovery} onClick={() => setUploadMode('text')} className="rounded-2xl border border-dashed border-border px-4 py-8 text-center transition-colors hover:border-blue-300 hover:bg-blue-50/60">
                <Pill className="mx-auto h-8 w-8 text-blue-600" />
                <p className="mt-4 font-semibold text-foreground">Type medication details</p>
                <p className="mt-2 text-sm text-muted-foreground">Enter drug names, dosage, and directions manually.</p>
              </button>
            </div>
          ) : null}

          {uploadMode === 'image' ? (
            <div className="space-y-3">
              <label htmlFor="prescription-image" className="block font-medium">Prescription photo (JPEG or PNG, up to 5 MB)</label>
              <input id="prescription-image" type="file" accept="image/jpeg,image/png" onChange={handleImageUpload} disabled={uploading || recovery} className="block w-full text-base" />
              <div className="flex justify-end gap-2">
                {retryImage && <Button disabled={uploading} onClick={() => submitImage(retryImage)}>Retry selected image</Button>}
                <Button variant="outline" disabled={uploading} onClick={() => setUploadMode('')}>Cancel</Button>
              </div>
            </div>
          ) : null}

          {uploadMode === 'text' ? (
            <div className="space-y-3">
              <textarea
                aria-label="Prescription text"
                maxLength={10000}
                value={prescriptionText}
                onChange={(event) => { draftVersion.current += 1; setPrescriptionText(event.target.value); }}
                rows={6}
                className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm"
                placeholder="Enter medication instructions, dosage, and duration."
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" disabled={uploading} onClick={() => setUploadMode('')}>Cancel</Button>
                <Button onClick={handleTextSubmit} disabled={uploading || !prescriptionText.trim() || (recovery && textAttempt.current?.text !== prescriptionText.trim())} className="bg-blue-600 text-white hover:bg-blue-500">
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
