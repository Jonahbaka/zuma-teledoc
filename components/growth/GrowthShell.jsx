import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { pageGraph, serializeJsonLd } from '@/lib/seo/metadata.cjs';

export const primaryLink = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary';
export const secondaryLink = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-background px-6 py-3 font-semibold text-foreground transition hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary';

export default function GrowthShell({ title, description, path, eyebrow, children }) {
  return <main lang="en" className="min-h-screen bg-background text-foreground">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(pageGraph({ title, description, path, breadcrumbs: [['DoctaRx', '/'], [title, path]] })) }} />
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 md:py-12">
      <nav aria-label="Public site" className="flex flex-wrap items-center justify-between gap-5 border-b border-border pb-6">
        <Link href="/" className="text-2xl font-bold tracking-tight">DoctaRx<span className="sr-only"> home</span></Link>
        <div className="flex flex-wrap gap-5 text-sm font-medium">
          <Link href="/for-providers" aria-current={path === '/for-providers' ? 'page' : undefined} className="underline-offset-4 hover:underline aria-[current=page]:underline">For providers</Link>
          <Link href="/partners" aria-current={path === '/partners' ? 'page' : undefined} className="underline-offset-4 hover:underline aria-[current=page]:underline">Partnerships</Link>
          <Link href="/international" className="underline-offset-4 hover:underline">Languages &amp; locations</Link>
        </div>
      </nav>
      <div className="pt-12 md:pt-20"><p className="text-sm font-bold uppercase tracking-widest text-primary">{eyebrow}</p></div>
      {children}
      <footer className="mt-16 flex flex-wrap justify-between gap-5 border-t border-border py-8 text-sm text-muted-foreground">
        <p>Connected care, with people at the centre.</p>
        <div className="flex flex-wrap gap-5">
          <Link href="/contact" className="inline-flex items-center gap-1 underline underline-offset-4">Contact <ArrowUpRight size={14} aria-hidden="true" /></Link>
          <Link href="/privacy" className="underline underline-offset-4">Privacy</Link>
          <Link href="/accessibility" className="underline underline-offset-4">Accessibility</Link>
        </div>
      </footer>
    </div>
  </main>;
}
