import { Suspense } from 'react';
import NGVideoCall from '@/components/ng/conference/NGVideoCall';

function CallFallback() {
  return (
    <div className="fixed inset-0 bg-[#202124] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-white text-sm font-medium">Loading Telehealth Center…</p>
      </div>
    </div>
  );
}

export default function NigeriaProviderCallPage() {
  return (
    <Suspense fallback={<CallFallback />}>
      <NGVideoCall />
    </Suspense>
  );
}
