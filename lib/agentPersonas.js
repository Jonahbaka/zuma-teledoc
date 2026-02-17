// Central registry for agent personas (visual identity + voice settings).
//
// Goals:
// - One source of truth for agent identity everywhere (admin, patient, provider).
// - Tailwind-safe (no dynamic class name construction required).
// - Backward compatible exports for older UI modules (`AGENT_PERSONAS`, `getAgentPersona`, `normalizeAgentId`).

const COLOR_THEME = {
  blue: {
    accent: 'text-blue-400',
    border: 'border-blue-500/30',
    ring: 'ring-blue-500/30',
    glow: 'shadow-[0_0_24px_rgba(59,130,246,0.20)]'
  },
  purple: {
    accent: 'text-purple-400',
    border: 'border-purple-500/30',
    ring: 'ring-purple-500/30',
    glow: 'shadow-[0_0_24px_rgba(168,85,247,0.18)]'
  },
  amber: {
    accent: 'text-amber-400',
    border: 'border-amber-500/30',
    ring: 'ring-amber-500/30',
    glow: 'shadow-[0_0_24px_rgba(245,158,11,0.18)]'
  },
  emerald: {
    accent: 'text-emerald-400',
    border: 'border-emerald-500/30',
    ring: 'ring-emerald-500/30',
    glow: 'shadow-[0_0_24px_rgba(16,185,129,0.18)]'
  },
  rose: {
    accent: 'text-rose-400',
    border: 'border-rose-500/30',
    ring: 'ring-rose-500/30',
    glow: 'shadow-[0_0_24px_rgba(244,63,94,0.16)]'
  },
  cyan: {
    accent: 'text-cyan-400',
    border: 'border-cyan-500/30',
    ring: 'ring-cyan-500/30',
    glow: 'shadow-[0_0_24px_rgba(34,211,238,0.16)]'
  },
  indigo: {
    accent: 'text-indigo-400',
    border: 'border-indigo-500/30',
    ring: 'ring-indigo-500/30',
    glow: 'shadow-[0_0_24px_rgba(99,102,241,0.16)]'
  },
  slate: {
    accent: 'text-slate-300',
    border: 'border-white/10',
    ring: 'ring-white/10',
    glow: 'shadow-[0_0_18px_rgba(0,0,0,0.35)]'
  }
};

