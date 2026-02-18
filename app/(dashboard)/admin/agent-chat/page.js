'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  MessageSquare, Send, Bot, Shield, Activity, TrendingUp, Zap,
  Brain, Eye, FileText, Lock, Key, Plus, Trash2, Check, X,
  Users, Radio, ChevronDown, Search, Radar, Gem, Calculator,
  Atom, Hexagon, Crown, AlertTriangle, BarChart3, Globe, Bug,
  Heart, Database, Cpu, Network, Hand, Play, Pause, Code2,
  Target, DollarSign, Gauge, Sparkles, ArrowUpRight, GitBranch
} from 'lucide-react';
import HolographicAvatar from '@/components/agents/HolographicAvatar';
import { AGENT_PERSONAS, getAgentPersona, normalizeAgentId } from '@/lib/agentPersonas';
import { getAgentTheme } from '@/lib/agentTheme';
import { useAgentVoice } from '@/lib/agentVoice';

// ═══════════════════════════════════════════════════════════════
//  TYPING ANIMATION — Makes agents feel ALIVE
//  Fast word-by-word reveal like a human typing rapidly
// ═══════════════════════════════════════════════════════════════
function TypingMessage({ text, speed = 12, onComplete, scrollRef }) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);
  const frameRef = useRef(null);
  const indexRef = useRef(0);
  const lastTimeRef = useRef(0);

  useEffect(() => {
    if (!text) { setDone(true); return; }
    indexRef.current = 0;
    setDisplayed('');
    setDone(false);
    lastTimeRef.current = 0;

    const words = text.split(/(\s+)/); // preserve whitespace
    let wordIdx = 0;
    let built = '';

    const tick = (timestamp) => {
      if (!lastTimeRef.current) lastTimeRef.current = timestamp;
      const elapsed = timestamp - lastTimeRef.current;

      // Reveal multiple words per frame for speed
      const wordsPerTick = Math.max(1, Math.floor(elapsed / speed));

      if (wordIdx < words.length) {
        for (let i = 0; i < wordsPerTick && wordIdx < words.length; i++) {
          built += words[wordIdx];
          wordIdx++;
        }
        setDisplayed(built);
        lastTimeRef.current = timestamp;

        // Auto-scroll as text appears
        if (scrollRef?.current) {
          scrollRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });
        }

        frameRef.current = requestAnimationFrame(tick);
      } else {
        setDisplayed(text);
        setDone(true);
        if (onComplete) onComplete();
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [text, speed, onComplete, scrollRef]);

  return (
    <>
      <pre className="whitespace-pre-wrap font-sans">{displayed}</pre>
      {!done && (
        <span className="inline-block w-2 h-4 bg-purple-400 animate-pulse ml-0.5 align-text-bottom rounded-sm" />
      )}
    </>
  );
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

const AGENTS = [
  { id: 'all', label: 'Broadcast', icon: Radio },
  { id: 'ceo', label: AGENT_PERSONAS.ceo.name, icon: Crown },
  { id: 'operations', label: AGENT_PERSONAS.operations.name, icon: Activity },
  { id: 'asclepius', label: AGENT_PERSONAS.asclepius.name, icon: Heart },
  { id: 'triage_nurse', label: AGENT_PERSONAS.triage_nurse.name, icon: AlertTriangle },
  { id: 'pharmacist', label: AGENT_PERSONAS.pharmacist.name, icon: Hand },
  { id: 'growth', label: AGENT_PERSONAS.growth.name, icon: Radar },
  { id: 'revenue', label: AGENT_PERSONAS.revenue.name, icon: Zap },
  { id: 'compliance', label: AGENT_PERSONAS.compliance.name, icon: Shield },
  { id: 'governance', label: AGENT_PERSONAS.governance.name, icon: Eye },
  { id: 'corporate_skills', label: AGENT_PERSONAS.corporate_skills.name, icon: FileText },
  { id: 'researcher', label: AGENT_PERSONAS.researcher.name, icon: Search },
  { id: 'engineering', label: AGENT_PERSONAS.engineering.name, icon: Code2 },
  { id: 'devops', label: AGENT_PERSONAS.devops.name, icon: Bug }
];

const PLATFORMS = [
  { id: 'twitter', name: 'Twitter / X', icon: '🐦' },
  { id: 'linkedin', name: 'LinkedIn', icon: '💼' },
  { id: 'facebook', name: 'Facebook', icon: '📘' },
  { id: 'instagram', name: 'Instagram', icon: '📸' },
  { id: 'tiktok', name: 'TikTok', icon: '🎵' },
  { id: 'youtube', name: 'YouTube', icon: '📺' },
  { id: 'google_ads', name: 'Google Ads', icon: '📊' },
  { id: 'meta_ads', name: 'Meta Ads Manager', icon: '📣' },
  { id: 'reddit', name: 'Reddit', icon: '🤖' },
  { id: 'pinterest', name: 'Pinterest', icon: '📌' },
  { id: 'github', name: 'GitHub', icon: '🐙' },
  { id: 'mailchimp', name: 'Mailchimp', icon: '📧' },
  { id: 'sendgrid', name: 'SendGrid', icon: '✉️' },
  { id: 'stripe', name: 'Stripe', icon: '💳' },
  { id: 'google_analytics', name: 'Google Analytics', icon: '📈' },
  { id: 'google_business', name: 'Google Business', icon: '🏢' },
  { id: 'slack', name: 'Slack', icon: '💬' },
  { id: 'discord', name: 'Discord', icon: '🎮' },
  { id: 'custom', name: 'Custom Platform', icon: '🔧' },
];

export default function AgentChatPage() {
  const [activeTab, setActiveTab] = useState('chat');
  const [selectedAgent, setSelectedAgent] = useState('ceo');
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [attachmentIds, setAttachmentIds] = useState([]);
  const [uploads, setUploads] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [githubStatus, setGithubStatus] = useState(null);
  const [credentials, setCredentials] = useState([]);
  const [results, setResults] = useState([]);
  const [showCredForm, setShowCredForm] = useState(false);
  const [credForm, setCredForm] = useState({ platform: '', accountLabel: '', username: '', password: '', apiKey: '', apiSecret: '', assignedAgents: [], notes: '' });
  const [loading, setLoading] = useState(true);
  const [typingIds, setTypingIds] = useState(new Set()); // message IDs currently typing
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const voice = useAgentVoice();

  // Drive avatar "talking" animation off the same signal used for typing.
  const typingAgentIds = useMemo(() => {
    const set = new Set();
    for (const msg of (messages || [])) {
      const isOperator = msg.sender_type === 'operator';
      const isSystem = msg.sender_type === 'system';
      const isAgent = !isOperator && !isSystem;
      if (!isAgent) continue;
      if (!msg.id) continue;
      if (!typingIds.has(msg.id)) continue;
      set.add(normalizeAgentId(msg.sender_id));
    }
    return set;
  }, [messages, typingIds]);

  const getToken = () => typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

  const apiCall = useCallback(async (endpoint, method = 'GET', body = null) => {
    const token = getToken();
    const controller = new AbortController();
    const timeoutMs = 20000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const options = {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: controller.signal
    };
    if (body) options.body = JSON.stringify(body);
    try {
      const res = await fetch(`${API_URL}/agent-chat${endpoint}`, options);
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = { success: false, error: `Invalid server response (${res.status})` };
      }
      if (!data.success) {
        const err = new Error(data.error || `Request failed (${res.status})`);
        err.status = res.status;
        err.code = data.code;
        throw err;
      }
      return data.data;
    } catch (err) {
      // If auth breaks (expired/invalid token), make it obvious and force re-login.
      if (err && err.status === 401) {
        try { localStorage.removeItem('accessToken'); } catch { /* ignore */ }
        // On admin-only pages, redirecting is better than silently failing.
        if (typeof window !== 'undefined') window.location.href = '/secure/admin';
      }
      if (err.name === 'AbortError') {
        console.error(`API timeout after ${timeoutMs}ms:`, endpoint);
      } else {
        console.error('API error:', err);
      }
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  const loadMessages = useCallback(async () => {
    const agent = selectedAgent === 'all' ? undefined : selectedAgent;
    const data = await apiCall(`/messages?agent=${agent || ''}&limit=100`);
    if (data) setMessages(data);
  }, [apiCall, selectedAgent]);

  const loadCredentials = useCallback(async () => {
    const data = await apiCall('/credentials');
    if (data) setCredentials(data);
  }, [apiCall]);

  const loadResults = useCallback(async () => {
    const data = await apiCall('/results?limit=50');
    if (data) setResults(data);
  }, [apiCall]);

  const loadUploads = useCallback(async () => {
    const data = await apiCall('/uploads');
    if (data) setUploads(data);
  }, [apiCall]);

  const loadGithubStatus = useCallback(async () => {
    const data = await apiCall('/github/status');
    setGithubStatus(data || null);
  }, [apiCall]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([loadMessages(), loadCredentials(), loadResults(), loadUploads()]);
      setLoading(false);
    };
    init();
  }, [loadMessages, loadCredentials, loadResults, loadUploads]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    loadMessages();
  }, [selectedAgent, loadMessages]);

  const sendMessage = async () => {
    if (!inputMessage.trim() || sending) return;
    setSending(true);
    const msg = inputMessage;
    setInputMessage('');

    // Optimistic UI — add operator message immediately
    const tempMsg = { id: Date.now(), sender_type: 'operator', sender_name: 'You (The Operator)', content: msg, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, tempMsg]);

    try {
      if (selectedAgent === 'all') {
        const data = await apiCall('/broadcast', 'POST', { content: msg });
        if (data) {
          // Mark all broadcast responses for typing animation
          if (data.responses) {
            const newIds = new Set(data.responses.map(r => r.id).filter(Boolean));
            setTypingIds(prev => new Set([...prev, ...newIds]));
          }
          await loadMessages();
        } else {
          console.warn('Broadcast failed — message may not have been saved');
        }
      } else {
        const data = await apiCall('/messages', 'POST', { recipientId: selectedAgent, content: msg, attachmentIds });
        if (data) {
          // Mark agent response for typing animation
          if (data.agentResponse?.id) {
            setTypingIds(prev => new Set([...prev, data.agentResponse.id]));
          }
          // Replace temp message and add agent response
          setMessages(prev => {
            const filtered = prev.filter(m => m.id !== tempMsg.id);
            const newMsgs = [data.operatorMessage];
            if (data.agentResponse) newMsgs.push(data.agentResponse);
            return [...filtered, ...newMsgs];
          });
        } else {
          setMessages(prev => prev.map(m => m.id === tempMsg.id ? { ...m, content: msg + '\n\n⚠️ Failed to send — check your login session and try again.' } : m));
        }
      }
    } catch (err) {
      console.error('Send error:', err);
      setMessages(prev => prev.map(m => m.id === tempMsg.id ? { ...m, content: msg + '\n\n⚠️ Error sending message.' } : m));
    } finally {
      setSending(false);
      setAttachmentIds([]);
      inputRef.current?.focus();
    }
  };

  const onUploadFiles = useCallback(async (filesList) => {
    const files = Array.from(filesList || []).slice(0, 8);
    if (files.length === 0) return;
    setUploading(true);
    try {
      const token = getToken();
      const form = new FormData();
      for (const f of files) form.append('files', f);
      const res = await fetch(`${API_URL}/agent-chat/uploads`, {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: form
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Upload failed');
      const newIds = (json.data || []).map((x) => x.id).filter(Boolean);
      await loadUploads();
      // Auto-select newly uploaded files for the next message.
      if (newIds.length > 0) {
        setAttachmentIds((prev) => {
          const merged = [...prev, ...newIds];
          return Array.from(new Set(merged)).slice(0, 8);
        });
      }
    } catch (e) {
      console.error('Upload failed:', e);
    } finally {
      setUploading(false);
    }
  }, [loadUploads]);

  const downloadUpload = useCallback(async (file) => {
    if (!file?.id) return;
    const token = getToken();
    try {
      const res = await fetch(`${API_URL}/agent-chat/uploads/${file.id}/download`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
      });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.original_name || file.originalName || 'download';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Download failed:', e);
      alert('Download failed. Check console for details.');
    }
  }, []);

  const summonAll = async () => {
    setSending(true);
    try {
      setSelectedAgent('all');
      const data = await apiCall('/summon-all', 'POST', { prompt: 'All agents — introduce yourselves. Tell me who you are, your role, your dreams, and what you do for fun.' });
      if (data) {
        // Mark all summon responses for typing animation
        if (data.responses) {
          const newIds = new Set(data.responses.map(r => r.id).filter(Boolean));
          setTypingIds(prev => new Set([...prev, ...newIds]));
        }
        await loadMessages();
      }
    } catch (err) {
      console.error('Summon error:', err);
    } finally {
      setSending(false);
    }
  };

  const saveCredential = async () => {
    if (!credForm.platform) return;
    const data = await apiCall('/credentials', 'POST', credForm);
    if (data) {
      await loadCredentials();
      setShowCredForm(false);
      setCredForm({ platform: '', accountLabel: '', username: '', password: '', apiKey: '', apiSecret: '', assignedAgents: [], notes: '' });
    }
  };

  const deleteCredential = async (id) => {
    if (!confirm('Delete this credential? This action cannot be undone.')) return;
    await apiCall(`/credentials/${id}`, 'DELETE');
    await loadCredentials();
  };

  const currentAgent = AGENTS.find(a => a.id === selectedAgent) || AGENTS[0];
  const currentPersona = useMemo(() => {
    if (selectedAgent === 'all') return getAgentPersona('runtime');
    return getAgentPersona(selectedAgent);
  }, [selectedAgent]);
  const currentTheme = getAgentTheme(currentPersona.color);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <MessageSquare className="w-16 h-16 text-purple-400 animate-pulse mx-auto mb-4" />
          <p className="text-gray-400 text-lg">Opening communication channel...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-indigo-700 rounded-xl flex items-center justify-center">
              <MessageSquare className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-indigo-300 bg-clip-text text-transparent">AGENT COMMAND CENTER</h1>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" /> Claude + Gemini
                </span>
                <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  <Heart className="w-2.5 h-2.5" /> Heartbeat
                </span>
                <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  <Database className="w-2.5 h-2.5" /> Memory
                </span>
                <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" title="Brain Stem — Continuous Run Loop (from OpenClaw/Lobster)">
                  <Cpu className="w-2.5 h-2.5" /> Brain Stem
                </span>
                <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20" title="Nervous System — Event Bus (from OpenClaw/ClawHub)">
                  <Network className="w-2.5 h-2.5" /> Nervous System
                </span>
                <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-pink-500/10 text-pink-400 border border-pink-500/20" title="Reflexes — Dynamic Skill Discovery (from OpenClaw/Skills)">
                  <Hand className="w-2.5 h-2.5" /> Reflexes
                </span>
                <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20" title="Goal Engine — Daily/Weekly/Monthly/Yearly/Infinite Forecasts">
                  <Target className="w-2.5 h-2.5" /> Goals
                </span>
                <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20" title="Nerve Bridge — Real app events → Agent reactions">
                  <Sparkles className="w-2.5 h-2.5" /> Nerve Bridge
                </span>
                <span className="text-[10px] text-gray-500">{AGENTS.length - 1} agents online</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-end">
            <button
              onClick={() => voice.setEnabled(!voice.enabled)}
              className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                voice.enabled
                  ? `bg-white/5 ${currentTheme.border} ${currentTheme.text}`
                  : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
              }`}
              title="Toggle agent voice playback (browser speech synthesis)"
            >
              {voice.enabled ? 'Voice: ON' : 'Voice: OFF'}
            </button>
            <button onClick={summonAll} disabled={sending}
              className="px-4 py-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 rounded-lg text-sm font-bold flex items-center gap-2 disabled:opacity-50 mr-3 shadow-lg shadow-amber-900/20">
              <Users className="w-4 h-4" /> {sending ? 'Summoning...' : 'Summon Council'}
            </button>
            <div className="flex flex-wrap gap-2 items-center sm:justify-end max-w-full">
              {[
                { id: 'chat', label: 'Chat', icon: MessageSquare },
                { id: 'goals', label: 'Goals & Forecast', icon: Target },
                { id: 'credentials', label: 'Credentials Vault', icon: Key },
                { id: 'uploads', label: 'Uploads', icon: FileText },
                { id: 'github', label: 'GitHub', icon: GitBranch },
                { id: 'results', label: 'Results', icon: BarChart3 },
              ].map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-2 text-sm font-medium rounded-lg flex items-center gap-2 ${
                    activeTab === tab.id ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
                  <tab.icon className="w-4 h-4" /> {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* UPLOADS TAB */}
      {activeTab === 'uploads' && (
        <div className="p-6 max-w-[1400px] mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2"><FileText className="w-6 h-6 text-cyan-400" /> Uploads for Analysis</h2>
              <p className="text-sm text-gray-400 mt-1">Upload PDFs / text docs to attach to a chat message. Images are stored; OCR requires an OCR provider.</p>
            </div>
            <label className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium cursor-pointer">
              {uploading ? 'Uploading…' : 'Upload Files'}
              <input
                type="file"
                multiple
                className="hidden"
                accept=".pdf,.txt,.md,.json,image/*"
                onChange={(e) => onUploadFiles(e.target.files)}
              />
            </label>
          </div>

          <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
            <div className="p-4 border-b border-gray-800 flex items-center justify-between">
              <div className="text-sm text-gray-300">
                Selected for next message: <span className="font-mono">{attachmentIds.length}</span>
              </div>
              <button
                type="button"
                className="text-xs px-3 py-1.5 rounded bg-gray-800 border border-gray-700 text-gray-200 hover:bg-gray-700 disabled:opacity-50"
                onClick={() => setAttachmentIds([])}
                disabled={attachmentIds.length === 0}
              >
                Clear
              </button>
            </div>

            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              {(uploads || []).length === 0 ? (
                <div className="text-gray-500 text-sm p-6">No uploads yet.</div>
              ) : (uploads || []).map((u) => {
                const selected = attachmentIds.includes(u.id);
                return (
                  <div key={u.id} className={`rounded-xl border p-4 ${selected ? 'border-purple-500/40 bg-purple-600/10' : 'border-gray-800 bg-gray-950/40'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        className="text-left min-w-0"
                        onClick={() => setAttachmentIds((prev) => selected ? prev.filter((x) => x !== u.id) : [...prev, u.id])}
                        title="Click to (de)select for next message"
                      >
                        <div className="text-sm text-white font-medium truncate">{u.original_name}</div>
                        <div className="text-xs text-gray-500 truncate">
                          {u.mime_type} · {(Number(u.size_bytes || 0) / 1024 / 1024).toFixed(1)} MB
                        </div>
                        <div className="mt-2 text-[10px] font-mono inline-flex items-center px-2 py-1 rounded bg-white/5 border border-white/10 text-gray-300">
                          extraction: {u.extraction_status || 'pending'}
                        </div>
                      </button>

                      <button
                        type="button"
                        className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 hover:bg-gray-700 text-xs"
                        onClick={() => downloadUpload(u)}
                        title="Download"
                      >
                        <ArrowUpRight className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="mt-3 text-xs text-gray-400">
                      {selected ? 'Selected (will be included in next message)' : 'Click the card to select for next message'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* GITHUB TAB */}
      {activeTab === 'github' && (
        <div className="p-6 max-w-[1100px] mx-auto">
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2"><GitBranch className="w-6 h-6 text-emerald-400" /> GitHub Connect</h2>
                <p className="text-sm text-gray-400 mt-1">Store a GitHub PAT in Credential Vault: platform GitHub → API Key.</p>
              </div>
              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 hover:bg-gray-700 text-sm font-medium"
                onClick={loadGithubStatus}
              >
                Test Connection
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-gray-800 bg-gray-950/40 p-4 text-sm">
              {githubStatus?.login ? (
                <div className="text-gray-200">
                  Connected as <span className="font-mono">{githubStatus.login}</span>
                  {githubStatus.url ? <div className="text-xs text-gray-500 mt-1">{githubStatus.url}</div> : null}
                </div>
              ) : (
                <div className="text-gray-400">
                  Not connected yet. Add a GitHub token in the Credential Vault (platform: GitHub) and click “Test Connection”.
                </div>
              )}
            </div>

            <div className="mt-4 text-sm text-gray-300">
              Chat commands:
              <pre className="mt-2 text-xs font-mono bg-black/30 border border-gray-800 rounded-xl p-3 text-gray-300 whitespace-pre-wrap">
{`/github status
/github repos <owner>
/github issues <owner>/<repo>
/github file <owner>/<repo> <path>
/api get https://api.github.com/repos/openclaw/openclaw`}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* CHAT TAB */}
      {activeTab === 'chat' && (
        <div className="flex h-[calc(100vh-140px)]">
          {/* Agent Sidebar */}
          <div className="w-64 bg-gray-900/70 border-r border-gray-800 overflow-y-auto">
            <div className="p-3">
              <p className="text-xs text-gray-500 uppercase font-medium mb-2 px-2">Select Agent</p>
              {AGENTS.map(agent => {
                const AgentIcon = agent.icon;
                const persona = agent.id === 'all' ? getAgentPersona('runtime') : getAgentPersona(agent.id);
                const isSpeaking = agent.id !== 'all' && typingAgentIds.has(normalizeAgentId(agent.id));
                return (
                  <button key={agent.id} onClick={() => setSelectedAgent(agent.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 text-left transition-colors ${
                      selectedAgent === agent.id ? 'bg-purple-600/20 border border-purple-500/30' : 'hover:bg-gray-800/50'}`}>
                    <div className="shrink-0">
                      {agent.id === 'all' ? (
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center">
                          <AgentIcon className="w-4 h-4 text-white" />
                        </div>
                      ) : (
                        <HolographicAvatar persona={persona} size="sm" isSpeaking={isSpeaking} online />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${selectedAgent === agent.id ? 'text-white' : 'text-gray-300'}`}>
                        {agent.id === 'all' ? 'Broadcast' : persona.name}
                      </p>
                      <p className="text-xs text-gray-500 truncate">{agent.id === 'all' ? 'All agents' : persona.role}</p>
                    </div>
                    {agent.id !== 'all' && <span className="w-2 h-2 rounded-full bg-emerald-400" title="Online" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Chat Area */}
          <div className="flex-1 flex flex-col">
            {/* Chat Header */}
            <div className="bg-gray-900/50 border-b border-gray-800 px-6 py-3 flex items-center gap-3">
              {selectedAgent === 'all' ? (
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center">
                  <currentAgent.icon className="w-5 h-5 text-white" />
                </div>
              ) : (
                <HolographicAvatar
                  persona={currentPersona}
                  size="md"
                  isSpeaking={typingAgentIds.has(normalizeAgentId(selectedAgent))}
                  online
                />
              )}
              <div>
                <h2 className="font-medium">{selectedAgent === 'all' ? 'Broadcast' : currentPersona.name}</h2>
                <p className="text-xs text-gray-500">
                  {selectedAgent === 'all' ? 'Broadcasting to all agents' : `${currentPersona.role} — Direct Channel`}
                </p>
              </div>
              <span className="ml-auto text-xs text-emerald-400 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Online
              </span>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {attachmentIds.length > 0 && (
                <div className="bg-purple-600/10 border border-purple-500/20 rounded-xl px-4 py-2 text-sm text-purple-200">
                  Next message includes <span className="font-mono">{attachmentIds.length}</span> attachment(s). Manage in the Uploads tab.
                </div>
              )}
              {messages.length === 0 && (
                <div className="text-center py-16">
                  <currentAgent.icon className={`w-16 h-16 ${currentAgent.color} mx-auto mb-4 opacity-30`} />
                  <p className="text-gray-500 text-lg">Start a conversation with {currentAgent.codeName}</p>
                  <p className="text-gray-600 text-sm mt-1 mb-6">Type a message below. Try: "introduce yourself", "status", "what can you do?", or any directive.</p>
                  {selectedAgent === 'all' && (
                    <button onClick={summonAll} disabled={sending}
                      className="px-6 py-3 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 rounded-xl text-sm font-bold flex items-center gap-2 mx-auto shadow-lg shadow-amber-900/30 disabled:opacity-50">
                      <Users className="w-5 h-5" /> Summon The Entire Council
                    </button>
                  )}
                </div>
              )}
              {messages.map((msg, idx) => {
                const isOperator = msg.sender_type === 'operator';
                const isSystem = msg.sender_type === 'system';
                const isAgent = !isOperator && !isSystem;
                const msgAgentId = isAgent ? normalizeAgentId(msg.sender_id) : null;
                const msgPersona = msgAgentId ? getAgentPersona(msgAgentId) : null;
                const msgTheme = msgPersona ? getAgentTheme(msgPersona.color) : null;
                const MsgIcon = Bot;
                const shouldType = isAgent && msg.id && typingIds.has(msg.id);

                // Parse engine metadata + tool call trace
                let engineLabel = null;
                let toolTraceEl = null;
                try {
                  const meta = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata || '{}') : (msg.metadata || {});
                  const eng = meta.engine || '';
                  if (eng.startsWith('agent_loop')) {
                    const isClaudeLoop = eng.includes('claude');
                    engineLabel = (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono flex items-center gap-1 ${isClaudeLoop ? 'bg-purple-500/20 text-purple-300' : 'bg-blue-500/20 text-blue-300'}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse inline-block" />
                        {isClaudeLoop ? 'Claude Agent' : 'Gemini Agent'}
                        {meta.iterations > 0 && <span className="opacity-60 ml-1">{meta.iterations}it</span>}
                      </span>
                    );
                  } else if (eng === 'claude+gemini' || eng === 'claude') {
                    engineLabel = <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 font-mono">Claude AI</span>;
                  } else if (eng === 'gemini' || eng === 'fast') {
                    engineLabel = <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-mono">Gemini AI</span>;
                  } else if (eng === 'medical_unit') {
                    engineLabel = <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono">Medical Unit</span>;
                  }
                  // Tool call trace — render below the message bubble
                  const calls = Array.isArray(meta.toolCalls) ? meta.toolCalls : [];
                  if (calls.length > 0) {
                    const TOOL_ICON = { get_platform_stats: '📊', query_patients: '🧑‍⚕️', query_providers: '👨‍⚕️', query_appointments: '📅', query_prescriptions: '💊', query_crm: '📋', create_crm_contact: '➕', query_revenue: '💰', search_web: '🌐', scrape_url: '🔗', medical_consult: '🏥', github_operation: '🐙', log_agent_result: '📝', query_triage: '🚑', list_credentials: '🔑', query_agent_results: '🤖', read_uploaded_file: '📄', list_uploaded_files: '📁', send_platform_notification: '🔔' };
                    toolTraceEl = (
                      <div className="mt-1.5 rounded-lg bg-gray-950/70 border border-gray-800 px-3 py-2 text-[11px] font-mono space-y-0.5">
                        <div className="text-gray-600 text-[10px] uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                          {calls.length} tool call{calls.length !== 1 ? 's' : ''} executed
                        </div>
                        {calls.map((c, i) => {
                          const name = c.tool || c.toolName || 'unknown';
                          const ok = c.success !== false;
                          return (
                            <div key={i} className="flex items-center gap-2">
                              <span>{TOOL_ICON[name] || '⚡'}</span>
                              <span className={ok ? 'text-emerald-300' : 'text-red-400'}>{name}</span>
                              {!ok && <span className="text-red-500 text-[10px] truncate max-w-[200px]">failed</span>}
                            </div>
                          );
                        })}
                      </div>
                    );
                  }
                } catch { /* ignore */ }

                return (
                  <div key={msg.id || idx} className={`flex gap-3 ${isOperator ? 'flex-row-reverse' : ''}`}>
                    {/* Avatar */}
                    <div className="w-9 h-9 flex-shrink-0">
                      {isOperator ? (
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-600 to-orange-600 flex items-center justify-center">
                          <Crown className="w-4 h-4 text-white" />
                        </div>
                      ) : isSystem ? (
                        <div className="w-9 h-9 rounded-xl bg-gray-700 flex items-center justify-center">
                          <Lock className="w-4 h-4 text-gray-300" />
                        </div>
                      ) : msgPersona ? (
                        <HolographicAvatar persona={msgPersona} size="sm" isSpeaking={shouldType} online />
                      ) : (
                        <div className="w-9 h-9 rounded-xl bg-gray-700 flex items-center justify-center">
                          <MsgIcon className="w-4 h-4 text-gray-300" />
                        </div>
                      )}
                    </div>
                    {/* Message */}
                    <div className={`max-w-[70%] ${isOperator ? 'text-right' : ''}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-medium ${
                          isOperator ? 'text-amber-400 ml-auto' : isSystem ? 'text-gray-500' : (msgTheme?.text || 'text-gray-400')
                        }`}>
                          {msg.sender_name || (isOperator ? 'You' : (msgPersona?.name || msg.sender_id))}
                        </span>
                        <span className="text-xs text-gray-600">{new Date(msg.created_at).toLocaleTimeString()}</span>
                        {engineLabel}
                        {isAgent && msgPersona && (
                          <button
                            className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-gray-300 hover:text-white"
                            onClick={() => voice.speak(msg.content, msgPersona)}
                            title="Play voice"
                            type="button"
                          >
                            <Play className="w-3 h-3 inline-block" />
                          </button>
                        )}
                      </div>
                      <div className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${
                        isOperator ? 'bg-purple-600/20 border border-purple-500/20 text-gray-200' :
                        isSystem ? 'bg-gray-800/50 border border-gray-700 text-gray-400 italic' :
                        'bg-gray-800/80 border border-gray-700/50 text-gray-300'}`}>
                        {shouldType ? (
                          <TypingMessage
                            text={msg.content}
                            speed={12}
                            scrollRef={messagesEndRef}
                            onComplete={() => setTypingIds(prev => {
                              const next = new Set(prev);
                              next.delete(msg.id);
                              return next;
                            })}
                          />
                        ) : (
                          <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
                        )}
                      </div>
                      {toolTraceEl}
                    </div>
                  </div>
                );
              })}
              {/* Agent thinking indicator — shows while waiting for response */}
              {sending && (
                <div className="flex gap-3 px-2 py-1">
                  <div className="w-9 h-9 flex-shrink-0">
                    {(() => { const p = getAgentPersona(selectedAgent === 'all' ? 'runtime' : selectedAgent); return <HolographicAvatar persona={p} size="sm" isSpeaking online />; })()}
                  </div>
                  <div className="bg-gray-800/80 border border-gray-700/50 rounded-xl px-4 py-3 text-sm text-gray-400 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                    <span className="text-xs text-gray-500 ml-1">Running tools&hellip;</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-gray-800 px-6 py-4 bg-gray-900/30">
              <div className="flex items-center gap-3">
                <label
                  className="px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-gray-200 hover:bg-gray-700 cursor-pointer text-sm font-medium flex items-center gap-2"
                  title="Upload and attach files for analysis"
                >
                  <FileText className="w-4 h-4" />
                  {attachmentIds.length > 0 ? `Attach (${attachmentIds.length})` : 'Attach'}
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    accept=".pdf,.txt,.md,.json,image/*"
                    onChange={(e) => onUploadFiles(e.target.files)}
                  />
                </label>
                <div className="flex-1 relative">
                  <input ref={inputRef} type="text" value={inputMessage} onChange={e => setInputMessage(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }}}
                    placeholder={`Message ${currentAgent.codeName}...`}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-purple-500 placeholder-gray-500" />
                </div>
                <button onClick={sendMessage} disabled={!inputMessage.trim() || sending}
                  className="px-5 py-3 bg-purple-600 hover:bg-purple-700 rounded-xl font-medium text-sm flex items-center gap-2 disabled:opacity-50 transition-colors">
                  <Send className="w-4 h-4" /> {sending ? 'Sending...' : 'Send'}
                </button>
              </div>
              <p className="text-xs text-gray-600 mt-2">
                {selectedAgent === 'all' ? '📡 Broadcasting to all agents — each will respond' : `💬 Direct channel to ${currentAgent.codeName} (${currentAgent.name})`}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* GOALS & FORECAST TAB */}
      {activeTab === 'goals' && (
        <GoalsDashboard apiCall={apiCall} agents={AGENTS} />
      )}

      {/* CREDENTIALS VAULT TAB */}
      {activeTab === 'credentials' && (
        <div className="p-6 max-w-[1400px] mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2"><Key className="w-6 h-6 text-amber-400" /> Credential Vault</h2>
              <p className="text-sm text-gray-400 mt-1">AES-256-GCM encrypted. Submit platform logins for agents to access the world.</p>
            </div>
            <button onClick={() => setShowCredForm(true)} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Credential
            </button>
          </div>

          {/* Add Credential Form */}
          {showCredForm && (
            <div className="bg-gray-900 border border-purple-800/30 rounded-xl p-6 mb-6">
              <h3 className="font-medium text-lg mb-4 flex items-center gap-2"><Lock className="w-5 h-5 text-purple-400" /> Add New Platform Credential</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Platform *</label>
                  <select value={credForm.platform} onChange={e => setCredForm(f => ({ ...f, platform: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500">
                    <option value="">Select platform...</option>
                    {PLATFORMS.map(p => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Account Label</label>
                  <input type="text" value={credForm.accountLabel} onChange={e => setCredForm(f => ({ ...f, accountLabel: e.target.value }))}
                    placeholder="e.g. DoctaRx Main" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Username / Email</label>
                  <input type="text" value={credForm.username} onChange={e => setCredForm(f => ({ ...f, username: e.target.value }))}
                    placeholder="Username or email" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Password</label>
                  <input type="password" value={credForm.password} onChange={e => setCredForm(f => ({ ...f, password: e.target.value }))}
                    placeholder="••••••••" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">API Key (optional)</label>
                  <input type="password" value={credForm.apiKey} onChange={e => setCredForm(f => ({ ...f, apiKey: e.target.value }))}
                    placeholder="API key" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">API Secret (optional)</label>
                  <input type="password" value={credForm.apiSecret} onChange={e => setCredForm(f => ({ ...f, apiSecret: e.target.value }))}
                    placeholder="API secret" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500" />
                </div>
              </div>
              <div className="mb-4">
                <label className="text-xs text-gray-400 block mb-1">Assign to Agents (select which agents can use this credential)</label>
                <div className="flex flex-wrap gap-2">
                  {AGENTS.filter(a => a.id !== 'all').map(agent => (
                    <button key={agent.id} onClick={() => setCredForm(f => ({
                      ...f,
                      assignedAgents: f.assignedAgents.includes(agent.id)
                        ? f.assignedAgents.filter(a => a !== agent.id)
                        : [...f.assignedAgents, agent.id]
                    }))} className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 border transition-colors ${
                      credForm.assignedAgents.includes(agent.id)
                        ? 'border-purple-500 bg-purple-900/30 text-purple-300'
                        : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600'}`}>
                      <agent.icon className={`w-3 h-3 ${credForm.assignedAgents.includes(agent.id) ? agent.color : 'text-gray-500'}`} />
                      {agent.codeName}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mb-4">
                <label className="text-xs text-gray-400 block mb-1">Notes</label>
                <textarea value={credForm.notes} onChange={e => setCredForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Any notes about this credential..." rows={2}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500" />
              </div>
              <div className="flex items-center gap-3">
                <button onClick={saveCredential} className="px-5 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium flex items-center gap-2">
                  <Lock className="w-4 h-4" /> Encrypt & Save
                </button>
                <button onClick={() => setShowCredForm(false)} className="px-5 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium">Cancel</button>
                <p className="text-xs text-gray-500 ml-4">🔐 All credentials encrypted with AES-256-GCM before storage. Never stored in plaintext.</p>
              </div>
            </div>
          )}

          {/* Credential List */}
          <div className="space-y-3">
            {credentials.length === 0 ? (
              <div className="bg-gray-900 rounded-xl p-12 text-center border border-gray-800">
                <Key className="w-16 h-16 text-gray-700 mx-auto mb-4" />
                <p className="text-gray-400 text-lg">No credentials stored yet</p>
                <p className="text-gray-600 text-sm mt-2">Add platform credentials so agents can interact with the world.</p>
              </div>
            ) : credentials.map(cred => {
              const platform = PLATFORMS.find(p => p.id === cred.platform);
              return (
                <div key={cred.id} className="bg-gray-900 rounded-xl p-5 border border-gray-800 hover:border-gray-700 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="text-3xl">{platform?.icon || '🔧'}</div>
                      <div>
                        <h3 className="font-medium">{cred.platform_display_name}</h3>
                        <p className="text-sm text-gray-400">{cred.account_label}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right text-xs text-gray-500">
                        <div className="flex items-center gap-2 mb-1">
                          {cred.has_username && <span className="px-2 py-0.5 bg-gray-800 rounded">Username</span>}
                          {cred.has_password && <span className="px-2 py-0.5 bg-gray-800 rounded">Password</span>}
                          {cred.has_api_key && <span className="px-2 py-0.5 bg-gray-800 rounded">API Key</span>}
                          {cred.has_api_secret && <span className="px-2 py-0.5 bg-gray-800 rounded">API Secret</span>}
                        </div>
                        <span>Added {new Date(cred.created_at).toLocaleDateString()}</span>
                      </div>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        cred.status === 'active' ? 'bg-emerald-900/40 text-emerald-300' :
                        cred.status === 'expired' ? 'bg-red-900/40 text-red-300' : 'bg-gray-800 text-gray-400'}`}>
                        {cred.status.toUpperCase()}
                      </span>
                      <button onClick={() => deleteCredential(cred.id)} className="p-2 hover:bg-red-900/30 rounded-lg text-red-400" title="Delete">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {cred.assigned_agents?.length > 0 && (
                    <div className="mt-3 flex items-center gap-2">
                      <span className="text-xs text-gray-500">Assigned:</span>
                      {cred.assigned_agents.map(agentId => {
                        const a = AGENTS.find(ag => ag.id === agentId);
                        return a ? <span key={agentId} className={`text-xs px-2 py-0.5 rounded ${a.bg} ${a.color}`}>{a.codeName}</span> : null;
                      })}
                    </div>
                  )}
                  {cred.notes && <p className="mt-2 text-xs text-gray-500">{cred.notes}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* RESULTS TAB */}
      {activeTab === 'results' && (
        <div className="p-6 max-w-[1400px] mx-auto">
          <div className="mb-6">
            <h2 className="text-xl font-bold flex items-center gap-2"><BarChart3 className="w-6 h-6 text-emerald-400" /> Agent Results — Tangible &amp; Measurable</h2>
            <p className="text-sm text-gray-400 mt-1">No black boxes. Every action produces a measurable result. Every result is logged here.</p>
          </div>

          {/* Results summary cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
              <div className="flex items-center gap-2 mb-2"><BarChart3 className="w-4 h-4 text-emerald-400" /><span className="text-sm text-gray-400">Total Results</span></div>
              <p className="text-3xl font-bold">{results.length}</p>
            </div>
            <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
              <div className="flex items-center gap-2 mb-2"><Check className="w-4 h-4 text-green-400" /><span className="text-sm text-gray-400">Verified</span></div>
              <p className="text-3xl font-bold text-green-400">{results.filter(r => r.status === 'verified').length}</p>
            </div>
            <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
              <div className="flex items-center gap-2 mb-2"><Globe className="w-4 h-4 text-blue-400" /><span className="text-sm text-gray-400">Accounts Created</span></div>
              <p className="text-3xl font-bold text-blue-400">{results.filter(r => r.result_type === 'account_created').length}</p>
            </div>
            <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
              <div className="flex items-center gap-2 mb-2"><TrendingUp className="w-4 h-4 text-purple-400" /><span className="text-sm text-gray-400">Active Agents</span></div>
              <p className="text-3xl font-bold text-purple-400">{new Set(results.map(r => r.agent_type)).size}</p>
            </div>
          </div>

          {/* Results List */}
          <div className="space-y-3">
            {results.length === 0 ? (
              <div className="bg-gray-900 rounded-xl p-12 text-center border border-gray-800">
                <BarChart3 className="w-16 h-16 text-gray-700 mx-auto mb-4" />
                <p className="text-gray-400 text-lg">No results reported yet</p>
                <p className="text-gray-600 text-sm mt-2">Run agents and interact with them to generate measurable results.</p>
              </div>
            ) : results.map(result => {
              const agent = AGENTS.find(a => a.id === result.agent_type);
              const AgentIcon = agent?.icon || Bot;
              return (
                <div key={result.id} className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${agent?.bg || 'bg-gray-800'}`}>
                        <AgentIcon className={`w-4 h-4 ${agent?.color || 'text-gray-400'}`} />
                      </div>
                      <div>
                        <h3 className="font-medium text-sm">{result.title}</h3>
                        <p className="text-xs text-gray-500">{result.agent_name} — {result.result_type.replace(/_/g, ' ')}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        result.status === 'verified' ? 'bg-green-900/40 text-green-300' :
                        result.status === 'disputed' ? 'bg-red-900/40 text-red-300' : 'bg-gray-800 text-gray-300'}`}>
                        {result.status}
                      </span>
                      <span className="text-xs text-gray-500">{new Date(result.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  {result.description && <p className="text-sm text-gray-400 mb-2">{result.description}</p>}
                  {result.metrics && Object.keys(typeof result.metrics === 'string' ? JSON.parse(result.metrics) : result.metrics).length > 0 && (
                    <div className="flex gap-3 flex-wrap">
                      {Object.entries(typeof result.metrics === 'string' ? JSON.parse(result.metrics) : result.metrics).map(([key, val]) => (
                        <span key={key} className="text-xs bg-gray-800 px-2 py-1 rounded">
                          {key.replace(/_/g, ' ')}: <span className="font-medium text-emerald-300">{typeof val === 'number' ? val.toLocaleString() : val}</span>
                        </span>
                      ))}
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

// ═══════════════════════════════════════════════════════════════
//  GOALS & FORECAST DASHBOARD COMPONENT
// ═══════════════════════════════════════════════════════════════
function GoalsDashboard({ apiCall, agents }) {
  const [ceoDash, setCeoDash] = useState(null);
  const [milestones, setMilestones] = useState([]);
  const [selectedTimeframe, setSelectedTimeframe] = useState('monthly');
  const [loading, setLoading] = useState(true);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';
  const getToken = () => typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

  const opsApiCall = useCallback(async (endpoint, method = 'GET', body = null) => {
    const token = getToken();
    const options = {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    };
    if (body) options.body = JSON.stringify(body);
    try {
      const res = await fetch(`${API_URL}/agent-ops${endpoint}`, options);
      const data = await res.json();
      if (!data.success) return null;
      return data.data;
    } catch (err) { return null; }
  }, [API_URL]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [ceo, ms] = await Promise.all([
        opsApiCall('/ceo-dashboard'),
        opsApiCall('/milestones')
      ]);
      if (ceo) setCeoDash(ceo);
      if (ms) setMilestones(ms);
      setLoading(false);
    };
    load();
  }, [opsApiCall]);

  const TIMEFRAMES = ['daily', 'weekly', 'monthly', 'yearly', 'infinite'];
  const TF_LABELS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly', infinite: 'Infinite' };
  const TF_COLORS = { daily: 'text-blue-400', weekly: 'text-cyan-400', monthly: 'text-emerald-400', yearly: 'text-amber-400', infinite: 'text-purple-400' };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-16">
        <Target className="w-12 h-12 text-purple-400 animate-pulse" />
        <p className="ml-4 text-gray-400">Loading goals & forecasts...</p>
      </div>
    );
  }

  const summary = ceoDash?.summary || [];
  const agentProgress = ceoDash?.agentProgress || [];
  const frequency = ceoDash?.frequency || {};
  const currentTF = summary.find(s => s.timeframe === selectedTimeframe);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Target className="w-6 h-6 text-amber-400" /> Goals &amp; Infinite Forecast
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            Every agent sets goals. Milestones measured in $ and energy. Frequency: {frequency.currentHum || 432}Hz
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4 text-purple-400" />
          <span className="text-xs text-gray-500">Harmonic: {frequency.harmonicMaster || 369}</span>
          <span className="text-xs text-gray-600 mx-2">|</span>
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span className="text-xs text-gray-500">Resonance Threshold: {((frequency.resonanceThreshold || 0.7) * 100).toFixed(0)}%</span>
        </div>
      </div>

      {/* Timeframe Selector */}
      <div className="flex gap-2 mb-6">
        {TIMEFRAMES.map(tf => (
          <button key={tf} onClick={() => setSelectedTimeframe(tf)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              selectedTimeframe === tf
                ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/30'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-300'}`}>
            {TF_LABELS[tf]}
          </button>
        ))}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
          <div className="flex items-center gap-2 mb-2"><DollarSign className="w-4 h-4 text-emerald-400" /><span className="text-xs text-gray-400">Revenue Target</span></div>
          <p className="text-2xl font-bold text-emerald-400">${Number(currentTF?.total_revenue_target || 0).toLocaleString()}</p>
          <p className="text-xs text-gray-500 mt-1">Actual: ${Number(currentTF?.total_revenue_actual || 0).toLocaleString()}</p>
        </div>
        <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
          <div className="flex items-center gap-2 mb-2"><ArrowUpRight className="w-4 h-4 text-blue-400" /><span className="text-xs text-gray-400">Savings Target</span></div>
          <p className="text-2xl font-bold text-blue-400">${Number(currentTF?.total_savings_target || 0).toLocaleString()}</p>
          <p className="text-xs text-gray-500 mt-1">Actual: ${Number(currentTF?.total_savings_actual || 0).toLocaleString()}</p>
        </div>
        <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
          <div className="flex items-center gap-2 mb-2"><Gauge className="w-4 h-4 text-amber-400" /><span className="text-xs text-gray-400">Avg Efficiency</span></div>
          <p className="text-2xl font-bold text-amber-400">{Number(currentTF?.avg_efficiency || 0).toFixed(0)}%</p>
        </div>
        <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
          <div className="flex items-center gap-2 mb-2"><Zap className="w-4 h-4 text-yellow-400" /><span className="text-xs text-gray-400">Avg Velocity</span></div>
          <p className="text-2xl font-bold text-yellow-400">{Number(currentTF?.avg_velocity || 0).toFixed(0)}%</p>
        </div>
        <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
          <div className="flex items-center gap-2 mb-2"><Sparkles className="w-4 h-4 text-purple-400" /><span className="text-xs text-gray-400">Harmonic Alignment</span></div>
          <p className="text-2xl font-bold text-purple-400">{((Number(currentTF?.avg_harmonic || 0)) * 100).toFixed(0)}%</p>
          <p className="text-xs text-gray-500 mt-1">Resonance: {Number(currentTF?.avg_resonance || 0).toFixed(2)}</p>
        </div>
      </div>

      {/* Agent Progress Grid */}
      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <Activity className="w-5 h-5 text-blue-400" />
        Agent {TF_LABELS[selectedTimeframe]} Goals
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {agentProgress
          .filter(ap => ap.timeframe === selectedTimeframe)
          .map(ap => {
            const agent = agents.find(a => a.id === ap.agent_id);
            const AgentIcon = agent?.icon || Target;
            const revPct = ap.revenue_target > 0 ? Math.min(100, (ap.revenue_actual / ap.revenue_target * 100)) : 0;
            const effPct = ap.efficiency_target > 0 ? Math.min(100, (ap.efficiency_actual / ap.efficiency_target * 100)) : 0;
            const harmonic = Number(ap.harmonic_alignment || 0);

            return (
              <div key={ap.agent_id + ap.timeframe} className="bg-gray-900 rounded-xl p-5 border border-gray-800 hover:border-gray-700 transition-colors">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${agent?.bg || 'bg-gray-800'}`}>
                    <AgentIcon className={`w-4 h-4 ${agent?.color || 'text-gray-400'}`} />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-sm font-medium">{ap.agent_name}</h4>
                    <p className="text-xs text-gray-500">{agent?.codeName || ap.agent_id}</p>
                  </div>
                  <div className={`px-2 py-0.5 rounded text-xs font-medium ${
                    harmonic >= 0.7 ? 'bg-emerald-900/40 text-emerald-300' :
                    harmonic >= 0.4 ? 'bg-amber-900/40 text-amber-300' : 'bg-red-900/40 text-red-300'}`}>
                    {(harmonic * 100).toFixed(0)}% aligned
                  </div>
                </div>
                {ap.revenue_target > 0 && (
                  <div className="mb-2">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-400">Revenue</span>
                      <span className="text-emerald-400">${Number(ap.revenue_actual || 0).toLocaleString()} / ${Number(ap.revenue_target).toLocaleString()}</span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-1.5">
                      <div className="bg-emerald-500 rounded-full h-1.5 transition-all" style={{ width: `${revPct}%` }} />
                    </div>
                  </div>
                )}
                {ap.efficiency_target > 0 && (
                  <div className="mb-2">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-400">Efficiency</span>
                      <span className="text-blue-400">{ap.efficiency_actual || 0}% / {ap.efficiency_target}%</span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-1.5">
                      <div className="bg-blue-500 rounded-full h-1.5 transition-all" style={{ width: `${effPct}%` }} />
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
                  <span>Resonance: {Number(ap.resonance_score || 0).toFixed(2)}</span>
                  <span className={`${ap.status === 'exceeded' ? 'text-emerald-400' : ap.status === 'active' ? 'text-blue-400' : 'text-gray-400'}`}>{ap.status?.toUpperCase()}</span>
                </div>
              </div>
            );
          })}
        {agentProgress.filter(ap => ap.timeframe === selectedTimeframe).length === 0 && (
          <div className="col-span-3 bg-gray-900 rounded-xl p-12 text-center border border-gray-800">
            <Target className="w-16 h-16 text-gray-700 mx-auto mb-4" />
            <p className="text-gray-400 text-lg">Goals initializing...</p>
            <p className="text-gray-600 text-sm mt-2">Agent goals are set during initialization. Restart the server to populate.</p>
          </div>
        )}
      </div>

      {/* Milestones */}
      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-amber-400" />
        Milestones — Path to Infinite Wins
      </h3>
      <div className="space-y-3">
        {milestones.length === 0 ? (
          <div className="bg-gray-900 rounded-xl p-8 text-center border border-gray-800">
            <DollarSign className="w-12 h-12 text-gray-700 mx-auto mb-3" />
            <p className="text-gray-400">No milestones yet. They emerge as agents execute goals.</p>
          </div>
        ) : milestones.map(ms => (
          <div key={ms.id} className="bg-gray-900 rounded-xl p-5 border border-gray-800 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              ms.status === 'achieved' ? 'bg-emerald-900/40' : ms.status === 'in_progress' ? 'bg-blue-900/40' : 'bg-gray-800'}`}>
              {ms.status === 'achieved' ? <Check className="w-5 h-5 text-emerald-400" /> : <Target className="w-5 h-5 text-blue-400" />}
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-medium">{ms.title}</h4>
              {ms.description && <p className="text-xs text-gray-500 mt-0.5">{ms.description}</p>}
            </div>
            <div className="text-right text-xs">
              <p className="text-emerald-400 font-medium">${Number(ms.dollars_value || 0).toLocaleString()}</p>
              <p className="text-yellow-400">{ms.energy_value || 0} energy</p>
              <p className="text-purple-400">{ms.frequency_reading || 432}Hz</p>
            </div>
            <span className={`px-2 py-1 rounded text-xs font-medium ${
              ms.status === 'achieved' ? 'bg-emerald-900/40 text-emerald-300' :
              ms.status === 'in_progress' ? 'bg-blue-900/40 text-blue-300' : 'bg-gray-800 text-gray-400'}`}>
              {ms.status?.toUpperCase()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
