import Image from 'next/image';
import Link from 'next/link';
import { Download } from 'lucide-react';
import PressKit from '@/components/marketing/PressKit';
import PublicShare from '@/components/growth/PublicShare';
import { publicMetadata, pageGraph, serializeJsonLd } from '@/lib/seo/metadata.cjs';

const title = 'DoctaRx press and media kit';
const description = 'Download DoctaRx brand assets, a public product screenshot and a company fact sheet. Get concise descriptions and contact the team for media enquiries.';
const baseMetadata = publicMetadata({ title, description, path: '/press' });
export const metadata = { ...baseMetadata,
  openGraph: { ...baseMetadata.openGraph, images: [{ url: 'https://doctarx.com/press/opengraph-image', width: 1200, height: 630, alt: 'DoctaRx — The media kit' }] },
  twitter: { ...baseMetadata.twitter, images: ['https://doctarx.com/press/opengraph-image'] },
};
const shortDescription = 'DoctaRx is a connected virtual care and clinical operations platform bringing patient access, provider workflows and care coordination into one product.';
const extendedDescription = 'DoctaRx brings together patient and provider experiences for appointments, video visits, records, prescriptions, pharmacy coordination, referrals and lab handoffs. Its voice experience includes live voice with speech-to-text and text-to-speech fallback. The product’s direction is connected care across languages and local health systems. Clinical voice validation remains in progress, and service availability depends on location, participating providers and configuration.';

export default function PressPage() {
  return <main className="min-h-screen bg-background text-foreground">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(pageGraph({ title, description, path: '/press', breadcrumbs: [['DoctaRx', '/'], ['Press', '/press']] })) }} />
    <div className="mx-auto max-w-6xl px-6 py-12 md:py-20">
      <nav aria-label="Press navigation" className="flex flex-wrap items-center justify-between gap-5"><Link href="/" className="text-xl font-bold underline underline-offset-4">DoctaRx</Link><Link href="/company" className="underline underline-offset-4">Company story</Link></nav>
      <header className="py-14 md:py-20">
        <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">For writers, creators and collaborators</p>
        <h1 className="mt-5 text-4xl font-bold tracking-tight md:text-6xl">The DoctaRx media kit.</h1>
        <p className="mt-6 max-w-3xl text-xl leading-8">A clear introduction. Useful assets. A direct line to the team.</p>
        <div className="mt-8 flex flex-wrap gap-4"><a href="/press/doctarx-fact-sheet.txt" download className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground"><Download className="h-5 w-5" aria-hidden="true" />Download fact sheet (.txt)</a><a href="mailto:info@doctarx.com?subject=DoctaRx%20media%20enquiry" className="rounded-lg border border-current px-5 py-3 font-semibold">Contact the team</a></div>
      </header>
      <section aria-labelledby="press-descriptions"><h2 id="press-descriptions" className="text-3xl font-semibold">Ready-to-use descriptions</h2><div className="mt-7 grid gap-6 md:grid-cols-2"><PressKit label="Short description" text={shortDescription} /><PressKit label="Product overview" text={extendedDescription} /></div></section>
      <section aria-labelledby="press-assets" className="mt-14">
        <h2 id="press-assets" className="text-3xl font-semibold">Brand and product assets</h2>
        <div className="mt-7 grid gap-6 md:grid-cols-3">
          <article className="rounded-2xl border border-border p-6"><div className="flex h-44 items-center justify-center rounded-xl bg-slate-100"><Image src="/icon.svg" width={112} height={112} alt="DoctaRx D and heartbeat brand icon" /></div><h3 className="mt-5 text-xl font-semibold">Brand icon</h3><p className="mt-3 leading-7 text-muted-foreground">The existing DoctaRx icon in scalable and raster formats.</p><div className="mt-5 flex gap-5"><a href="/icon.svg" download="doctarx-icon.svg" className="font-semibold underline underline-offset-4">SVG</a><a href="/icon-512.png" download="doctarx-icon-512.png" className="font-semibold underline underline-offset-4">PNG · 512 px</a></div></article>
          <article className="rounded-2xl border border-border p-6 md:col-span-2"><a href="/press/doctarx-homepage.png" className="block overflow-hidden rounded-xl border border-border"><Image src="/press/doctarx-homepage.png" width={1440} height={1000} alt="Public DoctaRx homepage captured on November 5, 2026, without patient or account data" className="h-auto w-full" /></a><h3 className="mt-5 text-xl font-semibold">Public product screenshot</h3><p className="mt-3 leading-7 text-muted-foreground">The public homepage, captured November 5, 2026. This is a marketing interface, not a clinical encounter or a customer endorsement.</p><a href="/press/doctarx-homepage.png" download className="mt-5 inline-block font-semibold underline underline-offset-4">Download screenshot (.png)</a></article>
        </div>
        <p className="mt-6 max-w-4xl leading-7 text-muted-foreground">Use these assets to identify DoctaRx in accurate coverage. Keep the brand name spelled “DoctaRx”, preserve icon proportions, and identify screenshots as product imagery. Asset use does not imply a partnership or endorsement.</p>
      </section>
      <section aria-labelledby="press-facts" className="mt-14 rounded-2xl bg-muted p-7 md:p-10">
        <h2 id="press-facts" className="text-3xl font-semibold">Quick facts</h2>
        <dl className="mt-6 grid gap-6 sm:grid-cols-2"><div><dt className="font-semibold">Product</dt><dd className="mt-2">Connected virtual care and clinical operations</dd></div><div><dt className="font-semibold">Website</dt><dd className="mt-2"><a href="https://doctarx.com" className="underline underline-offset-4">doctarx.com</a></dd></div><div><dt className="font-semibold">Media and company enquiries</dt><dd className="mt-2"><a href="mailto:info@doctarx.com" className="underline underline-offset-4">info@doctarx.com</a></dd></div><div><dt className="font-semibold">Voice</dt><dd className="mt-2 leading-7">Live voice plus speech-to-text and text-to-speech fallback; clinical validation in progress.</dd></div></dl>
        <p className="mt-8 leading-7">Contact the team to confirm current service availability, arrange a demonstration or request company information for publication. Public language pages do not establish clinical service coverage in a country.</p>
      </section>
      <section aria-labelledby="launch-kit" className="mt-14 rounded-2xl border border-border p-7">
        <h2 id="launch-kit" className="text-3xl font-semibold">Launch resources</h2>
        <p className="mt-4 leading-7">Use these editable introductions and fictional demonstration scripts to explain DoctaRx to your community.</p>
        <ul className="mt-5 space-y-4">
          <li><a href="/launch-kit/doctarx-overview.md" download className="underline underline-offset-4">Product overview (.md)</a></li>
          <li><a href="/launch-kit/social-launch-pack.md" download className="underline underline-offset-4">12 social posts and video scripts (.md)</a></li>
          <li><a href="/launch-kit/founder-demo-storyboard.md" download className="underline underline-offset-4">90-second demo storyboard (.md)</a></li>
        </ul>
      </section>
      <div className="mt-12"><PublicShare destination="press" heading="Pass the media kit along." /></div>
      <footer className="mt-12 flex flex-wrap gap-6 text-sm"><Link href="/company" className="underline underline-offset-4">Company</Link><Link href="/contact" className="underline underline-offset-4">Contact</Link><Link href="/privacy" className="underline underline-offset-4">Privacy</Link></footer>
    </div>
  </main>;
}
