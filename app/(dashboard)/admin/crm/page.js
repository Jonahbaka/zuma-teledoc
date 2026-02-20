'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Users, Mail, Send, Search, Plus, Filter, BarChart3, Globe,
  Building2, Stethoscope, DollarSign, UserPlus, Eye, Trash2,
  ChevronRight, ArrowUpRight, Clock, Target, Zap, Phone,
  Linkedin, Twitter, CheckCircle2, XCircle, PauseCircle,
  PlayCircle, FileText, Sparkles, Bot, Crown, Shield,
  MessageSquare, TrendingUp, ExternalLink, RefreshCw,
  Inbox, MailOpen, AlertTriangle, Bug, Activity, Radar,
  Hexagon, Calculator, Atom, Check, CheckCheck, ChevronDown,
  Bell, Brain, AlertCircle, Play
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

/* ─── existing CRM constants ────────────────────────────── */
const CONTACT_TYPES = [
  { id: 'provider', label: 'Providers', icon: Stethoscope, color: 'text-blue-400', bg: 'bg-blue-900/30' },
  { id: 'investor', label: 'Investors', icon: DollarSign, color: 'text-emerald-400', bg: 'bg-emerald-900/30' },
  { id: 'nurse', label: 'Nurses', icon: UserPlus, color: 'text-pink-400', bg: 'bg-pink-900/30' },
  { id: 'partner', label: 'Partners', icon: Building2, color: 'text-amber-400', bg: 'bg-amber-900/30' },
  { id: 'lead', label: 'Leads', icon: Target, color: 'text-purple-400', bg: 'bg-purple-900/30' },
  { id: 'influencer', label: 'Influencers', icon: Globe, color: 'text-cyan-400', bg: 'bg-cyan-900/30' },
];

const PIPELINE_STAGES = [
  { id: 'new', label: 'New', color: 'bg-gray-600' },
  { id: 'researching', label: 'Researching', color: 'bg-blue-600' },
  { id: 'outreach_queued', label: 'Queued', color: 'bg-indigo-600' },
  { id: 'contacted', label: 'Contacted', color: 'bg-purple-600' },
  { id: 'responded', label: 'Responded', color: 'bg-amber-600' },
  { id: 'interested', label: 'Interested', color: 'bg-emerald-600' },
  { id: 'negotiating', label: 'Negotiating', color: 'bg-cyan-600' },
  { id: 'converted', label: 'Converted', color: 'bg-green-600' },
  { id: 'lost', label: 'Lost', color: 'bg-red-600' },
  { id: 'nurturing', label: 'Nurturing', color: 'bg-rose-600' },
];

/* ─── Inbox tab constants ────────────────────────────────── */
const SENTIMENT_STYLE = {
  positive: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400', label: 'Positive' },
  neutral:  { bg: 'bg-gray-500/10',    border: 'border-gray-500/20',    text: 'text-gray-400',    label: 'Neutral'  },
  negative: { bg: 'bg-red-500/10',     border: 'border-red-500/20',     text: 'text-red-400',     label: 'Negative' },
  urgent:   { bg: 'bg-amber-500/10',   border: 'border-amber-500/20',   text: 'text-amber-400',   label: 'Urgent'   },
};

const MOCK_THREADS = [];

const MOCK_MESSAGES = {};

/* ─── Reports tab constants ──────────────────────────────── */
const AGENT_MAP = {
  ceo:          { name: 'The Conductor', icon: Crown,      color: 'text-yellow-400', bg: 'bg-yellow-900/40', border: 'border-yellow-500/20' },
  operations:   { name: 'The Weaver',    icon: Activity,   color: 'text-blue-400',   bg: 'bg-blue-900/40',   border: 'border-blue-500/20'   },
  growth:       { name: 'The Scout',     icon: Radar,      color: 'text-emerald-400',bg: 'bg-emerald-900/40',border: 'border-emerald-500/20'},
  revenue:      { name: 'The Alchemist', icon: Zap,        color: 'text-amber-400',  bg: 'bg-amber-900/40',  border: 'border-amber-500/20'  },
  compliance:   { name: 'The Guardian',  icon: Shield,     color: 'text-red-400',    bg: 'bg-red-900/40',    border: 'border-red-500/20'    },
  governance:   { name: 'The Sage',      icon: Eye,        color: 'text-purple-400', bg: 'bg-purple-900/40', border: 'border-purple-500/20' },
  researcher:   { name: 'The Oracle',    icon: Search,     color: 'text-cyan-400',   bg: 'bg-cyan-900/40',   border: 'border-cyan-500/20'   },
  economics:    { name: 'The Economist', icon: BarChart3,  color: 'text-green-400',  bg: 'bg-green-900/40',  border: 'border-green-500/20'  },
  physicist:    { name: 'The Architect', icon: Atom,       color: 'text-indigo-400', bg: 'bg-indigo-900/40', border: 'border-indigo-500/20' },
  mathematician:{ name: 'The Calculator',icon: Calculator, color: 'text-pink-400',   bg: 'bg-pink-900/40',   border: 'border-pink-500/20'   },
  vortex_math:  { name: 'The Tesseract', icon: Hexagon,   color: 'text-violet-400', bg: 'bg-violet-900/40', border: 'border-violet-500/20' },
  devops:       { name: 'The Debugger',  icon: Bug,        color: 'text-lime-400',   bg: 'bg-lime-900/40',   border: 'border-lime-500/20'   },
  heartbeat:    { name: 'Heartbeat',     icon: Activity,   color: 'text-rose-400',   bg: 'bg-rose-900/40',   border: 'border-rose-500/20'   },
};

