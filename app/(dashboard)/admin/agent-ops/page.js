'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Activity, Users, MonitorUp, MessageSquare, Settings, ShieldCheck, FileText,
  Brain, X, Sparkles, Layout, Terminal, Key, AlertTriangle, CheckCircle, Clock,
  Zap, DollarSign, Search, Bell, LogOut, Play, Database, Globe, Send, Loader2,
  RotateCcw, StopCircle, Menu
} from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { io } from 'socket.io-client';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

const safeJson = (value, fallback = []) => {
  if (!value) return fallback;
  if (Array.isArray(value) || typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
};

const metricCards = (sys, gov, comp, pendingBlockers) => [
  { label: 'Active Agents', value: `${sys.agentCount || 0}`, trend: `${sys.operatingMode || 'OBSERVATION'}`, icon: Activity, color: 'text-blue-400' },
  { label: 'Approved Proposals', value: `${gov.proposals?.approved || 0}`, trend: `${gov.proposals?.pending_review || 0} pending`, icon: DollarSign, color: 'text-emerald-400' },
  { label: 'Pending Intents', value: `${gov.intents?.pending || 0}`, trend: `${gov.intents?.completed || 0} completed`, icon: Clock, color: 'text-orange-400' },
  { label: 'Compliance Health', value: comp.globalShutdown ? 'LOCKED' : 'ACTIVE', trend: `${pendingBlockers} blocker(s)`, icon: Zap, color: comp.globalShutdown ? 'text-red-400' : 'text-purple-400' },
];

export default function AgentOpsPortal() {
  const { user } = useAuth();
  const [activeView, setActiveView] = useState('command');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [dashboard, setDashboard] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [briefings, setBriefings] = useState([]);
  const [skills, setSkills] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [streamLogs, setStreamLogs] = useState([]);
  const [socketConnected, setSocketConnected] = useState(false);
  const [llmStatus, setLlmStatus] = useState({ primary: 'claude', fallback: 'gemini', claudeConfigured: false, geminiConfigured: false });
  const [loading, setLoading] = useState(true);
  const [runningAgent, setRunningAgent] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');

  const getToken = () => (typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null);
  const getSocketUrl = () => {
    if (typeof window === 'undefined') return '';
    if (API_URL.startsWith('http')) return API_URL.replace(/\/api\/?$/, '');
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    return isLocalhost ? 'http://localhost:8080' : window.location.origin;
  };

  const apiCall = useCallback(async (endpoint, method = 'GET', body = null) => {
    const token = getToken();
    const options = {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(`${API_URL}/agent-ops${endpoint}`, options);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Request failed');
    return data.data;
  }, []);

  const adminApiCall = useCallback(async (endpoint, method = 'GET', body = null) => {
    const token = getToken();
    const options = {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(`${API_URL}${endpoint}`, options);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Request failed');
    return data.data;
  }, []);

  const loadDashboard = useCallback(async (showSpinner = true) => {
    try {
      if (showSpinner) setLoading(true);
      setError('');
      const [dash, props, briefs, sk, audit] = await Promise.all([
        apiCall('/dashboard'),
        apiCall('/proposals?status=pending_review&limit=20'),
        apiCall('/briefings?limit=20'),
        apiCall('/skills'),
        apiCall('/audit-log?limit=60')
      ]);
      setDashboard(dash);
      setProposals(props || []);
      setBriefings(briefs || []);
      setSkills(sk || []);
      setAuditLog(audit || []);
    } catch (e) {
      setError(e.message || 'Failed to load agent operations dashboard');
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [apiCall]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

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
      if (payload?.llm) setLlmStatus(payload.llm);
      const next = {
        id: `${event.type}-${event.createdAt}-${Math.random().toString(36).slice(2, 8)}`,
        agent: event.source || 'system',
        action: event.type || 'event',
        status: event.severity === 'error' || event.severity === 'critical' ? 'error' : 'success',
        error: payload?.error || '',
        createdAt: event.createdAt || new Date().toISOString()
      };
      setStreamLogs((prev) => [next, ...prev].slice(0, 100));
    });

    socket.on('agent-ops:error', (evt) => {
      setError(evt?.message || 'AgentOps socket error');
    });

    return () => socket.disconnect();
  }, []);

  const runAllAgents = async () => {
    setRunningAgent('all');
    try {
      await apiCall('/run-all', 'POST');
      await loadDashboard(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setRunningAgent(null);
    }
  };

  const emergencyShutdown = async () => {
    if (!confirm('This will freeze all agents and block new actions. Continue?')) return;
    setActionLoading(true);
    try {
      await apiCall('/emergency-shutdown', 'POST', { reason: 'Manual shutdown from Agent Ops' });
      await loadDashboard(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const resumeAgents = async () => {
    setActionLoading(true);
    try {
      await apiCall('/resume', 'POST');
      await loadDashboard(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const approveProposal = async (id) => {
    try {
      await apiCall(`/proposals/${id}/approve`, 'POST', { notes: 'Approved from Ops Control' });
      await loadDashboard(false);
    } catch (e) {
      setError(e.message);
    }
  };

  const runGrowthGenesis = async () => {
    setActionLoading(true);
    setError('');
    try {
      await adminApiCall('/inbox/wake-up', 'POST');
      await adminApiCall('/inbox/run-missions', 'POST');
      setStreamLogs((prev) => [
        {
          id: `growth-genesis-${Date.now()}`,
          agent: 'growth-orchestrator',
          action: 'genesis web missions launched',
          status: 'success',
          error: '',
          createdAt: new Date().toISOString()
        },
        ...prev
      ].slice(0, 100));
      await loadDashboard(false);
    } catch (e) {
      setError(e.message || 'Failed to launch growth genesis missions');
    } finally {
      setActionLoading(false);
    }
  };

  const sys = dashboard?.system || {};
  const comp = dashboard?.compliance || {};
  const gov = dashboard?.governance || {};
  const blockedFromAudit = auditLog.filter((log) => ['error', 'vetoed', 'blocked'].includes((log.outcome || '').toLowerCase()));
  const pendingBlockers = proposals.filter((p) => ['critical', 'high'].includes((p.priority || '').toLowerCase())).length + blockedFromAudit.length;
  const cards = metricCards(sys, gov, comp, pendingBlockers);

  const fallbackTerminalLogs = auditLog.slice(0, 40).reverse().map((entry) => ({
    id: entry.id,
    agent: entry.agent_name || 'system',
    action: (entry.action_type || 'unknown_action').replace(/_/g, ' '),
    status: entry.outcome || 'processing',
    error: entry.details || '',
    createdAt: entry.created_at
  }));
  const terminalLogs = streamLogs.length > 0 ? streamLogs : fallbackTerminalLogs;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center text-gray-300">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin mx-auto mb-4 text-purple-500" />
          <p>Loading Agent Operations...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[#0a0a0a] text-gray-200 font-sans selection:bg-purple-500/30 flex overflow-hidden">
      {mobileNavOpen && (
        <button
          className="fixed inset-0 bg-black/60 z-30 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-label="Close navigation overlay"
        />
      )}

      {/* Sidebar Navigation */}
      <aside className={`fixed inset-y-0 left-0 w-72 bg-[#0F0F0F] border-r border-gray-800 flex flex-col z-40 transform transition-transform duration-300 lg:static lg:w-64 lg:translate-x-0 ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="h-16 flex items-center px-6 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <DoctaRxLogo className="h-7 w-auto" />
          </div>
        </div>

        <div className="flex-1 py-6 px-3 space-y-1">
          <p className="px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Operations</p>
          <NavItem icon={Layout} label="Command Center" active={activeView === 'command'} onClick={() => setActiveView('command')} />
          <NavItem icon={MessageSquare} label="Admin Inbox" active={activeView === 'inbox'} onClick={() => setActiveView('inbox')} alert={briefings.length > 0 ? briefings.length : undefined} />
          <NavItem icon={MonitorUp} label="Live Monitor" active={activeView === 'monitor'} onClick={() => setActiveView('monitor')} live />

          <p className="px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 mt-6">Management</p>
          <NavItem icon={Users} label="Agents" />
          <NavItem icon={ShieldCheck} label="Compliance" />
          <NavItem icon={Key} label="Credential Readiness" active={activeView === 'credentials'} onClick={() => setActiveView('credentials')} />

          <p className="px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 mt-6">System</p>
          <NavItem icon={Database} label="Logs & Audit" />
          <NavItem icon={Settings} label="Configuration" />
        </div>

        <div className="p-4 border-t border-gray-800">
          <div className="bg-gray-800/50 rounded-lg p-3 flex items-center gap-3 border border-gray-700">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-purple-500 to-blue-500 flex items-center justify-center font-bold text-white text-xs">
              {(user?.firstName?.[0] || 'A').toUpperCase()}{(user?.lastName?.[0] || 'D').toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user?.firstName || 'Admin'} {user?.lastName || 'User'}</p>
              <p className="text-xs text-gray-500 truncate">{user?.email || 'ops@doctarx.com'}</p>
            </div>
            <LogOut size={14} className="text-gray-400" />
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative overflow-hidden lg:ml-0">
        <header className="h-16 border-b border-gray-800 bg-[#0a0a0a] flex items-center justify-between px-4 md:px-6 shrink-0 z-10">
          <div className="flex items-center gap-4 text-sm text-gray-400">
            <button
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-2 rounded-lg bg-gray-900 border border-gray-800 text-gray-300"
              aria-label="Open navigation"
            >
              <Menu size={16} />
            </button>
            <span className="flex items-center gap-2"><Globe size={14} /> doctarx.com</span>
            <span className="text-gray-700 hidden md:inline">/</span>
            <span className="text-purple-400 hidden md:inline">secure/admin/agent-ops</span>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <button onClick={runAllAgents} disabled={runningAgent === 'all' || actionLoading}
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-xl border border-gray-700 transition-colors text-xs font-medium text-gray-300 disabled:opacity-50">
              {runningAgent === 'all' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} className="text-green-400 fill-green-400" />}
              <span className="hidden sm:inline">{runningAgent === 'all' ? 'Running Cycle...' : 'Run Agent Cycle'}</span>
            </button>
            <button onClick={runGrowthGenesis} disabled={actionLoading}
              className="flex items-center gap-2 px-3 py-1.5 bg-purple-700 hover:bg-purple-600 rounded-xl border border-purple-500/30 transition-colors text-xs font-medium text-white disabled:opacity-50">
              {actionLoading ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
              <span className="hidden sm:inline">Run Growth Genesis</span>
            </button>
            {comp.globalShutdown ? (
              <button onClick={resumeAgents} disabled={actionLoading}
                className="flex items-center gap-2 px-3 py-1.5 bg-green-700 hover:bg-green-600 rounded-xl text-xs font-medium text-white disabled:opacity-50">
                <RotateCcw size={12} /> Resume
              </button>
            ) : (
              <button onClick={emergencyShutdown} disabled={actionLoading}
                className="flex items-center gap-2 px-3 py-1.5 bg-red-800 hover:bg-red-700 rounded-xl text-xs font-medium text-white disabled:opacity-50">
                <StopCircle size={12} /> Harmonic Lock
              </button>
            )}
            <div className="w-px h-6 bg-gray-800" />
            <Bell size={18} className="text-gray-400 hidden md:inline" />
            <Search size={18} className="text-gray-400 hidden md:inline" />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 bg-dots-pattern">
          {error && (
            <div className="mb-4 bg-red-500/10 border border-red-500/20 text-red-300 text-sm px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          {activeView === 'command' && (
            <div className="max-w-7xl mx-auto space-y-6">
              <div className="flex justify-between items-end">
                <div>
                  <h1 className="text-2xl font-bold text-white">Operations Control</h1>
                  <p className="text-gray-400 text-sm mt-1">
                    Autonomous Agent Fleet Status: <span className={comp.globalShutdown ? 'text-red-400' : 'text-green-400'}>{comp.globalShutdown ? 'Locked' : 'Operational'}</span>
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {cards.map((metric, idx) => (
                  <div key={idx} className="bg-[#111] p-5 rounded-xl border border-gray-800">
                    <div className="flex justify-between items-start mb-4">
                      <div className={`p-2 rounded-lg bg-gray-900`}><metric.icon size={20} className={metric.color} /></div>
                      <span className="text-xs font-medium text-gray-400 bg-gray-900 px-2 py-0.5 rounded">{metric.trend}</span>
                    </div>
                    <h3 className="text-2xl font-bold text-white">{metric.value}</h3>
                    <p className="text-sm text-gray-500 mt-1">{metric.label}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[520px]">
                <div className="lg:col-span-2 flex flex-col min-h-[360px]">
                  <h3 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
                    <Terminal size={14} /> AgentOps Live Feed
                    <span className={`ml-2 text-[10px] px-2 py-0.5 rounded-full border ${socketConnected ? 'text-green-300 border-green-500/30 bg-green-500/10' : 'text-gray-400 border-gray-700 bg-gray-800'}`}>
                      {socketConnected ? 'Realtime Connected' : 'Connecting...'}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full border border-purple-500/30 bg-purple-500/10 text-purple-200">
                      LLM: {llmStatus.primary} to {llmStatus.fallback}
                    </span>
                  </h3>
                  <AgentLogTerminal logs={terminalLogs} socketConnected={socketConnected} />
                </div>

                <div className="flex flex-col">
                  <h3 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2"><AlertTriangle size={14} /> Active Blockers</h3>
                  <div className="bg-[#111] border border-gray-800 rounded-xl p-4 flex-1 overflow-y-auto space-y-3">
                    {proposals.length === 0 && blockedFromAudit.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-gray-500 text-center p-4">
                        <CheckCircle size={32} className="text-green-900 mb-2" />
                        <p className="text-sm">No active blockers.</p>
                        <p className="text-xs">Agents are running within policy.</p>
                      </div>
                    ) : (
                      <>
                        {proposals.slice(0, 3).map((blocker) => (
                          <div key={blocker.id} className="bg-orange-500/5 border border-orange-500/20 p-3 rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-bold text-orange-400 uppercase">{blocker.agent_name || 'Agent'}</span>
                              <span className="text-[10px] text-gray-500">{new Date(blocker.created_at || Date.now()).toLocaleTimeString()}</span>
                            </div>
                            <p className="text-sm text-gray-300 font-medium">{blocker.title}</p>
                            <button onClick={() => approveProposal(blocker.id)} className="mt-3 w-full py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs rounded transition-colors">
                              Approve Proposal
                            </button>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeView === 'monitor' && (
            <div className="max-w-7xl mx-auto space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-white flex items-center gap-2"><MonitorUp className="text-purple-500" /> Live Agent Monitor</h2>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {(sys.agents || []).map((agent) => (
                  <div key={agent.type} className="bg-[#111] border border-gray-800 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <h3 className="text-white font-medium">{agent.name}</h3>
                        <p className="text-xs text-gray-500">{agent.description}</p>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-xs ${agent.status === 'running' ? 'bg-green-500/15 text-green-300' : 'bg-gray-800 text-gray-300'}`}>
                        {agent.status}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 flex justify-between">
                      <span>Autonomy: {agent.autonomyLevel}/5</span>
                      <span>{agent.emergencyShutdown ? 'Shutdown' : 'Enabled'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeView === 'inbox' && (
            <div className="max-w-5xl mx-auto space-y-6">
              <h2 className="text-xl font-bold text-white">Admin Briefing</h2>
              <div className="bg-[#111] border border-gray-800 rounded-xl overflow-hidden">
                <div className="p-4 border-b border-gray-800 bg-gray-900/50 flex items-center gap-3">
                  <Sparkles className="text-purple-400" size={18} />
                  <h3 className="font-semibold text-white">Ops Summary</h3>
                  <span className="text-xs text-gray-500 ml-auto">
                    Generated from live briefings · {new Date().toLocaleTimeString()}
                  </span>
                </div>
                <div className="p-6 space-y-5 text-sm text-gray-300 leading-relaxed">
                  {briefings.length === 0 ? (
                    <p className="text-gray-500">No briefings yet. Run an agent cycle to generate fresh summaries.</p>
                  ) : briefings.slice(0, 8).map((brief) => (
                    <div key={brief.id} className="bg-gray-900/40 border border-gray-800 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-medium text-white">{brief.title}</h4>
                        <span className="text-[11px] text-gray-500">{brief.agent_name || 'Agent'} · {new Date(brief.briefing_date || Date.now()).toLocaleString()}</span>
                      </div>
                      <p className="text-gray-400">{brief.summary}</p>
                      {safeJson(brief.insights).length > 0 && (
                        <ul className="mt-3 space-y-1">
                          {safeJson(brief.insights).slice(0, 3).map((ins, i) => (
                            <li key={i} className="text-xs text-gray-400 flex items-start gap-2">
                              <span className={ins.severity === 'high' ? 'text-red-400' : 'text-blue-400'}>•</span>
                              <span>{ins.message}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
                <div className="p-3 bg-gray-900/30 border-t border-gray-800 flex gap-2">
                  <input type="text" placeholder="Operator note..."
                    className="flex-1 bg-transparent text-sm px-3 py-2 outline-none text-white placeholder-gray-600" />
                  <button className="p-2 bg-purple-600 text-white rounded-lg hover:bg-purple-500"><Send size={16} /></button>
                </div>
              </div>
            </div>
          )}

          {activeView === 'credentials' && (
            <div className="max-w-5xl mx-auto space-y-6">
              <div>
                <h2 className="text-xl font-bold text-white">Credential Readiness</h2>
                <p className="text-gray-400 text-sm mt-1">Skills that require external systems should be approved and credential-backed.</p>
              </div>

              <div className="grid gap-4">
                {skills.length === 0 ? (
                  <div className="bg-[#111] border border-gray-800 rounded-xl p-6 text-sm text-gray-500">No skills loaded.</div>
                ) : skills.slice(0, 20).map((skill) => (
                  <div key={skill.id} className="bg-[#111] border border-gray-800 rounded-xl p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`p-3 rounded-lg ${skill.involves_external ? 'bg-orange-500/10 text-orange-400' : 'bg-gray-800 text-gray-400'}`}>
                        <Key size={18} />
                      </div>
                      <div>
                        <h3 className="text-white font-medium">{skill.display_name}</h3>
                        <p className="text-xs text-gray-500 mt-0.5">{skill.category} · risk: {skill.risk_level}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      {skill.compliance_status === 'approved' ? (
                        <span className="flex items-center gap-1.5 text-xs text-green-400 bg-green-500/10 px-2 py-1 rounded border border-green-500/20">
                          <CheckCircle size={12} /> Approved
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-xs text-orange-400 bg-orange-500/10 px-2 py-1 rounded border border-orange-500/20">
                          <AlertTriangle size={12} /> {skill.compliance_status || 'pending'}
                        </span>
                      )}
                      <a href="/admin/agent-chat" className="text-sm text-blue-400 hover:text-blue-300 font-medium px-3 py-1.5 hover:bg-blue-500/10 rounded transition-colors">
                        Open Vault
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      <style>{`
        .bg-dots-pattern {
          background-image: radial-gradient(#333 1px, transparent 1px);
          background-size: 24px 24px;
        }
        @keyframes fade-in-fast {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in-fast {
          animation: fade-in-fast 0.2s ease-out forwards;
        }
      `}</style>
    </div>
  );
}

const AgentLogTerminal = ({ logs, socketConnected }) => {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs]);

  return (
    <div className="bg-black border border-gray-800 rounded-xl overflow-hidden flex flex-col h-full font-mono text-xs shadow-inner shadow-black/50">
      <div className="bg-gray-900 p-2 flex items-center justify-between border-b border-gray-800">
        <div className="flex items-center gap-2 text-gray-400">
          <Terminal size={14} />
          <span className="font-semibold tracking-wider">DOCTARX_AGENTOPS_FEED</span>
        </div>
        <span className={`text-[10px] ${socketConnected ? 'text-green-400' : 'text-gray-500'}`}>
          {socketConnected ? 'LIVE' : 'OFFLINE'}
        </span>
      </div>
      <div className="flex-1 p-4 overflow-y-auto space-y-2" ref={scrollRef}>
        {logs.map((log) => (
          <div key={log.id} className="flex gap-3 animate-fade-in-fast">
            <span className="text-gray-600 shrink-0">[{new Date(log.createdAt || Date.now()).toLocaleTimeString()}]</span>
            <span className="uppercase font-bold shrink-0 w-24 text-purple-400">{log.agent}</span>
            <span className={log.status === 'success' ? 'text-green-400' : log.status === 'vetoed' || log.status === 'error' ? 'text-red-400' : 'text-gray-300'}>
              {log.action}
              {(log.status === 'vetoed' || log.status === 'error') && log.error ? (
                <span className="block ml-4 text-red-500/70 border-l-2 border-red-500/30 pl-2 mt-1">
                  BLOCKER: {typeof log.error === 'string' ? log.error : 'See audit detail'}
                </span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

const NavItem = ({ icon: Icon, label, active, onClick, alert, live }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-all duration-200 group ${
      active ? 'bg-purple-600/10 text-purple-400 border border-purple-600/20' : 'text-gray-400 hover:text-white hover:bg-gray-800'
    }`}
  >
    <div className="flex items-center gap-3">
      <Icon size={18} className={`transition-colors ${active ? 'text-purple-400' : 'text-gray-500 group-hover:text-white'}`} />
      <span className="font-medium">{label}</span>
    </div>
    {alert ? <span className="bg-purple-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md">{alert}</span> : null}
    {live ? (
      <span className="flex h-2 w-2 relative">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
      </span>
    ) : null}
  </button>
);
