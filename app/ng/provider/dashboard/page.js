'use client';

import { useEffect, useState } from 'react';
import ProviderDashboardPage from '@/app/(dashboard)/provider/dashboard/page';
import api from '@/lib/api';

export default function NigeriaProviderDashboardPage() {
  const [access, setAccess] = useState(null);

  useEffect(() => {
    api.get('/ng/providers/me/access')
      .then((response) => setAccess(response.data?.providerAccess || null))
      .catch(() => setAccess(null));
  }, []);

  const state = access?.access || {};
  const trial = access?.trial || {};
  const usage = access?.usage || {};

  return (
    <div>
      <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
        <div className={`rounded-2xl border px-4 py-3 text-sm ${
          state.allowed
            ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
            : 'border-amber-200 bg-amber-50 text-amber-900'
        }`}>
          <div className="font-semibold">
            {state.accessStatus === 'subscribed'
              ? 'Provider subscription active'
              : state.accessStatus === 'trial_access'
                ? `One-month provider trial: ${trial.daysRemaining || state.daysRemaining || 0} day(s) remaining`
                : state.blockReason || 'Provider onboarding access status'}
          </div>
          <div className="mt-1">
            Usage: {usage.appointmentsCount || 0} appointments, {usage.videoCallsCount || 0} video calls, {usage.prescriptionsCount || 0} prescriptions, {usage.messagesCount || 0} messages.
          </div>
        </div>
      </div>
      <ProviderDashboardPage />
    </div>
  );
}
