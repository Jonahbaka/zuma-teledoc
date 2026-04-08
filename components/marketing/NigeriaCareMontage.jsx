import { cn } from '@/lib/utils';

const CARD_COPY = {
  consultation: {
    eyebrow: 'Online consultation',
    title: 'Speak with a doctor who understands the local care flow',
  },
  family: {
    eyebrow: 'Patient journey',
    title: 'Move from prescription upload to medicine access without losing context',
  },
  pharmacy: {
    eyebrow: 'Pharmacy network',
    title: 'Confirm availability, pricing, pickup, or delivery in one trusted handoff',
  },
};

function ConsultationScene() {
  return (
    <svg viewBox="0 0 340 230" className="h-full w-full" aria-hidden="true">
      <defs>
        <linearGradient id="ng-consult-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0f3d2f" />
          <stop offset="55%" stopColor="#16354f" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>
      </defs>
      <rect width="340" height="230" rx="32" fill="url(#ng-consult-bg)" />
      <circle cx="64" cy="56" r="38" fill="#f59e0b" opacity="0.16" />
      <circle cx="286" cy="182" r="54" fill="#14b8a6" opacity="0.12" />
      <rect x="170" y="48" width="110" height="78" rx="18" fill="#f8fafc" opacity="0.12" />
      <rect x="184" y="62" width="82" height="46" rx="14" fill="#f8fafc" opacity="0.95" />
      <rect x="211" y="113" width="28" height="6" rx="3" fill="#94a3b8" />
      <circle cx="128" cy="104" r="28" fill="#8d5a3b" />
      <path d="M101 102c0-18 15-32 33-32 14 0 24 8 29 19-18 1-34 5-49 13-7 4-13 10-13 0Z" fill="#111827" />
      <path d="M99 148c8-20 19-30 33-30 15 0 27 10 38 30l-12 22H111Z" fill="#f8fafc" />
      <path d="M130 129c0 11-10 19-22 19-12 0-22-8-22-19s10-18 22-18c12 0 22 7 22 18Z" fill="#0f172a" opacity="0.07" />
      <path d="M130 142h11l8 26" stroke="#e2e8f0" strokeWidth="5" strokeLinecap="round" />
      <circle cx="146" cy="172" r="8" fill="#22c55e" />
      <circle cx="238" cy="108" r="19" fill="#7a4c2f" />
      <path d="M220 104c2-13 13-22 27-22 10 0 19 5 24 12-14 2-26 7-38 17-9 8-15 4-13-7Z" fill="#111827" />
      <path d="M208 158c8-21 19-31 31-31 14 0 26 10 34 31l-13 25h-39Z" fill="#0f766e" />
      <path d="M115 174h40" stroke="#cbd5e1" strokeWidth="4" strokeLinecap="round" />
      <path d="M229 173h37" stroke="#99f6e4" strokeWidth="4" strokeLinecap="round" />
      <rect x="38" y="176" width="264" height="22" rx="11" fill="#020617" opacity="0.3" />
      <rect x="43" y="30" width="72" height="22" rx="11" fill="#f8fafc" opacity="0.12" />
      <rect x="50" y="37" width="30" height="8" rx="4" fill="#f8fafc" opacity="0.88" />
      <rect x="86" y="37" width="16" height="8" rx="4" fill="#2dd4bf" />
    </svg>
  );
}

function FamilyScene() {
  return (
    <svg viewBox="0 0 340 230" className="h-full w-full" aria-hidden="true">
      <defs>
        <linearGradient id="ng-family-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#134e4a" />
          <stop offset="52%" stopColor="#14532d" />
          <stop offset="100%" stopColor="#064e3b" />
        </linearGradient>
      </defs>
      <rect width="340" height="230" rx="32" fill="url(#ng-family-bg)" />
      <circle cx="286" cy="48" r="34" fill="#fde68a" opacity="0.12" />
      <circle cx="62" cy="170" r="58" fill="#38bdf8" opacity="0.12" />
      <path d="M141 92c0-22 17-40 39-40 24 0 40 18 40 40 0 22-16 40-40 40-22 0-39-18-39-40Z" fill="#8a5738" />
      <path d="M149 73c6-21 23-33 42-33 16 0 29 9 35 24l-16 6-18-12-14 11-19 6Z" fill="#f59e0b" />
      <path d="M126 168c8-27 25-40 49-40 25 0 42 13 51 40l-12 24h-78Z" fill="#dc2626" opacity="0.88" />
      <path d="M144 135h11l9 19" stroke="#f8fafc" strokeWidth="4" strokeLinecap="round" />
      <circle cx="242" cy="138" r="21" fill="#7a4c2f" />
      <path d="M226 134c2-15 13-24 27-24 11 0 20 6 25 16-15 0-29 4-41 12-9 6-14 3-11-4Z" fill="#111827" />
      <path d="M215 173c7-21 19-31 31-31 13 0 24 10 31 31l-9 20h-48Z" fill="#fb7185" />
      <rect x="46" y="70" width="70" height="88" rx="20" fill="#f8fafc" opacity="0.14" />
      <rect x="57" y="84" width="48" height="58" rx="14" fill="#f8fafc" opacity="0.96" />
      <path d="M72 102h18" stroke="#0f766e" strokeWidth="6" strokeLinecap="round" />
      <path d="M81 93v18" stroke="#0f766e" strokeWidth="6" strokeLinecap="round" />
      <rect x="210" y="50" width="82" height="34" rx="16" fill="#f8fafc" opacity="0.14" />
      <rect x="224" y="61" width="36" height="10" rx="5" fill="#f8fafc" opacity="0.86" />
      <rect x="265" y="61" width="16" height="10" rx="5" fill="#2dd4bf" />
      <rect x="52" y="184" width="240" height="16" rx="8" fill="#020617" opacity="0.28" />
    </svg>
  );
}

