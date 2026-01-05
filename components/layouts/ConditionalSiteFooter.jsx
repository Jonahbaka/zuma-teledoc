'use client';

import { usePathname } from 'next/navigation';
import SiteFooter from './SiteFooter';

const HIDE_PREFIXES = ['/patient', '/provider', '/admin'];
const HIDE_EXACT = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email'];

export default function ConditionalSiteFooter() {
  const pathname = usePathname() || '/';

  if (HIDE_EXACT.includes(pathname)) return null;
  if (HIDE_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  return <SiteFooter />;
}


