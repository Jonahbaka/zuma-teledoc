'use client';

import { useEffect, useMemo, useState } from 'react';
import { Upload, Loader2, ShieldCheck, AlertTriangle, RefreshCw } from 'lucide-react';
import { insuranceAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';

function formatISODate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export default function InsuranceCardUploader({ title = 'Insurance Card Verification' }) {
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [wallet, setWallet] = useState([]);
  const [frontFile, setFrontFile] = useState(null);

  const primary = useMemo(() => wallet.find(w => w.is_primary) || wallet[0] || null, [wallet]);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await insuranceAPI.getWallet();
      if (res.data?.success) {
        setWallet(res.data.wallet || []);
      }
    } catch (e) {
      toast({
        title: 'Error',
        description: 'Failed to load insurance wallet',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const onUpload = async (frontFile, backFile) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('frontImage', frontFile);
      if (backFile) fd.append('backImage', backFile);
      fd.append('ocrProvider', 'auto');

      const res = await insuranceAPI.uploadOCR(fd);
      if (!res.data?.success) throw new Error(res.data?.error || 'Upload failed');

      toast({
        title: 'Card uploaded',
        description: 'We extracted your insurance details and started verification.'
      });

      await refresh();
    } catch (e) {
      toast({
        title: 'Upload failed',
        description: e.response?.data?.error || e.message || 'Could not upload insurance card',
        variant: 'destructive'
      });
    } finally {
      setUploading(false);
    }
  };

  const triggerVerify = async () => {
    if (!primary?.id) return;
    setVerifying(true);
    try {
      const res = await insuranceAPI.verifyEligibility(primary.id);
      if (!res.data?.success) throw new Error(res.data?.error || 'Verification failed');
      toast({ title: 'Eligibility check complete', description: 'Insurance status updated.' });
      await refresh();
    } catch (e) {
      toast({
        title: 'Verification failed',
        description: e.response?.data?.error || e.message || 'Could not verify eligibility',
        variant: 'destructive'
      });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>{title}</CardTitle>
        <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : primary ? (
          <div className="rounded-lg border border-border p-4 bg-muted/20">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-semibold text-foreground">{primary.insurance_provider}</p>
                <p className="text-sm text-muted-foreground">
                  Status: <span className="font-medium">{primary.eligibility_status || 'unknown'}</span>
                  {primary.eligibility_last_checked ? ` • Checked ${formatISODate(primary.eligibility_last_checked)}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" onClick={triggerVerify} disabled={verifying}>
                  {verifying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
                  Verify
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground mb-2">No insurance card on file yet.</p>
            <p className="text-xs text-muted-foreground">Upload your card (front required, back optional).</p>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <label className="rounded-lg border border-border p-4 cursor-pointer hover:bg-muted/30 transition-colors">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Upload className="h-4 w-4" />
              Upload front image
            </div>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setFrontFile(file);
                toast({ title: 'Front selected', description: 'Now select back image (optional), or re-select front to upload.' });
              }}
            />
          </label>

          <label className="rounded-lg border border-border p-4 cursor-pointer hover:bg-muted/30 transition-colors">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Upload className="h-4 w-4" />
              Upload back image (optional)
            </div>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={async (e) => {
                const back = e.target.files?.[0] || null;
                if (!frontFile) {
                  toast({
                    title: 'Front image required',
                    description: 'Please upload the front image first.',
                    variant: 'destructive'
                  });
                  return;
                }
                await onUpload(frontFile, back);
                setFrontFile(null);
              }}
            />
          </label>
        </div>

        {uploading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Uploading and scanning…
          </div>
        )}

        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-4 w-4 mt-0.5" />
          <p>
            Your insurance images are treated as PHI. We store them encrypted and audit access. AI processing runs in a NemoClaw OpenShell sandbox.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}


