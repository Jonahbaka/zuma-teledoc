'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowUpRight, Mail } from 'lucide-react';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';

export default function SiteFooter() {
  const nigeria=(usePathname()||'/').startsWith('/ng');
  const patient=nigeria?'/ng/patient':'/patient', provider=nigeria?'/ng/provider':'/provider', pharmacy=nigeria?'/ng/pharmacy':'/pharmacy';
  const columns=[
    ['Your care',[['Find care',nigeria?'/ng/find-care':patient+'/appointments/book'],['Patient sign in',patient+'/login'],['Find pharmacies',nigeria?'/ng/pharmacies':'/pharmacies'],['Frequently asked questions','/faq']]],
    ['Professionals',[['Provider sign in',provider+'/login'],['Join as a provider',provider+'/register'],['Pharmacy sign in',pharmacy+'/login'],['DoctaRx CareOps','/careops/login']]],
    ['About DoctaRx',[['Contact us','/contact'],['Privacy policy','/privacy'],['Terms of use','/terms'],['Accessibility','/accessibility']]],
  ];
  return <footer className="bg-[#101d36] text-white"><div className="mx-auto max-w-[1440px] px-5 py-14 sm:px-8 lg:py-16"><div className="grid gap-10 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]"><div><Link href={nigeria?'/ng':'/'} aria-label="DoctaRx home"><DoctaRxLogo glow={false} className="h-11 w-auto max-w-[190px]" /></Link><p className="mt-6 max-w-sm text-xl leading-8 text-white">Your care.<br />Connected.</p><p className="mt-4 max-w-sm leading-7 text-slate-300">Clear choices and connected care, from the first conversation to the next step.</p><a href="mailto:info@doctarx.com" className="mt-5 inline-flex min-h-12 items-center gap-3 font-medium text-white hover:text-blue-200"><Mail className="h-5 w-5" aria-hidden="true" />info@doctarx.com</a></div>{columns.map(([title,links])=><nav key={title} aria-label={title}><h2 className="text-lg font-semibold text-white">{title}</h2><ul className="mt-5 space-y-2">{links.map(([label,href])=><li key={href}><Link href={href} className="inline-flex min-h-12 items-center leading-7 text-slate-300 hover:text-white">{label}</Link></li>)}</ul></nav>)}</div><div className="mt-12 flex flex-wrap items-center justify-between gap-6 border-t border-white/20 pt-7"><p className="leading-7 text-slate-300">© {new Date().getFullYear()} DoctaRx. All rights reserved.</p><div className="flex flex-wrap gap-5"><Link href="/" className="inline-flex min-h-12 items-center gap-2 text-slate-300 hover:text-white" aria-current={!nigeria?'page':undefined}>United States<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Link><Link href="/ng" className="inline-flex min-h-12 items-center gap-2 text-slate-300 hover:text-white" aria-current={nigeria?'page':undefined}>Nigeria<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Link></div></div></div></footer>;
}
