'use client';
import Link from 'next/link';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';
import PharmacyLocator from '@/components/PharmacyLocator';

export default function PublicPharmacyDirectory({ market='US' }) {
  const nigeria=market==='NG';
  const home=nigeria?'/ng':'/';
  const patient=nigeria?'/ng/patient':'/patient';
  return <div className="doctarx-site min-h-[70vh] bg-[#f4f7fc] text-slate-950">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex min-h-24 max-w-[1440px] items-center justify-between gap-4 px-5 sm:px-8"><Link href={home} aria-label="DoctaRx home"><DoctaRxLogo tone="dark" glow={false} className="h-10 w-auto max-w-[160px]" /></Link><div className="flex gap-3"><Link href={home} className="inline-flex min-h-12 items-center rounded-xl px-4 font-medium text-blue-700">Home</Link><Link href={patient+'/login'} className="inline-flex min-h-12 items-center rounded-xl border border-slate-300 px-4 font-semibold">Sign in</Link></div></div></header>
    <main className="mx-auto max-w-[1440px] px-5 py-10 sm:px-8 sm:py-14"><div className="mb-8 max-w-3xl"><p className="font-semibold text-blue-700">DOCTARX · PHARMACY DIRECTORY</p><h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Pharmacies near you.</h1><p className="mt-5 text-lg leading-8 text-slate-600">Browse near your device, or choose an area closer to home or work. Confirm opening hours, services, and medication availability with the pharmacy.</p></div><PharmacyLocator /></main>
  </div>;
}
