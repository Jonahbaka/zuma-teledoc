'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  Command,
  Cpu,
  Database,
  Globe,
  Hand,
  Heart,
  Layers,
  Lock,
  MessageSquare,
  Play,
  RefreshCw,
  Search,
  Shield,
  Terminal,
  Wifi,
  Zap
} from 'lucide-react';
import { io } from 'socket.io-client';
import HolographicAvatar from '@/components/agents/HolographicAvatar';
import { ARCHITECTURE_LAYERS, COUNCIL_PERSONAS, getArchitecturePersona, getCouncilPersona, getThemeForColor } from '@/lib/agentPersonas';
import { useSpeechSynthesis } from '@/lib/useSpeechSynthesis';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

const ARCH_ICON = {
  gateway: Command,
  runtime: Cpu,
  memory: Database,
  skills: Terminal
};

const COUNCIL_ICON = {
  all: Wifi,
  ceo: Command,
  operations: Activity,
  asclepius: Heart,
  triage_nurse: AlertTriangle,
  pharmacist: Hand,
  growth: Globe,
  revenue: Zap,
  compliance: Shield,
  governance: Layers,
  corporate_skills: Layers,
  researcher: Search,
  economics: BarChart3,
  physicist: Cpu,
  mathematician: Cpu,
  vortex_math: Cpu,
  devops: Terminal,
  accounting: Database,
  engineering: Terminal
};

