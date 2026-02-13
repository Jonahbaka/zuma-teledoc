'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  Mail, Megaphone, Share2, Bot, AlertTriangle, Clock,
  CheckCircle, ArrowRight, Send, Eye, MousePointer, Activity, Sparkles
} from 'lucide-react';
import api from '@/lib/api';

const timeAgo = (dateLike) => {
  const d = new Date(dateLike);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

const quickActions = [
  { title: 'Compose Email', description: 'Write or triage inbox messages', href: '/admin/command-center/inbox', icon: Mail, bg: 'bg-blue-600' },
  { title: 'New Campaign', description: 'Build and launch email campaign', href: '/admin/command-center/campaigns', icon: Megaphone, bg: 'bg-violet-600' },
  { title: 'Social Manager', description: 'Plan and publish social content', href: '/admin/agent-social', icon: Share2, bg: 'bg-pink-600' },
  { title: 'Ask HealthBot', description: 'Generate messaging and insights', href: '/admin/command-center/healthbot', icon: Sparkles, bg: 'bg-emerald-600' }
];

export default function CommandCenterDashboard() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [summaryRes, unreadRes] = await Promise.all([
        api.get('/inbox/summary'),
        api.get('/inbox/unread-count')
      ]);
      setSummary(summaryRes.data?.data || null);
      setUnreadCount(unreadRes.data?.data?.count || 0);
    } catch {
      setSummary(null);
      setUnreadCount(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const stats = [
    { label: 'Unread Messages', value: `${unreadCount}`, delta: unreadCount > 0 ? 'needs review' : 'clear', icon: Mail, color: 'text-blue-400' },
    { label: 'Active Agents (24h)', value: `${summary?.activeAgents?.length || 0}`, delta: 'live', icon: Bot, color: 'text-emerald-400' },
    { label: 'Pending Proposals', value: `${summary?.pendingProposals?.length || 0}`, delta: 'approval queue', icon: Megaphone, color: 'text-violet-400' },
    { label: 'Tracked Event Types', value: `${summary?.recentEvents?.length || 0}`, delta: 'last 24h', icon: Share2, color: 'text-pink-400' }
  ];

  const recentActivities = (summary?.pendingProposals || []).slice(0, 5).map((p) => ({
    type: 'ai',
    title: p.title || 'Proposal update',
    description: `${p.agent_type || 'agent'} · priority ${p.priority || 'n/a'}`,
    time: timeAgo(p.created_at || Date.now()),
    priority: (p.priority || '').toLowerCase() === 'critical' ? 'urgent' : 'normal'
  }));

  return (
    <div className="min-h-full p-6 bg-[#0a0a0a] text-gray-200 space-y-6 bg-dots-pattern">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Command Center</h1>
          <p className="text-gray-400 text-sm mt-1">Unified communications hub with AI-assisted operations</p>
        </div>
        <Link href="/admin/agent-ops" className="text-xs px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-md hover:bg-gray-700 text-gray-300">
          Open Ops Control
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-[#111] p-5 rounded-xl border border-gray-800">
            <div className="flex items-center justify-between mb-4">
              <div className="p-2 rounded-lg bg-gray-900"><stat.icon size={20} className={stat.color} /></div>
              <span className="text-xs font-medium text-gray-300 bg-gray-900 px-2 py-0.5 rounded">{stat.delta}</span>
            </div>
            <h3 className="text-2xl font-bold text-white">{stat.value}</h3>
            <p className="text-sm text-gray-500 mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="bg-[#111] border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Quick Actions</h2>
          <div className="space-y-3">
            {quickActions.map((action) => (
              <Link key={action.title} href={action.href}
                className="flex items-center gap-4 p-3 rounded-lg hover:bg-gray-800 transition-colors border border-transparent hover:border-gray-700">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${action.bg}`}>
                  <action.icon className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-white">{action.title}</p>
                  <p className="text-xs text-gray-500">{action.description}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-gray-500" />
              </Link>
            ))}
          </div>
        </div>

        <div className="xl:col-span-2 bg-[#111] border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Recent Activity</h2>
          <div className="space-y-3">
            {!loading && recentActivities.length === 0 && (
              <div className="text-sm text-gray-500 border border-gray-800 bg-gray-900/50 rounded-lg p-4">
                No recent proposal activity yet. Trigger a mission from AgentOps to populate this feed.
              </div>
            )}
            {recentActivities.map((activity, i) => (
              <div key={`${activity.title}-${i}`} className="flex items-start gap-4 p-3 rounded-lg bg-gray-900/50 border border-gray-800">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-gray-800">
                  {activity.type === 'email' && <Mail className="w-5 h-5 text-blue-400" />}
                  {activity.type === 'campaign' && <Megaphone className="w-5 h-5 text-violet-400" />}
                  {activity.type === 'social' && <Share2 className="w-5 h-5 text-pink-400" />}
                  {activity.type === 'ai' && <Bot className="w-5 h-5 text-emerald-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-white">{activity.title}</p>
                    {activity.priority === 'urgent' && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-red-300 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded">
                        <AlertTriangle className="w-3 h-3" /> Urgent
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-400">{activity.description}</p>
                  <p className="text-xs text-gray-500 mt-1 flex items-center gap-1"><Clock className="w-3 h-3" /> {activity.time}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-[#111] border border-gray-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-300 mb-4">Campaign Performance Snapshot</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricMini icon={Send} value={`${summary?.messageStats?.find((s) => s.message_type === 'accomplishment')?.count || 0}`} label="Accomplishments (24h)" color="text-blue-400" />
          <MetricMini icon={CheckCircle} value={`${summary?.messageStats?.find((s) => s.message_type === 'briefing')?.count || 0}`} label="Briefings (24h)" color="text-emerald-400" />
          <MetricMini icon={Eye} value={`${summary?.messageStats?.find((s) => s.message_type === 'alert')?.count || 0}`} label="Alerts (24h)" color="text-violet-400" />
          <MetricMini icon={MousePointer} value={`${summary?.messageStats?.reduce((sum, item) => sum + Number(item.unread || 0), 0) || 0}`} label="Unread Total" color="text-pink-400" />
        </div>
      </div>
    </div>
  );
}

const MetricMini = ({ icon: Icon, value, label, color }) => (
  <div className="text-center p-4 rounded-lg bg-gray-900/60 border border-gray-800">
    <Icon className={`w-7 h-7 mx-auto mb-2 ${color}`} />
    <p className="text-2xl font-bold text-white">{value}</p>
    <p className="text-sm text-gray-500">{label}</p>
  </div>
);

