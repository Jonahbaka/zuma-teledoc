import Link from 'next/link';
import guides from '@/lib/seo/guides.cjs';
import { publicMetadata, pageGraph, serializeJsonLd } from '@/lib/seo/metadata.cjs';
const title = 'Practical guides to virtual care';
const description = 'Prepare for a video appointment, understand prescription coordination and protect your information with practical DoctaRx guides.';
export const metadata = publicMetadata({ title, description, path: '/blog' });
export default function BlogPage() {
  return <main className="mx-auto max-w-5xl px-6 py-16">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(pageGraph({ title, description, path: '/blog', breadcrumbs: [['DoctaRx', '/'], ['Guides', '/blog']] })) }} />
    <Link href="/" className="underline underline-offset-4">DoctaRx home</Link>
    <h1 className="mt-8 text-4xl font-bold">{title}</h1>
    <p className="mt-4 max-w-3xl text-lg leading-8">{description}</p>
    <p className="mt-4 leading-7">These are product-use guides from DoctaRx, not clinical advice or clinician-reviewed treatment guidance. Service availability depends on your location and care team.</p>
    <div className="mt-10 grid gap-6">
      {guides.map(guide => <article key={guide.slug} className="rounded-2xl border border-border p-6">
        <h2 className="text-2xl font-semibold"><Link href={'/blog/' + guide.slug} className="underline underline-offset-4">{guide.title}</Link></h2>
        <p className="mt-3 leading-7">{guide.description}</p>
        <p className="mt-4 text-sm">By DoctaRx · Product guide</p>
      </article>)}
    </div>
    <p className="mt-10"><Link href="/international" className="underline underline-offset-4">Explore DoctaRx in your language</Link></p>
  </main>;
}

