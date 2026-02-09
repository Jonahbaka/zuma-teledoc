'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Inbox, Mail, MailOpen, AlertTriangle, BarChart3, Shield, Bug,
  Crown, Activity, Zap, Search, Radar, Eye, Hexagon, Calculator,
  Atom, Check, CheckCheck, Trash2, Filter, RefreshCw, Clock,
  Bot, Radio, ChevronDown, Bell, FileText, TrendingUp, DollarSign,
  Brain, AlertCircle, ArrowUpRight, Sparkles, Globe, Play
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

const AGENT_MAP = {
  ceo: { name: 'The Conductor', icon: Crown, color: 'text-yellow-400', bg: 'bg-yellow-900/40', border: 'border-yellow-500/20' },
  operations: { name: 'The Weaver', icon: Activity, color: 'text-blue-400', bg: 'bg-blue-900/40', border: 'border-blue-500/20' },
  growth: { name: 'The Scout', icon: Radar, color: 'text-emerald-400', bg: 'bg-emerald-900/40', border: 'border-emerald-500/20' },
  revenue: { name: 'The Alchemist', icon: Zap, color: 'text-amber-400', bg: 'bg-amber-900/40', border: 'border-amber-500/20' },
  compliance: { name: 'The Guardian', icon: Shield, color: 'text-red-400', bg: 'bg-red-900/40', border: 'border-red-500/20' },
  governance: { name: 'The Sage', icon: Eye, color: 'text-purple-400', bg: 'bg-purple-900/40', border: 'border-purple-500/20' },
  researcher: { name: 'The Oracle', icon: Search, color: 'text-cyan-400', bg: 'bg-cyan-900/40', border: 'border-cyan-500/20' },
  economics: { name: 'The Economist', icon: BarChart3, color: 'text-green-400', bg: 'bg-green-900/40', border: 'border-green-500/20' },
  physicist: { name: 'The Architect', icon: Atom, color: 'text-indigo-400', bg: 'bg-indigo-900/40', border: 'border-indigo-500/20' },
  mathematician: { name: 'The Calculator', icon: Calculator, color: 'text-pink-400', bg: 'bg-pink-900/40', border: 'border-pink-500/20' },
  vortex_math: { name: 'The Tesseract', icon: Hexagon, color: 'text-violet-400', bg: 'bg-violet-900/40', border: 'border-violet-500/20' },
  devops: { name: 'The Debugger', icon: Bug, color: 'text-lime-400', bg: 'bg-lime-900/40', border: 'border-lime-500/20' },
  heartbeat: { name: 'Heartbeat', icon: Activity, color: 'text-rose-400', bg: 'bg-rose-900/40', border: 'border-rose-500/20' },
};

