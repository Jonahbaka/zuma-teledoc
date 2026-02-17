// Tailwind-safe theme helpers for agent personas.
// Avoid dynamic class construction like `border-${color}-500` because Tailwind won't emit those utilities.
const THEMES = Object.freeze({
  blue: {
    gradient: 'from-blue-600 to-cyan-500',
    ring: 'ring-blue-500/30',
    border: 'border-blue-500/30',
    text: 'text-blue-400',
    glow: 'shadow-[0_0_25px_rgba(37,99,235,0.18)]'
  },
  purple: {
    gradient: 'from-purple-600 to-fuchsia-500',
    ring: 'ring-purple-500/30',
    border: 'border-purple-500/30',
    text: 'text-purple-400',
    glow: 'shadow-[0_0_25px_rgba(168,85,247,0.16)]'
  },
  amber: {
    gradient: 'from-amber-600 to-orange-500',
    ring: 'ring-amber-500/30',
    border: 'border-amber-500/30',
    text: 'text-amber-400',
    glow: 'shadow-[0_0_25px_rgba(245,158,11,0.12)]'
  },
  emerald: {
    gradient: 'from-emerald-600 to-teal-500',
    ring: 'ring-emerald-500/30',
    border: 'border-emerald-500/30',
    text: 'text-emerald-400',
    glow: 'shadow-[0_0_25px_rgba(16,185,129,0.12)]'
  },
  cyan: {
    gradient: 'from-cyan-600 to-sky-500',
    ring: 'ring-cyan-500/30',
    border: 'border-cyan-500/30',
    text: 'text-cyan-400',
    glow: 'shadow-[0_0_25px_rgba(6,182,212,0.12)]'
  },
  red: {
    gradient: 'from-red-700 to-rose-600',
    ring: 'ring-red-500/30',
    border: 'border-red-500/30',
    text: 'text-red-400',
    glow: 'shadow-[0_0_25px_rgba(239,68,68,0.12)]'
  },
  yellow: {
    gradient: 'from-yellow-600 to-amber-500',
    ring: 'ring-yellow-500/30',
    border: 'border-yellow-500/30',
    text: 'text-yellow-300',
    glow: 'shadow-[0_0_25px_rgba(234,179,8,0.12)]'
  },
  indigo: {
    gradient: 'from-indigo-600 to-blue-600',
    ring: 'ring-indigo-500/30',
    border: 'border-indigo-500/30',
    text: 'text-indigo-300',
    glow: 'shadow-[0_0_25px_rgba(99,102,241,0.12)]'
  },
  violet: {
    gradient: 'from-violet-600 to-purple-600',
    ring: 'ring-violet-500/30',
    border: 'border-violet-500/30',
    text: 'text-violet-300',
    glow: 'shadow-[0_0_25px_rgba(139,92,246,0.12)]'
  },
  orange: {
    gradient: 'from-orange-600 to-amber-600',
    ring: 'ring-orange-500/30',
    border: 'border-orange-500/30',
    text: 'text-orange-300',
    glow: 'shadow-[0_0_25px_rgba(249,115,22,0.12)]'
  },
  lime: {
    gradient: 'from-lime-600 to-emerald-600',
    ring: 'ring-lime-500/30',
    border: 'border-lime-500/30',
    text: 'text-lime-300',
    glow: 'shadow-[0_0_25px_rgba(132,204,22,0.12)]'
  }
});

export function getAgentTheme(color) {
  return THEMES[color] || THEMES.blue;
}

