'use client';

import { useState, useEffect } from 'react';
import { CreditCard, FileText, Download, Loader2, Calendar, DollarSign } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';

export default function PatientBillingPage() {
  const [loading, setLoading] = useState(true);
  const [bills, setBills] = useState([]);

  useEffect(() => {
    // Placeholder - billing API not yet implemented
    setLoading(false);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <CreditCard className="w-6 h-6 text-purple-500" />
          Billing & Payments
        </h1>
        <p className="text-slate-500 mt-1">View your billing history and manage payments</p>
      </div>

      <Card className="py-16">
        <div className="text-center">
          <CreditCard className="w-16 h-16 text-slate-200 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-700">Billing Coming Soon</h3>
          <p className="text-sm text-slate-500 mt-1">
            Billing and payment features will be available soon
          </p>
        </div>
      </Card>
    </div>
  );
}



