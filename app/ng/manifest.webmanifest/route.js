const manifest = {
  name: 'DoctaRx Nigeria',
  short_name: 'DoctaRx NG',
  description:
    'DoctaRx Nigeria delivers mobile-ready virtual care, subscriptions, prescriptions, pharmacy coordination, and provider access.',
  start_url: '/ng',
  id: '/ng',
  scope: '/ng',
  display: 'standalone',
  display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
  orientation: 'any',
  background_color: '#ecfdf5',
  theme_color: '#047857',
  dir: 'ltr',
  lang: 'en-NG',
  prefer_related_applications: false,
  launch_handler: {
    client_mode: 'navigate-existing',
  },
  categories: ['medical', 'health', 'productivity'],
  icons: [
    {
      src: '/icon-192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/icon-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/icon-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any maskable',
    },
  ],
  shortcuts: [
    {
      name: 'Nigeria Patient Login',
      short_name: 'Patient',
      url: '/ng/patient/login',
    },
    {
      name: 'Nigeria Provider Login',
      short_name: 'Provider',
      url: '/ng/provider/login',
    },
    {
      name: 'Nigeria Pharmacy Login',
      short_name: 'Pharmacy',
      url: '/ng/pharmacy/login',
    },
    {
      name: 'Nigeria Pricing',
      short_name: 'Pricing',
      url: '/ng/pricing',
    },
  ],
};

export function GET() {
  return Response.json(manifest, {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}
