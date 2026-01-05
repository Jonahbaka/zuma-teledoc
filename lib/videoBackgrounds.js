// Google Meet-inspired virtual background presets.
// Values are tokens interpreted by SelfieCamera:
// - null: no effect
// - blur:soft|blur:strong: blur background with different strengths
// - color:#RRGGBB: solid color background
// - gradient:<name>: gradient background
// - https://...: image background URL

export const VIDEO_BG_PRESETS = [
  { id: 'none', name: 'None', type: 'none', value: null },

  // Blur levels (Meet-style)
  { id: 'blur-soft', name: 'Blur', type: 'blur', value: 'blur:soft' },
  { id: 'blur-strong', name: 'Blur+', type: 'blur', value: 'blur:strong' },

  // Gradients (lightweight, no external requests)
  { id: 'grad-studio', name: 'Studio', type: 'gradient', value: 'gradient:studio' },
  { id: 'grad-ocean', name: 'Ocean', type: 'gradient', value: 'gradient:ocean' },
  { id: 'grad-sunset', name: 'Sunset', type: 'gradient', value: 'gradient:sunset' },
  { id: 'grad-aurora', name: 'Aurora', type: 'gradient', value: 'gradient:aurora' },

  // Solid colors (good for low bandwidth / clarity)
  { id: 'color-dark', name: 'Dim', type: 'color', value: 'color:#0f172a' },
  { id: 'color-slate', name: 'Slate', type: 'color', value: 'color:#334155' },
  { id: 'color-white', name: 'Light', type: 'color', value: 'color:#f8fafc' },

  // Curated images (Meet-style)
  { id: 'img-office', name: 'Office', type: 'image', value: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=800&q=80' },
  { id: 'img-nature', name: 'Nature', type: 'image', value: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=800&q=80' },
  { id: 'img-clinic', name: 'Clinic', type: 'image', value: 'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=800&q=80' },
  { id: 'img-library', name: 'Library', type: 'image', value: 'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?auto=format&fit=crop&w=800&q=80' },
  { id: 'img-cabin', name: 'Cabin', type: 'image', value: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=800&q=80' },
  { id: 'img-abstract', name: 'Abstract', type: 'image', value: 'https://images.unsplash.com/photo-1541701494587-cb58502866ab?auto=format&fit=crop&w=800&q=80' }
];


