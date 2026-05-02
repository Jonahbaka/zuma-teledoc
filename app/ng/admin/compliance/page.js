'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function NigeriaAdminCompliancePage() {
  const [auditEntries, setAuditEntries] = useState([]);
  const [notice, setNotice] = useState('');

  const loadCompliance = async () => {
    const response = await api.get('/ng/admin/compliance/audit-log').catch(() => ({ data: [] }));
    setAuditEntries(Array.isArray(response.data) ? response.data : []);
  };

  useEffect(() => {
    loadCompliance();
  }, []);

  const runExpiredInventoryCheck = async () => {
    setNotice('');
    try {
      await api.post('/ng/admin/compliance/check-expired');
      setNotice('Expired inventory check started.');
    } catch (error) {
      setNotice(error.response?.data?.error || 'Unable to start expired inventory check.');
    }
  };

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Nigeria Compliance</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Audit log and compliance checks</h1>
          <p className="mt-2 text-sm text-muted-foreground">Review Nigeria pharmacy audit events and trigger compliance checks from the admin portal.</p>
        </div>
        <Button onClick={runExpiredInventoryCheck} className="bg-emerald-600 text-white hover:bg-emerald-500">Run Expired Inventory Check</Button>
      </section>

      {notice ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div> : null}

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>Compliance audit trail</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {auditEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No compliance audit entries are available.</p>
          ) : (
            auditEntries.map((entry) => (
              <div key={entry.id} className="rounded-2xl border border-border px-4 py-4 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-foreground">{entry.action}</p>
                    <p className="mt-1 text-muted-foreground">{entry.resource_type} • {entry.resource_id || 'N/A'}</p>
                    <p className="mt-2 text-muted-foreground">{entry.details ? JSON.stringify(entry.details) : 'No additional details'}</p>
                  </div>
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                    {entry.severity || 'info'}
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