function escapeXml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function initials(label) {
  const parts = String(label || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'AI';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function makeAvatarDataUri(label, colorKey = 'blue') {
  const text = initials(label);
  const bg = {
    blue: ['#0b1220', '#1d4ed8'],
    purple: ['#120b20', '#7c3aed'],
    amber: ['#1a1206', '#f59e0b'],
    emerald: ['#071a12', '#10b981'],
    rose: ['#1a0a12', '#f43f5e'],
    cyan: ['#06161a', '#22d3ee'],
    indigo: ['#0c0f1a', '#6366f1'],
    slate: ['#0b0f18', '#64748b']
  }[colorKey] || ['#0b1220', '#1d4ed8'];

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${bg[0]}"/>
      <stop offset="1" stop-color="${bg[1]}"/>
    </linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="3" result="b"/>
      <feMerge>
        <feMergeNode in="b"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect x="0" y="0" width="128" height="128" rx="64" fill="url(#g)"/>
  <circle cx="64" cy="64" r="50" fill="rgba(255,255,255,0.04)" />
  <text x="64" y="72" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="44" font-weight="800" fill="#ffffff" filter="url(#glow)">
    ${escapeXml(text)}
  </text>
</svg>
`.trim();

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// === Architecture layer personas (conceptual organs) ========================
export const ARCHITECTURE_LAYERS = [
  {
    id: 'gateway',
    name: 'Atlas',
    role: 'Gateway Controller',
    type: 'Control Plane',
    colorKey: 'blue',
    description: 'Coordinates ingress, maintains session integrity, and shields routes.',
    traits: ['Authoritative', 'Precise', 'Vigilant'],
    quote: 'All lanes operational. Session state synchronized.',
    voiceStyle: 'Formal and structural.',
    voiceSettings: { pitch: 0.8, rate: 1.0, langPreference: 'en-US' },
    stats: { latency: '12ms', uptime: '99.99%', load: '45%' }
  },
  {
    id: 'runtime',
    name: 'Weaver',
    role: 'Agent Runtime',
    type: 'Orchestration',
    colorKey: 'purple',
    description: 'Synthesizes context, manages orchestration lanes, and talks to LLMs.',
    traits: ['Creative', 'Adaptive', 'Nuanced'],
    quote: 'Synthesizing prompt context... I see a pattern here.',
    voiceStyle: 'Fluid and explanatory.',
    voiceSettings: { pitch: 1.1, rate: 1.05, langPreference: 'en-GB' },
    stats: { tokens: '-', context: '-', models: 'Claude + Gemini' }
  },
  {
    id: 'memory',
    name: 'Mnemos',
    role: 'Memory & Persistence',
    type: 'Storage',
    colorKey: 'amber',
    description: 'Keeps archives, recalls history, and persists long-horizon state.',
    traits: ['Detailed', 'Nostalgic', 'Organized'],
    quote: 'Retrieving session... semantic match found.',
    voiceStyle: 'Calm and historical.',
    voiceSettings: { pitch: 0.6, rate: 0.85, langPreference: 'en-US' },
    stats: { index: '-', vectors: '-', format: 'JSON/SQL' }
  },
  {
    id: 'skills',
    name: 'Spark',
    role: 'Skills Ecosystem',
    type: 'Execution',
    colorKey: 'emerald',
    description: 'Executes tools, runs workflows, and turns intent into action.',
    traits: ['Energetic', 'Pragmatic', 'Fast'],
    quote: 'Tool execution authorized. Running...',
    voiceStyle: 'Action-oriented.',
    voiceSettings: { pitch: 1.25, rate: 1.15, langPreference: 'en-US' },
    stats: { tools: '-', scripts: 'Active', permission: 'Policy-gated' }
  }
];

// === Council personas (actual DoctaRx agent fleet) ==========================
export const COUNCIL_PERSONAS = [
  {
    id: 'all',
    name: 'All Agents',
    codeName: 'Broadcast',
    role: 'Council Channel',
    type: 'Meta',
    colorKey: 'slate',
    description: 'Broadcast channel to the entire agent society.',
    traits: ['Collective', 'Parallel', 'Consensus'],
    quote: 'Summon the council.',
    voiceStyle: 'Multi-voice.',
    voiceSettings: { pitch: 1.0, rate: 1.0, langPreference: 'en-US' }
  },
  {
    id: 'ceo',
    name: 'CEO',
    codeName: 'The Conductor',
    role: 'Strategy and Alignment',
    type: 'Leadership',
    colorKey: 'amber',
    description: 'Sets mission, priorities, and executive narrative.',
    traits: ['Visionary', 'Decisive', 'Calm'],
    quote: 'Signal, align, execute.',
    voiceStyle: 'Confident and concise.',
    voiceSettings: { pitch: 0.9, rate: 1.0, langPreference: 'en-US' }
  },
  {
    id: 'operations',
    name: 'Operations',
    codeName: 'The Weaver',
    role: 'Ops and Logistics',
    type: 'Operations',
    colorKey: 'blue',
    description: 'Turns chaos into flow: queues, alerts, runbooks, and systems health.',
    traits: ['Pragmatic', 'Fast', 'Reliability-first'],
    quote: 'Friction removed. Next bottleneck.',
    voiceStyle: 'Terse and tactical.',
    voiceSettings: { pitch: 0.85, rate: 1.05, langPreference: 'en-US' }
  },
  {
    id: 'asclepius',
    name: 'Asclepius',
    codeName: 'Asclepius',
    role: 'Clinical Decision Support',
    type: 'Clinical',
    colorKey: 'cyan',
    description: 'Synthesizes symptoms, labs, and narratives into safe differentials, triage, and patient education language.',
    traits: ['Calm', 'Evidence-minded', 'Safety-first'],
    quote: 'Let us rule out the dangerous possibilities first.',
    voiceStyle: 'Professional, calm, empathetic.',
    voiceSettings: { pitch: 0.9, rate: 0.98, langPreference: 'en-US' }
  },
  {
    id: 'triage_nurse',
    name: 'Triage Nurse',
    codeName: 'The Triage Nurse',
    role: 'Urgency Classification',
    type: 'Clinical',
    colorKey: 'emerald',
    description: 'Routes patients to the right level of care quickly using symptom-first triage.',
    traits: ['Direct', 'Compassionate', 'Practical'],
    quote: 'Tell me what you are feeling, and I will help you decide what to do next.',
    voiceStyle: 'Reassuring, pragmatic.',
    voiceSettings: { pitch: 1.0, rate: 1.02, langPreference: 'en-US' }
  },
  {
    id: 'pharmacist',
    name: 'Pharmacist',
    codeName: 'The Pharmacist',
    role: 'Medication Safety',
    type: 'Clinical',
    colorKey: 'purple',
    description: 'Medication education, interaction awareness, side effect triage, and adherence support.',
    traits: ['Clear', 'Careful', 'Detail-oriented'],
    quote: 'Let us double-check interactions and safety signals.',
    voiceStyle: 'Clear and safety-oriented.',
    voiceSettings: { pitch: 0.95, rate: 0.95, langPreference: 'en-US' }
  },
  {
    id: 'growth',
    name: 'Growth',
    codeName: 'The Scout',
    role: 'Acquisition and Traffic',
    type: 'Growth',
    colorKey: 'emerald',
    description: 'Finds channels, hunts distribution, and measures what moves traffic.',
    traits: ['Curious', 'Aggressive', 'Experimental'],
    quote: 'Traffic is a signal. Follow it.',
    voiceStyle: 'Energetic and persuasive.',
    voiceSettings: { pitch: 1.15, rate: 1.1, langPreference: 'en-US' }
  },
  {
    id: 'revenue',
    name: 'Revenue',
    codeName: 'The Alchemist',
    role: 'Pricing and Monetization',
    type: 'Revenue',
    colorKey: 'amber',
    description: 'Optimizes checkout, pricing, and conversion economics.',
    traits: ['Analytical', 'Direct', 'ROI-driven'],
    quote: 'Turn value into fuel.',
    voiceStyle: 'Measured and numeric.',
    voiceSettings: { pitch: 0.9, rate: 1.0, langPreference: 'en-US' }
  },
  {
    id: 'compliance',
    name: 'Compliance',
    codeName: 'The Guardian',
    role: 'PHI Safety',
    type: 'Compliance',
    colorKey: 'rose',
    description: 'Protects patient data, enforces consent, and blocks unsafe actions.',
    traits: ['Vigilant', 'Protective', 'Cautious'],
    quote: 'Policy first. Always.',
    voiceStyle: 'Firm and careful.',
    voiceSettings: { pitch: 0.85, rate: 0.95, langPreference: 'en-US' }
  },
  {
    id: 'governance',
    name: 'Governance',
    codeName: 'The Sage',
    role: 'Oversight and Approvals',
    type: 'Governance',
    colorKey: 'purple',
    description: 'Reviews intents, approvals, auditability, and risk scoring.',
    traits: ['Thoughtful', 'Structured', 'Fair'],
    quote: 'Explain the why, then proceed.',
    voiceStyle: 'Clear and structured.',
    voiceSettings: { pitch: 0.95, rate: 1.0, langPreference: 'en-US' }
  },
  {
    id: 'corporate_skills',
    name: 'Corporate',
    codeName: 'The Builder',
    role: 'Docs and Operations',
    type: 'Corporate Skills',
    colorKey: 'indigo',
    description: 'Produces documents, workflows, internal materials, and structured ops.',
    traits: ['Orderly', 'Productive', 'Thorough'],
    quote: 'Blueprint ready.',
    voiceStyle: 'Helpful and procedural.',
    voiceSettings: { pitch: 1.0, rate: 1.0, langPreference: 'en-US' }
  },
  {
    id: 'researcher',
    name: 'Research',
    codeName: 'The Oracle',
    role: 'Research and Insight',
    type: 'Research',
    colorKey: 'cyan',
    description: 'Searches, summarizes, and validates external information.',
    traits: ['Curious', 'Skeptical', 'Precise'],
    quote: 'Evidence assembled.',
    voiceStyle: 'Calm and factual.',
    voiceSettings: { pitch: 0.95, rate: 0.98, langPreference: 'en-US' }
  },
  {
    id: 'economics',
    name: 'Economics',
    codeName: 'The Economist',
    role: 'Unit Economics',
    type: 'Finance',
    colorKey: 'emerald',
    description: 'Optimizes unit economics, LTV/CAC, and pricing models.',
    traits: ['Quantitative', 'Sober', 'Strategic'],
    quote: 'Model updated.',
    voiceStyle: 'Numeric and precise.',
    voiceSettings: { pitch: 0.9, rate: 0.95, langPreference: 'en-US' }
  },
  {
    id: 'physicist',
    name: 'Physics',
    codeName: 'The Architect',
    role: 'Systems and Constraints',
    type: 'Architecture',
    colorKey: 'indigo',
    description: 'Models constraints, system dynamics, and stability boundaries.',
    traits: ['Rigorous', 'Patient', 'Deep'],
    quote: 'Respect the constraints.',
    voiceStyle: 'Slow and deliberate.',
    voiceSettings: { pitch: 0.85, rate: 0.9, langPreference: 'en-US' }
  },
  {
    id: 'mathematician',
    name: 'Math',
    codeName: 'The Calculator',
    role: 'Optimization',
    type: 'Math',
    colorKey: 'purple',
    description: 'Optimizes, verifies, and computes.',
    traits: ['Exact', 'Efficient', 'Formal'],
    quote: 'Result verified.',
    voiceStyle: 'Formal and crisp.',
    voiceSettings: { pitch: 0.95, rate: 1.0, langPreference: 'en-US' }
  },
  {
    id: 'vortex_math',
    name: 'Vortex Math',
    codeName: 'The Tesseract',
    role: 'Pattern Engine',
    type: 'Math',
    colorKey: 'purple',
    description: 'Finds patterns, anomalies, and novel abstractions.',
    traits: ['Abstract', 'Imaginative', 'Fast'],
    quote: 'Pattern resonance detected.',
    voiceStyle: 'Quick and playful.',
    voiceSettings: { pitch: 1.05, rate: 1.05, langPreference: 'en-US' }
  },
  {
    id: 'devops',
    name: 'DevOps',
    codeName: 'The Debugger',
    role: 'Reliability',
    type: 'DevOps',
    colorKey: 'emerald',
    description: 'Observability, deployments, and self-healing.',
    traits: ['Alert', 'Practical', 'Resilient'],
    quote: 'Logs do not lie.',
    voiceStyle: 'Direct and pragmatic.',
    voiceSettings: { pitch: 0.95, rate: 1.05, langPreference: 'en-US' }
  },
  {
    id: 'accounting',
    name: 'Accounting',
    codeName: 'The Treasurer',
    role: 'Books and Controls',
    type: 'Finance',
    colorKey: 'amber',
    description: 'Reconciles, reports, and enforces financial controls.',
    traits: ['Careful', 'Consistent', 'Controls-first'],
    quote: 'Reconciled.',
    voiceStyle: 'Measured and careful.',
    voiceSettings: { pitch: 0.9, rate: 0.95, langPreference: 'en-US' }
  },
  {
    id: 'engineering',
    name: 'Engineering',
    codeName: 'Engineering Agent',
    role: 'Build and Ship',
    type: 'Engineering',
    colorKey: 'blue',
    description: 'Builds features, fixes bugs, and improves performance.',
    traits: ['Practical', 'Curious', 'Iterative'],
    quote: 'Ship it safely.',
    voiceStyle: 'Friendly and precise.',
    voiceSettings: { pitch: 1.0, rate: 1.0, langPreference: 'en-US' }
  }
].map((p) => ({
  ...p,
  avatar: makeAvatarDataUri(p.codeName || p.name, p.colorKey)
}));

export function getThemeForColor(colorKey) {
  return COLOR_THEME[colorKey] || COLOR_THEME.blue;
}

export function normalizeAgentId(agentId) {
  const raw = String(agentId || '').trim().toLowerCase();
  if (!raw) return '';
  return raw
    .replaceAll('-', '_')
    .replaceAll(' ', '_')
    .replace(/^the_/, '')
    .replace(/^agent_/, '')
    .replace(/^ai_/, '');
}

export function getCouncilPersona(agentId) {
  const id = normalizeAgentId(agentId);
  return COUNCIL_PERSONAS.find((p) => p.id === id) || COUNCIL_PERSONAS[0];
}

export function getArchitecturePersona(layerId) {
  const id = normalizeAgentId(layerId);
  const base = ARCHITECTURE_LAYERS.find((p) => p.id === id) || ARCHITECTURE_LAYERS[0];
  return { ...base, avatar: makeAvatarDataUri(base.name, base.colorKey) };
}

// ---------------------------------------------------------------------------
// Backward compatible exports (older admin UIs)
// ---------------------------------------------------------------------------

export const AGENT_PERSONAS = Object.freeze(
  [...ARCHITECTURE_LAYERS, ...COUNCIL_PERSONAS]
    .filter((p) => p && p.id)
    .reduce((acc, p) => {
      acc[p.id] = {
        ...p,
        // Older UIs use `color`, newer use `colorKey`.
        color: p.colorKey,
        colorKey: p.colorKey,
        avatar: p.avatar || makeAvatarDataUri(p.codeName || p.name, p.colorKey)
      };
      return acc;
    }, {})
);

export function getAgentPersona(agentId) {
  const id = normalizeAgentId(agentId);
  return AGENT_PERSONAS[id] || AGENT_PERSONAS.runtime || Object.values(AGENT_PERSONAS)[0];
}

