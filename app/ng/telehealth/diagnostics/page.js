'use client';

import PreCallDiagnostics from '@/components/ng/telehealth/PreCallDiagnostics';

export default function DiagnosticsPage() {
  return (
    <PreCallDiagnostics
      onReady={({ profile, audioOnly }) => {
        // Demo: just acknowledge. Real wiring will navigate to the call
        // page with the chosen profile as query state, or pass to the
        // useTelehealthSession hook.
        if (typeof window !== 'undefined') {
          alert(`Ready to join — profile: ${profile?.name || 'n/a'}${audioOnly ? ' (audio-only)' : ''}`);
        }
      }}
    />
  );
}