function formatAgo(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function safeJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export default function AgentOpsDashboard() {
  const [activeTab, setActiveTab] = useState('command'); // command | lanes | events | memory | skills | agents
  const [activeLayer, setActiveLayer] = useState('gateway'); // gateway | runtime | memory | skills
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [dashboard, setDashboard] = useState(null);
  const [runLoop, setRunLoop] = useState(null);
  const [eventStats, setEventStats] = useState(null);
  const [recentEvents, setRecentEvents] = useState([]);
  const [dynamicSkills, setDynamicSkills] = useState([]);
  const [memoryStats, setMemoryStats] = useState([]);
  const [streamLogs, setStreamLogs] = useState([]);
  const [socketConnected, setSocketConnected] = useState(false);

  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const { supported: voiceSupported, speak } = useSpeechSynthesis();

  const scrollRef = useRef(null);

  const getToken = () => (typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null);
  const getSocketUrl = () => {
    if (typeof window === 'undefined') return '';
    if (API_URL.startsWith('http')) return API_URL.replace(/\/api\/?$/, '');
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    return isLocal ? 'http://localhost:8080' : window.location.origin;
  };

  const apiCall = useCallback(async (endpoint, method = 'GET', body = null) => {
    const token = getToken();
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${API_URL}/agent-ops${endpoint}`, opts);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Request failed');
    return data.data;
  }, []);

  const adminApiCall = useCallback(async (endpoint, method = 'GET', body = null) => {
    const token = getToken();
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${API_URL}${endpoint}`, opts);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Request failed');
    return data.data;
  }, []);

  const loadAll = useCallback(async (showSpinner = true) => {
    try {
      if (showSpinner) setLoading(true);
      setError('');
      const [dash, rl, evStats, ev, skills, mem] = await Promise.all([
        apiCall('/dashboard'),
        apiCall('/run-loop'),
        apiCall('/events/stats'),
        apiCall('/events?limit=60'),
        apiCall('/dynamic-skills'),
        apiCall('/memory/stats')
      ]);
      setDashboard(dash);
      setRunLoop(rl);
      setEventStats(evStats);
      setRecentEvents(ev || []);
      setDynamicSkills(skills || []);
      setMemoryStats(mem || []);
    } catch (e) {
      setError(e?.message || 'Failed to load AgentOps');
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [apiCall]);

  useEffect(() => { loadAll(true); }, [loadAll]);

  // Lightweight refresh loop (keeps the UI "alive" without spamming).
  useEffect(() => {
    const t = setInterval(() => loadAll(false), 15000);
    return () => clearInterval(t);
  }, [loadAll]);

  // Socket stream (real events, not simulation).
  useEffect(() => {
    const token = getToken();
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
        createdAt: event.createdAt || new Date().toISOString(),
        summary: payload?.summary || payload?.message || payload?.error || '',
        payload
      };
      setStreamLogs((prev) => [next, ...prev].slice(0, 120));
    });

    socket.on('agent-ops:error', (evt) => setError(evt?.message || 'AgentOps socket error'));
    return () => socket.disconnect();
  }, []);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = 0;
  }, [streamLogs]);

  const sys = dashboard?.system || {};
  const comp = dashboard?.compliance || {};
  const gov = dashboard?.governance || {};
  const agents = Array.isArray(sys.agents) ? sys.agents : [];

  const layerPersona = useMemo(() => getArchitecturePersona(activeLayer), [activeLayer]);
  const layerTheme = useMemo(() => getThemeForColor(layerPersona.colorKey), [layerPersona.colorKey]);

  const activeHalted = Array.isArray(runLoop?.haltedWorkflows) ? runLoop.haltedWorkflows : [];
  const workflows = Array.isArray(runLoop?.workflows) ? runLoop.workflows : [];
  const activeWorkflows = Array.isArray(runLoop?.active) ? runLoop.active : [];

  const runVortexCycle = async () => {
    try {
      setError('');
      await apiCall('/run-all', 'POST');
      await loadAll(false);
    } catch (e) {
      setError(e?.message || 'Failed to run agent cycle');
    }
  };

  const runGrowthGenesis = async () => {
    try {
      setError('');
      await adminApiCall('/inbox/wake-up', 'POST');
      await adminApiCall('/inbox/run-missions', 'POST');
      await loadAll(false);
    } catch (e) {
      setError(e?.message || 'Failed to run growth genesis');
    }
  };

  const emergencyShutdown = async () => {
    if (!confirm('This will freeze all agents and block new actions. Continue?')) return;
    try {
      setError('');
      await apiCall('/emergency-shutdown', 'POST', { reason: 'Manual shutdown from AgentOps' });
      await loadAll(false);
    } catch (e) {
      setError(e?.message || 'Shutdown failed');
    }
  };

  const resume = async () => {
    try {
      setError('');
      await apiCall('/resume', 'POST');
      await loadAll(false);
    } catch (e) {
      setError(e?.message || 'Resume failed');
    }
  };

  const resumeWorkflow = async (workflowId, approved) => {
    try {
      setError('');
      await apiCall(`/workflows/${workflowId}/resume`, 'POST', { approved });
      await loadAll(false);
    } catch (e) {
      setError(e?.message || 'Workflow resume failed');
    }
  };

  const speakLog = (text, persona) => {
    if (!voiceEnabled || !voiceSupported) return;
    speak(text, persona?.voiceSettings || {});
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" /> Initializing AgentOps...
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Background grid */}
      <div
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          maskImage: 'radial-gradient(circle at 30% 10%, black, transparent 70%)'
        }}
      />

      <div className="relative z-10">
        {error ? (
          <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 text-red-200 px-4 py-3 text-sm flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5" />
            <div className="flex-1">{error}</div>
          </div>
        ) : null}

        {/* Top control bar */}
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <HolographicAvatar persona={layerPersona} size="sm" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl md:text-2xl font-bold text-white font-mono tracking-tight">AGENTOPS</h1>
                <span className={cn('text-[10px] px-2 py-0.5 rounded-full border bg-black/20', socketConnected ? 'border-emerald-500/30 text-emerald-300' : 'border-white/10 text-slate-400')}>
                  {socketConnected ? 'WS CONNECTED' : 'WS OFFLINE'}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-white/10 text-slate-300 bg-black/20">
                  MODE: {(sys.operatingMode || 'supervised').toUpperCase()}
                </span>
              </div>
              <div className="text-xs text-slate-400">
                Brain Stem: {runLoop?.isRunning ? 'ALIVE' : 'SLEEP'} · Workflows: {runLoop?.registeredWorkflows ?? '—'} · Skills: {dynamicSkills.length}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => loadAll(false)} variant="outline" className="bg-white/5 border-white/10 text-white hover:bg-white/10">
              <RefreshCw className="w-4 h-4 mr-2" /> Refresh
            </Button>
            <Button onClick={runVortexCycle} className="bg-blue-600 hover:bg-blue-500 text-white">
              <Play className="w-4 h-4 mr-2" /> Run Vortex Cycle
            </Button>
            <Button onClick={runGrowthGenesis} className="bg-purple-700 hover:bg-purple-600 text-white">
              <Zap className="w-4 h-4 mr-2" /> Growth Genesis
            </Button>
            {comp?.globalShutdown ? (
              <Button onClick={resume} className="bg-emerald-700 hover:bg-emerald-600 text-white">
                <CheckCircle2 className="w-4 h-4 mr-2" /> Resume
              </Button>
            ) : (
              <Button onClick={emergencyShutdown} className="bg-red-800 hover:bg-red-700 text-white">
                <Lock className="w-4 h-4 mr-2" /> Harmonic Lock
              </Button>
            )}
            <Button
              onClick={() => setVoiceEnabled((v) => !v)}
              variant="outline"
              className={cn('bg-white/5 border-white/10 text-white hover:bg-white/10', voiceEnabled ? 'ring-2 ring-blue-500/20' : '')}
              title={voiceSupported ? 'Toggle voice readout' : 'Voice not supported in this browser'}
            >
              <MessageSquare className="w-4 h-4 mr-2" />
              Voice {voiceEnabled ? 'On' : 'Off'}
            </Button>
          </div>
        </div>

        {/* Local sidebar + main */}
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          {/* Left: Architecture layers */}
          <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur p-4">
            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-3">Architecture Layers</div>
            <div className="space-y-2">
              {ARCHITECTURE_LAYERS.map((layer) => {
                const persona = getArchitecturePersona(layer.id);
                const theme = getThemeForColor(persona.colorKey);
                const Icon = ARCH_ICON[layer.id] || Layers;
                const active = activeLayer === layer.id;
                return (
                  <button
                    key={layer.id}
                    onClick={() => setActiveLayer(layer.id)}
                    className={cn(
                      'w-full flex items-center gap-3 p-3 rounded-xl border transition-colors text-left',
                      active ? cn('bg-white/[0.04]', theme.border) : 'bg-transparent border-transparent hover:bg-white/[0.03] hover:border-white/10'
                    )}
                  >
                    <HolographicAvatar persona={persona} size="xs" />
                    <div className="min-w-0 flex-1">
                      <div className={cn('text-sm font-medium truncate', active ? 'text-white' : 'text-slate-300')}>
                        {persona.name}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate font-mono">{persona.role}</div>
                    </div>
                    <Icon className={cn('w-4 h-4', theme.accent)} />
                  </button>
                );
              })}
            </div>

            <div className="mt-4 pt-4 border-t border-white/10">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-2">Views</div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['command', 'Command', Command],
                  ['lanes', 'Lanes', Cpu],
                  ['events', 'Events', Wifi],
                  ['memory', 'Memory', Database],
                  ['skills', 'Skills', Terminal],
                  ['agents', 'Agents', Activity]
                ].map(([id, label, I]) => (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className={cn(
                      'px-3 py-2 rounded-lg text-xs font-mono border transition-colors flex items-center gap-2',
                      activeTab === id ? cn('bg-white/[0.05]', layerTheme.border, 'text-white') : 'bg-transparent border-white/10 text-slate-400 hover:bg-white/[0.03]'
                    )}
                  >
                    <I className="w-3.5 h-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right: Main view */}
          <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur p-4 md:p-6">
            {activeTab === 'command' && (
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm text-slate-400 font-mono uppercase tracking-widest">Command Center</div>
                    <div className="text-white text-xl font-bold">{layerPersona.quote}</div>
                    <div className="text-slate-400 text-sm mt-2 max-w-2xl">{layerPersona.description}</div>
                  </div>
                  <div className={cn('hidden md:flex items-center gap-2 px-3 py-2 rounded-xl border bg-white/[0.03]', layerTheme.border)}>
                    <Wifi className={cn('w-4 h-4', socketConnected ? 'text-emerald-400' : 'text-slate-500')} />
                    <span className="text-xs font-mono text-slate-300">UPTIME: {sys.uptime ?? '—'}s</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  {[
                    { k: 'Active Agents', v: sys.agentCount ?? 0, icon: Activity },
                    { k: 'Pending Intents', v: gov?.intents?.pending ?? 0, icon: Clock },
                    { k: 'Pending Proposals', v: gov?.proposals?.pending_review ?? 0, icon: AlertTriangle },
                    { k: 'RunLoop Ticks', v: runLoop?.tickCount ?? '—', icon: Cpu }
                  ].map((m) => (
                    <div key={m.k} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-slate-500 font-mono uppercase">{m.k}</div>
                        <m.icon className="w-4 h-4 text-slate-400" />
                      </div>
                      <div className="text-2xl font-bold text-white mt-2 font-mono">{String(m.v)}</div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-mono uppercase tracking-widest text-slate-500">Brain Stem</div>
                      <span className={cn('text-[10px] font-mono px-2 py-0.5 rounded border', runLoop?.isRunning ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10' : 'border-white/10 text-slate-400 bg-white/5')}>
                        {runLoop?.isRunning ? 'ALIVE' : 'SLEEP'}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                      <div className="text-slate-300"><span className="text-slate-500 font-mono text-xs">ACTIVE</span><div className="font-mono text-white text-lg">{runLoop?.activeWorkflows ?? 0}</div></div>
                      <div className="text-slate-300"><span className="text-slate-500 font-mono text-xs">HALTED</span><div className="font-mono text-white text-lg">{activeHalted.length}</div></div>
                    </div>
                    {activeHalted.length > 0 ? (
                      <div className="mt-4 space-y-2">
                        {activeHalted.slice(0, 3).map((h) => (
                          <div key={h.id} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm text-white font-mono truncate">{h.name}</div>
                              <div className="flex items-center gap-2">
                                <button onClick={() => resumeWorkflow(h.id, true)} className="text-xs px-2 py-1 rounded bg-emerald-600/20 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-600/30">
                                  Approve
                                </button>
                                <button onClick={() => resumeWorkflow(h.id, false)} className="text-xs px-2 py-1 rounded bg-red-600/10 text-red-300 border border-red-500/20 hover:bg-red-600/20">
                                  Reject
                                </button>
                              </div>
                            </div>
                            {h.prompt ? <div className="text-xs text-amber-200/80 mt-2">{h.prompt}</div> : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-4 text-xs text-slate-500 font-mono">No approval gates pending.</div>
                    )}
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-mono uppercase tracking-widest text-slate-500">Nervous System</div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-white/10 text-slate-300 bg-white/5">
                        EVENTS: {eventStats?.totalEvents ?? '—'}
                      </span>
                    </div>
                    <div className="mt-3 space-y-2 text-sm">
                      {(recentEvents || []).slice(0, 6).map((evt) => (
                        <button
                          key={evt.id || `${evt.type}-${evt.created_at}`}
                          className="w-full text-left rounded-lg border border-white/10 bg-white/[0.02] hover:bg-white/[0.04] p-3 transition-colors"
                          onClick={() => speakLog(`${evt.type}: ${evt.summary || ''}`, layerPersona)}
                          title={voiceEnabled ? 'Click to speak' : undefined}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-xs font-mono text-slate-300 truncate">{evt.type}</div>
                            <div className="text-[10px] font-mono text-slate-500">{formatAgo(evt.created_at || evt.createdAt)}</div>
                          </div>
                          {evt.summary ? <div className="text-xs text-slate-400 mt-1 line-clamp-2">{evt.summary}</div> : null}
                        </button>
                      ))}
                      {(recentEvents || []).length === 0 ? (
                        <div className="text-xs text-slate-500 font-mono">No events yet.</div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'lanes' && (
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm text-slate-400 font-mono uppercase tracking-widest">Lanes</div>
                    <div className="text-white text-xl font-bold">Run Loop Workflows</div>
                    <div className="text-slate-400 text-sm mt-2">Real workflow execution state (no simulation): registered, active, halted.</div>
                  </div>
                  <div className="text-xs font-mono text-slate-400 flex items-center gap-2">
                    <Cpu className="w-4 h-4" /> ticks={runLoop?.tickCount ?? 0} idle={runLoop?.consecutiveIdleTicks ?? 0}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {[
                    { k: 'Registered', v: runLoop?.registeredWorkflows ?? workflows.length, icon: Layers },
                    { k: 'Active', v: runLoop?.activeWorkflows ?? activeWorkflows.length, icon: Activity },
                    { k: 'Halted', v: activeHalted.length, icon: AlertTriangle }
                  ].map((m) => (
                    <div key={m.k} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-slate-500 font-mono uppercase">{m.k}</div>
                        <m.icon className="w-4 h-4 text-slate-400" />
                      </div>
                      <div className="text-2xl font-bold text-white mt-2 font-mono">{String(m.v)}</div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="text-xs font-mono uppercase tracking-widest text-slate-500 mb-3">Registered Workflows</div>
                    <div className="space-y-2">
                      {workflows.slice(0, 30).map((wf) => (
                        <div key={wf.name} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm text-white font-mono truncate">{wf.name}</div>
                            <div className="text-[10px] font-mono text-slate-500">{wf.schedule ? `SCHED:${wf.schedule}` : 'EVENT'}</div>
                          </div>
                          {wf.description ? <div className="text-xs text-slate-400 mt-1">{wf.description}</div> : null}
                          <div className="text-[10px] font-mono text-slate-500 mt-2">
                            last={wf.lastRunAt ? formatAgo(wf.lastRunAt) : '—'} · triggers={(wf.triggerEvents || []).length}
                          </div>
                        </div>
                      ))}
                      {workflows.length === 0 ? <div className="text-xs text-slate-500 font-mono">No workflows registered.</div> : null}
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="text-xs font-mono uppercase tracking-widest text-slate-500 mb-3">Active Workflows</div>
                    <div className="space-y-2">
                      {activeWorkflows.slice(0, 30).map((wf) => (
                        <div key={wf.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm text-white font-mono truncate">{wf.name}</div>
                            <span className={cn('text-[10px] font-mono px-2 py-0.5 rounded border',
                              wf.status === 'running' ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10'
                                : wf.status === 'halted' ? 'border-amber-500/30 text-amber-300 bg-amber-500/10'
                                  : wf.status === 'failed' ? 'border-red-500/30 text-red-300 bg-red-500/10'
                                    : 'border-white/10 text-slate-300 bg-white/5'
                            )}>
                              {String(wf.status || 'idle').toUpperCase()}
                            </span>
                          </div>
                          <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-slate-500">
                            <span>step {Number(wf.currentStepIndex || 0) + 1}/{wf.stepCount || '—'}</span>
                            <span>{wf.startedAt ? formatAgo(wf.startedAt) : '—'}</span>
                          </div>
                          {wf.error ? <div className="text-xs text-red-200/80 mt-2">{wf.error}</div> : null}
                        </div>
                      ))}
                      {activeWorkflows.length === 0 ? <div className="text-xs text-slate-500 font-mono">No active workflows.</div> : null}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'events' && (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm text-slate-400 font-mono uppercase tracking-widest">Events</div>
                    <div className="text-white text-xl font-bold">Nervous System Stream</div>
                    <div className="text-slate-400 text-sm mt-2">Socket stream + persisted events. Click an event to speak it.</div>
                  </div>
                  <div className="text-xs font-mono text-slate-400 flex items-center gap-2">
                    <Wifi className="w-4 h-4" /> {socketConnected ? 'connected' : 'offline'}
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="text-xs font-mono uppercase tracking-widest text-slate-500 mb-3">Live Stream</div>
                    <div ref={scrollRef} className="max-h-[520px] overflow-auto space-y-2">
                      {streamLogs.map((evt) => (
                        <button
                          key={evt.id}
                          onClick={() => speakLog(`${evt.type}: ${evt.summary}`, layerPersona)}
                          className="w-full text-left rounded-lg border border-white/10 bg-white/[0.02] hover:bg-white/[0.04] p-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-xs font-mono text-slate-300 truncate">{evt.type}</div>
                            <div className="text-[10px] font-mono text-slate-500">{formatAgo(evt.createdAt)}</div>
                          </div>
                          {evt.summary ? <div className="text-xs text-slate-400 mt-1 line-clamp-2">{evt.summary}</div> : null}
                        </button>
                      ))}
                      {streamLogs.length === 0 ? <div className="text-xs text-slate-500 font-mono">No live events yet.</div> : null}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="text-xs font-mono uppercase tracking-widest text-slate-500 mb-3">Persisted Events</div>
                    <div className="max-h-[520px] overflow-auto space-y-2">
                      {recentEvents.map((evt) => (
                        <button
                          key={evt.id || `${evt.type}-${evt.created_at}`}
                          onClick={() => speakLog(`${evt.type}: ${evt.summary}`, layerPersona)}
                          className="w-full text-left rounded-lg border border-white/10 bg-white/[0.02] hover:bg-white/[0.04] p-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-xs font-mono text-slate-300 truncate">{evt.type}</div>
                            <div className="text-[10px] font-mono text-slate-500">{formatAgo(evt.created_at || evt.createdAt)}</div>
                          </div>
                          {evt.summary ? <div className="text-xs text-slate-400 mt-1 line-clamp-2">{evt.summary}</div> : null}
                        </button>
                      ))}
                      {recentEvents.length === 0 ? <div className="text-xs text-slate-500 font-mono">No stored events.</div> : null}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'memory' && (
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm text-slate-400 font-mono uppercase tracking-widest">Memory</div>
                    <div className="text-white text-xl font-bold">Second Brain</div>
                    <div className="text-slate-400 text-sm mt-2">Stats across `ai_agent_memory`. Browse by agent in Agent Chat if needed.</div>
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="text-xs font-mono uppercase tracking-widest text-slate-500 mb-3">Memory Stats</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {memoryStats.slice(0, 24).map((row, idx) => (
                      <div key={`${row.agent_type}-${row.memory_type}-${idx}`} className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
                        <div className="text-xs font-mono text-slate-500 uppercase">{row.agent_type} · {row.memory_type}</div>
                        <div className="text-2xl font-bold text-white mt-2 font-mono">{row.count}</div>
                      </div>
                    ))}
                    {memoryStats.length === 0 ? (
                      <div className="text-xs text-slate-500 font-mono">No memory rows yet.</div>
                    ) : null}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'skills' && (
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm text-slate-400 font-mono uppercase tracking-widest">Skills</div>
                    <div className="text-white text-xl font-bold">Reflex Library</div>
                    <div className="text-slate-400 text-sm mt-2">Dynamic skills discovered and loaded by the skill loader.</div>
                  </div>
                  <div className="text-xs font-mono text-slate-400">{dynamicSkills.length} skills</div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="text-xs font-mono uppercase tracking-widest text-slate-500 mb-3">Discovered Skills</div>
                    <div className="max-h-[560px] overflow-auto space-y-2">
                      {dynamicSkills.slice(0, 200).map((s) => (
                        <div key={s.name} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm text-white font-mono truncate">{s.name}</div>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-white/10 text-slate-300 bg-white/5">
                              {String(s.riskLevel || '—').toUpperCase()}
                            </span>
                          </div>
                          <div className="text-xs text-slate-400 mt-1">{s.description || '—'}</div>
                          <div className="text-[10px] font-mono text-slate-500 mt-2">
                            {s.category || 'general'} · steps={s.stepCount ?? '—'} · ext={s.involvesExternal ? 'yes' : 'no'}
                          </div>
                        </div>
                      ))}
                      {dynamicSkills.length === 0 ? <div className="text-xs text-slate-500 font-mono">No skills discovered.</div> : null}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="text-xs font-mono uppercase tracking-widest text-slate-500 mb-3">Skill Health</div>
                    <div className="space-y-3 text-sm text-slate-300">
                      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-mono text-slate-500 uppercase">Watch</div>
                          <div className="text-xs font-mono text-emerald-300">ACTIVE</div>
                        </div>
                        <div className="text-xs text-slate-400 mt-2">Skill loader watches the skills folder and hot-loads changes every 30s.</div>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-mono text-slate-500 uppercase">Compliance</div>
                          <div className="text-xs font-mono text-slate-200">{comp?.globalShutdown ? 'LOCKED' : 'ENFORCED'}</div>
                        </div>
                        <div className="text-xs text-slate-400 mt-2">High-risk skills require approval gates; all actions are audited.</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'agents' && (
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm text-slate-400 font-mono uppercase tracking-widest">Agents</div>
                    <div className="text-white text-xl font-bold">Council Presence</div>
                    <div className="text-slate-400 text-sm mt-2">Real status derived from runtime + persisted `last_run_at`.</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {agents.map((a) => {
                    const persona = getCouncilPersona(a.type);
                    const theme = getThemeForColor(persona.colorKey);
                    const Icon = COUNCIL_ICON[a.type] || COUNCIL_ICON[persona.id] || Activity;
                    const status = String(a.status || 'idle');
                    return (
                      <div key={a.type} className={cn('rounded-2xl border bg-white/[0.02] p-4', theme.border)}>
                        <div className="flex items-start gap-3">
                          <HolographicAvatar persona={persona} size="sm" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-white font-mono truncate">{persona.codeName || a.name}</div>
                              <span className={cn(
                                'text-[10px] font-mono px-2 py-0.5 rounded border',
                                status === 'running' ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10'
                                  : status === 'active' ? 'border-blue-500/30 text-blue-300 bg-blue-500/10'
                                    : status === 'shutdown' ? 'border-red-500/30 text-red-300 bg-red-500/10'
                                      : status === 'disabled' ? 'border-white/10 text-slate-400 bg-white/5'
                                        : 'border-white/10 text-slate-300 bg-white/5'
                              )}>
                                {status.toUpperCase()}
                              </span>
                            </div>
                            <div className="text-xs text-slate-500 truncate">{a.description || persona.description}</div>
                            <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-slate-500">
                              <span>autonomy={a.autonomyLevel ?? 0}/5</span>
                              <span>last={formatAgo(a.lastRunAt)}</span>
                            </div>
                          </div>
                          <Icon className={cn('w-4 h-4 mt-1', theme.accent)} />
                        </div>
                      </div>
                    );
                  })}
                  {agents.length === 0 ? <div className="text-xs text-slate-500 font-mono">No agents.</div> : null}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

