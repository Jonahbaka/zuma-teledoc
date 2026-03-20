// Google Meet-inspired virtual background presets.
// Values are tokens interpreted by SelfieCamera:
// - null: no effect
// - blur:soft|blur:strong: blur background with different strengths
// - color:#RRGGBB: solid color background
// - gradient:<name>: gradient background
// - data:image/...: image background URI

const toDataUri = (svg) => `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;

const abstractScene = (start, mid, end) =>
  toDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" fill="none">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${start}" />
          <stop offset="55%" stop-color="${mid}" />
          <stop offset="100%" stop-color="${end}" />
        </linearGradient>
      </defs>
      <rect width="800" height="600" fill="url(#bg)" />
      <circle cx="170" cy="160" r="120" fill="white" fill-opacity="0.14" />
      <circle cx="640" cy="150" r="90" fill="white" fill-opacity="0.12" />
      <circle cx="590" cy="430" r="150" fill="white" fill-opacity="0.10" />
      <path d="M110 470C180 360 300 310 420 330C520 348 600 420 690 440V600H110V470Z" fill="white" fill-opacity="0.11" />
      <rect x="92" y="84" width="248" height="158" rx="28" fill="white" fill-opacity="0.12" />
      <rect x="128" y="122" width="176" height="14" rx="7" fill="white" fill-opacity="0.6" />
      <rect x="128" y="152" width="126" height="10" rx="5" fill="white" fill-opacity="0.4" />
      <rect x="458" y="112" width="218" height="140" rx="30" fill="white" fill-opacity="0.12" />
      <rect x="495" y="148" width="132" height="12" rx="6" fill="white" fill-opacity="0.55" />
      <rect x="495" y="176" width="92" height="10" rx="5" fill="white" fill-opacity="0.4" />
      <rect x="274" y="244" width="252" height="188" rx="34" fill="white" fill-opacity="0.12" />
      <rect x="312" y="282" width="176" height="14" rx="7" fill="white" fill-opacity="0.55" />
      <rect x="312" y="316" width="128" height="10" rx="5" fill="white" fill-opacity="0.38" />
      <rect x="312" y="348" width="152" height="10" rx="5" fill="white" fill-opacity="0.3" />
    </svg>
  `);

export const VIDEO_BG_PRESETS = [
  { id: 'none', name: 'None', type: 'none', value: null },

  { id: 'blur-soft', name: 'Blur', type: 'blur', value: 'blur:soft' },
  { id: 'blur-strong', name: 'Blur+', type: 'blur', value: 'blur:strong' },

  { id: 'grad-studio', name: 'Studio', type: 'gradient', value: 'gradient:studio' },
  { id: 'grad-ocean', name: 'Ocean', type: 'gradient', value: 'gradient:ocean' },
  { id: 'grad-sunset', name: 'Sunset', type: 'gradient', value: 'gradient:sunset' },
  { id: 'grad-aurora', name: 'Aurora', type: 'gradient', value: 'gradient:aurora' },

  { id: 'color-dark', name: 'Dim', type: 'color', value: 'color:#0f172a' },
  { id: 'color-slate', name: 'Slate', type: 'color', value: 'color:#334155' },
  { id: 'color-white', name: 'Light', type: 'color', value: 'color:#f8fafc' },

  { id: 'img-atrium', name: 'Atrium', type: 'image', value: abstractScene('#0f172a', '#1d4ed8', '#06b6d4') },
  { id: 'img-aurora', name: 'Aurora', type: 'image', value: abstractScene('#052e16', '#0f766e', '#22c55e') },
  { id: 'img-signal', name: 'Signal', type: 'image', value: abstractScene('#1e1b4b', '#7c3aed', '#ec4899') },
  { id: 'img-sand', name: 'Sand', type: 'image', value: abstractScene('#431407', '#c2410c', '#f59e0b') },
  { id: 'img-cloud', name: 'Cloud', type: 'image', value: abstractScene('#0f172a', '#475569', '#94a3b8') },
  { id: 'img-grid', name: 'Grid', type: 'image', value: abstractScene('#082f49', '#155e75', '#14b8a6') },
];
