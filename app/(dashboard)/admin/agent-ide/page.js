'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Code2, FolderTree, Terminal, Bot, Play, Save, FileText, Search,
  ChevronRight, ChevronDown, File, Folder, FolderOpen, X, Plus,
  RotateCcw, Wand2, Bug, Shield, Zap, GitBranch, Settings, Eye,
  Copy, Download, Trash2, RefreshCw, Send, AlertTriangle, CheckCircle2,
  Braces, Database, Globe, Layers, ArrowRight, Sparkles, Cpu,
  FilePlus, PanelLeft, PanelBottom, Maximize2, Minimize2
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

// ═══════════════════════════════════════════════════════════════
// TOKEN & API
// ═══════════════════════════════════════════════════════════════

const getToken = () => typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

async function api(endpoint, options = {}) {
  try {
    const token = getToken();
    const res = await fetch(`${API_URL}/agent-ide${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
      }
    });
    return await res.json();
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// SYNTAX HIGHLIGHTER (lightweight, no deps)
// ═══════════════════════════════════════════════════════════════

const KEYWORDS_JS = /\b(const|let|var|function|async|await|return|if|else|for|while|do|switch|case|break|continue|new|this|class|extends|import|export|from|default|try|catch|finally|throw|typeof|instanceof|in|of|yield|delete|void|null|undefined|true|false|require|module)\b/g;
const STRINGS = /(["'`])(?:(?=(\\?))\2.)*?\1/g;
const COMMENTS_SINGLE = /\/\/.*/g;
const COMMENTS_MULTI = /\/\*[\s\S]*?\*\//g;
const NUMBERS = /\b\d+\.?\d*\b/g;
const FUNCTIONS = /\b([a-zA-Z_$][\w$]*)\s*\(/g;

function highlightJS(code) {
  if (!code) return '';
  let html = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  
  // Order matters — comments last to override
  html = html.replace(STRINGS, '<span class="text-amber-300">$&</span>');
  html = html.replace(NUMBERS, '<span class="text-purple-300">$&</span>');
  html = html.replace(FUNCTIONS, '<span class="text-blue-300">$1</span>(');
  html = html.replace(KEYWORDS_JS, '<span class="text-pink-400">$&</span>');
  html = html.replace(COMMENTS_SINGLE, '<span class="text-gray-500 italic">$&</span>');
  html = html.replace(COMMENTS_MULTI, '<span class="text-gray-500 italic">$&</span>');
  return html;
}

// ═══════════════════════════════════════════════════════════════
// FILE TREE COMPONENT
// ═══════════════════════════════════════════════════════════════

function FileTreeNode({ node, depth = 0, onSelect, selectedPath }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const isDir = node.type === 'directory';
  const isSelected = node.path === selectedPath;
  
  const iconClass = "w-3.5 h-3.5 flex-shrink-0";
  const getFileIcon = () => {
    const ext = node.ext || '';
    if (['.js', '.jsx'].includes(ext)) return <Braces className={`${iconClass} text-yellow-400`} />;
    if (['.ts', '.tsx'].includes(ext)) return <Braces className={`${iconClass} text-blue-400`} />;
    if (['.json'].includes(ext)) return <Braces className={`${iconClass} text-green-400`} />;
    if (['.sql'].includes(ext)) return <Database className={`${iconClass} text-orange-400`} />;
    if (['.css'].includes(ext)) return <Globe className={`${iconClass} text-purple-400`} />;
    if (['.md'].includes(ext)) return <FileText className={`${iconClass} text-gray-400`} />;
    return <File className={`${iconClass} text-gray-500`} />;
  };

  return (
    <div>
      <div
        onClick={() => {
          if (isDir) setExpanded(!expanded);
          else onSelect(node.path);
        }}
        className={`flex items-center gap-1 py-0.5 px-1 rounded cursor-pointer text-xs hover:bg-gray-800 ${
          isSelected ? 'bg-indigo-900/40 text-indigo-300' : 'text-gray-400'
        }`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {isDir ? (
          <>
            {expanded ? <ChevronDown className="w-3 h-3 text-gray-500" /> : <ChevronRight className="w-3 h-3 text-gray-500" />}
            {expanded ? <FolderOpen className={`${iconClass} text-amber-400`} /> : <Folder className={`${iconClass} text-amber-500`} />}
          </>
        ) : (
          <>
            <span className="w-3" />
            {getFileIcon()}
          </>
        )}
        <span className="truncate ml-1">{node.name}</span>
        {isDir && node.childCount > 0 && (
          <span className="text-[9px] text-gray-600 ml-auto">{node.childCount}</span>
        )}
      </div>
      {isDir && expanded && node.children?.map((child, i) => (
        <FileTreeNode key={i} node={child} depth={depth + 1} onSelect={onSelect} selectedPath={selectedPath} />
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN IDE PAGE
// ═══════════════════════════════════════════════════════════════

export default function AgentIdePage() {
  // State
  const [fileTree, setFileTree] = useState([]);
  const [openTabs, setOpenTabs] = useState([]);
  const [activeFile, setActiveFile] = useState(null);
  const [fileContents, setFileContents] = useState({});
  const [modifiedFiles, setModifiedFiles] = useState(new Set());
  const [terminalOutput, setTerminalOutput] = useState([{ type: 'system', text: '🤖 DoctaRx Agent IDE — Terminal Ready\nType commands or let the AI agent write code for you.\n' }]);
  const [terminalInput, setTerminalInput] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResponse, setAiResponse] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [projectStats, setProjectStats] = useState(null);
  const [gitInfo, setGitInfo] = useState(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showTerminal, setShowTerminal] = useState(true);
  const [activePanel, setActivePanel] = useState('files'); // files, search, ai, git
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loading, setLoading] = useState(true);

  const editorRef = useRef(null);
  const terminalRef = useRef(null);

  // Load initial data
  useEffect(() => {
    Promise.all([loadTree(), loadStats(), loadGit()]).then(() => setLoading(false));
  }, []);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalOutput]);

  async function loadTree() {
    const res = await api('/tree?depth=4');
    if (res.success) setFileTree(res.data);
  }

  async function loadStats() {
    const res = await api('/stats');
    if (res.success) setProjectStats(res.data);
  }

  async function loadGit() {
    const res = await api('/git/status');
    if (res.success) setGitInfo(res.data);
  }

  async function openFile(filePath) {
    if (fileContents[filePath]) {
      setActiveFile(filePath);
      if (!openTabs.includes(filePath)) setOpenTabs(prev => [...prev, filePath]);
      return;
    }
    const res = await api(`/file?path=${encodeURIComponent(filePath)}`);
    if (res.success) {
      setFileContents(prev => ({ ...prev, [filePath]: res.data.content }));
      setActiveFile(filePath);
      if (!openTabs.includes(filePath)) setOpenTabs(prev => [...prev, filePath]);
    } else {
      addTerminalLine('error', `Failed to open ${filePath}: ${res.error}`);
    }
  }

  function closeTab(filePath) {
    setOpenTabs(prev => prev.filter(t => t !== filePath));
    if (activeFile === filePath) {
      const remaining = openTabs.filter(t => t !== filePath);
      setActiveFile(remaining.length > 0 ? remaining[remaining.length - 1] : null);
    }
    // Keep in fileContents cache
  }

  function updateFileContent(filePath, content) {
    setFileContents(prev => ({ ...prev, [filePath]: content }));
    setModifiedFiles(prev => new Set([...prev, filePath]));
  }

  async function saveFile(filePath) {
    const content = fileContents[filePath];
    if (!content && content !== '') return;
    const res = await api('/file', {
      method: 'PUT',
      body: JSON.stringify({ path: filePath, content })
    });
    if (res.success) {
      setModifiedFiles(prev => { const s = new Set(prev); s.delete(filePath); return s; });
      addTerminalLine('success', `Saved: ${filePath} (${res.data.lines} lines, ${res.data.size} bytes)`);
    } else {
      addTerminalLine('error', `Save failed: ${res.error}`);
    }
  }

  async function runCode() {
    const code = fileContents[activeFile];
    if (!code) return;
    addTerminalLine('system', `▶ Running ${activeFile}...`);
    const lang = activeFile?.endsWith('.sql') ? 'sql' : activeFile?.endsWith('.sh') ? 'shell' : 'javascript';
    const res = await api('/execute', {
      method: 'POST',
      body: JSON.stringify({ code, language: lang })
    });
    if (res.success) {
      const d = res.data;
      if (d.output) addTerminalLine('stdout', d.output);
      if (d.error) addTerminalLine('error', d.error);
      addTerminalLine('system', `Exit: ${d.exitCode} (${d.duration}ms)`);
    }
  }

  async function handleTerminalCommand() {
    if (!terminalInput.trim()) return;
    const cmd = terminalInput.trim();
    addTerminalLine('input', `$ ${cmd}`);
    setTerminalInput('');

    if (cmd.startsWith('ai ')) {
      await handleAiCommand(cmd.slice(3));
      return;
    }

    const res = await api('/execute', {
      method: 'POST',
      body: JSON.stringify({ code: cmd, language: 'shell' })
    });
    if (res.success) {
      if (res.data.output) addTerminalLine('stdout', res.data.output);
      if (res.data.error) addTerminalLine('error', res.data.error);
    }
  }

  async function handleAiCommand(prompt) {
    setAiLoading(true);
    addTerminalLine('system', `🤖 AI Processing: "${prompt}"`);
    const context = { currentFile: activeFile, files: activeFile ? [activeFile] : [] };
    const res = await api('/ai/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt, context })
    });
    setAiLoading(false);
    if (res.success && res.data.code) {
      setAiResponse(res.data);
      addTerminalLine('ai', res.data.code.substring(0, 2000));
    } else {
      addTerminalLine('error', `AI Error: ${res.data?.error || res.error}`);
    }
  }

  async function aiGenerate() {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    const context = { currentFile: activeFile, files: activeFile ? [activeFile] : [] };
    const res = await api('/ai/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt: aiPrompt, context })
    });
    setAiLoading(false);
    if (res.success) {
      setAiResponse(res.data);
    } else {
      setAiResponse({ error: res.error });
    }
  }

  async function aiAnalyze(type) {
    if (!activeFile) return;
    setAiLoading(true);
    const res = await api('/ai/analyze', {
      method: 'POST',
      body: JSON.stringify({ path: activeFile, type })
    });
    setAiLoading(false);
    if (res.success) setAiResponse(res.data);
  }

  async function aiCreateTool() {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    const res = await api('/ai/create-tool', {
      method: 'POST',
      body: JSON.stringify({ description: aiPrompt })
    });
    setAiLoading(false);
    if (res.success) setAiResponse(res.data);
  }

  function applyAiCode() {
    if (!aiResponse?.code || !activeFile) return;
    // Extract code from markdown code blocks if present
    let code = aiResponse.code;
    const codeBlockMatch = code.match(/```[\w]*\n([\s\S]*?)```/);
    if (codeBlockMatch) code = codeBlockMatch[1];
    updateFileContent(activeFile, code);
    addTerminalLine('success', 'AI code applied to editor. Review and save when ready.');
  }

  async function runSearch() {
    if (!searchQuery.trim()) return;
    const res = await api(`/search?q=${encodeURIComponent(searchQuery)}`);
    if (res.success) setSearchResults(res.data);
  }

  function addTerminalLine(type, text) {
    setTerminalOutput(prev => [...prev.slice(-500), { type, text, time: new Date().toLocaleTimeString() }]);
  }

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (activeFile) saveFile(activeFile);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        setShowTerminal(t => !t);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        setShowSidebar(s => !s);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeFile]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0d1117]">
        <div className="text-center">
          <Code2 className="w-12 h-12 text-indigo-400 animate-pulse mx-auto mb-4" />
          <p className="text-gray-400">Initializing Agent IDE...</p>
        </div>
      </div>
    );
  }

  const currentContent = activeFile ? (fileContents[activeFile] || '') : '';
  const isModified = activeFile ? modifiedFiles.has(activeFile) : false;
  const fileExt = activeFile ? activeFile.split('.').pop() : '';

  return (
    <div className={`contrast-dark bg-[#0d1117] text-gray-300 flex flex-col ${isFullscreen ? 'fixed inset-0 z-50' : 'min-h-screen'}`}>
      
      {/* ═══ TOP BAR ═══ */}
      <div className="h-10 bg-[#161b22] border-b border-gray-800 flex items-center justify-between px-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <Code2 className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold text-white">DoctaRx Agent IDE</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/50 text-indigo-300 border border-indigo-700/30">v1.0</span>
        </div>
        <div className="flex items-center gap-1">
          {gitInfo && (
            <span className="flex items-center gap-1 text-[10px] text-gray-500 mr-2">
              <GitBranch className="w-3 h-3" /> {gitInfo.branch}
            </span>
          )}
          {projectStats && (
            <span className="text-[10px] text-gray-600 mr-2">
              {projectStats.totalFiles} files &bull; {(projectStats.totalLines || 0).toLocaleString()} lines
            </span>
          )}
          <button onClick={() => setShowSidebar(s => !s)} className="p-1 rounded hover:bg-gray-800" title="Toggle Sidebar (Ctrl+B)">
            <PanelLeft className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setShowTerminal(t => !t)} className="p-1 rounded hover:bg-gray-800" title="Toggle Terminal (Ctrl+`)">
            <PanelBottom className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setIsFullscreen(f => !f)} className="p-1 rounded hover:bg-gray-800">
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        
        {/* ═══ SIDEBAR ═══ */}
        {showSidebar && (
          <div className="w-64 bg-[#0d1117] border-r border-gray-800 flex flex-col flex-shrink-0">
            {/* Sidebar Tabs */}
            <div className="flex border-b border-gray-800">
              {[
                { id: 'files', icon: FolderTree, label: 'Explorer' },
                { id: 'search', icon: Search, label: 'Search' },
                { id: 'ai', icon: Bot, label: 'AI Agent' },
                { id: 'git', icon: GitBranch, label: 'Git' },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActivePanel(tab.id)}
                  className={`flex-1 p-2 flex items-center justify-center ${
                    activePanel === tab.id ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-gray-600 hover:text-gray-400'
                  }`}
                  title={tab.label}
                >
                  <tab.icon className="w-4 h-4" />
                </button>
              ))}
            </div>

            {/* Sidebar Content */}
            <div className="flex-1 overflow-y-auto p-1">
              
              {/* FILES PANEL */}
              {activePanel === 'files' && (
                <div>
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Explorer</span>
                    <button onClick={loadTree} className="p-0.5 rounded hover:bg-gray-800">
                      <RefreshCw className="w-3 h-3 text-gray-500" />
                    </button>
                  </div>
                  {fileTree.map((node, i) => (
                    <FileTreeNode key={i} node={node} onSelect={openFile} selectedPath={activeFile} />
                  ))}
                </div>
              )}

              {/* SEARCH PANEL */}
              {activePanel === 'search' && (
                <div className="p-2 space-y-2">
                  <div className="flex gap-1">
                    <input
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && runSearch()}
                      className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs focus:border-indigo-500 outline-none"
                      placeholder="Search codebase..."
                    />
                    <button onClick={runSearch} className="p-1 rounded bg-indigo-600 hover:bg-indigo-500">
                      <Search className="w-3 h-3" />
                    </button>
                  </div>
                  {searchResults && (
                    <div className="space-y-2 text-xs">
                      <p className="text-gray-500">{searchResults.length} files found</p>
                      {searchResults.map((r, i) => (
                        <div key={i} className="border border-gray-800 rounded p-2">
                          <button onClick={() => openFile(r.file)} className="text-indigo-400 hover:underline text-left w-full truncate">
                            {r.file}
                          </button>
                          <span className="text-gray-600 ml-1">({r.totalMatches} matches)</span>
                          {r.matches.slice(0, 2).map((m, j) => (
                            <div key={j} className="mt-1 bg-gray-900 rounded px-2 py-1 font-mono text-[10px] text-gray-400 truncate">
                              <span className="text-gray-600">L{m.line}</span> {m.content}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* AI PANEL */}
              {activePanel === 'ai' && (
                <div className="p-2 space-y-3">
                  <div className="text-center py-2">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center mx-auto mb-2">
                      <Sparkles className="w-5 h-5 text-white" />
                    </div>
                    <p className="text-xs text-gray-400">AI Engineering Agent</p>
                  </div>
                  
                  <textarea
                    value={aiPrompt}
                    onChange={e => setAiPrompt(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs h-24 resize-none focus:border-indigo-500 outline-none"
                    placeholder="Describe what you need...&#10;e.g., 'Create a rate limiter middleware'&#10;or 'Fix the authentication bug'"
                  />

                  <div className="grid grid-cols-2 gap-1">
                    <button onClick={aiGenerate} disabled={aiLoading} className="flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[10px] bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50">
                      <Wand2 className="w-3 h-3" /> Generate
                    </button>
                    <button onClick={aiCreateTool} disabled={aiLoading} className="flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[10px] bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-50">
                      <Zap className="w-3 h-3" /> Create Tool
                    </button>
                  </div>

                  {activeFile && (
                    <>
                      <p className="text-[10px] text-gray-600 uppercase tracking-wider">Analyze Current File</p>
                      <div className="grid grid-cols-2 gap-1">
                        {[
                          { type: 'review', icon: Eye, label: 'Review' },
                          { type: 'optimize', icon: Zap, label: 'Optimize' },
                          { type: 'security', icon: Shield, label: 'Security' },
                          { type: 'test', icon: Bug, label: 'Tests' },
                          { type: 'refactor', icon: RotateCcw, label: 'Refactor' },
                          { type: 'document', icon: FileText, label: 'Document' },
                        ].map(a => (
                          <button
                            key={a.type}
                            onClick={() => aiAnalyze(a.type)}
                            disabled={aiLoading}
                            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-400 disabled:opacity-50"
                          >
                            <a.icon className="w-2.5 h-2.5" /> {a.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  {aiLoading && (
                    <div className="text-center py-3">
                      <Cpu className="w-5 h-5 text-indigo-400 animate-spin mx-auto" />
                      <p className="text-[10px] text-gray-500 mt-1">AI thinking...</p>
                    </div>
                  )}

                  {aiResponse && !aiLoading && (
                    <div className="space-y-2">
                      {aiResponse.error ? (
                        <div className="p-2 rounded bg-red-900/20 border border-red-700/30 text-xs text-red-400">
                          {aiResponse.error}
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-gray-500">AI Output</span>
                            <div className="flex gap-1">
                              {activeFile && (
                                <button onClick={applyAiCode} className="text-[10px] px-2 py-0.5 rounded bg-green-700 hover:bg-green-600 text-white">
                                  Apply
                                </button>
                              )}
                              <button
                                onClick={() => navigator.clipboard.writeText(aiResponse.code || '')}
                                className="text-[10px] px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300"
                              >
                                Copy
                              </button>
                            </div>
                          </div>
                          <pre className="bg-gray-900 rounded-lg p-2 text-[10px] font-mono overflow-auto max-h-60 border border-gray-800 text-gray-300 whitespace-pre-wrap">
                            {(aiResponse.code || '').substring(0, 5000)}
                          </pre>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* GIT PANEL */}
              {activePanel === 'git' && (
                <div className="p-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Source Control</span>
                    <button onClick={loadGit} className="p-0.5 rounded hover:bg-gray-800">
                      <RefreshCw className="w-3 h-3 text-gray-500" />
                    </button>
                  </div>
                  {gitInfo && (
                    <>
                      <div className="bg-gray-900 rounded p-2 text-xs">
                        <div className="flex items-center gap-1 mb-1">
                          <GitBranch className="w-3 h-3 text-indigo-400" />
                          <span className="text-indigo-300">{gitInfo.branch}</span>
                        </div>
                        <p className="text-gray-500 text-[10px] truncate">{gitInfo.lastCommit}</p>
                      </div>
                      {gitInfo.changes?.length > 0 && (
                        <div>
                          <p className="text-[10px] text-gray-500 mb-1">Changes ({gitInfo.changes.length})</p>
                          {gitInfo.changes.slice(0, 20).map((c, i) => {
                            const status = c.substring(0, 2).trim();
                            const file = c.substring(3);
                            return (
                              <div key={i} className="flex items-center gap-1 py-0.5 text-[10px]">
                                <span className={`w-3 text-center font-mono ${
                                  status === 'M' ? 'text-amber-400' : status === '?' ? 'text-green-400' : status === 'D' ? 'text-red-400' : 'text-gray-400'
                                }`}>{status}</span>
                                <button onClick={() => openFile(file)} className="text-gray-400 hover:text-white truncate">
                                  {file}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ MAIN EDITOR AREA ═══ */}
        <div className="flex-1 flex flex-col overflow-hidden">
          
          {/* Tab Bar */}
          <div className="h-9 bg-[#161b22] border-b border-gray-800 flex items-center overflow-x-auto flex-shrink-0">
            {openTabs.map(tab => (
              <div
                key={tab}
                className={`flex items-center gap-1.5 px-3 h-full border-r border-gray-800 cursor-pointer text-xs group ${
                  tab === activeFile ? 'bg-[#0d1117] text-white' : 'text-gray-500 hover:text-gray-300 bg-[#161b22]'
                }`}
                onClick={() => setActiveFile(tab)}
              >
                {modifiedFiles.has(tab) && <span className="w-2 h-2 rounded-full bg-amber-400" />}
                <span className="truncate max-w-[120px]">{tab.split('/').pop()}</span>
                <button onClick={(e) => { e.stopPropagation(); closeTab(tab); }} className="ml-1 opacity-0 group-hover:opacity-100 hover:text-red-400">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            {openTabs.length === 0 && (
              <div className="px-3 text-xs text-gray-600 italic">No files open — select from Explorer</div>
            )}
          </div>

          {/* Editor + Terminal Split */}
          <div className="flex-1 flex flex-col overflow-hidden">
            
            {/* Editor */}
            <div className="flex-1 overflow-hidden relative">
              {activeFile ? (
                <div className="h-full flex flex-col">
                  {/* Editor Toolbar */}
                  <div className="h-8 bg-[#161b22] border-b border-gray-800 flex items-center justify-between px-3 flex-shrink-0">
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span className="text-indigo-400 font-mono">{activeFile}</span>
                      <span className="text-gray-600">&bull;</span>
                      <span>{fileExt.toUpperCase()}</span>
                      <span className="text-gray-600">&bull;</span>
                      <span>{currentContent.split('\n').length} lines</span>
                      {isModified && <span className="text-amber-400 text-[10px]">MODIFIED</span>}
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => saveFile(activeFile)} disabled={!isModified} className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-400 disabled:opacity-30" title="Save (Ctrl+S)">
                        <Save className="w-3 h-3" /> Save
                      </button>
                      <button onClick={runCode} className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-green-800 hover:bg-green-700 text-green-300" title="Run">
                        <Play className="w-3 h-3" /> Run
                      </button>
                      <button onClick={() => { setActivePanel('ai'); setShowSidebar(true); }} className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-purple-800 hover:bg-purple-700 text-purple-300">
                        <Bot className="w-3 h-3" /> AI
                      </button>
                    </div>
                  </div>

                  {/* Code Editor (textarea with line numbers) */}
                  <div className="flex-1 overflow-auto flex">
                    {/* Line Numbers */}
                    <div className="bg-[#0d1117] text-gray-600 text-right font-mono text-xs py-2 px-2 select-none border-r border-gray-800/50 overflow-hidden flex-shrink-0" style={{ minWidth: '50px' }}>
                      {currentContent.split('\n').map((_, i) => (
                        <div key={i} className="leading-5">{i + 1}</div>
                      ))}
                    </div>
                    {/* Text Area */}
                    <textarea
                      ref={editorRef}
                      value={currentContent}
                      onChange={e => updateFileContent(activeFile, e.target.value)}
                      className="flex-1 bg-[#0d1117] text-gray-300 font-mono text-xs p-2 outline-none resize-none leading-5"
                      spellCheck={false}
                      style={{ tabSize: 2 }}
                    />
                  </div>
                </div>
              ) : (
                /* Welcome Screen */
                <div className="h-full flex items-center justify-center">
                  <div className="text-center max-w-lg">
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-700 flex items-center justify-center mx-auto mb-6 shadow-xl shadow-indigo-900/30">
                      <Code2 className="w-10 h-10 text-white" />
                    </div>
                    <h2 className="text-2xl font-bold text-white mb-2">DoctaRx Agent IDE</h2>
                    <p className="text-gray-500 text-sm mb-6">
                      AI-powered code editor for DoctaRx engineering agents.
                      Write, review, debug, and deploy code with AI assistance.
                    </p>
                    <div className="grid grid-cols-2 gap-3 text-left mb-6">
                      {[
                        { icon: FolderTree, title: 'File Explorer', desc: 'Browse and edit any project file', color: 'text-amber-400' },
                        { icon: Bot, title: 'AI Code Generation', desc: 'Generate code with Gemini AI', color: 'text-purple-400' },
                        { icon: Terminal, title: 'Integrated Terminal', desc: 'Run commands and scripts', color: 'text-green-400' },
                        { icon: Shield, title: 'Security Audits', desc: 'HIPAA compliance scanning', color: 'text-red-400' },
                        { icon: Bug, title: 'Auto Bug Fix', desc: 'AI-powered error resolution', color: 'text-orange-400' },
                        { icon: Zap, title: 'Tool Creator', desc: 'Build new tools and utilities', color: 'text-cyan-400' },
                      ].map((f, i) => (
                        <div key={i} className="bg-gray-900/50 rounded-lg p-3 border border-gray-800/50">
                          <f.icon className={`w-5 h-5 ${f.color} mb-1.5`} />
                          <p className="text-xs font-semibold text-white">{f.title}</p>
                          <p className="text-[10px] text-gray-500">{f.desc}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2 justify-center text-xs">
                      <kbd className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-400">Ctrl+S</kbd>
                      <span className="text-gray-600">Save</span>
                      <kbd className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-400">Ctrl+B</kbd>
                      <span className="text-gray-600">Sidebar</span>
                      <kbd className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-400">Ctrl+`</kbd>
                      <span className="text-gray-600">Terminal</span>
                    </div>

                    {/* Project Stats */}
                    {projectStats && (
                      <div className="mt-6 bg-gray-900/50 rounded-xl border border-gray-800 p-4 text-xs">
                        <h3 className="text-gray-400 font-semibold mb-2">Project Overview</h3>
                        <div className="grid grid-cols-4 gap-3 text-center">
                          <div>
                            <p className="text-lg font-bold text-indigo-400">{projectStats.totalFiles}</p>
                            <p className="text-gray-600">Files</p>
                          </div>
                          <div>
                            <p className="text-lg font-bold text-green-400">{(projectStats.totalLines || 0).toLocaleString()}</p>
                            <p className="text-gray-600">Lines</p>
                          </div>
                          <div>
                            <p className="text-lg font-bold text-purple-400">{projectStats.architecture?.routes?.length || 0}</p>
                            <p className="text-gray-600">API Routes</p>
                          </div>
                          <div>
                            <p className="text-lg font-bold text-amber-400">{projectStats.architecture?.services?.length || 0}</p>
                            <p className="text-gray-600">Services</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ═══ TERMINAL ═══ */}
            {showTerminal && (
              <div className="h-52 bg-[#0d1117] border-t border-gray-800 flex flex-col flex-shrink-0">
                <div className="h-7 bg-[#161b22] border-b border-gray-800 flex items-center justify-between px-3 flex-shrink-0">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 flex items-center gap-1">
                      <Terminal className="w-3 h-3" /> Terminal
                    </span>
                    <span className="text-[10px] text-gray-600">Type &quot;ai [prompt]&quot; for AI commands</span>
                  </div>
                  <button onClick={() => setTerminalOutput([{ type: 'system', text: 'Terminal cleared.\n' }])} className="text-[10px] text-gray-600 hover:text-gray-400">
                    Clear
                  </button>
                </div>
                <div ref={terminalRef} className="flex-1 overflow-y-auto p-2 font-mono text-[11px]">
                  {terminalOutput.map((line, i) => (
                    <div key={i} className={`whitespace-pre-wrap ${
                      line.type === 'error' ? 'text-red-400' :
                      line.type === 'success' ? 'text-green-400' :
                      line.type === 'system' ? 'text-gray-500' :
                      line.type === 'input' ? 'text-cyan-300' :
                      line.type === 'ai' ? 'text-purple-300' :
                      'text-gray-300'
                    }`}>
                      {line.time && <span className="text-gray-700 text-[9px] mr-1">[{line.time}]</span>}
                      {line.text}
                    </div>
                  ))}
                </div>
                <div className="flex items-center border-t border-gray-800 px-2 flex-shrink-0">
                  <span className="text-green-400 text-xs mr-1">$</span>
                  <input
                    value={terminalInput}
                    onChange={e => setTerminalInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleTerminalCommand()}
                    className="flex-1 bg-transparent text-xs text-gray-300 outline-none py-1.5 font-mono"
                    placeholder="Enter command..."
                  />
                  <button onClick={handleTerminalCommand} className="p-1 text-gray-600 hover:text-gray-300">
                    <Send className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
