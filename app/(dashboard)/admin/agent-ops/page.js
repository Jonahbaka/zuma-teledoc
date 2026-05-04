'use client';

import OpenClawOpsPortal from '@/components/agents/OpenClawOpsPortal';
import OperationalAgentRuntimePanel from '@/components/agents/OperationalAgentRuntimePanel';
import HiveOverwatch from '@/components/hive/HiveOverwatch';

export default function AgentOpsPage() {
  return (
    <div className="space-y-8">
      {/* Hive OS Command Center */}
      <div className="bg-gray-950 border border-amber-500/20 rounded-2xl p-6">
        <HiveOverwatch />
      </div>

      <OperationalAgentRuntimePanel />

      {/* Legacy Agent Ops Portal */}
      <OpenClawOpsPortal />
    </div>
  );
}

