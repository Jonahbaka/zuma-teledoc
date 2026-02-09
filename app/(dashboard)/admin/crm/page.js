'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Users, Mail, Send, Search, Plus, Filter, BarChart3, Globe,
  Building2, Stethoscope, DollarSign, UserPlus, Eye, Trash2,
  ChevronRight, ArrowUpRight, Clock, Target, Zap, Phone,
  Linkedin, Twitter, CheckCircle2, XCircle, PauseCircle,
  PlayCircle, FileText, Sparkles, Bot, Crown, Shield,
  MessageSquare, TrendingUp, ExternalLink, RefreshCw
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

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

export default function CRMPage() {
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

  const getToken = () => typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

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

  const approveCampaign = async (id) => {
    await apiCall(`/campaigns/${id}/approve`, 'POST');
    loadAll();
  };

  const sendCampaign = async (id) => {
    await apiCall(`/campaigns/${id}/send`, 'POST', { limit: 10 });
    loadAll();
  };

  const sendDirectEmail = async () => {
    if (!selectedContact || !emailForm.subject) return;
    await apiCall(`/contacts/${selectedContact.id}/email`, 'POST', emailForm);
    setSelectedContact(null);
    setEmailForm({ subject: '', body: '' });
    loadAll();
  };

  const updateStage = async (id, stage) => {
    await apiCall(`/contacts/${id}/stage`, 'PUT', { stage });
    loadAll();
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

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-600 to-cyan-700 rounded-xl flex items-center justify-center">
              <Users className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-300 bg-clip-text text-transparent">AI AGENT CRM</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Bot className="w-2.5 h-2.5" /> AI-Powered
                </span>
                <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  <Mail className="w-2.5 h-2.5" /> Zoho Mail
                </span>
                <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
                  <Globe className="w-2.5 h-2.5" /> Web Scraping
                </span>
                <span className="text-[10px] text-gray-500">{dashboard?.totalContacts || 0} contacts</span>
              </div>
            </div>
          </div>
          <div className="flex gap-1">
            {[
              { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
              { id: 'contacts', label: 'Contacts', icon: Users },
              { id: 'campaigns', label: 'Campaigns', icon: Send },
              { id: 'templates', label: 'Templates', icon: FileText },
              { id: 'sources', label: 'Sources', icon: Globe },
            ].map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 text-sm font-medium rounded-lg flex items-center gap-2 ${
                  activeTab === tab.id ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
                <tab.icon className="w-4 h-4" /> {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* DASHBOARD TAB */}
      {activeTab === 'dashboard' && dashboard && (
        <div className="p-6 max-w-[1400px] mx-auto">
          {/* Stats Row */}
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

          {/* Pipeline */}
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

          {/* Email Stats */}
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

          {/* Recent Interactions */}
          <h3 className="text-lg font-semibold mb-3 flex items-center gap-2"><Clock className="w-5 h-5 text-amber-400" /> Recent Activity</h3>
          <div className="space-y-2">
            {(dashboard.recentInteractions || []).slice(0, 10).map((i, idx) => (
              <div key={i.id || idx} className="bg-gray-900 rounded-lg p-3 border border-gray-800 flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  i.interaction_type?.includes('email') ? 'bg-blue-900/40' : 'bg-purple-900/40'}`}>
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

      {/* CONTACTS TAB */}
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

          {/* Add Contact Form */}
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

          {/* Contact List */}
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
                        <div>
                          <p className="text-sm font-medium">{c.first_name} {c.last_name}</p>
                          <p className="text-xs text-gray-500">{c.email}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-1 rounded ${typeInfo?.bg || 'bg-gray-800'} ${typeInfo?.color || 'text-gray-400'}`}>
                          {c.contact_type}
                        </span>
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
                            <div className={`rounded-full h-1.5 ${c.lead_score > 70 ? 'bg-emerald-500' : c.lead_score > 40 ? 'bg-amber-500' : 'bg-gray-600'}`}
                              style={{ width: `${c.lead_score}%` }} />
                          </div>
                          <span className="text-xs text-gray-500">{c.lead_score}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {c.last_contacted_at ? new Date(c.last_contacted_at).toLocaleDateString() : 'Never'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => { setSelectedContact(c); setEmailForm({ subject: '', body: '' }); }}
                            className="p-1.5 hover:bg-blue-900/30 rounded text-blue-400" title="Send Email">
                            <Mail className="w-3.5 h-3.5" />
                          </button>
                          {c.linkedin_url && (
                            <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="p-1.5 hover:bg-blue-900/30 rounded text-blue-400" title="LinkedIn">
                              <Linkedin className="w-3.5 h-3.5" />
                            </a>
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

          {/* Email Modal */}
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

      {/* CAMPAIGNS TAB */}
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

      {/* TEMPLATES TAB */}
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

      {/* SOURCES TAB */}
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
    </div>
  );
}
