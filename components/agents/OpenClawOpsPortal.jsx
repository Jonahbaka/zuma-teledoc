'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Command,
  Cpu,
  Database,
  GitBranch,
  Globe,
  Layers,
  Lock,
  Play,
  RotateCcw,
  Search,
  Shield,
  Terminal,
  Wifi,
  Zap
} from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import HolographicAvatar from '@/components/agents/HolographicAvatar';
import { ARCHITECTURE_LAYERS, getArchitecturePersona, getThemeForColor } from '@/lib/agentPersonas';
import { useSpeechSynthesis } from '@/lib/useSpeechSynthesis';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

const safeJson = (value, fallback = []) => {
  if (!value) return fallback;
  if (Array.isArray(value) || typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
};

function classNames(...parts) {
  return parts.filter(Boolean).join(' ');
}

function statusPill(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'running' || s === 'active') return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300';
  if (s === 'halted' || s === 'warning') return 'bg-amber-500/10 border-amber-500/20 text-amber-300';
  if (s === 'failed' || s === 'error' || s === 'critical') return 'bg-rose-500/10 border-rose-500/20 text-rose-300';
  return 'bg-white/5 border-white/10 text-slate-300';
}

function timeAgo(iso) {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  const delta = Date.now() - dt.getTime();
  const sec = Math.max(0, Math.floor(delta / 1000));
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export default function OpenClawOpsPortal() {
  const { user } = useAuth();
  const [activeLayer, setActiveLayer] = useState('gateway'); // gateway | runtime | memory | skills
  const [activeTab, setActiveTab] = useState('overview'); // overview | lanes | events | memory | skills | blockers
  const [soundEnabled, setSoundEnabled] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [dashboard, setDashboard] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [streamLogs, setStreamLogs] = useState([]);
  const [socketConnected, setSocketConnected] = useState(false);

  const [telemetry, setTelemetry] = useState(null);
  const [runLoop, setRunLoop] = useState(null);
  const [eventStats, setEventStats] = useState(null);
  const [recentEvents, setRecentEvents] = useState([]);
  const [memoryStats, setMemoryStats] = useState([]);
  const [dynamicSkills, setDynamicSkills] = useState([]);
  const [registrySkills, setRegistrySkills] = useState([]);

  const [actionLoading, setActionLoading] = useState(false);
  const [runningCycle, setRunningCycle] = useState(false);

  const terminalEndRef = useRef(null);
  const { supported: voiceSupported, speak, stop } = useSpeechSynthesis();

  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null), []);

  const apiCall = useCallback(async (endpoint, method = 'GET', body = null) => {
    const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(`${API_URL}${endpoint}`, options);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Request failed');
    return data.data;
  }, [token]);

  const opsApiCall = useCallback(async (endpoint, method = 'GET', body = null) => {
    return apiCall(`/agent-ops${endpoint}`, method, body);
  }, [apiCall]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [
        dash,
        props,
        audit,
        tel,
        rl,
        evStats,
        evRecent,
        memStats,
        dynSkills,
        sk
      ] = await Promise.all([
        opsApiCall('/dashboard'),
        opsApiCall('/proposals?status=pending_review&limit=40'),
        opsApiCall('/audit-log?limit=80'),
        opsApiCall('/telemetry/overview'),
        opsApiCall('/telemetry/run-loop'),
        opsApiCall('/telemetry/event-bus'),
        opsApiCall('/telemetry/events?limit=60'),
        opsApiCall('/telemetry/memory-stats'),
        opsApiCall('/telemetry/dynamic-skills'),
        opsApiCall('/skills?limit=200')
      ]);

      setDashboard(dash);
      setProposals(props || []);
      setAuditLog(audit || []);
      setTelemetry(tel || null);
      setRunLoop(rl || null);
      setEventStats(evStats || null);
      setRecentEvents(evRecent || []);
      setMemoryStats(memStats || []);
      setDynamicSkills(dynSkills || []);
      setRegistrySkills(sk || []);
    } catch (e) {
      setError(e?.message || 'Failed to load AgentOps');
    } finally {
      setLoading(false);
    }
  }, [opsApiCall]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [streamLogs]);

  const getSocketUrl = useCallback(() => {
    if (typeof window === 'undefined') return '';
    if (API_URL.startsWith('http')) return API_URL.replace(/\/api\/?$/, '');
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    return isLocalhost ? 'http://localhost:8080' : window.location.origin;
  }, []);

  useEffect(() => {
    if (!token) return;
    const socket = io(getSocketUrl(), {
      transports: ['websocket', 'polling'],
      auth: { token },
      withCredentials: true
    });

    socket.on('connect', () => {
      setSocketConnected(true);
      socket.emit('agent-ops:subscribe');
    });
    socket.on('disconnect', () => setSocketConnected(false));
    socket.on('agent-ops:subscribed', () => setSocketConnected(true));

    socket.on('agent-ops:event', (event) => {
      const payload = event?.payload || {};
      const next = {
        id: `${event.type}-${event.createdAt}-${Math.random().toString(36).slice(2, 8)}`,
        type: event.type || 'event',
        source: event.source || 'system',
        severity: event.severity || 'info',
        message: payload?.message || payload?.error || payload?.title || '',
        createdAt: event.createdAt || new Date().toISOString()
      };
      setStreamLogs((prev) => [next, ...prev].slice(0, 120));
    });

    socket.on('agent-ops:error', (evt) => setError(evt?.message || 'AgentOps socket error'));
    return () => socket.disconnect();
  }, [getSocketUrl, token]);

  const layerPersona = useMemo(() => getArchitecturePersona(activeLayer), [activeLayer]);
  const layerTheme = useMemo(() => getThemeForColor(layerPersona.colorKey), [layerPersona.colorKey]);

  const blockersCount = useMemo(() => {
    const fromProposals = proposals.filter((p) => ['critical', 'high'].includes(String(p.priority || '').toLowerCase())).length;
    const fromAudit = (auditLog || []).filter((log) => ['error', 'vetoed', 'blocked'].includes(String(log.outcome || '').toLowerCase())).length;
    return fromProposals + fromAudit;
  }, [auditLog, proposals]);

  const runAgentCycle = useCallback(async () => {
    setRunningCycle(true);
    setError('');
    try {
      await opsApiCall('/run-all', 'POST');
      await loadAll();
    } catch (e) {
      setError(e?.message || 'Failed to run agent cycle');
    } finally {
      setRunningCycle(false);
    }
  }, [loadAll, opsApiCall]);

  const emergencyShutdown = useCallback(async () => {
    if (!confirm('This will freeze all agents and block new actions. Continue?')) return;
    setActionLoading(true);
    setError('');
    try {
      await opsApiCall('/emergency-shutdown', 'POST', { reason: 'Manual shutdown from Agent Ops' });
      await loadAll();
    } catch (e) {
      setError(e?.message || 'Failed to shutdown');
    } finally {
      setActionLoading(false);
    }
  }, [loadAll, opsApiCall]);

  const resumeAgents = useCallback(async () => {
    setActionLoading(true);
    setError('');
    try {
      await opsApiCall('/resume', 'POST');
      await loadAll();
    } catch (e) {
      setError(e?.message || 'Failed to resume');
    } finally {
      setActionLoading(false);
    }
  }, [loadAll, opsApiCall]);

  const approveProposal = useCallback(async (id) => {
    setActionLoading(true);
    setError('');
    try {
      await opsApiCall(`/proposals/${id}/approve`, 'POST', { notes: 'Approved from OpenClaw-style Ops UI' });
      await loadAll();
    } catch (e) {
      setError(e?.message || 'Failed to approve');
    } finally {
      setActionLoading(false);
    }
  }, [loadAll, opsApiCall]);

  const toggleVoice = useCallback(() => {
    if (!voiceSupported) return;
    setSoundEnabled((v) => {
      const next = !v;
      if (!next) stop();
      return next;
    });
  }, [stop, voiceSupported]);

  const lanes = useMemo(() => {
    const status = runLoop || telemetry?.runLoop || null;
    const active = status?.active || [];
    const items = [];
    for (let i = 0; i < 4; i++) {
      const wf = active[i] || null;
      if (!wf) {
        items.push({ id: i + 1, status: 'idle', task: 'Waiting for Dispatch', progress: 0 });
        continue;
      }
      const stepCount = Number(wf.stepCount || 0);
      const stepIdx = Number(wf.currentStepIndex || 0);
      const progress = stepCount > 0 ? Math.max(0, Math.min(100, Math.round((stepIdx / stepCount) * 100))) : 0;
      items.push({
        id: i + 1,
        status: wf.status || 'busy',
        task: wf.name || 'workflow',
        progress
      });
    }
    return items;
  }, [runLoop, telemetry]);

  const terminalLogs = useMemo(() => {
    const fromSocket = streamLogs.map((e) => ({
      id: e.id,
      label: e.source,
      type: e.type,
      severity: e.severity,
      message: e.message,
      createdAt: e.createdAt
    }));

    if (fromSocket.length > 0) return fromSocket;

    // Fallback to audit log
    return (auditLog || []).slice(0, 60).map((entry) => ({
      id: String(entry.id),
      label: entry.agent_name || entry.agent_type || 'system',
      type: String(entry.action_type || 'audit').replaceAll('_', ' '),
      severity: String(entry.outcome || 'info'),
      message: typeof entry.details === 'string' ? entry.details : '',
      createdAt: entry.created_at
    }));
  }, [auditLog, streamLogs]);

  const systemStatus = telemetry?.system || dashboard?.system || dashboard?.systemStatus || null;
  const sys = dashboard?.system || {};
  const comp = dashboard?.compliance || {};
  const globalShutdown = !!comp.globalShutdown || String(systemStatus?.operatingMode || '').toLowerCase() === 'shutdown';

  if (loading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="text-center text-slate-300">
          <div className="mx-auto mb-4 w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
            <Command className="w-6 h-6 text-blue-400 animate-pulse" />
          </div>
          <div className="text-sm font-mono text-slate-400">AGENTOPS_BOOT</div>
          <div className="text-xs text-slate-500 mt-1">Loading telemetry + governance gates...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {error && (
        <div className="mb-4 bg-rose-500/10 border border-rose-500/20 text-rose-200 text-sm px-4 py-3 rounded-xl">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left: Architecture layers */}
        <aside className="xl:col-span-4 2xl:col-span-3">
          <div className="bg-[#0D0D14] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center shadow-[0_0_18px_rgba(59,130,246,0.25)]">
                  <Command className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="text-white font-bold tracking-tight font-mono">AGENTOPS</div>
                  <div className="text-[11px] text-slate-500 font-mono flex items-center gap-2">
                    <span className="inline-flex items-center gap-1">
                      <span className={classNames('w-2 h-2 rounded-full', socketConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600')} />
                      <span>{socketConnected ? 'NET_OK' : 'NET_WAIT'}</span>
                    </span>
                    <span>·</span>
                    <span>{String(sys.operatingMode || systemStatus?.operatingMode || 'supervised').toUpperCase()}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => loadAll()}
                className="text-slate-400 hover:text-white text-xs font-mono px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
              >
                REFRESH
              </button>
            </div>

            <div className="p-4">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.18em] font-mono mb-3">
                Architecture Layers
              </div>

              <div className="space-y-2">
                {ARCHITECTURE_LAYERS.map((l) => {
                  const persona = getArchitecturePersona(l.id);
                  const theme = getThemeForColor(persona.colorKey);
                  const active = activeLayer === l.id;
                  const icon = l.id === 'gateway' ? Globe : l.id === 'runtime' ? Cpu : l.id === 'memory' ? Database : Terminal;
                  const Icon = icon;
                  return (
                    <button
                      key={l.id}
                      onClick={() => setActiveLayer(l.id)}
                      className={classNames(
                        'w-full flex items-center gap-3 p-3 rounded-xl border transition-all duration-200 text-left relative overflow-hidden',
                        active ? 'bg-white/[0.03] border-white/10' : 'bg-transparent border-transparent hover:bg-white/[0.02] hover:border-white/5'
                      )}
                    >
                      {active && <div className={classNames('absolute left-0 top-0 bottom-0 w-1', 'bg-gradient-to-b from-blue-500 to-cyan-400')} />}
                      <HolographicAvatar persona={persona} size="xs" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-3">
                          <div className={classNames('font-mono font-bold text-sm', active ? 'text-white' : 'text-slate-300')}>
                            {persona.name}
                          </div>
                          <span className={classNames('text-[10px] px-2 py-0.5 rounded border font-mono', theme.border, theme.accent, 'bg-white/5')}>
                            <Icon size={12} className="inline -mt-0.5 mr-1" />
                            {persona.type}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 truncate font-mono">{persona.role}</div>
                      </div>
                      {active && <Wifi size={14} className={classNames(theme.accent, 'animate-pulse')} />}
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 pt-5 border-t border-white/5">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.18em] font-mono mb-3">
                  Operator Controls
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-2">
                  <button
                    onClick={runAgentCycle}
                    disabled={runningCycle || actionLoading}
                    className="w-full px-4 py-3 rounded-xl bg-blue-600/20 border border-blue-500/30 hover:bg-blue-600/30 text-blue-100 font-mono text-sm flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
                  >
                    <Play size={16} className="text-blue-300" />
                    {runningCycle ? 'RUNNING_CYCLE...' : 'RUN_AGENT_CYCLE'}
                  </button>

                  {globalShutdown ? (
                    <button
                      onClick={resumeAgents}
                      disabled={actionLoading}
                      className="w-full px-4 py-3 rounded-xl bg-emerald-600/20 border border-emerald-500/30 hover:bg-emerald-600/30 text-emerald-100 font-mono text-sm flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
                    >
                      <RotateCcw size={16} className="text-emerald-300" />
                      RESUME
                    </button>
                  ) : (
                    <button
                      onClick={emergencyShutdown}
                      disabled={actionLoading}
                      className="w-full px-4 py-3 rounded-xl bg-rose-600/15 border border-rose-500/30 hover:bg-rose-600/25 text-rose-100 font-mono text-sm flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
                    >
                      <Lock size={16} className="text-rose-300" />
                      HARMONIC_LOCK
                    </button>
                  )}
                </div>

                <div className="mt-4 bg-black/30 border border-white/10 rounded-xl p-4">
                  <div className="text-xs text-slate-500 font-mono mb-2">SESSION</div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">Operator</span>
                    <span className="text-white font-mono">{user?.email || 'ops@doctarx.com'}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-1">
                    <span className="text-slate-400">Blockers</span>
                    <span className={classNames('font-mono', blockersCount > 0 ? 'text-amber-300' : 'text-emerald-300')}>
                      {blockersCount}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* Right: Main */}
        <section className="xl:col-span-8 2xl:col-span-9">
          {/* Tabs */}
          <div className="bg-[#0D0D14] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-white/5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className={classNames('rounded-xl border bg-black/20 p-2', layerTheme.border)}>
                  <Layers className={classNames('w-5 h-5', layerTheme.accent)} />
                </div>
                <div className="min-w-0">
                  <div className="text-white font-bold font-mono truncate">{layerPersona.name}</div>
                  <div className="text-xs text-slate-500 font-mono truncate">{layerPersona.description}</div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={toggleVoice}
                  disabled={!voiceSupported}
                  className={classNames(
                    'px-3 py-2 rounded-lg border text-xs font-mono transition-colors',
                    voiceSupported ? (soundEnabled ? 'bg-blue-600/20 border-blue-500/30 text-blue-100' : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10') : 'bg-white/5 border-white/10 text-slate-500 cursor-not-allowed'
                  )}
                  title={voiceSupported ? 'Toggle voice' : 'Voice not supported in this browser'}
                >
                  VOICE {soundEnabled ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>

            <div className="px-4 pt-4">
              <div className="flex flex-wrap gap-2">
                {[
                  { id: 'overview', label: 'Overview', icon: BarChart3 },
                  { id: 'lanes', label: 'Lanes', icon: GitBranch },
                  { id: 'events', label: 'Events', icon: Zap },
                  { id: 'memory', label: 'Memory', icon: Database },
                  { id: 'skills', label: 'Skills', icon: Terminal },
                  { id: 'blockers', label: 'Blockers', icon: AlertTriangle }
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id)}
                    className={classNames(
                      'px-3 py-2 rounded-lg border text-xs font-mono flex items-center gap-2 transition-colors',
                      activeTab === t.id ? 'bg-blue-600/20 border-blue-500/30 text-blue-100' : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                    )}
                  >
                    <t.icon size={14} className={activeTab === t.id ? 'text-blue-300' : 'text-slate-400'} />
                    {t.label.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Views */}
            <div className="p-4 md:p-6">
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {[
                      { label: 'Agents', value: String(systemStatus?.agentCount || sys.agentCount || 0), icon: Activity, tone: 'text-blue-300' },
                      { label: 'Run Loop', value: telemetry?.runLoop?.isRunning ? 'ALIVE' : 'SLEEP', icon: Cpu, tone: telemetry?.runLoop?.isRunning ? 'text-emerald-300' : 'text-slate-300' },
                      { label: 'Events (24h)', value: String((eventStats?.last24h || []).reduce((a, r) => a + Number(r.count || 0), 0)), icon: Zap, tone: 'text-amber-300' },
                      { label: 'Blockers', value: String(blockersCount), icon: AlertTriangle, tone: blockersCount > 0 ? 'text-rose-300' : 'text-emerald-300' }
                    ].map((c) => (
                      <div key={c.label} className="bg-black/25 border border-white/10 rounded-2xl p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="text-xs text-slate-500 font-mono">{c.label.toUpperCase()}</div>
                          <c.icon className={classNames('w-4 h-4', c.tone)} />
                        </div>
                        <div className={classNames('text-3xl font-bold font-mono', c.tone)}>{c.value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2">
                      <div className="text-xs text-slate-500 font-mono mb-2 flex items-center gap-2">
                        <Terminal size={14} /> LIVE_FEED
                        <span className={classNames('ml-2 px-2 py-0.5 rounded border text-[10px] font-mono', socketConnected ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-white/5 border-white/10 text-slate-400')}>
                          {socketConnected ? 'LIVE' : 'OFFLINE'}
                        </span>
                      </div>
                      <div className="bg-black/35 border border-white/10 rounded-2xl overflow-hidden">
                        <div className="max-h-[360px] overflow-y-auto font-mono text-xs p-4 space-y-2">
                          {terminalLogs.slice(0, 60).map((l) => (
                            <div key={l.id} className="flex gap-3 items-start">
                              <span className="text-slate-600 shrink-0">[{new Date(l.createdAt || Date.now()).toLocaleTimeString()}]</span>
                              <span className="uppercase font-bold shrink-0 w-28 text-slate-400 truncate">{l.label}</span>
                              <span className={classNames('flex-1', String(l.severity || '').includes('error') ? 'text-rose-300' : 'text-slate-300')}>
                                {l.type}{l.message ? ` — ${l.message}` : ''}
                              </span>
                              {soundEnabled && voiceSupported ? (
                                <button
                                  onClick={() => speak(`${l.label}. ${l.type}. ${l.message || ''}`, layerPersona.voiceSettings)}
                                  className="text-slate-500 hover:text-white"
                                  title="Play voice"
                                >
                                  <Play size={14} />
                                </button>
                              ) : null}
                            </div>
                          ))}
                          <div ref={terminalEndRef} />
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-slate-500 font-mono mb-2 flex items-center gap-2">
                        <Shield size={14} /> GOVERNANCE_GATES
                      </div>
                      <div className="bg-black/35 border border-white/10 rounded-2xl p-4 space-y-3">
                        {proposals.length === 0 ? (
                          <div className="text-slate-500 text-sm">
                            <div className="flex items-center gap-2 text-emerald-300 font-mono text-xs">
                              <CheckCircle2 size={14} /> NO_PENDING_PROPOSALS
                            </div>
                            <div className="text-xs text-slate-500 mt-2">Agents are running within policy.</div>
                          </div>
                        ) : proposals.slice(0, 4).map((p) => (
                          <div key={p.id} className="border border-white/10 bg-white/[0.03] rounded-xl p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-slate-200 text-sm font-medium truncate">{p.title}</div>
                                <div className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">
                                  {String(p.category || 'general').toUpperCase()} · {String(p.priority || 'medium').toUpperCase()}
                                </div>
                              </div>
                              <button
                                onClick={() => approveProposal(p.id)}
                                disabled={actionLoading}
                                className="px-3 py-2 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-100 text-xs font-mono hover:bg-emerald-600/30 disabled:opacity-50 transition-colors"
                              >
                                APPROVE
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'lanes' && (
                <div className="space-y-5">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <div className="text-white font-bold font-mono text-lg">LANE_DISPATCHER</div>
                      <div className="text-xs text-slate-500 font-mono">
                        Registered workflows: {runLoop?.registeredWorkflows ?? telemetry?.runLoop?.registeredWorkflows ?? 0} · Active: {runLoop?.activeWorkflows ?? telemetry?.runLoop?.activeWorkflows ?? 0} · Ticks: {runLoop?.tickCount ?? telemetry?.runLoop?.tickCount ?? 0}
                      </div>
                    </div>
                    <button
                      onClick={async () => { try { setRunLoop(await opsApiCall('/telemetry/run-loop')); } catch {} }}
                      className="px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 text-xs font-mono"
                    >
                      PULL_STATUS
                    </button>
                  </div>

                  <div className="grid gap-3">
                    {lanes.map((lane) => (
                      <div key={lane.id} className="bg-black/25 border border-white/10 rounded-2xl p-4 flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center font-mono text-slate-400">
                          L{lane.id}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-3 mb-2">
                            <div className="text-sm text-slate-200 font-medium truncate">{lane.task}</div>
                            <span className={classNames('text-[10px] px-2 py-0.5 rounded border font-mono', statusPill(lane.status))}>
                              {String(lane.status).toUpperCase()}
                            </span>
                          </div>
                          <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-white/5">
                            <div className="h-full bg-blue-500/80 transition-all" style={{ width: `${lane.progress}%` }} />
                          </div>
                        </div>
                        <div className="w-24 text-right text-xs text-slate-500 font-mono">
                          {lane.status === 'idle' ? '—' : `${lane.progress}%`}
                        </div>
                      </div>
                    ))}
                  </div>

                  {(runLoop?.haltedWorkflows || []).length > 0 && (
                    <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4">
                      <div className="text-amber-200 font-mono text-xs mb-2 flex items-center gap-2">
                        <AlertTriangle size={14} /> HALTED_WORKFLOWS
                      </div>
                      <div className="space-y-2">
                        {runLoop.haltedWorkflows.slice(0, 8).map((h) => (
                          <div key={h.id} className="bg-black/30 border border-white/10 rounded-xl p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-slate-200 font-mono text-sm truncate">{h.name}</div>
                                <div className="text-xs text-slate-500 mt-1">{h.prompt}</div>
                              </div>
                              <span className="text-[10px] px-2 py-1 rounded border border-amber-500/20 text-amber-200 font-mono bg-amber-500/10">
                                GATE
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'events' && (
                <div className="space-y-5">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <div className="text-white font-bold font-mono text-lg">EVENT_BUS</div>
                      <div className="text-xs text-slate-500 font-mono">
                        Emitted: {eventStats?.emitted ?? telemetry?.eventBus?.emitted ?? 0} · Subscribers: {eventStats?.subscribers ?? telemetry?.eventBus?.subscribers ?? 0}
                      </div>
                    </div>
                    <button
                      onClick={async () => { try { setRecentEvents(await opsApiCall('/telemetry/events?limit=80')); } catch {} }}
                      className="px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 text-xs font-mono"
                    >
                      PULL_EVENTS
                    </button>
                  </div>

                  <div className="bg-black/25 border border-white/10 rounded-2xl overflow-hidden">
                    <div className="max-h-[520px] overflow-y-auto p-4 space-y-2">
                      {recentEvents.length === 0 ? (
                        <div className="text-slate-500 text-sm font-mono">NO_EVENTS_FOUND</div>
                      ) : recentEvents.map((e) => (
                        <div key={e.id} className="flex items-start justify-between gap-3 border border-white/5 bg-white/[0.02] rounded-xl p-3">
                          <div className="min-w-0">
                            <div className="text-slate-200 font-mono text-sm truncate">{e.event_type}</div>
                            <div className="text-xs text-slate-500 mt-1 truncate">
                              {e.source} · {timeAgo(e.created_at)}
                            </div>
                            {Object.keys(e.payload || {}).length > 0 ? (
                              <pre className="mt-2 text-[11px] text-slate-400 whitespace-pre-wrap font-mono max-h-28 overflow-y-auto">
                                {JSON.stringify(e.payload, null, 2)}
                              </pre>
                            ) : null}
                          </div>
                          <span className={classNames('text-[10px] px-2 py-0.5 rounded border font-mono shrink-0', statusPill(e.severity))}>
                            {String(e.severity || 'info').toUpperCase()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'memory' && (
                <div className="space-y-5">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <div className="text-white font-bold font-mono text-lg">PERSISTENT_MEMORY</div>
                      <div className="text-xs text-slate-500 font-mono">Counts by agent + memory type (DB-backed).</div>
                    </div>
                    <button
                      onClick={async () => { try { setMemoryStats(await opsApiCall('/telemetry/memory-stats')); } catch {} }}
                      className="px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 text-xs font-mono"
                    >
                      PULL_STATS
                    </button>
                  </div>

                  <div className="bg-black/25 border border-white/10 rounded-2xl overflow-hidden">
                    <div className="p-4">
                      {memoryStats.length === 0 ? (
                        <div className="text-slate-500 text-sm font-mono">NO_MEMORY_STATS</div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          {memoryStats.slice(0, 60).map((r, idx) => (
                            <div key={`${r.agent_type}-${r.memory_type}-${idx}`} className="border border-white/10 bg-white/[0.02] rounded-xl p-3">
                              <div className="text-slate-200 font-mono text-sm truncate">{r.agent_type}</div>
                              <div className="text-xs text-slate-500 font-mono mt-1 truncate">{r.memory_type}</div>
                              <div className="mt-2 text-2xl font-bold font-mono text-blue-200">{Number(r.count || 0)}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'skills' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div>
                      <div className="text-white font-bold font-mono text-lg mb-1">DYNAMIC_SKILLS</div>
                      <div className="text-xs text-slate-500 font-mono mb-3">Hot-loaded reflex skills (runtime selector).</div>
                      <div className="bg-black/25 border border-white/10 rounded-2xl p-4 space-y-2 max-h-[520px] overflow-y-auto">
                        {dynamicSkills.length === 0 ? (
                          <div className="text-slate-500 text-sm font-mono">NO_DYNAMIC_SKILLS</div>
                        ) : dynamicSkills.map((s) => (
                          <div key={s.name} className="border border-white/10 bg-white/[0.02] rounded-xl p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-slate-200 font-mono text-sm truncate">{s.displayName || s.name}</div>
                                <div className="text-[11px] text-slate-500 font-mono truncate">{s.name} · v{s.version}</div>
                              </div>
                              <span className={classNames('text-[10px] px-2 py-0.5 rounded border font-mono shrink-0', statusPill(s.riskLevel))}>
                                {String(s.riskLevel || 'medium').toUpperCase()}
                              </span>
                            </div>
                            {s.description ? <div className="text-xs text-slate-400 mt-2">{s.description}</div> : null}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="text-white font-bold font-mono text-lg mb-1">REGISTRY_SKILLS</div>
                      <div className="text-xs text-slate-500 font-mono mb-3">Governance-reviewed skill registry (policy layer).</div>
                      <div className="bg-black/25 border border-white/10 rounded-2xl p-4 space-y-2 max-h-[520px] overflow-y-auto">
                        {registrySkills.length === 0 ? (
                          <div className="text-slate-500 text-sm font-mono">NO_REGISTRY_SKILLS</div>
                        ) : registrySkills.slice(0, 120).map((s) => (
                          <div key={s.id || s.name} className="border border-white/10 bg-white/[0.02] rounded-xl p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-slate-200 font-mono text-sm truncate">{s.display_name || s.displayName || s.name}</div>
                                <div className="text-[11px] text-slate-500 font-mono truncate">
                                  {String(s.category || 'general').toUpperCase()} · risk:{String(s.risk_level || s.riskLevel || 'medium')}
                                </div>
                              </div>
                              <span className={classNames('text-[10px] px-2 py-0.5 rounded border font-mono shrink-0', statusPill(s.compliance_status || 'pending'))}>
                                {String(s.compliance_status || 'pending').toUpperCase()}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'blockers' && (
                <div className="space-y-6">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <div className="text-white font-bold font-mono text-lg">ACTIVE_BLOCKERS</div>
                      <div className="text-xs text-slate-500 font-mono">Proposals + audit outcomes requiring attention.</div>
                    </div>
                    <button
                      onClick={loadAll}
                      className="px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 text-xs font-mono"
                    >
                      REFRESH
                    </button>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="bg-black/25 border border-white/10 rounded-2xl p-4">
                      <div className="text-xs text-slate-500 font-mono mb-3">PENDING_PROPOSALS</div>
                      {proposals.length === 0 ? (
                        <div className="text-slate-500 text-sm font-mono">NONE</div>
                      ) : proposals.slice(0, 12).map((p) => (
                        <div key={p.id} className="border border-white/10 bg-white/[0.02] rounded-xl p-3 mb-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-slate-200 text-sm font-medium truncate">{p.title}</div>
                              <div className="text-[10px] text-slate-500 font-mono mt-1">
                                {String(p.agent_name || 'agent').toUpperCase()} · {String(p.priority || 'medium').toUpperCase()}
                              </div>
                            </div>
                            <button
                              onClick={() => approveProposal(p.id)}
                              disabled={actionLoading}
                              className="px-3 py-2 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-100 text-xs font-mono hover:bg-emerald-600/30 disabled:opacity-50 transition-colors"
                            >
                              APPROVE
                            </button>
                          </div>
                          {p.summary ? <div className="text-xs text-slate-400 mt-2">{p.summary}</div> : null}
                        </div>
                      ))}
                    </div>

                    <div className="bg-black/25 border border-white/10 rounded-2xl p-4">
                      <div className="text-xs text-slate-500 font-mono mb-3">AUDIT_ALERTS</div>
                      {auditLog.length === 0 ? (
                        <div className="text-slate-500 text-sm font-mono">NONE</div>
                      ) : auditLog
                        .filter((log) => ['error', 'vetoed', 'blocked'].includes(String(log.outcome || '').toLowerCase()))
                        .slice(0, 20)
                        .map((log) => (
                          <div key={log.id} className="border border-white/10 bg-white/[0.02] rounded-xl p-3 mb-2">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-slate-200 font-mono text-sm truncate">{log.agent_name || log.agent_type || 'system'}</div>
                                <div className="text-[10px] text-slate-500 font-mono mt-1 truncate">
                                  {String(log.action_type || '').replaceAll('_', ' ')} · {timeAgo(log.created_at)}
                                </div>
                              </div>
                              <span className={classNames('text-[10px] px-2 py-0.5 rounded border font-mono', statusPill(log.outcome))}>
                                {String(log.outcome || 'error').toUpperCase()}
                              </span>
                            </div>
                            {log.details ? <div className="text-xs text-slate-400 mt-2">{String(log.details)}</div> : null}
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

