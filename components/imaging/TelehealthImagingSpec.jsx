'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Server,
  Database,
  Shield,
  Activity,
  Cpu,
  FileText,
  Layout,
  Smartphone,
  Eye,
  Share2,
  Lock,
  GitBranch,
  CheckCircle,
  Menu,
  X,
  Upload,
  Mic,
  Settings,
  User,
  AlertTriangle,
  Brain,
  ZoomIn,
  Move,
  Sun,
  Send,
  ChevronRight,
  ChevronLeft,
  Download,
  Printer,
  Users,
  FilePlus,
  CornerUpRight,
  CheckSquare
} from 'lucide-react';

// --- Content Components ---

const ExecutiveSummary = () => (
  <div className="space-y-6">
    <div className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white p-8 rounded-xl shadow-lg">
      <h1 className="text-3xl font-bold mb-4">Telehealth AI Imaging Platform</h1>
      <p className="text-xl opacity-90">
        A production-ready specification for a HIPAA-compliant, AI-enhanced medical imaging system designed for modern telehealth integrations.
      </p>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
        <div className="flex items-center space-x-3 mb-4 text-blue-600">
          <Activity className="w-6 h-6" />
          <h3 className="font-bold text-lg">High-Performance</h3>
        </div>
        <p className="text-slate-600 text-sm">
          Sub-second image retrieval via edge caching. Real-time AI inference pipeline using NVIDIA Triton. Supports DICOM, NIfTI, and standard image formats.
        </p>
      </div>
      <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
        <div className="flex items-center space-x-3 mb-4 text-purple-600">
          <Brain className="w-6 h-6" />
          <h3 className="font-bold text-lg">MedGemma AI Core</h3>
        </div>
        <p className="text-slate-600 text-sm">
          Powered by <strong>MedGemma 7B/27B</strong> for clinical reasoning. Integrated MONAI for segmentation (UNet) and EfficientNet for classification. Detects 50+ pathologies.
        </p>
      </div>
      <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
        <div className="flex items-center space-x-3 mb-4 text-green-600">
          <Shield className="w-6 h-6" />
          <h3 className="font-bold text-lg">Secure & Compliant</h3>
        </div>
        <p className="text-slate-600 text-sm">
          Zero-trust imaging architecture with automated PHI redaction (pixel + metadata). HIPAA, GDPR, and SOC2-ready controls with audit logging for every pixel access.
        </p>
      </div>
    </div>

    <div className="bg-slate-50 p-6 rounded-xl border border-slate-200">
      <h3 className="text-lg font-bold text-slate-800 mb-4">Core Capabilities Comparison</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left border-collapse">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="p-3 rounded-l-lg border-b border-slate-200">Feature</th>
              <th className="p-3 border-b border-slate-200">Our Platform</th>
              <th className="p-3 border-b border-slate-200">Standard Telehealth</th>
              <th className="p-3 rounded-r-lg border-b border-slate-200">Legacy PACS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            <tr>
              <td className="p-3 font-medium">AI Analysis</td>
              <td className="p-3 text-green-600 font-bold bg-green-50/50">Real-time (MedGemma)</td>
              <td className="p-3 text-slate-500">None / Basic</td>
              <td className="p-3 text-slate-500">Post-processing only</td>
            </tr>
            <tr>
              <td className="p-3 font-medium">Patient Explanation</td>
              <td className="p-3 text-green-600 font-bold bg-green-50/50">MedGemma Plain English</td>
              <td className="p-3 text-slate-500">Manual only</td>
              <td className="p-3 text-slate-500">Technical Jargon</td>
            </tr>
            <tr>
              <td className="p-3 font-medium">Integration</td>
              <td className="p-3 text-green-600 font-bold bg-green-50/50">API-First / Headless</td>
              <td className="p-3 text-slate-500">Native only</td>
              <td className="p-3 text-slate-500">HL7 / Heavy Client</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
);