const TYPE_LABELS = {
  alert:    { label: 'Alert',    icon: AlertTriangle, color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/30'     },
  report:   { label: 'Report',   icon: BarChart3,     color: 'text-blue-400',    bg: 'bg-blue-500/10',    border: 'border-blue-500/30'    },
  text:     { label: 'Message',  icon: Mail,          color: 'text-gray-400',    bg: 'bg-gray-500/10',    border: 'border-gray-500/30'    },
  result:   { label: 'Result',   icon: Check,         color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  request:  { label: 'Request',  icon: Bell,          color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30'   },
  approval: { label: 'Approval', icon: FileText,      color: 'text-purple-400',  bg: 'bg-purple-500/10',  border: 'border-purple-500/30'  },
};

const timeAgo = (date) => {
  const d = new Date(date);
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(diff / 3600000);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(diff / 86400000);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
};

/* ─────────────────────────────────────────────────────────── */
export default function CRMPage() {
  /* existing CRM state */
  const [activeTab, setActiveTab] = useState('dashboard');
  const [dashboard, setDashboard] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ type: '', stage: '', search: '' });
  const [showAddContact, setShowAddContact] = useState(false);
  const [showAddCampaign, setShowAddCampaign] = useState(false);
  const [contactForm, setContactForm] = useState({ firstName: '', lastName: '', email: '', phone: '', title: '', organization: '', contactType: 'provider', specialty: '', linkedinUrl: '', twitterHandle: '', notes: '' });
  const [campaignForm, setCampaignForm] = useState({ name: '', description: '', campaignType: 'cold_email', targetContactType: 'provider', subjectLine: '', emailTemplate: '', dailyLimit: 30 });
  const [selectedContact, setSelectedContact] = useState(null);
  const [emailForm, setEmailForm] = useState({ subject: '', body: '' });

  /* Inbox tab state */
  const [threads, setThreads] = useState([]);
  const [threadMessages, setThreadMessages] = useState({});
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [selectedThread, setSelectedThread] = useState(null);
  const [replyContent, setReplyContent] = useState('');
  const [showCompose, setShowCompose] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState('');
  const [showAISuggest, setShowAISuggest] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [composeForm, setComposeForm] = useState({ to: '', subject: '', body: '' });
  const emailUnread = threads.filter(t => !t.read_at).length;

  /* Reports tab state */
  const [reportItems, setReportItems] = useState([]);
  const [reportUnread, setReportUnread] = useState(0);
  const [reportFilter, setReportFilter] = useState('all');
  const [reportExpanded, setReportExpanded] = useState(null);
  const [reportRefreshing, setReportRefreshing] = useState(false);
  const [reportSummary, setReportSummary] = useState(null);
  const [waking, setWaking] = useState(false);
  const [missionRunning, setMissionRunning] = useState(false);

  const getToken = () => typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

  /* ── CRM API ── */
  const apiCall = useCallback(async (endpoint, method = 'GET', body = null) => {
    const token = getToken();
    const options = {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    };
    if (body) options.body = JSON.stringify(body);
    try {
      const res = await fetch(`${API_URL}/crm${endpoint}`, options);
      const data = await res.json();
      if (!data.success) return null;
      return data.data;
    } catch (err) { return null; }
  }, []);

  /* ── Inbox (agent) API ── */
  const inboxApi = useCallback(async (endpoint, method = 'GET', body = null) => {
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
    } catch (err) { return null; }
  }, []);

  /* ── load inbox threads from real CRM interactions ── */
  const loadThreads = useCallback(async () => {
    setThreadsLoading(true);
    const data = await apiCall('/threads');
    if (data) setThreads(data);
    setThreadsLoading(false);
  }, [apiCall]);

  /* ── load messages for a thread (by contact) ── */
  const loadThreadMessages = useCallback(async (contactId) => {
    if (threadMessages[contactId]) return;
    const data = await apiCall(`/threads/${contactId}/messages`);
    if (data) setThreadMessages(prev => ({ ...prev, [contactId]: data }));
  }, [apiCall, threadMessages]);

  /* ── load CRM data ── */
  const loadAll = useCallback(async () => {
    setLoading(true);
    const [dash, cs, cps, tpls, srcs] = await Promise.all([
      apiCall('/dashboard'),
      apiCall(`/contacts?type=${filter.type}&stage=${filter.stage}&search=${filter.search}&limit=200`),
      apiCall('/campaigns'),
      apiCall('/templates'),
      apiCall('/sources')
    ]);
    if (dash) setDashboard(dash);
    if (cs) setContacts(cs);
    if (cps) setCampaigns(cps);
    if (tpls) setTemplates(tpls);
    if (srcs) setSources(srcs);
    setLoading(false);
  }, [apiCall, filter]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { if (activeTab === 'inbox') loadThreads(); }, [activeTab, loadThreads]);

  /* ── load Reports ── */
  const loadReports = useCallback(async () => {
    const params = new URLSearchParams({ limit: '100' });
    if (reportFilter === 'unread') params.set('unread', 'true');
    if (reportFilter === 'alert' || reportFilter === 'report') params.set('type', reportFilter);
    const [inboxData, summaryData] = await Promise.all([
      inboxApi(`/?${params.toString()}`),
      inboxApi('/summary')
    ]);
    if (inboxData) {
      setReportItems(inboxData.items || []);
      setReportUnread(inboxData.unreadCount || 0);
    }
    if (summaryData) setReportSummary(summaryData);
  }, [inboxApi, reportFilter]);

  useEffect(() => {
    if (activeTab === 'reports') loadReports();
  }, [activeTab, loadReports]);

  useEffect(() => {
    if (activeTab !== 'reports') return;
    const interval = setInterval(loadReports, 60000);
    return () => clearInterval(interval);
  }, [activeTab, loadReports]);

  /* ── CRM actions ── */
  const addContact = async () => {
    const result = await apiCall('/contacts', 'POST', contactForm);
    if (result) {
      setShowAddContact(false);
      setContactForm({ firstName: '', lastName: '', email: '', phone: '', title: '', organization: '', contactType: 'provider', specialty: '', linkedinUrl: '', twitterHandle: '', notes: '' });
      loadAll();
    }
  };

  const createCampaign = async () => {
    const result = await apiCall('/campaigns', 'POST', campaignForm);
    if (result) {
      setShowAddCampaign(false);
      setCampaignForm({ name: '', description: '', campaignType: 'cold_email', targetContactType: 'provider', subjectLine: '', emailTemplate: '', dailyLimit: 30 });
      loadAll();
    }
  };

  const approveCampaign = async (id) => { await apiCall(`/campaigns/${id}/approve`, 'POST'); loadAll(); };
  const sendCampaign = async (id) => { await apiCall(`/campaigns/${id}/send`, 'POST', { limit: 10 }); loadAll(); };
  const sendDirectEmail = async () => {
    if (!selectedContact || !emailForm.subject) return;
    await apiCall(`/contacts/${selectedContact.id}/email`, 'POST', emailForm);
    setSelectedContact(null);
    setEmailForm({ subject: '', body: '' });
    loadAll();
  };
  const updateStage = async (id, stage) => { await apiCall(`/contacts/${id}/stage`, 'PUT', { stage }); loadAll(); };

  /* ── Inbox tab actions ── */
  const handleGetAISuggestion = async () => {
    setAiLoading(true);
    setShowAISuggest(true);
    await new Promise(r => setTimeout(r, 1200));
    const thread = selectedThread;
    const firstName = thread?.contact_name?.split(' ')[0] || 'there';
    const suggestions = {
      replied: `Hi ${firstName},\n\nThank you for your interest! I'd love to schedule a quick call to walk you through everything in detail.\n\nAre you available for a 15-minute call this week?\n\nBest regards,\nDoctaRx Team`,
      bounced: `Hi ${firstName},\n\nWe noticed our previous email may not have reached you. I wanted to follow up and ensure you received our outreach.\n\nPlease don't hesitate to reach out to us at info@doctarx.com or 408-585-9255.\n\nBest regards,\nDoctaRx Team`,
      neutral: `Hi ${firstName},\n\nThank you for your message. I'd be happy to answer any questions you have.\n\nLooking forward to connecting!\n\nBest regards,\nDoctaRx Team`,
    };
    setAiSuggestion(suggestions[thread?.email_status] || suggestions.neutral);
    setAiLoading(false);
  };

  const handleSendReply = () => {
    if (!replyContent.trim() || !selectedThread) return;
    setReplyContent('');
    setShowAISuggest(false);
    setAiSuggestion('');
  };

  /* ── Reports tab actions ── */
  const handleReportRefresh = async () => {
    setReportRefreshing(true);
    await loadReports();
    setReportRefreshing(false);
  };

  const wakeUpAgents = async () => {
    setWaking(true);
    await inboxApi('/wake-up', 'POST');
    setTimeout(async () => { await loadReports(); setWaking(false); }, 8000);
  };

  const runMissions = async () => {
    setMissionRunning(true);
    await inboxApi('/run-missions', 'POST');
    setTimeout(async () => { await loadReports(); setMissionRunning(false); }, 5000);
  };

  const markAllReportsRead = async () => {
    await inboxApi('/mark-read', 'POST', { ids: 'all' });
    await loadReports();
  };

  const deleteReport = async (id, e) => {
    e?.stopPropagation();
    await inboxApi(`/${id}`, 'DELETE');
    setReportItems(prev => prev.filter(i => i.id !== id));
  };

  const toggleReportExpand = (id) => {
    setReportExpanded(prev => prev === id ? null : id);
    const item = reportItems.find(i => i.id === id);
    if (item && !item.read_at) inboxApi('/mark-read', 'POST', { ids: [id] });
  };

  if (loading && !dashboard) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <Users className="w-16 h-16 text-purple-400 animate-pulse mx-auto mb-4" />
          <p className="text-gray-400 text-lg">Initializing CRM...</p>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════ */
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* ── Header ── */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-600 to-cyan-700 rounded-xl flex items-center justify-center">
              <Users className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-300 bg-clip-text text-transparent">AI AGENT CRM</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"><Bot className="w-2.5 h-2.5" /> AI-Powered</span>
                <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20"><Mail className="w-2.5 h-2.5" /> Zoho Mail</span>
                <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20"><Globe className="w-2.5 h-2.5" /> Web Scraping</span>
                <span className="text-[10px] text-gray-500">{dashboard?.totalContacts || 0} contacts</span>
              </div>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 flex-wrap">
            {[
              { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
              { id: 'contacts',  label: 'Contacts',  icon: Users },
              { id: 'campaigns', label: 'Campaigns', icon: Send },
              { id: 'templates', label: 'Templates', icon: FileText },
              { id: 'sources',   label: 'Sources',   icon: Globe },
              { id: 'inbox',     label: 'Inbox',     icon: Inbox,   badge: emailUnread || null },
              { id: 'reports',   label: 'Reports',   icon: Bot,     badge: reportUnread || null },
            ].map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-2 text-sm font-medium rounded-lg flex items-center gap-1.5 relative ${
                  activeTab === tab.id ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
                <tab.icon className="w-4 h-4" />
                {tab.label}
                {tab.badge > 0 && (
                  <span className={`ml-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                    activeTab === tab.id ? 'bg-white/20 text-white' :
                    tab.id === 'inbox' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-purple-500/20 text-purple-400'}`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ══ DASHBOARD TAB ══ */}
      {activeTab === 'dashboard' && dashboard && (
        <div className="p-6 max-w-[1400px] mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
            {CONTACT_TYPES.map(ct => {
              const count = dashboard.contactsByType?.find(c => c.contact_type === ct.id)?.count || 0;
              return (
                <div key={ct.id} className="bg-gray-900 rounded-xl p-4 border border-gray-800 hover:border-gray-700 cursor-pointer transition-colors"
                  onClick={() => { setFilter({ ...filter, type: ct.id }); setActiveTab('contacts'); }}>
                  <div className="flex items-center gap-2 mb-2"><ct.icon className={`w-4 h-4 ${ct.color}`} /><span className="text-xs text-gray-400">{ct.label}</span></div>
                  <p className="text-2xl font-bold">{count}</p>
                </div>
              );
            })}
          </div>

          <h3 className="text-lg font-semibold mb-3 flex items-center gap-2"><ArrowUpRight className="w-5 h-5 text-emerald-400" /> Pipeline</h3>
          <div className="grid grid-cols-5 md:grid-cols-10 gap-2 mb-6">
            {PIPELINE_STAGES.map(stage => {
              const count = dashboard.pipeline?.find(p => p.pipeline_stage === stage.id)?.count || 0;
              return (
                <div key={stage.id} className="bg-gray-900 rounded-lg p-3 border border-gray-800 text-center cursor-pointer hover:border-gray-700"
                  onClick={() => { setFilter({ ...filter, stage: stage.id }); setActiveTab('contacts'); }}>
                  <div className={`w-3 h-3 rounded-full ${stage.color} mx-auto mb-1`} />
                  <p className="text-xs text-gray-500 mb-1">{stage.label}</p>
                  <p className="text-lg font-bold">{count}</p>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
              <div className="flex items-center gap-2 mb-2"><Mail className="w-4 h-4 text-blue-400" /><span className="text-sm text-gray-400">Emails Sent Today</span></div>
              <p className="text-2xl font-bold">{dashboard.emailStats?.totalSent || 0}</p>
              <p className="text-xs text-gray-500 mt-1">Daily limit: {dashboard.emailStats?.dailyRemaining || 100} remaining</p>
            </div>
            <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
              <div className="flex items-center gap-2 mb-2"><Send className="w-4 h-4 text-emerald-400" /><span className="text-sm text-gray-400">Active Campaigns</span></div>
              <p className="text-2xl font-bold text-emerald-400">{campaigns.filter(c => c.status === 'running' || c.status === 'approved').length}</p>
            </div>
            <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
              <div className="flex items-center gap-2 mb-2"><Globe className="w-4 h-4 text-cyan-400" /><span className="text-sm text-gray-400">Scrape Sources</span></div>
              <p className="text-2xl font-bold text-cyan-400">{dashboard.scrapeSources?.length || 0}</p>
            </div>
          </div>

          <h3 className="text-lg font-semibold mb-3 flex items-center gap-2"><Clock className="w-5 h-5 text-amber-400" /> Recent Activity</h3>
          <div className="space-y-2">
            {(dashboard.recentInteractions || []).slice(0, 10).map((i, idx) => (
              <div key={i.id || idx} className="bg-gray-900 rounded-lg p-3 border border-gray-800 flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${i.interaction_type?.includes('email') ? 'bg-blue-900/40' : 'bg-purple-900/40'}`}>
                  {i.interaction_type?.includes('email') ? <Mail className="w-4 h-4 text-blue-400" /> : <MessageSquare className="w-4 h-4 text-purple-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{i.first_name} {i.last_name} — {i.organization || 'N/A'}</p>
                  <p className="text-xs text-gray-500 truncate">{i.interaction_type?.replace(/_/g, ' ')} {i.subject ? `· ${i.subject}` : ''}</p>
                </div>
                <span className="text-xs text-gray-600">{new Date(i.created_at).toLocaleDateString()}</span>
              </div>
            ))}
            {(!dashboard.recentInteractions || dashboard.recentInteractions.length === 0) && (
              <div className="bg-gray-900 rounded-lg p-8 border border-gray-800 text-center">
                <Clock className="w-12 h-12 text-gray-700 mx-auto mb-3" />
                <p className="text-gray-400">No interactions yet. Add contacts and start campaigns.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ CONTACTS TAB ══ */}
      {activeTab === 'contacts' && (
        <div className="p-6 max-w-[1400px] mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input type="text" value={filter.search} onChange={e => setFilter({ ...filter, search: e.target.value })}
                  placeholder="Search contacts..." className="bg-gray-800 border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-sm w-64 focus:outline-none focus:border-emerald-500" />
              </div>
              <select value={filter.type} onChange={e => setFilter({ ...filter, type: e.target.value })}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500">
                <option value="">All Types</option>
                {CONTACT_TYPES.map(ct => <option key={ct.id} value={ct.id}>{ct.label}</option>)}
              </select>
              <select value={filter.stage} onChange={e => setFilter({ ...filter, stage: e.target.value })}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500">
                <option value="">All Stages</option>
                {PIPELINE_STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <button onClick={loadAll} className="p-2 bg-gray-800 rounded-lg hover:bg-gray-700"><RefreshCw className="w-4 h-4 text-gray-400" /></button>
            </div>
            <button onClick={() => setShowAddContact(true)} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-sm font-medium flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Contact
            </button>
          </div>

          {showAddContact && (
            <div className="bg-gray-900 border border-emerald-800/30 rounded-xl p-6 mb-6">
              <h3 className="font-medium text-lg mb-4 flex items-center gap-2"><UserPlus className="w-5 h-5 text-emerald-400" /> Add Contact</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                {[
                  { k: 'firstName', l: 'First Name', p: 'John' },
                  { k: 'lastName', l: 'Last Name', p: 'Doe' },
                  { k: 'email', l: 'Email *', p: 'john@hospital.com' },
                  { k: 'phone', l: 'Phone', p: '+1 555-0123' },
                  { k: 'title', l: 'Title', p: 'MD, FACP' },
                  { k: 'organization', l: 'Organization', p: 'Memorial Hospital' },
                  { k: 'specialty', l: 'Specialty', p: 'Family Medicine' },
                  { k: 'linkedinUrl', l: 'LinkedIn URL', p: 'https://linkedin.com/in/...' },
                  { k: 'twitterHandle', l: 'Twitter', p: '@johndoe' }
                ].map(f => (
                  <div key={f.k}>
                    <label className="text-xs text-gray-400 block mb-1">{f.l}</label>
                    <input type="text" value={contactForm[f.k]} onChange={e => setContactForm(prev => ({ ...prev, [f.k]: e.target.value }))}
                      placeholder={f.p} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-4 mb-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Type</label>
                  <select value={contactForm.contactType} onChange={e => setContactForm(prev => ({ ...prev, contactType: e.target.value }))}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500">
                    {CONTACT_TYPES.map(ct => <option key={ct.id} value={ct.id}>{ct.label}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-xs text-gray-400 block mb-1">Notes</label>
                  <input type="text" value={contactForm.notes} onChange={e => setContactForm(prev => ({ ...prev, notes: e.target.value }))}
                    placeholder="Any notes..." className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={addContact} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-sm font-medium">Save Contact</button>
                <button onClick={() => setShowAddContact(false)} className="px-5 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm">Cancel</button>
              </div>
            </div>
          )}

          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800 text-left text-xs text-gray-500 uppercase">
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Organization</th>
                  <th className="px-4 py-3">Stage</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Last Contact</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map(c => {
                  const typeInfo = CONTACT_TYPES.find(ct => ct.id === c.contact_type);
                  const stageInfo = PIPELINE_STAGES.find(s => s.id === c.pipeline_stage);
                  return (
                    <tr key={c.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium">{c.first_name} {c.last_name}</p>
                        <p className="text-xs text-gray-500">{c.email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-1 rounded ${typeInfo?.bg || 'bg-gray-800'} ${typeInfo?.color || 'text-gray-400'}`}>{c.contact_type}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-400">{c.organization || '-'}</td>
                      <td className="px-4 py-3">
                        <select value={c.pipeline_stage} onChange={e => updateStage(c.id, e.target.value)}
                          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs focus:outline-none">
                          {PIPELINE_STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <div className="w-12 bg-gray-800 rounded-full h-1.5">
                            <div className={`rounded-full h-1.5 ${c.lead_score > 70 ? 'bg-emerald-500' : c.lead_score > 40 ? 'bg-amber-500' : 'bg-gray-600'}`} style={{ width: `${c.lead_score}%` }} />
                          </div>
                          <span className="text-xs text-gray-500">{c.lead_score}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{c.last_contacted_at ? new Date(c.last_contacted_at).toLocaleDateString() : 'Never'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => { setSelectedContact(c); setEmailForm({ subject: '', body: '' }); }}
                            className="p-1.5 hover:bg-blue-900/30 rounded text-blue-400" title="Send Email">
                            <Mail className="w-3.5 h-3.5" />
                          </button>
                          {c.linkedin_url && (
                            <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="p-1.5 hover:bg-blue-900/30 rounded text-blue-400"><Linkedin className="w-3.5 h-3.5" /></a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {contacts.length === 0 && (
              <div className="p-12 text-center">
                <Users className="w-16 h-16 text-gray-700 mx-auto mb-4" />
                <p className="text-gray-400 text-lg">No contacts yet</p>
                <p className="text-gray-600 text-sm mt-2">Add contacts manually or let AI agents scrape provider directories.</p>
              </div>
            )}
          </div>

          {selectedContact && (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
              <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-lg p-6">
                <h3 className="font-medium text-lg mb-1 flex items-center gap-2"><Mail className="w-5 h-5 text-blue-400" /> Send Email</h3>
                <p className="text-sm text-gray-400 mb-4">To: {selectedContact.first_name} {selectedContact.last_name} &lt;{selectedContact.email}&gt;</p>
                <div className="space-y-3 mb-4">
                  <input type="text" value={emailForm.subject} onChange={e => setEmailForm(f => ({ ...f, subject: e.target.value }))}
                    placeholder="Subject line..." className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                  <textarea value={emailForm.body} onChange={e => setEmailForm(f => ({ ...f, body: e.target.value }))}
                    placeholder="Email body... Use {{first_name}}, {{organization}}, {{specialty}} for personalization"
                    rows={8} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
                {templates.length > 0 && (
                  <div className="mb-4">
                    <label className="text-xs text-gray-400 mb-1 block">Quick Templates:</label>
                    <div className="flex flex-wrap gap-1">
                      {templates.slice(0, 5).map(t => (
                        <button key={t.id} onClick={() => setEmailForm({ subject: t.subject, body: t.body })}
                          className="text-xs px-2 py-1 bg-gray-800 rounded hover:bg-gray-700 text-gray-400">{t.name}</button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex gap-3">
                  <button onClick={sendDirectEmail} disabled={!emailForm.subject}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50">
                    <Send className="w-4 h-4" /> Send via Zoho
                  </button>
                  <button onClick={() => setSelectedContact(null)} className="px-5 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm">Cancel</button>
                  <p className="text-xs text-gray-500 ml-auto self-center">From: info@doctarx.com</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══ CAMPAIGNS TAB ══ */}
      {activeTab === 'campaigns' && (
        <div className="p-6 max-w-[1400px] mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold flex items-center gap-2"><Send className="w-6 h-6 text-emerald-400" /> Email Campaigns</h2>
            <button onClick={() => setShowAddCampaign(true)} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-sm font-medium flex items-center gap-2">
              <Plus className="w-4 h-4" /> New Campaign
            </button>
          </div>

          {showAddCampaign && (
            <div className="bg-gray-900 border border-emerald-800/30 rounded-xl p-6 mb-6">
              <h3 className="font-medium text-lg mb-4">Create Campaign</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Campaign Name *</label>
                  <input type="text" value={campaignForm.name} onChange={e => setCampaignForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Q1 Provider Outreach" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Type</label>
                  <select value={campaignForm.campaignType} onChange={e => setCampaignForm(f => ({ ...f, campaignType: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500">
                    <option value="cold_email">Cold Email</option>
                    <option value="follow_up">Follow Up</option>
                    <option value="investor_pitch">Investor Pitch</option>
                    <option value="partnership">Partnership</option>
                    <option value="social_engage">Social Engagement</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Target Type</label>
                  <select value={campaignForm.targetContactType} onChange={e => setCampaignForm(f => ({ ...f, targetContactType: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500">
                    {CONTACT_TYPES.map(ct => <option key={ct.id} value={ct.id}>{ct.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Daily Limit</label>
                  <input type="number" value={campaignForm.dailyLimit} onChange={e => setCampaignForm(f => ({ ...f, dailyLimit: parseInt(e.target.value) || 30 }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
                </div>
              </div>
              <div className="space-y-3 mb-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Subject Line *</label>
                  <input type="text" value={campaignForm.subjectLine} onChange={e => setCampaignForm(f => ({ ...f, subjectLine: e.target.value }))}
                    placeholder="Earn More, See More Patients — DoctaRx" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Email Body *</label>
                  <textarea value={campaignForm.emailTemplate} onChange={e => setCampaignForm(f => ({ ...f, emailTemplate: e.target.value }))}
                    placeholder="Hi {{first_name}},..." rows={6} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
                  {templates.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      <span className="text-xs text-gray-500">Templates:</span>
                      {templates.map(t => (
                        <button key={t.id} onClick={() => setCampaignForm(f => ({ ...f, subjectLine: t.subject, emailTemplate: t.body }))}
                          className="text-xs px-2 py-0.5 bg-gray-800 rounded hover:bg-gray-700 text-emerald-400">{t.name}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={createCampaign} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-sm font-medium">Create Campaign</button>
                <button onClick={() => setShowAddCampaign(false)} className="px-5 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm">Cancel</button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {campaigns.map(c => (
              <div key={c.id} className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-medium">{c.name}</h3>
                    <p className="text-xs text-gray-500">{c.campaign_type?.replace(/_/g, ' ')} · Target: {c.target_contact_type} · Daily limit: {c.daily_limit}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      c.status === 'running' ? 'bg-emerald-900/40 text-emerald-300' :
                      c.status === 'approved' ? 'bg-blue-900/40 text-blue-300' :
                      c.status === 'completed' ? 'bg-gray-800 text-gray-300' :
                      c.status === 'draft' ? 'bg-amber-900/40 text-amber-300' : 'bg-gray-800 text-gray-400'}`}>
                      {c.status?.toUpperCase()}
                    </span>
                    {c.status === 'draft' && (
                      <button onClick={() => approveCampaign(c.id)} className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 rounded text-xs font-medium flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Approve
                      </button>
                    )}
                    {(c.status === 'approved' || c.status === 'running') && (
                      <button onClick={() => sendCampaign(c.id)} className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs font-medium flex items-center gap-1">
                        <PlayCircle className="w-3 h-3" /> Send Batch
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex gap-6 text-xs text-gray-500">
                  <span>Sent: <span className="text-blue-400 font-medium">{c.emails_sent || 0}</span></span>
                  <span>Opened: <span className="text-amber-400 font-medium">{c.emails_opened || 0}</span></span>
                  <span>Replied: <span className="text-emerald-400 font-medium">{c.emails_replied || 0}</span></span>
                  <span>Bounced: <span className="text-red-400 font-medium">{c.emails_bounced || 0}</span></span>
                  <span>Converted: <span className="text-green-400 font-medium">{c.conversions || 0}</span></span>
                </div>
              </div>
            ))}
            {campaigns.length === 0 && (
              <div className="bg-gray-900 rounded-xl p-12 text-center border border-gray-800">
                <Send className="w-16 h-16 text-gray-700 mx-auto mb-4" />
                <p className="text-gray-400 text-lg">No campaigns yet</p>
                <p className="text-gray-600 text-sm mt-2">Create a campaign to start outreach.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ TEMPLATES TAB ══ */}
      {activeTab === 'templates' && (
        <div className="p-6 max-w-[1400px] mx-auto">
          <h2 className="text-xl font-bold flex items-center gap-2 mb-6"><FileText className="w-6 h-6 text-purple-400" /> Email Templates</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {templates.map(t => (
              <div key={t.id} className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium text-sm">{t.name}</h3>
                  <span className="text-xs px-2 py-0.5 rounded bg-purple-900/30 text-purple-400">{t.category?.replace(/_/g, ' ')}</span>
                </div>
                <p className="text-xs text-gray-500 mb-1">Subject: {t.subject}</p>
                <pre className="text-xs text-gray-400 whitespace-pre-wrap bg-gray-800 rounded-lg p-3 max-h-32 overflow-y-auto font-sans">{t.body?.substring(0, 300)}{t.body?.length > 300 ? '...' : ''}</pre>
                <div className="flex gap-4 mt-3 text-xs text-gray-500">
                  <span>Used: {t.times_used}x</span>
                  <span>Open: {t.open_rate}%</span>
                  <span>Reply: {t.reply_rate}%</span>
                </div>
              </div>
            ))}
            {templates.length === 0 && (
              <div className="col-span-2 bg-gray-900 rounded-xl p-12 text-center border border-gray-800">
                <FileText className="w-16 h-16 text-gray-700 mx-auto mb-4" />
                <p className="text-gray-400">Templates loading on first server start...</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ SOURCES TAB ══ */}
      {activeTab === 'sources' && (
        <div className="p-6 max-w-[1400px] mx-auto">
          <h2 className="text-xl font-bold flex items-center gap-2 mb-6"><Globe className="w-6 h-6 text-cyan-400" /> Scraping Sources — Provider &amp; Investor Directories</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sources.map(s => (
              <div key={s.id} className="bg-gray-900 rounded-xl p-5 border border-gray-800 hover:border-gray-700 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium text-sm">{s.name}</h3>
                  <span className="text-xs px-2 py-0.5 rounded bg-cyan-900/30 text-cyan-400">{s.source_type?.replace(/_/g, ' ')}</span>
                </div>
                <a href={s.url} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline flex items-center gap-1 mb-2">
                  <ExternalLink className="w-3 h-3" /> {s.url.replace('https://', '').substring(0, 40)}
                </a>
                <div className="flex gap-4 text-xs text-gray-500">
                  <span>Found: <span className="text-emerald-400 font-medium">{s.contacts_found}</span></span>
                  <span>Frequency: {s.scrape_frequency}</span>
                  <span>{s.last_scraped_at ? `Last: ${new Date(s.last_scraped_at).toLocaleDateString()}` : 'Never scraped'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══ INBOX TAB ══ */}
      {activeTab === 'inbox' && (
        <div className="flex" style={{ height: 'calc(100vh - 73px)' }}>
          {/* Thread List */}
          <div className="w-80 flex-shrink-0 border-r border-gray-800 flex flex-col bg-gray-900/50">
            {/* Search + Compose */}
            <div className="p-3 border-b border-gray-800 space-y-2">
              <div className="relative">
                <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input type="text" placeholder="Search inbox..."
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>
              <button onClick={() => setShowCompose(true)}
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium flex items-center justify-center gap-2">
                <Plus className="w-4 h-4" /> Compose
              </button>
            </div>

            {/* Thread Items */}
            <div className="flex-1 overflow-auto">
              {threadsLoading ? (
                <div className="flex items-center justify-center h-32 text-gray-500 text-sm gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin" /> Loading...
                </div>
              ) : threads.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-gray-600 text-sm gap-2 px-4 text-center">
                  <Inbox className="w-8 h-8 opacity-30" />
                  <p>No outreach emails yet.</p>
                  <p className="text-xs text-gray-700">Agent emails to CRM contacts will appear here.</p>
                </div>
              ) : threads.map(thread => {
                const statusStyle = thread.email_status === 'replied' ? SENTIMENT_STYLE.positive :
                  thread.email_status === 'bounced' ? SENTIMENT_STYLE.negative : SENTIMENT_STYLE.neutral;
                return (
                  <button key={thread.id} onClick={() => { setSelectedThread(thread); loadThreadMessages(thread.contact_id); }}
                    className={`w-full text-left p-4 border-b border-gray-800 transition-colors hover:bg-gray-800/60 ${
                      selectedThread?.id === thread.id ? 'bg-gray-800 border-l-2 border-l-blue-500' : ''
                    }`}>
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center flex-shrink-0 text-sm font-bold">
                        {(thread.contact_name || '?').charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <p className={`text-sm truncate ${!thread.read_at ? 'font-semibold text-white' : 'text-gray-300'}`}>
                            {thread.contact_name}
                          </p>
                          <span className="text-[10px] text-gray-500 flex-shrink-0 ml-1">{timeAgo(thread.created_at)}</span>
                        </div>
                        <p className={`text-xs truncate mb-1 ${!thread.read_at ? 'text-gray-200' : 'text-gray-500'}`}>{thread.subject}</p>
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusStyle.bg} ${statusStyle.text} border ${statusStyle.border}`}>
                            {thread.email_status || thread.interaction_type}
                          </span>
                          {!thread.read_at && <span className="w-2 h-2 rounded-full bg-blue-500 ml-auto" />}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Message Detail */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {selectedThread ? (
              <>
                {/* Thread header */}
                <div className="px-6 py-4 border-b border-gray-800 bg-gray-900/30">
                  <h3 className="font-semibold text-white">{selectedThread.subject}</h3>
                  <p className="text-sm text-gray-400 mt-0.5">
                    {selectedThread.contact_name} &lt;{selectedThread.contact_email}&gt;
                    <span className={`ml-2 text-[10px] px-2 py-0.5 rounded ${SENTIMENT_STYLE.neutral.bg} ${SENTIMENT_STYLE.neutral.text} border ${SENTIMENT_STYLE.neutral.border}`}>
                      {selectedThread.email_status || selectedThread.interaction_type}
                    </span>
                  </p>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-auto p-6 space-y-4">
                  {(threadMessages[selectedThread.contact_id] || []).length === 0 ? (
                    <div className="flex items-center justify-center h-24 text-gray-600 text-sm gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin" /> Loading messages...
                    </div>
                  ) : (threadMessages[selectedThread.contact_id] || []).map(msg => (
                    <div key={msg.id} className={`flex ${msg.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] rounded-2xl px-4 py-3 ${
                        msg.direction === 'out'
                          ? 'bg-blue-600/20 border border-blue-500/20 text-blue-100'
                          : 'bg-gray-800 border border-gray-700 text-gray-200'
                      }`}>
                        <p className="text-xs font-medium mb-1 text-gray-400">{msg.sender}</p>
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                        <p className="text-[10px] text-gray-500 mt-2 text-right">{timeAgo(msg.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* AI Suggestion */}
                {showAISuggest && (
                  <div className="mx-6 mb-3 p-4 bg-purple-900/20 border border-purple-500/30 rounded-xl">
                    <p className="text-xs font-medium text-purple-400 mb-2 flex items-center gap-1"><Sparkles className="w-3 h-3" /> AI Suggested Reply</p>
                    {aiLoading ? (
                      <div className="flex items-center gap-2 text-gray-400 text-sm"><RefreshCw className="w-4 h-4 animate-spin" /> Generating...</div>
                    ) : (
                      <>
                        <p className="text-sm text-gray-300 whitespace-pre-wrap">{aiSuggestion}</p>
                        <div className="flex gap-2 mt-3">
                          <button onClick={() => setReplyContent(aiSuggestion)}
                            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 rounded-lg text-xs font-medium">Use This</button>
                          <button onClick={() => { setShowAISuggest(false); setAiSuggestion(''); }}
                            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs">Dismiss</button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Reply Box */}
                <div className="p-4 border-t border-gray-800 bg-gray-900/30">
                  <textarea value={replyContent} onChange={e => setReplyContent(e.target.value)}
                    placeholder="Write a reply..."
                    rows={3} className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 resize-none mb-3" />
                  <div className="flex items-center gap-2">
                    <button onClick={handleSendReply} disabled={!replyContent.trim()}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50">
                      <Send className="w-4 h-4" /> Send
                    </button>
                    <button onClick={handleGetAISuggestion}
                      className="px-4 py-2 bg-purple-600/20 hover:bg-purple-600/40 border border-purple-500/30 rounded-lg text-sm text-purple-400 flex items-center gap-2">
                      <Sparkles className="w-4 h-4" /> AI Suggest
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-center p-8">
                <div>
                  <MailOpen className="w-16 h-16 text-gray-700 mx-auto mb-4" />
                  <p className="text-gray-400 text-lg font-medium">Select a conversation</p>
                  <p className="text-gray-600 text-sm mt-2">Choose a thread from the left to view messages and reply.</p>
                </div>
              </div>
            )}
          </div>

          {/* Compose Modal */}
          {showCompose && (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
              <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-lg p-6">
                <h3 className="font-medium text-lg mb-4 flex items-center gap-2"><Mail className="w-5 h-5 text-blue-400" /> New Email</h3>
                <div className="space-y-3 mb-4">
                  <input type="text" value={composeForm.to} onChange={e => setComposeForm(f => ({ ...f, to: e.target.value }))}
                    placeholder="To: email@example.com" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                  <input type="text" value={composeForm.subject} onChange={e => setComposeForm(f => ({ ...f, subject: e.target.value }))}
                    placeholder="Subject..." className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                  <textarea value={composeForm.body} onChange={e => setComposeForm(f => ({ ...f, body: e.target.value }))}
                    placeholder="Message body..." rows={8} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
                <div className="flex gap-3">
                  <button onClick={() => { setShowCompose(false); setComposeForm({ to: '', subject: '', body: '' }); }}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium flex items-center gap-2">
                    <Send className="w-4 h-4" /> Send
                  </button>
                  <button onClick={() => setShowCompose(false)} className="px-5 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm">Cancel</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══ REPORTS TAB ══ */}
      {activeTab === 'reports' && (
        <div className="p-6 max-w-[1400px] mx-auto">
          {/* Header row */}
          <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-indigo-700 rounded-xl flex items-center justify-center">
                <Inbox className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Agent Reports & Briefings</h2>
                <p className="text-xs text-gray-500">Proactive briefings, alerts, and results from your AI agents</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={wakeUpAgents} disabled={waking}
                className="px-3 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 rounded-lg text-xs font-bold flex items-center gap-1.5 disabled:opacity-50">
                <Zap className={`w-3.5 h-3.5 ${waking ? 'animate-spin' : ''}`} />
                {waking ? 'Waking...' : 'Wake Up Agents'}
              </button>
              <button onClick={runMissions} disabled={missionRunning}
                className="px-3 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 rounded-lg text-xs font-bold flex items-center gap-1.5 disabled:opacity-50">
                <Globe className={`w-3.5 h-3.5 ${missionRunning ? 'animate-spin' : ''}`} />
                {missionRunning ? 'Running...' : 'Web Missions'}
              </button>
              {reportUnread > 0 && (
                <button onClick={markAllReportsRead}
                  className="px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs font-medium flex items-center gap-1.5 text-gray-300 border border-gray-700">
                  <CheckCheck className="w-3.5 h-3.5" /> Mark read ({reportUnread})
                </button>
              )}
              <button onClick={handleReportRefresh} disabled={reportRefreshing}
                className="px-3 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-xs font-medium flex items-center gap-1.5 disabled:opacity-50">
                <RefreshCw className={`w-3.5 h-3.5 ${reportRefreshing ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>
          </div>

          {/* Summary Cards */}
          {reportSummary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <div className="flex items-center gap-2 mb-2"><Mail className="w-4 h-4 text-purple-400" /><span className="text-xs text-gray-400">Unread</span></div>
                <p className="text-3xl font-bold text-purple-400">{reportUnread}</p>
              </div>
              <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <div className="flex items-center gap-2 mb-2"><AlertTriangle className="w-4 h-4 text-red-400" /><span className="text-xs text-gray-400">Alerts (24h)</span></div>
                <p className="text-3xl font-bold text-red-400">{reportSummary.messageStats?.find(s => s.message_type === 'alert')?.count || 0}</p>
              </div>
              <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <div className="flex items-center gap-2 mb-2"><BarChart3 className="w-4 h-4 text-blue-400" /><span className="text-xs text-gray-400">Reports (24h)</span></div>
                <p className="text-3xl font-bold text-blue-400">{reportSummary.messageStats?.find(s => s.message_type === 'report')?.count || 0}</p>
              </div>
              <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <div className="flex items-center gap-2 mb-2"><Bot className="w-4 h-4 text-emerald-400" /><span className="text-xs text-gray-400">Active Agents</span></div>
                <p className="text-3xl font-bold text-emerald-400">{reportSummary.activeAgents?.length || 0}</p>
              </div>
            </div>
          )}

          {/* Pending Proposals Banner */}
          {reportSummary?.pendingProposals?.length > 0 && (
            <div className="bg-amber-900/20 border border-amber-500/30 rounded-xl p-4 mb-6 flex items-center gap-3">
              <AlertCircle className="w-6 h-6 text-amber-400 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-300">
                  {reportSummary.pendingProposals.length} pending proposal{reportSummary.pendingProposals.length > 1 ? 's' : ''} awaiting approval
                </p>
                <p className="text-xs text-amber-400/60 mt-0.5">{reportSummary.pendingProposals.map(p => p.title).join(' · ')}</p>
              </div>
              <a href="/admin/agent-ops" className="px-4 py-2 bg-amber-600 hover:bg-amber-700 rounded-lg text-sm font-medium flex items-center gap-2">
                Review <ArrowUpRight className="w-3 h-3" />
              </a>
            </div>
          )}

          {/* Filters */}
          <div className="flex items-center gap-2 mb-4">
            {['all', 'unread', 'alert', 'report'].map(f => (
              <button key={f} onClick={() => setReportFilter(f)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  reportFilter === f ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                {f === 'all' ? 'All' : f === 'unread' ? `Unread (${reportUnread})` : f.charAt(0).toUpperCase() + f.slice(1) + 's'}
              </button>
            ))}
          </div>

          {/* Report Items */}
          <div className="space-y-2">
            {reportItems.length === 0 ? (
              <div className="bg-gray-900 rounded-xl p-16 text-center border border-gray-800">
                <Inbox className="w-16 h-16 text-gray-700 mx-auto mb-4" />
                <p className="text-gray-400 text-lg">{reportFilter === 'unread' ? 'All caught up!' : 'No messages yet'}</p>
                <p className="text-gray-600 text-sm mt-2">
                  {reportFilter === 'unread'
                    ? 'All agent messages have been read.'
                    : 'Agents will post briefings, alerts, and reports here automatically.'}
                </p>
              </div>
            ) : reportItems.map(item => {
              const agent = AGENT_MAP[item.sender_id] || { name: item.sender_name, icon: Bot, color: 'text-gray-400', bg: 'bg-gray-800', border: 'border-gray-700' };
              const AgentIcon = agent.icon;
              const typeInfo = TYPE_LABELS[item.message_type] || TYPE_LABELS.text;
              const TypeIcon = typeInfo.icon;
              const isUnread = !item.read_at;
              const isExpanded = reportExpanded === item.id;
              let meta = {};
              try { meta = typeof item.metadata === 'string' ? JSON.parse(item.metadata || '{}') : (item.metadata || {}); } catch {}
              const lines = item.content.split('\n').filter(l => l.trim());
              const preview = lines.slice(0, 2).join(' ').replace(/\*\*/g, '').replace(/[#_]/g, '').substring(0, 200);

              return (
                <div key={item.id} className={`rounded-xl border transition-all group ${
                  isUnread ? `bg-gray-900/90 ${agent.border} border-l-4 shadow-lg` : 'bg-gray-900/50 border-gray-800 hover:border-gray-700'
                } ${isExpanded ? 'ring-1 ring-purple-500/30' : ''}`}>
                  <div onClick={() => toggleReportExpand(item.id)} className="flex items-center gap-3 px-5 py-4 cursor-pointer">
                    <div className={`w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center ${agent.bg}`}>
                      <AgentIcon className={`w-5 h-5 ${agent.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-sm font-semibold ${isUnread ? 'text-white' : 'text-gray-300'}`}>{agent.name}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${typeInfo.bg} ${typeInfo.color} border ${typeInfo.border} font-medium`}>{typeInfo.label}</span>
                        {meta.severity === 'critical' && <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 font-bold animate-pulse">CRITICAL</span>}
                        {meta.severity === 'high' && <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30 font-medium">HIGH</span>}
                        {meta.aiGenerated && <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30">AI</span>}
                      </div>
                      <p className={`text-sm truncate ${isUnread ? 'text-gray-200' : 'text-gray-500'}`}>{preview}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-gray-500 flex items-center gap-1"><Clock className="w-3 h-3" /> {timeAgo(item.created_at)}</span>
                      {isUnread && <span className="w-2.5 h-2.5 rounded-full bg-purple-500 animate-pulse" />}
                      <button onClick={(e) => deleteReport(item.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-900/30 rounded-lg transition-all">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-5 pb-5 border-t border-gray-800">
                      <div className="pt-4">
                        <pre className="whitespace-pre-wrap font-sans text-sm text-gray-300 leading-relaxed">{item.content}</pre>
                        {meta.metrics && (
                          <div className="mt-4 flex flex-wrap gap-2">
                            {Object.entries(meta.metrics).map(([key, val]) => (
                              <span key={key} className="text-xs bg-gray-800 px-3 py-1.5 rounded-lg">
                                {key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}:
                                <span className="font-medium text-emerald-300 ml-1">{typeof val === 'number' ? val.toLocaleString() : val}</span>
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="mt-4 flex items-center gap-2">
                          <span className="text-xs text-gray-600">{new Date(item.created_at).toLocaleString()}</span>
                          <span className="text-gray-700">·</span>
                          <span className="text-xs text-gray-600">{item.sender_id}</span>
                          <button onClick={(e) => deleteReport(item.id, e)}
                            className="ml-auto px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/30 rounded-lg flex items-center gap-1">
                            <Trash2 className="w-3 h-3" /> Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
