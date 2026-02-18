'use client';

import OpenClawOpsPortal from '@/components/agents/OpenClawOpsPortal';
import HiveOverwatch from '@/components/hive/HiveOverwatch';

export default function AgentOpsPage() {
  return (
    <div className="space-y-8">
      {/* Hive OS Command Center */}
      <div className="bg-gray-950 border border-amber-500/20 rounded-2xl p-6">
        <HiveOverwatch />
      </div>

      {/* Legacy Agent Ops Portal */}
      <OpenClawOpsPortal />
    </div>
  );
}

