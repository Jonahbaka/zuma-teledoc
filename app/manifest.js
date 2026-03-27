export default function manifest() {
  return {
    name: 'DoctaRx',
    short_name: 'DoctaRx',
    description:
      'DoctaRx delivers secure virtual care, prescriptions, messaging, and pharmacy coordination in a mobile-ready experience.',
    start_url: '/?source=pwa',
    id: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'portrait',
    background_color: '#020617',
    theme_color: '#0f172a',
    dir: 'ltr',
    lang: 'en',
    prefer_related_applications: false,
    launch_handler: {
      client_mode: 'navigate-existing'
    },
    categories: ['medical', 'health', 'productivity'],
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any'
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any'
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable'
      }
    ],
    shortcuts: [
      {
        name: 'Patient Login',
        short_name: 'Patient',
        url: '/patient/login'
      },
      {
        name: 'Provider Login',
        short_name: 'Provider',
        url: '/provider/login'
      },
      {
        name: 'Nigeria',
        short_name: 'Nigeria',
        url: '/ng'
      }
    ]
  };
}
