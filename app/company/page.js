import Link from 'next/link';
import PublicShare from '@/components/growth/PublicShare';
import { ArrowUpRight, AudioLines, ClipboardList, Network, Video } from 'lucide-react';
import { publicMetadata, pageGraph, serializeJsonLd } from '@/lib/seo/metadata.cjs';

const title = 'The company behind connected care';
const description = 'Explore DoctaRx: connected virtual care, multilingual voice and clinical workflows. Meet the product, our direction and opportunities to collaborate.';
const baseMetadata = publicMetadata({ title, description, path: '/company' });
export const metadata = { ...baseMetadata,
  openGraph: { ...baseMetadata.openGraph, images: [{ url: 'https://doctarx.com/company/opengraph-image', width: 1200, height: 630, alt: 'DoctaRx — Care should stay connected' }] },
  twitter: { ...baseMetadata.twitter, images: ['https://doctarx.com/company/opengraph-image'] },
};
const capabilities = [
  { icon: Video, title: 'A conversation that connects', body: 'Patient and provider experiences bring appointment access, video visits and follow-up into a shared care journey.' },
  { icon: AudioLines, title: 'More ways to be understood', body: 'Live voice, speech-to-text and text-to-speech fallback support the product’s voice experience. Clinical voice validation remains in progress; language and service availability depend on configuration.' },
  { icon: ClipboardList, title: 'The work around the visit', body: 'The platform includes workflows for records, prescriptions, pharmacy coordination, referrals and lab handoffs, with role-based access and clinical ownership.' },
  { icon: Network, title: 'Built with local context', body: 'Regional and multilingual experiences help people explore care options. Actual access depends on location, participating providers and locally available services.' },
];

export default function CompanyPage() {
  return <main className="min-h-screen bg-background text-foreground">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(pageGraph({ title, description, path: '/company', breadcrumbs: [['DoctaRx', '/'], ['Company', '/company']] })) }} />
    <div className="mx-auto max-w-6xl px-6 py-12 md:py-20">
      <nav aria-label="Company navigation" className="flex flex-wrap items-center justify-between gap-5">
        <Link href="/" className="text-xl font-bold underline underline-offset-4">DoctaRx</Link>
        <div className="flex gap-6"><Link href="/press" className="underline underline-offset-4">Press kit</Link><Link href="/contact" className="underline underline-offset-4">Get in touch</Link></div>
      </nav>
      <header className="py-16 md:py-24">
        <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Our direction</p>
        <h1 className="mt-5 max-w-4xl text-5xl font-bold leading-tight tracking-tight md:text-7xl">Care should stay connected.</h1>
        <p className="mt-8 max-w-3xl text-xl leading-9">From the first question to the next step, DoctaRx is building a more connected experience for patients, providers and care teams.</p>
        <div className="mt-9 flex flex-wrap gap-4">
          <Link href="/" className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground">Explore the platform <ArrowUpRight className="h-5 w-5" aria-hidden="true" /></Link>
          <a href="mailto:info@doctarx.com?subject=DoctaRx%20company%20and%20investment%20enquiry" className="rounded-lg border border-current px-6 py-3 font-semibold">Talk with the team</a>
        </div>
      </header>
      <section aria-labelledby="company-opportunity" className="grid gap-6 border-y border-border py-10 md:grid-cols-2 md:gap-16">
        <h2 id="company-opportunity" className="text-3xl font-semibold leading-tight">The visit is one moment.<br />The journey is much bigger.</h2>
        <div className="space-y-4 text-lg leading-8"><p>Booking, conversations, records and the next care step often happen in different places. Our product direction is to help those steps work together.</p><p>We are building around a practical idea: make the experience useful for care teams, and make it easier for patients to stay connected to their care.</p></div>
      </section>
      <section aria-labelledby="company-platform" className="py-14">
        <h2 id="company-platform" className="text-3xl font-semibold">One platform. Connected workflows.</h2>
        <div className="mt-8 grid gap-6 md:grid-cols-2">{capabilities.map(({ icon: Icon, title: heading, body }) => <article key={heading} className="rounded-2xl border border-border p-7">
          <Icon className="h-7 w-7 text-primary" aria-hidden="true" /><h3 className="mt-5 text-xl font-semibold">{heading}</h3><p className="mt-3 leading-7 text-muted-foreground">{body}</p>
        </article>)}</div>
      </section>
      <section aria-labelledby="company-next" className="rounded-2xl bg-muted p-8 md:p-12">
        <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">The next chapter</p>
        <h2 id="company-next" className="mt-4 max-w-3xl text-3xl font-semibold">Built for collaboration. Ambitious about access.</h2>
        <p className="mt-5 max-w-3xl text-lg leading-8">Our ambition is to make connected care useful across languages and local health systems. We welcome conversations with clinicians, clinics, pharmacy teams, implementation partners and investors who want to understand the product and help shape its next steps.</p>
        <p className="mt-4 max-w-3xl leading-7">For product demonstrations, market availability or company information, contact the team. We confirm service scope directly rather than assuming every workflow is available in every country.</p>
        <div className="mt-7 flex flex-wrap gap-6"><Link href="/contact" className="font-semibold underline underline-offset-4">Start a conversation</Link><Link href="/international" className="font-semibold underline underline-offset-4">Explore available languages</Link><Link href="/press" className="font-semibold underline underline-offset-4">Get the media kit</Link></div>
      </section>
      <div className="mt-12"><PublicShare destination="company" heading="Share the DoctaRx introduction." /></div>
      <footer className="mt-12 flex flex-wrap gap-6 text-sm"><Link href="/privacy" className="underline underline-offset-4">Privacy</Link><Link href="/terms" className="underline underline-offset-4">Terms</Link><a href="mailto:info@doctarx.com" className="underline underline-offset-4">info@doctarx.com</a></footer>
    </div>
  </main>;
}
