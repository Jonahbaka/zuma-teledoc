/** @type {import('next').NextConfig} */
const { resolveDeploymentProfile } = require('./lib/deploymentProfile.cjs');
const deployment = resolveDeploymentProfile();
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  poweredByHeader: false,
  compress: true,
  distDir: deployment.distDir,
  productionBrowserSourceMaps: false,
  outputFileTracingRoot: __dirname,
  // Permit reproducible validation on hosts with limited cache disk space.
  // Build artifacts and compiler checks are still produced normally.
  webpack(config) {
    if (process.env.DOCTARX_DISABLE_BUILD_CACHE === 'true') config.cache = false;
    return config;
  },
  
  // Security headers
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate'
          }
        ]
      },
      {
        source: '/manifest.webmanifest',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/manifest+json'
          },
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate'
          }
        ]
      },
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(self), geolocation=(self)'
          },
          ...(deployment.careops ? [
            { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
            { key: 'X-DoctaRx-Product', value: 'careops' },
            { key: 'X-DoctaRx-Deployment', value: deployment.deploymentId },
            { key: 'Content-Security-Policy', value: `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' ${deployment.mediaOrigins.join(' ')}; media-src 'self' blob: mediastream:; worker-src 'self' blob:; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'` },
          ] : [])
        ]
      }
    ];
  },

  async redirects() {
    return [
      ...(deployment.careops ? [
        { source: '/', destination: '/careops', permanent: false },
        { source: '/login', destination: '/careops/login', permanent: false },
        { source: '/robots.txt', destination: '/careops/robots', permanent: false },
        { source: '/sitemap.xml', destination: '/careops/sitemap', permanent: false },
      ] : []),
      { source: '/ng/secure/admin', destination: '/ng/admin/login', permanent: false },
      { source: '/ng/secure/admin/:path*', destination: '/ng/admin/login', permanent: false },
    ];
  },
  async rewrites() {
    return deployment.careops && deployment.apiProxyTarget ? [
      { source: '/api/:path*', destination: `${deployment.apiProxyTarget}/:path*` },
      { source: '/socket.io/:path*', destination: `${new URL(deployment.apiProxyTarget).origin}/socket.io/:path*` },
    ] : [];
  },

  // Environment variables exposed to client
  env: {
    NEXT_PUBLIC_DOCTARX_PRODUCT_PROFILE: deployment.profile,
    ...(deployment.careops ? { NEXT_PUBLIC_API_URL: '/api', NEXT_PUBLIC_DOCTARX_DEPLOYMENT_ID: deployment.deploymentId } : {}),
    NEXT_PUBLIC_APP_NAME: 'DoctaRx',
    NEXT_PUBLIC_APP_VERSION: '1.0.0',
    NEXT_PUBLIC_APP_DOMAIN: deployment.careops ? new URL(deployment.appOrigin).hostname : 'doctarx.com'
  },

  // Image optimization
  images: {
    // The production custom server serves public image files reliably, but the
    // Next image optimizer route is not available behind the current Express/Nginx
    // deployment path. Serve the checked-in responsive assets directly instead of
    // rendering broken /_next/image URLs in production.
    unoptimized: true,
    domains: ['doctarx.com', 'www.doctarx.com', 'localhost'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'doctarx.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.stripe.com',
        pathname: '/**',
      }
    ],
    formats: ['image/avif', 'image/webp']
  },

  // Experimental features
  experimental: {
    optimizePackageImports: ['lucide-react'],
    serverActions: {
      allowedOrigins: ['doctarx.com', 'www.doctarx.com', 'localhost:3000']
    }
  }
};

module.exports = nextConfig;