const ArchitectureDiagram = () => (
  <div className="space-y-8">
    <div className="bg-slate-900 text-white p-6 rounded-xl overflow-x-auto shadow-inner">
      <h3 className="text-xl font-bold mb-6 text-blue-400">System Architecture Diagram</h3>

      <div className="min-w-[800px] flex flex-col space-y-8 relative">
        <div className="flex justify-center space-x-12 relative z-10">
          <div className="bg-slate-800 border-2 border-blue-500 p-4 rounded-lg w-48 text-center shadow-lg transform hover:-translate-y-1 transition-transform">
            <Smartphone className="w-6 h-6 mx-auto mb-2 text-blue-400" />
            <div className="font-bold">Patient App</div>
            <div className="text-xs text-slate-400">React Native</div>
          </div>
          <div className="bg-slate-800 border-2 border-purple-500 p-4 rounded-lg w-48 text-center shadow-lg transform hover:-translate-y-1 transition-transform">
            <Layout className="w-6 h-6 mx-auto mb-2 text-purple-400" />
            <div className="font-bold">Clinician Portal</div>
            <div className="text-xs text-slate-400">Next.js / OHIF Viewer</div>
          </div>
        </div>

        <div className="flex justify-center relative z-10">
          <div className="bg-indigo-900 border border-indigo-500 p-4 rounded-lg w-3/4 text-center shadow-lg">
            <div className="font-bold text-indigo-300">API Gateway / Load Balancer</div>
            <div className="text-xs text-indigo-400">Nginx + Rate Limiting + SSL Termination</div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4 relative z-10">
          <div className="bg-slate-800 p-4 rounded-lg border border-slate-600 text-center hover:border-green-400 transition-colors">
            <Lock className="w-5 h-5 mx-auto mb-2 text-green-400" />
            <div className="font-bold text-sm">Auth Service</div>
            <div className="text-xs text-slate-400">Keycloak / JWT</div>
          </div>
          <div className="bg-slate-800 p-4 rounded-lg border border-slate-600 text-center hover:border-yellow-400 transition-colors">
            <FileText className="w-5 h-5 mx-auto mb-2 text-yellow-400" />
            <div className="font-bold text-sm">Study Manager</div>
            <div className="text-xs text-slate-400">Go / Orthanc Bridge</div>
          </div>
          <div className="bg-slate-800 p-4 rounded-lg border border-slate-600 text-center hover:border-pink-400 transition-colors">
            <Brain className="w-5 h-5 mx-auto mb-2 text-pink-400" />
            <div className="font-bold text-sm">AI Orchestrator</div>
            <div className="text-xs text-slate-400">Python / Celery</div>
          </div>
          <div className="bg-slate-800 p-4 rounded-lg border border-slate-600 text-center hover:border-cyan-400 transition-colors">
            <Activity className="w-5 h-5 mx-auto mb-2 text-cyan-400" />
            <div className="font-bold text-sm">Live Stream</div>
            <div className="text-xs text-slate-400">WebRTC media</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8 relative z-10">
          <div className="bg-slate-800 p-6 rounded-lg border-2 border-dashed border-slate-600">
            <h4 className="font-bold text-slate-300 mb-4 border-b border-slate-700 pb-2">Storage Cluster</h4>
            <div className="flex space-x-4">
              <div className="bg-black p-3 rounded text-xs w-full text-center border border-slate-700">
                <Database className="w-4 h-4 mx-auto mb-1" />
                Metadata (PostgreSQL)
              </div>
              <div className="bg-black p-3 rounded text-xs w-full text-center border border-slate-700">
                <Server className="w-4 h-4 mx-auto mb-1" />
                DICOM Store (Orthanc)
              </div>
              <div className="bg-black p-3 rounded text-xs w-full text-center border border-slate-700">
                <Server className="w-4 h-4 mx-auto mb-1" />
                Blob Store (MinIO/S3)
              </div>
            </div>
          </div>

          <div className="bg-slate-800 p-6 rounded-lg border-2 border-dashed border-pink-900">
            <h4 className="font-bold text-pink-300 mb-4 border-b border-pink-900 pb-2">AI Inference Engine</h4>
            <div className="flex space-x-4">
              <div className="bg-black p-3 rounded text-xs w-full text-center border border-pink-900/50">
                <GitBranch className="w-4 h-4 mx-auto mb-1" />
                Job Queue (Redis)
              </div>
              <div className="bg-pink-900/20 p-3 rounded text-xs w-full text-center border border-pink-500">
                <Cpu className="w-4 h-4 mx-auto mb-1 text-pink-400" />
                GPU Cluster (Triton)
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

const DatabaseSchema = () => (
  <div className="space-y-6">
    <div className="bg-amber-50 border-l-4 border-amber-500 p-4 text-amber-800 text-sm">
      <span className="font-bold">Note:</span> All tables include `created_at`, `updated_at`, and `deleted_at` (soft delete) for audit compliance.
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="bg-slate-100 p-3 font-bold border-b border-slate-200 text-slate-700">patients</div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            <tr className="bg-slate-50"><td className="p-2 font-mono text-xs">id</td><td className="p-2">UUID (PK)</td></tr>
            <tr><td className="p-2 font-mono text-xs">mrn_hash</td><td className="p-2">VARCHAR (Encrypted)</td></tr>
            <tr><td className="p-2 font-mono text-xs">dob</td><td className="p-2">DATE</td></tr>
            <tr><td className="p-2 font-mono text-xs">sex</td><td className="p-2">ENUM ('M', 'F', 'O')</td></tr>
          </tbody>
        </table>
      </div>

      <div className="border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="bg-slate-100 p-3 font-bold border-b border-slate-200 text-slate-700">studies</div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            <tr className="bg-slate-50"><td className="p-2 font-mono text-xs">id</td><td className="p-2">UUID (PK)</td></tr>
            <tr><td className="p-2 font-mono text-xs">patient_id</td><td className="p-2">UUID (FK)</td></tr>
            <tr><td className="p-2 font-mono text-xs">modality</td><td className="p-2">VARCHAR (CT, MR, XR)</td></tr>
            <tr><td className="p-2 font-mono text-xs">study_date</td><td className="p-2">TIMESTAMP</td></tr>
            <tr><td className="p-2 font-mono text-xs">orthanc_id</td><td className="p-2">VARCHAR (Index)</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
);

const AIModels = () => (
  <div className="space-y-6">
    <div className="prose max-w-none text-slate-600">
      <p>
        The AI pipeline utilizes a hybrid approach: local deployment for segmentation tasks (latency critical) and API-based LLMs for report generation and complex reasoning.
      </p>
    </div>

    <div className="overflow-hidden rounded-xl border border-slate-200 shadow-sm">
      <table className="w-full text-sm text-left">
        <thead className="bg-slate-50 text-slate-700">
          <tr>
            <th className="p-4">Task Domain</th>
            <th className="p-4">Model Architecture</th>
            <th className="p-4">Target Function</th>
            <th className="p-4">Deployment</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          <tr>
            <td className="p-4 font-medium">General Segmentation</td>
            <td className="p-4 font-mono text-blue-600">MedSAM (Segment Anything)</td>
            <td className="p-4">Zero-shot organ/tumor segmentation</td>
            <td className="p-4"><span className="bg-purple-100 text-purple-800 px-2 py-1 rounded text-xs">GPU / Triton</span></td>
          </tr>
          <tr>
            <td className="p-4 font-medium">Chest X-Ray</td>
            <td className="p-4 font-mono text-blue-600">CheXNet / DenseNet121</td>
            <td className="p-4">Pneumonia, opacity, nodule detection</td>
            <td className="p-4"><span className="bg-purple-100 text-purple-800 px-2 py-1 rounded text-xs">GPU / Triton</span></td>
          </tr>
          <tr>
            <td className="p-4 font-medium">Report Generation</td>
            <td className="p-4 font-mono text-blue-600">MedGemma 7B / Med-PaLM 2</td>
            <td className="p-4">Generate textual findings from image embeddings</td>
            <td className="p-4"><span className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs">Cloud API / Local LLM</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
);

const APIReference = () => (
  <div className="space-y-8">
    <div className="space-y-4">
      <h3 className="text-lg font-bold flex items-center"><Upload className="w-5 h-5 mr-2" /> Imaging Endpoints</h3>
      <div className="space-y-3">
        <div className="border border-slate-200 rounded-md bg-white">
          <div className="flex items-center px-4 py-3 bg-slate-50 border-b border-slate-200">
            <span className="bg-green-600 text-white px-2 py-1 rounded text-xs font-bold mr-3">POST</span>
            <code className="text-sm text-slate-700 flex-1">/api/v1/studies/upload</code>
          </div>
          <div className="p-4 text-sm text-slate-600">
            Accepts multipart/form-data (DICOM, PNG, JPEG). Triggers the ingestion pipeline.
          </div>
        </div>
      </div>
    </div>
  </div>
);

// --- Collaboration Timeline Hub ---

const CollaborationTimeline = ({ onClose }) => {
  const [events, setEvents] = useState([
    {
      id: '1',
      user: 'Dr. Sarah Jenkins',
      role: 'Radiologist',
      action: 'comment',
      content: 'I noticed a secondary density in the lower left lobe. Flagging for Oncology review.',
      timestamp: '10 mins ago',
      acknowledged: true
    },
    {
      id: '2',
      user: 'TeleScan AI',
      role: 'System',
      action: 'upload',
      content: 'Auto-segmented lung volume analysis added to series.',
      timestamp: '15 mins ago',
      acknowledged: false
    },
    {
      id: '3',
      user: 'Dr. Michael Chen',
      role: 'Oncologist',
      action: 'handoff',
      content: 'Case accepted for expedited review. Scheduling biopsy.',
      timestamp: '2 mins ago',
      acknowledged: false
    }
  ]);
  const [newPost, setNewPost] = useState('');

  const handlePost = () => {
    if (!newPost.trim()) return;
    const post = {
      id: Date.now().toString(),
      user: 'You',
      role: 'Lead',
      action: 'comment',
      content: newPost,
      timestamp: 'Just now',
      acknowledged: false
    };
    setEvents([post, ...events]);
    setNewPost('');
  };

  const handleAcknowledge = (id) => {
    setEvents(events.map(e => e.id === id ? { ...e, acknowledged: true } : e));
  };

  return (
    <div className="absolute right-0 top-0 bottom-0 w-96 bg-white shadow-2xl border-l border-slate-200 z-50 flex flex-col animate-in slide-in-from-right duration-300">
      <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
        <div className="flex items-center space-x-2 text-slate-800">
          <Users className="w-5 h-5 text-blue-600" />
          <h3 className="font-bold">Team Collaboration</h3>
        </div>
        <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-slate-50/50">
        {events.map((event) => (
          <div key={event.id} className="relative pl-6 border-l-2 border-slate-200">
            <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 border-white ${event.action === 'upload' ? 'bg-purple-500' : event.action === 'handoff' ? 'bg-green-500' : 'bg-blue-500'}`}></div>
            <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
              <div className="flex justify-between items-start mb-1">
                <span className="text-xs font-bold text-slate-900">{event.user}</span>
                <span className="text-[10px] text-slate-400">{event.timestamp}</span>
              </div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">{event.role} • {event.action}</div>
              <p className="text-sm text-slate-700 mb-3">{event.content}</p>

              {!event.acknowledged && event.user !== 'You' && (
                <button
                  onClick={() => handleAcknowledge(event.id)}
                  className="text-xs flex items-center text-blue-600 hover:text-blue-700 font-medium"
                >
                  <CheckSquare className="w-3 h-3 mr-1" /> Acknowledge
                </button>
              )}
              {event.acknowledged && (
                <div className="text-xs flex items-center text-green-600">
                  <CheckCircle className="w-3 h-3 mr-1" /> Seen by team
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-slate-200 bg-white">
        <div className="flex space-x-2">
          <textarea
            value={newPost}
            onChange={(e) => setNewPost(e.target.value)}
            placeholder="Add a clinical note or update..."
            className="flex-1 text-sm p-2 border border-slate-300 rounded-md focus:outline-none focus:border-blue-500 resize-none h-20"
          />
        </div>
        <div className="flex justify-between items-center mt-2">
          <div className="flex space-x-2">
            <button className="p-2 text-slate-400 hover:text-blue-600"><FilePlus className="w-4 h-4" /></button>
            <button className="p-2 text-slate-400 hover:text-blue-600"><Mic className="w-4 h-4" /></button>
          </div>
          <button
            onClick={handlePost}
            disabled={!newPost.trim()}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            Post Update
          </button>
        </div>
      </div>
    </div>
  );
};

// --- High-Fidelity Interactive Mockups ---

const RadiologistDashboard = ({ onToggleCollab }) => {
  const [activeSlice, setActiveSlice] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [activeTool, setActiveTool] = useState('default');
  const [chatMessage, setChatMessage] = useState('');
  const [studyStatus, setStudyStatus] = useState('In Progress');
  const [chatHistory, setChatHistory] = useState([
    { role: 'system', text: 'Analysis complete. 2 findings detected.' }
  ]);
  const [activeFinding, setActiveFinding] = useState(null);

  const findings = [
    { id: 'f1', title: 'Lung Nodule', color: 'red', percent: 92, desc: '14mm opacity in upper right lobe.', type: 'critical' },
    { id: 'f2', title: 'Pleural Effusion', color: 'yellow', percent: 65, desc: 'Minor fluid accumulation.', type: 'warning' }
  ];

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!chatMessage.trim()) return;
    const newHistory = [...chatHistory, { role: 'user', text: chatMessage }];
    setChatHistory(newHistory);
    setChatMessage('');

    setTimeout(() => {
      setChatHistory(prev => [...prev, { role: 'ai', text: 'The nodule density is 45 HU, suggesting soft tissue consistency. Would you like a volumetric analysis?' }]);
    }, 1000);
  };

  const handlePrint = () => {
    alert("Triggering Print Dialog / PDF Export...");
  };

  const handleForward = () => {
    alert("Forwarding case to Oncology Dept...");
  };

  return (
    <div className="bg-slate-900 h-full text-slate-300 flex flex-col rounded-lg overflow-hidden border border-slate-700 font-sans relative">
      <div className="h-14 bg-slate-950 flex items-center justify-between px-4 border-b border-slate-800 shrink-0">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 text-blue-500">
            <Activity className="w-5 h-5" />
            <span className="font-bold text-white tracking-tight">TeleScan AI</span>
          </div>
          <div className="h-6 w-px bg-slate-700"></div>

          <div className="relative">
            <select
              value={studyStatus}
              onChange={(e) => setStudyStatus(e.target.value)}
              className={`appearance-none bg-slate-900 border border-slate-700 text-xs font-bold px-3 py-1.5 rounded pr-8 cursor-pointer focus:outline-none focus:border-blue-500 transition-colors
                 ${studyStatus === 'Unread' ? 'text-slate-400' : studyStatus === 'Finalized' ? 'text-green-400 border-green-900' : 'text-blue-400 border-blue-900'}
               `}
            >
              <option value="Unread">Unread</option>
              <option value="In Progress">In Progress</option>
              <option value="Peer Review">Peer Review</option>
              <option value="Finalized">Finalized</option>
              <option value="Archived">Archived</option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-400">
              <svg className="fill-current h-3 w-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
            </div>
          </div>

          <div className="h-6 w-px bg-slate-700"></div>
          <div className="text-sm flex items-center space-x-2">
            <span className="text-slate-400">Patient:</span>
            <span className="text-white font-medium">DOE, JOHN (M, 45)</span>
          </div>
          <div className="text-xs bg-red-900/50 border border-red-800 text-red-200 px-2 py-0.5 rounded flex items-center animate-pulse">
            <AlertTriangle className="w-3 h-3 mr-1" /> Urgent Finding
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button onClick={handlePrint} className="p-2 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors" title="Print / Export">
            <Printer className="w-4 h-4" />
          </button>
          <button onClick={handleForward} className="p-2 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors" title="Forward / Pass On">
            <CornerUpRight className="w-4 h-4" />
          </button>
          <button className="p-2 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"><Share2 className="w-4 h-4" /></button>
          <div className="h-6 w-px bg-slate-700 mx-2"></div>
          <button onClick={onToggleCollab} className="flex items-center space-x-2 bg-slate-800 hover:bg-slate-700 text-blue-400 px-3 py-1.5 rounded text-sm font-medium transition-colors border border-slate-700">
            <Users className="w-4 h-4" />
            <span>Team Hub</span>
          </button>
          <button className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded text-sm font-medium transition-colors shadow-lg shadow-blue-900/20 ml-2">
            Finalize Report
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-20 bg-black border-r border-slate-800 flex flex-col items-center py-4 space-y-4 overflow-y-auto shrink-0 scrollbar-thin scrollbar-thumb-slate-800">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              onClick={() => setActiveSlice(i)}
              className={`relative cursor-pointer group transition-all duration-200 ${activeSlice === i ? 'scale-105' : 'opacity-60 hover:opacity-100'}`}
            >
              <div className={`w-16 h-16 bg-slate-800 rounded-md border-2 flex items-center justify-center text-xs overflow-hidden ${activeSlice === i ? 'border-blue-500 shadow-lg shadow-blue-500/20' : 'border-slate-700'}`}>
                <div className="w-full h-full bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center relative">
                  <div className="w-8 h-8 rounded-full border border-slate-600 opacity-20"></div>
                  <span className="absolute bottom-1 right-1 text-[9px] text-slate-500">{i}</span>
                </div>
              </div>
              {activeSlice === i && <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1 w-0 h-0 border-t-[6px] border-t-transparent border-l-[6px] border-l-blue-500 border-b-[6px] border-b-transparent"></div>}
            </div>
          ))}
        </div>

        <div className="flex-1 bg-black relative flex items-center justify-center overflow-hidden">
          <div
            className="relative transition-transform duration-200 ease-out cursor-crosshair"
            style={{
              width: '75%',
              height: '75%',
              transform: `scale(${zoom / 100})`
            }}
          >
            <div className="absolute inset-0 bg-slate-900 rounded-lg border border-slate-800 overflow-hidden">
              <div className="w-full h-full opacity-30" style={{
                backgroundImage: 'radial-gradient(circle at 50% 50%, #334155 0%, #0f172a 70%)',
              }}></div>

              <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60%] h-[70%] border-[20px] border-slate-700/30 rounded-[40%] blur-sm transition-all duration-500 ${activeSlice % 2 === 0 ? 'scale-95' : 'scale-100'}`}></div>
              <div className="absolute top-[40%] left-[45%] w-[10%] h-[15%] bg-slate-800/50 rounded-full blur-md"></div>
            </div>

            {(activeSlice === 1 || activeSlice === 2) && (
              <div
                className={`absolute top-[28%] left-[62%] w-[12%] h-[12%] border-2 rounded-full flex items-center justify-center transition-all duration-300 ${activeFinding === 'f1' ? 'border-red-500 bg-red-500/10 scale-110 shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'border-red-500/60 border-dashed'}`}
              >
                {activeFinding === 'f1' && (
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-red-600 text-white text-[10px] px-2 py-1 rounded shadow-lg whitespace-nowrap z-10 font-bold flex items-center animate-in fade-in slide-in-from-bottom-2">
                    Nodule (92%)
                  </div>
                )}
              </div>
            )}

            <div className="absolute top-4 left-4 text-[10px] font-mono text-slate-400 space-y-1 select-none pointer-events-none">
              <div>kVp: 120</div>
              <div>mA: 200</div>
              <div>Slice: {activeSlice}/124</div>
            </div>
            <div className="absolute top-4 right-4 text-[10px] font-mono text-slate-400 space-y-1 text-right select-none pointer-events-none">
              <div className="text-blue-400">W: 400 L: 40</div>
              <div>Zoom: {zoom}%</div>
            </div>

            <div className="absolute top-2 left-1/2 -translate-x-1/2 text-slate-600 font-bold text-xs select-none">A</div>
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-slate-600 font-bold text-xs select-none">P</div>
            <div className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-600 font-bold text-xs select-none">R</div>
            <div className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-600 font-bold text-xs select-none">L</div>
          </div>

          <div className="absolute bottom-8 bg-slate-900/90 backdrop-blur-md rounded-full px-4 py-2 flex items-center space-x-2 border border-slate-700 shadow-2xl z-20">
            <button
              onClick={() => setActiveTool(activeTool === 'window' ? 'default' : 'window')}
              className={`p-2 rounded-full transition-colors ${activeTool === 'window' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
              title="Window/Level"
            >
              <Sun className="w-5 h-5" />
            </button>
            <button
              onClick={() => setActiveTool(activeTool === 'pan' ? 'default' : 'pan')}
              className={`p-2 rounded-full transition-colors ${activeTool === 'pan' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
              title="Pan"
            >
              <Move className="w-5 h-5" />
            </button>
            <button
              onClick={() => setActiveTool(activeTool === 'zoom' ? 'default' : 'zoom')}
              className={`p-2 rounded-full transition-colors ${activeTool === 'zoom' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
              title="Zoom"
            >
              <ZoomIn className="w-5 h-5" />
            </button>
            <div className="w-px h-6 bg-slate-700 mx-2"></div>
            <button className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full" onClick={() => setZoom(z => Math.max(z - 10, 10))}>
              <div className="w-5 h-5 flex items-center justify-center font-bold text-lg">-</div>
            </button>
            <span className="text-xs font-mono w-12 text-center text-slate-300">{zoom}%</span>
            <button className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full" onClick={() => setZoom(z => z + 10)}>
              <div className="w-5 h-5 flex items-center justify-center font-bold text-lg">+</div>
            </button>
          </div>
        </div>

        <div className="w-80 bg-slate-950 border-l border-slate-800 flex flex-col shrink-0 transition-all duration-300">
          <div className="p-4 border-b border-slate-800 bg-slate-950">
            <h3 className="font-bold text-white flex items-center">
              <Brain className="w-4 h-4 mr-2 text-purple-400" /> AI Findings
            </h3>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-slate-800">
            {findings.map((f) => (
              <div
                key={f.id}
                onMouseEnter={() => setActiveFinding(f.id)}
                onMouseLeave={() => setActiveFinding(null)}
                className={`p-3 rounded-lg border cursor-pointer transition-all duration-200 ${activeFinding === f.id ? 'bg-slate-800 border-slate-600 shadow-lg translate-x-1' : 'bg-slate-900 border-slate-800 hover:border-slate-700'}`}
              >
                <div className="flex justify-between items-start mb-2">
                  <span className={`text-sm font-bold ${f.color === 'red' ? 'text-red-400' : 'text-yellow-400'}`}>{f.title}</span>
                  <span className="text-[10px] bg-black/40 px-1.5 py-0.5 rounded text-slate-400 border border-slate-800">Series 2</span>
                </div>
                <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                  {f.desc}
                </p>
                <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden border border-slate-800/50">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ${f.color === 'red' ? 'bg-gradient-to-r from-red-600 to-red-400' : 'bg-gradient-to-r from-yellow-600 to-yellow-400'}`}
                    style={{ width: `${f.percent}%` }}
                  ></div>
                </div>
                <div className="mt-1 text-[10px] text-right text-slate-500 font-mono">{f.percent}% Confidence</div>
              </div>
            ))}

            <div className="mt-6 pt-6 border-t border-slate-800">
              <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">Quantitative Analysis</h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-slate-900 p-2 rounded border border-slate-800">
                  <div className="text-slate-500 text-[10px] uppercase">Volume</div>
                  <div className="text-white font-mono mt-1">124 cc</div>
                </div>
                <div className="bg-slate-900 p-2 rounded border border-slate-800">
                  <div className="text-slate-500 text-[10px] uppercase">Mean Density</div>
                  <div className="text-white font-mono mt-1">45 HU</div>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-800 bg-slate-900 flex flex-col h-1/3 min-h-[200px]">
            <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-thin scrollbar-thumb-slate-800">
              {chatHistory.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-lg p-2 text-xs leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white rounded-br-none'
                      : msg.role === 'system'
                        ? 'bg-slate-800 text-slate-400 italic text-center w-full'
                        : 'bg-slate-800 text-slate-300 rounded-bl-none border border-slate-700'
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>
            <form onSubmit={handleSendMessage} className="p-3 border-t border-slate-800 bg-slate-950 flex items-center space-x-2">
              <input
                type="text"
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                placeholder="Ask Copilot..."
                className="flex-1 bg-slate-900 border border-slate-800 rounded px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
              />
              <button type="submit" className="p-2 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors disabled:opacity-50" disabled={!chatMessage}>
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

const PatientPortal = () => {
  const [activeTab, setActiveTab] = useState('summary');
  const [viewerOpen, setViewerOpen] = useState(false);

  return (
    <div className="bg-slate-50 h-full flex flex-col rounded-lg overflow-hidden border border-slate-200 font-sans relative">
      <div className="bg-white px-6 py-4 border-b border-slate-200 flex justify-between items-center shadow-sm z-10">
        <div className="flex items-center space-x-4">
          <div className="bg-blue-600 p-2 rounded-lg text-white">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800 leading-none">Chest CT Scan</h2>
            <p className="text-xs text-slate-500 mt-1">Oct 24, 2024 • Central Hospital</p>
          </div>
        </div>
        <div className="flex space-x-3">
          <button className="px-4 py-2 text-slate-600 text-sm font-medium hover:bg-slate-50 rounded-lg transition-colors border border-slate-200">
            Need Help?
          </button>
          <button className="px-4 py-2 bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 rounded-lg transition-colors shadow-sm flex items-center">
            <Download className="w-4 h-4 mr-2" /> Download
          </button>
        </div>
      </div>

      <div className="bg-white px-6 border-b border-slate-200 flex space-x-6">
        <button
          onClick={() => setActiveTab('summary')}
          className={`py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'summary' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
        >
          AI Summary
        </button>
        <button
          onClick={() => setActiveTab('report')}
          className={`py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'report' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
        >
          Full Report
        </button>
        <button
          onClick={() => setActiveTab('images')}
          className={`py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'images' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
        >
          Images
        </button>
      </div>

      <div className="p-6 flex-1 overflow-y-auto bg-slate-50">
        <div className="max-w-4xl mx-auto">
          {activeTab === 'summary' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-6 shadow-sm">
                <div className="flex items-start space-x-4">
                  <div className="bg-blue-100 p-2 rounded-full text-blue-600 mt-1">
                    <Brain className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-blue-900 mb-2">Simplified AI Summary</h3>
                    <p className="text-slate-700 leading-relaxed text-sm">
                      The scan shows your lungs are mostly clear, but there is a <span className="font-semibold text-blue-800 bg-blue-100 px-1 rounded">small spot (nodule)</span> on the right side that the doctor wants to watch. It's likely benign (not cancer), but they recommend a follow-up in 6 months to be safe. No signs of infection like pneumonia were found.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                  <h4 className="font-bold text-slate-800 mb-4 text-sm uppercase tracking-wide text-slate-500">Key Findings</h4>
                  <div className="space-y-3">
                    <div className="flex items-center p-3 bg-green-50 rounded-lg border border-green-100">
                      <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                      <span className="text-sm font-medium text-slate-700">Heart size is normal</span>
                    </div>
                    <div className="flex items-center p-3 bg-green-50 rounded-lg border border-green-100">
                      <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                      <span className="text-sm font-medium text-slate-700">Bones are healthy</span>
                    </div>
                    <div className="flex items-center p-3 bg-yellow-50 rounded-lg border border-yellow-100">
                      <AlertTriangle className="w-5 h-5 text-yellow-500 mr-3" />
                      <span className="text-sm font-medium text-yellow-800">Small 4mm nodule in right upper lobe</span>
                    </div>
                  </div>
                </div>
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
                  <div>
                    <h4 className="font-bold text-slate-800 mb-4 text-sm uppercase tracking-wide text-slate-500">Action Plan</h4>
                    <ul className="list-disc list-inside text-sm text-slate-700 space-y-2 pl-2">
                      <li>Schedule follow-up CT in 6 months</li>
                      <li>No medication required</li>
                      <li>Continue normal physical activity</li>
                    </ul>
                  </div>
                  <button className="w-full mt-4 bg-slate-900 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors">
                    Schedule Follow-up
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'report' && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in duration-300">
              <div className="p-8 font-serif">
                <div className="border-b-2 border-slate-800 pb-4 mb-8 flex justify-between items-end">
                  <div>
                    <h1 className="text-2xl font-bold text-slate-900">Radiology Report</h1>
                    <p className="text-slate-500 text-sm mt-1">Accession #: 2390482309</p>
                  </div>
                  <Printer className="w-5 h-5 text-slate-400 cursor-pointer hover:text-slate-800" />
                </div>
                <div className="space-y-6 text-slate-800 leading-relaxed">
                  <section>
                    <h4 className="font-bold uppercase text-xs text-slate-500 mb-2">Clinical Indication</h4>
                    <p className="text-sm">Persistent cough, 3 weeks duration. Rule out pneumonia.</p>
                  </section>
                  <section>
                    <h4 className="font-bold uppercase text-xs text-slate-500 mb-2">Findings</h4>
                    <p className="text-sm">The trachea and main bronchi are patent. No mediastinal or hilar lymphadenopathy. Heart size is normal. No pericardial effusion.</p>
                    <p className="text-sm mt-2"><strong>Lungs:</strong> There is a 14mm non-calcified nodule in the right upper lobe (Series 2, Image 45). The remainder of the lungs are clear. No consolidation or pneumothorax.</p>
                    <p className="text-sm mt-2"><strong>Osseous structures:</strong> No acute fracture or lytic lesion.</p>
                  </section>
                  <section className="bg-slate-50 p-4 rounded border border-slate-100">
                    <h4 className="font-bold uppercase text-xs text-slate-500 mb-2">Impression</h4>
                    <ol className="list-decimal list-inside text-sm font-medium space-y-1">
                      <li>14mm indeterminate nodule in right upper lobe. Fleischner Society guidelines recommend follow-up CT in 6-12 months.</li>
                      <li>No evidence of pneumonia.</li>
                    </ol>
                  </section>
                </div>
                <div className="mt-12 pt-8 border-t border-slate-200 flex justify-between items-center text-xs text-slate-500">
                  <span>Electronically Signed by: Dr. Sarah Jenkins, MD</span>
                  <span>Signed: Oct 24, 2024 14:30</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'images' && (
            <div className="animate-in fade-in duration-300 h-full flex flex-col items-center justify-center space-y-6 py-12">
              <div className="bg-slate-100 p-8 rounded-full">
                <Layout className="w-16 h-16 text-slate-400" />
              </div>
              <div className="text-center">
                <h3 className="text-lg font-bold text-slate-800">Medical Imaging Viewer</h3>
                <p className="text-slate-500 text-sm mt-2 max-w-sm mx-auto">
                  Access high-resolution DICOM images securely. Optimized for desktop and tablet viewing.
                </p>
              </div>
              <button
                onClick={() => setViewerOpen(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-full font-medium shadow-lg hover:shadow-xl transition-all transform hover:-translate-y-0.5"
              >
                Launch Secure Viewer
              </button>
              <p className="text-xs text-slate-400">Powered by OHIF & Orthanc</p>
            </div>
          )}
        </div>
      </div>

      {viewerOpen && (
        <div className="absolute inset-0 z-50 bg-black/90 flex flex-col animate-in fade-in duration-200">
          <div className="h-14 bg-black border-b border-slate-800 flex items-center justify-between px-4">
            <span className="text-white font-bold">QuickView</span>
            <button onClick={() => setViewerOpen(false)} className="text-slate-400 hover:text-white p-2">
              <X className="w-6 h-6" />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center relative bg-black">
            <div className="text-slate-500 flex flex-col items-center">
              <div className="w-64 h-64 border border-slate-700 rounded-lg flex items-center justify-center bg-slate-900 mb-4 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-tr from-transparent to-slate-800/50"></div>
                <Activity className="w-12 h-12 text-slate-600" />
              </div>
              <p>Loading Series 1...</p>
            </div>

            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex space-x-4">
              <button className="p-3 bg-slate-800 rounded-full hover:bg-slate-700 text-white"><ChevronLeft className="w-5 h-5" /></button>
              <button className="p-3 bg-slate-800 rounded-full hover:bg-slate-700 text-white"><ChevronRight className="w-5 h-5" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// --- Main App Component ---

export default function TelehealthImagingSpec() {
  const [activeSection, setActiveSection] = useState('executive');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isCollabOpen, setIsCollabOpen] = useState(false);

  const navItems = [
    { id: 'executive', label: 'Executive Summary', icon: <Activity className="w-5 h-5" /> },
    { id: 'architecture', label: 'System Architecture', icon: <Server className="w-5 h-5" /> },
    { id: 'database', label: 'Database Schema', icon: <Database className="w-5 h-5" /> },
    { id: 'ai-models', label: 'AI Model Stack', icon: <Brain className="w-5 h-5" /> },
    { id: 'api', label: 'API Contract', icon: <GitBranch className="w-5 h-5" /> },
    { id: 'wireframes', label: 'Live Wireframes', icon: <Eye className="w-5 h-5" /> },
  ];

  const renderContent = () => {
    switch (activeSection) {
      case 'executive': return <ExecutiveSummary />;
      case 'architecture': return <ArchitectureDiagram />;
      case 'database': return <DatabaseSchema />;
      case 'ai-models': return <AIModels />;
      case 'api': return <APIReference />;
      case 'wireframes': return (
        <div className="space-y-8 pb-12">
          <div className="h-[700px] shadow-2xl rounded-xl overflow-hidden ring-1 ring-slate-900/5 relative">
            <RadiologistDashboard onToggleCollab={() => setIsCollabOpen(!isCollabOpen)} />
            {isCollabOpen && <CollaborationTimeline onClose={() => setIsCollabOpen(false)} />}
          </div>
          <div className="h-[650px] shadow-2xl rounded-xl overflow-hidden ring-1 ring-slate-900/5">
            <PatientPortal />
          </div>
        </div>
      );
      default: return <ExecutiveSummary />;
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900">
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 text-white transform transition-transform duration-300 ease-in-out ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0 shadow-2xl`}>
        <div className="flex flex-col h-full">
          <div className="p-6 border-b border-slate-800 bg-slate-950">
            <div className="flex items-center space-x-2 text-blue-500">
              <Activity className="w-8 h-8" />
              <span className="text-xl font-bold text-white tracking-tight">MediView AI</span>
            </div>
            <p className="text-xs text-slate-500 mt-2 font-mono">Build v1.1.0-RC</p>
          </div>

          <nav className="flex-1 px-3 py-6 space-y-1 overflow-y-auto scrollbar-none">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setActiveSection(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                  activeSection === item.id
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50 translate-x-1'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
                {item.id === 'wireframes' && <span className="ml-auto flex h-2 w-2 rounded-full bg-green-400 animate-pulse"></span>}
              </button>
            ))}
          </nav>

          <div className="p-4 border-t border-slate-800 bg-slate-950">
            <div className="bg-slate-900 rounded-lg p-4 border border-slate-800 shadow-inner">
              <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-3 tracking-wider">System Status</h4>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-slate-300">Triton Inference</span>
                <span className="text-green-400 font-mono">ONLINE</span>
              </div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-slate-300">Orthanc PACS</span>
                <span className="text-green-400 font-mono">ONLINE</span>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-800 flex items-center space-x-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-[10px] text-slate-400">All systems operational</span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b border-slate-200 md:hidden p-4 flex items-center justify-between sticky top-0 z-40">
          <div className="font-bold text-slate-800 flex items-center space-x-2">
            <Activity className="w-5 h-5 text-blue-600" />
            <span>MediView Spec</span>
          </div>
          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg">
            {mobileMenuOpen ? <X /> : <Menu />}
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-8 lg:p-12 scrollbar-thin scrollbar-thumb-slate-200">
          <div className="max-w-7xl mx-auto">
            <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl md:text-3xl font-bold text-slate-900 mb-2 capitalize tracking-tight">
                  {navItems.find(n => n.id === activeSection)?.label}
                </h2>
                <div className="h-1.5 w-20 bg-blue-600 rounded-full"></div>
              </div>
              <div className="hidden md:flex space-x-3">
                <button className="flex items-center px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors shadow-sm">
                  <Settings className="w-4 h-4 mr-2" /> Settings
                </button>
                <button className="flex items-center px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors shadow-lg hover:shadow-xl">
                  <User className="w-4 h-4 mr-2" /> Dr. Jenkins
                </button>
              </div>
            </div>

            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              {renderContent()}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}