const TYPE_LABELS = {
  alert: { label: 'Alert', icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' },
  report: { label: 'Report', icon: BarChart3, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
  text: { label: 'Message', icon: Mail, color: 'text-gray-400', bg: 'bg-gray-500/10', border: 'border-gray-500/30' },
  result: { label: 'Result', icon: Check, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  request: { label: 'Request', icon: Bell, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
  approval: { label: 'Approval', icon: FileText, color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30' },
};

export default function InboxPage() {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all | unread | alert | report
  const [expandedId, setExpandedId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [missionRunning, setMissionRunning] = useState(false);

  const getToken = () => typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

  const apiCall = useCallback(async (endpoint, method = 'GET', body = null) => {
    const token = getToken();
    const options = {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    };
    if (body) options.body = JSON.stringify(body);
    try {
      const res = await fetch(`${API_URL}/inbox${endpoint}`, options);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data.data;
    } catch (err) {
      console.error('Inbox API error:', err);
      return null;
    }
  }, []);

  const loadInbox = useCallback(async () => {
    const params = new URLSearchParams({ limit: '100' });
    if (filter === 'unread') params.set('unread', 'true');
    if (filter === 'alert' || filter === 'report') params.set('type', filter);

    const [inboxData, summaryData] = await Promise.all([
      apiCall(`/?${params.toString()}`),
      apiCall('/summary')
    ]);

    if (inboxData) {
      setItems(inboxData.items || []);
      setUnreadCount(inboxData.unreadCount || 0);
    }
    if (summaryData) setSummary(summaryData);
  }, [apiCall, filter]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await loadInbox();
      setLoading(false);
    };
    init();
  }, [loadInbox]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => loadInbox(), 60 * 1000);
    return () => clearInterval(interval);
  }, [loadInbox]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadInbox();
    setRefreshing(false);
  };

  const runMissions = async () => {
    setMissionRunning(true);
    await apiCall('/run-missions', 'POST');
    // Missions run async — poll for results after a delay
    setTimeout(async () => {
      await loadInbox();
      setMissionRunning(false);
    }, 5000);
  };

  const markRead = async (ids) => {
    await apiCall('/mark-read', 'POST', { ids });
    await loadInbox();
  };

  const markAllRead = async () => {
    await apiCall('/mark-read', 'POST', { ids: 'all' });
    await loadInbox();
  };

  const deleteItem = async (id) => {
    await apiCall(`/${id}`, 'DELETE');
    setItems(prev => prev.filter(i => i.id !== id));
  };

  const toggleExpand = (id) => {
    setExpandedId(prev => prev === id ? null : id);
    // Mark as read when expanded
    const item = items.find(i => i.id === id);
    if (item && !item.read_at) {
      markRead([id]);
    }
  };

  const formatTime = (date) => {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.round(diffMs / 60000);
    const diffHr = Math.round(diffMs / 3600000);
    const diffDay = Math.round(diffMs / 86400000);

    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return d.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <Inbox className="w-16 h-16 text-purple-400 animate-pulse mx-auto mb-4" />
          <p className="text-gray-400 text-lg">Loading agent inbox...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-600 to-indigo-700 rounded-xl flex items-center justify-center shadow-lg shadow-purple-900/30">
              <Inbox className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-indigo-300 bg-clip-text text-transparent">AGENT INBOX</h1>
              <p className="text-sm text-gray-500 mt-0.5">Proactive briefings, alerts, and accomplishments from your AI agents</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={runMissions} disabled={missionRunning}
              className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 rounded-lg text-sm font-bold flex items-center gap-2 disabled:opacity-50 shadow-lg shadow-emerald-900/20">
              <Globe className={`w-4 h-4 ${missionRunning ? 'animate-spin' : ''}`} />
              {missionRunning ? 'Missions Running...' : 'Run Web Missions'}
            </button>
            {unreadCount > 0 && (
              <button onClick={markAllRead}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium flex items-center gap-2 text-gray-300 border border-gray-700">
                <CheckCheck className="w-4 h-4" /> Mark all read ({unreadCount})
              </button>
            )}
            <button onClick={handleRefresh} disabled={refreshing}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-6 py-6">
        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
              <div className="flex items-center gap-2 mb-2"><Mail className="w-4 h-4 text-purple-400" /><span className="text-xs text-gray-400">Unread</span></div>
              <p className="text-3xl font-bold text-purple-400">{unreadCount}</p>
            </div>
            <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
              <div className="flex items-center gap-2 mb-2"><AlertTriangle className="w-4 h-4 text-red-400" /><span className="text-xs text-gray-400">Alerts (24h)</span></div>
              <p className="text-3xl font-bold text-red-400">{summary.messageStats?.find(s => s.message_type === 'alert')?.count || 0}</p>
            </div>
            <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
              <div className="flex items-center gap-2 mb-2"><BarChart3 className="w-4 h-4 text-blue-400" /><span className="text-xs text-gray-400">Reports (24h)</span></div>
              <p className="text-3xl font-bold text-blue-400">{summary.messageStats?.find(s => s.message_type === 'report')?.count || 0}</p>
            </div>
            <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
              <div className="flex items-center gap-2 mb-2"><Bot className="w-4 h-4 text-emerald-400" /><span className="text-xs text-gray-400">Active Agents</span></div>
              <p className="text-3xl font-bold text-emerald-400">{summary.activeAgents?.length || 0}</p>
            </div>
          </div>
        )}

        {/* Pending Proposals Banner */}
        {summary?.pendingProposals?.length > 0 && (
          <div className="bg-amber-900/20 border border-amber-500/30 rounded-xl p-4 mb-6 flex items-center gap-3">
            <AlertCircle className="w-6 h-6 text-amber-400 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-300">
                {summary.pendingProposals.length} pending proposal{summary.pendingProposals.length > 1 ? 's' : ''} awaiting your approval
              </p>
              <p className="text-xs text-amber-400/60 mt-0.5">
                {summary.pendingProposals.map(p => p.title).join(' · ')}
              </p>
            </div>
            <a href="/admin/agent-ops"
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 rounded-lg text-sm font-medium flex items-center gap-2">
              Review <ArrowUpRight className="w-3 h-3" />
            </a>
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center gap-2 mb-4">
          {['all', 'unread', 'alert', 'report'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                filter === f
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-300'
              }`}>
              {f === 'all' ? 'All' : f === 'unread' ? `Unread (${unreadCount})` : f.charAt(0).toUpperCase() + f.slice(1) + 's'}
            </button>
          ))}
        </div>

        {/* Inbox Items */}
        <div className="space-y-2">
          {items.length === 0 ? (
            <div className="bg-gray-900 rounded-xl p-16 text-center border border-gray-800">
              <Inbox className="w-16 h-16 text-gray-700 mx-auto mb-4" />
              <p className="text-gray-400 text-lg">
                {filter === 'unread' ? 'All caught up!' : 'No messages yet'}
              </p>
              <p className="text-gray-600 text-sm mt-2">
                {filter === 'unread'
                  ? 'All agent messages have been read. Check back soon for new briefings.'
                  : 'Agents will post proactive briefings, alerts, and reports here. They start within minutes of server startup.'}
              </p>
            </div>
          ) : items.map(item => {
            const agent = AGENT_MAP[item.sender_id] || { name: item.sender_name, icon: Bot, color: 'text-gray-400', bg: 'bg-gray-800', border: 'border-gray-700' };
            const AgentIcon = agent.icon;
            const typeInfo = TYPE_LABELS[item.message_type] || TYPE_LABELS.text;
            const TypeIcon = typeInfo.icon;
            const isUnread = !item.read_at;
            const isExpanded = expandedId === item.id;

            // Parse metadata
            let meta = {};
            try { meta = typeof item.metadata === 'string' ? JSON.parse(item.metadata || '{}') : (item.metadata || {}); } catch (e) {}

            // Get preview (first 2 lines)
            const lines = item.content.split('\n').filter(l => l.trim());
            const preview = lines.slice(0, 2).join(' ').replace(/\*\*/g, '').replace(/[#_]/g, '').substring(0, 200);

            return (
              <div key={item.id}
                onClick={() => toggleExpand(item.id)}
                className={`rounded-xl border transition-all cursor-pointer ${
                  isUnread
                    ? `bg-gray-900/90 ${agent.border} border-l-4 shadow-lg`
                    : 'bg-gray-900/50 border-gray-800 hover:border-gray-700'
                } ${isExpanded ? 'ring-1 ring-purple-500/30' : ''}`}>

                {/* Collapsed Row */}
                <div className="flex items-center gap-4 px-5 py-4">
                  {/* Agent Avatar */}
                  <div className={`w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center ${agent.bg}`}>
                    <AgentIcon className={`w-5 h-5 ${agent.color}`} />
                  </div>

                  {/* Content Preview */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-sm font-semibold ${isUnread ? 'text-white' : 'text-gray-300'}`}>
                        {agent.name}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${typeInfo.bg} ${typeInfo.color} border ${typeInfo.border} font-medium`}>
                        {typeInfo.label}
                      </span>
                      {meta.severity === 'critical' && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 font-bold animate-pulse">CRITICAL</span>
                      )}
                      {meta.severity === 'high' && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30 font-medium">HIGH</span>
                      )}
                      {meta.aiGenerated && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30">AI</span>
                      )}
                    </div>
                    <p className={`text-sm truncate ${isUnread ? 'text-gray-200' : 'text-gray-500'}`}>
                      {preview}
                    </p>
                  </div>

                  {/* Time & Actions */}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {formatTime(item.created_at)}
                    </span>
                    {isUnread && <span className="w-2.5 h-2.5 rounded-full bg-purple-500 animate-pulse" />}
                  </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="px-5 pb-5 border-t border-gray-800 mt-0">
                    <div className="pt-4">
                      <pre className="whitespace-pre-wrap font-sans text-sm text-gray-300 leading-relaxed">
                        {item.content}
                      </pre>

                      {/* Metadata */}
                      {meta.metrics && (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {Object.entries(meta.metrics).map(([key, val]) => (
                            <span key={key} className="text-xs bg-gray-800 px-3 py-1.5 rounded-lg">
                              {key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}:
                              <span className="font-medium text-emerald-300 ml-1">
                                {typeof val === 'number' ? val.toLocaleString() : val}
                              </span>
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="mt-4 flex items-center gap-2">
                        <span className="text-xs text-gray-600">
                          {new Date(item.created_at).toLocaleString()}
                        </span>
                        <span className="text-gray-700">·</span>
                        <span className="text-xs text-gray-600">
                          {item.sender_id}
                        </span>
                        <div className="ml-auto flex items-center gap-2">
                          <button onClick={(e) => { e.stopPropagation(); deleteItem(item.id); }}
                            className="px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/30 rounded-lg flex items-center gap-1 transition-colors">
                            <Trash2 className="w-3 h-3" /> Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
