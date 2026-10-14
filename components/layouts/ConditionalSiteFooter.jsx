'use client';

import { usePathname } from 'next/navigation';
import SiteFooter from './SiteFooter';
import { CAREOPS_PROFILE } from '@/lib/careopsProfile';

const HIDE_PREFIXES = [
  '/careops',
  '/ng/phc',
  '/ng/government-data',
  '/patient',
  '/provider',
  '/admin',
  '/pharmacy',
  '/secure',
  '/ng/patient',
  '/ng/provider',
  '/ng/pharmacy',
  '/ng/admin',
  '/ng/auth',
  '/access',
];
const HIDE_EXACT = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email', '/signup'];

export default function ConditionalSiteFooter() {
  const pathname = usePathname() || '/';
  if (CAREOPS_PROFILE) return null;

  if (HIDE_EXACT.includes(pathname)) return null;
  if (HIDE_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  return <SiteFooter />;
}


