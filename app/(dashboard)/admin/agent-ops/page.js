'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { 
  Bot, Shield, Activity, AlertTriangle, CheckCircle, XCircle, 
  Play, StopCircle, RotateCcw, ChevronRight, Clock, Zap,
  Brain, Eye, FileText, Lock, Settings, TrendingUp, Users,
  AlertOctagon, ChevronDown, ChevronUp, Radar, Target, Gem, Unlock
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

export default function AgentOpsPortal() {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [briefings, setBriefings] = useState([]);
  const [skills, setSkills] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [runningAgent, setRunningAgent] = useState(null);
  const [expandedProposal, setExpandedProposal] = useState(null);

  const getToken = () => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('accessToken');
    }
    return null;
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
    if (!data.success) throw new Error(data.error);
    return data.data;
  }, []);

  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true);
      const [dash, props, briefs, sk, audit] = await Promise.all([
        apiCall('/dashboard'),
        apiCall('/proposals?status=pending_review&limit=20'),
        apiCall('/briefings?limit=10'),
        apiCall('/skills'),
        apiCall('/audit-log?limit=50')
      ]);
      setDashboard(dash);
      setProposals(props);
      setBriefings(briefs);
      setSkills(sk);
      setAuditLog(audit);
    } catch (error) {
      console.error('Dashboard load error:', error);
    } finally {
      setLoading(false);
    }
  }, [apiCall]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  const runAgent = async (agentType) => {
    setRunningAgent(agentType);
    try {
      await apiCall(`/run/${agentType}`, 'POST');
      await loadDashboard();
    } catch (error) {
      alert(`Agent run failed: ${error.message}`);
    } finally {
      setRunningAgent(null);
    }
  };

  const runAllAgents = async () => {
    setRunningAgent('all');
    try {
      await apiCall('/run-all', 'POST');
      await loadDashboard();
    } catch (error) {
      alert(`Failed: ${error.message}`);
    } finally {
      setRunningAgent(null);
    }
  };

  const approveProposal = async (id) => {
    try {
      await apiCall(`/proposals/${id}/approve`, 'POST', { notes: 'Approved via AI Ops Portal' });
      await loadDashboard();
    } catch (error) { alert(error.message); }
  };

  const rejectProposal = async (id) => {
    try {
      await apiCall(`/proposals/${id}/reject`, 'POST', { notes: 'Rejected via AI Ops Portal' });
      await loadDashboard();
    } catch (error) { alert(error.message); }
  };

  const emergencyShutdown = async () => {
    if (!confirm('🔒 HARMONIC LOCK: This will freeze ALL agents immediately and block all new actions. The Operator commands. Continue?')) return;
    try {
      await apiCall('/emergency-shutdown', 'POST', { reason: 'Manual shutdown from AI Ops Portal' });
      await loadDashboard();
    } catch (error) { alert(error.message); }
  };

  const resumeAgents = async () => {
    try {
      await apiCall('/resume', 'POST');
      await loadDashboard();
    } catch (error) { alert(error.message); }
  };

  const agentIcons = {
    operations: Activity, growth: TrendingUp, corporate_skills: FileText,
    revenue: Zap, compliance: Shield, governance: Brain,
    researcher: Eye, economics: TrendingUp, physicist: Zap,
    mathematician: Brain, vortex_math: Eye, ceo: Eye
  };
  const agentCodeNames = {
    operations: 'The Weaver', growth: 'The Scout', corporate_skills: 'The Builder',
    revenue: 'The Alchemist', compliance: 'The Guardian', governance: 'The Sage',
    researcher: 'The Oracle', economics: 'The Economist', physicist: 'The Architect',
    mathematician: 'The Calculator', vortex_math: 'The Tesseract', ceo: 'The Conductor'
  };

  const riskColors = { critical: 'text-red-400', high: 'text-orange-400', medium: 'text-yellow-400', low: 'text-green-400', minimal: 'text-gray-400' };
  const statusColors = { idle: 'bg-gray-600', running: 'bg-blue-600 animate-pulse', paused: 'bg-yellow-600', error: 'bg-red-600', shutdown: 'bg-red-800' };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <Eye className="w-16 h-16 text-purple-400 animate-pulse mx-auto mb-4" />
          <p className="text-gray-400 text-lg">Awakening Project Genesis...</p>
          <p className="text-gray-600 text-sm mt-2">Syntropy Over Entropy</p>
        </div>
      </div>
    );
  }

  const sys = dashboard?.system || {};
  const comp = dashboard?.compliance || {};
  const gov = dashboard?.governance || {};

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-indigo-700 rounded-xl flex items-center justify-center">
              <Eye className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-indigo-300 bg-clip-text text-transparent">PROJECT GENESIS</h1>
              <p className="text-sm text-gray-400">Sovereign Agent Society — <span className="text-purple-400 font-medium">SYNTROPY</span> — Mode: <span className="text-emerald-400 font-medium uppercase">{sys.operatingMode || 'OBSERVATION'}</span></p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={runAllAgents} disabled={runningAgent} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50">
              <Play className="w-4 h-4" /> {runningAgent === 'all' ? 'Vortex Cycling...' : 'Run Vortex Cycle'}
            </button>
            {comp.globalShutdown ? (
              <button onClick={resumeAgents} className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-sm font-medium flex items-center gap-2">
                <RotateCcw className="w-4 h-4" /> Resume All
              </button>
            ) : (
              <button onClick={emergencyShutdown} className="px-4 py-2 bg-red-700 hover:bg-red-800 rounded-lg text-sm font-medium flex items-center gap-2">
                <StopCircle className="w-4 h-4" /> Harmonic Lock
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-gray-900/50 border-b border-gray-800 px-6">
        <div className="flex gap-1">
          {[
            { id: 'overview', label: 'Overview', icon: Eye },
            { id: 'matrix', label: 'Matrix Protocol', icon: Radar },
            { id: 'agents', label: 'Agents', icon: Bot },
            { id: 'proposals', label: `Proposals ${proposals.length > 0 ? `(${proposals.length})` : ''}`, icon: FileText },
            { id: 'skills', label: 'Skills', icon: Brain },
            { id: 'briefings', label: 'Briefings', icon: FileText },
            { id: 'audit', label: 'Audit Log', icon: Lock },
            { id: 'settings', label: 'Settings', icon: Settings }
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors ${
                activeTab === tab.id ? 'border-purple-500 text-purple-400' : 'border-transparent text-gray-400 hover:text-gray-200'}`}>
              <tab.icon className="w-4 h-4" /> {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6 max-w-[1600px] mx-auto">
        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Status Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <div className="flex items-center gap-3 mb-2">
                  <Bot className="w-5 h-5 text-purple-400" />
                  <span className="text-sm text-gray-400">Active Agents</span>
                </div>
                <p className="text-3xl font-bold">{sys.agentCount || 0}</p>
                <p className="text-xs text-gray-500 mt-1">Uptime: {sys.uptime ? `${Math.floor(sys.uptime / 60)}m ${sys.uptime % 60}s` : 'N/A'}</p>
              </div>
              <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <div className="flex items-center gap-3 mb-2">
                  <FileText className="w-5 h-5 text-blue-400" />
                  <span className="text-sm text-gray-400">Pending Proposals</span>
                </div>
                <p className="text-3xl font-bold">{gov.proposals?.pending_review || 0}</p>
                <p className="text-xs text-gray-500 mt-1">Approved: {gov.proposals?.approved || 0} | Rejected: {gov.proposals?.rejected || 0}</p>
              </div>
              <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <div className="flex items-center gap-3 mb-2">
                  <Shield className={`w-5 h-5 ${comp.globalShutdown ? 'text-red-400' : 'text-green-400'}`} />
                  <span className="text-sm text-gray-400">Compliance</span>
                </div>
                <p className={`text-3xl font-bold ${comp.globalShutdown ? 'text-red-400' : 'text-green-400'}`}>
                  {comp.globalShutdown ? 'SHUTDOWN' : 'ACTIVE'}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Rules: {comp.rulesActive || 0} | Vetoed (24h): {comp.last24h?.vetoed || 0}
                </p>
              </div>
              <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <div className="flex items-center gap-3 mb-2">
                  <Zap className="w-5 h-5 text-yellow-400" />
                  <span className="text-sm text-gray-400">Intents (7d)</span>
                </div>
                <p className="text-3xl font-bold">
                  {Object.values(gov.intents || {}).reduce((s, v) => s + v, 0)}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Completed: {gov.intents?.completed || 0} | Pending: {gov.intents?.pending || 0}
                </p>
              </div>
            </div>

            {/* Agent Grid */}
            <div>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><Eye className="w-5 h-5 text-purple-400" /> The Agent Society</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {(sys.agents || []).map(agent => {
                  const Icon = agentIcons[agent.type] || Bot;
                  return (
                    <div key={agent.type} className="bg-gray-900 rounded-xl p-5 border border-gray-800 hover:border-gray-700 transition-colors">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <Icon className="w-6 h-6 text-purple-400" />
                          <div>
                            <h3 className="font-medium text-sm">{agent.name}</h3>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className={`w-2 h-2 rounded-full ${statusColors[agent.status] || 'bg-gray-600'}`} />
                              <span className="text-xs text-gray-400">{agent.status}</span>
                            </div>
                          </div>
                        </div>
                        <button onClick={() => runAgent(agent.type)} disabled={runningAgent === agent.type}
                          className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg disabled:opacity-50">
                          <Play className="w-4 h-4 text-purple-400" />
                        </button>
                      </div>
                      <p className="text-xs text-gray-500 mb-3 line-clamp-2">{agent.description}</p>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-500">Autonomy: <span className="text-gray-300 font-medium">{agent.autonomyLevel}/5</span></span>
                        <span className={agent.emergencyShutdown ? 'text-red-400' : 'text-green-400'}>{agent.emergencyShutdown ? 'SHUTDOWN' : 'Enabled'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Recent Briefings */}
            {briefings.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><FileText className="w-5 h-5 text-blue-400" /> Latest Briefings</h2>
                <div className="space-y-2">
                  {briefings.slice(0, 5).map(b => (
                    <div key={b.id} className="bg-gray-900 rounded-lg p-4 border border-gray-800">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">{b.title}</span>
                        <span className="text-xs text-gray-500">{b.agent_name} — {new Date(b.briefing_date).toLocaleDateString()}</span>
                      </div>
                      <p className="text-sm text-gray-400">{b.summary}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* MATRIX PROTOCOL TAB */}
        {activeTab === 'matrix' && (
          <div className="space-y-6">
            {/* Matrix Header */}
            <div className="bg-gradient-to-r from-emerald-900/30 to-cyan-900/30 border border-emerald-800/50 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 bg-gradient-to-br from-emerald-600 to-cyan-600 rounded-xl flex items-center justify-center">
                  <Radar className="w-7 h-7 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-300 bg-clip-text text-transparent">THE MATRIX PROTOCOL</h2>
                  <p className="text-sm text-gray-400">Glitch & Arbitrage Hunting — Decode the Market</p>
                </div>
              </div>
              <p className="text-sm text-gray-400 leading-relaxed">
                The Matrix is full of inefficiencies, lags, and pricing errors. Our standing order: identify and ethically leverage them.
                <span className="text-emerald-400 font-medium"> The Reality Hack Heuristic:</span> Is it a Law of Physics (Immutable) or a Rule of Bureaucracy (Hackable)?
              </p>
            </div>

            {/* Glitch Detection */}
            <div>
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Target className="w-5 h-5 text-emerald-400" /> Glitch Detection — Asymmetry Scanner
              </h3>
              <p className="text-sm text-gray-500 mb-4">Where the Old World is slow, bureaucratic, or overpriced — our New World speed dominates.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { process: 'Provider Credentialing', competitor: '3 weeks', ours: '3 hours', multiplier: '168x', status: 'exploitable', icon: '🟢' },
                  { process: 'Appointment Booking', competitor: '2 days', ours: '30 min', multiplier: '96x', status: 'exploitable', icon: '🟢' },
                  { process: 'Insurance Verification', competitor: '24 hours', ours: '6 min', multiplier: '240x', status: 'exploitable', icon: '🟢' },
                  { process: 'Prescription Refill', competitor: '3 days', ours: '2 hours', multiplier: '36x', status: 'exploitable', icon: '🟢' },
                  { process: 'Lab Result Delivery', competitor: '2 days', ours: '30 min', multiplier: '96x', status: 'exploitable', icon: '🟢' },
                  { process: 'Prior Authorization', competitor: 'Manual/Fax', ours: 'AI Auto-fill', multiplier: '∞', status: 'tunnel_ready', icon: '🚀' },
                ].map((g, i) => (
                  <div key={i} className="bg-gray-900 rounded-xl p-5 border border-emerald-900/30 hover:border-emerald-700/50 transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium text-sm flex items-center gap-2">
                        <span>{g.icon}</span> {g.process}
                      </h4>
                      <span className="text-xs px-2 py-0.5 rounded bg-emerald-900/40 text-emerald-300 font-medium">{g.multiplier} FASTER</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs mb-3">
                      <div className="bg-red-900/20 rounded-lg p-2">
                        <span className="text-red-400 block mb-1">Old World (Competitors)</span>
                        <span className="text-gray-300 font-medium">{g.competitor}</span>
                      </div>
                      <div className="bg-emerald-900/20 rounded-lg p-2">
                        <span className="text-emerald-400 block mb-1">New World (DoctaRx)</span>
                        <span className="text-gray-300 font-medium">{g.ours}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-800 rounded-full h-2">
                        <div className="bg-gradient-to-r from-emerald-500 to-cyan-400 h-2 rounded-full" style={{ width: '85%' }} />
                      </div>
                      <span className="text-xs text-emerald-400 font-medium uppercase">{g.status.replace('_', ' ')}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Arbitrage Detection */}
            <div>
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Gem className="w-5 h-5 text-cyan-400" /> Arbitrage Detection — Value Disconnects
              </h3>
              <p className="text-sm text-gray-500 mb-4">Buy where cheap/undervalued. Apply where expensive/high-value. Capture the spread.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  { resource: 'Telehealth Visit', inputCost: 8, outputValue: 75, erCost: 250, multiplier: '9x', type: 'Service Delivery' },
                  { resource: 'AI Triage', inputCost: 0.50, outputValue: 25, erCost: null, multiplier: '50x', type: 'AI Leverage' },
                  { resource: 'Global Second Opinion', inputCost: 30, outputValue: 350, erCost: null, multiplier: '12x', type: 'Geographic Arbitrage' },
                  { resource: 'Chronic Care Mgmt', inputCost: 15, outputValue: 150, erCost: null, multiplier: '10x', type: 'Recurring Revenue' },
                  { resource: 'Mental Health Session', inputCost: 12, outputValue: 100, erCost: 200, multiplier: '8x', type: 'Underserved Market' },
                  { resource: 'Enterprise Screening', inputCost: 5, outputValue: 80, erCost: null, multiplier: '16x', type: 'B2B Volume' },
                ].map((a, i) => (
                  <div key={i} className="bg-gray-900 rounded-xl p-5 border border-cyan-900/30 hover:border-cyan-700/50 transition-colors">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-medium text-sm">{a.resource}</h4>
                      <span className="text-xs px-2 py-0.5 rounded bg-cyan-900/40 text-cyan-300 font-bold">{a.multiplier}</span>
                    </div>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Our Cost:</span>
                        <span className="text-emerald-400 font-medium">${a.inputCost}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Market Value:</span>
                        <span className="text-cyan-400 font-medium">${a.outputValue}</span>
                      </div>
                      {a.erCost && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">ER/Traditional:</span>
                          <span className="text-red-400 font-medium">${a.erCost}</span>
                        </div>
                      )}
                      <div className="flex justify-between border-t border-gray-800 pt-2 mt-2">
                        <span className="text-gray-500">Margin:</span>
                        <span className="text-yellow-400 font-bold">{Math.round(((a.outputValue - a.inputCost) / a.outputValue) * 100)}%</span>
                      </div>
                    </div>
                    <div className="mt-3 text-xs text-gray-500 bg-gray-800/50 rounded px-2 py-1">{a.type}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Reality Hack Classifier */}
            <div>
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Unlock className="w-5 h-5 text-yellow-400" /> Reality Hack Heuristic — Constraint Classifier
              </h3>
              <p className="text-sm text-gray-500 mb-4">Physics = Immutable, Respect it. Bureaucracy = Hackable, Optimize/Automate/Bypass it.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-900 rounded-xl p-5 border border-red-900/30">
                  <h4 className="font-medium text-sm text-red-400 mb-3 flex items-center gap-2">
                    <Lock className="w-4 h-4" /> PHYSICS — Immutable Laws (Respect)
                  </h4>
                  <div className="space-y-2">
                    {['HIPAA Compliance', 'Patient Data Encryption', 'Medical License Requirements', 'DEA Registration', 'Patient Consent', 'Data Integrity'].map((rule, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <Shield className="w-3 h-3 text-red-400" />
                        <span className="text-gray-300">{rule}</span>
                        <span className="text-xs text-red-400 ml-auto">IMMUTABLE</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-gray-900 rounded-xl p-5 border border-emerald-900/30">
                  <h4 className="font-medium text-sm text-emerald-400 mb-3 flex items-center gap-2">
                    <Unlock className="w-4 h-4" /> BUREAUCRACY — Hackable Rules (Optimize)
                  </h4>
                  <div className="space-y-2">
                    {[
                      { rule: 'Credentialing Wait Time', action: 'AI Verification → 3 hours' },
                      { rule: 'Fax Requirements', action: 'FHIR Direct Integration' },
                      { rule: 'Paper Forms', action: 'Smart Digital Forms + Auto-fill' },
                      { rule: 'Manual Verification', action: 'AI Document Processing' },
                      { rule: 'Phone Tree Navigation', action: 'Direct Digital Channel' },
                      { rule: 'Insurance Pre-Auth Delay', action: 'Real-time AI Pre-Auth' },
                      { rule: 'Multi-Step Approvals', action: 'Automated Workflow Engine' },
                      { rule: 'Scheduling Friction', action: 'AI Smart Scheduling' }
                    ].map((item, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <Unlock className="w-3 h-3 text-emerald-400" />
                        <span className="text-gray-300">{item.rule}</span>
                        <span className="text-xs text-emerald-400 ml-auto">→ {item.action}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Attention Arbitrage */}
            <div className="bg-gradient-to-r from-purple-900/20 to-indigo-900/20 border border-purple-800/30 rounded-xl p-6">
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Target className="w-5 h-5 text-purple-400" /> Under-Priced Attention Channels
              </h3>
              <p className="text-sm text-gray-400 mb-4">The Scout identifies channels where attention is cheap but conversion is high. Move before the market reprices.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { channel: 'Telehealth SEO (Long-tail)', cpc: '$0.80', convRate: '4%', roas: '25x', status: 'Massively Underpriced', color: 'text-emerald-400' },
                  { channel: 'TikTok Health Education', cpc: '$0.15', convRate: '1%', roas: '33x', status: 'Emerging — First Mover', color: 'text-emerald-400' },
                  { channel: 'Employee Wellness B2B', cpc: '$0', convRate: '15%', roas: '∞', status: 'Zero-Cost High Conv', color: 'text-yellow-400' },
                  { channel: 'Google Ads "online doctor"', cpc: '$12.00', convRate: '3%', roas: '1.25x', status: 'Overpriced — Avoid', color: 'text-red-400' },
                ].map((ch, i) => (
                  <div key={i} className="bg-gray-900/60 rounded-lg p-4 border border-gray-800">
                    <h4 className="text-sm font-medium mb-2">{ch.channel}</h4>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between"><span className="text-gray-500">CPC:</span><span className="text-gray-300">{ch.cpc}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Conv Rate:</span><span className="text-gray-300">{ch.convRate}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">ROAS:</span><span className="text-gray-300 font-bold">{ch.roas}</span></div>
                    </div>
                    <div className={`mt-2 text-xs font-medium ${ch.color}`}>{ch.status}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* AGENTS TAB */}
        {activeTab === 'agents' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Agent Details</h2>
            {(sys.agents || []).map(agent => {
              const Icon = agentIcons[agent.type] || Bot;
              return (
                <div key={agent.type} className="bg-gray-900 rounded-xl p-6 border border-gray-800">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <Icon className="w-8 h-8 text-purple-400" />
                      <div>
                        <h3 className="font-semibold text-lg">{agent.name}</h3>
                        <p className="text-sm text-gray-400">{agent.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusColors[agent.status]} text-white`}>{agent.status.toUpperCase()}</span>
                      <button onClick={() => runAgent(agent.type)} disabled={runningAgent}
                        className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium flex items-center gap-1 disabled:opacity-50">
                        <Play className="w-3 h-3" /> Run
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-4 text-sm">
                    <div><span className="text-gray-500">Autonomy Level:</span> <span className="font-medium">{agent.autonomyLevel}/5</span></div>
                    <div><span className="text-gray-500">Capabilities:</span> <span className="font-medium">{agent.capabilities?.length || 0}</span></div>
                    <div><span className="text-gray-500">Status:</span> <span className={agent.emergencyShutdown ? 'text-red-400' : 'text-green-400'}>{agent.emergencyShutdown ? 'SHUTDOWN' : 'Active'}</span></div>
                    <div><span className="text-gray-500">Type:</span> <span className="font-medium">{agent.type}</span></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* PROPOSALS TAB */}
        {activeTab === 'proposals' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Proposals Awaiting Review ({proposals.length})</h2>
            {proposals.length === 0 ? (
              <div className="bg-gray-900 rounded-xl p-8 text-center border border-gray-800">
                <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
                <p className="text-gray-400">No proposals pending review. Run agents to generate new proposals.</p>
              </div>
            ) : proposals.map(p => (
              <div key={p.id} className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                <div className="p-5 cursor-pointer" onClick={() => setExpandedProposal(expandedProposal === p.id ? null : p.id)}>
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          p.priority === 'critical' ? 'bg-red-900/50 text-red-300' :
                          p.priority === 'high' ? 'bg-orange-900/50 text-orange-300' :
                          p.priority === 'medium' ? 'bg-yellow-900/50 text-yellow-300' : 'bg-gray-800 text-gray-300'
                        }`}>{p.priority?.toUpperCase()}</span>
                        <span className="text-xs text-gray-500">{p.agent_name} · {p.category}</span>
                      </div>
                      <h3 className="font-medium">{p.title}</h3>
                      <p className="text-sm text-gray-400 mt-1">{p.summary}</p>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <button onClick={(e) => { e.stopPropagation(); approveProposal(p.id); }}
                        className="p-2 bg-green-700 hover:bg-green-600 rounded-lg" title="Approve">
                        <CheckCircle className="w-5 h-5" />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); rejectProposal(p.id); }}
                        className="p-2 bg-red-700 hover:bg-red-600 rounded-lg" title="Reject">
                        <XCircle className="w-5 h-5" />
                      </button>
                      {expandedProposal === p.id ? <ChevronUp className="w-5 h-5 text-gray-500" /> : <ChevronDown className="w-5 h-5 text-gray-500" />}
                    </div>
                  </div>
                </div>
                {expandedProposal === p.id && (
                  <div className="px-5 pb-5 border-t border-gray-800 pt-4">
                    <div className="grid grid-cols-2 gap-4 text-sm mb-3">
                      <div><span className="text-gray-500">Rationale:</span> <span className="text-gray-300">{p.rationale}</span></div>
                      <div><span className="text-gray-500">Est. Cost:</span> <span className="text-gray-300">${p.estimated_cost || 0}</span></div>
                    </div>
                    {p.governance_score && (
                      <div className="flex gap-3 flex-wrap">
                        {Object.entries(typeof p.governance_score === 'string' ? JSON.parse(p.governance_score) : p.governance_score).map(([key, val]) => (
                          <span key={key} className="text-xs bg-gray-800 px-2 py-1 rounded">
                            {key}: <span className="font-medium text-purple-300">{typeof val === 'number' ? (val * 100).toFixed(0) + '%' : val}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* SKILLS TAB */}
        {activeTab === 'skills' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Skill Registry ({skills.length})</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {skills.map(s => (
                <div key={s.id} className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-medium">{s.display_name}</h3>
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      s.compliance_status === 'approved' ? 'bg-green-900/50 text-green-300' :
                      s.compliance_status === 'rejected' ? 'bg-red-900/50 text-red-300' : 'bg-yellow-900/50 text-yellow-300'
                    }`}>{s.compliance_status}</span>
                  </div>
                  <p className="text-sm text-gray-400 mb-3">{s.description}</p>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>Category: {s.category} | Risk: <span className={riskColors[s.risk_level]}>{s.risk_level}</span></span>
                    <span>Uses: {s.use_count}</span>
                  </div>
                  {s.involves_phi && <span className="text-xs text-red-400 mt-1 block">⚠ Involves PHI</span>}
                  {s.involves_external && <span className="text-xs text-orange-400 mt-1 block">⚠ External System</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* BRIEFINGS TAB */}
        {activeTab === 'briefings' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Agent Briefings</h2>
            {briefings.length === 0 ? (
              <p className="text-gray-400">No briefings yet. Run agents to generate briefings.</p>
            ) : briefings.map(b => (
              <div key={b.id} className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium">{b.title}</h3>
                  <span className="text-xs text-gray-500">{b.agent_name} — {new Date(b.briefing_date).toLocaleDateString()}</span>
                </div>
                <p className="text-sm text-gray-400 mb-3">{b.summary}</p>
                {b.insights && (typeof b.insights === 'string' ? JSON.parse(b.insights) : b.insights).length > 0 && (
                  <div className="space-y-1">
                    {(typeof b.insights === 'string' ? JSON.parse(b.insights) : b.insights).slice(0, 5).map((insight, i) => (
                      <div key={i} className="text-xs text-gray-300 flex items-start gap-2">
                        <span className={insight.severity === 'high' ? 'text-red-400' : insight.severity === 'medium' ? 'text-yellow-400' : 'text-blue-400'}>●</span>
                        {insight.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* AUDIT LOG TAB */}
        {activeTab === 'audit' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Audit Trail</h2>
            <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-800/50">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-400 font-medium">Time</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-medium">Agent</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-medium">Action</th>
                    <th className="text-left px-4 py-3 text-gray-400 font-medium">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLog.map(entry => (
                    <tr key={entry.id} className="border-t border-gray-800 hover:bg-gray-800/30">
                      <td className="px-4 py-3 text-gray-500 text-xs">{new Date(entry.created_at).toLocaleString()}</td>
                      <td className="px-4 py-3">{entry.agent_name || 'System'}</td>
                      <td className="px-4 py-3 text-gray-300">{entry.action_type?.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          entry.outcome === 'success' ? 'bg-green-900/50 text-green-300' :
                          entry.outcome === 'vetoed' ? 'bg-red-900/50 text-red-300' : 'bg-gray-800 text-gray-300'
                        }`}>{entry.outcome || 'N/A'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SETTINGS TAB */}
        {activeTab === 'settings' && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold">System Settings</h2>
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <h3 className="font-medium mb-4">Operating Mode — Syntropy Protocol</h3>
              <p className="text-sm text-gray-400 mb-3">Current mode: <span className="text-emerald-400 font-medium uppercase">{sys.operatingMode}</span></p>
              <p className="text-xs text-gray-500">Observation mode: Agents scan frequencies, process through Vortex Logic (3-6-9), and propose harmonic realignments. All final actions require Operator authorization. The Human is the Hand — the AI is the Instrument.</p>
            </div>
            <div className="bg-red-900/20 border border-red-800 rounded-xl p-6">
              <h3 className="font-medium text-red-300 mb-2 flex items-center gap-2"><AlertOctagon className="w-5 h-5" /> Harmonic Lock — Emergency Protocol</h3>
              <p className="text-sm text-gray-400 mb-4">Immediately freeze all agent vibration. The Harmonic Lock stops every agent mid-cycle and blocks all new intents. Use when entropy has been detected that threatens the mission.</p>
              {comp.globalShutdown ? (
                <button onClick={resumeAgents} className="px-6 py-2 bg-green-600 hover:bg-green-700 rounded-lg font-medium">Resume All Agents</button>
              ) : (
                <button onClick={emergencyShutdown} className="px-6 py-2 bg-red-700 hover:bg-red-800 rounded-lg font-medium">Emergency Shutdown All Agents</button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