function PharmacyScene() {
  return (
    <svg viewBox="0 0 340 230" className="h-full w-full" aria-hidden="true">
      <defs>
        <linearGradient id="ng-pharmacy-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#052e16" />
          <stop offset="55%" stopColor="#134e4a" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>
      </defs>
      <rect width="340" height="230" rx="32" fill="url(#ng-pharmacy-bg)" />
      <circle cx="276" cy="54" r="34" fill="#fde68a" opacity="0.12" />
      <circle cx="80" cy="54" r="28" fill="#34d399" opacity="0.16" />
      <rect x="38" y="56" width="94" height="50" rx="18" fill="#f8fafc" opacity="0.12" />
      <rect x="55" y="70" width="20" height="12" rx="6" fill="#f8fafc" opacity="0.88" />
      <rect x="81" y="70" width="20" height="12" rx="6" fill="#2dd4bf" />
      <rect x="107" y="70" width="12" height="12" rx="6" fill="#f59e0b" />
      <rect x="52" y="161" width="236" height="26" rx="13" fill="#f8fafc" opacity="0.12" />
      <circle cx="170" cy="98" r="26" fill="#8d5a3b" />
      <path d="M148 92c4-18 18-29 36-29 12 0 22 6 28 16-16 0-31 4-46 13-11 7-20 6-18 0Z" fill="#111827" />
      <path d="M139 144c9-23 22-34 36-34 16 0 29 11 37 34l-10 20h-53Z" fill="#f8fafc" />
      <path d="M152 125h35" stroke="#0f766e" strokeWidth="6" strokeLinecap="round" />
      <path d="M169 108v34" stroke="#0f766e" strokeWidth="6" strokeLinecap="round" />
      <path d="M232 118l23 13" stroke="#f8fafc" strokeWidth="6" strokeLinecap="round" />
      <path d="M254 132l13-9c9-6 20-2 24 7l5 10-27 14-15-22Z" fill="#f59e0b" />
      <rect x="230" y="76" width="58" height="34" rx="12" fill="#f8fafc" opacity="0.14" />
      <rect x="246" y="88" width="27" height="10" rx="5" fill="#f8fafc" opacity="0.88" />
      <rect x="122" y="188" width="96" height="12" rx="6" fill="#020617" opacity="0.26" />
    </svg>
  );
}

function SceneArtwork({ variant }) {
  if (variant === 'family') {
    return <FamilyScene />;
  }

  if (variant === 'pharmacy') {
    return <PharmacyScene />;
  }

  return <ConsultationScene />;
}

function SceneCard({ variant, className }) {
  const copy = CARD_COPY[variant];

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[1.7rem] border border-white/10 bg-[linear-gradient(160deg,rgba(3,36,28,0.96),rgba(15,23,42,0.94))] p-3 shadow-[0_22px_60px_rgba(15,23,42,0.28)]',
        className
      )}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_34%),radial-gradient(circle_at_85%_15%,rgba(245,158,11,0.16),transparent_28%)]" />
      <div className="relative flex h-full flex-col gap-3">
        <div className="flex items-center justify-between gap-3 px-1 pt-1">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-200/90">{copy.eyebrow}</div>
            <div className="mt-1 max-w-sm text-sm font-semibold leading-5 text-white">{copy.title}</div>
          </div>
          <div className="rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-100">
            Nigeria
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden rounded-[1.4rem] border border-white/10 bg-black/15">
          <SceneArtwork variant={variant} />
        </div>
      </div>
    </div>
  );
}

export default function NigeriaCareMontage({ compact = false }) {
  return (
    <div className={cn('grid gap-4', compact ? 'grid-cols-1 sm:grid-cols-2' : 'md:grid-cols-[1.08fr_0.92fr]')}>
      <SceneCard
        variant="consultation"
        className={cn(compact ? 'sm:col-span-2 min-h-[17.5rem]' : 'min-h-[20rem] md:min-h-[27rem]')}
      />
      <div className="grid gap-4">
        <SceneCard variant="family" className="min-h-[15rem]" />
        <SceneCard variant="pharmacy" className="min-h-[15rem]" />
      </div>
    </div>
  );
}
