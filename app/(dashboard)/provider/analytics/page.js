'use client';

import { AlertCircle, BarChart3, Lock, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function OutcomesAnalyticsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <BarChart3 className="h-7 w-7 text-purple-500" />
          Outcomes Analytics
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          This workspace no longer shows mock performance data. Only verified operational analytics should appear in production.
        </p>
      </div>

      <Card className="border-blue-200 bg-blue-50/60 dark:bg-blue-950/20">
        <CardContent className="p-4 flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-blue-600 mt-0.5" />
          <div>
            <p className="font-medium text-blue-900 dark:text-blue-100">Protected analytics surface</p>
            <p className="text-sm text-blue-800 dark:text-blue-200 mt-1">
              Aggregated treatment efficacy, population health, and provider performance data are restricted to the roles and pipelines that own those production datasets.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-amber-500" />
              Access Control
            </CardTitle>
            <CardDescription>Analytics endpoints are not exposed through a demo fallback anymore.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            If this provider workspace requires analytics access, the backend role permissions and live ETL pipeline should be enabled first. Until then, the portal remains intentionally read-restricted here.
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-rose-500" />
              Production Guardrail
            </CardTitle>
            <CardDescription>No synthetic metrics are rendered to providers.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            This avoids presenting invented sample sizes, success rates, readmission data, or ETL actions as if they were connected to the live clinical system.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
