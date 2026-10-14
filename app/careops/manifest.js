export default function manifest() {
  return { id: '/careops', name: 'DoctaRx CareOps', short_name: 'DoctaRx CareOps',
    description: 'Clinical collaboration and scoped institutional reporting.',
    start_url: '/careops', scope: '/careops', display: 'standalone', lang: 'en',
    background_color: '#f8fafc', theme_color: '#101d36',
    icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
    shortcuts: [{ name: 'Sign in to CareOps', url: '/careops/login' }],
  };
}
