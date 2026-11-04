import { NextResponse } from 'next/server';
import { isLegacyCreatorAssetPath } from './lib/legacyCreatorAssets.cjs';

// next dev/start and the frontend-only CareOps profile do not use Express's
// guard. Prevent direct access to historical ownerless creator files there too.
export function middleware(request) {
  if (isLegacyCreatorAssetPath(request.nextUrl.pathname)) {
    return new NextResponse(null, {
      status: 404,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
  return NextResponse.next();
}

// Include encoded path prefixes, not only the literal /uploads/creator prefix.
export const config = { matcher: '/:path*' };
