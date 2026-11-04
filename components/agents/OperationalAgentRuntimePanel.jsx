'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  Database,
  DollarSign,
  Loader2,
  Play,
  RefreshCw,
  Wrench,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

function statusClass(status) {
  const value = String(status || '').toLowerCase();
  if (['completed', 'approved', 'online'].includes(value)) return 'bg-emerald-500/12 text-emerald-300 border-emerald-500/30';
  if (['running', 'queued', 'waiting_approval'].includes(value)) return 'bg-amber-500/12 text-amber-300 border-amber-500/30';
  if (['failed', 'rejected', 'offline', 'cancelled'].includes(value)) return 'bg-rose-500/12 text-rose-300 border-rose-500/30';
  return 'bg-slate-800 text-slate-300 border-slate-700';
}

async function apiCall(endpoint, method = 'GET', body) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const response = await fetch(`${API_URL}/agent-ops/runtime${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!data.success) throw new Error(data.error || 'Agent runtime request failed');
  return data.data;
}

export default function OperationalAgentRuntimePanel() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [health, setHealth] = useState(null);
  const [registry, setRegistry] = useState({ agents: [], tools: [], model: {} });
  const [tasks, setTasks] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [form, setForm] = useState({
    title: 'Verify admin test account visibility',
    taskType: 'admin_test_account',
    agentId: 'admin_test_account',
  });

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextHealth, nextRegistry, nextTasks, nextApprovals] = await Promise.all([
        apiCall('/health'),
        apiCall('/registry'),
        apiCall('/tasks?limit=20'),
        apiCall('/approvals?status=pending'),
      ]);
      setHealth(nextHealth);
      setRegistry(nextRegistry || { agents: [], tools: [], model: {} });
      setTasks(nextTasks || []);
      setApprovals(nextApprovals || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const selectedAgent = useMemo(
    () => registry.agents?.find((agent) => agent.id === form.agentId),
    [form.agentId, registry.agents]
  );

  const createTask = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const task = await apiCall('/tasks', 'POST', {
        ...form,
        prompt: form.title,
      });
      setNotice(`Task queued: ${task.title}`);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const runNext = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const task = await apiCall('/run-next', 'POST');
      setNotice(task?.id ? `Task updated: ${task.status}` : 'No queued tasks waiting.');
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const decideApproval = async (approvalId, decision) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiCall(`/approvals/${approvalId}/${decision}`, 'POST', { notes: `Reviewed from runtime panel: ${decision}` });
      setNotice(`Approval ${decision}.`);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const statusCounts = health?.statusCounts || {};
  const model = health?.model || registry.model || {};
  const cost = health?.cost || {};

  return (
    <div className="contrast-dark rounded-2xl border border-emerald-500/20 bg-slate-950 p-5 shadow-2xl">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Operational Agent Runtime</h2>
              <p className="text-sm text-slate-400">Persisted tasks, safe tools, approval gates, and cost tracking.</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={loadAll} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-60">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            Refresh
          </button>
          <button onClick={runNext} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run Next
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
          {error}
        </div>
      )}
      {notice && (
        <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          {notice}
        </div>
      )}

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Database} label="Runtime" value={health?.runtimeOnline ? 'Online' : 'Offline'} status={health?.runtimeOnline ? 'online' : 'offline'} />
        <Metric icon={Clock} label="Worker" value={health?.worker?.processRunning ? 'Running' : 'Stopped'} status={health?.worker?.processRunning ? 'running' : 'offline'} />
        <Metric icon={Wrench} label="Tools Loaded" value={health?.tools?.loaded ?? registry.tools?.length ?? 0} status="completed" />
        <Metric icon={DollarSign} label="Monthly AI Cost" value={`$${Number(cost.monthlyCostUsd || 0).toFixed(4)}`} status={Number(cost.monthlyCostUsd || 0) > Number(cost.monthlyBudgetUsd || 0) ? 'failed' : 'completed'} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[0.92fr_1.08fr]">
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
          <h3 className="text-sm font-semibold text-white">Start Controlled Task</h3>
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-400">Task</span>
              <input
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-400">Specialist</span>
              <select
                value={form.agentId}
                onChange={(event) => setForm((current) => ({ ...current, agentId: event.target.value, taskType: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400"
              >
                {(registry.agents || []).map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </select>
            </label>
            {selectedAgent && (
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs leading-5 text-slate-400">
                <div className="font-semibold text-slate-200">{selectedAgent.description}</div>
                <div className="mt-1">Model: {selectedAgent.modelChoice}</div>
                <div>Max tool calls: {selectedAgent.maxToolCalls} | Max tokens: {selectedAgent.maxTokenBudget}</div>
              </div>
            )}
            <button onClick={createTask} disabled={busy || !form.title.trim()} className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60">
              Queue Task
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
          <h3 className="text-sm font-semibold text-white">Runtime Health</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Info label="Provider/API" value={model.primaryProvider || 'none'} />
            <Info label="Current model" value={model.currentModel || 'not configured'} />
            <Info label="Token mode" value={model.tokenMode || 'tool first'} />
            <Info label="Budget remaining" value={`$${Number(cost.monthlyBudgetRemainingUsd || 0).toFixed(2)}`} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {['queued', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled'].map((status) => (
              <span key={status} className={cn('rounded-full border px-2.5 py-1 text-xs', statusClass(status))}>
                {status.replace('_', ' ')}: {statusCounts[status] || 0}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
          <h3 className="text-sm font-semibold text-white">Recent Tasks</h3>
          <div className="mt-3 space-y-2">
            {tasks.length === 0 ? (
              <p className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm text-slate-500">No persisted agent tasks yet.</p>
            ) : tasks.map((task) => (
              <div key={task.id} className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-white">{task.title}</div>
                    <div className="text-xs text-slate-500">{task.selected_agent_name || task.selected_agent_id}</div>
                  </div>
                  <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-xs', statusClass(task.status))}>{task.status}</span>
                </div>
                {task.error && <div className="mt-2 text-xs text-rose-300">{task.error}</div>}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
          <h3 className="text-sm font-semibold text-white">Approval Queue</h3>
          <div className="mt-3 space-y-2">
            {approvals.length === 0 ? (
              <p className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm text-slate-500">No pending risky actions.</p>
            ) : approvals.map((approval) => (
              <div key={approval.id} className="rounded-lg border border-amber-500/20 bg-amber-500/8 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-white">{approval.action_type}</div>
                    <div className="text-xs text-slate-400">{approval.title}</div>
                  </div>
                  <span className={cn('rounded-full border px-2 py-0.5 text-xs', statusClass(approval.status))}>{approval.status}</span>
                </div>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => decideApproval(approval.id, 'approve')} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Approve
                  </button>
                  <button onClick={() => decideApproval(approval.id, 'reject')} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-500">
                    <XCircle className="h-3.5 w-3.5" />
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {!model.configured && (
        <div className="mt-5 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            No model API key is configured in this environment. The runtime still executes deterministic, zero-token tools, but LLM reasoning will stay disabled until ANTHROPIC_API_KEY or GEMINI_API_KEY is configured.
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ icon: Icon, label, value, status }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-slate-500">{label}</div>
          <div className="mt-1 text-lg font-semibold text-white">{value}</div>
        </div>
        <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg border', statusClass(status))}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm font-medium text-slate-200">{value}</div>
    </div>
  );
}
