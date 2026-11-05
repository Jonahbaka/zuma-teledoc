import { NextResponse } from 'next/server';
import { isLegacyCreatorAssetPath } from './lib/legacyCreatorAssets.cjs';
import { shouldNoIndex } from './lib/seo/public-seo-config.cjs';

// next dev/start and the frontend-only CareOps profile do not use Express's
// guard. Prevent direct access to historical ownerless creator files there too.
export function middleware(request) {
  if (isLegacyCreatorAssetPath(request.nextUrl.pathname)) {
    return new NextResponse(null, {
      status: 404,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
  const response = NextResponse.next();
  if (shouldNoIndex(request.url)) response.headers.set('X-Robots-Tag', 'noindex, nofollow, nosnippet');
  return response;
}

// Include encoded path prefixes, not only the literal /uploads/creator prefix.
export const config = { matcher: '/:path*' };
