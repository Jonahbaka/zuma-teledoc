'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity, Radio, Shield, AlertTriangle, Users, Zap,
  Power, PowerOff, RefreshCw, Eye, Clock, Bot,
  Brain, BarChart3, TrendingUp, MessageSquare, Server,
  ChevronRight, XCircle, CheckCircle2, Loader2
} from 'lucide-react';
import { cn } from '@/lib/utils';

function getApiBase() {
  if (typeof window === 'undefined') return '';
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:8080';
  return window.location.origin;
}

async function hiveApi(path, method = 'GET', body) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${getApiBase()}${path}`, opts);
  return res.json();
}

const AGENT_COLORS = {
  nova: 'from-blue-500 to-cyan-400',
  triage: 'from-purple-500 to-blue-500',
  hippocrates: 'from-emerald-500 to-teal-400',
  overwatch: 'from-amber-500 to-orange-400',
};

export default function HiveOverwatch() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [killConfirm, setKillConfirm] = useState(false);
  const timerRef = useRef(null);

  const fetchData = useCallback(async () => {
    try {
      const [ow, st] = await Promise.all([
        hiveApi('/api/hive/overwatch'),
        hiveApi('/api/hive/status'),
      ]);
      if (ow.success) setData(ow.data);
      if (st.success) { setStatus(st.data); setPaused(!!st.data.paused); }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    timerRef.current = setInterval(fetchData, 8000);
    return () => clearInterval(timerRef.current);
  }, [fetchData]);

  const togglePause = async () => {
    const res = await hiveApi('/api/hive/pause', 'POST', { paused: !paused });
    if (res.success) setPaused(res.data.paused);
  };

  const killAll = async () => {
    const res = await hiveApi('/api/hive/kill', 'POST', { scope: 'all' });
    if (res.success) { setKillConfirm(false); fetchData(); }
  };

  const killSession = async (id) => {
    const res = await hiveApi('/api/hive/kill', 'POST', { scope: id });
    if (res.success) fetchData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
      </div>
    );
  }

  const stats = data?.stats || {};
  const sessions = data?.activeSessions || [];
  const flagged = data?.flagged || [];
  const agents = status?.agents || [];

  return (
    <div className="contrast-dark space-y-6">
      {/* Header with controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
            <Radio className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Hive Overwatch</h2>
            <p className="text-xs text-gray-400">Real-time agent monitoring and control</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchData} className="ui-dark-chip-action p-2 rounded-lg" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={togglePause}
            className={cn('flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
              paused ? 'bg-green-600/20 text-green-400 border border-green-700/50 hover:bg-green-600/30' : 'bg-yellow-600/20 text-yellow-400 border border-yellow-700/50 hover:bg-yellow-600/30'
            )}
          >
            {paused ? <><Power className="w-4 h-4" /> Resume</> : <><PowerOff className="w-4 h-4" /> Pause</>}
          </button>
          {!killConfirm ? (
            <button
              onClick={() => setKillConfirm(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-red-600/20 text-red-400 border border-red-700/50 hover:bg-red-600/30 transition-colors"
            >
              <Zap className="w-4 h-4" /> Kill Switch
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button onClick={killAll} className="px-3 py-2 rounded-lg text-sm font-bold bg-red-600 text-white hover:bg-red-500 transition-colors">
                CONFIRM KILL ALL
              </button>
              <button onClick={() => setKillConfirm(false)} className="ui-dark-chip-action px-2 py-2 rounded-lg text-sm">
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Hive Pulse metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Active Sessions', value: stats.activeSessions ?? 0, icon: Users, color: 'text-blue-400' },
          { label: 'Total Users', value: stats.totalUsers ?? 0, icon: Users, color: 'text-green-400' },
          { label: 'Appts (24h)', value: stats.appointments24h ?? 0, icon: Clock, color: 'text-purple-400' },
          { label: 'Agent Msgs (1h)', value: stats.agentMessages1h ?? 0, icon: MessageSquare, color: 'text-cyan-400' },
          { label: 'Flagged', value: stats.flaggedConversations ?? 0, icon: AlertTriangle, color: flagged.length > 0 ? 'text-red-400' : 'text-gray-500' },
        ].map((m) => (
          <div key={m.label} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-1">
              <m.icon className={cn('w-4 h-4', m.color)} />
              <span className="text-xs text-gray-500">{m.label}</span>
            </div>
            <p className="text-xl font-bold text-white">{m.value}</p>
          </div>
        ))}
      </div>

      {/* Agents status */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Bot className="w-4 h-4 text-amber-400" /> Hive Agents
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {agents.map((a) => (
            <div key={a.id} className="flex items-center gap-3 bg-gray-950 border border-gray-800 rounded-xl p-4">
              <div className={cn('w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-lg', AGENT_COLORS[a.id] || 'from-gray-600 to-gray-500')}>
                <Brain className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-base font-bold text-white truncate">{a.name}</p>
                <p className="text-xs text-gray-400">{a.type}</p>
              </div>
              <div className={cn('w-2.5 h-2.5 rounded-full shrink-0', paused ? 'bg-yellow-500' : 'bg-green-500 animate-pulse')} />
            </div>
          ))}
        </div>
      </div>

      {/* Flagged conversations (Intervention Queue) */}
      {flagged.length > 0 && (
        <div className="bg-red-950/30 border border-red-800/40 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-red-300 mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Intervention Queue ({flagged.length})
          </h3>
          <div className="space-y-2">
            {flagged.map((f) => (
              <div key={f.id} className="flex items-center justify-between bg-red-900/20 border border-red-800/30 rounded-lg p-3">
                <div>
                  <p className="text-sm text-white">{f.agentName} — Urgency {f.urgencyScore}/5</p>
                  <p className="text-xs text-gray-400">{f.messageCount} messages, started {new Date(f.startedAt).toLocaleTimeString()}</p>
                </div>
                <div className="flex gap-2">
                  <button className="px-2 py-1 rounded bg-amber-800/50 text-amber-200 text-xs hover:bg-amber-700/50">
                    <Eye className="w-3 h-3 inline mr-1" /> Review
                  </button>
                  <button
                    onClick={() => killSession(f.id)}
                    className="px-2 py-1 rounded bg-red-800/50 text-red-200 text-xs hover:bg-red-700/50"
                  >
                    <XCircle className="w-3 h-3 inline mr-1" /> Kill
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Sessions */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-400" /> Active Sessions ({sessions.length})
        </h3>
        {sessions.length === 0 ? (
          <p className="text-sm text-gray-500">No active agent sessions.</p>
        ) : (
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between bg-gray-950 border border-gray-800 rounded-lg p-3">
                <div className="flex items-center gap-3">
                  <div className={cn('w-7 h-7 rounded-md bg-gradient-to-br flex items-center justify-center', AGENT_COLORS[s.agentId] || 'from-gray-600 to-gray-500')}>
                    <Bot className="w-3.5 h-3.5 text-white" />
                  </div>
                  <div>
                    <p className="text-sm text-white">{s.agentName}</p>
                    <p className="text-[10px] text-gray-500">{s.role} — {s.messageCount} msgs</p>
                  </div>
                </div>
                <button
                  onClick={() => killSession(s.id)}
                  className="ui-dark-chip-action px-2 py-1 rounded text-xs hover:bg-red-800/50 hover:text-red-300"
                >
                  Kill
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* System info */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-900/50 border border-gray-800 rounded-lg">
        <div className="flex items-center gap-2">
          <Server className="w-3.5 h-3.5 text-gray-500" />
          <span className="text-xs text-gray-500">Server uptime: {Math.round((data?.serverUptime || 0) / 60)} min</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={cn('w-2 h-2 rounded-full', paused ? 'bg-yellow-500' : 'bg-green-500')} />
          <span className="text-xs text-gray-500">{paused ? 'PAUSED' : 'ONLINE'}</span>
        </div>
      </div>
    </div>
  );
}
